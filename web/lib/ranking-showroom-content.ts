import ko from "@/components/ranking-showroom-data.json";
import en from "@/components/ranking-showroom-en-recommended.json";
import ja from "@/components/ranking-showroom-ja-recommended.json";

export const rankingShowroomContent = {
  ko: { samples: ko, mediaRoot: "/ranking-showroom-20" },
  en: { samples: en, mediaRoot: "/ranking-showroom-en" },
  ja: { samples: ja, mediaRoot: "/ranking-showroom-ja" },
} as const;
