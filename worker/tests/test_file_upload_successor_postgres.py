"""Opt-in receiver successor SQL tests; never connect to an application DB.

FILE_UPLOAD_SUCCESSOR_TEST_CONTAINER must name an explicitly labelled local
PostgreSQL container with network=none, no published ports, and disposable data.
"""

from __future__ import annotations

import json
import os
import re
import select
import subprocess
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

CONTAINER = os.environ.get("FILE_UPLOAD_SUCCESSOR_TEST_CONTAINER", "")
pytestmark = pytest.mark.skipif(not CONTAINER, reason="requires isolated opt-in PostgreSQL")
ROOT = Path(__file__).parents[2]
MIGRATION = ROOT / "supabase/migrations/202608310002_file_upload_successor.sql"
PREVIOUS = ROOT / "supabase/migrations/202608300001_file_upload_verified_release_gate.sql"
ADMIN = "9700c083-60a3-4d5a-9ac1-732e9991fb98"
USER = "1246e859-bb7d-4752-a848-e82be5999b47"
OLD = "41b2a092-b09c-4787-b715-0b1d4b9af4c3"
NEW = "e3fa0eb4-c51d-4d70-bb74-c485660d253a"
PROBE = "9e652082-0784-429b-9ab9-179df0b1c850"
JOB = "05d791f1-f6cc-4111-a859-4c3e43da106c"
SESSION = "aa3adfcb-f64c-416e-8c69-678252c165d3"
OLD_SHA, NEW_SHA, FONT = "a" * 40, "b" * 40, "c" * 64
OLD_IMAGE, NEW_IMAGE = f"sha256:{'a' * 64}", f"sha256:{'b' * 64}"
CHECKS = [
    "admin_end_to_end",
    "render_parity",
    "upload_1gb",
    "upload_5gb",
    "source_cleanup",
    "usage_integrity",
    "runtime_identity",
    "no_proxy_environment",
    "no_stuck_sessions",
]
ISOLATED_CHECKS = [
    "browser-parity-worker-matrix",
    "browser-worker-visual-parity",
    "caption-render-spec-v4",
    "captured-timeline",
    "editor-v2",
    "ffprobe",
    "font-fallback",
    "font-manifest",
    "frame-parity",
    "legacy-no-timeline",
    "render-spec-v4",
    "runtime-identity",
    "worker-caption-noop-parity",
    "worker-image",
    "worker-title-compositor-parity",
]
TARGETS = [
    "legacy_project",
    "source_range",
    "elevenlabs_transcription",
    "subtitle_templates",
    "unified_template_subtitles",
]


def command() -> list[str]:
    return [
        "/usr/local/bin/docker",
        "exec",
        "-i",
        CONTAINER,
        "psql",
        "-X",
        "-q",
        "-A",
        "-t",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "postgres",
        "-d",
        "file_upload_successor_test",
    ]


def sql(statement: str) -> str:
    result = subprocess.run(
        command(),
        input=statement,
        text=True,
        capture_output=True,
        timeout=20,
        check=True,
    )
    return result.stdout.strip()


def encoded(value: object) -> str:
    return "'" + json.dumps(value).replace("'", "''") + "'::jsonb"


def observed(delta: timedelta = timedelta(seconds=-1)) -> str:
    return (datetime.now(UTC) + delta).isoformat()


def identity(*, old: bool = False) -> dict:
    return {
        "releaseId": OLD if old else NEW,
        "sourceGitSha": OLD_SHA if old else NEW_SHA,
        "workerImageDigest": OLD_IMAGE if old else NEW_IMAGE,
        "fontManifestSha256": FONT,
        "renderSpecVersion": 4,
        "captionRenderSpecVersion": 4,
    }


def readiness(*, old: bool = False) -> dict:
    return {
        **identity(old=old),
        "observedAt": observed(),
        "evidenceId": "local-ready-observation",
        "inventorySha256": "d" * 64,
        "readyReceiverCount": 1,
        "allReadyImagesMatch": True,
        "oldTaskCount": 0,
        "oldTargetCount": 0,
        "protectedTaskCount": 0,
        "capacityWaitingCount": 0,
        "capacityGrantedCount": 0,
        "capacityClaimedCount": 0,
    }


def checks() -> dict:
    return {
        key: {
            "passed": True,
            "details": {
                **identity(),
                "evidenceId": f"observed-{key}",
                "observedAt": observed(),
            },
        }
        for key in CHECKS
    }


def expected() -> str:
    return f"'{OLD}','{OLD_SHA}','{OLD_IMAGE}'"


def begin(*, actor: str = ADMIN) -> dict:
    return json.loads(
        sql(f"select shorts_mvp.begin_file_upload_successor({expected()},'{NEW}','{actor}');")
    )


def ready(operation: dict, evidence: dict | None = None) -> dict:
    return json.loads(
        sql(
            "select shorts_mvp.ready_file_upload_successor("
            f"'{operation['id']}',{expected()},{encoded(evidence or readiness())},'{ADMIN}');"
        )
    )


def promote(operation: dict, evidence: dict | None = None) -> dict:
    recorded_checks = evidence if evidence is not None else checks()
    return json.loads(
        sql(
            "select shorts_mvp.promote_file_upload_successor("
            f"'{operation['id']}',{expected()},{encoded(recorded_checks)},"
            f"{encoded(readiness())},'{ADMIN}');"
        )
    )


def insert_job(*, user: str = USER, release: str = OLD, source: str = "upload") -> str:
    return (
        "insert into shorts_mvp.video_jobs(id,source_type,status,user_id,"
        "initial_editor_release_id,initial_render_spec_version,initial_caption_render_spec_version)"
        f" values ('{JOB}','{source}','uploading','{user}','{release}',4,4);"
    )


def assert_rejected(statement: str, message: str) -> None:
    with pytest.raises(subprocess.CalledProcessError) as error:
        sql(statement)
    assert message in error.value.stderr


@pytest.fixture(scope="module", autouse=True)
def isolated_database():
    assert re.fullmatch(r"shorts-file-upload-successor-test-[a-z0-9-]{1,80}", CONTAINER)
    inspected = subprocess.run(
        ["/usr/local/bin/docker", "inspect", CONTAINER],
        text=True,
        capture_output=True,
        check=True,
        timeout=10,
    )
    container = json.loads(inspected.stdout)[0]
    assert container["HostConfig"]["NetworkMode"] == "none"
    assert not container["HostConfig"].get("PortBindings")
    assert container["Config"]["Labels"].get("easycut.test-scope") == "file-upload-successor"
    sql("""
      do $$ begin
        if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
        if not exists(select 1 from pg_roles where rolname='authenticated') then
          create role authenticated;
        end if;
        if not exists(select 1 from pg_roles where rolname='service_role') then
          create role service_role bypassrls;
        end if;
      end $$;
      create schema if not exists shorts_mvp;
      grant usage on schema shorts_mvp to service_role,anon,authenticated;
      create table if not exists shorts_mvp.app_users(id uuid primary key,is_admin boolean);
      alter table shorts_mvp.app_users add column if not exists withdrawn_at timestamptz;
      create table if not exists shorts_mvp.runtime_feature_flags(
        flag_key text primary key,enabled boolean,updated_by_user_id uuid,
        updated_at timestamptz default clock_timestamp()
      );
      create table if not exists shorts_mvp.file_upload_release_checks(
        check_key text primary key,passed boolean,details jsonb,verified_at timestamptz,
        verified_by_user_id uuid,updated_at timestamptz default clock_timestamp()
      );
      create table if not exists shorts_mvp.admin_audit_logs(
        actor_user_id uuid,action text,entity_type text,entity_id text,metadata jsonb
      );
      create table if not exists shorts_mvp.editor_release_state(
        singleton boolean primary key,stable_release_id uuid,candidate_release_id uuid,
        render_v4_kill_switch boolean,render_v4_infra_lease_id uuid,
        render_v4_infra_lease_expires_at timestamptz
      );
      create table if not exists shorts_mvp.editor_releases(
        id uuid primary key,git_sha text,worker_image_digest text,font_manifest_sha256 text,
        render_spec_version integer,caption_render_spec_version integer,status text,
        staging_verified_at timestamptz,promoted_at timestamptz
      );
      create table if not exists shorts_mvp.editor_release_probe_runs(
        id uuid primary key,finalized_release_id uuid,state text,git_sha text,
        worker_image_digest text,font_manifest_sha256 text,artifact_uri text,
        manifest_sha256 text,manifest_s3_version_id text,
        matrix_sha256 text,matrix_s3_version_id text
      );
      create table if not exists shorts_mvp.editor_release_checks(
        release_id uuid,environment text,check_name text,
        status text,details jsonb,artifact_uri text,
        primary key(release_id,environment,check_name)
      );
      create table if not exists shorts_mvp.editor_release_project_targets(
        release_id uuid,target_key text,worker_source_git_sha text,worker_image_digest text,
        primary key(release_id,target_key)
      );
      create table if not exists shorts_mvp.video_jobs(
        id uuid primary key,source_type text,status text,
        user_id uuid,initial_editor_release_id uuid,
        initial_render_spec_version integer,initial_caption_render_spec_version integer
      );
      create table if not exists shorts_mvp.upload_sessions(
        id uuid primary key,job_id uuid,status text,expires_at timestamptz
      );
      create table if not exists shorts_mvp.file_upload_capacity_requests(
        id uuid primary key,status text,queue_expires_at timestamptz,upload_expires_at timestamptz
      );
      create table if not exists shorts_mvp.test_usage_reservations(job_id uuid);
      grant insert,select on shorts_mvp.video_jobs to service_role;
    """)
    sql(PREVIOUS.read_text())
    sql(MIGRATION.read_text())


@pytest.fixture(autouse=True)
def reset_data(isolated_database):
    sql("""
      truncate shorts_mvp.app_users,shorts_mvp.runtime_feature_flags,
        shorts_mvp.file_upload_release_checks,shorts_mvp.admin_audit_logs,
        shorts_mvp.editor_release_state,shorts_mvp.editor_releases,
        shorts_mvp.editor_release_probe_runs,shorts_mvp.editor_release_checks,
        shorts_mvp.editor_release_project_targets,shorts_mvp.video_jobs,
        shorts_mvp.upload_sessions,shorts_mvp.file_upload_capacity_requests,
        shorts_mvp.test_usage_reservations;
    """)
    sql(f"""
      insert into shorts_mvp.app_users(id,is_admin) values ('{ADMIN}',true),('{USER}',false);
      insert into shorts_mvp.runtime_feature_flags(flag_key,enabled) values
        ('file_upload',true),('file_upload_public',true),('file_upload_emergency_stop',false),
        ('editor_rendering_v2',true);
      insert into shorts_mvp.editor_release_state values(true,'{OLD}','{NEW}',false,null,null);
      insert into shorts_mvp.editor_releases values
        ('{OLD}','{OLD_SHA}','{OLD_IMAGE}','{FONT}',4,4,'stable',now(),now()),
        ('{NEW}','{NEW_SHA}','{NEW_IMAGE}','{FONT}',4,4,'canary_ready',now(),null);
      insert into shorts_mvp.editor_release_probe_runs values(
        '{PROBE}','{NEW}','finalized','{NEW_SHA}','{NEW_IMAGE}','{FONT}',
        's3://private-test-artifacts/receiver/manifest.json',repeat('d',64),'manifest-v1',
        repeat('e',64),'matrix-v1'
      );
    """)
    inserts: list[str] = []
    for key in CHECKS:
        inserts.append(
            "insert into shorts_mvp.file_upload_release_checks"
            "(check_key,passed,details,verified_at) values "
            f"('{key}',true,{encoded(identity(old=True))},now()-interval '3 days');"
        )
    for key in ISOLATED_CHECKS:
        details = {
            "probeRunId": PROBE,
            "customTemplateDesign": {
                "version": 1,
                "passed": True,
                "wrapRevision": "editor-text-v1",
                **identity(),
            },
        }
        inserts.append(
            "insert into shorts_mvp.editor_release_checks values "
            f"('{NEW}','isolated','{key}','passed',{encoded(details)},"
            "'s3://private-test-artifacts/receiver/manifest.json');"
        )
    for key in TARGETS:
        inserts.append(
            "insert into shorts_mvp.editor_release_project_targets values "
            f"('{NEW}','{key}','{NEW_SHA}','{NEW_IMAGE}');"
        )
    sql("\n".join(inserts))


def test_start_and_migration_replay_preserve_published_checks_and_flags():
    before = sql(
        "select jsonb_agg(to_jsonb(c) order by check_key) "
        "from shorts_mvp.file_upload_release_checks c;"
    )
    operation = begin()
    assert operation["phase"] == "draining"
    sql(MIGRATION.read_text())
    after = json.loads(
        sql(
            "select jsonb_agg(to_jsonb(c) order by check_key) "
            "from shorts_mvp.file_upload_release_checks c;"
        )
    )
    for row in after:
        row["successor"] = None
    assert after == json.loads(before)
    assert (
        sql(
            "select enabled from shorts_mvp.runtime_feature_flags "
            "where flag_key='file_upload_public';"
        )
        == "t"
    )


def test_old_check_recording_cannot_clear_a_handoff():
    operation = begin()
    sql(
        "select shorts_mvp.record_file_upload_release_check('runtime_identity',true,"
        f"{encoded(identity(old=True))},'{ADMIN}');"
    )
    assert (
        json.loads(
            sql(
                "select successor from shorts_mvp.file_upload_release_checks "
                "where check_key='runtime_identity';"
            )
        )
        == operation
    )


@pytest.mark.parametrize(
    "field,value", [("release", NEW), ("source", NEW_SHA), ("image", NEW_IMAGE)]
)
def test_start_compares_old_release_source_and_image(field, value):
    values = {"release": OLD, "source": OLD_SHA, "image": OLD_IMAGE}
    values[field] = value
    assert_rejected(
        "select shorts_mvp.begin_file_upload_successor("
        f"'{values['release']}','{values['source']}','{values['image']}','{NEW}','{ADMIN}');",
        "compare-and-swap failed",
    )


def test_non_admin_and_private_helpers_are_rejected():
    assert_rejected(
        f"select shorts_mvp.begin_file_upload_successor({expected()},'{NEW}','{USER}');",
        "administrator required",
    )
    assert_rejected(
        "set role service_role; select shorts_mvp._verified_file_upload_successor_identity("
        f"'{NEW}','{FONT}');",
        "permission denied",
    )
    assert_rejected(
        "set role anon; select shorts_mvp.begin_file_upload_successor("
        f"{expected()},'{NEW}','{ADMIN}');",
        "permission denied",
    )


def test_withdrawn_administrator_cannot_start_successor():
    sql(f"update shorts_mvp.app_users set withdrawn_at=now() where id='{ADMIN}';")
    assert_rejected(
        f"select shorts_mvp.begin_file_upload_successor({expected()},'{NEW}','{ADMIN}');",
        "administrator required",
    )


@pytest.mark.parametrize(
    "tamper",
    [
        f"update shorts_mvp.editor_releases set render_spec_version=3 where id='{NEW}';",
        f"update shorts_mvp.editor_releases set caption_render_spec_version=3 where id='{NEW}';",
        "update shorts_mvp.editor_releases set font_manifest_sha256=repeat('d',64) "
        f"where id='{NEW}';",
        "update shorts_mvp.editor_release_probe_runs set state='evidence_verified';",
        "update shorts_mvp.editor_release_probe_runs set manifest_s3_version_id=null;",
        "update shorts_mvp.editor_release_probe_runs set matrix_s3_version_id=null;",
        "update shorts_mvp.editor_release_probe_runs set git_sha=repeat('d',40);",
        "update shorts_mvp.editor_release_probe_runs "
        "set worker_image_digest='sha256:'||repeat('d',64);",
        "update shorts_mvp.editor_release_checks set details='{}'::jsonb "
        "where check_name='render-spec-v4';",
        "update shorts_mvp.editor_release_checks set status='failed' where check_name='ffprobe';",
        "update shorts_mvp.editor_release_checks set artifact_uri='s3://wrong/manifest.json' "
        "where check_name='render-spec-v4';",
        "update shorts_mvp.editor_release_project_targets set worker_source_git_sha=repeat('d',40) "
        "where target_key='legacy_project';",
        "update shorts_mvp.editor_release_state set render_v4_kill_switch=true;",
    ],
)
def test_new_identity_requires_attested_capability_all_checks_and_same_font(tamper):
    sql(tamper)
    assert_rejected(
        f"select shorts_mvp.begin_file_upload_successor({expected()},'{NEW}','{ADMIN}');",
        "file upload successor",
    )


def test_draining_blocks_old_web_before_jobs_or_usage_but_not_youtube():
    begin()
    assert_rejected(
        "begin;"
        + insert_job()
        + f"insert into shorts_mvp.test_usage_reservations values('{JOB}'); commit;",
        "retry without usage reservation",
    )
    assert sql("select count(*) from shorts_mvp.video_jobs;") == "0"
    assert sql("select count(*) from shorts_mvp.test_usage_reservations;") == "0"
    sql(insert_job(source="youtube"))


@pytest.mark.parametrize(
    "active",
    [
        insert_job(),
        "insert into shorts_mvp.upload_sessions values"
        f"('{SESSION}','{JOB}','claimed',now()-interval '1 day');",
        "insert into shorts_mvp.upload_sessions values"
        f"('{SESSION}','{JOB}','awaiting_upload',now()+interval '1 minute');",
        "insert into shorts_mvp.file_upload_capacity_requests values"
        f"('{SESSION}','waiting',now()+interval '1 minute',null);",
        "insert into shorts_mvp.file_upload_capacity_requests values"
        f"('{SESSION}','granted',now(),now()+interval '1 minute');",
    ],
)
def test_ready_waits_for_pending_active_granted_and_claimed_work(active):
    sql(active)
    operation = begin()
    assert_rejected(
        "select shorts_mvp.ready_file_upload_successor("
        f"'{operation['id']}',{expected()},{encoded(readiness())},'{ADMIN}');",
        "sessions or jobs have not drained",
    )


@pytest.mark.parametrize(
    "key",
    [
        "oldTaskCount",
        "oldTargetCount",
        "protectedTaskCount",
        "capacityWaitingCount",
        "capacityGrantedCount",
        "capacityClaimedCount",
    ],
)
def test_ready_requires_aws_task_target_and_capacity_drain_evidence(key):
    operation = begin()
    evidence = readiness()
    evidence[key] = 1
    assert_rejected(
        "select shorts_mvp.ready_file_upload_successor("
        f"'{operation['id']}',{expected()},{encoded(evidence)},'{ADMIN}');",
        "receiver or capacity has not drained",
    )


def test_completed_grants_do_not_block_and_only_exact_admin_successor_is_admitted():
    sql(f"""
      insert into shorts_mvp.upload_sessions
        values('{SESSION}','{JOB}','completed',now()+interval '1 minute');
      insert into shorts_mvp.file_upload_capacity_requests
        values('{SESSION}','granted',now(),now()+interval '1 minute');
    """)
    operation = ready(begin())
    assert operation["phase"] == "admin_test"
    assert_rejected(insert_job(release=NEW), "retry without usage reservation")
    assert_rejected(insert_job(user=ADMIN), "retry without usage reservation")
    sql(insert_job(user=ADMIN, release=NEW))


def test_mutated_attestation_after_ready_blocks_both_direct_insert_and_promotion():
    operation = ready(begin())
    sql("update shorts_mvp.editor_release_checks set status='failed' where check_name='ffprobe';")
    assert_rejected(insert_job(user=ADMIN, release=NEW), "isolated checks are incomplete")
    assert_rejected(
        "select shorts_mvp.promote_file_upload_successor("
        f"'{operation['id']}',{expected()},{encoded(checks())},{encoded(readiness())},'{ADMIN}');",
        "isolated checks are incomplete",
    )


def test_successor_does_not_rewrite_preexisting_jobs_or_sessions():
    sql(insert_job())
    sql(f"update shorts_mvp.video_jobs set status='completed' where id='{JOB}';")
    sql(f"insert into shorts_mvp.upload_sessions values"
        f"('{SESSION}','{JOB}','completed',now()-interval '1 minute');")
    before = sql("select jsonb_build_object('job',to_jsonb(j),'session',to_jsonb(s)) "
                 "from shorts_mvp.video_jobs j cross join shorts_mvp.upload_sessions s;")
    promote(ready(begin()))
    after = sql("select jsonb_build_object('job',to_jsonb(j),'session',to_jsonb(s)) "
                "from shorts_mvp.video_jobs j cross join shorts_mvp.upload_sessions s;")
    assert before == after


@pytest.mark.parametrize("public", [True, False])
def test_promotion_atomically_replaces_nine_observed_checks_without_resetting_flags(public):
    operation = ready(begin())
    sql(
        f"update shorts_mvp.runtime_feature_flags set enabled={'true' if public else 'false'} "
        "where flag_key='file_upload_public';"
    )
    flags_before = sql(
        "select jsonb_agg(to_jsonb(f) order by flag_key) from shorts_mvp.runtime_feature_flags f;"
    )
    evidence = checks()
    assert promote(operation, evidence)["releaseId"] == NEW
    assert (
        sql(
            "select jsonb_agg(to_jsonb(f) order by flag_key) "
            "from shorts_mvp.runtime_feature_flags f;"
        )
        == flags_before
    )
    rows = json.loads(
        sql(
            "select jsonb_agg(to_jsonb(c) order by check_key) "
            "from shorts_mvp.file_upload_release_checks c;"
        )
    )
    assert len(rows) == 9
    for row in rows:
        assert row["passed"] is True and row["successor"] is None
        assert row["details"] == evidence[row["check_key"]]["details"]
        assert datetime.fromisoformat(row["verified_at"]) == datetime.fromisoformat(
            row["details"]["observedAt"]
        )


@pytest.mark.parametrize(
    "invalid", ["missing", "extra", "failed", "old", "future", "infinite", "wrong_image"]
)
def test_promotion_requires_exact_nine_fresh_identity_bound_passes_and_is_atomic(invalid):
    operation = ready(begin())
    evidence = checks()
    if invalid == "missing":
        evidence.pop("upload_5gb")
    elif invalid == "extra":
        evidence["pretend_check"] = evidence["upload_5gb"]
    elif invalid == "failed":
        evidence["usage_integrity"]["passed"] = False
    elif invalid == "old":
        evidence["usage_integrity"]["details"]["observedAt"] = observed(timedelta(hours=-25))
    elif invalid == "future":
        evidence["usage_integrity"]["details"]["observedAt"] = observed(timedelta(minutes=1))
    elif invalid == "infinite":
        evidence["usage_integrity"]["details"]["observedAt"] = "infinity"
    elif invalid == "wrong_image":
        evidence["usage_integrity"]["details"]["workerImageDigest"] = OLD_IMAGE
    before = sql(
        "select jsonb_agg(to_jsonb(c) order by check_key) "
        "from shorts_mvp.file_upload_release_checks c;"
    )
    assert_rejected(
        "select shorts_mvp.promote_file_upload_successor("
        f"'{operation['id']}',{expected()},{encoded(evidence)},{encoded(readiness())},'{ADMIN}');",
        "file upload successor",
    )
    assert (
        sql(
            "select jsonb_agg(to_jsonb(c) order by check_key) "
            "from shorts_mvp.file_upload_release_checks c;"
        )
        == before
    )


def test_expired_successor_stays_fenced_and_cancellation_requires_old_receiver_restoration():
    operation = ready(begin())
    sql(
        "update shorts_mvp.file_upload_release_checks set successor=jsonb_set(successor,"
        "'{expiresAt}',to_jsonb((now()-interval '1 minute')::text)) "
        "where check_key='runtime_identity';"
    )
    assert_rejected(insert_job(user=ADMIN, release=NEW), "retry without usage reservation")
    assert_rejected(
        "select shorts_mvp.cancel_file_upload_successor("
        f"'{operation['id']}',{expected()},{encoded(readiness())},'{ADMIN}');",
        "readiness identity does not match",
    )
    sql(
        "select shorts_mvp.cancel_file_upload_successor("
        f"'{operation['id']}',{expected()},{encoded(readiness(old=True))},'{ADMIN}');"
    )
    assert (
        sql(
            "select successor is null from shorts_mvp.file_upload_release_checks "
            "where check_key='runtime_identity';"
        )
        == "t"
    )
    assert (
        sql(
            "select enabled from shorts_mvp.runtime_feature_flags "
            "where flag_key='file_upload_public';"
        )
        == "t"
    )


def test_inflight_old_admission_cannot_cross_the_begin_fence():
    transaction = subprocess.Popen(
        command(), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
    )
    attempt: subprocess.Popen[str] | None = None
    try:
        assert transaction.stdin and transaction.stdout
        transaction.stdin.write(
            "begin; select shorts_mvp.begin_file_upload_successor("
            f"{expected()},'{NEW}','{ADMIN}');\n"
        )
        transaction.stdin.flush()
        assert select.select([transaction.stdout], [], [], 10)[0]
        json.loads(transaction.stdout.readline())
        attempt = subprocess.Popen(
            command(),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        assert attempt.stdin and attempt.stdout
        attempt.stdin.write(insert_job() + "\n")
        attempt.stdin.close()
        attempt.stdin = None
        assert not select.select([attempt.stdout], [], [], 0.2)[0]
        transaction.stdin.write("commit;\n")
        transaction.stdin.flush()
        _, error = attempt.communicate(timeout=10)
        assert attempt.returncode != 0
        assert "retry without usage reservation" in error
        assert sql("select count(*) from shorts_mvp.video_jobs;") == "0"
    finally:
        if transaction.poll() is None:
            if transaction.stdin:
                transaction.stdin.close()
            transaction.wait(timeout=10)
        if attempt and attempt.poll() is None:
            attempt.kill()
            attempt.wait(timeout=5)
