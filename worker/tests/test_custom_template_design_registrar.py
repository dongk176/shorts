from __future__ import annotations

import hashlib
import io
from copy import deepcopy
from unittest.mock import MagicMock

import pytest
from test_batch_pipeline_lambdas import (
    _editor_release_v4_manifest,
    _load_lambda,
)


def evidence_manifest(module):
    manifest = _editor_release_v4_manifest(module)
    frames = [
        {"file": filename, "sha256": "a" * 64}
        for filename in (
            "front-initial.png", "front-rerender.png", "behind-initial.png",
            "behind-rerender.png", "deleted.png",
        )
    ]
    manifest["customTemplateDesign"] = {
        "version": 1, "passed": True,
        "sourceGitSha": manifest["gitSha"],
        "workerImageDigest": manifest["workerImageDigest"],
        "fontManifestSha256": manifest["fontManifestSha256"],
        "renderSpecVersion": 4, "captionRenderSpecVersion": 4,
        "wrapRevision": "editor-text-v1",
        "verification": {
            "caseCount": 3, "fontIds": sorted(module._REQUIRED_FONTS),
            "textOverlayCount": 20, "wrapRevision": "editor-text-v1",
            "maximumFrameMeanError": 1.2, "deletedTextPreserved": True,
            "backgroundSha256": "b" * 64, "frames": frames,
        },
    }
    manifest["artifacts"] = [{
        "relativeName": "custom-template-design/" + frame["file"],
        "sha256": frame["sha256"], "versionId": "immutable-version",
    } for frame in frames]
    return manifest


def verify(module, manifest):
    return module._verify_custom_template_design(
        manifest, git_sha=manifest["gitSha"], digest=manifest["workerImageDigest"],
        font_manifest_sha256=manifest["fontManifestSha256"],
    )


def test_design_evidence_is_optional_for_legacy_but_never_fabricated():
    module, _ = _load_lambda("editor_release_registrar")
    legacy = _editor_release_v4_manifest(module)
    assert verify(module, legacy) is None
    manifest = evidence_manifest(module)
    assert verify(module, manifest) == manifest["customTemplateDesign"]
    assert manifest["checks"]["render-spec-v4"] is True


@pytest.mark.parametrize("patch", [
    {"sourceGitSha": "f" * 40}, {"workerImageDigest": "sha256:" + "f" * 64},
    {"fontManifestSha256": "f" * 64}, {"renderSpecVersion": 3},
    {"captionRenderSpecVersion": 3}, {"wrapRevision": "other"}, {"passed": 1},
])
def test_design_evidence_rejects_identity_drift(patch):
    module, _ = _load_lambda("editor_release_registrar")
    manifest = evidence_manifest(module)
    manifest["customTemplateDesign"].update(patch)
    with pytest.raises(RuntimeError):
        verify(module, manifest)


@pytest.mark.parametrize("patch", [
    {"caseCount": 2}, {"caseCount": True}, {"textOverlayCount": 19},
    {"deletedTextPreserved": False}, {"fontIds": ["pretendard"]},
    {"maximumFrameMeanError": float("nan")},
    {"maximumFrameMeanError": float("inf")}, {"maximumFrameMeanError": 2.01},
    {"maximumFrameMeanError": -1}, {"maximumFrameMeanError": True},
    {"backgroundSha256": "invalid"}, {"frames": []},
])
def test_design_evidence_rejects_partial_synthetic_results(patch):
    module, _ = _load_lambda("editor_release_registrar")
    manifest = evidence_manifest(module)
    manifest["customTemplateDesign"]["verification"].update(patch)
    with pytest.raises(RuntimeError):
        verify(module, manifest)


@pytest.mark.parametrize("change", ["version", "checksum", "duplicate", "path"])
def test_design_evidence_requires_all_exact_versioned_frames(change):
    module, _ = _load_lambda("editor_release_registrar")
    manifest = evidence_manifest(module)
    if change == "version":
        manifest["artifacts"][0]["versionId"] = ""
    elif change == "checksum":
        manifest["artifacts"][0]["sha256"] = "f" * 64
    elif change == "duplicate":
        frames = manifest["customTemplateDesign"]["verification"]["frames"]
        frames[-1] = deepcopy(frames[0])
    else:
        manifest["customTemplateDesign"]["verification"]["frames"][0]["file"] = "../private.png"
    with pytest.raises(RuntimeError):
        verify(module, manifest)


def test_design_artifacts_are_read_by_exact_s3_version_and_hashed(monkeypatch):
    module, _ = _load_lambda("editor_release_registrar")
    manifest = evidence_manifest(module)
    payload = b"\x89PNG\r\n\x1a\nverified-frame"
    digest = hashlib.sha256(payload).hexdigest()
    for frame in manifest["customTemplateDesign"]["verification"]["frames"]:
        frame["sha256"] = digest
    for artifact in manifest["artifacts"]:
        artifact["sha256"] = digest
    evidence = verify(module, manifest)
    module.s3 = MagicMock()
    module.s3.get_object.side_effect = lambda **kwargs: {
        "Body": io.BytesIO(payload), "VersionId": kwargs["VersionId"],
    }
    uri = "s3://editor-test-bucket/editor-release-probes/exact/manifest.json"
    monkeypatch.setenv("EDITOR_TEST_BUCKET_NAME", "editor-test-bucket")
    module._verify_custom_template_design_artifacts(uri, manifest, evidence)
    assert module.s3.get_object.call_count == 5
    for call in module.s3.get_object.call_args_list:
        assert call.kwargs["VersionId"] == "immutable-version"
        assert call.kwargs["Key"].startswith("editor-release-probes/exact/custom-template-design/")
    module.s3.get_object.side_effect = lambda **_kwargs: {
        "Body": io.BytesIO(payload), "VersionId": "changed-version",
    }
    with pytest.raises(RuntimeError, match="artifact identity"):
        module._verify_custom_template_design_artifacts(uri, manifest, evidence)
