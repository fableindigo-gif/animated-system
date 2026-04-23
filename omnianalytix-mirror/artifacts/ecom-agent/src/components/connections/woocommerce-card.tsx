import { useState, useEffect } from "react";
import { SiWoo } from "react-icons/si";
import { AlertCircle, CheckCircle2, ExternalLink, KeyRound, Loader2, PlugZap, ShieldCheck, Store } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getListConnectionsQueryKey } from "@workspace/api-client-react";
import { authFetch } from "@/lib/auth-fetch";

const BASE = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE.endsWith("/") ? BASE : BASE + "/";

interface Props {
  existingConnectionId?: number | null;
}

export function WooCommerceCard({ existingConnectionId }: Props) {
  const { toast }  = useToast();
  const queryClient = useQueryClient();

  const [storeUrl,  setStoreUrl]  = useState("");
  const [consumerKey, setConsumerKey] = useState("");
  const [secret,    setSecret]    = useState("");
  const [saving,    setSaving]    = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error,     setError]     = useState("");

  const connected = !!existingConnectionId;

  const handleConnect = async () => {
    const url = storeUrl.trim();
    const ck  = consumerKey.trim();
    const cs  = secret.trim();
    if (!url || !ck || !cs) { setError("All three fields are required."); return; }

    setSaving(true);
    setError("");
    try {
      const storeLabel = url.replace(/^https?:\/\//, "").split("/")[0];
      const resp = await authFetch(`${API_BASE}api/connections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: "woocommerce",
          displayName: storeLabel,
          credentials: { storeUrl: url, consumerKey: ck, consumerSecret: cs },
        }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Failed to save");
      }
      await queryClient.invalidateQueries({ queryKey: getListConnectionsQueryKey() });
      toast({ title: "WooCommerce Connected", description: `${storeLabel} synced via REST API.` });
      setStoreUrl(""); setConsumerKey(""); setSecret("");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not connect. Check credentials.";
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    if (!existingConnectionId) return;
    setDisconnecting(true);
    try {
      await authFetch(`${API_BASE}api/connections/${existingConnectionId}`, { method: "DELETE" });
      await queryClient.invalidateQueries({ queryKey: getListConnectionsQueryKey() });
      toast({ title: "WooCommerce Disconnected", description: "Connection removed." });
    } catch {
      toast({ title: "Error", description: "Could not disconnect.", variant: "destructive" });
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <Card className="flex flex-col bg-card/50 border-border/50 shadow-sm backdrop-blur-sm transition-all hover:bg-card hover:border-border">
      <CardHeader className="flex flex-row items-start justify-between pb-2">
        <div className="flex items-center space-x-3">
          <div className={`p-2 rounded-md ring-1 ${connected ? "bg-purple-500/10 ring-purple-500/30" : "bg-secondary/30 ring-border/50"}`}>
            <SiWoo className={`w-6 h-6 ${connected ? "text-purple-400" : "text-muted-foreground"}`} />
          </div>
          <div>
            <CardTitle className="text-base font-bold tracking-tight">WooCommerce</CardTitle>
            <CardDescription className="text-xs font-mono text-muted-foreground mt-1">
              Orders · products · revenue via REST API
            </CardDescription>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {connected ? (
            <>
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500" />
              </span>
              <Badge variant="outline" className="text-purple-400 border-purple-500/20 bg-purple-500/10 font-mono text-[10px] uppercase">
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
          {["Orders", "Products", "Customers", "Revenue", "Refunds"].map((tag) => (
            <span
              key={tag}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-medium border transition-colors ${
                connected
                  ? "border-purple-500/20 bg-purple-500/5 text-purple-300"
                  : "border-border/30 bg-secondary/10 text-muted-foreground opacity-60"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-purple-500" : "bg-on-surface-variant"}`} />
              {tag}
            </span>
          ))}
        </div>

        {connected ? (
          <div className="flex items-center gap-2 text-xs text-purple-400 bg-purple-500/5 border border-purple-500/20 rounded-md px-3 py-2">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span>REST API connected — inventory and order sync enabled</span>
          </div>
        ) : (
          <div className="space-y-2 pt-1">
            <a
              href="https://woocommerce.com/document/woocommerce-rest-api/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[10px] font-mono text-accent-blue/60 hover:text-accent-blue transition-colors"
            >
              <ExternalLink className="w-2.5 h-2.5" />
              How to generate REST API keys →
            </a>

            <Input
              type="text"
              placeholder="https://yourstore.com"
              value={storeUrl}
              onChange={(e) => { setStoreUrl(e.target.value); setError(""); }}
              className="font-mono text-xs h-8 bg-surface-container-low border-outline-variant/20 placeholder:text-on-surface-variant focus-visible:ring-accent-blue/15"
            />
            <Input
              type="text"
              placeholder="ck_xxxx (Consumer Key)"
              value={consumerKey}
              onChange={(e) => { setConsumerKey(e.target.value); setError(""); }}
              className="font-mono text-xs h-8 bg-surface-container-low border-outline-variant/20 placeholder:text-on-surface-variant focus-visible:ring-accent-blue/15"
            />
            <Input
              type="password"
              placeholder="cs_xxxx (Consumer Secret)"
              value={secret}
              onChange={(e) => { setSecret(e.target.value); setError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") handleConnect(); }}
              className="font-mono text-xs h-8 bg-surface-container-low border-outline-variant/20 placeholder:text-on-surface-variant focus-visible:ring-accent-blue/15"
            />

            {error && (
              <div className="flex items-center gap-1.5 text-[10px] font-mono text-rose-400">
                <AlertCircle className="w-3 h-3 shrink-0" />
                {error}
              </div>
            )}

            <p className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground/60">
              <ShieldCheck className="w-3 h-3 text-purple-500/60 shrink-0" />
              Credentials stored encrypted · read-only API scope required
            </p>
          </div>
        )}
      </CardContent>

      <CardFooter className="pt-3 border-t border-border/50 flex flex-wrap gap-2 justify-end">
        {connected ? (
          <Button
            variant="outline"
            size="sm"
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="font-mono text-xs gap-1.5 border-rose-500/40 text-rose-400 hover:bg-error-container/10 hover:border-rose-500/60 hover:text-red-300"
          >
            {disconnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <span className="text-[11px]">✕</span>}
            Disconnect
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={handleConnect}
            disabled={saving || !storeUrl.trim() || !consumerKey.trim() || !secret.trim()}
            className="font-mono text-xs gap-1.5 bg-accent-blue hover:bg-accent-blue/90 text-white disabled:opacity-40"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlugZap className="w-3.5 h-3.5" />}
            Connect Store
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
