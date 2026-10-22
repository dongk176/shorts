import type { VideoAspectRatio } from "@/lib/contracts";
import { snsEditorLayout } from "@/lib/unified-sns-editor";

export function SocialEditorDecoration({ snapshot, ratio }: { snapshot: Record<string, unknown>; ratio: VideoAspectRatio }) {
  const l = snsEditorLayout(snapshot, ratio);
  const color = String(snapshot.brandColor || "#000000");
  const [x, y, width, height] = l.card;
  return <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1080 1920">
    {l.community ? <><rect width="1080" height="270" fill={color} /><path d="M0 375H1080" stroke="#303e78" strokeWidth="3" /></>
      : <><rect x="60" y={150 + l.offset} width="960" height="132" rx="26" fill={color} /><rect x={x} y={y} width={width} height={height} fill="none" stroke="#e2e2e2" strokeWidth="2" /></>}
  </svg>;
}
