import Image from "next/image";
import { captures } from "./data";
import styles from "./updates.module.css";
export function CapturedImage({ image, priority = false }: {
    image: string;
    priority?: boolean;
}) {
    const shot = captures[image];
    return <div className={styles.captureViewport} style={{ aspectRatio: `${shot.width}/${shot.height}` }}><Image src={`/updates/${image}.jpg`} alt={shot.alt} width={1920} height={873} priority={priority} sizes="1920px" style={{ position: "absolute", width: `${1920 / shot.width * 100}%`, maxWidth: "none", height: "auto", left: `${-shot.cropX / shot.width * 100}%`, top: `${-shot.cropY / shot.height * 100}%` }}/></div>;
}
