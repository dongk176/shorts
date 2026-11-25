"""Package the reviewed additive SNS/editor identity overlay; never deploy AWS."""
from __future__ import annotations
import argparse
import base64
import hashlib
import io
from pathlib import Path
from zipfile import ZipFile

BASE_CODE_SHA256 = '+lptlTPOMFlzJzBrAEjWwxWAt16MWnFtWViuAT/URPs='
TARGET = 'language_test_submitter.py'
FIXTURES = Path(__file__).resolve().parent / 'fixtures/ytdlp-recovery-20261125'


def package(source: Path, output: Path) -> None:
    blob = source.read_bytes()
    if base64.b64encode(hashlib.sha256(blob).digest()).decode() != BASE_CODE_SHA256:
        raise ValueError('Live editor submitter archive changed; re-inspect before packaging')
    before = (FIXTURES / 'language_test_submitter.before.py').read_bytes()
    after = (FIXTURES / 'language_test_submitter.after.py').read_bytes()
    compile(after, TARGET, 'exec')
    with ZipFile(io.BytesIO(blob)) as original:
        assert original.read(TARGET) == before
        with ZipFile(output, 'w') as result:
            for entry in original.infolist():
                result.writestr(entry, after if entry.filename == TARGET else original.read(entry.filename))
        with ZipFile(output) as result:
            assert original.namelist() == result.namelist()
            assert [name for name in original.namelist() if original.read(name) != result.read(name)] == [TARGET]
    print('Verified exactly one module changed; archive sha256=' + hashlib.sha256(output.read_bytes()).hexdigest())


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    package(args.source, args.output)
