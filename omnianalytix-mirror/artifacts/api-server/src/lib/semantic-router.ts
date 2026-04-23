// ─── Semantic Router ──────────────────────────────────────────────────────────
//
// Classifies an incoming user prompt into one of four execution categories
// and returns a specialized system-prompt addendum that sharpens the model's
// focus for that intent type.
//
// Design: Uses a fast, layered keyword matcher (zero latency, zero cost).
// No extra model call — classification happens in-memory before the main
// Vertex AI call is made.
// ─────────────────────────────────────────────────────────────────────────────

export type RouteCategory =
  | "WAREHOUSE_QUERY"   // Cross-platform SQL / joined inventory+ad analysis
  | "AD_EXECUTION"      // Mutations: budgets, bids, status changes, keywords
  | "SUPPORT_DOCS"      // How-to, definitions, platform guidance
  | "GENERAL_STRATEGY"; // Audits, attribution, growth strategy, diagnostics

interface RouteResult {
  category: RouteCategory;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  systemAddendum: string;
}

// ── Keyword signal banks ─────────────────────────────────────────────────────

const WAREHOUSE_SIGNALS = [
  /out.?of.?stock/i,
  /\binventory\b.*\bad(s?)\b/i,
  /\bad(s?)\b.*\binventory\b/i,
  /which\s+ads?\s+(are|is|promoting|running|spending)/i,
  /\bpoas\b.*\bsku\b/i,
  /\bsku\b.*\bpoas\b/i,
  /unified.?warehouse/i,
  /\bwarehouse\b/i,
  /\betl\b/i,
  /sync.+warehouse/i,
  /warehouse.+sync/i,
  /cross.?platform.+map/i,
  /\bsql\b.*query/i,
  /ads.+promoting.+product/i,
  /products?.+with.+zero.+inventor/i,
  /bleeding.+margin/i,
  /margin.+bleed/i,
  /v_ads_on_empty/i,
  /v_poas_by_sku/i,
  /join.*shopify.*google/i,
  /google.*shopify.*join/i,
];

const AD_EXECUTION_SIGNALS = [
  /\b(pause|enable|resume)\s+(the\s+)?(campaign|ad.?set|ad.?group|ad\b)/i,
  /increase.+(budget|bid|tROAS|tCPA)/i,
  /decrease.+(budget|bid|tROAS|tCPA)/i,
  /\bset\s+(the\s+)?(budget|bid|tROAS|tCPA)/i,
  /\bchange\s+(the\s+)?(budget|bid|tROAS|tCPA|status)/i,
  /\bupdate\s+(the\s+)?(campaign|ad.?set|ad|keyword|budget)/i,
  /add\s+negative\s+keyword/i,
  /\bnegative\s+keyword/i,
  /\bapply\s+(the\s+)?(change|update|bid|budget)/i,
  /\bexecute\s+(the\s+)?(change|mutation|action|update)/i,
  /\bturn\s+(on|off)\s+(the\s+)?(campaign|ad)/i,
  /\bduplicate\s+(the\s+)?(ad.?set|campaign)/i,
  /\blaunch\s+(the\s+)?(campaign|ad)/i,
  /upload\s+offline\s+conversion/i,
  /sync.+poas.+conversion/i,
  /push.+(to|into)\s+(google|meta|shopify)/i,
  /shopify.*\b(update|change|set|create|publish|draft|archive)\b/i,
  /\bcreate\s+(a\s+)?(discount|product|blog)/i,
  /\bfulfil(l)?\s+order/i,
  /asset.?group.*pause/i,
  /pause.*asset.?group/i,
];

const SUPPORT_DOCS_SIGNALS = [
  /^how\s+(do\s+i|to|can\s+i)/i,
  /^what\s+is\s+(a\s+|the\s+)?/i,
  /^what\s+does\s+/i,
  /^explain\s+/i,
  /^(give me\s+)?(a\s+)?(guide|tutorial|walkthrough|overview)\s+(on|for|to)/i,
  /difference\s+between\s+/i,
  /\bhelp\s+me\s+(understand|learn|set up|configure)/i,
  /^what.+(mean|means)/i,
  /\bsteps?\s+to\s+(set up|configure|connect|link)\b/i,
  /\bhow\s+does\s+(ga4|pmax|roas|poas|tROAS)\s+work/i,
  /how\s+do\s+i\s+(connect|link|set up|enable|add)\b/i,
];

// ── Classifier ────────────────────────────────────────────────────────────────

export function classifyPrompt(prompt: string): RouteResult {
  const p = prompt.trim();

  const warehouseScore  = WAREHOUSE_SIGNALS.filter((r) => r.test(p)).length;
  const executionScore  = AD_EXECUTION_SIGNALS.filter((r) => r.test(p)).length;
  const supportScore    = SUPPORT_DOCS_SIGNALS.filter((r) => r.test(p)).length;

  const maxScore = Math.max(warehouseScore, executionScore, supportScore);

  // Need at least 1 signal to commit to a specialized category
  if (maxScore === 0) {
    return {
      category:  "GENERAL_STRATEGY",
      confidence: "HIGH",
      systemAddendum: ADDENDA.GENERAL_STRATEGY,
    };
  }

  if (warehouseScore > 0 && warehouseScore >= executionScore && warehouseScore >= supportScore) {
    return {
      category:   "WAREHOUSE_QUERY",
      confidence: warehouseScore >= 2 ? "HIGH" : "MEDIUM",
      systemAddendum: ADDENDA.WAREHOUSE_QUERY,
    };
  }

  if (executionScore > 0 && executionScore >= warehouseScore && executionScore >= supportScore) {
    return {
      category:   "AD_EXECUTION",
      confidence: executionScore >= 2 ? "HIGH" : "MEDIUM",
      systemAddendum: ADDENDA.AD_EXECUTION,
    };
  }

  if (supportScore > 0) {
    return {
      category:   "SUPPORT_DOCS",
      confidence: supportScore >= 2 ? "HIGH" : "MEDIUM",
      systemAddendum: ADDENDA.SUPPORT_DOCS,
    };
  }

  return {
    category:   "GENERAL_STRATEGY",
    confidence: "LOW",
    systemAddendum: ADDENDA.GENERAL_STRATEGY,
  };
}

// ── Per-category system prompt addenda ───────────────────────────────────────

const ADDENDA: Record<RouteCategory, string> = {

  WAREHOUSE_QUERY: `

## ROUTER DIRECTIVE — WAREHOUSE_QUERY MODE

The user is asking a cross-platform data question. MANDATORY EXECUTION PATH:
1. Use the query_unified_warehouse tool to answer this question directly via SQL.
2. The warehouse has three tables (warehouse_shopify_products, warehouse_google_ads, warehouse_cross_platform_mapping) and two views (v_ads_on_empty_shelves, v_poas_by_sku).
3. If the warehouse returns 0 rows, instruct the user to run a sync ("sync the warehouse") and retry.
4. If the warehouse sync has never run, proactively suggest: "Trigger a warehouse sync first — type 'sync the warehouse' and retry."
5. NEVER fall back to querying individual platform APIs for a question that can be answered from the warehouse.
6. Format the result as a ranked data table with action items.`,

  AD_EXECUTION: `

## ROUTER DIRECTIVE — AD_EXECUTION MODE

The user wants to execute a platform change. MANDATORY EXECUTION PATH:
1. Identify: PLATFORM, ENTITY TYPE, ENTITY ID, and the CHANGE to be made.
2. If ANY of these four parameters is missing, halt immediately and state exactly what is needed: "Missing parameter: [X]. Provide [exact format expected] to proceed."
3. DO NOT attempt a write action with incomplete parameters.
4. For mutating actions: confirm the current state before the change, show what it will become, then queue for approval.
5. After approval is granted, confirm the change was applied and state the expected performance impact.
6. If the requested change contradicts best practices (e.g., lowering budget on a budget-limited campaign), surface this as a WARNING before proceeding.`,

  SUPPORT_DOCS: `

## ROUTER DIRECTIVE — SUPPORT_DOCS MODE

The user needs guidance or explanation. MANDATORY EXECUTION PATH:
1. Answer directly and concisely. No tool calls unless data is explicitly requested.
2. Structure the response: DEFINITION → HOW IT WORKS → WHAT TO DO IN THIS PLATFORM.
3. If the guidance leads to an action, end with: "Want me to apply this now? Confirm and I'll execute."
4. Reference specific platform locations (e.g., "Google Ads → Campaigns → Settings → Bidding") for configuration steps.
5. Maximum 4 paragraphs. Use bullet points for steps.`,

  GENERAL_STRATEGY: `

## ROUTER DIRECTIVE — GENERAL_STRATEGY MODE

The user wants strategic analysis or a full audit. MANDATORY EXECUTION PATH:
1. Pull live data from all connected platforms using available read tools.
2. Identify the top 3 highest-impact issues (ranked by estimated revenue impact).
3. For each issue: STATE the problem → QUANTIFY the impact → RECOMMEND the action.
4. Format as: 🔴 CRITICAL / 🟡 WARNING / 🟢 HEALTHY.
5. End with a prioritized action queue: "Execute [X] first — estimated impact $Y/month."`,
};
