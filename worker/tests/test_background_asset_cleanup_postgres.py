"""Opt-in real PostgreSQL checks in an explicitly labelled, network-none test container.

Set BACKGROUND_ASSET_TEST_CONTAINER to the disposable container name. These
tests never use DATABASE_URL, AWS credentials or an existing application DB.
"""

from __future__ import annotations

import json
import os
import re
import select
import subprocess
import time
from pathlib import Path

import pytest

USER = "5576b6fc-edbf-4eb4-85df-f619e33befb0"
ASSET = "710489ee-7318-48a1-b4d1-73573f3654ab"
JOB = "26c8578d-3f09-4a9d-aeda-1be25ebd433f"
SHORT = "bdd7a49b-c8ad-44c9-833b-d48239831a7c"
CONTAINER = os.environ.get("BACKGROUND_ASSET_TEST_CONTAINER", "")
pytestmark = pytest.mark.skipif(
    not CONTAINER, reason="requires isolated opt-in PostgreSQL container"
)
MIGRATION = Path(__file__).parents[2] / "supabase/migrations/202608310001_background_assets.sql"


def psql_command() -> list[str]:
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
        "background_assets_test",
    ]


def sql(statement: str) -> str:
    result = subprocess.run(
        psql_command(),
        input=statement,
        text=True,
        capture_output=True,
        timeout=20,
        check=True,
    )
    return result.stdout.strip()


def encoded(value: object) -> str:
    return "'" + json.dumps(value).replace("'", "''") + "'::jsonb"


@pytest.fixture(scope="module", autouse=True)
def isolated_database():
    assert re.fullmatch(r"shorts-background-assets-test-[a-z0-9-]{1,80}", CONTAINER)
    inspection = subprocess.run(
        ["/usr/local/bin/docker", "inspect", CONTAINER],
        text=True,
        capture_output=True,
        timeout=10,
        check=True,
    )
    container = json.loads(inspection.stdout)[0]
    assert container["HostConfig"]["NetworkMode"] == "none"
    assert not container["HostConfig"].get("PortBindings")
    assert container["Config"]["Labels"].get("easycut.test-scope") == "background-assets"
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
      create or replace function shorts_mvp.set_updated_at() returns trigger
      language plpgsql as $$ begin new.updated_at=clock_timestamp(); return new; end $$;
      create table if not exists shorts_mvp.app_users(
        id uuid primary key,withdrawn_at timestamptz,is_admin boolean default false
      );
      create table if not exists shorts_mvp.runtime_feature_flags(
        flag_key text primary key,enabled boolean not null,description text not null
      );
      create table if not exists shorts_mvp.custom_templates(user_id uuid,config jsonb);
      create table if not exists shorts_mvp.video_jobs(
        id uuid primary key,user_id uuid,template_snapshot jsonb,status text,
        user_deleted_at timestamptz
      );
      create table if not exists shorts_mvp.upload_sessions(job_id uuid,user_id uuid,status text);
      create table if not exists shorts_mvp.generated_shorts(
        id uuid primary key,job_id uuid,user_id uuid,template_snapshot jsonb,
        editor_document jsonb,pending_edit_snapshot jsonb,deleted_at timestamptz,
        expires_at timestamptz,status text
      );
      create table if not exists shorts_mvp.editor_render_requests(
        short_id uuid,user_id uuid,status text
      );
    """)
    sql(MIGRATION.read_text())


@pytest.fixture(autouse=True)
def reset_test_data(isolated_database):
    sql(f"""
      truncate shorts_mvp.background_assets,shorts_mvp.custom_templates,
        shorts_mvp.video_jobs,shorts_mvp.generated_shorts,shorts_mvp.upload_sessions,
        shorts_mvp.editor_render_requests,shorts_mvp.app_users cascade;
      insert into shorts_mvp.app_users(id) values ('{USER}');
    """)


def asset(*, visible: bool = False, observed: bool = True, lease: bool = False) -> None:
    removed = "null" if visible else "clock_timestamp()-interval '120 days'"
    unreferenced = "null" if visible or not observed else "clock_timestamp()-interval '40 days'"
    retain = (
        "clock_timestamp()+interval '1 day'" if lease else "clock_timestamp()-interval '60 days'"
    )
    sql(f"""
      insert into shorts_mvp.background_assets(
        id,user_id,object_key,state,sha256,original_byte_size,reserved_bytes,
        byte_size,width,height,library_removed_at,unreferenced_since,retain_until
      ) values (
        '{ASSET}','{USER}','custom-backgrounds/{USER}/{ASSET}.webp','ready',repeat('a',64),
        100,0,100,1080,1920,{removed},{unreferenced},{retain}
      );
    """)


def claim() -> list[dict]:
    result = sql(
        "select row_to_json(claim) from "
        f"shorts_mvp.claim_background_asset_cleanup('{ASSET}') claim;"
    )
    return [json.loads(line) for line in result.splitlines() if line]


def background() -> dict:
    return {"kind": "uploaded_image", "assetId": ASSET}


def snapshot() -> dict:
    return {"config": {"background": background()}}


def test_migration_replay_preserves_release_flags():
    sql(
        "update shorts_mvp.runtime_feature_flags set enabled=true "
        "where flag_key='custom_template_design_enabled';"
    )
    sql(MIGRATION.read_text())
    assert (
        sql(
            "select enabled from shorts_mvp.runtime_feature_flags "
            "where flag_key='custom_template_design_enabled';"
        )
        == "t"
    )


def test_saved_visible_image_never_expires():
    asset(visible=True)
    assert claim() == []
    assert sql(f"select state from shorts_mvp.background_assets where id='{ASSET}';") == "ready"


def test_hidden_image_waits_for_lease_then_thirty_unreferenced_days():
    asset(observed=False, lease=True)
    assert claim() == []
    assert (
        sql(
            "select unreferenced_since is null from shorts_mvp.background_assets "
            f"where id='{ASSET}';"
        )
        == "t"
    )
    sql(
        "update shorts_mvp.background_assets set retain_until=clock_timestamp()-interval '1 day' "
        f"where id='{ASSET}';"
    )
    assert claim() == []
    assert (
        sql(
            "select unreferenced_since is not null from shorts_mvp.background_assets "
            f"where id='{ASSET}';"
        )
        == "t"
    )
    sql(
        "update shorts_mvp.background_assets "
        f"set unreferenced_since=clock_timestamp()-interval '29 days' where id='{ASSET}';"
    )
    assert claim() == []
    sql(
        "update shorts_mvp.background_assets "
        f"set unreferenced_since=clock_timestamp()-interval '31 days' where id='{ASSET}';"
    )
    assert len(claim()) == 1


def test_saved_template_and_uppercase_uuid_keep_hidden_background_alive():
    asset()
    config = {"background": {**background(), "assetId": ASSET.upper()}}
    sql(f"insert into shorts_mvp.custom_templates values ('{USER}',{encoded(config)});")
    assert claim() == []
    assert (
        sql(
            "select unreferenced_since is null from shorts_mvp.background_assets "
            f"where id='{ASSET}';"
        )
        == "t"
    )
    sql("delete from shorts_mvp.custom_templates;")
    assert claim() == []
    assert sql(f"select state from shorts_mvp.background_assets where id='{ASSET}';") == "ready"


@pytest.mark.parametrize(
    "status,upload_status",
    [
        ("downloading", None),
        ("queued", None),
        ("retry_waiting", None),
        ("completed", "awaiting_upload"),
        ("failed", "claimed"),
    ],
)
def test_active_youtube_and_upload_work_retain_background(status, upload_status):
    asset()
    sql(
        "insert into shorts_mvp.video_jobs(id,user_id,template_snapshot,status) "
        f"values ('{JOB}','{USER}',{encoded(snapshot())},'{status}');"
    )
    if upload_status:
        sql(f"insert into shorts_mvp.upload_sessions values ('{JOB}','{USER}','{upload_status}');")
    assert claim() == []


@pytest.mark.parametrize(
    "column,document",
    [
        ("template_snapshot", snapshot()),
        ("editor_document", {"overlays": {"background": background()}}),
        ("editor_document", {"template": {"snapshot": snapshot()}}),
        ("pending_edit_snapshot", {"overlays": {"background": background()}}),
        ("pending_edit_snapshot", {"template": {"snapshot": snapshot()}}),
    ],
)
def test_valid_video_and_document_snapshot_paths_retain_background(column, document):
    asset()
    sql(f"""
      insert into shorts_mvp.video_jobs(id,user_id,status) values ('{JOB}','{USER}','completed');
      insert into shorts_mvp.generated_shorts(id,job_id,user_id,expires_at,status,{column})
      values ('{SHORT}','{JOB}','{USER}',clock_timestamp()+interval '1 day',
        'ready',{encoded(document)});
    """)
    assert claim() == []


def test_pending_editor_request_survives_video_expiry_and_project_deletion():
    asset()
    document = {"template": {"snapshot": snapshot()}}
    sql(f"""
      insert into shorts_mvp.video_jobs(id,user_id,status,user_deleted_at)
      values ('{JOB}','{USER}','completed',clock_timestamp());
      insert into shorts_mvp.generated_shorts(
        id,job_id,user_id,expires_at,status,pending_edit_snapshot
      ) values ('{SHORT}','{JOB}','{USER}',clock_timestamp()-interval '1 day',
        'rerendering',{encoded(document)});
      insert into shorts_mvp.editor_render_requests values ('{SHORT}','{USER}','queued');
    """)
    assert claim() == []


def test_withdrawal_hides_library_without_deleting_inflight_references():
    asset(visible=True)
    sql(f"""
      update shorts_mvp.app_users set withdrawn_at=clock_timestamp() where id='{USER}';
      insert into shorts_mvp.video_jobs(id,user_id,status,template_snapshot)
      values ('{JOB}','{USER}','rendering',{encoded(snapshot())});
    """)
    assert sql("select count(*) from shorts_mvp.claim_background_asset_cleanup_batch(20);") == "0"
    assert (
        sql(
            "select library_removed_at is not null and state='ready' "
            f"from shorts_mvp.background_assets where id='{ASSET}';"
        )
        == "t"
    )


def test_only_matching_post_delete_token_frees_held_bytes():
    asset()
    entry = claim()[0]
    assert (
        sql(f"select shorts_mvp.finalize_background_asset_cleanup('{ASSET}',gen_random_uuid());")
        == "f"
    )
    assert (
        sql(
            "select sum(coalesce(byte_size,reserved_bytes)) from shorts_mvp.background_assets "
            "where state<>'deleted';"
        )
        == "100"
    )
    assert (
        sql(
            "select shorts_mvp.finalize_background_asset_cleanup("
            f"'{ASSET}','{entry['cleanup_token']}');"
        )
        == "t"
    )
    assert sql("select count(*) from shorts_mvp.background_assets where state<>'deleted';") == "0"


def test_retry_claim_fences_out_stale_finalization():
    asset()
    first = claim()[0]
    assert claim() == []
    sql(
        "update shorts_mvp.background_assets "
        f"set retain_until=clock_timestamp()-interval '1 second' where id='{ASSET}';"
    )
    second = claim()[0]
    assert first["cleanup_token"] != second["cleanup_token"]
    assert (
        sql(
            "select shorts_mvp.finalize_background_asset_cleanup("
            f"'{ASSET}','{first['cleanup_token']}');"
        )
        == "f"
    )
    assert (
        sql(
            "select shorts_mvp.finalize_background_asset_cleanup("
            f"'{ASSET}','{second['cleanup_token']}');"
        )
        == "t"
    )


def test_incomplete_upload_without_digest_never_requires_s3_delete():
    sql(f"""
      insert into shorts_mvp.background_assets(
        id,user_id,object_key,original_byte_size,retain_until
      ) values ('{ASSET}','{USER}','custom-backgrounds/{USER}/{ASSET}.webp',20,
        clock_timestamp()-interval '1 minute');
    """)
    assert claim() == []
    assert (
        sql(f"select state,reserved_bytes from shorts_mvp.background_assets where id='{ASSET}';")
        == "deleted|0"
    )


def test_reference_committed_while_cleanup_waits_is_seen_after_lock():
    asset()
    writer = subprocess.Popen(
        psql_command(), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE
    )
    cleaner = None
    try:
        assert writer.stdin and writer.stdout
        writer.stdin.write(
            (
                "begin; select pg_advisory_xact_lock("
                f"hashtextextended('background-assets:{USER}',0)); select 'BG_LOCKED';\n"
            ).encode()
        )
        writer.stdin.flush()
        output = b""
        deadline = time.monotonic() + 5
        while b"BG_LOCKED" not in output and time.monotonic() < deadline:
            readable, _, _ = select.select([writer.stdout], [], [], 0.1)
            if readable:
                output += os.read(writer.stdout.fileno(), 4096)
        assert b"BG_LOCKED" in output
        cleaner = subprocess.Popen(
            psql_command(), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE
        )
        assert cleaner.stdin
        cleaner.stdin.write(
            (
                "set application_name='background-cleanup-race'; select count(*) from "
                f"shorts_mvp.claim_background_asset_cleanup('{ASSET}');\n"
            ).encode()
        )
        cleaner.stdin.close()
        cleaner.stdin = None
        deadline = time.monotonic() + 5
        waiting = False
        while time.monotonic() < deadline:
            if (
                sql(
                    "select count(*) from pg_stat_activity "
                    "where application_name='background-cleanup-race' and wait_event='advisory';"
                )
                == "1"
            ):
                waiting = True
                break
        assert waiting, "cleanup must wait on the same owner advisory lock as template saves"
        writer.stdin.write(
            (
                "insert into shorts_mvp.custom_templates values "
                f"('{USER}',{encoded({'background': background()})}); commit;\n"
            ).encode()
        )
        writer.stdin.close()
        writer.stdin = None
        _, write_error = writer.communicate(timeout=10)
        assert writer.returncode == 0, write_error.decode()
        result, error = cleaner.communicate(timeout=10)
        assert cleaner.returncode == 0, error.decode()
        assert result.strip() == b"0"
        assert (
            sql(
                "select state,unreferenced_since is null from shorts_mvp.background_assets "
                f"where id='{ASSET}';"
            )
            == "ready|t"
        )
    finally:
        for process in [writer, cleaner]:
            if process is not None and process.poll() is None:
                process.kill()
                process.wait(timeout=5)
