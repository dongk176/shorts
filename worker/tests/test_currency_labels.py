import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from shorts_worker.language_context import has_unlabeled_amount
from shorts_worker.localized_selection import LocalizedSelectionError
from shorts_worker.schemas import OutputLanguage
from shorts_worker.selector import TranscriptSelector

CASES = json.loads(
    Path(__file__).with_name("fixtures").joinpath("currency-label-cases.json").read_text(),
)


@pytest.mark.parametrize("case", CASES)
def test_currency_label_boundaries(case):
    source = case.get("source", "15만 원과 53만 달러입니다.")
    assert has_unlabeled_amount(case["text"], source) == case["missing"]


def test_title_and_reason_validation_preserves_legacy_and_checks_each_field():
    response = {"clips": [{
        "start_seconds": 0, "end_seconds": 45,
        "hook_title_line1": "月7億超を稼ぐ方法", "hook_title_line2": "自動でドルが貯まる",
        "reason": "53万ドルを稼いだという話です。",
        "hook_score": 25, "completeness_score": 18, "impact_score": 18,
        "shareability_score": 18, "density_score": 8,
    }]}
    client = MagicMock()
    client.beta.chat.completions.parse.return_value = SimpleNamespace(choices=[
        SimpleNamespace(message=SimpleNamespace(parsed=response))])
    messages = [{"role": "user", "content": "53만 달러와 1,200만 원입니다."}]
    assert TranscriptSelector._parse_selection(client, "test", messages, OutputLanguage.JA)
    client.chat.completions.create.side_effect = lambda **kwargs: SimpleNamespace(
        usage=None, choices=[SimpleNamespace(finish_reason="stop", message=SimpleNamespace(
            content=json.dumps(response),
        ))],
    )
    with pytest.raises(LocalizedSelectionError, match="candidate_validation"):
        TranscriptSelector._parse_selection(client, "test", messages, OutputLanguage.JA, "ko")
    response["clips"][0]["hook_title_line1"] = "月53万ドル稼ぐ方法"
    response["clips"][0]["reason"] = "月7億超を稼ぐ話です。"
    client.chat.completions.create.side_effect = lambda **kwargs: SimpleNamespace(
        usage=None, choices=[SimpleNamespace(finish_reason="stop", message=SimpleNamespace(
            content=json.dumps(response),
        ))],
    )
    with pytest.raises(LocalizedSelectionError, match="candidate_validation"):
        TranscriptSelector._parse_selection(client, "test", messages, OutputLanguage.JA, "ko")
