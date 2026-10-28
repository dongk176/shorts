import "server-only";
import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { HttpError } from "@/lib/http";
import { postInput, returnPath, startInput, uuid, type Actor, type Tokens } from "./contracts";
import { MetaApi, MetaApiError } from "./api";
import type { MetaConfig } from "./config";
import type { TikTokMediaAccess } from "../tiktok/media";
import { MetaStore, type Link, type PostRow } from "./store";
import { hash, secret, MetaVault } from "./vault";
import { metaReviewerGrant } from "./reviewer-access";

export class MetaPublishing {
  constructor(readonly store: MetaStore, private vault: MetaVault, private api: MetaApi, private media: TikTokMediaAccess, private config: MetaConfig, private accountAccess: (id: string) => Promise<void>, private publishAccess: (id: string) => Promise<void> = accountAccess) {}
  private async actor(actor: Actor) {
    uuid.parse(actor.userId);
    if (!actor.sessionId) throw new HttpError(401, "Please sign in.", "META_SIGN_IN");
    await this.accountAccess(actor.userId);
  }
  private async source(actor: Actor, shortId: string) { await this.actor(actor); uuid.parse(shortId); return this.store.source(actor.userId, shortId); }
  private async channelActor(actor: Actor) {
    await this.actor(actor);
    if (this.config.platform !== "instagram") throw new HttpError(400, "Choose a finished video.", "META_INVALID_POST");
  }
  async list(actor: Actor, shortId: string) {
    if (shortId) await this.source(actor, shortId);
    else await this.channelActor(actor);
    return { connections: await this.store.list(actor.userId), oauthReady: this.config.oauthReady, retryAfterSeconds: await this.store.retryAfter(actor.userId) };
  }
  async start(actor: Actor, raw: unknown) {
    const input = startInput.parse(raw);
    if (input.shortId) await this.source(actor, input.shortId);
    else await this.channelActor(actor);
    if (!this.config.oauthReady) throw new HttpError(503, "The connection is not configured.", "META_SETUP_REQUIRED");
    const state = `${this.config.platform}_${secret()}`;
    await this.store.start(actor, input, state);
    return this.api.authorization(state);
  }
  async callback(actor: Actor, query: URLSearchParams) {
    await this.actor(actor);
    const state = query.get("state") || "";
    if (!new RegExp(`^${this.config.platform}_[A-Za-z0-9_-]{43}$`).test(state)) throw new HttpError(400, "The connection expired.", "META_STATE_EXPIRED");
    const pending = await this.store.consume(actor, state), path = returnPath.parse(pending.returnPath);
    if (query.has("error")) return { returnPath: path, outcome: "cancelled" };
    let tokens: Tokens | undefined;
    try {
      const code = query.get("code");
      if (!code || code.length > 4096) throw new Error("Invalid code");
      if (pending.shortId) await this.source(actor, pending.shortId);
      else await this.channelActor(actor);
      tokens = await this.api.exchange(code);
      const profile = await this.api.profile(tokens.accessToken);
      // Instagram's OAuth ID and profile ID may belong to different ID namespaces.
      // The profile obtained with this grant is the authoritative publishing ID.
      tokens.openId = profile.openId;
      await this.store.finish(pending, { ...profile, ciphertext: this.vault.seal(JSON.stringify(tokens), actor.userId, `connection:${profile.openId}`) });
      return { returnPath: path, outcome: "connected" };
    } catch (error) {
      console.warn(JSON.stringify({ event: "meta_oauth_callback_failed", platform: this.config.platform,
        code: error instanceof HttpError ? error.code : "META_UNAVAILABLE",
        ...(error instanceof MetaApiError && error.diagnostic ? { diagnostic: error.diagnostic } : {}),
      }));
      if (tokens) await this.api.revoke(tokens.accessToken);
      return { returnPath: path, outcome: error instanceof HttpError ? error.code : "failed" };
    }
  }
  private async access<T>(actor: Actor, id: string, fn: (tx: TransactionSql, link: Link, token: string) => Promise<T>): Promise<T> {
    await this.actor(actor); uuid.parse(id);
    const result = await this.store.locked(actor.userId, id, async (tx, link) => {
      try {
        if (link.status !== "active") throw new HttpError(409, "Reconnect this account.", "META_RECONNECT_REQUIRED");
        let tokens = JSON.parse(this.vault.open(link.tokenCiphertext, actor.userId, `connection:${link.openId}`)) as Tokens;
        if (tokens.openId !== link.openId || tokens.expiresAt <= Date.now() || this.config.scopes.some(scope => !tokens.scopes.includes(scope))) throw new HttpError(409, "Reconnect this account.", "META_RECONNECT_REQUIRED");
        if (tokens.expiresAt < Date.now() + 7 * 86400_000) {
          tokens = await this.api.refresh(tokens);
          await tx`update shorts_mvp.meta_connections set token_ciphertext=${this.vault.seal(JSON.stringify(tokens), actor.userId, `connection:${link.openId}`)},updated_at=now() where id=${id}`;
        }
        return { value: await fn(tx, link, tokens.accessToken) };
      } catch (error) {
        if (error instanceof HttpError && ["META_RECONNECT_REQUIRED", "META_PERMISSION_REQUIRED"].includes(error.code)) await tx`update shorts_mvp.meta_connections set status='reconnect_required' where id=${id}`;
        return { error };
      }
    });
    if ("error" in result) throw result.error;
    return result.value;
  }
  async preview(actor: Actor, shortId: string) { return this.media.file((await this.source(actor, shortId)).outputS3Key); }
  async listPosts(actor: Actor, shortId: string) { await this.source(actor, shortId); return (await this.store.posts(actor.userId, shortId)).map(row => this.store.view(row)); }
  async create(actor: Actor, raw: unknown) {
    const input = postInput.parse(raw), source = await this.source(actor, input.shortId);
    if (this.config.platform === "threads" && [...input.title].length > 500) throw new HttpError(400, "The caption is too long.", "META_CAPTION_TOO_LONG");
    await this.publishAccess(actor.userId);
    const media = await this.media.inspect(source.outputS3Key), id = randomUUID(), capability = secret();
    if (media.duration < 3 || media.duration > (this.config.platform === "threads" ? 300 : 900)) throw new HttpError(400, "Unsupported video duration.", "META_VIDEO_DURATION");
    const inserted = await this.access(actor, input.connectionId, async (tx, link, token) => {
      const current = await this.store.source(actor.userId, input.shortId, tx);
      if (source.outputS3Key !== current.outputS3Key || source.renderVersion !== current.renderVersion) throw new HttpError(409, "The video changed.", "META_SOURCE_CHANGED");
      const profile = await this.api.profile(token);
      if (profile.openId !== link.openId) throw new HttpError(409, "The connected account changed.", "META_RECONNECT_REQUIRED");
      if (this.config.platform === "threads") {
        const granted = await this.api.permissions(token);
        if (this.config.scopes.some(scope => !granted.includes(scope))) throw new HttpError(403, "Allow the publishing permission.", "META_PERMISSION_REQUIRED");
      }
      // Instagram grants are checked from the OAuth response and the encrypted
      // token. Its publishing endpoint authoritatively enforces live permissions.
      const rows = await tx`insert into shorts_mvp.meta_posts(id,user_id,connection_id,connection_version,short_id,render_version,title,privacy,consent_ciphertext,source_key,source_hash,media_hash,status)
        values(${id},${actor.userId},${input.connectionId},${link.version},${input.shortId},${source.renderVersion},${input.title},'PROFILE',${this.vault.seal(JSON.stringify({ input, profile, confirmedAt: new Date().toISOString() }), actor.userId, `consent:${id}`)},${source.outputS3Key},${media.hash},${hash(capability)},'initiating')
        on conflict(user_id,short_id,render_version,connection_id) where status<>'failed' do nothing returning id`;
      if (rows.length) return { id, fresh: true };
      const existing = (await tx`select id from shorts_mvp.meta_posts where user_id=${actor.userId} and short_id=${input.shortId} and render_version=${source.renderVersion} and connection_id=${input.connectionId} and status<>'failed'`)[0];
      return { id: String(existing.id), fresh: false };
    });
    if (inserted.fresh) {
      try {
        await this.access(actor, input.connectionId, async (tx, link, token) => {
          const post = await this.store.post(actor.userId, id, tx);
          await this.validateSource(actor, post, link, tx);
          const containerId = await this.api.container(token, link.openId, input.title, `${this.config.origin}/api/social/${this.config.platform}/media/${capability}`);
          await tx`update shorts_mvp.meta_posts set container_id=${containerId},status='processing',checked_at=null where id=${id}`;
        });
      } catch (error) { await this.failure(actor, id, error); }
    }
    return this.store.view(await this.store.post(actor.userId, inserted.id));
  }
  private async validateSource(actor: Actor, post: PostRow, link: Link, tx: TransactionSql) {
    const live = await this.store.source(actor.userId, post.shortId, tx);
    if (link.version !== post.connectionVersion || live.renderVersion !== post.renderVersion || live.outputS3Key !== post.sourceKey || post.sourceHash !== await this.media.fingerprint((await this.media.file(post.sourceKey)).file)) throw new HttpError(409, "The account or video changed.", "META_SOURCE_CHANGED");
  }
  private async failure(actor: Actor, id: string, error: unknown) {
    const ambiguous = !(error instanceof HttpError) || error instanceof MetaApiError && error.ambiguous;
    await this.store.db`update shorts_mvp.meta_posts set status=${ambiguous ? "unknown" : "failed"},error_code=${error instanceof HttpError ? error.code : "META_RESULT_UNKNOWN"},media_hash=case when ${ambiguous} then media_hash else null end where id=${id} and user_id=${actor.userId} and status<>'complete'`;
  }
  async check(actor: Actor, id: string) {
    await this.actor(actor); uuid.parse(id);
    const post = await this.store.post(actor.userId, id);
    await this.source(actor, post.shortId);
    if (!post.containerId || ["complete", "failed"].includes(post.status)) return this.store.view(post);
    const publish = await this.access(actor, post.connectionId, async (tx, link, token) => {
      const row = await this.store.post(actor.userId, id, tx);
      if (!row.containerId || ["complete", "failed"].includes(row.status) || row.checkedAt && new Date(row.checkedAt).getTime() > Date.now()-10_000) return false;
      await this.validateSource(actor, row, link, tx);
      const state = await this.api.status(token, row.containerId);
      if (state === "PUBLISHED") {
        await tx`update shorts_mvp.meta_posts set status='complete',error_code=null,media_hash=null,checked_at=now() where id=${id}`;
        return false;
      }
      if (["ERROR", "EXPIRED"].includes(state)) {
        await tx`update shorts_mvp.meta_posts set status='failed',error_code='META_PROCESSING_FAILED',media_hash=null,checked_at=now() where id=${id}`;
        return false;
      }
      await tx`update shorts_mvp.meta_posts set checked_at=now() where id=${id}`;
      if (state !== "FINISHED" || row.publishAttemptedAt) return false;
      // Commit the attempt before contacting Meta: a lost response must never
      // trigger a second publish. Later checks only inspect this container.
      await tx`update shorts_mvp.meta_posts set publish_attempted_at=now() where id=${id}`;
      return true;
    });
    if (publish) {
      try {
        await this.access(actor, post.connectionId, async (tx, link, token) => {
          const row = await this.store.post(actor.userId, id, tx);
          await this.validateSource(actor, row, link, tx);
          const publishId = await this.api.publish(token, link.openId, row.containerId!);
          await tx`update shorts_mvp.meta_posts set publish_id=${publishId},status='complete',error_code=null,media_hash=null,checked_at=now() where id=${id}`;
        });
      } catch (error) { await this.failure(actor, id, error); }
    }
    const completed = await this.store.post(actor.userId, id);
    if (completed.status === "complete" && completed.publishId && !completed.postUrl) {
      try {
        await this.access(actor, post.connectionId, async (tx, _link, token) => {
          const url = await this.api.permalink(token, completed.publishId!);
          await tx`update shorts_mvp.meta_posts set post_url=${url} where id=${id}`;
        });
      } catch { /* Persisted publication remains successful when link lookup fails. */ }
    }
    return this.store.view(await this.store.post(actor.userId, id));
  }
  async publicMedia(capability: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(capability)) throw new HttpError(404, "Media unavailable.");
    const grant = metaReviewerGrant();
    const rows = await this.store.db`select p.* from shorts_mvp.meta_posts p join shorts_mvp.meta_connections c on c.id=p.connection_id
      join shorts_mvp.app_users u on u.id=p.user_id where p.media_hash=${hash(capability)} and p.media_expires_at>now()
        and p.status in ('initiating','processing','unknown') and c.app_key=${this.config.appKey} and c.user_id=p.user_id
        and c.status='active' and c.version=p.connection_version and u.withdrawn_at is null
        and (${this.store.publicEnabled} or u.is_admin=true or (u.id=${grant?.userId ?? null} and p.short_id=${grant?.shortId ?? null}
          and clock_timestamp()<${grant?.expiresAt ?? null}::timestamptz))`;
    if (!rows[0]) throw new HttpError(404, "Media unavailable.");
    const post = rows[0] as PostRow;
    await this.accountAccess(post.userId);
    const source = await this.store.source(post.userId, post.shortId);
    if (source.renderVersion !== post.renderVersion || source.outputS3Key !== post.sourceKey || post.sourceHash !== await this.media.fingerprint((await this.media.file(post.sourceKey)).file)) throw new HttpError(404, "Media unavailable.");
    return this.media.file(post.sourceKey);
  }
  async disconnect(actor: Actor, id: string) {
    await this.actor(actor); uuid.parse(id);
    const link = await this.store.disconnect(actor.userId, id);
    let revoked = false;
    try { const tokens = JSON.parse(this.vault.open(link.tokenCiphertext, actor.userId, `connection:${link.openId}`)) as Tokens; revoked = await this.api.revoke(tokens.accessToken); } catch { /* Local deletion already invalidated all capabilities. */ }
    return { deleted: true, revocation: revoked ? "revoked" : "manual_required", retryAfterSeconds: await this.store.retryAfter(actor.userId) };
  }
}
