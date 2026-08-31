from __future__ import annotations

import json
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from test_batch_pipeline_lambdas import (
    _editor_release_job_definition,
    _load_lambda,
    _reserved_v4_probe,
    _v4_probe_identity,
)
from test_custom_template_design_registrar import evidence_manifest

STABLE = "11111111-1111-4111-8111-111111111111"
OTHER_STABLE = "22222222-2222-4222-8222-222222222222"
OLD_SHA = "9" * 40
OLD_DIGEST = "sha256:" + "8" * 64
NEW_SHA = "a" * 40
NEW_DIGEST = "sha256:" + "b" * 64
FONT = "d" * 64
REPOSITORY = "123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/editor-releases"
BATCH = "arn:aws:batch:ap-northeast-2:123456789012:"
ROLE = "arn:aws:iam::123456789012:role/trusted"
EXECUTION_ROLE = "arn:aws:iam::123456789012:role/execution"


def successor_fixture(monkeypatch):
    module, _ = _load_lambda("editor_release_registrar")
    monkeypatch.setenv("EDITOR_RELEASE_ECR_REPOSITORY_URI", REPOSITORY)
    monkeypatch.setenv(
        "EDITOR_RELEASE_REGISTRAR_PASS_ROLE_ARNS", json.dumps([ROLE, EXECUTION_ROLE])
    )
    # A decommissioned legacy JD/registry must not block or influence a successor.
    monkeypatch.delenv("RERENDER_JOB_DEFINITION", raising=False)
    module._read_project_target_registry = MagicMock(
        side_effect=AssertionError("stale bootstrap registry was read")
    )
    stable_arn = BATCH + "job-definition/shorts-mvp-editor-release-999999999999-4vcpu:17"
    fixture = SimpleNamespace(
        module=module,
        state={"stable_release_id": STABLE},
        stable={
            "id": STABLE,
            "status": "stable",
            "git_sha": OLD_SHA,
            "worker_image_digest": OLD_DIGEST,
            "render_spec_version": 4,
            "caption_render_spec_version": 4,
            "font_manifest_sha256": FONT,
            "production_job_definition_arn": stable_arn,
            "promoted_at": "2026-08-31T00:00:00Z",
        },
        rows=[],
        definitions={},
        created=[],
        reads=[],
        proof={},
        after_register=None,
    )

    def definition(arn, *, vcpus, lane):
        name = arn.split("/", 1)[1].rsplit(":", 1)[0]
        result = _editor_release_job_definition(
            name, image=f"{REPOSITORY}@{OLD_DIGEST}", vcpus=vcpus
        )
        result["jobDefinitionArn"] = arn
        result["parameters"] = {"route": lane}
        result["retryStrategy"] = {"attempts": 1}
        result["timeout"] = {"attemptDurationSeconds": 3600}
        result["propagateTags"] = True
        container = result["containerProperties"]
        container["command"] = ["python", "-m", "shorts_worker", lane]
        container["executionRoleArn"] = EXECUTION_ROLE
        container["networkConfiguration"] = {"assignPublicIp": "ENABLED"}
        container["logConfiguration"] = {
            "logDriver": "awslogs", "options": {"awslogs-group": "/current/production"}
        }
        container["ephemeralStorage"] = {"sizeInGiB": 100}
        container["secrets"] = [{
            "name": "INGESTION_PROXY_REGISTRY_JSON",
            "valueFrom": "arn:aws:secretsmanager:ap-northeast-2:123456789012:secret:current-pool",
        }]
        container["environment"].extend([
            {"name": "EDITOR_RELEASE_GIT_SHA", "value": OLD_SHA},
            {"name": "EDITOR_RENDER_SPEC_VERSION", "value": "4"},
            {"name": "EDITOR_CAPTION_RENDER_SPEC_VERSION", "value": "4"},
            {"name": "EDITOR_FONT_MANIFEST_SHA256", "value": FONT},
            {"name": "WORKER_IMAGE_DIGEST", "value": OLD_DIGEST},
            {"name": "YOUTUBE_PO_TOKEN_ENABLED", "value": "true"},
            {"name": "INGESTION_EGRESS_MODE", "value": "webshare_isp"},
            {"name": "CURRENT_LANE", "value": lane},
        ])
        return result

    fixture.definitions[stable_arn] = definition(stable_arn, vcpus="4", lane="rerender")
    for lane in sorted(module._PROJECT_TARGET_LANES):
        slug = lane.replace("_", "-")
        arn = BATCH + f"job-definition/shorts-mvp-editor-v4-{slug}-{OLD_SHA[:12]}:23"
        fixture.rows.append({
            "target_key": lane,
            "batch_target_release_id": slug + "-current-v4",
            "worker_source_git_sha": OLD_SHA,
            "worker_image_digest": OLD_DIGEST,
            "job_definition_arn": arn,
            "job_queue_arn": BATCH + "job-queue/current-" + slug,
        })
        fixture.definitions[arn] = definition(arn, vcpus="8", lane=lane)

    def rest(table, **kwargs):
        fixture.reads.append((table, kwargs))
        assert kwargs.get("method") is None, "baseline reads cannot mutate state"
        if table == "editor_release_state":
            return [deepcopy(fixture.state)]
        if table == "editor_releases":
            return [deepcopy(fixture.stable)]
        if table == "editor_release_project_targets":
            return deepcopy(fixture.rows)
        raise AssertionError(table)

    def register(payload):
        arn = BATCH + "job-definition/" + payload["jobDefinitionName"] + ":29"
        created = {**deepcopy(payload), "jobDefinitionArn": arn, "status": "ACTIVE"}
        fixture.definitions[arn] = created
        fixture.created.append(created)
        if fixture.after_register is not None:
            fixture.after_register(created)
        return arn

    module.rest = rest
    module._job_definition = MagicMock(side_effect=lambda arn: deepcopy(fixture.definitions[arn]))
    module._register_exact_definition = MagicMock(side_effect=register)
    return fixture


def register_successor(fixture):
    return fixture.module._register_v4_production_definitions(
        git_sha=NEW_SHA,
        digest=NEW_DIGEST,
        font_manifest_sha256=FONT,
        preserve_production_contract=True,
        predecessor_contract=fixture.proof,
    )


def test_successor_clones_all_six_actual_stable_contracts_and_no_bootstrap(monkeypatch):
    fixture = successor_fixture(monkeypatch)
    originals = deepcopy(fixture.definitions)
    editor_arn, targets = register_successor(fixture)
    assert len(fixture.created) == 6
    assert set(targets) == fixture.module._PROJECT_TARGET_LANES
    fixture.module._read_project_target_registry.assert_not_called()
    assert len(fixture.reads) == 6  # all three baseline tables, before and after cloning
    proof = fixture.proof
    assert proof["version"] == 1
    assert proof["predecessorReleaseId"] == STABLE
    assert proof["sourceGitSha"] == OLD_SHA
    assert proof["workerImageDigest"] == OLD_DIGEST
    assert proof["fontManifestSha256"] == FONT
    assert set(proof["projectTargets"]) == fixture.module._PROJECT_TARGET_LANES
    mappings = [(editor_arn, fixture.stable["production_job_definition_arn"], "4")]
    for row in fixture.rows:
        lane = row["target_key"]
        target = targets[lane]
        baseline = proof["projectTargets"][lane]
        assert target["jobQueueArn"] == row["job_queue_arn"]
        assert target["workerImageDigest"] == NEW_DIGEST
        assert baseline["jobDefinitionArn"] == row["job_definition_arn"]
        assert baseline["jobQueueArn"] == row["job_queue_arn"]
        assert baseline["batchTargetReleaseId"] == row["batch_target_release_id"]
        assert baseline["workerSourceGitSha"] == OLD_SHA
        assert baseline["workerImageDigest"] == OLD_DIGEST
        mappings.append((target["jobDefinitionArn"], row["job_definition_arn"], "8"))
    for candidate_arn, original_arn, cpus in mappings:
        actual = fixture.definitions[candidate_arn]["containerProperties"]
        expected = originals[original_arn]["containerProperties"]
        assert actual["resourceRequirements"] == expected["resourceRequirements"]
        resources = {item["type"]: item["value"] for item in actual["resourceRequirements"]}
        assert resources["VCPU"] == cpus
        assert actual["secrets"] == expected["secrets"]
        assert actual["networkConfiguration"] == expected["networkConfiguration"]
        assert actual["jobRoleArn"] == expected["jobRoleArn"]
        assert actual["executionRoleArn"] == expected["executionRoleArn"]
        actual_env = {item["name"]: item["value"] for item in actual["environment"]}
        assert actual_env["TASK_VCPUS"] == cpus
        assert actual_env["FFMPEG_THREADS"] == cpus
        assert actual_env["YOUTUBE_PO_TOKEN_ENABLED"] == "true"
        assert actual_env["INGESTION_EGRESS_MODE"] == "webshare_isp"
    assert proof["editor"]["contractSha256"] == fixture.module._successor_contract_sha256(
        originals[fixture.stable["production_job_definition_arn"]]
    )
    for baseline in proof["projectTargets"].values():
        assert baseline["contractSha256"] == fixture.module._successor_contract_sha256(
            originals[baseline["jobDefinitionArn"]]
        )
    serialized = json.dumps(proof)
    assert "current-pool" not in serialized
    assert "YOUTUBE_PO_TOKEN_ENABLED" not in serialized
    assert "containerProperties" not in serialized


@pytest.mark.parametrize("patch", [
    {"id": OTHER_STABLE}, {"status": "approved"}, {"promoted_at": None},
    {"git_sha": "invalid"}, {"worker_image_digest": "invalid"},
    {"render_spec_version": 3}, {"caption_render_spec_version": 3},
    {"font_manifest_sha256": "e" * 64}, {"production_job_definition_arn": "untrusted"},
])
def test_successor_rejects_invalid_stable_before_any_registration(monkeypatch, patch):
    fixture = successor_fixture(monkeypatch)
    fixture.stable.update(patch)
    with pytest.raises(RuntimeError, match="differs from production"):
        register_successor(fixture)
    assert fixture.created == []
    assert fixture.proof == {}


@pytest.mark.parametrize("change", [
    "missing", "duplicate", "unknown", "source", "digest", "definition", "queue",
    "other-account", "other-region", "batch-release",
])
def test_successor_rejects_bad_actual_project_targets_before_registration(monkeypatch, change):
    fixture = successor_fixture(monkeypatch)
    row = fixture.rows[0]
    if change == "missing":
        fixture.rows.pop()
    elif change == "duplicate":
        fixture.rows[-1] = deepcopy(row)
    elif change == "unknown":
        row["target_key"] = "unknown"
    elif change == "source":
        row["worker_source_git_sha"] = "f" * 40
    elif change == "digest":
        row["worker_image_digest"] = NEW_DIGEST
    elif change == "definition":
        row["job_definition_arn"] = "arbitrary-definition"
    elif change == "queue":
        row["job_queue_arn"] = "arbitrary-queue"
    elif change == "other-account":
        row["job_queue_arn"] = row["job_queue_arn"].replace("123456789012", "123456789099")
    elif change == "other-region":
        row["job_queue_arn"] = row["job_queue_arn"].replace("ap-northeast-2", "us-east-1")
    else:
        row["batch_target_release_id"] = "invalid/id"
    with pytest.raises(RuntimeError, match="targets are incomplete|target identity differs"):
        register_successor(fixture)
    assert fixture.created == []
    assert fixture.proof == {}


@pytest.mark.parametrize("lane", ["editor", "last-project"])
@pytest.mark.parametrize("change", ["arn", "status", "image", "source", "font", "duplicate"])
def test_successor_preflights_every_real_definition(monkeypatch, lane, change):
    fixture = successor_fixture(monkeypatch)
    arn = (fixture.stable["production_job_definition_arn"] if lane == "editor"
           else fixture.rows[-1]["job_definition_arn"])
    definition = fixture.definitions[arn]
    container = definition["containerProperties"]
    if change == "arn":
        definition["jobDefinitionArn"] += "9"
    elif change == "status":
        definition["status"] = "INACTIVE"
    elif change == "image":
        container["image"] = REPOSITORY + "@" + NEW_DIGEST
    elif change == "duplicate":
        container["environment"].append({"name": "WORKER_IMAGE_DIGEST", "value": OLD_DIGEST})
    else:
        key = "EDITOR_RELEASE_GIT_SHA" if change == "source" else "EDITOR_FONT_MANIFEST_SHA256"
        for item in container["environment"]:
            if item["name"] == key:
                item["value"] = "f" * (40 if change == "source" else 64)
    with pytest.raises(RuntimeError, match="identity has drifted|requested digest"):
        register_successor(fixture)
    assert fixture.created == []
    assert fixture.proof == {}


@pytest.mark.parametrize("target", ["editor", "last-project"])
@pytest.mark.parametrize("change", [
    "cpu", "memory", "token", "egress", "proxy-secret", "role", "network", "timeout", "image",
])
def test_successor_rechecks_actual_registered_contract_before_attesting(
    monkeypatch, change, target
):
    fixture = successor_fixture(monkeypatch)
    target_index = 1 if target == "editor" else 6

    def alter(created):
        if len(fixture.created) != target_index:
            return
        container = created["containerProperties"]
        if change in {"cpu", "memory"}:
            resource = "VCPU" if change == "cpu" else "MEMORY"
            for item in container["resourceRequirements"]:
                if item["type"] == resource:
                    item["value"] = "2"
        elif change in {"token", "egress"}:
            key = "YOUTUBE_PO_TOKEN_ENABLED" if change == "token" else "INGESTION_EGRESS_MODE"
            for item in container["environment"]:
                if item["name"] == key:
                    item["value"] = "changed"
        elif change == "proxy-secret":
            container["secrets"][0]["valueFrom"] = "old-pool"
        elif change == "role":
            container["jobRoleArn"] = EXECUTION_ROLE
        elif change == "network":
            container["networkConfiguration"]["assignPublicIp"] = "DISABLED"
        elif change == "timeout":
            created["timeout"]["attemptDurationSeconds"] = 100
        else:
            container["image"] = REPOSITORY + "@" + OLD_DIGEST

    fixture.after_register = alter
    with pytest.raises(RuntimeError, match="differs from its trusted template|requested digest"):
        register_successor(fixture)
    assert len(fixture.created) == target_index
    assert fixture.proof == {}


@pytest.mark.parametrize("change", ["stable", "target"])
def test_successor_rejects_baseline_switch_during_registration(monkeypatch, change):
    fixture = successor_fixture(monkeypatch)

    def switch(_created):
        if len(fixture.created) != 3:
            return
        if change == "stable":
            fixture.state["stable_release_id"] = OTHER_STABLE
            fixture.stable["id"] = OTHER_STABLE
        else:
            fixture.rows[0]["job_definition_arn"] += "9"

    fixture.after_register = switch
    with pytest.raises(RuntimeError, match="baseline changed during registration"):
        register_successor(fixture)
    assert len(fixture.created) == 6
    assert fixture.proof == {}


def test_successor_fingerprint_is_order_independent_but_covers_secret_and_resources(monkeypatch):
    fixture = successor_fixture(monkeypatch)
    definition = next(iter(fixture.definitions.values()))
    original = fixture.module._successor_contract_sha256(definition)
    reordered = deepcopy(definition)
    reordered["containerProperties"]["environment"].reverse()
    reordered["containerProperties"]["resourceRequirements"].reverse()
    assert fixture.module._successor_contract_sha256(reordered) == original
    reordered["containerProperties"]["secrets"][0]["valueFrom"] = "other-secret-reference"
    assert fixture.module._successor_contract_sha256(reordered) != original
    reordered = deepcopy(definition)
    reordered["containerProperties"]["resourceRequirements"][1]["value"] = "8"
    assert fixture.module._successor_contract_sha256(reordered) != original


@pytest.mark.parametrize("include_predecessor", [True, False])
def test_finalizer_binds_successor_evidence_without_weakening_fifteen_checks(
    monkeypatch, include_predecessor
):
    fixture = successor_fixture(monkeypatch)
    production_arn, targets = register_successor(fixture)
    module = fixture.module
    proof = deepcopy(fixture.proof)
    probe = {
        **_reserved_v4_probe(), "state": "job_submitted",
        "isolated_batch_job_id": "8fd1c249-6cef-40f1-97d4-e4e6c837f60b",
    }
    manifest = evidence_manifest(module)
    manifest["probeIdentity"] = {
        "nonce": probe["nonce"], "batchJobId": probe["isolated_batch_job_id"],
        "probeRunId": str(probe["id"]),
    }
    artifact_uri = "s3://isolated/editor-release-probes/exact/manifest.json"
    matrix_uri = artifact_uri.replace("manifest.json", "browser-parity/matrix.json")
    module._v4_request_identity = MagicMock(return_value=(
        NEW_SHA, NEW_DIGEST, FONT, _v4_probe_identity()
    ))
    module._load_probe = MagicMock(return_value=probe)
    module._verify_probe_request_identity = MagicMock()
    module._verify_isolated_v4_job = MagicMock()
    module._probe_artifact_uri = MagicMock(return_value=artifact_uri)
    module._read_versioned_json = MagicMock(return_value=(manifest, "e" * 64, "manifest-version"))
    module._verify_manifest = MagicMock()
    module._verify_custom_template_design_artifacts = MagicMock()
    module._artifact_contract = MagicMock(return_value={"versionId": "version", "sha256": "f" * 64})
    module._read_browser_parity_matrix = MagicMock(return_value=({}, "f" * 64, matrix_uri))
    module._read_inline_browser_parity_report = MagicMock(return_value={
        "caseCount": 66, "maximumDomErrorPixels": 1, "maximumPixelErrorPixels": 1,
    })
    module._verify_browser_parity_report = MagicMock()
    # The companion suite checks artifacts; here isolate the finalizer's evidence binding.
    module._verify_custom_template_design = MagicMock(return_value=manifest["customTemplateDesign"])
    module._rpc = MagicMock(side_effect=[
        {**probe, "state": "evidence_verified"},
        {"releaseId": OTHER_STABLE, "status": "canary_ready"},
    ])

    def register(**kwargs):
        assert kwargs["preserve_production_contract"] is True
        if include_predecessor:
            kwargs["predecessor_contract"].update(proof)
        return production_arn, targets

    module._register_v4_production_definitions = MagicMock(side_effect=register)
    event = {"probeRunId": str(probe["id"]), "browserParityReportJson": "{}",
             "browserParityReportSha256": "f" * 64}
    if not include_predecessor:
        with pytest.raises(RuntimeError, match="predecessor evidence is missing"):
            module._finalize_v4_release(event)
        assert module._rpc.call_count == 1
        return
    module._finalize_v4_release(event)
    name, body = module._rpc.call_args.args
    assert name == "finalize_editor_render_v4_release"
    checks = body["p_release_checks"]
    assert len(checks) == 15
    assert {item["checkName"] for item in checks} == (
        module._REQUIRED_CHECKS | module._V4_REQUIRED_CHECKS | {module._BROWSER_PARITY_CHECK}
    )
    design_check = next(item for item in checks if item["checkName"] == "render-spec-v4")
    assert design_check["details"]["compatibleSuccessor"] == proof
    assert design_check["details"]["customTemplateDesign"] == manifest["customTemplateDesign"]
    assert all("compatibleSuccessor" not in item["details"] for item in checks
               if item["checkName"] != "render-spec-v4")
