import { useState } from "react";
import {
  X, ShieldCheck, Globe, Server,
  Copy, Check, AlertTriangle, Zap, ArrowRight,
  Rocket, Loader2, CheckCircle2, Lock, Eye, EyeOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/auth-fetch";

const BASE_URL = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE_URL.endsWith("/") ? BASE_URL.slice(0, -1) : BASE_URL;

type CDNProvider = "cloudflare" | "akamai" | "custom";
type ModalStep = 1 | 2 | 3;
type AutomationState = "idle" | "provisioning" | "success" | "error";

interface TagGatewayModalProps {
  open: boolean;
  onClose: () => void;
  domain?: string;
}

const CDN_OPTIONS: Array<{
  id: CDNProvider;
  label: string;
  desc: string;
  icon: React.ReactNode;
  automated?: boolean;
}> = [
  {
    id: "cloudflare",
    label: "Cloudflare",
    desc: "Fully automated — we deploy a Worker and bind the route via API.",
    icon: <Globe className="w-5 h-5" />,
    automated: true,
  },
  {
    id: "akamai",
    label: "Akamai",
    desc: "EdgeWorkers or Property Manager rewrite — enterprise-grade CDN.",
    icon: <Server className="w-5 h-5" />,
  },
  {
    id: "custom",
    label: "Custom Web Server",
    desc: "Nginx, Apache, or any reverse proxy — full control over routing.",
    icon: <Server className="w-5 h-5" />,
  },
];

function CopyBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group">
      {label && (
        <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider mb-1.5">{label}</p>
      )}
      <div className="bg-surface-container-low border border-outline-variant/20 rounded-md overflow-hidden">
        <pre className="p-3 text-[11px] font-mono text-on-surface-variant leading-relaxed whitespace-pre-wrap break-all overflow-x-auto max-h-[240px]">
          {code}
        </pre>
        <button
          onClick={handleCopy}
          className={cn(
            "absolute top-2 right-2 p-1.5 rounded border transition-all text-[10px] font-mono flex items-center gap-1",
            copied
              ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
              : "bg-white border-outline-variant/20 text-on-surface-variant hover:text-on-surface-variant hover:border-outline-variant/30",
          )}
        >
          {copied ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
        </button>
      </div>
    </div>
  );
}

function SecureInput({
  label,
  value,
  onChange,
  placeholder,
  helpText,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  helpText?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <Lock className="w-3 h-3 text-on-surface-variant" />
        <label className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider">{label}</label>
      </div>
      <div className="relative">
        <input
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full px-3 py-2 pr-9 bg-surface-container-low border border-outline-variant/20 rounded-md text-[12px] font-mono text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus:border-accent-blue/50"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface-variant transition-colors"
        >
          {visible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
      </div>
      {helpText && <p className="text-[9px] text-on-surface-variant leading-relaxed">{helpText}</p>}
    </div>
  );
}

function getDNSInstructions(cdn: CDNProvider, domain: string): { title: string; steps: string[]; code: string } {
  const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");

  switch (cdn) {
    case "cloudflare":
      return { title: "", steps: [], code: "" };

    case "akamai":
      return {
        title: "Akamai Property Manager Setup",
        steps: [
          `Open Akamai Control Center → Property Manager → your property`,
          `Add a new rule: Match Path = /gtag/*`,
          `Set Origin Server to www.googletagmanager.com (port 443, HTTPS)`,
          `Enable "Modify Outgoing Request Path" to rewrite /gtag/* → /gtag/*`,
          `Save and activate to staging first, then production`,
        ],
        code: `<!-- Akamai Property Manager Rule (JSON snippet) -->
{
  "name": "Google Tag Gateway Proxy",
  "criteria": [{
    "name": "path",
    "options": { "matchOperator": "MATCHES_ONE_OF", "values": ["/gtag/*"] }
  }],
  "behaviors": [{
    "name": "origin",
    "options": {
      "originType": "CUSTOMER",
      "hostname": "www.googletagmanager.com",
      "forwardHostHeader": "ORIGIN_HOSTNAME",
      "httpPort": 80,
      "httpsPort": 443
    }
  }]
}`,
      };

    case "custom":
      return {
        title: "Nginx Reverse Proxy Setup",
        steps: [
          `Add the location block below to your Nginx server configuration`,
          `Test with: nginx -t`,
          `Reload Nginx: sudo systemctl reload nginx`,
          `Verify by visiting https://${cleanDomain}/gtag/js?id=YOUR_MEASUREMENT_ID`,
        ],
        code: `# Add to your nginx server block
location /gtag/ {
    proxy_pass https://www.googletagmanager.com/gtag/;
    proxy_set_header Host www.googletagmanager.com;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_ssl_server_name on;
    proxy_ssl_name www.googletagmanager.com;

    # Cache for 1 hour
    proxy_cache_valid 200 1h;
    proxy_hide_header Set-Cookie;
    add_header X-Tag-Gateway "first-party" always;
}

# GTM container proxy (optional)
location /gtm.js {
    proxy_pass https://www.googletagmanager.com/gtm.js;
    proxy_set_header Host www.googletagmanager.com;
    proxy_ssl_server_name on;
    proxy_ssl_name www.googletagmanager.com;
}`,
      };
  }
}

function getModifiedGtagScript(domain: string, measurementId: string): string {
  const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `<!-- Google Tag Gateway — First-Party Mode -->
<script async src="https://${cleanDomain}/gtag/js?id=${measurementId || "G-XXXXXXXXXX"}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${measurementId || "G-XXXXXXXXXX"}', {
    server_container_url: 'https://${cleanDomain}/gtag',
    send_page_view: true
  });
</script>`;
}

export function TagGatewayModal({ open, onClose, domain }: TagGatewayModalProps) {
  const [step, setStep] = useState<ModalStep>(1);
  const [selectedCDN, setSelectedCDN] = useState<CDNProvider | null>(null);
  const [userDomain, setUserDomain] = useState(domain || "");
  const [measurementId, setMeasurementId] = useState("");

  const [cfApiToken, setCfApiToken] = useState("");
  const [cfZoneId, setCfZoneId] = useState("");
  const [cfProxyRoute, setCfProxyRoute] = useState("");
  const [automationState, setAutomationState] = useState<AutomationState>("idle");
  const [automationError, setAutomationError] = useState("");
  const [provisionedSnippet, setProvisionedSnippet] = useState("");
  const [provisionedRoute, setProvisionedRoute] = useState("");

  if (!open) return null;

  const isCloudflareAutomated = selectedCDN === "cloudflare";

  const handleClose = () => {
    setStep(1);
    setSelectedCDN(null);
    setAutomationState("idle");
    setAutomationError("");
    setProvisionedSnippet("");
    setCfApiToken("");
    setCfZoneId("");
    setCfProxyRoute("");
    onClose();
  };

  const handleProvision = async () => {
    setAutomationState("provisioning");
    setAutomationError("");

    try {
      const resp = await authFetch(`${API_BASE}/api/infrastructure/provision-cloudflare-gateway`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cfApiToken,
          cfZoneId,
          proxyRoute: cfProxyRoute,
          measurementId: measurementId || undefined,
        }),
      });

      const data = await resp.json();

      if (!resp.ok || !data.success) {
        setAutomationState("error");
        setAutomationError(data.error || "Provisioning failed. Please check your credentials and try again.");
        return;
      }

      setProvisionedSnippet(data.gtagSnippet);
      setProvisionedRoute(data.routePattern);
      setAutomationState("success");
    } catch {
      setAutomationState("error");
      setAutomationError("Network error — could not reach the provisioning API.");
    }
  };

  const cfFormValid = cfApiToken.length >= 20 && cfZoneId.length >= 10 && cfProxyRoute.length >= 5;
  const dnsInfo = selectedCDN && !isCloudflareAutomated ? getDNSInstructions(selectedCDN, userDomain || "yourdomain.com") : null;

  const totalSteps = isCloudflareAutomated ? 3 : 3;

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={handleClose} />

      <div className="relative w-full max-w-[640px] max-h-[90vh] mx-4 bg-surface border border-outline-variant/20 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-outline-variant/20 bg-white/50 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded bg-accent-blue/10 border border-accent-blue/20">
              <ShieldCheck className="w-4 h-4 text-accent-blue" />
            </div>
            <div>
              <h2 className="text-[13px] font-semibold text-on-surface">Tag Gateway Setup</h2>
              <p className="text-[10px] font-mono text-on-surface-variant">
                {isCloudflareAutomated ? "Automated Cloudflare Provisioning" : "First-Party Signal Recovery"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              {Array.from({ length: totalSteps }, (_, i) => i + 1).map((s) => (
                <div
                  key={s}
                  className={cn(
                    "w-6 h-1 rounded-full transition-all",
                    automationState === "success"
                      ? "bg-emerald-400"
                      : s <= step ? "bg-[#0081FB]" : "bg-outline/40",
                  )}
                />
              ))}
            </div>
            <button onClick={handleClose} className="p-1 text-on-surface-variant hover:text-on-surface-variant transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* ── STEP 1: CDN Selection ─────────────────────────────────────── */}
          {step === 1 && (
            <>
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-md p-3 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[11px] font-medium text-amber-400">Why this matters</p>
                  <p className="text-[10px] text-on-surface-variant mt-1 leading-relaxed">
                    Safari (ITP), Firefox (ETP), Brave, and ad-blockers strip cookies and block scripts from third-party domains like <span className="font-mono text-error-m3">www.googletagmanager.com</span>. This causes 15-25% of your conversion signals to vanish — inflating CPAs and degrading Smart Bidding models.
                  </p>
                </div>
              </div>

              <div>
                <p className="text-[11px] font-medium text-on-surface mb-2.5">Select your CDN or server provider:</p>
                <div className="space-y-2">
                  {CDN_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => setSelectedCDN(opt.id)}
                      className={cn(
                        "w-full flex items-center gap-3 p-3 rounded-md border transition-all text-left group",
                        selectedCDN === opt.id
                          ? "border-[#0081FB]/50 bg-accent-blue/5"
                          : "ghost-border bg-white/50 hover:border-outline-variant/20 hover:bg-surface-container-low/60",
                      )}
                    >
                      <div className={cn(
                        "p-2 rounded-md transition-colors",
                        selectedCDN === opt.id ? "bg-accent-blue/15 text-accent-blue" : "bg-surface-container-low text-on-surface-variant group-hover:text-on-surface-variant",
                      )}>
                        {opt.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-[12px] font-medium text-on-surface">{opt.label}</p>
                          {opt.automated && (
                            <span className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 uppercase tracking-wider">
                              Auto
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-on-surface-variant mt-0.5">{opt.desc}</p>
                      </div>
                      <div className={cn(
                        "w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors",
                        selectedCDN === opt.id ? "border-[#0081FB] bg-[#0081FB]" : "border-outline-variant/30/50",
                      )}>
                        {selectedCDN === opt.id && <Check className="w-2.5 h-2.5 text-surface" />}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider">Your Domain</label>
                <input
                  type="text"
                  value={userDomain}
                  onChange={(e) => {
                    setUserDomain(e.target.value);
                    if (!cfProxyRoute && e.target.value) {
                      const clean = e.target.value.replace(/^https?:\/\//, "").replace(/\/$/, "");
                      setCfProxyRoute(`${clean}/gtag`);
                    }
                  }}
                  placeholder="example.com"
                  className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant/20 rounded-md text-[12px] font-mono text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus:border-accent-blue/50"
                />
              </div>
            </>
          )}

          {/* ── STEP 2: Cloudflare Automated Provisioning ─────────────────── */}
          {step === 2 && isCloudflareAutomated && automationState !== "success" && (
            <>
              <div>
                <h3 className="text-[12px] font-semibold text-on-surface mb-1">Cloudflare API Credentials</h3>
                <p className="text-[10px] text-on-surface-variant">
                  We'll deploy a Worker and bind the route automatically. Your token is sent securely and never stored.
                </p>
              </div>

              <div className="bg-white/50 border border-outline-variant/30/20 rounded-md p-3 space-y-3">
                <SecureInput
                  label="Cloudflare API Token"
                  value={cfApiToken}
                  onChange={setCfApiToken}
                  placeholder="Paste your API token"
                  helpText="Requires permissions: Worker Scripts (Edit) + Worker Routes (Edit). Create at dash.cloudflare.com/profile/api-tokens."
                />
                <SecureInput
                  label="Zone ID"
                  value={cfZoneId}
                  onChange={setCfZoneId}
                  placeholder="e.g. a1b2c3d4e5f6..."
                  helpText="Found in Cloudflare Dashboard → your domain → Overview → right sidebar."
                />
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Globe className="w-3 h-3 text-on-surface-variant" />
                    <label className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider">Proxy Route</label>
                  </div>
                  <input
                    type="text"
                    value={cfProxyRoute}
                    onChange={(e) => setCfProxyRoute(e.target.value)}
                    placeholder="yourdomain.com/gtag"
                    className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant/20 rounded-md text-[12px] font-mono text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus:border-accent-blue/50"
                  />
                  <p className="text-[9px] text-on-surface-variant">The path where your tags will be proxied. Typically yourdomain.com/gtag.</p>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Globe className="w-3 h-3 text-on-surface-variant" />
                    <label className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider">Measurement ID (optional)</label>
                  </div>
                  <input
                    type="text"
                    value={measurementId}
                    onChange={(e) => setMeasurementId(e.target.value)}
                    placeholder="G-XXXXXXXXXX"
                    className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant/20 rounded-md text-[12px] font-mono text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus:border-accent-blue/50"
                  />
                </div>
              </div>

              {automationState === "error" && (
                <div className="bg-error-container/5 border border-rose-500/20 rounded-md p-3 flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-error-m3 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[11px] font-medium text-error-m3">Provisioning Failed</p>
                    <p className="text-[10px] text-on-surface-variant mt-1 leading-relaxed">{automationError}</p>
                  </div>
                </div>
              )}

              <button
                onClick={handleProvision}
                disabled={!cfFormValid || automationState === "provisioning"}
                className={cn(
                  "w-full flex items-center justify-center gap-2 py-3 rounded-md text-[12px] font-semibold transition-all",
                  !cfFormValid || automationState === "provisioning"
                    ? "bg-surface-container-low text-on-surface-variant border border-outline-variant/30/20 cursor-not-allowed"
                    : "bg-gradient-to-r from-[#0081FB]/20 to-cyan-500/20 text-accent-blue border border-accent-blue/30 hover:from-[#0081FB]/30 hover:to-cyan-500/30 shadow-lg shadow-cyan-500/10",
                )}
              >
                {automationState === "provisioning" ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Deploying Worker...</>
                ) : (
                  <><Rocket className="w-4 h-4" /> Automate Gateway Provisioning</>
                )}
              </button>

              <div className="flex items-center gap-2 justify-center">
                <Lock className="w-3 h-3 text-on-surface-variant" />
                <p className="text-[9px] text-on-surface-variant">Credentials are transmitted securely and never stored on our servers.</p>
              </div>
            </>
          )}

          {/* ── STEP 2: Cloudflare Success State ─────────────────────────── */}
          {step === 2 && isCloudflareAutomated && automationState === "success" && (
            <>
              <div className="text-center py-4">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-emerald-500/10 border-2 border-emerald-500/30 mb-3">
                  <CheckCircle2 className="w-7 h-7 text-emerald-400" />
                </div>
                <h3 className="text-[14px] font-bold text-emerald-400">Tag Gateway Deployed</h3>
                <p className="text-[11px] text-on-surface-variant mt-1">
                  Your Cloudflare Worker is live at <span className="font-mono text-accent-blue">{provisionedRoute}</span>
                </p>
                <p className="text-[10px] text-on-surface-variant mt-1">
                  Conversion signals are now first-party. ITP, ETP, and ad-blockers can no longer intercept your tags.
                </p>
              </div>

              <CopyBlock
                code={provisionedSnippet}
                label="Your First-Party Script Tag — drop this into your <head>"
              />

              <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-md p-3 flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[11px] font-medium text-emerald-400">Next Steps</p>
                  <p className="text-[10px] text-on-surface-variant mt-1 leading-relaxed">
                    1. Replace your existing Google tag snippet with the code above.<br />
                    2. Re-run the tag audit from the Command Center to verify first-party mode is active.<br />
                    3. Monitor your conversion rates — expect 15-25% signal recovery within 48 hours.
                  </p>
                </div>
              </div>
            </>
          )}

          {/* ── STEP 2: Manual CDN (Akamai / Custom) ─────────────────────── */}
          {step === 2 && !isCloudflareAutomated && dnsInfo && (
            <>
              <div>
                <h3 className="text-[12px] font-semibold text-on-surface mb-1">{dnsInfo.title}</h3>
                <p className="text-[10px] text-on-surface-variant">Follow these steps to configure your proxy routing:</p>
              </div>

              <div className="space-y-2">
                {dnsInfo.steps.map((s, i) => (
                  <div key={i} className="flex items-start gap-2.5 p-2.5 bg-white/50 rounded-md border border-outline-variant/30/20">
                    <span className="shrink-0 w-5 h-5 rounded-full bg-accent-blue/10 border border-accent-blue/20 text-accent-blue text-[10px] font-bold flex items-center justify-center mt-0.5">
                      {i + 1}
                    </span>
                    <p className="text-[11px] text-on-surface-variant leading-relaxed">{s}</p>
                  </div>
                ))}
              </div>

              <CopyBlock code={dnsInfo.code} label="Configuration" />
            </>
          )}

          {/* ── STEP 3: Script Tag (manual CDN only) ─────────────────────── */}
          {step === 3 && !isCloudflareAutomated && (
            <>
              <div>
                <h3 className="text-[12px] font-semibold text-on-surface mb-1">Updated gtag.js Script</h3>
                <p className="text-[10px] text-on-surface-variant">
                  Replace your existing Google tag snippet with this first-party version. The <span className="font-mono text-accent-blue">server_container_url</span> routes all tag requests through your domain.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider">Measurement / Container ID</label>
                <input
                  type="text"
                  value={measurementId}
                  onChange={(e) => setMeasurementId(e.target.value)}
                  placeholder="G-XXXXXXXXXX or GTM-XXXXXXX"
                  className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant/20 rounded-md text-[12px] font-mono text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus:border-accent-blue/50"
                />
              </div>

              <CopyBlock
                code={getModifiedGtagScript(userDomain || "yourdomain.com", measurementId)}
                label="Drop-in replacement"
              />

              <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-md p-3 flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[11px] font-medium text-emerald-400">After deployment</p>
                  <p className="text-[10px] text-on-surface-variant mt-1 leading-relaxed">
                    Re-run the tag audit from the Command Center to verify first-party mode is active. The AI will confirm your tags are secured and update the Live Triage status accordingly.
                  </p>
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-outline-variant/20 bg-white/30 shrink-0">
          <div className="text-[10px] font-mono text-on-surface-variant">
            {automationState === "success"
              ? "Provisioning complete"
              : `Step ${step} of ${totalSteps}`}
          </div>
          <div className="flex items-center gap-2">
            {step > 1 && automationState !== "success" && automationState !== "provisioning" && (
              <button
                onClick={() => {
                  setStep((s) => (s - 1) as ModalStep);
                  setAutomationState("idle");
                  setAutomationError("");
                }}
                className="px-3 py-1.5 text-[11px] font-medium text-on-surface-variant bg-surface-container-low border border-outline-variant/20 rounded-md hover:bg-[#1e2740] transition-colors"
              >
                Back
              </button>
            )}

            {automationState === "success" ? (
              <button
                onClick={handleClose}
                className="flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 rounded-md hover:bg-emerald-500/25 transition-all"
              >
                <Zap className="w-3 h-3" /> Done
              </button>
            ) : isCloudflareAutomated && step === 2 ? null : (
              <>
                {step < totalSteps ? (
                  <button
                    onClick={() => setStep((s) => (s + 1) as ModalStep)}
                    disabled={step === 1 && !selectedCDN}
                    className={cn(
                      "flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-medium rounded-md transition-all",
                      step === 1 && !selectedCDN
                        ? "bg-surface-container-low text-on-surface-variant border border-outline-variant/30/20 cursor-not-allowed"
                        : "bg-accent-blue/15 text-accent-blue border border-accent-blue/20 hover:bg-[#0081FB]/25",
                    )}
                  >
                    Continue <ArrowRight className="w-3 h-3" />
                  </button>
                ) : (
                  <button
                    onClick={handleClose}
                    className="flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 rounded-md hover:bg-emerald-500/25 transition-all"
                  >
                    <Zap className="w-3 h-3" /> Done
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
