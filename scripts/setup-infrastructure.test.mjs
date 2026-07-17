import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const script = fs.readFileSync(new URL("./setup-infrastructure.sh", import.meta.url), "utf8");

test("applies Supabase migrations before deploying worker infrastructure", () => {
  const migrationIndex = script.indexOf("npm run db:migrate");
  const deployIndex = script.indexOf("npm --prefix infra/aws run deploy");

  assert.notEqual(migrationIndex, -1);
  assert.notEqual(deployIndex, -1);
  assert.ok(migrationIndex < deployIndex);
});
