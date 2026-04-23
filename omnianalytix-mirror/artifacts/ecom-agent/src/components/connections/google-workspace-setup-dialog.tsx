import { useState } from "react";
import { SiGoogle } from "react-icons/si";
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
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListConnectionsQueryKey } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { authFetch } from "@/lib/auth-fetch";

const BASE_URL = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE_URL.endsWith("/") ? BASE_URL.slice(0, -1) : BASE_URL;

interface GoogleWorkspaceSetupDialogProps {
  setupKey: string;
  email: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

export function GoogleWorkspaceSetupDialog({
  setupKey,
  email,
  isOpen,
  onOpenChange,
  onComplete,
}: GoogleWorkspaceSetupDialogProps) {
  const [developerToken, setDeveloperToken] = useState("");
  const [customerId, setCustomerId] = useState(() => {
    try { return sessionStorage.getItem("omni_gads_customer_id") ?? ""; } catch { return ""; }
  });
  const [managerCustomerId, setManagerCustomerId] = useState(() => {
    try { return sessionStorage.getItem("omni_gads_mcc_id") ?? ""; } catch { return ""; }
  });
  const [merchantId, setMerchantId] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [ga4PropertyId, setGa4PropertyId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleSubmit = async () => {
    setError("");
    setIsSubmitting(true);
    try {
      const body: Record<string, string> = { setupKey };
      if (developerToken) body.developerToken = developerToken;
      if (customerId) body.customerId = customerId;
      if (managerCustomerId) body.managerCustomerId = managerCustomerId;
      if (merchantId) body.merchantId = merchantId;
      if (siteUrl) body.siteUrl = siteUrl;
      if (ga4PropertyId) body.ga4PropertyId = ga4PropertyId.trim();

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

      const result = await resp.json() as { platforms?: string[] };
      const count = result.platforms?.length ?? 1;
      toast({
        title: "Google Workspace Connected",
        description: `${count} service${count !== 1 ? "s" : ""} connected${email ? ` as ${email}` : ""}.`,
      });
      queryClient.invalidateQueries({ queryKey: getListConnectionsQueryKey() });
      try { sessionStorage.removeItem("omni_gads_customer_id"); sessionStorage.removeItem("omni_gads_mcc_id"); } catch { /* ignore */ }
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
      <DialogContent className="sm:max-w-[520px] max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 rounded-md bg-primary-container/10 ring-1 ring-primary-container/30">
              <SiGoogle className="w-5 h-5 text-[#60a5fa]" />
            </div>
            <div>
              <DialogTitle>Complete Google Workspace Setup</DialogTitle>
              <DialogDescription className="text-xs mt-0.5">
                Google authorization successful{email ? ` · ${email}` : ""}. Enter the IDs for each service you want to connect. Leave any blank to skip that service.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5 pt-1">
          {/* Google Ads */}
          <div className="rounded-2xl border border-border/50 bg-secondary/10 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[#60a5fa] border-primary-container/30 bg-primary-container/10 font-mono text-[10px]">Google Ads</Badge>
              <span className="text-xs text-muted-foreground">Enter your Customer ID to connect</span>
            </div>
            <div className="space-y-2">
              {/* Developer token pre-configured notice */}
              <div className="flex items-center gap-2 rounded-md bg-emerald-500/10 border border-emerald-500/20 px-3 py-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <p className="text-[11px] text-emerald-400">Developer token pre-configured — no need to enter it here.</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Customer ID <span className="text-rose-400">*</span></Label>
                <Input
                  placeholder="123-456-7890"
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  className="font-mono text-sm h-8"
                />
                <p className="text-[10px] text-muted-foreground">Top-right corner of your Google Ads account</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Manager Customer ID <span className="text-muted-foreground">(optional — MCC accounts only)</span></Label>
                <Input
                  placeholder="123-456-7890"
                  value={managerCustomerId}
                  onChange={(e) => setManagerCustomerId(e.target.value)}
                  className="font-mono text-sm h-8"
                />
              </div>
            </div>
          </div>

          {/* Merchant Center */}
          <div className="rounded-2xl border border-border/50 bg-secondary/10 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-rose-400 border-rose-500/30 bg-error-container/10 font-mono text-[10px]">Merchant Center</Badge>
              <span className="text-xs text-muted-foreground">Optional</span>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Merchant ID</Label>
              <Input
                placeholder="123456789"
                value={merchantId}
                onChange={(e) => setMerchantId(e.target.value)}
                className="font-mono text-sm h-8"
              />
              <p className="text-[10px] text-muted-foreground">Found in Merchant Center → Settings → Account information</p>
            </div>
          </div>

          {/* Search Console */}
          <div className="rounded-2xl border border-border/50 bg-secondary/10 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-emerald-400 border-emerald-500/30 bg-emerald-500/10 font-mono text-[10px]">Search Console</Badge>
              <span className="text-xs text-muted-foreground">Optional</span>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Site URL</Label>
              <Input
                placeholder="https://www.yoursite.com"
                value={siteUrl}
                onChange={(e) => setSiteUrl(e.target.value)}
                className="font-mono text-sm h-8"
              />
              <p className="text-[10px] text-muted-foreground">Must exactly match the property URL in Search Console</p>
            </div>
          </div>

          {/* GA4 Property ID */}
          <div className="rounded-2xl border border-border/50 bg-secondary/10 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-sky-400 border-sky-500/30 bg-sky-500/10 font-mono text-[10px]">GA4</Badge>
              <span className="text-xs text-muted-foreground">Optional — enables attribution cross-reference</span>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">GA4 Property ID</Label>
              <Input
                placeholder="e.g. 123456789"
                value={ga4PropertyId}
                onChange={(e) => setGa4PropertyId(e.target.value)}
                className="font-mono text-sm h-8"
              />
              <p className="text-[10px] text-muted-foreground">Found in GA4 → Admin → Property Settings → Property ID</p>
            </div>
          </div>

          {/* Auto-connected services */}
          <div className="space-y-2">
            <div className="rounded-2xl border border-border/50 bg-secondary/10 px-4 py-3 flex items-center gap-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              <div>
                <p className="text-xs font-medium">YouTube / Google Data</p>
                <p className="text-[10px] text-muted-foreground">Automatically connected — no extra ID required.</p>
              </div>
              <Badge variant="outline" className="ml-auto text-emerald-500 border-emerald-500/20 bg-emerald-500/10 font-mono text-[10px]">Auto</Badge>
            </div>
            <div className="rounded-2xl border border-border/50 bg-secondary/10 px-4 py-3 flex items-center gap-3">
              <CheckCircle2 className="w-4 h-4 text-[#0F9D58] shrink-0" />
              <div>
                <p className="text-xs font-medium">Google Sheets & Drive</p>
                <p className="text-[10px] text-muted-foreground">Native spreadsheet access — create, read & write sheets directly from AI.</p>
              </div>
              <Badge variant="outline" className="ml-auto text-[#0F9D58] border-[#0F9D58]/20 bg-[#0F9D58]/10 font-mono text-[10px]">Auto</Badge>
            </div>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="gap-2 bg-primary-container hover:bg-primary-m3 text-white"
            >
              {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <SiGoogle className="w-3.5 h-3.5" />}
              Connect Google Workspace
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
