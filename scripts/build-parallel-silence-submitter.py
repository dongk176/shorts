"""Build an additive submitter archive without replacing live private helpers.

This does not deploy. Input must be an independently downloaded and SHA256-verified
production Lambda archive. It preserves all existing files except the three
explicit branch additions and two projection additions in batch_submitter.py.
"""
import argparse
import ast
import base64
import hashlib
import io
import json
from pathlib import Path
import zipfile


def build(original: bytes, expected_hash: str, source: Path, *, editor: bool = False) -> tuple[bytes, dict]:
    if base64.b64encode(hashlib.sha256(original).digest()).decode() != expected_hash:
        raise ValueError("Live archive hash changed")
    with zipfile.ZipFile(io.BytesIO(original)) as archive:
        entries = {name: archive.read(name) for name in archive.namelist()}
    if "silence_inline_submitter.py" in entries:
        raise ValueError("Parallel routing already present; inspect latest deployment")
    before = entries["batch_submitter.py"].decode()
    local = (source / "batch_submitter.py").read_text()
    patched = before
    branches = []
    for name in (() if editor else (
        "_project_registry_for_job", "_initial_render_v4_environment", "_editor_release_target"
    )):
        node = next(n for n in ast.parse(local).body if isinstance(n, ast.FunctionDef) and n.name == name)
        addition = "".join(local.splitlines(keepends=True)[node.body[0].lineno - 1:node.body[0].end_lineno])
        if "silence_inline_release_id" not in addition or addition in before:
            raise ValueError("Unexpected branch source")
        target = next(n for n in ast.parse(patched).body if isinstance(n, ast.FunctionDef) and n.name == name)
        lines = patched.splitlines(keepends=True)
        lines.insert(target.body[0].lineno - 1, addition)
        patched = "".join(lines)
        branches.append(addition)
    if editor:
        marker = "def _language_editor_target(request_id, parent_job):\n"
        addition = '    if parent_job.get("silence_inline_release_id"):\n        import silence_inline_submitter\n        import language_test_submitter\n        return silence_inline_submitter.editor_target(language_test_submitter, parent_job, request_id)\n'
        if patched.count(marker) != 1:
            raise ValueError("Live editor target changed")
        patched = patched.replace(marker, marker + addition)
        branches.append(addition)
    replacements = [
        ("initial_editor_release_id,language_test_release_id,midform_release_id",
         "initial_editor_release_id,language_test_release_id,silence_inline_release_id,midform_release_id"),
        ("language_test_release_id,initial_editor_release_id,template_snapshot",
         "language_test_release_id,initial_editor_release_id,silence_inline_release_id,template_snapshot"),
    ]
    if editor:
        replacements = replacements[1:]
    for old, new in replacements:
        if patched.count(old) != 1:
            raise ValueError("Live job projection changed")
        patched = patched.replace(old, new)
    # A byte-exact inverse establishes that nothing else in the live main handler changed.
    restored = patched
    for branch in branches:
        restored = restored.replace(branch, "", 1)
    for old, new in replacements:
        restored = restored.replace(new, old, 1)
    if restored != before:
        raise ValueError("Unexpected live-handler changes")
    ast.parse(patched)
    entries["batch_submitter.py"] = patched.encode()
    entries["silence_inline_submitter.py"] = (source / "silence_inline_submitter.py").read_bytes()
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(entries.items()):
            archive.writestr(name, data)
    result = stream.getvalue()
    return result, {
        "baselineCodeSha256": expected_hash,
        "candidateCodeSha256": base64.b64encode(hashlib.sha256(result).digest()).decode(),
        "preservedFiles": sorted(set(entries) - {"batch_submitter.py", "silence_inline_submitter.py"}),
        "changedFiles": ["batch_submitter.py"], "addedFiles": ["silence_inline_submitter.py"],
        "deployed": False,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("expected_hash")
    parser.add_argument("output", type=Path)
    parser.add_argument("--editor", action="store_true")
    args = parser.parse_args()
    source = Path(__file__).resolve().parents[1] / "infra/aws/lambda"
    result, manifest = build(args.archive.read_bytes(), args.expected_hash, source, editor=args.editor)
    args.output.write_bytes(result)
    args.output.with_suffix(".json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest))
