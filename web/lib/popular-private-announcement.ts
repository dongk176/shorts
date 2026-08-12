export const POPULAR_PRIVATE_DISMISSED_STORAGE_KEY =
  "easycut:popular-private-announcement-dismissed:v1";

export function shouldShowPopularPrivateAnnouncement({
  mobile,
  dismissed,
}: {
  mobile: boolean;
  dismissed: string | null;
}) {
  return mobile && dismissed !== "1";
}
