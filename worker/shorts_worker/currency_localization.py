"""Pinned exchange rates and arithmetic; source text is never inspected or rewritten."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

import httpx

from .errors import SubtitleTranslationError

POLICY = "target-currency-v1"


TARGET_CURRENCIES = {"ko": "KRW", "ja": "JPY", "en": "USD"}


RATE_URL = "https://api.frankfurter.dev/v2/rates"


RATE_CURRENCIES = frozenset({"EUR", "GBP", "KRW", "JPY", "USD"})


def _failure() -> SubtitleTranslationError:
    return SubtitleTranslationError("금액 환산을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.")


@dataclass(frozen=True)
class CurrencySnapshot:
    target: str
    rate_date: str
    fetched_at: str
    rates: dict[str, Decimal]

    @classmethod
    def from_dict(cls, value: dict, target: str) -> CurrencySnapshot:
        try:
            if (value["policy"] != POLICY or value["targetCurrency"] != target
                    or value["provider"] != "frankfurter-ecb" or value["base"] != "EUR"):
                raise ValueError("snapshot_identity")
            date.fromisoformat(value["rateDate"])
            datetime.fromisoformat(value["fetchedAt"])
            rates = {key: Decimal(str(rate)) for key, rate in value["rates"].items()}
            if (set(rates) != RATE_CURRENCIES or rates["EUR"] != 1
                    or any(not r.is_finite() or r <= 0 for r in rates.values())):
                raise ValueError("snapshot_rates")
            return cls(target, value["rateDate"], value["fetchedAt"], rates)
        except (KeyError, TypeError, AttributeError, ValueError, InvalidOperation) as exc:
            raise _failure() from exc

    def to_dict(self) -> dict:
        return {"policy": POLICY, "provider": "frankfurter-ecb", "base": "EUR",
                "targetCurrency": self.target, "rateDate": self.rate_date,
                "fetchedAt": self.fetched_at,
                "rounding": "half-up-minor-unit",
                "rates": {key: str(rate) for key, rate in self.rates.items()}}

    def convert(self, amount: Decimal, source: str) -> Decimal:
        quantum = Decimal("0.01") if self.target == "USD" else Decimal(1)
        return (amount / self.rates[source] * self.rates[self.target]).quantize(
            quantum, rounding=ROUND_HALF_UP,
        )


def fetch_snapshot(target: str) -> CurrencySnapshot:
    """Only currency codes leave the worker; no transcript or project data is sent."""
    try:
        with httpx.Client(timeout=10, follow_redirects=False) as client:
            response = client.get(RATE_URL, params={
                "base": "EUR", "quotes": "GBP,KRW,JPY,USD", "providers": "ECB",
            })
            response.raise_for_status()
            rows = response.json()
        if not isinstance(rows, list) or len(rows) != 4:
            raise ValueError("rate_response")
        dates = {r["date"] for r in rows}
        now = datetime.now(UTC)
        if (len(dates) != 1 or any(r["base"] != "EUR" for r in rows)
                or not 0 <= (now.date() - date.fromisoformat(next(iter(dates)))).days <= 7):
            raise ValueError("rate_date")
        return CurrencySnapshot.from_dict({
            "policy": POLICY, "provider": "frankfurter-ecb", "base": "EUR",
            "targetCurrency": target, "rateDate": next(iter(dates)),
            "fetchedAt": now.isoformat(),
            "rates": {"EUR": "1", **{r["quote"]: str(r["rate"]) for r in rows}},
        }, target)
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        raise _failure() from exc
