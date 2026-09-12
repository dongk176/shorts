import json
from pathlib import Path

import pytest

from shorts_worker.money_facts import ungrounded_money

CASES = json.loads(Path(__file__).with_name("fixtures").joinpath("money-facts.json").read_text())


@pytest.mark.parametrize("case", CASES)
def test_money_magnitudes_ranges_and_ambiguous_transcription(case):
    assert ungrounded_money(case["text"], case["source"]) == case["reject"]
