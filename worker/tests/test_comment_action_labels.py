import json
from pathlib import Path

import pytest
from PIL import ImageDraw

from shorts_worker.content_language import comment_action_labels
from shorts_worker.editor_renderer import create_editor_comment_layers
from shorts_worker.overlays import create_comment_panel
from shorts_worker.schemas import (
    CommentOverlay,
    EditorDocument,
    OutputLanguage,
    build_comment_overlay,
)

CASES = json.loads((Path(__file__).parent / "fixtures/comment-action-labels.json").read_text())


@pytest.mark.parametrize("case", CASES)
def test_saved_language_action_labels_match_shared_boundary_cases(case):
    assert comment_action_labels(case["count"], case["language"]) == (
        case["likes"], case["reply"],
    )


@pytest.mark.parametrize("language,reply,likes", [("en", "Reply", "2.6K"), ("ja", "返信", "2,654")])
@pytest.mark.parametrize("mode", ["plain", "custom", "editor"])
def test_real_comment_panels_draw_localized_actions_without_hangul(
    tmp_path, monkeypatch, language, reply, likes, mode,
):
    text = "That is quite a number." if language == "en" else "すごい数字ですね。"
    comment = CommentOverlay.model_validate({
        **build_comment_overlay(start_seconds=0, end_seconds=2, text=text,
                                output_language=OutputLanguage(language)),
        "likeCount": 2654,
    })
    drawn = []
    original = ImageDraw.ImageDraw.text

    def capture(self, xy, text, *args, **kwargs):
        drawn.append(text)
        return original(self, xy, text, *args, **kwargs)

    monkeypatch.setattr(ImageDraw.ImageDraw, "text", capture)
    if mode == "editor":
        fixture = Path(__file__).resolve().parents[2] / "test-fixtures/editor-document-v2.json"
        document = EditorDocument.model_validate_json(fixture.read_text())
        document.comments = [comment]
        document.overlays.visible["comment"] = True
        assets = create_editor_comment_layers(document, tmp_path, output_language=language)
        assert len(assets) == 1
        output = assets[0].path
    else:
        output = create_comment_panel(
            comment, tmp_path / "comment.png", output_language=language,
            japanese_font_enabled=language == "ja",
            **({"theme": "dark", "size": "medium"} if mode == "custom" else {}),
        )
    assert output.is_file()
    assert reply in drawn and likes in drawn
    assert all(not any("가" <= char <= "힣" for char in part) for part in drawn)


def test_old_projects_keep_korean_action_default():
    assert comment_action_labels(2654) == ("2.6천", "답글")
