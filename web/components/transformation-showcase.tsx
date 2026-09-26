"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { localizedValue, type SiteLocale } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/provider";
import { categoryShowcase, categoryShowcaseMedia, showcaseCategoryCopy, defaultShowcaseCategory, showcaseStyleLabels, type ShowcaseCategory, type ShowcaseMedia, type ShowcaseStyle } from "@/lib/category-showcase";
import styles from "./transformation-showcase.module.css";

const templateChoiceLabels: Partial<Record<ShowcaseStyle, Record<SiteLocale, string>>> = {
  comment: { ko: "댓글 넣기", en: "Comments", ja: "コメント" },
  highlight: { ko: "자막 강조", en: "Highlights", ja: "字幕強調" },
  minimal: { ko: "깔끔하게", en: "Simple", ja: "シンプル" },
};

function CategoryIcon({ category }: { category: ShowcaseCategory }) {
  const paths: Record<ShowcaseCategory, string> = {
    talk: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM5 11v1a7 7 0 0 0 14 0v-1M12 19v3m-4 0h8",
    entertainment: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM8 14s1 3 4 3 4-3 4-3M8 8v2m8-2v2",
    review: "M6 3h12a2 2 0 0 1 2 2v16H4V5a2 2 0 0 1 2-2ZM8 8h8M8 12h8m-8 4h5",
    education: "m2 8 10-5 10 5-10 5L2 8Zm4 3v6l6 3 6-3v-6m4-3v9",
    gaming: "M8 6h8c3 0 4 3 5 9 1 4-2 5-4 2l-2-2H9l-2 2c-2 3-5 2-4-2 1-6 2-9 5-9Zm-1 3v5m-2-2h4m7-2h.01M18 13h.01",
    vlog: "M3 6h12v13H3V6Zm12 4 6-3v11l-6-3M6 3h6",
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[category]} /></svg>;
}

function PreviewVideo({ source, poster, active, label, audible = false }: { source: string; poster: string; active: boolean; label: string; audible?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (active && !document.hidden) void video.play().catch(() => { /* A user gesture can start playback. */ });
    else video.pause();
    return () => video.pause();
  }, [active, source, audible]);
  return <><video ref={ref} className={styles.video} src={source} poster={poster} muted={!audible} playsInline loop controls={false} preload={active ? "auto" : "metadata"} aria-label={label}
    onError={() => setFailed(true)} data-media-error={failed || undefined} />{failed && <span className={styles.mediaError} role="status">⚠ {label}</span>}</>;
}

function ExpandedPlayer({ media, locale, category, index, onClose }: { media: ShowcaseMedia; locale: SiteLocale; category: ShowcaseCategory; index: number; onClose: () => void }) {
  const [playing, setPlaying] = useState(true);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const clip = index < 0 ? media : media.shorts[index];
  const presentation = index < 0 ? undefined : media.shorts[index].style;
  const playerCopy = presentation === "comment" ? ({
    ko: { title: "여기에 댓글까지 붙이면 이런 느낌이에요", description: "영상 보면서 할 법한 말을 AI 댓글로 붙였어요" },
    en: { title: "Here’s what it looks like with a comment", description: "We added an AI comment—the kind of thing you might say while watching" },
    ja: { title: "コメントをつけると、こんな感じです", description: "見ながら思わず言いたくなるひと言を、AIコメントでつけてみました" },
  })[locale] : presentation === "highlight" ? ({
    ko: { title: "중요한 말은 자막으로 딱 짚어줘요", description: "글자를 크게 넣고, 포인트가 되는 단어에 색을 줬어요" },
    en: { title: "Make the important words easy to catch", description: "Bigger captions, with a bit of color on the key words" },
    ja: { title: "大事な言葉は、字幕で目立たせます", description: "文字を大きくして、ポイントになる言葉に色をつけました" },
  })[locale] : presentation ? ({
    ko: { title: "깔끔한 게 좋으면 이 스타일로 가세요", description: "제목 붙이고, 영상이 잘 보이게. 딱 필요한 것만 넣었어요" },
    en: { title: "Like it simple? Try this one", description: "Just a title and your video. That’s it" },
    ja: { title: "シンプルなのが好きなら、こちら", description: "タイトルをつけて、動画を見やすく。それだけです" },
  })[locale] : { title: showcaseCategoryCopy[category][locale].headline, description: showcaseCategoryCopy[category][locale].description };
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    return () => { dialog?.close(); document.body.style.overflow = previousOverflow; previousFocus?.focus(); };
  }, []);
  return createPortal(<dialog ref={dialogRef} className={styles.dialog} onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} aria-label={localizedValue(locale, { ko: "영상 미리보기", en: "Video preview", ja: "動画プレビュー" })}>
    <div className={styles.dialogContent}>
      <button autoFocus type="button" className={styles.close} onClick={onClose} aria-label={localizedValue(locale, { ko: "닫기", en: "Close", ja: "閉じる" })}>×</button>
      <div className={index < 0 ? styles.expandedSource : styles.expandedShort}>
        <PreviewVideo source={clip.source} poster={clip.poster} active={playing} audible={Boolean(media.hasAudio)} label={media.title} />
      </div>
      <button type="button" className={styles.playToggle} aria-pressed={playing} onClick={() => setPlaying((value) => !value)}>{playing ? "Ⅱ" : "▷"} {localizedValue(locale, { ko: "재생 / 일시정지", en: "Play / pause", ja: "再生 / 一時停止" })}</button>
      <p>{playerCopy.title}</p><small>{playerCopy.description}</small>
    </div>
  </dialog>, document.body);
}

function ShortCard({ media, index, position, template, locale, active, audible, onSelect }: { media?: ShowcaseMedia; index: number; position: number; template: ShowcaseStyle; locale: SiteLocale; active: boolean; audible: boolean; onSelect: () => void }) {
  const clip = media?.shorts[index];
  const actualTemplate = clip?.style ?? template;
  return <figure className={`${styles.short} ${styles[`card${position}`]}`}>
    <button type="button" className={styles.shortButton} disabled={!clip} onClick={onSelect} aria-pressed={position === 1} aria-label={localizedValue(locale, { ko: `${index + 1}번째 ${showcaseStyleLabels[actualTemplate].ko} 쇼츠 가운데로 보기`, en: `Center Short ${index + 1}: ${showcaseStyleLabels[actualTemplate].en}`, ja: `ショート${index + 1}を中央に：${showcaseStyleLabels[actualTemplate].ja}` })}>
      {clip ? <PreviewVideo source={clip.source} poster={clip.poster} active={active} audible={audible} label={`${media?.author} · ${index + 1}`} /> : <span className={styles.pendingMark}><span>✦</span>{localizedValue(locale, { ko: "영상 준비 중", en: "Video coming soon", ja: "動画を準備中" })}</span>}
    </button>
  </figure>;
}

function Showcase({ locale }: { locale: SiteLocale }) {
  const id = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const [selected, setSelected] = useState<ShowcaseCategory>(defaultShowcaseCategory[locale]);
  const [visible, setVisible] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(true);
  const [centeredShort, setCenteredShort] = useState(1);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const category = categoryShowcase.find((item) => item.id === selected)!;
  const media = categoryShowcaseMedia[locale][selected];
  const categoryCopy = showcaseCategoryCopy[selected][locale];
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => { setReducedMotion(motion.matches); };
    const updateVisibility = () => setDocumentVisible(!document.hidden);
    updateMotion(); updateVisibility();
    motion.addEventListener("change", updateMotion);
    document.addEventListener("visibilitychange", updateVisibility);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.1 });
    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => { observer.disconnect(); motion.removeEventListener("change", updateMotion); document.removeEventListener("visibilitychange", updateVisibility); };
  }, []);
  useEffect(() => {
    const tab = tabsRef.current[categoryShowcase.findIndex((item) => item.id === selected)];
    const rail = tab?.parentElement;
    if (tab && rail) rail.scrollLeft = tab.offsetLeft - rail.offsetLeft - (rail.clientWidth - tab.clientWidth) / 2;
  }, [selected]);
  const active = visible && !reducedMotion && documentVisible && expanded === null;
  function selectTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % categoryShowcase.length;
    else if (event.key === "ArrowLeft") next = (index + categoryShowcase.length - 1) % categoryShowcase.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = categoryShowcase.length - 1;
    else return;
    event.preventDefault(); setSoundEnabled(false); setCenteredShort(1); setSelected(categoryShowcase[next].id); tabsRef.current[next]?.focus(); tabsRef.current[next]?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  }
  return <section ref={sectionRef} id="category-showcase" className={styles.section} aria-labelledby={`${id}-heading`} data-i18n-skip data-reduced-motion={reducedMotion}>
    <header className={styles.heading}>
      <h2 id={`${id}-heading`}>{localizedValue(locale, { ko: "긴 영상 하나 넣으면,", en: "Start with one long video", ja: "長い動画を1本入れると、" })}<br /><span>{localizedValue(locale, { ko: "쇼츠가 이렇게 나와요", en: "Get Shorts like these", ja: "こんなショートが作れます" })}</span></h2>
    </header>
    <div className={styles.tabs} role="tablist" aria-label={localizedValue(locale, { ko: "영상 카테고리", en: "Video categories", ja: "動画のジャンル" })}>
      {categoryShowcase.map((item, index) => <button key={item.id} ref={(element) => { tabsRef.current[index] = element; }} type="button" role="tab" id={`${id}-tab-${item.id}`} aria-controls={`${id}-panel`} aria-selected={selected === item.id} tabIndex={selected === item.id ? 0 : -1} onClick={() => { setSelected(item.id); setCenteredShort(1); setSoundEnabled(false); }} onKeyDown={(event) => selectTab(event, index)}><CategoryIcon category={item.id} />{item.label[locale]}</button>)}
    </div>
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${selected}`} tabIndex={0} className={styles.panel} key={selected}>
      <div className={styles.stage}>
        <figure className={styles.source}>
          <figcaption className={styles.sourceLabel}><span>{localizedValue(locale, { ko: "원본 영상", en: "Original video", ja: "元の動画" })}</span></figcaption>
          <button className={styles.sourceFrame} type="button" disabled={!media} onClick={() => setExpanded(-1)} aria-label={localizedValue(locale, { ko: "원본 미리보기 재생", en: "Play original preview", ja: "元動画のプレビューを再生" })}>
            {media ? <PreviewVideo source={media.source} poster={media.poster} active={active} label={media.title} /> : <span className={styles.emptySource}><CategoryIcon category={selected} /><strong>{category.label[locale]}</strong><span>{localizedValue(locale, { ko: "어울리는 원본 영상을 준비하고 있어요", en: "A matching source video is being prepared", ja: "このジャンルに合う元動画を準備中です" })}</span></span>}
          </button>
          <div className={styles.sourceMeta}><strong>{categoryCopy.headline}</strong><span>{categoryCopy.description}</span></div>
        </figure>
        <div className={styles.arrow} aria-hidden="true"><span>→</span></div>
        <div className={styles.result}>
          <div className={styles.fan}>
            {category.styles.map((template, index) => <ShortCard key={`${locale}-${selected}-${index}`} media={media} template={template} index={index} position={(index - centeredShort + 4) % 3} locale={locale} active={active} audible={Boolean(media?.hasAudio) && soundEnabled && index === centeredShort && active} onSelect={() => setCenteredShort(index)} />)}
          </div>
          {media?.hasAudio && <button type="button" className={styles.soundToggle} aria-label={localizedValue(locale, { ko: "음소거", en: "Mute", ja: "ミュート" })} aria-pressed={!soundEnabled} title={localizedValue(locale, soundEnabled ? { ko: "음소거", en: "Mute", ja: "ミュート" } : { ko: "음소거 해제", en: "Unmute", ja: "ミュート解除" })} onClick={() => setSoundEnabled((value) => !value)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M11 5 6 9H3v6h3l5 4V5Z" />
              {soundEnabled ? <><path d="M15 8a6 6 0 0 1 0 8" /><path d="M18 5a10 10 0 0 1 0 14" /></> : <path d="m16 9 5 6m0-6-5 6" />}
            </svg>
            <span>{localizedValue(locale, soundEnabled ? { ko: "음소거", en: "Mute", ja: "ミュート" } : { ko: "음소거 해제", en: "Unmute", ja: "ミュート解除" })}</span>
          </button>}
          <div className={styles.templateChoices} role="group" aria-label={localizedValue(locale, { ko: "쇼츠 스타일 선택", en: "Choose a Shorts style", ja: "ショートのスタイルを選択" })}>
            {category.styles.map((fallback, index) => {
              const template = media?.shorts[index].style ?? fallback;
              return <button key={index} className={styles[`choice${(index - centeredShort + 4) % 3}`]} type="button" disabled={!media} aria-pressed={Boolean(media) && centeredShort === index} onClick={() => setCenteredShort(index)}>
                <span className={styles.choiceText}>{(templateChoiceLabels[template] ?? showcaseStyleLabels[template])[locale]}</span>
              </button>;
            })}
          </div>
        </div>
      </div>
      {media?.originalUrl && <details className={styles.credits}><summary>{localizedValue(locale, { ko: "영상 출처", en: "Video credits", ja: "使用動画・クレジット" })}</summary><a href={media.originalUrl} target="_blank" rel="noreferrer">{media.author} — {media.title}</a><p><a href="https://www.youtube.com/t/creative_commons" target="_blank" rel="noreferrer">CC BY</a> · {localizedValue(locale, { ko: "원본을 발췌해 세로 영상으로 편집했어요 · 추가한 댓글과 반응 수치는 AI 예시예요", en: "Excerpts edited into vertical videos · Added comments and reaction counts are AI demos", ja: "元動画を抜粋して縦動画に編集 · 追加コメントと反応数はAIによるサンプルです" })}</p></details>}
    </div>
    {expanded !== null && media && <ExpandedPlayer media={media} locale={locale} category={selected} index={expanded} onClose={() => setExpanded(null)} />}
  </section>;
}

export function TransformationShowcase() {
  const { locale } = useI18n();
  return <Showcase key={locale} locale={locale} />;
}
