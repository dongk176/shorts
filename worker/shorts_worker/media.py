from __future__ import annotations

import json
import subprocess
from fractions import Fraction
from pathlib import Path

from .errors import RenderError


def run_command(
    args: list[str],
    *,
    timeout: float,
    cwd: Path | None = None,
) -> subprocess.CompletedProcess[str]:
    """Run a trusted argument vector. Shell interpretation is intentionally unavailable."""
    try:
        return subprocess.run(
            args,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            shell=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise RenderError("영상 처리 시간이 초과되었습니다. 다시 시도해 주세요.") from exc
    except OSError as exc:
        raise RenderError("FFmpeg를 실행할 수 없습니다. 설치 상태를 확인해 주세요.") from exc


def probe_media(path: Path, timeout: float = 30) -> dict:
    result = run_command(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
            str(path),
        ],
        timeout=timeout,
    )
    if result.returncode != 0:
        raise RenderError(f"영상 정보를 읽지 못했습니다: {result.stderr[-1000:]}")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RenderError("FFprobe 결과를 해석하지 못했습니다.") from exc


def video_fps(probe: dict) -> float:
    video = next(
        (
            stream
            for stream in probe.get("streams", [])
            if stream.get("codec_type") == "video"
        ),
        {},
    )
    raw = video.get("avg_frame_rate") or video.get("r_frame_rate") or "30/1"
    try:
        fps = float(Fraction(raw))
    except (ValueError, ZeroDivisionError):
        fps = 30.0
    if fps <= 0:
        fps = 30.0
    return min(fps, 30.0)


def media_duration(probe: dict) -> float:
    raw = probe.get("format", {}).get("duration")
    if raw is None:
        for stream in probe.get("streams", []):
            if stream.get("duration") is not None:
                raw = stream["duration"]
                break
    try:
        return max(0.0, float(raw))
    except (TypeError, ValueError):
        return 0.0
