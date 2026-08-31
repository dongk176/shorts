"""Opt-in project successor SQL tests in an explicitly isolated PostgreSQL.

PROJECT_TARGET_SUCCESSOR_TEST_CONTAINER must name a disposable, labelled
network-none container. No application DATABASE_URL or AWS credentials are used.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import select
import subprocess
import time
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest

CONTAINER = os.environ.get("PROJECT_TARGET_SUCCESSOR_TEST_CONTAINER", "")
pytestmark = pytest.mark.skipif(not CONTAINER, reason="requires isolated opt-in PostgreSQL")
MIGRATION = (
    Path(__file__).parents[2] / "supabase/migrations/202608310003_project_target_successor.sql"
)
ADMIN = "9dac7ecf-44c0-445d-a2de-3b5b841f9d50"
USER = "7322829c-de28-4d3a-9332-3d704895cf9e"
OLD = "0652212b-2e6b-419c-bbfa-07488a986b73"
NEW = "0f5d16c8-6706-454a-bd8f-0a1e268f7b1a"
PROBE = "6dbff25d-316e-46f4-9a04-9926e3048035"
JOB = "a8b2d2c2-4b6a-4fd0-94c8-ccdcab6bad79"
OLD_SHA, NEW_SHA, FONT = "a" * 40, "b" * 40, "c" * 64
OLD_IMAGE, NEW_IMAGE = f"sha256:{'a' * 64}", f"sha256:{'b' * 64}"
REPOSITORY = "123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/shorts-worker"
BATCH = "arn:aws:batch:ap-northeast-2:123456789012:"
ARTIFACT = "s3://private-test-artifacts/successor/manifest.json"
TARGETS = [
    "legacy_project",
    "source_range",
    "elevenlabs_transcription",
    "subtitle_templates",
    "unified_template_subtitles",
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
        "project_target_successor_test",
    ]


def sql(statement: str) -> str:
    try:
        result = subprocess.run(
            command(),
            input=statement,
            text=True,
            capture_output=True,
            timeout=20,
            check=True,
        )
    except subprocess.CalledProcessError as error:
        error.add_note(error.stderr)
        raise
    return result.stdout.strip()


def encoded(value: object) -> str:
    return "'" + json.dumps(value).replace("'", "''") + "'::jsonb"


def digest(value: object) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def definition(key: str, *, old: bool = False) -> str:
    source = OLD_SHA if old else NEW_SHA
    return f"{BATCH}job-definition/local-{key}-{source[:7]}:1"


def target(key: str, *, old: bool = False) -> dict:
    return {
        "releaseId": f"{key}-{'previous' if old else 'successor'}",
        "workerSourceGitSha": OLD_SHA if old else NEW_SHA,
        "imageUri": f"{REPOSITORY}@{OLD_IMAGE if old else NEW_IMAGE}",
        "jobDefinitionArn": definition(key, old=old),
        "jobQueueArn": f"{BATCH}job-queue/local-{key}",
        "renderSpecVersion": 4,
        "captionRenderSpecVersion": 4,
        "fontManifestSha256": FONT,
    }


def registry(*, old: bool = False) -> dict:
    return {
        "version": 1,
        "environment": "production",
        "lanes": {
            key: {
                "current": target(key, old=old),
                "previous": None
                if old
                else {
                    **target(key, old=True),
                    "submitAsReleaseId": target(key, old=True)["releaseId"],
                },
                "schedulingMode": "fifo" if key == "unified_template_subtitles" else "fair_share",
            }
            for key in TARGETS
        },
    }


def predecessor() -> dict:
    return {
        "version": 1,
        "predecessorReleaseId": OLD,
        "sourceGitSha": OLD_SHA,
        "workerImageDigest": OLD_IMAGE,
        "fontManifestSha256": FONT,
        "editor": {"jobDefinitionArn": definition("editor", old=True), "contractSha256": "d" * 64},
        "projectTargets": {
            key: {
                "batchTargetReleaseId": target(key, old=True)["releaseId"],
                "workerSourceGitSha": OLD_SHA,
                "workerImageDigest": OLD_IMAGE,
                "jobDefinitionArn": definition(key, old=True),
                "jobQueueArn": target(key)["jobQueueArn"],
                "contractSha256": "d" * 64,
            }
            for key in TARGETS
        },
    }


def binding() -> dict:
    return {
        "base": "e" * 40,
        "head": "f" * 40,
        "oldRegistry": registry(old=True),
        "newRegistry": registry(),
        "oldRegistrySha256": digest(registry(old=True)),
        "newRegistrySha256": digest(registry()),
        "oldRuntime": runtime(old=True),
    }


def runtime(*, old: bool = False) -> dict:
    return {
        "observedAt": (datetime.now(UTC) - timedelta(seconds=1)).isoformat(),
        "registrySha256": digest(registry(old=old)),
        "allTargetsMatch": True,
        **{
            key: "e" * 64
            for key in [
                "editorTemplateSha256",
                "computeTemplateSha256",
                "registrarCodeSha256",
                "submitterCodeSha256",
                "inventorySha256",
            ]
        },
    }


def begin_statement(*, actor: str = ADMIN, value: dict | None = None) -> str:
    return (
        "select shorts_mvp.begin_project_target_successor("
        f"'{OLD}','{NEW}',{encoded(value if value is not None else binding())},'{actor}');"
    )


def begin(*, actor: str = ADMIN, value: dict | None = None) -> dict:
    return json.loads(sql(begin_statement(actor=actor, value=value)))


def transition(operation: dict, action: str, evidence: dict | None = None) -> dict:
    observation = evidence if evidence is not None else runtime(old=action == "cancel")
    if action == "cancel" and evidence is None:
        observation["candidateActiveJobs"] = 0
    return json.loads(
        sql(
            "select shorts_mvp.transition_project_target_successor("
            f"'{operation['id']}','{action}',"
            f"{encoded(observation)},'{ADMIN}');"
        )
    )


def ready() -> dict:
    return transition(begin(), "ready")


def promote_release() -> None:
    # Simulate only the already separately tested web CAS promotion; no flags reset.
    sql(f"""
      update shorts_mvp.editor_releases set status='stable',promoted_at=now() where id='{NEW}';
      update shorts_mvp.editor_release_state set stable_release_id='{NEW}',
        previous_stable_release_id='{OLD}',candidate_release_id=null,canary_enabled=false;
    """)


def active() -> dict:
    operation = ready()
    promote_release()
    return transition(operation, "complete")


def insert_job(
    *,
    user: str = USER,
    old: bool = True,
    release: str | None = OLD,
    spec: int | None = 4,
    caption: int | None = 4,
    key: str = "legacy_project",
    job: str = JOB,
    source: str = "youtube",
    aws_id: str | None = None,
    status: str = "queued",
    raw: dict | None = None,
) -> str:
    selected = raw if raw is not None else target(key, old=old)
    quoted_release = f"'{release}'" if release is not None else "null"
    quoted_aws = f"'{aws_id}'" if aws_id is not None else "null"
    return (
        "insert into shorts_mvp.video_jobs(id,user_id,status,source_type,pipeline_version,"
        "batch_target_key,batch_target_release_id,batch_job_definition,batch_job_queue,"
        "initial_editor_release_id,initial_render_spec_version,initial_caption_render_spec_version,"
        "aws_batch_job_id) values ("
        f"'{job}','{user}','{status}','{source}',2,'{key}','{selected['releaseId']}',"
        f"'{selected['jobDefinitionArn']}','{selected['jobQueueArn']}',{quoted_release},"
        f"{spec if spec is not None else 'null'},{caption if caption is not None else 'null'},"
        f"{quoted_aws});"
    )


def resolve(*, user: str = USER, old: bool = True, key: str = "legacy_project") -> str:
    selected = target(key, old=old)
    return sql(
        "select release_id from shorts_mvp.resolve_initial_render_v4_release("
        f"'{user}','{key}','{selected['releaseId']}','{selected['jobDefinitionArn']}',"
        f"'{selected['jobQueueArn']}','{OLD_IMAGE if old else NEW_IMAGE}',"
        f"'{OLD_SHA if old else NEW_SHA}');"
    )


def drain() -> dict:
    return json.loads(sql("select shorts_mvp.project_target_successor_drain();"))


def flags() -> str:
    return sql("""
      select jsonb_build_object('state',shorts_mvp._project_target_successor_flags(),
        'allRuntime',(select jsonb_agg(to_jsonb(f) order by flag_key)
          from shorts_mvp.runtime_feature_flags f));
    """)


def assert_rejected(statement: str, message: str) -> None:
    with pytest.raises(subprocess.CalledProcessError) as error:
        sql(statement)
    assert message in error.value.stderr


@pytest.fixture(scope="module", autouse=True)
def isolated_database():
    assert re.fullmatch(r"shorts-project-target-successor-test-[a-z0-9-]{1,80}", CONTAINER)
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
    assert container["Config"]["Labels"].get("easycut.test-scope") == "project-target-successor"
    assert container["HostConfig"].get("Tmpfs", {}).get("/var/lib/postgresql/data")
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
      create table if not exists shorts_mvp.app_users(
        id uuid primary key,is_admin boolean not null default false,withdrawn_at timestamptz
      );
      create table if not exists shorts_mvp.runtime_feature_flags(
        flag_key text primary key,enabled boolean not null
      );
      create table if not exists shorts_mvp.admin_audit_logs(
        actor_user_id uuid,action text,entity_type text,entity_id text,metadata jsonb
      );
      create table if not exists shorts_mvp.editor_release_state(
        singleton boolean primary key,stable_release_id uuid,candidate_release_id uuid,
        previous_stable_release_id uuid,public_enabled boolean not null,
        canary_enabled boolean not null,render_v4_internal_enabled boolean not null,
        render_v4_rollout_percent smallint not null,render_v4_kill_switch boolean not null,
        render_v4_infra_lease_id uuid,render_v4_infra_lease_owner text,
        render_v4_infra_lease_expires_at timestamptz
      );
      create table if not exists shorts_mvp.editor_releases(
        id uuid primary key,git_sha text,worker_image_digest text,font_manifest_sha256 text,
        render_spec_version smallint,caption_render_spec_version smallint,status text,
        staging_verified_at timestamptz,promoted_at timestamptz,production_job_definition_arn text
      );
      create table if not exists shorts_mvp.editor_release_probe_runs(
        id uuid primary key,finalized_release_id uuid,state text,git_sha text,
        worker_image_digest text,font_manifest_sha256 text,artifact_uri text,
        manifest_sha256 text,manifest_s3_version_id text,
        matrix_sha256 text,matrix_s3_version_id text
      );
      create table if not exists shorts_mvp.editor_release_checks(
        release_id uuid,environment text,check_name text,status text,
        details jsonb,artifact_uri text,
        primary key(release_id,environment,check_name)
      );
      create table if not exists shorts_mvp.editor_release_project_targets(
        release_id uuid,target_key text,batch_target_release_id text,
        worker_source_git_sha text,worker_image_digest text,
        job_definition_arn text,job_queue_arn text,
        primary key(release_id,target_key)
      );
      create table if not exists shorts_mvp.editor_release_testers(
        user_id uuid primary key,enabled boolean not null
      );
      create table if not exists shorts_mvp.video_jobs(
        id uuid primary key,user_id uuid,status text,source_type text,
        pipeline_version smallint not null default 2,
        project_resume_count integer not null default 0,
        aws_batch_job_id text,batch_target_key text,batch_target_release_id text,
        batch_job_definition text,batch_job_queue text,initial_editor_release_id uuid,
        initial_render_spec_version smallint,initial_caption_render_spec_version smallint,
        template_snapshot jsonb
      );
      create table if not exists shorts_mvp.project_job_outbox(job_id uuid,status text);
      create table if not exists shorts_mvp.batch_submission_claims(
        submission_key text primary key,aws_batch_job_id text
      );
      create table if not exists shorts_mvp.test_usage_reservations(job_id uuid);
      grant insert,select on shorts_mvp.video_jobs,shorts_mvp.test_usage_reservations
        to service_role;
    """)
    sql(MIGRATION.read_text())


@pytest.fixture(autouse=True)
def reset_data(isolated_database):
    sql(f"""
      truncate shorts_mvp.app_users,shorts_mvp.runtime_feature_flags,shorts_mvp.admin_audit_logs,
        shorts_mvp.editor_release_state,shorts_mvp.editor_releases,
        shorts_mvp.editor_release_probe_runs,shorts_mvp.editor_release_checks,
        shorts_mvp.editor_release_project_targets,shorts_mvp.editor_release_testers,
        shorts_mvp.video_jobs,shorts_mvp.project_job_outbox,shorts_mvp.batch_submission_claims,
        shorts_mvp.test_usage_reservations;
      insert into shorts_mvp.app_users(id,is_admin) values ('{ADMIN}',true),('{USER}',false);
      insert into shorts_mvp.runtime_feature_flags values
        ('editor_rendering_v2',true),('file_upload',true),('file_upload_public',true),
        ('editor_subtitle_editing_public',true),('custom_template_design_enabled',true),
        ('custom_template_design_public',false);
      insert into shorts_mvp.editor_release_state(singleton,stable_release_id,candidate_release_id,
        public_enabled,canary_enabled,render_v4_internal_enabled,render_v4_rollout_percent,
        render_v4_kill_switch) values(true,'{OLD}','{NEW}',true,true,false,100,false);
      insert into shorts_mvp.editor_releases values
        ('{OLD}','{OLD_SHA}','{OLD_IMAGE}','{FONT}',4,4,'stable',now(),now(),
          '{definition("editor", old=True)}'),
        ('{NEW}','{NEW_SHA}','{NEW_IMAGE}','{FONT}',4,4,'canary_ready',now(),null,
          '{definition("editor")}');
      insert into shorts_mvp.editor_release_probe_runs values(
        '{PROBE}','{NEW}','finalized','{NEW_SHA}','{NEW_IMAGE}','{FONT}',
        '{ARTIFACT}',repeat('d',64),'manifest-v1',repeat('e',64),'matrix-v1');
    """)
    statements = []
    for name in ISOLATED_CHECKS:
        details = {
            "probeRunId": PROBE,
            "compatibleSuccessor": predecessor(),
            "customTemplateDesign": {
                "version": 1,
                "passed": True,
                "wrapRevision": "editor-text-v1",
                "renderSpecVersion": 4,
                "captionRenderSpecVersion": 4,
                "sourceGitSha": NEW_SHA,
                "workerImageDigest": NEW_IMAGE,
                "fontManifestSha256": FONT,
            },
        }
        statements.append(
            "insert into shorts_mvp.editor_release_checks values "
            f"('{NEW}','isolated','{name}','passed',{encoded(details)},'{ARTIFACT}');"
        )
    for key in TARGETS:
        for old in [True, False]:
            selected = target(key, old=old)
            statements.append(
                "insert into shorts_mvp.editor_release_project_targets values "
                f"('{OLD if old else NEW}','{key}','{selected['releaseId']}',"
                f"'{OLD_SHA if old else NEW_SHA}','{OLD_IMAGE if old else NEW_IMAGE}',"
                f"'{selected['jobDefinitionArn']}','{selected['jobQueueArn']}');"
            )
    sql("\n".join(statements))


def test_migration_replay_and_fence_preserve_all_published_flags():
    before = flags()
    operation = begin()
    assert operation["phase"] == "fenced"
    assert begin() == operation
    sql(MIGRATION.read_text())
    assert flags() == before
    assert (
        json.loads(sql("select render_v4_target_successor from shorts_mvp.editor_release_state;"))
        == operation
    )


@pytest.mark.parametrize(
    "invalid",
    [
        {},
        {"version": 1},
        {"phase": "active"},
        {"version": None, "phase": "active"},
        {"version": 1, "phase": None},
    ],
)
def test_partial_successor_json_cannot_bypass_the_fence(invalid):
    assert_rejected(
        "update shorts_mvp.editor_release_state "
        f"set render_v4_target_successor={encoded(invalid)};",
        "editor_release_state_target_successor_check",
    )


@pytest.mark.parametrize("actor,withdrawn", [(USER, False), (ADMIN, True)])
def test_real_active_administrator_is_required(actor, withdrawn):
    if withdrawn:
        sql(f"update shorts_mvp.app_users set withdrawn_at=now() where id='{ADMIN}';")
    assert_rejected(begin_statement(actor=actor), "administrator required")


def test_anonymous_and_private_helper_privileges_are_closed():
    assert_rejected("set role anon;" + begin_statement(), "permission denied")
    assert_rejected("set role authenticated;" + begin_statement(), "permission denied")
    assert_rejected(
        "set role service_role; "
        "select shorts_mvp._assert_project_successor_registry('{}','{}','');",
        "permission denied",
    )
    assert json.loads(sql("set role service_role;" + begin_statement()))["phase"] == "fenced"


@pytest.mark.parametrize(
    "tamper",
    [
        "update shorts_mvp.editor_releases set font_manifest_sha256=repeat('e',64) "
        f"where id='{NEW}';",
        f"update shorts_mvp.editor_releases set render_spec_version=3 where id='{NEW}';",
        "update shorts_mvp.editor_release_probe_runs set manifest_s3_version_id=null;",
        "update shorts_mvp.editor_release_probe_runs set state='evidence_verified';",
        "update shorts_mvp.editor_release_checks set status='failed' where check_name='ffprobe';",
        "delete from shorts_mvp.editor_release_checks where check_name='worker-image';",
        "update shorts_mvp.editor_release_checks set details=jsonb_set(details,"
        "'{compatibleSuccessor,predecessorReleaseId}','\"11111111-1111-4111-8111-111111111111\"') "
        "where check_name='render-spec-v4';",
        "update shorts_mvp.editor_release_project_targets set job_queue_arn='wrong' "
        f"where release_id='{NEW}' and target_key='legacy_project';",
    ],
)
def test_begin_requires_same_font_predecessor_fifteen_checks_and_exact_targets(tamper):
    sql(tamper)
    assert_rejected(begin_statement(), "project successor")
    assert (
        sql("select render_v4_target_successor is null from shorts_mvp.editor_release_state;")
        == "t"
    )


def test_different_controller_cannot_replace_a_durable_fence():
    operation = begin()
    changed = binding()
    changed["head"] = "d" * 40
    assert_rejected(begin_statement(value=changed), "another durable project successor fence")
    assert begin() == operation


def test_fence_blocks_old_web_and_null_specs_before_atomic_usage_reservation():
    begin()
    assert resolve() == ""
    for old in [True, False]:
        assert_rejected(
            "begin; set local role service_role;"
            f"insert into shorts_mvp.test_usage_reservations values('{JOB}');"
            + insert_job(old=old, release=None, spec=None, caption=None)
            + "commit;",
            "INITIAL_RENDER_RELEASE_HANDOFF",
        )
    assert sql("select count(*) from shorts_mvp.video_jobs;") == "0"
    assert sql("select count(*) from shorts_mvp.test_usage_reservations;") == "0"


def test_expired_or_cleared_infrastructure_lease_never_reopens_fenced_admission():
    operation = begin()
    sql("""
      update shorts_mvp.editor_release_state set render_v4_infra_lease_id=gen_random_uuid(),
        render_v4_infra_lease_owner='expired-test',
        render_v4_infra_lease_expires_at=now()-interval '1 day';
    """)
    assert_rejected(
        insert_job(release=None, spec=None, caption=None), "INITIAL_RENDER_RELEASE_HANDOFF"
    )
    sql("""
      update shorts_mvp.editor_release_state set render_v4_infra_lease_id=null,
        render_v4_infra_lease_owner=null,render_v4_infra_lease_expires_at=null,
        render_v4_kill_switch=true;
      update shorts_mvp.runtime_feature_flags set enabled=false;
    """)
    assert_rejected(
        insert_job(release=None, spec=None, caption=None), "INITIAL_RENDER_RELEASE_HANDOFF"
    )
    assert (
        json.loads(sql("select render_v4_target_successor from shorts_mvp.editor_release_state;"))
        == operation
    )


@pytest.mark.parametrize("key", TARGETS)
def test_admin_ready_accepts_only_exact_administrator_candidate_for_each_lane(key):
    ready()
    sql(f"insert into shorts_mvp.editor_release_testers values('{USER}',true);")
    assert resolve(user=USER, old=False, key=key) == ""
    assert resolve(user=ADMIN, old=False, key=key) == NEW
    assert_rejected(insert_job(old=False, release=NEW, key=key), "INITIAL_RENDER_RELEASE_HANDOFF")
    assert_rejected(insert_job(user=ADMIN, key=key), "INITIAL_RENDER_RELEASE_HANDOFF")
    sql(insert_job(user=ADMIN, old=False, release=NEW, key=key))


@pytest.mark.parametrize(
    "spec,caption,release",
    [(None, None, None), (None, 4, NEW), (4, None, NEW), (3, 4, NEW), (4, 4, OLD)],
)
def test_admin_ready_rejects_missing_or_wrong_render_contract(spec, caption, release):
    ready()
    assert_rejected(
        insert_job(user=ADMIN, old=False, release=release, spec=spec, caption=caption),
        "INITIAL_RENDER_RELEASE_HANDOFF",
    )


@pytest.mark.parametrize(
    "stop",
    [
        "update shorts_mvp.editor_release_state set canary_enabled=false;",
        "update shorts_mvp.editor_release_state set render_v4_kill_switch=true;",
        "update shorts_mvp.runtime_feature_flags set enabled=false "
        "where flag_key='editor_rendering_v2';",
        f"update shorts_mvp.app_users set withdrawn_at=now() where id='{ADMIN}';",
        "update shorts_mvp.editor_release_checks set status='failed' where check_name='ffprobe';",
    ],
)
def test_admin_ready_stops_if_authority_runtime_or_evidence_changes(stop):
    ready()
    sql(stop)
    assert (
        sql(f"select shorts_mvp.editor_target_successor_admin_release('{ADMIN}') is null;") == "t"
    )
    assert_rejected(
        insert_job(user=ADMIN, old=False, release=NEW), "INITIAL_RENDER_RELEASE_HANDOFF"
    )


def test_active_pin_and_promotion_preserve_flags_and_preexisting_rows():
    sql(insert_job(status="rendering", aws_id="prior-batch-id"))
    snapshot = {
        "config": {
            "background": {"kind": "uploaded_image", "assetId": str(uuid4())},
            "textOverlays": [{"text": "kept"}],
        }
    }
    sql(f"update shorts_mvp.video_jobs set template_snapshot={encoded(snapshot)};")
    before_job = sql("select row_to_json(job) from shorts_mvp.video_jobs job;")
    before_flags = flags()
    operation = active()
    assert operation["phase"] == "active"
    assert operation["activeReleaseId"] == NEW
    assert flags() == before_flags
    assert sql("select row_to_json(job) from shorts_mvp.video_jobs job;") == before_job
    sql(
        "update shorts_mvp.runtime_feature_flags set enabled=false "
        "where flag_key like 'custom_template_design%';"
    )
    assert sql("select row_to_json(job) from shorts_mvp.video_jobs job;") == before_job
    sql(MIGRATION.read_text())
    assert (
        json.loads(sql("select render_v4_target_successor from shorts_mvp.editor_release_state;"))
        == operation
    )


@pytest.mark.parametrize("key", TARGETS)
def test_active_pin_rejects_old_web_target_even_for_plain_vod(key):
    active()
    assert resolve(old=False, key=key) == NEW
    assert resolve(old=True, key=key) == ""
    assert_rejected(
        insert_job(old=True, release=None, spec=None, caption=None, key=key),
        "INITIAL_RENDER_RELEASE_HANDOFF",
    )
    sql(insert_job(old=False, release=NEW, key=key))


@pytest.mark.parametrize(
    "field,value",
    [
        ("releaseId", "old-release"),
        ("jobDefinitionArn", definition("legacy_project", old=True)),
        ("jobQueueArn", f"{BATCH}job-queue/wrong"),
    ],
)
def test_active_pin_does_not_accept_partial_target_identity(field, value):
    active()
    selected = deepcopy(target("legacy_project"))
    selected[field] = value
    assert_rejected(
        insert_job(old=False, release=NEW, raw=selected), "INITIAL_RENDER_RELEASE_HANDOFF"
    )


@pytest.mark.parametrize(
    "spec,caption,release",
    [(None, None, None), (None, 4, NEW), (4, None, NEW), (3, 4, NEW), (4, 4, OLD)],
)
def test_active_public_v4_bucket_rejects_null_or_stale_contract_before_charge(
    spec, caption, release
):
    active()
    assert_rejected(
        "begin;"
        + insert_job(old=False, release=release, spec=spec, caption=caption)
        + f"insert into shorts_mvp.test_usage_reservations values('{JOB}'); commit;",
        "INITIAL_RENDER_RELEASE_HANDOFF",
    )
    assert sql("select count(*) from shorts_mvp.test_usage_reservations;") == "0"


@pytest.mark.parametrize(
    "stop",
    [
        "update shorts_mvp.editor_release_state set render_v4_kill_switch=true;",
        "update shorts_mvp.runtime_feature_flags set enabled=false "
        "where flag_key='editor_rendering_v2';",
        "update shorts_mvp.editor_release_state set public_enabled=false;",
        "update shorts_mvp.editor_release_state set render_v4_rollout_percent=0;",
    ],
)
def test_deliberate_legacy_fallback_keeps_exact_new_target_pin(stop):
    active()
    sql(stop)
    assert resolve(old=False) == ""
    assert_rejected(
        insert_job(release=None, spec=None, caption=None), "INITIAL_RENDER_RELEASE_HANDOFF"
    )
    sql(insert_job(old=False, release=None, spec=None, caption=None))


def test_rollout_bucket_outside_percentage_keeps_legacy_compatibility():
    active()
    excluded = sql("""
      select id from (select gen_random_uuid() id from generate_series(1,100)) users
      where ('x'||substr(md5(id::text||':editor-render-v4'),1,8))::bit(32)::bigint%100>=5 limit 1;
    """)
    assert excluded
    sql(
        f"insert into shorts_mvp.app_users(id) values('{excluded}');"
        "update shorts_mvp.editor_release_state set render_v4_rollout_percent=5;"
    )
    assert resolve(user=excluded, old=False) == ""
    sql(insert_job(user=excluded, old=False, release=None, spec=None, caption=None))


def test_active_infrastructure_lease_blocks_public_v4_without_retargeting():
    active()
    sql("""
      update shorts_mvp.editor_release_state set render_v4_infra_lease_id=gen_random_uuid(),
        render_v4_infra_lease_owner='other-test',
        render_v4_infra_lease_expires_at=now()+interval '1 hour';
    """)
    assert resolve(old=False) == ""
    assert_rejected(insert_job(old=False, release=NEW), "INITIAL_RENDER_RELEASE_HANDOFF")
    assert_rejected(
        insert_job(old=False, release=None, spec=None, caption=None),
        "INITIAL_RENDER_RELEASE_HANDOFF",
    )


def test_default_and_upload_paths_are_unchanged_without_a_successor_pin():
    assert resolve() == OLD
    sql(insert_job(release=None, spec=None, caption=None))
    begin()
    sql(insert_job(job=str(uuid4()), source="upload", release=None, spec=None, caption=None))


def test_drain_counts_unsubmitted_jobs_outbox_claims_and_preserves_running_current():
    sql(insert_job())
    sql(
        f"insert into shorts_mvp.project_job_outbox values('{JOB}','pending');"
        f"insert into shorts_mvp.batch_submission_claims values('project:{JOB}:0',null);"
    )
    begin()
    assert drain() == {
        "unsubmittedJobs": 1,
        "pendingOutbox": 1,
        "unsubmittedClaims": 1,
        "olderGenerationJobs": 0,
    }
    sql(
        "update shorts_mvp.video_jobs set aws_batch_job_id='batch-0',status='rendering';"
        "update shorts_mvp.project_job_outbox set status='dispatched';"
        "update shorts_mvp.batch_submission_claims set aws_batch_job_id='batch-0';"
    )
    assert all(value == 0 for value in drain().values())
    sql(
        "update shorts_mvp.video_jobs set project_resume_count=1,aws_batch_job_id=null;"
        f"insert into shorts_mvp.batch_submission_claims values('project:{JOB}:resume:1',null);"
    )
    assert drain()["unsubmittedJobs"] == 1
    assert drain()["unsubmittedClaims"] == 1
    sql(
        "update shorts_mvp.video_jobs set aws_batch_job_id='batch-1';"
        "update shorts_mvp.batch_submission_claims set aws_batch_job_id='batch-1' "
        "where submission_key like '%:resume:1';"
    )
    assert all(value == 0 for value in drain().values())


@pytest.mark.parametrize("case", ["orphan", "terminal", "mismatch"])
def test_drain_never_ignores_ambiguous_project_submission_claims(case):
    if case != "orphan":
        sql(
            insert_job(
                status="completed" if case == "terminal" else "rendering", aws_id="job-batch"
            )
        )
    claim_id = "'other-batch'" if case == "mismatch" else "null"
    sql(f"insert into shorts_mvp.batch_submission_claims values('project:{JOB}:0',{claim_id});")
    begin()
    assert drain()["unsubmittedClaims"] == 1


def test_drain_waits_for_older_generation_running_jobs_to_finish():
    selected = target("legacy_project", old=True)
    selected["jobDefinitionArn"] = f"{BATCH}job-definition/two-generations-old:1"
    selected["releaseId"] = "two-generations-old"
    sql(insert_job(status="rendering", aws_id="older-running-batch", raw=selected))
    begin()
    assert drain()["olderGenerationJobs"] == 1
    sql("update shorts_mvp.video_jobs set status='completed';")
    assert all(value == 0 for value in drain().values())


@pytest.mark.parametrize(
    "invalid", ["stale", "future", "infinite", "registry", "targets", "missing_hash"]
)
def test_transition_requires_fresh_exact_runtime_observation(invalid):
    operation = begin()
    evidence = runtime()
    if invalid in {"stale", "future"}:
        delta = timedelta(minutes=-6 if invalid == "stale" else 1)
        evidence["observedAt"] = (datetime.now(UTC) + delta).isoformat()
    elif invalid == "infinite":
        evidence["observedAt"] = "infinity"
    elif invalid == "registry":
        evidence["registrySha256"] = digest(registry(old=True))
    elif invalid == "targets":
        evidence["allTargetsMatch"] = False
    else:
        evidence.pop("submitterCodeSha256")
    assert_rejected(
        "select shorts_mvp.transition_project_target_successor("
        f"'{operation['id']}','ready',{encoded(evidence)},'{ADMIN}');",
        "project successor live runtime",
    )
    assert begin() == operation


def test_complete_requires_explicit_stable_promotion_and_flags_are_not_reset():
    operation = ready()
    assert_rejected(
        "select shorts_mvp.transition_project_target_successor("
        f"'{operation['id']}','complete',{encoded(runtime())},'{ADMIN}');",
        "stable promotion or restoration is not complete",
    )
    promote_release()
    sql("update shorts_mvp.editor_release_state set render_v4_kill_switch=true;")
    assert_rejected(
        "select shorts_mvp.transition_project_target_successor("
        f"'{operation['id']}','complete',{encoded(runtime())},'{ADMIN}');",
        "proof or public flags changed",
    )
    assert sql("select render_v4_kill_switch from shorts_mvp.editor_release_state;") == "t"


def test_cancel_requires_candidate_jobs_finished_and_retains_a_pin():
    operation = ready()
    sql(insert_job(user=ADMIN, old=False, release=NEW))
    assert_rejected(
        "select shorts_mvp.transition_project_target_successor("
        f"'{operation['id']}','cancel',{encoded(runtime(old=True))},'{ADMIN}');",
        "project successor submissions have not drained",
    )
    sql("update shorts_mvp.video_jobs set status='completed';")
    cancelled = transition(operation, "cancel")
    assert cancelled["phase"] == "active"
    assert cancelled["activeReleaseId"] == OLD
    assert sql("select count(*) from shorts_mvp.video_jobs;") == "1"


@pytest.mark.parametrize("active_jobs", [None, 1, "0"])
def test_cancel_requires_explicit_zero_aws_candidate_jobs(active_jobs):
    operation = ready()
    evidence = runtime(old=True)
    if active_jobs is not None:
        evidence["candidateActiveJobs"] = active_jobs
    assert_rejected(
        "select shorts_mvp.transition_project_target_successor("
        f"'{operation['id']}','cancel',{encoded(evidence)},'{ADMIN}');",
        "project successor AWS candidate jobs have not drained",
    )
    assert (
        sql("select render_v4_target_successor->>'phase' from shorts_mvp.editor_release_state;")
        == "admin_ready"
    )


def test_ready_waits_for_unsubmitted_work_but_allows_preserved_running_current():
    sql(insert_job())
    operation = begin()
    assert_rejected(
        "select shorts_mvp.transition_project_target_successor("
        f"'{operation['id']}','ready',{encoded(runtime())},'{ADMIN}');",
        "project successor submissions have not drained",
    )
    sql("update shorts_mvp.video_jobs set aws_batch_job_id='retained-batch',status='rendering';")
    assert transition(operation, "ready")["phase"] == "admin_ready"


def test_explicit_refence_preserves_existing_job_data_and_emergency_stop():
    operation = ready()
    sql(insert_job(user=ADMIN, old=False, release=NEW))
    before = sql("select row_to_json(job) from shorts_mvp.video_jobs job;")
    sql("update shorts_mvp.editor_release_state set render_v4_kill_switch=true;")
    assert transition(operation, "fence")["phase"] == "fenced"
    assert sql("select render_v4_kill_switch from shorts_mvp.editor_release_state;") == "t"
    assert sql("select row_to_json(job) from shorts_mvp.video_jobs job;") == before
    assert_rejected(
        insert_job(user=ADMIN, old=False, release=NEW, job=str(uuid4())),
        "INITIAL_RENDER_RELEASE_HANDOFF",
    )


def process() -> subprocess.Popen:
    return subprocess.Popen(
        command(), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE
    )


def send(child: subprocess.Popen, statement: str, *, finish: bool = False) -> None:
    assert child.stdin
    child.stdin.write((statement + "\n").encode())
    child.stdin.flush()
    if finish:
        child.stdin.close()
        child.stdin = None


def marker(child: subprocess.Popen, expected: bytes) -> None:
    assert child.stdout
    output = b""
    deadline = time.monotonic() + 5
    while expected not in output and time.monotonic() < deadline:
        readable, _, _ = select.select([child.stdout], [], [], 0.1)
        if readable:
            output += os.read(child.stdout.fileno(), 4096)
    assert expected in output, output.decode()


def waiting(name: str) -> None:
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if (
            sql(
                "select count(*) from pg_stat_activity "
                f"where application_name='{name}' and wait_event_type='Lock';"
            )
            == "1"
        ):
            return
    pytest.fail("expected the competing admission/transition to wait on the state row lock")


def stop_children(*children: subprocess.Popen | None) -> None:
    for child in children:
        if child is not None and child.poll() is None:
            child.kill()
            child.wait(timeout=5)


def test_fence_waits_for_prior_job_commit_and_drain_sees_that_job():
    admitted = process()
    fencing = None
    try:
        send(admitted, "begin;" + insert_job() + "select 'ADMITTED';")
        marker(admitted, b"ADMITTED")
        fencing = process()
        send(
            fencing,
            "set application_name='project-target-fence-race';" + begin_statement(),
            finish=True,
        )
        waiting("project-target-fence-race")
        send(
            admitted,
            f"insert into shorts_mvp.test_usage_reservations values('{JOB}'); commit;",
            finish=True,
        )
        _, error = admitted.communicate(timeout=10)
        assert admitted.returncode == 0, error.decode()
        output, error = fencing.communicate(timeout=10)
        assert fencing.returncode == 0, error.decode()
        assert json.loads(output)["phase"] == "fenced"
        assert drain()["unsubmittedJobs"] == 1
        assert sql("select count(*) from shorts_mvp.test_usage_reservations;") == "1"
    finally:
        stop_children(admitted, fencing)


def test_job_waiting_for_committed_fence_is_rejected_before_usage():
    fencing = process()
    admitted = None
    try:
        send(fencing, "begin;" + begin_statement() + "select 'FENCED';")
        marker(fencing, b"FENCED")
        admitted = process()
        send(
            admitted,
            "set application_name='project-target-admit-race';begin;"
            + insert_job(release=None, spec=None, caption=None)
            + f"insert into shorts_mvp.test_usage_reservations values('{JOB}');commit;",
            finish=True,
        )
        waiting("project-target-admit-race")
        send(fencing, "commit;", finish=True)
        _, error = fencing.communicate(timeout=10)
        assert fencing.returncode == 0, error.decode()
        _, error = admitted.communicate(timeout=10)
        assert admitted.returncode != 0
        assert b"INITIAL_RENDER_RELEASE_HANDOFF" in error
        assert sql("select count(*) from shorts_mvp.video_jobs;") == "0"
        assert sql("select count(*) from shorts_mvp.test_usage_reservations;") == "0"
    finally:
        stop_children(fencing, admitted)
