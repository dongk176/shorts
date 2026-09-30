import { CapturedImage } from "./captured-image";
import type { UpdatePost } from "./data";
import styles from "./updates.module.css";
export function UpdateCover({ post, priority = false }: {
    post: UpdatePost;
    priority?: boolean;
}) {
    return <div className={styles.cover} data-tone={post.topic}>
   <div className={styles.coverTitle}>{post.cover.split("\n").map(line => <span key={line}>{line}</span>)}</div>
   <div className={styles.coverScreen}><div className={styles.screenBar}><i /><i /><i /><span>easycut.co.kr</span></div><CapturedImage image={post.image} priority={priority}/></div>
 </div>;
}
