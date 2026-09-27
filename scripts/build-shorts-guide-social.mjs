// Static social cards: render once so share crawlers need no image-generation API.
// Usage: JA_FONT=/path/to/static-ja-bold.ttf node scripts/build-shorts-guide-social.mjs
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "../web/node_modules/react/index.js";
import sharp from "../web/node_modules/sharp/lib/index.js";
import { ImageResponse } from "../web/node_modules/next/dist/compiled/@vercel/og/index.node.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const h = React.createElement;
const copy = {
  ko: {
    tag: "쇼츠 가이드",
    title: ["쇼츠 수익화,", "나에게 맞는 방법부터."],
    subtitle: "내 콘텐츠와 시간에 맞춘 시작 계획",
  },
  en: {
    tag: "SHORTS GUIDE",
    title: ["Earn from Shorts.", "Find your starting point."],
    subtitle: "A plan for your content and your time.",
  },
  ja: {
    tag: "ショート動画ガイド",
    title: ["ショートの収益化、", "自分に合う始め方から。"],
    subtitle: "作りたい動画と使える時間に合うプラン",
  },
};
const box = (style, ...children) =>
  h("div", { style: { display: "flex", ...style } }, ...children);
await fs.mkdir(path.join(root, "web/public/social"), { recursive: true });
for (const [locale, c] of Object.entries(copy)) {
  const font = await fs.readFile(
    locale === "ja"
      ? process.env.JA_FONT
      : path.join(root, "web/public/fonts/editor/Paperlogy-7Bold.ttf"),
  );
  const tree = box(
    {
      width: "100%",
      height: "100%",
      background: "#090a0e",
      color: "#f7f7fa",
      fontFamily: "Guide",
      position: "relative",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    },
    box({
      position: "absolute",
      width: 900,
      height: 700,
      left: -470,
      bottom: -490,
      background:
        "radial-gradient(circle, rgba(209,54,72,0.17), rgba(9,10,14,0))",
      borderRadius: 450,
    }),
    box({
      position: "absolute",
      width: 900,
      height: 700,
      right: -470,
      top: -490,
      background:
        "radial-gradient(circle, rgba(130,67,223,0.20), rgba(9,10,14,0))",
      borderRadius: 450,
    }),
    box(
      { fontSize: 25, color: "#a8a6b2", marginBottom: 36, letterSpacing: 1 },
      `EasyCut · ${c.tag}`,
    ),
    ...c.title.map((line, i) =>
      box(
        {
          fontSize: locale === "ko" ? 86 : locale === "en" ? 76 : 74,
          lineHeight: 1.22,
          letterSpacing: -2,
          ...(i === 1
            ? {
                backgroundImage: "linear-gradient(100deg, #ae7bed, #ef858e)",
                backgroundClip: "text",
                color: "transparent",
              }
            : {}),
        },
        line,
      ),
    ),
    box(
      { fontSize: 28, color: "#b8b6c1", marginTop: 37, letterSpacing: -0.5 },
      c.subtitle,
    ),
  );
  const response = new ImageResponse(tree, {
    width: 1200,
    height: 630,
    fonts: [{ name: "Guide", data: font, weight: 700, style: "normal" }],
  });
  const output = path.join(
    root,
    `web/public/social/shorts-guide-${locale}-20260927-v2.jpg`,
  );
  await sharp(Buffer.from(await response.arrayBuffer()))
    .jpeg({ quality: 94, mozjpeg: true })
    .toFile(output);
  console.log(output);
}
