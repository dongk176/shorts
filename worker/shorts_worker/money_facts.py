"""Conservative grounding of explicit monetary amounts; not general fact checking."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from .language_context import CATALOG

LABEL = (r"(?:South Korean won|Korean won|KRW|USD|JPY|EUR|GBP|US dollars?|dollars?|won|"
         r"yen|euros?|pounds?|韓国ウォン|ウォン|米ドル|ドル|ユーロ|ポンド|달러|유로|원|円|엔|[₩$¥￥€£])")
NUMBER = r"[-+]?\d(?:[\d,.]*\d)?"
SCALE = r"(?:trillion|billion|million|thousand|[kmbt](?![a-z])|[천만억조千万億兆])"
EXPRESSION = NUMBER + r"\s*(?:" + SCALE + r")*(?:\s*" + NUMBER + r"\s*" + SCALE + r")*"
SEPARATOR = r"(?:에서|부터|から|to\b|[~〜～–—、,-])"
MONEY = re.compile(
    r"(?<![\d.,])(?:" + "(" + LABEL + r")\s*(" + EXPRESSION + r")"
    r"(?:\s*" + SEPARATOR + r"\s*(" + EXPRESSION + r"))?|"
    "(" + EXPRESSION + r")(?:\s*(?:" + LABEL + r")?\s*" + SEPARATOR
    + r"\s*(" + EXPRESSION + r"))?\s*(" + LABEL + r"))(?![a-z])", re.I,
)
UNITS = {"k": 1e3, "thousand": 1e3, "천": 1e3, "千": 1e3,
         "m": 1e6, "million": 1e6, "b": 1e9, "billion": 1e9,
         "t": 1e12, "trillion": 1e12, "만": 1e4, "万": 1e4,
         "억": 1e8, "億": 1e8, "조": 1e12, "兆": 1e12}
VALID_NUMBER = re.compile(r"[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$")


@dataclass(frozen=True)
class MoneyClaim:
    currency: str
    low: float | None
    high: float | None


def _currency(label: str) -> str:
    if re.search(r"won|ウォン|원|KRW|₩", label, re.I):
        return "KRW"
    if re.search(r"dollar|ドル|달러|USD|\$", label, re.I):
        return "USD"
    if re.search(r"yen|円|엔|JPY|[¥￥]", label, re.I):
        return "JPY"
    return "EUR" if re.search(r"euro|ユーロ|유로|EUR|€", label, re.I) else "GBP"


def _quantity(expression: str, inherited: float = 1) -> float | None:
    tokens = re.findall(NUMBER + "|" + SCALE, expression, re.I)
    total = section = 0.0
    pending: float | None = None
    scaled = False
    for token in tokens:
        if re.match(r"[-+]?\d", token):
            if not VALID_NUMBER.fullmatch(token) or pending is not None:
                return None
            pending = float(token.replace(",", ""))
        else:
            unit = UNITS[token.lower()]
            scaled = True
            if unit < 1e4:
                section += (pending if pending is not None else 1) * unit
            else:
                base = section + (pending if pending is not None else 0)
                total += (1 if pending is None and section == 0 else base) * unit
                section = 0
            pending = None
    value = total + section + (pending or 0)
    value = value if scaled else value * inherited
    return value if abs(value) <= 9_007_199_254_740_991 else None


def money_claims(text: str, *, include_unlabeled: bool = False) -> list[MoneyClaim]:
    text = unicodedata.normalize("NFKC", text)
    result = []
    spans = []
    for match in MONEY.finditer(text):
        spans.append(match.span())
        prefix, first, second, suffix_first, suffix_second, suffix = match.groups()
        first, second = first or suffix_first, second or suffix_second
        scale = re.findall(SCALE, second or "", re.I)
        inherited = UNITS[scale[-1].lower()] if scale else 1
        low = _quantity(first, inherited)
        high = _quantity(second) if second else low
        result.append(MoneyClaim(_currency(prefix or suffix), low, high))
    if include_unlabeled:
        # Spoken Korean often omits the currency after the first mention. Ground
        # the explicit magnitude/range without inventing which currency it meant.
        pattern = "(" + EXPRESSION + r")(?:\s*" + SEPARATOR + r"\s*(" + EXPRESSION + "))?"
        for match in re.finditer(pattern, text, re.I):
            if any(start <= match.start() < end for start, end in spans):
                continue
            if not re.search(SCALE, match.group(), re.I):
                continue
            after = text[match.end():].lstrip()
            if re.match(r"(?:명|개|회|년|개월|번|대|시간|분|초)|"
                        + CATALOG["amountCountUnitPattern"], after, re.I):
                continue
            nearby = text[max(0, match.start() - 45):match.end() + 45]
            if not re.search(r"원|달러|돈|벌|자산|고정비|이자|매출|수익|비용|금액|"
                             r"cost|income|earn|profit|asset|revenue|ウォン|ドル|稼|資産",
                             nearby, re.I):
                continue
            first, second = match.groups()
            scale = re.findall(SCALE, second or "", re.I)
            low = _quantity(first, UNITS[scale[-1].lower()] if scale else 1)
            result.append(MoneyClaim("?", low, _quantity(second) if second else low))
    return result


def ungrounded_money(text: str, source: str) -> bool:
    claims = money_claims(text)
    if not claims:
        return False
    source_claims = money_claims(source, include_unlabeled=True)
    # Range endpoints are not standalone claims; allow an explicitly labelled bound.
    minimum = bool(re.search(r"\b(?:min(?:imum)?|at least)\b|最低|少なくとも|최소", text, re.I))
    maximum = bool(re.search(r"\b(?:max(?:imum)?|up to|at most)\b|最大|최대", text, re.I))
    question = bool(re.search(
        r"[?？]|(?:かな|だろう|かも(?:しれない)?)(?:[。！!…\s]|$)|"
        r"\b(?:could|would|might)\b", text, re.I,
    ))
    for claim in claims:
        if claim.low is None or claim.high is None:
            return True
        if any(original.currency in {"?", claim.currency}
               and original.low == claim.low and original.high == claim.high
               for original in source_claims):
            continue
        if claim.low == claim.high and any(
            original.currency in {"?", claim.currency}
            and original.low is not None and original.high is not None
            and original.low != original.high
            and ((minimum and not maximum and claim.low == original.low)
                 or (maximum and not minimum and claim.high == original.high)
                 or (question and not minimum and not maximum
                     and claim.low in {original.low, original.high}))
            for original in source_claims
        ):
            continue
        return True
    return False
