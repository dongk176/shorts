"""Project-pinned currency conversion, calculated before any generated text."""

from __future__ import annotations

import os
import re
import unicodedata
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

import httpx

from .errors import SubtitleTranslationError
from .money_facts import EXPRESSION, LABEL, MONEY, NUMBER, SCALE, UNITS, VALID_NUMBER, _currency
from .schemas import SubtitleSegment

POLICY = "target-currency-v1"
TARGET_CURRENCIES = {"ko": "KRW", "ja": "JPY", "en": "USD"}
RATE_URL = "https://api.frankfurter.dev/v2/rates"
RATE_CURRENCIES = frozenset({"EUR", "GBP", "KRW", "JPY", "USD"})
_DIGITS = dict(zip("영공일이삼사오육칠팔구〇零一二三四五六七八九",
                   "0012345678900123456789", strict=True))
_SMALL = {"십": 10, "백": 100, "천": 1000, "十": 10, "百": 100, "千": 1000}
_LARGE = {"만": 10_000, "억": 100_000_000, "조": 1_000_000_000_000,
          "万": 10_000, "億": 100_000_000, "兆": 1_000_000_000_000}
_WORDS = dict(zip(
    "zero one two three four five six seven eight nine ten eleven twelve thirteen "
    "fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty "
    "sixty seventy eighty ninety".split(),
    [*range(20), 20, 30, 40, 50, 60, 70, 80, 90], strict=True,
))


def _failure() -> SubtitleTranslationError:
    return SubtitleTranslationError("금액 환산을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.")


def _written_number(value: str) -> str:
    total = section = 0
    pending = None
    tokens = re.findall(
        r"[0-9영공일이삼사오육칠팔구〇零一二三四五六七八九]+|[십백천만억조十百千万億兆]", value,
    )
    for token in tokens:
        if token in _SMALL:
            section += (pending if pending is not None else 1) * _SMALL[token]
            pending = None
        elif token in _LARGE:
            base = 1 if pending is None and section == 0 else section + (pending or 0)
            total += base * _LARGE[token]
            section, pending = 0, None
        else:
            pending = int("".join(_DIGITS.get(c, c) for c in token))
    return str(total + section + (pending or 0))


def normalize_money_text(text: str) -> str:
    """Normalize spoken number spelling only next to a currency label."""
    text = unicodedata.normalize("NFKC", text)
    text = re.sub(
        r"(?<![가-힣\d.,])([0-9영공일이삼사오육칠팔구십백천만억조〇零一二三四五六七八九十百千万億兆]+"
        r"(?:\s+[0-9영공일이삼사오육칠팔구십백천만억조〇零一二三四五六七八九十百千万億兆]+)*)"
        r"(?=\s*" + LABEL + ")",
        lambda m: _written_number(m[0]) if not re.search(r"\d", m[0]) or re.search(
            r"[영공일이삼사오육칠팔구십백〇零一二三四五六七八九十百]", m[0],
        ) else m[0],
        text,
    )
    words = "|".join([*_WORDS, "hundred", "thousand", "million", "billion", "trillion"])

    def english(match: re.Match[str]) -> str:
        total = section = 0
        for token in re.findall(r"[a-z]+", match[0].lower()):
            if token in _WORDS:
                section += _WORDS[token]
            elif token == "hundred":
                section = (section or 1) * 100
            elif token in UNITS:
                total += (section or 1) * int(UNITS[token])
                section = 0
        return str(total + section)

    return re.sub(
        r"\b(?:" + words + r")(?:[ -]+(?:and[ -]+)?(?:" + words + r"))*"
        r"(?=\s*" + LABEL + r"\b)", english, text, flags=re.I,
    )


def _quantity(value: str, inherited: Decimal = Decimal(1)) -> Decimal:
    total = section = Decimal(0)
    pending = None
    scaled = False
    for token in re.findall(NUMBER + "|" + SCALE, value, re.I):
        if re.match(r"[-+]?\d", token):
            if not VALID_NUMBER.fullmatch(token) or pending is not None:
                raise _failure()
            pending = Decimal(token.replace(",", ""))
        else:
            unit = Decimal(str(UNITS[token.lower()]))
            scaled = True
            if unit < 10_000:
                section += (pending if pending is not None else 1) * unit
            else:
                base = 1 if pending is None and section == 0 else section + (pending or 0)
                total += base * unit
                section = Decimal(0)
            pending = None
    result = total + section + (pending or 0)
    result *= 1 if scaled else inherited
    if not result.is_finite() or abs(result) > 9_007_199_254_740_991:
        raise _failure()
    return result


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

    def localize(self, text: str) -> str:
        def format_amount(amount: Decimal) -> str:
            return f"${amount:,.2f}" if self.target == "USD" else (
                f"{amount:,.0f}" + ("円" if self.target == "JPY" else "원")
            )

        def replace(match: re.Match[str]) -> str:
            # A monetary range can share a label, but two different labels identify
            # independently converted amounts, not a single-currency range.
            if len({_currency(label) for label in re.findall(LABEL, match[0], re.I)}) > 1:
                single = re.compile(
                    "(" + LABEL + r")\s*(" + EXPRESSION + ")|("
                    + EXPRESSION + r")\s*(" + LABEL + ")", re.I,
                )
                return single.sub(lambda m: format_amount(self.convert(
                    _quantity(m[2] or m[3]), _currency(m[1] or m[4]),
                )), match[0])
            prefix, first, second, suffix_first, suffix_second, suffix = match.groups()
            source = _currency(prefix or suffix)
            first, second = first or suffix_first, second or suffix_second
            scales = re.findall(SCALE, second or "", re.I)
            inherited = _quantity("1" + " ".join(scales)) if scales else Decimal(1)
            low = self.convert(_quantity(first, inherited), source)
            high = self.convert(_quantity(second), source) if second else None
            places = 2 if self.target == "USD" else 0
            amount = f"{low:,.{places}f}"
            if high is not None:
                amount += f"–{high:,.{places}f}"
            if self.target == "USD":
                return "$" + amount
            return amount + ("円" if self.target == "JPY" else "원")

        return MONEY.sub(replace, normalize_money_text(text))


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


def localize_project_money(
    job: dict, transcript: list[SubtitleSegment], repository: object,
) -> tuple[list[SubtitleSegment], str, CurrencySnapshot | None]:
    title = str(job["video_title"])
    target = TARGET_CURRENCIES.get(str(job.get("output_language")))
    if (os.getenv("EASYCUT_LANGUAGE_TEST_WORKER") != "true"
            or not job.get("language_test_release_id")
            or job.get("source_language_hint") is None or target is None):
        return transcript, title, None
    phrases: list[SubtitleSegment] = []
    for segment in transcript:
        # Transcription may split the number from its currency. Join just that
        # contiguous phrase before assigning translation IDs; keep raw STT intact.
        if (phrases and 0 <= segment.start - phrases[-1].end <= 0.25
                and re.match(r"\s*" + LABEL, segment.text, re.I)
                and re.search(
                    "(?:" + EXPRESSION
                    + r"|[영공일이삼사오육칠팔구십백천만억조〇零一二三四五六七八九十百千万億兆]+"
                    r"|\b(?:" + "|".join([*_WORDS, "hundred", "thousand", "million"])
                    + r"))\s*$", phrases[-1].text, re.I,
                )):
            phrases[-1] = phrases[-1].model_copy(update={
                "text": phrases[-1].text + " " + segment.text, "end": segment.end,
            })
        else:
            phrases.append(segment)
    metrics = job.get("performance_metrics") or {}
    saved = metrics.get("currencyLocalization") if isinstance(metrics, dict) else None
    texts = [title, *(s.text for s in phrases)]
    currencies = {_currency(label) for t in texts
                  for m in MONEY.finditer(normalize_money_text(t))
                  for label in re.findall(LABEL, m[0], re.I)}
    if not saved and not currencies - {target}:
        return transcript, title, None
    snapshot = CurrencySnapshot.from_dict(saved, target) if saved else fetch_snapshot(target)
    if not saved:
        # The repository atomically retains the first snapshot and fails on write errors.
        snapshot = CurrencySnapshot.from_dict(
            repository.pin_currency_snapshot(str(job["id"]), snapshot.to_dict()), target,
        )
    return ([s.model_copy(update={"text": snapshot.localize(s.text)}) for s in phrases],
            snapshot.localize(title), snapshot)
