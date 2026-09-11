// Local browser contract test. Capture the requested URL before native dispatch;
// this does not claim to test an installed iPhone/Android app on the test host.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const origin = process.env.CREATOR_UI_ORIGIN || "http://127.0.0.1:3109";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
try {
  for (const device of [
    { name: "iPhone Kakao", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile KAKAOTALK", platform: "iPhone", maxTouchPoints: 5, scheme: "vnd.youtube:" },
    { name: "Android Kakao", userAgent: "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36 KAKAOTALK", platform: "Linux armv8l", maxTouchPoints: 5, scheme: "intent:" },
    { name: "iPad desktop mode", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15", platform: "MacIntel", maxTouchPoints: 5, scheme: "vnd.youtube:" },
    { name: "Desktop", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/537.36 Chrome/140.0 Safari/537.36", platform: "MacIntel", maxTouchPoints: 0, scheme: "https:" },
  ]) {
    const context = await browser.newContext({ userAgent: device.userAgent, viewport: { width: 390, height: 656 } });
    await context.addInitScript(({ platform, maxTouchPoints }) => {
      Object.defineProperty(navigator, "platform", { get: () => platform });
      Object.defineProperty(navigator, "maxTouchPoints", { get: () => maxTouchPoints });
    }, device);
    const page = await context.newPage();
    await page.route("**/api/creator-support/application", route => {
      assert.equal(route.request().method(), "GET");
      return route.fulfill({ json: { account: { key: "a".repeat(64), name: "검증", email: null, provider: "카카오", joinedAt: "2026-01-01T00:00:00Z" }, enrollmentOpen: true, status: null, application: null } });
    });
    await page.goto(origin + "/creator-support?step=account");
    await page.getByRole("button", { name: "이 계정으로 계속" }).click();
    const phone = page.getByRole("textbox", { name: "휴대폰 번호", exact: true });
    await phone.fill("01000000000");
    const youtube = page.locator('a[data-platform="youtube"]');
    await page.waitForFunction(scheme => document.querySelector('a[data-platform="youtube"]')?.getAttribute("href").startsWith(scheme), device.scheme);
    await page.evaluate(() => {
      window.requestedPlatformLinks = [];
      document.addEventListener("click", event => {
        const link = event.target.closest('a[data-platform="youtube"]');
        if (!link) return;
        event.preventDefault();
        window.requestedPlatformLinks.push({ href: link.href, target: link.target });
      });
    });
    await youtube.click();
    const launches = await page.evaluate(() => window.requestedPlatformLinks);
    assert.equal(launches.length, 1);
    const launch = launches[0];
    assert.ok(launch.href.startsWith(device.scheme));
    assert.equal(launch.target, device.scheme === "https:" ? "_blank" : "_self");
    if (device.scheme === "intent:") assert.ok(launch.href.includes("package=com.google.android.youtube;"));
    await Promise.all([
      page.waitForResponse(response => response.url().endsWith("/api/creator-support/application")),
      page.evaluate(() => window.dispatchEvent(new Event("focus"))),
    ]);
    assert.equal(page.url(), origin + "/creator-support?step=account");
    assert.equal(await phone.inputValue(), "010-0000-0000");
    await page.getByRole("textbox", { name: "유튜브 링크", exact: true }).fill("youtube.com/@example");
    assert.equal(await page.evaluate(() => window.requestedPlatformLinks.length), 1);
    results.push({ device: device.name, ...launch, valuesPreserved: true, actualNativeLaunchVerified: false });
    await context.close();
  }
  if (process.env.CREATOR_UI_OUTPUT) await fs.writeFile(process.env.CREATOR_UI_OUTPUT + "/app-links-result.json", JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally { await browser.close(); }
