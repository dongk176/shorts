"""Bounded, ephemeral component check on the production worker image.

No database access, project creation or S3 uploads. The authorized source is
limited to its first four minutes; all media is removed on success or failure.
This is not a substitute for the release registrar or project E2E checks.
"""
from __future__ import annotations

import json
import subprocess
import time
from importlib.metadata import version
from pathlib import Path
from tempfile import TemporaryDirectory

from shorts_worker.config import Settings
from shorts_worker.ingestion import YOUTUBE_DOWNLOAD_FORMAT, YtDlpIngestionProvider
from shorts_worker.media import probe_media
from shorts_worker.renderer import VideoRenderer
from shorts_worker.schemas import HighlightClip, TemplateId
from shorts_worker.subtitles import OPENAI_STABLE_POLICY, AudioTranscriber


def emit(stage: str, **values: object) -> None:
    print(json.dumps({"event": "ytdlp_runtime_probe", "stage": stage, **values}), flush=True)


def main() -> None:
    started = time.monotonic()
    assert version("yt-dlp") == "2026.11.23"
    provider = YtDlpIngestionProvider(timeout_seconds=360, max_attempts=1)
    route = provider._acquire_route(
        job_id=None, asset="probe", attempt=1, required_route_id="webshare-01",
    )
    emit("start", version=version("yt-dlp"), po_enabled=provider.po_token_enabled)
    with TemporaryDirectory(prefix="easycut-ytdlp-components-") as folder:
        root = Path(folder)
        provider._run_for_route(
            [
                *provider._base_args(), "--verbose", "--format", YOUTUBE_DOWNLOAD_FORMAT,
                "--download-sections", "*0-240", "--merge-output-format", "mp4",
                "--output", str(root / "source.%(ext)s"),
                "https://www.youtube.com/watch?v=YxtZmF516EY",
            ],
            timeout=360, route=route, job_id=None, asset="probe", attempt=1,
        )
        source = root / "source.mp4"
        media = probe_media(source, timeout=30)
        streams = media["streams"]
        assert any(s.get("codec_type") == "video" for s in streams)
        assert any(s.get("codec_type") == "audio" for s in streams)
        assert 239 <= float(media["format"]["duration"]) <= 245
        emit("download_passed", seconds=round(time.monotonic() - started, 2))
        settings = Settings()
        result = AudioTranscriber(settings).transcribe(
            source, root / "transcribe", duration_seconds=240, policy=OPENAI_STABLE_POLICY,
        )
        assert result.segments and result.failed_chunk_count == 0
        emit("transcription_passed", segments=len(result.segments), provider=result.provider)
        clip = HighlightClip(start_seconds=0, end_seconds=15, hook_title="추출기 업데이트 검증")
        output = root / "short.mp4"
        VideoRenderer(settings).render(
            source_path=source, output_path=output, clip=clip, clip_index=0,
            channel_name="이지컷 내부 검증", template_id=TemplateId.DARK_RED,
            transcript=result.segments, work_dir=root / "render",
        )
        rendered = probe_media(output, timeout=30)
        video = next(s for s in rendered["streams"] if s.get("codec_type") == "video")
        assert (video["width"], video["height"]) == (1080, 1920)
        assert any(s.get("codec_type") == "audio" for s in rendered["streams"])
        assert 14.9 <= float(rendered["format"]["duration"]) <= 15.2
        subprocess.run(
            ["ffmpeg", "-v", "error", "-i", str(output), "-f", "null", "-"],
            check=True, capture_output=True, timeout=90,
        )
        emit("render_decode_passed", width=1080, height=1920, duration=15)
    emit("completed", media_removed=not root.exists(), seconds=round(time.monotonic() - started, 2))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # Do not print subprocess arguments, provider text, credentials or URLs.
        emit("failed", exception=type(exc).__name__, code=getattr(exc, "code", None))
        raise SystemExit(1) from None
