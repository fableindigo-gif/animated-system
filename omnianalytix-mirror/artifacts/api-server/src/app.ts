/**
 * app.ts — Express application setup
 *
 * Phase 1: Sentry error monitoring (initSentry, request/error handlers)
 * Phase 3: Helmet security headers + production-hardened CORS
 */

import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import stripeWebhookRouter from "./routes/webhooks/stripe";
import { logger } from "./lib/logger";
import {
  initSentry,
  attachSentryRequestHandler,
  attachSentryErrorHandler,
} from "./lib/monitoring";

// ── Phase 1: Initialise Sentry first (must precede all other setup) ───────────
initSentry();

const app: Express = express();

// ── Phase 1: Sentry request handler (must be first middleware) ────────────────
attachSentryRequestHandler(app);

// ── Phase 3: Security headers via Helmet ─────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc:     ["'self'"],
        scriptSrc:      ["'self'"],
        styleSrc:       ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc:        ["'self'", "https://fonts.gstatic.com"],
        imgSrc:         ["'self'", "data:", "https:"],
        connectSrc:     ["'self'", "https://*.googleapis.com", "https://*.google.com", "https://sentry.io"],
        frameSrc:       ["'none'"],
        objectSrc:      ["'none'"],
        upgradeInsecureRequests: process.env.NODE_ENV === "production" ? [] : null,
      },
    },
    // Disable X-Powered-By header (avoid fingerprinting)
    hidePoweredBy: true,
    // Prevent browsers from MIME-sniffing
    noSniff: true,
    // Enable XSS filter in older browsers
    xssFilter: true,
    // Prevent clickjacking
    frameguard: { action: "deny" },
    // Force HTTPS in production
    hsts: process.env.NODE_ENV === "production"
      ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
      : false,
    // Disable DNS prefetch
    dnsPrefetchControl: { allow: false },
  }),
);

// ── Request logging ───────────────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id:     req.id,
          method: req.method,
          // Strip query string — may contain OAuth tokens
          url:    req.url?.split("?")[0],
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// ── CORS — tighter in production ──────────────────────────────────────────────
const allowedOrigins: (string | RegExp)[] =
  process.env.NODE_ENV === "production"
    ? [
        // Replit deployed domain
        new RegExp(`^https://${(process.env.REPLIT_DEV_DOMAIN ?? "").replace(".", "\\.")}$`),
        `https://${process.env.REPL_SLUG ?? ""}.${process.env.REPL_OWNER ?? ""}.repl.co`,
        // Any additional origins from env (comma-separated)
        ...(process.env.CORS_ALLOWED_ORIGINS
          ? process.env.CORS_ALLOWED_ORIGINS.split(",").map((o) => o.trim())
          : []),
      ].filter(Boolean)
    : [];   // In development: all origins allowed (cors({}) defaults to "*")

app.use(
  cors(
    process.env.NODE_ENV === "production"
      ? { origin: allowedOrigins, credentials: true }
      : { origin: true, credentials: true },
  ),
);

app.use(cookieParser());

// ── Stripe webhook — raw body required, must be before express.json() ─────────
app.use("/api/webhooks", stripeWebhookRouter);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ── API routes ────────────────────────────────────────────────────────────────
app.use("/api", router);

// ── Phase 1: Sentry error handler (must come BEFORE our custom error handler) ─
attachSentryErrorHandler(app);

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error(
    { err: { message: err.message, stack: err.stack } },
    "Unhandled error in request pipeline",
  );
  if (!res.headersSent) {
    res.status(500).json({
      error: "Internal server error",
      code:  "INTERNAL_ERROR",
    });
  }
});

export default app;
