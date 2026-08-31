#!/usr/bin/env node

// Local-only, in-memory visual harness. Never loads environment files, database
// clients, AWS SDKs, application API handlers, or browser automation.
import { createHash, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { createServer } from "vite";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const origin = "http://127.0.0.1:3017";
const assets = new Map();
const templates = new Map();
const controls = { failNextUpload: false, failNextRead: false, delayMs: 0 };

const blueSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><defs><pattern id="grid" width="120" height="120" patternUnits="userSpaceOnUse"><path d="M 120 0 L 0 0 0 120" fill="none" stroke="#59bfff" stroke-opacity=".32" stroke-width="3"/></pattern><linearGradient id="blue" x2="1" y2="1"><stop stop-color="#082a52"/><stop offset="1" stop-color="#075985"/></linearGradient></defs><path fill="url(#blue)" d="M0 0h1080v1920H0z"/><path fill="url(#grid)" d="M0 0h1080v1920H0z"/><circle cx="1050" cy="1700" r="360" fill="#38bdf8" opacity=".25"/></svg>`;
const coralSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><defs><linearGradient id="coral" x2="1" y2="1"><stop stop-color="#74202c"/><stop offset="1" stop-color="#2d123e"/></linearGradient></defs><path fill="url(#coral)" d="M0 0h1080v1920H0z"/><g fill="none" stroke="#ffb68b" stroke-width="7" opacity=".55"><circle cx="120" cy="80" r="240"/><circle cx="990" cy="1660" r="380"/><circle cx="990" cy="1660" r="260"/></g></svg>`;

function metadata(asset) {
  return { ...asset.metadata, imageUrl: `/api/background-assets/${asset.metadata.id}` };
}

function addAsset(id, displayName, body) {
  const asset = {
    metadata: { id, displayName, width: 1080, height: 1920, byteSize: body.length, createdAt: new Date().toISOString() },
    body, sha256: createHash("sha256").update(body).digest("hex"), listed: true,
  };
  assets.set(id, asset);
  return asset;
}

await Promise.all([
  sharp(Buffer.from(blueSvg)).webp({ quality: 85 }).toBuffer().then((body) => addAsset("11111111-1111-4111-8111-111111111111", "합성 블루 격자", body)),
  sharp(Buffer.from(coralSvg)).webp({ quality: 85 }).toBuffer().then((body) => addAsset("22222222-2222-4222-8222-222222222222", "합성 코랄 원형", body)),
]);
const samplePng = await sharp(Buffer.from(blueSvg.replaceAll("#59bfff", "#86efac").replaceAll("#075985", "#14532d"))).png().toBuffer();

function sendJson(response, status, body) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "private, no-store");
  response.end(JSON.stringify(body));
}
function fail(status, detail, code = "LOCAL_HARNESS_ERROR") {
  return Object.assign(new Error(detail), { status, code });
}
async function readBody(request, maxBytes = 4 * 1024 * 1024) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maxBytes) throw fail(413, "로컬 요청 본문이 너무 큽니다.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function delay() {
  if (controls.delayMs) await new Promise((done) => setTimeout(done, controls.delayMs));
}

async function handleApi(request, response, pathname) {
  if (!["GET", "HEAD"].includes(request.method) && request.headers.origin !== origin) {
    throw fail(403, "로컬 검증 페이지에서만 변경할 수 있습니다.");
  }
  if (pathname === "/__harness/control" && request.method === "POST") {
    const payload = JSON.parse((await readBody(request, 2048)).toString("utf8"));
    for (const key of ["failNextUpload", "failNextRead"]) if (typeof payload[key] === "boolean") controls[key] = payload[key];
    if (typeof payload.delayMs === "number") controls.delayMs = Math.min(3000, Math.max(0, payload.delayMs));
    sendJson(response, 200, { ...controls });
    return;
  }
  if (pathname === "/__harness/sample.png" && request.method === "GET") {
    response.setHeader("content-type", "image/png");
    response.setHeader("cache-control", "private, no-store");
    response.end(samplePng);
    return;
  }
  if (pathname === "/api/background-assets" && request.method === "GET") {
    const listed = [...assets.values()].filter((asset) => asset.listed);
    sendJson(response, 200, { assets: listed.map(metadata), quota: {
      listedCount: listed.length, pendingCount: 0, maxListed: 100,
      bytesUsed: [...assets.values()].reduce((sum, asset) => sum + asset.body.length, 0), maxBytes: 1024 ** 3,
    } });
    return;
  }
  if (pathname === "/api/background-assets" && request.method === "POST") {
    const body = await readBody(request);
    await delay();
    if (controls.failNextUpload) {
      controls.failNextUpload = false;
      throw fail(503, "의도한 로컬 업로드 실패입니다. 기존 배경은 바뀌지 않습니다.", "BACKGROUND_UPLOAD_TEST_FAILURE");
    }
    const multipart = new Request(`${origin}${pathname}`, { method: "POST", headers: request.headers, body });
    const file = (await multipart.formData()).get("file");
    if (!(file instanceof File) || file.size < 1 || file.size > 3 * 1024 * 1024) throw fail(413, "3MB 이하 이미지를 선택해 주세요.");
    const input = Buffer.from(await file.arrayBuffer());
    const image = sharp(input, { limitInputPixels: 20_000_000, failOn: "warning" }).timeout({ seconds: 8 });
    const info = await image.metadata();
    if (!["jpeg", "png", "webp"].includes(info.format) || (info.pages || 1) !== 1) throw fail(415, "정지 JPG·PNG·WebP만 사용할 수 있습니다.");
    const normalized = await image.autoOrient().toColourspace("srgb").flatten({ background: "#000000" })
      .resize(1080, 1920, { fit: "cover", position: "centre" }).webp({ quality: 85 }).toBuffer();
    if (normalized.length > 2 * 1024 * 1024) throw fail(413, "변환된 이미지가 너무 큽니다.");
    const sha256 = createHash("sha256").update(normalized).digest("hex");
    const existing = [...assets.values()].find((asset) => asset.sha256 === sha256);
    if ((!existing || !existing.listed) && [...assets.values()].filter((asset) => asset.listed).length >= 100) throw fail(409, "내 배경 목록은 최대 100개입니다.");
    const asset = existing || addAsset(randomUUID(), file.name.slice(0, 120), normalized);
    asset.listed = true;
    sendJson(response, existing ? 200 : 201, { asset: metadata(asset), reused: Boolean(existing) });
    return;
  }
  const assetId = /^\/api\/background-assets\/([0-9a-f-]{36})$/.exec(pathname)?.[1];
  if (assetId) {
    const asset = assets.get(assetId);
    if (!asset) throw fail(404, "로컬 배경을 찾을 수 없습니다.");
    if (request.method === "DELETE") {
      asset.listed = false;
      sendJson(response, 200, { removed: true, assetId });
      return;
    }
    if (request.method === "GET") {
      const imageVerification = !String(request.headers.accept || "").includes("image/");
      if (imageVerification) {
        await delay();
        if (controls.failNextRead) {
          controls.failNextRead = false;
          throw fail(404, "의도한 이미지 선택 실패입니다. 기존 배경은 바뀌지 않습니다.");
        }
      }
      response.setHeader("content-type", "image/webp");
      response.setHeader("cache-control", "private, no-store");
      response.end(asset.body);
      return;
    }
  }
  if (pathname === "/api/templates" && request.method === "GET") {
    sendJson(response, 200, { templates: [...templates.values()] });
    return;
  }
  const templateId = /^\/api\/templates\/([0-9a-f-]{36})$/.exec(pathname)?.[1];
  if ((pathname === "/api/templates" && request.method === "POST") || (templateId && request.method === "PUT")) {
    const payload = JSON.parse((await readBody(request, 128 * 1024)).toString("utf8"));
    const existing = templateId ? templates.get(templateId) : undefined;
    if (templateId && !existing) throw fail(404, "로컬 템플릿을 찾을 수 없습니다.");
    if (existing && payload.version !== existing.version) throw fail(409, "다른 창에서 저장했습니다. 최신 템플릿을 확인해 주세요.", "CUSTOM_TEMPLATE_VERSION_CONFLICT");
    const { customTemplateInputSchema } = await vite.ssrLoadModule("/lib/template-config.ts");
    const parsed = customTemplateInputSchema.safeParse({ name: payload.name, baseTemplateId: existing?.baseTemplateId || payload.baseTemplateId, config: payload.config });
    if (!parsed.success) throw fail(400, "템플릿 형식·문구 개수·길이·레이어 순서를 확인해 주세요.");
    if (parsed.data.config.background.kind === "uploaded_image" && !assets.has(parsed.data.config.background.assetId)) throw fail(404, "로컬 계정의 배경이 아닙니다.");
    const template = { ...parsed.data, id: templateId || randomUUID(), version: (existing?.version || 0) + 1, createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    templates.set(template.id, template);
    sendJson(response, existing ? 200 : 201, { template });
    return;
  }
  throw fail(404, "이 로컬 검증 서버에는 해당 API가 없습니다. 운영 서버로 연결하지 않습니다.");
}

const virtualLink = "\0local-harness-next-link";
const virtualImage = "\0local-harness-next-image";
const vite = await createServer({
  configFile: false,
  envDir: false,
  root: webRoot,
  publicDir: resolve(webRoot, "public"),
  appType: "mpa",
  logLevel: "warn",
  resolve: { alias: { "@": webRoot } },
  oxc: { jsx: { runtime: "automatic" } },
  define: { "process.env.NEXT_PUBLIC_EDITOR_RENDER_SPEC_V4_ENABLED": JSON.stringify("true") },
  server: { host: "127.0.0.1", port: 3017, strictPort: true, cors: false, allowedHosts: ["127.0.0.1"] },
  plugins: [{
    name: "local-custom-template-design-harness",
    enforce: "pre",
    resolveId(source) {
      if (source === "next/link") return virtualLink;
      if (source === "next/image") return virtualImage;
      if (source === "server-only" || source.startsWith("@aws-sdk/") || source === "postgres" || source.includes("/lib/db")) throw new Error("Server dependency is forbidden in the local UI harness");
    },
    load(id) {
      if (id === virtualLink) return `import { createElement } from "react"; export default function Link({ href, children, prefetch, scroll, replace, onNavigate, ...props }) { return createElement("a", { ...props, href: href === "/templates" ? "/#harness-library" : href }, children); }`;
      if (id === virtualImage) return `import { createElement } from "react"; export default function Image({ fill, unoptimized, priority, quality, loader, style, ...props }) { return createElement("img", { ...props, style: fill ? { position: "absolute", inset: 0, width: "100%", height: "100%", ...style } : style }); }`;
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.headers.host !== "127.0.0.1:3017") { sendJson(response, 403, { detail: "Loopback host only" }); return; }
        response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self' ws://127.0.0.1:3017; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'self'");
        const pathname = new URL(request.url || "/", origin).pathname;
        if (pathname === "/") request.url = "/tests/custom-template-design/index.html";
        if (pathname.startsWith("/api/") || pathname.startsWith("/__harness/")) {
          void handleApi(request, response, pathname).catch((error) => {
            sendJson(response, error.status || 400, { detail: error.message || "로컬 테스트 요청 오류", code: error.code || "LOCAL_HARNESS_ERROR" });
          });
          return;
        }
        next();
      });
    },
  }],
});

await vite.listen();
console.log(`Local visual harness ready: ${origin}/ (memory only; no production services)`);
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { void vite.close().then(() => process.exit(0)); });
