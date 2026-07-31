from __future__ import annotations

import shutil
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from shorts_worker import editor_release_probe


def test_probe_document_covers_all_supported_editor_fonts() -> None:
    document = editor_release_probe._document()

    assert document.version == 2
    assert {overlay.font_id.value for overlay in document.overlays.text_overlays} == set(
        editor_release_probe.FONT_IDS
    )
    assert len(document.video.clips) == 2
    assert document.comments[0].end_seconds < document.comments[1].start_seconds


@pytest.mark.render
@pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg and ffprobe are required",
)
def test_release_probe_renders_and_uploads_machine_verifiable_evidence(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    s3 = MagicMock()
    monkeypatch.setenv("EDITOR_RELEASE_GIT_SHA", "a" * 40)
    monkeypatch.setenv("WORKER_IMAGE_DIGEST", f"sha256:{'b' * 64}")
    monkeypatch.setenv("EDITOR_RELEASE_SUITE_VERIFIED", "true")
    monkeypatch.setenv("AWS_S3_OUTPUT_BUCKET", "isolated-editor-test")
    monkeypatch.setenv("TEMP_ROOT", str(tmp_path))
    monkeypatch.setattr(editor_release_probe.boto3, "client", lambda *_args, **_kwargs: s3)

    result = editor_release_probe.run_editor_release_probe()

    assert result["checks"] == {
        "worker-image": True,
        "legacy-no-timeline": True,
        "captured-timeline": True,
        "editor-v2": True,
        "ffprobe": True,
        "frame-parity": True,
    }
    assert result["media"]["width"] == 1080
    assert result["media"]["height"] == 1920
    assert result["geometry"]["maximumErrorPixels"] <= 2
    assert result["artifactUri"].endswith("/manifest.json")
    assert s3.upload_file.call_count == 2
    s3.put_object.assert_called_once()
