"use client";

import Image, { type ImageProps } from "next/image";
import { useEffect, useState } from "react";
import {
  normalizeYoutubeThumbnailUrl,
  youtubeThumbnailFallbackUrl,
} from "@/lib/youtube-thumbnail";

type YoutubeThumbnailProps = Omit<ImageProps, "src"> & { src: string };

export function YoutubeThumbnail({ src, alt, onError, ...props }: YoutubeThumbnailProps) {
  const normalizedSrc = normalizeYoutubeThumbnailUrl(src);
  const [currentSrc, setCurrentSrc] = useState(normalizedSrc);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    setCurrentSrc(normalizedSrc);
    setUnavailable(false);
  }, [normalizedSrc]);

  if (!currentSrc || unavailable) return null;

  return (
    <Image
      {...props}
      src={currentSrc}
      alt={alt}
      onError={(event) => {
        const fallback = youtubeThumbnailFallbackUrl(currentSrc);
        if (fallback && fallback !== currentSrc) setCurrentSrc(fallback);
        else setUnavailable(true);
        onError?.(event);
      }}
    />
  );
}
