import json

import httpx
import pytest

from shorts_worker.midform import normalize_segments
from shorts_worker.midform_selection import select_shorts_chain, validate_shorts_chain


def test_one_call_preserves_whole_shorts_without_target_or_refinement(monkeypatch):
    from shorts_worker import midform_selection as module

    rows = normalize_segments(
        [{"start": i, "end": i + 10, "text": f"line {i}"} for i in range(0, 200, 10)], 200
    )
    calls = []

    class Client:
        def __init__(self, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def post(self, url, **kwargs):
            calls.append(kwargs["json"])
            return httpx.Response(
                200,
                request=httpx.Request("POST", url),
                json={
                    "choices": [
                        {
                            "finish_reason": "stop",
                            "message": {
                                "content": json.dumps(
                                    {
                                        "title": "Highlights",
                                        "scenes": [
                                            {"start_id": "2", "end_id": "5"},
                                            {"start_id": "10", "end_id": "13"},
                                        ],
                                    }
                                )
                            },
                        }
                    ]
                },
            )

    monkeypatch.setattr(module.httpx, "Client", Client)
    ids, mode = select_shorts_chain(rows, "test-only")
    assert ids == ["2", "3", "4", "5", "10", "11", "12", "13"]
    assert len(calls) == 1 and mode.startswith("AI 쇼츠 연결")
    assert "희망" not in str(calls[0]["messages"])
    assert "keep_ids" not in str(calls[0]["messages"])


@pytest.mark.parametrize(
    "scenes",
    [
        [{"start_id": "2", "end_id": "3"}],
        [{"start_id": "0", "end_id": "13"}],
        [{"start_id": "3", "end_id": "6"}, {"start_id": "2", "end_id": "5"}],
        [{"start_id": "19", "end_id": "22"}],
    ],
)
def test_invalid_shorts_are_rejected(scenes):
    rows = normalize_segments([{"start": i, "end": i + 10} for i in range(0, 200, 10)], 200)
    with pytest.raises((ValueError, KeyError)):
        validate_shorts_chain({"scenes": scenes}, rows)


def test_no_key_remains_explicit_manual_fallback():
    rows = normalize_segments([{"start": i, "end": i + 20} for i in range(0, 720, 20)], 720)
    ids, mode = select_shorts_chain(rows)
    assert ids and mode.startswith("수동")
