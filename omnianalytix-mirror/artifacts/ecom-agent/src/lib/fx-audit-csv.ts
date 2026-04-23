/**
 * Helpers for embedding FX audit information in CSV and clipboard exports.
 *
 * When a user exports data that contains money values converted from USD, they
 * need to know which rate was applied so they can verify or reconstruct the
 * figures. These helpers append a standardised "FX Audit" footer section to
 * any CSV string, recording the same provenance that `<MoneyTile>` surfaces in
 * its hover tooltip: the exchange rate, rate date, and rate source.
 *
 * Usage (non-React code paths, e.g. download handlers):
 *
 *   import { appendFxAuditToCsv } from "@/lib/fx-audit-csv";
 *   const csv = [header, ...rows].join("\n");
 *   triggerDownload(appendFxAuditToCsv(csv), filename, "text/csv");
 *
 * For React components use `useFxAuditCsvSection()` which reads from context
 * and therefore picks up the user's live display currency automatically.
 */
import { getActiveFxRate } from "@/contexts/fx-runtime";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FxAuditInfo {
  /** ISO-4217 display currency code (e.g. "INR"). */
  quote: string;
  /** 1 USD → `rate` units of `quote`. */
  rate: number;
  /** YYYY-MM-DD the rate was fetched/cached for. */
  rateDate: string;
  /** Provenance of the rate ("override" | "cache" | "fetched" | "fallback"). */
  source: string;
}

// ─── Primitive helpers ────────────────────────────────────────────────────────

function csvCell(value: string | number): string {
  const s = String(value);
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

/**
 * Build the FX audit section that is appended to CSV exports.
 *
 * The section starts with a blank separator row so spreadsheet applications
 * render the metadata visually distinct from the data rows above it.
 */
export function buildFxAuditCsvSection(info: FxAuditInfo): string {
  if (info.quote === "USD") return "";

  const rows = [
    "",
    "# FX Audit",
    [csvCell("Display Currency"), csvCell(info.quote)].join(","),
    [csvCell("Rate (1 USD →)"), csvCell(`${info.rate.toFixed(6)} ${info.quote}`)].join(","),
    [csvCell("Rate Date"), csvCell(info.rateDate)].join(","),
    [csvCell("Rate Source"), csvCell(info.source)].join(","),
    [csvCell("Note"), csvCell("All USD warehouse values in this export can be converted using the rate above.")].join(","),
  ];
  return rows.join("\n");
}

/**
 * Append FX audit metadata to an existing CSV string.
 *
 * Pass an explicit `info` object when calling from within a React component
 * (obtained via `useFx()`). When called from a non-React event handler, omit
 * `info` and the function reads from the module-level FX runtime instead.
 */
export function appendFxAuditToCsv(csv: string, info?: FxAuditInfo): string {
  const resolved: FxAuditInfo = info ?? (() => {
    const rt = getActiveFxRate();
    return {
      quote:    rt.quote,
      rate:     rt.rate,
      rateDate: rt.rateDate,
      source:   rt.fullSource,
    };
  })();
  const section = buildFxAuditCsvSection(resolved);
  return section ? `${csv}\n${section}` : csv;
}

/**
 * Build FX audit lines suitable for plain-text / Markdown exports (e.g.
 * chat-message "Export to Docs"). Returns an empty string when the active
 * currency is USD (no conversion was applied).
 */
export function buildFxAuditTextSection(info?: FxAuditInfo): string {
  const resolved: FxAuditInfo = info ?? (() => {
    const rt = getActiveFxRate();
    return {
      quote:    rt.quote,
      rate:     rt.rate,
      rateDate: rt.rateDate,
      source:   rt.fullSource,
    };
  })();
  if (resolved.quote === "USD") return "";
  return [
    "",
    "---",
    "FX Audit",
    `Display Currency: ${resolved.quote}`,
    `Rate (1 USD →): ${resolved.rate.toFixed(6)} ${resolved.quote}`,
    `Rate Date: ${resolved.rateDate}`,
    `Rate Source: ${resolved.source}`,
  ].join("\n");
}
