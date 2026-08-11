from __future__ import annotations

import shutil
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from shorts_worker import editor_release_probe
from shorts_worker.editor_renderer import editor_layer_order, retime_editor_caption_spec
from shorts_worker.schemas import EditorFontId


def test_probe_document_covers_all_supported_editor_fonts() -> None:
    document = editor_release_probe._document()

    assert document.version == 3
    assert document.render_spec is not None
    assert document.render_spec.version == 2
    assert document.render_spec.subtitles is not None
    assert document.render_spec.subtitles.center_x == 540
    assert document.render_spec.subtitles.offset_y == -260
    assert document.render_spec.subtitles.scale == 1.5
    assert set(editor_release_probe.FONT_IDS) == {
        font_id.value for font_id in EditorFontId
    }
    assert {overlay.font_id.value for overlay in document.overlays.text_overlays} == set(
        editor_release_probe.FONT_IDS
    )
    assert len(document.video.clips) == 2
    assert document.comments[0].end_seconds < document.comments[1].start_seconds


@pytest.mark.parametrize("scenario", editor_release_probe.PROBE_SCENARIOS)
def test_editor_release_probe_scenarios_are_valid_and_renderable(scenario: str) -> None:
    document = editor_release_probe._document(scenario)

    assert document.version == 3
    assert document.render_spec is not None
    assert document.video.output_duration_seconds == pytest.approx(3.5)
    assert document.overlays.visible["video"] is True
    assert set(document.overlays.layer_order) == {
        "video",
        "title",
        "comment",
        "channel",
        *(f"text:{overlay.id}" for overlay in document.overlays.text_overlays),
    }


def test_editor_release_probe_matrix_covers_candidate_editing_features() -> None:
    documents = {
        scenario: editor_release_probe._document(scenario)
        for scenario in editor_release_probe.PROBE_SCENARIOS
    }

    assert len(documents["ripple-cut"].video.clips) == 3
    assert len(documents["comment-gaps"].comments) == 3
    assert documents["comment-gaps"].overlays.comment_theme == "light"
    assert {
        overlay.effect for overlay in documents["text-effects"].overlays.text_overlays
    } == {"none", "outline", "shadow"}
    assert documents["background-template"].overlays.background is not None
    assert documents["background-template"].overlays.background.asset_id == "white-hanji"
    assert documents["channel-layer-order"].channel.display_name == "교체한 채널 프로필"
    assert documents["channel-layer-order"].overlays.layer_order[-1] == "text:top-layer"
    assert editor_layer_order(documents["channel-layer-order"])[-1] == "channel"


def test_editor_release_probe_rejects_unknown_scenario() -> None:
    with pytest.raises(RuntimeError, match="Unsupported editor release scenario"):
        editor_release_probe._document("unknown")


@pytest.mark.render
@pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg and ffprobe are required",
)
@pytest.mark.parametrize("scenario", editor_release_probe.PROBE_SCENARIOS)
def test_release_probe_renders_and_uploads_machine_verifiable_evidence(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    scenario: str,
) -> None:
    s3 = MagicMock()
    monkeypatch.setenv("EDITOR_RELEASE_GIT_SHA", "a" * 40)
    monkeypatch.setenv("WORKER_IMAGE_DIGEST", f"sha256:{'b' * 64}")
    monkeypatch.setenv("EDITOR_RELEASE_SUITE_VERIFIED", "true")
    monkeypatch.setenv("EDITOR_RELEASE_SCENARIO", scenario)
    monkeypatch.setenv("AWS_S3_OUTPUT_BUCKET", "isolated-editor-test")
    monkeypatch.setenv("TEMP_ROOT", str(tmp_path))
    monkeypatch.setattr(editor_release_probe.boto3, "client", lambda *_args, **_kwargs: s3)

    result = editor_release_probe.run_editor_release_probe()

    assert result["scenario"] == scenario
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
    assert result["captionTemplate"]["templateId"] == "pop"
    assert result["captionTemplate"]["accentPixels"] >= 25
    assert result["capabilities"] == {"subtitleEditing": True}
    assert set(result["fonts"]) == {font_id.value for font_id in EditorFontId}
    assert result["artifactUri"].endswith("/manifest.json")
    assert s3.upload_file.call_count == 2
    s3.put_object.assert_called_once()
