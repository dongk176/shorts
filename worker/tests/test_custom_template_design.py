from __future__ import annotations

import hashlib
import io
import json
import shutil
from contextlib import contextmanager
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from PIL import Image
from pydantic import ValidationError

from shorts_worker.background_assets import MAX_BACKGROUND_BYTES, download_owned_background
from shorts_worker.config import Settings
from shorts_worker.custom_template_design_probe import (
    PROBE_ASSET_ID,
    PROBE_TEMPLATE_ID,
    custom_template_design_evidence,
    design_probe_config,
    design_probe_document,
    verify_custom_template_design,
)
from shorts_worker.editor_text_layout import (
    composition_steps,
    normalize_composition_layer_order,
    wrap_editor_render_text,
)
from shorts_worker.errors import RenderError
from shorts_worker.render_spec_v4 import compile_initial_editor_render_spec_v4
from shorts_worker.repository import WorkerRepository
from shorts_worker.schemas import (
    CustomTemplateConfig,
    EditorCanvasBackground,
    EditorFontId,
    TemplateBackground,
)
from shorts_worker.worker_pipeline import BatchWorker

LAYOUT_FIXTURES = json.loads(
    (Path(__file__).parent / "fixtures" / "template-text-layout.json").read_text()
)


@pytest.mark.parametrize("fixture", LAYOUT_FIXTURES)
def test_template_wrap_matches_shared_web_fixtures(fixture: dict[str, object]) -> None:
    assert wrap_editor_render_text(fixture["value"], fixture["width"]) == fixture["lines"]


@pytest.mark.parametrize("font", list(EditorFontId))
def test_template_text_keeps_canonical_full_duration_spec_for_every_font(
    font: EditorFontId,
) -> None:
    config = design_probe_config()
    raw = config.text_overlays[0].model_copy(update={"font_id": font})
    config = config.model_copy(update={"text_overlays": [raw], "layer_order": None})
    spec = compile_initial_editor_render_spec_v4(
        title="확인", template_id="dark-minimal", video_aspect_ratio="16:9", font_scale=1,
        custom_template_config=config, custom_template_id=PROBE_TEMPLATE_ID, duration_seconds=9.5,
    )
    text = spec["textOverlays"][0]
    assert text["id"] == f"tpl:{PROBE_TEMPLATE_ID}:{raw.id}"
    assert text["font"]["fontId"] == font.value
    assert text["font"]["requestedWeight"] == 800
    assert text["lines"] == ["배경", " ", "Aa1"]
    assert (text["startFrame"], text["endFrame"]) == (0, 285)


def test_legacy_template_does_not_gain_optional_design_fields() -> None:
    value = design_probe_config().model_dump(by_alias=True)
    value.pop("textOverlays")
    value.pop("layerOrder")
    value["background"] = {"kind": "color", "color": "#111111"}
    for version in (3, 4):
        value["schemaVersion"] = version
        parsed = CustomTemplateConfig.model_validate(value)
        saved = parsed.model_dump(by_alias=True)
        assert "textOverlays" not in saved
        assert "layerOrder" not in saved
        assert saved["schemaVersion"] == version


@pytest.mark.parametrize("mutation", [
    "timing", "21-texts", "121-characters", "unknown-font", "unknown-color",
    "duplicate-text", "duplicate-order", "missing-order", "unknown-order", "null-text",
])
def test_template_design_rejects_invalid_shape(mutation: str) -> None:
    value = design_probe_config().model_dump(by_alias=True)
    if mutation == "timing":
        value["textOverlays"][0]["startSeconds"] = 0
    elif mutation == "21-texts":
        value["textOverlays"].append(deepcopy(value["textOverlays"][0]))
    elif mutation == "121-characters":
        value["textOverlays"][0]["text"] = "가" * 121
    elif mutation == "unknown-font":
        value["textOverlays"][0]["fontId"] = "unapproved"
    elif mutation == "unknown-color":
        value["textOverlays"][0]["color"] = "#010203"
    elif mutation == "duplicate-text":
        value["textOverlays"][1]["id"] = value["textOverlays"][0]["id"]
    elif mutation == "duplicate-order":
        value["layerOrder"][1] = value["layerOrder"][0]
    elif mutation == "missing-order":
        value["layerOrder"].pop()
    elif mutation == "unknown-order":
        value["layerOrder"][0] = "text:unknown"
    else:
        value["textOverlays"] = None
    with pytest.raises(ValidationError):
        CustomTemplateConfig.model_validate(value)


def test_uploaded_background_schema_does_not_accept_urls_or_keys() -> None:
    for model in (TemplateBackground, EditorCanvasBackground):
        parsed = model.model_validate({"kind": "uploaded_image", "assetId": PROBE_ASSET_ID})
        assert parsed.asset_id == PROBE_ASSET_ID
        for asset in ("https://example.com/a.webp", "../a", "custom-backgrounds/a.webp", "stock-1"):
            with pytest.raises(ValidationError):
                model.model_validate({"kind": "uploaded_image", "assetId": asset})
        with pytest.raises(ValidationError):
            model.model_validate({"kind": "uploaded_image", "assetId": PROBE_ASSET_ID,
                                  "color": "#111111"})


def test_template_design_compilation_fails_without_verified_runtime_context() -> None:
    with pytest.raises(RenderError, match="원본과 영상 길이"):
        compile_initial_editor_render_spec_v4(
            title="확인", template_id="dark-minimal", video_aspect_ratio="16:9", font_scale=1,
            custom_template_config=design_probe_config(),
        )


def test_initial_and_editor_share_title_channel_and_subtitle_plane_rules() -> None:
    normalized = normalize_composition_layer_order([
        "channel", "text:a", "title", "comment", "video", "text:b",
    ])
    assert normalized == ["text:a", "video", "title", "comment", "text:b", "channel"]
    assert list(composition_steps(normalized)) == [
        "text:a", "video", "title", "comment", None, "text:b", "channel", None,
    ]


def _background_payload(*, size=(1080, 1920), format="WEBP", animated=False) -> bytes:
    output = io.BytesIO()
    image = Image.new("RGB", size, "red")
    image.save(output, format, **({"save_all": True,
                                 "append_images": [Image.new("RGB", size, "blue")],
                                 "duration": 100, "loop": 0} if animated else {}))
    return output.getvalue()


def _background_environment(raw: bytes):
    owner = "00000000-0000-4000-8000-000000000003"
    record = {
        "id": PROBE_ASSET_ID, "user_id": owner,
        "object_key": f"custom-backgrounds/{owner}/{PROBE_ASSET_ID}.webp",
        "state": "ready", "byte_size": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
        "width": 1080, "height": 1920, "library_removed_at": "2026-08-01T00:00:00Z",
    }
    repository = MagicMock()
    repository.get_background_asset.return_value = record
    body = io.BytesIO(raw)
    storage = SimpleNamespace(client=MagicMock(), bucket="private-bucket")
    storage.client.get_object.return_value = {"Body": body, "ContentLength": len(raw)}
    return owner, record, repository, storage, body


def test_owner_ready_asset_remains_renderable_after_library_removal(tmp_path: Path) -> None:
    raw = _background_payload()
    owner, record, repository, storage, body = _background_environment(raw)
    path = download_owned_background(repository=repository, storage=storage, user_id=owner,
                                     asset_id=PROBE_ASSET_ID, work_dir=tmp_path)
    assert path.read_bytes() == raw
    assert path.is_relative_to(tmp_path.resolve())
    assert body.closed
    repository.get_background_asset.assert_called_once_with(owner, PROBE_ASSET_ID)
    storage.client.get_object.assert_called_once_with(Bucket="private-bucket",
                                                       Key=record["object_key"])


@pytest.mark.parametrize("field,value", [
    ("user_id", "00000000-0000-4000-8000-000000000009"),
    ("id", "00000000-0000-4000-8000-000000000009"),
    ("state", "deleting"), ("state", "pending"),
    ("object_key", "custom-backgrounds/../foreign.webp"),
    ("sha256", "invalid"), ("byte_size", MAX_BACKGROUND_BYTES + 1),
    ("byte_size", -1), ("width", 20000),
])
def test_invalid_background_metadata_never_requests_s3(
    tmp_path: Path, field: str, value: object,
) -> None:
    owner, record, repository, storage, _body = _background_environment(_background_payload())
    record[field] = value
    with pytest.raises(RenderError):
        download_owned_background(repository=repository, storage=storage, user_id=owner,
                                  asset_id=PROBE_ASSET_ID, work_dir=tmp_path)
    storage.client.get_object.assert_not_called()


@pytest.mark.parametrize("kind", ["corrupt", "png", "dimensions", "animated", "hash", "length"])
def test_invalid_stored_image_is_rejected_and_never_left_on_disk(tmp_path: Path, kind: str) -> None:
    raw = (b"not an image" if kind == "corrupt" else _background_payload(
        size=(10, 10) if kind == "dimensions" else (1080, 1920),
        format="PNG" if kind == "png" else "WEBP", animated=kind == "animated",
    ))
    owner, record, repository, storage, body = _background_environment(raw)
    if kind == "hash":
        record["sha256"] = "a" * 64
    if kind == "length":
        storage.client.get_object.return_value["ContentLength"] += 1
    with pytest.raises(RenderError):
        download_owned_background(repository=repository, storage=storage, user_id=owner,
                                  asset_id=PROBE_ASSET_ID, work_dir=tmp_path)
    assert body.closed
    assert not list(tmp_path.rglob("*.webp"))


def test_background_repository_requires_owner_and_ready_state() -> None:
    repository = WorkerRepository("postgresql://example", "ap-northeast-2")
    connection = MagicMock()

    @contextmanager
    def connect():
        yield connection

    repository.connect = connect
    repository.get_background_asset("owner", "asset")
    sql, parameters = connection.execute.call_args.args
    assert "id=%s and user_id=%s and state='ready'" in sql
    assert "library_removed_at" not in sql
    assert parameters == ("asset", "owner")


def test_saved_empty_editor_text_stays_empty_despite_template_snapshot() -> None:
    value = design_probe_document(design_probe_config()).model_dump(by_alias=True)
    for container in (value["overlays"], value["renderSpec"]):
        container["textOverlays"] = []
        container["layerOrder"] = ["video", "title", "comment", "channel"]
    from shorts_worker.schemas import EditorDocument
    document = EditorDocument.model_validate(value)
    assert document.overlays.text_overlays == []
    assert document.template.snapshot["config"]["textOverlays"]


def test_editor_background_override_wins_over_template_asset(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    resolver = MagicMock(return_value=tmp_path / "background.webp")
    monkeypatch.setattr("shorts_worker.worker_pipeline.download_owned_background", resolver)
    worker = BatchWorker.__new__(BatchWorker)
    worker.repository = MagicMock()
    worker.storage = MagicMock()
    document = design_probe_document(design_probe_config())
    item = {"user_id": "00000000-0000-4000-8000-000000000007"}
    worker._background_render_arguments(item, tmp_path, document)
    assert resolver.call_args.kwargs["asset_id"] == PROBE_ASSET_ID
    resolver.reset_mock()
    document.overlays.background = EditorCanvasBackground.model_validate({
        "kind": "color", "color": "#111111",
    })
    assert worker._background_render_arguments(item, tmp_path, document) == {}
    resolver.assert_not_called()


def _complete_probe_verification() -> dict[str, object]:
    return {
        "caseCount": 3, "textOverlayCount": 20, "wrapRevision": "editor-text-v1",
        "maximumFrameMeanError": 0.5, "deletedTextPreserved": True,
        "fontIds": [font.value for font in EditorFontId], "backgroundSha256": "a" * 64,
        "frames": [{"file": name, "sha256": "b" * 64} for name in (
            "front-initial.png", "front-rerender.png", "behind-initial.png",
            "behind-rerender.png", "deleted.png",
        )],
    }


def test_design_capability_evidence_requires_complete_successful_verification() -> None:
    arguments = {"source_git_sha": "a" * 40, "worker_image_digest": f"sha256:{'b' * 64}",
                 "font_manifest_sha256": "c" * 64}
    result = custom_template_design_evidence(
        **arguments, verification=_complete_probe_verification(),
    )
    assert result["passed"] is True
    for field in _complete_probe_verification():
        incomplete = _complete_probe_verification()
        incomplete.pop(field)
        with pytest.raises(RenderError):
            custom_template_design_evidence(**arguments, verification=incomplete)
    for key, value in (
        ("maximumFrameMeanError", 2.01), ("maximumFrameMeanError", float("nan")),
        ("deletedTextPreserved", False), ("fontIds", ["pretendard"] * 20),
        ("frames", []), ("caseCount", 2),
    ):
        incomplete = {**_complete_probe_verification(), key: value}
        with pytest.raises(RenderError):
            custom_template_design_evidence(**arguments, verification=incomplete)


@pytest.mark.render
@pytest.mark.skipif(not shutil.which("ffmpeg") or not shutil.which("ffprobe"),
                    reason="synthetic renderer verification requires FFmpeg/ffprobe")
def test_custom_background_template_text_initial_noop_order_and_deletion_parity(tmp_path: Path):
    result = verify_custom_template_design(
        root=tmp_path,
        settings=Settings(database_url=None, temp_dir=tmp_path, ffmpeg_timeout_seconds=180,
                          ffmpeg_threads=2),
    )
    assert result["caseCount"] == 3
    assert result["textOverlayCount"] == 20
    assert set(result["fontIds"]) == {font.value for font in EditorFontId}
    assert result["maximumFrameMeanError"] <= 2
    assert result["deletedTextPreserved"] is True
    assert len(result["frames"]) == 5
