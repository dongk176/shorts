import Image from "next/image";
import { captures } from "./data";
import styles from "./updates.module.css";
export function CapturedImage({ image, priority = false }: {
    image: string;
    priority?: boolean;
}) {
    const shot = captures[image];
    const sourceWidth = shot.sourceWidth ?? 1920;
    const sourceHeight = shot.sourceHeight ?? 873;
    return <div className={styles.captureViewport} style={{ aspectRatio: `${shot.width}/${shot.height}` }}><Image src={`/updates/${image}.jpg`} alt={shot.alt} width={sourceWidth} height={sourceHeight} priority={priority} sizes="1920px" style={{ position: "absolute", width: `${sourceWidth / shot.width * 100}%`, maxWidth: "none", height: "auto", left: `${-shot.cropX / shot.width * 100}%`, top: `${-shot.cropY / shot.height * 100}%` }}/></div>;
}
