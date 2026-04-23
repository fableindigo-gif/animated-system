from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from database import get_db
from schemas import OrderWebhook
from services.profit_layer import ingest_order_event, get_poas, calculate_poas

router = APIRouter(prefix="/profit", tags=["ProfitLayer"])


@router.post("/webhook/order", summary="Ingest mock order webhook")
def order_webhook(event: OrderWebhook, db: Session = Depends(get_db)):
    """
    Ingest a real-time order event and update the DailyPnL record.
    Formula: True Profit = Revenue - (AdSpend + COGS + Shipping + Fees)
    Multi-tenant isolation: event scoped to (agency_id, client_id).
    """
    return ingest_order_event(db, event.model_dump())


@router.get("/poas/{agency_id}/{client_id}", summary="Get POAS for a specific date")
def get_poas_endpoint(
    agency_id: str,
    client_id: str,
    target_date: Annotated[date | None, Query(alias="date")] = None,
    db: Session = Depends(get_db),
):
    """Return POAS (Profit on Ad Spend) record for a client on a specific date."""
    target_date = target_date or date.today()
    result = get_poas(db, agency_id, client_id, target_date)
    if result is None:
        return {"message": f"No P&L record found for {target_date}", "agency_id": agency_id, "client_id": client_id}
    return result


@router.post("/calculate/{agency_id}/{client_id}", summary="Recompute POAS from order events")
def calculate_endpoint(
    agency_id: str,
    client_id: str,
    target_date: Annotated[date | None, Query(alias="date")] = None,
    db: Session = Depends(get_db),
):
    """Recompute POAS by re-aggregating all order events for the given date."""
    return calculate_poas(db, agency_id, client_id, target_date)
