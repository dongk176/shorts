"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import type { GuideSlug } from "@/lib/shorts-guides/catalog";
const Context = createContext<{
  recommended?: GuideSlug;
  setRecommended: (slug?: GuideSlug) => void;
  active: boolean;
  setActive: (value: boolean) => void;
  resume: "new" | "draft" | "result";
  setResume: (value: "new" | "draft" | "result") => void;
}>({
  setRecommended: () => {},
  active: false,
  setActive: () => {},
  resume: "new",
  setResume: () => {},
});
export function GuideRecommendationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [recommended, setRecommended] = useState<GuideSlug>();
  const [active, setActive] = useState(false);
  const [resume, setResume] = useState<"new" | "draft" | "result">("new");
  return (
    <Context.Provider
      value={{
        recommended,
        setRecommended,
        active,
        setActive,
        resume,
        setResume,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export const useGuideRecommendation = () => useContext(Context);
