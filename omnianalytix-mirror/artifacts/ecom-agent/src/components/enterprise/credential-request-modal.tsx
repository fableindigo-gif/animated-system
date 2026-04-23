import { useState } from "react";
import { cn } from "@/lib/utils";
import { Mail, Copy, Check, ShieldCheck, Link2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const DEFAULT_FIELDS: Record<string, Array<{ key: string; label: string; placeholder: string }>> = {
  WooCommerce: [
    { key: "storeUrl", label: "Store URL", placeholder: "https://yourstore.com" },
    { key: "consumerKey", label: "Consumer Key", placeholder: "ck_..." },
    { key: "consumerSecret", label: "Consumer Secret", placeholder: "cs_..." },
  ],
  "CRM / Pipeline": [
    { key: "apiKey", label: "API Key / Access Token", placeholder: "Bearer token or API key" },
    { key: "instanceUrl", label: "Instance URL", placeholder: "https://app.hubspot.com/..." },
  ],
};

const DEFAULT_GENERIC = [
  { key: "apiKey", label: "API Key / Access Token", placeholder: "Enter credentials" },
  { key: "endpoint", label: "API Endpoint URL", placeholder: "https://..." },
];

interface CredentialRequestModalProps {
  open: boolean;
  onClose: () => void;
  platform: string;
  platformLabel?: string;
  requiredFields?: Array<{ key: string; label: string; placeholder: string }>;
}

export function CredentialRequestModal({ open, onClose, platform, platformLabel, requiredFields }: CredentialRequestModalProps) {
  const label = platformLabel || platform;
  const fields = requiredFields || DEFAULT_FIELDS[platform] || DEFAULT_GENERIC;
  const [recipientEmail, setRecipientEmail] = useState("");
  const [senderNote, setSenderNote] = useState("");
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<"email" | "link">("email");

  const secureToken = `cred-req-${platform}-${Date.now().toString(36)}`;

  const emailSubject = encodeURIComponent(`OmniAnalytix: ${label} API Credentials Needed`);
  const emailBody = encodeURIComponent(
    `Hi,\n\n` +
    `Our agency needs ${label} API credentials to set up performance tracking in OmniAnalytix.\n\n` +
    `Required credentials:\n${fields.map((f) => `• ${f.label}`).join("\n")}\n\n` +
    `${senderNote ? `Note from the team:\n${senderNote}\n\n` : ""}` +
    `For security, please enter credentials directly using this secure link:\n` +
    `${window.location.origin}${import.meta.env.BASE_URL}connections?cred_token=${secureToken}&platform=${platform}\n\n` +
    `This link is scoped to ${label} only — we will never see the raw credentials.\n\n` +
    `Thank you,\nOmniAnalytix Team`
  );

  const secureLink = `${window.location.origin}${import.meta.env.BASE_URL}connections?cred_token=${secureToken}&platform=${platform}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(secureLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* silent */ }
  };

  const handleSendEmail = () => {
    window.open(`mailto:${recipientEmail}?subject=${emailSubject}&body=${emailBody}`, "_blank");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md p-0 gap-0">
        <DialogHeader className="p-6 pb-0 space-y-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-purple-50 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-purple-600" />
            </div>
            <div className="text-left">
              <DialogTitle className="font-bold text-base text-on-surface">Request IT Setup</DialogTitle>
              <DialogDescription className="text-[10px] text-on-surface-variant mt-0.5">{label} Credentials</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="p-6 space-y-5">
          <div className="bg-emerald-50/50 rounded-2xl p-3 border border-emerald-100">
            <div className="flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <p className="text-[11px] text-emerald-700 leading-relaxed">
                Your IT team will enter credentials directly into a secure sandboxed form. Raw API keys are never visible to the marketing team.
              </p>
            </div>
          </div>

          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-2">Required Credentials</p>
            <div className="space-y-1">
              {fields.map((f) => (
                <div key={f.key} className="flex items-center gap-2 text-xs text-on-surface-variant">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#c8c5cb]" />
                  {f.label}
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 bg-surface-container-low rounded-2xl p-1">
            <button
              onClick={() => setMode("email")}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-2xl text-xs font-semibold transition-all",
                mode === "email" ? "bg-white text-on-surface shadow-sm" : "text-on-surface-variant hover:text-on-surface-variant",
              )}
            >
              <Mail className="w-3.5 h-3.5" /> Send Email
            </button>
            <button
              onClick={() => setMode("link")}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-2xl text-xs font-semibold transition-all",
                mode === "link" ? "bg-white text-on-surface shadow-sm" : "text-on-surface-variant hover:text-on-surface-variant",
              )}
            >
              <Link2 className="w-3.5 h-3.5" /> Copy Link
            </button>
          </div>

          {mode === "email" ? (
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5 block">
                  IT Team Email
                </label>
                <input
                  type="email"
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  placeholder="it-admin@client.com"
                  className="w-full px-3 py-2.5 rounded-2xl border border-outline-variant/15 text-sm bg-white placeholder:text-on-surface-variant outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5 block">
                  Additional Note (Optional)
                </label>
                <textarea
                  value={senderNote}
                  onChange={(e) => setSenderNote(e.target.value)}
                  placeholder="e.g. We need read-only access for reporting only..."
                  rows={2}
                  className="w-full px-3 py-2.5 rounded-2xl border border-outline-variant/15 text-sm bg-white placeholder:text-on-surface-variant outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all resize-none"
                />
              </div>
            </div>
          ) : (
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5 block">
                Secure Setup Link
              </label>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={secureLink}
                  className="flex-1 px-3 py-2.5 rounded-2xl border border-outline-variant/15 text-xs bg-surface text-on-surface-variant outline-none font-mono truncate"
                />
                <Button
                  onClick={handleCopy}
                  size="sm"
                  variant={copied ? "outline" : "default"}
                  className={cn(
                    "shrink-0 min-h-[40px]",
                    copied && "border-emerald-200 text-emerald-600 bg-emerald-50 hover:bg-emerald-50",
                  )}
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 p-6 pt-0">
          <Button
            onClick={onClose}
            variant="outline"
            className="flex-1"
          >
            Cancel
          </Button>
          {mode === "email" && (
            <Button
              onClick={handleSendEmail}
              disabled={!recipientEmail}
              className="flex-1"
            >
              <Mail className="w-3.5 h-3.5" />
              Open Mail Client
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
