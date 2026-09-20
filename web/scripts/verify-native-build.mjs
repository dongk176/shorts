import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function assertNativeBuildPlatform({ platform, architecture, vercel }) {
  if (vercel !== "1") return;
  if (platform !== "linux" || !["x64", "arm64"].includes(architecture)) {
    throw new Error(
      "Vercel functions need Linux sharp binaries. Build this deployment on Vercel "
      + "(vercel deploy --prod --skip-domain), or in a matching Linux build environment. "
      + "Do not deploy macOS/Windows prebuilt output.",
    );
  }
}

export async function verifyNativeBuild() {
  assertNativeBuildPlatform({
    platform: process.platform, architecture: process.arch, vercel: process.env.VERCEL,
  });
  const { default: sharp } = await import("sharp");
  // Exercise the native codec, not just the JS package or a mocked decoder.
  const encoded = await sharp({
    create: { width: 16, height: 16, channels: 3, background: "#174b70" },
  }).webp().toBuffer();
  const decoded = await sharp(encoded).metadata();
  if (decoded.format !== "webp" || decoded.width !== 16 || decoded.height !== 16) {
    throw new Error("The sharp WebP runtime check failed; deployment build stopped.");
  }
  console.log(`Native image runtime verified: ${process.platform}-${process.arch}, sharp ${sharp.versions.sharp}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  verifyNativeBuild().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
