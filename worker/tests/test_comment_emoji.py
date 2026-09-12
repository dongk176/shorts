import json
from pathlib import Path

import pytest
from PIL import Image, ImageDraw

from shorts_worker.comment_emoji import comment_text_width, display_units, draw_comment_text
from shorts_worker.editor_renderer import create_editor_comment_layers
from shorts_worker.overlays import _wrap_comment_text, create_comment_panel, load_comment_font
from shorts_worker.schemas import (
    CommentOverlay,
    EditorDocument,
    OutputLanguage,
    build_comment_overlay,
)


@pytest.mark.parametrize("emoji", ["😂", "👍🏽", "👨‍👩‍👧", "🇯🇵", "❤️", "1️⃣"])
def test_emoji_sequences_are_not_split_and_have_actual_color_pixels(emoji):
    assert display_units(emoji) == [emoji]
    font = load_comment_font("English", 40)
    canvas = Image.new("RGBA", (160, 100))
    draw_comment_text(canvas, (0, 0), emoji, font=font, fill="#FFFFFF")
    assert sum(1 for *_, a in canvas.getdata() if a > 100) > 50
    # Noto's current family pictogram is intentionally monochrome.
    if "\u200d" not in emoji:
        assert sum(1 for r, g, b, a in canvas.getdata()
                   if a > 100 and max(r, g, b) - min(r, g, b) > 40) > 50
    assert comment_text_width(emoji, font) == pytest.approx(46)


def test_wrap_uses_emoji_width_and_keeps_sequences_intact():
    font = load_comment_font("English", 40)
    draw = ImageDraw.Draw(Image.new("RGBA", (300, 100)))
    lines = _wrap_comment_text(draw, "One 👍🏽 Two 😂", font, 160)
    assert len(lines) == 2
    assert "👍🏽" in " ".join(lines) and all(not line.startswith("🏽") for line in lines)
    assert all(comment_text_width(line, font) <= 160 for line in lines)


def test_narrow_wrap_does_not_split_an_oversized_emoji_sequence():
    font = load_comment_font("English", 40)
    draw = ImageDraw.Draw(Image.new("RGBA", (100, 100)))
    assert _wrap_comment_text(draw, "👍🏽👍🏽", font, 20) == ["👍🏽", "👍🏽"]


@pytest.mark.parametrize("mode", ["plain", "custom", "editor"])
@pytest.mark.parametrize("language", ["en", "ja"])
def test_real_comment_render_paths_paint_emoji(tmp_path, mode, language):
    comment = CommentOverlay.model_validate(build_comment_overlay(
        start_seconds=0, end_seconds=3,
        text="I need this job rn 😂" if language == "en" else "これはすごい 😂",
        output_language=OutputLanguage(language),
    ))
    if mode == "editor":
        fixture = Path(__file__).resolve().parents[2] / "test-fixtures/editor-document-v2.json"
        data = json.loads(fixture.read_text())
        document = EditorDocument.model_validate(data)
        document.comments = [comment]
        document.overlays.visible["comment"] = True
        path = create_editor_comment_layers(document, tmp_path, output_language=language)[0].path
    else:
        path = create_comment_panel(
            comment, tmp_path / "comment.png", output_language=language,
            japanese_font_enabled=language == "ja",
            **({"theme": "dark", "size": "medium"} if mode == "custom" else {}),
        )
    pixels = Image.open(path).convert("RGBA")
    # The original missing-glyph box was grey; a real face has opaque yellow pixels.
    assert sum(1 for r, g, b, a in pixels.getdata()
               if a > 150 and r > 180 and g > 120 and b < 90) > 30
