"use client";

import type { RefObject } from "react";
import styles from "./creator-support.module.css";

export function CreatorSupportIntro({
  onApply,
  surfaceRef,
  headingRef,
}: {
  onApply: () => void;
  surfaceRef: RefObject<HTMLElement | null>;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  return (
    <main ref={surfaceRef} className={`${styles.page} ${styles.introPage}`} data-i18n-skip lang="ko">
      <div className={styles.introShell}>
        <div className={styles.introContent}>
          <h1 ref={headingRef} tabIndex={-1} className={styles.introHeading}>
            크리에이터의 다음 도전,<br />
            <span>이지컷</span>이 함께합니다.
          </h1>
          <div className={styles.introOffer}>
            <p className={styles.introLabel}>선정된 파트너에게 매월 제작 사용량</p>
            <p className={styles.introMinutes}>100<span>분</span></p>
            <p className={styles.introDuration}>× 3개월</p>
          </div>
          <button className={`${styles.introApply} easycut-private-entry`} onClick={onApply}>
            무료로 파트너 지원하기
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12h16m-7-7 7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </main>
  );
}
