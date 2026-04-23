"""
ProfitLayer — Real-Time POAS Calculator
========================================
Formula: True Profit (P) = Revenue - (AdSpend + COGS + Shipping + Fees)
POAS   = True Profit / AdSpend

Processing fee sources:
  • Stripe standard rate   — 2.9 % of revenue + $0.30 per transaction
  • Shopify Payments        — identical economics to Stripe Checkout
  When an OrderWebhook arrives with `auto_compute_fees=True` (the default),
  the `fees` value is replaced with: (revenue × stripe_fee_rate) + stripe_flat_fee.
  This ensures the P formula always captures real payment processing costs even
  when the upstream order system does not break out fees explicitly.

Integrates with mocked real-time order webhooks.
Multi-tenant isolation: all DB reads/writes scoped to (agency_id, client_id).
"""
from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Any

from sqlalchemy.orm import Session
from sqlalchemy import func

from models import DailyPnL, DownstreamMetric, OrderEvent

logger = logging.getLogger("profit_layer")

# ── Stripe / Shopify Payments default rate ────────────────────────────────────
# Stripe standard: 2.9 % + $0.30 per successful transaction.
# Shopify Payments (powered by Stripe) uses identical economics.
# These constants are the fallback when no override is provided via the webhook.
_DEFAULT_STRIPE_FEE_RATE: float = 0.029   # 2.9 %
_DEFAULT_STRIPE_FLAT_FEE: float = 0.30    # $0.30 per transaction


def compute_stripe_processing_fee(
    revenue: float,
    fee_rate: float = _DEFAULT_STRIPE_FEE_RATE,
    flat_fee: float = _DEFAULT_STRIPE_FLAT_FEE,
) -> float:
    """
    Compute the Stripe / Shopify Payments processing fee for a single order.

    Formula:  fee = (revenue × fee_rate) + flat_fee

    Args:
        revenue:   Gross order revenue (before any deductions).
        fee_rate:  Percentage rate as a decimal (default 0.029 = 2.9 %).
        flat_fee:  Flat per-transaction charge in USD (default $0.30).

    Returns:
        Computed fee amount rounded to 2 decimal places.
    """
    return round(revenue * fee_rate + flat_fee, 2)


def ingest_order_event(db: Session, event: dict[str, Any]) -> dict[str, Any]:
    """
    Ingest a mock order webhook and upsert the DailyPnL record.

    Called by POST /profit/webhook/order — treated as a real-time event.

    Stripe / Shopify fee auto-computation
    ──────────────────────────────────────
    When `event["auto_compute_fees"]` is True (the default from the schema),
    the `fees` value is replaced with the Stripe formula:

        fees = (revenue × stripe_fee_rate) + stripe_flat_fee

    This prevents callers from accidentally omitting payment processing costs,
    which would silently overstate True Profit.  The computed fee is logged
    alongside the raw `fees` supplied by the caller for auditability.
    """
    agency_id  = event["agency_id"]
    client_id  = event["client_id"]
    event_date = (event["event_date"] if isinstance(event["event_date"], date)
                  else date.fromisoformat(event["event_date"]))

    revenue  = float(event["revenue"])
    raw_fees = float(event.get("fees", 0.0))

    # ── Stripe processing fee computation ────────────────────────────────────
    if event.get("auto_compute_fees", True):
        fee_rate    = float(event.get("stripe_fee_rate", _DEFAULT_STRIPE_FEE_RATE))
        flat_fee    = float(event.get("stripe_flat_fee", _DEFAULT_STRIPE_FLAT_FEE))
        computed_fees = compute_stripe_processing_fee(revenue, fee_rate, flat_fee)
        logger.info(
            "[ProfitLayer] Stripe fee auto-computed | order=%s revenue=%.2f "
            "rate=%.3f flat=%.2f computed_fees=%.2f caller_fees=%.2f",
            event["order_id"], revenue, fee_rate, flat_fee, computed_fees, raw_fees,
        )
        fees = computed_fees
    else:
        fees = raw_fees
        logger.info(
            "[ProfitLayer] Using caller-supplied fees | order=%s fees=%.2f",
            event["order_id"], fees,
        )

    db.add(OrderEvent(
        agency_id=agency_id,
        client_id=client_id,
        order_id=event["order_id"],
        revenue=revenue,
        cogs=float(event.get("cogs", 0.0)),
        shipping=float(event.get("shipping", 0.0)),
        fees=fees,
        event_date=event_date,
    ))
    db.flush()

    _refresh_daily_pnl(db, agency_id, client_id, event_date)
    db.commit()

    pnl = _get_pnl_record(db, agency_id, client_id, event_date)
    logger.info(
        "[ProfitLayer] OrderEvent ingested | agency=%s client=%s order=%s date=%s "
        "revenue=%.2f true_profit=%.2f poas=%.3f",
        agency_id, client_id, event["order_id"], event_date,
        pnl.revenue if pnl else 0, pnl.true_profit if pnl else 0, pnl.poas if pnl else 0,
    )
    return _pnl_to_dict(pnl) if pnl else {}


def _refresh_daily_pnl(db: Session, agency_id: str, client_id: str, target_date: date) -> None:
    """Aggregate all OrderEvents for the day and upsert DailyPnL."""
    totals = (
        db.query(
            func.sum(OrderEvent.revenue).label("revenue"),
            func.sum(OrderEvent.cogs).label("cogs"),
            func.sum(OrderEvent.shipping).label("shipping"),
            func.sum(OrderEvent.fees).label("fees"),
            func.count(OrderEvent.id).label("order_count"),
        )
        .filter(
            OrderEvent.agency_id == agency_id,
            OrderEvent.client_id == client_id,
            OrderEvent.event_date == target_date,
        )
        .one()
    )

    spend_row = (
        db.query(func.sum(DownstreamMetric.spend).label("total_spend"))
        .filter(
            DownstreamMetric.agency_id == agency_id,
            DownstreamMetric.client_id == client_id,
            DownstreamMetric.date == target_date,
        )
        .one()
    )

    revenue = float(totals.revenue or 0)
    cogs = float(totals.cogs or 0)
    shipping = float(totals.shipping or 0)
    fees = float(totals.fees or 0)
    ad_spend = float(spend_row.total_spend or 0)
    order_count = int(totals.order_count or 0)

    true_profit = revenue - (ad_spend + cogs + shipping + fees)
    poas = round(true_profit / ad_spend, 4) if ad_spend > 0 else 0.0

    existing = _get_pnl_record(db, agency_id, client_id, target_date)
    if existing:
        existing.revenue = revenue
        existing.ad_spend = ad_spend
        existing.cogs = cogs
        existing.shipping = shipping
        existing.fees = fees
        existing.true_profit = true_profit
        existing.poas = poas
        existing.order_count = order_count
        existing.updated_at = datetime.utcnow()
    else:
        db.add(DailyPnL(
            agency_id=agency_id,
            client_id=client_id,
            date=target_date,
            revenue=revenue,
            ad_spend=ad_spend,
            cogs=cogs,
            shipping=shipping,
            fees=fees,
            true_profit=true_profit,
            poas=poas,
            order_count=order_count,
        ))

    margin_status = _margin_status(true_profit, revenue)
    logger.info(
        "[ProfitLayer] P&L refreshed | agency=%s client=%s date=%s "
        "revenue=%.2f ad_spend=%.2f cogs=%.2f shipping=%.2f fees=%.2f "
        "true_profit=%.2f poas=%.4f status=%s",
        agency_id, client_id, target_date,
        revenue, ad_spend, cogs, shipping, fees, true_profit, poas, margin_status,
    )


def _get_pnl_record(db: Session, agency_id: str, client_id: str, target_date: date) -> DailyPnL | None:
    return (
        db.query(DailyPnL)
        .filter(
            DailyPnL.agency_id == agency_id,
            DailyPnL.client_id == client_id,
            DailyPnL.date == target_date,
        )
        .first()
    )


def get_poas(db: Session, agency_id: str, client_id: str, target_date: date) -> dict[str, Any] | None:
    """Return POAS record for a specific date (path-based isolation enforced)."""
    record = _get_pnl_record(db, agency_id, client_id, target_date)
    return _pnl_to_dict(record) if record else None


def calculate_poas(
    db: Session,
    agency_id: str,
    client_id: str,
    target_date: date | None = None,
) -> dict[str, Any]:
    """Recompute POAS for a date by re-aggregating all order events."""
    target_date = target_date or date.today()
    _refresh_daily_pnl(db, agency_id, client_id, target_date)
    db.commit()
    record = _get_pnl_record(db, agency_id, client_id, target_date)
    return _pnl_to_dict(record) if record else {
        "agency_id": agency_id,
        "client_id": client_id,
        "date": str(target_date),
        "message": "No order events found for this date.",
    }


def _margin_status(true_profit: float, revenue: float) -> str:
    if true_profit < 0:
        return "NEGATIVE_MARGIN"
    if revenue == 0:
        return "NO_REVENUE"
    margin_pct = true_profit / revenue * 100
    if margin_pct >= 20:
        return "HEALTHY"
    if margin_pct >= 10:
        return "MARGINAL"
    return "AT_RISK"


def _pnl_to_dict(record: DailyPnL) -> dict[str, Any]:
    return {
        "agency_id": record.agency_id,
        "client_id": record.client_id,
        "date": str(record.date),
        "revenue": record.revenue,
        "ad_spend": record.ad_spend,
        "cogs": record.cogs,
        "shipping": record.shipping,
        "fees": record.fees,
        "true_profit": record.true_profit,
        "poas": record.poas,
        "order_count": record.order_count,
        "margin_status": _margin_status(record.true_profit, record.revenue),
    }
