// Run against a local Next server with Playwright available via PLAYWRIGHT_MODULE.
// API responses and viewport changes are fixtures; this never submits real data.
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const origin = process.env.CREATOR_UI_ORIGIN || "http://127.0.0.1:3109";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(origin).hostname), "Local fixture server required");
const output = process.env.CREATOR_UI_OUTPUT;
if (output) await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
try {
  for (const size of [{ width: 390, height: 656 }, { width: 320, height: 568 }, { width: 844, height: 390 }, { width: 1280, height: 900 }]) {
    const context = await browser.newContext({ viewport: size, hasTouch: size.width < 1000 });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      const viewport = new EventTarget();
      Object.assign(viewport, { height: innerHeight, width: innerWidth, offsetTop: 0, offsetLeft: 0, scale: 1 });
      Object.defineProperty(window, "visualViewport", { value: viewport, configurable: true });
      window.setTestViewport = values => {
        Object.assign(viewport, values);
        viewport.dispatchEvent(new Event("resize"));
        viewport.dispatchEvent(new Event("scroll"));
      };
    });
    await page.route("**/api/creator-support/application", async route => {
      assert.equal(route.request().method(), "GET", "No application writes in keyboard test");
      await route.fulfill({ json: {
        account: { key: "a".repeat(64), name: "화면 검증", email: null, provider: "카카오", joinedAt: "2026-01-01T00:00:00Z" },
        enrollmentOpen: true, termsVersion: "2026-09-11.v2", status: null, application: null,
      } });
    });
    await page.goto(`${origin}/creator-support?step=account`);
    await page.getByRole("button", { name: "이 계정으로 계속" }).click();
    const fields = ["유튜브 링크", "인스타그램 링크", "휴대폰 번호"].map(name => page.getByRole("textbox", { name, exact: true }));
    const values = ["youtube.com/@keyboardcheck", "instagram.com/keyboardcheck", "01000000000"];
    const measure = () => page.evaluate(() => {
      const field = document.activeElement;
      const footer = document.querySelector("main footer");
      const content = document.querySelector('[data-step="2"]').parentElement;
      return {
        documentHeight: document.documentElement.scrollHeight,
        overflow: document.documentElement.scrollWidth > innerWidth,
        scrollContainer: getComputedStyle(content).overflowY,
        footerTop: footer.getBoundingClientRect().top + scrollY,
        fieldBottom: field.getBoundingClientRect().bottom + scrollY,
        fieldFontSize: getComputedStyle(field).fontSize,
      };
    });
    for (let i = 0; i < fields.length; i++) {
      await fields[i].fill(values[i]);
      const before = await measure();
      // iOS: keyboard shrinks/pans only the visual viewport, not the document.
      await page.evaluate(() => window.setTestViewport({ height: 280, offsetTop: 160 }));
      const during = await measure();
      assert.equal(during.documentHeight, before.documentHeight, "Keyboard must not reflow the form");
      assert.equal(during.scrollContainer, "visible", "Inputs must use the document scroller");
      assert.ok(during.footerTop >= during.fieldBottom, "CTA must remain after every input");
      assert.equal(during.overflow, false);
      assert.ok(parseFloat(during.fieldFontSize) >= 16, "Avoid iOS input auto-zoom");
      // A user can scroll any focused field clear of the keyboard without CTA occlusion.
      await fields[i].evaluate(element => element.scrollIntoView({ block: "center", behavior: "instant" }));
      assert.equal(await fields[i].inputValue(), values[i]);
      await fields[i].press("Enter");
      if (i < fields.length - 1) assert.equal(await fields[i + 1].evaluate(element => document.activeElement === element), true);
      else assert.equal(await fields[i].evaluate(element => document.activeElement === element), false);
      await page.evaluate(({ height, width }) => window.setTestViewport({ height, width, offsetTop: 0 }), size);
      assert.equal((await measure()).documentHeight, before.documentHeight);
    }
    // Android's resizes-content mode: a smaller layout viewport must scroll,
    // never squeeze cards beneath the footer. Includes landscape and short phones.
    await page.setViewportSize({ width: size.width, height: 300 });
    await fields[2].focus();
    const compact = await measure();
    assert.ok(compact.footerTop >= compact.fieldBottom);
    assert.equal(compact.overflow, false);
    await page.setViewportSize(size);
    await fields[2].press("Enter");
    await page.getByRole("button", { name: "다음", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "운영 또는 이용허락" }).waitFor();
    await page.evaluate(() => window.setTestViewport({ height: 280, offsetTop: 100, width: 260, offsetLeft: 40, scale: 1.5 }));
    await page.waitForTimeout(200);
    const toast = await page.getByRole("alert").filter({ hasText: "운영 또는 이용허락" }).boundingBox();
    assert.ok(Math.abs(toast.y + toast.height / 2 - 240) < 2, "Toast follows visible viewport and keyboard pan");
    assert.ok(Math.abs(toast.x + toast.width / 2 - 170) < 2, "Toast follows horizontal zoom pan");
    await page.getByRole("alert").filter({ hasText: "운영 또는 이용허락" }).waitFor({ state: "hidden", timeout: 3000 });
    await page.evaluate(({ height, width }) => window.setTestViewport({ height, width, offsetTop: 0, offsetLeft: 0, scale: 1 }), size);
    await page.getByRole("checkbox", { name: "등록한 채널의 운영자이거나 이용허락 권한이 있는 담당자입니다." }).check();
    if (output) await page.screenshot({ path: `${output}/form-${size.width}x${size.height}.png`, fullPage: true });
    await page.getByRole("button", { name: "다음", exact: true }).click();
    assert.equal(await page.evaluate(() => scrollY), 0, "New step resets document pan");
    // Keyboard navigation also works when a local Next dev indicator overlaps
    // the bottom-left button; production has no dev indicator.
    await page.getByRole("button", { name: "이전", exact: true }).focus();
    await page.getByRole("button", { name: "이전", exact: true }).press("Enter");
    assert.equal(await fields[0].inputValue(), "https://youtube.com/@keyboardcheck");
    assert.equal(await fields[1].inputValue(), "https://instagram.com/keyboardcheck");
    assert.equal(await fields[2].inputValue(), "010-0000-0000");
    assert.equal(errors.length, 0, errors.join("\n"));
    results.push({ size, inputs: 3, iosVisualViewport: "passed", androidResize: "passed", valuesPreserved: true, errors });
    await context.close();
  }
  if (output) await fs.writeFile(`${output}/keyboard-result.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally { await browser.close(); }
