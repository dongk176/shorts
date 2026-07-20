import type { TemplateConfig } from "@/lib/template-config";

export function CustomTemplateTitlePreview({ title, firstLine, secondLine }: { title: TemplateConfig["title"]; firstLine: string; secondLine: string }) {
  if (!title.visible) return null;
  return (
    <div className="absolute z-20 flex flex-col items-center text-center font-black leading-tight" style={{ left: `${title.x / 10.8}%`, top: `${title.y / 19.2}%`, width: `${title.maxWidth / 10.8}%`, transform: "translate(-50%, -50%)", fontSize: `${title.fontSize / 10.8}cqw` }}>
      <span className="rounded px-[1.5cqw] py-[.8cqw]" style={{ color: title.primaryColor, backgroundColor: title.primaryBackgroundColor || "transparent" }}>{firstLine}</span>
      <span className="mt-[.6cqw] rounded px-[1.5cqw] py-[.8cqw]" style={{ color: title.accentColor, backgroundColor: title.accentBackgroundColor || "transparent" }}>{secondLine}</span>
    </div>
  );
}
