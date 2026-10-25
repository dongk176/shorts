"""Initialize a fresh, explicitly selected disposable localhost ranking_test DB."""

import json
import os
from pathlib import Path
from urllib.parse import urlsplit

import psycopg

url = os.environ["RANKING_TEST_DATABASE_URL"]
parsed = urlsplit(url)
assert parsed.hostname in {"127.0.0.1", "localhost"} and parsed.path == "/ranking_test"
root = Path(__file__).resolve().parents[2]
with psycopg.connect(url) as db:
    db.execute((root / "worker/tests/fixtures/ranking_route_schema.sql").read_text())
    for row in json.loads((root / "worker/tests/fixtures/ranking_route_baseline.json").read_text()):
        db.execute(row["definition"])
    for name in [
        "20261024081212_ranking_shorts_admin.sql",
        "20261024110000_ranking_webshare_admission.sql",
        "20261025081932_ranking_vercel_sessions.sql",
        "20261025121506_ranking_parallel_downloads.sql",
    ]:
        db.execute((root / "supabase/migrations" / name).read_text())
