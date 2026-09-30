"""Update the inspected editor wrapper without replacing ordinary editor routing."""
from __future__ import annotations

import argparse
import ast
import hashlib
from pathlib import Path
from zipfile import ZipFile

EDITOR_SHA = "70a63d00038eae7f5428554530b2d68bb35fbb6e98b344cd441d9a5c4d3a99f0"
FEATURE_SHA = "d024de99753902b3c907fb347a612fd7f677658a215ec162b2b0066290bd493b"


def package(source: Path, output: Path, feature: Path) -> None:
    with ZipFile(source) as archive:
        payloads = {name: archive.read(name) for name in archive.namelist()}
    wrapper = payloads["batch_submitter.py"].decode()
    old_feature = payloads["language_test_submitter.py"].decode()
    if hashlib.sha256(wrapper.encode()).hexdigest() != EDITOR_SHA:
        raise ValueError("Inspect the changed production editor wrapper before packaging")
    if hashlib.sha256(old_feature.encode()).hexdigest() != FEATURE_SHA:
        raise ValueError("Inspect the changed production feature resolver before packaging")
    before = '"language_test_release_id,initial_editor_release_id"'
    after = '"language_test_release_id,initial_editor_release_id,template_snapshot"'
    if wrapper.count(before) != 1:
        raise ValueError("Parent snapshot query is not unique")
    payloads["batch_submitter.py"] = wrapper.replace(before, after).encode()
    new_feature = feature.read_text()
    old_nodes = {n.name: ast.dump(n) for n in ast.parse(old_feature).body if isinstance(n, ast.FunctionDef)}
    new_nodes = {n.name: ast.dump(n) for n in ast.parse(new_feature).body if isinstance(n, ast.FunctionDef)}
    changed = {name for name in old_nodes if old_nodes[name] != new_nodes.get(name)}
    if changed != {"_editor_release_target", "_submit"} or new_nodes.keys() - old_nodes.keys() != {"_sns_editor_compatible"}:
        raise ValueError("Feature resolver contains changes beyond SNS editor routing")
    payloads["language_test_submitter.py"] = new_feature.encode()
    for name in ("batch_submitter.py", "language_test_submitter.py"):
        compile(payloads[name], name, "exec")
    with ZipFile(output, "w") as archive:
        for name, data in payloads.items():
            archive.writestr(name, data)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    package(args.source, args.output, Path(__file__).parents[1] / "infra/aws/lambda/batch_submitter.py")
