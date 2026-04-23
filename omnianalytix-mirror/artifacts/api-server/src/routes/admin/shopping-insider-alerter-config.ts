/**
 * GET  /api/admin/shopping-insider-alerter-config
 * PUT  /api/admin/shopping-insider-alerter-config
 *
 * Lets platform admins read and update the Shopping Insider Cost Alerter
 * thresholds at runtime without touching environment variables or redeploying.
 *
 * Auth: mounted under /admin (requires `admin` role) but these routes write
 * platform-wide configuration that applies across ALL tenants, so they are
 * additionally restricted to `super_admin` at the handler level.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod/v4";
import {
  loadAlerterConfigOverrides,
  loadRawDbOverrides,
  saveAlerterConfigOverrides,
} from "../../lib/alerter-config-store";
import { loadAlerterConfig } from "../../lib/shopping-insider-cost-alerter";
import { logger } from "../../lib/logger";

const router = Router();

const SUPER_ADMIN_ROLE = "super_admin";

function requireSuperAdminInline(req: Request, res: Response, next: NextFunction): void {
  const role =
    (req.jwtPayload as { role?: string } | undefined)?.role ??
    (req.rbacUser as { role?: string } | undefined)?.role;
  if (role !== SUPER_ADMIN_ROLE) {
    res.status(403).json({
      error: "Forbidden",
      message: "This endpoint is restricted to platform super-admins.",
      code: "SUPER_ADMIN_REQUIRED",
    });
    return;
  }
  next();
}

router.use(requireSuperAdminInline);

const PutBody = z.object({
  bytesThreshold: z.union([z.number().positive(), z.null()]).optional(),
  hitRateFloor: z.union([z.number().min(0).max(1), z.null()]).optional(),
  cooldownMs: z.union([z.number().positive(), z.null()]).optional(),
});

router.get("/", async (_req, res, next) => {
  try {
    const baseConfig = loadAlerterConfig();
    const [effectiveOverrides, rawDbOverrides] = await Promise.all([
      loadAlerterConfigOverrides(),
      loadRawDbOverrides(),
    ]);

    res.json({
      ok: true,
      config: {
        bytesThreshold: effectiveOverrides.bytesThreshold ?? baseConfig.bytesThreshold,
        hitRateFloor: effectiveOverrides.hitRateFloor ?? baseConfig.hitRateFloor,
        cooldownMs: effectiveOverrides.cooldownMs ?? baseConfig.cooldownMs,
      },
      envDefaults: {
        bytesThreshold: baseConfig.bytesThreshold,
        hitRateFloor: baseConfig.hitRateFloor,
        cooldownMs: baseConfig.cooldownMs,
      },
      dbOverrides: rawDbOverrides,
    });
  } catch (err) {
    next(err);
  }
});

router.put("/", async (req, res, next) => {
  try {
    const parsed = PutBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
      return;
    }

    await saveAlerterConfigOverrides(parsed.data);

    const [effectiveOverrides, rawDbOverrides, baseConfig] = await Promise.all([
      loadAlerterConfigOverrides(),
      loadRawDbOverrides(),
      Promise.resolve(loadAlerterConfig()),
    ]);

    logger.info(
      { rawDbOverrides, actor: (req as { rbacUser?: { email?: string } }).rbacUser?.email },
      "[AdminAlerterConfig] thresholds updated",
    );

    res.json({
      ok: true,
      config: {
        bytesThreshold: effectiveOverrides.bytesThreshold ?? baseConfig.bytesThreshold,
        hitRateFloor: effectiveOverrides.hitRateFloor ?? baseConfig.hitRateFloor,
        cooldownMs: effectiveOverrides.cooldownMs ?? baseConfig.cooldownMs,
      },
      dbOverrides: rawDbOverrides,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
