import { useState } from "react";
import { SiYoutube } from "react-icons/si";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useListConnections } from "@workspace/api-client-react";
import { ExternalLink, Loader2 } from "lucide-react";

const BASE_URL = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE_URL.endsWith("/") ? BASE_URL.slice(0, -1) : BASE_URL;

export function YoutubeCard() {
  const { data: connections } = useListConnections();
  const [isConnecting, setIsConnecting] = useState(false);

  const isConnected = !!connections?.find((c) => c.platform === "youtube");

  const handleConnect = () => {
    setIsConnecting(true);
    window.location.href = `${API_BASE}/api/auth/google/start?platform=youtube`;
  };

  return (
    <Card className="flex flex-col bg-card/50 border-border/50 shadow-sm backdrop-blur-sm transition-all hover:bg-card hover:border-border">
      <CardHeader className="flex flex-row items-start justify-between pb-2">
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-md bg-secondary/30 ring-1 ring-border/50">
            <SiYoutube className="w-6 h-6 text-error-m3" />
          </div>
          <div>
            <CardTitle className="text-base font-bold tracking-tight">YouTube / Google Data</CardTitle>
            <CardDescription className="text-xs font-mono text-muted-foreground mt-1">
              Video ad performance, audit broken links, YouTube analytics
            </CardDescription>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          {isConnected ? (
            <>
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <Badge variant="outline" className="text-emerald-500 border-emerald-500/20 bg-emerald-500/10 font-mono text-[10px] uppercase">Connected</Badge>
            </>
          ) : (
            <>
              <span className="flex h-2 w-2 rounded-full bg-muted" />
              <Badge variant="outline" className="text-muted-foreground font-mono text-[10px] uppercase">Disconnected</Badge>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex-grow">
        <p className="text-xs text-muted-foreground font-mono mt-1">
          Scope: <code className="text-on-surface-variant">youtube.force-ssl</code>
        </p>
      </CardContent>
      <CardFooter className="pt-4 border-t border-border/50 flex flex-wrap gap-2 justify-end">
        {isConnected ? (
          <Button
            variant="outline"
            size="sm"
            onClick={handleConnect}
            className="font-mono text-xs gap-1.5 border-rose-500/20 hover:border-rose-500 hover:text-rose-400 hover:bg-error-container/10"
          >
            <ExternalLink className="w-3 h-3" />
            Re-authorize
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={handleConnect}
            disabled={isConnecting}
            className="font-mono text-xs gap-1.5 bg-error-m3 hover:bg-rose-700 text-white"
            data-testid="button-connect-youtube"
          >
            {isConnecting ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <SiYoutube className="w-3.5 h-3.5" />
            )}
            Connect YouTube
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
