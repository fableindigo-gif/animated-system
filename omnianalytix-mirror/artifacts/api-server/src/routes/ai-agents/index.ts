/**
 * AI Agent Builder — CRUD, Knowledge Base Ingestion, RAG Chat, Script Embed, Billing
 *
 * Embeddings: Vertex AI text-embedding-004 (768 dims) via service account JWT auth
 * Chat:       Gemini 2.5 Flash via @workspace/integrations-gemini-ai (already provisioned)
 * Files:      pdf-parse (PDF), csv-parse (CSV), utf-8 buffer (TXT)
 * Vector DB:  pgvector (cosine similarity <=>)
 */

import { Router, type Request } from "express";
import multer from "multer";
import Stripe from "stripe";
import { createSign, createPrivateKey, randomBytes } from "crypto";
import { db, aiAgents, kbDocuments, kbChunks } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { handleRouteError } from "../../lib/route-error-handler";
import { assertOwnsAgent } from "../../lib/tenant-guards";
import { requireOrgId } from "../../middleware/rbac";
import { logger } from "../../lib/logger";
import {
  runAdkAgent,
  generateSmartTitle,
  listAdkSessions,
  getAdkSession,
  updateAdkSession,
  deleteAdkSession,
  resolveAdkSessionMissReason,
  AdkConfigError,
  AdkRunError,
} from "../../services/adk-agent";

const router = Router();

// ─── Stripe ───────────────────────────────────────────────────────────────────
let stripe: Stripe | null = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    // Stripe v22 doesn't expose `StripeConfig` on the namespace; the SDK
    // accepts any pinned date-string at runtime, so we cast through `any`.
    apiVersion: "2025-04-30.basil" as any,
  });
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const CHUNK_SIZE        = 500;
const CHUNK_OVERLAP     = 50;
const TOP_K             = 5;
const AGENT_PRICE_CENTS = 15000; // $150/mo

// ─── Vertex AI credentials ────────────────────────────────────────────────────
const GCP_PROJECT  = process.env.GOOGLE_CLOUD_PROJECT ?? "";
const GCP_LOCATION = process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1";

// In-memory token cache (expires in 55 min to be safe)
let _gcpToken:   string | null = null;
let _gcpExpires: number        = 0;

function base64url(data: string | Buffer): string {
  return Buffer.from(data).toString("base64url");
}

async function getGCPAccessToken(): Promise<string> {
  if (_gcpToken && Date.now() < _gcpExpires) return _gcpToken;

  const raw = process.env.VERTEX_AI_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("VERTEX_AI_SERVICE_ACCOUNT_JSON is not set");

  const sa    = JSON.parse(raw) as { client_email: string; private_key: string; project_id?: string };
  const email = sa.client_email;
  const key   = sa.private_key;

  const now     = Math.floor(Date.now() / 1000);
  const header  = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iss:   email,
    sub:   email,
    aud:   "https://oauth2.googleapis.com/token",
    iat:   now,
    exp:   now + 3600,
    scope: "https://www.googleapis.com/auth/cloud-platform",
  }));

  const sign = createSign("RSA-SHA256");
  sign.update(`${header}.${payload}`);
  const sig = base64url(sign.sign(createPrivateKey(key)));
  const jwt = `${header}.${payload}.${sig}`;

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion:  jwt,
    }),
  });

  if (!resp.ok) throw new Error(`GCP token exchange failed: ${resp.status} ${await resp.text()}`);
  const { access_token } = await resp.json() as { access_token: string };

  _gcpToken   = access_token;
  _gcpExpires = Date.now() + 55 * 60 * 1000; // cache for 55 min
  return access_token;
}

// ─── Vertex AI text-embedding-004 (768 dims) ──────────────────────────────────
async function embedTexts(texts: string[], taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" = "RETRIEVAL_DOCUMENT"): Promise<number[][]> {
  if (!texts.length) return [];
  const token   = await getGCPAccessToken();
  const project = GCP_PROJECT;
  const location = GCP_LOCATION;
  const url     = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/text-embedding-004:predict`;

  const results: number[][] = [];

  // Vertex AI text-embedding-004 accepts up to 250 instances per request; batch at 100 to be safe
  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100);
    const resp  = await fetch(url, {
      method:  "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body:    JSON.stringify({
        instances: batch.map((content) => ({ content, task_type: taskType })),
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Vertex embedding error: ${resp.status} — ${body.substring(0, 300)}`);
    }

    const data = await resp.json() as { predictions: { embeddings: { values: number[] } }[] };
    for (const pred of data.predictions) {
      results.push(pred.embeddings.values);
    }
  }

  return results;
}

// ─── pgvector cosine similarity search ───────────────────────────────────────
// SECURITY: Uses parameterized `sql\`\`` template, NOT sql.raw with string
// interpolation. The previous version concatenated `agentId` and `vecStr`
// directly into the SQL string. While both happen to be server-derived today
// (agentId from a DB row, vecStr from a Vertex embedding response), the
// pattern is a footgun — a future refactor that lets either become
// user-influenced would silently re-introduce SQL injection. The tagged-
// template form below auto-parameterizes via the pg driver.
async function similaritySearch(agentId: number, queryEmbedding: number[]): Promise<string[]> {
  const vecStr = `[${queryEmbedding.join(",")}]`;
  const rows   = await db.execute(sql`
    SELECT content
    FROM kb_chunks
    WHERE agent_id = ${agentId}
    ORDER BY embedding <=> ${vecStr}::vector
    LIMIT ${TOP_K}
  `);
  return (rows.rows as { content: string }[]).map((r) => r.content);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function resolveOrgId(req: any): number | null {
  if (req.rbacUser?.organizationId) return Number(req.rbacUser.organizationId);
  if (req.user?.organizationId)     return Number(req.user.organizationId);
  return null;
}

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const chunk = text.slice(start, start + CHUNK_SIZE).trim();
    if (chunk.length > 20) chunks.push(chunk);
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks;
}

function appDomain(req: { hostname: string }): string {
  if (process.env.APP_DOMAIN) return process.env.APP_DOMAIN;
  const replitDomains = (process.env.REPLIT_DOMAINS ?? "").split(",").map((d) => d.trim()).filter(Boolean);
  const custom = replitDomains.find((d) => !d.endsWith(".replit.app") && !d.endsWith(".repl.co"));
  return custom ?? replitDomains[0] ?? req.hostname;
}

function buildDefaultPrompt(agent: { name: string; objective: string; customObjective: string | null; toneOfVoice: string }): string {
  const obj = agent.customObjective || agent.objective;
  return [
    `You are ${agent.name}, an AI assistant.`,
    `Your primary objective is: ${obj}.`,
    `Tone of voice: ${agent.toneOfVoice}.`,
    "Answer concisely using only the provided context. If you don't know the answer from the context, say so politely.",
    "Do not invent information not present in the context.",
  ].join(" ");
}

// ─── Document ingestion (background, non-blocking) ───────────────────────────
async function ingestDocument(docId: number, agentId: number, buffer: Buffer, fileType: string, fileName: string) {
  try {
    let text = "";

    if (fileType === "pdf") {
      // pdf-parse v2 ships ESM with a named export; older types still
      // expect `.default`. Fall back to either to remain version-resilient.
      const pdfMod   = await import("pdf-parse");
      const pdfParse = ((pdfMod as { default?: unknown }).default ?? pdfMod) as
        (buffer: Buffer) => Promise<{ text: string }>;
      const parsed   = await pdfParse(buffer);
      text = parsed.text;
    } else if (fileType === "csv") {
      const { parse } = await import("csv-parse/sync");
      const records   = parse(buffer.toString("utf-8"), { columns: true, skip_empty_lines: true }) as Record<string, string>[];
      text = records.map((r) => Object.values(r).join(" ")).join("\n");
    } else {
      text = buffer.toString("utf-8");
    }

    const chunks     = chunkText(text);
    const embeddings = await embedTexts(chunks, "RETRIEVAL_DOCUMENT");

    for (let i = 0; i < chunks.length; i++) {
      await db.insert(kbChunks).values({
        documentId: docId,
        agentId,
        content:   chunks[i],
        embedding: embeddings[i],
        metadata:  { source: fileName, row: i },
      });
    }

    await db
      .update(kbDocuments)
      .set({ status: "ready", chunkCount: chunks.length })
      .where(eq(kbDocuments.id, docId));

    logger.info({ docId, agentId, chunks: chunks.length, model: "text-embedding-004" }, "KB document ingested via Vertex AI");
  } catch (err) {
    logger.error({ err, docId }, "KB document ingestion failed");
    await db
      .update(kbDocuments)
      .set({ status: "failed", errorMessage: String(err).substring(0, 500) })
      .where(eq(kbDocuments.id, docId));
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// PUBLIC ENDPOINTS — no auth middleware, must be before CRUD routes
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/ai-agents/config/:scriptId — agent config JSON for widget
router.get("/config/:scriptId", async (req, res) => {
  try {
    // tenant-ownership-skip: scriptId is a 32-char unguessable token issued
    // per-agent (POST /:id/generate-script). It IS the tenancy proof — the
    // public widget on the customer's site has no other auth.
    const [agent] = await db
      .select({
        name:           aiAgents.name,
        toneOfVoice:    aiAgents.toneOfVoice,
        objective:      aiAgents.objective,
        primaryColor:   aiAgents.primaryColor,
        welcomeMessage: aiAgents.welcomeMessage,
        isActive:       aiAgents.isActive,
      })
      .from(aiAgents)
      .where(eq(aiAgents.scriptId, req.params.scriptId))
      .limit(1);

    if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
    res.json(agent);
  } catch (err) {
    handleRouteError(err, req, res, "GET /api/ai-agents/config/:scriptId", { error: "Failed to fetch config" });
  }
});

// POST /api/ai-agents/chat/:scriptId — RAG chat powered by Vertex AI embeddings + Gemini 2.5 Flash
router.post("/chat/:scriptId", async (req, res) => {
  try {
    const { message, history = [] } = req.body as {
      message: string;
      history?: { role: "user" | "assistant"; content: string }[];
    };

    if (!message?.trim()) { res.status(400).json({ error: "message is required" }); return; }

    // tenant-ownership-skip: same as /config/:scriptId — scriptId IS the auth
    // for public widget chat. Counter UPDATEs below scope by `agent.id` which
    // came from this lookup, so they inherit the tenancy proof.
    const [agent] = await db
      .select()
      .from(aiAgents)
      .where(eq(aiAgents.scriptId, req.params.scriptId))
      .limit(1);

    if (!agent || !agent.isActive) {
      res.json({ reply: "This agent is not currently active." });
      return;
    }

    // ── RAG retrieval (Vertex AI query embedding → pgvector cosine search) ──
    let context = "";
    try {
      const [queryEmbedding] = await embedTexts([message], "RETRIEVAL_QUERY");
      const chunks            = await similaritySearch(agent.id, queryEmbedding);
      if (chunks.length > 0) {
        context = `\n\n--- Relevant Knowledge Base Context ---\n${chunks.join("\n\n---\n")}\n--- End Context ---`;
      }
    } catch (embErr) {
      logger.warn({ embErr }, "RAG retrieval failed — proceeding without context");
    }

    const systemPrompt = (agent.systemPrompt || buildDefaultPrompt(agent)) + context;

    // ── Gemini 2.5 Flash response generation ──────────────────────────────────
    let reply = "I'm unable to process your request right now. Please try again later.";
    try {
      const { ai } = await import("@workspace/integrations-gemini-ai");

      const chatHistory = history.slice(-10).map((h) => ({
        role:  h.role === "assistant" ? "model" as const : "user" as const,
        parts: [{ text: h.content }],
      }));

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          { role: "user", parts: [{ text: `[System Instructions]\n${systemPrompt}` }] },
          { role: "model", parts: [{ text: "Understood. I will follow these instructions." }] },
          ...chatHistory,
          { role: "user", parts: [{ text: message }] },
        ],
        config: { maxOutputTokens: 8192 },
      });

      reply = response.text?.trim() ?? reply;
    } catch (geminiErr) {
      logger.warn({ geminiErr }, "Gemini chat response failed");
    }

    // tenant-ownership-skip: `agent` was loaded above via the public scriptId
    // (the widget's tenancy proof); `agent.id` is therefore tenant-bound and
    // safe as the only WHERE predicate for this counter increment.
    db.update(aiAgents)
      .set({
        totalMessages:      sql`${aiAgents.totalMessages} + 1`,
        totalConversations: history.length === 0
          ? sql`${aiAgents.totalConversations} + 1`
          : aiAgents.totalConversations,
      })
      .where(eq(aiAgents.id, agent.id))
      .catch(() => {});

    res.json({ reply });
  } catch (err) {
    logger.error({ err }, "agent chat error");
    res.status(500).json({ error: "Chat failed" });
  }
});

// GET /api/ai-agents/widget.js — self-contained embeddable chat widget
router.get("/widget.js", async (req, res) => {
  const scriptId = req.query.id as string;
  if (!scriptId) { res.status(400).send("// Missing script id"); return; }

  const domain = appDomain(req);
  const apiBase = `https://${domain}/api/ai-agents`;

  const js = /* js */`
(function() {
  var SCRIPT_ID = "${scriptId}";
  var API_BASE  = "${apiBase}";
  var config    = { primaryColor: "#1a73e8", welcomeMessage: "Hi! How can I help?", name: "AI Assistant" };
  var history   = [];
  var open      = false;

  fetch(API_BASE + "/config/" + SCRIPT_ID)
    .then(function(r) { return r.json(); })
    .then(function(c) {
      config = c;
      var btn = document.getElementById("__omni_btn");
      if (btn) btn.style.background = c.primaryColor;
      var hdr = document.getElementById("__omni_hdr");
      if (hdr) { hdr.style.background = c.primaryColor; hdr.textContent = "\\u{1F4AC} " + c.name; }
      var snd = document.getElementById("__omni_send");
      if (snd) snd.style.background = c.primaryColor;
    }).catch(function() {});

  var style = document.createElement("style");
  style.textContent = "#__omni_fab{position:fixed;bottom:24px;right:24px;z-index:999999}#__omni_btn{width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;background:#1a73e8;color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(0,0,0,.28);transition:.2s}#__omni_btn:hover{transform:scale(1.08)}#__omni_win{position:fixed;bottom:92px;right:24px;width:360px;max-height:520px;border-radius:20px;background:#fff;box-shadow:0 8px 40px rgba(0,0,0,.18);display:flex;flex-direction:column;z-index:999998;overflow:hidden;transition:opacity .2s,transform .2s}#__omni_win.hidden{opacity:0;pointer-events:none;transform:translateY(12px)}#__omni_hdr{padding:14px 16px;color:#fff;font:700 14px/1 sans-serif}#__omni_msgs{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;font:13px/1.5 sans-serif}#__omni_msgs::-webkit-scrollbar{width:4px}#__omni_msgs::-webkit-scrollbar-thumb{background:#e2e8f0;border-radius:4px}.omni_msg{max-width:82%;padding:9px 13px;border-radius:16px;word-break:break-word}.omni_msg.bot{background:#f1f5f9;color:#1e293b;align-self:flex-start;border-bottom-left-radius:4px}.omni_msg.usr{color:#fff;align-self:flex-end;border-bottom-right-radius:4px}#__omni_inp{display:flex;padding:10px 12px;gap:8px;border-top:1px solid #e2e8f0}#__omni_inp input{flex:1;border:1.5px solid #e2e8f0;border-radius:12px;padding:8px 12px;font-size:13px;outline:none;font-family:sans-serif;transition:.15s}#__omni_inp input:focus{border-color:#94a3b8}#__omni_inp button{border:none;border-radius:12px;padding:8px 16px;cursor:pointer;font:600 13px sans-serif;color:#fff;transition:.15s}#__omni_inp button:hover{opacity:.88}#__omni_inp button:disabled{opacity:.5;cursor:default}";
  document.head.appendChild(style);

  var fab = document.createElement("div");
  fab.id  = "__omni_fab";
  fab.innerHTML = '<button id="__omni_btn" aria-label="Open chat"><svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></button><div id="__omni_win" class="hidden"><div id="__omni_hdr" style="background:#1a73e8">\\u{1F4AC} AI Assistant</div><div id="__omni_msgs"></div><div id="__omni_inp"><input id="__omni_q" type="text" placeholder="Ask something\\u2026" /><button id="__omni_send" style="background:#1a73e8">Send</button></div></div>';
  document.body.appendChild(fab);

  var win  = document.getElementById("__omni_win");
  var msgs = document.getElementById("__omni_msgs");
  var inp  = document.getElementById("__omni_q");
  var btn  = document.getElementById("__omni_btn");
  var send = document.getElementById("__omni_send");

  function addMsg(role, text) {
    var el = document.createElement("div");
    el.className = "omni_msg " + (role === "bot" ? "bot" : "usr");
    if (role !== "bot") el.style.background = config.primaryColor;
    el.textContent = text;
    msgs.appendChild(el);
    msgs.scrollTop = msgs.scrollHeight;
  }

  setTimeout(function() {
    fetch(API_BASE + "/config/" + SCRIPT_ID).then(function(r){return r.json();}).then(function(c){
      config = c;
      addMsg("bot", c.welcomeMessage || "Hi! How can I help you today?");
      var hdr = document.getElementById("__omni_hdr");
      if (hdr) { hdr.style.background = c.primaryColor; hdr.textContent = "\\u{1F4AC} " + c.name; }
      if (send) send.style.background = c.primaryColor;
      if (btn)  btn.style.background  = c.primaryColor;
    }).catch(function() { addMsg("bot", "Hi! How can I help you today?"); });
  }, 350);

  btn.addEventListener("click", function() {
    open = !open;
    win.classList.toggle("hidden", !open);
    if (open && inp) inp.focus();
  });

  function doSend() {
    var q = inp.value.trim();
    if (!q || send.disabled) return;
    inp.value = "";
    send.disabled = true;
    addMsg("usr", q);
    history.push({ role: "user", content: q });

    var thinking = document.createElement("div");
    thinking.className = "omni_msg bot";
    thinking.innerHTML = "<em style='color:#94a3b8'>Thinking\\u2026</em>";
    msgs.appendChild(thinking);
    msgs.scrollTop = msgs.scrollHeight;

    fetch(API_BASE + "/chat/" + SCRIPT_ID, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: q, history: history.slice(-10) }),
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      msgs.removeChild(thinking);
      var reply = d.reply || "Sorry, I couldn\\u0027t process that.";
      addMsg("bot", reply);
      history.push({ role: "assistant", content: reply });
    })
    .catch(function() {
      msgs.removeChild(thinking);
      addMsg("bot", "Something went wrong. Please try again.");
    })
    .finally(function() { send.disabled = false; inp.focus(); });
  }

  send.addEventListener("click", doSend);
  inp.addEventListener("keydown", function(e) { if (e.key === "Enter" && !e.shiftKey) doSend(); });
})();
`;

  res.setHeader("Content-Type", "application/javascript");
  res.setHeader("Cache-Control", "public, max-age=60");
  res.send(js);
});

// ═════════════════════════════════════════════════════════════════════════════
// ADK AGENT RUN — POST /ai-agents/run
// ═════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/ai-agents/run
 *
 * Runs a prompt through the Google ADK-orchestrated OmniAnalytix agent.
 * Accepts { prompt, sessionId? } and returns { output, sessionId, toolCalls }.
 *
 * Auth: requires a valid organisation session (uses requireOrgId chokepoint).
 * Session continuity: pass the returned sessionId back in subsequent calls.
 *
 * Error codes:
 *   ADK_CONFIG_ERROR — GEMINI_API_KEY is not configured (503)
 *   ADK_RUN_ERROR    — model / auth failure during the run (502)
 *   VALIDATION_ERROR — missing or invalid request body (400)
 */
/**
 * Build the per-user identifier used to scope ADK sessions. We combine the
 * org id and the team-member id so a leaked session id cannot be resumed by a
 * user from a different organisation, even one with the same numeric memberId.
 */
function adkUserIdFor(req: Request): string | null {
  const orgId    = req.rbacUser?.organizationId ?? req.jwtPayload?.organizationId ?? null;
  const memberId = req.rbacUser?.id            ?? req.jwtPayload?.memberId       ?? null;
  if (orgId == null || memberId == null) return null;
  return `org:${orgId}:user:${memberId}`;
}

router.post("/run", async (req, res) => {
  try {
    requireOrgId(req); // throws 401 AUTH_REQUIRED if not authenticated
    const adkUserId = adkUserIdFor(req);
    if (!adkUserId) {
      res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });
      return;
    }

    const { prompt, sessionId } = req.body ?? {};

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      res.status(400).json({ error: "prompt is required and must be a non-empty string", code: "VALIDATION_ERROR" });
      return;
    }

    const result = await runAdkAgent(prompt.trim(), adkUserId, sessionId ?? undefined);

    // Fire-and-forget smart title generation after the first exchange.
    // Only runs when a brand-new session was just created so we always get a
    // title that reflects the actual opening topic, not a vague first message.
    if (result.isNewSession) {
      generateSmartTitle(adkUserId, result.sessionId, prompt.trim(), result.output).catch(() => {
        // Already logged inside generateSmartTitle — suppress unhandled-rejection noise.
      });
    }

    res.json(result);
  } catch (err) {
    if (err instanceof AdkConfigError) {
      logger.warn({ err }, "[POST /ai-agents/run] ADK not configured");
      res.status(503).json({ error: err.message, code: err.code });
      return;
    }
    if (err instanceof AdkRunError) {
      logger.error({ err }, "[POST /ai-agents/run] ADK run error");
      res.status(502).json({ error: err.message, code: err.code });
      return;
    }
    handleRouteError(err, req, res, "POST /api/ai-agents/run", { error: "Agent run failed" });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// ADK SESSION HISTORY — list, fetch, delete (per-user)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/ai-agents/sessions
 * List the authenticated user's past ADK conversations (newest first).
 */
router.get("/sessions", async (req, res) => {
  try {
    requireOrgId(req);
    const adkUserId = adkUserIdFor(req);
    if (!adkUserId) {
      res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });
      return;
    }

    // ── Parse + validate query params ───────────────────────────────────────
    const rawQuery        = typeof req.query.q === "string" ? req.query.q : "";
    const rawRange        = typeof req.query.dateRange === "string" ? req.query.dateRange : "";
    const dateRange       = rawRange === "today" || rawRange === "week" || rawRange === "older"
      ? rawRange
      : undefined;
    const limitParsed     = Number.parseInt(String(req.query.limit  ?? ""), 10);
    const offsetParsed    = Number.parseInt(String(req.query.offset ?? ""), 10);
    const limit           = Number.isFinite(limitParsed)  ? Math.min(Math.max(limitParsed, 1), 100) : 30;
    const offset          = Number.isFinite(offsetParsed) ? Math.max(offsetParsed, 0)               : 0;
    const includeArchived = req.query.archived === "1" || req.query.archived === "true";

    const result = await listAdkSessions(adkUserId, {
      query: rawQuery.slice(0, 200), // hard cap to avoid pathological ILIKE patterns
      dateRange,
      limit,
      offset,
      includeArchived,
    });
    res.json(result);
  } catch (err) {
    handleRouteError(err, req, res, "GET /api/ai-agents/sessions", { error: "Failed to list sessions" });
  }
});

/**
 * GET /api/ai-agents/sessions/:sessionId
 * Fetch full message history for one session. 404 if not owned by the caller.
 */
router.get("/sessions/:sessionId", async (req, res) => {
  try {
    requireOrgId(req);
    const adkUserId = adkUserIdFor(req);
    if (!adkUserId) {
      res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });
      return;
    }
    const session = await getAdkSession(adkUserId, req.params.sessionId);
    if (!session) {
      // resolveAdkSessionMissReason performs a secondary DB lookup (no userId
      // filter) so the route log carries an explicit reason field instead of
      // relying solely on correlation with the service-layer mismatch warn.
      const reason = await resolveAdkSessionMissReason(adkUserId, req.params.sessionId);
      logger.warn(
        {
          adkUserId,
          sessionId: req.params.sessionId,
          route:     "GET /api/ai-agents/sessions/:id",
          code:      "SESSION_NOT_FOUND",
          reason,
        },
        reason === "ownership_mismatch"
          ? "Session fetch blocked — session exists but is owned by a different user"
          : "Session fetch returned 404 — session does not exist",
      );
      res.status(404).json({ error: "Session not found", code: "NOT_FOUND" });
      return;
    }
    res.json({ session });
  } catch (err) {
    handleRouteError(err, req, res, "GET /api/ai-agents/sessions/:id", { error: "Failed to load session" });
  }
});

/**
 * PATCH /api/ai-agents/sessions/:sessionId
 * Rename / pin / archive a past conversation. Body accepts any subset of
 * { title?: string|null, pinned?: boolean, archived?: boolean }.
 * Tenant-scoped — returns 404 if not owned by the caller.
 */
router.patch("/sessions/:sessionId", async (req, res) => {
  try {
    requireOrgId(req);
    const adkUserId = adkUserIdFor(req);
    if (!adkUserId) {
      res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: { title?: string | null; pinned?: boolean; archived?: boolean } = {};

    if ("title" in body) {
      const t = body.title;
      if (t !== null && typeof t !== "string") {
        res.status(400).json({ error: "title must be a string or null", code: "VALIDATION_ERROR" });
        return;
      }
      patch.title = t as string | null;
    }
    if ("pinned" in body) {
      if (typeof body.pinned !== "boolean") {
        res.status(400).json({ error: "pinned must be a boolean", code: "VALIDATION_ERROR" });
        return;
      }
      patch.pinned = body.pinned;
    }
    if ("archived" in body) {
      if (typeof body.archived !== "boolean") {
        res.status(400).json({ error: "archived must be a boolean", code: "VALIDATION_ERROR" });
        return;
      }
      patch.archived = body.archived;
    }

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "No fields to update (expected title, pinned, or archived)", code: "VALIDATION_ERROR" });
      return;
    }

    const session = await updateAdkSession(adkUserId, req.params.sessionId, patch);
    if (!session) {
      res.status(404).json({ error: "Session not found", code: "NOT_FOUND" });
      return;
    }
    res.json({ session });
  } catch (err) {
    handleRouteError(err, req, res, "PATCH /api/ai-agents/sessions/:id", { error: "Failed to update session" });
  }
});

/**
 * DELETE /api/ai-agents/sessions/:sessionId
 * Remove a past conversation. Tenant-scoped — returns 404 if not owned.
 */
router.delete("/sessions/:sessionId", async (req, res) => {
  try {
    requireOrgId(req);
    const adkUserId = adkUserIdFor(req);
    if (!adkUserId) {
      res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });
      return;
    }
    const ok = await deleteAdkSession(adkUserId, req.params.sessionId);
    if (!ok) {
      // resolveAdkSessionMissReason performs a secondary DB lookup (no userId
      // filter) so the route log carries an explicit reason field instead of
      // relying solely on correlation with the service-layer mismatch warn.
      const reason = await resolveAdkSessionMissReason(adkUserId, req.params.sessionId);
      logger.warn(
        {
          adkUserId,
          sessionId: req.params.sessionId,
          route:     "DELETE /api/ai-agents/sessions/:id",
          code:      "SESSION_NOT_FOUND",
          reason,
        },
        reason === "ownership_mismatch"
          ? "Session delete blocked — session exists but is owned by a different user"
          : "Session delete returned 404 — session does not exist",
      );
      res.status(404).json({ error: "Session not found", code: "NOT_FOUND" });
      return;
    }
    res.json({ deleted: true });
  } catch (err) {
    handleRouteError(err, req, res, "DELETE /api/ai-agents/sessions/:id", { error: "Failed to delete session" });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// AUTH-REQUIRED CRUD ENDPOINTS
// ═════════════════════════════════════════════════════════════════════════════

router.get("/", async (req, res) => {
  const orgId = resolveOrgId(req);
  if (!orgId) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const agents = await db.select().from(aiAgents).where(eq(aiAgents.organizationId, orgId)).orderBy(desc(aiAgents.createdAt));
    res.json({ agents });
  } catch (err) {
    handleRouteError(err, req, res, "GET /api/ai-agents", { error: "Failed to list agents" });
  }
});

router.post("/", async (req, res) => {
  const orgId = resolveOrgId(req);
  if (!orgId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const { name, toneOfVoice = "Professional", objective = "Customer Support",
          customObjective, systemPrompt, primaryColor, welcomeMessage } = req.body ?? {};
  if (!name?.trim()) { res.status(400).json({ error: "name is required" }); return; }
  try {
    const [agent] = await db.insert(aiAgents).values({
      organizationId: orgId, name: name.trim(), toneOfVoice, objective,
      customObjective: customObjective ?? null, systemPrompt: systemPrompt ?? null,
      primaryColor: primaryColor ?? "#1a73e8", welcomeMessage: welcomeMessage ?? "Hi! How can I help you today?",
    }).returning();
    res.status(201).json({ agent });
  } catch (err) {
    logger.error({ err }, "create agent error");
    res.status(500).json({ error: "Failed to create agent" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const orgId   = requireOrgId(req);
    const agentId = parseInt(String(req.params.id), 10);
    if (isNaN(agentId)) { res.status(400).json({ error: "Invalid agent id" }); return; }
    // Explicit assertion before any KB child-table read. The parent SELECT
    // below ALSO scopes by organizationId, so this is defense-in-depth — a
    // future refactor that loosens the parent filter cannot silently
    // re-introduce a cross-tenant document leak.
    await assertOwnsAgent(orgId, agentId);
    const [agent] = await db.select().from(aiAgents)
      .where(and(eq(aiAgents.id, agentId), eq(aiAgents.organizationId, orgId))).limit(1);
    if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
    const documents = await db.select().from(kbDocuments)
      .where(eq(kbDocuments.agentId, agentId)).orderBy(desc(kbDocuments.createdAt));
    res.json({ agent, documents });
  } catch (err) {
    handleRouteError(err, req, res, "GET /api/ai-agents/:id", { error: "Failed to fetch agent" });
  }
});

router.put("/:id", async (req, res) => {
  const orgId   = resolveOrgId(req);
  if (!orgId)  { res.status(401).json({ error: "Unauthorized", code: "AUTH_REQUIRED" }); return; }
  const agentId = parseInt(String(req.params.id), 10);
  if (isNaN(agentId)) { res.status(400).json({ error: "Invalid agent id" }); return; }
  const { name, toneOfVoice, objective, customObjective, systemPrompt, primaryColor, welcomeMessage } = req.body ?? {};
  try {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined)           updates.name           = name;
    if (toneOfVoice !== undefined)    updates.toneOfVoice    = toneOfVoice;
    if (objective !== undefined)      updates.objective      = objective;
    if (customObjective !== undefined) updates.customObjective = customObjective;
    if (systemPrompt !== undefined)   updates.systemPrompt   = systemPrompt;
    if (primaryColor !== undefined)   updates.primaryColor   = primaryColor;
    if (welcomeMessage !== undefined) updates.welcomeMessage = welcomeMessage;
    const [agent] = await db.update(aiAgents).set(updates)
      .where(and(eq(aiAgents.id, agentId), eq(aiAgents.organizationId, orgId))).returning();
    if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
    res.json({ agent });
  } catch (err) {
    handleRouteError(err, req, res, "PATCH /api/ai-agents/:id", { error: "Failed to update agent" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const orgId   = requireOrgId(req);
    const agentId = parseInt(String(req.params.id), 10);
    if (isNaN(agentId)) { res.status(400).json({ error: "Invalid agent id" }); return; }
    // CRITICAL: verify ownership BEFORE deleting child rows. The previous
    // implementation deleted kbChunks + kbDocuments by agentId alone, then
    // tried (and silently no-op'd) to delete the parent agent — meaning any
    // caller who guessed an agentId could nuke another tenant's KB.
    await assertOwnsAgent(orgId, agentId);
    await db.delete(kbChunks).where(eq(kbChunks.agentId, agentId));
    await db.delete(kbDocuments).where(eq(kbDocuments.agentId, agentId));
    await db.delete(aiAgents).where(and(eq(aiAgents.id, agentId), eq(aiAgents.organizationId, orgId)));
    res.json({ success: true });
  } catch (err) {
    handleRouteError(err, req, res, "DELETE /api/ai-agents/:id", { error: "Failed to delete agent" });
  }
});

router.post("/:id/generate-script", async (req, res) => {
  const orgId   = resolveOrgId(req);
  if (!orgId)  { res.status(401).json({ error: "Unauthorized", code: "AUTH_REQUIRED" }); return; }
  const agentId = parseInt(String(req.params.id), 10);
  if (isNaN(agentId)) { res.status(400).json({ error: "Invalid agent id" }); return; }
  try {
    const scriptId = randomBytes(16).toString("hex");
    const [agent]  = await db.update(aiAgents)
      .set({ scriptId, isActive: true, updatedAt: new Date() })
      .where(and(eq(aiAgents.id, agentId), eq(aiAgents.organizationId, orgId)))
      .returning();
    const domain    = appDomain(req);
    const scriptTag = `<script src="https://${domain}/api/ai-agents/widget.js?id=${scriptId}" async></script>`;
    res.json({ agent, scriptTag });
  } catch (err) {
    handleRouteError(err, req, res, "POST /api/ai-agents/:id/generate-script", { error: "Failed to generate script" });
  }
});

router.post("/:id/subscribe", async (req, res) => {
  const orgId   = resolveOrgId(req);
  if (!orgId)  { res.status(401).json({ error: "Unauthorized", code: "AUTH_REQUIRED" }); return; }
  const agentId = parseInt(String(req.params.id), 10);
  if (isNaN(agentId)) { res.status(400).json({ error: "Invalid agent id" }); return; }
  try {
    const [agent] = await db.select().from(aiAgents)
      .where(and(eq(aiAgents.id, agentId), eq(aiAgents.organizationId, orgId))).limit(1);
    if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
    if (agent.stripeSubscriptionId) { res.json({ alreadySubscribed: true }); return; }
    if (!stripe) { res.json({ checkoutUrl: null, error: "Stripe not configured" }); return; }

    const domain     = appDomain(req);
    const fb         = process.env.FRONTEND_BASE_PATH ?? "";
    const successUrl = `https://${domain}${fb}/agent-builder/${agentId}?subscribed=1`;
    const cancelUrl  = `https://${domain}${fb}/agent-builder/${agentId}`;
    const email      = (req as any).rbacUser?.email ?? (req as any).user?.email;

    let customer: Stripe.Customer | null = null;
    if (agent.stripeCustomerId) {
      customer = await stripe.customers.retrieve(agent.stripeCustomerId) as Stripe.Customer;
    } else if (email) {
      const existing = await stripe.customers.list({ email, limit: 1 });
      customer = existing.data[0] ?? await stripe.customers.create({ email, metadata: { orgId: String(orgId) } });
      // Defense-in-depth: even though we already verified ownership at the
      // top of this handler when loading `agent`, scope the update by orgId
      // too so a future refactor that drops the early check can't silently
      // re-introduce a cross-tenant write.
      await db
        .update(aiAgents)
        .set({ stripeCustomerId: customer.id })
        .where(and(eq(aiAgents.id, agentId), eq(aiAgents.organizationId, orgId)));
    }

    const session = await stripe.checkout.sessions.create({
      mode:     "subscription",
      customer: customer?.id,
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: { name: `OmniAnalytix AI Agent — ${agent.name}`, description: "White-label conversational AI agent (RAG-powered)" },
          unit_amount: AGENT_PRICE_CENTS,
          recurring: { interval: "month" },
        },
        quantity: 1,
      }],
      success_url: successUrl,
      cancel_url:  cancelUrl,
      metadata:    { agentId: String(agentId), orgId: String(orgId) },
    });

    res.json({ checkoutUrl: session.url });
  } catch (err) {
    logger.error({ err }, "subscribe agent error");
    res.status(500).json({ error: "Failed to create subscription" });
  }
});

// ─── Document CRUD ────────────────────────────────────────────────────────────

router.get("/:id/documents", async (req, res) => {
  try {
    const orgId   = requireOrgId(req);
    const agentId = parseInt(String(req.params.id), 10);
    if (isNaN(agentId)) { res.status(400).json({ error: "Invalid agent id" }); return; }
    // CRITICAL: previous implementation listed any agent's docs by id —
    // pure cross-tenant data leak. Verify ownership first.
    await assertOwnsAgent(orgId, agentId);
    const documents = await db.select().from(kbDocuments)
      .where(eq(kbDocuments.agentId, agentId)).orderBy(desc(kbDocuments.createdAt));
    res.json({ documents });
  } catch (err) {
    handleRouteError(err, req, res, "GET /api/ai-agents/:id/documents", { error: "Failed to list documents" });
  }
});

router.post("/:id/documents", upload.single("file"), async (req, res) => {
  try {
    const orgId   = requireOrgId(req);
    const agentId = parseInt(String(req.params.id), 10);
    if (isNaN(agentId))  { res.status(400).json({ error: "Invalid agent id" }); return; }
    if (!req.file)       { res.status(400).json({ error: "No file uploaded" }); return; }

    if (!GCP_PROJECT || !process.env.VERTEX_AI_SERVICE_ACCOUNT_JSON) {
      res.status(503).json({ error: "VERTEX_AI_SERVICE_ACCOUNT_JSON is not set — cannot generate embeddings" });
      return;
    }

    // CRITICAL: previous implementation accepted uploads against any agent
    // id — an attacker could pollute another tenant's KB with their own
    // documents. Verify ownership first.
    await assertOwnsAgent(orgId, agentId);

    const { originalname, buffer, size } = req.file;
    const ext  = originalname.split(".").pop()?.toLowerCase() ?? "txt";
    const type = ext === "pdf" ? "pdf" : ext === "csv" ? "csv" : "txt";

    const [doc] = await db.insert(kbDocuments)
      .values({ agentId, fileName: originalname, fileType: type, fileSize: size, status: "processing" })
      .returning();

    ingestDocument(doc.id, agentId, buffer, type, originalname).catch((err) =>
      logger.error({ err, docId: doc.id }, "Ingest error"),
    );

    res.status(202).json({ document: doc });
  } catch (err) {
    handleRouteError(err, req, res, "POST /api/ai-agents/:id/documents", { error: "Failed to upload document" });
  }
});

router.delete("/:id/documents/:docId", async (req, res) => {
  try {
    const orgId   = requireOrgId(req);
    const agentId = parseInt(String(req.params.id), 10);
    const docId   = parseInt(req.params.docId, 10);
    if (isNaN(agentId) || isNaN(docId)) { res.status(400).json({ error: "Invalid id" }); return; }
    // CRITICAL: previous implementation deleted any agent's documents by
    // (agentId, docId) — attacker who guesses both wipes another tenant's
    // KB document + chunks. Verify agent ownership first.
    await assertOwnsAgent(orgId, agentId);
    await db.delete(kbChunks).where(and(eq(kbChunks.documentId, docId), eq(kbChunks.agentId, agentId)));
    await db.delete(kbDocuments).where(and(eq(kbDocuments.id, docId), eq(kbDocuments.agentId, agentId)));
    res.json({ success: true });
  } catch (err) {
    handleRouteError(err, req, res, "DELETE /api/ai-agents/:id/documents/:docId", { error: "Failed to delete document" });
  }
});

export default router;
