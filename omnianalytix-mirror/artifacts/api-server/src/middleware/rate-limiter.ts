import rateLimit, { type Options } from "express-rate-limit";
import type { Request } from "express";

const disableIpValidation: Partial<Options>["validate"] = {
  default: true,
  ip: false,
};

function safeIp(req: Request): string {
  const raw = req.socket?.remoteAddress ?? "unknown";
  if (raw.startsWith("::ffff:")) return raw.slice(7);
  return raw;
}

export const authRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  validate: disableIpValidation,
  message: {
    error: "Too many authentication attempts",
    message: "You have exceeded the rate limit for authentication. Please try again later.",
    code: "RATE_LIMIT_AUTH",
    retryAfter: 60,
  },
  keyGenerator: (req) => safeIp(req),
});

export const etlRateLimit = rateLimit({
  windowMs: 5 * 60_000,
  limit: 1,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  validate: disableIpValidation,
  message: {
    error: "ETL sync rate limited",
    message: "Only one sync is allowed every 5 minutes to protect external API quotas.",
    code: "RATE_LIMIT_ETL",
    retryAfter: 300,
  },
  keyGenerator: (req) => `etl-${req.rbacUser?.id ?? safeIp(req)}`,
});

export const warehouseRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  validate: disableIpValidation,
  message: {
    error: "Too many requests",
    message: "You have exceeded the read rate limit. Please slow down.",
    code: "RATE_LIMIT_READ",
    retryAfter: 60,
  },
  keyGenerator: (req) => `read-${req.rbacUser?.id ?? safeIp(req)}`,
});

export const sharedReportRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  validate: disableIpValidation,
  message: {
    error: "Too many requests",
    message: "You have exceeded the rate limit for shared report access. Please try again later.",
    code: "RATE_LIMIT_SHARED_REPORT",
    retryAfter: 60,
  },
  keyGenerator: (req) => `shared-report-${safeIp(req)}`,
});

export const geminiRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  validate: disableIpValidation,
  message: {
    error: "Too many AI requests",
    message: "You have exceeded the rate limit for AI queries. Please wait before trying again.",
    code: "RATE_LIMIT_AI",
    retryAfter: 60,
  },
  keyGenerator: (req) => `ai-${req.rbacUser?.id ?? safeIp(req)}`,
});

export const connectionsRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  validate: disableIpValidation,
  message: {
    error: "Too many requests",
    message: "You have exceeded the rate limit for connection management. Please try again later.",
    code: "RATE_LIMIT_CONNECTIONS",
    retryAfter: 60,
  },
  keyGenerator: (req) => `conn-${req.rbacUser?.id ?? safeIp(req)}`,
});

export const actionsRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 15,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  validate: disableIpValidation,
  message: {
    error: "Too many action requests",
    message: "You have exceeded the rate limit for actions. Please wait before trying again.",
    code: "RATE_LIMIT_ACTIONS",
    retryAfter: 60,
  },
  keyGenerator: (req) => `act-${req.rbacUser?.id ?? safeIp(req)}`,
});

export const sseTicketRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  validate: disableIpValidation,
  message: {
    error: "Too many SSE connection attempts",
    message: "You are reconnecting too frequently. Please wait before trying again.",
    code: "RATE_LIMIT_SSE",
    retryAfter: 60,
  },
  keyGenerator: (req) => `sse-${req.rbacUser?.id ?? safeIp(req)}`,
});
