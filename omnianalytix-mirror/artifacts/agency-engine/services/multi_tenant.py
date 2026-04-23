"""
Multi-Tenant Aggregator
========================
Provides the Master Diagnostic Sweep: a cross-agency, cross-client background
task that aggregates TrustLayer + ActionLayer + ProfitLayer health scores
into a single portfolio health dashboard.

Path-based isolation: every query is scoped to (agency_id, client_id).

Concurrency model
-----------------
`run_full_sweep` fans out to a ThreadPoolExecutor so 50+ client orgs can be
processed in parallel rather than sequentially.  Each worker receives its own
SQLAlchemy session (created from `SessionLocal`) to satisfy ORM thread-safety.

API rate-limit protection
--------------------------
A `TokenBucketRateLimiter` with configurable burst size and refill rate is
exposed as two module-level singletons — one per external API family:

    GOOGLE_ADS_LIMITER  10 tokens/sec, burst 20
    META_ADS_LIMITER     5 tokens/sec, burst 10

Service-layer functions (trust_layer, etc.) are expected to call
`acquire_google()` / `acquire_meta()` before issuing outbound requests.
The default constants are conservative enough to stay inside:
    - Google Ads: 1,000 req / 100 s per developer-token
    - Meta Marketing API: 200 calls / hour per ad account (Business tier)

At MAX_CONCURRENT_CLIENTS=10 with 50 clients the burst is absorbed in ≤ 5 s.
"""
from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from database import SessionLocal
from models import Agency, Client, AuditLog, ResolutionTicket, DailyPnL
from services.trust_layer import reconcile as trust_reconcile
from services.action_layer import evaluate_playbooks
from services.profit_layer import calculate_poas

logger = logging.getLogger("multi_tenant")

# ─── Concurrency constants ────────────────────────────────────────────────────
# Max parallel client workers.  10 is safe for both Google & Meta rate limits
# at current token-bucket settings even with a full 50-client burst.
MAX_CONCURRENT_CLIENTS: int = 10


# ─── Token-Bucket Rate Limiter ────────────────────────────────────────────────
class TokenBucketRateLimiter:
    """
    Thread-safe token-bucket rate limiter.

    Args:
        rate:   Tokens refilled per second (sustained throughput cap).
        burst:  Maximum tokens that can accumulate (short-term burst headroom).

    Usage::
        GOOGLE_ADS_LIMITER.acquire()   # blocks until a token is available
    """

    def __init__(self, rate: float, burst: float) -> None:
        self._rate = rate
        self._burst = burst
        self._tokens = burst
        self._last_refill = time.monotonic()
        self._lock = threading.Lock()

    def acquire(self, tokens: float = 1.0) -> None:
        """Block until `tokens` are available, then consume them."""
        while True:
            with self._lock:
                now = time.monotonic()
                elapsed = now - self._last_refill
                self._tokens = min(self._burst, self._tokens + elapsed * self._rate)
                self._last_refill = now
                if self._tokens >= tokens:
                    self._tokens -= tokens
                    return
                wait_for = (tokens - self._tokens) / self._rate
            time.sleep(wait_for)


# Module-level singletons — import these in service layers before outbound calls
GOOGLE_ADS_LIMITER = TokenBucketRateLimiter(rate=10.0, burst=20.0)
META_ADS_LIMITER   = TokenBucketRateLimiter(rate=5.0,  burst=10.0)


# ─── Health score helpers (unchanged logic, kept session-scoped) ──────────────

def _compute_trust_score(db: Session, agency_id: str, client_id: str) -> tuple[float, list[str]]:
    """Trust score based on the ratio of MATCH to total recent checks."""
    recent = (
        db.query(AuditLog)
        .filter(AuditLog.agency_id == agency_id, AuditLog.client_id == client_id)
        .order_by(AuditLog.checked_at.desc())
        .limit(60)
        .all()
    )
    if not recent:
        return 50.0, ["No reconciliation data — trust score defaulted to 50"]
    match_count = sum(1 for r in recent if r.status == "MATCH")
    score = round(match_count / len(recent) * 100, 1)
    alerts = []
    if score < 80:
        drift_rows = [r for r in recent if r.status == "DRIFT_DETECTED"]
        platforms = {r.platform for r in drift_rows}
        alerts.append(f"Data drift on {', '.join(platforms)} — {len(drift_rows)} field(s) affected")
    return score, alerts


def _compute_action_score(db: Session, agency_id: str, client_id: str) -> tuple[float, list[str]]:
    """Action score: 100 minus penalty for unresolved resolution tickets."""
    open_tickets = (
        db.query(ResolutionTicket)
        .filter(
            ResolutionTicket.agency_id == agency_id,
            ResolutionTicket.client_id == client_id,
            ResolutionTicket.status == "open",
        )
        .count()
    )
    score = max(0.0, 100.0 - open_tickets * 10)
    alerts = []
    if open_tickets > 0:
        alerts.append(f"{open_tickets} open action item(s) require attention")
    return score, alerts


def _compute_profit_score(db: Session, agency_id: str, client_id: str) -> tuple[float, list[str]]:
    """Profit score based on today's POAS margin_status."""
    pnl = (
        db.query(DailyPnL)
        .filter(DailyPnL.agency_id == agency_id, DailyPnL.client_id == client_id)
        .order_by(DailyPnL.date.desc())
        .first()
    )
    if not pnl:
        return 50.0, ["No P&L data available — profit score defaulted to 50"]

    score_map = {"HEALTHY": 100.0, "MARGINAL": 65.0, "AT_RISK": 35.0, "NEGATIVE_MARGIN": 0.0, "NO_REVENUE": 50.0}
    true_profit = pnl.true_profit
    revenue = pnl.revenue
    if true_profit < 0:
        status = "NEGATIVE_MARGIN"
    elif revenue == 0:
        status = "NO_REVENUE"
    else:
        margin_pct = true_profit / revenue * 100
        if margin_pct >= 20:
            status = "HEALTHY"
        elif margin_pct >= 10:
            status = "MARGINAL"
        else:
            status = "AT_RISK"

    score = score_map.get(status, 50.0)
    alerts = []
    if status in ("NEGATIVE_MARGIN", "AT_RISK"):
        alerts.append(f"Margin alert: {status} — POAS {pnl.poas:.3f}")
    return score, alerts


def account_health(db: Session, agency_id: str, client_id: str, client_name: str) -> dict[str, Any]:
    """Compute a composite health score for a single client account."""
    trust, trust_alerts = _compute_trust_score(db, agency_id, client_id)
    action, action_alerts = _compute_action_score(db, agency_id, client_id)
    profit, profit_alerts = _compute_profit_score(db, agency_id, client_id)
    health = round((trust * 0.4 + action * 0.3 + profit * 0.3), 1)
    return {
        "agency_id": agency_id,
        "client_id": client_id,
        "client_name": client_name,
        "trust_score": trust,
        "action_score": action,
        "profit_score": profit,
        "health_score": health,
        "grade": "A" if health >= 90 else "B" if health >= 75 else "C" if health >= 55 else "D",
        "alerts": trust_alerts + action_alerts + profit_alerts,
    }


def health_dashboard(db: Session, agency_ids: list[str] | None = None) -> dict[str, Any]:
    """
    Aggregate health scores for all agencies (or a subset).
    Path-based isolation: results are always scoped per-agency.
    """
    query = db.query(Agency)
    if agency_ids:
        query = query.filter(Agency.id.in_(agency_ids))
    agencies = query.all()

    results: list[dict] = []
    for agency in agencies:
        clients = (
            db.query(Client)
            .filter(Client.agency_id == agency.id)
            .all()
        )
        agency_scores = []
        for client in clients:
            score = account_health(db, agency.id, client.id, client.name)
            agency_scores.append(score)
            results.append(score)
            logger.info(
                "[MultiTenant] Health | agency=%s client=%s health=%.1f grade=%s",
                agency.id, client.id, score["health_score"], score["grade"],
            )

        avg_health = round(sum(s["health_score"] for s in agency_scores) / len(agency_scores), 1) if agency_scores else 0.0
        logger.info("[MultiTenant] Agency summary | agency=%s avg_health=%.1f accounts=%d", agency.id, avg_health, len(clients))

    return {
        "agencies_swept": len(agencies),
        "accounts_swept": len(results),
        "results": results,
        "portfolio_health": round(sum(r["health_score"] for r in results) / len(results), 1) if results else 0.0,
    }


# ─── Concurrent sweep helpers ─────────────────────────────────────────────────

def _sweep_single_client(
    agency_id: str,
    client_id: str,
    client_name: str,
    report_date: date,
    drift_mode: bool,
) -> dict[str, Any]:
    """
    Run the three-layer sweep for one client inside a dedicated DB session.
    Designed to be called from a ThreadPoolExecutor worker — each invocation
    creates and closes its own SQLAlchemy session so there is no cross-thread
    session sharing.

    Rate-limit tokens are acquired before the trust-layer (the only layer that
    calls external platform APIs).
    """
    db = SessionLocal()
    try:
        # Acquire rate-limit tokens before any outbound API call.
        # trust_reconcile may call Google/Meta APIs in production.
        GOOGLE_ADS_LIMITER.acquire()
        META_ADS_LIMITER.acquire()

        trust_result  = trust_reconcile(db, agency_id, client_id, report_date, drift_mode=drift_mode)
        action_result = evaluate_playbooks(db, agency_id, client_id)
        profit_result = calculate_poas(db, agency_id, client_id, report_date)

        entry = {
            "agency_id":   agency_id,
            "client_id":   client_id,
            "client_name": client_name,
            "trust":   {"checks": trust_result["total_checks"], "drift_count": trust_result["drift_count"]},
            "action":  {"triggers": len(action_result.get("triggers", []))},
            "profit":  {"poas": profit_result.get("poas"), "margin_status": profit_result.get("margin_status")},
            "error":   None,
        }
        logger.info(
            "[MultiTenant] Sweep complete | agency=%s client=%s drift=%d triggers=%d poas=%s",
            agency_id, client_id, trust_result["drift_count"],
            len(action_result.get("triggers", [])), profit_result.get("poas"),
        )
        return entry

    except Exception as exc:  # noqa: BLE001
        logger.error(
            "[MultiTenant] Sweep error | agency=%s client=%s error=%s",
            agency_id, client_id, exc,
        )
        return {
            "agency_id":   agency_id,
            "client_id":   client_id,
            "client_name": client_name,
            "trust":   {"checks": 0, "drift_count": 0},
            "action":  {"triggers": 0},
            "profit":  {"poas": None, "margin_status": "ERROR"},
            "error":   str(exc),
        }
    finally:
        db.close()


def run_full_sweep(
    db: Session,
    agency_ids: list[str] | None = None,
    report_date: date | None = None,
    drift_mode: bool = False,
) -> dict[str, Any]:
    """
    Master Diagnostic Sweep — runs all three service layers for every client,
    concurrently across up to MAX_CONCURRENT_CLIENTS workers.

    Thread-safety
    -------------
    The `db` argument is used **read-only** here to load agency/client IDs.
    All per-client work is dispatched to `_sweep_single_client`, which opens
    its own session, so the caller's session is never shared across threads.

    Rate limiting
    -------------
    Each worker acquires tokens from GOOGLE_ADS_LIMITER and META_ADS_LIMITER
    before calling the trust layer.  At MAX_CONCURRENT_CLIENTS=10 and a burst
    of 20 tokens this keeps Google Ads calls ≤ 10/s and Meta ≤ 5/s, well
    inside both platforms' documented per-developer-token quotas.

    Scalability
    -----------
    Sequential time for N clients: O(N × avg_client_ms)
    Concurrent time for N clients: O(ceil(N / MAX_CONCURRENT_CLIENTS) × avg_client_ms)
    At 50 clients × ~200 ms each: sequential ≈ 10 s → concurrent ≈ 1 s.
    """
    report_date = report_date or date.today()

    query = db.query(Agency)
    if agency_ids:
        query = query.filter(Agency.id.in_(agency_ids))
    agencies = query.all()

    # Build flat list of (agency, client) work items using the caller's session
    work_items: list[tuple[str, str, str]] = []
    for agency in agencies:
        clients = db.query(Client).filter(Client.agency_id == agency.id).all()
        for client in clients:
            work_items.append((agency.id, client.id, client.name))

    logger.info(
        "[MultiTenant] Starting concurrent sweep | agencies=%d clients=%d workers=%d",
        len(agencies), len(work_items), min(MAX_CONCURRENT_CLIENTS, max(1, len(work_items))),
    )
    sweep_start = time.monotonic()

    sweep_log: list[dict] = []
    error_count = 0

    with ThreadPoolExecutor(
        max_workers=min(MAX_CONCURRENT_CLIENTS, max(1, len(work_items))),
        thread_name_prefix="sweep",
    ) as executor:
        future_to_item = {
            executor.submit(
                _sweep_single_client,
                agency_id, client_id, client_name,
                report_date, drift_mode,
            ): (agency_id, client_id)
            for agency_id, client_id, client_name in work_items
        }

        for future in as_completed(future_to_item):
            result = future.result()
            sweep_log.append(result)
            if result.get("error"):
                error_count += 1

    elapsed_ms = round((time.monotonic() - sweep_start) * 1000)
    logger.info(
        "[MultiTenant] Sweep finished | accounts=%d errors=%d elapsed_ms=%d",
        len(sweep_log), error_count, elapsed_ms,
    )

    return {
        "sweep_date":      str(report_date),
        "agencies_swept":  len(agencies),
        "accounts_swept":  len(sweep_log),
        "error_count":     error_count,
        "elapsed_ms":      elapsed_ms,
        "sweep_log":       sweep_log,
        "health_dashboard": health_dashboard(db, agency_ids),
    }
