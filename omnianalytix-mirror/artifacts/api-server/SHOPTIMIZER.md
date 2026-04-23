# Shoptimizer Integration

OmniAnalytix uses Google's open-source [Shoptimizer](https://github.com/google/shoptimizer)
service to analyze and optimize Merchant Center / Google Shopping product
feeds. We treat Shoptimizer as an **external dependency**: it runs as a
separate Flask service and we call it over HTTP.

## Required environment variable

| Variable                | Purpose                                                                  |
| ----------------------- | ------------------------------------------------------------------------ |
| `SHOPTIMIZER_BASE_URL`  | Base URL of a running Shoptimizer service (no trailing slash needed).    |

If `SHOPTIMIZER_BASE_URL` is unset OR the service is unreachable, every
optimization endpoint and ADK tool returns a clear failure (HTTP **503** /
`SHOPTIMIZER_NOT_CONFIGURED` or `SHOPTIMIZER_UNREACHABLE`). We never
silently pass the unmodified product through.

## Running Shoptimizer locally (Docker)

```bash
# 1. Clone Google's repo
git clone https://github.com/google/shoptimizer.git
cd shoptimizer/shoptimizer_api

# 2. Build the image
docker build -t shoptimizer .

# 3. Run it on port 8080
docker run --rm -p 8080:8080 shoptimizer

# 4. Point OmniAnalytix at it
export SHOPTIMIZER_BASE_URL=http://localhost:8080
```

## Running Shoptimizer on Cloud Run

```bash
# Build & push to Artifact Registry, then deploy:
gcloud run deploy shoptimizer \
  --image gcr.io/$PROJECT_ID/shoptimizer \
  --region us-central1 \
  --no-allow-unauthenticated

# Use the service URL it prints:
export SHOPTIMIZER_BASE_URL=https://shoptimizer-xxxx-uc.a.run.app
```

When deploying behind IAM auth, attach a service account that can mint
identity tokens and reverse-proxy/wrap the calls; Shoptimizer itself does
not authenticate callers.

## REST endpoint

`POST /api/feed-enrichment/optimize`

```json
{
  "products": [
    {
      "offerId": "SKU-123",
      "title": "blue shirt mens cotton",
      "color": "",
      "identifierExists": false
    }
  ],
  "pluginSettings": {}
}
```

Response (abridged):

```json
{
  "maxBatch": 50,
  "totalRequested": 1,
  "totalOptimized": 1,
  "totalFailed": 0,
  "results": [
    {
      "ok": true,
      "offerId": "SKU-123",
      "original": { "...": "..." },
      "optimized": { "color": "blue", "title": "Mens cotton blue shirt" },
      "diff": {
        "offerId": "SKU-123",
        "pluginsFired": ["title-word-order", "color"],
        "changeCount": 2,
        "changedFields": [
          { "field": "color", "before": "", "after": "blue" }
        ]
      }
    }
  ]
}
```

A single product can also be sent as `{ "product": {...} }`.
The batch is hard-capped at **50** products per request.

## Agent tool

The ADK `gap_finder` agent gains a new `optimize_product_feed` tool. Ask
the agent things like:

> *"What's wrong with the feed for SKU-123? Here's the payload: …"*

and it will call Shoptimizer, return the plugins that fired, and explain
each fix.

## Out of scope (Task #13)

- Hosting Shoptimizer inside this repo (it's a Python service).
- Writing optimized products back to Merchant Center — this integration
  is **read/preview only**.
- A UI for browsing fixes — backend + agent tool only.
