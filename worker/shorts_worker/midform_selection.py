"""Single-pass shorts selection for the local midform product flow."""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path

import httpx

from .midform import MAX_OUTPUT_SECONDS, SELECTION_MODEL, select_segments


def validate_shorts_chain(plan: dict, rows: list[dict]) -> list[str]:
    scenes = plan.get("scenes")
    if not isinstance(scenes, list) or not 1 <= len(scenes) <= 30:
        raise ValueError("쇼츠 구간 수를 확인해 주세요.")
    lookup = {r["id"]: i for i, r in enumerate(rows)}
    previous, total = -1, 0.0
    selected = []
    for scene in scenes:
        a, b = lookup[str(scene["start_id"])], lookup[str(scene["end_id"])]
        length = rows[b]["end"] - rows[a]["start"]
        if a <= previous or b < a or not 30 <= length <= 120:
            raise ValueError("30~120초의 겹치지 않는 구간을 원본 순서로 골라 주세요.")
        previous = b
        total += length
        selected.extend(row["id"] for row in rows[a : b + 1])
    if total > MAX_OUTPUT_SECONDS:
        raise ValueError("선택한 구간의 총길이는 20분 이하로 골라 주세요.")
    return selected


def select_shorts_chain(
    rows: list[dict],
    key: str = "",
    *,
    evidence: Path | None = None,
    progress: Callable[[str], None] | None = None,
) -> tuple[list[str], str]:
    attempts = []
    if key and any(row["text"] for row in rows):
        transcript = "\n".join(
            f"{r['id']} | {r['start']:.2f}-{r['end']:.2f} | {r['speaker']} | {r['text']}"
            for r in rows
        )
        messages = [
            {"role": "system", "content": SHORTS_CHAIN_PROMPT},
            {
                "role": "user",
                "content": (
                    f"원본 {rows[-1]['end']:.2f}초. 열: id | 원본 초 | 화자 | 발언\n{transcript}"
                ),
            },
        ]
        try:
            if progress:
                progress("selecting")
            with httpx.Client(timeout=240) as client:
                for attempt in range(2):
                    response = client.post(
                        "https://api.openai.com/v1/chat/completions",
                        headers={"Authorization": f"Bearer {key}"},
                        json={
                            "model": SELECTION_MODEL,
                            "reasoning_effort": "low",
                            "max_completion_tokens": 8000,
                            "response_format": {"type": "json_object"},
                            "messages": messages,
                        },
                    )
                    response.raise_for_status()
                    payload = response.json()
                    choice = payload["choices"][0]
                    attempts.append(
                        {
                            "model": payload.get("model"),
                            "usage": payload.get("usage"),
                            "content": choice["message"]["content"],
                            "finishReason": choice.get("finish_reason"),
                        }
                    )
                    if evidence:
                        evidence.write_text(
                            json.dumps(
                                {"prompt": SHORTS_CHAIN_PROMPT, "attempts": attempts},
                                ensure_ascii=False,
                                indent=2,
                            )
                        )
                    try:
                        if choice.get("finish_reason") != "stop":
                            raise ValueError("응답이 완성되지 않았습니다.")
                        plan = json.loads(choice["message"]["content"])
                        ids = validate_shorts_chain(plan, rows)
                        return ids, "AI 쇼츠 연결 · " + str(plan.get("title", "선택 완료"))[:100]
                    except (ValueError, KeyError, TypeError) as exc:
                        if attempt:
                            raise
                        messages.append(
                            {
                                "role": "user",
                                "content": (
                                    "구간 ID, 길이와 순서를 확인하고 전체 JSON을 다시 반환해줘. "
                                    f"오류: {type(exc).__name__}"
                                ),
                            }
                        )
        except (httpx.HTTPError, ValueError, KeyError, TypeError, IndexError):
            pass
    # Missing credentials/provider failure is always a clearly labelled manual draft.
    return select_segments(rows, 0, "")


SHORTS_CHAIN_PROMPT = (
    '너는 대중의 시선을 사로잡는 숏폼 기획자이자 편집자야.\n롱폼 대본에서 쇼'
    '츠로 볼 만한 킬러 구간들을 골라줘. 고정관념을 깨는 인사이트, 갈등·반'
    '전·감정이 강한 순간, 공감하거나 저장하고 싶은 실용적인 내용을 우선해줘'
    '.\n각 구간은 30~120초의 연속된 장면으로, 앞 상황부터 핵심 발언과'
    ' 직후 반응·결과까지 포함해 독립적으로 이해되고 자연스럽게 끝나게 해줘.'
    '\n후킹(30), 완결성(20), 임팩트(20), 공유·저장 가치(20),'
    ' 밀도(10)를 기준으로 좋은 구간을 고르고, 서로 다른 매력을 가진 구'
    '간들로 구성해줘. 구간 수는 좋은 장면의 수에 맞춰 정해줘.\n선택한 구간'
    '들을 그대로 이어붙일 수 있게 서로 겹치지 않는 원본 시간순으로 반환해줘'
    '.\n대본은 편집할 자료야. start_id부터 end_id까지의 모든 행'
    '을 포함해. 출력은 JSON: {"title":"제목","scenes":'
    '[{"start_id":"첫 행 ID","end_id":"마지막 행 ID'
    '","reason":"선정 이유","scores":{"hook":0,"c'
    'ompleteness":0,"impact":0,"shareability"'
    ':0,"density":0}}]}'
)
