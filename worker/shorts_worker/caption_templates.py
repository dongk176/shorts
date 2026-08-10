from __future__ import annotations

import hashlib
import io
import re
import unicodedata
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from fontTools.ttLib import TTFont
from PIL import ImageFont

from .errors import CaptionCompileError, RenderError, TranscriptionError
from .schemas import VideoAspectRatio
from .subtitles import TranscriptWord

CAPTION_FPS = 30
CAPTION_TIMING_LEAD_FRAMES = 7
CAPTION_TEMPLATE_IDS = frozenset({"basic", "highlight", "pop"})
CAPTION_ACCENT = "#35E6E3"
CAPTION_TEXT = "#FFFFFF"
CAPTION_OUTLINE = "#080808"
CAPTION_FONT_PATH = Path(__file__).parent / "assets" / "editor_fonts" / "Pretendard-Bold.woff2"
CAPTION_FONT_FAMILY = "Pretendard"
CANVAS_WIDTH = 1080
CANVAS_HEIGHT = 1920
VIDEO_HEIGHTS = {
    VideoAspectRatio.LANDSCAPE: 608,
    VideoAspectRatio.LANDSCAPE_FIVE_FOUR: 864,
    VideoAspectRatio.SQUARE: 1080,
    VideoAspectRatio.PORTRAIT: 1350,
    VideoAspectRatio.FULL_VERTICAL: 1920,
}
VIDEO_Y = {
    VideoAspectRatio.LANDSCAPE: 432,
    VideoAspectRatio.LANDSCAPE_FIVE_FOUR: 528,
    VideoAspectRatio.SQUARE: 420,
    VideoAspectRatio.PORTRAIT: 420,
    VideoAspectRatio.FULL_VERTICAL: 0,
}
CAPTION_WORD_SEPARATOR = "\u2009"
CAPTION_HIGHLIGHT_WORD_SEPARATOR = " "
CAPTION_POP_SPACED_GAP_PX = 6
CAPTION_POP_UNSPACED_GAP_PX = 0
CAPTION_LANDSCAPE_GAP_PX = 48
CAPTION_PORTRAIT_CHANNEL_GAP_PX = 24
CAPTION_CHANNEL_HEIGHT_PX = 160
_NO_SPACE_BEFORE = frozenset(",.!?:;)]}%。！？、，．：；）」』】》〉…")
_NO_SPACE_AFTER = frozenset("([{（「『【《〈")
_SENTENCE_END_RE = re.compile(r"[.!?。！？]+[\"'”’」』】）)]*$")
_CJK_RE = re.compile(r"[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]")
_HANGUL_TOKEN_RE = re.compile(r"[\uac00-\ud7af]+")
_EXPRESSIVE_REPEAT_RE = re.compile(r"(.)\1{5,}")


@dataclass(frozen=True, slots=True)
class _CaptionWord:
    text: str
    start_frame: int
    end_frame: int
    space_before: bool
    source_indexes: tuple[int, ...]
    speech_start_frame: int | None = None
    speech_end_frame: int | None = None


@lru_cache(maxsize=1)
def _caption_ttf_bytes() -> bytes:
    if not CAPTION_FONT_PATH.is_file():
        raise RenderError("자막 폰트 파일을 찾지 못했습니다.")
    try:
        font = TTFont(str(CAPTION_FONT_PATH), recalcBBoxes=False, recalcTimestamp=False)
        font.flavor = None
        output = io.BytesIO()
        font.save(output, reorderTables=False)
        font.close()
        value = output.getvalue()
    except Exception as exc:
        raise RenderError("자막 폰트를 변환하지 못했습니다.") from exc
    if not value:
        raise RenderError("자막 폰트를 변환하지 못했습니다.")
    return value


@lru_cache(maxsize=32)
def _font(size: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(io.BytesIO(_caption_ttf_bytes()), size=size)
    except OSError as exc:
        raise RenderError("자막 폰트를 불러오지 못했습니다.") from exc


def _measure(text: str, size: int) -> float:
    return float(_font(size).getlength(text))


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for block in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def prepare_caption_fonts(directory: Path) -> Path:
    """Materialize the approved WOFF2 as a libass-compatible TTF.

    Pillow/Freetype can read the source WOFF2 directly, while fontconfig builds
    used by libass do not consistently discover WOFF2 files in ``fontsdir``.
    The conversion is deterministic and local to the render work directory;
    the immutable render spec still identifies and hashes the approved WOFF2.
    """
    if not CAPTION_FONT_PATH.is_file():
        raise RenderError("자막 폰트 파일을 찾지 못했습니다.")
    directory.mkdir(parents=True, exist_ok=True)
    output_path = directory / "Pretendard-Bold.ttf"
    try:
        output_path.write_bytes(_caption_ttf_bytes())
    except OSError as exc:
        output_path.unlink(missing_ok=True)
        raise RenderError("자막 렌더 폰트를 준비하지 못했습니다.") from exc
    if not output_path.is_file() or output_path.stat().st_size <= 0:
        raise RenderError("자막 렌더 폰트를 준비하지 못했습니다.")
    return directory


def caption_layout(
    video_aspect_ratio: VideoAspectRatio,
    *,
    caption_placement: str = "lower",
) -> dict[str, dict[str, int]]:
    video_height = VIDEO_HEIGHTS[video_aspect_ratio]
    video_y = VIDEO_Y[video_aspect_ratio]
    video_bottom = video_y + video_height
    channel = (
        {
            "x": 0,
            "y": video_bottom - CAPTION_CHANNEL_HEIGHT_PX,
            "width": CANVAS_WIDTH,
            "height": CAPTION_CHANNEL_HEIGHT_PX,
        }
        if video_aspect_ratio is VideoAspectRatio.PORTRAIT
        else {
            "x": 0,
            "y": 1710,
            "width": CANVAS_WIDTH,
            "height": CAPTION_CHANNEL_HEIGHT_PX,
        }
    )
    safe_area = (
        {
            "x": 120,
            "y": video_y + round((video_height - 140) / 2),
            "width": 840,
            "height": 140,
        }
        if caption_placement == "center"
        else {
            "x": 120,
            "y": video_bottom + CAPTION_LANDSCAPE_GAP_PX,
            "width": 840,
            "height": 140,
        }
        if video_aspect_ratio is VideoAspectRatio.LANDSCAPE
        else {"x": 120, "y": 1430, "width": 840, "height": 140}
        if video_aspect_ratio is VideoAspectRatio.FULL_VERTICAL
        else {
            "x": 120,
            "y": channel["y"] - CAPTION_PORTRAIT_CHANNEL_GAP_PX - 140,
            "width": 840,
            "height": 140,
        }
        if video_aspect_ratio is VideoAspectRatio.PORTRAIT
        else {
            "x": 120,
            "y": max(
                video_y,
                video_bottom - max(64, round(video_height * 0.08)) - 140,
            ),
            "width": 840,
            "height": 140,
        }
    )
    title = (
        {"x": 0, "y": 96, "width": CANVAS_WIDTH, "height": 300}
        if video_aspect_ratio
        in {VideoAspectRatio.PORTRAIT, VideoAspectRatio.FULL_VERTICAL}
        else {"x": 0, "y": 0, "width": CANVAS_WIDTH, "height": video_y}
    )
    return {
        "canvas": {"x": 0, "y": 0, "width": CANVAS_WIDTH, "height": CANVAS_HEIGHT},
        "video": {"x": 0, "y": video_y, "width": CANVAS_WIDTH, "height": video_height},
        "title": title,
        "channel": channel,
        "caption": safe_area,
    }


def caption_safe_area(
    video_aspect_ratio: VideoAspectRatio,
    *,
    caption_placement: str = "lower",
) -> dict[str, int]:
    return caption_layout(
        video_aspect_ratio,
        caption_placement=caption_placement,
    )["caption"]


def _has_cjk(text: str) -> bool:
    return bool(_CJK_RE.search(text))


def _is_hangul_token(text: str) -> bool:
    return bool(_HANGUL_TOKEN_RE.fullmatch(text))


def _is_punctuation(text: str) -> bool:
    return bool(text) and all(not char.isalnum() and not _has_cjk(char) for char in text)


def _join_text(
    left: str,
    right: str,
    *,
    space_before: bool,
    word_separator: str = CAPTION_WORD_SEPARATOR,
) -> str:
    if not left:
        return right
    if not right:
        return left
    if right[0] in _NO_SPACE_BEFORE or left[-1] in _NO_SPACE_AFTER:
        return left + right
    return left + (word_separator if space_before else "") + right


def _clip_words(
    words: Sequence[TranscriptWord],
    *,
    clip_start: float,
    clip_end: float,
    fps: int,
    timing_lead_frames: int = CAPTION_TIMING_LEAD_FRAMES,
) -> list[_CaptionWord]:
    if clip_end <= clip_start:
        raise ValueError("자막 구간 길이가 올바르지 않습니다.")
    clip_frames = max(1, round((clip_end - clip_start) * fps))
    selected: list[_CaptionWord] = []
    previous_start = -1
    for source_index, word in enumerate(words):
        if word.end <= clip_start or word.start >= clip_end:
            continue
        if not word.text.strip() or word.end <= word.start:
            raise TranscriptionError("자막 단어 타임스탬프가 올바르지 않습니다.")
        source_start_frame = min(
            clip_frames - 1,
            max(0, round((max(word.start, clip_start) - clip_start) * fps)),
        )
        source_end_frame = min(
            clip_frames,
            round((min(word.end, clip_end) - clip_start) * fps),
        )
        start_frame = max(0, source_start_frame - timing_lead_frames)
        # Advance when a word becomes visible, but keep the provider-derived
        # end boundary. Shifting both edges made the final caption disappear
        # before the spoken word had actually finished.
        end_frame = max(start_frame + 1, source_end_frame)
        if start_frame < previous_start or end_frame > clip_frames:
            raise TranscriptionError("자막 단어 순서가 올바르지 않습니다.")
        previous_start = start_frame
        selected.append(
            _CaptionWord(
                text=word.text.strip(),
                start_frame=start_frame,
                end_frame=end_frame,
                space_before=bool(selected) and word.space_before,
                source_indexes=(source_index,),
                speech_start_frame=source_start_frame,
                speech_end_frame=source_end_frame,
            )
        )
    if not selected:
        raise TranscriptionError("선택한 쇼츠 구간의 단어 타임스탬프가 비어 있습니다.")
    return _merge_unspaced_cjk_words(selected)


def _merge_unspaced_cjk_words(words: list[_CaptionWord]) -> list[_CaptionWord]:
    """Keep provider words intact while restoring CJK whitespace-delimited units."""
    merged: list[_CaptionWord] = []
    for word in words:
        if (
            merged
            and not word.space_before
            # Provider token fragments that form one Korean eojeol are
            # contiguous. Never stretch a merged word across a pause (or an
            # independently transcribed chunk boundary) just because both
            # tokens are Hangul.
            and word.start_frame - merged[-1].end_frame <= 1
            # Only recover a Korean eojeol from adjacent, pure Hangul
            # provider tokens. Japanese/Han, mixed tokens and punctuation
            # retain the provider's original word boundary.
            and _is_hangul_token(merged[-1].text)
            and _is_hangul_token(word.text)
            and not _is_punctuation(word.text)
            and len(merged[-1].text + word.text) <= 12
            and _measure(merged[-1].text + word.text, 92) <= 360
        ):
            previous = merged[-1]
            merged[-1] = _CaptionWord(
                text=previous.text + word.text,
                start_frame=previous.start_frame,
                end_frame=word.end_frame,
                space_before=previous.space_before,
                source_indexes=previous.source_indexes + word.source_indexes,
                speech_start_frame=(
                    previous.speech_start_frame
                    if previous.speech_start_frame is not None
                    else previous.start_frame
                ),
                speech_end_frame=(
                    word.speech_end_frame
                    if word.speech_end_frame is not None
                    else word.end_frame
                ),
            )
            continue
        merged.append(word)
    return merged


def _text_for_words(
    words: Sequence[_CaptionWord],
    *,
    word_separator: str = CAPTION_WORD_SEPARATOR,
) -> str:
    text = ""
    for word in words:
        text = _join_text(
            text,
            word.text,
            space_before=word.space_before,
            word_separator=word_separator,
        )
    return text


def _ellipsize_to_width(
    text: str,
    *,
    font_size: int,
    max_width: float,
    scale: float = 1.0,
) -> str:
    """Return the longest readable prefix that fits, preserving an ellipsis."""
    ellipsis = "…"
    if _measure(text, font_size) * scale <= max_width:
        return text
    if _measure(ellipsis, font_size) * scale > max_width:
        return ellipsis
    prefix = ""
    for unit in _display_units(text):
        candidate = f"{prefix}{unit}{ellipsis}"
        if _measure(candidate, font_size) * scale > max_width:
            break
        prefix += unit
    return f"{prefix}{ellipsis}" if prefix else ellipsis


def _compact_expressive_repeat(text: str) -> str:
    return _EXPRESSIVE_REPEAT_RE.sub(
        lambda match: f"{match.group(1) * 3}…",
        text,
    )


def _display_units(text: str) -> list[str]:
    """Keep combining marks and common emoji sequences intact when splitting."""
    units: list[str] = []
    for character in text:
        codepoint = ord(character)
        joins_previous = bool(units) and (
            unicodedata.combining(character) > 0
            or character == "\u200d"
            or units[-1].endswith("\u200d")
            or 0xFE00 <= codepoint <= 0xFE0F
            or 0x1F3FB <= codepoint <= 0x1F3FF
        )
        if joins_previous:
            units[-1] += character
        else:
            units.append(character)
    return units


def _split_caption_word(
    word: _CaptionWord,
    *,
    font_size: int,
    max_width: float,
    scale: float = 1.0,
) -> list[_CaptionWord]:
    """Split an unbreakable display token without changing its source timing."""
    if _measure(word.text, font_size) * scale <= max_width:
        return [word]
    if _EXPRESSIVE_REPEAT_RE.search(word.text):
        compacted = _compact_expressive_repeat(word.text)
        return [
            _CaptionWord(
                text=_ellipsize_to_width(
                    compacted,
                    font_size=font_size,
                    max_width=max_width,
                    scale=scale,
                ),
                start_frame=word.start_frame,
                end_frame=word.end_frame,
                space_before=word.space_before,
                source_indexes=word.source_indexes,
                speech_start_frame=word.speech_start_frame,
                speech_end_frame=word.speech_end_frame,
            )
        ]

    units = _display_units(word.text)
    pieces: list[list[str]] = []
    current: list[str] = []
    for unit in units:
        candidate = "".join([*current, unit])
        if current and _measure(candidate, font_size) * scale > max_width:
            pieces.append(current)
            current = [unit]
        else:
            current.append(unit)
    if current:
        pieces.append(current)

    frame_count = word.end_frame - word.start_frame
    if not pieces or len(pieces) > frame_count:
        return [
            _CaptionWord(
                text=_ellipsize_to_width(
                    word.text,
                    font_size=font_size,
                    max_width=max_width,
                    scale=scale,
                ),
                start_frame=word.start_frame,
                end_frame=word.end_frame,
                space_before=word.space_before,
                source_indexes=word.source_indexes,
                speech_start_frame=word.speech_start_frame,
                speech_end_frame=word.speech_end_frame,
            )
        ]

    starts = [word.start_frame]
    consumed_units = len(pieces[0])
    for index in range(1, len(pieces)):
        remaining = len(pieces) - index
        desired = word.start_frame + round(frame_count * consumed_units / len(units))
        starts.append(min(word.end_frame - remaining, max(starts[-1] + 1, desired)))
        consumed_units += len(pieces[index])
    return [
        _CaptionWord(
            text="".join(piece),
            start_frame=start,
            end_frame=(starts[index + 1] if index + 1 < len(starts) else word.end_frame),
            space_before=word.space_before if index == 0 else False,
            source_indexes=word.source_indexes,
            speech_start_frame=(
                word.speech_start_frame
                if word.speech_start_frame is not None
                else start
            ),
            speech_end_frame=(
                word.speech_end_frame
                if word.speech_end_frame is not None
                else (starts[index + 1] if index + 1 < len(starts) else word.end_frame)
            ),
        )
        for index, (piece, start) in enumerate(zip(pieces, starts, strict=True))
    ]


def _fit_display_words(
    words: Sequence[_CaptionWord],
    *,
    template_id: str,
    safe_area: dict[str, int],
) -> list[_CaptionWord]:
    outline = 8 if template_id == "pop" else 7
    max_width = safe_area["width"] - outline * 2
    font_size = 64 if template_id == "pop" else 72
    scale = 1.12 if template_id == "pop" else 1.0
    fitted: list[_CaptionWord] = []
    for word in words:
        fitted.extend(
            _split_caption_word(
                word,
                font_size=font_size,
                max_width=max_width,
                scale=scale,
            )
        )
    return fitted


def _without_display_periods(words: Sequence[_CaptionWord]) -> list[_CaptionWord]:
    """Remove ASCII full stops only from rendered caption text.

    This runs after sentence partitioning, so punctuation still controls cue
    boundaries. Period-only provider tokens are folded into an adjacent word
    to retain the original source indexes and spoken timing without reserving
    an invisible pop-caption slot.
    """
    cleaned: list[_CaptionWord] = []
    pending_start_frame: int | None = None
    pending_source_indexes: tuple[int, ...] = ()
    for word in words:
        text = word.text.replace(".", "")
        if text:
            cleaned.append(
                _CaptionWord(
                    text=text,
                    start_frame=(
                        min(pending_start_frame, word.start_frame)
                        if pending_start_frame is not None
                        else word.start_frame
                    ),
                    end_frame=word.end_frame,
                    space_before=bool(cleaned) and word.space_before,
                    source_indexes=pending_source_indexes + word.source_indexes,
                    speech_start_frame=word.speech_start_frame,
                    speech_end_frame=word.speech_end_frame,
                )
            )
            pending_start_frame = None
            pending_source_indexes = ()
            continue
        if cleaned:
            previous = cleaned[-1]
            cleaned[-1] = _CaptionWord(
                text=previous.text,
                start_frame=previous.start_frame,
                end_frame=max(previous.end_frame, word.end_frame),
                space_before=previous.space_before,
                source_indexes=previous.source_indexes + word.source_indexes,
                speech_start_frame=previous.speech_start_frame,
                speech_end_frame=word.speech_end_frame,
            )
        else:
            pending_start_frame = (
                min(pending_start_frame, word.start_frame)
                if pending_start_frame is not None
                else word.start_frame
            )
            pending_source_indexes += word.source_indexes
    return cleaned


def _wrap_word_indexes(
    words: Sequence[_CaptionWord],
    *,
    font_size: int,
    max_width: int,
    word_separator: str = CAPTION_WORD_SEPARATOR,
) -> list[list[int]]:
    lines: list[list[int]] = []
    current: list[int] = []
    for index, _word in enumerate(words):
        proposed = [*current, index]
        proposed_text = _text_for_words(
            [words[item] for item in proposed],
            word_separator=word_separator,
        )
        if current and _measure(proposed_text, font_size) > max_width:
            lines.append(current)
            current = [index]
        else:
            current = proposed
    if current:
        lines.append(current)
    return lines


def _would_fit_phrase(
    words: Sequence[_CaptionWord],
    *,
    font_size: int,
    max_width: int,
    max_lines: int,
    word_separator: str = CAPTION_WORD_SEPARATOR,
) -> bool:
    lines = _wrap_word_indexes(
        words,
        font_size=font_size,
        max_width=max_width,
        word_separator=word_separator,
    )
    return len(lines) <= max_lines and all(
        _measure(
            _text_for_words(
                [words[index] for index in line],
                word_separator=word_separator,
            ),
            font_size,
        )
        <= max_width
        for line in lines
    )


def _partition_words(
    words: list[_CaptionWord],
    *,
    gap_frames: int,
    max_words: int | None,
    font_size: int,
    max_width: int,
    max_duration_frames: int,
    max_lines: int = 2,
    require_word_frames: bool = False,
    word_separator: str = CAPTION_WORD_SEPARATOR,
) -> list[list[_CaptionWord]]:
    groups: list[list[_CaptionWord]] = []
    current: list[_CaptionWord] = []
    for word in words:
        should_break = bool(current) and (
            word.start_frame - current[-1].end_frame >= gap_frames
            or bool(_SENTENCE_END_RE.search(current[-1].text))
            or (max_words is not None and len(current) >= max_words)
            or word.end_frame - current[0].start_frame > max_duration_frames
            or (require_word_frames and word.end_frame - current[0].start_frame < len(current) + 1)
            or not _would_fit_phrase(
                [*current, word],
                font_size=font_size,
                max_width=max_width,
                max_lines=max_lines,
                word_separator=word_separator,
            )
        )
        if should_break:
            groups.append(current)
            current = []
        current.append(word)
        if _SENTENCE_END_RE.search(word.text):
            groups.append(current)
            current = []
    if current:
        groups.append(current)
    return groups


def _event_ranges(
    words: Sequence[_CaptionWord],
    *,
    cue_start: int,
    cue_end: int,
) -> list[dict[str, int]]:
    if not words or cue_end <= cue_start:
        return []
    frame_count = cue_end - cue_start
    if frame_count < len(words):
        raise CaptionCompileError("30fps에서 각 자막 어절의 표시 구간을 구분할 수 없습니다.")

    starts = [cue_start]
    for index, word in enumerate(words[1:], start=1):
        # Reserve at least one frame for this and every remaining word. This
        # turns provider words that round to the same frame into consecutive
        # one-frame events instead of overlapping them.
        earliest = starts[-1] + 1
        remaining = len(words) - index
        latest = cue_end - remaining
        desired = min(cue_end, max(cue_start, word.start_frame))
        starts.append(min(latest, max(earliest, desired)))

    return [
        {
            "startFrame": start,
            "endFrame": starts[index + 1] if index + 1 < len(starts) else cue_end,
            "activeWordIndex": index,
        }
        for index, start in enumerate(starts)
    ]


def _serialize_word(word: _CaptionWord) -> dict[str, object]:
    serialized: dict[str, object] = {
        "text": word.text,
        "startFrame": word.start_frame,
        "endFrame": word.end_frame,
        "spaceBefore": word.space_before,
        "sourceWordIndexes": list(word.source_indexes),
    }
    if word.speech_start_frame is not None:
        serialized["speechStartFrame"] = word.speech_start_frame
    if word.speech_end_frame is not None:
        serialized["speechEndFrame"] = word.speech_end_frame
    return serialized


def _basic_or_highlight_cues(
    words: list[_CaptionWord],
    *,
    highlighted: bool,
    safe_area: dict[str, int],
    fps: int,
) -> list[dict[str, object]]:
    outline = 7
    max_width = safe_area["width"] - outline * 2
    word_separator = (
        CAPTION_HIGHLIGHT_WORD_SEPARATOR if highlighted else CAPTION_WORD_SEPARATOR
    )
    groups = [
        cleaned
        for group in _partition_words(
            words,
            gap_frames=round(0.42 * fps),
            max_words=None,
            font_size=72,
            max_width=max_width,
            max_duration_frames=round(3.2 * fps),
            max_lines=1,
            require_word_frames=highlighted,
            word_separator=word_separator,
        )
        if (cleaned := _without_display_periods(group))
    ]
    cues: list[dict[str, object]] = []
    previous_end_frame = 0
    for index, group in enumerate(groups):
        start_frame = max(group[0].start_frame, previous_end_frame)
        minimum_frames = len(group) if highlighted else 1
        end_frame = max(group[-1].end_frame, start_frame + minimum_frames)
        if index + 1 < len(groups):
            next_start = groups[index + 1][0].start_frame
            if next_start >= start_frame + minimum_frames and next_start - group[
                -1
            ].end_frame < round(0.42 * fps):
                end_frame = next_start
        previous_end_frame = end_frame
        lines = _wrap_word_indexes(
            group,
            font_size=72,
            max_width=max_width,
            word_separator=word_separator,
        )
        scale_x = 100
        if any(
            _measure(
                _text_for_words(
                    [group[item] for item in line],
                    word_separator=word_separator,
                ),
                72,
            )
            > max_width
            for line in lines
        ):
            widest = max(
                _measure(
                    _text_for_words(
                        [group[item] for item in line],
                        word_separator=word_separator,
                    ),
                    72,
                )
                for line in lines
            )
            required_scale_x = min(100, max_width / widest * 100)
            if required_scale_x < 60:
                raise CaptionCompileError("자막 어절이 안전영역에 들어갈 수 없을 만큼 깁니다.")
            scale_x = round(required_scale_x)
        cue: dict[str, object] = {
            "startFrame": start_frame,
            "endFrame": end_frame,
            "fontSize": 72,
            "scaleX": scale_x,
            "centerX": safe_area["x"] + safe_area["width"] // 2,
            "centerY": safe_area["y"] + safe_area["height"] // 2,
            "words": [_serialize_word(word) for word in group],
            "lines": lines,
            "wordSeparator": word_separator,
        }
        cue["events"] = (
            _event_ranges(group, cue_start=start_frame, cue_end=end_frame)
            if highlighted
            else [{"startFrame": start_frame, "endFrame": end_frame}]
        )
        cues.append(cue)
    return cues


def _pop_font_size(word: _CaptionWord, max_width: int) -> int:
    size = 92
    while size > 64 and _measure(word.text, size) * 1.12 > max_width:
        size -= 2
    return size


def _pop_event_positions(
    words: Sequence[dict[str, object]],
    *,
    active_word_index: int,
    safe_area: dict[str, int],
) -> list[dict[str, float]]:
    """Center a pop cue using the scale visible in this exact event.

    CSS transforms and ASS scale tags do not participate in layout. Reserving
    112% for every word therefore made inactive 100% words look much farther
    apart than the configured six-pixel gap. Reflow each event around its one
    active word so the rendered glyph boxes retain the approved spacing.
    """
    widths = [
        _measure(str(word["text"]), int(word["fontSize"]))
        * (1.12 if word_index == active_word_index else 1.0)
        for word_index, word in enumerate(words)
    ]
    gaps = [
        CAPTION_POP_SPACED_GAP_PX
        if bool(words[word_index].get("spaceBefore"))
        else CAPTION_POP_UNSPACED_GAP_PX
        for word_index in range(1, len(words))
    ]
    center_x = safe_area["x"] + safe_area["width"] / 2
    center_y = safe_area["y"] + safe_area["height"] / 2
    cursor = center_x - (sum(widths) + sum(gaps)) / 2
    positions: list[dict[str, float]] = []
    for word_index, width in enumerate(widths):
        if word_index:
            cursor += gaps[word_index - 1]
        positions.append(
            {
                "centerX": round(cursor + width / 2, 3),
                "centerY": round(center_y, 3),
            }
        )
        cursor += width
    return positions


def _pop_cues(
    words: list[_CaptionWord],
    *,
    safe_area: dict[str, int],
    fps: int,
) -> list[dict[str, object]]:
    outline = 8
    max_width = safe_area["width"] - outline * 2
    groups = [
        cleaned
        for group in _partition_words(
            words,
            gap_frames=round(0.25 * fps),
            max_words=3,
            font_size=92,
            max_width=round(max_width / 1.12),
            max_duration_frames=round(2.0 * fps),
            max_lines=1,
            require_word_frames=True,
        )
        if (cleaned := _without_display_periods(group))
    ]
    center_x = safe_area["x"] + safe_area["width"] / 2
    center_y = safe_area["y"] + safe_area["height"] / 2
    cues: list[dict[str, object]] = []
    previous_end_frame = 0
    for index, group in enumerate(groups):
        sizes = [_pop_font_size(word, max_width) for word in group]
        widths = [_measure(word.text, size) * 1.12 for word, size in zip(group, sizes, strict=True)]
        gaps = [
            CAPTION_POP_SPACED_GAP_PX if group[item].space_before else CAPTION_POP_UNSPACED_GAP_PX
            for item in range(1, len(group))
        ]
        total_width = sum(widths) + sum(gaps)
        if total_width > max_width:
            ratio = max_width / total_width
            sizes = [max(64, round(size * ratio)) for size in sizes]
            widths = [
                _measure(word.text, size) * 1.12 for word, size in zip(group, sizes, strict=True)
            ]
            total_width = sum(widths) + sum(gaps)
        if total_width > max_width + 0.5:
            raise CaptionCompileError("팝 자막 어절이 안전영역에 들어갈 수 없을 만큼 깁니다.")
        cursor = center_x - total_width / 2
        serialized: list[dict[str, object]] = []
        for word_index, (word, size, width) in enumerate(zip(group, sizes, widths, strict=True)):
            if word_index:
                cursor += gaps[word_index - 1]
            serialized_word = _serialize_word(word)
            serialized_word.update(
                {
                    "fontSize": size,
                    "centerX": round(cursor + width / 2, 3),
                    "centerY": round(center_y, 3),
                    "maxScale": 112,
                }
            )
            serialized.append(serialized_word)
            cursor += width
        start_frame = max(group[0].start_frame, previous_end_frame)
        end_frame = max(group[-1].end_frame, start_frame + len(group))
        if index + 1 < len(groups):
            next_start = groups[index + 1][0].start_frame
            if next_start >= start_frame + len(group) and next_start - group[-1].end_frame < round(
                0.25 * fps
            ):
                end_frame = next_start
        previous_end_frame = end_frame
        events: list[dict[str, object]] = [
            {
                **event,
                "positions": _pop_event_positions(
                    serialized,
                    active_word_index=event["activeWordIndex"],
                    safe_area=safe_area,
                ),
            }
            for event in _event_ranges(
                group,
                cue_start=start_frame,
                cue_end=end_frame,
            )
        ]
        cues.append(
            {
                "startFrame": start_frame,
                "endFrame": end_frame,
                "words": serialized,
                "easeFrames": 2,
                "events": events,
            }
        )
    return cues


def rebuild_caption_cue_text(
    cue: dict[str, object],
    *,
    text: str,
    template_id: str,
    safe_area: dict[str, int],
    fps: int = CAPTION_FPS,
) -> list[dict[str, object]]:
    """Reflow one trusted cue while preserving its compiled frame window."""
    if template_id not in {"highlight", "pop"}:
        raise CaptionCompileError("편집할 수 없는 자막 템플릿입니다.")
    if fps != CAPTION_FPS:
        raise CaptionCompileError("편집 자막 프레임레이트가 올바르지 않습니다.")
    start_frame = int(cue.get("startFrame") or 0)
    end_frame = int(cue.get("endFrame") or 0)
    frame_count = end_frame - start_frame
    if frame_count < 1:
        raise CaptionCompileError("편집 자막 표시 구간이 올바르지 않습니다.")
    tokens = text.strip().split()
    if not tokens:
        raise CaptionCompileError("편집 자막 내용이 비어 있습니다.")

    # Caption specs cap a cue at twenty words and animated templates require at
    # least one output frame per word. Keep arbitrary user copy renderable by
    # folding any overflow into the final timed word.
    maximum_words = min(20, frame_count)
    if len(tokens) > maximum_words:
        tokens = [
            *tokens[:maximum_words - 1],
            " ".join(tokens[maximum_words - 1:]),
        ] if maximum_words > 1 else [" ".join(tokens)]

    weights = [max(1, len(token)) for token in tokens]
    total_weight = sum(weights)
    starts = [start_frame]
    consumed_weight = weights[0]
    for index in range(1, len(tokens)):
        remaining = len(tokens) - index
        desired = start_frame + round(frame_count * consumed_weight / total_weight)
        starts.append(min(
            end_frame - remaining,
            max(starts[-1] + 1, desired),
        ))
        consumed_weight += weights[index]

    words = [
        _CaptionWord(
            text=token,
            start_frame=word_start,
            end_frame=(starts[index + 1] if index + 1 < len(starts) else end_frame),
            space_before=index > 0,
            source_indexes=(),
            speech_start_frame=word_start,
            speech_end_frame=(
                starts[index + 1] if index + 1 < len(starts) else end_frame
            ),
        )
        for index, (token, word_start) in enumerate(zip(tokens, starts, strict=True))
    ]
    words = _fit_display_words(
        words,
        template_id=template_id,
        safe_area=safe_area,
    )
    rebuilt = (
        _pop_cues(words, safe_area=safe_area, fps=fps)
        if template_id == "pop"
        else _basic_or_highlight_cues(
            words,
            highlighted=True,
            safe_area=safe_area,
            fps=fps,
        )
    )
    if not rebuilt:
        raise CaptionCompileError("편집 자막을 다시 배치하지 못했습니다.")
    return rebuilt


def reflow_caption_cues_for_clips(
    cues: Sequence[dict[str, object]],
    *,
    template_id: str,
    safe_area: dict[str, int],
    clip_windows: Sequence[tuple[int, int, int]],
    cue_edits: dict[int, str] | None = None,
    fps: int = CAPTION_FPS,
) -> list[dict[str, object]]:
    """Recompile caption layout from the words retained by editor cuts.

    Caption cues contain provider-derived word windows. Those words, rather
    than the already-laid-out cue events, are the source of truth when a user
    trims or removes video. Recompiling here prevents deleted words from
    remaining visible and recalculates every gap and position after text edits.
    """
    if template_id not in CAPTION_TEMPLATE_IDS:
        raise CaptionCompileError("편집할 수 없는 자막 템플릿입니다.")
    if fps != CAPTION_FPS:
        raise CaptionCompileError("편집 자막 프레임레이트가 올바르지 않습니다.")

    # A plain split creates adjacent source clips. Treat them as one window so
    # a word crossing the split point is not duplicated on both sides.
    merged_windows: list[tuple[int, int, int]] = []
    for clip_start, clip_end, output_start in clip_windows:
        if clip_end <= clip_start:
            continue
        if (
            merged_windows
            and merged_windows[-1][1] == clip_start
            and merged_windows[-1][2]
            + merged_windows[-1][1]
            - merged_windows[-1][0]
            == output_start
        ):
            previous_start, _previous_end, previous_output = merged_windows[-1]
            merged_windows[-1] = (previous_start, clip_end, previous_output)
        else:
            merged_windows.append((clip_start, clip_end, output_start))

    edits = cue_edits or {}
    rebuilt: list[dict[str, object]] = []
    for cue_index, cue_value in enumerate(cues):
        if not isinstance(cue_value, dict):
            raise CaptionCompileError("원본 자막 큐가 올바르지 않습니다.")
        source_cue_index = int(cue_value.get("sourceCueIndex", cue_index))
        edited_text = edits.get(source_cue_index)
        source_cues = (
            rebuild_caption_cue_text(
                cue_value,
                text=edited_text,
                template_id=template_id,
                safe_area=safe_area,
                fps=fps,
            )
            if edited_text is not None
            else [cue_value]
        )

        for source_cue in source_cues:
            words_value = source_cue.get("words")
            if not isinstance(words_value, list):
                raise CaptionCompileError("원본 자막 어절이 올바르지 않습니다.")
            for clip_start, clip_end, output_start in merged_windows:
                retained: list[_CaptionWord] = []
                for word_value in words_value:
                    if not isinstance(word_value, dict):
                        raise CaptionCompileError("원본 자막 어절이 올바르지 않습니다.")
                    if "startFrame" not in word_value or "endFrame" not in word_value:
                        raise CaptionCompileError("원본 자막 어절 시간이 올바르지 않습니다.")
                    word_start = int(word_value["startFrame"])
                    word_end = int(word_value["endFrame"])
                    speech_start = int(
                        word_value.get("speechStartFrame", word_start)
                    )
                    speech_end = int(word_value.get("speechEndFrame", word_end))
                    spoken_visible_start = max(speech_start, clip_start)
                    spoken_visible_end = min(speech_end, clip_end)
                    if spoken_visible_end <= spoken_visible_start:
                        continue
                    visible_start = max(word_start, clip_start)
                    visible_end = min(word_end, clip_end)
                    if visible_end <= visible_start:
                        continue
                    source_indexes_value = word_value.get("sourceWordIndexes")
                    source_indexes = (
                        tuple(int(value) for value in source_indexes_value)
                        if isinstance(source_indexes_value, list)
                        else ()
                    )
                    retained.append(_CaptionWord(
                        text=str(word_value.get("text") or ""),
                        start_frame=output_start + visible_start - clip_start,
                        end_frame=output_start + visible_end - clip_start,
                        space_before=bool(retained) and bool(
                            word_value.get("spaceBefore")
                        ),
                        source_indexes=source_indexes,
                        speech_start_frame=(
                            output_start + spoken_visible_start - clip_start
                        ),
                        speech_end_frame=(
                            output_start + spoken_visible_end - clip_start
                        ),
                    ))
                if not retained:
                    continue
                retained = _fit_display_words(
                    retained,
                    template_id=template_id,
                    safe_area=safe_area,
                )
                compiled = (
                    _pop_cues(retained, safe_area=safe_area, fps=fps)
                    if template_id == "pop"
                    else _basic_or_highlight_cues(
                        retained,
                        highlighted=template_id == "highlight",
                        safe_area=safe_area,
                        fps=fps,
                    )
                )
                for cue in compiled:
                    cue["sourceCueIndex"] = source_cue_index
                rebuilt.extend(compiled)

    rebuilt.sort(key=lambda cue: (
        int(cue.get("startFrame") or 0),
        int(cue.get("endFrame") or 0),
    ))
    return rebuilt


def compile_caption_render_spec(
    words: Sequence[TranscriptWord],
    *,
    template_id: str,
    clip_start: float,
    clip_end: float,
    video_aspect_ratio: VideoAspectRatio,
    caption_placement: str = "lower",
    fps: int = CAPTION_FPS,
    accent_color: str = CAPTION_ACCENT,
) -> dict[str, object]:
    if template_id not in CAPTION_TEMPLATE_IDS:
        raise ValueError("지원하지 않는 자막 템플릿입니다.")
    if fps != CAPTION_FPS:
        raise ValueError("자막 렌더 프레임레이트는 30fps여야 합니다.")
    if caption_placement not in {"lower", "center"}:
        raise ValueError("지원하지 않는 자막 위치입니다.")
    layout = caption_layout(
        video_aspect_ratio,
        caption_placement=caption_placement,
    )
    safe_area = layout["caption"]
    clipped_words = _clip_words(
        words,
        clip_start=clip_start,
        clip_end=clip_end,
        fps=fps,
    )
    clipped_words = _fit_display_words(
        clipped_words,
        template_id=template_id,
        safe_area=safe_area,
    )
    if template_id == "pop":
        cues = _pop_cues(clipped_words, safe_area=safe_area, fps=fps)
        font_size = 92
        outline = 8
    else:
        cues = _basic_or_highlight_cues(
            clipped_words,
            highlighted=template_id == "highlight",
            safe_area=safe_area,
            fps=fps,
        )
        font_size = 72
        outline = 7
    if not cues:
        raise TranscriptionError("선택한 쇼츠 구간에 표시할 자막이 없습니다.")
    return {
        "schemaVersion": 3,
        "templateId": template_id,
        "captionPlacement": caption_placement,
        "fps": fps,
        "clipStartSeconds": round(clip_start, 3),
        "clipEndSeconds": round(clip_end, 3),
        "timingLeadFrames": CAPTION_TIMING_LEAD_FRAMES,
        "layout": layout,
        "safeArea": safe_area,
        "font": {
            "fileId": CAPTION_FONT_PATH.name,
            "sha256": _sha256(CAPTION_FONT_PATH),
            "family": CAPTION_FONT_FAMILY,
            "weight": 700,
        },
        "style": {
            "fontSize": font_size,
            "textColor": CAPTION_TEXT,
            "accentColor": accent_color,
            "outlineColor": CAPTION_OUTLINE,
            "outlineWidth": outline,
            "shadow": 0,
            "background": None,
            "maxLines": 1,
        },
        "cues": cues,
    }


def _ass_timestamp(frame: int, fps: int) -> str:
    # ASS only stores centiseconds. Floor a frame boundary so the event is
    # already active when libass samples that exact output frame. Rounding
    # frame 2 at 30fps to 0.07, for example, keeps the previous event active at
    # the frame-2 timestamp (0.066...), making every 2/5/8... transition one
    # frame late. Integer arithmetic also avoids float boundary drift.
    centiseconds = max(0, frame * 100 // fps)
    hours, remainder = divmod(centiseconds, 360_000)
    minutes, remainder = divmod(remainder, 6_000)
    seconds, centiseconds = divmod(remainder, 100)
    return f"{hours}:{minutes:02d}:{seconds:02d}.{centiseconds:02d}"


def _ass_color(color: str) -> str:
    value = color.lstrip("#")
    return f"&H00{value[4:6]}{value[2:4]}{value[0:2]}&"


def _ass_escape(text: str) -> str:
    return text.replace("\\", r"\\").replace("{", r"\{").replace("}", r"\}")


def _line_text(
    words: list[dict[str, Any]],
    indexes: Iterable[int],
    *,
    active_index: int | None,
    text_color: str,
    accent_color: str,
    word_separator: str,
) -> str:
    result = ""
    for line_position, word_index in enumerate(indexes):
        word = words[word_index]
        prefix = word_separator if line_position and word.get("spaceBefore") else ""
        color = accent_color if word_index == active_index else text_color
        result += f"{{\\1c{_ass_color(color)}}}{prefix}{_ass_escape(str(word['text']))}"
    return result


def create_caption_ass(spec: dict[str, Any], output_path: Path) -> Path:
    if int(spec.get("schemaVersion") or 0) not in {1, 2, 3}:
        raise RenderError("자막 렌더 사양 버전이 올바르지 않습니다.")
    template_id = str(spec.get("templateId") or "")
    if template_id not in CAPTION_TEMPLATE_IDS:
        raise RenderError("자막 렌더 템플릿이 올바르지 않습니다.")
    fps = int(spec.get("fps") or 0)
    if fps != CAPTION_FPS:
        raise RenderError("자막 렌더 프레임레이트가 올바르지 않습니다.")
    font = spec.get("font") or {}
    if font.get("sha256") != _sha256(CAPTION_FONT_PATH):
        raise RenderError("자막 렌더 폰트가 승인된 파일과 다릅니다.")
    style = spec.get("style") or {}
    text_color = str(style.get("textColor") or CAPTION_TEXT)
    accent_color = str(style.get("accentColor") or CAPTION_ACCENT)
    outline_color = str(style.get("outlineColor") or CAPTION_OUTLINE)
    dialogues: list[str] = []
    for cue in spec.get("cues") or []:
        words = list(cue.get("words") or [])
        events = list(cue.get("events") or [])
        if not words or not events:
            continue
        if template_id == "pop":
            for event in events:
                active_index = int(event["activeWordIndex"])
                positions = event.get("positions")
                if not isinstance(positions, list) or len(positions) != len(words):
                    safe_area = spec.get("safeArea")
                    if not isinstance(safe_area, dict):
                        raise RenderError("팝 자막 안전영역이 올바르지 않습니다.")
                    try:
                        positions = _pop_event_positions(
                            words,
                            active_word_index=active_index,
                            safe_area={
                                key: int(safe_area[key]) for key in ("x", "y", "width", "height")
                            },
                        )
                    except (KeyError, TypeError, ValueError) as exc:
                        raise RenderError("팝 자막 안전영역이 올바르지 않습니다.") from exc
                ease_frames = max(0, int(cue.get("easeFrames") or 0))
                ease_milliseconds = round(ease_frames / fps * 1000)
                event_frames = max(
                    1,
                    int(event["endFrame"]) - int(event["startFrame"]),
                )
                for word_index, word in enumerate(words):
                    position = positions[word_index]
                    if not isinstance(position, dict):
                        raise RenderError("팝 자막 위치가 올바르지 않습니다.")
                    scale = 100
                    color = accent_color if word_index == active_index else text_color
                    ease = ""
                    if word_index == active_index:
                        # A one-frame active event has no later output sample on
                        # which an interpolation can finish. Render it at the
                        # approved 112% scale immediately instead of producing
                        # a barely enlarged word. Longer events retain the
                        # two-frame ease requested by the template.
                        if event_frames == 1:
                            scale = 112
                        else:
                            ease = f"\\t(0,{ease_milliseconds},\\fscx112\\fscy112)"
                    tags = (
                        f"\\an5\\pos({position['centerX']},{position['centerY']})"
                        f"\\fn{font['family']}\\fs{word['fontSize']}"
                        f"\\fscx{scale}\\fscy{scale}"
                        f"\\bord{style['outlineWidth']}\\shad0"
                        f"\\1c{_ass_color(color)}\\3c{_ass_color(outline_color)}"
                        f"{ease}"
                    )
                    dialogues.append(
                        "Dialogue: 0,"
                        f"{_ass_timestamp(int(event['startFrame']), fps)},"
                        f"{_ass_timestamp(int(event['endFrame']), fps)},"
                        f"Default,,0,0,0,,{{{tags}}}{_ass_escape(str(word['text']))}"
                    )
            continue
        for event in events:
            active_index = (
                int(event["activeWordIndex"])
                if template_id == "highlight" and "activeWordIndex" in event
                else None
            )
            lines = [
                _line_text(
                    words,
                    line,
                    active_index=active_index,
                    text_color=text_color,
                    accent_color=accent_color,
                    word_separator=str(
                        cue.get("wordSeparator") or CAPTION_WORD_SEPARATOR
                    ),
                )
                for line in cue.get("lines") or []
            ]
            tags = (
                f"\\an5\\pos({cue['centerX']},{cue['centerY']})"
                f"\\fn{font['family']}\\fs{cue['fontSize']}"
                f"\\fscx{cue.get('scaleX', 100)}\\fscy100"
                f"\\bord{style['outlineWidth']}\\shad0"
                f"\\1c{_ass_color(text_color)}\\3c{_ass_color(outline_color)}"
            )
            joined_lines = r"\N".join(lines)
            dialogues.append(
                "Dialogue: 0,"
                f"{_ass_timestamp(int(event['startFrame']), fps)},"
                f"{_ass_timestamp(int(event['endFrame']), fps)},"
                f"Default,,0,0,0,,{{{tags}}}{joined_lines}"
            )
    if not dialogues:
        raise RenderError("렌더링할 자막 이벤트가 없습니다.")
    content = "\n".join(
        [
            "[Script Info]",
            "ScriptType: v4.00+",
            "PlayResX: 1080",
            "PlayResY: 1920",
            "WrapStyle: 2",
            "ScaledBorderAndShadow: yes",
            "",
            "[V4+ Styles]",
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
            "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, "
            "ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
            "Alignment, MarginL, MarginR, MarginV, Encoding",
            (
                f"Style: Default,{font['family']},72,{_ass_color(text_color)},"
                f"{_ass_color(text_color)},{_ass_color(outline_color)},&HFF000000,"
                "-1,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1"
            ),
            "",
            "[Events]",
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
            *dialogues,
            "",
        ]
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(content, encoding="utf-8")
    return output_path
