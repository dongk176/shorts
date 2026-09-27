import { getAuthenticatedUser } from "@/lib/supabase/server";
import { authProfile } from "@/lib/session";
import { getRequestLocale } from "@/lib/i18n/server";
import { savedVideoCopy } from "@/lib/saved-videos";
import { SavedVideosPage } from "./saved-videos-page";
export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const copy = savedVideoCopy[await getRequestLocale()];
  return { title: { absolute: `${copy.title} | Easy Cut` }, description: copy.description, robots: { index: false, follow: false } };
}
export default async function Page() {
  const user = await getAuthenticatedUser();
  return <SavedVideosPage user={user ? authProfile(user) : null} />;
}
