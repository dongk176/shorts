import "server-only";
import { cache } from "react";
import { revalidateTag } from "next/cache";
import { RECENT_UPDATES_TAG } from "./recent-updates";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { updateAssetIds, updateDraftSchema, publicationIssues, type AdminUpdate, type UpdateContent } from "./update-content";
export const publishedUpdates = cache(async (): Promise<UpdateContent[]> => {
 const rows = await getDb()`select published from shorts_mvp.update_posts where visible = true and published is not null order by published->>'date' desc, sort_order asc, id asc`;
 return rows.map(row => updateDraftSchema.parse(row.published));
});
export async function listAdminUpdates(): Promise<AdminUpdate[]> {
 const rows = await getDb()`select id, draft, version, visible, first_published_at, updated_at, (published is null or draft <> published) as has_changes from shorts_mvp.update_posts order by draft->>'date' desc, sort_order asc, id asc`;
 return rows.map(row => ({ id: row.id, draft: updateDraftSchema.parse(row.draft), version: row.version, visible: row.visible, firstPublishedAt: row.firstPublishedAt?.toISOString() ?? null, updatedAt: row.updatedAt.toISOString(), hasChanges: row.hasChanges }));
}
export async function saveUpdate(input: { id: string; version: number; action: "save" | "publish" | "hide"; draft: UpdateContent }, adminId: string) {
 const post = updateDraftSchema.parse(input.draft);
 if (input.action === "publish") { const issues = publicationIssues(post); if (issues.length) throw new HttpError(400, issues.join(" ")); }
 const sql = getDb();
 await sql.begin(async tx => {
  const [existing] = await tx`select version, draft, first_published_at from shorts_mvp.update_posts where id=${input.id}::uuid for update`;
  if (existing ? existing.version !== input.version : input.version !== 0) throw new HttpError(409, "다른 곳에서 수정된 글입니다. 내용을 복사해 두고 목록을 새로 열어 주세요.");
  if (existing?.firstPublishedAt && existing.draft.slug !== post.slug) throw new HttpError(400, "게시한 글의 주소는 변경할 수 없습니다.");
  const assets = updateAssetIds(post);
  if (assets.length) {
   const found = await tx`select id from shorts_mvp.update_assets where id = any(${assets}::uuid[])`;
   if (found.length !== assets.length) throw new HttpError(400, "사진을 다시 업로드해 주세요.");
  }
  if (!existing) await tx`insert into shorts_mvp.update_posts (id, slug, draft, updated_by) values (${input.id}::uuid, ${post.slug}, ${tx.json(post)}, ${adminId}::uuid)`;
  if (input.action === "hide") {
   await tx`update shorts_mvp.update_posts set visible=false, version=version+1, updated_at=now(), updated_by=${adminId}::uuid where id=${input.id}::uuid`;
  } else if (input.action === "publish") {
   await tx`update shorts_mvp.update_posts set slug=${post.slug}, draft=${tx.json(post)}, published=${tx.json(post)}, published_assets=${assets}::uuid[], visible=true, first_published_at=coalesce(first_published_at, now()), version=version+1, updated_at=now(), updated_by=${adminId}::uuid where id=${input.id}::uuid`;
  } else {
   await tx`update shorts_mvp.update_posts set slug=${post.slug}, draft=${tx.json(post)}, version=version+1, updated_at=now(), updated_by=${adminId}::uuid where id=${input.id}::uuid`;
  }
 });
 if (input.action === "publish" || input.action === "hide") revalidateTag(RECENT_UPDATES_TAG);
 return (await listAdminUpdates()).find(p => p.id === input.id)!;
}
