import Image from "next/image";
import type { UpdateShot } from "@/lib/update-content";
import { legacyShot } from "./data";
import styles from "./updates.module.css";
export function CapturedImage({ image, shot: suppliedShot, priority = false }: {
    image: string;
    shot?: UpdateShot;
    priority?: boolean;
}) {
    const shot = suppliedShot ?? legacyShot(image);
    const sourceWidth = shot.sourceWidth ?? 1920;
    const sourceHeight = shot.sourceHeight ?? 873;
    return <div className={styles.captureViewport} style={{ aspectRatio: `${shot.width}/${shot.height}` }}><Image src={shot.src} unoptimized={shot.src.startsWith("/api/")} alt={shot.alt} width={sourceWidth} height={sourceHeight} priority={priority} sizes="1920px" style={{ position: "absolute", width: `${sourceWidth / shot.width * 100}%`, maxWidth: "none", height: "auto", left: `${-shot.cropX / shot.width * 100}%`, top: `${-shot.cropY / shot.height * 100}%` }}/></div>;
}
