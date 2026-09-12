from __future__ import annotations

from types import SimpleNamespace

import pytest
from PIL import ImageFont

from shorts_worker.editor_renderer import load_editor_font, verify_editor_fonts
from shorts_worker.errors import RenderError
from shorts_worker.font_manifest import editor_font_manifest_entry
from shorts_worker.overlays import load_custom_template_font
from shorts_worker.schemas import EDITOR_FONT_VARIABLE_IDS, EditorFontId

pytestmark = pytest.mark.render


@pytest.mark.parametrize("font_id", list(EditorFontId))
@pytest.mark.parametrize("loader", [load_editor_font, load_custom_template_font])
def test_space_is_blank_and_has_the_bundled_word_advance(font_id, loader) -> None:
    # RIDIBatang's original WOFF has an incomplete cmap on Linux. A text bbox
    # alone accepts its .notdef boxes; verify the pixels and spacing instead.
    font = loader(font_id, 72)
    entry = editor_font_manifest_entry(font_id)
    expected = entry["wordSpaceAdvanceEm"] * 72
    if font_id in EDITOR_FONT_VARIABLE_IDS:
        # The manifest records the default axis. The rendered 700 face can
        # legitimately have a different advance, which normalization preserves.
        original = ImageFont.truetype(entry["resolvedPath"], 72)
        original.set_variation_by_axes([700])
        expected = original.getlength(" ")

    assert font.getmask(" ").getbbox() is None
    assert font.getlength(" ") == pytest.approx(expected, abs=1 / 64)
    assert font.getmask("한글 Aa 123").getbbox() is not None


@pytest.mark.parametrize("space_ink,advance", [((7, 0, 62, 73), 67.6875), (None, 0)])
def test_font_startup_check_rejects_invalid_spaces(monkeypatch, space_ink, advance) -> None:
    font = SimpleNamespace(
        getbbox=lambda _: (0, 0, 200, 72),
        getmask=lambda _: SimpleNamespace(getbbox=lambda: space_ink),
        getlength=lambda _: advance,
    )
    monkeypatch.setattr("shorts_worker.editor_renderer.load_editor_font", lambda *a: font)

    with pytest.raises(RenderError, match="공백"):
        verify_editor_fonts()
