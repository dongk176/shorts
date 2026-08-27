"""Run the Chromium side of the isolated-worker Stage B parity matrix."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

_CASE_ID = re.compile(r"^[a-z0-9-]{3,100}$")
_HEX_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_REQUIRED_CASE_COUNT = 66
_OVERALL_TIMEOUT_SECONDS = 45 * 60


def _object(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise TypeError(f"Expected a JSON object: {path}")
    return value


def _sha256(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def _run(arguments: list[str], *, root: Path, deadline: float) -> None:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise subprocess.TimeoutExpired(arguments, _OVERALL_TIMEOUT_SECONDS)
    subprocess.run(
        arguments,
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
        shell=False,
        timeout=min(120, remaining),
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--matrix", type=Path, required=True)
    parser.add_argument("--matrix-source", required=True)
    parser.add_argument("--worker-frames-root", type=Path, required=True)
    parser.add_argument("--worker-manifest", type=Path, required=True)
    parser.add_argument("--evidence-directory", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--case-offset", type=int, default=0)
    parser.add_argument("--case-limit", type=int)
    parser.add_argument("--skip-aggregate", action="store_true")
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent
    deadline = time.monotonic() + _OVERALL_TIMEOUT_SECONDS
    matrix = _object(args.matrix)
    cases = matrix.get("cases")
    if (
        matrix.get("schemaVersion") != 1
        or not isinstance(cases, list)
        or matrix.get("caseCount") != len(cases)
        or len(cases) != _REQUIRED_CASE_COUNT
        or not args.matrix_source.startswith("s3://")
        or not args.matrix_source.endswith("/browser-parity/matrix.json")
    ):
        raise RuntimeError("Browser parity runner requires the complete Batch matrix")

    if args.case_offset < 0 or (args.case_limit is not None and args.case_limit < 1):
        raise ValueError("Browser parity case slice is invalid")
    selected_cases = cases[
        args.case_offset:
        None if args.case_limit is None else args.case_offset + args.case_limit
    ]
    if len(selected_cases) != len(cases) and not args.skip_aggregate:
        raise RuntimeError("A sliced browser parity run cannot produce a release report")

    evidence = args.evidence_directory.resolve()
    case_reports = evidence / "case-reports"
    case_reports.mkdir(parents=True, exist_ok=True)
    seen: set[str] = set()
    failures: list[str] = []
    for case in selected_cases:
        if not isinstance(case, dict):
            raise TypeError("Browser parity matrix case is not an object")
        case_id = str(case.get("id") or "")
        frame_name = str(case.get("workerFrameName") or "")
        expected_hash = str(case.get("workerFrameSha256") or "")
        fixture = case.get("fixture")
        if (
            not _CASE_ID.fullmatch(case_id)
            or case_id in seen
            or frame_name != f"frames/{case_id}.png"
            or not _HEX_SHA256.fullmatch(expected_hash)
            or not isinstance(fixture, dict)
            or fixture.get("caseId") != case_id
        ):
            raise RuntimeError("Browser parity matrix case identity is invalid")
        seen.add(case_id)
        worker_frame = args.worker_frames_root / f"{case_id}.png"
        if not worker_frame.is_file() or _sha256(worker_frame) != expected_hash:
            raise RuntimeError(f"Worker frame hash is invalid: {case_id}")

        case_root = evidence / "cases" / case_id
        case_root.mkdir(parents=True, exist_ok=True)
        fixture_path = case_root / "fixture.json"
        fixture_path.write_text(
            json.dumps(fixture, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        screenshot_path = case_root / "chromium.png"
        metrics_path = case_root / "chromium-metrics.json"
        report_path = case_reports / f"{case_id}.json"
        try:
            _run(
                [
                    "node",
                    "web/tests/browser-render-parity/run.mjs",
                    "--fixture",
                    str(fixture_path),
                    "--screenshot",
                    str(screenshot_path),
                    "--metrics",
                    str(metrics_path),
                ],
                root=root,
                deadline=deadline,
            )
            _run(
                [
                    sys.executable,
                    "scripts/verify-editor-v4-browser-worker-parity.py",
                    "--fixture",
                    str(fixture_path),
                    "--browser-screenshot",
                    str(screenshot_path),
                    "--browser-metrics",
                    str(metrics_path),
                    "--worker-frame",
                    str(worker_frame),
                    "--worker-manifest",
                    str(args.worker_manifest),
                    "--worker-frame-source",
                    args.matrix_source.removesuffix("matrix.json") + frame_name,
                    "--expected-worker-frame-sha256",
                    expected_hash,
                    "--report",
                    str(report_path),
                ],
                root=root,
                deadline=deadline,
            )
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
            detail = (
                str(error.stderr).strip().splitlines()[-1]
                if isinstance(error, subprocess.CalledProcessError) and error.stderr
                else str(error)
            )
            failures.append(f"{case_id}: {detail}")

    if failures:
        raise RuntimeError(
            "Browser/worker parity matrix failed:\n" + "\n".join(failures)
        )

    if args.skip_aggregate:
        return

    _run(
        [
            sys.executable,
            "scripts/aggregate-editor-v4-browser-worker-parity.py",
            "--matrix",
            str(args.matrix),
            "--matrix-source",
            args.matrix_source,
            "--worker-manifest",
            str(args.worker_manifest),
            "--case-report-directory",
            str(case_reports),
            "--report",
            str(args.report),
        ],
        root=root,
        deadline=deadline,
    )


if __name__ == "__main__":
    main()
