import type { ReactNode } from "react";
import { Link } from "wouter";
import { ArrowLeft, Shield } from "lucide-react";

export default function PrivacyPolicy() {
  const lastUpdated = "April 5, 2026";

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border bg-card px-6 py-4 flex items-center gap-4 sticky top-0 z-10">
        <Link href="/">
          <button className="p-2 -ml-2 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
        </Link>
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-primary shrink-0" />
          <div>
            <h1 className="text-lg font-bold tracking-tight text-foreground">Privacy Policy</h1>
            <p className="text-xs font-mono text-muted-foreground">OmniAnalytix · Last updated {lastUpdated}</p>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-6 py-10 space-y-10">

        <section className="space-y-3">
          <p className="text-sm text-muted-foreground leading-relaxed">
            OmniAnalytix ("we", "our", or "us") is an AI-powered e-commerce intelligence platform. This Privacy Policy explains how we collect, use, store, and protect information when you use our application. By using OmniAnalytix, you agree to the practices described in this policy.
          </p>
        </section>

        <Section title="1. Information We Collect">
          <p>We collect only the information necessary to provide our services:</p>
          <ul>
            <li><strong>Platform credentials:</strong> OAuth access tokens and refresh tokens for connected platforms (Google Ads, Google Merchant Center, Google Search Console, Meta Ads, Shopify). These are stored encrypted in our database.</li>
            <li><strong>Account identifiers:</strong> Platform-specific IDs such as your Google Ads Customer ID, Shopify store URL, or Meta Ad Account ID, which you provide when connecting a platform.</li>
            <li><strong>Conversation data:</strong> The questions and commands you submit to the AI agent, along with the agent's responses, are stored to maintain session history and continuity.</li>
            <li><strong>Platform performance data:</strong> Advertising metrics, product catalog data, and other e-commerce data fetched from your connected platforms on your behalf.</li>
          </ul>
        </Section>

        <Section title="2. How We Use Your Information">
          <ul>
            <li>To connect to your advertising and e-commerce platforms on your behalf and fetch data relevant to your queries.</li>
            <li>To generate AI-powered analysis, recommendations, reports (PDF/PPTX), and ad copy using the data from your connected platforms.</li>
            <li>To maintain your conversation history so you can review past sessions.</li>
            <li>To detect issues, improve reliability, and debug errors in the application.</li>
          </ul>
          <p className="mt-3">We do <strong>not</strong> sell, rent, or share your data with third parties for advertising or marketing purposes.</p>
        </Section>

        <Section title="3. Third-Party Services">
          <p>OmniAnalytix integrates with the following third-party services to deliver its functionality. Your use of OmniAnalytix is subject to the privacy policies of these services:</p>
          <ul>
            <li><strong>Google (Ads, Merchant Center, Search Console, Analytics):</strong> <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Google Privacy Policy</a></li>
            <li><strong>Meta (Facebook Ads):</strong> <a href="https://www.facebook.com/privacy/policy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Meta Privacy Policy</a></li>
            <li><strong>Shopify:</strong> <a href="https://www.shopify.com/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Shopify Privacy Policy</a></li>
            <li><strong>Google Gemini / Vertex AI (AI model provider):</strong> <a href="https://cloud.google.com/terms/cloud-privacy-notice" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Google Cloud Privacy Notice</a></li>
          </ul>
          <p className="mt-3">When you connect a platform, you authorize OmniAnalytix to access that platform's API on your behalf using OAuth 2.0. You can revoke this access at any time from within each platform's account settings.</p>
        </Section>

        <Section title="4. Data Storage and Security">
          <ul>
            <li>All data is stored in a secure PostgreSQL database.</li>
            <li>OAuth tokens are stored encrypted and are only used to make API calls on your behalf.</li>
            <li>All data in transit is encrypted using TLS/HTTPS.</li>
            <li>We do not store raw passwords. Authentication to connected platforms is handled entirely through OAuth 2.0.</li>
            <li>Platform data fetched by the agent is used transiently to generate responses and is not permanently cached beyond what is necessary for session continuity.</li>
          </ul>
        </Section>

        <Section title="5. Data Retention">
          <ul>
            <li><strong>Conversation history:</strong> Retained until you delete it or close your account.</li>
            <li><strong>Platform credentials (OAuth tokens):</strong> Retained until you disconnect the platform from within OmniAnalytix, or until the token is revoked at the source platform.</li>
            <li>You can request deletion of your data at any time by contacting us (see Section 8).</li>
          </ul>
        </Section>

        <Section title="6. Cookies and Local Storage">
          <p>OmniAnalytix uses minimal browser storage:</p>
          <ul>
            <li>Session state may be stored in browser memory while the application is open.</li>
            <li>We do not use tracking cookies or third-party analytics cookies.</li>
          </ul>
        </Section>

        <Section title="7. Your Rights">
          <p>Depending on your location, you may have rights including:</p>
          <ul>
            <li><strong>Access:</strong> Request a copy of the data we hold about you.</li>
            <li><strong>Deletion:</strong> Request that we delete your account data and OAuth tokens.</li>
            <li><strong>Portability:</strong> Request your conversation history in a machine-readable format.</li>
            <li><strong>Revocation:</strong> Disconnect any platform at any time from the Connections page — this immediately removes the stored credentials for that platform.</li>
          </ul>
        </Section>

        <Section title="8. Contact">
          <p>If you have any questions, requests, or concerns about this Privacy Policy or your data, please contact us via the application. We will respond within a reasonable timeframe.</p>
          <p className="mt-2">
            This policy is published at:{" "}
            <a href="https://omnianalytix.in/privacy-policy" target="_blank" rel="noopener noreferrer">
              https://omnianalytix.in/privacy-policy
            </a>
          </p>
        </Section>

        <Section title="9. Changes to This Policy">
          <p>We may update this Privacy Policy from time to time. When we do, we will update the "Last updated" date at the top of this page. Continued use of OmniAnalytix after changes constitutes acceptance of the updated policy.</p>
        </Section>

        <div className="pt-6 border-t border-border/50">
          <p className="text-xs text-muted-foreground font-mono">
            © {new Date().getFullYear()} OmniAnalytix. All rights reserved.
          </p>
        </div>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-bold text-foreground">{title}</h2>
      <div className="text-sm text-muted-foreground leading-relaxed space-y-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_strong]:text-foreground [&_a]:text-primary [&_a:hover]:underline">
        {children}
      </div>
    </section>
  );
}
