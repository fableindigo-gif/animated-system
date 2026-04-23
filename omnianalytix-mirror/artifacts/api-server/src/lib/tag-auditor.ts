import { pushAlert, notifyTeams } from "./alert-store";
import { logger } from "./logger";
import { URL } from "url";
import dns from "dns/promises";
import net from "net";

export interface TagAuditResult {
  url: string;
  status: "vulnerable" | "secured" | "no_tags_found" | "error";
  details: TagDetail[];
  summary: string;
  signalLossEstimate?: string;
}

export interface TagDetail {
  tagType: "gtag" | "gtm" | "ga4" | "unknown";
  src: string;
  loadDomain: string;
  isFirstParty: boolean;
  risk: "high" | "low" | "none";
}

const THIRD_PARTY_DOMAINS = [
  "www.googletagmanager.com",
  "googletagmanager.com",
  "www.google-analytics.com",
  "google-analytics.com",
  "www.googleadservices.com",
  "googleadservices.com",
  "connect.facebook.net",
  "snap.licdn.com",
];

const TAG_PATH_PATTERNS: Array<{ pattern: RegExp; type: TagDetail["tagType"] }> = [
  { pattern: /\/gtag\/js/i, type: "gtag" },
  { pattern: /\/gtm\.js/i, type: "gtm" },
  { pattern: /\/analytics\.js/i, type: "ga4" },
  { pattern: /[?&]id=(G-|GT-|GTM-|UA-)/i, type: "gtag" },
];

function isPrivateIP(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 0) return true;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
  }
  return false;
}

async function isSafeUrl(urlStr: string): Promise<boolean> {
  try {
    const parsed = new URL(urlStr);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    const hostname = parsed.hostname;
    if (hostname === "localhost" || hostname === "metadata.google.internal") return false;
    if (net.isIP(hostname)) return !isPrivateIP(hostname);
    const addresses = await dns.resolve4(hostname).catch(() => []);
    for (const addr of addresses) {
      if (isPrivateIP(addr)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function classifyScriptSrc(src: string, pageHostname: string): TagDetail | null {
  let parsedSrc: URL;
  try {
    parsedSrc = new URL(src, `https://${pageHostname}`);
  } catch {
    return null;
  }

  const srcHostname = parsedSrc.hostname;
  const fullPath = parsedSrc.pathname + parsedSrc.search;

  let tagType: TagDetail["tagType"] | null = null;
  for (const { pattern, type } of TAG_PATH_PATTERNS) {
    if (pattern.test(fullPath)) {
      tagType = type;
      break;
    }
  }

  if (!tagType) {
    const isKnownTracker = THIRD_PARTY_DOMAINS.some(
      (d) => srcHostname === d || srcHostname.endsWith(`.${d}`),
    );
    if (isKnownTracker) {
      tagType = "unknown";
    } else {
      return null;
    }
  }

  const isThirdParty = THIRD_PARTY_DOMAINS.some(
    (d) => srcHostname === d || srcHostname.endsWith(`.${d}`),
  );

  return {
    tagType,
    src,
    loadDomain: srcHostname,
    isFirstParty: !isThirdParty,
    risk: isThirdParty ? "high" : "none",
  };
}

export async function auditTagInfrastructure(targetUrl: string): Promise<TagAuditResult> {
  let url = targetUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

  const safe = await isSafeUrl(url);
  if (!safe) {
    return {
      url,
      status: "error",
      details: [],
      summary: "URL rejected: only public HTTPS websites can be audited.",
    };
  }

  let pageHostname: string;
  try {
    pageHostname = new URL(url).hostname;
  } catch {
    return { url, status: "error", details: [], summary: "Invalid URL." };
  }

  let html: string;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; OmniAnalytix TagAuditor/1.0)",
      },
      redirect: "follow",
    });
    clearTimeout(timeout);
    if (!resp.ok) {
      return {
        url,
        status: "error",
        details: [],
        summary: `HTTP ${resp.status} — could not fetch the page.`,
      };
    }
    html = await resp.text();
  } catch (err) {
    return {
      url,
      status: "error",
      details: [],
      summary: `Network error: ${String(err)}`,
    };
  }

  const scriptSrcRegex = /<script[^>]+src=["']([^"']+)["'][^>]*>/gi;
  const details: TagDetail[] = [];
  let match: RegExpExecArray | null;

  while ((match = scriptSrcRegex.exec(html)) !== null) {
    const classified = classifyScriptSrc(match[1], pageHostname);
    if (classified) details.push(classified);
  }

  if (details.length === 0) {
    return {
      url,
      status: "no_tags_found",
      details: [],
      summary:
        "No Google Analytics, GTM, or ad-tracking script tags detected on this page. Tags may be loaded dynamically via a tag manager container or injected client-side.",
    };
  }

  const vulnerableCount = details.filter((d) => !d.isFirstParty).length;
  const securedCount = details.filter((d) => d.isFirstParty).length;

  if (vulnerableCount === 0) {
    return {
      url,
      status: "secured",
      details,
      summary: `All ${securedCount} tracking tag(s) load via first-party paths. Tag Gateway is properly configured — no signal leakage detected.`,
    };
  }

  const result: TagAuditResult = {
    url,
    status: "vulnerable",
    details,
    summary: `${vulnerableCount} of ${details.length} tag(s) load via third-party domains (${THIRD_PARTY_DOMAINS.filter((d) => details.some((t) => t.loadDomain === d)).join(", ")}). These are vulnerable to ITP, ETP, and ad-blocker interception.`,
    signalLossEstimate: "15-25%",
  };

  pushAlert({
    id: `tag-gateway-vulnerable-${Date.now()}`,
    severity: "critical",
    title: "\u26A0\uFE0F Conversion Signal Bleed Detected",
    detail: `Your Google Tags on ${url} are loading via third-party domains, exposing you to ITP and ad blockers. Potential ${result.signalLossEstimate} signal loss. ${vulnerableCount} vulnerable tag(s) found.`,
    platform: "Tag Infrastructure",
    action: "Setup Tag Gateway",
    ts: new Date().toISOString().substring(11, 16) + " UTC",
  });

  notifyTeams(
    "\u26A0\uFE0F Conversion Signal Bleed Detected",
    `${url}: ${vulnerableCount} tag(s) loading via third-party domains. Est. signal loss: ${result.signalLossEstimate}.`,
  ).catch(() => {});

  logger.warn({ url, vulnerableCount }, "tag-auditor: signal bleed detected");

  return result;
}
