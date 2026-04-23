/**
 * Shoptimizer write-back worker tests.
 *
 * Focuses on the parts that don't need a real DB:
 *   • Failure classification — the rules that turn an HTTP status + body
 *     into per-product retry guidance.
 *
 * Integration with proposed_tasks / audit_logs is exercised by the route
 * tests when the API server runs end-to-end; this suite keeps the
 * classification rules locked down so the dashboard can render
 * actionable retry hints with confidence.
 */
import { describe, it, expect } from "vitest";
import {
  classifyWritebackFailure,
  WRITEBACK_MAX_ATTEMPTS,
  runWritebackRetryScheduler,
} from "../workers/shoptimizer-writeback";

describe("classifyWritebackFailure", () => {
  it("flags 401 as a non-retryable auth failure", () => {
    const g = classifyWritebackFailure(401, "Invalid Credentials");
    expect(g.retryClass).toBe("auth");
    expect(g.retryable).toBe(false);
    expect(g.hint).toMatch(/reconnect/i);
  });

  it("treats 429 as a retryable quota error and honors Retry-After", () => {
    const headers = new Headers({ "retry-after": "120" });
    const g = classifyWritebackFailure(429, "rate limited", headers);
    expect(g.retryClass).toBe("quota");
    expect(g.retryable).toBe(true);
    expect(g.retryAfterSec).toBe(120);
  });

  it("recognises Content-API-style dailyLimitExceeded inside a 403 body", () => {
    const body = JSON.stringify({
      error: {
        code: 403,
        message: "Daily limit exceeded.",
        errors: [{ reason: "dailyLimitExceeded" }],
      },
    });
    const g = classifyWritebackFailure(403, body);
    expect(g.retryClass).toBe("quota");
    expect(g.retryable).toBe(true);
    expect(g.retryAfterSec).toBeGreaterThan(0);
  });

  it("classifies 5xx as transient and retryable", () => {
    const g = classifyWritebackFailure(503, "upstream busy");
    expect(g.retryClass).toBe("transient");
    expect(g.retryable).toBe(true);
  });

  it("classifies generic 4xx as non-retryable validation error", () => {
    const body = JSON.stringify({
      error: { code: 400, message: "[price.value] is required" },
    });
    const g = classifyWritebackFailure(400, body);
    expect(g.retryClass).toBe("non_retryable");
    expect(g.retryable).toBe(false);
    expect(g.hint).toMatch(/fix the diff/i);
  });

  it("returns a no-op guidance for 2xx (defensive)", () => {
    const g = classifyWritebackFailure(200, "");
    expect(g.retryClass).toBe("none");
    expect(g.retryable).toBe(false);
  });
});

describe("WRITEBACK_MAX_ATTEMPTS", () => {
  it("is a positive integer (default cap of 5)", () => {
    expect(typeof WRITEBACK_MAX_ATTEMPTS).toBe("number");
    expect(WRITEBACK_MAX_ATTEMPTS).toBeGreaterThan(0);
    expect(Number.isInteger(WRITEBACK_MAX_ATTEMPTS)).toBe(true);
    expect(WRITEBACK_MAX_ATTEMPTS).toBe(5);
  });
});

describe("retry guidance contracts required by the scheduler", () => {
  it("auth failures are never retryable (scheduler must not re-queue them)", () => {
    const g = classifyWritebackFailure(401, "Unauthorized");
    expect(g.retryable).toBe(false);
    expect(g.retryClass).toBe("auth");
    expect(g.retryAfterSec).toBeNull();
  });

  it("non-retryable 4xx carry no retryAfterSec (scheduler must skip them)", () => {
    const g = classifyWritebackFailure(422, JSON.stringify({ error: { code: 422, message: "bad payload" } }));
    expect(g.retryable).toBe(false);
    expect(g.retryAfterSec).toBeNull();
  });

  it("transient 5xx have a positive retryAfterSec so the scheduler can schedule a wake-up", () => {
    const g = classifyWritebackFailure(502, "bad gateway");
    expect(g.retryable).toBe(true);
    expect(g.retryAfterSec).toBeGreaterThan(0);
    expect(g.retryClass).toBe("transient");
  });

  it("quota failures honour an explicit Retry-After header (scheduler uses this value)", () => {
    const g = classifyWritebackFailure(429, "quota", new Headers({ "retry-after": "300" }));
    expect(g.retryable).toBe(true);
    expect(g.retryClass).toBe("quota");
    expect(g.retryAfterSec).toBe(300);
  });

  it("quota failures without a Retry-After header default to a positive backoff", () => {
    const g = classifyWritebackFailure(429, "quota");
    expect(g.retryable).toBe(true);
    expect(g.retryAfterSec).toBeGreaterThan(0);
  });
});

describe("runWritebackRetryScheduler export", () => {
  it("is a callable async function", () => {
    expect(typeof runWritebackRetryScheduler).toBe("function");
  });
});
