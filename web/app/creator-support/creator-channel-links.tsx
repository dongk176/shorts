"use client";

import type { CreatorPlatform } from "@/lib/creator-support";
import styles from "./creator-support.module.css";

export const creatorPlatforms = [
  { platform: "youtube", label: "유튜브", placeholder: "링크 입력", url: "https://www.youtube.com/" },
  { platform: "instagram", label: "인스타그램", placeholder: "링크 입력", url: "https://www.instagram.com/" },
] as const;

export function CreatorChannelLinks({ values, disabled, onChange }: {
  values: Record<CreatorPlatform, string>;
  disabled: boolean;
  onChange: (platform: CreatorPlatform, value: string) => void;
}) {
  return <div className={styles.channelCards}>
    {creatorPlatforms.map(({ platform, label, placeholder, url }) => <div key={platform} className={styles.channelCard}>
      <span className={styles.channelCardHeading}>
        {/* Official HTTPS app links fall back to the web and keep this form open. */}
        <a className={styles.channelIcon} data-platform={platform} href={url} target="_blank" rel="noopener noreferrer"
          aria-label={`${label} 열기 (앱 또는 새 창)`} title={`${label} 열기`}>
          {platform === "youtube" ? <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="2" y="5" width="20" height="14" rx="4" fill="currentColor" />
            <path d="m10 9 5 3-5 3V9Z" fill="white" />
          </svg> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="5" />
            <circle cx="12" cy="12" r="4" />
            <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
          </svg>}
        </a>
        <label htmlFor={`creator-${platform}-link`}><strong>{label}</strong></label>
      </span>
      <input id={`creator-${platform}-link`} type="url" inputMode="url" enterKeyHint="next" aria-label={`${label} 링크`} autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={400}
        disabled={disabled} value={values[platform]} onChange={(event) => onChange(platform, event.target.value)} placeholder={placeholder} />
    </div>)}
  </div>;
}
