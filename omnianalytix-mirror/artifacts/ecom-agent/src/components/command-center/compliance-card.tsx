import { ShieldAlert, ShieldCheck, ShieldX, ExternalLink, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ComplianceViolation {
  type: "mismatched_claims" | "prohibited_content" | "ux_violation" | "missing_trust_page" | "exaggerated_claims";
  severity: "warning" | "error" | "critical";
  description: string;
  policy: string;
  fix: string;
}

export interface ComplianceReport {
  overallRisk: "low" | "medium" | "high" | "critical";
  violations: ComplianceViolation[];
  trustPageAudit: { privacyPolicy: boolean; terms: boolean; refundPolicy: boolean; contact: boolean };
  pricingConsistency: string;
  prohibitedKeywords: string[];
  approvalRecommendation: "approve" | "approve_with_warnings" | "block";
  autoFixAvailable: string[];
}

export interface ComplianceAuditData {
  url: string;
  report: ComplianceReport;
  rawChecks: { hasPrivacyPolicy: boolean; hasTerms: boolean; hasRefundPolicy: boolean; hasContactInfo: boolean; hasInterstitial: boolean };
}

interface ComplianceCardProps {
  data: ComplianceAuditData;
  onAutoFix?: (fix: string) => void;
}

const RISK_CONFIG = {
  low: { label: "LOW RISK", icon: ShieldCheck, color: "text-emerald-400", border: "border-emerald-500/30 bg-emerald-500/5" },
  medium: { label: "MEDIUM RISK", icon: ShieldAlert, color: "text-amber-400", border: "border-amber-500/30 bg-amber-500/5" },
  high: { label: "HIGH RISK", icon: ShieldAlert, color: "text-orange-400", border: "border-orange-500/30 bg-orange-500/5" },
  critical: { label: "🚫 CRITICAL — BLOCKED", icon: ShieldX, color: "text-rose-400", border: "border-rose-500/40 bg-error-container/10" },
};

const SEVERITY_COLORS = {
  warning: "text-amber-400 border-amber-400/30 bg-amber-400/5",
  error: "text-orange-400 border-orange-400/30 bg-orange-400/5",
  critical: "text-rose-400 border-rose-500/30 bg-error-container/10",
};

const TRUST_PAGE_LABELS = [
  { key: "privacyPolicy" as const, label: "Privacy Policy" },
  { key: "terms" as const, label: "Terms of Service" },
  { key: "refundPolicy" as const, label: "Refund Policy" },
  { key: "contact" as const, label: "Contact Info" },
];

export function ComplianceCard({ data, onAutoFix }: ComplianceCardProps) {
  const { url, report } = data;
  const risk = RISK_CONFIG[report.overallRisk] ?? RISK_CONFIG.medium;
  const RiskIcon = risk.icon;
  const isBlocked = report.approvalRecommendation === "block";
  const critical = report.violations.filter((v) => v.severity === "critical");
  const errors = report.violations.filter((v) => v.severity === "error");
  const warnings = report.violations.filter((v) => v.severity === "warning");

  return (
    <div className={cn("mx-4 my-2 rounded-2xl border-2 overflow-hidden", risk.border)}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border/30">
        <div className={cn("p-1.5 rounded-md", isBlocked ? "bg-error-container/20" : "bg-secondary/40")}>
          <RiskIcon className={cn("w-4 h-4", risk.color)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-foreground">Compliance Audit</span>
            <Badge variant="outline" className={cn("font-mono text-[9px]", risk.color)}>{risk.label}</Badge>
          </div>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors mt-0.5 truncate"
          >
            <ExternalLink className="w-2.5 h-2.5 shrink-0" />
            <span className="truncate">{url}</span>
          </a>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {critical.length > 0 && <Badge variant="outline" className="text-[9px] font-mono text-rose-400 border-rose-500/30">{critical.length} critical</Badge>}
          {errors.length > 0 && <Badge variant="outline" className="text-[9px] font-mono text-orange-400 border-orange-500/30">{errors.length} error</Badge>}
          {warnings.length > 0 && <Badge variant="outline" className="text-[9px] font-mono text-amber-400 border-amber-500/30">{warnings.length} warn</Badge>}
        </div>
      </div>

      {/* Trust Page Audit */}
      <div className="px-4 py-3 border-b border-border/30">
        <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mb-2">Trust & Safety Pages</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {TRUST_PAGE_LABELS.map(({ key, label }) => (
            <div key={key} className={cn("rounded-md px-2 py-1.5 text-center border", report.trustPageAudit[key] ? "border-emerald-500/30 bg-emerald-500/10" : "border-rose-500/30 bg-error-container/10")}>
              <p className={cn("text-sm", report.trustPageAudit[key] ? "text-emerald-400" : "text-rose-400")}>{report.trustPageAudit[key] ? "✓" : "✗"}</p>
              <p className="text-[9px] text-muted-foreground mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Violations */}
      {report.violations.length > 0 && (
        <div className="px-4 py-3 border-b border-border/30">
          <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mb-2">Policy Violations</p>
          <div className="space-y-2">
            {report.violations.map((v, i) => (
              <div key={i} className={cn("rounded-2xl p-3 border", SEVERITY_COLORS[v.severity])}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={cn("text-[8px] font-mono", SEVERITY_COLORS[v.severity])}>
                      {v.severity.toUpperCase()}
                    </Badge>
                    <span className="text-[9px] font-mono text-muted-foreground">{v.type.replace(/_/g, " ")}</span>
                  </div>
                  <span className="text-[9px] text-muted-foreground/60">{v.policy}</span>
                </div>
                <p className="text-xs text-foreground/90 mb-1">{v.description}</p>
                <p className="text-[10px] text-muted-foreground">💡 {v.fix}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Auto-Fix Options */}
      {report.autoFixAvailable.length > 0 && onAutoFix && (
        <div className="px-4 pb-4 pt-3">
          <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mb-2">Auto-Fix Available</p>
          <div className="flex flex-wrap gap-2">
            {report.autoFixAvailable.map((fix, i) => (
              <Button
                key={i}
                size="sm"
                variant="outline"
                onClick={() => onAutoFix(fix)}
                className="gap-1.5 font-mono text-xs h-8 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
              >
                <Wrench className="w-3.5 h-3.5" />
                Fix: {fix.slice(0, 30)}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Prohibited Keywords */}
      {report.prohibitedKeywords.length > 0 && (
        <div className="px-4 pb-4 border-t border-border/30 pt-3">
          <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mb-2">Restricted Keywords Detected</p>
          <div className="flex flex-wrap gap-1.5">
            {report.prohibitedKeywords.map((kw, i) => (
              <Badge key={i} variant="outline" className="text-[9px] font-mono text-rose-400 border-rose-500/30">{kw}</Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
