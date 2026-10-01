import { z } from "zod";
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => { const d = new Date(s); return !Number.isNaN(+d) && d.toISOString().slice(0, 10) === s; }, "올바른 날짜를 입력해 주세요.");
export const annotationSchema = z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100), w: z.number().positive().max(100), h: z.number().positive().max(100), label: z.string().max(200) }).refine(a => a.x + a.w <= 100.01 && a.y + a.h <= 100.01, "표시는 사진 안에 있어야 합니다.");
export const shotSchema = z.object({
 src: z.string().regex(/^\/(?:updates\/[a-z0-9-]+\.jpg|api\/updates\/assets\/[0-9a-f-]{36})$/),
 width: z.number().int().positive().max(10000), height: z.number().int().positive().max(10000),
 cropX: z.number().min(0), cropY: z.number().min(0), sourceWidth: z.number().int().positive().max(10000), sourceHeight: z.number().int().positive().max(10000),
 capturedAt: date, alt: z.string().max(500), annotations: z.array(annotationSchema).max(20),
}).refine(s => s.cropX + s.width <= s.sourceWidth && s.cropY + s.height <= s.sourceHeight, "이미지 영역을 확인해 주세요.");
export type UpdateShot = z.infer<typeof shotSchema>;
export const blockSchema = z.discriminatedUnion("type", [
 z.object({ type: z.literal("text"), heading: z.string().max(200), eyebrow: z.string().max(100), paragraphs: z.array(z.string().max(5000)).max(30), strongFirst: z.boolean() }),
 z.object({ type: z.literal("image"), heading: z.string().max(200), description: z.string().max(1000), shot: shotSchema }),
 z.object({ type: z.literal("steps"), heading: z.string().max(200), items: z.array(z.string().max(1000)).max(30), href: z.string().max(300).regex(/^\/(?!\/)[a-zA-Z0-9/?=&%_#.-]*$/) }),
 z.object({ type: z.literal("youtube-guide") }),
]);
export type UpdateBlock = z.infer<typeof blockSchema>;
export const updateDraftSchema = z.object({
 slug: z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), date,
 kind: z.enum(["새 기능", "개선", "오류 수정"]), topic: z.string().max(100), title: z.string().max(160), summary: z.string().max(500),
 cover: z.string().max(200), image: z.string().regex(/^[a-z0-9-]*$/), commit: z.string().max(100),
 href: z.string().max(300).regex(/^\/(?!\/)[a-zA-Z0-9/?=&%_#.-]*$/),
 changes: z.array(z.string().max(5000)).max(30), steps: z.array(z.string().max(1000)).max(30), readingMinutes: z.number().int().min(1).max(60),
 shot: shotSchema.optional(), blocks: z.array(blockSchema).max(40).optional(),
});
export type UpdateContent = z.infer<typeof updateDraftSchema>;
export function publicationIssues(post: UpdateContent, today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)) {
 const issues: string[] = [];
 if (!post.title.trim()) issues.push("제목을 입력해 주세요.");
 if (!post.summary.trim()) issues.push("짧은 소개를 입력해 주세요.");
 if (!post.topic.trim() || !post.cover.trim()) issues.push("주제와 표지 문구를 입력해 주세요.");
 if (!post.shot) issues.push("표지 사진을 선택해 주세요.");
 if (post.date > today) issues.push("게시 날짜는 오늘 또는 이전 날짜로 선택해 주세요.");
 if (!post.blocks?.some(b => b.type === "text" && b.paragraphs.some(p => p.trim()))) issues.push("본문에 글을 추가해 주세요.");
 if (post.shot && !post.shot.alt.trim()) issues.push("표지 사진 설명을 입력해 주세요.");
 if (post.blocks?.some(b => b.type === "image" && !b.shot.alt.trim())) issues.push("본문 사진 설명을 입력해 주세요.");
 return issues;
}
export function updateAssetIds(post: UpdateContent) {
 const shots = [post.shot, ...(post.blocks ?? []).flatMap(b => b.type === "image" ? [b.shot] : [])];
 return [...new Set(shots.flatMap(s => s?.src.startsWith("/api/updates/assets/") ? [s.src.split("/").at(-1)!] : []))];
}
export type AdminUpdate = { id: string; draft: UpdateContent; version: number; visible: boolean; firstPublishedAt: string | null; updatedAt: string; hasChanges: boolean };
