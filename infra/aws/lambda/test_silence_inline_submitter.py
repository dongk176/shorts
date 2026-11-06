import copy
import importlib.util
import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "silence_inline_submitter", Path(__file__).with_name("silence_inline_submitter.py")
)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
RID = "11111111-1111-4111-8111-111111111111"
USER = "22222222-2222-4222-8222-222222222222"
JOB = "33333333-3333-4333-8333-333333333333"
REQUEST = "44444444-4444-4444-8444-444444444444"
QUEUE = m.PREFIX + "job-queue/shorts-mvp-project-fargate-production"


class ParallelSilence(unittest.TestCase):
    def setUp(self):
        release = {
            "git_sha": "a" * 40,
            "worker_image_digest": "sha256:" + "b" * 64,
            "font_manifest_sha256": "c" * 64,
            "production_job_definition_arn": m.PREFIX
            + "job-definition/shorts-mvp-editor-release-aaaaaaaaaaaa-4vcpu:1",
        }
        lanes = {}
        for key in m.KEYS:
            lanes[key] = {
                "previous": None,
                "schedulingMode": "fifo" if key == "unified_template_subtitles" else "fair_share",
                "current": {
                    "releaseId": "verified-" + key,
                    "workerSourceGitSha": release["git_sha"],
                    "imageUri": (
                        "181651591905.dkr.ecr.ap-northeast-2.amazonaws.com/"
                        "shorts-mvp-editor-releases-production@"
                    )
                    + release["worker_image_digest"],
                    "fontManifestSha256": release["font_manifest_sha256"],
                    "renderSpecVersion": 4,
                    "captionRenderSpecVersion": 4,
                    "jobDefinitionArn": m.PREFIX
                    + "job-definition/shorts-mvp-editor-v4-aaaaaaaaaaaa:1",
                    "jobQueueArn": QUEUE,
                },
            }
        self.result = {
            "id": RID,
            "userId": USER,
            "release": release,
            "registry": {"version": 1, "environment": "production", "lanes": lanes},
        }
        t = lanes["source_range"]["current"]
        self.job = {
            "id": JOB,
            "user_id": USER,
            "silence_inline_release_id": RID,
            "initial_editor_release_id": RID,
            "batch_target_key": "source_range",
            "batch_target_release_id": t["releaseId"],
            "batch_job_definition": t["jobDefinitionArn"],
            "batch_job_queue": QUEUE,
            "initial_render_spec_version": 4,
            "initial_caption_render_spec_version": 4,
        }
        self.request = {"user_id": USER, "release_id": RID, "release_channel": "canary"}
        self.calls = []

        def rest(table, **kwargs):
            self.calls.append((table, kwargs))
            return copy.deepcopy(self.result) if table.startswith("rpc/") else [self.request.copy()]

        self.host = SimpleNamespace(rest=rest)

    def test_main_submitter_uses_pinned_parallel_branches(self):
        fixture_path = Path(__file__).parents[3] / "worker/tests/test_batch_pipeline_lambdas.py"
        fixture_spec = importlib.util.spec_from_file_location("pipeline_fixture", fixture_path)
        fixture = importlib.util.module_from_spec(fixture_spec)
        fixture_spec.loader.exec_module(fixture)
        if os.environ.get("SILENCE_SUBMITTER_ARTIFACT_DIR"):
            fixture.LAMBDA_DIR = Path(os.environ["SILENCE_SUBMITTER_ARTIFACT_DIR"])
        host, _ = fixture._load_lambda("batch_submitter")
        host.rest = self.host.rest
        for key, lane in self.result["registry"]["lanes"].items():
            lane["current"]["jobDefinitionArn"] = (
                m.PREFIX + "job-definition/shorts-mvp-editor-v4-" + key.replace("_", "-") + ":1"
            )
            if key == "unified_template_subtitles":
                lane["current"]["jobQueueArn"] = (
                    m.PREFIX + "job-queue/shorts-mvp-unified-production"
                )
        self.job["batch_job_definition"] = self.result["registry"]["lanes"]["source_range"][
            "current"
        ]["jobDefinitionArn"]
        with patch.dict(sys.modules, {host.__name__: host, "silence_inline_submitter": m}):
            registry = host._project_registry_for_job(self.job)
            self.assertEqual(registry, self.result["registry"])
            environment = host._initial_render_v4_environment(
                self.job,
                job_definition=self.job["batch_job_definition"],
                job_queue=QUEUE,
                resume=False,
            )
            self.assertIn({"name": "SHORTS_SILENCE_INLINE_ENABLED", "value": "true"}, environment)
            with patch.dict(os.environ, {"EDITOR_STABLE_BATCH_QUEUE": QUEUE}):
                self.assertEqual(host._editor_release_target(REQUEST, self.job)[3], RID)

    def test_stored_job_not_latest_settings_selects_target(self):
        result = m.release_for_job(self.host, self.job)
        self.assertEqual(result["id"], RID)
        self.assertEqual(
            self.calls,
            [("rpc/shorts_silence_route_for_job", {"method": "POST", "body": {"p_job_id": JOB}})],
        )

    def test_initial_and_resume_keep_exact_binding_and_enable_inline(self):
        for resume in [False, True]:
            env = m.initial_render_environment(
                self.host,
                self.job,
                job_definition=self.job["batch_job_definition"],
                job_queue=QUEUE,
                resume=resume,
            )
            self.assertIn({"name": "SHORTS_SILENCE_INLINE_ENABLED", "value": "true"}, env)
        self.assertEqual(self.job["batch_job_queue"], QUEUE)

    def test_rejects_wrong_owner(self):
        self.result["userId"] = JOB
        with self.assertRaises(RuntimeError):
            m.release_for_job(self.host, self.job)

    def test_rejects_mixed_provenance_or_qa_queue(self):
        original = copy.deepcopy(self.result)
        for field, value in [
            ("workerSourceGitSha", "d" * 40),
            ("fontManifestSha256", "d" * 64),
            ("jobQueueArn", m.PREFIX + "job-queue/shorts-mvp-editor-test"),
        ]:
            self.result = copy.deepcopy(original)
            self.result["registry"]["lanes"]["source_range"]["current"][field] = value
            with self.assertRaises(RuntimeError):
                m.release_for_job(self.host, self.job)

    def test_rejects_partial_registry(self):
        del self.result["registry"]["lanes"]["legacy_project"]
        with self.assertRaises(RuntimeError):
            m.release_for_job(self.host, self.job)

    def test_cannot_change_job_queue_or_revision(self):
        with self.assertRaises(RuntimeError):
            m.initial_render_environment(
                self.host,
                self.job,
                job_definition=self.job["batch_job_definition"].replace(":1", ":2"),
                job_queue=QUEUE,
                resume=True,
            )

    def test_edit_keeps_pin_after_admission_window(self):
        with patch.dict(os.environ, {"EDITOR_STABLE_BATCH_QUEUE": QUEUE}):
            self.assertEqual(m.editor_target(self.host, self.job, REQUEST)[3], RID)
            self.request["user_id"] = JOB
            with self.assertRaises(RuntimeError):
                m.editor_target(self.host, self.job, REQUEST)

    def test_edit_uses_existing_production_editor_queue_configuration(self):
        with patch.dict(os.environ, {"PROJECT_BATCH_QUEUE": QUEUE}, clear=True):
            self.assertEqual(m.editor_target(self.host, self.job, REQUEST)[0], QUEUE)
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(RuntimeError):
                m.editor_target(self.host, self.job, REQUEST)

    def test_deployed_stable_queue_name_normalizes_to_exact_production_arn(self):
        with patch.dict(
            os.environ, {"EDITOR_STABLE_BATCH_QUEUE": "shorts-mvp-project-fargate-production"}
        ):
            self.assertEqual(m.editor_target(self.host, self.job, REQUEST)[0], QUEUE)

    def test_edit_never_falls_back_to_qa_or_legacy(self):
        with patch.dict(
            os.environ, {"EDITOR_STABLE_BATCH_QUEUE": m.PREFIX + "job-queue/shorts-mvp-editor-test"}
        ):
            with self.assertRaises(RuntimeError):
                m.editor_target(self.host, self.job, REQUEST)
        with self.assertRaises(RuntimeError):
            m.editor_target(self.host, self.job, None)


if __name__ == "__main__":
    unittest.main()
