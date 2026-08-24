import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { authProfile } from "@/lib/session";
import { createNoIndexMetadata } from "@/lib/seo";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { SettingsPageContent } from "./settings-page-content";

export const dynamic = "force-dynamic";
export const metadata: Metadata = createNoIndexMetadata("설정", "Easy Cut 계정 및 약관 설정");

export default async function SettingsPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/auth/sign-in?next=/settings");

  return <SettingsPageContent user={authProfile(user)} />;
}
