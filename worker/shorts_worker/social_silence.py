"""Seed the shared social editor before the initial silence render.

Geometry follows web/lib/unified-sns-editor.ts. This does not select a worker
release or change public admission; callers must retain those independent gates.
"""
from __future__ import annotations

import copy
import math
import re

from .community_copy import LEGACY_HEADING
from .community_template import FRAMES, community_heading_color
from .editor_text_layout import wrap_editor_render_text
from .render_spec_v4 import compile_initial_editor_render_spec_v4, editor_font_face_v4
from .schemas import CustomTemplateConfig, EditorFontId
from .sns_template import sns_layout


def social_initial_item(item: dict) -> dict:
    value = copy.deepcopy(item)
    snapshot = value["template_snapshot"]
    language = snapshot.get("snsLanguage", "ko")
    brand = snapshot.get("brandColor", "#000000")
    if (snapshot.get("snsTemplateVersion") != 1 or language not in {"ko", "en", "ja"}
            or not re.fullmatch(r"#[0-9a-fA-F]{6}", brand)
            or value.get("custom_template_id")):
        raise ValueError("Invalid initial social layout")
    community = snapshot.get("communityTemplateVersion") == 1
    ratio = value.get("video_aspect_ratio", "1:1")
    layout = sns_layout(ratio)
    x, y, width, height = FRAMES[ratio] if community else layout.video
    offset = layout.offset_y
    red, green, blue = bytes.fromhex(brand[1:])
    title_color = ("#111111" if community or 299 * red + 587 * green + 114 * blue >= 160000
                   else "#FFFFFF")
    font = "noto-sans-jp" if language == "ja" else "pretendard"
    config = dict(
        schemaVersion=5, background=dict(kind="color", color="#FFFFFF"),
        video=dict(aspectRatio=ratio, x=x, y=y, width=width, height=height, fit="cover"),
        title=dict(visible=True, x=540, y=450 if community else 216 + offset,
                   maxWidth=960, fontSize=58 if community else 80, fontId=font,
                   primaryColor=title_color, accentColor=title_color,
                   primaryBackgroundColor=None, accentBackgroundColor=None),
        subtitle=dict(visible=False, x=540, y=1410, maxWidth=900, fontSize=48,
                      color="#FFFFFF", variant="highlight", fontId="pretendard",
                      accentColor="#FFD84D"),
        channel=dict(visible=True, x=540, y=534 if community else 416 + offset,
                     maxWidth=960, fontSize=36 if community else 52,
                     color="#111111", backgroundColor=None),
        comment=dict(visible=True, theme="dark", size="medium", y=1392, dockedToVideo=True),
    )
    CustomTemplateConfig.model_validate(config)
    content = snapshot["snsContent"]
    rows = [(f"sns-body-{i}", text, 636 if community else 524 + offset + 90 * i,
             46 if community else 72, "#111111") for i, text in enumerate(content["body"])]
    if content["hashtags"]:
        rows.append(("sns-tags", "  ".join(content["hashtags"]), 718 + offset, 47, "#111111"))
    if community:
        rows.insert(0, ("sns-board", content.get("boardName") or LEGACY_HEADING[language],
                        210, 96, community_heading_color(brand)))
        heading = {"ko": "실시간 베스트", "en": "Trending now", "ja": "話題の投稿"}[language]
        rows.append(("sns-heading", heading, 332, 42, "#111111"))
    spec = compile_initial_editor_render_spec_v4(
        title=value["hook_title"], template_id="white-yellow", video_aspect_ratio=ratio,
        font_scale=1, custom_template_config=config,
        comments=value.get("comment_overlays") or [],
        caption_render_spec=value.get("caption_render_spec") if community else None,
        channel_visible=True, output_language=language,
    )
    spec["channel"]["font"] = editor_font_face_v4(EditorFontId(font), requested_weight=700)
    duration = float(value["end_seconds"]) - float(value["start_seconds"])
    layers = []
    for key, text, center_y, size, color in rows:
        lines = wrap_editor_render_text(text, 960)
        scale = size / 72
        if key.startswith("sns-body-") and len(lines) > 1:
            scale = min(scale, max(0.1, 82 / (86 * len(lines) + 22)))
        layers.append(dict(id=key, lines=lines, centerX=540, centerY=center_y,
                           width=960, fontSize=72, lineHeight=86, scale=scale,
                           color=color, effect="none", outlineWidth=0, shadowBlur=0,
                           startFrame=0, endFrame=math.floor(duration * 30 + 0.5),
                           font=editor_font_face_v4(EditorFontId(font), requested_weight=800)))
    spec["textOverlays"] = layers
    spec["layerOrder"] = ["video", "title", "comment", *[f"text:{r[0]}" for r in rows], "channel"]
    snapshot.update(unifiedEditorVersion=1, config=config)
    snapshot["snsContent"] = {**content, "title": value["hook_title"], "source": "edited"}
    value["initial_render_spec"] = spec
    value["subtitles_enabled"] = bool(community and value.get("subtitles_enabled"))
    # These are semantic strings, not wrapped lines: saving an unchanged editor
    # must preserve the author's original text exactly.
    value["silence_text_content"] = {r[0]: r[1] for r in rows}
    return value
