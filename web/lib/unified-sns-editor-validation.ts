import type { ValidatedEditorDocumentSnapshot } from "./editor-document-contract";
import type { EditorReleaseAssignment } from "./editor-rendering-release";
import type { VideoAspectRatio } from "./contracts";
import { HttpError } from "./http";
import {
  isUnifiedSnsSnapshot, unifiedSnsSnapshot, unifiedSnsTemplate,
  UNIFIED_COMMUNITY_EDITOR_RELEASE_ID, UNIFIED_SNS_EDITOR_RELEASE_ID
} from "./unified-sns-editor";

/** Only the new, attested worker can accept movable social layers. The base
 * layout and immutable language/template identity always come from storage;
 * editable geometry, copy and image ownership use the common editor validators. */
export function validateUnifiedSnsEdit(document: ValidatedEditorDocumentSnapshot, original: Record<string, unknown>,
  ratio: VideoAspectRatio, release: EditorReleaseAssignment) {
  const community = original.communityTemplateVersion === 1;
  const snapshot = document.template.snapshot;
  if (original.snsTemplateVersion !== 1 || !isUnifiedSnsSnapshot(snapshot)
    || !release.unifiedTemplateEditingCapable
    || release.releaseId !== (community ? UNIFIED_COMMUNITY_EDITOR_RELEASE_ID : UNIFIED_SNS_EDITOR_RELEASE_ID)
    || document.version !== 3 || document.renderSpec.version !== 4
    || document.template.id !== "white-yellow" || document.template.customTemplateId !== null
    || snapshot?.snsLanguage !== original.snsLanguage
    || (snapshot?.communityTemplateVersion === 1) !== community
    || !/^#[0-9a-f]{6}$/i.test(String(snapshot?.brandColor))
    || document.video.aspectRatio !== ratio) {
    throw new HttpError(400, "편집 화면을 새로 열고 다시 저장해 주세요.", "SNS_EDITOR_DOCUMENT_INVALID");
  }
  const layout = unifiedSnsTemplate({ templateSnapshot: { ...original, brandColor: snapshot?.brandColor }, videoAspectRatio: ratio });
  if (!layout) throw new HttpError(400, "템플릿 정보를 확인할 수 없습니다.");
  // Ignore client-supplied base config/identity. All user changes live in the
  // already validated overlay/document fields, including uploaded backgrounds.
  return unifiedSnsSnapshot(original, layout.config, document.title.text, document.overlays.textOverlays, String(snapshot?.brandColor));
}
