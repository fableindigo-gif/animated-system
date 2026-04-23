export type Goal = "ecom" | "leadgen" | "hybrid";

export interface StackPlatform {
  id: string;
  label: string;
  shortLabel?: string;
  goals: Goal[];
  color: string;
  bgColor: string;
}

export const STACK_PLATFORMS: StackPlatform[] = [
  { id: "shopify",       label: "Shopify",                goals: ["ecom", "hybrid"],              color: "text-emerald-600", bgColor: "bg-emerald-50" },
  { id: "woocommerce",   label: "WooCommerce",            goals: ["ecom", "hybrid"],              color: "text-purple-600",  bgColor: "bg-purple-50" },
  { id: "google_ads",    label: "Google Ads",             goals: ["ecom", "leadgen", "hybrid"],   color: "text-blue-600",    bgColor: "bg-blue-50" },
  { id: "meta",          label: "Meta Ads",               goals: ["ecom", "leadgen", "hybrid"],   color: "text-[#0081FB]",   bgColor: "bg-blue-50" },
  { id: "gmc",           label: "Google Merchant Center", shortLabel: "GMC", goals: ["ecom", "hybrid"],              color: "text-orange-600",  bgColor: "bg-orange-50" },
  { id: "ga4",           label: "Google Analytics 4",     shortLabel: "GA4", goals: ["ecom", "hybrid"],              color: "text-amber-600",   bgColor: "bg-amber-50" },
  { id: "gsc",           label: "Google Search Console",  shortLabel: "GSC", goals: ["leadgen", "hybrid"],           color: "text-blue-500",    bgColor: "bg-sky-50" },
  { id: "bing_ads",      label: "Bing Ads",               goals: ["leadgen", "hybrid"],            color: "text-teal-600",    bgColor: "bg-teal-50" },
  { id: "salesforce",    label: "Salesforce",             goals: ["leadgen", "hybrid"],            color: "text-sky-600",     bgColor: "bg-sky-50" },
  { id: "hubspot",       label: "HubSpot",                goals: ["leadgen", "hybrid"],            color: "text-orange-500",  bgColor: "bg-orange-50" },
  { id: "zoho",          label: "Zoho CRM",               shortLabel: "Zoho", goals: ["leadgen", "hybrid"],           color: "text-red-600",     bgColor: "bg-red-50" },
];

export function getPlatformsForGoal(goal: Goal): StackPlatform[] {
  return STACK_PLATFORMS.filter((p) => p.goals.includes(goal));
}

export const ECOM_STACK = STACK_PLATFORMS.filter((p) => p.goals.includes("ecom"));
export const LEADGEN_STACK = STACK_PLATFORMS.filter((p) => p.goals.includes("leadgen"));
export const HYBRID_STACK = [...STACK_PLATFORMS];
