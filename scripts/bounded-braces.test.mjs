import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const require = createRequire(new URL("../web/package.json", import.meta.url));
const braces = require("braces");

test("actual glob consumers resolve the bounded build-time implementation", () => {
  for (const consumer of ["micromatch", "chokidar"]) {
    const fromConsumer = createRequire(require.resolve(consumer));
    assert.equal(fromConsumer("braces"), braces);
  }
});

test("preserves ordinary Tailwind and lint glob semantics", () => {
  assert.equal(braces.compile("src/**/*.{ts,tsx}"), "src/**/*.(ts|tsx)");
  assert.deepEqual(braces.expand("{a,{b,c}}"), ["a", "b", "c"]);
  assert.deepEqual(braces.expand("file-{01..03}.js"), ["file-01.js", "file-02.js", "file-03.js"]);
  for (const pattern of ["./{app,components}/**/*.{js,ts,jsx,tsx}", "a/(b|c)/{x,y}", "{a,b}", "x/\\{a,b\\}"]) {
    assert.equal(braces.stringify(braces.parse(pattern)), pattern.replaceAll("\\", ""));
  }
  const ast = braces.parse("{a,b}");
  assert.equal(ast.nodes[1].parent, ast); // Normal parser backlinks are allowed.
  assert.equal(braces.compile(ast), "(a|b)");
});

test("rejects hostile strings and ASTs before recursive walkers can exhaust the stack", () => {
  const script = `
    const braces = require(${JSON.stringify(require.resolve("braces"))});
    const reject = fn => {
      try { fn(); } catch (error) {
        if (error instanceof RangeError && /exceeds/.test(error.message)) return;
        throw error;
      }
      throw new Error('Unsafe input was accepted');
    };
    for (const pair of [['{','}'], ['(',')']]) {
      const input = pair[0].repeat(3000) + 'a,b' + pair[1].repeat(3000);
      for (const method of ['parse','compile','expand','stringify']) reject(() => braces[method](input));
    }
    let deep = {type:'text',value:'x'};
    for (let i=0; i<3000; i++) deep={type:'brace',nodes:[deep]};
    const cyclic={type:'root',nodes:[]}; cyclic.nodes.push(cyclic);
    for (const ast of [deep,cyclic,{type:'root',nodes:Array(65537).fill({type:'text',value:'x'})}]) {
      for (const method of ['compile','expand','stringify']) reject(() => braces[method](ast));
    }
    braces.compile('{'.repeat(80)+'a,b'+'}'.repeat(80));
  `;
  const result = spawnSync(process.execPath, ["--stack_size=512", "-e", script], {
    timeout: 3000, encoding: "utf8", maxBuffer: 128 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});
