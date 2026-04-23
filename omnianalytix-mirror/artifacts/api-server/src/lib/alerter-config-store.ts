/**
 * alerter-config-store.ts
 *
 * Reads and writes Shopping Insider Cost Alerter configuration from the
 * `app_settings` table so the values take effect immediately without a
 * server restart.
 *
 * Key names mirror the original environment variable names (lower-cased):
 *   shopping_insider_alert_bytes_threshold
 *   shopping_insider_alert_hitrate_floor
 *   shopping_insider_alert_cooldown_ms
 *
 * Env vars remain the authoritative source of truth when no DB record is
 * present, keeping existing deployments unaffected.
 */

import { db, appSettings } from "@workspace/db";
import { inArray } from "drizzle-orm";
import type { AlerterConfig } from "./shopping-insider-cost-alerter";
import { logger } from "./logger";

const BYTES_KEY = "shopping_insider_alert_bytes_threshold";
const HITRATE_KEY = "shopping_insider_alert_hitrate_floor";
const COOLDOWN_KEY = "shopping_insider_alert_cooldown_ms";

const ALL_KEYS = [BYTES_KEY, HITRATE_KEY, COOLDOWN_KEY] as const;
type ConfigKey = (typeof ALL_KEYS)[number];

function readEnvNumber(name: string): number | null {
  const raw = process.env[name];
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parseNumber(val: string): number | null {
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

export interface AlerterConfigOverrides {
  bytesThreshold: number | null;
  hitRateFloor: number | null;
  cooldownMs: number | null;
}

/**
 * Load raw DB override values only — no env-var fallback.
 * Returns null for each key that has no DB row.
 * Use this when you need to distinguish "DB has a value" from "env default".
 */
export async function loadRawDbOverrides(): Promise<AlerterConfigOverrides> {
  let rows: { key: string; value: string }[] = [];
  try {
    rows = await db
      .select({ key: appSettings.key, value: appSettings.value })
      .from(appSettings)
      .where(inArray(appSettings.key, [...ALL_KEYS]));
  } catch (err) {
    logger.warn({ err }, "[AlerterConfigStore] DB read failed — raw overrides unavailable");
  }

  const map = new Map(rows.map((r) => [r.key as ConfigKey, r.value]));

  return {
    bytesThreshold: map.has(BYTES_KEY) ? parseNumber(map.get(BYTES_KEY)!) : null,
    hitRateFloor: map.has(HITRATE_KEY) ? parseNumber(map.get(HITRATE_KEY)!) : null,
    cooldownMs: map.has(COOLDOWN_KEY) ? parseNumber(map.get(COOLDOWN_KEY)!) : null,
  };
}

/**
 * Load the three user-configurable thresholds from the database, with
 * env-var fallback when no DB row exists.
 *
 * NOTE: a null result means neither DB nor env has a value for that threshold.
 * Use `loadRawDbOverrides` when you need to distinguish DB vs env origin.
 */
export async function loadAlerterConfigOverrides(): Promise<AlerterConfigOverrides> {
  let rows: { key: string; value: string }[] = [];
  let dbError = false;
  try {
    rows = await db
      .select({ key: appSettings.key, value: appSettings.value })
      .from(appSettings)
      .where(inArray(appSettings.key, [...ALL_KEYS]));
  } catch (err) {
    dbError = true;
    logger.warn({ err }, "[AlerterConfigStore] DB read failed — falling back to env/default config");
  }

  const map = new Map(rows.map((r) => [r.key as ConfigKey, r.value]));

  function resolve(key: ConfigKey, envVar: string): number | null {
    if (!dbError && map.has(key)) {
      return parseNumber(map.get(key)!);
    }
    return readEnvNumber(envVar);
  }

  return {
    bytesThreshold: resolve(BYTES_KEY, "SHOPPING_INSIDER_ALERT_BYTES_THRESHOLD"),
    hitRateFloor: resolve(HITRATE_KEY, "SHOPPING_INSIDER_ALERT_HITRATE_FLOOR"),
    cooldownMs: resolve(COOLDOWN_KEY, "SHOPPING_INSIDER_ALERT_COOLDOWN_MS"),
  };
}

/**
 * Persist one or more threshold overrides to the database.
 * Pass `null` to delete a stored override (env var fallback takes over).
 */
export async function saveAlerterConfigOverrides(
  overrides: Partial<AlerterConfigOverrides>,
): Promise<void> {
  const ops: Promise<unknown>[] = [];

  const pairs: [ConfigKey, number | null | undefined][] = [
    [BYTES_KEY, overrides.bytesThreshold],
    [HITRATE_KEY, overrides.hitRateFloor],
    [COOLDOWN_KEY, overrides.cooldownMs],
  ];

  for (const [key, val] of pairs) {
    if (val === undefined) continue;
    if (val === null) {
      ops.push(
        db.delete(appSettings).where(
          inArray(appSettings.key, [key]),
        ),
      );
    } else {
      ops.push(
        db
          .insert(appSettings)
          .values({ key, value: String(val) })
          .onConflictDoUpdate({
            target: appSettings.key,
            set: { value: String(val), updatedAt: new Date() },
          }),
      );
    }
  }

  await Promise.all(ops);
}

/**
 * Merge DB overrides into a base AlerterConfig produced by `loadAlerterConfig`.
 */
export function applyOverrides(
  base: AlerterConfig,
  overrides: AlerterConfigOverrides,
): AlerterConfig {
  return {
    ...base,
    bytesThreshold: overrides.bytesThreshold ?? base.bytesThreshold,
    hitRateFloor: overrides.hitRateFloor ?? base.hitRateFloor,
    cooldownMs: overrides.cooldownMs ?? base.cooldownMs,
  };
}
