"""
ActionLayer — Optimization Playbook Engine
==========================================
Processes JSON-driven playbook rules with simplified CEL-like logic.

Rule format (PlaybookRule schema):
    {
      "name": "Creative Fatigue + Underpacing",
      "condition_group": {
        "logic": "AND",
        "conditions": [
          {"field": "fatigue_score", "op": ">", "value": 0.8},
          {"field": "pacing_ratio",  "op": "<", "value": 0.9}
        ]
      },
      "action": {
        "type": "create_resolution_ticket",
        "payload": {"priority": "high", "label": "Creative Refresh Required"}
      }
    }

CTR Trend fields automatically added to every context (when DB history exists):
    ctr_7d_avg    – rolling average CTR across the last 7 days for this campaign
    ctr_drop_pct  – percentage by which today's CTR is below ctr_7d_avg
                    (0.0 when today's CTR is equal or above the average)

These fields can be used directly in playbook conditions:
    {"field": "ctr_drop_pct", "op": ">", "value": 20}
    → fires when CTR has dropped more than 20 % below the 7-day average.

Supported ops: > < >= <= == !=
Supported logic connectors: AND, OR

Multi-tenant isolation: all DB writes scoped to (agency_id, client_id).
"""
from __future__ import annotations

import logging
import operator
from datetime import datetime, date, timedelta
from typing import Any

from sqlalchemy.orm import Session

from models import DownstreamMetric, Playbook, ResolutionTicket

logger = logging.getLogger("action_layer")

_OPS: dict[str, Any] = {
    ">":  operator.gt,
    "<":  operator.lt,
    ">=": operator.ge,
    "<=": operator.le,
    "==": operator.eq,
    "!=": operator.ne,
}


def _evaluate_condition(condition: dict, context: dict[str, Any]) -> bool:
    field = condition["field"]
    op_str = condition["op"]
    threshold = condition["value"]
    actual = context.get(field)
    if actual is None:
        logger.debug("[ActionLayer] Field '%s' not in context — condition skipped", field)
        return False
    op_fn = _OPS.get(op_str)
    if op_fn is None:
        raise ValueError(f"Unsupported operator: {op_str!r}")
    try:
        result = op_fn(float(actual), float(threshold))
    except (TypeError, ValueError):
        result = op_fn(str(actual), str(threshold))
    return bool(result)


def _evaluate_group(group: dict, context: dict[str, Any]) -> bool:
    logic = group.get("logic", "AND").upper()
    conditions = group.get("conditions", [])
    if not conditions:
        return False
    results = [_evaluate_condition(c, context) for c in conditions]
    return all(results) if logic == "AND" else any(results)


def _build_context_from_metric(metric: DownstreamMetric) -> dict[str, Any]:
    return {
        "spend":         metric.spend,
        "impressions":   metric.impressions,
        "clicks":        metric.clicks,
        "conversions":   metric.conversions,
        "revenue":       metric.revenue,
        "fatigue_score": metric.fatigue_score,
        "pacing_ratio":  metric.pacing_ratio,
        "ctr":           (metric.clicks / metric.impressions) if metric.impressions else 0.0,
        "cvr":           (metric.conversions / metric.clicks) if metric.clicks else 0.0,
        "roas":          (metric.revenue / metric.spend) if metric.spend else 0.0,
    }


# ─── CTR Trend Enrichment ─────────────────────────────────────────────────────

def _compute_ctr_trend(
    db: Session,
    agency_id: str,
    client_id: str,
    campaign_id: str,
    window_days: int = 7,
) -> dict[str, float]:
    """
    Compute CTR trend for a single campaign over a rolling window.

    Returns a dict with:
        ctr_7d_avg    – mean CTR over the last `window_days` days (0.0 if no data)
        ctr_drop_pct  – how far today's CTR has fallen below the average, as a
                        percentage (0.0 if CTR is equal or higher than average)

    This function queries the DB so the caller must pass a live session.
    It is intentionally lightweight — one indexed query per campaign.
    """
    today = date.today()
    cutoff = today - timedelta(days=window_days)

    # ── Historical window: strictly BEFORE today ────────────────────────────
    # The 7-day average must not include today's own row; otherwise a low
    # today-CTR would deflate the average and under-report the true drop.
    historical = (
        db.query(DownstreamMetric)
        .filter(
            DownstreamMetric.agency_id  == agency_id,
            DownstreamMetric.client_id  == client_id,
            DownstreamMetric.campaign_id == campaign_id,
            DownstreamMetric.date       >= cutoff,
            DownstreamMetric.date       < today,        # exclude today
        )
        .order_by(DownstreamMetric.date.desc())
        .limit(window_days)
        .all()
    )

    # ── Today's row (the reference point for the drop calculation) ──────────
    today_row = (
        db.query(DownstreamMetric)
        .filter(
            DownstreamMetric.agency_id  == agency_id,
            DownstreamMetric.client_id  == client_id,
            DownstreamMetric.campaign_id == campaign_id,
            DownstreamMetric.date       == today,
        )
        .first()
    )

    # No history at all → can't compute a meaningful trend
    if not historical:
        return {"ctr_7d_avg": 0.0, "ctr_drop_pct": 0.0}

    historic_ctrs = [
        (row.clicks / row.impressions) if row.impressions else 0.0
        for row in historical
    ]
    ctr_avg = sum(historic_ctrs) / len(historic_ctrs)

    # ctr_today from today's DB row; fall back to 0.0 if no row for today
    if today_row is not None:
        ctr_today = (today_row.clicks / today_row.impressions) if today_row.impressions else 0.0
    else:
        # No today row yet — treat drop as 0 (no signal, no false positive)
        return {"ctr_7d_avg": round(ctr_avg, 6), "ctr_drop_pct": 0.0}

    if ctr_avg > 0 and ctr_today < ctr_avg:
        drop_pct = ((ctr_avg - ctr_today) / ctr_avg) * 100.0
    else:
        drop_pct = 0.0

    return {
        "ctr_7d_avg":   round(ctr_avg, 6),
        "ctr_drop_pct": round(drop_pct, 2),
    }


def evaluate_playbooks(
    db: Session,
    agency_id: str,
    client_id: str,
    context_override: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Evaluate all active playbooks for a client against their latest downstream metrics.

    Each matching rule fires its action (creates a ticket, logs pause, logs alert).
    Returns structured results with triggered/skipped rule details.
    """
    playbooks = (
        db.query(Playbook)
        .filter(Playbook.agency_id == agency_id, Playbook.active.is_(True))
        .all()
    )

    metrics = (
        db.query(DownstreamMetric)
        .filter(
            DownstreamMetric.agency_id == agency_id,
            DownstreamMetric.client_id == client_id,
        )
        .order_by(DownstreamMetric.date.desc())
        .limit(20)
        .all()
    )

    if not metrics and not context_override:
        return {
            "agency_id": agency_id,
            "client_id": client_id,
            "playbooks_evaluated": len(playbooks),
            "campaigns_checked": 0,
            "triggers": [],
            "message": "No metrics available for this client.",
        }

    triggers: list[dict] = []

    for metric in (metrics or [None]):
        ctx = context_override if context_override is not None else _build_context_from_metric(metric)
        campaign_id = metric.campaign_id if metric else "context_override"

        # Enrich context with CTR trend fields (ctr_7d_avg, ctr_drop_pct).
        # Only meaningful when processing a real metric row (not a context_override).
        if metric is not None and context_override is None:
            ctr_trend = _compute_ctr_trend(db, agency_id, client_id, metric.campaign_id)
            ctx = {**ctx, **ctr_trend}
        elif "ctr_drop_pct" not in ctx:
            # context_override callers can pre-populate ctr_drop_pct; if absent,
            # default to 0 so conditions using it don't crash.
            ctx = {**ctx, "ctr_7d_avg": ctx.get("ctr_7d_avg", 0.0), "ctr_drop_pct": ctx.get("ctr_drop_pct", 0.0)}

        for pb in playbooks:
            rules: list[dict] = pb.rules_json if isinstance(pb.rules_json, list) else []

            for rule in rules:
                rule_name = rule.get("name", "Unnamed Rule")
                cond_group = rule.get("condition_group", {})
                action = rule.get("action", {})

                matched = _evaluate_group(cond_group, ctx)

                if matched:
                    action_type = action.get("type", "send_alert")
                    action_payload = action.get("payload", {})

                    ticket = ResolutionTicket(
                        agency_id=agency_id,
                        client_id=client_id,
                        campaign_id=campaign_id,
                        playbook_id=pb.id,
                        rule_name=rule_name,
                        trigger_data=ctx,
                        action_type=action_type,
                        action_payload=action_payload,
                        status="open",
                    )
                    db.add(ticket)

                    pb.trigger_count += 1
                    pb.last_triggered = datetime.utcnow()

                    trigger_entry = {
                        "playbook": pb.name,
                        "rule": rule_name,
                        "campaign_id": campaign_id,
                        "action_type": action_type,
                        "action_payload": action_payload,
                        "context_snapshot": ctx,
                        "result": "TRIGGERED",
                    }
                    triggers.append(trigger_entry)

                    logger.warning(
                        "[ActionLayer] TRIGGERED | agency=%s client=%s playbook=%r rule=%r action=%s",
                        agency_id, client_id, pb.name, rule_name, action_type,
                    )
                else:
                    logger.debug(
                        "[ActionLayer] SKIPPED | agency=%s client=%s playbook=%r rule=%r",
                        agency_id, client_id, pb.name, rule_name,
                    )

    db.commit()

    return {
        "agency_id": agency_id,
        "client_id": client_id,
        "playbooks_evaluated": len(playbooks),
        "campaigns_checked": len(metrics),
        "triggers": triggers,
        "trigger_count": len(triggers),
    }


def get_playbooks(db: Session, agency_id: str) -> list[dict]:
    """List all playbooks for an agency (path-based isolation)."""
    rows = (
        db.query(Playbook)
        .filter(Playbook.agency_id == agency_id)
        .order_by(Playbook.created_at.desc())
        .all()
    )
    return [
        {
            "id": r.id,
            "name": r.name,
            "description": r.description,
            "active": r.active,
            "trigger_count": r.trigger_count,
            "last_triggered": r.last_triggered.isoformat() if r.last_triggered else None,
            "rules_json": r.rules_json,
        }
        for r in rows
    ]
