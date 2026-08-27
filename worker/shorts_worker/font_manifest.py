from __future__ import annotations

import hashlib
import io
import json
from functools import lru_cache
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont

from .errors import RenderError
from .schemas import EDITOR_FONT_FILE_IDS, EditorFontId

EDITOR_FONT_DIRECTORY = Path(__file__).parent / "assets" / "editor_fonts"

# Chromium and libass center a few faces on slightly different raster
# baselines even when they load the same immutable font bytes. Keep the
# measured correction next to the font-derived metrics so every browser
# preview uses the same value as the Linux renderer. Values are expressed in
# the original CSS font-size unit, before cssToAssScale is applied.
_CSS_TO_ASS_BASELINE_CALIBRATION_EM = {
    EditorFontId.NOTO_SANS_KR: round(2 / 92, 6),
}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for block in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _postscript_name(font: TTFont) -> str:
    name_table = font["name"]
    preferred = name_table.getName(6, 3, 1)
    if preferred is None:
        preferred = next(
            (record for record in name_table.names if record.nameID == 6),
            None,
        )
    if preferred is None:
        raise RenderError("편집기 폰트 PostScript 이름을 찾지 못했습니다.")
    value = preferred.toUnicode().strip()
    if not value:
        raise RenderError("편집기 폰트 PostScript 이름이 비어 있습니다.")
    return value


def _word_space_glyph(font: TTFont) -> tuple[str, int]:
    cmap = font.getBestCmap() or {}
    glyph_name = cmap.get(0x20)
    metrics = font["hmtx"].metrics
    if glyph_name is not None:
        advance = int(metrics[glyph_name][0])
        if advance > 0:
            return glyph_name, advance
    glyph_set = font.getGlyphSet()
    empty_glyphs: list[tuple[int, str]] = []
    for candidate in font.getGlyphOrder():
        advance = int(metrics.get(candidate, (0, 0))[0])
        if advance <= 0:
            continue
        pen = BoundsPen(glyph_set)
        glyph_set[candidate].draw(pen)
        if pen.bounds is None:
            empty_glyphs.append((advance, candidate))
    if not empty_glyphs:
        raise RenderError("편집기 폰트에 공백 글리프가 없습니다.")
    advance, glyph_name = min(empty_glyphs)
    return glyph_name, advance


@lru_cache(maxsize=32)
def normalized_editor_font_bytes(font_id: EditorFontId) -> bytes:
    """Return the bundled face with an explicit deterministic U+0020 mapping."""
    path = (EDITOR_FONT_DIRECTORY / EDITOR_FONT_FILE_IDS[font_id]).resolve()
    try:
        font = TTFont(str(path), recalcBBoxes=False, recalcTimestamp=False)
        glyph_name, _advance = _word_space_glyph(font)
        for table in font["cmap"].tables:
            if table.isUnicode():
                table.cmap.setdefault(0x20, glyph_name)
        font.flavor = None
        output = io.BytesIO()
        font.save(output, reorderTables=False)
        font.close()
        value = output.getvalue()
    except RenderError:
        raise
    except Exception as exc:
        raise RenderError("편집기 폰트 공백 매핑을 정규화하지 못했습니다.") from exc
    if not value:
        raise RenderError("편집기 폰트 공백 매핑을 정규화하지 못했습니다.")
    return value


@lru_cache(maxsize=32)
def editor_font_manifest_entry(font_id: EditorFontId) -> dict[str, object]:
    path = (EDITOR_FONT_DIRECTORY / EDITOR_FONT_FILE_IDS[font_id]).resolve()
    if not path.is_file():
        raise RenderError(f"편집기 폰트 파일을 찾지 못했습니다: {font_id.value}")
    try:
        font = TTFont(
            str(path),
            recalcBBoxes=False,
            recalcTimestamp=False,
            lazy=True,
        )
        postscript_name = _postscript_name(font)
        units_per_em = int(font["head"].unitsPerEm)
        hhea = font["hhea"]
        os2 = font["OS/2"]
        vertical_extent = int(os2.usWinAscent) + int(os2.usWinDescent)
        hhea_center = int(hhea.ascent) + int(hhea.descent)
        win_center = int(os2.usWinAscent) - int(os2.usWinDescent)
        _space_glyph, word_space_advance = _word_space_glyph(font)
        font.close()
    except RenderError:
        raise
    except Exception as exc:
        raise RenderError(
            f"편집기 폰트 메타데이터를 읽지 못했습니다: {font_id.value}"
        ) from exc
    if units_per_em <= 0 or vertical_extent <= 0:
        raise RenderError(f"편집기 폰트 메트릭이 올바르지 않습니다: {font_id.value}")
    css_to_ass_scale = round(units_per_em / vertical_extent, 6)
    # CSS centers its line box with the hhea baseline while libass anchors
    # \an5 text with the Windows ascent/descent box. Persist the reproducible
    # delta from the bundled face, plus a single cross-runtime raster
    # calibration measured by the isolated Linux release matrix.
    css_to_ass_baseline_offset_em = round(
        (win_center - hhea_center) / (2 * vertical_extent)
        + _CSS_TO_ASS_BASELINE_CALIBRATION_EM.get(font_id, 0.0),
        6,
    )
    # Title baselines must not depend on Canvas/Pillow glyph-box rounding,
    # which differs by operating system. The hhea center is immutable font
    # data and is shared by the browser compiler and the worker compiler.
    title_baseline_offset_em = round(
        hhea_center / (2 * units_per_em),
        6,
    )
    word_space_advance_em = round(word_space_advance / units_per_em, 6)
    if not 0 < css_to_ass_scale <= 1.2:
        raise RenderError(
            f"편집기 폰트 CSS/ASS 보정값이 올바르지 않습니다: {font_id.value}"
        )
    if not 0 < word_space_advance_em <= 1:
        raise RenderError(
            f"편집기 폰트 공백 폭이 올바르지 않습니다: {font_id.value}"
        )
    return {
        "fontId": font_id.value,
        "sha256": _sha256(path),
        "postscriptName": postscript_name,
        "resolvedPath": str(path),
        "cssToAssScale": css_to_ass_scale,
        "cssToAssBaselineOffsetEm": css_to_ass_baseline_offset_em,
        "titleBaselineOffsetEm": title_baseline_offset_em,
        "wordSpaceAdvanceEm": word_space_advance_em,
    }


@lru_cache(maxsize=1)
def canonical_editor_font_manifest() -> dict[str, object]:
    entries = [
        editor_font_manifest_entry(font_id)
        for font_id in sorted(EditorFontId, key=lambda item: item.value)
    ]
    unsigned = {
        "fallbackDetected": False,
        "entries": entries,
    }
    canonical = json.dumps(
        unsigned,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return {
        "sha256": hashlib.sha256(canonical).hexdigest(),
        **unsigned,
    }


def canonical_editor_font_manifest_json() -> str:
    return json.dumps(
        canonical_editor_font_manifest(),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
