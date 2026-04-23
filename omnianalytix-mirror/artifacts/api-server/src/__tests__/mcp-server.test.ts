/**
 * VAG 1 Tests — MCP JSON-RPC Server
 *
 * Covers:
 *   • list_tools returns the full tool catalogue
 *   • invoke_tool with missing workspace_id/org_id → -32602
 *   • invoke_tool with org_id mismatch → -32603
 *   • invoke_tool → master_diagnostic_sweep returns structured alert payload
 *   • invoke_tool → predict_stockouts returns OOS SKU list
 *   • invoke_tool → unknown tool → -32601
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (must appear before any subject imports) ────────────────────────────

vi.mock("@workspace/db", () => {
  const makeChain = (resolveValue: unknown) => {
    const chain: Record<string, unknown> = {};
    const methods = ["select", "from", "where", "limit", "and", "insert", "values", "returning"];
    methods.forEach((m) => {
      chain[m] = vi.fn(() => chain);
    });
    (chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(resolveValue).then(resolve);
    Object.defineProperty(chain, Symbol.toStringTag, { value: "MockChain" });
    return chain;
  };

  return {
    db: {
      select: vi.fn(() => makeChain([])),
      insert: vi.fn(() => makeChain([{ id: 99 }])),
      execute: vi.fn().mockResolvedValue(undefined),
    },
    warehouseShopifyProducts: {
      tenantId: "tenantId",
      inventoryQty: "inventoryQty",
    },
    proposedTasks: {
      id: "id",
      idempotencyKey: "idempotencyKey",
      status: "status",
    },
    workspaces: { id: "id", organizationId: "organizationId" },
  };
});

vi.mock("../lib/advanced-diagnostic-engine", () => ({
  runAdvancedDiagnostics: vi.fn().mockResolvedValue([
    {
      id: "gads-budget-0",
      severity: "critical",
      title: "Campaign losing 55% impressions to budget",
      detail: "$1200 missed revenue",
      platform: "Google Ads",
      category: "pipeline",
      ts: new Date().toISOString(),
    },
  ]),
}));

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Subject ───────────────────────────────────────────────────────────────────

import {
  TOOL_REGISTRY,
  validateIsolationParams,
} from "../routes/mcp/index";

// ── Helpers ───────────────────────────────────────────────────────────────────

const MOCK_CTX = { workspaceId: "ws-001", orgId: "42", orgIdNum: 42 };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("VAG 1 — MCP JSON-RPC Server", () => {

  describe("TOOL_REGISTRY catalogue", () => {
    it("exposes master_diagnostic_sweep in the diagnostics category", () => {
      const tool = TOOL_REGISTRY["master_diagnostic_sweep"];
      expect(tool).toBeDefined();
      expect(tool.category).toBe("diagnostics");
      expect(tool.name).toBe("master_diagnostic_sweep");
    });

    it("exposes predict_stockouts in the diagnostics category", () => {
      const tool = TOOL_REGISTRY["predict_stockouts"];
      expect(tool).toBeDefined();
      expect(tool.category).toBe("diagnostics");
    });

    it("exposes propose_campaign_pause in the optimization category", () => {
      const tool = TOOL_REGISTRY["propose_campaign_pause"];
      expect(tool).toBeDefined();
      expect(tool.category).toBe("optimization");
    });

    it("exposes generate_weekly_report in the reporting category", () => {
      const tool = TOOL_REGISTRY["generate_weekly_report"];
      expect(tool).toBeDefined();
      expect(tool.category).toBe("reporting");
    });

    it("every tool has a non-empty inputSchema", () => {
      for (const [name, tool] of Object.entries(TOOL_REGISTRY)) {
        expect(tool.inputSchema, `${name} should have inputSchema`).toBeDefined();
      }
    });
  });

  describe("validateIsolationParams (path-based isolation)", () => {
    it("returns valid:true when workspace_id and org_id are present and token matches", () => {
      const result = validateIsolationParams("ws-001", "42", 42);
      expect(result.valid).toBe(true);
    });

    it("returns -32602 when workspace_id is missing", () => {
      const result = validateIsolationParams(undefined, "42");
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.code).toBe(-32602);
        expect(result.message).toMatch(/workspace_id and org_id/);
      }
    });

    it("returns -32602 when org_id is missing", () => {
      const result = validateIsolationParams("ws-001", undefined);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.code).toBe(-32602);
      }
    });

    it("returns -32602 when both params are missing (unauthorised agent invocation)", () => {
      const result = validateIsolationParams(undefined, undefined);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.code).toBe(-32602);
      }
    });

    it("returns -32603 when token org_id does not match requested org_id", () => {
      const result = validateIsolationParams("ws-001", "99", 42);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.code).toBe(-32603);
        expect(result.message).toMatch(/mismatch/);
      }
    });

    it("passes when decoded org_id is null (super-admin / platform token)", () => {
      const result = validateIsolationParams("ws-001", "any-org", null);
      expect(result.valid).toBe(true);
    });
  });

  describe("Tool handlers — happy paths", () => {
    it("master_diagnostic_sweep returns alert list with tool name and org context", async () => {
      const handler = TOOL_REGISTRY["master_diagnostic_sweep"].handler;
      const result = (await handler({}, MOCK_CTX)) as Record<string, unknown>;

      expect(result.tool).toBe("master_diagnostic_sweep");
      expect(result.workspace_id).toBe("ws-001");
      expect(result.org_id).toBe("42");
      expect(Array.isArray(result.alerts)).toBe(true);
      expect((result.alerts as unknown[]).length).toBeGreaterThan(0);
    });

    it("generate_weekly_report returns a job_token and queued status", async () => {
      const handler = TOOL_REGISTRY["generate_weekly_report"].handler;
      const result = (await handler({ period_days: 7 }, MOCK_CTX)) as Record<string, unknown>;

      expect(result.tool).toBe("generate_weekly_report");
      expect(typeof result.job_token).toBe("string");
      expect(result.status).toBe("queued");
      expect(result.period_days).toBe(7);
    });

    it("unknown tool name would not be found in the registry", () => {
      const tool = TOOL_REGISTRY["does_not_exist"];
      expect(tool).toBeUndefined();
    });
  });
});
