"""Verify release handoff SQL without an application or shared-lab connection."""
from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys
import time
from uuid import uuid4

ROOT = Path(__file__).resolve().parent.parent
DOCKER = "/usr/local/bin/docker"
POSTGRES = "postgres@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685"


def run(args: list[str], **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(args, check=True, timeout=kwargs.pop("timeout", 45), **kwargs)


def main() -> None:
    if not Path(DOCKER).is_file():
        raise RuntimeError("The existing SQL tests require /usr/local/bin/docker")
    # Only this immutable image can be used, even if the local tag moves.
    run([DOCKER, "pull", POSTGRES], timeout=180)
    for scope, variable in [
        ("file-upload-successor", "FILE_UPLOAD_SUCCESSOR_TEST_CONTAINER"),
        ("project-target-successor", "PROJECT_TARGET_SUCCESSOR_TEST_CONTAINER"),
    ]:
        name = f"shorts-{scope}-test-release-{uuid4().hex[:12]}"
        database = scope.replace("-", "_") + "_test"
        run([DOCKER, "run", "--detach", "--rm", "--name", name,
             "--network", "none", "--label", f"easycut.test-scope={scope}",
             "--tmpfs", "/var/lib/postgresql/data:rw,size=512m",
             "--env", "POSTGRES_HOST_AUTH_METHOD=trust",
             "--env", f"POSTGRES_DB={database}", POSTGRES], capture_output=True)
        try:
            deadline = time.monotonic() + 45
            while True:
                ready = subprocess.run([DOCKER, "exec", name, "pg_isready", "-U", "postgres"],
                                       capture_output=True, timeout=10)
                if ready.returncode == 0:
                    break
                if time.monotonic() >= deadline:
                    raise RuntimeError("Isolated PostgreSQL did not become ready")
                time.sleep(1)
            env = dict(os.environ)
            for key in ["DATABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL"]:
                env.pop(key, None)
            env.update({variable: name, "PYTHONPATH": str(ROOT / "worker")})
            test = "test_" + scope.replace("-", "_") + "_postgres.py"
            run([sys.executable, "-m", "pytest", "-q", str(ROOT / "worker/tests" / test)],
                cwd=ROOT, env=env, timeout=300)
        finally:
            run([DOCKER, "rm", "--force", name], capture_output=True)


if __name__ == "__main__":
    main()
