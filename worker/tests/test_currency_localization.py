from copy import deepcopy
from datetime import UTC, datetime
from decimal import Decimal
from unittest.mock import MagicMock

import pytest

from shorts_worker import currency_localization as fx
from shorts_worker.config import Settings
from shorts_worker.errors import SubtitleTranslationError
from shorts_worker.schemas import HighlightClip, OutputLanguage, SubtitleSegment
from shorts_worker.selector import TranscriptSelector
from shorts_worker.subtitle_translation import SubtitleTranslator, inspect_translation


def snapshot(target="JPY"):
    return fx.CurrencySnapshot.from_dict({
        "policy": fx.POLICY, "provider": "frankfurter-ecb", "base": "EUR",
        "targetCurrency": target, "rateDate": "2026-09-14",
        "fetchedAt": "2026-09-15T00:00:00+00:00",
        "rates": {"EUR": "1", "USD": "1.2", "JPY": "180", "KRW": "1800", "GBP": ".9"},
    }, target)


@pytest.mark.parametrize("target,source,expected", [
    ("JPY", "애플워치 가격은 170만 원입니다.", "애플워치 가격은 170,000円입니다."),
    ("JPY", "가격은 백칠십만 원입니다.", "가격은 170,000円입니다."),
    ("JPY", "월 만원도 안 하는 금액입니다.", "월 1,000円도 안 하는 금액입니다."),
    ("JPY", "천 원과 천만원", "100円과 1,000,000円"),
    ("JPY", "억 원", "10,000,000円"),
    ("JPY", "3.5만원", "3,500円"),
    ("USD", "월 만원", "월 $6.67"),
    ("KRW", "万円と千円", "100,000원と10,000원"),
    ("JPY", "価格は一万五千ウォンです。", "価格は1,500円です。"),
    ("JPY", "It costs one hundred and fifty dollars.", "It costs 22,500円."),
    ("JPY", "3천만 원이고 10.5kg입니다.", "3,000,000円이고 10.5kg입니다."),
    ("JPY", "20~30만 원", "20,000–30,000円"),
    ("JPY", "1~2천만 원", "1,000,000–2,000,000円"),
    ("JPY", "100달러에서200유로", "15,000円에서36,000円"),
    ("JPY", "0원", "0円"),
    ("JPY", "$0 million", "0円"),
    ("JPY", "$12.50", "1,875円"),
    ("KRW", "価格は15000円です。", "価格は150,000원です。"),
    ("USD", "가격은 170만 원입니다.", "가격은 $1,133.33입니다."),
    ("USD", "€3 and £3", "$3.60 and $4.00"),
    ("JPY", "가격은 1,000원이고 2개입니다.", "가격은 100円이고 2개입니다."),
])
def test_local_currency_conversion(target, source, expected):
    assert snapshot(target).localize(source) == expected


def test_minor_units_use_decimal_half_up():
    assert snapshot().convert(Decimal("5"), "KRW") == Decimal("1")
    assert snapshot("USD").convert(Decimal("15.075"), "KRW") == Decimal("0.01")


def job():
    return {"id": "test", "video_title": "170만 원 제품", "output_language": "ja",
            "source_language_hint": "ko", "language_test_release_id": "test-release"}


def test_project_pins_once_and_reuses_old_rate_without_refetch(monkeypatch):
    monkeypatch.setenv("EASYCUT_LANGUAGE_TEST_WORKER", "true")
    fetch = MagicMock(return_value=snapshot())
    monkeypatch.setattr(fx, "fetch_snapshot", fetch)
    repository = MagicMock()
    repository.pin_currency_snapshot.return_value = snapshot().to_dict()
    original = [SubtitleSegment(start=10, end=15, text="애플워치는 170만 원입니다.")]
    source = deepcopy(original)
    current = job()
    first, title, saved = fx.localize_project_money(current, original, repository)
    current["performance_metrics"] = {"currencyLocalization": saved.to_dict()}
    fetch.side_effect = AssertionError("A retry must retain the first rate")
    repeated = fx.localize_project_money(current, original, repository)
    assert repeated == (first, title, saved)
    assert original == source
    assert (first[0].start, first[0].end) == (10, 15)
    assert "170,000円" in first[0].text and "170,000円" in title
    repository.pin_currency_snapshot.assert_called_once()


@pytest.mark.parametrize("worker,release,hint", [("false", "test", "ko"),
                                              ("true", None, "ko"),
                                              ("true", "test", None)])
def test_stable_paths_do_not_call_rates_or_write(monkeypatch, worker, release, hint):
    monkeypatch.setenv("EASYCUT_LANGUAGE_TEST_WORKER", worker)
    fetch = MagicMock(side_effect=AssertionError("stable"))
    monkeypatch.setattr(fx, "fetch_snapshot", fetch)
    current = {**job(), "language_test_release_id": release, "source_language_hint": hint}
    repository = MagicMock()
    original = [SubtitleSegment(start=0, end=3, text="170만 원")]
    assert fx.localize_project_money(current, original, repository) == (
        original, current["video_title"], None,
    )
    repository.pin_currency_snapshot.assert_not_called()


def test_persistence_failure_stops_before_ai(monkeypatch):
    monkeypatch.setenv("EASYCUT_LANGUAGE_TEST_WORKER", "true")
    monkeypatch.setattr(fx, "fetch_snapshot", lambda _: snapshot())
    repository = MagicMock()
    repository.pin_currency_snapshot.side_effect = RuntimeError("database unavailable")
    with pytest.raises(RuntimeError, match="database unavailable"):
        fx.localize_project_money(job(), [], repository)


def test_currency_split_across_transcription_phrases(monkeypatch):
    monkeypatch.setenv("EASYCUT_LANGUAGE_TEST_WORKER", "true")
    monkeypatch.setattr(fx, "fetch_snapshot", lambda _: snapshot())
    repository = MagicMock()
    repository.pin_currency_snapshot.return_value = snapshot().to_dict()
    original = [SubtitleSegment(start=0, end=2, text="가격은 170만"),
                SubtitleSegment(start=2.1, end=4, text="원입니다.")]
    localized, _, _ = fx.localize_project_money({**job(), "video_title": "가격"},
                                             original, repository)
    assert [s.model_dump() for s in localized] == [
        {"start": 0, "end": 4, "text": "가격은 170,000円입니다."},
    ]
    assert original[0].text == "가격은 170만"


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


@pytest.mark.parametrize("translated", ["価格は170万円です。", "価格は170万ウォンです。",
                                      "価格は17万円で送料は500円です。"])
def test_translation_rejects_wrong_conversion_and_added_money(translated):
    valid, issues = inspect_translation(
        {"segments": [{"id": 0, "text": translated}]},
        {0: snapshot().localize("가격은 170만 원입니다.")}, "ja", {"JPY"}, exact_money=True,
    )
    assert valid == {} and issues


def test_real_translator_path_accepts_calculated_value_and_preserves_timing(monkeypatch):
    translator = SubtitleTranslator(
        Settings(gemini_api_key="test", gemini_paid_data_processing_confirmed=True),
        currency_snapshot=snapshot().to_dict(),
    )
    monkeypatch.setattr(translator, "_request", lambda *_: {
        "segments": [{"id": 0, "text": "Apple Watchの価格は17万円です。"}],
    })
    result = translator.translate_partial([
        SubtitleSegment(start=2, end=5, text=snapshot().localize(
            "애플워치 가격은 170만 원입니다.",
        )),
    ], source_language="ko", output_language="ja")
    assert result.failures == []
    assert result.segments[0].text == "Apple Watchの価格は17万円です。"
    assert (result.segments[0].start, result.segments[0].end) == (2, 5)


def test_titles_use_clip_local_calculated_money(monkeypatch):
    selector = TranscriptSelector(Settings(gemini_api_key="test",
                                          gemini_paid_data_processing_confirmed=True,
                                          openai_api_key=None))
    monkeypatch.setattr(selector, "_select_with_gemini", lambda **_: [
        HighlightClip(start_seconds=0, end_seconds=40, hook_title="価格は17万円\n価値を確かめる"),
        HighlightClip(start_seconds=60, end_seconds=100, hook_title="価格は17万円\n価値を確かめる"),
    ])
    clips = selector.select(
        video_title="価格を比較", duration_seconds=150, required_count=1,
        transcript=[SubtitleSegment(start=0, end=40, text="価格は170,000円です。"),
                    SubtitleSegment(start=60, end=100, text="価格は1,000円です。")],
        output_language=OutputLanguage.JA, source_language="ko", ground_money=True,
    )
    assert len(clips) == 1 and clips[0].start_seconds == 0
