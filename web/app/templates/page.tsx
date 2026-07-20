import type { Metadata } from "next";
import { AuthControls } from "@/components/auth-controls";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { authProfile } from "@/lib/session";
import { createPageMetadata } from "@/lib/seo";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { requireMvpSession } from "@/lib/session";
import { getDb } from "@/lib/db";
import { customTemplateFromRow } from "@/lib/custom-templates";
import type { CustomTemplate } from "@/lib/template-config";
import { TemplateLibrary } from "./template-library";

const PAGE_PATH = "/templates";

export const metadata: Metadata = createPageMetadata({
  title: "AI 쇼츠 템플릿 라이브러리 | 이지컷",
  description: "댓글 캡처, 다크 레드, 화이트 옐로, 다크 미니멀, 페이퍼까지 이지컷 쇼츠 템플릿을 한곳에서 둘러보세요.",
  path: PAGE_PATH,
});

export default async function TemplatesPage() {
  const user = await getAuthenticatedUser();
  let personalTemplates: CustomTemplate[] = [];
  if (user) {
    const session = await requireMvpSession(user);
    const rows = await getDb()`
      select id, name, base_template_id, config, version, created_at, updated_at
      from shorts_mvp.custom_templates where user_id=${session.userId}
      order by updated_at desc, id desc
    `;
    personalTemplates = rows.map(customTemplateFromRow);
  }

  return (
    <div className="app-shell site-chrome min-h-screen overflow-visible text-neutral-100">
      <SiteHeader><AuthControls user={user ? authProfile(user) : null} next={PAGE_PATH} /></SiteHeader>
      <main className="w-full flex-1 px-5 pb-24 pt-10 sm:px-8 sm:pt-14">
        <TemplateLibrary personalTemplates={personalTemplates} authenticated={Boolean(user)} />
      </main>
      <SiteFooter />
    </div>
  );
}
