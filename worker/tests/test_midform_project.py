import pytest

from shorts_worker.media import media_duration, probe_media, run_command
from shorts_worker.midform import edit_ranges, render
from shorts_worker.midform_project import build_edit_reel, reel_document


def test_reel_preserves_speakers_context_and_exact_frame_clock():
    rows = [
        {"start": 10, "end": 12.014, "text": "질문", "speaker": "a"},
        {"start": 12.2, "end": 15.013, "text": "답변", "speaker": "b"},
        {"start": 16, "end": 22, "keep": False},
        {"start": 30, "end": 33.017, "text": "마지막 반응", "speaker": "b"},
    ]
    doc = reel_document(rows, 100, 30000 / 1001)
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
    first_scene_end = doc["scenes"][0]["end"]
    for row in doc["rows"]:
        row["keep"] = row["start"] >= first_scene_end
    exported = tmp_path / "edited.mp4"
    render(reel, exported, edit_ranges(doc["rows"], [], False, {}), True)
    assert media_duration(probe_media(exported)) == pytest.approx(2, abs=0.1)
    captions = exported.with_suffix(".srt").read_text()
    assert "다음 장면" in captions and "첫 장면" not in captions


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


def test_admitted_upload_advances_pending_slot_and_never_stores_original(monkeypatch, tmp_path):
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
        "id": "job", "mvp_session_id": "session", "source_type": "upload",
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
