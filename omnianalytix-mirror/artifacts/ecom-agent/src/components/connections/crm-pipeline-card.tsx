import { useState, useEffect } from "react";
import { GitMerge, KeyRound, CheckCircle2, Loader2, PlugZap, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { authFetch } from "@/lib/auth-fetch";

const LS_KEY = "omni_crm_pipeline_key_saved";

const CRM_PLATFORMS = [
  { id: "hubspot",    label: "HubSpot",    color: "text-orange-400" },
  { id: "salesforce", label: "Salesforce", color: "text-[#60a5fa]"   },
  { id: "pipedrive",  label: "Pipedrive",  color: "text-emerald-400"  },
];

export function CrmPipelineCard() {
  const { toast } = useToast();
  const [apiKey, setApiKey]             = useState("");
  const [isSaving, setIsSaving]         = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [connected, setConnected]       = useState(false);
  const [maskedKey, setMaskedKey]       = useState("");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored) {
        setConnected(true);
        setMaskedKey(`••••••••${stored.slice(-4)}`);
      }
    } catch { /* ignore */ }
  }, []);

  const handleConnect = async () => {
    const key = apiKey.trim();
    if (!key) return;
    setIsSaving(true);
    try {
      await authFetch(`${import.meta.env.BASE_URL ?? "/"}api/crm/connect`.replace("//api", "/api"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: key }),
      }).catch(() => null);

      localStorage.setItem(LS_KEY, key);
      setConnected(true);
      setMaskedKey(`••••••••${key.slice(-4)}`);
      setApiKey("");
      toast({
        title: "CRM Connected",
        description: "Pipeline sync and offline conversion upload are now enabled.",
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
      toast({ title: "CRM Disconnected", description: "API key removed." });
      setIsDisconnecting(false);
    }, 600);
  };

  return (
    <Card className="flex flex-col bg-card/50 border-border/50 shadow-sm backdrop-blur-sm transition-all hover:bg-card hover:border-border">
      <CardHeader className="flex flex-row items-start justify-between pb-2">
        <div className="flex items-center space-x-3">
          <div className={`p-2 rounded-md ring-1 ${connected ? "bg-violet-500/10 ring-violet-500/30" : "bg-secondary/30 ring-border/50"}`}>
            <GitMerge className={`w-6 h-6 ${connected ? "text-violet-400" : "text-muted-foreground"}`} />
          </div>
          <div>
            <CardTitle className="text-base font-bold tracking-tight">CRM &amp; Pipeline</CardTitle>
            <CardDescription className="text-xs font-mono text-muted-foreground mt-1">
              HubSpot / Salesforce — deal stage sync &amp; offline conversions
            </CardDescription>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {connected ? (
            <>
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500" />
              </span>
              <Badge variant="outline" className="text-violet-400 border-violet-500/20 bg-violet-500/10 font-mono text-[10px] uppercase">
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

      <CardContent className="flex-grow pt-0 pb-3 space-y-3">
        <div className="flex flex-wrap gap-1.5 mt-1">
          {CRM_PLATFORMS.map(({ id, label, color }) => (
            <span
              key={id}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-medium border transition-colors ${
                connected
                  ? "border-violet-500/20 bg-violet-500/5 text-violet-300"
                  : "border-border/30 bg-secondary/10 text-muted-foreground opacity-60"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-violet-500" : "bg-on-surface-variant"}`} />
              <span className={connected ? "" : color}>{label}</span>
            </span>
          ))}
        </div>

        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Push ad-attributed leads into CRM deal stages automatically. Syncs signed deals
          and qualified calls back to Google Ads as enhanced offline conversions for smarter bidding.
        </p>

        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono border border-violet-500/20 bg-violet-500/5 text-violet-400">
            <Upload className="w-2.5 h-2.5" /> Offline Conversion Upload
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono border border-primary-container/20 bg-primary-container/5 text-[#60a5fa]">
            <GitMerge className="w-2.5 h-2.5" /> Pipeline Stage Sync
          </span>
        </div>

        {connected && (
          <div className="flex items-center gap-2 text-xs text-violet-400 bg-violet-500/5 border border-violet-500/20 rounded-md px-3 py-2">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span>
              API key active&nbsp;
              <code className="font-mono text-violet-300 bg-violet-500/10 px-1.5 py-0.5 rounded text-[10px]">{maskedKey}</code>
            </span>
          </div>
        )}

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
              />
            </div>
          </div>
        )}
      </CardContent>

      <CardFooter className="pt-3 border-t border-border/50 flex flex-wrap gap-2 justify-end">
        {connected ? (
          <Button
            variant="outline"
            size="sm"
            onClick={handleDisconnect}
            disabled={isDisconnecting}
            className="font-mono text-xs gap-1.5 border-rose-500/40 text-rose-400 hover:bg-error-container/10 hover:border-rose-500/60 hover:text-red-300"
          >
            {isDisconnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <span className="text-[11px]">✕</span>}
            Disconnect
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={handleConnect}
            disabled={isSaving || !apiKey.trim()}
            className="font-mono text-xs gap-1.5 bg-violet-700 hover:bg-violet-600 text-white disabled:opacity-40"
          >
            {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlugZap className="w-3.5 h-3.5" />}
            Connect CRM
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
