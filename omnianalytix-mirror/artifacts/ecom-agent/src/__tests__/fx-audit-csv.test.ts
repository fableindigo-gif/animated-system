/**
 * fx-audit-csv.test.ts — Task #262
 * ─────────────────────────────────
 * Unit tests for the three public helpers in src/lib/fx-audit-csv.ts:
 *
 *   - buildFxAuditCsvSection  — builds the CSV footer rows
 *   - appendFxAuditToCsv      — appends the footer to a full CSV string
 *   - buildFxAuditTextSection — builds the plain-text / Markdown footer
 *
 * All tests are pure / synchronous; the fx-runtime module is mocked so these
 * tests never hit network or module-level side effects.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildFxAuditCsvSection,
  appendFxAuditToCsv,
  buildFxAuditTextSection,
  type FxAuditInfo,
} from "@/lib/fx-audit-csv";

// ─── Mock the fx-runtime module ───────────────────────────────────────────────
// appendFxAuditToCsv and buildFxAuditTextSection fall back to getActiveFxRate
// when no explicit info is supplied. We provide a controllable mock here.

vi.mock("@/contexts/fx-runtime", () => ({
  getActiveFxRate: vi.fn(() => ({
    quote: "EUR",
    rate: 0.92,
    rateDate: "2026-04-22",
    fullSource: "cache",
  })),
}));

import { getActiveFxRate } from "@/contexts/fx-runtime";

const mockGetActiveFxRate = vi.mocked(getActiveFxRate);

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const inrInfo: FxAuditInfo = {
  quote: "INR",
  rate: 83.5,
  rateDate: "2026-04-22",
  source: "fetched",
};

const usdInfo: FxAuditInfo = {
  quote: "USD",
  rate: 1,
  rateDate: "2026-04-22",
  source: "cache",
};

// ─── buildFxAuditCsvSection ───────────────────────────────────────────────────

describe("buildFxAuditCsvSection", () => {
  it("returns empty string when quote is USD", () => {
    expect(buildFxAuditCsvSection(usdInfo)).toBe("");
  });

  it("returns a non-empty string for a non-USD currency", () => {
    expect(buildFxAuditCsvSection(inrInfo)).not.toBe("");
  });

  it("includes the display currency in the output", () => {
    const section = buildFxAuditCsvSection(inrInfo);
    expect(section).toContain("INR");
  });

  it("formats the rate to 6 decimal places", () => {
    const section = buildFxAuditCsvSection(inrInfo);
    expect(section).toContain("83.500000");
  });

  it("includes the rate date", () => {
    const section = buildFxAuditCsvSection(inrInfo);
    expect(section).toContain("2026-04-22");
  });

  it("includes the source label", () => {
    const section = buildFxAuditCsvSection(inrInfo);
    expect(section).toContain("fetched");
  });

  it("includes the '# FX Audit' header row", () => {
    const section = buildFxAuditCsvSection(inrInfo);
    expect(section).toContain("# FX Audit");
  });

  it("includes a blank separator line at the start", () => {
    const section = buildFxAuditCsvSection(inrInfo);
    expect(section.startsWith("\n")).toBe(true);
  });

  it("uses 'fallback' as the source label when source is fallback", () => {
    const fallbackInfo: FxAuditInfo = { ...inrInfo, source: "fallback" };
    const section = buildFxAuditCsvSection(fallbackInfo);
    expect(section).toContain("fallback");
  });

  it("handles non-ASCII currency codes (multibyte Unicode quote string)", () => {
    // Simulate a hypothetical currency whose code contains non-ASCII characters
    // (e.g. a localized label). CSV cells must embed the value without corruption.
    const exoticInfo: FxAuditInfo = {
      quote: "¥圆",   // multibyte Unicode — not a real ISO code, but tests encoding path
      rate: 154.32,
      rateDate: "2026-04-22",
      source: "override",
    };
    const section = buildFxAuditCsvSection(exoticInfo);
    expect(section).toContain("¥圆");
    expect(section).toContain("154.320000");
    expect(section).toContain("override");
  });

  it("handles a zero rate gracefully (no crash)", () => {
    const zeroRateInfo: FxAuditInfo = { ...inrInfo, rate: 0 };
    const section = buildFxAuditCsvSection(zeroRateInfo);
    expect(section).toContain("0.000000");
  });

  it("handles NaN rate without crashing and renders NaN token", () => {
    const nanRateInfo: FxAuditInfo = { ...inrInfo, rate: NaN };
    expect(() => buildFxAuditCsvSection(nanRateInfo)).not.toThrow();
    const section = buildFxAuditCsvSection(nanRateInfo);
    expect(section).toContain("INR");
  });

  it("handles a very large rate", () => {
    const largeRateInfo: FxAuditInfo = { ...inrInfo, rate: 1_000_000.123456 };
    const section = buildFxAuditCsvSection(largeRateInfo);
    expect(section).toContain("1000000.123456");
  });

  it("contains the explanatory Note row", () => {
    const section = buildFxAuditCsvSection(inrInfo);
    expect(section).toContain("Note");
    expect(section).toContain("can be converted using the rate above");
  });

  it("contains CSV key-value pairs (comma-separated rows)", () => {
    const section = buildFxAuditCsvSection(inrInfo);
    const dataLines = section.split("\n").filter((l) => l.includes(","));
    expect(dataLines.length).toBeGreaterThan(0);
  });
});

// ─── appendFxAuditToCsv ───────────────────────────────────────────────────────

describe("appendFxAuditToCsv", () => {
  const baseCsv = "Campaign,Spend\nCampaign A,1000";

  it("returns unchanged CSV when quote is USD (explicit info)", () => {
    const result = appendFxAuditToCsv(baseCsv, usdInfo);
    expect(result).toBe(baseCsv);
  });

  it("appends FX audit section when quote is non-USD (explicit info)", () => {
    const result = appendFxAuditToCsv(baseCsv, inrInfo);
    expect(result).toContain(baseCsv);
    expect(result).toContain("# FX Audit");
    expect(result).toContain("INR");
  });

  it("separates original CSV from the audit section with a newline", () => {
    const result = appendFxAuditToCsv(baseCsv, inrInfo);
    expect(result.startsWith(baseCsv + "\n")).toBe(true);
  });

  it("reads from fx-runtime when no info is provided (non-USD)", () => {
    mockGetActiveFxRate.mockReturnValueOnce({
      quote: "EUR",
      rate: 0.92,
      rateDate: "2026-04-22",
      fullSource: "cache",
    });
    const result = appendFxAuditToCsv(baseCsv);
    expect(result).toContain("EUR");
    expect(result).toContain("# FX Audit");
  });

  it("returns unchanged CSV from fx-runtime when quote is USD (no info)", () => {
    mockGetActiveFxRate.mockReturnValueOnce({
      quote: "USD",
      rate: 1,
      rateDate: "2026-04-22",
      fullSource: "cache",
    });
    const result = appendFxAuditToCsv(baseCsv);
    expect(result).toBe(baseCsv);
  });

  it("correctly reflects fallback source from fx-runtime", () => {
    mockGetActiveFxRate.mockReturnValueOnce({
      quote: "GBP",
      rate: 0.79,
      rateDate: "2026-04-22",
      fullSource: "fallback",
    });
    const result = appendFxAuditToCsv(baseCsv);
    expect(result).toContain("fallback");
    expect(result).toContain("GBP");
  });
});

// ─── buildFxAuditTextSection ──────────────────────────────────────────────────

describe("buildFxAuditTextSection", () => {
  it("returns empty string when quote is USD (explicit info)", () => {
    expect(buildFxAuditTextSection(usdInfo)).toBe("");
  });

  it("returns a non-empty string for a non-USD currency (explicit info)", () => {
    expect(buildFxAuditTextSection(inrInfo)).not.toBe("");
  });

  it("includes the '---' horizontal rule separator", () => {
    expect(buildFxAuditTextSection(inrInfo)).toContain("---");
  });

  it("includes 'FX Audit' header text", () => {
    expect(buildFxAuditTextSection(inrInfo)).toContain("FX Audit");
  });

  it("includes the display currency", () => {
    expect(buildFxAuditTextSection(inrInfo)).toContain("INR");
  });

  it("formats the rate to 6 decimal places", () => {
    expect(buildFxAuditTextSection(inrInfo)).toContain("83.500000");
  });

  it("includes the rate date", () => {
    expect(buildFxAuditTextSection(inrInfo)).toContain("2026-04-22");
  });

  it("includes the source label", () => {
    expect(buildFxAuditTextSection(inrInfo)).toContain("fetched");
  });

  it("includes a blank leading separator line", () => {
    const section = buildFxAuditTextSection(inrInfo);
    expect(section.startsWith("\n")).toBe(true);
  });

  it("reads from fx-runtime when no info is provided (non-USD)", () => {
    mockGetActiveFxRate.mockReturnValueOnce({
      quote: "EUR",
      rate: 0.92,
      rateDate: "2026-04-22",
      fullSource: "fetched",
    });
    const result = buildFxAuditTextSection();
    expect(result).toContain("EUR");
    expect(result).toContain("FX Audit");
  });

  it("returns empty string from fx-runtime when quote is USD (no info)", () => {
    mockGetActiveFxRate.mockReturnValueOnce({
      quote: "USD",
      rate: 1,
      rateDate: "2026-04-22",
      fullSource: "cache",
    });
    expect(buildFxAuditTextSection()).toBe("");
  });

  it("handles fallback source label correctly", () => {
    const fallbackInfo: FxAuditInfo = { ...inrInfo, source: "fallback" };
    const result = buildFxAuditTextSection(fallbackInfo);
    expect(result).toContain("fallback");
  });

  it("handles zero rate without crashing", () => {
    const zeroRateInfo: FxAuditInfo = { ...inrInfo, rate: 0 };
    const result = buildFxAuditTextSection(zeroRateInfo);
    expect(result).toContain("0.000000");
  });
});
