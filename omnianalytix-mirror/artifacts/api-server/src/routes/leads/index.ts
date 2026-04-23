import { Router } from "express";
import { z } from "zod";
import { db, leads } from "@workspace/db";
import { logger } from "../../lib/logger";

const router = Router();

const leadSchema = z.object({
  email: z.string().email(),
  website: z.string().min(1),
  revenueModel: z.enum(["ecom", "leadgen", "hybrid"]),
  attribution: z.string().min(1),
  scheduledDate: z.string().min(1),
  scheduledTime: z.string().min(1),
});

const enterpriseContactSchema = z.object({
  source: z.literal("enterprise"),
  name: z.string().min(1),
  email: z.string().email(),
  company: z.string().optional(),
  employees: z.string().optional(),
  message: z.string().optional(),
});

router.post("/", async (req, res) => {
  if (req.body?.source === "enterprise") {
    const parsed = enterpriseContactSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid contact data", details: parsed.error.flatten() });
    }
    const { name, email, company, employees, message } = parsed.data;
    try {
      await db.insert(leads).values({
        source: "enterprise",
        email,
        name,
        company: company ?? null,
        employees: employees ?? null,
        message: message ?? null,
        status: "new",
      });
      logger.info({ email }, "[Leads] Enterprise contact saved to DB");
    } catch (err) {
      logger.error({ err }, "[Leads] Failed to persist enterprise contact");
    }
    return res.json({ ok: true, message: "Enterprise contact captured successfully" });
  }

  const parsed = leadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid lead data", details: parsed.error.flatten() });
  }

  const { email, website, revenueModel, attribution, scheduledDate, scheduledTime } = parsed.data;
  try {
    await db.insert(leads).values({
      source: "demo",
      email,
      website,
      revenueModel,
      attribution,
      scheduledDate,
      scheduledTime,
      status: "new",
    });
    logger.info({ email }, "[Leads] Demo request saved to DB");
  } catch (err) {
    logger.error({ err }, "[Leads] Failed to persist demo request");
  }

  return res.json({ ok: true, message: "Lead captured successfully" });
});

export default router;
