"""Compare an actual Chromium preview capture with a worker render frame."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any

from PIL import Image

MAXIMUM_ERROR_PIXELS = 2.0
_GIT_SHA = re.compile(r"^[0-9a-f]{40}$")
_IMAGE_DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
_HEX_SHA256 = re.compile(r"^[0-9a-f]{64}$")


def _sha256(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def _number(value: object, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise TypeError(f"Browser metric is not numeric: {label}")
    return float(value)


def _assert_close(actual: object, expected: object, label: str) -> float:
    difference = abs(_number(actual, label) - _number(expected, label))
    if difference > MAXIMUM_ERROR_PIXELS:
        raise RuntimeError(
            f"{label} differs by {difference:.3f}px "
            f"(allowed: {MAXIMUM_ERROR_PIXELS:.0f}px)"
        )
    return difference


def _rgb(value: str) -> tuple[int, int, int]:
    normalized = value.removeprefix("#")
    if len(normalized) != 6:
        raise RuntimeError(f"Unsupported parity color: {value}")
    return tuple(int(normalized[index : index + 2], 16) for index in (0, 2, 4))


def _region_box(region: dict[str, Any], padding: int = 28) -> tuple[int, int, int, int]:
    left = max(0, round(float(region["x"]) - padding))
    top = max(0, round(float(region["y"]) - padding))
    right = min(1080, round(float(region["x"]) + float(region["width"]) + padding))
    bottom = min(1920, round(float(region["y"]) + float(region["height"]) + padding))
    return left, top, right, bottom


def _ink_bounds(
    image: Image.Image,
    *,
    region: tuple[int, int, int, int],
    colors: list[tuple[int, int, int]],
    tolerance: int,
) -> tuple[int, int, int, int]:
    pixels = image.load()
    left, top, right, bottom = region[2], region[3], -1, -1
    matches = 0
    for y in range(region[1], region[3]):
        for x in range(region[0], region[2]):
            pixel = pixels[x, y]
            if any(
                sum((int(pixel[channel]) - color[channel]) ** 2 for channel in range(3))
                <= tolerance**2
                for color in colors
            ):
                matches += 1
                left = min(left, x)
                top = min(top, y)
                right = max(right, x)
                bottom = max(bottom, y)
    if matches < 25 or right < left or bottom < top:
        raise RuntimeError(
            f"Parity region has too little matching text ink ({matches} pixels)"
        )
    return left, top, right + 1, bottom + 1


def _title_region(fixture: dict[str, Any]) -> dict[str, float]:
    boxes = fixture["title"]["spec"]["lineBoxes"]
    left = min(float(box["centerX"]) - float(box["width"]) / 2 for box in boxes)
    top = min(float(box["centerY"]) - float(box["height"]) / 2 for box in boxes)
    right = max(float(box["centerX"]) + float(box["width"]) / 2 for box in boxes)
    bottom = max(float(box["centerY"]) + float(box["height"]) / 2 for box in boxes)
    return {"x": left, "y": top, "width": right - left, "height": bottom - top}


def _verify_dom_geometry(
    fixture: dict[str, Any],
    metrics: dict[str, Any],
) -> tuple[float, list[dict[str, float]], dict[str, object]]:
    viewport = metrics.get("viewport") or {}
    if viewport != fixture["canvas"] or metrics.get("devicePixelRatio") != 1:
        raise RuntimeError("Chromium parity capture is not an exact 1080x1920 DPR=1 canvas")
    if metrics.get("fontStatus") != "loaded":
        raise RuntimeError("Chromium font set was not fully loaded")
    if "Chrome/" not in str(metrics.get("browser") or ""):
        raise RuntimeError("Browser parity evidence was not produced by Chromium")

    maximum = 0.0
    compiler_evidence = metrics.get("compilerEvidence")
    if not isinstance(compiler_evidence, dict):
        raise TypeError("Chromium did not expose its independent compiler result")
    title_metrics = metrics.get("title") or []
    stored_title_metrics = metrics.get("storedTitle") or []
    title_fixture = fixture.get("title")
    title_boxes = title_fixture["spec"]["lineBoxes"] if title_fixture else []
    if len(title_metrics) != len(title_boxes) or len(stored_title_metrics) != len(
        title_boxes
    ):
        raise RuntimeError(
            "Chromium did not render both compiled and stored title consumers"
        )
    padding_x = float(title_fixture["spec"]["linePaddingX"]) if title_fixture else 0
    for surface, observed in (
        ("compiler", title_metrics),
        ("stored", stored_title_metrics),
    ):
        for index, (actual, expected) in enumerate(
            zip(observed, title_boxes, strict=True)
        ):
            advance = float(expected["width"]) - padding_x * 2
            maximum = max(
                maximum,
                _assert_close(
                    actual["x"],
                    float(expected["centerX"]) - advance / 2,
                    f"{surface}.title[{index}].x",
                ),
                _assert_close(
                    actual["y"],
                    expected["baselineY"],
                    f"{surface}.title[{index}].baselineY",
                ),
                _assert_close(
                    actual["textLength"],
                    advance,
                    f"{surface}.title[{index}].textLength",
                ),
            )
            if (
                actual.get("text") != expected["text"]
                or actual.get("fontLoaded") is not True
            ):
                raise RuntimeError(
                    f"Chromium {surface} title line {index} used fallback text/font"
                )
    compiled_title = compiler_evidence.get("titleSpec")
    if title_fixture:
        if not isinstance(compiled_title, dict):
            raise RuntimeError("Chromium title compiler did not produce a v4 spec")
        compiled_boxes = compiled_title.get("lineBoxes")
        if not isinstance(compiled_boxes, list) or len(compiled_boxes) != len(
            title_boxes
        ):
            raise RuntimeError("Chromium and worker title compilers disagree on lines")
        for name in (
            "centerX",
            "centerY",
            "fontSize",
            "lineGap",
            "linePaddingX",
            "linePaddingY",
        ):
            maximum = max(
                maximum,
                _assert_close(
                    compiled_title.get(name),
                    title_fixture["spec"].get(name),
                    f"compiler.title.{name}",
                ),
            )
        for index, (browser_box, worker_box) in enumerate(
            zip(compiled_boxes, title_boxes, strict=True)
        ):
            if browser_box.get("text") != worker_box.get("text"):
                raise RuntimeError(
                    f"Chromium/worker title compiler line {index} content differs"
                )
            browser_backgrounds = browser_box.get("backgroundRuns") or []
            worker_backgrounds = worker_box.get("backgroundRuns") or []
            if (
                not isinstance(browser_backgrounds, list)
                or not isinstance(worker_backgrounds, list)
                or len(browser_backgrounds) != len(worker_backgrounds)
            ):
                raise RuntimeError(
                    f"Chromium/worker title compiler line {index} backgrounds differ"
                )
            for run_index, (browser_run, worker_run) in enumerate(
                zip(browser_backgrounds, worker_backgrounds, strict=True)
            ):
                if any(
                    browser_run.get(name) != worker_run.get(name)
                    for name in ("start", "end", "color")
                ):
                    raise RuntimeError(
                        "Chromium/worker title background semantics differ: "
                        f"line {index}, run {run_index}"
                    )
                for name in ("x", "y", "width", "height", "radius"):
                    maximum = max(
                        maximum,
                        _assert_close(
                            browser_run.get(name),
                            worker_run.get(name),
                            f"compiler.title[{index}].background[{run_index}].{name}",
                        ),
                    )
            for name in ("centerX", "centerY", "width", "height", "baselineY"):
                maximum = max(
                    maximum,
                    _assert_close(
                        browser_box.get(name),
                        worker_box.get(name),
                        f"compiler.title[{index}].{name}",
                    ),
                )
    elif compiled_title is not None:
        raise RuntimeError("Caption-only case unexpectedly compiled a title")

    caption_fixture = fixture.get("caption")
    caption_metrics = metrics.get("captions") or []
    stored_caption_metrics = metrics.get("storedCaptions") or []
    words = caption_fixture["words"] if caption_fixture else []
    if len(caption_metrics) != len(words) or len(stored_caption_metrics) != len(words):
        raise RuntimeError(
            "Chromium did not render both compiled and stored caption consumers"
        )
    gap_evidence: list[dict[str, float]] = []
    dom_evidence: dict[str, object] = {
        "browserTemplateCompiler": True,
        "storedSpecConsumer": True,
    }
    if not caption_fixture:
        return maximum, gap_evidence, dom_evidence
    mode = caption_fixture.get("mode") or "positioned-pop"
    if mode == "flow-highlight":
        flow_box = metrics.get("flowCaptionBox")
        stored_flow_box = metrics.get("storedFlowCaptionBox")
        if not isinstance(flow_box, dict) or not isinstance(stored_flow_box, dict):
            raise RuntimeError(
                "Chromium did not render compiled/stored highlight containers"
            )
        for surface, observed_box in (
            ("compiler", flow_box),
            ("stored", stored_flow_box),
        ):
            maximum = max(
                maximum,
                _assert_close(
                    (float(observed_box["left"]) + float(observed_box["right"])) / 2,
                    caption_fixture["centerX"],
                    f"{surface}.highlight.centerX",
                ),
                _assert_close(
                    (float(observed_box["top"]) + float(observed_box["bottom"])) / 2,
                    float(caption_fixture["centerY"])
                    + float(caption_fixture["fontSize"])
                    * float(caption_fixture["cssToAssBaselineOffsetEm"]),
                    f"{surface}.highlight.centerY",
                ),
            )
        maximum = max(
            maximum,
            _assert_close(
                flow_box["width"],
                stored_flow_box["width"],
                "compiler.highlight.width",
            ),
            _assert_close(
                flow_box["height"],
                stored_flow_box["height"],
                "compiler.highlight.height",
            ),
        )
        for surface, observed in (
            ("compiler", caption_metrics),
            ("stored", stored_caption_metrics),
        ):
            for index, (actual, word) in enumerate(
                zip(observed, words, strict=True)
            ):
                if (
                    actual.get("mode") != "flow-highlight"
                    or actual.get("text") != word["text"]
                    or actual.get("fontLoaded") is not True
                ):
                    raise RuntimeError(
                        f"Chromium {surface} highlight word {index} used fallback"
                    )
        dom_evidence["highlightCompilerVsStoredBounds"] = {
            "compiler": flow_box,
            "stored": stored_flow_box,
        }
        compiled_caption = compiler_evidence.get("captionGeometry")
        if not isinstance(compiled_caption, dict):
            raise TypeError("Chromium highlight compiler did not produce geometry")
        maximum = max(
            maximum,
            _assert_close(
                compiled_caption.get("cssToAssBaselineOffsetEm"),
                caption_fixture["cssToAssBaselineOffsetEm"],
                "compiler.highlight.cssToAssBaselineOffsetEm",
            ),
            _assert_close(
                compiled_caption.get("separatorAdvanceWidth"),
                caption_fixture["separatorAdvanceWidth"],
                "compiler.highlight.separatorAdvanceWidth",
            ),
            _assert_close(
                compiled_caption.get("scaleX"),
                caption_fixture.get("scaleX") or 1,
                "compiler.highlight.scaleX",
            ),
        )
        dom_evidence["highlightCompilerGeometry"] = compiled_caption
        return maximum, gap_evidence, dom_evidence
    if mode != "positioned-pop":
        raise RuntimeError(f"Unsupported browser parity caption mode: {mode}")
    positions = caption_fixture.get("positions") or []
    if len(positions) != len(words):
        raise RuntimeError("Positioned caption fixture is incomplete")
    for surface, observed in (
        ("compiler", caption_metrics),
        ("stored", stored_caption_metrics),
    ):
        for index, (actual, position, word) in enumerate(
            zip(observed, positions, words, strict=True)
        ):
            box = actual["box"]
            expected_center_x = float(position["centerX"])
            expected_center_y = float(position["centerY"]) + float(
                caption_fixture["offsetY"]
            ) + float(word["fontSize"]) * float(
                caption_fixture["cssToAssBaselineOffsetEm"]
            ) * (
                float(caption_fixture["activeWordScale"])
                if index == int(caption_fixture["activeWordIndex"])
                else 1
            )
            expected_width = float(position["advanceWidth"]) * float(
                caption_fixture["layoutScale"]
            )
            maximum = max(
                maximum,
                _assert_close(
                    (float(box["left"]) + float(box["right"])) / 2,
                    expected_center_x,
                    f"{surface}.caption[{index}].centerX",
                ),
                _assert_close(
                    (float(box["top"]) + float(box["bottom"])) / 2,
                    expected_center_y,
                    f"{surface}.caption[{index}].centerY",
                ),
                _assert_close(
                    box["width"],
                    expected_width,
                    f"{surface}.caption[{index}].advanceWidth",
                ),
                _assert_close(
                    actual["gapBefore"],
                    position["gapBefore"],
                    f"{surface}.caption[{index}].gapBefore",
                ),
            )
            if (
                actual.get("text") != word["text"]
                or actual.get("fontLoaded") is not True
            ):
                raise RuntimeError(
                    f"Chromium {surface} caption word {index} used fallback"
                )
            if index and surface == "compiler":
                previous = observed[index - 1]["box"]
                observed_gap = float(box["left"]) - float(previous["right"])
                expected_gap = float(position["gapBefore"])
                gap_error = _assert_close(
                    observed_gap,
                    expected_gap,
                    f"{surface}.caption[{index}].outerGap",
                )
                maximum = max(maximum, gap_error)
                gap_evidence.append({
                    "wordIndex": index,
                    "configuredGapPixels": expected_gap,
                    "chromiumOuterGapPixels": observed_gap,
                    "maximumErrorPixels": gap_error,
                })
    compiled_caption = compiler_evidence.get("captionGeometry")
    if not isinstance(compiled_caption, dict):
        raise TypeError("Chromium caption compiler did not produce geometry")
    compiled_positions = compiled_caption.get("positions")
    if not isinstance(compiled_positions, list) or len(compiled_positions) != len(
        positions
    ):
        raise RuntimeError("Chromium/worker caption compilers disagree on words")
    for index, (browser_position, worker_position) in enumerate(
        zip(compiled_positions, positions, strict=True)
    ):
        for name in ("centerX", "centerY", "advanceWidth", "gapBefore"):
            maximum = max(
                maximum,
                _assert_close(
                    browser_position.get(name),
                    worker_position.get(name),
                    f"compiler.caption[{index}].{name}",
                ),
            )
    maximum = max(
        maximum,
        _assert_close(
            compiled_caption.get("cssToAssBaselineOffsetEm"),
            caption_fixture["cssToAssBaselineOffsetEm"],
            "compiler.caption.cssToAssBaselineOffsetEm",
        ),
    )
    configured_gaps = {
        float(position["gapBefore"])
        for position in positions[1:]
    }
    if (
        "font-template-mode-matrix" in (fixture.get("coverage") or [])
        and configured_gaps != {0.0, 6.0}
    ):
        raise RuntimeError(
            "Caption parity fixture must prove both joined 0px and spaced 6px gaps"
        )
    dom_evidence["captionCompilerPositions"] = compiled_positions
    return maximum, gap_evidence, dom_evidence


def _caption_word_region(
    fixture: dict[str, Any],
    position: dict[str, Any],
) -> tuple[int, int, int, int]:
    safe_area = fixture["caption"]["safeArea"]
    left = max(0, int(float(position["centerX"]) - float(position["advanceWidth"]) / 2))
    right = min(
        int(fixture["canvas"]["width"]),
        int(float(position["centerX"]) + float(position["advanceWidth"]) / 2 + 0.999),
    )
    top = max(0, int(float(safe_area["y"])))
    bottom = min(
        int(fixture["canvas"]["height"]),
        int(float(safe_area["y"]) + float(safe_area["height"]) + 0.999),
    )
    if right <= left or bottom <= top:
        raise RuntimeError("Caption parity word has an invalid authoritative region")
    return left, top, right, bottom


def _verify_pixel_geometry(
    fixture: dict[str, Any],
    browser_image: Image.Image,
    worker_image: Image.Image,
) -> tuple[float, dict[str, object]]:
    comparisons: dict[
        str,
        tuple[tuple[int, int, int, int], tuple[int, int, int, int]],
    ] = {}
    title_fixture = fixture.get("title")
    if title_fixture:
        title_colors = {
            str(title_fixture["primaryColor"]),
            str(title_fixture["accentColor"]),
            *(
                str(style["color"])
                for style in title_fixture["textStyles"]
                if style.get("color")
            ),
        }
        title_region = _region_box(_title_region(fixture))
        comparisons["title"] = (
            _ink_bounds(
                browser_image,
                region=title_region,
                colors=[_rgb(color) for color in title_colors],
                tolerance=45,
            ),
            _ink_bounds(
                worker_image,
                region=title_region,
                colors=[_rgb(color) for color in title_colors],
                tolerance=90,
            ),
        )
        background_colors = {
            str(run["color"])
            for box in title_fixture["spec"]["lineBoxes"]
            for run in box.get("backgroundRuns") or []
        }
        if background_colors:
            comparisons["titleBackground"] = (
                _ink_bounds(
                    browser_image,
                    region=title_region,
                    colors=[_rgb(color) for color in background_colors],
                    tolerance=20,
                ),
                _ink_bounds(
                    worker_image,
                    region=title_region,
                    colors=[_rgb(color) for color in background_colors],
                    tolerance=20,
                ),
            )
    maximum = 0.0
    evidence: dict[str, object] = {}
    for label, (browser_box, worker_box) in comparisons.items():
        errors = [abs(float(actual) - float(expected)) for actual, expected in zip(
            browser_box,
            worker_box,
            strict=True,
        )]
        maximum = max(maximum, *errors)
        evidence[label] = {
            "browserInkBounds": browser_box,
            "workerInkBounds": worker_box,
            "maximumErrorPixels": max(errors),
        }
        if max(errors) > MAXIMUM_ERROR_PIXELS:
            raise RuntimeError(
                f"{label} browser/worker ink bounds differ by {max(errors):.3f}px "
                f"(allowed: {MAXIMUM_ERROR_PIXELS:.0f}px)"
            )

    caption_fixture = fixture.get("caption")
    if not caption_fixture:
        return maximum, evidence
    mode = caption_fixture.get("mode") or "positioned-pop"
    if mode == "flow-highlight":
        caption_region = _region_box(caption_fixture["safeArea"], padding=20)
        colors = [
            _rgb(str(caption_fixture["textColor"])),
            _rgb(str(caption_fixture["accentColor"])),
        ]
        browser_box = _ink_bounds(
            browser_image,
            region=caption_region,
            colors=colors,
            tolerance=45,
        )
        worker_box = _ink_bounds(
            worker_image,
            region=caption_region,
            colors=colors,
            tolerance=90,
        )
        errors = [
            abs(float(actual) - float(expected))
            for actual, expected in zip(browser_box, worker_box, strict=True)
        ]
        highlight_error = max(errors)
        if highlight_error > MAXIMUM_ERROR_PIXELS:
            raise RuntimeError(
                "highlight caption browser/worker ink bounds differ by "
                f"{highlight_error:.3f}px (allowed: {MAXIMUM_ERROR_PIXELS:.0f}px)"
            )
        evidence["highlightCaption"] = {
            "browserInkBounds": browser_box,
            "workerInkBounds": worker_box,
            "maximumErrorPixels": highlight_error,
        }
        return max(maximum, highlight_error), evidence
    if mode != "positioned-pop":
        raise RuntimeError(f"Unsupported browser parity caption mode: {mode}")
    positions = caption_fixture.get("positions") or []
    active_index = int(caption_fixture["activeWordIndex"])
    word_matrix: list[dict[str, object]] = []
    browser_word_boxes: list[tuple[int, int, int, int]] = []
    worker_word_boxes: list[tuple[int, int, int, int]] = []
    for index, position in enumerate(positions):
        region = _caption_word_region(fixture, position)
        color = _rgb(str(
            caption_fixture["accentColor"]
            if index == active_index
            else caption_fixture["textColor"]
        ))
        browser_box = _ink_bounds(
            browser_image,
            region=region,
            colors=[color],
            tolerance=45,
        )
        worker_box = _ink_bounds(
            worker_image,
            region=region,
            colors=[color],
            tolerance=90,
        )
        browser_word_boxes.append(browser_box)
        worker_word_boxes.append(worker_box)
        edge_errors = [
            abs(float(actual) - float(expected))
            for actual, expected in zip(browser_box, worker_box, strict=True)
        ]
        word_error = max(edge_errors)
        if word_error > MAXIMUM_ERROR_PIXELS:
            raise RuntimeError(
                f"caption word {index} browser/worker ink bounds differ by "
                f"{word_error:.3f}px (allowed: {MAXIMUM_ERROR_PIXELS:.0f}px)"
            )
        maximum = max(maximum, word_error)
        item: dict[str, object] = {
            "wordIndex": index,
            "text": caption_fixture["words"][index]["text"],
            "configuredGapPixels": float(position["gapBefore"]),
            "browserInkBounds": browser_box,
            "workerInkBounds": worker_box,
            "maximumInkBoundsErrorPixels": word_error,
        }
        if index:
            browser_gap = browser_box[0] - browser_word_boxes[index - 1][2]
            worker_gap = worker_box[0] - worker_word_boxes[index - 1][2]
            gap_error = abs(float(browser_gap) - float(worker_gap))
            if gap_error > MAXIMUM_ERROR_PIXELS:
                raise RuntimeError(
                    f"caption word {index} browser/worker glyph gap differs by "
                    f"{gap_error:.3f}px (allowed: {MAXIMUM_ERROR_PIXELS:.0f}px)"
                )
            maximum = max(maximum, gap_error)
            item.update({
                "browserGlyphGapPixels": browser_gap,
                "workerGlyphGapPixels": worker_gap,
                "maximumGlyphGapErrorPixels": gap_error,
            })
        word_matrix.append(item)
    configured_gaps = {
        float(item["configuredGapPixels"])
        for item in word_matrix[1:]
    }
    if (
        "font-template-mode-matrix" in (fixture.get("coverage") or [])
        and configured_gaps != {0.0, 6.0}
    ):
        raise RuntimeError("Caption word matrix did not exercise both required gaps")
    evidence["captionWordMatrix"] = word_matrix
    return maximum, evidence


def _worker_identity(manifest: dict[str, Any]) -> dict[str, Any]:
    git_sha = str(manifest.get("gitSha") or "").lower()
    digest = str(manifest.get("workerImageDigest") or "").lower()
    font_manifest_sha256 = str(manifest.get("fontManifestSha256") or "").lower()
    runtime_identity = manifest.get("runtimeIdentity")
    expected_runtime_identity = {
        "sourceGitSha": git_sha,
        "imageDigest": digest,
        "renderSpecVersion": "4",
        "captionRenderSpecVersion": "4",
        "fontManifestSha256": font_manifest_sha256,
    }
    checks = manifest.get("checks")
    if (
        manifest.get("schemaVersion") != 2
        or not _GIT_SHA.fullmatch(git_sha)
        or not _IMAGE_DIGEST.fullmatch(digest)
        or not _HEX_SHA256.fullmatch(font_manifest_sha256)
        or manifest.get("renderSpecVersion") != 4
        or manifest.get("captionRenderSpecVersion") != 4
        or runtime_identity != expected_runtime_identity
        or not isinstance(checks, dict)
        or any(checks.get(name) is not True for name in (
            "runtime-identity",
            "render-spec-v4",
            "caption-render-spec-v4",
            "worker-title-compositor-parity",
            "worker-caption-noop-parity",
            "font-manifest",
            "font-fallback",
            "browser-parity-worker-matrix",
        ))
    ):
        raise RuntimeError("Worker manifest does not contain exact v4 runtime identity")
    return {
        "gitSha": git_sha,
        "workerImageDigest": digest,
        "fontManifestSha256": font_manifest_sha256,
        "runtimeIdentity": expected_runtime_identity,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument("--browser-screenshot", type=Path, required=True)
    parser.add_argument("--browser-metrics", type=Path, required=True)
    parser.add_argument("--worker-frame", type=Path, required=True)
    parser.add_argument("--worker-manifest", type=Path, required=True)
    parser.add_argument("--worker-frame-source", required=True)
    parser.add_argument("--expected-worker-frame-sha256", required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    fixture = json.loads(args.fixture.read_text(encoding="utf-8"))
    metrics = json.loads(args.browser_metrics.read_text(encoding="utf-8"))
    worker_manifest = json.loads(args.worker_manifest.read_text(encoding="utf-8"))
    if not isinstance(worker_manifest, dict):
        raise TypeError("Worker manifest must be a JSON object")
    identity = _worker_identity(worker_manifest)
    worker_frame_sha256 = _sha256(args.worker_frame)
    if (
        not _HEX_SHA256.fullmatch(args.expected_worker_frame_sha256)
        or worker_frame_sha256 != args.expected_worker_frame_sha256
    ):
        raise RuntimeError("Worker parity frame hash does not match its Batch matrix")
    with (
        Image.open(args.browser_screenshot).convert("RGB") as browser_image,
        Image.open(args.worker_frame).convert("RGB") as worker_image,
    ):
        if browser_image.size != (1080, 1920) or worker_image.size != (1080, 1920):
            raise RuntimeError("Browser and worker evidence must both be 1080x1920")
        dom_error, dom_gap_evidence, dom_evidence = _verify_dom_geometry(
            fixture,
            metrics,
        )
        pixel_error, pixel_evidence = _verify_pixel_geometry(
            fixture,
            browser_image,
            worker_image,
        )
    report = {
        "schemaVersion": 1,
        **identity,
        "caseId": fixture.get("caseId"),
        "coverage": fixture.get("coverage") or [],
        "fontId": fixture.get("fontId"),
        "browser": metrics["browser"],
        "maximumAllowedErrorPixels": MAXIMUM_ERROR_PIXELS,
        "maximumDomErrorPixels": dom_error,
        "maximumPixelErrorPixels": pixel_error,
        "browserScreenshotSha256": _sha256(args.browser_screenshot),
        "workerFrameSha256": worker_frame_sha256,
        "workerManifestSha256": _sha256(args.worker_manifest),
        "workerFrameSource": args.worker_frame_source,
        "domCaptionGapEvidence": dom_gap_evidence,
        "domEvidence": dom_evidence,
        "pixelEvidence": pixel_evidence,
        "checks": {
            "browser-worker-visual-parity": True,
            "actualChromium": True,
            "exactFontsLoaded": True,
            "authoritativeDomGeometry": True,
            "browserTemplateCompilerParity": True,
            "storedSpecConsumerParity": True,
            "workerFrameInkBounds": True,
            **({"captionWordInkBounds": True}
               if (fixture.get("caption") or {}).get("mode") == "positioned-pop"
               else {}),
            **({"captionWordInkAndGapMatrix": True}
               if (
                   (fixture.get("caption") or {}).get("mode") == "positioned-pop"
                   and "font-template-mode-matrix" in (fixture.get("coverage") or [])
               ) else {}),
            **({"highlightCaptionInkBounds": True}
               if (fixture.get("caption") or {}).get("mode") == "flow-highlight"
               else {}),
            **({"titleInkBounds": True} if fixture.get("title") else {}),
        },
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(report, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
