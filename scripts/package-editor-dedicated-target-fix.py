"""Patch only SNS target validation in the inspected production editor archive."""
from __future__ import annotations

import argparse
import ast
import base64
import hashlib
import io
from pathlib import Path
from zipfile import ZipFile

BASE_SHA256 = "5gFF6LTU15FCDenWTwoUNTAM+yTJOPncdyo6F26Tq+g="


def target_function(source: str) -> ast.FunctionDef:
    return next(node for node in ast.parse(source).body
                if isinstance(node, ast.FunctionDef) and node.name == "_sns_editor_compatible")


def package(source: Path, output: Path) -> None:
    blob = source.read_bytes()
    if base64.b64encode(hashlib.sha256(blob).digest()).decode() != BASE_SHA256:
        raise ValueError("Production archive changed; inspect before packaging")
    feature = (Path(__file__).parents[1] / "infra/aws/lambda/batch_submitter.py").read_text()
    replacement = target_function(feature)
    with ZipFile(io.BytesIO(blob)) as archive:
        original = archive.read("language_test_submitter.py").decode()
        node = target_function(original)
        patched = "\n".join(original.splitlines()[:node.lineno - 1]
                            + feature.splitlines()[replacement.lineno - 1:replacement.end_lineno]
                            + original.splitlines()[node.end_lineno:]) + "\n"
        compile(patched, "language_test_submitter.py", "exec")
        before = ast.parse(original)
        after = ast.parse(patched)
        before.body = [n for n in before.body if n is not node and not (
            isinstance(n, ast.FunctionDef) and n.name == node.name)]
        after.body = [n for n in after.body if not (
            isinstance(n, ast.FunctionDef) and n.name == node.name)]
        assert ast.dump(before) == ast.dump(after)
        with ZipFile(output, "w") as result:
            for entry in archive.infolist():
                result.writestr(entry, patched.encode()
                                if entry.filename == "language_test_submitter.py"
                                else archive.read(entry.filename))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    package(args.source, args.output)
