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
  for (const size of [{ width: 390, height: 656 }, { width: 375, height: 624 }, { width: 320, height: 568 }, { width: 844, height: 390 }, { width: 1280, height: 900 }]) {
    const context = await browser.newContext({ viewport: size, hasTouch: size.width < 1000 });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    // Intercept app-link fallback pages: never open real social apps or accounts in tests.
    await context.route(/^https:\/\/www\.(youtube|instagram)\.com\/$/, route => route.fulfill({ contentType: "text/html", body: "<title>Platform link fixture</title>" }));
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
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const setViewport = async values => { await page.evaluate(v => window.setTestViewport(v), values); await settle(); };
    const assertPinned = async (height, top = 0, focused = false) => {
      await settle();
      const box = await page.evaluate(() => {
        const rect = element => { const r = element.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height }; };
        const pane = document.querySelector('[data-step]').parentElement;
        const footer = document.querySelector('main footer');
        return { footer: rect(footer), pane: rect(pane), field: rect(document.activeElement),
          inputFocused: document.activeElement instanceof HTMLInputElement,
          overflow: document.documentElement.scrollWidth > innerWidth, scrollY,
          paneOverflow: getComputedStyle(pane).overflowY };
      });
      assert.ok(Math.abs(box.footer.bottom - (height + top)) < 2, `CTA must stay at visible bottom: ${JSON.stringify(box)}`);
      assert.ok(box.footer.top >= top && box.footer.height > 44, "Actions fully visible without page scrolling");
      assert.ok(box.pane.bottom <= box.footer.top + 1, "Input pane and footer must never overlap");
      assert.equal(box.overflow, false); assert.equal(box.scrollY, 0);
      assert.equal(box.paneOverflow, "auto");
      if (focused) {
        assert.equal(box.inputFocused, true);
        assert.ok(box.field.top >= box.pane.top - 1, `Focused field clipped at top: ${JSON.stringify(box)}`);
        assert.ok(box.field.bottom <= box.pane.bottom + 1, `Focused field hidden by CTA: ${JSON.stringify(box)}`);
      }
      return box;
    };
    await page.goto(`${origin}/creator-support?step=account`);
    await page.getByRole("button", { name: "이 계정으로 계속" }).click();
    const fields = ["유튜브 링크", "인스타그램 링크", "휴대폰 번호"].map(name => page.getByRole("textbox", { name, exact: true }));
    const values = ["youtube.com/@keyboardcheck", "instagram.com/keyboardcheck", "01000000000"];
    await assertPinned(size.height);
    // Regression from the reported screenshot: scrolling long content cannot move CTA off-screen.
    await page.locator('[data-step="2"]').evaluate(element => { element.parentElement.scrollTop = element.parentElement.scrollHeight; });
    await assertPinned(size.height);
    await page.locator('[data-step="2"]').evaluate(element => { element.parentElement.scrollTop = 0; });
    if (output) await page.screenshot({ path: `${output}/fixed-initial-${size.width}x${size.height}.png` });
    for (let i = 0; i < fields.length; i++) {
      await fields[i].fill(values[i]); await assertPinned(size.height, 0, true);
      // iOS: the keyboard shrinks AND pans the visual viewport.
      await setViewport({ height: 280, offsetTop: 80 }); await assertPinned(280, 80, true);
      // A scroll-only viewport event must also reposition the pinned shell.
      await page.evaluate(() => { window.visualViewport.offsetTop = 100; window.visualViewport.dispatchEvent(new Event("scroll")); });
      await assertPinned(280, 100, true);
      assert.equal(await fields[i].inputValue(), values[i]);
      if (output && i === 2) await page.screenshot({ path: `${output}/fixed-keyboard-${size.width}x${size.height}.png`, clip: { x: 0, y: 100, width: size.width, height: 280 } });
      await fields[i].press("Enter"); await settle();
      if (i < fields.length - 1) {
        assert.equal(await fields[i + 1].evaluate(element => document.activeElement === element), true);
        await assertPinned(280, 100, true);
      } else assert.equal(await fields[i].evaluate(element => document.activeElement === element), false);
      // Keyboard dismissal: even a stale WebView offset must restore the bottom CTA.
      await setViewport({ height: size.height, width: size.width, offsetTop: 100 }); await assertPinned(size.height);
      await setViewport({ height: size.height, width: size.width, offsetTop: 0 });
    }
    // Android resizes the layout too; short landscape keyboard still keeps field/CTA visible.
    await page.setViewportSize({ width: size.width, height: 240 });
    await setViewport({ height: 240, width: size.width, offsetTop: 0 });
    await fields[2].focus(); await assertPinned(240, 0, true);
    await page.setViewportSize(size); await setViewport({ ...size, offsetTop: 0 });
    await fields[2].press("Enter");
    for (const [i, platform] of ["youtube", "instagram"].entries()) {
      const link = page.getByRole("link", { name: `${i === 0 ? "유튜브" : "인스타그램"} 열기 (앱 또는 새 창)`, exact: true });
      await link.scrollIntoViewIfNeeded();
      const target = await link.boundingBox(), field = await fields[i].boundingBox();
      assert.ok(target.width >= 44 && target.height >= 44, "Icon touch target must be at least 44px");
      assert.ok(target.x + target.width < field.x, "Icon and input must be separate touch targets");
      assert.equal(await link.evaluate(element => element.closest("label") === null), true);
      const [popup] = await Promise.all([page.waitForEvent("popup"), link.click()]);
      await popup.waitForURL(`https://www.${platform}.com/`);
      assert.equal(await popup.evaluate(() => window.opener), null);
      await popup.close(); await page.bringToFront();
      await Promise.all([
        page.waitForResponse(response => response.url().endsWith("/api/creator-support/application")),
        page.evaluate(() => window.dispatchEvent(new Event("focus"))),
      ]);
      assert.equal(page.url(), `${origin}/creator-support?step=account`);
      for (let j = 0; j < fields.length; j++) assert.equal(await fields[j].inputValue(), values[j]);
      await fields[i].click();
      assert.equal(await fields[i].evaluate(element => document.activeElement === element), true);
      await fields[i].press("Enter"); await assertPinned(size.height);
    }
    await page.getByRole("button", { name: "다음", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "운영 또는 이용허락" }).waitFor();
    // Pinch zoom should not shrink/reflow the wizard; toast follows the magnified visible area.
    const beforeZoom = await assertPinned(size.height);
    await setViewport({ height: 280, offsetTop: 100, width: 260, offsetLeft: 40, scale: 1.5 });
    await page.waitForTimeout(180);
    const toast = await page.getByRole("alert").filter({ hasText: "운영 또는 이용허락" }).boundingBox();
    assert.ok(Math.abs(toast.y + toast.height / 2 - 240) < 2);
    assert.ok(Math.abs(toast.x + toast.width / 2 - 170) < 2);
    assert.equal((await page.locator("main footer").boundingBox()).height, beforeZoom.footer.height);
    await page.getByRole("alert").filter({ hasText: "운영 또는 이용허락" }).waitFor({ state: "hidden", timeout: 3000 });
    await setViewport({ height: size.height, width: size.width, offsetTop: 0, offsetLeft: 0, scale: 1 });
    await page.getByRole("checkbox", { name: "등록한 채널의 운영자이거나 이용허락 권한이 있는 담당자입니다." }).check();
    await page.getByRole("button", { name: "다음", exact: true }).click(); await assertPinned(size.height);
    await page.getByRole("button", { name: "개인정보 수집·이용 동의 자세히 보기" }).click();
    await assertPinned(size.height);
    await page.getByRole("button", { name: "닫고 동의 화면으로" }).click();
    // Keyboard navigation avoids the local Next dev indicator over the back button.
    await page.getByRole("button", { name: "이전", exact: true }).focus();
    await page.getByRole("button", { name: "이전", exact: true }).press("Enter");
    assert.equal(await fields[0].inputValue(), "https://youtube.com/@keyboardcheck");
    assert.equal(await fields[1].inputValue(), "https://instagram.com/keyboardcheck");
    assert.equal(await fields[2].inputValue(), "010-0000-0000");
    await assertPinned(size.height);
    assert.equal(errors.length, 0, errors.join("\n"));
    results.push({ size, inputs: 3, pinnedFooter: true, focusedInputsVisible: true, keyboardDismissal: true, platformLinks: 2, appReturnPreserved: true, valuesPreserved: true, errors });
    await context.close();
  }
  if (output) await fs.writeFile(`${output}/keyboard-result.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally { await browser.close(); }
