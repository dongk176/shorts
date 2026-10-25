// Run only against the verified deployment project. No user data or secrets enter snapshots.
import { Sandbox } from "../web/node_modules/@vercel/sandbox/dist/index.js";
import { writeFile } from "node:fs/promises";
const projectId = process.env.VERCEL_PROJECT_ID;
const teamId = process.env.VERCEL_TEAM_ID;
const token = process.env.VERCEL_TOKEN;
if (!projectId || !teamId || !token)
  throw new Error("Explicit verified Vercel project/team/token required");
let sandbox;
try {
  sandbox = await Sandbox.create({
    projectId,
    teamId,
    token,
    image: "vercel/sandbox/ubuntu",
    persistent: false,
    timeout: 12 * 60000,
    resources: { vcpus: 2 },
    region: "icn1",
  });
  const steps = [
    ["apt-get", ["update"], true],
    [
      "apt-get",
      [
        "install",
        "-y",
        "ffmpeg",
        "python3-venv",
        "nodejs",
        "npm",
        "build-essential",
        "libcairo2-dev",
        "libpango1.0-dev",
        "libjpeg-dev",
        "libgif-dev",
        "librsvg2-dev",
      ],
      true,
    ],
    ["python3", ["-m", "venv", "/vercel/sandbox/venv"]],
    [
      "/vercel/sandbox/venv/bin/pip",
      [
        "install",
        "yt-dlp[default]==2026.7.4",
        "bgutil-ytdlp-pot-provider==1.3.1",
        "yt-dlp-ejs==0.8.0",
        "Pillow==11.3.0",
        "httpx==0.28.1",
      ],
    ],
    [
      "python3",
      [
        "-c",
        "import urllib.request,hashlib,tarfile,pathlib,shutil; p=pathlib.Path('/tmp/provider.tgz'); urllib.request.urlretrieve('https://codeload.github.com/Brainicism/bgutil-ytdlp-pot-provider/tar.gz/fbe4ed47f3b63cf061f1158f18f74bcc90e54033',p); assert hashlib.sha256(p.read_bytes()).hexdigest()=='cbc8c2e54126ec38f4c2a278b3cab685d337cadc3e7f09762116e3b28be18b5f'; tarfile.open(p).extractall('/tmp/provider',filter='data'); shutil.move(next(pathlib.Path('/tmp/provider').iterdir()),'/opt/bgutil-ytdlp-pot-provider')",
      ],
      true,
    ],
    [
      "npm",
      ["ci", "--no-audit", "--no-fund"],
      true,
      "/opt/bgutil-ytdlp-pot-provider/server",
    ],
    [
      "/opt/bgutil-ytdlp-pot-provider/server/node_modules/.bin/tsc",
      [],
      true,
      "/opt/bgutil-ytdlp-pot-provider/server",
    ],
    [
      "node",
      [
        "/opt/bgutil-ytdlp-pot-provider/server/build/generate_once.js",
        "--version",
      ],
    ],
  ];
  for (const [cmd, args, sudo = false, cwd] of steps) {
    const result = await sandbox.runCommand({ cmd, args, sudo, cwd });
    if (result.exitCode !== 0)
      throw new Error(`Dependency installation failed: ${cmd}`);
  }
  const result = await sandbox.snapshot();
  await writeFile(
    process.env.RANKING_SNAPSHOT_RECORD || "ranking-snapshot.json",
    JSON.stringify(
      {
        projectId,
        teamId,
        snapshotId: result.snapshotId,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log("Dependency snapshot created", result.snapshotId);
} finally {
  await sandbox?.stop().catch(() => undefined);
}
