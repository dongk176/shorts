"""Prepare a minimal patch against the inspected deployed Lambda archive.

This only builds a local ZIP; it never deploys or changes AWS configuration.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import io
from pathlib import Path
from zipfile import ZipFile

BASE_SHA256 = "df41a0e94ab04a87e5d69472d7c0bda686ef7bd6891443fde76b9357ab8d5edf"
TARGET = "language_test_submitter.py"
ROOT = Path(__file__).resolve().parents[1]


def package(source: Path, output: Path) -> None:
    blob = source.read_bytes()
    if hashlib.sha256(blob).hexdigest() != BASE_SHA256:
        raise ValueError("Deployed archive changed; inspect the new version first")
    with ZipFile(io.BytesIO(blob)) as archive:
        original = archive.read(TARGET).decode()
        old = "language_release and _contrast_editor_kind(releases[0]) is not None"
        if original.count(old) != 1:
            raise ValueError("Expected exact validation branch was not found")
        patched = original.replace(
            "from __future__ import annotations",
            "from __future__ import annotations\n"
            "from editor_incident_identity import is_registered_japanese_editor", 1,
        ).replace(old, "language_release and ("
                  "_contrast_editor_kind(releases[0]) is not None "
                  "or is_registered_japanese_editor(releases[0]))")
        compile(patched, TARGET, "exec")
        # Every existing function except the target validator must be identical.
        def preserved_tree(text):
            tree = ast.parse(text)
            tree.body = [n for n in tree.body if not (
                isinstance(n, ast.FunctionDef) and n.name == "_editor_release_target"
                or isinstance(n, ast.ImportFrom) and n.module == "editor_incident_identity"
            )]
            return ast.dump(tree)
        if preserved_tree(original) != preserved_tree(patched):
            raise ValueError("Unrelated deployed behavior was changed")
        with ZipFile(output, "w") as result:
            for entry in archive.infolist():
                result.writestr(entry, patched.encode() if entry.filename == TARGET
                                else archive.read(entry.filename))
            result.writestr("editor_incident_identity.py",
                            (ROOT / "infra/aws/lambda/editor_incident_identity.py").read_bytes())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    package(args.source, args.output)
