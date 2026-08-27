#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { createServer as createViteServer } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "../..");

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return resolve(process.argv[index + 1]);
}

async function unusedPort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No TCP port");
  await new Promise((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose());
  });
  return address.port;
}

function executableInPath(name) {
  const result = spawnSync("which", [name], {
    encoding: "utf8",
    shell: false,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function chromeExecutable() {
  const configured = process.env.CHROME_BIN?.trim();
  if (configured) return configured;
  const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const macResult = spawnSync("test", ["-x", macChrome], { shell: false });
  if (macResult.status === 0) return macChrome;
  for (const name of ["google-chrome", "chromium", "chromium-browser"]) {
    const resolvedPath = executableInPath(name);
    if (resolvedPath) return resolvedPath;
  }
  throw new Error("Set CHROME_BIN to a Chromium 120+ executable.");
}

async function pollJson(url, timeoutMilliseconds = 15_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return await response.json();
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Chrome DevTools did not start: ${String(lastError || "timeout")}`);
}

async function cdpClient(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });
  return {
    async send(method, params = {}) {
      const id = ++nextId;
      const result = new Promise((resolveRequest, rejectRequest) => {
        pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
      });
      socket.send(JSON.stringify({ id, method, params }));
      return result;
    },
    close() {
      socket.close();
    },
  };
}

async function runtimeValue(client, expression) {
  const response = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(JSON.stringify(response.exceptionDetails));
  }
  return response.result?.value;
}

async function waitUntilReady(client) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const state = await runtimeValue(client, `({
      ready: document.documentElement.dataset.browserParityReady || "",
      error: document.documentElement.dataset.browserParityError || "",
    })`);
    if (state?.error) throw new Error(state.error);
    if (state?.ready === "true") return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("Browser parity scene did not become ready.");
}

const browserMetricsExpression = `(() => {
  const rectangle = (value) => ({
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height,
    left: value.left,
    top: value.top,
    right: value.right,
    bottom: value.bottom,
  });
  const titleMetrics = (root) => Array.from(document.querySelectorAll(
    root + " [data-editor-v4-title-preview] svg text",
  )).map((element) => ({
    text: element.textContent,
    x: Number(element.getAttribute("x")),
    y: Number(element.getAttribute("y")),
    textLength: Number(element.getAttribute("textLength")),
    fontFamily: getComputedStyle(element).fontFamily,
    fontSize: getComputedStyle(element).fontSize,
    fontLoaded: document.fonts.check(
      getComputedStyle(element).font,
      element.textContent || "",
    ),
    svgBox: rectangle(element.getBBox()),
    clientBox: rectangle(element.getBoundingClientRect()),
  }));
  const captionMetrics = (root) => Array.from(document.querySelectorAll(
    root + " [data-positioned-subtitle-word], "
      + root + " [data-flow-subtitle-word]",
  )).map((element) => {
    const positioned = element.hasAttribute("data-positioned-subtitle-word");
    const glyph = positioned ? element.firstElementChild : element;
    return {
      text: glyph?.textContent || "",
      mode: positioned ? "positioned-pop" : "flow-highlight",
      advanceWidth: Number(element.dataset.advanceWidth),
      gapBefore: Number(element.dataset.gapBefore),
      box: rectangle(element.getBoundingClientRect()),
      glyphBox: glyph ? rectangle(glyph.getBoundingClientRect()) : null,
      fontFamily: glyph ? getComputedStyle(glyph).fontFamily : "",
      fontSize: glyph ? getComputedStyle(glyph).fontSize : "",
      fontLoaded: glyph ? document.fonts.check(
        getComputedStyle(glyph).font,
        glyph.textContent || "",
      ) : false,
    };
  });
  const flowBox = (root) => {
    const value = document.querySelector(
      root + " [data-browser-parity-flow-caption]",
    );
    return value ? rectangle(value.getBoundingClientRect()) : null;
  };
  return {
    browser: navigator.userAgent,
    devicePixelRatio,
    viewport: { width: innerWidth, height: innerHeight },
    title: titleMetrics("[data-browser-compiler-title]"),
    storedTitle: titleMetrics("[data-browser-stored-title]"),
    captions: captionMetrics("[data-browser-compiler-caption]"),
    storedCaptions: captionMetrics("[data-browser-stored-caption]"),
    flowCaptionBox: flowBox("[data-browser-compiler-caption]"),
    storedFlowCaptionBox: flowBox("[data-browser-stored-caption]"),
    compilerEvidence: window.__editorV4BrowserParityCompilerEvidence || null,
    fontStatus: document.fonts.status,
  };
})()`;

async function main() {
  const fixturePath = argument("--fixture");
  const screenshotPath = argument("--screenshot");
  const metricsPath = argument("--metrics");
  const fixtureBody = await readFile(fixturePath);
  const fixture = JSON.parse(fixtureBody.toString("utf8"));
  if (fixture.schemaVersion !== 1) throw new Error("Unsupported fixture schema");

  const vitePort = await unusedPort();
  const devtoolsPort = await unusedPort();
  const vite = await createViteServer({
    root: webRoot,
    publicDir: resolve(webRoot, "public"),
    logLevel: "error",
    appType: "mpa",
    resolve: { alias: { "@": webRoot } },
    esbuild: { jsx: "automatic" },
    server: { host: "127.0.0.1", port: vitePort, strictPort: true },
    plugins: [{
      name: "editor-v4-parity-fixture",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url !== "/__editor_v4_parity_fixture.json") {
            next();
            return;
          }
          response.statusCode = 200;
          response.setHeader("content-type", "application/json; charset=utf-8");
          response.setHeader("cache-control", "no-store");
          response.end(fixtureBody);
        });
      },
    }],
  });
  const profileDirectory = await mkdtemp(join(tmpdir(), "editor-v4-chrome-"));
  let chrome;
  let client;
  try {
    await vite.listen();
    const args = [
      "--headless=new",
      "--disable-gpu",
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-extensions",
      "--force-device-scale-factor=1",
      "--hide-scrollbars",
      "--no-default-browser-check",
      "--no-first-run",
      `--remote-debugging-port=${devtoolsPort}`,
      "--remote-debugging-address=127.0.0.1",
      `--user-data-dir=${profileDirectory}`,
      "about:blank",
    ];
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      args.unshift("--no-sandbox");
    }
    chrome = spawn(chromeExecutable(), args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    const targets = await pollJson(`http://127.0.0.1:${devtoolsPort}/json/list`);
    const page = targets.find((target) => target.type === "page");
    if (!page?.webSocketDebuggerUrl) throw new Error("No Chrome page target");
    client = await cdpClient(page.webSocketDebuggerUrl);
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: fixture.canvas.width,
      height: fixture.canvas.height,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: fixture.canvas.width,
      screenHeight: fixture.canvas.height,
    });
    await client.send("Page.navigate", {
      url: `http://127.0.0.1:${vitePort}/tests/browser-render-parity/index.html`,
    });
    await waitUntilReady(client);
    const metrics = await runtimeValue(client, browserMetricsExpression);
    const capture = await client.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    await writeFile(screenshotPath, Buffer.from(capture.data, "base64"));
    await writeFile(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`);
  } finally {
    client?.close();
    if (chrome && chrome.exitCode === null) {
      const exited = new Promise((resolveExit) => {
        chrome.once("exit", resolveExit);
      });
      chrome.kill("SIGTERM");
      await Promise.race([
        exited,
        new Promise((resolveWait) => setTimeout(resolveWait, 2_000)),
      ]);
      if (chrome.exitCode === null) {
        chrome.kill("SIGKILL");
        await exited;
      }
    }
    await vite.close();
    await rm(profileDirectory, {
      recursive: true,
      force: true,
      maxRetries: 4,
      retryDelay: 100,
    });
  }
}

await main();
