"use client";

import { useMemo } from "react";
import { useNavigationLocale } from "./provider";
import { createUiText } from "./ui-text";

export function useUiText() {
  const locale = useNavigationLocale();
  return useMemo(() => createUiText(locale), [locale]);
}
