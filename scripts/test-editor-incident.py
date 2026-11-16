"""Regression tests against the actual deployed routing function in a ZIP."""
from __future__ import annotations

import __future__
import ast
import re
import sys
import urllib.parse
from pathlib import Path
from zipfile import ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "infra/aws/lambda"))
from editor_incident_identity import JAPANESE_EDITOR_IDENTITY, is_registered_japanese_editor


def verify(path):
    with ZipFile(path) as archive:
        source = archive.read("language_test_submitter.py").decode()
    node = next(n for n in ast.parse(source).body
                if isinstance(n, ast.FunctionDef) and n.name == "_editor_release_target")
    release = {**JAPANESE_EDITOR_IDENTITY, "status": "canary_ready", "staging_verified_at": "verified"}
    request = {"release_id": release["id"], "release_channel": "canary"}
    def rest(table, **kwargs):
        return [request] if table == "editor_render_requests" else [release]
    namespace = {
        "urllib": urllib, "re": re, "rest": rest, "BatchTargetTrustRejected": ValueError,
        "_language_test_release": lambda parent: {
            "id": JAPANESE_EDITOR_IDENTITY["id"], "editor_job_queue_arn": "verified-queue"},
        "_LANGUAGE_TEST_EDITOR_DEFINITION": re.compile(r".*-language-test-.*"),
        "_EDITOR_RELEASE_JOB_DEFINITION": re.compile(r".*"),
        "_contrast_editor_kind": lambda candidate: None,
        "is_registered_japanese_editor": is_registered_japanese_editor,
        "_sns_editor_compatible": lambda parent, candidate: False,
    }
    exec(compile(ast.Module(body=[node], type_ignores=[]), "deployed-routing", "exec",
                 flags=__future__.annotations.compiler_flag), namespace)
    def invoke():
        return namespace["_editor_release_target"]("request", {"language_test_release_id": request["release_id"]})
    def rejected():
        try:
            invoke()
        except (RuntimeError, ValueError):
            return
        raise AssertionError("Unsafe identity was accepted")
    if "--expect-original-rejection" in sys.argv:
        rejected()
        print("Original deployed Japanese routing failure reproduced")
        return
    assert invoke() == ("verified-queue", release["production_job_definition_arn"],
                        release["worker_image_digest"], release["id"])
    count = 1
    for key in JAPANESE_EDITOR_IDENTITY:
        previous = release[key]
        release[key] = "invalid"
        rejected()
        release[key] = previous
        count += 1
    for status in ["draft", "rolled_back", "revoked"]:
        release["status"] = status
        rejected()
        count += 1
    release["status"] = "canary_ready"
    release["staging_verified_at"] = None
    rejected()
    release["staging_verified_at"] = "verified"
    request["release_channel"] = "stable"
    rejected()
    request["release_channel"] = "canary"
    request["release_id"] = "wrong-project-release"
    rejected()
    print(f"Candidate deployed routing checks passed: {count + 3}")


if __name__ == "__main__":
    verify(sys.argv[1])
