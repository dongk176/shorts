import pytest

from shorts_worker.media import media_duration, probe_media, run_command
from shorts_worker.midform import edit_ranges, render
from shorts_worker.midform_project import (
    build_edit_reel,
    prepare_midform_source,
    reel_document,
    reel_silence_ranges,
)


def test_selected_source_is_trimmed_before_transcription_with_a_zero_based_clock(tmp_path):
    source = tmp_path / "range-source.mp4"
    result = run_command([
        "ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i",
        "testsrc2=size=160x90:rate=1:duration=900", "-f", "lavfi", "-i",
        "sine=frequency=440:sample_rate=8000:duration=900",
        "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac",
        "-shortest", str(source),
    ], timeout=30)
    assert result.returncode == 0
    selected, duration, source_range = prepare_midform_source(source, {
        "source_range_selection_enabled": True,
        "range_start_seconds": 120.0, "range_end_seconds": 780.0,
    }, tmp_path)
    assert selected != source
    assert duration == pytest.approx(660, abs=0.15)
    probe = probe_media(selected)
    assert media_duration(probe) == pytest.approx(660, abs=0.15)
    assert float(probe["format"].get("start_time", 0)) == pytest.approx(0, abs=0.05)
    assert source_range["start"] == 120.0 and source_range["end"] == 780.0
    assert source.exists()


@pytest.mark.parametrize("start,end", [(-1, 3), (3, 3), (0, 7), (float("nan"), 4)])
def test_selected_source_rejects_invalid_clock_before_encoding(monkeypatch, tmp_path, start, end):
    from unittest.mock import Mock

    from shorts_worker import midform_project as project

    monkeypatch.setattr(project, "inspect_source", lambda _source: (6.0, True))
    encode = Mock()
    monkeypatch.setattr(project, "checked_run", encode)
    with pytest.raises(ValueError, match="원본 구간"):
        prepare_midform_source(tmp_path / "source.mp4", {
            "source_range_selection_enabled": True,
            "range_start_seconds": start, "range_end_seconds": end,
        }, tmp_path)
    encode.assert_not_called()


@pytest.mark.parametrize("declared,end,accepted", [
    (835, 835, True), (835, 835.2, False), (836, 836, False),
    (None, 835, False), (float("inf"), 835, False),
])
def test_full_range_metadata_rounding_is_clamped_only_at_admitted_endpoint(
    monkeypatch, tmp_path, declared, end, accepted,
):
    from unittest.mock import Mock

    from shorts_worker import midform_project as project

    monkeypatch.setattr(project, "inspect_source", lambda _: (834.36263, True))
    encode = Mock()
    monkeypatch.setattr(project, "checked_run", encode)
    source = tmp_path / "source.mp4"
    job = {"source_range_selection_enabled": True, "range_start_seconds": 0,
           "range_end_seconds": end, "source_duration_seconds": declared}
    if accepted:
        selected, duration, source_range = prepare_midform_source(source, job, tmp_path)
        assert selected == source
        assert duration == source_range["end"] == 834.36263
    else:
        with pytest.raises(ValueError, match="원본 구간"):
            prepare_midform_source(source, job, tmp_path)
    encode.assert_not_called()


def test_reel_preserves_speakers_context_and_exact_frame_clock():
    rows = [
        {"start": 10, "end": 12.014, "text": "질문", "speaker": "a"},
        {"start": 12.2, "end": 15.013, "text": "답변", "speaker": "b"},
        {"start": 16, "end": 22, "keep": False},
        {"start": 30, "end": 33.017, "text": "마지막 반응", "speaker": "b"},
    ]
    doc = reel_document(rows, 100, 30000 / 1001, context_seconds=0)
    assert len(doc["scenes"]) == 2
    assert doc["scenes"][1]["start"] == round(5.013 * 30000 / 1001) / (30000 / 1001)
    speech = [row for row in doc["rows"] if row["text"]]
    assert [row["text"] for row in speech] == ["질문", "답변", "마지막 반응"]
    assert [row["speaker"] for row in speech] == ["a", "b", "b"]
    assert doc["rows"][0]["start"] == 0
    assert doc["rows"][-1]["end"] == pytest.approx(doc["duration"])
    output_duration = sum(r["end"] - r["start"]
                          for r in edit_ranges(doc["rows"], [], False, {}))
    assert output_duration == pytest.approx(doc["duration"])


def test_reel_cannot_disguise_complete_source_as_an_edit_asset():
    with pytest.raises(ValueError, match="원본 전체"):
        reel_document([{"start": 0, "end": 99}], 100, 30)


def test_every_retained_frame_belongs_to_a_scene_even_with_fractional_fps():
    doc = reel_document([{"start": 10, "end": 15.013},
                         {"start": 200, "end": 203.017}], 600, 30000 / 1001)
    assert doc["scenes"][0]["availableStart"] == 0
    assert doc["scenes"][0]["availableEnd"] == doc["scenes"][1]["availableStart"]
    assert doc["scenes"][-1]["availableEnd"] == doc["duration"]


def test_saved_reel_can_be_edited_without_original(tmp_path):
    source = tmp_path / "source.mp4"
    result = run_command([
        "ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i",
        "testsrc2=size=320x180:rate=30:duration=8", "-f", "lavfi", "-i",
        "sine=frequency=440:duration=8", "-c:v", "libx264", "-c:a", "aac",
        "-shortest", str(source),
    ], timeout=30)
    assert result.returncode == 0
    reel = tmp_path / "reel.mp4"
    doc = build_edit_reel(source, reel, [
        {"start": 1, "end": 2.5, "text": "첫 장면", "speaker": "a"},
        {"start": 5, "end": 7, "text": "다음 장면", "speaker": "b"},
    ])
    source.unlink()
    second_scene = doc["scenes"][1]
    for row in doc["rows"]:
        row["keep"] = (row["start"] >= second_scene["start"] - .001
                       and row["end"] <= second_scene["end"] + .001)
    exported = tmp_path / "edited.mp4"
    render(reel, exported, edit_ranges(doc["rows"], [], False, {}), True)
    assert media_duration(probe_media(exported)) == pytest.approx(2, abs=0.1)
    captions = exported.with_suffix(".srt").read_text()
    assert "다음 장면" in captions and "첫 장면" not in captions


def test_context_keeps_30_seconds_per_edge_without_changing_initial_selection():
    rows = [{"start": a, "end": b, "text": text, "speaker": speaker, "keep": keep}
            for a, b, text, speaker, keep in [
                (70, 80, "앞 대사", "b", False), (100, 110, "첫 장면", "a", True),
                (132, 138, "뒤 대사", "b", False), (270, 280, "다음 앞", "b", False),
                (300, 310, "다음 장면", "b", True), (330, 338, "다음 뒤", "a", False),
            ]]
    doc = reel_document(rows, 600, 30)
    assert doc["editContextSeconds"] == 30
    assert [(w["sourceStart"], w["sourceEnd"]) for w in doc["retainedRanges"]] == [
        (70, 140), (270, 340),
    ]
    assert doc["duration"] == 140
    assert [r["text"] for r in doc["rows"] if r["keep"] and r["text"]] == [
        "첫 장면", "다음 장면",
    ]
    assert sum(r["end"] - r["start"] for r in edit_ranges(doc["rows"], [], False, {})) == 20
    assert [(s["start"], s["end"], s["availableStart"], s["availableEnd"])
            for s in doc["scenes"]] == [(30, 40, 0, 70), (100, 110, 70, 140)]
    assert any(r["text"] == "앞 대사" and not r["keep"] for r in doc["rows"])


def test_overlapping_handles_share_one_asset_and_do_not_split_context_dialogue():
    doc = reel_document([
        {"start": 100, "end": 110, "text": "장면1"},
        {"start": 112, "end": 122, "text": "여유 대사", "keep": False},
        {"start": 125, "end": 130, "text": "장면2"},
    ], 600, 30)
    assert len(doc["retainedRanges"]) == 1
    assert doc["duration"] == 90
    assert len(doc["scenes"]) == 2
    assert doc["scenes"][0]["availableEnd"] == doc["scenes"][1]["availableStart"]
    boundary = doc["scenes"][0]["availableEnd"]
    assert not any(r["start"] < boundary < r["end"] for r in doc["rows"])
    assert sum(r["end"] - r["start"] for r in edit_ranges(doc["rows"], [], False, {})) == 15


def test_adding_context_preserves_initial_silence_cuts_and_only_maps_retained_audio():
    rows = [{"start": 100, "end": 110}, {"start": 300, "end": 310}]
    silences = [[72, 78], [105, 108], [150, 190]]
    lengths = []
    for context in (0, 30):
        doc = reel_document(rows, 600, 30, context_seconds=context)
        mapped = reel_silence_ranges(doc, silences)
        lengths.append(sum(r["end"] - r["start"]
                           for r in edit_ranges(doc["rows"], mapped, True, {})))
        assert all(0 <= a < b <= doc["duration"] for a, b in mapped)
    assert lengths == [17, 17]


@pytest.mark.parametrize("rows,duration", [
    ([{"start": 30, "end": 70}], 100),
    ([{"start": 100, "end": 1290}], 3600),
])
def test_context_shrinks_before_full_source_or_existing_asset_limit(rows, duration):
    doc = reel_document(rows, duration, 30)
    assert 0 <= doc["editContextSeconds"] < 30
    assert doc["duration"] < duration * .95
    assert doc["duration"] <= 1200.1
    kept_duration = sum(r["end"] - r["start"] for r in edit_ranges(doc["rows"], [], False, {}))
    assert kept_duration == pytest.approx(
        sum(r["end"] - r["start"] for r in rows), abs=.05,
    )


@pytest.mark.render
def test_retained_context_can_extend_and_restore_video_after_original_is_deleted(tmp_path):
    source = tmp_path / "context-original.mp4"
    result = run_command([
        "ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i",
        "testsrc2=size=160x90:rate=10:duration=120", "-f", "lavfi", "-i",
        "sine=frequency=440:sample_rate=8000:duration=120", "-c:v", "libx264",
        "-preset", "ultrafast", "-c:a", "aac", "-shortest", str(source),
    ], timeout=30)
    assert result.returncode == 0
    reel = tmp_path / "context-reel.mp4"
    doc = build_edit_reel(source, reel, [
        {"start": 15, "end": 20, "text": "복원할 앞 문장", "speaker": "b", "keep": False},
        {"start": 20, "end": 22, "text": "첫 장면", "speaker": "a"},
        {"start": 22, "end": 25, "text": "뒤 문장", "speaker": "b", "keep": False},
        {"start": 70, "end": 72, "text": "두 번째 장면", "speaker": "b"},
    ])
    assert doc["duration"] == pytest.approx(102, abs=.1)
    source.unlink()
    output = tmp_path / "context-initial.mp4"
    render(reel, output, edit_ranges(doc["rows"], [], False, {}), True)
    assert media_duration(probe_media(output)) == pytest.approx(4, abs=.1)
    assert "복원할" not in output.with_suffix(".srt").read_text()
    for row in doc["rows"]:
        if row["text"] == "복원할 앞 문장":
            row["keep"] = True
    extended = tmp_path / "context-extended.mp4"
    render(reel, extended, edit_ranges(doc["rows"], [], False, {}), True)
    assert media_duration(probe_media(extended)) == pytest.approx(9, abs=.1)
    assert "복원할 앞 문장" in extended.with_suffix(".srt").read_text()


def test_cloud_rerender_rejects_wrong_request_before_downloading(monkeypatch, tmp_path):
    from types import SimpleNamespace
    from unittest.mock import Mock

    from shorts_worker.midform_project import rerender_midform

    monkeypatch.setattr(
        "shorts_worker.midform_project.require_midform_worker_access", lambda *args: None,
    )
    monkeypatch.setenv("MIDFORM_ENABLED", "true")
    worker = SimpleNamespace(storage=Mock(), settings=SimpleNamespace(temp_dir=tmp_path))
    item = {"id": "s", "job_id": "job", "render_version": 1, "pending_edit_request_id": "accepted",
            "midform_document": {"duration": 3, "rows": []}}
    with pytest.raises(ValueError, match="일치하지"):
        rerender_midform(worker, item, {"version": 4, "kind": "midform",
            "sourceShortId": "s", "baseRenderVersion": 1, "requestId": "other"})
    worker.storage.download.assert_not_called()


@pytest.mark.parametrize("change", [{"start": 1}, {"end": 2}, {"id": "99"}])
def test_cloud_rerender_rejects_source_clock_tampering(monkeypatch, tmp_path, change):
    from types import SimpleNamespace
    from unittest.mock import Mock

    from shorts_worker.midform_project import rerender_midform

    monkeypatch.setattr(
        "shorts_worker.midform_project.require_midform_worker_access", lambda *args: None,
    )
    monkeypatch.setenv("MIDFORM_ENABLED", "true")
    worker = SimpleNamespace(storage=Mock(), settings=SimpleNamespace(temp_dir=tmp_path))
    row = {"id": "0", "start": 0, "end": 3, "speaker": "a", "text": "안녕", "keep": True}
    item = {"id": "s", "job_id": "job", "render_version": 1, "pending_edit_request_id": "accepted",
            "midform_document": {"duration": 3, "rows": [row]}}
    with pytest.raises(ValueError, match="시간 정보"):
        rerender_midform(worker, item, {"version": 4, "kind": "midform",
            "sourceShortId": "s", "baseRenderVersion": 1, "requestId": "accepted",
            "draft": {"rows": [{**row, **change}], "framing": {}, "removeSilence": False}})
    worker.storage.download.assert_not_called()


@pytest.mark.parametrize("source_type", ["upload", "youtube"])
def test_admitted_source_advances_pending_slot_and_never_stores_original(
    monkeypatch, tmp_path, source_type,
):
    from types import SimpleNamespace
    from unittest.mock import Mock

    from shorts_worker import midform_project as project

    monkeypatch.setattr(
        "shorts_worker.midform_project.require_midform_worker_access", lambda *args: None,
    )
    source = tmp_path / "original.mp4"
    source.write_bytes(b"full private source")
    rows = [{"id": "0", "start": 0, "end": 20, "speaker": "a", "text": "이야기", "keep": True}]
    monkeypatch.setattr(project, "inspect_source", lambda _: (900, True))
    monkeypatch.setattr(project, "transcribe", lambda *args: rows)
    monkeypatch.setattr(project, "select_shorts_chain", lambda *args: (["0"], "ai"))
    monkeypatch.setattr(project, "silence_ranges", lambda *args: [])
    def renderer(source, output, ranges, audio):
        output.write_bytes(b"final with silence removed")
        output.with_suffix(".srt").write_text("captions")
    monkeypatch.setattr(project, "render", renderer)
    monkeypatch.setattr(project, "probe_media", lambda _: {"format": {"duration": "20"}})


    def build(original, output, selected):
        assert original == source
        output.write_bytes(b"condensed selected story")
        output.with_suffix(".srt").write_text("captions")
        return {"version": 1, "duration": 20, "rows": selected,
                "framing": {}, "names": {}, "removeSilence": False}

    monkeypatch.setattr(project, "build_edit_reel", build)
    repository = Mock()
    slot = {"status": "pending"}

    def selected(job_id, index):
        assert (job_id, index) == ("job", 1)
        assert slot["status"] == "pending"
        slot["status"] = "selected"

    def extracted(**kwargs):
        assert slot["status"] == "selected"
        assert kwargs["clip_index"] == 1
        assert kwargs["midform_document"]["duration"] == 20
        assert kwargs["clean_key"].startswith("edit-sources/session/job/")
        slot["status"] = "extracted"
        return True

    def ready(*args):
        assert slot["status"] == "extracted"
        slot["status"] = "ready"
        return True

    repository.set_project_attempt_selected.side_effect = selected
    repository.add_pending_short.side_effect = extracted
    repository.complete_initial_render.side_effect = ready
    repository.finalize_project_job.side_effect = lambda _: slot["status"] == "ready"
    storage = Mock()

    def upload(local, key, content_type):
        assert local != source
        assert local.read_bytes() != source.read_bytes()
        return local.stat().st_size

    storage.upload.side_effect = upload
    worker = SimpleNamespace(repository=repository, storage=storage,
        settings=SimpleNamespace(elevenlabs_api_key="test", openai_api_key="test"),
        _thumbnail=lambda reel, output, directory: output.write_bytes(b"thumbnail"))
    project.run_midform_project(worker, {
        "id": "job", "mvp_session_id": "session", "source_type": source_type,
        "planned_short_count": 1, "pipeline_version": 2, "retention_days": 3,
        "video_title": "테스트", "midform_request": {"version": 1, "targetSeconds": 0},
    }, source, tmp_path)
    assert slot["status"] == "ready"
    repository.finalize_project_job.assert_called_once_with("job")
    assert storage.upload.call_count == 3
    storage.delete.assert_not_called()


def test_ai_caption_rerender_saves_generated_draft_and_keeps_source_clean(monkeypatch, tmp_path):
    from types import SimpleNamespace
    from unittest.mock import Mock

    from shorts_worker import midform_project as project

    monkeypatch.setattr(
        "shorts_worker.midform_project.require_midform_worker_access", lambda *args: None,
    )
    row = {"id": "0", "start": 0, "end": 10, "speaker": "a", "text": "대사", "keep": True}
    custom = "user_11111111-1111-4111-8111-111111111111"
    draft = {"rows": [{**row, "speaker": custom}], "framing": {custom: "right"},
             "names": {custom: "진행자"}, "removeSilence": False}
    generated = {"enabled": True, "mode": "ai", "items": [{
        "id": "caption-0", "start": 2, "end": 4, "text": "면허는 있음", "kicker": "",
        "style": "comic", "x": .5, "y": .6, "scale": 1, "enabled": True,
    }]}
    repository = Mock()
    repository.complete_midform_rerender.return_value = ["outputs/old.mp4"]
    source = tmp_path / "clean.mp4"
    source.write_bytes(b"clean edit reel")
    storage = Mock()
    storage.download.return_value = source
    storage.upload.return_value = 123
    worker = SimpleNamespace(repository=repository, storage=storage,
        settings=SimpleNamespace(temp_dir=tmp_path, openai_api_key="test"),
        _thumbnail=lambda *args: None)
    generator = Mock(return_value=generated)
    monkeypatch.setattr(project, "generate_captions", generator)

    def renderer(input_path, output, ranges, audio, entertainment):
        assert input_path == source and audio
        assert entertainment == generated
        assert ranges[0]["position"] == "right"
        output.write_bytes(b"rendered captions")
        output.with_suffix(".srt").write_text("dialogue captions")

    monkeypatch.setattr(project, "render", renderer)
    monkeypatch.setattr(project, "probe_media", lambda _: {"format": {"duration": "10"}})
    item = {"id": "s", "job_id": "job", "render_version": 1, "pending_edit_request_id": "accepted",
        "mvp_session_id": "session", "clean_clip_s3_key": "edit-sources/clean",
        "midform_document": {"duration": 10, "rows": [row]}}
    project.rerender_midform(worker, item, {"version": 4, "kind": "midform",
        "sourceShortId": "s", "baseRenderVersion": 1, "requestId": "accepted",
        "generateCaptions": True, "draft": draft})
    generator.assert_called_once()
    saved = repository.complete_midform_rerender.call_args.kwargs
    assert saved["draft"]["entertainment"] == generated
    assert saved["draft"]["rows"][0]["speaker"] == custom
    assert item["midform_document"]["rows"][0]["speaker"] == "a"
    assert "entertainment" not in draft
    assert source.read_bytes() == b"clean edit reel"
    storage.delete.assert_called_once_with("outputs/old.mp4")


def test_speaker_reassignment_preserves_source_and_changes_framing():
    from shorts_worker.midform import edit_ranges, validate_speaker_assignments

    source = [{"id": "0", "start": 0, "end": 3, "speaker": "a", "text": "대사", "keep": True}]
    custom = "user_11111111-1111-4111-8111-111111111111"
    rows = [{**source[0], "speaker": custom}]
    validate_speaker_assignments(rows, source, {custom: "진행자"})
    assert edit_ranges(rows, [], False, {custom: "right"})[0]["position"] == "right"
    assert source[0]["speaker"] == "a"
    with pytest.raises(ValueError, match="화자"):
        validate_speaker_assignments(rows, source, {})
