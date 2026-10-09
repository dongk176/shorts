import { getDb } from "@/lib/db";
import { canUseYoutubeAdminPublishing } from "@/lib/youtube-accounts/review-access";
import { notFound, redirect } from "next/navigation";
import { accountContext } from "@/lib/youtube-accounts/runtime";
import { ChannelConnectionsPage } from "@/components/channel-connections-page";
import { SiteHeader } from "@/components/site-header";
import { AuthControls } from "@/components/auth-controls";
import { canUseTikTokPublishing } from "@/lib/social-publishing/tiktok/access";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import { authProfile } from "@/lib/session";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { localizedRedirectPath } from "@/lib/i18n/server";
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };
export default async function Channels() {
  const user = await getAuthenticatedUser();
  if (!user) redirect(await localizedRedirectPath("/auth/sign-in?next=/publish/channels"));
  const session = await requireAuthenticatedMvpSession({ allowPaymentMethodRemediation: true });
  const tiktokEnabled = await canUseTikTokPublishing(getDb(), session.userId);
  let adminEnabled = false;
  try { const { actor } = await accountContext(true); adminEnabled = await canUseYoutubeAdminPublishing(getDb(), actor.userId); } catch { if (!tiktokEnabled) notFound(); }
  return <div className="app-shell site-chrome desktop-sidebar-layout min-h-screen overflow-visible text-neutral-100">
    <SiteHeader desktopSidebar><AuthControls user={authProfile(user)} next="/publish/channels" /></SiteHeader>
    <ChannelConnectionsPage adminEnabled={adminEnabled} tiktokEnabled={tiktokEnabled} />
  </div>;
}
