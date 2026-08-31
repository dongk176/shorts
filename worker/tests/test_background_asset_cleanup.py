from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import MagicMock

import pytest

ASSET_ID = "710489ee-7318-48a1-b4d1-73573f3654ab"
USER_ID = "5576b6fc-edbf-4eb4-85df-f619e33befb0"
TOKEN = "6b33dd2c-23b6-4779-9e81-37e06348e5d9"
KEY = f"custom-backgrounds/{USER_ID}/{ASSET_ID}.webp"
CLAIM = {
    "asset_id": ASSET_ID,
    "user_id": USER_ID,
    "object_key": KEY,
    "cleanup_token": TOKEN,
}
MIGRATION = (
    Path(__file__).parents[2]
    / "supabase/migrations/202608310001_background_assets.sql"
)


@pytest.fixture
def cleanup(monkeypatch):
    client = MagicMock()
    client.delete_object.return_value = {"ResponseMetadata": {"HTTPStatusCode": 204}}
    common = ModuleType("common")
    common.iso_now = lambda: "2026-08-31T00:00:00+00:00"
    common.log_event = MagicMock()
    common.patch = MagicMock()
    common.rest = MagicMock(return_value=[])
    monkeypatch.setitem(sys.modules, "boto3", SimpleNamespace(client=lambda _name: client))
    monkeypatch.setitem(sys.modules, "common", common)
    monkeypatch.setenv("MEDIA_BUCKET", "private-media")
    source = Path(__file__).parents[2] / "infra/aws/lambda/cleanup.py"
    spec = importlib.util.spec_from_file_location("test_background_asset_cleanup_lambda", source)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module, client


def test_deletes_exact_claimed_private_object_then_finalizes_token(cleanup) -> None:
    module, client = cleanup
    module.rest.side_effect = [[CLAIM], True]

    assert module.cleanup_background_assets() == 1

    assert module.rest.call_args_list[0].args == ("rpc/claim_background_asset_cleanup_batch",)
    assert module.rest.call_args_list[0].kwargs["body"] == {"p_limit": 20}
    client.delete_object.assert_called_once_with(Bucket="private-media", Key=KEY)
    client.delete_objects.assert_not_called()
    assert module.rest.call_args_list[1].args == ("rpc/finalize_background_asset_cleanup",)
    assert module.rest.call_args_list[1].kwargs["body"] == {
        "p_asset_id": ASSET_ID,
        "p_cleanup_token": TOKEN,
    }


def test_no_claim_means_no_delete_for_visible_referenced_or_leased_assets(cleanup) -> None:
    module, client = cleanup
    module.rest.return_value = []
    assert module.cleanup_background_assets() == 0
    client.delete_object.assert_not_called()
    assert module.rest.call_count == 1


@pytest.mark.parametrize("changes", [
    {"object_key": "outputs/session/job/video.mp4"},
    {"object_key": "custom-backgrounds/../other.webp"},
    {"object_key": f"custom-backgrounds/{ASSET_ID}/{USER_ID}.webp"},
    {"object_key": f"https://s3.example/{KEY}"},
    {"asset_id": "../../other"},
    {"asset_id": ASSET_ID.upper()},
    {"user_id": "another-owner"},
    {"cleanup_token": None},
])
def test_rejects_noncanonical_claims_without_any_storage_mutation(cleanup, changes) -> None:
    module, client = cleanup
    module.rest.return_value = [{**CLAIM, **changes}]
    assert module.cleanup_background_assets() == 0
    client.delete_object.assert_not_called()
    assert module.rest.call_count == 1
    assert module.log_event.call_args_list[0].kwargs == {"error_type": "ValueError"}


def test_storage_error_never_frees_quota_and_logs_no_error_payload(cleanup) -> None:
    module, client = cleanup
    module.rest.return_value = [CLAIM]
    client.delete_object.side_effect = RuntimeError("secret=do-not-log private-object-key")
    assert module.cleanup_background_assets() == 0
    assert module.rest.call_count == 1
    assert module.log_event.call_args_list[0].args == ("background_asset_cleanup_deferred",)
    assert module.log_event.call_args_list[0].kwargs == {"error_type": "RuntimeError"}
    assert "do-not-log" not in str(module.log_event.call_args_list)


@pytest.mark.parametrize("response", [
    {"ResponseMetadata": {"HTTPStatusCode": 403}},
    {"ResponseMetadata": {"HTTPStatusCode": 204}, "DeleteMarker": True},
    {},
])
def test_unconfirmed_or_version_marker_delete_is_not_finalized(cleanup, response) -> None:
    module, client = cleanup
    module.rest.return_value = [CLAIM]
    client.delete_object.return_value = response
    assert module.cleanup_background_assets() == 0
    assert module.rest.call_count == 1


def test_failed_finalize_remains_retryable_and_charged(cleanup) -> None:
    module, client = cleanup
    module.rest.side_effect = [[CLAIM], False]
    assert module.cleanup_background_assets() == 0
    client.delete_object.assert_called_once()
    assert module.log_event.call_args_list[0].kwargs == {"error_type": "RuntimeError"}


def test_delete_and_finalize_order_is_preserved_on_retry(cleanup) -> None:
    module, client = cleanup
    events = []

    def rest(table, **_kwargs):
        events.append(table)
        return [CLAIM] if table.endswith("_batch") else True

    def delete(**_kwargs):
        events.append("delete")
        return {"ResponseMetadata": {"HTTPStatusCode": 204}}

    module.rest.side_effect = rest
    client.delete_object.side_effect = delete
    assert module.cleanup_background_assets() == 1
    assert events == [
        "rpc/claim_background_asset_cleanup_batch", "delete",
        "rpc/finalize_background_asset_cleanup",
    ]


def test_missing_migration_does_not_block_existing_cleanup(cleanup) -> None:
    module, client = cleanup
    module.report_batch_dispatch_health = MagicMock(return_value=0)
    module.enforce_deadlines = MagicMock(return_value=1)
    module.cleanup_failed_shorts = MagicMock(return_value=(2, 3))
    module.expire_shorts = MagicMock(return_value=(4, 5))
    module.release_stale_jobs = MagicMock(return_value=6)
    module.reset_stale_rerenders = MagicMock(return_value=7)
    module.rest.side_effect = RuntimeError("Supabase RPC is not deployed; secret must stay hidden")
    assert module.handler({}, None) == {
        "expiredShorts": 4,
        "cleanedFailedShorts": 2,
        "deletedObjects": 8,
        "releasedStaleJobs": 6,
        "resetStaleRerenders": 7,
        "enforcedDeadlines": 1,
        "actionableQueuedWithoutBatchId": 0,
    }
    client.delete_object.assert_not_called()
    assert module.log_event.call_args_list[0].kwargs == {"error_type": "RuntimeError"}
    assert "secret" not in str(module.log_event.call_args_list)


def test_rpc_retention_contract_and_attachment_locks_match() -> None:
    sql = MIGRATION.read_text()
    claim = sql.split("function shorts_mvp.claim_background_asset_cleanup(\n", 1)[1]
    claim = claim.split("function shorts_mvp.claim_background_asset_cleanup_batch", 1)[0]
    assert claim.index("pg_advisory_xact_lock") < claim.index("for update")
    assert claim.index("for update") < claim.index("background_asset_has_live_references")
    assert "'background-assets:' || v_owner::text" in claim
    assert "v_asset.state='ready' and v_asset.library_removed_at is null then return" in claim
    assert "account.withdrawn_at is not null" in claim
    assert "v_asset.retain_until>v_now then return" in claim
    assert "v_asset.unreferenced_since is null" in claim
    assert "set unreferenced_since=v_now" in claim
    assert "v_asset.unreferenced_since>v_now-interval '30 days' then return" in claim
    assert "set unreferenced_since=null" in claim
    assert "state='pending' and v_asset.sha256 is null" in claim
    assert "retain_until=v_now+interval '5 minutes'" in claim


def test_rpc_references_cover_both_render_sources_and_pending_editor_documents() -> None:
    sql = MIGRATION.read_text()
    references = sql.split("function shorts_mvp.background_asset_has_live_references", 1)[1]
    references = references.split("function shorts_mvp.claim_background_asset_cleanup", 1)[0]
    for reference in [
        "custom_templates template", "template.config", "video_jobs job",
        "job.template_snapshot", "upload_sessions upload", "('awaiting_upload','claimed')",
        "generated_shorts short", "short.template_snapshot", "short.editor_document",
        "short.pending_edit_snapshot", "short.expires_at>clock_timestamp()",
        "editor_render_requests request", "('queued','rendering')",
        "job.user_deleted_at is null",
    ]:
        assert reference in references
    assert "{overlays,background}" in sql
    assert "{template,snapshot,config,background}" in sql
    assert "lower(candidate->>'assetId')=p_asset_id::text" in sql


def test_rpc_finalization_is_fenced_and_never_frees_quota_on_claim() -> None:
    sql = MIGRATION.read_text()
    finalize = sql.split("function shorts_mvp.finalize_background_asset_cleanup", 1)[1]
    assert "v_asset.cleanup_token is distinct from p_cleanup_token" in finalize
    assert "p_cleanup_token is null then return false" in finalize
    assert "v_asset.state<>'deleting'" in finalize
    assert "background_asset_has_live_references" in finalize
    assert "set state='deleted',deleted_at=clock_timestamp(),reserved_bytes=0" in finalize
    assert "where sha256 is not null and state in ('pending','ready','deleting')" in sql
    assert "from public,anon,authenticated" in sql
    assert "to service_role" in sql
    assert "limit greatest(1,least(coalesce(p_limit,20),20))" in sql
    assert "interval '7 days'" in sql
