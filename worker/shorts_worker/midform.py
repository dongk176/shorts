"""Isolated single-source midform experiment. Never submits a cloud job."""

from __future__ import annotations

import json
import math
import re
import tempfile
import time
from collections.abc import Callable
from pathlib import Path

import httpx

from .media import media_duration, probe_media, run_command

SELECTION_MODEL = "gpt-5.4"
MAX_SEGMENTS = 6000
MAX_OUTPUT_SECONDS = 1200
DELIVERY_AUDIO_FILTER = "loudnorm=I=-16:TP=-3.5:LRA=11,aresample=48000,apad"


def checked_run(args: list[str], timeout: float = 180) -> str:
    result = run_command(args, timeout=timeout)
    if result.returncode:
        raise ValueError("영상 처리에 실패했습니다. 다른 파일로 다시 시도해 주세요.")
    return result.stderr


def inspect_source(source: Path) -> tuple[float, bool]:
    probe = probe_media(source)
    duration = media_duration(probe)
    streams = probe.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    if not video or not math.isfinite(duration) or not 600 <= duration <= 3600:
        raise ValueError("10~60분 길이의 영상을 선택해 주세요.")
    if int(video.get("width", 0)) * int(video.get("height", 0)) > 3840 * 2160:
        raise ValueError("4K 이하의 영상을 선택해 주세요.")
    return duration, any(s.get("codec_type") == "audio" for s in streams)


def normalize_segments(rows: list[dict], duration: float) -> list[dict]:
    if not isinstance(rows, list) or not 1 <= len(rows) <= MAX_SEGMENTS:
        raise ValueError("편집 구간 수가 올바르지 않습니다.")
    result = []
    last_end = 0.0
    for i, row in enumerate(rows):
        if not isinstance(row, dict):
            raise ValueError("편집 구간 형식이 올바르지 않습니다.")
        start, end = float(row["start"]), float(row["end"])
        if not all(math.isfinite(n) for n in [start, end]):
            raise ValueError("시간 값이 올바르지 않습니다.")
        if start < last_end - 0.001 or end <= start or end > duration + 0.05:
            raise ValueError("구간은 겹치지 않고 원본 시간 안에 있어야 합니다.")
        text = str(row.get("text", ""))[:2000].replace("\x00", "")
        result.append(
            {
                "id": str(i),
                "start": start,
                "end": min(end, duration),
                "text": text,
                "speaker": str(row.get("speaker", "unknown"))[:80],
                "keep": row.get("keep", True) is True,
            }
        )
        last_end = end
    return result


def validate_speaker_assignments(rows: list[dict], originals: list[dict], names: dict) -> None:
    import re

    known = {row["speaker"] for row in originals} | {"unknown", "overlap"}
    custom = re.compile(r"user_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
    if not isinstance(names, dict) or len(set(names) - known) > 64:
        raise ValueError("화자 지정을 확인해 주세요.")
    for row in rows:
        key = row["speaker"]
        if key not in known and not (
            custom.fullmatch(key)
            and isinstance(names.get(key), str)
            and 0 < len(names[key].strip()) <= 80
        ):
            raise ValueError("화자 지정을 확인해 주세요.")


def from_words(words: list[dict], duration: float) -> list[dict]:
    rows: list[dict] = []
    for word in words:
        if word.get("type") != "word":
            continue
        start, end = float(word["start"]), float(word["end"])
        if not all(math.isfinite(n) for n in (start, end)) or end <= start:
            continue
        speaker = word.get("speaker_id") or "unknown"
        if rows and start < rows[-1]["end"]:
            # Overlapping speech is kept in one uncropped row, never guessed as one face.
            rows[-1]["end"] = max(rows[-1]["end"], end)
            rows[-1]["text"] += " " + str(word["text"])
            rows[-1]["speaker"] = "overlap"
        elif (
            rows
            and speaker == rows[-1]["speaker"]
            and end - rows[-1]["start"] <= 12
            and start - rows[-1]["end"] < 1.2
            and not re.search(r"[.!?。！？]$", rows[-1]["text"])
        ):
            rows[-1]["end"] = end
            rows[-1]["text"] += " " + str(word["text"])
        else:
            rows.append({"start": start, "end": end, "text": str(word["text"]), "speaker": speaker})
    # Keep a small amount of room around speech, without overlapping adjacent rows.
    for i, row in enumerate(rows):
        row["start"] = max(rows[i - 1]["end"] if i else 0, row["start"] - 0.12)
        row["end"] = min(rows[i + 1]["start"] if i + 1 < len(rows) else duration, row["end"] + 0.18)
    # A transcript gap is not proof of silence. Keep selectable source ranges for
    # laughter, demonstrations, music and unrecognised speech as well.
    complete = []
    cursor = 0.0
    for row in rows:
        while row["start"] - cursor >= 0.4:
            end = min(cursor + 20, row["start"])
            complete.append({"start": cursor, "end": end, "text": "", "speaker": "unknown"})
            cursor = end
        complete.append(row)
        cursor = row["end"]
    while duration - cursor >= 0.4:
        end = min(cursor + 20, duration)
        complete.append({"start": cursor, "end": end, "text": "", "speaker": "unknown"})
        cursor = end
    return normalize_segments(complete, duration)


def transcribe(source: Path, duration: float, key: str) -> list[dict]:
    with tempfile.TemporaryDirectory(prefix="midform-audio-", dir=source.parent) as temp:
        audio = Path(temp) / "speech.mp3"
        checked_run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-y",
                "-i",
                str(source),
                "-vn",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-b:a",
                "48k",
                str(audio),
            ],
            300,
        )
        with audio.open("rb") as stream, httpx.Client(timeout=600) as client:
            response = client.post(
                "https://api.elevenlabs.io/v1/speech-to-text",
                headers={"xi-api-key": key},
                files={"file": ("speech.mp3", stream, "audio/mpeg")},
                data={
                    "model_id": "scribe_v2",
                    "diarize": "true",
                    "timestamps_granularity": "word",
                    "tag_audio_events": "true",
                    "no_verbatim": "false",
                },
            )
        if response.status_code != 200:
            raise ValueError("음성 분석을 완료하지 못했습니다. 수동 편집으로 진행할 수 있습니다.")
        return from_words(response.json().get("words", []), duration)


SILENCE_PRESETS = {
    "aggressive": {"noise_db": -30, "minimum": 0.30, "padding": 0.08},
    "medium": {"noise_db": -35, "minimum": 0.60, "padding": 0.16},
    "relaxed": {"noise_db": -40, "minimum": 1.00, "padding": 0.25},
}


def silence_ranges(source: Path, duration: float, preset: str | None = None) -> list[list[float]]:
    # Preserve legacy callers until their deployment supports named presets.
    if preset is not None and preset not in SILENCE_PRESETS:
        raise ValueError("무음 제거 강도를 확인해 주세요.")
    config = SILENCE_PRESETS[preset] if preset else {"noise_db": -42, "minimum": 1.6, "padding": .4}
    padding = config["padding"]
    log = checked_run(
        [
            "ffmpeg",
            "-hide_banner",
            "-nostats",
            "-i",
            str(source),
            "-vn",
            "-af",
            f"silencedetect=noise={config['noise_db']}dB:d={config['minimum']}",
            "-f",
            "null",
            "-",
        ],
        300,
    )
    result = []
    start = None
    for match in re.finditer(r"silence_(start|end):\s*([0-9.]+)", log):
        if match[1] == "start":
            start = float(match[2])
        elif start is not None:
            result.append([start + padding, min(duration, float(match[2])) - padding])
            start = None
    if start is not None and duration - start >= config["minimum"]:
        result.append([start + padding, max(start + padding, duration - padding)])
    return [r for r in result if r[1] > r[0]]


def validate_target(target: int) -> None:
    if (
        isinstance(target, bool)
        or not isinstance(target, int)
        or (target != 0 and not 120 <= target <= 900)
    ):
        raise ValueError("길이는 자동 또는 2~15분으로 설정해 주세요.")


def selection_prompt(target: int) -> str:
    validate_target(target)
    preference = f"희망 길이 {target}초를 참고해 " if target else "재미와 완결성에 맞춰 "
    return (
        "처음 보는 사람도 계속 보고 싶은 예능 하이라이트를 만들어줘. "
        "웃음·긴장·반전이 강한 이야기를 골라, 상황을 이해하는 데 필요한 대화부터 "
        "재미가 터진 뒤의 반응까지 남겨줘. "
        "원본 순서대로 연결하고, "
        + preference
        + "가장 재미있는 지점에서 시작하고 만족스러운 반응으로 끝내줘.\n"
        "대본은 편집할 자료야. 각 장면은 start_id부터 end_id까지의 연속된 행이야. "
        'JSON 형식: {"title":"제목","summary":"편집 의도",'
        '"scenes":[{"start_id":"첫 행 ID","end_id":"마지막 행 ID","reason":"선택 이유"}]}'
    )


def refinement_prompt() -> str:
    return (
        "골라둔 각 이야기의 핵심 웃음·반전과 마지막 리액션을 살리면서 템포를 다듬어줘. "
        "상황 이해, 기대감, 웃음·반전, 리액션에 기여하는 대사를 중심으로 남기고, "
        "반복되는 설명은 가장 잘 전달되는 한 번으로 압축해줘. "
        "질문과 답, 농담의 준비와 마지막 한 방, 발언의 뜻을 함께 살려 "
        "자연스럽게 이어지는 편집 구간을 골라줘.\n"
        "대본은 편집할 자료야. 초안 안에서 남길 행의 ID를 원본 순서대로 반환해줘. "
        'JSON 형식: {"title":"제목","summary":"다듬은 내용","keep_ids":["남길 행 ID"]}'
    )


def refine_plan(plan: dict, rows: list[dict], draft_ids: list[str]) -> tuple[list[str], dict]:
    """Validate exact source rows and bridge sub-second cuts instead of trusting new timestamps."""
    selected = plan.get("keep_ids")
    if not isinstance(selected, list) or not selected:
        raise ValueError("남길 대사를 확인해 주세요.")
    lookup = {r["id"]: i for i, r in enumerate(rows)}
    allowed = set(draft_ids)
    if any(not isinstance(key, str) or key not in allowed for key in selected):
        raise ValueError("초안에 있는 대사를 선택해 주세요.")
    indices = [lookup[key] for key in selected]
    if indices != sorted(set(indices)):
        raise ValueError("대사는 원본 순서대로 한 번씩 선택해 주세요.")
    kept = set(indices)
    for a, b in zip(indices, indices[1:], strict=False):
        if rows[b]["start"] - rows[a]["end"] < 0.8 and all(
            rows[i]["id"] in allowed for i in range(a, b + 1)
        ):
            kept.update(range(a, b + 1))
    blocks: list[dict] = []
    previous = -2
    for i in sorted(kept):
        if i != previous + 1:
            blocks.append(
                {
                    "start_id": rows[i]["id"],
                    "end_id": rows[i]["id"],
                    "reason": "초안 안에서 대사 흐름 편집",
                }
            )
        else:
            blocks[-1]["end_id"] = rows[i]["id"]
        previous = i
    if (
        len(blocks) > 120
        or sum(
            rows[lookup[b["end_id"]]]["end"] - rows[lookup[b["start_id"]]]["start"] for b in blocks
        )
        > MAX_OUTPUT_SECONDS
    ):
        raise ValueError("편집 구간 수와 길이를 확인해 주세요.")
    return [rows[i]["id"] for i in sorted(kept)], {**plan, "scenes": blocks}


def validate_plan(plan: dict, rows: list[dict]) -> list[str]:
    scenes = plan.get("scenes")
    if not isinstance(scenes, list) or not 1 <= len(scenes) <= 8:
        raise ValueError("장면 구성을 확인해 주세요.")
    lookup = {r["id"]: i for i, r in enumerate(rows)}
    ids = []
    previous = -1
    total = 0.0
    for scene in scenes:
        a, b = lookup[str(scene["start_id"])], lookup[str(scene["end_id"])]
        if a <= previous or b < a or rows[b]["end"] - rows[a]["start"] < 12:
            raise ValueError("장면은 원본 순서의 완결된 대화로 선택해 주세요.")
        ids.extend(r["id"] for r in rows[a : b + 1])
        total += rows[b]["end"] - rows[a]["start"]
        previous = b
    if total > MAX_OUTPUT_SECONDS:
        raise ValueError("편집 길이는 최대 20분입니다.")
    return ids


def select_segments(
    rows: list[dict],
    target: int,
    key: str = "",
    evidence: Path | None = None,
    progress: Callable[[str], None] | None = None,
    *,
    model: str = SELECTION_MODEL,
    reasoning: str = "low",
) -> tuple[list[str], str]:
    prompt = selection_prompt(target)
    attempts: list[dict] = []
    if key and any(r["text"] for r in rows):
        try:
            source_length = rows[-1]["end"]
            preferred = target or round(min(480, max(120, source_length * 0.35)))
            transcript = "\n".join(
                f"{r['id']} | {r['start']:.2f}-{r['end']:.2f} | {r['speaker']} | {r['text']}"
                for r in rows
            )
            messages = [
                {"role": "system", "content": prompt},
                {
                    "role": "user",
                    "content": (
                        f"원본 {source_length:.1f}초. 편집 희망 길이 약 {preferred}초. "
                        "대본 열: id | 원본 초 | 화자 | 발언\n" + transcript
                    ),
                },
            ]
            usages = []
            plans = []
            draft_ids: list[str] = []
            with httpx.Client(timeout=240) as client:
                for revision in range(2):
                    if progress:
                        progress("reviewing" if revision else "selecting")
                    response = client.post(
                        "https://api.openai.com/v1/chat/completions",
                        headers={"Authorization": f"Bearer {key}"},
                        json={
                            "model": model,
                            "reasoning_effort": reasoning,
                            "max_completion_tokens": 12000,
                            "response_format": {"type": "json_object"},
                            "messages": messages,
                        },
                    )
                    response.raise_for_status()
                    payload = response.json()
                    content = payload["choices"][0]["message"]["content"]
                    attempts.append(
                        {
                            "model": payload.get("model"),
                            "usage": payload.get("usage"),
                            "finishReason": payload["choices"][0].get("finish_reason"),
                            "content": content,
                        }
                    )
                    if evidence:
                        evidence.write_text(
                            json.dumps(
                                {"target": target, "attempts": attempts},
                                ensure_ascii=False,
                                indent=2,
                            ),
                            encoding="utf-8",
                        )
                    plan = json.loads(content)
                    if revision == 0:
                        selected = validate_plan(plan, rows)
                    else:
                        selected, plan = refine_plan(plan, rows, draft_ids)
                    plans.append(plan)
                    usages.append(payload.get("usage"))
                    if revision == 0:
                        draft_ids = selected
                        draft_sections = []
                        lookup = {r["id"]: i for i, r in enumerate(rows)}
                        for number, scene in enumerate(plan["scenes"], 1):
                            a = lookup[str(scene["start_id"])]
                            b = lookup[str(scene["end_id"])]
                            section = f"이야기 {number}: {scene.get('reason', '')}\n"
                            section += "\n".join(
                                f"{r['id']} | {r['start']:.2f}-{r['end']:.2f} | "
                                f"{r['speaker']} | {r['text']}"
                                for r in rows[a : b + 1]
                            )
                            draft_sections.append(section)
                        messages = [
                            {"role": "system", "content": refinement_prompt()},
                            {
                                "role": "user",
                                "content": (
                                    f"초안 제목: {plan.get('title', '')}\n"
                                    f"희망 길이 약 {preferred}초.\n"
                                    "초안 대본 열: id | 원본 초 | 화자 | 발언\n"
                                    + "\n\n".join(draft_sections)
                                ),
                            },
                        ]
            if evidence:
                evidence.write_text(
                    json.dumps(
                        {
                            "target": target,
                            "attempts": attempts,
                            "plan": plan,
                            "firstDraft": plans[0],
                            "prompts": {"selection": prompt, "refinement": refinement_prompt()},
                            "usage": usages,
                            "model": payload.get("model"),
                        },
                        ensure_ascii=False,
                        indent=2,
                    ),
                    encoding="utf-8",
                )
            return selected, "AI 이야기 편집 · " + str(plan.get("title", "선택 완료"))[:100]
        except (httpx.HTTPError, ValueError, KeyError, TypeError, IndexError) as exc:
            if evidence:
                failure = {"target": target, "attempts": attempts, "errorType": type(exc).__name__}
                if isinstance(exc, httpx.HTTPStatusError):
                    failure["httpStatus"] = exc.response.status_code
                evidence.write_text(
                    json.dumps(failure, ensure_ascii=False, indent=2), encoding="utf-8"
                )
    # A contiguous manual draft is honest and coherent when semantic analysis is unavailable.
    budget = target or min(300, rows[-1]["end"])
    selected = [r["id"] for r in rows if r["end"] <= rows[0]["start"] + budget]
    return selected or [rows[0]["id"]], "수동 초안 · AI 선별 미완료, 앞부분을 연속으로 열었습니다."


def edit_ranges(
    rows: list[dict], silences: list[list[float]], remove_silence: bool, framing: dict
) -> list[dict]:
    # Adjacent selected utterances share one continuous shot, including their breathing room.
    blocks: list[dict] = []
    interrupted = True
    for row in rows:
        if not row["keep"]:
            interrupted = True
            continue
        position = framing.get(row["speaker"], "wide")
        if position not in ("wide", "left", "center", "right"):
            raise ValueError("화자 구도가 올바르지 않습니다.")
        if row["speaker"] in ("unknown", "overlap"):
            position = "wide"
        cue = {"start": row["start"], "end": row["end"], "text": row["text"]}
        if (
            blocks
            and not interrupted
            and blocks[-1]["position"] == position
            and row["start"] - blocks[-1]["end"] <= 0.5
        ):
            blocks[-1]["end"] = row["end"]
            blocks[-1]["captions"].append(cue)
        else:
            blocks.append(
                {
                    "start": row["start"],
                    "end": row["end"],
                    "position": position,
                    "text": "",
                    "captions": [cue],
                }
            )
        interrupted = False
    ranges = []
    for block in blocks:
        pieces = [(block["start"], block["end"])]
        for left, right in silences if remove_silence else []:
            next_pieces = []
            for start, end in pieces:
                if right <= start or left >= end:
                    next_pieces.append((start, end))
                else:
                    if left - start >= 0.08:
                        next_pieces.append((start, left))
                    if end - right >= 0.08:
                        next_pieces.append((right, end))
            pieces = next_pieces
        for a, b in pieces:
            ranges.append(
                {
                    **block,
                    "start": a,
                    "end": b,
                    "captions": [
                        {**cue, "start": max(a, cue["start"]), "end": min(b, cue["end"])}
                        for cue in block["captions"]
                        if cue["start"] < b and cue["end"] > a
                    ],
                }
            )
    if not ranges or len(ranges) > 1600:
        raise ValueError("내보낼 구간을 선택해 주세요. 구간은 1,600개 이하로 제한됩니다.")
    if sum(r["end"] - r["start"] for r in ranges) > MAX_OUTPUT_SECONDS + 0.1:
        raise ValueError("편집 길이를 20분 이하로 줄여 주세요.")
    return ranges


def srt_time(seconds: float) -> str:
    value = round(seconds * 1000)
    return (
        f"{value // 3600000:02}:{value // 60000 % 60:02}:{value // 1000 % 60:02},{value % 1000:03}"
    )


def render(
    source: Path,
    output: Path,
    ranges: list[dict],
    has_audio: bool,
    entertainment: dict | None = None,
) -> None:
    """Seek and encode each piece sequentially, bounding memory on 60-minute sources."""
    deadline = time.monotonic() + 2400
    probe = probe_media(source)
    from .editor_renderer import _escape_filter_path
    from .midform_captions import FONTS, validate_captions, write_caption_ass

    entertainment = validate_captions(entertainment, media_duration(probe))
    video = next(s for s in probe["streams"] if s["codec_type"] == "video")
    width, height = int(video["width"]), int(video["height"])
    scale = min(1, 1920 / width, 1080 / height)
    width, height = int(width * scale) // 2 * 2, int(height * scale) // 2 * 2
    rate = str(video.get("avg_frame_rate", "30/1")).split("/")
    fps = min(60, max(1, float(rate[0]) / max(1, float(rate[-1]))))
    offset = 0.0
    captions = []
    clip_lengths = []
    with tempfile.TemporaryDirectory(prefix="midform-render-", dir=output.parent) as temp:
        directory = Path(temp)
        for i, row in enumerate(ranges):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ValueError("영상 처리 시간이 초과되었습니다.")
            a, b = row["start"], row["end"]
            clip_length = max(1, round((b - a) * fps)) / fps
            clip_lengths.append(clip_length)
            crop = ""
            if row["position"] != "wide":
                x = {"left": "0", "center": "(iw-ow)/2", "right": "iw-ow"}[row["position"]]
                crop = f"crop=trunc(iw/1.4/2)*2:trunc(ih/1.4/2)*2:{x}:(ih-oh)/2,"
            filters = (
                crop + f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
                f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={fps},"
                "tpad=stop_mode=clone:stop_duration=0.1"
            )
            ass = directory / f"captions-{i}.ass"
            if write_caption_ass(ass, entertainment, a, b, width, height):
                filters += (
                    f",ass='{_escape_filter_path(ass)}':fontsdir='{_escape_filter_path(FONTS)}'"
                )
            args = [
                "ffmpeg",
                "-v",
                "error",
                "-y",
                "-threads",
                "2",
                "-ss",
                str(a),
                "-i",
                str(source),
                "-t",
                str(clip_length),
                "-map",
                "0:v:0",
                "-vf",
                filters,
                "-filter_threads",
                "2",
                "-c:v",
                "libx264",
                "-preset",
                "fast",
                "-crf",
                "19",
                "-threads",
                "2",
                "-pix_fmt",
                "yuv420p",
            ]
            if has_audio:
                args += [
                    "-map",
                    "0:a:0",
                    "-af",
                    f"aresample=48000,asetpts=PTS-STARTPTS,afade=t=in:d=0.008,"
                    f"afade=t=out:st={max(0, clip_length - 0.008)}:d=0.008,apad",
                    "-c:a",
                    "pcm_f32le",
                    "-ac",
                    "2",
                ]
            else:
                args += ["-an"]
            args += [str(directory / f"piece-{i}.mkv")]
            checked_run(args, min(remaining, 600))
            cues = row.get("captions", [{"start": a, "end": b, "text": row["text"]}])
            for cue in cues:
                clean = re.sub(r"\s+", " ", cue["text"]).strip()
                begin = offset + max(0, cue["start"] - a)
                finish = offset + min(clip_length, cue["end"] - a)
                if clean and finish > begin:
                    captions.append(
                        f"{len(captions) + 1}\n{srt_time(begin)} --> {srt_time(finish)}\n{clean}\n"
                    )
            offset += clip_length
        manifest = directory / "pieces.txt"
        manifest.write_text(
            "\n".join(
                f"file 'piece-{i}.mkv'\nduration {length:.9f}"
                for i, length in enumerate(clip_lengths)
            ),
            encoding="utf-8",
        )
        # Generated filenames only. PCM intermediates avoid per-cut AAC priming delay.
        args = [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-f",
            "concat",
            "-safe",
            "1",
            "-i",
            str(manifest),
            "-c:v",
            "copy",
        ]
        if has_audio:
            args += ["-af", DELIVERY_AUDIO_FILTER, "-ar", "48000", "-c:a", "aac", "-b:a", "192k"]
        args += ["-t", str(offset), "-movflags", "+faststart", str(directory / "final.mp4")]
        checked_run(args, max(0.1, min(120, deadline - time.monotonic())))
        subtitle = directory / "final.srt"
        subtitle.write_text("\n".join(captions), encoding="utf-8")
        (directory / "final.mp4").replace(output)
        subtitle.replace(output.with_suffix(".srt"))
