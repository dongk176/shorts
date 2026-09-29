import { afterEach, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { PublishingSelect } from "./publishing-select";

let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; vi.unstubAllGlobals(); });

it("selects without submitting, restores focus, keeps Escape inside the upload dialog, and handles disabled/outside states", async () => {
  const { window, document } = parseHTML('<html><body><div id="app"></div><button id="outside">Outside</button></body></html>');
  Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
  Object.assign(window.HTMLElement.prototype, {
    getBoundingClientRect() { return { top: 100, bottom: 150, left: 0, right: 300, width: 300, height: 50 }; },
    focus() { Object.defineProperty(document, "activeElement", { value: this, configurable: true }); },
  });
  vi.stubGlobal("window", window); vi.stubGlobal("document", document); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const submitted = vi.fn(); const onChange = vi.fn(); const outerEscape = vi.fn();
  function Fixture({ disabled = false }: { disabled?: boolean }) {
    const [value, setValue] = useState("private");
    return <form onSubmit={submitted} onKeyDown={event => { if (event.key === "Escape") outerEscape(); }}>
      <PublishingSelect id="privacy" label="공개 범위" value={value} disabled={disabled}
        options={[{ value: "private", label: "비공개" }, { value: "unlisted", label: "일부 공개" }, { value: "public", label: "공개" }]}
        onChange={next => { setValue(next); onChange(next); }} />
    </form>;
  }
  root = createRoot(document.getElementById("app")! as unknown as Element);
  await act(async () => root!.render(<Fixture />));
  const trigger = document.querySelector('[role="combobox"]')!;
  const click = async (element: Element) => act(async () => { element.dispatchEvent(new window.Event("click", { bubbles: true })); });
  const key = async (element: Element, value: string) => act(async () => {
    const event = new window.Event("keydown", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "key", { value }); element.dispatchEvent(event);
  });
  await key(trigger, "ArrowDown");
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(document.activeElement?.getAttribute("aria-selected")).toBe("true");
  await key(document.activeElement!, "End");
  expect(document.activeElement?.textContent).toContain("공개");
  await click(document.activeElement!);
  expect(onChange).toHaveBeenCalledWith("public");
  expect(document.activeElement).toBe(trigger);
  expect(submitted).not.toHaveBeenCalled();
  await click(trigger);
  await key(document.activeElement!, "Escape");
  expect(document.querySelector('[role="listbox"]')).toBeNull();
  expect(outerEscape).not.toHaveBeenCalled();
  await click(trigger);
  await act(async () => { document.getElementById("outside")!.dispatchEvent(new window.Event("pointerdown", { bubbles: true })); });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  await click(trigger);
  await act(async () => root!.render(<Fixture disabled />));
  expect(document.querySelector('[role="listbox"]')).toBeNull();
  expect(trigger.hasAttribute("disabled")).toBe(true);
});
