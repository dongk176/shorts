from __future__ import annotations

import hashlib
import json
import os
import re
import urllib.parse
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import boto3
from common import iso_now, log_event, patch, rest

batch = boto3.client("batch")

_NOMINAL_CLIP_SECONDS = {
    "sec_30": 30,
    "sec_31_60": 45,
    "sec_61_180": 90,
}
_EDITOR_RELEASE_JOB_DEFINITION = re.compile(
    r"^arn:aws:batch:[a-z0-9-]+:[0-9]{12}:job-definition/"
    r"shorts-mvp-editor-release-[a-z0-9-]+:[1-9][0-9]*$"
)
_BATCH_JOB_DEFINITION_ARN = re.compile(
    r"^arn:aws:batch:[a-z0-9-]+:[0-9]{12}:job-definition/[^:]+:[1-9][0-9]*$"
)
_BATCH_QUEUE_ARN = re.compile(
    r"^arn:aws:batch:[a-z0-9-]+:[0-9]{12}:job-queue/[^/]+$"
)
_SUBTITLE_TEMPLATE_IDS = {"basic", "highlight", "pop"}
_UNIFIED_TEMPLATE_SUBTITLE_ORIGIN = "unified-template-v5"
_PROJECT_TARGET_KEYS = {
    "legacy_project",
    "source_range",
    "elevenlabs_transcription",
    "subtitle_templates",
    "unified_template_subtitles",
}
_RESOURCE_TIER_BY_TARGET_KEY = {
    "legacy_project": "legacy",
    "source_range": "source_range",
    "elevenlabs_transcription": "elevenlabs_transcription",
    "subtitle_templates": "subtitle_templates",
    "unified_template_subtitles": "unified_template_subtitles",
}
_BRAND_COLOR_VALUES = {
    "#040404", "#000000", "#111111", "#1B1B1E", "#353438", "#64748B",
    "#FFFFFF", "#F3F0E9", "#E32626", "#FF4D4F", "#FF715E", "#FFB4A8",
    "#F97316", "#FFD84D", "#8BFF5A", "#16A34A", "#35E6E3", "#3B82F6",
    "#2563EB", "#A78BFA", "#DB2777",
}


class UnknownBatchTargetRelease(RuntimeError):
    """A logical project target points at a release outside current/previous."""


class BatchTargetTrustRejected(RuntimeError):
    """A project target does not match the job's immutable execution contract."""


class UnsubmittedBatchTargetCutoverBlocked(BatchTargetTrustRejected):
    """A pre-cutover claim has no provable AWS job and cannot be retargeted."""


def _production_project_target_registry() -> dict[str, Any] | None:
    raw = os.environ.get("PROJECT_TARGET_REGISTRY_JSON", "").strip()
    registry_path = os.environ.get("PROJECT_TARGET_REGISTRY_PATH", "").strip()
    if raw and registry_path:
        raise RuntimeError(
            "Production project target registry has multiple configured sources"
        )
    if registry_path:
        try:
            raw = Path(registry_path).read_text(encoding="utf-8")
        except OSError as exc:
            raise RuntimeError(
                "Production project target registry file is unavailable"
            ) from exc
        if len(raw.encode("utf-8")) > 64 * 1024:
            raise RuntimeError("Production project target registry file is too large")
    if not raw:
        if os.environ.get("PROJECT_TARGET_REGISTRY_REQUIRED") == "true":
            raise RuntimeError("Production project target registry is required")
        return None
    try:
        registry = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError("Production project target registry is invalid JSON") from exc
    if (
        not isinstance(registry, dict)
        or registry.get("version") != 1
        or registry.get("environment") != "production"
        or not isinstance(registry.get("lanes"), dict)
    ):
        raise RuntimeError("Production project target registry header is invalid")
    lanes = registry["lanes"]
    if set(lanes) != _PROJECT_TARGET_KEYS:
        raise RuntimeError("Production project target registry lanes are invalid")
    definitions: set[str] = set()
    queue_scheduling_modes: dict[str, str] = {}
    for target_key, lane in lanes.items():
        if not isinstance(lane, dict):
            raise RuntimeError(f"Project target lane {target_key} is invalid")
        if lane.get("schedulingMode") not in {"fair_share", "fifo"}:
            raise RuntimeError(
                f"Project target lane {target_key} scheduling mode is invalid"
            )
        releases: list[dict[str, Any]] = []
        current = lane.get("current")
        previous = lane.get("previous")
        if not isinstance(current, dict):
            raise RuntimeError(f"Project target lane {target_key} current is invalid")
        releases.append(current)
        if previous is not None:
            if not isinstance(previous, dict):
                raise RuntimeError(
                    f"Project target lane {target_key} previous is invalid"
                )
            releases.append(previous)
        release_ids: set[str] = set()
        for release in releases:
            release_id = str(release.get("releaseId") or "")
            definition = str(release.get("jobDefinitionArn") or "")
            queue = str(release.get("jobQueueArn") or "")
            if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{2,127}", release_id):
                raise RuntimeError(
                    f"Project target lane {target_key} release id is invalid"
                )
            if release_id in release_ids:
                raise RuntimeError(
                    f"Project target lane {target_key} release id is duplicated"
                )
            if not _BATCH_JOB_DEFINITION_ARN.fullmatch(definition):
                raise RuntimeError(
                    f"Project target lane {target_key} definition is invalid"
                )
            if not _BATCH_QUEUE_ARN.fullmatch(queue):
                raise RuntimeError(
                    f"Project target lane {target_key} queue is invalid"
                )
            existing_mode = queue_scheduling_modes.get(queue)
            if existing_mode and existing_mode != lane["schedulingMode"]:
                raise RuntimeError(
                    "Project target queue has conflicting scheduling modes"
                )
            queue_scheduling_modes[queue] = str(lane["schedulingMode"])
            if definition in definitions:
                raise RuntimeError("Project target definitions must be isolated")
            release_ids.add(release_id)
            definitions.add(definition)
        if previous is not None:
            submit_as = previous.get("submitAsReleaseId")
            if submit_as is not None and submit_as not in release_ids:
                raise RuntimeError(
                    f"Project target lane {target_key} submit-as release is invalid"
                )
    return registry


def _target_release(
    lane: dict[str, Any], release_id: str
) -> dict[str, Any] | None:
    for pointer in ("current", "previous"):
        release = lane.get(pointer)
        if isinstance(release, dict) and release.get("releaseId") == release_id:
            return release
    return None


def _expected_target_key(
    job: dict[str, Any],
    *,
    uses_admin_template_candidate: bool,
    uses_unified_template_candidate: bool,
    transcription_policy: str,
) -> str:
    if uses_unified_template_candidate:
        return "unified_template_subtitles"
    if uses_admin_template_candidate:
        return "subtitle_templates"
    if transcription_policy == "elevenlabs_primary_openai_fallback":
        return "elevenlabs_transcription"
    if bool(job.get("source_range_selection_enabled")):
        return "source_range"
    return "legacy_project"


def _registry_project_dispatch_target(
    registry: dict[str, Any],
    job: dict[str, Any],
    *,
    expected_target_key: str,
    estimated_seconds: int,
) -> tuple[str, str, str, int]:
    lanes = registry["lanes"]
    lane = lanes[expected_target_key]
    logical_key = str(job.get("batch_target_key") or "").strip()
    logical_release_id = str(job.get("batch_target_release_id") or "").strip()
    stored_definition = str(job.get("batch_job_definition") or "").strip()
    stored_queue = str(job.get("batch_job_queue") or "").strip()

    if logical_key or logical_release_id:
        if not logical_key or not logical_release_id:
            raise BatchTargetTrustRejected(
                "Logical project Batch target is incomplete"
            )
        if logical_key not in lanes:
            raise UnknownBatchTargetRelease("Project Batch target key is unknown")
        if logical_key != expected_target_key:
            raise BatchTargetTrustRejected(
                "Project Batch target does not match its execution contract"
            )
        release = _target_release(lane, logical_release_id)
        if not release:
            raise UnknownBatchTargetRelease(
                "Project Batch target release is outside current/previous"
            )
        submit_as_release_id = str(
            release.get("submitAsReleaseId") or logical_release_id
        )
        submit_release = _target_release(lane, submit_as_release_id)
        if not submit_release:
            raise UnknownBatchTargetRelease(
                "Project Batch target submit-as release is unknown"
            )
        return (
            str(submit_release["jobDefinitionArn"]),
            str(submit_release["jobQueueArn"]),
            _RESOURCE_TIER_BY_TARGET_KEY[expected_target_key],
            estimated_seconds,
        )

    # Rows created before logical routing remain immutable. They are trusted
    # only when their exact (definition, queue) pair is current or previous for
    # the semantic lane selected above. A previous pointer may submit as the
    # current hardened release, but no arbitrary ARN is accepted.
    if stored_definition or stored_queue:
        for pointer in ("current", "previous"):
            release = lane.get(pointer)
            if not isinstance(release, dict):
                continue
            if (
                stored_definition == release.get("jobDefinitionArn")
                and stored_queue == release.get("jobQueueArn")
            ):
                submit_as_release_id = str(
                    release.get("submitAsReleaseId")
                    or release.get("releaseId")
                )
                submit_release = _target_release(lane, submit_as_release_id)
                if not submit_release:
                    raise UnknownBatchTargetRelease(
                        "Legacy project Batch submit-as release is unknown"
                    )
                return (
                    str(submit_release["jobDefinitionArn"]),
                    str(submit_release["jobQueueArn"]),
                    _RESOURCE_TIER_BY_TARGET_KEY[expected_target_key],
                    estimated_seconds,
                )
        legacy_names = {
            os.environ.get("PROJECT_JOB_DEFINITION", "").strip(),
            os.environ.get("PROJECT_HEAVY_JOB_DEFINITION", "").strip(),
        }
        current = lane["current"]
        if (
            expected_target_key == "legacy_project"
            and not bool(job.get("source_range_selection_enabled"))
            and not stored_queue
            and stored_definition in legacy_names
        ):
            return (
                str(current["jobDefinitionArn"]),
                str(current["jobQueueArn"]),
                "legacy",
                estimated_seconds,
            )
        raise BatchTargetTrustRejected("Stored project Batch target is not trusted")

    # Very old ordinary rows did not pin the stable target. Preserve only that
    # established stable fallback; candidate lanes must always be explicit.
    if expected_target_key != "legacy_project":
        raise BatchTargetTrustRejected(
            "Candidate project is missing its immutable Batch target"
        )
    current = lane["current"]
    return (
        str(current["jobDefinitionArn"]),
        str(current["jobQueueArn"]),
        "legacy",
        estimated_seconds,
    )


def _estimated_output_seconds(job: dict[str, Any]) -> int:
    try:
        planned_count = max(1, int(job.get("planned_short_count") or 1))
    except (TypeError, ValueError):
        planned_count = 1
    nominal_seconds = _NOMINAL_CLIP_SECONDS.get(
        str(job.get("clip_length_option") or "sec_31_60"),
        _NOMINAL_CLIP_SECONDS["sec_31_60"],
    )
    return planned_count * nominal_seconds


def _trusted_project_target(prefix: str) -> tuple[str, str]:
    definition = os.environ[f"{prefix}_JOB_DEFINITION_ARN"].strip()
    queue = os.environ[f"{prefix}_BATCH_QUEUE_ARN"].strip()
    if not _BATCH_JOB_DEFINITION_ARN.fullmatch(definition):
        raise RuntimeError(f"{prefix} project job definition ARN is invalid")
    if not _BATCH_QUEUE_ARN.fullmatch(queue):
        raise RuntimeError(f"{prefix} project Batch queue ARN is invalid")
    return definition, queue


def _optional_trusted_project_target(prefix: str) -> tuple[str, str] | None:
    definition = os.environ.get(f"{prefix}_JOB_DEFINITION_ARN", "").strip()
    queue = os.environ.get(f"{prefix}_BATCH_QUEUE_ARN", "").strip()
    if not definition and not queue:
        return None
    if not _BATCH_JOB_DEFINITION_ARN.fullmatch(definition):
        raise RuntimeError(f"{prefix} project job definition ARN is invalid")
    if not _BATCH_QUEUE_ARN.fullmatch(queue):
        raise RuntimeError(f"{prefix} project Batch queue ARN is invalid")
    return definition, queue


def _optional_trusted_project_definition(name: str) -> str | None:
    definition = os.environ.get(name, "").strip()
    if not definition:
        return None
    if not _BATCH_JOB_DEFINITION_ARN.fullmatch(definition):
        raise RuntimeError(f"{name} is invalid")
    return definition


def _preset_brand_color(job: dict[str, Any]) -> str | None:
    snapshot = job.get("template_snapshot")
    if not isinstance(snapshot, dict):
        return None
    brand_color = snapshot.get("brandColor")
    if isinstance(brand_color, str) and brand_color in _BRAND_COLOR_VALUES:
        return brand_color
    return None


def _uses_unified_template_v5(job: dict[str, Any]) -> bool:
    template_snapshot = job.get("template_snapshot")
    if not isinstance(template_snapshot, dict):
        return False
    config = template_snapshot.get("config")
    if not isinstance(config, dict):
        return False
    schema_version = config.get("schemaVersion")
    if not isinstance(schema_version, int) or schema_version != 5:
        return False
    subtitle_snapshot = job.get("subtitle_template_snapshot")
    if not isinstance(subtitle_snapshot, dict):
        raise TypeError("Unified template subtitle snapshot is invalid")
    origin = subtitle_snapshot.get("origin")
    if origin != _UNIFIED_TEMPLATE_SUBTITLE_ORIGIN:
        raise RuntimeError("Unified template subtitle origin is invalid")
    return True


def _project_dispatch_target(
    job: dict[str, Any], *, resume: bool
) -> tuple[str, str, str, int]:
    estimated_seconds = _estimated_output_seconds(job)
    stored_definition = str(job.get("batch_job_definition") or "").strip()
    stored_queue = str(job.get("batch_job_queue") or "").strip()
    raw_subtitle_template_id = job.get("subtitle_template_id")
    subtitle_template_id = (
        str(raw_subtitle_template_id)
        if raw_subtitle_template_id is not None
        else None
    )
    if (
        subtitle_template_id is not None
        and subtitle_template_id not in _SUBTITLE_TEMPLATE_IDS
    ):
        raise RuntimeError("Project subtitle template is invalid")
    brand_color = _preset_brand_color(job)
    uses_admin_template_candidate = (
        subtitle_template_id is not None or brand_color is not None
    )
    uses_unified_template_candidate = _uses_unified_template_v5(job)
    transcription_policy = str(
        job.get("transcription_policy") or "openai_stable"
    )
    if transcription_policy not in {
        "openai_stable",
        "elevenlabs_primary_openai_fallback",
    }:
        raise RuntimeError("Project transcription policy is invalid")
    if (
        uses_admin_template_candidate
        and transcription_policy != "elevenlabs_primary_openai_fallback"
    ):
        raise RuntimeError(
            "Admin template candidate requires the word-timed transcription policy"
        )
    if (
        uses_unified_template_candidate
        and transcription_policy != "elevenlabs_primary_openai_fallback"
    ):
        raise RuntimeError(
            "Unified template candidate requires the word-timed transcription policy"
        )

    registry = _production_project_target_registry()
    if registry is not None:
        expected_target_key = _expected_target_key(
            job,
            uses_admin_template_candidate=uses_admin_template_candidate,
            uses_unified_template_candidate=uses_unified_template_candidate,
            transcription_policy=transcription_policy,
        )
        return _registry_project_dispatch_target(
            registry,
            job,
            expected_target_key=expected_target_key,
            estimated_seconds=estimated_seconds,
        )

    # The environment-based resolver remains only for local tests and
    # pre-registry deployments. Production reads its immutable target registry
    # from the bundled Lambda asset and therefore does not duplicate ARN state
    # across dozens of environment variables.
    legacy_definition, legacy_queue = _trusted_project_target("LEGACY_PROJECT")
    range_definition, range_queue = _trusted_project_target("SOURCE_RANGE")
    transcription_target = _optional_trusted_project_target(
        "ELEVENLABS_TRANSCRIPTION"
    )
    # A partially configured subtitle candidate must never stop an ordinary
    # legacy/source-range submission. Parse this optional target only after the
    # stored job itself proves it is a caption-template job.
    subtitle_target = (
        _optional_trusted_project_target("SUBTITLE_TEMPLATES")
        if uses_admin_template_candidate
        else None
    )
    unified_template_target = (
        _optional_trusted_project_target("UNIFIED_TEMPLATE_SUBTITLES")
        if uses_unified_template_candidate
        else None
    )
    previous_subtitle_target = None
    if uses_admin_template_candidate:
        previous_subtitle_definition = _optional_trusted_project_definition(
            "SUBTITLE_TEMPLATES_PREVIOUS_JOB_DEFINITION_ARN"
        )
        if previous_subtitle_definition:
            if not subtitle_target:
                raise RuntimeError(
                    "Previous subtitle Job Definition requires the primary target"
                )
            if previous_subtitle_definition == subtitle_target[0]:
                raise RuntimeError(
                    "Previous subtitle Job Definition must differ from the primary target"
                )
            previous_subtitle_target = (
                previous_subtitle_definition,
                subtitle_target[1],
            )
    previous_unified_template_target = None
    if uses_unified_template_candidate:
        previous_unified_template_definition = (
            _optional_trusted_project_definition(
                "UNIFIED_TEMPLATE_SUBTITLES_PREVIOUS_JOB_DEFINITION_ARN"
            )
        )
        if previous_unified_template_definition:
            if not unified_template_target:
                raise RuntimeError(
                    "Previous unified template Job Definition requires the primary target"
                )
            if (
                previous_unified_template_definition
                == unified_template_target[0]
            ):
                raise RuntimeError(
                    "Previous unified template Job Definition must differ from the primary target"
                )
            previous_unified_template_target = (
                previous_unified_template_definition,
                unified_template_target[1],
            )
    allowed_targets = {
        (legacy_definition, legacy_queue): "legacy",
        (range_definition, range_queue): "source_range",
    }
    allowed_definitions = {
        definition for definition, _queue in allowed_targets
    }
    for candidate_target, resource_tier in (
        (transcription_target, "elevenlabs_transcription"),
        (subtitle_target, "subtitle_templates"),
        (previous_subtitle_target, "subtitle_templates"),
        (unified_template_target, "unified_template_subtitles"),
        (previous_unified_template_target, "unified_template_subtitles"),
    ):
        if not candidate_target:
            continue
        if candidate_target[0] in allowed_definitions:
            raise RuntimeError(
                f"{resource_tier} Job Definition must be isolated from every other project target"
            )
        allowed_targets[candidate_target] = resource_tier
        allowed_definitions.add(candidate_target[0])

    if stored_definition or stored_queue:
        resource_tier = allowed_targets.get((stored_definition, stored_queue))
        if resource_tier:
            if (
                not uses_admin_template_candidate
                and resource_tier == "subtitle_templates"
            ):
                raise RuntimeError(
                    "Ordinary job cannot use the admin template candidate target"
                )
            expected_candidate_tier = None
            if uses_unified_template_candidate:
                expected_candidate_tier = "unified_template_subtitles"
            elif uses_admin_template_candidate:
                expected_candidate_tier = "subtitle_templates"
            elif transcription_policy == "elevenlabs_primary_openai_fallback":
                expected_candidate_tier = "elevenlabs_transcription"
            if expected_candidate_tier and resource_tier != expected_candidate_tier:
                raise RuntimeError(
                    "Candidate job is not pinned to its exact immutable Batch target"
                )
            if (
                transcription_policy == "openai_stable"
                and resource_tier in {
                    "elevenlabs_transcription",
                    "subtitle_templates",
                    "unified_template_subtitles",
                }
            ):
                raise RuntimeError(
                    "Stable transcription job cannot use an isolated candidate target"
                )
            resolved_definition = stored_definition
            resolved_queue = stored_queue
            if (
                previous_unified_template_target
                and unified_template_target
                and (stored_definition, stored_queue)
                == previous_unified_template_target
            ):
                # The previous pointer is a one-generation trust marker, not an
                # execution rollback. Older immutable definitions may lack the
                # current public-video ingestion controls, so validated v5 jobs
                # must run on the primary hardened unified target.
                resolved_definition, resolved_queue = unified_template_target
            return (
                resolved_definition,
                resolved_queue,
                resource_tier,
                estimated_seconds,
            )
        legacy_names = {
            os.environ.get("PROJECT_JOB_DEFINITION", "").strip(),
            os.environ.get("PROJECT_HEAVY_JOB_DEFINITION", "").strip(),
        }
        if (
            not bool(job.get("source_range_selection_enabled"))
            and not stored_queue
            and stored_definition in legacy_names
        ):
            return legacy_definition, legacy_queue, "legacy", estimated_seconds
        raise RuntimeError("Stored project Batch target is not trusted")

    if uses_unified_template_candidate:
        raise RuntimeError(
            "Unified template candidate is missing its pinned Batch target"
        )
    if uses_admin_template_candidate:
        raise RuntimeError(
            "Admin template candidate is missing its pinned Batch target"
        )
    if transcription_policy == "elevenlabs_primary_openai_fallback":
        raise RuntimeError(
            "ElevenLabs transcription job is missing its pinned Batch target"
        )
    if bool(job.get("source_range_selection_enabled")):
        raise RuntimeError("Source-range job is missing its pinned Batch target")
    return legacy_definition, legacy_queue, "legacy", estimated_seconds


def _share_identifier(*values: object) -> str:
    identity = next((str(value) for value in values if value), "anonymous")
    digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:40]
    return f"user{digest}"


def _priority_class(value: object) -> str:
    return "paid" if str(value or "").casefold() == "paid" else "free"


def _priority_share_identifier(priority_class: object, *values: object) -> str:
    return f"{_priority_class(priority_class)}{_share_identifier(*values)}"


def _scheduling_priority(priority_class: object) -> int:
    return 1000 if _priority_class(priority_class) == "paid" else 0


def _project_scheduling_overrides(
    job_queue: str,
    resource_tier: str,
    priority_class: object,
    *identity_values: object,
) -> dict[str, object]:
    # Scheduling mode belongs to the logical lane. Queue rotations therefore
    # cannot accidentally attach fair-share-only fields to a FIFO queue.
    registry = _production_project_target_registry()
    if registry is not None:
        target_key = next(
            (
                key
                for key, tier in _RESOURCE_TIER_BY_TARGET_KEY.items()
                if tier == resource_tier
            ),
            None,
        )
        if target_key:
            lane = registry["lanes"][target_key]
            valid_queues = {
                str(release["jobQueueArn"])
                for pointer in ("current", "previous")
                if isinstance((release := lane.get(pointer)), dict)
            }
            if job_queue in valid_queues:
                return {} if lane["schedulingMode"] == "fifo" else {
                    "shareIdentifier": _priority_share_identifier(
                        priority_class,
                        *identity_values,
                    ),
                    "schedulingPriorityOverride": _scheduling_priority(
                        priority_class
                    ),
                }
    configured_unified_queue = os.environ.get(
        "UNIFIED_TEMPLATE_SUBTITLES_BATCH_QUEUE_ARN", ""
    ).strip()
    if (
        resource_tier == "unified_template_subtitles"
        and _BATCH_QUEUE_ARN.fullmatch(configured_unified_queue)
        and job_queue == configured_unified_queue
    ):
        return {}
    return {
        "shareIdentifier": _priority_share_identifier(
            priority_class,
            *identity_values,
        ),
        "schedulingPriorityOverride": _scheduling_priority(priority_class),
    }


def _rerender_scheduling_overrides(
    job_queue: str,
    priority_class: object,
    *identity_values: object,
) -> dict[str, object]:
    # The isolated editor canary queue intentionally uses simple FIFO
    # scheduling. AWS Batch rejects fair-share-only fields on that queue.
    if job_queue == os.environ.get("EDITOR_CANARY_BATCH_QUEUE", "").strip():
        return {}
    return {
        "shareIdentifier": _priority_share_identifier(
            priority_class,
            *identity_values,
        ),
        "schedulingPriorityOverride": _scheduling_priority(priority_class),
    }


def _render_container_overrides(command: list[str]) -> dict[str, object]:
    return {
        "command": command,
        "environment": [{"name": "RENDER_SUBMITTED_AT", "value": iso_now()}],
    }


def _editor_release_target(
    pending_request_id: str | None,
) -> tuple[str, str, str, str] | None:
    if not pending_request_id:
        return None
    encoded_request_id = urllib.parse.quote(pending_request_id, safe="")
    requests = rest("editor_render_requests", query=(
        "select=release_id,release_channel"
        f"&id=eq.{encoded_request_id}&limit=1"
    )) or []
    if not requests or not requests[0].get("release_id"):
        # Requests queued before release routing was installed retain the
        # known-good legacy definition instead of being moved implicitly.
        return None
    release_id = str(requests[0]["release_id"])
    channel = str(requests[0].get("release_channel") or "")
    if channel not in {"stable", "canary"}:
        raise RuntimeError("Editor render request has an invalid release channel")
    encoded_release_id = urllib.parse.quote(release_id, safe="")
    releases = rest("editor_releases", query=(
        "select=id,worker_image_digest,production_job_definition_arn"
        f"&id=eq.{encoded_release_id}&limit=1"
    )) or []
    if not releases:
        raise RuntimeError("Editor release does not exist")
    job_definition = str(
        releases[0].get("production_job_definition_arn") or ""
    )
    if not _EDITOR_RELEASE_JOB_DEFINITION.fullmatch(job_definition):
        raise RuntimeError("Editor release job definition is not trusted")
    worker_image_digest = str(releases[0].get("worker_image_digest") or "")
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", worker_image_digest):
        raise RuntimeError("Editor release image digest is invalid")
    if channel == "canary":
        job_queue = os.environ.get("EDITOR_CANARY_BATCH_QUEUE", "").strip()
        if not job_queue:
            raise RuntimeError("Editor canary queue is not configured")
    else:
        job_queue = (
            os.environ.get("EDITOR_STABLE_BATCH_QUEUE")
            or os.environ["PROJECT_BATCH_QUEUE"]
        )
    return job_queue, job_definition, worker_image_digest, release_id


def _existing_batch_job(job_queue: str, job_name: str) -> str | None:
    response = batch.list_jobs(
        jobQueue=job_queue,
        filters=[{"name": "JOB_NAME", "values": [job_name]}],
        maxResults=10,
    )
    for item in response.get("jobSummaryList", []):
        if str(item.get("jobName", "")).casefold() == job_name.casefold():
            return str(item["jobId"])
    return None


def _batch_job_has_target(
    batch_job_id: str,
    job_definition: str,
    job_queue: str,
) -> bool:
    described = batch.describe_jobs(jobs=[batch_job_id]).get("jobs", [])
    if len(described) != 1:
        return False
    return (
        str(described[0].get("jobDefinition") or "") == job_definition
        and str(described[0].get("jobQueue") or "") == job_queue
    )


def _complete_batch_submission_target(
    submission_key: str,
    batch_job_id: str,
    job_definition: str,
    job_queue: str,
    project_binding: dict[str, Any] | None = None,
) -> None:
    rpc = "rpc/complete_batch_submission_target"
    body: dict[str, Any] = {
        "p_submission_key": submission_key,
        "p_aws_batch_job_id": batch_job_id,
        "p_job_definition": job_definition,
        "p_job_queue": job_queue,
    }
    if project_binding is not None:
        rpc = "rpc/complete_project_batch_submission_target"
        body.update(project_binding)
    completed = rest(
        rpc,
        method="POST",
        body=body,
        prefer="return=representation",
    )
    if completed is not True and completed != [True]:
        raise RuntimeError("Batch submission target completion was rejected")


def _submit_once(
    request: dict[str, Any],
    submission_key: str,
    *,
    project_binding: dict[str, Any] | None = None,
) -> str:
    job_definition = str(request.get("jobDefinition") or "").strip()
    job_queue = str(request.get("jobQueue") or "").strip()
    if not _BATCH_JOB_DEFINITION_ARN.fullmatch(job_definition):
        raise BatchTargetTrustRejected(
            "Batch submission Job Definition must be a revision-pinned ARN"
        )
    if not _BATCH_QUEUE_ARN.fullmatch(job_queue):
        raise BatchTargetTrustRejected(
            "Batch submission queue must be an exact ARN"
        )
    claims = rest(
        "rpc/claim_batch_submission_target",
        method="POST",
        body={
            "p_submission_key": submission_key,
            "p_job_name": str(request["jobName"]),
            "p_job_definition": job_definition,
            "p_job_queue": job_queue,
        },
        prefer="return=representation",
    ) or []
    if not claims:
        raise RuntimeError("Batch submission claim returned no result")
    action = str(claims[0].get("action") or "")
    claimed_definition = str(claims[0].get("job_definition") or "").strip()
    claimed_queue = str(claims[0].get("job_queue") or "").strip()
    if action == "invalid_target":
        raise BatchTargetTrustRejected(
            "Batch submission claim target does not match the resolved target"
        )
    if action == "target_mismatch":
        claimed_batch_job_id = str(
            claims[0].get("aws_batch_job_id") or ""
        ).strip()
        if (
            project_binding is not None
            and not claimed_batch_job_id
            and claimed_definition
            and claimed_queue
        ):
            # A target-aware invocation may have claimed the old current target
            # immediately before a registry cutover. Never execute that previous
            # target merely to make the mismatch disappear: it may have been
            # remapped for a security hardening reason (for example Proof of
            # Origin). If AWS already accepted the old request, however, adopting
            # that exact existing job is safer than submitting a duplicate. A
            # claim with no discoverable AWS job remains fail-closed until the
            # deployment admission fence drains it.
            existing = _existing_batch_job(
                claimed_queue, str(request["jobName"])
            )
            if existing:
                if not _batch_job_has_target(
                    existing, claimed_definition, claimed_queue
                ):
                    raise BatchTargetTrustRejected(
                        "Pre-cutover Batch job name is bound to another target"
                    )
                _complete_batch_submission_target(
                    submission_key,
                    existing,
                    claimed_definition,
                    claimed_queue,
                    project_binding,
                )
                return existing
            raise UnsubmittedBatchTargetCutoverBlocked(
                "Pre-cutover Batch claim has no provable AWS job and cannot be retargeted"
            )
        raise BatchTargetTrustRejected(
            "Batch submission claim target does not match the resolved target"
        )
    if action == "existing":
        batch_job_id = str(claims[0].get("aws_batch_job_id") or "").strip()
        if not batch_job_id:
            raise RuntimeError("Existing Batch submission claim has no job id")
        if claimed_definition or claimed_queue:
            if (
                claimed_definition != job_definition
                or claimed_queue != job_queue
            ):
                raise BatchTargetTrustRejected(
                    "Existing Batch submission claim target changed"
                )
        else:
            if not _batch_job_has_target(
                batch_job_id, job_definition, job_queue
            ):
                raise BatchTargetTrustRejected(
                    "Legacy Batch submission claim target cannot be proven"
                )
        if project_binding is not None or not (
            claimed_definition or claimed_queue
        ):
            _complete_batch_submission_target(
                submission_key,
                batch_job_id,
                job_definition,
                job_queue,
                project_binding,
            )
        return batch_job_id
    if action != "claimed":
        raise RuntimeError("Batch submission is already in progress")
    if claimed_definition != job_definition or claimed_queue != job_queue:
        raise BatchTargetTrustRejected(
            "Claimed Batch submission target changed"
        )
    existing = _existing_batch_job(job_queue, str(request["jobName"]))
    if existing and not _batch_job_has_target(existing, job_definition, job_queue):
        raise BatchTargetTrustRejected(
            "Existing Batch job name is bound to another target"
        )
    batch_job_id = existing or str(batch.submit_job(**request)["jobId"])
    _complete_batch_submission_target(
        submission_key,
        batch_job_id,
        job_definition,
        job_queue,
        project_binding,
    )
    return batch_job_id


def _submit(payload: dict[str, Any]) -> str | None:
    kind = payload.get("kind")
    if kind in {"project", "project_resume"}:
        job_id = str(payload["jobId"])
        resume = kind == "project_resume"
        encoded_job_id = urllib.parse.quote(job_id, safe="")
        jobs = rest("video_jobs", query=(
            "select=id,status,pipeline_version,project_resume_count,aws_batch_job_id,"
            "mvp_session_id,user_id,preparation_finished_at,planned_short_count,"
            "clip_length_option,batch_job_definition,batch_job_queue,"
            "batch_target_key,batch_target_release_id,"
            "source_range_selection_enabled,transcription_policy,subtitle_template_id,"
            "template_snapshot,subtitle_template_snapshot,"
            "dispatch_priority_class"
            f"&id=eq.{encoded_job_id}&limit=1"
        )) or []
        if not jobs or int(jobs[0].get("pipeline_version") or 1) != 2:
            return None
        job = jobs[0]
        resume_count = int(job.get("project_resume_count") or 0)
        recorded_batch_job_id = str(
            job.get("aws_batch_job_id") or ""
        ).strip()
        # The attempt identity is immutable even if an EventBridge state event
        # advances the project status before the submitter finishes binding the
        # idempotency claim and raw target.  A recorded Batch id therefore
        # re-enters the exact same submission path for reconciliation instead
        # of taking the historical id-only fast path.
        if resume:
            if resume_count != 1 or not job.get("preparation_finished_at"):
                return None
        elif resume_count != 0:
            return None
        expected_status = "rendering" if resume else "queued"
        if not recorded_batch_job_id and job["status"] != expected_status:
            return None
        suffix = "resume-1" if resume else "0"
        command = ["python", "-m", "shorts_worker", "project", "--job-id", job_id]
        if resume:
            command.append("--resume")
        job_definition, job_queue, resource_tier, estimated_seconds = _project_dispatch_target(
            job,
            resume=resume,
        )
        priority_class = _priority_class(
            job.get("dispatch_priority_class") or payload.get("priorityClass")
        )
        log_event(
            "project_resource_tier_selected",
            job_id=job_id,
            resource_tier=resource_tier,
            estimated_output_seconds=estimated_seconds,
            job_definition=job_definition,
            job_queue=job_queue,
            resume=resume,
            priority_class=priority_class,
        )
        request = dict(
            jobName=f"shorts-project-{job_id}-{suffix}",
            jobQueue=job_queue,
            jobDefinition=job_definition,
            **_project_scheduling_overrides(
                job_queue,
                resource_tier,
                priority_class,
                job.get("user_id"), job.get("mvp_session_id"), job_id
            ),
            containerOverrides=_render_container_overrides(command),
            retryStrategy={"attempts": 1},
            timeout={
                "attemptDurationSeconds": (
                    18000
                    if resource_tier in {
                        "source_range",
                        "elevenlabs_transcription",
                        "subtitle_templates",
                        "unified_template_subtitles",
                    }
                    else 7200
                )
            },
        )
        submission_key = f"project:{job_id}:resume:1" if resume else f"project:{job_id}:0"
        project_batch_id = _submit_once(
            request,
            submission_key,
            project_binding={
                "p_video_job_id": job_id,
                "p_expected_batch_target_key": job.get("batch_target_key"),
                "p_expected_batch_target_release_id": job.get(
                    "batch_target_release_id"
                ),
                "p_observed_job_definition": job.get(
                    "batch_job_definition"
                ),
                "p_observed_job_queue": job.get("batch_job_queue"),
            },
        )
        if (
            recorded_batch_job_id
            and project_batch_id != recorded_batch_job_id
        ):
            raise BatchTargetTrustRejected(
                "Recorded project Batch id changed during reconciliation"
            )
        return project_batch_id
    if kind == "prepare_batch":
        dispatch_id = str(payload["dispatchBatchId"])
        count = max(1, min(10000, int(payload["itemCount"])))
        queue_name = os.environ["PREPARE_BATCH_QUEUE"]
        request: dict[str, Any] = {
            "jobName": f"shorts-prepare-{dispatch_id}",
            "jobQueue": queue_name,
            "jobDefinition": os.environ["PREPARE_JOB_DEFINITION"],
            "containerOverrides": {"command": [
                "python", "-m", "shorts_worker", "prepare-array",
                "--dispatch-batch-id", dispatch_id,
            ]},
            "retryStrategy": {"attempts": 1},
            "timeout": {"attemptDurationSeconds": 3600},
        }
        existing_batches = rest(
            "dispatch_batches",
            query=(
                "select=status,aws_batch_job_id"
                f"&id=eq.{urllib.parse.quote(dispatch_id, safe='')}&limit=1"
            ),
        ) or []
        if not existing_batches:
            return None
        recorded_id = existing_batches[0].get("aws_batch_job_id")
        if recorded_id:
            return str(recorded_id)
        if count > 1:
            request["arrayProperties"] = {"size": count}
        batch_id = _submit_once(request, f"prepare:{dispatch_id}")
        patch("dispatch_batches", f"id=eq.{dispatch_id}", {
            "status": "submitted", "aws_batch_job_id": batch_id,
            "submitted_at": iso_now(),
        })
        patch("video_jobs", f"dispatch_batch_id=eq.{dispatch_id}", {
            "aws_batch_job_id": batch_id,
        })
        return batch_id
    if kind == "prepare_retry":
        job_id = str(payload["jobId"])
        encoded = urllib.parse.quote(job_id, safe="")
        failed_batch_id = payload.get("failedBatchJobId")
        rows = rest("video_jobs", query=(
            "select=id,attempt_count,status,aws_batch_job_id"
            f"&id=eq.{encoded}&limit=1"
        )) or []
        if not rows:
            return None
        job = rows[0]
        if failed_batch_id and job.get("aws_batch_job_id") != failed_batch_id:
            return None
        if job["status"] != "retry_waiting" or int(job["attempt_count"]) >= 10:
            return None
        rest(
            "rpc/enqueue_prepare_retry",
            method="POST",
            body={"p_job_id": job_id},
            prefer="return=representation",
        )
        return None
    if kind == "render":
        job_id = str(payload["jobId"])
        count = max(1, int(payload["shardCount"]))
        encoded_job_id = urllib.parse.quote(job_id, safe="")
        pending = rest("generated_shorts", query=(
            "select=id,render_batch_job_id"
            f"&job_id=eq.{encoded_job_id}&status=eq.rendering&limit=100"
        )) or []
        if not pending:
            return None
        recorded_ids = {
            str(item["render_batch_job_id"])
            for item in pending if item.get("render_batch_job_id")
        }
        if recorded_ids:
            return sorted(recorded_ids)[0]
        jobs = rest("video_jobs", query=(
            "select=id,status,deadline_at,mvp_session_id,user_id,"
            "dispatch_priority_class"
            f"&id=eq.{encoded_job_id}&limit=1"
        )) or []
        if not jobs or jobs[0]["status"] != "rendering":
            return None
        deadline = datetime.fromisoformat(jobs[0]["deadline_at"].replace("Z", "+00:00"))
        if deadline <= datetime.now(UTC):
            return None
        priority_class = _priority_class(jobs[0].get("dispatch_priority_class"))
        request = {
            "jobName": f"shorts-render-{job_id}",
            "jobQueue": os.environ["RENDER_BATCH_QUEUE"],
            "jobDefinition": os.environ["RENDER_JOB_DEFINITION"],
            "shareIdentifier": _priority_share_identifier(
                priority_class,
                jobs[0].get("user_id"), jobs[0].get("mvp_session_id"), job_id
            ),
            "schedulingPriorityOverride": _scheduling_priority(priority_class),
            "parameters": {"renderRetryCount": "0"},
            "containerOverrides": _render_container_overrides([
                "python", "-m", "shorts_worker", "render-shard", "--job-id", job_id,
            ]),
            "retryStrategy": {"attempts": 1},
            "timeout": {"attemptDurationSeconds": 1200},
        }
        if count > 1:
            request["arrayProperties"] = {"size": count}
        render_batch_id = _submit_once(request, f"render:{job_id}")
        patch(
            "generated_shorts",
            f"job_id=eq.{encoded_job_id}&status=eq.rendering",
            {"render_batch_job_id": render_batch_id},
        )
        return render_batch_id
    if kind == "render_retry":
        job_id = str(payload["jobId"])
        shard_index = max(0, int(payload["shardIndex"]))
        failed_batch_id = str(payload["failedBatchJobId"])
        retry_count = max(1, int(payload.get("retryCount") or 1))
        encoded_job_id = urllib.parse.quote(job_id, safe="")
        encoded_failed_batch_id = urllib.parse.quote(failed_batch_id, safe="")
        pending = rest("generated_shorts", query=(
            "select=id"
            f"&job_id=eq.{encoded_job_id}&render_shard_index=eq.{shard_index}"
            f"&render_batch_job_id=eq.{encoded_failed_batch_id}"
            "&status=eq.rendering&limit=1"
        )) or []
        jobs = rest("video_jobs", query=(
            "select=id,status,deadline_at,mvp_session_id,user_id,"
            "dispatch_priority_class"
            f"&id=eq.{encoded_job_id}&limit=1"
        )) or []
        if not pending or not jobs or jobs[0]["status"] != "rendering":
            return None
        deadline = datetime.fromisoformat(jobs[0]["deadline_at"].replace("Z", "+00:00"))
        if deadline <= datetime.now(UTC):
            return None
        retry_name = (
            f"shorts-render-retry-{job_id}-{shard_index}-{retry_count}"
        )
        priority_class = _priority_class(jobs[0].get("dispatch_priority_class"))
        request = dict(
            jobName=retry_name,
            jobQueue=os.environ["RENDER_BATCH_QUEUE"],
            jobDefinition=os.environ["RENDER_JOB_DEFINITION"],
            shareIdentifier=_priority_share_identifier(
                priority_class,
                jobs[0].get("user_id"), jobs[0].get("mvp_session_id"), job_id
            ),
            schedulingPriorityOverride=_scheduling_priority(priority_class),
            parameters={"renderRetryCount": str(retry_count)},
            containerOverrides=_render_container_overrides([
                "python", "-m", "shorts_worker", "render-shard", "--job-id", job_id,
                "--shard-index", str(shard_index),
            ]),
            retryStrategy={"attempts": 1},
            timeout={"attemptDurationSeconds": 1200},
        )
        render_retry_id = _submit_once(
            request, f"render-retry:{job_id}:{shard_index}:{failed_batch_id}"
        )
        patch(
            "generated_shorts",
            (
                f"job_id=eq.{encoded_job_id}&render_shard_index=eq.{shard_index}"
                f"&render_batch_job_id=eq.{encoded_failed_batch_id}&status=eq.rendering"
            ),
            {"render_batch_job_id": render_retry_id},
        )
        return render_retry_id
    if kind == "rerender":
        short_id = str(payload["shortId"])
        rerender_attempt = max(0, min(1, int(payload.get("attempt") or 0)))
        encoded_short_id = urllib.parse.quote(short_id, safe="")
        shorts = rest("generated_shorts", query=(
            "select=id,status,render_version,rerender_batch_job_id,"
            "pending_edit_request_id,pending_render_hash,updated_at,"
            "mvp_session_id,job_id"
            f"&id=eq.{encoded_short_id}&status=eq.rerendering&limit=1"
        )) or []
        if not shorts:
            return None
        if shorts[0].get("rerender_batch_job_id"):
            return str(shorts[0]["rerender_batch_job_id"])
        parent_jobs = rest("video_jobs", query=(
            "select=id,user_id,mvp_session_id,dispatch_priority_class"
            f"&id=eq.{urllib.parse.quote(str(shorts[0]['job_id']), safe='')}&limit=1"
        )) or []
        parent_job = parent_jobs[0] if parent_jobs else {}
        priority_class = _priority_class(
            parent_job.get("dispatch_priority_class")
        )
        version = int(shorts[0]["render_version"]) + 1
        pending_request_id = shorts[0].get("pending_edit_request_id")
        release_target = _editor_release_target(
            str(pending_request_id) if pending_request_id else None
        )
        legacy_save_identity = None
        if not pending_request_id:
            identity_source = ":".join((
                str(shorts[0].get("pending_render_hash") or ""),
                str(shorts[0].get("updated_at") or ""),
            ))
            if identity_source != ":":
                legacy_save_identity = hashlib.sha256(
                    identity_source.encode("utf-8")
                ).hexdigest()[:12]
        request_suffix = (
            f"-r{str(pending_request_id).replace('-', '')[:12]}"
            if pending_request_id
            else f"-l{legacy_save_identity}" if legacy_save_identity else ""
        )
        rerender_queue = (
            release_target[0]
            if release_target
            else os.environ["PROJECT_BATCH_QUEUE"]
        )
        rerender_definition = (
            release_target[1]
            if release_target
            else os.environ["RERENDER_JOB_DEFINITION"]
        )
        request = dict(
            jobName=(
                f"shorts-rerender-{short_id}-v{version}-a{rerender_attempt}"
                f"{request_suffix}"
            ),
            jobQueue=rerender_queue,
            jobDefinition=rerender_definition,
            **_rerender_scheduling_overrides(
                rerender_queue,
                priority_class,
                parent_job.get("user_id"),
                parent_job.get("mvp_session_id"),
                shorts[0].get("mvp_session_id"),
                short_id,
            ),
            containerOverrides=_render_container_overrides([
                "python", "-m", "shorts_worker", "rerender", "--short-id", short_id,
            ]),
            parameters={"rerenderAttempt": str(rerender_attempt)},
            retryStrategy={"attempts": 1},
            timeout={"attemptDurationSeconds": 1200},
        )
        submission_key = f"rerender:{short_id}:{version}:{rerender_attempt}"
        if pending_request_id:
            submission_key = f"{submission_key}:{pending_request_id}"
            if release_target:
                submission_key = f"{submission_key}:release:{release_target[3]}"
        elif legacy_save_identity:
            submission_key = f"{submission_key}:legacy:{legacy_save_identity}"
        rerender_batch_id = _submit_once(
            request,
            submission_key,
        )
        patch_filter = f"id=eq.{encoded_short_id}&status=eq.rerendering"
        if pending_request_id:
            patch_filter += (
                "&pending_edit_request_id=eq."
                f"{urllib.parse.quote(str(pending_request_id), safe='')}"
            )
        patch(
            "generated_shorts",
            patch_filter,
            {"rerender_batch_job_id": rerender_batch_id},
        )
        if pending_request_id and release_target:
            patch(
                "editor_render_requests",
                (
                    f"id=eq.{urllib.parse.quote(str(pending_request_id), safe='')}"
                    f"&short_id=eq.{encoded_short_id}"
                    "&status=in.(queued,rendering)"
                ),
                {
                    "status": "rendering",
                    "worker_image_digest": release_target[2],
                    "batch_job_id": rerender_batch_id,
                    "updated_at": iso_now(),
                },
            )
        return rerender_batch_id
    raise ValueError(f"Unsupported work kind: {kind}")


def _aws_error_code(exc: Exception) -> str:
    response = getattr(exc, "response", None)
    if isinstance(response, dict):
        error = response.get("Error")
        if isinstance(error, dict) and error.get("Code"):
            return str(error["Code"])[:100]
    return type(exc).__name__


def _log_project_target_failure(
    exc: Exception,
    payload: dict[str, Any],
    *,
    invocation: str,
) -> None:
    if isinstance(exc, UnknownBatchTargetRelease):
        event_name = "project_target_release_unknown"
    elif isinstance(exc, BatchTargetTrustRejected):
        event_name = "project_target_trust_rejected"
    else:
        return
    log_event(
        event_name,
        kind=payload.get("kind"),
        job_id=payload.get("jobId"),
        error_type=type(exc).__name__,
        invocation=invocation,
    )


def _release_terminal_editor_submission(
    payload: dict[str, Any],
    error_code: str,
) -> bool:
    if payload.get("kind") != "rerender":
        return False
    request_id = str(payload.get("requestId") or "").strip()
    short_id = str(payload.get("shortId") or "").strip()
    if not request_id or not short_id:
        return False
    encoded_request_id = urllib.parse.quote(request_id, safe="")
    encoded_short_id = urllib.parse.quote(short_id, safe="")
    now = iso_now()
    patch(
        "editor_render_requests",
        (
            f"id=eq.{encoded_request_id}&short_id=eq.{encoded_short_id}"
            "&status=eq.queued"
        ),
        {
            "status": "failed",
            "failure_code": "editor_batch_submit_failed",
            "updated_at": now,
            "completed_at": now,
        },
    )
    patch(
        "generated_shorts",
        (
            f"id=eq.{encoded_short_id}&status=eq.rerendering"
            f"&pending_edit_request_id=eq.{encoded_request_id}"
        ),
        {
            "status": "ready",
            "rerender_progress": 0,
            "pending_render_hash": None,
            "pending_edit_snapshot": None,
            "pending_edit_request_id": None,
            "rerender_batch_job_id": None,
            "render_error_code": "editor_batch_submit_failed",
            "render_error_message": "편집 렌더 작업을 시작하지 못했습니다. 다시 시도해 주세요.",
        },
    )
    patch(
        "editor_render_outbox",
        f"request_id=eq.{encoded_request_id}",
        {
            "status": "failed",
            "updated_at": now,
            "last_error": error_code,
        },
    )
    return True


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    if event.get("kind"):
        try:
            result = _submit(event)
        except Exception as exc:
            _log_project_target_failure(exc, event, invocation="direct")
            raise
        log_event(
            "batch_submit_succeeded",
            kind=event.get("kind"),
            job_id=event.get("jobId"),
            batch_job_id=result,
            invocation="direct",
        )
        return {"batchJobId": result}

    failures: list[dict[str, str]] = []
    for record in event.get("Records", []):
        payload: dict[str, Any] = {}
        try:
            payload = json.loads(record["body"])
            result = _submit(payload)
            log_event(
                "batch_submit_succeeded",
                kind=payload.get("kind"),
                job_id=payload.get("jobId"),
                batch_job_id=result,
            )
        except Exception as exc:
            error_code = _aws_error_code(exc)
            _log_project_target_failure(exc, payload, invocation="sqs")
            receive_count = int(
                record.get("attributes", {}).get("ApproximateReceiveCount") or 1
            )
            log_event(
                "batch_submit_failed",
                kind=payload.get("kind"),
                job_id=payload.get("jobId"),
                error_type=type(exc).__name__,
                error_code=error_code,
                receive_count=receive_count,
            )
            if receive_count >= 5:
                try:
                    if _release_terminal_editor_submission(payload, error_code):
                        log_event(
                            "editor_batch_submit_terminal_failure_released",
                            short_id=payload.get("shortId"),
                            request_id=payload.get("requestId"),
                            error_code=error_code,
                        )
                        continue
                except Exception as release_exc:
                    log_event(
                        "editor_batch_submit_terminal_release_failed",
                        short_id=payload.get("shortId"),
                        request_id=payload.get("requestId"),
                        error_type=type(release_exc).__name__,
                    )
            failures.append({"itemIdentifier": record["messageId"]})
    return {"batchItemFailures": failures}
