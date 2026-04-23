/**
 * Vertex AI client (native @google/genai)
 * ────────────────────────────────────────
 * The legacy `@google-cloud/vertexai` SDK was deprecated 2025-06-24 and is
 * scheduled for removal on 2026-06-24. This module is the single chokepoint
 * through which every Gemini-on-Vertex call in the api-server flows. It
 * builds (and caches) an authenticated `GoogleGenAI` client; call sites use
 * the native shape directly:
 *   const ai = await getGoogleGenAI();
 *   const r  = await ai.models.generateContent({ model, contents, config });
 *   r.candidates?.[0]?.content?.parts ...
 *
 * Tracked in PHASE_0_FINDINGS.md COR-03; replit.md "External Dependencies"
 * notes the new client lives here.
 */

import {
  GoogleGenAI,
  type Content,
  type GenerateContentResponse,
  type Tool,
  type FunctionDeclaration,
  type Schema,
  type GenerateContentConfig,
} from "@google/genai";
import {
  GoogleAuth,
  type BaseExternalAccountClient,
  type Compute,
  type JWT,
  type UserRefreshClient,
} from "google-auth-library";

// Re-export the types call sites used to pull from `@google-cloud/vertexai`,
// sourced from the new SDK. Also re-export `GoogleGenAI` so callers can type
// parameters without importing `@google/genai` themselves.
export type {
  Content,
  Tool,
  FunctionDeclaration,
  Schema,
  GenerateContentResponse,
  GenerateContentConfig,
  GoogleGenAI,
};

const project  = process.env.GOOGLE_CLOUD_PROJECT;
const location = process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1";

if (!project) {
  throw new Error("GOOGLE_CLOUD_PROJECT environment variable is required for Vertex AI");
}

const serviceAccountJson = process.env.VERTEX_AI_SERVICE_ACCOUNT_JSON;

let credentials: Record<string, unknown> | undefined;
if (serviceAccountJson) {
  try {
    credentials = JSON.parse(serviceAccountJson);
  } catch {
    throw new Error("VERTEX_AI_SERVICE_ACCOUNT_JSON is not valid JSON");
  }
}

const googleAuth = new GoogleAuth({
  ...(credentials ? { credentials } : {}),
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

type AuthClient = Compute | JWT | UserRefreshClient | BaseExternalAccountClient;

let _authClient: AuthClient | null = null;
async function getAuthClient(): Promise<AuthClient> {
  if (!_authClient) {
    _authClient = (await googleAuth.getClient()) as AuthClient;
  }
  return _authClient;
}

let _client: GoogleGenAI | null = null;
export async function getGoogleGenAI(): Promise<GoogleGenAI> {
  if (!_client) {
    const authClient = await getAuthClient();
    _client = new GoogleGenAI({
      vertexai: true,
      project,
      location,
      googleAuthOptions: { authClient: authClient as unknown as never },
    });
  }
  return _client;
}

export const VERTEX_MODEL = "gemini-2.5-pro";
