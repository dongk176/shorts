import assert from "node:assert/strict";
import test from "node:test";
import { assertNativeBuildPlatform } from "../web/scripts/verify-native-build.mjs";

test("rejects host-native macOS/Windows output for Vercel before deployment", () => {
  for (const platform of ["darwin", "win32"]) {
    assert.throws(() => assertNativeBuildPlatform({ platform, architecture: "arm64", vercel: "1" }), /Linux sharp binaries/);
  }
});

test("allows supported Linux Vercel builds and ordinary local builds", () => {
  for (const architecture of ["x64", "arm64"]) {
    assert.doesNotThrow(() => assertNativeBuildPlatform({ platform: "linux", architecture, vercel: "1" }));
  }
  assert.doesNotThrow(() => assertNativeBuildPlatform({ platform: "darwin", architecture: "arm64" }));
});
