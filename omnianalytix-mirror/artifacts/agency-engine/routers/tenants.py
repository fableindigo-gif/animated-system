from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import Agency, Client, DownstreamMetric, Playbook, DataValidationRule
from schemas import AgencyCreate, ClientCreate, DownstreamMetricUpsert, SweepRequest
from services.multi_tenant import health_dashboard, run_full_sweep

router = APIRouter(prefix="/tenants", tags=["Multi-Tenant"])


@router.post("/agencies", summary="Register a new agency", status_code=201)
def create_agency(body: AgencyCreate, db: Session = Depends(get_db)):
    """Create a top-level agency. All sub-resources inherit agency_id isolation."""
    if db.query(Agency).filter(Agency.id == body.id).first():
        raise HTTPException(status_code=409, detail=f"Agency '{body.id}' already exists")
    agency = Agency(id=body.id, name=body.name, plan=body.plan)
    db.add(agency)
    db.commit()
    return {"id": agency.id, "name": agency.name, "plan": agency.plan}


@router.post("/agencies/{agency_id}/clients", summary="Register a client under an agency", status_code=201)
def create_client(agency_id: str, body: ClientCreate, db: Session = Depends(get_db)):
    """Register a client under an agency (enforces agency_id path isolation)."""
    if not db.query(Agency).filter(Agency.id == agency_id).first():
        raise HTTPException(status_code=404, detail=f"Agency '{agency_id}' not found")
    if db.query(Client).filter(Client.id == body.id).first():
        raise HTTPException(status_code=409, detail=f"Client '{body.id}' already exists")
    client = Client(id=body.id, agency_id=agency_id, name=body.name, slug=body.slug, goal=body.goal)
    db.add(client)
    db.commit()
    return {"id": client.id, "agency_id": agency_id, "name": client.name}


@router.post("/agencies/{agency_id}/clients/{client_id}/metrics", summary="Upsert downstream metrics")
def upsert_metrics(agency_id: str, client_id: str, body: DownstreamMetricUpsert, db: Session = Depends(get_db)):
    """
    Upsert a downstream metric row for a client.
    This is what the ETL pipeline writes — TrustLayer reads from this table.
    """
    existing = (
        db.query(DownstreamMetric)
        .filter(
            DownstreamMetric.agency_id == agency_id,
            DownstreamMetric.client_id == client_id,
            DownstreamMetric.campaign_id == body.campaign_id,
            DownstreamMetric.date == body.date,
            DownstreamMetric.platform == body.platform,
        )
        .first()
    )
    if existing:
        for field, val in body.model_dump(exclude={"campaign_id", "date", "platform"}).items():
            setattr(existing, field, val)
        db.commit()
        return {"updated": True, "id": existing.id}
    else:
        m = DownstreamMetric(agency_id=agency_id, client_id=client_id, **body.model_dump())
        db.add(m)
        db.commit()
        return {"created": True, "id": m.id}


@router.post("/agencies/{agency_id}/playbooks/seed", summary="Seed default playbooks for an agency")
def seed_playbooks(agency_id: str, db: Session = Depends(get_db)):
    """Seed the two canonical agency playbooks for testing."""
    if not db.query(Agency).filter(Agency.id == agency_id).first():
        raise HTTPException(status_code=404, detail=f"Agency '{agency_id}' not found")

    playbooks = [
        Playbook(
            agency_id=agency_id,
            name="Creative Fatigue + Underpacing Alert",
            description="Triggers when creative fatigue is high and campaign is pacing below budget.",
            rules_json=[{
                "name": "Fatigue+Underpacing",
                "condition_group": {"logic": "AND", "conditions": [
                    {"field": "fatigue_score", "op": ">", "value": 0.8},
                    {"field": "pacing_ratio",  "op": "<", "value": 0.9},
                ]},
                "action": {"type": "create_resolution_ticket", "payload": {"priority": "high", "label": "Creative Refresh Required"}},
            }],
        ),
        Playbook(
            agency_id=agency_id,
            name="Low ROAS Campaign Pause",
            description="Pauses campaigns where ROAS drops below 1.5.",
            rules_json=[{
                "name": "Low ROAS",
                "condition_group": {"logic": "AND", "conditions": [
                    {"field": "roas", "op": "<", "value": 1.5},
                    {"field": "spend", "op": ">", "value": 500.0},
                ]},
                "action": {"type": "pause_campaign", "payload": {"reason": "ROAS below threshold"}},
            }],
        ),
        Playbook(
            agency_id=agency_id,
            name="High-CTR Scale Opportunity",
            description="Alerts when CTR exceeds 3% — potential scale opportunity.",
            rules_json=[{
                "name": "HighCTR",
                "condition_group": {"logic": "AND", "conditions": [
                    {"field": "ctr", "op": ">", "value": 0.03},
                    {"field": "conversions", "op": ">", "value": 50},
                ]},
                "action": {"type": "send_alert", "payload": {"message": "Scale budget — high CTR opportunity detected"}},
            }],
        ),
    ]
    for pb in playbooks:
        db.add(pb)
    db.commit()
    return {"seeded": len(playbooks), "agency_id": agency_id}


@router.post("/agencies/{agency_id}/validation-rules/seed", summary="Seed default data validation rules")
def seed_validation_rules(agency_id: str, db: Session = Depends(get_db)):
    """Seed TrustLayer thresholds for Google Ads and Facebook Ads."""
    if not db.query(Agency).filter(Agency.id == agency_id).first():
        raise HTTPException(status_code=404, detail=f"Agency '{agency_id}' not found")
    rules = [
        DataValidationRule(
            agency_id=agency_id, name="Google Ads Drift Threshold",
            platform="google_ads", fields=["spend", "impressions", "clicks", "conversions", "revenue"],
            threshold_pct=5.0,
        ),
        DataValidationRule(
            agency_id=agency_id, name="Facebook Ads Drift Threshold",
            platform="facebook_ads", fields=["spend", "impressions", "clicks", "conversions", "revenue"],
            threshold_pct=5.0,
        ),
    ]
    for r in rules:
        db.add(r)
    db.commit()
    return {"seeded": len(rules), "agency_id": agency_id}


@router.get("/health-dashboard", summary="Portfolio health dashboard (all agencies)")
def health_dashboard_endpoint(db: Session = Depends(get_db)):
    """Aggregate health scores across all agencies. Path-based isolation enforced per account."""
    return health_dashboard(db)


@router.post("/sweep", summary="Trigger Master Diagnostic Sweep")
def trigger_sweep(body: SweepRequest, db: Session = Depends(get_db)):
    """
    Trigger a Master Diagnostic Sweep.
    Runs inline (sync) if Celery is unavailable; otherwise dispatches to Celery worker.
    Sweeps TrustLayer + ActionLayer + ProfitLayer for every client in the specified agencies.
    """
    try:
        from tasks.diagnostic_sweep import master_diagnostic_sweep
        task = master_diagnostic_sweep.delay(agency_ids=body.agency_ids or None)
        return {
            "mode": "async",
            "task_id": task.id,
            "message": "Master Diagnostic Sweep dispatched to Celery worker.",
            "agency_ids": body.agency_ids or "ALL",
        }
    except Exception:
        result = run_full_sweep(db, agency_ids=body.agency_ids or None)
        return {"mode": "sync", "result": result}
