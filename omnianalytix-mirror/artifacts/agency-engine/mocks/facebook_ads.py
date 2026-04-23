"""
Mock Facebook / Meta Ads API — deterministic upstream data for TrustLayer reconciliation.
No real OAuth is implemented. Drift mode injects deliberate value corruption for UAT.
"""
import random
from dataclasses import dataclass
from datetime import date


@dataclass
class MetaCampaignMetric:
    campaign_id: str
    campaign_name: str
    date: date
    spend: float
    impressions: int
    clicks: int
    conversions: int
    revenue: float
    frequency: float
    platform: str = "facebook_ads"


META_SEED_DATA: dict[str, dict] = {
    "meta_001": dict(spend=3100.0, impressions=280000, clicks=7840,  conversions=235, revenue=17625.0, frequency=2.1),
    "meta_002": dict(spend=2250.0, impressions=195000, clicks=5460,  conversions=164, revenue=12300.0, frequency=1.8),
    "meta_003": dict(spend=980.0,  impressions=88000,  clicks=2464,  conversions=74,  revenue=5550.0,  frequency=3.4),
}


class MockFacebookAdsAPI:
    """
    Simulates the Meta Marketing API (Graph API v20).
    drift_mode: if True, random campaigns will have values shifted > 5% to trigger DRIFT_DETECTED.
    """

    def __init__(self, ad_account_id: str = "act_demo123", drift_mode: bool = False, seed: int = 99):
        self.ad_account_id = ad_account_id
        self.drift_mode = drift_mode
        self._rng = random.Random(seed)

    def get_campaign_metrics(self, report_date: date | None = None) -> list[MetaCampaignMetric]:
        report_date = report_date or date.today()
        results = []
        for cid, base in META_SEED_DATA.items():
            m = dict(base)
            if self.drift_mode and self._rng.random() > 0.5:
                drift_factor = 1.0 + self._rng.choice([-1, 1]) * self._rng.uniform(0.07, 0.25)
                m["spend"] = round(m["spend"] * drift_factor, 2)
                m["impressions"] = int(m["impressions"] * self._rng.uniform(0.80, 1.20))
            results.append(MetaCampaignMetric(
                campaign_id=cid,
                campaign_name=f"Meta Campaign {cid[-3:].upper()}",
                date=report_date,
                spend=m["spend"],
                impressions=m["impressions"],
                clicks=m["clicks"],
                conversions=m["conversions"],
                revenue=m["revenue"],
                frequency=m["frequency"],
            ))
        return results

    @staticmethod
    def describe() -> dict:
        return {
            "api": "Meta Marketing API v20.0 (MOCK)",
            "auth": "System User Token (not implemented — mock only)",
            "campaigns": list(META_SEED_DATA.keys()),
        }
