"""Add only midform branches to freshly inspected deployed Lambda archives."""
import argparse
import ast
import hashlib
from pathlib import Path
from zipfile import ZipFile

PROJECT_SHA = "92962967ca13cc46f6c5a854e5407205f918643ea718c16632de6af0c47f7dbe"
EDITOR_SHA = "c9aefde5ec788f78bca1ce4d1876ee043dca98e6f4404a2800f9118de022e67b"


def overlay(source, editor=False):
    if hashlib.sha256(source.encode()).hexdigest() != (EDITOR_SHA if editor else PROJECT_SHA):
        raise ValueError("Deployed submitter changed; inspect the current archive")
    original = source
    # Query fields only; no default routing, identity, or scheduling changes.
    source = source.replace('language_test_release_id,initial_editor_release_id,template_snapshot',
                            'language_test_release_id,initial_editor_release_id,template_snapshot,midform_release_id,midform_request')
    if editor:
        marker = 'def _language_editor_target(request_id, parent_job):\n'
        branch = '''    if parent_job.get("midform_release_id"):
        import midform_submitter
        import language_test_submitter
        return midform_submitter.editor_target(language_test_submitter, request_id, parent_job)
'''
    else:
        source = source.replace('initial_editor_release_id,language_test_release_id,',
                                'initial_editor_release_id,language_test_release_id,midform_release_id,midform_request,')
        marker = 'def _project_registry_for_job(job: dict[str, Any]) -> dict[str, Any] | None:\n'
        branch = '''    if job.get("midform_release_id"):
        import sys
        import midform_submitter
        return midform_submitter.release_for_job(sys.modules[__name__], job)["registry"]
'''
    if source.count(marker) != 1:
        raise ValueError("Midform insertion point is not unique")
    source = source.replace(marker, marker + branch)
    runtime_marker = ('        submission_key = f"rerender:{short_id}:{version}:{rerender_attempt}"'
                      if editor else '        submission_key = (\n            f"project:{job_id}:resume:1"')
    runtime_job = "parent_job" if editor else "job"
    if source.count(runtime_marker) != 1:
        raise ValueError("Midform runtime insertion point is not unique")
    source = source.replace(runtime_marker,
        f'        if {runtime_job}.get("midform_release_id"):\n'
        '            import midform_submitter\n'
        f'            midform_submitter.bind_runtime(request, {runtime_job})\n' + runtime_marker)
    before = {n.name: ast.dump(n) for n in ast.parse(original).body if isinstance(n, ast.FunctionDef)}
    after = {n.name: ast.dump(n) for n in ast.parse(source).body if isinstance(n, ast.FunctionDef)}
    allowed = {"_submit", "_language_editor_target" if editor else "_project_registry_for_job"}
    assert {name for name in before if before[name] != after[name]} <= allowed
    compile(source, "batch_submitter.py", "exec")
    return source


def package(source, destination, editor=False):
    with ZipFile(source) as archive:
        files = {name: archive.read(name) for name in archive.namelist()}
    files["batch_submitter.py"] = overlay(files["batch_submitter.py"].decode(), editor).encode()
    files["midform_submitter.py"] = (Path(__file__).parents[1] / "infra/aws/lambda/midform_submitter.py").read_bytes()
    with ZipFile(destination, "w") as archive:
        for name, content in files.items():
            archive.writestr(name, content)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--editor", action="store_true")
    args = parser.parse_args()
    package(args.source, args.destination, args.editor)
