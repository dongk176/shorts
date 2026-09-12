"""Validate localized candidates independently, without logging generated/source text."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from typing import Any

from pydantic import ValidationError

from .content_language import text_matches_language
from .language_context import has_unlabeled_amount, mentioned_currencies
from .money_facts import ungrounded_money
from .schemas import HighlightClip, LocalizedHighlightCandidate, LocalizedSelectionResponse


@dataclass
class SelectionAttempt:
    clips: list[HighlightClip] = field(default_factory=list)
    rejected: list[dict[str, object]] = field(default_factory=list)


class LocalizedSelectionError(ValueError):
    def __init__(self, code: str, attempt: SelectionAttempt | None = None):
        super().__init__(code)
        self.code = code
        self.attempt = attempt or SelectionAttempt()


def validate_candidates(payload: object, *, language: str, source: str) -> SelectionAttempt:
    if not isinstance(payload, dict) or set(payload) != {"clips"}:
        raise LocalizedSelectionError("invalid_response_shape")
    if not isinstance(payload["clips"], list) or not payload["clips"]:
        raise LocalizedSelectionError("empty_candidates")
    result = SelectionAttempt()
    currencies = mentioned_currencies(source)
    for index, raw in enumerate(payload["clips"]):
        rejection: dict[str, object] = {"candidate_index": index + 1}
        try:
            candidate = LocalizedHighlightCandidate.model_validate(raw)
        except ValidationError as error:
            rejection.update(code="schema", fields=[
                {"field": str(e["loc"][0]) if e["loc"]
                 and e["loc"][0] in LocalizedHighlightCandidate.model_fields else "$candidate",
                 "code": e["type"]}
                for e in error.errors(include_input=False, include_context=False)[:10]
            ])
            result.rejected.append(rejection)
            continue
        rejection.update(start_seconds=candidate.start_seconds, end_seconds=candidate.end_seconds)
        if (not math.isfinite(candidate.start_seconds) or not math.isfinite(candidate.end_seconds)
                or candidate.start_seconds < 0 or candidate.end_seconds <= candidate.start_seconds):
            result.rejected.append({"candidate_index": index + 1, "code": "invalid_range"})
            continue
        title = candidate.hook_title_line1 + "\n" + candidate.hook_title_line2
        # A proper name may occupy a title line. Check the complete title's script,
        # while preserving the strict per-line length and no-foreign-script rules.
        for name, text in (("title", title), ("reason", candidate.reason)):
            code = None
            if not text_matches_language(text, language):
                code = "language"
            elif currencies and mentioned_currencies(text) - currencies:
                code = "currency_changed"
            elif has_unlabeled_amount(text, source):
                code = "currency_label_missing"
            elif ungrounded_money(text, source):
                code = "money_not_grounded"
            if code:
                rejection.update(code=code, field=name)
                result.rejected.append(rejection)
                break
        else:
            result.clips.append(HighlightClip(
                start_seconds=candidate.start_seconds, end_seconds=candidate.end_seconds,
                hook_title=title, reason=candidate.reason,
                viral_score=sum((candidate.hook_score, candidate.completeness_score,
                                 candidate.impact_score, candidate.shareability_score,
                                 candidate.density_score)),
            ))
    return result


def request_candidates(
    client: Any, model: str, messages: list[dict[str, str]], language: str,
    *, max_tokens: int | None = None,
) -> SelectionAttempt:
    # Keep the same strict generation schema, but validate each returned item locally
    # instead of letting SDK parsing discard all candidates for one invalid title.
    response = client.chat.completions.create(
        model=model, messages=messages,
        response_format={"type": "json_schema", "json_schema": {
            "name": "LocalizedSelectionResponse", "strict": True,
            "schema": LocalizedSelectionResponse.model_json_schema(),
        }},
        **({"max_tokens": max_tokens} if max_tokens is not None else {}),
    )
    usage = getattr(response, "usage", None)
    if usage is not None:
        print(json.dumps({"event": "highlight_selection_usage", "model": model,
                          "input_tokens": usage.prompt_tokens,
                          "output_tokens": usage.completion_tokens}), flush=True)
    if not response.choices:
        raise LocalizedSelectionError("empty_choices")
    choice = response.choices[0]
    if choice.finish_reason == "length":
        raise LocalizedSelectionError("output_limit")
    if getattr(choice.message, "refusal", None):
        raise LocalizedSelectionError("provider_refusal")
    try:
        payload = json.loads(choice.message.content or "")
    except (TypeError, ValueError) as exc:
        raise LocalizedSelectionError("invalid_json") from exc
    source = "\n".join(m["content"] for m in messages if m["role"] == "user")
    attempt = validate_candidates(payload, language=language, source=source)
    if attempt.rejected:
        raise LocalizedSelectionError("candidate_validation", attempt)
    return attempt


def repair_instruction(language: str, error: LocalizedSelectionError) -> str:
    accepted = [{"start_seconds": c.start_seconds, "end_seconds": c.end_seconds}
                for c in error.attempt.clips]
    scope = (
        "Return only replacements for rejected candidates. " if error.attempt.rejected
        else "Regenerate the requested candidates after correcting the response format. "
    ) if language == "en" else (
        "不合格の候補だけを修正して返す。" if error.attempt.rejected
        else "応答形式を修正し、要求された候補を再生成する。"
    )
    instruction = (
        "Keep accepted ranges unchanged and "
        "do not overlap them by more than 5 seconds. Correct the listed validation failures; "
        "hook_title_line1 and hook_title_line2 must each contain 5–18 characters. "
        "Preserve source facts and all original "
        "rules. Do not guess unclear amounts. Return the same JSON structure."
        if language == "en" else
        "合格済みの区間は変更せず、5秒を超えて重複させない。"
        "記載された検証エラーを修正し、hook_title_line1 と hook_title_line2 を各5〜18文字にする。"
        "原文の事実と元の全条件を守り、不明確な金額は推測しない。同じJSON形式で返す。"
    )
    if any(item.get("code") in {
        "money_not_grounded", "currency_changed", "currency_label_missing",
    } for item in error.attempt.rejected):
        instruction += (
            " For candidates rejected over money or currency, omit monetary amounts from "
            "the title and reason; do not replace them with a different amount."
            if language == "en" else
            " 金額・通貨の検証に失敗した候補は、タイトルと選定理由から金額を省き、"
            "別の金額に置き換えない。"
        )
    return scope + instruction + "\n" + json.dumps({
        "failure": error.code, "rejected": error.attempt.rejected,
        "accepted_ranges": accepted,
    }, ensure_ascii=False, allow_nan=False)
