import { afterEach, expect, it, vi } from "vitest";
import { act, type ImgHTMLAttributes } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { YoutubeLaunchGuide, YOUTUBE_LAUNCH_SEEN_KEY } from "./youtube-launch-guide";

vi.mock("next/image", () => ({ default: ({ unoptimized: _u, priority: _p, ...props }: ImgHTMLAttributes<HTMLImageElement> & { unoptimized?: boolean; priority?: boolean }) => {
  void _u; void _p;
  // eslint-disable-next-line @next/next/no-img-element
  return <img {...props} alt={props.alt || ""} />;
} }));
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; vi.unstubAllGlobals(); });

async function render(preview = false, seen = false) {
  const { window, document } = parseHTML('<html><body><div id="app"></div></body></html>');
  Object.assign(window.HTMLElement.prototype, {
    showModal(this: HTMLElement) { this.setAttribute("open", ""); },
    close(this: HTMLElement) { this.removeAttribute("open"); },
  });
  vi.stubGlobal("window", window); vi.stubGlobal("document", document); vi.stubGlobal("HTMLElement", window.HTMLElement); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const storage = { getItem: vi.fn(() => seen ? "yes" : null), setItem: vi.fn() };
  vi.stubGlobal("localStorage", storage);
  const dismissed = vi.fn();
  root = createRoot(document.getElementById("app")! as unknown as Element);
  await act(async () => root!.render(<YoutubeLaunchGuide preview={preview} onDismiss={dismissed} />));
  const click = async (text: string) => act(async () => {
    const button = [...document.querySelectorAll("button")].find(item => item.textContent === text || item.getAttribute("aria-label") === text);
    expect(button).toBeTruthy(); button!.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
  return { document, storage, dismissed, click };
}

it("records completion at the final step and never turns screenshots into links", async () => {
  const { document, storage, dismissed, click } = await render();
  expect(document.querySelector("dialog[open]")).not.toBeNull();
  expect(document.querySelectorAll(".yt-launch-shot a,.yt-launch-shot button")).toHaveLength(0);
  await click("다음"); await click("다음");
  expect(storage.setItem).not.toHaveBeenCalled();
  await click("확인했어요");
  expect(storage.setItem).toHaveBeenCalledExactlyOnceWith(YOUTUBE_LAUNCH_SEEN_KEY, "yes");
  expect(dismissed).toHaveBeenCalledTimes(1);
  expect(document.querySelector("dialog")).toBeNull();
});

it("remembers an early close so it stays dismissed on the next visit", async () => {
  const { storage, click, document } = await render();
  await click("안내 닫기");
  expect(document.querySelector("dialog")).toBeNull();
  expect(storage.setItem).toHaveBeenCalledExactlyOnceWith(YOUTUBE_LAUNCH_SEEN_KEY, "yes");
  await act(async () => root!.unmount()); root = undefined;
  const nextVisit = await render(false, true);
  expect(nextVisit.document.querySelector("dialog")).toBeNull();
});

it("also remembers dismissal with Escape", async () => {
  const { storage, document } = await render();
  await act(async () => document.querySelector("dialog")!.dispatchEvent(new window.Event("cancel", { bubbles: false, cancelable: true })));
  expect(storage.setItem).toHaveBeenCalledExactlyOnceWith(YOUTUBE_LAUNCH_SEEN_KEY, "yes");
  expect(document.querySelector("dialog")).toBeNull();
});

it("skips a completed production announcement", async () => {
  const { document, dismissed } = await render(false, true);
  expect(document.querySelector("dialog")).toBeNull(); expect(dismissed).toHaveBeenCalledTimes(1);
});

it("always opens local preview without modifying saved completion", async () => {
  const { document, storage, click } = await render(true, true);
  expect(document.querySelector("dialog[open]")).not.toBeNull();
  await click("다음"); await click("다음"); await click("확인했어요");
  expect(storage.setItem).not.toHaveBeenCalled();
});
