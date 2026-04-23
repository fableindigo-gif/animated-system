/**
 * Shared data contracts — single source of truth for every type that crosses
 * the network boundary.  These interfaces 1-to-1 mirror the PostgreSQL schema
 * (lib/db/src/schema/*) and the Vertex AI / Gemini output shapes returned by
 * the API server.  Import from here instead of re-defining ad-hoc types in
 * individual components.
 */

// ─── Role taxonomy ─────────────────────────────────────────────────────────────

export const ROLES = ["viewer", "analyst", "it", "manager", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const ADMIN_ROLES: Role[] = ["admin"];
export const CAN_APPROVE_ROLES: Role[] = ["admin", "manager"];

// ─── Workspace (mirrors workspaces table) ──────────────────────────────────────

export interface Workspace {
  id: number;
  organizationId: number;
  clientName: string;
  slug: string;
  primaryGoal: string | null;
  enabledIntegrations: string[];
  selectedWorkflows: string[] | null;
  inviteToken: string;
  status: string;
  notes: string | null;
  webhookUrl: string | null;
  websiteUrl: string | null;
  discoverySource: string | null;
  headquartersCountry: string | null;
  billingThreshold: number | null;
  createdAt: string;
  /** Computed by the API server — not stored in DB */
  criticalAlertCount: number;
}

// ─── Team member (mirrors team_members table) ──────────────────────────────────

export interface TeamMember {
  id: number;
  organizationId: number | null;
  workspaceId: number | null;
  name: string;
  email: string;
  role: Role;
  inviteCode: string;
  isActive: boolean;
  createdAt: string;
}

// ─── Campaign (matches /api/warehouse/campaigns response shape) ────────────────

export interface Campaign {
  campaignId: string;
  campaignName: string;
  costUsd: number;
  clicks: number;
  impressions: number;
  conversions: number;
  status: string;
  budgetUsd?: number;
}

// ─── LiveChannel (matches /api/warehouse/channels response shape) ──────────────

export interface LiveChannel {
  campaignId: string;
  campaignName: string;
  spend: number;
  conversions: number;
  clicks: number;
  impressions: number;
  ctr: number;
  roas: number;
  cpa: number | null;
  // revenue: actual conversion value reported by Google Ads.
  revenue: number | null;
  status: string;
}

// ─── Warehouse KPIs (matches /api/warehouse/kpis response shape) ───────────────

export interface WarehouseKpis {
  hasData: boolean;
  totalSpend: number;
  estimatedRevenue: number;
  /** Actual Google Ads reported conversion value (purchase revenue). Source of truth for revenue. */
  totalConversionValue?: number;
  activeProducts: number;
  totalProducts?: number;
  totalConversions: number;
  trueProfit?: number;
  processingFees?: number;
  poas: number;
  roas: number;
  inventoryValue: number;
  campaignCount: number;
  mappingCount?: number;
  /** ISO-4217 currency code of the Google Ads account (e.g. "INR", "USD"). */
  accountCurrency?: string;
  /** Revenue methodology used: "google_ads_conversion_value" | "avg_price_estimate" */
  revenueMethod?: string;
  etlStatus: string;
  etlPhase?: string;
  etlPct?: number;
  lastSyncedAt: number | null;
  totalClicks?: number;
  inventoryLastSyncAt?: string | null;
  inventoryFreshnessHours?: number | null;
  inventoryDataStale?: boolean;
}

// ─── Margin leak (matches /api/warehouse/margin-leaks response shape) ──────────

export interface MarginLeak {
  campaignName: string | null;
  campaignId: string;
  productTitle: string | null;
  sku: string | null;
  inventoryQty: number | null;
  wastedSpend: number;
  impressions: number;
}

// ─── Gemini / Vertex AI message (mirrors gemini_messages table + API output) ───

export interface GeminiMessage {
  id: number;
  conversationId: number;
  role: "user" | "model";
  content: string;
  createdAt: string;
}

export interface GeminiConversation {
  id: number;
  title: string;
  createdAt: string;
  messages: GeminiMessage[];
}

/** Structured action payload emitted by Gemini inside a message */
export interface GeminiActionPayload {
  type: string;
  title?: string;
  summary?: string;
  data?: Record<string, unknown>;
}

// ─── Standardized API error shapes ────────────────────────────────────────────

/**
 * The shape the API server returns for validation errors (400).
 * Backend must return: { errors: { field: string; message: string }[] }
 * or { error: string } for generic failures.
 */
export interface ApiValidationError {
  field: string;
  message: string;
}

export interface ApiErrorBody {
  error?: string;
  message?: string;
  code?: string;
  errors?: ApiValidationError[];
}

/**
 * Parsed field-level errors ready for form components to consume.
 * Keys are field names (e.g. "email"), values are the human-readable message.
 */
export type FieldErrors = Record<string, string>;
