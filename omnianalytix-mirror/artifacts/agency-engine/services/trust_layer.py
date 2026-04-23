"""
TrustLayer — Data Integrity Service
====================================
Reconciles upstream mock API data (Google / Facebook Ads) against the internal
downstream_metrics table. Logs MATCH or DRIFT_DETECTED per field per campaign.

Multi-tenant isolation: every query is scoped to (agency_id, client_id).
"""
from __future__ import annotations

import logging
from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from models import AuditLog, DataValidationRule, DownstreamMetric
from mocks.google_ads import MockGoogleAdsAPI
from mocks.facebook_ads import MockFacebookAdsAPI

logger = logging.getLogger("trust_layer")

RECONCILED_FIELDS = ["spend", "impressions", "clicks", "conversions", "revenue"]


def _pct_drift(upstream: float, downstream: float) -> float:
    if upstream == 0:
        return 0.0 if downstream == 0 else 100.0
    return abs(upstream - downstream) / abs(upstream) * 100.0


def _get_threshold(db: Session, agency_id: str, platform: str) -> float:
    rule = (
        db.query(DataValidationRule)
        .filter(
            DataValidationRule.agency_id == agency_id,
            DataValidationRule.platform == platform,
            DataValidationRule.active.is_(True),
        )
        .first()
    )
    return rule.threshold_pct if rule else 5.0


def _build_downstream_index(
    db: Session, agency_id: str, client_id: str, report_date: date, platform: str
) -> dict[str, DownstreamMetric]:
    rows = (
        db.query(DownstreamMetric)
        .filter(
            DownstreamMetric.agency_id == agency_id,
            DownstreamMetric.client_id == client_id,
            DownstreamMetric.date == report_date,
            DownstreamMetric.platform == platform,
        )
        .all()
    )
    return {r.campaign_id: r for r in rows}


def reconcile(
    db: Session,
    agency_id: str,
    client_id: str,
    report_date: date | None = None,
    drift_mode: bool = False,
) -> dict[str, Any]:
    """
    Run a full TrustLayer reconciliation for a single client.

    Returns a structured result with per-field, per-campaign MATCH / DRIFT_DETECTED entries.
    All AuditLog rows are committed to the database.
    """
    report_date = report_date or date.today()
    all_results: list[dict] = []
    total = drift = 0

    for platform, api_cls, api_kwargs in [
        ("google_ads", MockGoogleAdsAPI, {"drift_mode": drift_mode}),
        ("facebook_ads", MockFacebookAdsAPI, {"drift_mode": drift_mode}),
    ]:
        api = api_cls(**api_kwargs)
        threshold = _get_threshold(db, agency_id, platform)
        downstream_idx = _build_downstream_index(db, agency_id, client_id, report_date, platform)
        upstream_rows = api.get_campaign_metrics(report_date=report_date)

        for up in upstream_rows:
            ds = downstream_idx.get(up.campaign_id)

            for field in RECONCILED_FIELDS:
                up_val = float(getattr(up, field))
                ds_val = float(getattr(ds, field)) if ds else 0.0
                drift_pct = _pct_drift(up_val, ds_val)
                status = "MATCH" if drift_pct <= threshold else "DRIFT_DETECTED"
                total += 1
                if status == "DRIFT_DETECTED":
                    drift += 1

                entry = dict(
                    agency_id=agency_id,
                    client_id=client_id,
                    campaign_id=up.campaign_id,
                    platform=platform,
                    field=field,
                    upstream_value=up_val,
                    downstream_value=ds_val,
                    drift_pct=round(drift_pct, 3),
                    status=status,
                    threshold_pct=threshold,
                )
                all_results.append(entry)

                db.add(AuditLog(**entry))

                log_fn = logger.warning if status == "DRIFT_DETECTED" else logger.info
                log_fn(
                    "[TrustLayer] %s | agency=%s client=%s campaign=%s field=%s "
                    "upstream=%.2f downstream=%.2f drift=%.2f%% threshold=%.1f%%",
                    status, agency_id, client_id, up.campaign_id, field,
                    up_val, ds_val, drift_pct, threshold,
                )

    db.commit()
    return {
        "agency_id": agency_id,
        "client_id": client_id,
        "report_date": str(report_date),
        "total_checks": total,
        "match_count": total - drift,
        "drift_count": drift,
        "drift_pct_overall": round(drift / total * 100, 2) if total else 0.0,
        "results": all_results,
    }


def get_audit_log(
    db: Session, agency_id: str, client_id: str, limit: int = 200
) -> list[dict]:
    """Fetch recent TrustLayer audit entries scoped to (agency_id, client_id)."""
    rows = (
        db.query(AuditLog)
        .filter(AuditLog.agency_id == agency_id, AuditLog.client_id == client_id)
        .order_by(AuditLog.checked_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": r.id,
            "campaign_id": r.campaign_id,
            "platform": r.platform,
            "field": r.field,
            "upstream_value": r.upstream_value,
            "downstream_value": r.downstream_value,
            "drift_pct": r.drift_pct,
            "status": r.status,
            "threshold_pct": r.threshold_pct,
            "checked_at": r.checked_at.isoformat(),
        }
        for r in rows
    ]
