// ─── LLM Output Sanitizer ─────────────────────────────────────────────────────
//
// Intercepts Vertex AI output text BEFORE it reaches the React frontend.
// Enforces two rules:
//
//   1. SYSTEM PROMPT SCRUBBING  — strips any fragment that looks like a leaked
//      system instruction, internal directive, or tool JSON schema.
//
//   2. RAW SQL SCRUBBING        — strips raw warehouse SQL blocks from the
//      visible chat output. Admins can see them by setting OMNI_DEBUG_MODE=true.
//
// If a critical violation is detected, the entire fragment is replaced with a
// safe blocked-output notice rather than passing corrupted text downstream.
// ─────────────────────────────────────────────────────────────────────────────

const DEBUG_MODE = process.env.OMNI_DEBUG_MODE === "true";

// ── System-prompt leak patterns ───────────────────────────────────────────────
// These patterns indicate the model is echoing back its own system instructions.
const SYSTEM_LEAK_PATTERNS: RegExp[] = [
  /You are(?: the)? OmniAnalytix\b/gi,
  /CORE OPERATING DIRECTIVES/gi,
  /SYSTEM IDENTITY & CAPABILITIES/gi,
  /OPERATING PROTOCOL/gi,
  /## ROUTER DIRECTIVE\s*—/gi,
  /## EXECUTIVE PERSONA MODE/gi,
  /## FORENSIC AUDITOR/gi,
  /STRICT COMMUNICATION RULES:/gi,
  /BANNED PHRASES:/gi,
  /ANTI-LEAKAGE DIRECTIVE/gi,
  /ERROR COMMUNICATION RULES/gi,
  /MISSING CONNECTION RESPONSE PROTOCOL/gi,
  /ZERO-FRICTION CLARIFICATION MANDATE/gi,
  /CHAINED EXECUTION RULES/gi,
  /CONTEXT PRE-LOADER/gi,
  /ACTIVE MODE:\s*(?:E-Commerce|Lead Gen|Hybrid)/gi,
  // RBAC dynamic prompt section headers — prevent persona instructions leaking
  /## RBAC PERSONA\s*—/gi,
  /## LIVE WORKSPACE CONTEXT/gi,
  /## UI ACTION PROTOCOL/gi,
  /RBAC CLIENT SAFETY RULES/gi,
  /CRITICAL CLIENT SAFETY RULES/gi,

  // Defence-in-depth: even though we no longer INJECT `[SYSTEM — …]` directives
  // (we use <orchestrator_instruction> XML tags now), strip any residual leak.
  /\[SYSTEM\s*—\s*(?:RECOVERY DIRECTIVE|SAFETY CATCH|ROUTER DIRECTIVE|CONTEXT PRE-LOADER)\]/gi,
  /^\s*\[SYSTEM[^\]]*\][^\n]*\n?/gim,
  // Strip any orchestrator XML tag the model echoes back verbatim
  /<\/?orchestrator_instruction(?:\s+[^>]*)?>/gi,
  // Raw warehouse view / table name leaks — specific known prefixes only
  /\bv_(?:ads|poas|inventory|orders|sessions|campaign|product|sku|gmc|crm|attribution)_[a-z_]+\b/g,
  /\bwarehouse_[a-z_]+\b/g,
  // Fenced thinking blocks (Gemini occasionally emits these despite includeThoughts=false)
  /```(?:thinking|internal|system)[\s\S]*?```/gi,

  /"name"\s*:\s*"[a-z_]{5,}"\s*,\s*"description"\s*:\s*"/gi,
  /"parameters"\s*:\s*\{\s*"type"\s*:\s*"object"/gi,
  /"functionCall"\s*:\s*\{/gi,
  /"functionResponse"\s*:\s*\{/gi,

  /\b(?:shopify|googleAds|google_ads|meta|gsc|gmc|ga4|crm|crossPlatform|gemini|compliance)_[a-zA-Z]+[A-Z]?[a-zA-Z]*\b/g,
  /\bdispatchToolCall\b/g,
  /\bvalidateToolArgs\b/g,
  /\bqueueWriteOperation\b/g,
  /\bmissingConnectionError\b/g,
  /\bgetRequiredPlatform\b/g,

  /I will now attempt to recover/gi,
  /Let me try again with/gi,
  /I encountered an? (?:internal )?error/gi,
  /The tool returned/gi,
  /Tool error:\s/gi,
  /ECONNREFUSED\s+[\d.:]+/gi,
  /connection refused/gi,
];

// ── Raw SQL patterns ──────────────────────────────────────────────────────────
// Detect multi-line or inline SQL that the AI generated internally.
// These are internal plumbing — users see the results, not the SQL.
const RAW_SQL_PATTERNS: RegExp[] = [
  // Full SELECT blocks against warehouse tables
  /```sql[\s\S]{10,}?```/gi,
  /SELECT\s+(?:DISTINCT\s+)?(?:\w+\.)?(?:\w+|\*)\s+[\s\S]{30,}?FROM\s+warehouse_\w+/gi,
  // Inline single-line warehouse SQL
  /SELECT\b.{20,}FROM\s+warehouse_\w+[^;\n]*/gi,
  // Views by name
  /SELECT\b.{5,}FROM\s+v_(?:ads_on_empty_shelves|poas_by_sku)\b[^;\n]*/gi,
];

const SQL_PLACEHOLDER = "[SQL REDACTED — ENABLE DEBUG MODE TO VIEW]";

const STACK_TRACE_PATTERNS: RegExp[] = [
  /at\s+[\w$.]+\s+\([\w/\\.:]+:\d+:\d+\)/g,
  /Error:\s+\w+Error:?\s/gi,
  /TypeError:\s/gi,
  /ReferenceError:\s/gi,
  /node_modules\//g,
  /^\s*at\s+.+\(.+:\d+:\d+\)\s*$/gm,
];

// ── Critical violation patterns ───────────────────────────────────────────────
// If found, replace the entire text fragment with a blocked-output notice.
const CRITICAL_VIOLATION_PATTERNS: RegExp[] = [
  // Bulk credential or private-key dumps
  /-----BEGIN\s+(?:RSA|EC|PRIVATE)\s+KEY-----/gi,
  /(?:access_token|refresh_token|developer_token)\s*[:=]\s*["']?[A-Za-z0-9_\-./+]{30,}/gi,
  // Explicit system prompt reproduction
  /^##\s+SYSTEM IDENTITY/gim,
];

/**
 * Sanitizes a chunk of text from the LLM output stream.
 *
 * @param chunk  Raw text fragment from Vertex AI
 * @returns      Sanitized string safe to send to the frontend,
 *               or null if the entire fragment should be dropped silently.
 */
export function sanitizeOutput(chunk: string): string | null {
  if (!chunk || chunk.trim() === "") return chunk;

  // ── Critical check: replace entire fragment ────────────────────────────────
  for (const pattern of CRITICAL_VIOLATION_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(chunk)) {
      return "Output blocked by security policy. Please rephrase your request.";
    }
  }

  let safe = chunk;

  // ── System prompt scrubbing ────────────────────────────────────────────────
  for (const pattern of SYSTEM_LEAK_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(safe)) {
      // Replace the matching segment, not the whole response
      safe = safe.replace(pattern, "[REDACTED]");
    }
  }

  // ── Raw SQL scrubbing ──────────────────────────────────────────────────────
  if (!DEBUG_MODE) {
    for (const pattern of RAW_SQL_PATTERNS) {
      pattern.lastIndex = 0;
      safe = safe.replace(pattern, SQL_PLACEHOLDER);
    }
  }

  // ── Stack trace scrubbing ────────────────────────────────────────────────
  if (!DEBUG_MODE) {
    for (const pattern of STACK_TRACE_PATTERNS) {
      pattern.lastIndex = 0;
      safe = safe.replace(pattern, "[REDACTED]");
    }
  }

  return safe;
}

/**
 * Sanitizes the final accumulated full-response string before DB storage.
 * More aggressive than the streaming version since it operates on the
 * complete text and can apply multi-line patterns cleanly.
 */
export function sanitizeFullResponse(text: string): string {
  let safe = text;

  for (const pattern of CRITICAL_VIOLATION_PATTERNS) {
    pattern.lastIndex = 0;
    safe = safe.replace(pattern, "[REDACTED BY SECURITY POLICY]");
  }

  for (const pattern of SYSTEM_LEAK_PATTERNS) {
    pattern.lastIndex = 0;
    safe = safe.replace(pattern, "[REDACTED]");
  }

  if (!DEBUG_MODE) {
    for (const pattern of RAW_SQL_PATTERNS) {
      pattern.lastIndex = 0;
      safe = safe.replace(pattern, SQL_PLACEHOLDER);
    }
    for (const pattern of STACK_TRACE_PATTERNS) {
      pattern.lastIndex = 0;
      safe = safe.replace(pattern, "[REDACTED]");
    }
  }

  return safe;
}
