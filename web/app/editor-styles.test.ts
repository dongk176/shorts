import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse, type AtRule, type Rule } from "postcss";

const stylesheet = parse(
  readFileSync(new URL("./globals.css", import.meta.url), "utf8"),
);

function matchingRules(selector: string) {
  const rules: Rule[] = [];
  stylesheet.walkRules((rule) => {
    if (rule.selectors.includes(selector)) {
      rules.push(rule);
    }
  });
  return rules;
}

describe("editor desktop styles", () => {
  it("keeps history controls positioned outside responsive media queries", () => {
    const positionedRule = matchingRules(".editor-history-controls").find(
      (rule) => rule.nodes.some(
        (node) => node.type === "decl"
          && node.prop === "position"
          && node.value === "absolute",
      ),
    );

    expect(positionedRule).toBeDefined();
    expect(positionedRule?.parent?.type).toBe("root");
  });

  it("only hides history controls in the narrow editor layout", () => {
    const hiddenRule = matchingRules(".editor-history-controls").find(
      (rule) => rule.nodes.some(
        (node) => node.type === "decl"
          && node.prop === "display"
          && node.value === "none",
      ),
    );
    const mediaQuery = hiddenRule?.parent as AtRule | undefined;

    expect(mediaQuery?.name).toBe("media");
    expect(mediaQuery?.params).toBe("(max-width: 920px)");
  });
});
