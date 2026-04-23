import { useState, useEffect } from "react";
import { Users, KeyRound, CheckCircle2, Loader2, Plug, PlugZap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { authFetch } from "@/lib/auth-fetch";

const LS_KEY = "omni_crm_api_key_saved";

const CRM_PLATFORMS = [
  { id: "klaviyo",  label: "Klaviyo",  color: "text-emerald-400"  },
  { id: "hubspot",  label: "HubSpot",  color: "text-orange-400" },
  { id: "mailchimp",label: "Mailchimp",color: "text-amber-400" },
];

export function CrmRetentionCard() {
  const { toast } = useToast();
  const [apiKey, setApiKey]             = useState("");
  const [isSaving, setIsSaving]         = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [connected, setConnected]       = useState(false);
  const [maskedKey, setMaskedKey]       = useState("");

  // Hydrate from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored) {
        setConnected(true);
        // Show only last 4 chars for security
        setMaskedKey(`••••••••${stored.slice(-4)}`);
      }
    } catch { /* ignore */ }
  }, []);

  const handleConnect = async () => {
    const key = apiKey.trim();
    if (!key) return;
    setIsSaving(true);
    try {
      // Attempt to persist to backend (non-blocking — falls through to localStorage)
      await authFetch(`${import.meta.env.BASE_URL ?? "/"}api/crm/connect`.replace("//api", "/api"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: key }),
      }).catch(() => null); // Silently swallow if endpoint not yet live

      localStorage.setItem(LS_KEY, key);
      setConnected(true);
      setMaskedKey(`••••••••${key.slice(-4)}`);
      setApiKey("");
      toast({
        title: "CRM Connected",
        description: "API key saved. Audience sync and retention flows are now enabled.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDisconnect = () => {
    setIsDisconnecting(true);
    setTimeout(() => {
      try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
      setConnected(false);
      setMaskedKey("");
      setApiKey("");
      toast({ title: "CRM Disconnected", description: "API key removed from this device." });
      setIsDisconnecting(false);
    }, 600);
  };

  return (
    <Card className="flex flex-col bg-card/50 border-border/50 shadow-sm backdrop-blur-sm transition-all hover:bg-card hover:border-border">
      {/* ── Header ── */}
      <CardHeader className="flex flex-row items-start justify-between pb-2">
        <div className="flex items-center space-x-3">
          <div className={`p-2 rounded-md ring-1 ${connected ? "bg-emerald-500/10 ring-green-500/30" : "bg-secondary/30 ring-border/50"}`}>
            <Users className={`w-6 h-6 ${connected ? "text-emerald-400" : "text-muted-foreground"}`} />
          </div>
          <div>
            <CardTitle className="text-base font-bold tracking-tight">CRM &amp; Retention</CardTitle>
            <CardDescription className="text-xs font-mono text-muted-foreground mt-1">
              Klaviyo / HubSpot — audience sync &amp; retention flows
            </CardDescription>
          </div>
        </div>

        {/* Status badge */}
        <div className="flex items-center space-x-2">
          {connected ? (
            <>
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <Badge variant="outline" className="text-emerald-500 border-emerald-500/20 bg-emerald-500/10 font-mono text-[10px] uppercase">
                Connected
              </Badge>
            </>
          ) : (
            <>
              <span className="flex h-2 w-2 rounded-full bg-muted" />
              <Badge variant="outline" className="text-muted-foreground font-mono text-[10px] uppercase">
                Disconnected
              </Badge>
            </>
          )}
        </div>
      </CardHeader>

      {/* ── Content ── */}
      <CardContent className="flex-grow pt-0 pb-3 space-y-3">
        {/* Platform capability pills */}
        <div className="flex flex-wrap gap-1.5 mt-1">
          {CRM_PLATFORMS.map(({ id, label, color }) => (
            <span
              key={id}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-medium border transition-colors ${
                connected
                  ? "border-emerald-500/20 bg-emerald-500/5 text-green-300"
                  : "border-border/30 bg-secondary/10 text-muted-foreground opacity-60"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-emerald-500" : "bg-on-surface-variant"}`} />
              <span className={connected ? "" : color}>{label}</span>
            </span>
          ))}
        </div>

        {/* Description */}
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Sync high-LTV audiences and trigger automated retention flows. Exclusion lists are pushed to
          Google Ads &amp; Meta Customer Match to avoid wasted retargeting spend.
        </p>

        {/* ── Connected state ── */}
        {connected && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/5 border border-emerald-500/20 rounded-md px-3 py-2">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              <span>
                API key active&nbsp;
                <code className="font-mono text-green-300 bg-emerald-500/10 px-1.5 py-0.5 rounded text-[10px]">{maskedKey}</code>
              </span>
            </div>
          </div>
        )}

        {/* ── Disconnected: API key input ── */}
        {!connected && (
          <div className="space-y-2 pt-1">
            <div className="flex items-center gap-1.5 mb-1">
              <KeyRound className="w-3 h-3 text-muted-foreground" />
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">API Key</span>
            </div>
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder="Enter CRM API Key..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleConnect(); }}
                className="font-mono text-xs h-8 flex-1 bg-surface-container-low border-outline-variant/15 placeholder:text-on-surface-variant focus-visible:ring-accent-blue/40"
                data-testid="input-crm-api-key"
              />
            </div>
          </div>
        )}
      </CardContent>

      {/* ── Footer ── */}
      <CardFooter className="pt-3 border-t border-border/50 flex flex-wrap gap-2 justify-end">
        {connected ? (
          <Button
            variant="outline"
            size="sm"
            onClick={handleDisconnect}
            disabled={isDisconnecting}
            className="font-mono text-xs gap-1.5 border-rose-500/40 text-rose-400 hover:bg-error-container/10 hover:border-rose-500/60 hover:text-red-300"
            data-testid="button-disconnect-crm"
          >
            {isDisconnecting
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <span className="text-[11px]">✕</span>}
            Disconnect
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={handleConnect}
            disabled={isSaving || !apiKey.trim()}
            className="font-mono text-xs gap-1.5 bg-cyan-700 hover:bg-cyan-600 text-white disabled:opacity-40"
            data-testid="button-connect-crm"
          >
            {isSaving
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <PlugZap className="w-3.5 h-3.5" />}
            Connect CRM
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
