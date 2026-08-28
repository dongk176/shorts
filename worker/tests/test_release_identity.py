from __future__ import annotations

import pytest

from shorts_worker.errors import RenderError
from shorts_worker.font_manifest import canonical_editor_font_manifest
from shorts_worker.release_identity import (
    initial_render_v4_opt_in,
    verify_initial_render_v4_runtime,
)


def test_legacy_initial_render_skips_v4_runtime_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("EDITOR_RELEASE_GIT_SHA", raising=False)
    assert initial_render_v4_opt_in({}) is False
    assert verify_initial_render_v4_runtime(
        {
            "initial_render_spec_version": None,
            "initial_caption_render_spec_version": None,
        },
        embedded_source_sha_reader=lambda: (_ for _ in ()).throw(AssertionError()),
        running_image_digest_reader=lambda: (_ for _ in ()).throw(AssertionError()),
    ) is None


@pytest.mark.parametrize(
    ("render_version", "caption_version"),
    [(4, None), (None, 4), (3, 4), (4, 3), (True, 4)],
)
def test_partial_or_non_exact_v4_pair_fails_closed(
    render_version: object,
    caption_version: object,
) -> None:
    with pytest.raises(RenderError, match="4/4"):
        initial_render_v4_opt_in({
            "initial_render_spec_version": render_version,
            "initial_caption_render_spec_version": caption_version,
        })


def test_v4_runtime_matches_built_source_running_digest_and_font_manifest(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    git_sha = "a" * 40
    image_digest = f"sha256:{'b' * 64}"
    font_hash = str(canonical_editor_font_manifest()["sha256"])
    monkeypatch.setenv("EDITOR_RELEASE_GIT_SHA", git_sha)
    monkeypatch.setenv("WORKER_IMAGE_DIGEST", image_digest)
    monkeypatch.setenv("EDITOR_RENDER_SPEC_VERSION", "4")
    monkeypatch.setenv("EDITOR_CAPTION_RENDER_SPEC_VERSION", "4")
    monkeypatch.setenv("EDITOR_FONT_MANIFEST_SHA256", font_hash)

    identity = verify_initial_render_v4_runtime(
        {
            "initial_render_spec_version": 4,
            "initial_caption_render_spec_version": 4,
        },
        embedded_source_sha_reader=lambda: git_sha,
        running_image_digest_reader=lambda: image_digest,
    )

    assert identity == {
        "sourceGitSha": git_sha,
        "imageDigest": image_digest,
        "renderSpecVersion": "4",
        "captionRenderSpecVersion": "4",
        "fontManifestSha256": font_hash,
    }


def test_bound_v4_release_must_match_running_worker(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    git_sha = "a" * 40
    image_digest = f"sha256:{'b' * 64}"
    font_hash = str(canonical_editor_font_manifest()["sha256"])
    monkeypatch.setenv("EDITOR_RELEASE_GIT_SHA", git_sha)
    monkeypatch.setenv("WORKER_IMAGE_DIGEST", image_digest)
    monkeypatch.setenv("EDITOR_RENDER_SPEC_VERSION", "4")
    monkeypatch.setenv("EDITOR_CAPTION_RENDER_SPEC_VERSION", "4")
    monkeypatch.setenv("EDITOR_FONT_MANIFEST_SHA256", font_hash)

    job = {
        "initial_render_spec_version": 4,
        "initial_caption_render_spec_version": 4,
        "initial_editor_release_id": "f223e9e5-6aad-449f-8d2d-99202bfed190",
        "initial_editor_release_git_sha": git_sha,
        "initial_editor_release_worker_image_digest": image_digest,
        "initial_editor_release_font_manifest_sha256": font_hash,
        "initial_editor_release_render_spec_version": 4,
        "initial_editor_release_caption_render_spec_version": 4,
    }
    assert verify_initial_render_v4_runtime(
        job,
        embedded_source_sha_reader=lambda: git_sha,
        running_image_digest_reader=lambda: image_digest,
    ) is not None

    job["initial_editor_release_worker_image_digest"] = f"sha256:{'c' * 64}"
    with pytest.raises(RenderError, match="고정된 렌더 릴리스"):
        verify_initial_render_v4_runtime(
            job,
            embedded_source_sha_reader=lambda: git_sha,
            running_image_digest_reader=lambda: image_digest,
        )


@pytest.mark.parametrize("mismatch", ["source", "digest", "font"])
def test_v4_runtime_identity_mismatch_fails_closed(
    monkeypatch: pytest.MonkeyPatch,
    mismatch: str,
) -> None:
    git_sha = "a" * 40
    image_digest = f"sha256:{'b' * 64}"
    font_hash = str(canonical_editor_font_manifest()["sha256"])
    monkeypatch.setenv("EDITOR_RELEASE_GIT_SHA", git_sha)
    monkeypatch.setenv("WORKER_IMAGE_DIGEST", image_digest)
    monkeypatch.setenv("EDITOR_RENDER_SPEC_VERSION", "4")
    monkeypatch.setenv("EDITOR_CAPTION_RENDER_SPEC_VERSION", "4")
    monkeypatch.setenv(
        "EDITOR_FONT_MANIFEST_SHA256",
        "c" * 64 if mismatch == "font" else font_hash,
    )
    with pytest.raises(RenderError):
        verify_initial_render_v4_runtime(
            {
                "initial_render_spec_version": 4,
                "initial_caption_render_spec_version": 4,
            },
            embedded_source_sha_reader=(
                (lambda: "d" * 40) if mismatch == "source" else (lambda: git_sha)
            ),
            running_image_digest_reader=(
                (lambda: f"sha256:{'e' * 64}")
                if mismatch == "digest"
                else (lambda: image_digest)
            ),
        )
