import "server-only";
import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { HttpError } from "@/lib/http";
import { validateTikTokIntent } from "../review-contract";
import { postInput, returnPath, scopes, startInput, uuid, type Actor, type Tokens } from "./contracts";
import { TikTokApi, TikTokApiError } from "./api";
import type { TikTokConfig } from "./config";
import type { TikTokMediaAccess } from "./media";
import { TikTokStore, type Link, type PostRow } from "./store";
import { hash, secret, TikTokVault } from "./vault";

export class TikTokPublishing {
  constructor(readonly store: TikTokStore, private vault: TikTokVault, private api: TikTokApi, private media: TikTokMediaAccess, private config: TikTokConfig, private paidAccess: (userId: string) => Promise<void>) {}
  private actor(actor: Actor) { uuid.parse(actor.userId); if (!actor.sessionId) throw new HttpError(401, "Please sign in.", "TIKTOK_SIGN_IN"); }
  private async source(actor: Actor, shortId: string) { this.actor(actor); uuid.parse(shortId); await this.paidAccess(actor.userId); return this.store.source(actor.userId, shortId); }
  async list(actor: Actor, shortId?: string) {
    this.actor(actor); if (shortId) await this.source(actor, shortId);
    return { connections: await this.store.list(actor.userId), oauthReady: this.config.oauthReady, mediaReady: this.config.mediaVerified, retryAfterSeconds: await this.store.retryAfter(actor.userId) };
  }
  async start(actor: Actor, raw: unknown) {
    this.actor(actor);
    if (!this.config.oauthReady) throw new HttpError(503, "Register the HTTPS callback and configure the TikTok Sandbox credentials.", "TIKTOK_SETUP_REQUIRED");
    const input = startInput.parse(raw);
    if (input.shortId) await this.source(actor, input.shortId);
    const state = `tt_${secret()}`;
    await this.store.start(actor, input, state);
    return this.api.authorization(state);
  }
  async callback(actor: Actor, query: URLSearchParams) {
    this.actor(actor);
    const state = query.get("state") || "";
    if (!/^tt_[a-zA-Z0-9_-]{43}$/.test(state)) throw new HttpError(400, "Invalid connection request.", "TIKTOK_STATE_EXPIRED");
    const pending = await this.store.consume(actor, state), path = returnPath.parse(pending.returnPath);
    if (query.has("error")) return { returnPath: path, outcome: "cancelled" };
    let tokens: Tokens | undefined;
    try {
      const code = query.get("code");
      if (!code || code.length > 4096) throw new Error("Invalid authorization code");
      if (pending.shortId) await this.source(actor, pending.shortId);
      tokens = await this.api.exchange(code);
      if (scopes.some(scope => !tokens!.scopes.includes(scope))) throw new Error("Partial permission grant");
      const creator = await this.api.creator(tokens.accessToken, "pending");
      await this.store.finish(pending, { openId: tokens.openId, nickname: creator.nickname, username: creator.username, ciphertext: this.vault.seal(JSON.stringify(tokens), actor.userId, `connection:${tokens.openId}`) });
      return { returnPath: path, outcome: "connected" };
    } catch {
      const revoked = !tokens || await this.api.revoke(tokens.accessToken);
      return { returnPath: path, outcome: revoked ? "failed" : "revoke_required" };
    }
  }
  private async access<T>(actor: Actor, connectionId: string, fn: (tx: TransactionSql, link: Link, token: string) => Promise<T>): Promise<T> {
    this.actor(actor); uuid.parse(connectionId);
    // Commit rotated tokens even when a subsequent provider request fails.
    const result = await this.store.locked(actor.userId, connectionId, async (tx, link) => {
      try {
        if (link.status !== "active") throw new HttpError(409, "Reconnect this TikTok account.", "TIKTOK_RECONNECT_REQUIRED");
        let tokens = JSON.parse(this.vault.open(link.tokenCiphertext, actor.userId, `connection:${link.openId}`)) as Tokens;
        if (tokens.openId !== link.openId || tokens.refreshExpiresAt <= Date.now() || scopes.some(scope => !tokens.scopes.includes(scope))) throw new HttpError(409, "Reconnect this TikTok account.", "TIKTOK_RECONNECT_REQUIRED");
        if (tokens.accessExpiresAt <= Date.now()+60_000) {
          const refreshed = await this.api.refresh(tokens.refreshToken);
          if (refreshed.openId !== link.openId || scopes.some(scope => !refreshed.scopes.includes(scope))) {
            await this.api.revoke(refreshed.accessToken);
            throw new HttpError(409, "Reconnect this TikTok account.", "TIKTOK_RECONNECT_REQUIRED");
          }
          tokens = refreshed;
          await tx`update shorts_mvp.tiktok_connections set token_ciphertext=${this.vault.seal(JSON.stringify(tokens), actor.userId, `connection:${link.openId}`)},updated_at=now() where id=${link.id}`;
        }
        return { value: await fn(tx, link, tokens.accessToken) };
      } catch (error) {
        if (error instanceof HttpError && ["TIKTOK_RECONNECT_REQUIRED", "TIKTOK_INVALID_GRANT", "TIKTOK_ACCESS_TOKEN_INVALID", "TIKTOK_SCOPE_NOT_AUTHORIZED", "TIKTOK_AUTH_REMOVED"].includes(error.code)) {
          await tx`update shorts_mvp.tiktok_connections set status='reconnect_required' where id=${link.id}`;
        }
        return { error };
      }
    });
    if ("error" in result) throw result.error;
    return result.value;
  }
  async creator(actor: Actor, connectionId: string, shortId: string) {
    const source = await this.source(actor, shortId), media = await this.media.inspect(source.outputS3Key);
    const creator = await this.access(actor, connectionId, (_tx, _link, token) => this.api.creator(token, connectionId));
    return { creator, durationSeconds: media.duration, auditApproved: false, mediaReady: this.config.mediaVerified };
  }
  async preview(actor: Actor, shortId: string) { return this.media.file((await this.source(actor, shortId)).outputS3Key); }
  async listPosts(actor: Actor, shortId: string) { await this.source(actor, shortId); return (await this.store.posts(actor.userId, shortId)).map(row => this.store.view(row)); }
  async create(actor: Actor, raw: unknown) {
    const input = postInput.parse(raw);
    const source = await this.source(actor, input.shortId);
    if (!this.config.mediaVerified) throw new HttpError(503, "Verify the media URL domain in TikTok before uploading.", "TIKTOK_MEDIA_SETUP_REQUIRED");
    const media = await this.media.inspect(source.outputS3Key), id = randomUUID(), capability = secret();
    const inserted = await this.access(actor, input.connectionId, async (tx, link, token) => {
      const live = await this.store.source(actor.userId, input.shortId, tx);
      if (live.renderVersion !== source.renderVersion || live.outputS3Key !== source.outputS3Key) throw new HttpError(409, "The finished video changed.", "TIKTOK_SOURCE_CHANGED");
      const creator = await this.api.creator(token, input.connectionId);
      const issues = validateTikTokIntent(input, creator, { nowMs: Date.now(), durationSeconds: media.duration, auditApproved: false });
      if (issues.length) throw new HttpError(400, "Review the audience, permissions and consent before uploading.", "TIKTOK_INVALID_POST");
      const pending = await tx`select id from shorts_mvp.tiktok_posts where user_id=${actor.userId} and status in ('initiating','processing') and created_at>now()-interval '90 minutes'
        and not(short_id=${input.shortId} and render_version=${source.renderVersion} and connection_id=${input.connectionId})`;
      if (pending.length) throw new HttpError(409, "Wait for the current TikTok upload to finish.", "TIKTOK_POST_BUSY");
      const rows = await tx`insert into shorts_mvp.tiktok_posts(id,user_id,connection_id,connection_version,short_id,render_version,title,privacy,consent_ciphertext,source_key,source_hash,media_hash,status)
        values(${id},${actor.userId},${input.connectionId},${link.version},${input.shortId},${source.renderVersion},${input.title},${input.privacy},${this.vault.seal(JSON.stringify({ input, creator, durationSeconds: media.duration, confirmedAt: new Date().toISOString() }), actor.userId, `consent:${id}`)},${source.outputS3Key},${media.hash},${hash(capability)},'initiating')
        on conflict(user_id,short_id,render_version,connection_id) do update set
          id=excluded.id,connection_version=excluded.connection_version,title=excluded.title,
          consent_ciphertext=excluded.consent_ciphertext,source_key=excluded.source_key,source_hash=excluded.source_hash,
          media_hash=excluded.media_hash,media_expires_at=excluded.media_expires_at,
          status='initiating',error_code=null,created_at=excluded.created_at,checked_at=null
        where shorts_mvp.tiktok_posts.status='failed' and shorts_mvp.tiktok_posts.publish_id is null
          and shorts_mvp.tiktok_posts.error_code='TIKTOK_UNAUDITED_CLIENT_CAN_ONLY_POST_TO_PRIVATE_ACCOUNTS'
        returning id`;
      if (rows.length) return { id, fresh: true };
      const existing = (await tx`select id from shorts_mvp.tiktok_posts where user_id=${actor.userId} and short_id=${input.shortId} and render_version=${source.renderVersion} and connection_id=${input.connectionId}`)[0];
      return { id: String(existing.id), fresh: false };
    });
    // An init response can be lost after TikTok accepted the video. Only the
    // first insertion calls init, except for a new user submission after TikTok
    // explicitly rejected a public account before accepting the post. That
    // replacement renews consent and media access; uncertain/accepted results
    // remain deduplicated. Refresh and status polling never call init.
    if (!inserted.fresh) return this.store.view(await this.store.post(actor.userId, inserted.id));
    try {
      await this.access(actor, input.connectionId, async (tx, link, token) => {
        const post = await this.store.post(actor.userId, id, tx);
        const live = await this.store.source(actor.userId, input.shortId, tx);
        if (post.connectionVersion !== link.version || live.renderVersion !== post.renderVersion || live.outputS3Key !== post.sourceKey || media.hash !== await this.media.fingerprint((await this.media.file(post.sourceKey)).file)) throw new HttpError(409, "The account or video changed before upload.", "TIKTOK_SOURCE_CHANGED");
        const videoUrl = `${this.config.publicOrigin}/api/social/tiktok/media/${capability}`;
        const publishId = await this.api.init(token, input, videoUrl);
        await tx`update shorts_mvp.tiktok_posts set publish_id=${publishId},status='processing',checked_at=now() where id=${id} and user_id=${actor.userId}`;
      });
    } catch (error) {
      const ambiguous = !(error instanceof HttpError) || error instanceof TikTokApiError && error.ambiguous;
      await this.store.db`update shorts_mvp.tiktok_posts set status=${ambiguous ? "unknown" : "failed"},error_code=${error instanceof HttpError ? error.code : "TIKTOK_RESULT_UNKNOWN"},media_hash=case when ${ambiguous} then media_hash else null end where id=${id} and user_id=${actor.userId} and status='initiating'`;
    }
    return this.store.view(await this.store.post(actor.userId, id));
  }
  async check(actor: Actor, id: string) {
    this.actor(actor); uuid.parse(id);
    const post = await this.store.post(actor.userId, id);
    await this.source(actor, post.shortId);
    if (!post.publishId || ["complete", "failed"].includes(post.status)) return this.store.view(post);
    return this.access(actor, post.connectionId, async (tx, _link, token) => {
      const current = await this.store.post(actor.userId, id, tx);
      if (!current.publishId || current.checkedAt && new Date(current.checkedAt).getTime() > Date.now()-5000) return this.store.view(current);
      const state = await this.api.status(token, current.publishId);
      const rows = await tx`update shorts_mvp.tiktok_posts set status=${state.status},error_code=${state.errorCode},checked_at=now(),media_hash=case when ${state.status} in ('complete','failed') then null else media_hash end where id=${id} and user_id=${actor.userId} returning *`;
      return this.store.view(rows[0] as PostRow);
    });
  }
  async publicMedia(capability: string) {
    if (!/^[a-zA-Z0-9_-]{43}$/.test(capability) || !this.config.mediaVerified) throw new HttpError(404, "Media unavailable.");
    const rows = await this.store.db`select p.* from shorts_mvp.tiktok_posts p join shorts_mvp.tiktok_connections c on c.id=p.connection_id
      join shorts_mvp.app_users u on u.id=p.user_id
      where p.media_hash=${hash(capability)} and p.media_expires_at>now() and p.status in ('initiating','processing','unknown')
        and c.user_id=p.user_id and c.app_key=${this.config.clientKey} and c.status='active' and c.version=p.connection_version and u.withdrawn_at is null`;
    if (!rows[0]) throw new HttpError(404, "Media unavailable.");
    const post = rows[0] as PostRow;
    await this.paidAccess(post.userId);
    const live = await this.store.source(post.userId, post.shortId);
    if (live.renderVersion !== post.renderVersion || live.outputS3Key !== post.sourceKey) throw new HttpError(404, "Media unavailable.");
    const media = await this.media.file(post.sourceKey);
    if (await this.media.fingerprint(media.file) !== post.sourceHash) throw new HttpError(404, "Media unavailable.");
    return media;
  }
  async revokeRemoved(userId: string, links: Link[]) {
    const results = await Promise.all(links.map(async link => {
      try { const token = JSON.parse(this.vault.open(link.tokenCiphertext, userId, `connection:${link.openId}`)) as Tokens; return await this.api.revoke(token.accessToken); } catch { return false; }
    }));
    return results.every(Boolean) ? "revoked" : "manual_required";
  }
  async disconnect(actor: Actor, id: string) {
    this.actor(actor); uuid.parse(id);
    const link = await this.store.disconnect(actor.userId, id);
    return { deleted: true, revocation: await this.revokeRemoved(actor.userId, [link]), retryAfterSeconds: await this.store.retryAfter(actor.userId) };
  }
}
