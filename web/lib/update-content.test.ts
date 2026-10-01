import { describe, expect, it } from "vitest";
import { updateDraftSchema, publicationIssues, updateAssetIds } from "./update-content";
import { updates, legacyShot } from "../app/updates/data";
import { readFileSync } from "node:fs";
const seedSql = readFileSync(new URL("../../supabase/migrations/202610010100_update_cms.sql", import.meta.url), "utf8");
const seed = JSON.parse(seedSql.split("$seed$")[1]);
describe("update content migration and publication boundaries", () => {
 it("preserves every existing post, screenshot crop and annotation", () => {
  expect(seed).toHaveLength(updates.length);
  for (const [i, original] of updates.entries()) {
   const post = updateDraftSchema.parse(seed[i]);
   expect(post).toMatchObject(original);
   expect(post.shot).toEqual(legacyShot(original.image));
   expect(publicationIssues(post, "2026-10-01")).toEqual([]);
   expect(post.blocks?.find(b => b.type === "text")).toMatchObject({ paragraphs: original.changes });
   expect(post.blocks?.find(b => b.type === "steps")).toMatchObject({ items: original.steps, href: original.href });
  }
 });
 it("rejects broken dates, unsafe links and external image sources", () => {
  const p = seed[0];
  for (const date of ["2026-02-30", "bad"]) expect(updateDraftSchema.safeParse({ ...p, date }).success).toBe(false);
  for (const href of ["//evil.test", "javascript:alert(1)", "/\\evil.test"]) expect(updateDraftSchema.safeParse({ ...p, href }).success).toBe(false);
  expect(updateDraftSchema.safeParse({ ...p, shot: { ...p.shot, src: "https://evil.test/private" } }).success).toBe(false);
  expect(updateDraftSchema.safeParse({ ...p, shot: { ...p.shot, annotations: [{ x:95,y:0,w:20,h:20,label:"outside" }] } }).success).toBe(false);
 });
 it("allows incomplete drafts but blocks publication and future dates", () => {
  const draft = updateDraftSchema.parse({ ...seed[0], title:"", summary:"", shot:undefined, blocks:[] });
  expect(publicationIssues(draft).length).toBeGreaterThan(3);
  expect(publicationIssues({ ...updateDraftSchema.parse(seed[0]), date:"2099-01-01" })).toContain("게시 날짜는 오늘 또는 이전 날짜로 선택해 주세요.");
 });
 it("collects only the exact uploaded images referenced by the publish snapshot", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const post = updateDraftSchema.parse(seed[0]);
  post.shot!.src = `/api/updates/assets/${id}`;
  expect(updateAssetIds(post)).toEqual([id]);
  expect(updateAssetIds(updateDraftSchema.parse(seed[0]))).toEqual([]);
 });
});
