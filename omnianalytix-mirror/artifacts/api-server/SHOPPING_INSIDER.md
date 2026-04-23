# Shopping Insider integration

OmniAnalytix reads real Google Ads + Merchant Center performance from the
BigQuery datasets produced by Google's
[`shopping_insider`](https://github.com/google/shopping_insider) solution.

We do **not** fork or run the Shopping Insider pipeline ourselves. The customer
deploys it once into their own GCP project following Google's deploy guide
(Cloud Functions + Cloud Scheduler + BigQuery), then grants our service account
read access to the resulting datasets.

## What you get

Once configured, OmniAnalytix exposes:

- `GET /api/insights/shopping/campaigns` — campaign performance over a date range
- `GET /api/insights/shopping/products` — top/bottom products by conversions, ROAS, cost, etc.
- `GET /api/insights/shopping/issues` — product disapprovals / demotions
- `GET /api/insights/shopping/account-health` — account-level feed health

…plus four matching ADK FunctionTools (`shopping_campaign_performance`,
`shopping_top_products`, `shopping_product_issues`, `shopping_account_health`)
that the agent uses to answer questions like:

- "How are my Shopping campaigns doing this week?"
- "Which products have disapproval issues?"
- "What are my top-converting SKUs this month?"

## Customer-side setup (one time)

1. Follow Google's official Shopping Insider deploy guide:
   <https://github.com/google/shopping_insider#deployment>
   It will create a BigQuery dataset (default name `shopping_insider`) in the
   customer's GCP project containing materialized views over their Merchant
   Center + Google Ads data.
2. Create a service account in that GCP project with the roles:
   - `roles/bigquery.dataViewer` on the Shopping Insider dataset
   - `roles/bigquery.jobUser` on the project (so we can run queries)
3. Download the service-account JSON key.

## Server-side environment variables

Set these on the API server (Replit Secrets, or your deployment env):

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `SHOPPING_INSIDER_BQ_PROJECT_ID` | yes | — | GCP project ID hosting the Shopping Insider datasets. |
| `SHOPPING_INSIDER_BQ_DATASET` | no | `shopping_insider` | BigQuery dataset name produced by Shopping Insider. |
| `SHOPPING_INSIDER_BQ_LOCATION` | no | `US` | BigQuery dataset location. |
| `SHOPPING_INSIDER_GCP_SA_KEY` | one of | — | Service-account JSON, inline (paste the entire JSON object). |
| `SHOPPING_INSIDER_GCP_SA_KEY_FILE` | one of | — | Path to a service-account JSON file on disk. |
| `GOOGLE_APPLICATION_CREDENTIALS` | one of | — | Standard GCP fallback path. |
| `SHOPPING_INSIDER_BQ_MAX_BYTES` | no | `1000000000` (1 GB) | Per-query billing cap. |
| `SHOPPING_INSIDER_CACHE_TTL_MS` | no | `3600000` (1 h) | TTL for the in-memory result cache. Shopping Insider materialized tables refresh ≤ once per day, so identical queries within the TTL are served from memory and skip BigQuery entirely. Set to `0` to disable. Pass `?no_cache=1` on any `/api/insights/shopping/*` endpoint to bypass for that one call. |

If none of `SHOPPING_INSIDER_GCP_SA_KEY` / `SHOPPING_INSIDER_GCP_SA_KEY_FILE` /
`GOOGLE_APPLICATION_CREDENTIALS` is set, the endpoints **fail loudly** with a
`503 BIGQUERY_NOT_CONFIGURED` response. There is no silent fallback to mock
data.

### Sharing the response cache across replicas

Shopping Insider responses (and other live platform-data fetches) are cached
in the API server with a 60-second TTL to keep BigQuery and ad-platform bills
down. By default this cache lives in-process — fine for a single instance,
but each replica keeps its own copy when the API server is horizontally
scaled, so cache hit rates degrade roughly 1/N.

Point the cache at a shared Redis instance and every replica will see the
same entries. Key format and TTL semantics are unchanged; callers don't
need to know which backend is active.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `SHARED_CACHE_REDIS_URL` | no | — | Redis connection string (e.g. `redis://default:pw@host:6379`). When set, the cache is backed by Redis. When unset, falls back to the in-process Map. |
| `SHARED_CACHE_KEY_PREFIX` | no | `omnianalytix:cache:` | Root namespace prefix for every cache key in Redis. Set this if multiple deployments share one Redis instance. |

If the Redis client fails to connect or a single op errors out, the server
logs a warning and the request proceeds (treating it as a cache miss) — a
broken cache should never take Shopping Insider down.

### Optional table-name overrides

If the customer's Shopping Insider deployment uses non-default table names,
override them:

| Variable | Default |
| --- | --- |
| `SHOPPING_INSIDER_TABLE_PRODUCT_DETAILED` | `product_detailed_materialized` |
| `SHOPPING_INSIDER_TABLE_PRODUCT_HISTORICAL` | `product_historical_metrics_materialized` |
| `SHOPPING_INSIDER_TABLE_ACCOUNT_SUMMARY` | `account_summary_materialized` |
| `SHOPPING_INSIDER_TABLE_CAMPAIGN_PERF` | `campaign_performance_materialized` |
| `SHOPPING_INSIDER_TABLE_PRODUCT_ISSUES` | `product_issues_materialized` |

## Cache & cost monitoring

Every Shopping Insider query is fronted by a 1-hour in-memory cache
(`src/lib/shopping-insider-cache.ts`). Each cached function (`getCampaignPerformance`,
`getProductPerformance`, `getProductIssues`, `getAccountHealth`) increments
counters on every hit and miss, and tracks the BigQuery `totalBytesProcessed`
that the cache saved (hits) vs. still billed (misses).

Read the counters from:

```bash
curl "$API_BASE/api/admin/shopping-insider-cache" \
  -H "Authorization: Bearer <admin token>"
```

Response shape:

```json
{
  "ok": true,
  "ttlMs": 3600000,
  "cacheSize": 7,
  "perFunction": {
    "getCampaignPerformance": {
      "hits": 42, "misses": 3,
      "bytesAvoided": 12884901888,
      "bytesBilled": 920350134,
      "hitRate": 0.9333
    }
  },
  "totals": {
    "hits": 88, "misses": 11,
    "bytesAvoided": 30064771072,
    "bytesBilled": 3758096384,
    "hitRate": 0.8889
  }
}
```

`bytesAvoided` is BigQuery bytes the cache prevented us from being billed
for. Multiply by your on-demand BigQuery rate (≈ `$5 / TiB`) to estimate
dollars saved, or graph it over time in your monitoring tool of choice.
The endpoint requires the `admin` role (it lives under `/api/admin/*`,
which is already gated by `requireRole("admin")`).

## Spend & cache-health alerts (Task #42)

A background alerter runs on the API server and periodically samples the
same counters that `GET /api/admin/shopping-insider-cache` exposes. It fires
a **Sentry alert** (and always logs at `warn` level) when:

- `bytesBilled` over a rolling window exceeds a configured byte threshold
  (runaway spend — e.g. a deploy broke the cache key and every request re-bills
  BigQuery), **or**
- `hitRate` over the same window falls below a configured floor once a minimum
  number of samples have been seen (cache effectively offline).

Alerts surface in Sentry the same way any other server exception does.  When
`SENTRY_DSN` is not set they are still visible in the API server logs so they
are never silently swallowed.

Two alerts for the same condition are suppressed for a configurable cooldown
period to prevent alert storms.

### Alert configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `SHOPPING_INSIDER_ALERT_INTERVAL_MS` | `300000` (5 min) | How often the alerter samples the metrics. |
| `SHOPPING_INSIDER_ALERT_WINDOW_MS` | `3600000` (1 h) | Rolling window over which bytesBilled delta and hitRate are computed. |
| `SHOPPING_INSIDER_ALERT_BYTES_THRESHOLD` | *unset* | Bytes-billed alert fires when the delta within the window exceeds this value. Leave unset to disable. At the on-demand BigQuery rate (~$5/TiB) 10 GB ≈ $0.05, so a reasonable starting point for a single deployment is `10000000000` (10 GB/hour). |
| `SHOPPING_INSIDER_ALERT_HITRATE_FLOOR` | *unset* | Hit-rate alert fires when the rate falls below this fraction (`0`–`1`). A healthy deployment with a 1-hour TTL typically sees >0.8 after warm-up. Leave unset to disable. |
| `SHOPPING_INSIDER_ALERT_MIN_SAMPLES` | `20` | Minimum number of requests within the window before the hit-rate check fires (avoids false positives at low traffic). |
| `SHOPPING_INSIDER_ALERT_COOLDOWN_MS` | `3600000` (1 h) | Minimum gap between two firings of the same alert kind. |

The alerter is **completely disabled** (no background timer, no log noise) when
neither `SHOPPING_INSIDER_ALERT_BYTES_THRESHOLD` nor
`SHOPPING_INSIDER_ALERT_HITRATE_FLOOR` is set. Set at least one threshold to
enable it.

## Quick smoke test

```bash
curl "$API_BASE/api/insights/shopping/account-health"
```

A 200 response with rows confirms credentials, dataset, and the materialized
views are all reachable. A 503 with code `BIGQUERY_NOT_CONFIGURED` means the
env vars are missing or the service account lacks access.
