"""Export exact bundled CJK font coverage for browser/server validation."""
from pathlib import Path
import base64
import hashlib
import json
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
FONTS = {
    "noto-sans-kr": "NotoSansKR-Variable.ttf",
    "noto-serif-kr": "NotoSerifKR-Variable.ttf",
    "noto-sans-jp": "NotoSansCJKjp-Variable.ttf",
}
coverage = {}
for font_id, filename in FONTS.items():
    path = ROOT / "web/public/fonts/editor" / filename
    data = path.read_bytes()
    worker = ROOT / "worker/shorts_worker/assets/editor_fonts" / filename
    if data != worker.read_bytes():
        raise ValueError(f"Web/worker font mismatch: {font_id}")
    with TTFont(path) as font:
        points = sorted(font.getBestCmap())
    bitmap = bytearray(8192)
    ranges = []
    for point in points:
        if point < 65536:
            bitmap[point >> 3] |= 1 << (point & 7)
            continue
        if ranges and point == ranges[-1][1] + 1:
            ranges[-1][1] = point
        else:
            ranges.append([point, point])
    coverage[font_id] = {"file": filename, "sha256": hashlib.sha256(data).hexdigest(), "bmp": base64.b64encode(bitmap).decode("ascii"), "ranges": ranges}
(ROOT / "web/lib/editor-cjk-font-coverage.json").write_text(
    json.dumps(coverage, separators=(",", ":")) + "\n"
)
