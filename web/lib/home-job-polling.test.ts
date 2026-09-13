import { afterEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EstimatedProcessingOverlay } from "../components/project-card";
import type { VideoJob } from "./contracts";
import { startHomeJobPolling } from "./home-job-polling";

vi.mock("@/lib/i18n/provider", () => ({ useI18n: () => ({ locale: "ko" }) }));

const job = (id: string, stage = "queued", status = "processing", rerendering = false) => ({
  id, stage, status, shorts: rerendering ? [{ status: "rerendering" }] : [],
}) as VideoJob;
afterEach(() => vi.useRealTimers());

it("updates stages through completion without a full home reload at each tick", async () => {
  vi.useFakeTimers();
  const read = vi.fn().mockResolvedValueOnce({ job: job("a", "downloading") })
    .mockResolvedValueOnce({ job: job("a", "transcribing") })
    .mockResolvedValueOnce({ job: job("a", "completed", "completed") });
  const apply = vi.fn(); const settled = vi.fn().mockResolvedValue(undefined);
  const stop = startHomeJobPolling({ jobIds: ["a"], read, apply, settled, failed: vi.fn() });
  await vi.advanceTimersByTimeAsync(6000);
  expect(apply.mock.calls.map(([v]) => v.job.stage)).toEqual(["downloading", "transcribing"]);
  expect(settled).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(3000);
  expect(apply.mock.calls[2][0].job.status).toBe("completed");
  expect(settled).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60000);
  expect(read).toHaveBeenCalledTimes(3); stop();
});

it("retries a failed job and updates other simultaneous jobs", async () => {
  vi.useFakeTimers(); const failed = vi.fn(); const apply = vi.fn();
  const read = vi.fn().mockRejectedValueOnce(new Error("timeout"))
    .mockImplementation(async (id: string) => ({ job: job(id, "rendering") }));
  const stop = startHomeJobPolling({ jobIds: ["a", "b"], read, apply, failed, settled: vi.fn() });
  await vi.advanceTimersByTimeAsync(6000);
  expect(failed).toHaveBeenCalledTimes(1);
  expect(apply.mock.calls.map(([v]) => v.job.id)).toEqual(["b", "a", "b"]); stop();
});

it("discards a delayed response after cleanup and never overlaps requests", async () => {
  vi.useFakeTimers(); let resolve!: (v: {job: VideoJob}) => void;
  const read = vi.fn(() => new Promise<{job: VideoJob}>(r => { resolve = r; }));
  const apply = vi.fn(); const settled = vi.fn();
  const stop = startHomeJobPolling({ jobIds: ["a", "b"], read, apply, settled, failed: vi.fn() });
  await vi.advanceTimersByTimeAsync(30000);
  expect(read).toHaveBeenCalledTimes(1); stop();
  resolve({ job: job("a") }); await vi.advanceTimersByTimeAsync(1);
  expect(apply).not.toHaveBeenCalled(); expect(settled).not.toHaveBeenCalled();
});

it("continues polling completed projects while a short rerenders", async () => {
  vi.useFakeTimers(); const settled = vi.fn().mockResolvedValue(undefined);
  const read = vi.fn().mockResolvedValueOnce({job: job("a", "completed", "completed", true)})
    .mockResolvedValue({job: job("a", "completed", "completed")});
  const stop = startHomeJobPolling({jobIds:["a"],read,apply:vi.fn(),settled,failed:vi.fn()});
  await vi.advanceTimersByTimeAsync(3000); expect(settled).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(3000); expect(settled).toHaveBeenCalledTimes(1); stop();
});


it("renders the home card's current stage from each poll response", async () => {
  vi.useFakeTimers();
  const stages = ["queued", "downloading", "transcribing", "selecting", "rendering"];
  const read = vi.fn(async () => ({ job: job("a", stages.shift()) }));
  const screens: string[] = [];
  const stop = startHomeJobPolling({ jobIds: ["a"], read,
    apply: ({job: current}) => screens.push(renderToStaticMarkup(createElement(
      EstimatedProcessingOverlay, { operationKey: "a", durationSeconds: 300, job: current },
    ))), settled: vi.fn(), failed: vi.fn(),
  });
  await vi.advanceTimersByTimeAsync(15000);
  for (const [index, label] of ["작업을 시작하고 있습니다", "원본 영상을 다운로드하고 있습니다",
    "영상 내용을 분석하고 있습니다", "쇼츠 장면을 찾고 있습니다", "쇼츠를 생성하고 있습니다"].entries()) {
    expect(screens[index]).toContain(label);
  }
  stop();
});
