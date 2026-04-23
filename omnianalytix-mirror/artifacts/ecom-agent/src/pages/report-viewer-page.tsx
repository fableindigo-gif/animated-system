import { useLocation } from "wouter";
import { ReportViewer } from "@/components/dashboard/report-viewer";
import { Link } from "wouter";

export default function ReportViewerPage() {
  const [location] = useLocation();

  // Extract :id from the URL path /reports/:id
  const match = location.match(/\/reports\/(\d+)/);
  const templateId = match ? parseInt(match[1], 10) : null;

  if (!templateId || isNaN(templateId)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f9fb]">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="w-14 h-14 rounded-2xl bg-rose-50 flex items-center justify-center">
            <span className="material-symbols-outlined text-rose-400" style={{ fontSize: 30 }}>
              error
            </span>
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-700">Invalid report ID</p>
            <p className="text-xs text-slate-400 mt-1">The URL does not contain a valid template identifier.</p>
          </div>
          <Link href="/reports/templates">
            <a className="text-xs text-[#1a73e8] font-medium hover:underline">
              Back to Templates →
            </a>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#f8f9fb]">
      {/* ── Sub-nav breadcrumb ── */}
      <div className="px-6 py-3 flex items-center gap-2 text-xs text-slate-500 border-b border-slate-100 bg-white">
        <Link href="/reports/templates">
          <a className="hover:text-slate-800 transition-colors">Report Templates</a>
        </Link>
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>chevron_right</span>
        <span className="text-slate-800 font-medium">Report Viewer</span>
      </div>

      {/* ── Viewer fills remaining height ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <ReportViewer templateId={templateId} />
      </div>
    </div>
  );
}
