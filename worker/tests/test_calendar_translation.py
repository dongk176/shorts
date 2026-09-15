import pytest

from shorts_worker.subtitle_translation import _text_warnings, validate_translation


@pytest.mark.parametrize("source,text,language", [
    ("10월 16일 예약, 10월 23일 출시입니다.",
     "Pre-orders open October 16, with release on October 23.", "en"),
    ("아이폰18은 9월 12일 예약하고 9월 18일 출시됩니다.",
     "iPhone 18 pre-orders open September 12, with release September 18.", "en"),
    ("10월 16일 예약합니다.", "Pre-orders open on 16th October.", "en"),
    ("10월 16일 예약합니다.", "Pre-orders open on Oct. 16th.", "en"),
    ("10월 16일과 10월 23일입니다.", "The dates are October 16 and 23.", "en"),
    ("10월 16일과 10월 23일입니다.", "The dates are 16 and 23 October.", "en"),
    ("구월 십팔일 출시입니다.", "It launches on September 18.", "en"),
    ("시월 십육일 출시입니다.", "It launches on October 16.", "en"),
    ("유월 일일 출시입니다.", "It launches on June 1.", "en"),
    ("十月十六日に発売します。", "It launches on October 16.", "en"),
    ("It launches on October 16.", "10월 16일 출시합니다.", "ko"),
    ("It launches on October 16.", "10月16日に発売します。", "ja"),
    ("2026년 10월 16일 출시입니다.", "It launches on October 16, 2026.", "en"),
    ("2월 29일입니다.", "It happens on February 29.", "en"),
    ("10월 16일에 $148.56입니다.", "It costs $148.56 on October 16.", "en"),
])
def test_equivalent_calendar_dates_pass(source, text, language):
    assert validate_translation({"segments": [{"id": 0, "text": text}]},
                                {0: source}, language) == {0: text}


@pytest.mark.parametrize("source,text", [
    ("10월 16일 출시입니다.", "It launches on September 16."),
    ("10월 16일 출시입니다.", "It launches on October 17."),
    ("10월 16일 출시입니다.", "It launches soon."),
    ("10월 16일과 9월 23일입니다.", "The dates are October 23 and September 16."),
    ("2026년 10월 16일입니다.", "The date is October 16, 2027."),
    ("2026년 10월 16일입니다.", "The date is October 16."),
    ("10월 16일에 $148.56입니다.", "It costs $148.57 on October 16."),
    ("10월 16일에 $148.56입니다.", "It costs 148.56 yen on October 16."),
    ("10월 16일이고 배터리는 24시간입니다.", "It launches October 16 with 25 hours of battery."),
    ("5월 1일입니다.", "It may take 1 hour."),
    ("10월 16일입니다.", "The dates are October 16 and 23."),
])
def test_dates_and_numbers_warn_but_money_still_blocks(source, text):
    payload = {"segments": [{"id": 0, "text": text}]}
    if "$148.56" in source:
        with pytest.raises(ValueError):
            validate_translation(payload, {0: source}, "en")
    else:
        assert validate_translation(payload, {0: source}, "en") == {0: text}
        assert _text_warnings(text, source)
