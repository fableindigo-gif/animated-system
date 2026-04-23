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
import { SiShopify } from "react-icons/si";
import { ExternalLink, ShieldCheck } from "lucide-react";

const BASE_URL = import.meta.env.BASE_URL ?? "/";
const API_BASE = BASE_URL.endsWith("/") ? BASE_URL.slice(0, -1) : BASE_URL;

interface ShopifyOAuthDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShopifyOAuthDialog({ isOpen, onOpenChange }: ShopifyOAuthDialogProps) {
  const [shopDomain, setShopDomain] = useState("");
  const [error, setError] = useState("");

  const handleConnect = () => {
    const domain = shopDomain.trim().toLowerCase();
    if (!domain) {
      setError("Shop domain is required.");
      return;
    }
    const normalized = domain.includes(".myshopify.com") ? domain : `${domain}.myshopify.com`;
    if (!/^[a-zA-Z0-9-]+\.myshopify\.com$/.test(normalized)) {
      setError("Must be a valid .myshopify.com domain.");
      return;
    }
    setError("");
    const token = localStorage.getItem("omnianalytix_gate_token") ?? "";
    window.location.href = `${API_BASE}/api/auth/shopify/start?shop=${encodeURIComponent(normalized)}&token=${encodeURIComponent(token)}`;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 rounded-md bg-emerald-500/10 ring-1 ring-green-500/20">
              <SiShopify className="w-5 h-5 text-emerald-500" />
            </div>
            <DialogTitle>Connect Shopify Store</DialogTitle>
          </div>
          <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
            Authorize via Shopify OAuth to grant the agent Admin API access. You'll be redirected to Shopify to approve the required permissions.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="shopDomain">Your Shopify Store Domain</Label>
            <Input
              id="shopDomain"
              placeholder="mystore.myshopify.com"
              value={shopDomain}
              onChange={(e) => {
                setShopDomain(e.target.value);
                setError("");
              }}
              onKeyDown={(e) => e.key === "Enter" && handleConnect()}
              data-testid="input-shop-domain"
              className="font-mono text-sm"
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
            <p className="text-xs text-muted-foreground font-mono">
              e.g. my-brand.myshopify.com
            </p>
          </div>

          <div className="rounded-2xl bg-secondary/30 border border-border/50 px-4 py-3 space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Permissions requested</p>
            <ul className="text-xs text-muted-foreground space-y-0.5">
              <li>• Read & write products, inventory, pricing</li>
              <li>• Read & write orders, fulfillments, tags</li>
              <li>• Read & write discounts and price rules</li>
              <li>• Read & write blog articles and themes</li>
              <li>• Read analytics and customer data</li>
            </ul>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
            <span>Tokens are stored encrypted. Access can be revoked anytime from your Shopify Partners dashboard.</span>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleConnect}
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
              data-testid="button-shopify-oauth"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Authorize with Shopify
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
