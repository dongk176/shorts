import { z } from "zod";
import {
  editorDraftDocumentSnapshotSchema,
} from "@/lib/editor-document-contract";
import type { EditorDocumentSnapshot } from "@/lib/editor-document-snapshot";

const EDITOR_DRAFT_DATABASE = "easycut-editor-drafts";
const EDITOR_DRAFT_STORE = "drafts";
const EDITOR_DRAFT_DATABASE_VERSION = 1;
let editorDraftDatabasePromise: Promise<IDBDatabase> | null = null;

const editorDraftRecordSchema = z.object({
  key: z.string().min(1).max(240),
  shortId: z.string().uuid(),
  baseRenderVersion: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
  document: editorDraftDocumentSnapshotSchema,
}).strict().superRefine((record, context) => {
  if (
    record.document.sourceShortId !== record.shortId
    || record.document.baseRenderVersion !== record.baseRenderVersion
  ) {
    context.addIssue({
      code: "custom",
      message: "임시저장 문서와 영상 버전이 일치하지 않습니다.",
    });
  }
});

export type EditorDraftRecord = {
  key: string;
  shortId: string;
  baseRenderVersion: number;
  updatedAt: string;
  document: EditorDocumentSnapshot;
};

export function editorDraftKey(shortId: string, baseRenderVersion: number) {
  return `editor-v2:${shortId}:render:${baseRenderVersion}`;
}

export function createEditorDraftRecord(
  document: EditorDocumentSnapshot,
  updatedAt = new Date().toISOString(),
): EditorDraftRecord {
  return {
    key: editorDraftKey(document.sourceShortId, document.baseRenderVersion),
    shortId: document.sourceShortId,
    baseRenderVersion: document.baseRenderVersion,
    updatedAt,
    document,
  };
}

export function editorDraftSavedAgoLabel(
  savedAt: string | null,
  now = Date.now(),
) {
  if (!savedAt) return "자동 저장";
  const savedAtTime = Date.parse(savedAt);
  if (!Number.isFinite(savedAtTime)) return "저장됨";
  const elapsedMinutes = Math.max(
    0,
    Math.floor((now - savedAtTime) / 60_000),
  );
  if (elapsedMinutes < 1) return "방금 전 저장됨";
  if (elapsedMinutes < 60) return `${elapsedMinutes}분 전 저장됨`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}시간 전 저장됨`;
  return `${Math.floor(elapsedHours / 24)}일 전 저장됨`;
}

export function parseEditorDraftRecord(value: unknown): EditorDraftRecord | null {
  const parsed = editorDraftRecordSchema.safeParse(value);
  return parsed.success ? parsed.data as unknown as EditorDraftRecord : null;
}

function openEditorDraftDatabase() {
  if (editorDraftDatabasePromise) return editorDraftDatabasePromise;
  editorDraftDatabasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      editorDraftDatabasePromise = null;
      reject(new Error("indexed_db_unavailable"));
      return;
    }
    const request = indexedDB.open(
      EDITOR_DRAFT_DATABASE,
      EDITOR_DRAFT_DATABASE_VERSION,
    );
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(EDITOR_DRAFT_STORE)) {
        database.createObjectStore(EDITOR_DRAFT_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        editorDraftDatabasePromise = null;
      };
      resolve(request.result);
    };
    request.onerror = () => {
      editorDraftDatabasePromise = null;
      reject(request.error || new Error("editor_draft_database_open_failed"));
    };
  });
  return editorDraftDatabasePromise;
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(
      request.error || new Error("editor_draft_request_failed"),
    );
  });
}

function transactionComplete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(
      transaction.error || new Error("editor_draft_transaction_failed"),
    );
    transaction.onabort = () => reject(
      transaction.error || new Error("editor_draft_transaction_aborted"),
    );
  });
}

export async function readEditorDraft(
  shortId: string,
  baseRenderVersion: number,
) {
  const database = await openEditorDraftDatabase();
  const transaction = database.transaction(EDITOR_DRAFT_STORE, "readonly");
  const raw = await requestResult(
    transaction.objectStore(EDITOR_DRAFT_STORE).get(
      editorDraftKey(shortId, baseRenderVersion),
    ),
  );
  return parseEditorDraftRecord(raw);
}

export async function writeEditorDraft(record: EditorDraftRecord) {
  const parsed = editorDraftRecordSchema.parse(record);
  const database = await openEditorDraftDatabase();
  const transaction = database.transaction(EDITOR_DRAFT_STORE, "readwrite");
  transaction.objectStore(EDITOR_DRAFT_STORE).put(parsed);
  await transactionComplete(transaction);
}

export async function deleteEditorDraft(
  shortId: string,
  baseRenderVersion: number,
) {
  const database = await openEditorDraftDatabase();
  const transaction = database.transaction(EDITOR_DRAFT_STORE, "readwrite");
  transaction.objectStore(EDITOR_DRAFT_STORE).delete(
    editorDraftKey(shortId, baseRenderVersion),
  );
  await transactionComplete(transaction);
}
