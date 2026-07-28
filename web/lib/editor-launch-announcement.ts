export const EDITOR_LAUNCH_CAMPAIGN_CODE = "editor_launch_20260728";

export type EditorLaunchAnnouncement = {
  campaignCode: typeof EDITOR_LAUNCH_CAMPAIGN_CODE;
  grantedSeconds: number;
  validUntil: string;
};
