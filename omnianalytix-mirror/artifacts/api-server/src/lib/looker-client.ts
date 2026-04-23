import { LookerNodeSDK, NodeSettings } from "@looker/sdk-node";
import type { Looker40SDK } from "@looker/sdk";
import type { IApiSection } from "@looker/sdk-rtl";

export interface LookerConfig {
  host: string;
  /**
   * Reserved: the embed secret is configured directly in the Looker admin UI
   * and identified server-side by `secret_id` when calling
   * `create_sso_embed_url`. Kept here so a single helper still surfaces every
   * Looker-related env var in one place.
   */
  embedSecret: string;
  apiClientId: string;
  apiClientSecret: string;
}

export function getLookerConfig(): LookerConfig {
  return {
    host:            process.env.LOOKER_HOST            || "https://your-instance.looker.com",
    embedSecret:     process.env.LOOKER_EMBED_SECRET    || "",
    apiClientId:     process.env.LOOKER_API_CLIENT_ID   || "",
    apiClientSecret: process.env.LOOKER_API_CLIENT_SECRET || "",
  };
}

export function isLookerApiConfigured(cfg: LookerConfig = getLookerConfig()): boolean {
  return Boolean(cfg.host && cfg.apiClientId && cfg.apiClientSecret);
}

class OmniLookerSettings extends NodeSettings {
  private readonly cfg: LookerConfig;
  constructor(cfg: LookerConfig) {
    super("LOOKERSDK");
    this.cfg = cfg;
    this.base_url   = cfg.host;
    this.verify_ssl = true;
  }
  override readConfig(_section?: string): IApiSection {
    return {
      base_url:      this.cfg.host,
      client_id:     this.cfg.apiClientId,
      client_secret: this.cfg.apiClientSecret,
      verify_ssl:    "true",
    };
  }
}

let sdkCache: { key: string; sdk: Looker40SDK } | null = null;

export function getLookerSDK(cfg: LookerConfig = getLookerConfig()): Looker40SDK | null {
  if (!isLookerApiConfigured(cfg)) return null;
  const key = `${cfg.host}|${cfg.apiClientId}|${cfg.apiClientSecret}`;
  if (sdkCache && sdkCache.key === key) return sdkCache.sdk;
  const sdk = LookerNodeSDK.init40(new OmniLookerSettings(cfg));
  sdkCache = { key, sdk };
  return sdk;
}
