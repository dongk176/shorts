"""Overlay only explicit QA branches onto freshly inspected production archives."""

import argparse
import ast
import hashlib
from pathlib import Path
from zipfile import ZipFile

PROJECT_SHA = "bcdbf71cee76e53760d9a26ff620ec870c5630e17fbec1dcbc88cf57048b2f7e"
EDITOR_SHA = "bc9ecf27389b07a0264e8ec8d7ca72554fc3eea99f17989f45235c3aa9a4e230"


class OrdinaryPath(ast.NodeTransformer):
    """A missing nullable QA marker must execute precisely the original AST."""

    def visit_If(self, node):
        if (
            isinstance(node.test, ast.Call)
            and isinstance(node.test.func, ast.Attribute)
            and node.test.func.attr == "get"
            and len(node.test.args) == 1
            and isinstance(node.test.args[0], ast.Constant)
            and node.test.args[0].value == "silence_test_release_id"
        ):
            if node.orelse:
                raise ValueError("QA branch must not replace ordinary behavior")
            return None
        return self.generic_visit(node)

    def visit_Constant(self, node):
        if isinstance(node.value, str):
            node.value = node.value.replace(
                "midform_release_id,midform_request,silence_test_release_id",
                "midform_release_id,midform_request",
            )
        return node


def overlay(source, editor=False):
    if hashlib.sha256(source.encode()).hexdigest() != (
        EDITOR_SHA if editor else PROJECT_SHA
    ):
        raise ValueError("Production submitter changed; inspect again")
    original = source
    query = "midform_release_id,midform_request"
    if source.count(query) != (1 if editor else 2):
        raise ValueError("Expected one job query")
    source = source.replace(query, query + ",silence_test_release_id")
    if editor:
        marker = "def _language_editor_target(request_id, parent_job):\n"
        branch = """    if parent_job.get("silence_test_release_id"):
        import silence_test_submitter
        import language_test_submitter
        return silence_test_submitter.editor_target(language_test_submitter, request_id, parent_job)
"""
    else:
        marker = "def _project_registry_for_job(job: dict[str, Any]) -> dict[str, Any] | None:\n"
        branch = """    if job.get("silence_test_release_id"):
        import sys
        import silence_test_submitter
        registry = silence_test_submitter.release_for_job(sys.modules[__name__], job)["registry"]
        return _validate_project_target_registry(registry)
"""
        # Keep the complete existing implementation behind a single nullable marker.
        initial = '    if job.get("midform_release_id"):\n        import sys\n        import midform_submitter\n        return midform_submitter.initial_render_environment('
        if source.count(initial) != 1:
            raise ValueError("Initial render branch changed")
        source = source.replace(
            initial,
            """    if job.get("silence_test_release_id"):
        import sys
        import silence_test_submitter
        return silence_test_submitter.initial_render_environment(
            sys.modules[__name__], job, job_definition=job_definition,
            job_queue=job_queue, resume=resume,
        )
"""
            + initial,
        )
    if source.count(marker) != 1:
        raise ValueError("Submitter insertion point changed")
    source = source.replace(marker, marker + branch)
    runtime_marker = (
        '        submission_key = f"rerender:{short_id}:{version}:{rerender_attempt}"'
        if editor
        else '        submission_key = (\n            f"project:{job_id}:resume:1"'
    )
    if source.count(runtime_marker) != 1:
        raise ValueError("Submission boundary changed")
    runtime_job = "parent_job" if editor else "job"
    source = source.replace(
        runtime_marker,
        f'        if {runtime_job}.get("silence_test_release_id"):\n'
        "            import silence_test_submitter\n"
        f"            silence_test_submitter.bind_request(request, {runtime_job})\n"
        + runtime_marker,
    )
    before = {
        n.name: ast.dump(n)
        for n in ast.parse(original).body
        if isinstance(n, ast.FunctionDef)
    }
    after = {
        n.name: ast.dump(n)
        for n in ast.parse(source).body
        if isinstance(n, ast.FunctionDef)
    }
    allowed = (
        {"_submit", "_language_editor_target"}
        if editor
        else {
            "_submit",
            "_project_registry_for_job",
            "_initial_render_v4_environment",
        }
    )
    if (
        set(before) != set(after)
        or not {name for name in before if before[name] != after[name]} <= allowed
    ):
        raise ValueError("Unrelated submitter behavior changed")
    if ast.dump(OrdinaryPath().visit(ast.parse(source))) != ast.dump(
        ast.parse(original)
    ):
        raise ValueError("Ordinary path is not identical to inspected production")
    compile(source, "batch_submitter.py", "exec")
    return source


def package(source, destination, editor=False):
    with ZipFile(source) as archive:
        files = {name: archive.read(name) for name in archive.namelist()}
    files["batch_submitter.py"] = overlay(
        files["batch_submitter.py"].decode(), editor
    ).encode()
    files["silence_test_submitter.py"] = (
        Path(__file__).parents[1] / "infra/aws/lambda/silence_test_submitter.py"
    ).read_bytes()
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
