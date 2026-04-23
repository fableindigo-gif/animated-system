"""
Celery Task — Master Diagnostic Sweep
======================================
Runs the full Multi-Tenant Aggregator sweep asynchronously via Celery/Redis.
Designed to handle 100+ accounts without blocking the API.

Usage:
    from tasks.diagnostic_sweep import master_diagnostic_sweep
    result = master_diagnostic_sweep.delay(agency_ids=["agency-001", "agency-002"])
    # or: master_diagnostic_sweep.apply_async(kwargs={"agency_ids": []}, countdown=60)
"""
import logging
from datetime import date

from celery_app import celery
from database import SessionLocal
from services.multi_tenant import run_full_sweep

logger = logging.getLogger("celery.sweep")


@celery.task(
    bind=True,
    name="agency_engine.master_diagnostic_sweep",
    max_retries=3,
    default_retry_delay=30,
    soft_time_limit=300,
    time_limit=360,
)
def master_diagnostic_sweep(
    self,
    agency_ids: list[str] | None = None,
    report_date_str: str | None = None,
    drift_mode: bool = False,
):
    """
    Master Diagnostic Sweep Celery task.

    Sweeps TrustLayer + ActionLayer + ProfitLayer for every client in the
    specified agencies (or all agencies if agency_ids is empty/None).

    Args:
        agency_ids:       List of agency IDs to sweep. Empty = all agencies.
        report_date_str:  ISO date string e.g. "2025-01-15". Defaults to today.
        drift_mode:       If True, Mock APIs inject deliberate drift for UAT.
    """
    task_id = self.request.id or "inline"
    logger.info("[Sweep:%s] Starting master_diagnostic_sweep | agencies=%s", task_id, agency_ids or "ALL")

    report_date = date.fromisoformat(report_date_str) if report_date_str else date.today()

    db = SessionLocal()
    try:
        result = run_full_sweep(
            db=db,
            agency_ids=agency_ids or None,
            report_date=report_date,
            drift_mode=drift_mode,
        )
        logger.info(
            "[Sweep:%s] Complete | agencies=%d accounts=%d portfolio_health=%.1f",
            task_id,
            result["agencies_swept"],
            result["accounts_swept"],
            result["health_dashboard"]["portfolio_health"],
        )
        return result
    except Exception as exc:
        logger.exception("[Sweep:%s] Failed: %s", task_id, exc)
        raise self.retry(exc=exc)
    finally:
        db.close()
