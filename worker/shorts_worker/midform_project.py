"""Portable midform edit sources: retain selected scenes, never the full upload.

The cloud editor works on a condensed reel. Its coordinates are independent of
the ephemeral original, so later edits do not need the original upload again.
"""

from __future__ import annotations

import math
import os
import tempfile
from pathlib import Path
from uuid import uuid4

from .media import media_duration, probe_media
from .midform import (
    edit_ranges,
    inspect_source,
    normalize_segments,
    render,
    silence_ranges,
    transcribe,
    validate_speaker_assignments,
)
from .midform_captions import generate_captions, validate_captions
from .midform_selection import select_shorts_chain


def reel_document(rows: list[dict], source_duration: float, fps: float) -> dict:
    """Compile frame-aligned source mappings and editable transcript together."""
    if not math.isfinite(source_duration) or source_duration <= 0:
        raise ValueError("원본 영상 길이가 올바르지 않습니다.")
    if not math.isfinite(fps) or not 1 <= fps <= 60:
        raise ValueError("영상 프레임 정보가 올바르지 않습니다.")
    normalized = normalize_segments(rows, source_duration)
    ranges = edit_ranges(normalized, [], False, {})
    selected_duration = sum(item["end"] - item["start"] for item in ranges)
    # A reel must genuinely discard source material. Renaming/re-encoding a
    # complete source is not a way around the ephemeral-source boundary.
    if selected_duration >= source_duration * 0.95:
        raise ValueError("핵심 장면을 더 골라 주세요. 원본 전체는 편집용으로 보관하지 않습니다.")
    cursor_frames = 0
    mapped_rows: list[dict] = []
    scenes: list[dict] = []
    for item in ranges:
        frames = max(1, round((item["end"] - item["start"]) * fps))
        offset = cursor_frames / fps
        length = frames / fps
        scenes.append({
            "sourceStart": item["start"], "sourceEnd": item["end"],
            "start": offset, "end": offset + length,
        })
        for row in normalized:
            if not row["keep"] or row["end"] <= item["start"] or row["start"] >= item["end"]:
                continue
            start = offset + max(0, row["start"] - item["start"])
            end = offset + min(length, row["end"] - item["start"])
            if end <= start:
                continue
            mapped_rows.append({
                **row, "id": str(len(mapped_rows)), "start": start, "end": end,
            })
        # Keep the frame-rounding tail and sentence gaps selectable. These are
        # real video/reactions, not transcript-derived silence to auto-remove.
        cursor_frames += frames
    duration = cursor_frames / fps
    filled: list[dict] = []
    cursor = 0.0
    for row in mapped_rows:
        if row["start"] > cursor + 0.001:
            filled.append({"start": cursor, "end": row["start"], "text": "",
                           "speaker": "unknown", "keep": True})
        filled.append(row)
        cursor = row["end"]
    if cursor < duration - 0.001:
        filled.append({"start": cursor, "end": duration, "text": "",
                       "speaker": "unknown", "keep": True})
    return {
        "version": 1, "duration": duration, "sourceDuration": source_duration,
        "fps": fps, "scenes": scenes,
        "rows": normalize_segments(filled, duration),
        "framing": {}, "names": {}, "removeSilence": False,
    }


def build_edit_reel(source: Path, destination: Path, rows: list[dict]) -> dict:
    probe = probe_media(source)
    video = next(stream for stream in probe["streams"] if stream["codec_type"] == "video")
    rate = str(video.get("avg_frame_rate", "30/1")).split("/")
    fps = min(60, max(1, float(rate[0]) / max(1, float(rate[-1]))))
    document = reel_document(rows, media_duration(probe), fps)
    ranges = edit_ranges(normalize_segments(rows, document["sourceDuration"]), [], False, {})
    render(source, destination, ranges,
           any(stream["codec_type"] == "audio" for stream in probe["streams"]))
    actual = media_duration(probe_media(destination))
    if abs(actual - document["duration"]) > max(0.1, 2 / fps):
        destination.unlink(missing_ok=True)
        destination.with_suffix(".srt").unlink(missing_ok=True)
        raise ValueError("편집 영상과 대본의 길이가 일치하지 않습니다.")
    return document


def require_midform_worker_access(worker, job_id: str) -> None:
    """Recheck current admin status and immutable release before provider work."""
    with worker.repository.connect() as connection:
        row = connection.execute(
            """select u.is_admin, j.midform_request, j.midform_release_id,
                      j.initial_editor_release_id
               from shorts_mvp.video_jobs j
               join shorts_mvp.app_users u on u.id=j.user_id
               where j.id=%s and j.user_deleted_at is null""", (job_id,),
        ).fetchone()
    if (os.getenv("MIDFORM_ENABLED") != "true" or not row
            or row["is_admin"] is not True
            or row["midform_request"] != {"version": 1, "targetSeconds": 0}
            or str(row["midform_release_id"]) != os.getenv("MIDFORM_RELEASE_ID")
            or row["initial_editor_release_id"] != row["midform_release_id"]):
        raise ValueError("중폼 제작 권한 또는 릴리스를 확인하지 못했습니다.")


def run_midform_project(worker, job: dict, source: Path, work_dir: Path) -> None:
    """Use the existing admitted upload job, billing, heartbeat and cleanup owner."""
    require_midform_worker_access(worker, str(job["id"]))
    request = job.get("midform_request")
    if not isinstance(request, dict) or request.get("version") != 1:
        raise ValueError("긴 영상 편집 요청을 확인하지 못했습니다.")
    target = request.get("targetSeconds")
    if type(target) is not int or (target != 0 and not 120 <= target <= 900):
        raise ValueError("희망 영상 길이를 확인해 주세요.")
    if (job.get("source_type", "youtube") not in {"youtube", "upload"}
            or int(job.get("planned_short_count") or 0) != 1):
        raise ValueError("긴 영상 편집 작업 형식이 올바르지 않습니다.")
    duration, has_audio = inspect_source(source)
    if not has_audio:
        raise ValueError("음성이 있는 영상을 선택해 주세요.")
    repository = worker.repository
    repository.stage(job["id"], "transcribing", 28, "대화와 화자를 분석하고 있습니다.")
    if worker.settings.elevenlabs_api_key:
        rows = transcribe(source, duration, worker.settings.elevenlabs_api_key)
    else:
        rows = normalize_segments([
            {"start": start, "end": min(duration, start + 20), "text": ""}
            for start in range(0, math.ceil(duration), 20)
        ], duration)
    repository.stage(job["id"], "selecting", 42, "이야기와 반응을 고르고 있습니다.")
    selected, mode = select_shorts_chain(rows, worker.settings.openai_api_key or "")
    selected_ids = set(selected)
    for row in rows:
        row["keep"] = row["id"] in selected_ids
    # Upload admission creates a pending pipeline-v2 slot. Commit selection
    # before add_pending_short atomically advances that slot to extracted.
    repository.set_project_attempt_selected(job["id"], 1)
    repository.stage(job["id"], "rendering", 55, "자연스러운 편집본을 만들고 있습니다.")
    reel = work_dir / "midform-reel.mp4"
    document = build_edit_reel(source, reel, rows)
    document.update({"target": target, "selectionMode": mode,
                     "silences": silence_ranges(reel, document["duration"], "aggressive"),
                     "revision": 0, "outputSrt": reel.with_suffix(".srt").read_text()})
    document["removeSilence"] = True
    document["silencePreset"] = "aggressive"
    output = work_dir / "midform-output.mp4"
    render(reel, output, edit_ranges(document["rows"], document["silences"], True, {}), True)
    document["outputSrt"] = output.with_suffix(".srt").read_text()
    document["renderedDraft"] = {key: document[key]
                                 for key in ("rows", "framing", "names",
                                             "removeSilence", "silencePreset")}
    short_id = str(uuid4())
    prefix = f"{job['mvp_session_id']}/{job['id']}/{short_id}"
    clean_key = f"edit-sources/{prefix}.mp4"
    output_key = f"outputs/{prefix}/v1.mp4"
    thumbnail_key = f"thumbnails/{prefix}.jpg"
    thumbnail = work_dir / "midform-thumbnail.jpg"
    worker._thumbnail(output, thumbnail, work_dir)
    uploaded: list[str] = []
    checkpointed = False
    checkpoint_attempted = False
    try:
        worker.storage.upload(reel, clean_key, "video/mp4")
        uploaded.append(clean_key)
        size = worker.storage.upload(output, output_key, "video/mp4")
        uploaded.append(output_key)
        worker.storage.upload(thumbnail, thumbnail_key, "image/jpeg")
        uploaded.append(thumbnail_key)
        subtitles = [{"start": row["start"], "end": row["end"], "text": row["text"]}
                     for row in document["rows"] if row["text"]]
        checkpoint_attempted = True
        checkpointed = repository.add_pending_short(
            short_id=short_id, job=job, clip_index=1, start_seconds=0,
            end_seconds=media_duration(probe_media(output)),
            hook_title=str(job["video_title"])[:80],
            highlight_reason=mode, selection_raw_start_seconds=None,
            selection_raw_end_seconds=None, selection_raw_duration_seconds=None,
            selection_candidate_index=None, selection_provider=None, selection_model=None,
            selection_length_adjustment=None, selection_repositioned=None,
            subtitles=subtitles, comment_overlays=[], clean_key=clean_key,
            timeline_key=None, timeline_start_seconds=None, timeline_end_seconds=None,
            timeline_subtitles=None, retention_days=min(30, int(job["retention_days"])),
            shard_index=0, subtitles_enabled=False, midform_document=document,
        )
        if not checkpointed:
            raise ValueError("작업 상태가 바뀌어 편집본을 저장하지 못했습니다.")
        if not repository.mark_project_preparation_finished(job["id"]):
            raise ValueError("편집본 저장 시간이 만료되었습니다.")
        if not repository.complete_initial_render(short_id, output_key, thumbnail_key, size):
            raise ValueError("완성본을 저장하지 못했습니다.")
        repository.finalize_project_job(job["id"])
    finally:
        # After the DB checkpoint, normal retention/cleanup owns the assets.
        # Never delete a referenced edit source on an ambiguous DB response.
        if not checkpoint_attempted:
            for key in uploaded:
                worker.storage.delete(key)


def rerender_midform(worker, item: dict, snapshot: dict) -> None:
    require_midform_worker_access(worker, str(item["job_id"]))
    short_id = str(item["id"])
    document = item.get("midform_document")
    if (not isinstance(document, dict) or snapshot.get("kind") != "midform"
            or snapshot.get("version") != 4 or snapshot.get("sourceShortId") != short_id
            or snapshot.get("baseRenderVersion") != int(item["render_version"])
            or str(snapshot.get("requestId")) != str(item.get("pending_edit_request_id"))):
        raise ValueError("저장한 편집 요청과 영상이 일치하지 않습니다.")
    draft = dict(snapshot["draft"])
    draft.update({"removeSilence": True, "silencePreset": "aggressive"})
    rows = normalize_segments(draft["rows"], document["duration"])
    originals = document["rows"]
    if len(rows) != len(originals) or any(
        any(row[key] != original[key] for key in ("id", "start", "end"))
        for row, original in zip(draft["rows"], originals, strict=True)
    ):
        raise ValueError("편집 원본의 시간 정보가 변경되었습니다.")
    validate_speaker_assignments(rows, originals, draft.get("names", {}))
    ranges = edit_ranges(rows, document.get("silences", []),
                         draft["removeSilence"] is True, draft["framing"])
    captions = validate_captions(draft.get("entertainment"), document["duration"])
    if snapshot.get("generateCaptions") is True:
        worker.repository.update_rerender_progress(short_id, 8)
        captions = generate_captions(
            rows, document["duration"], worker.settings.openai_api_key or "", captions, ranges,
        )
        draft["entertainment"] = captions
    version = int(item["render_version"]) + 1
    prefix = f"{item['mvp_session_id']}/{item['job_id']}/{short_id}"
    output_key = f"outputs/{prefix}/v{version}.mp4"
    thumbnail_key = f"thumbnails/{prefix}/v{version}.jpg"
    uploaded = []
    completion_attempted = False
    try:
        with tempfile.TemporaryDirectory(
            prefix="midform-edit-", dir=worker.settings.temp_dir,
        ) as temp:
            directory = Path(temp)
            source = worker.storage.download(item["clean_clip_s3_key"], directory / "reel.mp4")
            worker.repository.mark_editor_render_request_rendering(short_id)
            worker.repository.update_rerender_progress(short_id, 15)
            output = directory / "output.mp4"
            render(source, output, ranges, True, entertainment=captions)
            thumbnail = directory / "thumbnail.jpg"
            worker._thumbnail(output, thumbnail, directory)
            worker.repository.update_rerender_progress(short_id, 82)
            size = worker.storage.upload(output, output_key, "video/mp4")
            uploaded.append(output_key)
            worker.storage.upload(thumbnail, thumbnail_key, "image/jpeg")
            uploaded.append(thumbnail_key)
            completion_attempted = True
            old_keys = worker.repository.complete_midform_rerender(
                short_id, request_id=str(item["pending_edit_request_id"]),
                output_key=output_key, thumbnail_key=thumbnail_key, size=size,
                version=version, duration=round(media_duration(probe_media(output)), 3),
                draft=draft, srt=output.with_suffix(".srt").read_text(),
            )
            if old_keys is not None:
                for key in old_keys:
                    if key and key not in uploaded:
                        try:
                            worker.storage.delete(key)
                        except Exception:
                            pass  # Normal retention remains a backstop.
    except Exception:
        if not completion_attempted:
            for key in uploaded:
                worker.storage.delete(key)
        if int(os.getenv("AWS_BATCH_JOB_ATTEMPT", "1")) >= 2:
            worker.repository.reset_rerender(short_id)
        raise


def resume_midform_output(worker, item: dict) -> dict:
    """Finish an already-checkpointed reel without the deleted original."""
    require_midform_worker_access(worker, str(item["job_id"]))
    short_id = str(item["id"])
    prefix = f"{item['mvp_session_id']}/{item['job_id']}/{short_id}"
    with tempfile.TemporaryDirectory(
        prefix="midform-resume-", dir=worker.settings.temp_dir,
    ) as temp:
        directory = Path(temp)
        source = worker.storage.download(item["clean_clip_s3_key"], directory / "reel.mp4")
        thumbnail = directory / "thumbnail.jpg"
        document = item["midform_document"]
        output = directory / "output.mp4"
        render(source, output, edit_ranges(document["rows"], document["silences"], True, {}), True)
        worker._thumbnail(output, thumbnail, directory)
        output_key = f"outputs/{prefix}/v1.mp4"
        thumbnail_key = f"thumbnails/{prefix}.jpg"
        size = worker.storage.upload(output, output_key, "video/mp4")
        worker.storage.upload(thumbnail, thumbnail_key, "image/jpeg")
        committed = worker.repository.complete_initial_render(
            short_id, output_key, thumbnail_key, size,
        )
        return {"committed": committed, "outputBytes": size,
                "clipDurationSeconds": item["midform_document"]["duration"]}
