import { useState } from "react";
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
import { SiMeta } from "react-icons/si";
import { ExternalLink, ShieldCheck, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListConnectionsQueryKey } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { authFetch } from "@/lib/auth-fetch";

const BASE_URL = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE_URL.endsWith("/") ? BASE_URL.slice(0, -1) : BASE_URL;

interface MetaOAuthDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MetaOAuthDialog({ isOpen, onOpenChange }: MetaOAuthDialogProps) {
  const handleAuthorize = () => {
    window.location.href = `${API_BASE}/api/auth/meta/start`;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 rounded-md bg-primary-container/10 ring-1 ring-primary-container/20">
              <SiMeta className="w-5 h-5 text-primary-container" />
            </div>
            <DialogTitle>Connect Meta Ads</DialogTitle>
          </div>
          <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
            Authorize via Facebook Login. You'll return here to complete setup with your Ad Account ID.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="rounded-2xl bg-secondary/30 border border-border/50 px-4 py-3 space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Permissions requested</p>
            <ul className="text-xs text-muted-foreground space-y-0.5">
              <li>• Manage and read your Meta Ads campaigns</li>
              <li>• Read ad performance insights & analytics</li>
              <li>• Manage business assets and pages</li>
              <li>• Product catalog management</li>
              <li>• Instagram insights, comments & messages</li>
              <li>• Publish content to Instagram</li>
              <li>• Lead generation data</li>
            </ul>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
            <span>Uses Facebook's official OAuth. Long-lived token (60 days) stored encrypted. Revocable from Meta Business settings.</span>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleAuthorize}
              className="bg-primary-container hover:bg-primary-m3 text-white gap-2"
              data-testid="button-meta-oauth"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Authorize with Meta
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Meta Setup Completion Dialog ─────────────────────────────────────────────

interface MetaSetupDialogProps {
  setupKey: string;
  email: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

export function MetaSetupDialog({ setupKey, email, isOpen, onOpenChange, onComplete }: MetaSetupDialogProps) {
  const [adAccountId, setAdAccountId] = useState("");
  const [pageId, setPageId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleSubmit = async () => {
    setError("");
    if (!adAccountId) { setError("Ad Account ID is required"); return; }

    setIsSubmitting(true);
    try {
      const resp = await authFetch(`${API_BASE}/api/auth/meta/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setupKey, adAccountId, pageId: pageId || undefined }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Request failed" })) as { error?: string };
        setError(err.error ?? "Failed to complete setup");
        return;
      }

      toast({
        title: "Meta Ads Connected",
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
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Complete Meta Ads Setup</DialogTitle>
          <DialogDescription>
            Meta authorization successful{email ? ` (${email})` : ""}. Provide your Ad Account ID to finish.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label>Ad Account ID</Label>
            <Input
              placeholder="act_123456789"
              value={adAccountId}
              onChange={(e) => setAdAccountId(e.target.value)}
              className="font-mono text-sm"
              data-testid="input-ad-account-id"
            />
            <p className="text-xs text-muted-foreground">Found in Meta Ads Manager → Account Settings. Format: act_XXXXXXXXX</p>
          </div>

          <div className="space-y-1.5">
            <Label>Page ID <span className="text-muted-foreground">(optional, for creative updates)</span></Label>
            <Input
              placeholder="123456789"
              value={pageId}
              onChange={(e) => setPageId(e.target.value)}
              className="font-mono text-sm"
            />
          </div>

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
