import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "vitest";
import { silenceEditDocument } from "./shorts-silence-contract";

describe("actual silence cuts and the unchanged editor renderer", () => {
  it("does not expose signed source access in a timeout traceback", () => {
    const root = path.resolve(import.meta.dirname, "../..");
    const script = `
import importlib.util, subprocess, sys, traceback
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('silence_analyzer',sys.argv[1])
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
url='https://cdn.example.com/edit-sources/test.mp4?Signature=temporary-private-access'
with patch.object(module.subprocess,'run',side_effect=subprocess.TimeoutExpired(['ffmpeg','-i',url],90)):
    try: module.analyze({'url':url,'host':'cdn.example.com','start':0,'end':12})
    except RuntimeError:
        message=traceback.format_exc()
        assert 'temporary-private-access' not in message and url not in message
        assert 'Owned audio analysis did not complete' in message
        print('redacted')
    else: raise AssertionError('Expected bounded analysis failure')
`;
    expect(execFileSync((process.env.WORKER_PYTHON || path.join(root, "worker/.venv/bin/python")), ["-c", script,
      path.join(root, "web/private/shorts-silence/analyze.py")], { encoding: "utf8", timeout: 10_000 }).trim()).toBe("redacted");
  });
  it.each([[0, "ko"], [240, "ko"], [240, "en"], [240, "ja"]] as const)("removes silence and retimes captions at offset %s in %s", (offset, language) => {
    const folder = mkdtempSync(path.join(os.tmpdir(), "shorts-silence-media-"));
    const root = path.resolve(import.meta.dirname, "../..");
    const python = (process.env.WORKER_PYTHON || path.join(root, "worker/.venv/bin/python"));
    const helper = path.join(root, "test-tools/silence-media-proof.py");
    try {
      const detected = JSON.parse(execFileSync(python, [helper, "prepare", folder, String(offset), language], { encoding: "utf8", timeout: 120_000 }));
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
