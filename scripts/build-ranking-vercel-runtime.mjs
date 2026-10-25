import { readFile, writeFile, mkdir, copyFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "worker/shorts_worker");
const output = path.join(root, "web/private/ranking-runtime");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const design = JSON.parse(
  await readFile(path.join(source, "assets/ranking_templates.json"), "utf8"),
);
const names = [
  "__init__.py",
  "errors.py",
  "url_validation.py",
  "ranking_pipeline.py",
  "ranking_po_runtime.py",
  "ranking_vercel_service.py",
  "assets/ranking_templates.json",
  "assets/ranking_audio.json",
  ...Object.values(design.fonts).map((f) => "assets/editor_fonts/" + f.file),
  ...JSON.parse(await readFile(path.join(source, "assets/ranking_audio.json"), "utf8")).flatMap(
    (sound) => [sound.id, sound.asset].map(asset => "assets/ranking_audio/" + asset + ".mp4"),
  ),
];
const files = [];
for (const name of names) {
  const dest = path.join(output, "shorts_worker", name);
  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(path.join(source, name), dest);
  files.push({
    path: "shorts_worker/" + name,
    sha256: createHash("sha256")
      .update(await readFile(dest))
      .digest("hex"),
  });
}
await writeFile(
  path.join(output, "manifest.json"),
  JSON.stringify({ version: 1, files }, null, 2),
);

execFileSync("tar", [
  "-czf",
  path.join(output, "runtime.tar.gz"),
  "-C",
  output,
  "shorts_worker",
]);
const archiveSha256 = createHash("sha256")
  .update(await readFile(path.join(output, "runtime.tar.gz")))
  .digest("hex");
await writeFile(
  path.join(output, "manifest.json"),
  JSON.stringify({ version: 1, archiveSha256, files }, null, 2),
);
