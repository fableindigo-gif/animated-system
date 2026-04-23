import { useState, useCallback } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type { TrustedReportKind } from "@/components/dashboard/share-report-modal";

interface ShareableReportsProps {
  /**
   * Server-side report kind to export. When omitted, the export buttons render
   * disabled — exports require a registered report so the server can generate
   * the file from trusted warehouse data.
   */
  reportKind?: TrustedReportKind;
  filters?: Record<string, unknown>;
  /** Display title (also used as the registered report's title). */
  title?: string;
  /** Filename stem used for the downloaded file. */
  filenameBase?: string;
  compact?: boolean;
}

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

async function registerSavedReport(kind: TrustedReportKind, filters?: Record<string, unknown>, title?: string): Promise<string> {
  const res = await authFetch(`${BASE}/api/reports/saved`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, filters, title }),
  });
  if (!res.ok) throw new Error("Failed to register report");
  const json = await res.json() as { reportId: string };
  return json.reportId;
}

export function ShareableReports({
  reportKind,
  filters,
  title = "OmniAnalytix Export",
  filenameBase,
  compact = false,
}: ShareableReportsProps) {
  const [exporting, setExporting] = useState<"csv" | "sheets" | null>(null);
  const [lastExport, setLastExport] = useState<{ type: string; time: string } | null>(null);

  const handleCsvExport = useCallback(async () => {
    if (!reportKind) return;
    setExporting("csv");
    try {
      const reportId = await registerSavedReport(reportKind, filters, title);
      const filename = (filenameBase ?? title).replace(/\s+/g, "-").toLowerCase();
      const res = await authFetch(`${BASE}/api/reports/export-csv`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId, filename }),
      });

      if (!res.ok) throw new Error("Export failed");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setLastExport({ type: "CSV", time: new Date().toLocaleTimeString() });
    } catch (err) {
      console.error("CSV export failed:", err);
    } finally {
      setExporting(null);
    }
  }, [reportKind, filters, title, filenameBase]);

  const handleSheetsExport = useCallback(async () => {
    if (!reportKind) return;
    setExporting("sheets");
    try {
      const reportId = await registerSavedReport(reportKind, filters, title);
      const res = await authFetch(`${BASE}/api/reports/export-sheets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId, title }),
      });

      if (!res.ok) throw new Error("Sheets export failed");

      const json = await res.json() as {
        mode?: "sheets" | "download";
        spreadsheetUrl?: string;
        spreadsheet?: unknown;
        title?: string;
      };

      if (json.mode === "sheets" && json.spreadsheetUrl) {
        window.open(json.spreadsheetUrl, "_blank", "noopener,noreferrer");
        setLastExport({ type: "Google Sheets", time: new Date().toLocaleTimeString() });
      } else if (json.mode === "download" && json.spreadsheet) {
        // No Google credentials linked — fall back to a JSON download the user
        // can import manually. Mirrors the server's `download` mode.
        const blob = new Blob([JSON.stringify(json.spreadsheet, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const stem = (filenameBase ?? title).replace(/\s+/g, "-").toLowerCase();
        a.href = url;
        a.download = `${stem}-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setLastExport({ type: "Google Sheets (download)", time: new Date().toLocaleTimeString() });
      } else {
        throw new Error("Unexpected sheets export response");
      }
    } catch (err) {
      console.error("Sheets export failed:", err);
    } finally {
      setExporting(null);
    }
  }, [reportKind, filters, title, filenameBase]);

  const disabled = !reportKind;

  if (compact) {
    return (
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => handleCsvExport()}
          disabled={exporting !== null || disabled}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-2xl border border-outline-variant/15 text-[11px] font-medium text-on-surface-variant hover:bg-surface hover:border-[#c8c5cb] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 13 }}>
            {exporting === "csv" ? "hourglass_top" : "download"}
          </span>
          CSV
        </button>
        <button
          onClick={() => handleSheetsExport()}
          disabled={exporting !== null || disabled}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-2xl border border-emerald-200 text-[11px] font-medium text-emerald-600 bg-emerald-50 hover:bg-emerald-100 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 13 }}>
            {exporting === "sheets" ? "hourglass_top" : "table_chart"}
          </span>
          Sheets
        </button>
      </div>
    );
  }

  return (
    <section className="bg-white rounded-2xl shadow-sm border ghost-border overflow-hidden">
      <div className="px-5 py-4 border-b ghost-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-2xl bg-teal-50 flex items-center justify-center">
            <span className="material-symbols-outlined text-teal-600" style={{ fontSize: 20 }}>
              share
            </span>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-on-surface">Shareable Reports</h3>
            <p className="text-[11px] text-on-surface-variant tracking-wider font-mono mt-0.5">
              EXPORT & WORKSPACE INTEGRATION
            </p>
          </div>
        </div>
        {lastExport && (
          <span className="text-[10px] text-emerald-500 font-medium flex items-center gap-1">
            <span className="material-symbols-outlined" style={{ fontSize: 12 }}>check_circle</span>
            {lastExport.type} exported at {lastExport.time}
          </span>
        )}
      </div>

      <div className="p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            onClick={() => handleCsvExport()}
            disabled={exporting !== null || disabled}
            className="flex items-center gap-4 p-4 rounded-2xl border ghost-border hover:border-outline-variant/15 hover:bg-surface/50 transition-all text-left group disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <div className="w-11 h-11 rounded-2xl bg-primary-container/10 flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-primary-container" style={{ fontSize: 24 }}>
                {exporting === "csv" ? "hourglass_top" : "csv"}
              </span>
            </div>
            <div>
              <p className="text-[13px] font-semibold text-on-surface group-hover:text-primary-container transition-colors">
                Download CSV
              </p>
              <p className="text-[11px] text-on-surface-variant mt-0.5">
                Export current data as a comma-separated file
              </p>
            </div>
          </button>

          <button
            onClick={() => handleSheetsExport()}
            disabled={exporting !== null || disabled}
            className="flex items-center gap-4 p-4 rounded-2xl border border-emerald-100 hover:border-emerald-200 hover:bg-emerald-50/30 transition-all text-left group disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <div className="w-11 h-11 rounded-2xl bg-emerald-50 flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-emerald-600" style={{ fontSize: 24 }}>
                {exporting === "sheets" ? "hourglass_top" : "table_chart"}
              </span>
            </div>
            <div>
              <p className="text-[13px] font-semibold text-on-surface group-hover:text-emerald-600 transition-colors">
                Export to Google Sheets
              </p>
              <p className="text-[11px] text-on-surface-variant mt-0.5">
                Send data to Google Workspace for team collaboration
              </p>
            </div>
          </button>
        </div>

        {disabled && (
          <div className="mt-3 p-3 rounded-2xl bg-surface border ghost-border text-center">
            <p className="text-[11px] text-on-surface-variant">
              Generate a performance report or diagnostic analysis to enable exports.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
