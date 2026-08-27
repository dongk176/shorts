from __future__ import annotations

import json
import shutil
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from PIL import Image

from shorts_worker import editor_release_probe
from shorts_worker.editor_renderer import editor_layer_order, retime_editor_caption_spec
from shorts_worker.font_manifest import canonical_editor_font_manifest
from shorts_worker.schemas import EditorFontId


def test_probe_document_covers_all_supported_editor_fonts() -> None:
    document = editor_release_probe._document()

    assert document.version == 3
    assert document.render_spec is not None
    assert document.render_spec.version == 4
    assert document.render_spec.subtitles is not None
    assert document.render_spec.subtitles.center_x == 540
    assert document.render_spec.subtitles.offset_y == 0
    assert document.render_spec.subtitles.scale == 1
    assert document.render_spec.subtitles.caption_spec_version == 4
    assert document.render_spec.title.font.family == '"Editor V4 Gmarket Sans"'
    assert document.render_spec.title.font.sha256 is not None
    assert set(editor_release_probe.FONT_IDS) == {
        font_id.value for font_id in EditorFontId
    }
    assert {overlay.font_id.value for overlay in document.overlays.text_overlays} == set(
        editor_release_probe.FONT_IDS
    )
    assert len(document.video.clips) == 2
    assert document.comments[0].end_seconds < document.comments[1].start_seconds


def test_v4_font_manifest_is_complete_deterministic_and_exact() -> None:
    manifest = canonical_editor_font_manifest()
    entries = manifest["entries"]

    assert manifest["fallbackDetected"] is False
    assert len(str(manifest["sha256"])) == 64
    assert [entry["fontId"] for entry in entries] == sorted(editor_release_probe.FONT_IDS)
    assert len(entries) == len(EditorFontId) == 20
    paperlogy = next(entry for entry in entries if entry["fontId"] == "paperlogy")
    assert paperlogy["sha256"] == (
        "fe71049fe3d3a7dd3f2e0c12efd850acd1293658181af322348edde9b016e6ba"
    )
    assert paperlogy["postscriptName"] == "Paperlogy-7Bold"
    assert paperlogy["cssToAssScale"] == 0.849057
    noto_sans = next(entry for entry in entries if entry["fontId"] == "noto-sans-kr")
    assert noto_sans["cssToAssBaselineOffsetEm"] == 0.021739
    gmarket = next(entry for entry in entries if entry["fontId"] == "gmarket-sans")
    assert gmarket["titleBaselineOffsetEm"] == 0.3


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


def test_editor_release_probe_pop_caption_survives_every_timeline() -> None:
    caption_render_spec = editor_release_probe._pop_caption_render_spec()

    assert caption_render_spec["templateId"] == "pop"
    assert caption_render_spec["schemaVersion"] == 4
    assert caption_render_spec["layoutMode"] == "absolute-word-positions-v1"
    assert caption_render_spec["font"]["fontId"] == "paperlogy"
    assert caption_render_spec["timingLeadFrames"] == 7
    multiword_cues = [
        cue for cue in caption_render_spec["cues"] if len(cue["words"]) >= 2
    ]
    assert multiword_cues
    assert multiword_cues[0]["words"][1]["spaceBefore"] is True
    assert len(multiword_cues[0]["events"][0]["positions"]) >= 2
    for scenario in editor_release_probe.PROBE_SCENARIOS:
        rendered = retime_editor_caption_spec(
            editor_release_probe._document(scenario),
            caption_render_spec,
        )
        assert rendered is not None
        assert rendered["templateId"] == "pop"
        assert rendered["cues"]

    baseline = retime_editor_caption_spec(
        editor_release_probe._document("baseline"),
        caption_render_spec,
    )
    assert baseline is not None
    sample_event = next(
        event
        for cue in baseline["cues"]
        for event in cue["events"]
        if event["startFrame"] <= 60 < event["endFrame"]
    )
    assert [position["gapBefore"] for position in sample_event["positions"]] == [
        0,
        6,
        0,
    ]


def test_v4_fallback_probe_verifies_every_editor_font(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    prepared: list[str] = []
    verified: list[str] = []

    def fake_prepare(
        directory: Path,
        spec: dict[str, object],
    ) -> Path:
        font = spec["font"]
        assert isinstance(font, dict)
        prepared.append(str(font["fontId"]))
        directory.mkdir(parents=True, exist_ok=True)
        return directory

    def fake_verify(
        *,
        font_directory: Path,
        spec: dict[str, object],
        timeout: float,
    ) -> None:
        assert font_directory == tmp_path / "caption-fonts"
        assert timeout == 30
        font = spec["font"]
        assert isinstance(font, dict)
        assert spec["schemaVersion"] == 4
        assert font["metrics"]["revision"] == "editor-font-metrics-v2"
        verified.append(str(font["fontId"]))

    monkeypatch.setattr(editor_release_probe, "prepare_caption_fonts", fake_prepare)
    monkeypatch.setattr(
        editor_release_probe,
        "verify_caption_font_selection_v4",
        fake_verify,
    )

    result = editor_release_probe._verify_all_v4_caption_font_selections(
        root=tmp_path,
    )

    assert result == editor_release_probe.FONT_IDS
    assert prepared == list(editor_release_probe.FONT_IDS)
    assert verified == list(editor_release_probe.FONT_IDS)
    assert len(verified) == len(EditorFontId) == 20


@pytest.mark.render
@pytest.mark.skipif(
    shutil.which("ffmpeg") is None,
    reason="ffmpeg is required",
)
def test_v4_fallback_probe_selects_every_editor_font_with_libass(
    tmp_path: Path,
) -> None:
    assert editor_release_probe._verify_all_v4_caption_font_selections(
        root=tmp_path,
    ) == editor_release_probe.FONT_IDS


def test_editor_release_probe_rejects_unknown_scenario() -> None:
    with pytest.raises(RuntimeError, match="Unsupported editor release scenario"):
        editor_release_probe._document("unknown")


def test_release_probe_requires_exact_runtime_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("EDITOR_RELEASE_GIT_SHA", "a" * 40)
    monkeypatch.setenv("WORKER_IMAGE_DIGEST", f"sha256:{'b' * 64}")
    runtime_verifier = MagicMock(return_value=None)
    monkeypatch.setattr(
        editor_release_probe,
        "verify_initial_render_v4_runtime",
        runtime_verifier,
    )

    with pytest.raises(RuntimeError, match="runtime identity evidence"):
        editor_release_probe.run_editor_release_probe()

    runtime_verifier.assert_called_once_with({
        "initial_render_spec_version": 4,
        "initial_caption_render_spec_version": 4,
    })


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
    s3.put_object.side_effect = lambda **kwargs: {
        "VersionId": f"version-{kwargs['Key'].replace('/', '-')}",
        "ETag": '"evidence-etag"',
        "ChecksumSHA256": kwargs.get("ChecksumSHA256"),
    }
    monkeypatch.setenv("EDITOR_RELEASE_GIT_SHA", "a" * 40)
    monkeypatch.setenv("WORKER_IMAGE_DIGEST", f"sha256:{'b' * 64}")
    monkeypatch.setenv("EDITOR_RELEASE_SUITE_VERIFIED", "true")
    monkeypatch.setenv(
        "EDITOR_FONT_MANIFEST_SHA256",
        str(canonical_editor_font_manifest()["sha256"]),
    )
    monkeypatch.setenv("EDITOR_RELEASE_SCENARIO", scenario)
    if scenario == "baseline":
        monkeypatch.setenv("EDITOR_RELEASE_PROBE_NONCE", "c" * 32)
        monkeypatch.setenv(
            "EDITOR_RELEASE_PROBE_RUN_ID",
            "7fd1c249-6cef-40f1-97d4-e4e6c837f60a",
        )
        monkeypatch.setenv(
            "AWS_BATCH_JOB_ID",
            "8fd1c249-6cef-40f1-97d4-e4e6c837f60b",
        )
    monkeypatch.setenv("AWS_S3_OUTPUT_BUCKET", "isolated-editor-test")
    monkeypatch.setenv("TEMP_ROOT", str(tmp_path))
    monkeypatch.setattr(editor_release_probe.boto3, "client", lambda *_args, **_kwargs: s3)
    runtime_identity = {
        "sourceGitSha": "a" * 40,
        "imageDigest": f"sha256:{'b' * 64}",
        "renderSpecVersion": "4",
        "captionRenderSpecVersion": "4",
        "fontManifestSha256": str(canonical_editor_font_manifest()["sha256"]),
    }
    runtime_verifier = MagicMock(return_value=runtime_identity)
    monkeypatch.setattr(
        editor_release_probe,
        "verify_initial_render_v4_runtime",
        runtime_verifier,
    )
    fallback_probe = MagicMock(return_value=editor_release_probe.FONT_IDS)
    monkeypatch.setattr(
        editor_release_probe,
        "_verify_all_v4_caption_font_selections",
        fallback_probe,
    )
    def fake_browser_matrix(
        root: Path,
        *,
        runtime_identity: dict[str, str],
    ) -> dict[str, object]:
        assert runtime_identity == runtime_verifier.return_value
        (root / "frames").mkdir(parents=True)
        Image.new("RGB", (1080, 1920), "#000000").save(
            root / "frames" / "fixture.png"
        )
        matrix = {
            "schemaVersion": 1,
            "caseCount": 1,
            "fontIds": list(editor_release_probe.FONT_IDS),
            "cases": [{"id": "fixture"}],
        }
        (root / "matrix.json").write_text(json.dumps(matrix), encoding="utf-8")
        return matrix

    browser_matrix = MagicMock(side_effect=fake_browser_matrix)
    monkeypatch.setattr(
        editor_release_probe,
        "build_browser_parity_matrix",
        browser_matrix,
    )

    result = editor_release_probe.run_editor_release_probe()

    assert result["scenario"] == scenario
    assert result["schemaVersion"] == 2
    assert result["renderSpecVersion"] == 4
    assert result["captionRenderSpecVersion"] == 4
    assert result["fontManifest"] == canonical_editor_font_manifest()
    assert result["runtimeIdentity"] == runtime_identity
    expected_checks = {
        "worker-image": True,
        "runtime-identity": True,
        "legacy-no-timeline": True,
        "captured-timeline": True,
        "editor-v2": True,
        "subtitle-layout": True,
        "caption-template-pop": True,
        "ffprobe": True,
        "frame-parity": True,
        "render-spec-v4": True,
        "caption-render-spec-v4": True,
        "worker-title-compositor-parity": True,
        "worker-caption-noop-parity": True,
        "font-manifest": True,
        "font-fallback": True,
    }
    if scenario == "baseline":
        expected_checks["browser-parity-worker-matrix"] = True
    assert result["checks"] == expected_checks
    assert result["media"]["width"] == 1080
    assert result["media"]["height"] == 1920
    assert result["geometry"]["maximumErrorPixels"] <= 2
    assert result["captionTemplate"]["templateId"] == "pop"
    assert result["captionTemplate"]["accentPixels"] >= 25
    assert result["capabilities"] == {"subtitleEditing": True}
    assert set(result["fonts"]) == {font_id.value for font_id in EditorFontId}
    assert result["artifactUri"].endswith("/manifest.json")
    runtime_verifier.assert_called_once_with({
        "initial_render_spec_version": 4,
        "initial_caption_render_spec_version": 4,
    })
    fallback_probe.assert_called_once()
    if scenario == "baseline":
        assert s3.upload_file.call_count == 0
        assert s3.put_object.call_count == 5
        browser_matrix.assert_called_once()
        assert result["browserParityMatrix"]["caseCount"] == 1
        assert result["probeIdentity"] == {
            "nonce": "c" * 32,
            "probeRunId": "7fd1c249-6cef-40f1-97d4-e4e6c837f60a",
            "batchJobId": "8fd1c249-6cef-40f1-97d4-e4e6c837f60b",
        }
        assert len(result["artifacts"]) == 4
        assert result["manifestVersionId"].startswith("version-")
        assert len(result["manifestSha256"]) == 64
    else:
        assert s3.upload_file.call_count == 2
        s3.put_object.assert_called_once()
        browser_matrix.assert_not_called()
        assert result["browserParityMatrix"] is None
