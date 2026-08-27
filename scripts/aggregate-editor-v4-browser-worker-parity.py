"""Aggregate the exact Chromium ↔ isolated-worker Stage B parity matrix."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any

MAXIMUM_ERROR_PIXELS = 2.0
_HEX_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_REQUIRED_COVERAGE = {
    "long-korean-title",
    "transparent-title-background",
    "colored-title-background",
    "non-centered-title",
    "edge-clamped-title",
    "pop-caption",
    "highlight-caption",
    "mixed-language-caption",
    "pure-korean-caption",
    "pure-english-caption",
    "font-template-mode-matrix",
    "title-font-matrix",
    "mixed-language-title",
}


def _sha256(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def _object(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise TypeError(f"Expected a JSON object: {path}")
    return value


def _number(value: object, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise TypeError(f"Parity report {label} is not numeric")
    number = float(value)
    if number < 0 or number > MAXIMUM_ERROR_PIXELS:
        raise RuntimeError(f"Parity report {label} exceeds 2px")
    return number


def _matrix_frame_source(matrix_source: str, frame_name: str) -> str:
    if not matrix_source.startswith("s3://") or not matrix_source.endswith(
        "/browser-parity/matrix.json"
    ):
        raise RuntimeError("Worker parity matrix source is not an isolated S3 artifact")
    if not re.fullmatch(r"frames/[a-z0-9-]+\.png", frame_name):
        raise RuntimeError("Worker parity frame name is invalid")
    return matrix_source.removesuffix("matrix.json") + frame_name


def _validate_matrix_coverage(matrix: dict[str, Any]) -> set[str]:
    cases = matrix.get("cases")
    if (
        matrix.get("schemaVersion") != 1
        or matrix.get("renderer") != "isolated-linux-worker-v4"
        or not isinstance(cases, list)
        or matrix.get("caseCount") != len(cases)
        or len(cases) != 66
    ):
        raise RuntimeError("Worker browser parity matrix is incomplete")
    coverage: set[str] = set()
    case_ids: set[str] = set()
    font_modes: dict[str, set[str]] = {}
    title_fonts: set[str] = set()
    for case in cases:
        if not isinstance(case, dict):
            raise TypeError("Worker browser parity case is not an object")
        case_id = str(case.get("id") or "")
        fixture = case.get("fixture")
        case_coverage = case.get("coverage")
        frame_hash = str(case.get("workerFrameSha256") or "")
        if (
            not re.fullmatch(r"[a-z0-9-]{3,100}", case_id)
            or case_id in case_ids
            or not isinstance(fixture, dict)
            or fixture.get("caseId") != case_id
            or fixture.get("coverage") != case_coverage
            or not isinstance(case_coverage, list)
            or not _HEX_SHA256.fullmatch(frame_hash)
        ):
            raise RuntimeError("Worker browser parity case identity is invalid")
        case_ids.add(case_id)
        coverage.update(str(value) for value in case_coverage)
        if "font-template-mode-matrix" in case_coverage:
            font_id = str(case.get("fontId") or "")
            template_id = str(case.get("templateId") or "")
            if (
                fixture.get("fontId") != font_id
                or template_id not in {"pop", "highlight"}
                or fixture.get("caption", {}).get("mode")
                != ("positioned-pop" if template_id == "pop" else "flow-highlight")
            ):
                raise RuntimeError("Worker font parity case identity is invalid")
            modes = font_modes.setdefault(font_id, set())
            if template_id in modes:
                raise RuntimeError("Worker font/template parity case is duplicated")
            modes.add(template_id)

        title = fixture.get("title")
        if isinstance(title, dict):
            boxes = title.get("spec", {}).get("lineBoxes") or []
            background_count = sum(
                len(box.get("backgroundRuns") or [])
                for box in boxes
                if isinstance(box, dict)
            )
            if "transparent-title-background" in case_coverage and background_count:
                raise RuntimeError("Transparent title fixture contains a background")
            if "colored-title-background" in case_coverage and background_count < 2:
                raise RuntimeError("Colored title fixture does not cover both title lines")
            if "non-centered-title" in case_coverage and all(
                abs(float(box["centerX"]) - 540) <= 2 for box in boxes
            ):
                raise RuntimeError("Non-centered title fixture is centered")
            if "edge-clamped-title" in case_coverage:
                touches_edge = any(
                    min(
                        abs(float(box["centerX"]) - float(box["width"]) / 2),
                        abs(
                            float(box["centerX"])
                            + float(box["width"]) / 2
                            - 1080
                        ),
                    ) <= 2
                    for box in boxes
                )
                if not touches_edge:
                    raise RuntimeError("Edge title fixture does not touch a canvas edge")
            if "title-font-matrix" in case_coverage:
                font_id = str(case.get("fontId") or "")
                compiler_input = title.get("compilerInput") or {}
                title_text = str(compiler_input.get("title") or "")
                if (
                    fixture.get("fontId") != font_id
                    or compiler_input.get("fontId") != font_id
                    or not re.search(r"[A-Za-z]", title_text)
                    or not re.search(r"[가-힣]", title_text)
                    or font_id in title_fonts
                ):
                    raise RuntimeError("Title font matrix case identity is invalid")
                title_fonts.add(font_id)
        caption = fixture.get("caption")
        caption_coverage = {
            "pop-caption",
            "highlight-caption",
            "mixed-language-caption",
            "pure-korean-caption",
            "pure-english-caption",
            "font-template-mode-matrix",
        }
        if caption_coverage.intersection(case_coverage) and not isinstance(
            caption,
            dict,
        ):
            raise RuntimeError("Caption matrix fixture is missing its compiler input")
        if isinstance(caption, dict) and "mixed-language-caption" in case_coverage:
            text = "".join(str(word.get("text") or "") for word in caption["words"])
            if not re.search(r"[A-Za-z]", text) or not re.search(r"[가-힣]", text):
                raise RuntimeError("Mixed caption fixture is not Korean/English mixed")
        if isinstance(caption, dict) and "pure-korean-caption" in case_coverage:
            text = "".join(str(word.get("text") or "") for word in caption["words"])
            if not text or re.search(r"[^가-힣]", text):
                raise RuntimeError("Pure Korean caption fixture is not Korean-only")
        if isinstance(caption, dict) and "pure-english-caption" in case_coverage:
            text = "".join(str(word.get("text") or "") for word in caption["words"])
            if not text or re.search(r"[^A-Za-z]", text):
                raise RuntimeError("Pure English caption fixture is not English-only")
        if (
            "pop-caption" in case_coverage
            and caption.get("mode") != "positioned-pop"
        ):
            raise RuntimeError("Pop fixture mode is invalid")
        if (
            "font-template-mode-matrix" in case_coverage
            and "pop-caption" in case_coverage
            and {
                float(position["gapBefore"])
                for position in caption.get("positions", [])[1:]
            }
            != {0.0, 6.0}
        ):
            raise RuntimeError("Pop fixture does not cover joined and spaced gaps")
        if "highlight-caption" in case_coverage and caption.get("mode") != "flow-highlight":
            raise RuntimeError("Highlight fixture mode is invalid")
    fonts = {str(value) for value in matrix.get("fontIds") or []}
    if (
        coverage != _REQUIRED_COVERAGE
        or set(font_modes) != fonts
        or title_fonts != fonts
        or any(modes != {"pop", "highlight"} for modes in font_modes.values())
        or len(fonts) != 20
    ):
        raise RuntimeError("Worker browser parity coverage/font matrix is incomplete")
    return fonts


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--matrix", type=Path, required=True)
    parser.add_argument("--matrix-source", required=True)
    parser.add_argument("--worker-manifest", type=Path, required=True)
    parser.add_argument("--case-report-directory", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    matrix = _object(args.matrix)
    manifest = _object(args.worker_manifest)
    matrix_sha256 = _sha256(args.matrix)
    manifest_sha256 = _sha256(args.worker_manifest)
    identity = manifest.get("runtimeIdentity")
    matrix_contract = manifest.get("browserParityMatrix")
    if (
        matrix.get("runtimeIdentity") != identity
        or not isinstance(matrix_contract, dict)
        or matrix_contract.get("sha256") != matrix_sha256
        or matrix_contract.get("caseCount") != matrix.get("caseCount")
        or matrix_contract.get("fontIds") != matrix.get("fontIds")
    ):
        raise RuntimeError("Worker parity matrix is not bound to the Batch manifest")
    fonts = _validate_matrix_coverage(matrix)
    case_reports: list[dict[str, Any]] = []
    maximum_dom = 0.0
    maximum_pixel = 0.0
    browser_versions: set[str] = set()
    for case in matrix["cases"]:
        case_id = str(case["id"])
        report = _object(args.case_report_directory / f"{case_id}.json")
        frame_source = _matrix_frame_source(
            args.matrix_source,
            str(case["workerFrameName"]),
        )
        checks = report.get("checks")
        if (
            report.get("schemaVersion") != 1
            or report.get("runtimeIdentity") != identity
            or report.get("caseId") != case_id
            or report.get("coverage") != case["coverage"]
            or report.get("fontId") != case.get("fontId")
            or report.get("workerManifestSha256") != manifest_sha256
            or report.get("workerFrameSha256") != case["workerFrameSha256"]
            or report.get("workerFrameSource") != frame_source
            or not isinstance(checks, dict)
            or checks.get("browser-worker-visual-parity") is not True
            or checks.get("actualChromium") is not True
            or checks.get("exactFontsLoaded") is not True
            or checks.get("authoritativeDomGeometry") is not True
            or checks.get("workerFrameInkBounds") is not True
            or checks.get("browserTemplateCompilerParity") is not True
            or checks.get("storedSpecConsumerParity") is not True
        ):
            raise RuntimeError(f"Browser parity case report is invalid: {case_id}")
        if "pop-caption" in case["coverage"] and checks.get(
            "captionWordInkBounds"
        ) is not True:
            raise RuntimeError(f"Pop parity case lacks word ink evidence: {case_id}")
        if (
            "pop-caption" in case["coverage"]
            and "font-template-mode-matrix" in case["coverage"]
            and checks.get("captionWordInkAndGapMatrix") is not True
        ):
            raise RuntimeError(f"Font pop parity case lacks gap evidence: {case_id}")
        if "highlight-caption" in case["coverage"] and checks.get(
            "highlightCaptionInkBounds"
        ) is not True:
            raise RuntimeError("Highlight parity case lacks rendered ink evidence")
        if "colored-title-background" in case["coverage"] and "titleBackground" not in (
            report.get("pixelEvidence") or {}
        ):
            raise RuntimeError("Colored title background lacks rendered pixel evidence")
        maximum_dom = max(
            maximum_dom,
            _number(report.get("maximumDomErrorPixels"), f"{case_id} DOM error"),
        )
        maximum_pixel = max(
            maximum_pixel,
            _number(report.get("maximumPixelErrorPixels"), f"{case_id} pixel error"),
        )
        browser_versions.add(str(report.get("browser") or ""))
        case_reports.append({
            "caseId": case_id,
            "coverage": case["coverage"],
            "fontId": case.get("fontId"),
            "maximumDomErrorPixels": report["maximumDomErrorPixels"],
            "maximumPixelErrorPixels": report["maximumPixelErrorPixels"],
            "browserScreenshotSha256": report["browserScreenshotSha256"],
            "workerFrameSha256": report["workerFrameSha256"],
            "workerFrameSource": report["workerFrameSource"],
            "checks": report["checks"],
        })
    report = {
        "schemaVersion": 2,
        "gitSha": manifest["gitSha"],
        "workerImageDigest": manifest["workerImageDigest"],
        "fontManifestSha256": manifest["fontManifestSha256"],
        "runtimeIdentity": identity,
        "workerManifestSha256": manifest_sha256,
        "workerMatrixSha256": matrix_sha256,
        "workerMatrixSource": args.matrix_source,
        "maximumAllowedErrorPixels": MAXIMUM_ERROR_PIXELS,
        "maximumDomErrorPixels": maximum_dom,
        "maximumPixelErrorPixels": maximum_pixel,
        "caseCount": len(case_reports),
        "fontIds": sorted(fonts),
        "coverage": sorted(_REQUIRED_COVERAGE),
        "browsers": sorted(browser_versions),
        "cases": case_reports,
        "checks": {
            "browser-worker-visual-parity": True,
            "actualChromium": True,
            "exactFontsLoaded": True,
            "authoritativeDomGeometry": True,
            "workerFrameInkBounds": True,
            "browserTemplateCompilerParity": True,
            "storedSpecConsumerParity": True,
            "captionWordInkAndGapMatrix": True,
            "highlightCaptionInkBounds": True,
            "titleScenarioMatrix": True,
            "allEditorFontsVisualMatrix": True,
            "allEditorFontsBothCaptionModes": True,
            "allEditorFontsTitleMatrix": True,
            "pureLanguageBoundaryMatrix": True,
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
