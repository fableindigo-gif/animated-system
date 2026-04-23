"""
Mock Google Ads API — deterministic upstream data for TrustLayer reconciliation.
No real OAuth is implemented. Drift mode injects deliberate value corruption for UAT.
"""
import random
from dataclasses import dataclass, field
from datetime import date


@dataclass
class GoogleCampaignMetric:
    campaign_id: str
    campaign_name: str
    date: date
    spend: float
    impressions: int
    clicks: int
    conversions: int
    revenue: float
    platform: str = "google_ads"


GOOGLE_SEED_DATA: dict[str, dict] = {
    "goog_001": dict(spend=4200.0, impressions=320000, clicks=9600,  conversions=288, revenue=21600.0),
    "goog_002": dict(spend=1850.0, impressions=140000, clicks=4200,  conversions=126, revenue=9450.0),
    "goog_003": dict(spend=750.0,  impressions=60000,  clicks=1800,  conversions=54,  revenue=4050.0),
}


class MockGoogleAdsAPI:
    """
    Simulates the Google Ads Reporting API.
    drift_mode: if True, random campaigns will have values shifted > 5% to trigger DRIFT_DETECTED.
    """

    def __init__(self, customer_id: str = "demo-customer", drift_mode: bool = False, seed: int = 42):
        self.customer_id = customer_id
        self.drift_mode = drift_mode
        self._rng = random.Random(seed)

    def get_campaign_metrics(self, report_date: date | None = None) -> list[GoogleCampaignMetric]:
        report_date = report_date or date.today()
        results = []
        for cid, base in GOOGLE_SEED_DATA.items():
            m = dict(base)
            if self.drift_mode and self._rng.random() > 0.5:
                drift_factor = 1.0 + self._rng.choice([-1, 1]) * self._rng.uniform(0.08, 0.20)
                m["spend"] = round(m["spend"] * drift_factor, 2)
                m["revenue"] = round(m["revenue"] * self._rng.uniform(0.75, 1.25), 2)
            results.append(GoogleCampaignMetric(
                campaign_id=cid,
                campaign_name=f"Google Campaign {cid[-3:].upper()}",
                date=report_date,
                spend=m["spend"],
                impressions=m["impressions"],
                clicks=m["clicks"],
                conversions=m["conversions"],
                revenue=m["revenue"],
            ))
        return results

    @staticmethod
    def describe() -> dict:
        return {
            "api": "Google Ads Reporting API v18 (MOCK)",
            "auth": "OAuth2 Service Account (not implemented — mock only)",
            "campaigns": list(GOOGLE_SEED_DATA.keys()),
        }
