from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from shorts_worker.schemas import EditorDocument

FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "test-fixtures"
    / "editor-document-v2.json"
)


def test_editor_document_accepts_shared_web_fixture() -> None:
    document = EditorDocument.model_validate_json(FIXTURE.read_text())

    assert document.version == 2
    assert document.video.output_duration_seconds == 3.5
    assert document.overlays.visible["video"] is True


def test_editor_document_rejects_layer_order_drift() -> None:
    value = json.loads(FIXTURE.read_text())
    value["overlays"]["layerOrder"].remove("channel")

    with pytest.raises(ValidationError, match="layer order"):
        EditorDocument.model_validate(value)


def test_editor_document_rejects_selection_clip_drift() -> None:
    value = json.loads(FIXTURE.read_text())
    value["video"]["selectionEndSeconds"] -= 1

    with pytest.raises(ValidationError, match="selection does not match clips"):
        EditorDocument.model_validate(value)


def test_editor_document_rejects_two_channel_thumbnail_sources() -> None:
    value = json.loads(FIXTURE.read_text())
    value["channel"]["thumbnailAssetKey"] = (
        "edit-sources/session/job/short/editor-assets/channel.webp"
    )

    with pytest.raises(ValidationError, match="thumbnail must use one source"):
        EditorDocument.model_validate(value)


def test_editor_document_rejects_duplicate_comment_ids() -> None:
    value = json.loads(FIXTURE.read_text())
    comment = {
        "id": "comment-1",
        "startSeconds": 0,
        "endSeconds": 1.5,
        "text": "댓글",
        "initial": "댓",
        "avatarColor": "#2563EB",
        "nickname": "댓글러",
        "likeCount": 30,
        "ageLabel": "1개월 전",
    }
    value["comments"] = [
        comment,
        {**comment, "startSeconds": 1.5, "endSeconds": 3.5},
    ]

    with pytest.raises(ValidationError, match="comment ids must be unique"):
        EditorDocument.model_validate(value)


def test_editor_document_rejects_overlay_past_output() -> None:
    value = json.loads(FIXTURE.read_text())
    value["comments"] = [{
        "id": "comment-1",
        "startSeconds": 0,
        "endSeconds": 4,
        "text": "댓글",
        "initial": "댓",
        "avatarColor": "#2563EB",
        "nickname": "댓글러",
        "likeCount": 30,
        "ageLabel": "1개월 전",
    }]

    with pytest.raises(ValidationError, match="comment exceeds editor output"):
        EditorDocument.model_validate(value)


def test_editor_document_rejects_horizontal_comment_offsets() -> None:
    value = json.loads(FIXTURE.read_text())
    value["overlays"]["offsets"]["comment"]["x"] = 1

    with pytest.raises(ValidationError, match="vertically constrained"):
        EditorDocument.model_validate(value)
