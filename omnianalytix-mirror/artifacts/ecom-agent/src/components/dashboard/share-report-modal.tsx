import { useState, useCallback, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authFetch } from "@/lib/auth-fetch";
import { cn } from "@/lib/utils";
import { Link2, Copy, Check, Loader2, ExternalLink, Clock, Shield } from "lucide-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

// Server-side report kinds — must match TRUSTED_REPORT_KINDS in @workspace/db.
export type TrustedReportKind = "warehouse_kpis" | "warehouse_channels";

interface ShareReportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reportKind: TrustedReportKind;
  filters?: Record<string, unknown>;
  reportTitle?: string;
  agencyName?: string;
}

export function ShareReportModal({
  open,
  onOpenChange,
  reportKind,
  filters,
  reportTitle = "Performance Report",
  agencyName,
}: ShareReportModalProps) {
  const [generating, setGenerating] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customTitle, setCustomTitle] = useState(reportTitle);

  useEffect(() => {
    if (open) {
      setShareUrl(null);
      setExpiresAt(null);
      setCopied(false);
      setError(null);
      setCustomTitle(reportTitle);
    }
  }, [open, reportTitle]);

  const generateLink = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      // Step 1: register a saved report on the server. The server records the
      // report kind + filters + creator under the caller's workspace; only the
      // returned id is sent back to the browser. The browser never supplies the
      // underlying row data, so it cannot fabricate an OmniAnalytix-branded
      // export.
      const savedRes = await authFetch(`${BASE}/api/reports/saved`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: reportKind, filters, title: customTitle }),
      });
      if (!savedRes.ok) throw new Error("Failed to register report");
      const { reportId } = await savedRes.json() as { reportId: string };

      // Step 2: generate the share link, server-side, from that saved report.
      const res = await authFetch(`${BASE}/api/reports/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId, reportTitle: customTitle, agencyName, expiresInDays: 30 }),
      });

      if (!res.ok) throw new Error("Failed to generate link");
      const data = await res.json();

      const origin = window.location.origin;
      const basePath = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
      const fullUrl = `${origin}${basePath}/shared/${data.shareId}`;
      setShareUrl(fullUrl);
      setExpiresAt(data.expiresAt);
    } catch {
      setError("Failed to generate shareable link. Please try again.");
    } finally {
      setGenerating(false);
    }
  }, [reportKind, filters, customTitle, agencyName]);

  const handleCopy = useCallback(() => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [shareUrl]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] rounded-2xl border-outline-variant/15/60 shadow-2xl shadow-surface-container-highest/50 p-0 gap-0 overflow-hidden">
        <div className="bg-gradient-to-br from-[#eff6ff] via-white to-[#eff6ff]/40 px-6 pt-6 pb-4">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-primary-container flex items-center justify-center">
                <Link2 className="w-5 h-5 text-white" />
              </div>
              <div>
                <DialogTitle className="text-[15px] font-semibold text-on-surface">
                  Share Client Report
                </DialogTitle>
                <p className="text-[12px] text-on-surface-variant mt-0.5">
                  Generate a secure read-only link for your client
                </p>
              </div>
            </div>
          </DialogHeader>
        </div>

        <div className="px-6 py-5 space-y-4">
          {!shareUrl ? (
            <>
              <div className="space-y-2">
                <Label className="text-[12px] font-medium text-on-surface-variant uppercase tracking-wider">
                  Report Title
                </Label>
                <Input
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder="Performance Report"
                  className="rounded-2xl h-10 text-[13px] border-outline-variant/15 focus:border-primary-container/40 focus:ring-[#dbeafe]"
                />
              </div>

              <div className="flex items-start gap-3 p-3 rounded-2xl bg-surface border ghost-border">
                <Shield className="w-4 h-4 text-on-surface-variant mt-0.5 shrink-0" />
                <div className="text-[11px] text-on-surface-variant leading-relaxed">
                  The link provides a <span className="font-medium text-on-surface-variant">read-only</span> view of the current dashboard snapshot. 
                  No login required. No access to settings or internal tools.
                </div>
              </div>

              <div className="flex items-center gap-2 text-[11px] text-on-surface-variant">
                <Clock className="w-3.5 h-3.5" />
                Link expires in 30 days
              </div>

              {error && (
                <p className="text-[12px] text-error-m3 font-medium">{error}</p>
              )}

              <Button
                onClick={generateLink}
                disabled={generating}
                className="w-full h-11 rounded-2xl bg-primary-container hover:bg-primary-m3 text-white text-[13px] font-semibold active:scale-[0.98] transition-all"
              >
                {generating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating Secure Link…
                  </>
                ) : (
                  <>
                    <Link2 className="w-4 h-4 mr-2" />
                    Generate Shareable Link
                  </>
                )}
              </Button>
            </>
          ) : (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-100">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center">
                    <Check className="w-3.5 h-3.5 text-white" />
                  </div>
                  <p className="text-[13px] font-semibold text-emerald-800">Link Ready</p>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-white rounded-2xl px-3 py-2.5 border border-emerald-200 overflow-hidden">
                    <p className="text-[12px] text-on-surface-variant font-mono truncate">{shareUrl}</p>
                  </div>
                  <Button
                    onClick={handleCopy}
                    size="sm"
                    className={cn(
                      "rounded-2xl h-10 px-4 shrink-0 transition-all active:scale-[0.96]",
                      copied
                        ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                        : "bg-on-surface hover:bg-on-surface text-white"
                    )}
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5 mr-1.5" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 mr-1.5" />
                        Copy
                      </>
                    )}
                  </Button>
                </div>
              </div>

              <button
                onClick={() => window.open(shareUrl, "_blank")}
                className="flex items-center gap-2 w-full p-3 rounded-2xl border ghost-border hover:border-outline-variant/15 hover:bg-surface transition-all text-left group"
              >
                <ExternalLink className="w-4 h-4 text-on-surface-variant group-hover:text-primary-container transition-colors" />
                <span className="text-[12px] text-on-surface-variant group-hover:text-primary-container transition-colors font-medium">
                  Preview client view in new tab
                </span>
              </button>

              {expiresAt && (
                <p className="text-[11px] text-on-surface-variant text-center">
                  Expires {new Date(expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                </p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ShareReportButton({
  reportKind,
  filters,
  reportTitle,
  agencyName,
  className,
}: {
  reportKind: TrustedReportKind;
  filters?: Record<string, unknown>;
  reportTitle?: string;
  agencyName?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "flex items-center gap-2 px-3.5 py-2 rounded-2xl border border-primary-container/20 bg-primary-container/10 text-primary-container text-[12px] font-semibold hover:bg-[#dbeafe] hover:border-[#93c5fd] transition-all active:scale-[0.97]",
          className
        )}
      >
        <Link2 className="w-3.5 h-3.5" />
        Share Client Link
      </button>
      <ShareReportModal
        open={open}
        onOpenChange={setOpen}
        reportKind={reportKind}
        filters={filters}
        reportTitle={reportTitle}
        agencyName={agencyName}
      />
    </>
  );
}
