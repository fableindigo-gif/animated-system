from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from database import get_db
from services.trust_layer import reconcile, get_audit_log

router = APIRouter(prefix="/trust", tags=["TrustLayer"])


@router.post("/reconcile/{agency_id}/{client_id}", summary="Run TrustLayer reconciliation")
def reconcile_endpoint(
    agency_id: str,
    client_id: str,
    report_date: Annotated[date | None, Query(description="ISO date e.g. 2025-01-15")] = None,
    drift_mode: Annotated[bool, Query(description="Inject drift into Mock APIs for UAT")] = False,
    db: Session = Depends(get_db),
):
    """
    Reconcile upstream mock API data vs downstream_metrics for a client.

    Returns field-level MATCH / DRIFT_DETECTED results.
    Multi-tenant isolation: scoped to (agency_id, client_id).
    """
    return reconcile(db, agency_id, client_id, report_date=report_date, drift_mode=drift_mode)


@router.get("/audit-log/{agency_id}/{client_id}", summary="Fetch TrustLayer audit log")
def audit_log_endpoint(
    agency_id: str,
    client_id: str,
    limit: Annotated[int, Query(ge=1, le=1000)] = 200,
    db: Session = Depends(get_db),
):
    """Return recent reconciliation audit entries for a client (path-isolated)."""
    return {"agency_id": agency_id, "client_id": client_id, "entries": get_audit_log(db, agency_id, client_id, limit)}
