import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SiGoogleads, SiGoogle } from "react-icons/si";
import { ExternalLink, ShieldCheck, Loader2, Copy, Check, AlertTriangle, ChevronRight } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListConnectionsQueryKey } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { authFetch } from "@/lib/auth-fetch";

const BASE_URL = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE_URL.endsWith("/") ? BASE_URL.slice(0, -1) : BASE_URL;

export type GooglePlatform = "google_ads" | "gmc" | "gsc" | "google_workspace" | "google_sheets";

interface GoogleOAuthDialogProps {
  platform: GooglePlatform;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

function CopyableUri({ uri }: { uri: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(uri);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="flex items-center gap-2 mt-1.5">
      <code className="flex-1 text-[11px] font-mono bg-secondary/50 border border-border/60 rounded px-2.5 py-1.5 text-foreground break-all">
        {uri}
      </code>
      <button
        onClick={handleCopy}
        className="shrink-0 p-1.5 rounded-md border border-border/60 hover:bg-secondary/60 transition-colors"
        title="Copy"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>
    </div>
  );
}

export function GoogleOAuthDialog({ platform, isOpen, onOpenChange }: GoogleOAuthDialogProps) {
  const isGmc = platform === "gmc";
  const isGsc = platform === "gsc";
  const title = isGmc ? "Google Merchant Center" : isGsc ? "Google Search Console" : "Google Ads";
  const Icon = isGmc ? SiGoogle : isGsc ? SiGoogle : SiGoogleads;
  const iconClass = isGmc ? "text-error-m3" : isGsc ? "text-emerald-600" : "text-primary-container";

  const [redirectUri, setRedirectUri] = useState<string>("");
  const [configLoading, setConfigLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setConfigLoading(true);
    fetch(`${API_BASE}/api/auth/google/config`)
      .then((r) => { if (!r.ok) throw new Error(`Config fetch failed: ${r.status}`); return r.json(); })
      .then((data: { redirectUri?: string }) => { if (data.redirectUri) setRedirectUri(data.redirectUri); })
      .catch((err) => { console.error("[GoogleOAuthDialog] Failed to load OAuth config:", err); })
      .finally(() => setConfigLoading(false));
  }, [isOpen]);

  const handleAuthorize = () => {
    window.location.href = `${API_BASE}/api/auth/google/start?platform=${platform}`;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 rounded-md bg-secondary/30 ring-1 ring-border/50">
              <Icon className={`w-5 h-5 ${iconClass}`} />
            </div>
            <DialogTitle>Connect {title}</DialogTitle>
          </div>
          <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
            Complete the two steps below before authorizing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* ── Step 1: GCP Setup ── */}
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <p className="text-sm font-semibold text-amber-300">Step 1 — Register the Redirect URI</p>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              You must add this exact URI to your{" "}
              <a
                href="https://console.cloud.google.com/apis/credentials"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#60a5fa] underline underline-offset-2 hover:text-[#93c5fd]"
              >
                Google Cloud Console
              </a>{" "}
              OAuth 2.0 credentials before clicking Authorize — otherwise Google will block the request.
            </p>

            <div>
              <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1">Authorized Redirect URI to add:</p>
              {configLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Loading…
                </div>
              ) : redirectUri ? (
                <CopyableUri uri={redirectUri} />
              ) : (
                <p className="text-xs text-muted-foreground mt-1 italic">Could not load redirect URI — check your API server is running.</p>
              )}
            </div>

            <div>
              <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1">Privacy Policy URL (OAuth Consent Screen):</p>
              <CopyableUri uri="https://omnianalytix.in/privacy-policy" />
              <p className="text-[10px] text-muted-foreground mt-1">Paste this in GCP → APIs &amp; Services → OAuth consent screen → Privacy Policy URL field.</p>
            </div>

            <div className="space-y-1.5 text-xs text-muted-foreground">
              <p className="font-medium text-foreground/80">Where to add it in GCP Console:</p>
              <ol className="space-y-1 list-none">
                {[
                  "Go to APIs & Services → Credentials",
                  "Click your OAuth 2.0 Client ID (must be type: Web application)",
                  "Under \"Authorized redirect URIs\", click Add URI",
                  "Paste the URI above → Save",
                ].map((step, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="shrink-0 flex items-center justify-center w-4 h-4 rounded-full bg-secondary/60 text-[9px] font-bold mt-0.5">{i + 1}</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          {/* ── Step 2: Scopes ── */}
          <div className="rounded-2xl bg-secondary/20 border border-border/50 px-4 py-3 space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Step 2 — Permissions requested</p>
            <ul className="text-xs text-muted-foreground space-y-0.5 mt-1">
              {isGmc ? (
                <>
                  <li>• Read & manage your Google Merchant Center account</li>
                  <li>• Access product feeds, status, and performance data</li>
                </>
              ) : isGsc ? (
                <>
                  <li>• Read-only access to Google Search Console data</li>
                  <li>• Search analytics: queries, pages, impressions, clicks, CTR, position</li>
                </>
              ) : (
                <>
                  <li>• Manage your Google Ads campaigns, budgets & bids</li>
                  <li>• Read performance data, search terms & auction insights</li>
                </>
              )}
              <li>• Read Google Analytics data</li>
              <li>• Access your Google account email for identification</li>
            </ul>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
            <span>Uses Google's official OAuth 2.0 flow. Tokens stored encrypted. Revocable anytime from your Google Account.</span>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleAuthorize}
              className="bg-primary-container hover:bg-primary-m3 text-white gap-2"
              data-testid={`button-google-oauth-${platform}`}
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Authorize with Google
              <ChevronRight className="w-3 h-3" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Google Setup Completion Dialog ───────────────────────────────────────────

interface GoogleSetupDialogProps {
  platform: GooglePlatform;
  setupKey: string;
  email: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

export function GoogleSetupDialog({ platform, setupKey, email, isOpen, onOpenChange, onComplete }: GoogleSetupDialogProps) {
  const isGmc = platform === "gmc";
  const isGsc = platform === "gsc";
  const [developerToken, setDeveloperToken] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [managerCustomerId, setManagerCustomerId] = useState("");
  const [merchantId, setMerchantId] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleSubmit = async () => {
    setError("");
    if (isGmc && !merchantId) { setError("Merchant ID is required"); return; }
    if (isGsc && !siteUrl) { setError("Site URL is required"); return; }
    if (!isGmc && !isGsc && (!developerToken || !customerId)) { setError("Developer Token and Customer ID are required"); return; }

    setIsSubmitting(true);
    try {
      const body: Record<string, string> = { setupKey };
      if (isGmc) {
        body.merchantId = merchantId;
      } else if (isGsc) {
        body.siteUrl = siteUrl;
      } else {
        body.developerToken = developerToken;
        body.customerId = customerId;
        if (managerCustomerId) body.managerCustomerId = managerCustomerId;
      }

      const resp = await authFetch(`${API_BASE}/api/auth/google/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Request failed" })) as { error?: string };
        setError(err.error ?? "Failed to complete setup");
        return;
      }

      const platformLabel = isGmc ? "Google Merchant Center" : isGsc ? "Google Search Console" : "Google Ads";
      toast({
        title: `${platformLabel} Connected`,
        description: `Successfully authorized${email ? ` as ${email}` : ""}.`,
      });
      queryClient.invalidateQueries({ queryKey: getListConnectionsQueryKey() });
      onComplete();
      onOpenChange(false);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Complete {isGmc ? "Google Merchant Center" : isGsc ? "Google Search Console" : "Google Ads"} Setup</DialogTitle>
          <DialogDescription>
            Google authorization successful{email ? ` (${email})` : ""}. Provide the remaining details to finish connecting.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {isGsc ? (
            <div className="space-y-1.5">
              <Label>Site URL</Label>
              <Input
                placeholder="https://www.yoursite.com"
                value={siteUrl}
                onChange={(e) => setSiteUrl(e.target.value)}
                className="font-mono text-sm"
                data-testid="input-site-url"
              />
              <p className="text-xs text-muted-foreground">Must exactly match the property URL in Google Search Console (including http/https and trailing slash if any)</p>
            </div>
          ) : !isGmc ? (
            <>
              <div className="space-y-1.5">
                <Label>Developer Token</Label>
                <Input
                  type="password"
                  placeholder="•••••••••••••••"
                  value={developerToken}
                  onChange={(e) => setDeveloperToken(e.target.value)}
                  className="font-mono text-sm"
                  data-testid="input-developer-token"
                />
                <p className="text-xs text-muted-foreground">Found in Google Ads → Tools → API Center</p>
              </div>
              <div className="space-y-1.5">
                <Label>Customer ID</Label>
                <Input
                  placeholder="123-456-7890"
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  className="font-mono text-sm"
                  data-testid="input-customer-id"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Manager Customer ID <span className="text-muted-foreground">(optional)</span></Label>
                <Input
                  placeholder="123-456-7890"
                  value={managerCustomerId}
                  onChange={(e) => setManagerCustomerId(e.target.value)}
                  className="font-mono text-sm"
                />
              </div>
            </>
          ) : isGmc ? (
            <div className="space-y-1.5">
              <Label>Merchant ID</Label>
              <Input
                placeholder="123456789"
                value={merchantId}
                onChange={(e) => setMerchantId(e.target.value)}
                className="font-mono text-sm"
                data-testid="input-merchant-id"
              />
              <p className="text-xs text-muted-foreground">Found in your Google Merchant Center account settings</p>
            </div>
          ) : null}

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSubmit} disabled={isSubmitting} className="gap-2">
              {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              Save Connection
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
