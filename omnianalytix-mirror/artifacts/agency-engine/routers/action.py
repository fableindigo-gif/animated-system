from typing import Annotated, Any
from fastapi import APIRouter, Depends, Body
from sqlalchemy.orm import Session

from database import get_db
from models import Playbook
from schemas import PlaybookCreate
from services.action_layer import evaluate_playbooks, get_playbooks

router = APIRouter(prefix="/action", tags=["ActionLayer"])


@router.post("/evaluate/{agency_id}/{client_id}", summary="Evaluate playbook rules for a client")
def evaluate_endpoint(
    agency_id: str,
    client_id: str,
    context_override: Annotated[dict[str, Any] | None, Body(embed=True)] = None,
    db: Session = Depends(get_db),
):
    """
    Evaluate all active agency playbooks against a client's latest metrics.

    Optionally pass `context_override` to test rules against arbitrary values.
    Triggered rules fire their action (creates resolution tickets, logs pauses, etc.).
    Multi-tenant isolation: playbooks are scoped to agency_id, tickets to (agency_id, client_id).
    """
    return evaluate_playbooks(db, agency_id, client_id, context_override=context_override)


@router.get("/playbooks/{agency_id}", summary="List agency playbooks")
def list_playbooks(agency_id: str, db: Session = Depends(get_db)):
    """Return all playbooks for an agency."""
    return {"agency_id": agency_id, "playbooks": get_playbooks(db, agency_id)}


@router.post("/playbooks/{agency_id}", summary="Create a new playbook")
def create_playbook(agency_id: str, body: PlaybookCreate, db: Session = Depends(get_db)):
    """
    Create a JSON-driven optimization playbook for an agency.

    Rules follow the CEL-like format:
        {"name": "...", "condition_group": {"logic": "AND", "conditions": [...]}, "action": {...}}
    """
    pb = Playbook(
        agency_id=agency_id,
        name=body.name,
        description=body.description,
        rules_json=[r.model_dump() for r in body.rules_json],
    )
    db.add(pb)
    db.commit()
    db.refresh(pb)
    return {"id": pb.id, "name": pb.name, "agency_id": agency_id, "created": True}
