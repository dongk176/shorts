"""Ranking downloads share the existing Webshare IP admission, never an active lease."""

from __future__ import annotations

import json
import random
import time

from .ingestion import _parse_configured_routes
from .ranking_pipeline import RankingDownloadFailure, RankingFailure


class RankingEgress:
    def __init__(self, service, operation):
        self.service = service
        self.operation = str(operation["id"])
        routes = _parse_configured_routes(
            "INGESTION_PROXY_ROUTES_JSON", default_egress_class="webshare_isp", max_routes=32
        )
        self.routes = {r.route_id: r.proxy_url for r in routes if r.egress_class == "webshare_isp"}
        if not self.routes:
            raise RankingFailure("영상 다운로드 경로를 준비 중입니다. 잠시 후 다시 시도해 주세요.")

    def claim(self, excluded):
        with self.service.db() as db:
            row = db.execute(
                "select shorts_ranking_runtime.claim_route(%s,%s,%s,%s) as route",
                (self.operation, self.service.task, list(self.routes), excluded),
            ).fetchone()
        return row["route"]

    def release(self, route, result):
        with self.service.db() as db:
            db.execute(
                "select shorts_ranking_runtime.release_route(%s,%s,%s,%s)",
                (self.operation, self.service.task, route, result),
            )

    def run(self, action, deadline):
        attempted = []
        wait_until = min(deadline, time.monotonic() + 60)
        while len(attempted) < min(20, len(self.routes)) and time.monotonic() < deadline:
            route = self.claim(attempted)
            if not route:
                if time.monotonic() >= wait_until:
                    break
                time.sleep(1)
                continue
            if route not in self.routes:
                self.release(route, "terminal")
                raise RankingFailure("영상 다운로드 경로 설정을 확인해 주세요.")
            attempted.append(route)
            result = "terminal"
            try:
                value = action(self.routes[route])
                result = "success"
                return value
            except RankingDownloadFailure as exc:
                result = exc.category
                if result == "terminal":
                    raise
            finally:
                self.release(route, result)
                print(
                    json.dumps(
                        {
                            "event": "ranking_ingestion",
                            "operation": self.operation,
                            "route": route,
                            "result": result,
                            "attempt": len(attempted),
                        }
                    ),
                    flush=True,
                )
            time.sleep(random.uniform(0.8, 1.2))
        raise RankingFailure(
            "현재 영상 다운로드 요청이 많거나 연결이 지연됩니다. 잠시 후 다시 시도해 주세요."
        )
