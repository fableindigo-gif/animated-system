from datetime import datetime, date
from sqlalchemy import (
    String, Integer, Float, Boolean, Date, DateTime, Text, JSON,
    ForeignKey, UniqueConstraint, Index,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database import Base


class Agency(Base):
    __tablename__ = "agencies"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    plan: Mapped[str] = mapped_column(String(50), default="starter")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    clients: Mapped[list["Client"]] = relationship("Client", back_populates="agency", cascade="all, delete-orphan")
    playbooks: Mapped[list["Playbook"]] = relationship("Playbook", back_populates="agency", cascade="all, delete-orphan")
    rules: Mapped[list["DataValidationRule"]] = relationship("DataValidationRule", back_populates="agency", cascade="all, delete-orphan")


class Client(Base):
    __tablename__ = "clients"
    __table_args__ = (
        UniqueConstraint("agency_id", "slug", name="uq_client_slug"),
        Index("ix_client_agency", "agency_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    agency_id: Mapped[str] = mapped_column(String(36), ForeignKey("agencies.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), nullable=False)
    goal: Mapped[str] = mapped_column(String(50), default="ecom")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    agency: Mapped["Agency"] = relationship("Agency", back_populates="clients")
    metrics: Mapped[list["DownstreamMetric"]] = relationship("DownstreamMetric", back_populates="client", cascade="all, delete-orphan")
    pnl_records: Mapped[list["DailyPnL"]] = relationship("DailyPnL", back_populates="client", cascade="all, delete-orphan")


class DownstreamMetric(Base):
    """Internal metrics received from ETL pipeline — compared against upstream mock APIs."""
    __tablename__ = "downstream_metrics"
    __table_args__ = (
        Index("ix_dm_agency_client", "agency_id", "client_id"),
        Index("ix_dm_campaign_date", "campaign_id", "date"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    agency_id: Mapped[str] = mapped_column(String(36), ForeignKey("agencies.id"), nullable=False)
    client_id: Mapped[str] = mapped_column(String(36), ForeignKey("clients.id"), nullable=False)
    campaign_id: Mapped[str] = mapped_column(String(100), nullable=False)
    platform: Mapped[str] = mapped_column(String(50), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    spend: Mapped[float] = mapped_column(Float, default=0.0)
    impressions: Mapped[int] = mapped_column(Integer, default=0)
    clicks: Mapped[int] = mapped_column(Integer, default=0)
    conversions: Mapped[int] = mapped_column(Integer, default=0)
    revenue: Mapped[float] = mapped_column(Float, default=0.0)
    fatigue_score: Mapped[float] = mapped_column(Float, default=0.0)
    pacing_ratio: Mapped[float] = mapped_column(Float, default=1.0)

    client: Mapped["Client"] = relationship("Client", back_populates="metrics")


class DataValidationRule(Base):
    """Agency-level rules controlling TrustLayer drift thresholds per platform."""
    __tablename__ = "data_validation_rules"
    __table_args__ = (Index("ix_dvr_agency", "agency_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    agency_id: Mapped[str] = mapped_column(String(36), ForeignKey("agencies.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    platform: Mapped[str] = mapped_column(String(50), nullable=False)
    fields: Mapped[list] = mapped_column(JSON, default=list)
    threshold_pct: Mapped[float] = mapped_column(Float, default=5.0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    agency: Mapped["Agency"] = relationship("Agency", back_populates="rules")


class Playbook(Base):
    """JSON-driven optimization playbook (ActionLayer rules engine input)."""
    __tablename__ = "playbooks"
    __table_args__ = (Index("ix_pb_agency", "agency_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    agency_id: Mapped[str] = mapped_column(String(36), ForeignKey("agencies.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    rules_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    trigger_count: Mapped[int] = mapped_column(Integer, default=0)
    last_triggered: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    agency: Mapped["Agency"] = relationship("Agency", back_populates="playbooks")


class DailyPnL(Base):
    """True-profit record per client per day (ProfitLayer output)."""
    __tablename__ = "daily_pnl"
    __table_args__ = (
        UniqueConstraint("agency_id", "client_id", "date", name="uq_pnl_day"),
        Index("ix_pnl_agency_client", "agency_id", "client_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    agency_id: Mapped[str] = mapped_column(String(36), ForeignKey("agencies.id"), nullable=False)
    client_id: Mapped[str] = mapped_column(String(36), ForeignKey("clients.id"), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    revenue: Mapped[float] = mapped_column(Float, default=0.0)
    ad_spend: Mapped[float] = mapped_column(Float, default=0.0)
    cogs: Mapped[float] = mapped_column(Float, default=0.0)
    shipping: Mapped[float] = mapped_column(Float, default=0.0)
    fees: Mapped[float] = mapped_column(Float, default=0.0)
    true_profit: Mapped[float] = mapped_column(Float, default=0.0)
    poas: Mapped[float] = mapped_column(Float, default=0.0)
    order_count: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    client: Mapped["Client"] = relationship("Client", back_populates="pnl_records")


class AuditLog(Base):
    """TrustLayer reconciliation log — one row per field per campaign comparison."""
    __tablename__ = "audit_logs"
    __table_args__ = (Index("ix_al_agency_client", "agency_id", "client_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    agency_id: Mapped[str] = mapped_column(String(36), nullable=False)
    client_id: Mapped[str] = mapped_column(String(36), nullable=False)
    campaign_id: Mapped[str] = mapped_column(String(100), nullable=False)
    platform: Mapped[str] = mapped_column(String(50), nullable=False)
    field: Mapped[str] = mapped_column(String(100), nullable=False)
    upstream_value: Mapped[float] = mapped_column(Float, nullable=False)
    downstream_value: Mapped[float] = mapped_column(Float, nullable=False)
    drift_pct: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String(30), nullable=False)
    threshold_pct: Mapped[float] = mapped_column(Float, default=5.0)
    checked_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ResolutionTicket(Base):
    """Tickets generated by ActionLayer rule triggers."""
    __tablename__ = "resolution_tickets"
    __table_args__ = (Index("ix_rt_agency_client", "agency_id", "client_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    agency_id: Mapped[str] = mapped_column(String(36), nullable=False)
    client_id: Mapped[str] = mapped_column(String(36), nullable=False)
    campaign_id: Mapped[str] = mapped_column(String(100), nullable=True)
    playbook_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("playbooks.id"), nullable=True)
    rule_name: Mapped[str] = mapped_column(String(200), nullable=False)
    trigger_data: Mapped[dict] = mapped_column(JSON, default=dict)
    action_type: Mapped[str] = mapped_column(String(100), nullable=False)
    action_payload: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(50), default="open")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class OrderEvent(Base):
    """Mock order webhook events ingested by ProfitLayer."""
    __tablename__ = "order_events"
    __table_args__ = (Index("ix_oe_agency_client", "agency_id", "client_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    agency_id: Mapped[str] = mapped_column(String(36), nullable=False)
    client_id: Mapped[str] = mapped_column(String(36), nullable=False)
    order_id: Mapped[str] = mapped_column(String(100), nullable=False)
    revenue: Mapped[float] = mapped_column(Float, default=0.0)
    cogs: Mapped[float] = mapped_column(Float, default=0.0)
    shipping: Mapped[float] = mapped_column(Float, default=0.0)
    fees: Mapped[float] = mapped_column(Float, default=0.0)
    event_date: Mapped[date] = mapped_column(Date, nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
