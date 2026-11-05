import "server-only";
import { Sandbox } from "@vercel/sandbox";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { getSignedUrl } from "@aws-sdk/cloudfront-signer";
import { z } from "zod";
import { resolveEditorFontFaceV4 } from "./editor-fonts";
import { wrapPreviewTitle } from "./title-preview";

const resultSchema = z.object({ version: z.literal(1), preset: z.literal("aggressive"),
  silences: z.array(z.tuple([z.number().finite().nonnegative(), z.number().finite().nonnegative()])).max(1200),
  titleMeasurements: z.record(z.string(), z.record(z.string(), z.number().finite().nonnegative())).optional() }).strict();

export async function analyzeShortSilences(sourceKey: string, start: number, end: number) {
  return (await analyzeShortSilenceComposition(sourceKey, start, end)).silences;
}

export async function analyzeShortSilenceComposition(sourceKey: string, start: number, end: number,
  title?: { text: string; language: string }) {
  const host = process.env.CLOUDFRONT_DOMAIN;
  const keyPairId = process.env.CLOUDFRONT_KEY_PAIR_ID;
  const snapshotId = process.env.RANKING_VERCEL_SNAPSHOT_ID;
  if (!host || !/^[a-z0-9.-]+$/i.test(host) || !keyPairId || !snapshotId
    || !/^edit-sources\/[A-Za-z0-9/_-]+\.mp4$/.test(sourceKey)) throw new Error("SILENCE_ANALYSIS_CONFIGURATION");
  let privateKey = process.env.CLOUDFRONT_PRIVATE_KEY_B64
    ? Buffer.from(process.env.CLOUDFRONT_PRIVATE_KEY_B64, "base64").toString("utf8") : "";
  if (!privateKey && process.env.CLOUDFRONT_PRIVATE_KEY_PATH) privateKey = await readFile(path.resolve(process.cwd(), process.env.CLOUDFRONT_PRIVATE_KEY_PATH), "utf8");
  if (!privateKey) throw new Error("SILENCE_SIGNING_CONFIGURATION");
  const url = getSignedUrl({ url: `https://${host}/${sourceKey}`, keyPairId, privateKey,
    dateLessThan: new Date(Date.now() + 5 * 60_000).toISOString() });
  const script = await readFile(path.join(process.cwd(), "private/shorts-silence/analyze.py"));
  const face = title ? resolveEditorFontFaceV4(title.language === "ja" ? "noto-sans-jp" : "pretendard", "title") : null;
  const font = face ? await readFile(path.join(process.cwd(), "public/fonts/editor", face.fileId)) : null;
  if (font && createHash("sha256").update(font).digest("hex") !== face!.sha256) throw new Error("SILENCE_FONT_IDENTITY");
  const texts = title ? [...new Set(wrapPreviewTitle(title.text).flatMap(line => [line, ...line.split(" ")]))] : [];
  const titleMeasurement = face ? { sha256: face.sha256, variableWeight: face.variableWeight, texts } : undefined;
  const sandbox = await Sandbox.create({ source: { type: "snapshot", snapshotId }, persistent: false,
    timeout: 120_000, resources: { vcpus: 1 }, region: "icn1", name: `silence-${randomUUID()}`,
    networkPolicy: { allow: [host] } });
  try {
    await sandbox.writeFiles([
      { path: "/vercel/sandbox/silence-input.json", content: JSON.stringify({ host, url, start, end, titleMeasurement }), mode: 0o600 },
      { path: "/vercel/sandbox/silence-analyze.py", content: script, mode: 0o600 },
      ...(font ? [{ path: "/vercel/sandbox/silence-title-font", content: font, mode: 0o600 }] : []),
    ]);
    const result = await sandbox.runCommand({ cmd: title ? "/vercel/sandbox/venv/bin/python" : "python3", args: ["/vercel/sandbox/silence-analyze.py"] });
    if (result.exitCode !== 0) throw new Error("SILENCE_AUDIO_ANALYSIS_FAILED");
    return resultSchema.parse(JSON.parse(await result.stdout()));
  } finally {
    await sandbox.stop();
  }
}
