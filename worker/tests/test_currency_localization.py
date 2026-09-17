from copy import deepcopy
from datetime import UTC, datetime
from decimal import Decimal
from unittest.mock import MagicMock

import pytest

from shorts_worker import currency_localization as fx
from shorts_worker import currency_tools
from shorts_worker.currency_tools import CurrencyConverter
from shorts_worker.errors import SubtitleTranslationError


def snapshot(target="JPY"):
    return fx.CurrencySnapshot.from_dict({
        "policy": fx.POLICY, "provider": "frankfurter-ecb", "base": "EUR",
        "targetCurrency": target, "rateDate": "2026-09-14",
        "fetchedAt": "2026-09-15T00:00:00+00:00",
        "rates": {"EUR": "1", "USD": "1.2", "JPY": "180", "KRW": "1800", "GBP": ".9"},
    }, target)


@pytest.mark.parametrize("target,amount,source,expected", [
    ("JPY", "1700000", "KRW", "170000"),
    ("USD", "1700000", "KRW", "1133.33"),
    ("KRW", "15000", "JPY", "150000"),
    ("JPY", "12.50", "USD", "1875"),
    ("JPY", "5", "KRW", "1"),
    ("USD", "15.075", "KRW", "0.01"),
    ("JPY", "0", "KRW", "0"),
])
def test_conversion_arithmetic(target, amount, source, expected):
    assert snapshot(target).convert(Decimal(amount), source) == Decimal(expected)


def converter(repository=None, **fields):
    return CurrencyConverter({"id": "test", "output_language": "ja", **fields},
                             repository or MagicMock())


def test_only_ai_requested_amounts_are_calculated_without_rewriting_source(monkeypatch):
    original = {"video_title": "이유로 170만 원", "transcript": "이 십칠엔1 컬러"}
    current = deepcopy(original)
    fetch = MagicMock(return_value=snapshot())
    monkeypatch.setattr(currency_tools, "fetch_snapshot", fetch)
    repository = MagicMock()
    repository.pin_currency_snapshot.return_value = snapshot().to_dict()
    calc = converter(repository, **current)
    fetch.assert_not_called()
    for _ in range(2):
        assert calc.calculate({"amount": "1700000", "sourceCurrency": "KRW"}) == {
            "status": "ok", "amount": "170000", "currency": "JPY", "display": "170,000円",
        }
    assert current == original
    assert calc.job["transcript"] == original["transcript"]
    fetch.assert_called_once()
    repository.pin_currency_snapshot.assert_called_once()
    # Resumed jobs use the originally pinned rate.
    calc = converter(repository, performance_metrics={"currencyLocalization": snapshot().to_dict()})
    assert calc.calculate({"amount": "1700000", "sourceCurrency": "KRW"})["amount"] == "170000"
    fetch.assert_called_once()


@pytest.mark.parametrize("arguments", [None, {}, {"amount": "이", "sourceCurrency": "EUR"},
    {"amount": "NaN", "sourceCurrency": "KRW"}, {"amount": True, "sourceCurrency": "KRW"},
    {"amount": "10", "sourceCurrency": "unknown"}, {"amount": "10", "sourceCurrency": []},
    {"amount": "1e1000", "sourceCurrency": "KRW"}])
def test_malformed_tool_arguments_are_nonfatal_and_do_not_fetch(monkeypatch, arguments):
    fetch = MagicMock(side_effect=AssertionError("no lookup for malformed arguments"))
    monkeypatch.setattr(currency_tools, "fetch_snapshot", fetch)
    assert converter().calculate(arguments)["status"] == "invalid_amount"
    fetch.assert_not_called()


def test_matching_currency_needs_no_provider_or_storage(monkeypatch):
    fetch = MagicMock(side_effect=AssertionError("unnecessary lookup"))
    monkeypatch.setattr(currency_tools, "fetch_snapshot", fetch)
    repository = MagicMock()
    assert converter(repository).calculate({"amount": "100", "sourceCurrency": "JPY"}) == {
        "status": "ok", "amount": "100", "currency": "JPY", "display": "100円",
    }
    fetch.assert_not_called()
    repository.pin_currency_snapshot.assert_not_called()


@pytest.mark.parametrize("where", ["provider", "storage", "saved_snapshot"])
def test_optional_rate_failures_keep_original_money_and_do_not_retry(monkeypatch, where):
    fetch = MagicMock(return_value=snapshot())
    monkeypatch.setattr(currency_tools, "fetch_snapshot", fetch)
    repository = MagicMock()
    repository.pin_currency_snapshot.return_value = snapshot().to_dict()
    fields = {}
    if where == "provider":
        fetch.side_effect = TimeoutError()
    elif where == "storage":
        repository.pin_currency_snapshot.side_effect = RuntimeError("unavailable")
    else:
        fields["performance_metrics"] = {"currencyLocalization": {"invalid": True}}
    calc = converter(repository, **fields)
    for _ in range(3):
        assert calc.calculate({"amount": "100", "sourceCurrency": "KRW"}) == {
            "status": "unavailable", "action": "retain_original_amount_and_currency",
        }
    assert fetch.call_count <= 1
    assert repository.pin_currency_snapshot.call_count <= 1


@pytest.mark.parametrize("change", [{"targetCurrency": "USD"}, {"rates": {"EUR": "1"}},
                                  {"rates": {**snapshot().to_dict()["rates"], "JPY": "NaN"}}])
def test_invalid_saved_snapshot_is_not_silently_replaced(change):
    with pytest.raises(SubtitleTranslationError):
        fx.CurrencySnapshot.from_dict({**snapshot().to_dict(), **change}, "JPY")


@pytest.mark.parametrize("rate_date,missing", [("2000-01-01", False),
                                            (datetime.now(UTC).date().isoformat(), True)])
def test_stale_or_incomplete_provider_data_fails(monkeypatch, rate_date, missing):
    rows = [{"base": "EUR", "quote": key, "rate": str(value), "date": rate_date}
            for key, value in snapshot().rates.items() if key != "EUR"]
    client = MagicMock()
    client.__enter__.return_value = client
    client.get.return_value.json.return_value = rows[:-1] if missing else rows
    monkeypatch.setattr(fx.httpx, "Client", lambda **_: client)
    with pytest.raises(SubtitleTranslationError):
        fx.fetch_snapshot("JPY")
