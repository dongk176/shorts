import { execFileSync } from "node:child_process";
import { PGlite } from "../../test-tools/node_modules/@electric-sql/pglite/dist/index.js";
import { expect, it } from "vitest";

const queries: string[] = JSON.parse(execFileSync("python3", ["-c", `
import ast,json
m=ast.parse(open('../worker/shorts_worker/repository.py').read())
methods=[n for n in ast.walk(m) if isinstance(n,ast.FunctionDef) and n.name in ('get_short','get_project_render_items','get_render_shard')]
print(json.dumps([n.value for m in methods for n in ast.walk(m) if isinstance(n,ast.Constant) and isinstance(n.value,str) and 'as comment_output_language' in n.value]))
`], { encoding: "utf8" }));

it("keeps verified upload comment language through initial and subsequent rendering", async () => {
  expect(queries).toHaveLength(3);
  const db = new PGlite();
  const release = "11111111-1111-4111-8111-111111111111";
  try {
    await db.exec(`create table jobs(source_type text,template_snapshot jsonb,initial_editor_release_id uuid,output_language text,language_test_release_id uuid);
      insert into jobs values('upload','{}','${release}','ko',null)`);
    for (const query of queries) {
      const expression = query.match(/case when[\s\S]*?end as comment_output_language/)![0];
      for (const language of ["ko", "en", "ja"]) {
        const context = { uploadLanguage: { version: 1, releaseId: release, outputLanguage: language } };
        await db.query("update jobs set template_snapshot=$1,output_language=$2", [context, language]);
        expect((await db.query(`select ${expression} from jobs j`)).rows).toEqual([{ comment_output_language: language }]);
      }
      for (const invalidContext of [
        {},
        { uploadLanguage: { version: 1, releaseId: "other", outputLanguage: "ja" } },
        { uploadLanguage: { version: 1, releaseId: release, outputLanguage: "en" } },
      ]) {
        await db.query("update jobs set template_snapshot=$1,output_language='ja'", [invalidContext]);
        expect((await db.query(`select ${expression} from jobs j`)).rows).toEqual([{ comment_output_language: "ko" }]);
      }
      await db.exec(`update jobs set source_type='youtube',language_test_release_id='${release}',output_language='en'`);
      expect((await db.query(`select ${expression} from jobs j`)).rows).toEqual([{ comment_output_language: "en" }]);
      await db.exec("update jobs set source_type='upload',language_test_release_id=null");
    }
  } finally { await db.close(); }
}, 30_000);
