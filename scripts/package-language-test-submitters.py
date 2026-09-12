"""Produce bounded overlays from the inspected production Lambda archives.

No cloud calls or configuration changes. Ordinary editor functions remain byte
for byte identical; only marked parent jobs use the new feature resolver.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import io
from pathlib import Path
from zipfile import ZipFile

EDITOR_BASE_SHA = "d490d75d60c8de550bdc279e75069ad34ba5499a7bae2b6398b267960cbce9c5"
PROJECT_BASE_SHA = "0f2a5654739219906412d574ea387ecbed9bd47089a22a28dd100f9b2efe2007"


def editor_overlay(source: str) -> str:
    if hashlib.sha256(source.encode()).hexdigest() != EDITOR_BASE_SHA:
        raise ValueError("Actual editor submitter changed; inspect it before packaging")
    replacements = [
        (
            '"select=id,user_id,mvp_session_id,dispatch_priority_class"',
            '"select=id,user_id,mvp_session_id,dispatch_priority_class,"\n'
            '            "language_test_release_id,initial_editor_release_id"',
        ),
        (
            "release_target = _editor_release_target(\n"
            "            str(pending_request_id) if pending_request_id else None\n"
            "        )",
            "release_target = _language_editor_target(\n"
            "            str(pending_request_id) if pending_request_id else None, parent_job\n"
            "        )",
        ),
        (
            "**_rerender_scheduling_overrides(\n                rerender_queue,",
            "**_language_editor_scheduling(\n                rerender_queue,",
        ),
    ]
    original = source
    for before, after in replacements:
        if source.count(before) != 1:
            raise ValueError("Editor overlay location is not unique")
        source = source.replace(before, after)
    source += '''\n\ndef _language_editor_target(request_id, parent_job):
    if parent_job.get("language_test_release_id"):
        import language_test_submitter
        return language_test_submitter._editor_release_target(request_id, parent_job)
    return _editor_release_target(request_id)


def _language_editor_scheduling(queue, priority_class, *identities):
    if re.fullmatch(
        r"arn:aws:batch:ap-northeast-2:181651591905:job-queue/"
        r"shorts-mvp-language-test-[a-z0-9-]+", queue
    ):
        return {}
    return _rerender_scheduling_overrides(queue, priority_class, *identities)
'''
    old_functions = {n.name: ast.dump(n) for n in ast.parse(original).body if isinstance(n, ast.FunctionDef)}
    new_functions = {n.name: ast.dump(n) for n in ast.parse(source).body if isinstance(n, ast.FunctionDef)}
    assert [name for name in old_functions if old_functions[name] != new_functions[name]] == ["_submit"]
    compile(source, "batch_submitter.py", "exec")
    return source


def package(source_zip: Path, output_zip: Path, feature_source: Path, *, editor: bool) -> None:
    with ZipFile(source_zip) as original:
        payloads = {name: original.read(name) for name in original.namelist()}
    current = payloads["batch_submitter.py"]
    if editor:
        payloads["batch_submitter.py"] = editor_overlay(current.decode()).encode()
        payloads["language_test_submitter.py"] = feature_source.read_bytes()
    else:
        if hashlib.sha256(current).hexdigest() != PROJECT_BASE_SHA:
            raise ValueError("Actual production submitter changed; inspect before packaging")
        payloads["batch_submitter.py"] = feature_source.read_bytes()
    buffer = io.BytesIO()
    with ZipFile(buffer, "w") as result:
        for name, content in payloads.items():
            result.writestr(name, content)
    output_zip.write_bytes(buffer.getvalue())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--editor", action="store_true")
    args = parser.parse_args()
    package(args.source, args.output, Path(__file__).parents[1] / "infra/aws/lambda/batch_submitter.py", editor=args.editor)
