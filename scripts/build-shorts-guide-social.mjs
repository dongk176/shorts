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
    title: ["쇼츠 수익화,", "나에게 맞는", "방법부터."],
    subtitle: "내 콘텐츠와 시간에 맞춘 시작 계획",
    cta: "무료로 내 수익화 방법 찾기",
    meta: "8가지 질문 · 로그인 없이 무료",
    plan: "나만의 시작 계획",
    labels: [
      "어떤 콘텐츠를 만들까요?",
      "하루에 얼마나 할 수 있나요?",
      "어떤 수익화가 맞을까요?",
    ],
    result: "맞춤 전략 + 첫 영상 아이디어",
  },
  en: {
    tag: "SHORTS GUIDE",
    title: ["Earn from Shorts.", "Find your", "starting point."],
    subtitle: "A plan for your content and your time.",
    cta: "Find my way to earn",
    meta: "8 questions · Free · No sign-in",
    plan: "Your starting plan",
    labels: [
      "What will you create?",
      "How much time do you have?",
      "How would you like to earn?",
    ],
    result: "Your strategy + first video ideas",
  },
  ja: {
    tag: "ショート動画ガイド",
    title: ["ショートの収益化、", "自分に合う", "始め方から。"],
    subtitle: "作りたい動画と使える時間に合うプラン",
    cta: "自分に合う収益化を見つける",
    meta: "8つの質問 · 無料 · ログイン不要",
    plan: "自分だけのスタートプラン",
    labels: [
      "どんな動画を作りたい？",
      "1日に使える時間は？",
      "どんな収益化が合う？",
    ],
    result: "自分に合う戦略と動画アイデア",
  },
};
const logo =
  "data:image/png;base64," +
  (await fs.readFile(path.join(root, "web/public/east-cut-logo.png"))).toString(
    "base64",
  );
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
      background: "#101315",
      color: "#f7f7fa",
      fontFamily: "Guide",
      position: "relative",
      overflow: "hidden",
    },
    box({
      position: "absolute",
      width: 780,
      height: 780,
      right: -220,
      top: -70,
      borderRadius: 400,
      background:
        "radial-gradient(circle, rgba(132,74,239,0.25), rgba(16,19,21,0))",
    }),
    box(
      {
        position: "absolute",
        left: 64,
        top: 44,
        alignItems: "center",
        gap: 14,
      },
      h("img", {
        src: logo,
        width: 42,
        height: 42,
        style: { borderRadius: 10 },
      }),
      box(
        { fontSize: 27 },
        "Easy",
        h("span", { style: { color: "#fc827e" } }, "Cut"),
      ),
      box(
        {
          marginLeft: 18,
          borderLeft: "1px solid #45454e",
          paddingLeft: 26,
          fontSize: 20,
          color: "#c6b5e7",
        },
        c.tag,
      ),
    ),
    box(
      { position: "absolute", left: 64, top: 132, flexDirection: "column" },
      ...c.title.map((line, index) =>
        box(
          {
            fontSize: locale === "en" ? 61 : locale === "ja" ? 61 : 73,
            lineHeight: 1.18,
            letterSpacing: -2.5,
            color: index === 0 ? "#f7f7fa" : "#cdb1ff",
          },
          line,
        ),
      ),
      box(
        { fontSize: 24, color: "#b6b5c0", marginTop: 23, letterSpacing: -0.5 },
        c.subtitle,
      ),
    ),
    box(
      {
        position: "absolute",
        left: 64,
        bottom: 58,
        flexDirection: "column",
        gap: 16,
      },
      box(
        {
          padding: "18px 24px",
          borderRadius: 13,
          background: "linear-gradient(110deg,#9258e7,#f27879)",
          alignItems: "center",
          fontSize: 22,
          gap: 26,
        },
        c.cta,
        h("span", { style: { fontSize: 27 } }, "→"),
      ),
      box({ fontSize: 18, color: "#a6a5b2", paddingLeft: 2 }, c.meta),
    ),
    box(
      {
        position: "absolute",
        left: 768,
        top: 116,
        width: 364,
        height: 402,
        flexDirection: "column",
        border: "1px solid #494253",
        borderRadius: 24,
        background: "linear-gradient(150deg,#29232f,#191d23)",
        padding: 24,
        boxShadow: "0px 18px 50px rgba(0,0,0,0.3)",
        transform: "rotate(3deg)",
      },
      box(
        {
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 24,
        },
        box({ fontSize: locale === "ja" ? 18 : 21, color: "#f2eafc" }, c.plan),
        box({ fontSize: 16, color: "#c7a5fa" }, "01—08"),
      ),
      ...c.labels.map((label, i) =>
        box(
          {
            height: 67,
            marginBottom: 12,
            borderRadius: 12,
            border: "1px solid #45414e",
            background: "#24242b",
            alignItems: "center",
            padding: "0 14px",
            gap: 12,
          },
          box({ fontSize: 15, color: "#ad8cde" }, `0${i + 1}`),
          box(
            {
              fontSize: locale === "ko" ? 18 : 17,
              color: "#e8e4ee",
              letterSpacing: -0.5,
            },
            label,
          ),
        ),
      ),
      box(
        {
          fontSize: locale === "ja" ? 16 : 17,
          color: "#d0b2fa",
          marginTop: 15,
          alignItems: "center",
          gap: 9,
        },
        box(
          {
            width: 22,
            height: 22,
            borderRadius: 11,
            background: "#bb95f2",
            color: "#18131f",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 15,
          },
          "+",
        ),
        c.result,
      ),
    ),
    box(
      {
        position: "absolute",
        right: 64,
        bottom: 43,
        color: "#727481",
        fontSize: 17,
      },
      "easycut.co.kr",
    ),
  );
  const response = new ImageResponse(tree, {
    width: 1200,
    height: 630,
    fonts: [{ name: "Guide", data: font, weight: 700, style: "normal" }],
  });
  const output = path.join(
    root,
    `web/public/social/shorts-guide-${locale}-20260927.jpg`,
  );
  await sharp(Buffer.from(await response.arrayBuffer()))
    .jpeg({ quality: 94, mozjpeg: true })
    .toFile(output);
  console.log(output);
}
