"""
OmniAnalytix — Agency Logic Engine
=====================================
FastAPI microservice implementing:
  • TrustLayer   — Data Integrity & Reconciliation
  • ActionLayer  — Optimization Playbook Engine (CEL-like rules)
  • ProfitLayer  — Real-Time POAS Calculator
  • Multi-Tenant Aggregator — Master Diagnostic Sweep (Celery/Redis)

Stack: Python 3.11, FastAPI, SQLAlchemy, Celery/Redis, PostgreSQL-compatible SQLite
"""
import logging
import os
import sys

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

sys.path.insert(0, os.path.dirname(__file__))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("agency_engine")

from database import init_db
from routers import trust, action, profit, tenants

app = FastAPI(
    title="OmniAnalytix Agency Logic Engine",
    version="1.0.0",
    description=(
        "Multi-tenant backend powering TrustLayer (data integrity), "
        "ActionLayer (playbook rules engine), ProfitLayer (POAS calculator), "
        "and Master Diagnostic Sweep (Celery/Redis aggregator)."
    ),
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(trust.router)
app.include_router(action.router)
app.include_router(profit.router)
app.include_router(tenants.router)


@app.on_event("startup")
def startup():
    logger.info("Agency Logic Engine starting — initialising database schema...")
    init_db()
    logger.info("Schema ready. TrustLayer / ActionLayer / ProfitLayer / MultiTenant online.")


@app.get("/", tags=["Meta"])
def root():
    return {
        "service": "OmniAnalytix Agency Logic Engine",
        "version": "1.0.0",
        "layers": ["TrustLayer", "ActionLayer", "ProfitLayer", "Multi-Tenant Aggregator"],
        "docs": "/docs",
        "health": "/health",
    }


@app.get("/health", tags=["Meta"])
def health():
    from database import engine
    try:
        with engine.connect() as conn:
            conn.execute(__import__("sqlalchemy").text("SELECT 1"))
        db_status = "ok"
    except Exception as e:
        db_status = f"error: {e}"

    try:
        import redis as _redis
        r = _redis.Redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379/0"), socket_timeout=1)
        r.ping()
        redis_status = "ok"
    except Exception as e:
        redis_status = f"unavailable: {e}"

    return {
        "status": "ok" if db_status == "ok" else "degraded",
        "database": db_status,
        "redis": redis_status,
        "celery": "configured" if redis_status == "ok" else "degraded (async sweep will run sync fallback)",
    }


@app.get("/mock-apis", tags=["Meta"])
def describe_mock_apis():
    from mocks.google_ads import MockGoogleAdsAPI
    from mocks.facebook_ads import MockFacebookAdsAPI
    return {
        "google_ads": MockGoogleAdsAPI.describe(),
        "facebook_ads": MockFacebookAdsAPI.describe(),
        "note": "Mock APIs simulate upstream platform data. Real OAuth is NOT implemented.",
    }


if __name__ == "__main__":
    port = int(os.getenv("AGENCY_ENGINE_PORT", "8090"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True, log_level="info")
