"""Real SQL against an explicitly isolated, disposable network-none container."""

from __future__ import annotations

import json
import os
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

import pytest
import test_project_target_successor_postgres as base
from test_language_test_isolation import registration

CONTAINER = os.getenv("LANGUAGE_TEST_SQL_CONTAINER", "")
pytestmark = pytest.mark.skipif(not CONTAINER, reason="requires isolated SQL container")
MIGRATION = Path(__file__).parents[2] / "supabase/migrations/202609120001_admin_language_test.sql"


def test_additive_migration_and_isolated_admission():
    base.CONTAINER = CONTAINER
    base.isolated_database.__wrapped__()
    base.reset_data.__wrapped__(None)
    sql = base.sql
    sql("""
      alter table shorts_mvp.video_jobs add column output_language text default 'ko',
        add column request_id uuid default gen_random_uuid();
      alter table shorts_mvp.editor_releases add column ui_version integer default 3,
        add column document_version integer default 3;
      create table shorts_mvp.generated_shorts(
        id uuid primary key,job_id uuid,user_id uuid,
        subtitle_template_id text,subtitle_template_snapshot jsonb,caption_render_spec jsonb,
        constraint generated_shorts_subtitle_template_check check(
          (subtitle_template_id is null and subtitle_template_snapshot is null
            and caption_render_spec is null)
          or (subtitle_template_snapshot->>'subtitleTemplateId'=subtitle_template_id
            and caption_render_spec->>'templateId'=subtitle_template_id))
      );
      create table shorts_mvp.editor_render_requests(
        id uuid primary key,short_id uuid,user_id uuid,release_id uuid,release_channel text
      );
    """)
    sql(
        "update shorts_mvp.editor_release_state set render_v4_target_successor="
        + base.encoded(
            {
                "version": 1,
                "phase": "active",
                "activeReleaseId": base.OLD,
                "activeRegistry": base.registry(old=True),
            }
        )
        + ";"
    )
    before_flags = base.flags()

    def insert(*, test=False, user=base.ADMIN, key="legacy_project", **changes):
        target = (
            registration()["registry"]["lanes"][key]["current"]
            if test
            else base.target(key, old=True)
        )
        values = {
            "id": str(uuid4()),
            "user_id": user,
            "status": "queued" if test else "completed",
            "source_type": "youtube",
            "pipeline_version": 2,
            "batch_target_key": key,
            "batch_target_release_id": target["releaseId"],
            "batch_job_definition": target["jobDefinitionArn"],
            "batch_job_queue": target["jobQueueArn"],
            "initial_editor_release_id": base.NEW if test else base.OLD,
            "initial_render_spec_version": 4,
            "initial_caption_render_spec_version": 4,
            "output_language": "ja" if test else "ko",
        }
        if test:
            values.update(source_language_hint="auto", language_test_release_id=base.NEW)
        values.update(changes)

        def literal(value):
            if value is None:
                return "null"
            return str(value) if isinstance(value, int) else "'" + value.replace("'", "''") + "'"

        return (
            "insert into shorts_mvp.video_jobs("
            + ",".join(values)
            + ") values("
            + ",".join(literal(v) for v in values.values())
            + ") returning id;"
        )

    old_id = sql(insert(user=base.USER))
    old_job = json.loads(
        sql(f"select to_jsonb(j) from shorts_mvp.video_jobs j where id='{old_id}';")
    )
    sql(MIGRATION.read_text())
    after = json.loads(sql(f"select to_jsonb(j) from shorts_mvp.video_jobs j where id='{old_id}';"))
    assert {k: v for k, v in after.items() if k in old_job} == old_job
    assert after["source_language_hint"] is None and after["language_test_release_id"] is None
    assert sql("select enabled from shorts_mvp.language_test_settings;") == "f"
    sql(insert(user=base.USER))
    sql(insert(user=base.ADMIN))
    assert base.flags() == before_flags

    record = registration()
    # Production-shaped registry references a synthetic test release in this local DB only.
    sql(
        f"update shorts_mvp.editor_releases set git_sha='{base.NEW_SHA}',"
        f"worker_image_digest='{base.NEW_IMAGE}' where id='{base.NEW}';"
    )
    for lane in record["registry"]["lanes"].values():
        lane["current"]["workerSourceGitSha"] = base.NEW_SHA
        lane["current"]["imageUri"] = (
            lane["current"]["imageUri"].split("@")[0] + "@" + base.NEW_IMAGE
        )
    sql(
        "insert into shorts_mvp.language_test_releases"
        "(id,registry,editor_job_queue_arn,verified_at) values("
        f"'{base.NEW}',{base.encoded(record['registry'])},'{record['editor_job_queue_arn']}',now());"
        f"update shorts_mvp.language_test_settings set release_id='{base.NEW}';"
    )
    base.assert_rejected(insert(test=True), "LANGUAGE_TEST_UNAVAILABLE")
    sql("update shorts_mvp.language_test_settings set enabled=true;")
    base.assert_rejected(insert(test=True, user=base.USER), "LANGUAGE_TEST_ADMIN_REQUIRED")
    base.assert_rejected(
        insert(test=True, batch_job_queue="wrong"), "LANGUAGE_TEST_TARGET_MISMATCH"
    )
    base.assert_rejected(
        insert(test=True, source_type="upload"), "video_jobs_language_test_context"
    )
    base.assert_rejected(
        insert(test=True, initial_render_spec_version=None), "video_jobs_language_test_context"
    )
    base.assert_rejected(
        insert(test=True, source_language_hint=None), "video_jobs_language_test_context"
    )

    # Two simultaneous submissions may never create two active test projects.
    def submit(_):
        try:
            return sql(insert(test=True))
        except subprocess.CalledProcessError as error:
            assert "LANGUAGE_TEST_BUSY" in error.stderr
            return None

    with ThreadPoolExecutor(max_workers=2) as executor:
        jobs = list(executor.map(submit, [1, 2]))
    assert sum(job is not None for job in jobs) == 1
    job = next(job for job in jobs if job)
    sql(insert(user=base.USER))
    for field, value in [
        ("language_test_release_id", "null"),
        ("source_language_hint", "'en'"),
        ("batch_job_queue", "'wrong'"),
        ("output_language", "'ko'"),
    ]:
        base.assert_rejected(
            f"update shorts_mvp.video_jobs set {field}={value} where id='{job}';",
            "LANGUAGE_TEST_BINDING_IMMUTABLE",
        )
    base.assert_rejected(
        f"update shorts_mvp.video_jobs set language_test_release_id='{base.NEW}',"
        f"source_language_hint='auto' where id='{old_id}';",
        "LANGUAGE_TEST_BINDING_IMMUTABLE",
    )
    sql("update shorts_mvp.language_test_settings set enabled=false;")
    sql(f"update shorts_mvp.video_jobs set status='completed' where id='{job}';")
    short = str(uuid4())
    sql(
        "insert into shorts_mvp.generated_shorts(id,job_id,user_id) "
        f"values('{short}','{job}','{base.ADMIN}');"
    )
    # Cross-language captions also exist when no template was selected. The
    # old app's null contract still passes; incomplete translation does not.
    translation = {
        "schemaVersion": 4,
        "templateId": "basic",
        "translation": {
            "policy": "translated-basic-v1",
            "sourceLanguage": "ja",
            "outputLanguage": "ko",
            "requestedTemplateId": None,
        },
    }
    snapshot = {"translationOutcome": {"policy": "translated-basic-v1", "status": "ready"}}
    sql(
        "update shorts_mvp.generated_shorts set caption_render_spec="
        + base.encoded(translation)
        + ",subtitle_template_snapshot="
        + base.encoded(snapshot)
        + f" where id='{short}';"
    )
    invalid = json.loads(json.dumps(translation))
    invalid["translation"].pop("requestedTemplateId")
    base.assert_rejected(
        "update shorts_mvp.generated_shorts set caption_render_spec="
        + base.encoded(invalid)
        + f" where id='{short}';",
        "generated_shorts_subtitle_template_check",
    )
    unavailable = {"translationOutcome": {"status": "unavailable"}}
    sql(
        "update shorts_mvp.generated_shorts set caption_render_spec=null,"
        "subtitle_template_snapshot=" + base.encoded(unavailable) + f" where id='{short}';"
    )
    sql(
        "insert into shorts_mvp.editor_render_requests values("
        f"gen_random_uuid(),'{short}','{base.ADMIN}','{base.NEW}','canary');"
    )
    base.assert_rejected(
        "insert into shorts_mvp.editor_render_requests values("
        f"gen_random_uuid(),'{short}','{base.ADMIN}','{base.OLD}','stable');",
        "LANGUAGE_TEST_EDITOR_BINDING_MISMATCH",
    )
    base.assert_rejected(insert(test=True), "LANGUAGE_TEST_UNAVAILABLE")
    # A missing experiment setting must not affect the original trigger branch.
    sql("alter table shorts_mvp.language_test_settings rename to temporarily_unavailable;")
    sql(insert(user=base.USER))
    sql("alter table shorts_mvp.temporarily_unavailable rename to language_test_settings;")
    assert base.flags() == before_flags
    assert sql("select count(*) from shorts_mvp.test_usage_reservations;") == "0"
