import "server-only";

import { randomUUID } from "node:crypto";
import type { Row, Sql, TransactionSql } from "postgres";
import { getBillingSummary } from "@/lib/billing";
import {
  BACKGROUND_ASSET_DRAFT_RETENTION_DAYS,
  BACKGROUND_ASSET_HEIGHT,
  BACKGROUND_ASSET_MAX_INPUT_BYTES,
  BACKGROUND_ASSET_MAX_LISTED,
  BACKGROUND_ASSET_MAX_OUTPUT_BYTES,
  BACKGROUND_ASSET_MAX_STORAGE_BYTES,
  BACKGROUND_ASSET_UPLOADS_PER_MINUTE,
  BACKGROUND_ASSET_WIDTH,
  backgroundAssetIdSchema,
  backgroundAssetImageUrl,
  type BackgroundAssetList,
  type BackgroundAssetMetadata,
  type BackgroundAssetUploadResult,
} from "@/lib/background-assets-contract";
import type { NormalizedBackgroundAssetImage } from "@/lib/background-assets-image";
import {
  backgroundAssetObjectKey,
  getBackgroundAssetObject,
  putBackgroundAssetObject,
} from "@/lib/background-assets-storage";
import {
  assertCustomTemplateDesignAccess,
  lockCustomTemplateDesignAccess,
} from "@/lib/custom-template-design-access";
import { assertEnterpriseServiceAccess } from "@/lib/enterprise-access";
import { HttpError } from "@/lib/http";
import { assertPaidProjectActionAccess } from "@/lib/project-action-entitlements";

export { collectBackgroundAssetIds } from "@/lib/background-assets-contract";

export type BackgroundAssetReservation = {
  assetId: string;
  userId: string;
  objectKey: string;
  originalByteSize: number;
};

export type OwnedBackgroundAsset = {
  assetId: string;
  objectKey: string;
  sha256: string;
  byteSize: number;
  width: number;
  height: number;
};

function missingAsset() {
  return new HttpError(404, "배경 이미지를 찾을 수 없습니다. 다시 업로드해 주세요.", "BACKGROUND_ASSET_NOT_FOUND");
}

function busyAsset() {
  return new HttpError(409, "같은 이미지가 처리 중입니다. 잠시 후 다시 시도해 주세요.", "BACKGROUND_ASSET_BUSY", 2);
}

function metadataFromRow(row: Row): BackgroundAssetMetadata {
  const id = backgroundAssetIdSchema.parse(row.id);
  return {
    id,
    displayName: String(row.displayName || "내 배경"),
    width: Number(row.width),
    height: Number(row.height),
    byteSize: Number(row.byteSize),
    createdAt: new Date(row.createdAt as string | Date).toISOString(),
    imageUrl: backgroundAssetImageUrl(id),
  };
}

function displayName(value: string) {
  // Names are cosmetic only and are never used to derive storage paths.
  return value.replace(/[\u0000-\u001f\u007f]/g, "").split(/[\\/]/).pop()?.trim().slice(0, 120) || "내 배경";
}

export async function lockBackgroundAssetUser(tx: TransactionSql, userId: string) {
  const id = backgroundAssetIdSchema.parse(userId);
  await tx`select pg_advisory_xact_lock(hashtextextended(${`background-assets:${id}`}, 0))`;
}

async function lockUploadAccess(tx: TransactionSql, userId: string) {
  assertCustomTemplateDesignAccess(await lockCustomTemplateDesignAccess(tx, userId));
  await lockBackgroundAssetUser(tx, userId);
  // Both existing template and editing entitlements currently use this same
  // paid/managed-feature predicate. No upload grants credits or widens access.
  assertPaidProjectActionAccess(await getBillingSummary(tx, userId), "edit");
  await assertEnterpriseServiceAccess(tx, userId);
}

async function quota(tx: Sql | TransactionSql, userId: string) {
  const rows = await tx`
    select
      count(*) filter (where state='ready' and library_removed_at is null)::int as listed_count,
      count(*) filter (where state='pending')::int as pending_count,
      coalesce(sum(case when state<>'deleted' then coalesce(byte_size,reserved_bytes) else 0 end),0)::bigint as bytes_used,
      count(*) filter (where created_at>clock_timestamp()-interval '1 minute')::int as recent_uploads
    from shorts_mvp.background_assets where user_id=${userId}
  `;
  return {
    listedCount: Number(rows[0]?.listedCount || 0),
    pendingCount: Number(rows[0]?.pendingCount || 0),
    bytesUsed: Number(rows[0]?.bytesUsed || 0),
    recentUploads: Number(rows[0]?.recentUploads || 0),
  };
}

export function assertBackgroundAssetUploadQuota(current: {
  listedCount: number; pendingCount: number; bytesUsed: number; recentUploads: number;
}) {
  if (current.recentUploads >= BACKGROUND_ASSET_UPLOADS_PER_MINUTE) {
    throw new HttpError(429, "배경 이미지는 1분에 10번까지 업로드할 수 있습니다. 잠시 후 다시 시도해 주세요.", "BACKGROUND_UPLOAD_RATE_LIMIT", 60);
  }
  if (current.listedCount + current.pendingCount >= BACKGROUND_ASSET_MAX_LISTED) {
    throw new HttpError(409, "내 배경은 최대 100개까지 보관할 수 있습니다. 목록에서 이미지를 제거한 뒤 다시 시도해 주세요.", "BACKGROUND_LIBRARY_FULL");
  }
  if (current.bytesUsed + BACKGROUND_ASSET_MAX_OUTPUT_BYTES > BACKGROUND_ASSET_MAX_STORAGE_BYTES) {
    throw new HttpError(409, "배경 이미지 보관 용량이 가득 찼습니다. 사용 중인 이미지는 유지되며, 정리가 끝나면 다시 업로드할 수 있습니다.", "BACKGROUND_STORAGE_FULL");
  }
}

/** Reserve quota/rate BEFORE decoding. Failed and deduplicated rows remain as
 * rate-limit tombstones; cleanup must retain them for at least one minute. */
export async function beginBackgroundAssetUpload(
  db: Sql,
  userId: string,
  input: { originalByteSize: number; displayName: string },
): Promise<BackgroundAssetReservation> {
  const owner = backgroundAssetIdSchema.parse(userId);
  if (!Number.isSafeInteger(input.originalByteSize) || input.originalByteSize < 1
    || input.originalByteSize > BACKGROUND_ASSET_MAX_INPUT_BYTES) {
    throw new HttpError(413, "배경 이미지는 3MB 이하로 업로드해 주세요.", "BACKGROUND_IMAGE_TOO_LARGE");
  }
  const assetId = randomUUID();
  const objectKey = backgroundAssetObjectKey(owner, assetId);
  await db.begin(async (tx) => {
    await lockUploadAccess(tx, owner);
    assertBackgroundAssetUploadQuota(await quota(tx, owner));
    await tx`
      insert into shorts_mvp.background_assets (
        id,user_id,object_key,state,original_byte_size,reserved_bytes,display_name,retain_until
      ) values (
        ${assetId},${owner},${objectKey},'pending',${input.originalByteSize},
        ${BACKGROUND_ASSET_MAX_OUTPUT_BYTES},${displayName(input.displayName)},
        clock_timestamp()+interval '15 minutes'
      )
    `;
  });
  return { assetId, userId: owner, objectKey, originalByteSize: input.originalByteSize };
}

export async function failBackgroundAssetUpload(db: Sql, reservation: BackgroundAssetReservation) {
  await db.begin(async (tx) => {
    await lockBackgroundAssetUser(tx, reservation.userId);
    // Once a digest is assigned a PUT may have happened, even if its response
    // timed out. Keep bytes charged and hand deletion to maintenance. The web
    // role deliberately has no DeleteObject permission on this prefix.
    await tx`
      update shorts_mvp.background_assets
      set state=case when sha256 is null then 'deleted' else 'deleting' end,
        library_removed_at=coalesce(library_removed_at,clock_timestamp()),
        deleted_at=case when sha256 is null then clock_timestamp() else null end,
        reserved_bytes=case when sha256 is null then 0 else reserved_bytes end,
        retain_until=clock_timestamp()+interval '15 minutes'
      where id=${reservation.assetId} and user_id=${reservation.userId} and state='pending'
    `;
  });
}

export async function finishBackgroundAssetUpload(
  db: Sql,
  reservation: BackgroundAssetReservation,
  image: NormalizedBackgroundAssetImage,
): Promise<BackgroundAssetUploadResult> {
  if (image.originalByteSize !== reservation.originalByteSize || image.byteSize !== image.body.length
    || image.byteSize < 1 || image.byteSize > BACKGROUND_ASSET_MAX_OUTPUT_BYTES
    || image.width !== BACKGROUND_ASSET_WIDTH || image.height !== BACKGROUND_ASSET_HEIGHT
    || !/^[0-9a-f]{64}$/.test(image.sha256)) {
    throw new HttpError(400, "배경 이미지 변환 결과가 올바르지 않습니다.", "BACKGROUND_IMAGE_INVALID");
  }
  const reused = await db.begin(async (tx) => {
    await lockUploadAccess(tx, reservation.userId);
    const current = await tx`
      select id,state,retain_until from shorts_mvp.background_assets
      where id=${reservation.assetId} and user_id=${reservation.userId}
        and state='pending' and retain_until>clock_timestamp()
      for update
    `;
    if (!current[0]) throw busyAsset();
    const matching = await tx`
      select id,state,display_name,byte_size,width,height,created_at,library_removed_at
      from shorts_mvp.background_assets
      where user_id=${reservation.userId} and sha256=${image.sha256}
        and id<>${reservation.assetId} and state in ('pending','ready','deleting')
      order by id for update
    `;
    if (matching[0]) {
      if (matching[0].state !== "ready") throw busyAsset();
      // The current reservation already owns one visible slot. Consuming it
      // and restoring a hidden duplicate cannot exceed the 100-slot limit.
      const rows = await tx`
        update shorts_mvp.background_assets
        set library_removed_at=null,unreferenced_since=null,
          retain_until=greatest(retain_until,clock_timestamp()+interval '30 days')
        where id=${matching[0].id} and user_id=${reservation.userId} and state='ready'
        returning id,display_name,byte_size,width,height,created_at
      `;
      await tx`
        update shorts_mvp.background_assets set state='deleted',reserved_bytes=0,
          library_removed_at=clock_timestamp(),deleted_at=clock_timestamp()
        where id=${reservation.assetId} and user_id=${reservation.userId} and state='pending'
      `;
      return metadataFromRow(rows[0]);
    }
    await tx`
      update shorts_mvp.background_assets
      set sha256=${image.sha256},byte_size=${image.byteSize},
        width=${image.width},height=${image.height}
      where id=${reservation.assetId} and user_id=${reservation.userId} and state='pending'
    `;
    return null;
  });
  if (reused) return { asset: reused, reused: true };

  // Image decoding and S3 requests are intentionally outside transactions.
  await putBackgroundAssetObject({
    userId: reservation.userId, assetId: reservation.assetId,
    body: image.body, sha256: image.sha256,
  });
  const asset = await db.begin(async (tx) => {
    await lockUploadAccess(tx, reservation.userId);
    const rows = await tx`
      update shorts_mvp.background_assets
      set state='ready',reserved_bytes=0,library_removed_at=null,unreferenced_since=null,
        retain_until=clock_timestamp()+interval '30 days'
      where id=${reservation.assetId} and user_id=${reservation.userId}
        and state='pending' and sha256=${image.sha256} and retain_until>clock_timestamp()
      returning id,display_name,byte_size,width,height,created_at
    `;
    if (!rows[0]) throw busyAsset();
    return metadataFromRow(rows[0]);
  });
  return { asset, reused: false };
}

export async function listBackgroundAssets(db: Sql, userId: string): Promise<BackgroundAssetList> {
  const owner = backgroundAssetIdSchema.parse(userId);
  return db.begin(async (tx) => {
    await lockBackgroundAssetUser(tx, owner);
    const current = await quota(tx, owner);
    const rows = await tx`
      select id,display_name,byte_size,width,height,created_at
      from shorts_mvp.background_assets
      where user_id=${owner} and state='ready' and library_removed_at is null
      order by created_at desc,id desc limit ${BACKGROUND_ASSET_MAX_LISTED}
    `;
    return {
      assets: rows.map(metadataFromRow),
      quota: {
        listedCount: current.listedCount, pendingCount: current.pendingCount,
        maxListed: BACKGROUND_ASSET_MAX_LISTED, bytesUsed: current.bytesUsed,
        maxBytes: BACKGROUND_ASSET_MAX_STORAGE_BYTES,
      },
    };
  });
}

/**
 * Call inside the SAME transaction that saves a template/document or submits a
 * job. Cleanup uses the same user advisory lock then asset row lock. Hidden
 * ready assets still work in their existing templates; deleting assets cannot
 * be attached. Empty legacy designs never query the new table.
 */
export async function lockOwnedBackgroundAssets(
  tx: TransactionSql,
  userId: string,
  assetIds: readonly string[],
  options: { retainUntil?: Date } = {},
): Promise<OwnedBackgroundAsset[]> {
  if (!assetIds.length) return [];
  const owner = backgroundAssetIdSchema.parse(userId);
  const ids = [...new Set(assetIds.map((id) => backgroundAssetIdSchema.parse(id)))].sort();
  if (ids.length > BACKGROUND_ASSET_MAX_LISTED) throw missingAsset();
  if (options.retainUntil && !Number.isFinite(options.retainUntil.getTime())) throw missingAsset();
  await lockBackgroundAssetUser(tx, owner);
  const results: OwnedBackgroundAsset[] = [];
  for (const id of ids) {
    const rows = await tx`
      select id,object_key,sha256,byte_size,width,height,state
      from shorts_mvp.background_assets
      where id=${id} and user_id=${owner}
      for update
    `;
    const row = rows[0];
    if (!row || row.state !== "ready" || row.objectKey !== backgroundAssetObjectKey(owner, id)
      || !/^[0-9a-f]{64}$/.test(String(row.sha256))
      || Number(row.byteSize) < 1 || Number(row.byteSize) > BACKGROUND_ASSET_MAX_OUTPUT_BYTES
      || Number(row.width) !== BACKGROUND_ASSET_WIDTH || Number(row.height) !== BACKGROUND_ASSET_HEIGHT) {
      throw missingAsset();
    }
    await tx`
      update shorts_mvp.background_assets
      set retain_until=greatest(retain_until,
          clock_timestamp()+${BACKGROUND_ASSET_DRAFT_RETENTION_DAYS}*interval '1 day',
          ${options.retainUntil?.toISOString() || null}::timestamptz),
        unreferenced_since=null
      where id=${id} and user_id=${owner} and state='ready'
    `;
    results.push({ assetId: id, objectKey: String(row.objectKey), sha256: String(row.sha256),
      byteSize: Number(row.byteSize), width: Number(row.width), height: Number(row.height) });
  }
  return results;
}

export async function getBackgroundAssetImage(db: Sql, userId: string, assetId: string) {
  const owner = backgroundAssetIdSchema.parse(userId);
  const id = backgroundAssetIdSchema.parse(assetId);
  const asset = await db.begin(async (tx) => (await lockOwnedBackgroundAssets(tx, owner, [id]))[0]);
  const body = await getBackgroundAssetObject({ userId: owner, ...asset });
  return { body, sha256: asset.sha256, byteSize: asset.byteSize };
}

export async function removeBackgroundAssetFromLibrary(db: Sql, userId: string, assetId: string) {
  const owner = backgroundAssetIdSchema.parse(userId);
  const id = backgroundAssetIdSchema.parse(assetId);
  await db.begin(async (tx) => {
    await lockBackgroundAssetUser(tx, owner);
    const rows = await tx`
      select id,state,library_removed_at from shorts_mvp.background_assets
      where id=${id} and user_id=${owner} for update
    `;
    if (!rows[0]) throw missingAsset();
    if (rows[0].libraryRemovedAt) return; // Also idempotent after eventual GC.
    if (rows[0].state !== "ready") throw busyAsset();
    await tx`
      update shorts_mvp.background_assets
      set library_removed_at=clock_timestamp(),unreferenced_since=null,
        retain_until=greatest(retain_until,clock_timestamp()+interval '30 days')
      where id=${id} and user_id=${owner} and state='ready' and library_removed_at is null
    `;
  });
  return { removed: true as const, assetId: id };
}
