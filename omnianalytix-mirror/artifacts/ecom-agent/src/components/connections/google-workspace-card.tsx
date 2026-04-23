import { useState, useEffect } from "react";
import { SiGoogle, SiGoogleads, SiYoutube, SiGooglesheets } from "react-icons/si";
import { Search, BarChart2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useListConnections, getListConnectionsQueryKey } from "@workspace/api-client-react";
import { AlertTriangle, Copy, Check, ExternalLink, Loader2, KeyRound, CheckCircle2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { authFetch } from "@/lib/auth-fetch";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";

const BASE_URL = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE_URL.endsWith("/") ? BASE_URL.slice(0, -1) : BASE_URL;

function CopyableUri({ uri }: { uri: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 mt-1.5">
      <code className="flex-1 text-[11px] font-mono bg-secondary/50 border border-border/60 rounded px-2.5 py-1.5 text-foreground break-all">
        {uri}
      </code>
      <button
        onClick={() => { navigator.clipboard.writeText(uri); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
        className="shrink-0 p-1.5 rounded-md border border-border/60 hover:bg-secondary/60 transition-colors"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>
    </div>
  );
}

// sharedAuth: true means the service is accessible via the shared Google OAuth
// token and does not need its own connection row — it mirrors workspace status.
const GOOGLE_SERVICES = [
  { id: "google_ads",    label: "Google Ads",     Icon: SiGoogleads,    color: "text-[#60a5fa]",   sharedAuth: false },
  { id: "gmc",           label: "Merchant Center", Icon: SiGoogle,       color: "text-rose-400",    sharedAuth: false },
  { id: "gsc",           label: "Search Console",  Icon: Search,         color: "text-emerald-400", sharedAuth: false },
  { id: "youtube",       label: "YouTube",         Icon: SiYoutube,      color: "text-error-m3",    sharedAuth: false },
  { id: "google_sheets", label: "Google Sheets",   Icon: SiGooglesheets, color: "text-[#0F9D58]",   sharedAuth: false },
  { id: "ga4",           label: "Analytics 4",     Icon: BarChart2,      color: "text-orange-400",  sharedAuth: true  },
];

export function GoogleWorkspaceCard() {
  const { data: connections } = useListConnections();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [redirectUri, setRedirectUri] = useState("");

  // Customer ID capture state
  const [customerId, setCustomerId] = useState("");
  const [isSavingId, setIsSavingId] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  useEffect(() => {
    if (!isDialogOpen) return;
    fetch(`${API_BASE}/api/auth/google/config`)
      .then((r) => { if (!r.ok) throw new Error(`Config fetch failed: ${r.status}`); return r.json(); })
      .then((d: { redirectUri?: string }) => { if (d.redirectUri) setRedirectUri(d.redirectUri); })
      .catch((err) => { console.error("[GoogleWorkspaceCard] Failed to load OAuth config:", err); });
  }, [isDialogOpen]);

  const connectedIds = new Set(connections?.map((c) => c.platform) ?? []);
  const anyGoogleConnected = connectedIds.size > 0;
  // sharedAuth services (GA4) mirror workspace status rather than having their own row
  const connectedCount = GOOGLE_SERVICES.filter((s) =>
    s.sharedAuth ? anyGoogleConnected : connectedIds.has(s.id)
  ).length;
  const allConnected = connectedCount === GOOGLE_SERVICES.length;

  // Check if google_ads is connected but missing customer ID or GA4 property ID
  const gadsConn = connections?.find((c) => c.platform === "google_ads");
  const gadsConnected = !!gadsConn;
  const hasCustomerId = !!(gadsConn as Record<string, unknown> | undefined)?.hasCustomerId;
  const hasGa4PropertyId = !!(gadsConn as Record<string, unknown> | undefined)?.hasGa4PropertyId;
  const showCustomerIdPrompt = gadsConnected && !hasCustomerId;
  const showGa4Prompt = gadsConnected && hasCustomerId && !hasGa4PropertyId;

  // GA4 property ID capture state
  const [ga4PropertyId, setGa4PropertyId] = useState("");
  const [isSavingGa4, setIsSavingGa4] = useState(false);

  const handleSaveGa4PropertyId = async () => {
    if (!ga4PropertyId.trim()) return;
    setIsSavingGa4(true);
    try {
      const resp = await authFetch(`${API_BASE}/api/connections/google-ads/ga4-property-id`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ga4PropertyId: ga4PropertyId.trim() }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Failed" })) as { error?: string };
        toast({ title: "Error", description: err.error ?? "Failed to save GA4 property ID", variant: "destructive" });
        return;
      }
      toast({ title: "GA4 Property ID Saved", description: "Analytics cross-reference is now enabled." });
      setGa4PropertyId("");
      queryClient.invalidateQueries({ queryKey: getListConnectionsQueryKey() });
    } catch {
      toast({ title: "Network error", description: "Please try again.", variant: "destructive" });
    } finally {
      setIsSavingGa4(false);
    }
  };

  const handleAuthorize = () => {
    setIsConnecting(true);
    window.location.href = `${API_BASE}/api/auth/google/start?platform=workspace`;
  };

  const handleDisconnect = () => {
    setShowDisconnectConfirm(true);
  };

  const executeDisconnect = async () => {
    setShowDisconnectConfirm(false);
    setIsDisconnecting(true);
    try {
      const resp = await authFetch(`${API_BASE}/api/auth/google/disconnect`, { method: "POST" });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Unknown error" })) as { error?: string };
        toast({ title: "Disconnect failed", description: err.error ?? "Failed to disconnect", variant: "destructive" });
        return;
      }
      toast({ title: "Google Workspace Disconnected", description: "All Google tokens have been wiped. You can now re-authorize for fresh credentials." });
      queryClient.invalidateQueries({ queryKey: getListConnectionsQueryKey() });
    } catch {
      toast({ title: "Network error", description: "Could not reach the server. Please try again.", variant: "destructive" });
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleSaveCustomerId = async () => {
    if (!customerId.trim()) return;
    setIsSavingId(true);
    try {
      const resp = await authFetch(`${API_BASE}/api/connections/google-ads/customer-id`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: customerId.trim() }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Failed" })) as { error?: string };
        toast({ title: "Error", description: err.error ?? "Failed to save Customer ID", variant: "destructive" });
        return;
      }
      toast({ title: "Google Ads Customer ID Saved", description: `Customer ID ${customerId.replace(/-/g, "")} has been saved.` });
      setCustomerId("");
      queryClient.invalidateQueries({ queryKey: getListConnectionsQueryKey() });
    } catch {
      toast({ title: "Network error", description: "Please try again.", variant: "destructive" });
    } finally {
      setIsSavingId(false);
    }
  };

  return (
    <>
      <Card className="flex flex-col bg-card/50 border-border/50 shadow-sm backdrop-blur-sm transition-all hover:bg-card hover:border-border md:col-span-2">
        <CardHeader className="flex flex-row items-start justify-between pb-2">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-md bg-primary-container/10 ring-1 ring-primary-container/30">
              <SiGoogle className="w-6 h-6 text-[#60a5fa]" />
            </div>
            <div>
              <CardTitle className="text-base font-bold tracking-tight">Google Workspace Ecosystem</CardTitle>
              <CardDescription className="text-xs font-mono text-muted-foreground mt-1">
                Ads · Merchant Center · Search Console · YouTube · Sheets · GA4 — one auth flow
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            {allConnected && hasCustomerId ? (
              <>
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                <Badge variant="outline" className="text-emerald-500 border-emerald-500/20 bg-emerald-500/10 font-mono text-[10px] uppercase">All Connected</Badge>
              </>
            ) : connectedCount > 0 ? (
              <>
                <span className="flex h-2 w-2 rounded-full bg-amber-500" />
                <Badge variant="outline" className="text-amber-400 border-amber-500/20 bg-amber-500/10 font-mono text-[10px] uppercase">{connectedCount}/{GOOGLE_SERVICES.length} Connected</Badge>
              </>
            ) : (
              <>
                <span className="flex h-2 w-2 rounded-full bg-muted" />
                <Badge variant="outline" className="text-muted-foreground font-mono text-[10px] uppercase">Disconnected</Badge>
              </>
            )}
          </div>
        </CardHeader>

        <CardContent className="pt-0 pb-3 space-y-3">
          {/* Service status row */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-1">
            {GOOGLE_SERVICES.map(({ id, label, Icon, color }) => {
              const isConn = id === "ga4"
                ? gadsConnected  // GA4 uses shared OAuth token
                : connectedIds.has(id);
              const needsId = id === "google_ads" && isConn && !hasCustomerId;
              const needsGa4Id = id === "ga4" && isConn && !hasGa4PropertyId;
              const isFullyReady = needsId || needsGa4Id ? false : isConn;
              return (
                <div
                  key={id}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md text-xs border transition-colors ${
                    needsId || needsGa4Id
                      ? "border-amber-500/30 bg-amber-500/5"
                      : isFullyReady
                        ? "border-emerald-500/20 bg-emerald-500/5"
                        : "border-border/30 bg-secondary/10 opacity-50"
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 shrink-0 ${color}`} />
                  <span className="font-medium truncate">{label}</span>
                  <span className={`ml-auto flex h-1.5 w-1.5 rounded-full shrink-0 ${
                    needsId || needsGa4Id ? "bg-amber-400" : isFullyReady ? "bg-emerald-500" : "bg-on-surface-variant"
                  }`} />
                </div>
              );
            })}
          </div>

          {/* Customer ID prompt — only shows when Google Ads is authorized but customer ID is missing */}
          {showCustomerIdPrompt && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <KeyRound className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <p className="text-xs font-semibold text-amber-300">Google Ads Customer ID required</p>
              </div>
              <p className="text-[10px] text-muted-foreground">
                OAuth token saved. Enter your 10-digit Customer ID to enable all Google Ads API calls.
                Found in Google Ads → Admin → Account settings (format: 123-456-7890).
              </p>
              <div className="flex gap-2">
                <Input
                  placeholder="123-456-7890"
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSaveCustomerId(); }}
                  className="font-mono text-xs h-8 flex-1"
                  data-testid="input-google-ads-customer-id"
                />
                <Button
                  size="sm"
                  onClick={handleSaveCustomerId}
                  disabled={isSavingId || !customerId.trim()}
                  className="h-8 text-xs gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
                  data-testid="button-save-customer-id"
                >
                  {isSavingId ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                  Save
                </Button>
              </div>
            </div>
          )}

          {/* Confirmation when customer ID is saved */}
          {gadsConnected && hasCustomerId && (
            <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/5 border border-emerald-500/20 rounded-md px-3 py-2">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              <span>Google Ads Customer ID configured — API calls enabled.</span>
            </div>
          )}

          {/* GA4 Property ID prompt — shown when Google Ads is connected but GA4 property ID is missing */}
          {showGa4Prompt && (
            <div className="rounded-2xl border border-sky-500/30 bg-sky-500/5 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <BarChart2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                <p className="text-xs font-semibold text-sky-300">Connect Google Analytics 4</p>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Since you've enabled the Google Analytics API, enter your GA4 Property ID to unlock attribution cross-reference — comparing GA4 data-driven revenue against ad platform self-reported figures to detect double-counting.
              </p>
              <div className="flex gap-2">
                <Input
                  placeholder="e.g. 123456789"
                  value={ga4PropertyId}
                  onChange={(e) => setGa4PropertyId(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSaveGa4PropertyId(); }}
                  className="font-mono text-xs h-8 flex-1"
                  data-testid="input-ga4-property-id"
                />
                <Button
                  size="sm"
                  onClick={handleSaveGa4PropertyId}
                  disabled={isSavingGa4 || !ga4PropertyId.trim()}
                  className="h-8 text-xs gap-1.5 bg-sky-600 hover:bg-sky-700 text-white"
                  data-testid="button-save-ga4-property-id"
                >
                  {isSavingGa4 ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                  Save
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">Found in GA4 → Admin → Property Settings → Property ID (numeric only)</p>
            </div>
          )}

          {/* Confirmation when GA4 is fully connected */}
          {gadsConnected && hasCustomerId && hasGa4PropertyId && (
            <div className="flex items-center gap-2 text-xs text-sky-400 bg-sky-500/5 border border-sky-500/20 rounded-md px-3 py-2">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              <span>GA4 connected — attribution cross-reference enabled.</span>
            </div>
          )}
        </CardContent>

        <CardFooter className="pt-3 border-t border-border/50 flex flex-wrap gap-2 justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsDialogOpen(true)}
            className="font-mono text-xs gap-1.5"
          >
            View Setup Guide
          </Button>

          {/* Disconnect — only visible when at least one Google service is connected */}
          {connectedCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleDisconnect}
              disabled={isDisconnecting || isConnecting}
              className="font-mono text-xs gap-1.5 border-rose-500/40 text-rose-400 hover:bg-error-container/10 hover:border-rose-500/60 hover:text-red-300"
              data-testid="button-disconnect-google-workspace"
            >
              {isDisconnecting
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <span className="text-[11px]">✕</span>}
              Disconnect
            </Button>
          )}

          <Button
            size="sm"
            onClick={handleAuthorize}
            disabled={isConnecting || isDisconnecting}
            className="font-mono text-xs gap-1.5 bg-primary-container hover:bg-primary-m3 text-white"
            data-testid="button-connect-google-workspace"
          >
            {isConnecting
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <SiGoogle className="w-3.5 h-3.5" />}
            {allConnected && hasCustomerId ? "Re-authorize Google Workspace" : "Connect Google Workspace"}
          </Button>
        </CardFooter>
      </Card>

      {/* Pre-flight setup guide dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[540px]">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2 rounded-md bg-primary-container/10 ring-1 ring-primary-container/30">
                <SiGoogle className="w-5 h-5 text-[#60a5fa]" />
              </div>
              <DialogTitle>Google Workspace Setup Guide</DialogTitle>
            </div>
            <DialogDescription>
              Before authorizing, register the redirect URI in Google Cloud Console.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-1">
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <p className="text-sm font-semibold text-amber-300">Register the Redirect URI first</p>
              </div>
              <p className="text-xs text-muted-foreground">
                Add this exact URI to your{" "}
                <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="text-[#60a5fa] underline">
                  Google Cloud Console
                </a>{" "}
                OAuth 2.0 credentials before clicking Authorize.
              </p>
              {redirectUri && <CopyableUri uri={redirectUri} />}
            </div>

            <div className="rounded-2xl bg-secondary/20 border border-border/50 px-4 py-3 space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Permissions requested (single auth)</p>
              <ul className="text-xs text-muted-foreground space-y-0.5 mt-1">
                <li>• Manage Google Ads campaigns, budgets &amp; bidding</li>
                <li>• Read &amp; manage Google Merchant Center product feeds</li>
                <li>• Read-only Google Search Console analytics</li>
                <li>• YouTube Data API (force-ssl scope)</li>
                <li>• Google Sheets — create, read &amp; write spreadsheets</li>
                <li>• Google Drive — manage files created by this app</li>
                <li>• Google Analytics 4 — read-only data API</li>
                <li>• Read your Google account email for identification</li>
              </ul>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setIsDialogOpen(false)}>Close</Button>
              <Button
                size="sm"
                onClick={handleAuthorize}
                disabled={isConnecting}
                className="gap-2 bg-primary-container hover:bg-primary-m3 text-white"
              >
                {isConnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />}
                Authorize with Google
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDisconnectConfirm} onOpenChange={setShowDisconnectConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Google Workspace</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all Google OAuth tokens from the database (Google Ads, Merchant Center, Search Console, YouTube, Google Sheets). You will need to re-authorize.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={executeDisconnect}>Disconnect</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
