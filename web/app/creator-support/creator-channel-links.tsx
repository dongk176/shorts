"use client";

import type { CreatorPlatform } from "@/lib/creator-support";
import styles from "./creator-support.module.css";

export const creatorPlatforms = [
  { platform: "youtube", label: "유튜브", placeholder: "링크 입력" },
  { platform: "instagram", label: "인스타그램", placeholder: "링크 입력" },
] as const;

export function CreatorChannelLinks({ values, disabled, onChange }: {
  values: Record<CreatorPlatform, string>;
  disabled: boolean;
  onChange: (platform: CreatorPlatform, value: string) => void;
}) {
  return <div className={styles.channelCards}>
    {creatorPlatforms.map(({ platform, label, placeholder }) => <label key={platform} className={styles.channelCard}>
      <span className={styles.channelCardHeading}>
        <span className={styles.channelIcon} data-platform={platform} aria-hidden="true">
          {platform === "youtube" ? <svg viewBox="0 0 24 24" fill="none">
            <rect x="2" y="5" width="20" height="14" rx="4" fill="currentColor" />
            <path d="m10 9 5 3-5 3V9Z" fill="white" />
          </svg> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="3" y="3" width="18" height="18" rx="5" />
            <circle cx="12" cy="12" r="4" />
            <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
          </svg>}
        </span>
        <strong>{label}</strong>
      </span>
      <input type="url" inputMode="url" aria-label={`${label} 링크`} autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={400}
        disabled={disabled} value={values[platform]} onChange={(event) => onChange(platform, event.target.value)} placeholder={placeholder} />
    </label>)}
  </div>;
}
