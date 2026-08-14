import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadCreatorProjectShare } from "@/lib/creator-project-shares";
import { getDb } from "@/lib/db";
import {
  LOGIN_WELCOME_GRANT_FLAG_KEY,
  onboardingWelcomeGrantEnabled,
} from "@/lib/onboarding-welcome";
import { authProfile } from "@/lib/session";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { CreatorProjectClient } from "./creator-project-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "전용 쇼츠 프로젝트 | 이지컷" },
  description: "이지컷으로 제작한 크리에이터 전용 쇼츠 프로젝트입니다.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function CreatorProjectPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [project, authenticatedUser, freeTrialRows] = await Promise.all([
    loadCreatorProjectShare(token),
    getAuthenticatedUser(),
    onboardingWelcomeGrantEnabled()
      ? getDb()`
          select enabled from shorts_mvp.runtime_feature_flags
          where flag_key=${LOGIN_WELCOME_GRANT_FLAG_KEY}
          limit 1
        `
      : Promise.resolve([]),
  ]);
  if (!project) notFound();

  return (
    <CreatorProjectClient
      project={project}
      token={token}
      viewRequestId={randomUUID()}
      user={authenticatedUser ? authProfile(authenticatedUser) : null}
      freeTrialEnabled={Boolean(freeTrialRows[0]?.enabled)}
    />
  );
}
