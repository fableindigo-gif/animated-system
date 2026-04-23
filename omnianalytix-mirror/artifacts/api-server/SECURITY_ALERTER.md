# Security Alerter — Cross-User Session Access Notifications

## Overview

The security alerter fires a real-time push notification to a configured admin channel
whenever a cross-user session access attempt is detected inside the API server.

A *cross-user session access attempt* occurs when a request provides a valid session ID
that exists in the database, but the session is owned by a **different** user than the
one making the request. This is logged as `event: "session_ownership_mismatch"` and is a
strong signal of session probing or misconfiguration.

## Trigger points

| Function          | Description                                                   |
|-------------------|---------------------------------------------------------------|
| `getAdkSession`   | Caller tries to read a session they do not own               |
| `deleteAdkSession`| Caller tries to delete a session they do not own             |

Source: `artifacts/api-server/src/services/adk-agent.ts`
Alerter: `artifacts/api-server/src/lib/security-alerter.ts`

## Environment variables

| Variable                          | Required | Default  | Description                                                        |
|-----------------------------------|----------|----------|--------------------------------------------------------------------|
| `SECURITY_ALERT_SLACK_WEBHOOK_URL`| No       | —        | Slack Incoming Webhook URL. When set, a formatted alert is POSTed to Slack immediately on every mismatch (subject to cooldown). |
| `SECURITY_ALERT_COOLDOWN_MS`      | No       | `60000`  | Minimum milliseconds between alerts for the **same sessionId**. Prevents flooding when a bad actor probes rapidly. Invalid or non-positive values fall back to the 60-second default. |

When neither variable is set the alerter is a no-op — the passive `logger.warn` entry
in the log stream remains the only trace.

## Setting up a Slack Incoming Webhook

1. Go to **https://api.slack.com/apps** and select (or create) your workspace app.
2. Enable **Incoming Webhooks** under *Features → Incoming Webhooks*.
3. Click **Add New Webhook to Workspace** and choose your `#security-alerts` channel.
4. Copy the generated URL and set it as `SECURITY_ALERT_SLACK_WEBHOOK_URL` in your
   deployment environment (Replit Secrets, `.env`, or your CI/CD secret store).

## Alert payload example

```
🚨 Security Alert — Cross-User Session Access Attempt
• org: `42`
• member: `99`
• session: `ses_01hx...`
• source: `getAdkSession`
• time: 2026-04-22T10:15:30.123Z
```

## Cooldown behaviour

To avoid a single probing burst generating hundreds of Slack messages, the alerter
tracks the last notification time per `sessionId`. If the same session triggers another
mismatch within `SECURITY_ALERT_COOLDOWN_MS` milliseconds the alert is silently
suppressed (a `debug`-level log line is emitted instead). The cooldown resets once the
window elapses.

The in-memory map is capped at 1 000 entries to prevent unbounded memory growth.
