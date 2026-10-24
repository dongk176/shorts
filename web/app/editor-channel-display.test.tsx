import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { CaptionTemplateEditorChannel } from "./shorts-app";
import { I18nProvider } from "@/lib/i18n/provider";
import { messagesByLocale } from "@/lib/i18n/messages";

it.each(["ugc_korea", "@ugc_korea_", "아홉글자이상채널명"])("keeps the complete channel label %s in the editing and non-editing preview", (name) => {
 for (const movable of [false, true]) {
  const html = renderToStaticMarkup(<I18nProvider locale="ko" messages={messagesByLocale.ko}>
   <CaptionTemplateEditorChannel rect={{ x: 0, y: 1710, width: 1080, height: 160 }} fontSize={48} iconSize={64} gap={26}
    channelName={name} channelThumbnailUrl={null} onPointerDown={movable ? () => {} : undefined} />
  </I18nProvider>);
  expect(html).toContain(name);
  expect(html).not.toContain("truncate");
  expect(html).not.toContain("max-w-[75%]");
 }
});
