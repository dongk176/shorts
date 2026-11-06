"""Initial-output silence cuts using the editor's retained source clock.

The input is a local, bounded clean clip, never a URL or a full retained upload.
Keep the public post-processing policy (30fps, -30dB, 300ms, 80ms handles).
"""

from __future__ import annotations

import copy
import math
import re
import subprocess
from pathlib import Path

from .schemas import EditorDocument


def kept_ranges(duration: float, silences: list[list[float]]) -> list[tuple[float, float]]:
    if not math.isfinite(duration) or not 1 <= duration <= 180:
        raise ValueError("Invalid silence analysis duration")
    cursor, last = 0, math.floor(duration * 30 + 1e-6)
    result = []
    for start, end in sorted(silences):
        if not all(map(math.isfinite, (start, end))):
            raise ValueError("Invalid silence boundary")
        left = max(cursor, math.ceil((start + 0.08) * 30))
        right = min(last, math.floor((end - 0.08) * 30))
        if end - start < 0.3 or right <= left or left - cursor < 5 or last - right < 5:
            continue
        result.append((cursor / 30, left / 30))
        cursor = right
        if len(result) >= 119:
            break
    result.append((cursor / 30, last / 30))
    return result if sum(b - a for a, b in result) >= 1 else [(0, duration)]


def analyze(path: Path, duration: float) -> list[list[float]]:
    if not path.is_file() or not math.isfinite(duration) or not 1 <= duration <= 180:
        raise ValueError("Invalid local silence source")
    run = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-nostats",
            "-i",
            str(path),
            "-t",
            str(duration),
            "-vn",
            "-af",
            "silencedetect=noise=-30dB:d=0.30",
            "-f",
            "null",
            "-",
        ],
        capture_output=True,
        text=True,
        timeout=90,
        check=True,
        shell=False,
    )
    ranges, left = [], None
    for kind, raw in re.findall(r"silence_(start|end):\s*([0-9.]+)", run.stderr):
        value = min(duration, max(0.0, float(raw)))
        if kind == "start":
            left = value
        elif left is not None:
            ranges.append([left, value])
            left = None
    if left is not None:
        ranges.append([left, duration])
    return ranges


def plan(item: dict, silences: list[list[float]]) -> EditorDocument | None:
    """Keep source subtitles untouched; comments live on the output clock."""
    if (item.get("template_snapshot") or {}).get("snsTemplateVersion") == 1:
        from .social_silence import social_initial_item

        item = social_initial_item(item)
    spec = copy.deepcopy(item.get("initial_render_spec"))
    snapshot = item.get("template_snapshot") or {}
    if (
        not isinstance(spec, dict)
        or spec.get("version") != 4
        or (snapshot.get("snsTemplateVersion") and snapshot.get("unifiedEditorVersion") != 1)
        or item.get("editor_document")
    ):
        raise ValueError("Inline silence requires an unedited standard v4 short")
    start, end = float(item["start_seconds"]), float(item["end_seconds"])
    ranges = kept_ranges(end - start, silences)
    if len(ranges) == 1:
        return None

    def output_at(t):
        return math.floor((sum(max(0, min(b, t) - a) for a, b in ranges) + 1e-9) * 1000) / 1000

    comments = []
    for original in item.get("comment_overlays") or []:
        c = copy.deepcopy(original)
        c["startSeconds"] = output_at(c["startSeconds"])
        c["endSeconds"] = output_at(c["endSeconds"])
        if c["endSeconds"] - c["startSeconds"] >= 1 / 30:
            comments.append(c)
    spec["comments"] = [
        dict(
            id=c["id"],
            offsetY=next((original.get("offsetY", 0) for original in
                          spec.get("comments", []) if original["id"] == c["id"]), 0),
            startFrame=math.floor(c["startSeconds"] * 30 + 0.5),
            endFrame=math.floor(c["endSeconds"] * 30 + 0.5),
        )
        for c in comments
    ]
    overlays = dict(
        offsets={k: dict(x=0, y=0) for k in ("video", "title", "comment", "channel")},
        commentOffsets={c["id"]: dict(x=0, y=c["offsetY"]) for c in spec["comments"]},
        scales=dict(video=spec["video"]["scale"], title=1, channel=spec["channel"]["scale"]),
        fonts={k: spec[k]["font"]["fontId"] for k in ("title", "channel")},
        visible=dict(
            video=True,
            title=spec["title"]["visible"],
            comment=bool(comments),
            channel=spec["channel"]["visible"],
        ),
        commentTheme=None,
        textOverlays=[],
        layerOrder=spec["layerOrder"],
        background=None,
    )
    text_layers = []
    authored = (snapshot.get("config") or {}).get("textOverlays") or []
    custom_id = item.get("custom_template_id")
    for original in spec.get("textOverlays", []):
        layer = copy.deepcopy(original)
        layer["startFrame"] = math.floor(output_at(layer["startFrame"] / 30) * 30 + 0.5)
        layer["endFrame"] = math.floor(output_at(layer["endFrame"] / 30) * 30 + 0.5)
        if layer["endFrame"] <= layer["startFrame"]:
            continue
        text_layers.append(layer)
        text = next((t["text"] for t in authored if t["id"] == layer["id"]
                     or f"tpl:{custom_id}:{t['id']}" == layer["id"]),
                    item.get("silence_text_content", {}).get(
                        layer["id"], "\n".join(layer["lines"])))
        overlays["textOverlays"].append(dict(
            id=layer["id"], text=text, fontId=layer["font"]["fontId"],
            color=layer["color"], effect=layer["effect"],
            offset=dict(x=layer["centerX"] - 540, y=layer["centerY"] - 960),
            width=layer["width"], scale=layer["scale"],
            startSeconds=layer["startFrame"] / 30, endSeconds=layer["endFrame"] / 30,
        ))
    spec["textOverlays"] = text_layers
    text_ids = {f"text:{layer['id']}" for layer in text_layers}
    spec["layerOrder"] = [key for key in spec["layerOrder"]
                          if not key.startswith("text:") or key in text_ids]
    overlays["layerOrder"] = spec["layerOrder"]
    for k in ("video", "channel"):
        overlays["offsets"][k] = dict(x=spec[k]["offsetX"], y=spec[k]["offsetY"])
    return EditorDocument.model_validate(
        dict(
            version=3,
            sourceShortId=str(item["id"]),
            baseRenderVersion=1,
            template=dict(
                id=item["template_id"],
                customTemplateId=str(custom_id) if custom_id is not None else None,
                presetVersion=snapshot.get("presetVersion", 3),
                snapshot=snapshot,
            ),
            title=dict(
                text=item["hook_title"], textStyles=item.get("title_text_styles") or [], fontScale=1
            ),
            channel=dict(
                displayName=item["channel_display_name"],
                thumbnailUrl=item.get("channel_thumbnail_url"),
            ),
            comments=comments,
            subtitles=dict(
                enabled=bool(item["subtitles_enabled"] and spec.get("subtitles")),
                segments=copy.deepcopy(item["subtitle_segments"]),
            ),
            overlays=overlays,
            renderSpec=spec,
            video=dict(
                clips=[
                    dict(id=f"silence-cut-{i}", sourceStartSeconds=a, sourceEndSeconds=b)
                    for i, (a, b) in enumerate(ranges)
                ],
                aspectRatio=item.get("video_aspect_ratio") or "1:1",
                timelineStartSeconds=start,
                timelineEndSeconds=end,
                selectionStartSeconds=start + ranges[0][0],
                selectionEndSeconds=start + ranges[-1][1],
            ),
        )
    )


def editor_snapshot(document: EditorDocument) -> dict:
    """Match the browser contract: an absent v4 caption spec is omitted."""
    value = document.model_dump(mode="json", by_alias=True)
    if value["renderSpec"].get("subtitles") is None:
        value["renderSpec"].pop("subtitles", None)
    return value
