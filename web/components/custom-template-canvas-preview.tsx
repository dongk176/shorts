import { CustomTemplateTitlePreview } from "@/components/custom-template-title-preview";
import { TemplateCommentPreview } from "@/components/template-comment-prototype";
import {
  customCanvasWidth,
  customCenteredLayerStyle,
  customCommentLayerY,
  customVideoFrameStyle,
} from "@/lib/custom-template-preview-layout";
import { stockBackgrounds, TEMPLATE_CANVAS, type CustomTemplate } from "@/lib/template-config";

function previewBackground(template: CustomTemplate) {
  const background = template.config.background;
  if (background.kind === "color") return { backgroundColor: background.color };
  const asset = stockBackgrounds.find((item) => item.id === background.assetId);
  return {
    backgroundImage: `url(${asset?.src || ""})`,
    backgroundPosition: "center",
    backgroundSize: "cover",
  };
}

function PreviewChannel({ template, label, inCommentFlow = false }: { template: CustomTemplate; label: string; inCommentFlow?: boolean }) {
  const channel = template.config.channel;
  if (!channel.visible) return null;
  const flowStyle = inCommentFlow
    ? { width: customCanvasWidth(channel.maxWidth) }
    : customCenteredLayerStyle(channel);
  return (
    <div
      className={`${inCommentFlow ? "relative mx-auto mt-[2cqw] block" : "absolute"} z-30 truncate rounded px-[1.5cqw] py-[.7cqw] text-center font-bold`}
      style={{ ...flowStyle, color: channel.color, backgroundColor: channel.backgroundColor || "transparent", fontSize: customCanvasWidth(channel.fontSize) }}
    >
      ● {label}
    </div>
  );
}

export function CustomTemplateCanvasPreview({
  template,
  firstLine,
  secondLine,
  channelLabel,
}: {
  template: CustomTemplate;
  firstLine: string;
  secondLine: string;
  channelLabel: string;
}) {
  const config = template.config;
  const commentLayerEnabled = template.baseTemplateId === "comment-capture";
  const commentY = customCommentLayerY(config);
  return (
    <div
      className="relative mx-auto aspect-[9/16] w-full max-w-[164px] overflow-hidden rounded-lg"
      style={{ ...previewBackground(template), containerType: "inline-size" }}
      aria-label={`${template.name} 쇼츠 미리보기`}
    >
      <div className="absolute bg-neutral-700" style={customVideoFrameStyle(config.video)}>
        <div className="absolute inset-x-0 top-1/2 h-px bg-white/20" />
      </div>
      <CustomTemplateTitlePreview title={config.title} firstLine={firstLine} secondLine={secondLine} />
      {commentLayerEnabled
        ? <div className="absolute inset-x-0 z-40" style={{ top: `${(commentY / TEMPLATE_CANVAS.height) * 100}%` }}>
            {config.comment.visible && <TemplateCommentPreview theme={config.comment.theme} size={config.comment.size} />}
            <PreviewChannel template={template} label={channelLabel} inCommentFlow />
          </div>
        : <PreviewChannel template={template} label={channelLabel} />}
    </div>
  );
}
