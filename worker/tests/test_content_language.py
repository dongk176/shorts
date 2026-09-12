from dataclasses import replace
from unittest.mock import MagicMock

import pytest
from test_comment_generator import _clip

from shorts_worker.comment_generator import CommentGenerator
from shorts_worker.config import Settings
from shorts_worker.content_language import (
    CONTENT_LANGUAGES,
    comment_key,
    content_title_font,
    text_matches_language,
)
from shorts_worker.schemas import OutputLanguage, SubtitleSegment, fallback_comment_overlays
from shorts_worker.selector import FALLBACK_TITLE_LINES, _two_line_title, deterministic_fallback


@pytest.mark.parametrize("language", list(OutputLanguage))
def test_catalog_and_missing_ai_fallback_stay_in_project_language(language):
    assert set(CONTENT_LANGUAGES) == {value.value for value in OutputLanguage}
    clip = replace(_clip(duration=60), output_language=language)
    generator = CommentGenerator(Settings(gemini_api_key=None, openai_api_key=None))
    generator._generate_with_gemini = MagicMock()
    generator._generate_with_openai = MagicMock()
    result = generator.generate([clip])[1]
    assert len(result) == 15
    assert len({comment_key(item["text"]) for item in result}) == 15
    assert all(text_matches_language(item["text"], language) for item in result)
    assert result[-1]["endSeconds"] == 60
    if language != OutputLanguage.KO:
        assert all("개월" not in item["ageLabel"] for item in result)
        assert all(not any("가" <= c <= "힣" for c in item["nickname"]) for item in result)
    generator._generate_with_gemini.assert_not_called()
    generator._generate_with_openai.assert_not_called()


@pytest.mark.parametrize("language", [OutputLanguage.EN, OutputLanguage.JA])
def test_partial_ai_keeps_requested_language_and_fills_invalid_or_missing_comments(language):
    clip = replace(_clip(), output_language=language)
    texts = CONTENT_LANGUAGES[language]["comments"][:3]
    generator = CommentGenerator(Settings(openai_api_key="test-key", gemini_api_key=None))
    generator._generate_with_openai = MagicMock(return_value={"clips": [{
        "clipIndex": 1,
        "comments": [*texts, texts[0] + "!!", "이 한국어 댓글은 제외해야 해요"],
    }]})
    result = generator.generate([clip])[1]
    assert [item["text"] for item in result[:3]] == texts
    assert len(result) == clip.target_count
    assert len({comment_key(item["text"]) for item in result}) == clip.target_count
    assert all(text_matches_language(item["text"], language) for item in result)
    messages = generator._generate_with_openai.call_args.args[0]
    assert f"outputLanguage={language.value}" in messages[0]["content"]
    assert "이 방법이 맞습니다" in messages[1]["content"]
    assert "ㅋㅋ" not in messages[0]["content"]


def test_japanese_comments_are_preserved_and_unicode_equivalents_deduplicated():
    assert comment_key("ｶﾞｯﾂﾎﾟｰｽﾞ！！") == comment_key("ガッツポーズ")
    assert comment_key("ここが気になる") != comment_key("先が気になる")
    assert text_matches_language("ｺｺｶﾞｷﾆﾅﾙ", "ja")
    assert comment_key("CAFÉ!") == comment_key("cafe\u0301")


@pytest.mark.parametrize("hangul", ["가", "ㅋ", "\u1100", "\uffa1", "\ua960", "\ud7b0"])
def test_hangul_variants_cannot_hide_in_foreign_comments(hangul):
    assert not text_matches_language("この場面が気になる" + hangul, "ja")
    assert not text_matches_language("这个场景很有趣" + hangul, "zh-CN")
    assert not text_matches_language("This scene is interesting " + hangul, "en")
    assert text_matches_language("한국어 댓글 " + hangul, "ko")


@pytest.mark.parametrize("language", list(OutputLanguage))
def test_exception_fallback_overlays_use_the_requested_language(language):
    result = fallback_comment_overlays(45, count=10, clip_index=2, output_language=language)
    assert len(result) == 10
    assert all(text_matches_language(item["text"], language) for item in result)


@pytest.mark.parametrize("language", [OutputLanguage.EN, OutputLanguage.JA, OutputLanguage.ES])
def test_title_fallback_does_not_copy_korean_transcript_into_other_languages(language):
    clips = deterministic_fallback(
        "원본 제목도 한국어", 190, 3,
        [SubtitleSegment(start=0, end=190, text="이 문장은 한국어로 된 원본 자막입니다")],
        output_language=language,
    )
    assert all(text_matches_language(clip.hook_title, language) for clip in clips)
    assert all(text_matches_language(clip.reason, language) for clip in clips)
    assert all(len(clip.hook_title.splitlines()) == 2 for clip in clips)
    assert _two_line_title("한국어로 작성된\n잘못된 AI 제목", language) == "\n".join(
        FALLBACK_TITLE_LINES[language]
    )


@pytest.mark.parametrize("title", [
    "\n".join(CONTENT_LANGUAGES["ja"]["title"]),
    "紙飛行機が飛ばない理由\n左右の対称性が命です",
    "奥深い世界\n意外な発見 ｶﾞｯﾂﾎﾟｰｽﾞ",
])
def test_initial_japanese_title_uses_bundled_glyphs_and_keeps_editor_font_identity(title):
    from fontTools.ttLib import TTFont

    from shorts_worker.render_spec_v4 import (
        compile_initial_editor_render_spec_v4,
        editor_font_path_v4,
    )
    from shorts_worker.schemas import EditorFontId, EditorRenderSpec

    parsed = EditorRenderSpec.model_validate(compile_initial_editor_render_spec_v4(
        title=title, template_id="comment-capture", video_aspect_ratio="1:1", font_scale=1,
        output_language="ja",
    ))
    assert parsed.title.font.font_id == EditorFontId.NOTO_SANS_JP
    assert parsed.title.font.file_id == "NotoSansCJKjp-Variable.ttf"
    with TTFont(editor_font_path_v4(parsed.title.font.font_id)) as font:
        cmap = font.getBestCmap()
        assert all(ord(char) in cmap for char in title if not char.isspace())
    assert content_title_font(title, "noto-serif-kr") == "noto-serif-kr"
    assert content_title_font("The Moment You\nCannot Miss", "pretendard") == "pretendard"
    assert content_title_font("한국어 제목", "pretendard") == "pretendard"


def test_japanese_comment_font_is_bundled_and_old_comments_keep_their_font():
    from io import BytesIO

    from fontTools.ttLib import TTFont

    from shorts_worker.overlays import load_comment_font, load_font

    text = "これ、意外と奥が深いんだね！ 対称 한글"
    font = load_comment_font(text, 35, japanese_enabled=True)
    with TTFont(BytesIO(font.font_bytes)) as bundled:
        assert all(ord(c) in bundled.getBestCmap() for c in text if not c.isspace())
    assert load_comment_font(text, 35).path == load_font(35, "regular").path
    korean_font = load_comment_font("한국어 댓글", 35, japanese_enabled=True)
    assert korean_font.path == load_font(35, "regular").path


def test_japanese_font_capability_keeps_the_original_twenty_font_files_unchanged():
    import hashlib
    import json
    from pathlib import Path

    from shorts_worker.font_manifest import canonical_editor_font_manifest

    root = Path(__file__).resolve().parents[2]
    entries = [dict(entry) for entry in canonical_editor_font_manifest()["entries"]]
    for entry in entries:
        entry["resolvedPath"] = (
            "/app/worker/shorts_worker/assets/editor_fonts/" + Path(entry["resolvedPath"]).name
        )

    def digest(values):
        return hashlib.sha256(json.dumps(
            {"fallbackDetected": False, "entries": values},
            ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        ).encode()).hexdigest()

    capability = json.loads((root / "web/lib/editor-japanese-font.json").read_text())
    assert digest(entries) == capability["fontManifestSha256"]
    assert digest([entry for entry in entries if entry["fontId"] != "noto-sans-jp"]) == (
        "b9f530954066e89e95fcd2cfb77db558e68530329d3d1d9db17e4e73c859d486"
    )
