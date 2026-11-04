import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "vitest";
import { silenceEditDocument } from "./shorts-silence-contract";

describe("actual silence cuts and the unchanged editor renderer", () => {
  it.each([0, 240])("removes silence and retimes captions with source-clock offset %s", offset => {
    const folder = mkdtempSync(path.join(os.tmpdir(), "shorts-silence-media-"));
    const root = path.resolve(import.meta.dirname, "../..");
    const python = path.join(root, "worker/.venv/bin/python");
    const helper = path.join(root, "test-tools/silence-media-proof.py");
    try {
      const detected = JSON.parse(execFileSync(python, [helper, "prepare", folder, String(offset)], { encoding: "utf8", timeout: 120_000 }));
      expect(detected.silences).toHaveLength(2);
      const input = JSON.parse(readFileSync(path.join(folder, "input.json"), "utf8"));
      const plan = silenceEditDocument(input.short, input.timeline, input.silences);
      expect(plan.cutCount).toBe(2);
      expect(plan.removedSeconds).toBeGreaterThan(3.4);
      expect(plan.removedSeconds).toBeLessThan(3.9);
      writeFileSync(path.join(folder, "plan.json"), JSON.stringify(plan));
      const result = JSON.parse(execFileSync(python, [helper, "render", folder], { encoding: "utf8", timeout: 120_000 }));
      console.info("silence-media-proof", JSON.stringify(result));
      expect(result.codecs).toEqual(expect.arrayContaining(["h264", "aac"]));
      expect(result.outputSeconds).toBeCloseTo(plan.outputSeconds, 1);
    } finally { rmSync(folder, { recursive: true, force: true }); }
  }, 180_000);
});
