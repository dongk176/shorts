import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function creationBlockCodes(file) {
  const migration = fs.readFileSync(
    new URL(`../supabase/migrations/${file}`, import.meta.url),
    "utf8",
  );
  const values = migration.match(/creation_block_code in \(([\s\S]*?)\)/);
  assert.ok(values, `${file} must define creation_block_code values`);
  return new Set([...values[1].matchAll(/'([^']+)'/g)].map((match) => match[1]));
}

test("replayed availability migration accepts every current playback block code", () => {
  const replayedCodes = creationBlockCodes("202607150008_youtube_creation_availability.sql");
  const currentCodes = creationBlockCodes("202607170002_youtube_playback_availability.sql");

  for (const code of currentCodes) {
    assert.ok(replayedCodes.has(code), `${code} is missing from the replayed constraint`);
  }
});
