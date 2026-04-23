import { useState } from "react";
import { SiGoogleads, SiMeta, SiShopify, SiGoogle } from "react-icons/si";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ShopifyOAuthDialog } from "./shopify-oauth-dialog";
import { GoogleOAuthDialog } from "./google-oauth-dialog";
import { MetaOAuthDialog } from "./meta-oauth-dialog";
import { useDeleteConnection, useTestConnection, getListConnectionsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import type { PlatformConnection } from "@workspace/api-client-react";
import { CreateConnectionBodyPlatform } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";

interface PlatformCardProps {
  platformId: CreateConnectionBodyPlatform;
  displayName: string;
  description: string;
  connection?: PlatformConnection;
}

const PLATFORM_CONFIG: Record<
  CreateConnectionBodyPlatform,
  { label: string; buttonColor: string; icon: React.ReactNode }
> = {
  google_ads: {
    label: "Authorize with Google",
    buttonColor: "bg-primary-container hover:bg-primary-m3 text-white",
    icon: <SiGoogleads className="w-6 h-6 text-primary-container" />,
  },
  meta: {
    label: "Authorize with Meta",
    buttonColor: "bg-[#1877F2] hover:bg-[#166FE5] text-white",
    icon: <SiMeta className="w-6 h-6 text-[#1877F2]" />,
  },
  shopify: {
    label: "Authorize with Shopify",
    buttonColor: "bg-emerald-600 hover:bg-emerald-700 text-white",
    icon: <SiShopify className="w-6 h-6 text-emerald-500" />,
  },
  gmc: {
    label: "Authorize with Google",
    buttonColor: "bg-error-m3 hover:bg-rose-700 text-white",
    icon: <SiGoogle className="w-6 h-6 text-error-m3" />,
  },
  gsc: {
    label: "Authorize with Google",
    buttonColor: "bg-emerald-600 hover:bg-emerald-700 text-white",
    icon: <Search className="w-6 h-6 text-emerald-500" />,
  },
  // OAuth-only Google platforms — share the Google styling/icon.
  google_workspace: {
    label: "Authorize with Google",
    buttonColor: "bg-primary-container hover:bg-primary-m3 text-white",
    icon: <SiGoogle className="w-6 h-6 text-primary-container" />,
  },
  google_sheets: {
    label: "Authorize with Google",
    buttonColor: "bg-emerald-600 hover:bg-emerald-700 text-white",
    icon: <SiGoogle className="w-6 h-6 text-emerald-600" />,
  },
};

export function PlatformCard({ platformId, displayName, description, connection }: PlatformCardProps) {
  const [isOAuthDialogOpen, setIsOAuthDialogOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const deleteMutation = useDeleteConnection();
  const testMutation = useTestConnection();

  const isConnected = !!connection;
  const config = PLATFORM_CONFIG[platformId];

  const handleDisconnect = () => {
    if (!connection) return;
    deleteMutation.mutate({ id: connection.id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListConnectionsQueryKey() });
        toast({ title: "Disconnected", description: `Successfully disconnected from ${displayName}.` });
      },
      onError: () => {
        toast({ title: "Error", description: `Failed to disconnect from ${displayName}.`, variant: "destructive" });
      }
    });
  };

  const handleTest = () => {
    if (!connection) return;
    testMutation.mutate({ id: connection.id }, {
      onSuccess: (result) => {
        if (result.success) {
          toast({ title: "Connection Successful", description: result.message });
        } else {
          toast({ title: "Connection Failed", description: result.message, variant: "destructive" });
        }
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to test connection.", variant: "destructive" });
      }
    });
  };

  return (
    <>
      <Card className="flex flex-col bg-card/50 border-border/50 shadow-sm backdrop-blur-sm transition-all hover:bg-card hover:border-border">
        <CardHeader className="flex flex-row items-start justify-between pb-2">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-md bg-secondary/30 ring-1 ring-border/50">
              {config.icon}
            </div>
            <div>
              <CardTitle className="text-base font-bold tracking-tight">{displayName}</CardTitle>
              <CardDescription className="text-xs font-mono text-muted-foreground mt-1">
                {description}
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            {isConnected ? (
              <>
                <span className="flex h-2 w-2 relative" data-testid={`status-indicator-${platformId}`}>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                <Badge variant="outline" className="text-emerald-500 border-emerald-500/20 bg-emerald-500/10 font-mono text-[10px] uppercase">Connected</Badge>
              </>
            ) : (
              <>
                <span className="flex h-2 w-2 rounded-full bg-muted" data-testid={`status-indicator-${platformId}`} />
                <Badge variant="outline" className="text-muted-foreground font-mono text-[10px] uppercase">Disconnected</Badge>
              </>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex-grow" />
        <CardFooter className="pt-4 border-t border-border/50 flex flex-wrap gap-2 justify-end">
          {isConnected ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleTest}
                disabled={testMutation.isPending}
                className="font-mono text-xs border-primary/20 hover:border-primary hover:text-primary hover:bg-primary/10"
                data-testid={`button-test-${platformId}`}
              >
                {testMutation.isPending ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : null}
                Test Connection
              </Button>
              <Button
                size="sm"
                onClick={() => setIsOAuthDialogOpen(true)}
                className={`font-mono text-xs gap-1.5 ${config.buttonColor}`}
                data-testid={`button-reauth-${platformId}`}
              >
                Re-authorize
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDisconnect}
                disabled={deleteMutation.isPending}
                className="font-mono text-xs"
                data-testid={`button-disconnect-${platformId}`}
              >
                {deleteMutation.isPending ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : null}
                Disconnect
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              onClick={() => setIsOAuthDialogOpen(true)}
              className={`font-mono text-xs gap-1.5 ${config.buttonColor}`}
              data-testid={`button-connect-${platformId}`}
            >
              {config.label}
            </Button>
          )}
        </CardFooter>
      </Card>

      {platformId === "shopify" && (
        <ShopifyOAuthDialog isOpen={isOAuthDialogOpen} onOpenChange={setIsOAuthDialogOpen} />
      )}
      {(platformId === "google_ads" ||
        platformId === "gmc" ||
        platformId === "gsc" ||
        platformId === "google_workspace" ||
        platformId === "google_sheets") && (
        <GoogleOAuthDialog platform={platformId} isOpen={isOAuthDialogOpen} onOpenChange={setIsOAuthDialogOpen} />
      )}
      {platformId === "meta" && (
        <MetaOAuthDialog isOpen={isOAuthDialogOpen} onOpenChange={setIsOAuthDialogOpen} />
      )}
    </>
  );
}
