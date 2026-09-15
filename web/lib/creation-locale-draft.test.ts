import { afterEach, describe, expect, it } from "vitest";
import { clearCreationDraft, preserveCreationDraft, readCreationDraft } from "./creation-locale-draft";
afterEach(clearCreationDraft);
describe("locale refresh creation draft", () => {
  it("keeps the explicit output and selected source for the same account", () => {
    const draft = { videoId: "video", outputLanguage: "ja", outputLanguageChosen: true, range: [0, 240] };
    preserveCreationDraft("owner", "en", draft, 100);
    expect(readCreationDraft("owner", "en", 101)).toEqual(draft);
    // React can read initial state twice; reading is harmless and repeatable.
    expect(readCreationDraft("owner", "en", 102)).toEqual(draft);
    clearCreationDraft(); expect(readCreationDraft("owner", "en", 103)).toBeNull();
  });
  it("never restores another account, another locale or an expired draft", () => {
    preserveCreationDraft("owner", "en", { source: "private" }, 100);
    expect(readCreationDraft("other", "en", 101)).toBeNull();
    expect(readCreationDraft(null, "en", 101)).toBeNull();
    expect(readCreationDraft("owner", "ja", 101)).toBeNull();
    expect(readCreationDraft("owner", "en", 60_101)).toBeNull();
  });
});
