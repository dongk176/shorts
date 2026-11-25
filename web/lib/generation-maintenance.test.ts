import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { generationMaintenanceResponse, GENERATION_MAINTENANCE_START, GENERATION_MAINTENANCE_END } from "./generation-maintenance";

const during = GENERATION_MAINTENANCE_START + 1000;
const request = (path: string, method = "GET", headers: Record<string, string> = {}) => new NextRequest(`https://www.easycut.co.kr${path}`, { method, headers });

describe("temporary generation maintenance", () => {
  it("reopens exactly at 14:00 KST without a second deployment", () => {
    expect(generationMaintenanceResponse(request("/"), GENERATION_MAINTENANCE_START - 1, "scheduled")).toBeNull();
    expect(generationMaintenanceResponse(request("/api/jobs", "POST"), GENERATION_MAINTENANCE_END - 1, "scheduled")?.status).toBe(503);
    expect(generationMaintenanceResponse(request("/api/jobs", "POST"), GENERATION_MAINTENANCE_END, "scheduled")).toBeNull();
  });
  it.each([["/", "ko", "오후 2시"], ["/en", "en", "05:00 UTC"], ["/jp/ranking-shorts", "ja", "14:00"]])("localizes %s and avoids shared caching", async (path, locale, time) => {
    const response = generationMaintenanceResponse(request("/api/jobs", "POST", { referer: `https://www.easycut.co.kr${path}` }), during, "scheduled")!;
    expect(response.status).toBe(503);
    expect(response.headers.get("content-language")).toBe(locale);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.text()).toContain(time);
  });
  it.each(["/api/jobs", "/api/youtube/analyze", "/api/file-upload/sessions", "/api/ranking-shorts", "/api/ranking-shorts/discover", "/api/ranking-shorts/id/render", "/api/ranking-shorts/id/sources", "/api/ranking-shorts/id/session", "/api/ranking-shorts/id/sources/source/preview"])("rejects creation before auth, data writes, or charging: %s", async path => {
    const response = generationMaintenanceResponse(request(path, "POST", { referer: "https://www.easycut.co.kr/jp/ranking-shorts" }), during, "scheduled")!;
    expect(response.status).toBe(503);
    expect(response.headers.get("content-language")).toBe("ja");
    expect((await response.json()).code).toBe("GENERATION_MAINTENANCE");
  });
  it.each([["/", "GET"], ["/en", "GET"], ["/jp", "GET"], ["/ranking-shorts", "GET"], ["/projects/31338", "GET"], ["/projects/31338/edit/id", "GET"], ["/api/shorts/id/rerender", "POST"], ["/api/shorts/id/download", "GET"], ["/api/jobs/id", "GET"], ["/api/file-upload/sessions/id", "DELETE"], ["/api/ranking-shorts/id", "PATCH"], ["/api/cron/billing-renewals", "GET"], ["/guidebook", "GET"], ["/pricing", "GET"], ["/admin/easycutcutcutcutcutcut", "GET"]])("preserves existing projects, editing, downloads and unrelated services: %s", (path, method) => {
    expect(generationMaintenanceResponse(request(path, method), during)).toBeNull();
  });
});


describe("verified reopening and recovery rollback", () => {
  it("keeps recovery closed after the old scheduled deadline", async () => {
    const response = generationMaintenanceResponse(request("/api/jobs", "POST"), GENERATION_MAINTENANCE_END + 1, "recovery")!;
    expect(response.status).toBe(503);
    expect((await response.json()).endsAt).toBeNull();
    expect(response.headers.get("retry-after")).toBe("300");
  });
  it("opens immediately only for the open release", () => {
    expect(generationMaintenanceResponse(request("/api/jobs", "POST"), during, "open")).toBeNull();
  });
  it.each(["/", "/projects/31338", "/pricing", "/api/shorts/id/rerender"])("recovery does not block existing paths: %s", path => {
    expect(generationMaintenanceResponse(request(path, path.endsWith("rerender") ? "POST" : "GET"), during, "recovery")).toBeNull();
  });
});
