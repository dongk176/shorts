from __future__ import annotations

import os
import shutil
from pathlib import Path

import pytest

from fargate_render_load import run_load_test

pytestmark = [
    pytest.mark.render,
    pytest.mark.skipif(
        os.getenv("RUN_FARGATE_RENDER_LOAD_TEST") != "1"
        or shutil.which("ffmpeg") is None
        or shutil.which("ffprobe") is None,
        reason="run inside the 4 vCPU/30 GB Fargate image as a deployment gate",
    ),
]


def test_two_sixty_second_comment_renders_stay_below_27_gib(tmp_path: Path) -> None:
    result = run_load_test(tmp_path)

    assert result["peakMemoryBytes"] < 27 * 1024**3
