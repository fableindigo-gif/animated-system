from datetime import datetime, date
from typing import Any, Literal
from pydantic import BaseModel, Field


class AgencyCreate(BaseModel):
    id: str
    name: str
    plan: str = "starter"


class ClientCreate(BaseModel):
    id: str
    name: str
    slug: str
    goal: Literal["ecom", "leadgen", "hybrid"] = "ecom"


class DownstreamMetricUpsert(BaseModel):
    campaign_id: str
    platform: Literal["google_ads", "facebook_ads", "meta_ads"]
    date: date
    spend: float = 0.0
    impressions: int = 0
    clicks: int = 0
    conversions: int = 0
    revenue: float = 0.0
    fatigue_score: float = Field(0.0, ge=0.0, le=1.0)
    pacing_ratio: float = Field(1.0, ge=0.0)


class RuleCondition(BaseModel):
    field: str
    op: Literal[">", "<", ">=", "<=", "==", "!="]
    value: float | str | bool


class RuleGroup(BaseModel):
    logic: Literal["AND", "OR"] = "AND"
    conditions: list[RuleCondition]


class RuleAction(BaseModel):
    type: Literal["create_resolution_ticket", "pause_campaign", "send_alert"]
    payload: dict[str, Any] = {}


class PlaybookRule(BaseModel):
    name: str
    condition_group: RuleGroup
    action: RuleAction


class PlaybookCreate(BaseModel):
    name: str
    description: str = ""
    rules_json: list[PlaybookRule]


class OrderWebhook(BaseModel):
    order_id: str
    agency_id: str
    client_id: str
    revenue: float
    cogs: float
    shipping: float
    fees: float
    event_date: date

    # ── Stripe / Shopify processing-fee auto-computation ──────────────────────
    # When `auto_compute_fees` is True (the default) the ProfitLayer will
    # replace the caller-supplied `fees` value with:
    #   fees = (revenue × stripe_fee_rate) + stripe_flat_fee
    # This matches the Stripe standard rate (2.9 % + $0.30 per transaction).
    # Shopify Payments uses the same economics as Stripe Checkout.
    # Callers that track processing fees from their Stripe Dashboard directly
    # should set `auto_compute_fees=False` and pass the exact `fees` amount.
    auto_compute_fees:  bool  = True
    stripe_fee_rate:    float = Field(0.029, ge=0.0, le=1.0,
                                      description="Payment processing % rate (default: Stripe standard 2.9%)")
    stripe_flat_fee:    float = Field(0.30,  ge=0.0,
                                      description="Per-transaction flat fee in USD (default: Stripe standard $0.30)")


class ReconcileResponse(BaseModel):
    agency_id: str
    client_id: str
    total_checks: int
    match_count: int
    drift_count: int
    drift_pct_overall: float
    results: list[dict[str, Any]]


class POASResponse(BaseModel):
    agency_id: str
    client_id: str
    date: date
    revenue: float
    ad_spend: float
    cogs: float
    shipping: float
    fees: float
    true_profit: float
    poas: float
    order_count: int
    margin_status: str


class HealthScore(BaseModel):
    agency_id: str
    client_id: str
    client_name: str
    trust_score: float
    action_score: float
    profit_score: float
    health_score: float
    alerts: list[str]


class SweepRequest(BaseModel):
    agency_ids: list[str] = []
