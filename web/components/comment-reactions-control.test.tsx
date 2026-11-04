import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { CommentReactionsControl } from "./comment-reactions-control";
let root: Root;
beforeEach(() => {
  const { window, document } = parseHTML("<html><body><div id='app'></div></body></html>");
  vi.stubGlobal("window", window); vi.stubGlobal("document", document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.getElementById("app")!);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
function Example() { const [value,setValue] = useState(true); return <CommentReactionsControl value={value} onChange={setValue} />; }
it("opens examples and changes the controlled setting in both directions", async () => {
  await act(async () => root.render(<Example />));
  const trigger = document.querySelector("button")!;
  expect(document.querySelector('[role="group"]')).toBeNull();
  await act(async () => trigger.click());
  const choices = document.querySelectorAll<HTMLButtonElement>('[aria-pressed]');
  expect(choices).toHaveLength(2);
  await act(async () => choices[1].click());
  expect(trigger.textContent).toContain("반응 없이");
  expect(choices[1].getAttribute("aria-pressed")).toBe("true");
  await act(async () => choices[0].click());
  expect(trigger.textContent).toContain("반응 있음");
  await act(async () => trigger.click());
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});
