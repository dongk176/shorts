import { notFound } from "next/navigation";
import { accountContext } from "@/lib/youtube-accounts/runtime";
import { YoutubeAccountConnections } from "@/components/youtube-account-connections";
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };
export default async function Channels() {
  try { await accountContext(true); } catch { notFound(); }
  return <main className="mx-auto max-w-4xl px-6 py-12"><YoutubeAccountConnections/></main>;
}
