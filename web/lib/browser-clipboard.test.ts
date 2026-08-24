import { afterEach, describe, expect, it, vi } from "vitest";
import { copyTextToClipboard } from "./browser-clipboard";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser clipboard", () => {
  it("uses the Clipboard API when it is available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await copyTextToClipboard("https://www.easycut.co.kr/projects/12");

    expect(writeText).toHaveBeenCalledWith("https://www.easycut.co.kr/projects/12");
  });

  it("falls back to a temporary textarea when Clipboard API fails", async () => {
    const remove = vi.fn();
    const textarea = {
      value: "",
      style: {} as CSSStyleDeclaration,
      setAttribute: vi.fn(),
      select: vi.fn(),
      setSelectionRange: vi.fn(),
      remove,
    };
    const append = vi.fn();
    const execCommand = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    vi.stubGlobal("document", {
      createElement: vi.fn().mockReturnValue(textarea),
      body: { append },
      execCommand,
    });

    await copyTextToClipboard("project-link");

    expect(textarea.value).toBe("project-link");
    expect(append).toHaveBeenCalledWith(textarea);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(remove).toHaveBeenCalledOnce();
  });
});
