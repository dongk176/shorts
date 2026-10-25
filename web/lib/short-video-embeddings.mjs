import { randomUUID } from "node:crypto";

export const SHORT_EMBEDDING_MODEL = "text-embedding-3-small";
export const SHORT_EMBEDDING_DIMENSIONS = 768;

/** Public metadata only. Never return provider response bodies or credentials. */
export async function createShortEmbeddings(inputs, { apiKey, fetcher = fetch, timeoutMs = 15000 } = {}) {
  if (!apiKey) throw new Error("EmbeddingKeyMissing");
  if (!inputs.length || inputs.length > 128 || inputs.some(text => typeof text !== "string" || !text.trim() || text.length > 2000)) throw new Error("EmbeddingInputInvalid");
  const response = await fetcher("https://api.openai.com/v1/embeddings", {
    method: "POST", signal: AbortSignal.timeout(timeoutMs),
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: SHORT_EMBEDDING_MODEL, dimensions: SHORT_EMBEDDING_DIMENSIONS, encoding_format: "float", input: inputs }),
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`EmbeddingHttp${response.status}`); }
  const result = await response.json();
  const rows = result.data;
  if (!Array.isArray(rows) || rows.length !== inputs.length) throw new Error("EmbeddingResponseInvalid");
  const ordered = new Array(inputs.length);
  for (const row of rows) {
    if (!Number.isInteger(row.index) || row.index < 0 || row.index >= inputs.length || ordered[row.index]
      || !Array.isArray(row.embedding) || row.embedding.length !== SHORT_EMBEDDING_DIMENSIONS
      || row.embedding.some(n => typeof n !== "number" || !Number.isFinite(n))
      || !row.embedding.some(n => n !== 0)) throw new Error("EmbeddingResponseInvalid");
    ordered[row.index] = row.embedding;
  }
  return { vectors: ordered, tokens: Number.isSafeInteger(result.usage?.total_tokens) ? result.usage.total_tokens : 0 };
}

/** Brief DB claim, then external API call outside a transaction. Lease tokens
 * fence late responses; concurrent cron/backfills cannot own the same batch. */
export async function indexShortVideoBatch(db, { apiKey, limit = 100, embed = createShortEmbeddings } = {}) {
  if (!apiKey) return { claimed: 0, saved: 0, tokens: 0, skipped: "missing_key" };
  if (!Number.isInteger(limit) || limit < 1 || limit > 128) throw new Error("EmbeddingBatchLimitInvalid");
  const token = randomUUID();
  const claimed = await db.begin(async tx => {
    const [lock] = await tx`select pg_try_advisory_xact_lock(hashtext('shorts_mvp.short_video_embeddings_claim')) as acquired`;
    if (!lock.acquired) return null;
    return tx`with pending as (
      select c.id, md5(shorts_mvp.short_video_embedding_text(c.metadata)) as source_hash
      from shorts_mvp.youtube_catalog c left join shorts_mvp.short_video_embeddings e on e.catalog_id=c.id
      where c.availability='public' and c.video_id is not null and c.metadata is not null
        and (c.metadata->>'durationSeconds')::integer between 1 and 180
        and c.verified_at>now()-interval '30 days'
        and (e.catalog_id is null or e.embedding is null)
        and (e.lease_until is null or e.lease_until<=now()) and (e.retry_after is null or e.retry_after<=now())
      order by c.id limit ${limit}
    ), claimed as (
      insert into shorts_mvp.short_video_embeddings(catalog_id,source_hash,lease_token,lease_until,attempts)
      select id,source_hash,${token}::uuid,now()+interval '2 minutes',1 from pending
      on conflict(catalog_id) do update set source_hash=excluded.source_hash,lease_token=excluded.lease_token,
        lease_until=excluded.lease_until,attempts=short_video_embeddings.attempts+1,updated_at=now()
      where short_video_embeddings.lease_until is null or short_video_embeddings.lease_until<=now()
      returning catalog_id,source_hash
    ) select p.catalog_id,p.source_hash,shorts_mvp.short_video_embedding_text(c.metadata) as input_text
      from claimed p join shorts_mvp.youtube_catalog c on c.id=p.catalog_id order by p.catalog_id`;
  });
  if (claimed === null) return { claimed: 0, saved: 0, tokens: 0, skipped: "busy" };
  if (!claimed.length) return { claimed: 0, saved: 0, tokens: 0 };
  try {
    const result = await embed(claimed.map(row => row.inputText), { apiKey });
    const records = claimed.map((row,index) => ({ catalog_id: row.catalogId, source_hash: row.sourceHash, embedding: JSON.stringify(result.vectors[index]) }));
    const saved = await db`update shorts_mvp.short_video_embeddings e set embedding=r.embedding::public.vector,
      embedded_at=now(),lease_token=null,lease_until=null,retry_after=null,updated_at=now()
      from jsonb_to_recordset(${db.json(records)}) r(catalog_id text,source_hash text,embedding text),shorts_mvp.youtube_catalog c
      where e.catalog_id=r.catalog_id and c.id=e.catalog_id and e.lease_token=${token}::uuid
        and e.source_hash=r.source_hash and md5(shorts_mvp.short_video_embedding_text(c.metadata))=r.source_hash
        and c.availability='public' and c.video_id is not null and c.metadata is not null
        and (c.metadata->>'durationSeconds')::integer between 1 and 180 and c.verified_at>now()-interval '30 days'
      returning e.catalog_id`;
    // A catalog change may have made a claimed row ineligible during the API call.
    await db`update shorts_mvp.short_video_embeddings set lease_token=null,lease_until=null,retry_after=now()+interval '5 minutes'
      where lease_token=${token}::uuid`;
    return { claimed: claimed.length, saved: saved.length, tokens: result.tokens };
  } catch (error) {
    await db`update shorts_mvp.short_video_embeddings set lease_token=null,lease_until=null,retry_after=now()+interval '5 minutes',updated_at=now()
      where lease_token=${token}::uuid`;
    throw error;
  }
}
