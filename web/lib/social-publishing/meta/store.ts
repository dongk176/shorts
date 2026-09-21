import "server-only";
import type { Sql, TransactionSql } from "postgres";
import { HttpError } from "@/lib/http";
import { localePath } from "@/lib/i18n/routing";
import { hash } from "./vault";
import { uuid, type Actor, type Connection, type Post } from "./contracts";

type Db = Sql | TransactionSql;
export type Pending = { userId: string; returnPath: string; shortId: string | null; epoch: number };
export type Link = { id: string; userId: string; openId: string; nickname: string; username: string; tokenCiphertext: string; status: string; version: number };
export type PostRow = { id: string; userId: string; connectionId: string; connectionVersion: number; shortId: string; renderVersion: number; title: string; privacy: string; containerId: string | null; publishAttemptedAt: Date | null; postUrl: string | null; sourceKey: string; sourceHash: string; publishId: string | null; status: Post["status"]; errorCode: string | null; createdAt: Date; checkedAt: Date | null };
const missing = () => new HttpError(404, "The connected account or finished video is unavailable.", "META_NOT_FOUND");

export class MetaStore {
  constructor(readonly db: Sql, readonly appKey: string) {}
  async source(userId: string, shortId: string, db: Db = this.db) {
    const rows = await db`select s.id,j.project_number,s.output_s3_key,s.render_version
      from shorts_mvp.generated_shorts s join shorts_mvp.video_jobs j on j.id=s.job_id
      where s.id=${shortId} and s.user_id=${userId} and j.user_id=${userId}
        and j.is_example=false and j.status<>'deleted' and j.user_deleted_at is null
        and s.status='ready' and s.deleted_at is null and s.output_s3_key is not null
        and (s.expires_at is null or s.expires_at>now())
        and exists(select 1 from shorts_mvp.app_users u where u.id=${userId} and u.withdrawn_at is null)
      for share of s,j`;
    if (!rows[0]) throw missing();
    return { id: String(rows[0].id), projectNumber: Number(rows[0].projectNumber), outputS3Key: String(rows[0].outputS3Key), renderVersion: Number(rows[0].renderVersion) };
  }
  async owner(tx: Db, userId: string) {
    uuid.parse(userId);
    if (!(await tx`select id from shorts_mvp.app_users where id=${userId} and is_admin=true and withdrawn_at is null for update`).length) throw missing();
    await tx`insert into shorts_mvp.meta_owners(user_id) values(${userId}) on conflict do nothing`;
    return (await tx`select epoch,greatest(0,ceil(extract(epoch from disconnect_until-now())))::int as retry_after from shorts_mvp.meta_owners where user_id=${userId} for update`)[0];
  }
  async list(userId: string): Promise<Connection[]> {
    const rows = await this.db`select id,nickname,username,status from shorts_mvp.meta_connections where user_id=${userId} and app_key=${this.appKey}
      and exists(select 1 from shorts_mvp.app_users where id=${userId} and withdrawn_at is null) order by updated_at desc`;
    return rows as unknown as Connection[];
  }
  async retryAfter(userId: string) {
    const rows = await this.db`select greatest(0,ceil(extract(epoch from disconnect_until-now())))::int as retry_after from shorts_mvp.meta_owners where user_id=${userId}`;
    return Number(rows[0]?.retryAfter || 0);
  }
  async link(tx: Db, userId: string, id: string): Promise<Link> {
    const rows = await tx`select * from shorts_mvp.meta_connections where id=${id} and user_id=${userId} and app_key=${this.appKey} for update`;
    if (!rows[0]) throw missing();
    return rows[0] as Link;
  }
  async locked<T>(userId: string, id: string, fn: (tx: TransactionSql, link: Link) => Promise<T>): Promise<T> {
    return this.db.begin(async tx => {
      // Bounded provider requests may be made while fencing disconnect/withdrawal.
      await tx`set local idle_in_transaction_session_timeout='60s'`;
      await this.owner(tx, userId);
      return fn(tx, await this.link(tx, userId, id));
    }) as Promise<T>;
  }
  async start(actor: Actor, input: { returnPath: string; shortId?: string }, state: string) {
    await this.db.begin(async tx => {
      const owner = await this.owner(tx, actor.userId);
      if (owner.retryAfter > 0) throw new HttpError(409, "Please wait before reconnecting.", "META_RECONNECT_WAIT", Number(owner.retryAfter));
      const path = localePath(input.returnPath).pathname;
      if (input.shortId) {
        const source = await this.source(actor.userId, input.shortId, tx);
        if (path !== `/projects/${source.projectNumber}`) throw missing();
      } else if (!["/settings", "/publish/channels"].includes(path)) throw missing();
      const epoch = Number(owner.epoch) + 1;
      await tx`update shorts_mvp.meta_owners set epoch=${epoch} where user_id=${actor.userId}`;
      await tx`delete from shorts_mvp.meta_oauth where (user_id=${actor.userId} and app_key=${this.appKey}) or expires_at<=now()`;
      await tx`insert into shorts_mvp.meta_oauth(state_hash,user_id,app_key,session_hash,return_path,short_id,epoch)
        values(${hash(state)},${actor.userId},${this.appKey},${hash(actor.sessionId)},${input.returnPath},${input.shortId || null},${epoch})`;
    });
  }
  async consume(actor: Actor, state: string): Promise<Pending> {
    const rows = await this.db`delete from shorts_mvp.meta_oauth s using shorts_mvp.meta_owners o
      where s.state_hash=${hash(state)} and s.user_id=${actor.userId} and s.app_key=${this.appKey} and s.session_hash=${hash(actor.sessionId)}
        and s.expires_at>now() and o.user_id=s.user_id and o.epoch=s.epoch
      returning s.user_id,s.return_path,s.short_id,s.epoch`;
    if (!rows[0]) throw new HttpError(400, "This connection request expired. Please connect again.", "META_STATE_EXPIRED");
    return rows[0] as Pending;
  }
  async finish(pending: Pending, data: { openId: string; nickname: string; username: string; ciphertext: string }) {
    await this.db.begin(async tx => {
      const owner = await this.owner(tx, pending.userId);
      if (Number(owner.epoch) !== pending.epoch || owner.retryAfter > 0) throw new HttpError(409, "The connection request changed.", "META_STATE_EXPIRED");
      if (pending.shortId) await this.source(pending.userId, pending.shortId, tx);
      // A provider grant belongs to one EasyCut user. Reconnecting never silently
      // reassigns another user's grant, whose revocation would affect both users.
      const saved = await tx`insert into shorts_mvp.meta_connections(user_id,app_key,open_id,nickname,username,token_ciphertext)
        values(${pending.userId},${this.appKey},${data.openId},${data.nickname},${data.username},${data.ciphertext})
        on conflict(app_key,open_id) do update set nickname=excluded.nickname,username=excluded.username,token_ciphertext=excluded.token_ciphertext,status='active',version=shorts_mvp.meta_connections.version+1,updated_at=now()
        where shorts_mvp.meta_connections.user_id=excluded.user_id returning id`;
      if (!saved.length) throw new HttpError(409, "This Meta account is connected to another EasyCut account.", "META_ALREADY_LINKED");
    });
  }
  async disconnect(userId: string, id: string) {
    return this.db.begin(async tx => {
      await this.owner(tx, userId);
      const link = await this.link(tx, userId, id);
      await tx`update shorts_mvp.meta_owners set epoch=epoch+1,disconnect_until=now()+interval '1 minute' where user_id=${userId}`;
      await tx`delete from shorts_mvp.meta_oauth where user_id=${userId} and app_key=${this.appKey}`;
      await tx`delete from shorts_mvp.meta_connections where user_id=${userId} and id=${id} and app_key=${this.appKey}`;
      return link;
    });
  }
  async removeForWithdrawal(tx: TransactionSql, userId: string): Promise<Link[]> {
    await this.owner(tx, userId);
    await tx`update shorts_mvp.meta_owners set epoch=epoch+1 where user_id=${userId}`;
    await tx`delete from shorts_mvp.meta_oauth where user_id=${userId}`;
    return await tx`delete from shorts_mvp.meta_connections where user_id=${userId} returning *` as unknown as Link[];
  }
  async deauthorized(subject: string, issuedAt: number, receiptHash: string) {
    await this.db.begin(async tx => {
      await tx`delete from shorts_mvp.meta_callback_receipts where created_at<now()-interval '90 days'`;
      const receipt = await tx`insert into shorts_mvp.meta_callback_receipts(request_hash) values(${receiptHash}) on conflict do nothing returning request_hash`;
      if (!receipt.length) return;
      const links = await tx`select user_id from shorts_mvp.meta_connections where app_key=${this.appKey} and open_id=${subject} and updated_at<to_timestamp(${issuedAt + 1})`;
      for (const link of links) {
        await tx`select id from shorts_mvp.app_users where id=${link.userId} for update`;
        await tx`update shorts_mvp.meta_owners set epoch=epoch+1 where user_id=${link.userId}`;
        await tx`delete from shorts_mvp.meta_oauth where user_id=${link.userId} and app_key=${this.appKey}`;
        await tx`delete from shorts_mvp.meta_connections where user_id=${link.userId} and app_key=${this.appKey} and open_id=${subject} and updated_at<to_timestamp(${issuedAt + 1})`;
      }
    });
  }
  async posts(userId: string, shortId: string) {
    return await this.db`select p.* from shorts_mvp.meta_posts p join shorts_mvp.meta_connections c on c.id=p.connection_id
      where p.user_id=${userId} and p.short_id=${shortId} and c.app_key=${this.appKey} order by p.created_at desc` as unknown as PostRow[];
  }
  async hasDeletionReceipt(receiptHash: string) {
    const rows = await this.db`select request_hash from shorts_mvp.meta_callback_receipts
      where request_hash=${receiptHash} and created_at>=now()-interval '90 days'`;
    return rows.length > 0;
  }
  async post(userId: string, id: string, db: Db = this.db): Promise<PostRow> {
    const rows = await db`select p.* from shorts_mvp.meta_posts p join shorts_mvp.meta_connections c on c.id=p.connection_id
      where p.id=${id} and p.user_id=${userId} and c.app_key=${this.appKey}`;
    if (!rows[0]) throw missing();
    return rows[0] as PostRow;
  }
  view(row: PostRow): Post {
    const staleInit = row.status === "initiating" && new Date(row.createdAt).getTime() < Date.now()-60_000;
    return { id: row.id, connectionId: row.connectionId, title: row.title, status: staleInit || row.status === "processing" && row.publishAttemptedAt !== null && new Date(row.publishAttemptedAt).getTime() < Date.now()-60_000 ? "unknown" : row.status, privacy: row.privacy, url: row.postUrl, errorCode: row.errorCode, createdAt: new Date(row.createdAt).toISOString() };
  }
}
