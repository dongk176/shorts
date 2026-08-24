"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { localizedValue } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/provider";

const SHOWCASE_ASSET_VERSION = "20260726-2";
const showcaseImages = [
  { path: "/home-showcase/showcase-02.png", channel: "chimchak" },
  { path: "/home-showcase/showcase-01.png", channel: "malwang" },
  { path: "/home-showcase/showcase-05.png", channel: "chimchak" },
  { path: "/home-showcase/showcase-06.png", channel: "towmoo" },
  { path: "/home-showcase/showcase-08.png", channel: "chimchak" },
  { path: "/home-showcase/showcase-12.png", channel: "wildlife" },
  { path: "/home-showcase/showcase-09.png", channel: "chimchak" },
  { path: "/home-showcase/showcase-03.png", channel: "malwang" },
  { path: "/home-showcase/showcase-10.png", channel: "chimchak" },
  { path: "/home-showcase/showcase-07.png", channel: "towmoo" },
  { path: "/home-showcase/showcase-13.png", channel: "wildlife" },
  { path: "/home-showcase/showcase-04.png", channel: "malwang" },
  { path: "/home-showcase/showcase-11.png", channel: "towmoo" },
  { path: "/home-showcase/showcase-14.png", channel: "wildlife" },
].map(({ path, channel }) => ({
  src: `${path}?v=${SHOWCASE_ASSET_VERSION}`,
  channel,
}));

const AUTO_SCROLL_PIXELS_PER_SECOND = 72;
const MANUAL_RESUME_DELAY_MS = 1_200;
const CLICK_DRAG_THRESHOLD_PX = 4;
const MAX_SHUFFLE_ATTEMPTS = 512;

function hasSeparatedChannels(images: typeof showcaseImages) {
  return images.every((image, index) => (
    image.channel !== images[(index + 1) % images.length]?.channel
  ));
}

function shuffleShowcaseImages() {
  for (let attempt = 0; attempt < MAX_SHUFFLE_ATTEMPTS; attempt += 1) {
    const images = [...showcaseImages];
    const randomValues = new Uint32Array(images.length);
    window.crypto.getRandomValues(randomValues);

    for (let index = images.length - 1; index > 0; index -= 1) {
      const swapIndex = randomValues[index] % (index + 1);
      [images[index], images[swapIndex]] = [images[swapIndex], images[index]];
    }

    if (hasSeparatedChannels(images)) {
      return images;
    }
  }

  return showcaseImages;
}

export function BackgroundShowcase() {
  const { locale } = useI18n();
  const railRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const pointerTypeRef = useRef("");
  const dragStartXRef = useRef(0);
  const dragStartScrollLeftRef = useRef(0);
  const pointerMovedRef = useRef(false);
  const desktopPausedRef = useRef(false);
  const resumeAtRef = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [imageOrder, setImageOrder] = useState(showcaseImages);

  useEffect(() => {
    setImageOrder(shuffleShowcaseImages());
  }, []);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let previousTime = performance.now();
    let animationFrame = 0;
    let initialized = false;

    const normalizePosition = () => {
      const segmentWidth = rail.scrollWidth / 3;
      if (!segmentWidth) return;

      if (!initialized) {
        rail.scrollLeft = segmentWidth;
        initialized = true;
        return;
      }

      if (rail.scrollLeft < segmentWidth * 0.5) {
        rail.scrollLeft += segmentWidth;
      } else if (rail.scrollLeft >= segmentWidth * 1.5) {
        rail.scrollLeft -= segmentWidth;
      }
    };

    const animate = (currentTime: number) => {
      normalizePosition();
      const elapsed = Math.min(currentTime - previousTime, 64);
      previousTime = currentTime;

      if (
        !reducedMotion.matches
        && !draggingRef.current
        && !desktopPausedRef.current
        && currentTime >= resumeAtRef.current
      ) {
        rail.scrollLeft += elapsed * AUTO_SCROLL_PIXELS_PER_SECOND / 1_000;
      }
      animationFrame = window.requestAnimationFrame(animate);
    };

    const resizeObserver = new ResizeObserver(normalizePosition);
    resizeObserver.observe(rail);
    normalizePosition();
    animationFrame = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
    };
  }, []);

  const pauseAfterInteraction = (delay = MANUAL_RESUME_DELAY_MS) => {
    resumeAtRef.current = performance.now() + delay;
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const rail = railRef.current;
    if (!rail || event.button !== 0) return;

    draggingRef.current = true;
    pointerTypeRef.current = event.pointerType;
    dragStartXRef.current = event.clientX;
    dragStartScrollLeftRef.current = rail.scrollLeft;
    pointerMovedRef.current = false;
    resumeAtRef.current = Number.POSITIVE_INFINITY;
    setDragging(true);

    if (event.pointerType !== "touch") {
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    }
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const rail = railRef.current;
    if (!rail || !draggingRef.current || pointerTypeRef.current === "touch") return;

    event.preventDefault();
    const deltaX = event.clientX - dragStartXRef.current;
    if (Math.abs(deltaX) >= CLICK_DRAG_THRESHOLD_PX) {
      pointerMovedRef.current = true;
    }
    rail.scrollLeft = dragStartScrollLeftRef.current - deltaX;
  };

  const finishPointerInteraction = (
    event: PointerEvent<HTMLDivElement>,
    cancelled = false,
  ) => {
    if (!draggingRef.current) return;

    const pointerType = pointerTypeRef.current;
    const moved = pointerMovedRef.current;
    draggingRef.current = false;
    pointerTypeRef.current = "";
    setDragging(false);

    if (pointerType === "touch") {
      pauseAfterInteraction();
    } else if (cancelled || moved) {
      resumeAtRef.current = performance.now();
    } else {
      desktopPausedRef.current = !desktopPausedRef.current;
      if (!desktopPausedRef.current) {
        resumeAtRef.current = performance.now();
      }
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    pauseAfterInteraction();
    event.currentTarget.scrollBy({
      left: (event.key === "ArrowRight" ? 1 : -1) * Math.max(180, event.currentTarget.clientWidth * 0.45),
      behavior: "smooth",
    });
  };

  return (
    <section className="background-showcase-section" aria-labelledby="background-showcase-title">
      <div className="background-showcase-heading">
        <h2 id="background-showcase-title" className="hero-title">
          {localizedValue(locale, { ko: "이 영상과 댓글, 전부", en: "This video and every comment", ja: "この動画もコメントも、すべて" })}
          <br />
          {localizedValue(locale, { ko: "AI가 만들었어요", en: "were made by AI", ja: "AIが作りました" })}
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-sm leading-6 text-[#d5aaa4] sm:text-base">
          {localizedValue(locale, { ko: "⬇ 소름 돋게 자연스러운 AI의 실제 댓글 ⬇", en: "⬇ Unbelievably natural comments made by AI ⬇", ja: "⬇ 驚くほど自然なAIコメント ⬇" })}
        </p>
      </div>
      <div
        ref={railRef}
        className={`background-showcase-rail${dragging ? " is-dragging" : ""}`}
        role="region"
        aria-label={localizedValue(locale, { ko: "완성된 쇼츠 예시. 좌우로 드래그하거나 클릭해 자동 이동을 일시정지할 수 있습니다.", en: "Finished Shorts examples. Drag sideways, or click to pause automatic movement.", ja: "完成したショート動画の例です。左右にドラッグするか、クリックして自動移動を一時停止できます。" })}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerInteraction}
        onPointerCancel={(event) => finishPointerInteraction(event, true)}
        onKeyDown={handleKeyDown}
        onDragStart={(event) => event.preventDefault()}
      >
        <div className="background-showcase-track">
          {[0, 1, 2].map((copyIndex) => (
            <div
              key={copyIndex}
              className="background-showcase-copy"
              aria-hidden={copyIndex === 1 ? undefined : true}
            >
              {imageOrder.map((image, imageIndex) => (
                <figure className="background-showcase-item" key={`${copyIndex}-${image.src}`}>
                  <Image
                    src={image.src}
                    alt={copyIndex === 1 ? localizedValue(locale, { ko: `완성된 쇼츠 예시 ${imageIndex + 1}`, en: `Finished Shorts example ${imageIndex + 1}`, ja: `完成したショート動画の例 ${imageIndex + 1}` }) : ""}
                    fill
                    unoptimized
                    sizes="(max-width: 640px) 44vw, (max-width: 1200px) 20vw, 250px"
                    draggable={false}
                    className="background-showcase-image"
                  />
                </figure>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
