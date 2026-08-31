import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("page.tsx", pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const queries: ts.TaggedTemplateExpression[] = [];
function visit(node: ts.Node) {
  if (ts.isTaggedTemplateExpression(node)) queries.push(node);
  ts.forEachChild(node, visit);
}
visit(ast);
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

// Exact 3c0589ed6a78dcc63e4044e3fee447a8ccc48a6f source, captured before this change.
// No git subprocess, database, or application-module imports are needed by this test.
const baselineQueryHashes = [
  "e28d1b31786246a7412b47009c152ad12d6406cbf697a2e0276daf5348924110",
  "be488cfd806ec484242168086a854f311a43d46a5425d57bbd5de11336f28efe",
  "7dc88590040d6bccfd3038808f8892fd12aae939070eb61f754f57fb6628a7f6",
  "b5fdee867e7b811213410e85d25a82d6e58502ddd4159263b0c38001a8211eaa",
  "2fd187b37d6fed9ae9687bcbc28c371b9b61c16b4ce153169a9ef1648ed50874",
  "b198e326fce156b5ac6d6b3a6074de6107b07e7888e95af2d9c078e6b0dc9d49",
  "4b32d0a5e0ee4d9d80c6ff7537932e86904334efa70681e35221b3a6a5247720",
  "d1d0c25753ec3833ef7453ef8afa3d355557cbde188eb3c512c8af2db59acdfe",
  "2de6becbf1a746aaff0bfe7d6a9c8c7502da6979033206a5acc8032d482bbab4",
  "49408f3d8731628252ce53ac58f211ecc3d5cdb98230c20f051fc18b1eeb5069",
  "ff35626b23a826312138df90ad1382c69062cb78c4b1853ebdc7018020a03b42",
  "5ab721261debd35e33c72a52e974a44ef645e6e5b05bb20d3617c22c216b70c4",
  "cd6fea9a39a58eb97ce4b762455c0d71e6c88abdfff0d29da287b0ab3f3466f5",
  "c294d747b7ccff2d2e3f4dc4c3d1ab1979d2f69ace79b58475f6fd5e6c68a7a6",
  "6da027717a2e366c0d8d8e7b7d41b386cd74ea5c7d122b94940b63f09081d130",
  "4fd7a7e87bf14a9ce4bc83790b9210427958e5c3e4e0ebe56d23d171d945b12c",
  "24f343c2e5b50a578cc13359f52297900bd587bb566a1bbac8f001718d32e312",
  "6e7a7502caacffcf189b097a440121cb2916b333b0dab85c6ec1c4d834d07d86",
  "d388f892359d87425ce0e656759649f951db9cea06f1a391eb2d45160e5ba8b4",
  "8d623f734711a20831494ac9c6f38d692289ec1cd3ce26ee79300df00a2370e0",
  "700d9952d81678200bddc71884cf3cf7f679be6219e45246a48774a57f420651",
  "c5dfec815a76531062cbfddcaa721744939928482e7cc2ec6b6ea7777d969c9f",
  "cae7ccc36cd9f9e4fe3497f29ac8053371ca548efda5a67d0af6b123e9985b99",
  "43f32b56002a58c0194a74e3149d443c074e2ab5d29a1b33db73a1898214203c",
  "fbe6aeb0be682dda4b25b941b0ab2b55b12f78a4d567c2c6ab7c70b866373d85",
];
const targets = [
  { index: 5, name: "releases", clause: "where", preceding: "from shorts_mvp.editor_releases release" },
  { index: 6, name: "checks", clause: "and", preceding: ")" },
  { index: 7, name: "testers", clause: "where", preceding: "join shorts_mvp.app_users tester_user on tester_user.id=tester.user_id" },
  { index: 8, name: "renders", clause: "and", preceding: "where release_id is not null" },
  { index: 9, name: "refunds", clause: "where", preceding: "join shorts_mvp.app_users a on a.id=r.requested_by_user_id" },
  { index: 10, name: "remediation", clause: "and", preceding: "where r.campaign_key='legacy_easycut_pro_202608'" },
] as const;
function removeExactNeutralGuard(target: typeof targets[number]) {
  const query = queries[target.index];
  expect(query.tag.getText(ast)).toBe("db");
  if (!ts.isTemplateExpression(query.template)) throw new Error("neutral binding missing");
  const { head, templateSpans } = query.template;
  expect(templateSpans).toHaveLength(1);
  expect(templateSpans[0].expression.kind).toBe(ts.SyntaxKind.TrueKeyword);
  expect(templateSpans[0].expression.getText(ast)).toBe("true");
  expect(templateSpans[0].literal.text.startsWith("::boolean\n")).toBe(true);
  const indent = " ".repeat(target.clause === "where" ? 10 : 12);
  expect(head.text.endsWith(`          ${target.preceding}\n${indent}${target.clause} `)).toBe(true);
  // Exclude SQL string/identifier contents before counting parentheses. These
  // pinned queries have no SQL comments/dollar strings; the guard must be outermost.
  const prefix = head.text.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"/g, "");
  const depth = [...prefix].reduce((value, char) => value + (char === "(" ? 1 : char === ")" ? -1 : 0), 0);
  expect(depth).toBe(0);
  const original = query.getText(ast);
  const guardLine = indent + target.clause + " ${true}::boolean\n";
  expect(original.split(guardLine)).toHaveLength(2);
  return original.replace(guardLine, ""); // No broad whitespace/SQL normalization.
}

describe("administrator parameterized read protocol", () => {
  it("adds literal true bindings to exactly the six approved query nodes", () => {
    expect(queries).toHaveLength(25);
    const changed = queries.flatMap((query, index) => (
      sha256(query.getText(ast)) !== baselineQueryHashes[index] ? [index] : []
    ));
    expect(changed).toEqual(targets.map(({ index }) => index));
    const trueBindings = queries.flatMap((query) => ts.isTemplateExpression(query.template)
      ? query.template.templateSpans.filter(({ expression }) => expression.kind === ts.SyntaxKind.TrueKeyword)
      : []);
    expect(trueBindings).toHaveLength(6);
  });

  it.each(targets)("keeps $name SQL byte-identical after removing its one outer true guard", (target) => {
    expect(sha256(removeExactNeutralGuard(target))).toBe(baselineQueryHashes[target.index]);
  });

  it("preserves every other query, including the original parameterized editor-state", () => {
    for (const [index, query] of queries.entries()) {
      if (!targets.some((target) => target.index === index)) {
        expect(sha256(query.getText(ast))).toBe(baselineQueryHashes[index]);
      }
    }
    const state = queries[4].template;
    expect(ts.isTemplateExpression(state) && state.templateSpans.length).toBe(5);
  });

});
