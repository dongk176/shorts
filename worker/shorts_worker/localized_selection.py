"""Validate localized candidates independently, without logging generated/source text."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from typing import Any

from pydantic import ValidationError

from .prompt_language import LOCALIZED_SELECTION_PROMPTS
from .schemas import HighlightCandidate, HighlightClip, SelectionResponse


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
    for index, raw in enumerate(payload["clips"]):
        rejection: dict[str, object] = {"candidate_index": index + 1}
        try:
            candidate = HighlightCandidate.model_validate(raw)
        except ValidationError as error:
            rejection.update(code="schema", fields=[
                {"field": str(e["loc"][0]) if e["loc"]
                 and e["loc"][0] in HighlightCandidate.model_fields else "$candidate",
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
    # Use the regular title bounds and retain independently valid candidates.
    schema = SelectionResponse.model_json_schema()
    target = {"ko": "Korean", "en": "English", "ja": "Japanese"}.get(language, language)
    fields = schema["$defs"]["HighlightCandidate"]["properties"]
    for name in ("hook_title_line1", "hook_title_line2", "reason"):
        fields[name]["description"] = (
            f"Write in {target}, preserving the source facts and meaning."
        )
    response = client.chat.completions.create(
        model=model, messages=messages,
        response_format={"type": "json_schema", "json_schema": {
            "name": "LocalizedSelectionResponse", "strict": True,
            "schema": schema,
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
    templates = LOCALIZED_SELECTION_PROMPTS[language]
    scope = templates["repair_rejected" if error.attempt.rejected else "repair_format"]
    instruction = templates["repair"]
    return scope + instruction + "\n" + json.dumps({
        "failure": error.code, "rejected": error.attempt.rejected,
        "accepted_ranges": accepted,
    }, ensure_ascii=False, allow_nan=False)
