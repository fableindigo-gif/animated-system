import { useState } from "react";
import { ChevronDown, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CredentialHelpStep {
  text: string;
}

interface CredentialHelpProps {
  platformLabel: string;
  steps: CredentialHelpStep[];
  docsUrl?: string;
  className?: string;
}

const HELP_RECIPES: Record<string, { steps: CredentialHelpStep[]; docsUrl?: string }> = {
  woocommerce: {
    steps: [
      { text: "Open your WordPress admin and go to WooCommerce → Settings → Advanced → REST API." },
      { text: "Click \"Add key\". Give it a description like \"OmniAnalytix\" and set Permissions to Read." },
      { text: "Click \"Generate API key\". Copy the Consumer key (starts with ck_) and Consumer secret (starts with cs_) — they're shown only once." },
      { text: "Paste both above, plus your store URL (e.g. https://yourstore.com)." },
    ],
    docsUrl: "https://woocommerce.com/document/woocommerce-rest-api/",
  },
  hubspot: {
    steps: [
      { text: "In HubSpot, go to Settings (gear icon) → Integrations → Private Apps." },
      { text: "Click \"Create a private app\", name it \"OmniAnalytix\", and add the read scopes for Contacts, Deals, and Companies." },
      { text: "Open the Auth tab and copy the Access token (starts with pat-)." },
      { text: "Paste it above. We'll never store this in plain text." },
    ],
    docsUrl: "https://developers.hubspot.com/docs/api/private-apps",
  },
  salesforce: {
    steps: [
      { text: "In Salesforce, open Setup → App Manager → New Connected App." },
      { text: "Enable OAuth, add the scope \"Access and manage your data (api)\", and save. Copy the Consumer Key and Consumer Secret from the API section." },
      { text: "Generate a Security Token from your personal Settings → Reset Security Token if you don't have one." },
      { text: "Paste your username, password+token, key and secret above." },
    ],
    docsUrl: "https://help.salesforce.com/s/articleView?id=sf.connected_app_create.htm",
  },
  klaviyo: {
    steps: [
      { text: "In Klaviyo, click the account name (bottom-left) → Settings → API Keys." },
      { text: "Create a Private API Key with read scopes for Lists, Segments, Profiles and Metrics." },
      { text: "Copy the key (starts with pk_) and paste it above." },
    ],
    docsUrl: "https://help.klaviyo.com/hc/en-us/articles/115005062267",
  },
  stripe: {
    steps: [
      { text: "In Stripe, open Developers → API keys." },
      { text: "Click \"Create restricted key\". Grant Read access to Charges, Customers, Subscriptions, and PaymentIntents." },
      { text: "Reveal and copy the key (starts with rk_live_ or rk_test_) and paste it above." },
    ],
    docsUrl: "https://stripe.com/docs/keys",
  },
  zoho: {
    steps: [
      { text: "Use the OAuth Connect button instead — Zoho's API requires the OAuth handshake we provide." },
      { text: "If you must enter a token manually, generate it from Zoho API Console → Self Client." },
    ],
    docsUrl: "https://www.zoho.com/crm/developer/docs/api/v6/auth-request.html",
  },
};

export function getHelpRecipe(platform: string): { steps: CredentialHelpStep[]; docsUrl?: string } | null {
  return HELP_RECIPES[platform] ?? null;
}

export function CredentialHelp({ platformLabel, steps, docsUrl, className }: CredentialHelpProps) {
  const [open, setOpen] = useState(false);
  const panelId = `credential-help-${platformLabel.replace(/\s+/g, "-").toLowerCase()}`;

  if (!steps?.length) return null;

  return (
    <div className={cn("rounded-2xl border border-outline-variant/15 bg-surface/60", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-left"
      >
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-on-surface uppercase tracking-wider">
          <HelpCircle className="w-3.5 h-3.5 text-on-surface-variant" aria-hidden="true" />
          How do I find these credentials?
        </span>
        <ChevronDown
          className={cn("w-3.5 h-3.5 text-on-surface-variant transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div id={panelId} className="px-4 pb-3 pt-1 border-t border-outline-variant/10">
          <ol className="list-decimal pl-4 space-y-1.5 text-[12px] text-on-surface-variant leading-relaxed">
            {steps.map((s, i) => (
              <li key={i}>{s.text}</li>
            ))}
          </ol>
          {docsUrl && (
            <a
              href={docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2.5 inline-flex items-center gap-1 text-[11px] font-semibold text-primary-container hover:underline"
            >
              Open the {platformLabel} docs ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}
