"""Private binding failures and exact-worker provenance; no cloud calls."""

import copy
import importlib.util
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location(
    "silence_test_submitter",
    Path(__file__).with_name("silence_test_submitter.py"),
)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
RID = "11111111-1111-4111-8111-111111111111"
USER = "22222222-2222-4222-8222-222222222222"


class Admission(unittest.TestCase):
    def setUp(self):
        self.rows = {
            "app_users": [{"id": USER, "is_admin": True}],
            "silence_test_releases": [
                {
                    "id": RID,
                    "administrator_id": USER,
                    "verified_at": "verified",
                    "enabled": True,
                    "job_queue_arn": m.QUEUE,
                    "expires_at": (
                        datetime.now(UTC) + timedelta(hours=1)
                    ).isoformat(),
                }
            ],
            "editor_release_state": [{"render_v4_kill_switch": False}],
            "runtime_feature_flags": [{"enabled": True}],
            "editor_releases": [
                {
                    "id": RID,
                    "status": "canary_ready",
                    "staging_verified_at": "verified",
                    "render_spec_version": 4,
                    "caption_render_spec_version": 4,
                    "git_sha": "a" * 40,
                    "worker_image_digest": "sha256:" + "b" * 64,
                    "font_manifest_sha256": "c" * 64,
                    "production_job_definition_arn": "arn:aws:batch:ap-northeast-2:181651591905:"
                    "job-definition/shorts-mvp-editor-release-aaaaaaaaaaaa-4vcpu:1",
                }
            ],
            "editor_release_project_targets": [
                {
                    "target_key": key,
                    "worker_source_git_sha": "a" * 40,
                    "worker_image_digest": "sha256:" + "b" * 64,
                    "batch_target_release_id": key + "-release",
                    "job_definition_arn": "arn:aws:batch:ap-northeast-2:181651591905:"
                    "job-definition/shorts-mvp-editor-v4-"
                    + key.replace("_", "-")
                    + ":1",
                }
                for key in sorted(m.KEYS)
            ],
            "editor_render_requests": [
                {"release_id": RID, "release_channel": "canary", "user_id": USER}
            ],
        }
        target = next(
            t
            for t in self.rows["editor_release_project_targets"]
            if t["target_key"] == "source_range"
        )
        self.definition = {
            "jobDefinitionArn": target["job_definition_arn"],
            "status": "ACTIVE",
            "containerProperties": {
                "image": m.IMAGE_REPOSITORY + "@sha256:" + "b" * 64
            },
        }
        self.host = SimpleNamespace(
            rest=lambda table, query: copy.deepcopy(self.rows[table]),
            batch=SimpleNamespace(
                describe_job_definitions=lambda **kwargs: {
                    "jobDefinitions": [self.definition]
                }
            ),
        )
        self.job = {
            "silence_test_release_id": RID,
            "initial_editor_release_id": RID,
            "user_id": USER,
            "batch_target_key": "source_range",
            "batch_target_release_id": target["batch_target_release_id"],
            "batch_job_definition": target["job_definition_arn"],
            "batch_job_queue": m.QUEUE,
            "initial_render_spec_version": 4,
            "initial_caption_render_spec_version": 4,
        }

    def environment(self):
        return m.initial_render_environment(
            self.host,
            self.job,
            job_definition=self.job["batch_job_definition"],
            job_queue=self.job["batch_job_queue"],
            resume=False,
        )

    def test_fifo_request_and_bounded_timeout(self):
        request = {
            "jobQueue": m.QUEUE,
            "shareIdentifier": "paid",
            "schedulingPriorityOverride": 1000,
        }
        m.bind_request(request, self.job)
        self.assertEqual(
            request, {"jobQueue": m.QUEUE, "timeout": {"attemptDurationSeconds": 1800}}
        )
        ordinary = {"jobQueue": "public", "shareIdentifier": "paid"}
        m.bind_request(ordinary, {})
        self.assertEqual(ordinary, {"jobQueue": "public", "shareIdentifier": "paid"})

    def test_complete_registry_and_environment(self):
        result = m.release_for_job(self.host, self.job)
        self.assertEqual(set(result["registry"]["lanes"]), m.KEYS)
        self.assertEqual(len(self.environment()), 5)
        self.assertIn({"name": "EASYCUT_SILENCE_TEST_RELEASE_ID", "value": RID}, self.environment())

    def test_member_rejected(self):
        self.rows["app_users"][0]["is_admin"] = False
        with self.assertRaisesRegex(RuntimeError, "administrator"):
            self.environment()

    def test_foreign_owner_rejected(self):
        self.rows["silence_test_releases"][0]["administrator_id"] = RID
        with self.assertRaisesRegex(RuntimeError, "private target"):
            self.environment()

    def test_expired_creation_but_existing_editor_pinned(self):
        self.rows["silence_test_releases"][0]["expires_at"] = "2020-01-01T00:00:00Z"
        with self.assertRaisesRegex(RuntimeError, "window ended"):
            self.environment()
        self.assertEqual(m.editor_target(self.host, RID, self.job)[0], m.QUEUE)

    def test_disabled_creation(self):
        self.rows["silence_test_releases"][0]["enabled"] = False
        with self.assertRaisesRegex(RuntimeError, "window ended"):
            self.environment()

    def test_emergency_stop(self):
        self.rows["editor_release_state"][0]["render_v4_kill_switch"] = True
        with self.assertRaisesRegex(RuntimeError, "stopped"):
            self.environment()

    def test_flag_stop(self):
        self.rows["runtime_feature_flags"][0]["enabled"] = False
        with self.assertRaisesRegex(RuntimeError, "disabled"):
            self.environment()

    def test_missing_attestation_lane(self):
        self.rows["editor_release_project_targets"].pop()
        with self.assertRaisesRegex(RuntimeError, "incomplete"):
            self.environment()

    def test_wrong_attested_digest(self):
        self.rows["editor_release_project_targets"][0]["worker_image_digest"] = (
            "sha256:" + "d" * 64
        )
        with self.assertRaisesRegex(RuntimeError, "provenance"):
            self.environment()

    def test_unattested_definition_rejected(self):
        self.job["batch_job_definition"] += "9"
        with self.assertRaisesRegex(RuntimeError, "immutable"):
            self.environment()

    def test_different_queue(self):
        self.job["batch_job_queue"] = "public"
        with self.assertRaisesRegex(RuntimeError, "immutable"):
            self.environment()

    def test_editor_foreign_owner(self):
        self.rows["editor_render_requests"][0]["user_id"] = RID
        with self.assertRaisesRegex(RuntimeError, "owner"):
            m.editor_target(self.host, RID, self.job)


if __name__ == "__main__":
    unittest.main()
