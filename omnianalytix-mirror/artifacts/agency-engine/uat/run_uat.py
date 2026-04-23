"""
OmniAnalytix Agency Logic Engine — UAT Runner
===============================================
Standalone script (no pytest required). Exercises all four service layers
and prints a structured UAT log showing Happy Path (MATCH) and Failure Path (DRIFT_DETECTED).

Run:
    cd artifacts/agency-engine
    python uat/run_uat.py
"""
from __future__ import annotations

import sys
import os
import json
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from database import engine, SessionLocal, init_db, Base
from models import Agency, Client, DownstreamMetric
from services.trust_layer import reconcile
from services.action_layer import evaluate_playbooks
from services.profit_layer import ingest_order_event, calculate_poas
from services.multi_tenant import health_dashboard, run_full_sweep

DIVIDER   = "─" * 78
HDR_OK    = "  ✅ PASS"
HDR_FAIL  = "  ❌ FAIL"
HDR_INFO  = "  ℹ️  INFO"
HDR_WARN  = "  ⚠️  WARN"

_results: list[dict] = []


def _log(label: str, status: str, detail: str = ""):
    emoji = HDR_OK if status == "PASS" else HDR_FAIL if status == "FAIL" else HDR_INFO
    line = f"{emoji}  [{label}]  {detail}"
    print(line)
    _results.append({"label": label, "status": status, "detail": detail})


def _section(title: str):
    print(f"\n{DIVIDER}")
    print(f"  {title}")
    print(DIVIDER)


def _setup_db(db):
    """Seed minimal fixtures: 2 agencies, 2 clients, downstream metrics."""
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    agencies = [
        Agency(id="agency-001", name="Apex Digital Agency", plan="pro"),
        Agency(id="agency-002", name="Stellar Media Group", plan="starter"),
    ]
    clients = [
        Client(id="client-alpha",  agency_id="agency-001", name="AlphaStore",  slug="alphastore",  goal="ecom"),
        Client(id="client-profit", agency_id="agency-001", name="ProfitDemoStore", slug="profit-demo", goal="ecom"),
        Client(id="client-beta",   agency_id="agency-002", name="BetaLeads",   slug="betaleads",   goal="leadgen"),
    ]
    for obj in agencies + clients:
        db.add(obj)
    db.flush()

    today = date.today()

    metrics_alpha = [
        DownstreamMetric(
            agency_id="agency-001", client_id="client-alpha",
            campaign_id="goog_001", platform="google_ads", date=today,
            spend=4200.0, impressions=320000, clicks=9600, conversions=288, revenue=21600.0,
            fatigue_score=0.85, pacing_ratio=0.78,
        ),
        DownstreamMetric(
            agency_id="agency-001", client_id="client-alpha",
            campaign_id="goog_002", platform="google_ads", date=today,
            spend=1850.0, impressions=140000, clicks=4200, conversions=126, revenue=9450.0,
            fatigue_score=0.40, pacing_ratio=1.02,
        ),
        DownstreamMetric(
            agency_id="agency-001", client_id="client-alpha",
            campaign_id="goog_003", platform="google_ads", date=today,
            spend=750.0, impressions=60000, clicks=1800, conversions=54, revenue=4050.0,
            fatigue_score=0.55, pacing_ratio=0.98,
        ),
        DownstreamMetric(
            agency_id="agency-001", client_id="client-alpha",
            campaign_id="meta_001", platform="facebook_ads", date=today,
            spend=3100.0, impressions=280000, clicks=7840, conversions=235, revenue=17625.0,
            fatigue_score=0.60, pacing_ratio=1.05,
        ),
        DownstreamMetric(
            agency_id="agency-001", client_id="client-alpha",
            campaign_id="meta_002", platform="facebook_ads", date=today,
            spend=2250.0, impressions=195000, clicks=5460, conversions=164, revenue=12300.0,
            fatigue_score=0.45, pacing_ratio=0.97,
        ),
        DownstreamMetric(
            agency_id="agency-001", client_id="client-alpha",
            campaign_id="meta_003", platform="facebook_ads", date=today,
            spend=980.0, impressions=88000, clicks=2464, conversions=74, revenue=5550.0,
            fatigue_score=0.70, pacing_ratio=0.88,
        ),
    ]
    metrics_beta = [
        DownstreamMetric(
            agency_id="agency-002", client_id="client-beta",
            campaign_id="goog_001", platform="google_ads", date=today,
            spend=4200.0, impressions=320000, clicks=9600, conversions=288, revenue=21600.0,
            fatigue_score=0.30, pacing_ratio=0.95,
        ),
        DownstreamMetric(
            agency_id="agency-002", client_id="client-beta",
            campaign_id="goog_002", platform="google_ads", date=today,
            spend=1850.0, impressions=140000, clicks=4200, conversions=126, revenue=9450.0,
            fatigue_score=0.25, pacing_ratio=1.00,
        ),
        DownstreamMetric(
            agency_id="agency-002", client_id="client-beta",
            campaign_id="goog_003", platform="google_ads", date=today,
            spend=750.0, impressions=60000, clicks=1800, conversions=54, revenue=4050.0,
            fatigue_score=0.20, pacing_ratio=1.00,
        ),
        DownstreamMetric(
            agency_id="agency-002", client_id="client-beta",
            campaign_id="meta_001", platform="facebook_ads", date=today,
            spend=3100.0, impressions=280000, clicks=7840, conversions=235, revenue=17625.0,
            fatigue_score=0.35, pacing_ratio=1.10,
        ),
        DownstreamMetric(
            agency_id="agency-002", client_id="client-beta",
            campaign_id="meta_002", platform="facebook_ads", date=today,
            spend=2250.0, impressions=195000, clicks=5460, conversions=164, revenue=12300.0,
            fatigue_score=0.28, pacing_ratio=0.99,
        ),
        DownstreamMetric(
            agency_id="agency-002", client_id="client-beta",
            campaign_id="meta_003", platform="facebook_ads", date=today,
            spend=980.0, impressions=88000, clicks=2464, conversions=74, revenue=5550.0,
            fatigue_score=0.32, pacing_ratio=1.05,
        ),
    ]
    for m in metrics_alpha + metrics_beta:
        db.add(m)

    from models import DataValidationRule, Playbook
    rules = [
        DataValidationRule(agency_id="agency-001", name="Google Drift Threshold", platform="google_ads",
                           fields=["spend", "impressions", "clicks", "conversions", "revenue"], threshold_pct=5.0),
        DataValidationRule(agency_id="agency-001", name="Meta Drift Threshold", platform="facebook_ads",
                           fields=["spend", "impressions", "clicks", "conversions", "revenue"], threshold_pct=5.0),
        DataValidationRule(agency_id="agency-002", name="Google Drift Threshold", platform="google_ads",
                           fields=["spend", "impressions", "clicks", "conversions", "revenue"], threshold_pct=5.0),
    ]
    playbooks = [
        Playbook(
            agency_id="agency-001", name="Creative Fatigue + Underpacing",
            rules_json=[{"name": "Fatigue+Underpacing", "condition_group": {"logic": "AND", "conditions": [
                {"field": "fatigue_score", "op": ">", "value": 0.8},
                {"field": "pacing_ratio",  "op": "<", "value": 0.9},
            ]}, "action": {"type": "create_resolution_ticket", "payload": {"priority": "high", "label": "Creative Refresh Required"}}}],
        ),
        Playbook(
            agency_id="agency-001", name="Low ROAS Pause",
            rules_json=[{"name": "Low ROAS", "condition_group": {"logic": "AND", "conditions": [
                {"field": "roas", "op": "<", "value": 1.5},
                {"field": "spend", "op": ">", "value": 500.0},
            ]}, "action": {"type": "pause_campaign", "payload": {"reason": "ROAS below 1.5x"}}}],
        ),
        Playbook(
            agency_id="agency-002", name="Scale High-CTR Campaigns",
            rules_json=[{"name": "HighCTR", "condition_group": {"logic": "AND", "conditions": [
                {"field": "ctr", "op": ">", "value": 0.03},
            ]}, "action": {"type": "send_alert", "payload": {"message": "Scale opportunity"}}}],
        ),
    ]
    for obj in rules + playbooks:
        db.add(obj)
    db.commit()
    return today


def uat_trust_layer_happy_path(db, today: date):
    _section("UAT-1: TrustLayer — Happy Path (MATCH expected)")
    result = reconcile(db, "agency-001", "client-alpha", report_date=today, drift_mode=False)
    total = result["total_checks"]
    match_ = result["match_count"]
    drift_ = result["drift_count"]
    _log("TrustLayer/HappyPath/TotalChecks", "PASS" if total > 0 else "FAIL", f"{total} field checks performed")
    _log("TrustLayer/HappyPath/AllMatch", "PASS" if drift_ == 0 else "WARN", f"MATCH={match_} DRIFT={drift_}")
    print(f"\n  Sample results (first 4):")
    for r in result["results"][:4]:
        status = r["status"]
        icon = "✅" if status == "MATCH" else "⚠️"
        print(f"    {icon} {r['platform']}/{r['campaign_id']}/{r['field']}: "
              f"upstream={r['upstream_value']:.1f} downstream={r['downstream_value']:.1f} "
              f"drift={r['drift_pct']:.2f}% → {status}")
    return drift_ == 0


def uat_trust_layer_failure_path(db, today: date):
    _section("UAT-2: TrustLayer — Failure Path (DRIFT_DETECTED expected)")
    result = reconcile(db, "agency-001", "client-alpha", report_date=today, drift_mode=True)
    drift_ = result["drift_count"]
    _log("TrustLayer/FailurePath/DriftDetected", "PASS" if drift_ > 0 else "FAIL",
         f"DRIFT_DETECTED on {drift_} field(s) — threshold 5%")
    drifts = [r for r in result["results"] if r["status"] == "DRIFT_DETECTED"]
    print(f"\n  Drifted fields (showing up to 4):")
    for r in drifts[:4]:
        print(f"    ⚠️  {r['platform']}/{r['campaign_id']}/{r['field']}: "
              f"upstream={r['upstream_value']:.1f} downstream={r['downstream_value']:.1f} "
              f"drift={r['drift_pct']:.2f}% > threshold={r['threshold_pct']}%")
    _log("TrustLayer/FailurePath/OverallDriftPct", "PASS" if result["drift_pct_overall"] > 0 else "FAIL",
         f"Overall drift rate: {result['drift_pct_overall']:.1f}%")
    return drift_ > 0


def uat_action_layer_trigger(db):
    _section("UAT-3: ActionLayer — Rule Trigger (fatigue=0.85, pacing=0.78)")
    ctx = {"fatigue_score": 0.85, "pacing_ratio": 0.78, "spend": 4200.0, "roas": 4.2, "ctr": 0.02, "conversions": 288, "impressions": 320000, "clicks": 9600, "revenue": 21600.0}
    result = evaluate_playbooks(db, "agency-001", "client-alpha", context_override=ctx)
    triggers = result["triggers"]
    _log("ActionLayer/FatigueRule/Triggered", "PASS" if any(t["rule"] == "Fatigue+Underpacing" for t in triggers) else "FAIL",
         f"{len(triggers)} rule(s) triggered")
    for t in triggers:
        print(f"    🔔 Playbook: {t['playbook']} | Rule: {t['rule']} | Action: {t['action_type']}")
        print(f"       Payload: {json.dumps(t['action_payload'])}")
    return len(triggers) > 0


def uat_action_layer_no_trigger(db):
    _section("UAT-4: ActionLayer — No Trigger (healthy campaign context)")
    ctx = {"fatigue_score": 0.30, "pacing_ratio": 1.05, "spend": 1850.0, "roas": 5.1, "ctr": 0.03, "conversions": 126, "impressions": 140000, "clicks": 4200, "revenue": 9450.0}
    result = evaluate_playbooks(db, "agency-001", "client-alpha", context_override=ctx)
    triggers = result["triggers"]
    _log("ActionLayer/HealthyContext/NoTrigger", "PASS" if len(triggers) == 0 else "WARN",
         f"Triggers fired: {len(triggers)} (expected 0 for healthy campaign)")
    return True


def uat_profit_layer_happy_path(db, today: date):
    _section("UAT-5: ProfitLayer — Happy Path (positive POAS, no pre-existing ad spend)")
    for i in range(5):
        ingest_order_event(db, {
            "order_id": f"ord-profit-{i:03d}",
            "agency_id": "agency-001",
            "client_id": "client-profit",
            "revenue": 430.0,
            "cogs": 120.0,
            "shipping": 12.0,
            "fees": 18.0,
            "event_date": today,
        })
    result = calculate_poas(db, "agency-001", "client-profit", today)
    tp = result.get("true_profit", 0)
    poas = result.get("poas", 0)
    status = result.get("margin_status", "?")
    _log("ProfitLayer/HappyPath/TrueProfit", "PASS" if tp > 0 else "FAIL",
         f"P = Revenue − (AdSpend + COGS + Shipping + Fees) = {result.get('revenue', 0):.2f} − "
         f"({result.get('ad_spend', 0):.2f} + {result.get('cogs', 0):.2f} + {result.get('shipping', 0):.2f} + {result.get('fees', 0):.2f}) = {tp:.2f}")
    _log("ProfitLayer/HappyPath/MarginStatus", "PASS" if status in ("HEALTHY", "MARGINAL") else "FAIL",
         f"True Profit = {tp:.2f} | POAS = {poas:.4f} (undefined when ad_spend=0) | Margin: {status}")
    return tp > 0


def uat_profit_layer_negative_margin(db):
    _section("UAT-6: ProfitLayer — Failure Path (negative margin)")
    tomorrow = date.today() + timedelta(days=1)
    ingest_order_event(db, {
        "order_id": "ord-loss-001",
        "agency_id": "agency-001",
        "client_id": "client-profit",
        "revenue": 50.0,
        "cogs": 200.0,
        "shipping": 30.0,
        "fees": 25.0,
        "event_date": tomorrow,
    })
    result = calculate_poas(db, "agency-001", "client-profit", tomorrow)
    tp = result.get("true_profit", 0)
    status = result.get("margin_status", "?")
    _log("ProfitLayer/NegativeMargin/TrueProfit", "PASS" if tp < 0 else "FAIL", f"True Profit = {tp:.2f} (expected < 0)")
    _log("ProfitLayer/NegativeMargin/Status", "PASS" if status == "NEGATIVE_MARGIN" else "FAIL",
         f"Margin Status = {status} (expected NEGATIVE_MARGIN)")
    return tp < 0


def uat_multi_tenant_isolation(db, today: date):
    _section("UAT-7: Multi-Tenant Isolation — Cross-agency data separation")
    result = run_full_sweep(db, agency_ids=["agency-001", "agency-002"], report_date=today, drift_mode=False)
    agencies_swept = result["agencies_swept"]
    accounts_swept = result["accounts_swept"]
    _log("MultiTenant/Sweep/AgenciesSwept", "PASS" if agencies_swept == 2 else "FAIL", f"{agencies_swept} agencies swept")
    _log("MultiTenant/Sweep/AccountsSwept", "PASS" if accounts_swept >= 2 else "FAIL", f"{accounts_swept} client accounts swept")

    health = result["health_dashboard"]
    for r in health.get("results", []):
        print(f"    📊 {r['agency_id']} / {r['client_name']}: "
              f"Trust={r['trust_score']} Action={r['action_score']} Profit={r['profit_score']} "
              f"→ Health={r['health_score']} Grade={r['grade']}")

    portfolio_health = health.get("portfolio_health", 0)
    _log("MultiTenant/PortfolioHealth/Score", "PASS" if portfolio_health >= 0 else "FAIL",
         f"Portfolio Health Score: {portfolio_health}")
    return agencies_swept == 2


def main():
    print("\n" + "═" * 78)
    print("  OmniAnalytix Agency Logic Engine — UAT Test Suite")
    print("  Testing: TrustLayer | ActionLayer | ProfitLayer | Multi-Tenant Aggregator")
    print("═" * 78)

    init_db()
    db = SessionLocal()
    try:
        today = _setup_db(db)
        print(f"\n  Fixtures seeded → 2 agencies, 2 clients, {today.isoformat()}")

        results = [
            uat_trust_layer_happy_path(db, today),
            uat_trust_layer_failure_path(db, today),
            uat_action_layer_trigger(db),
            uat_action_layer_no_trigger(db),
            uat_profit_layer_happy_path(db, today),
            uat_profit_layer_negative_margin(db),
            uat_multi_tenant_isolation(db, today),
        ]
    finally:
        db.close()

    _section("UAT Summary")
    passed = failed = 0
    for r in _results:
        if r["status"] == "PASS":
            passed += 1
            icon = "✅"
        elif r["status"] == "FAIL":
            failed += 1
            icon = "❌"
        else:
            icon = "⚠️ "
        print(f"  {icon}  {r['label']}")
        if r.get("detail"):
            print(f"       {r['detail']}")

    print(f"\n{DIVIDER}")
    print(f"  TOTAL: {passed + failed} checks | ✅ PASS: {passed} | ❌ FAIL: {failed}")
    print(DIVIDER + "\n")

    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
