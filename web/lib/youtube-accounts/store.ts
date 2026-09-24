import "server-only";
import type { Sql, TransactionSql } from "postgres";
import { HttpError } from "@/lib/http";
import { hash } from "./crypto";
import type { Actor, Channel, Connection, Source, StartInput } from "./contracts";

type Db = Sql | TransactionSql;
export type RemovedConnections = { epoch: number; tokens: Array<{ channelId: unknown; tokenCiphertext: unknown }> };
export type Pending = { userId: string; epoch: number; verifierCiphertext: string; returnPath: string; shortId: string | null; connectionId: string | null };
const missing = () => new HttpError(404, "이 계정에서 사용할 수 있는 채널 또는 완성 영상을 찾을 수 없습니다.");

export class YoutubeAccountStore {
  constructor(private db: Sql, private sourceAccess?: (userId: string, shortId: string, db: Db) => void | Promise<void>) {}
  private async owner(tx: Db, userId: string) {
    const users = await tx`select id from shorts_mvp.app_users where id=${userId} and withdrawn_at is null for update`;
    if (!users.length) throw missing();
    await tx`insert into shorts_mvp.youtube_account_owners (user_id) values (${userId}) on conflict do nothing`;
    const rows = await tx`select epoch from shorts_mvp.youtube_account_owners where user_id=${userId} for update`;
    return Number(rows[0].epoch);
  }
  private async assertNotDisconnecting(tx: Db, userId: string) {
    const rows = await tx`select ceil(extract(epoch from disconnect_until-now()))::int as retry_after_seconds from shorts_mvp.youtube_account_owners where user_id=${userId} and disconnect_until>now()`;
    if (rows.length) {
      const seconds = Math.max(1, Number(rows[0].retryAfterSeconds));
      throw new HttpError(409, `${seconds}초 뒤 YouTube 채널을 다시 연결할 수 있습니다.`, "YOUTUBE_RECONNECT_COOLDOWN", seconds);
    }
  }
  async disconnectState(userId: string) {
    const rows = await this.db`select disconnect_status,greatest(0,ceil(extract(epoch from disconnect_until-now())))::int as retry_after_seconds from shorts_mvp.youtube_account_owners where user_id=${userId}`;
    const row = rows[0];
    if (!row) return { status: "none", retryAfterSeconds: 0 };
    const retryAfterSeconds = Number(row.retryAfterSeconds);
    return { status: row.disconnectStatus === "pending" && !retryAfterSeconds ? "manual_required" : String(row.disconnectStatus), retryAfterSeconds };
  }
  async disconnectStatus(userId: string) {
    return (await this.disconnectState(userId)).status;
  }
  async source(userId: string, shortId: string, db: Db = this.db): Promise<Source> {
    await this.sourceAccess?.(userId, shortId, db);
    const rows = await db`
      select s.id,j.project_number,s.output_s3_key,s.render_version
      from shorts_mvp.generated_shorts s join shorts_mvp.video_jobs j on j.id=s.job_id
      where s.id=${shortId} and s.user_id=${userId} and j.user_id=${userId}
        and j.is_example=false and j.status<>'deleted' and j.user_deleted_at is null
        and s.status='ready' and s.deleted_at is null and s.output_s3_key is not null
        and (s.expires_at is null or s.expires_at>now())
        and exists(select 1 from shorts_mvp.app_users u where u.id=${userId} and u.withdrawn_at is null)
      for share of s,j
    `;
    if (!rows[0]) throw missing();
    return { id: String(rows[0].id), projectNumber: Number(rows[0].projectNumber), outputS3Key: String(rows[0].outputS3Key), renderVersion: Number(rows[0].renderVersion) };
  }
  async link(userId: string, id: string, active = false, db: Db = this.db) {
    const rows = await db`select id,channel_id,channel_title,status,version,token_ciphertext from shorts_mvp.youtube_account_links where id=${id} and user_id=${userId}
      and (${active}=false or (verified_at>now()-interval '29 days' and last_used_at>now()-interval '29 days'))
      and exists(select 1 from shorts_mvp.app_users u where u.id=${userId} and u.withdrawn_at is null) for share`;
    const row = rows[0];
    if (!row || (active && row.status !== "active")) throw missing();
    return row;
  }
  async list(userId: string): Promise<Connection[]> {
    const rows = await this.db`update shorts_mvp.youtube_account_links set last_used_at=now() where user_id=${userId}
      and verified_at>now()-interval '29 days' and last_used_at>now()-interval '29 days'
      and exists(select 1 from shorts_mvp.app_users u where u.id=${userId} and u.withdrawn_at is null)
      returning id,channel_id,channel_title,status`;
    return rows.map(row => ({ id: String(row.id), channelId: String(row.channelId), channelTitle: String(row.channelTitle), status: row.status as Connection["status"] }));
  }
  async start(actor: Actor, input: StartInput, stateHash: string, verifierCiphertext: string) {
    await this.db.begin(async tx => {
      await this.sourceAccess?.(actor.userId, input.shortId || "", tx);
      const epoch = await this.owner(tx, actor.userId) + 1;
      await this.assertNotDisconnecting(tx, actor.userId);
      if (input.shortId) {
        const source = await this.source(actor.userId, input.shortId, tx);
        if (input.returnPath !== `/projects/${source.projectNumber}`) throw missing();
      } else if (!["/settings", "/publish/channels"].includes(input.returnPath)) throw missing();
      if (input.connectionId) await this.link(actor.userId, input.connectionId, false, tx);
      await tx`update shorts_mvp.youtube_account_owners set epoch=${epoch} where user_id=${actor.userId}`;
      await tx`delete from shorts_mvp.youtube_account_oauth where user_id=${actor.userId} or expires_at<=now()`;
      await tx`insert into shorts_mvp.youtube_account_oauth (state_hash,user_id,session_hash,verifier_ciphertext,return_path,short_id,connection_id,epoch)
        values (${stateHash},${actor.userId},${hash(actor.sessionId)},${verifierCiphertext},${input.returnPath},${input.shortId ?? null},${input.connectionId ?? null},${epoch})`;
    });
  }
  async consume(actor: Actor, stateHash: string): Promise<Pending> {
    const rows = await this.db`delete from shorts_mvp.youtube_account_oauth s using shorts_mvp.youtube_account_owners o
      where s.state_hash=${stateHash} and s.user_id=${actor.userId} and s.session_hash=${hash(actor.sessionId)}
        and s.expires_at>now() and o.user_id=s.user_id and o.epoch=s.epoch
      returning s.user_id,s.epoch,s.verifier_ciphertext,s.return_path,s.short_id,s.connection_id`;
    if (!rows[0]) throw new HttpError(400, "연결 요청이 만료됐거나 로그인 계정이 바뀌었습니다. 다시 연결해 주세요.");
    return rows[0] as Pending;
  }
  async finish(p: Pending, channels: Array<Channel & { ciphertext: string }>, scopes: string[]) {
    await this.db.begin(async tx => {
      if (await this.owner(tx, p.userId) !== p.epoch) throw new HttpError(409, "새 연결 요청 또는 연결 해제가 있어 이전 인증을 적용하지 않았습니다.");
      await this.assertNotDisconnecting(tx, p.userId);
      if (p.shortId) await this.source(p.userId, p.shortId, tx);
      let selected = channels;
      if (p.connectionId) {
        const target = await this.link(p.userId, p.connectionId, false, tx);
        selected = channels.filter(c => c.channelId === target.channelId);
        if (!selected.length) throw new HttpError(400, "재연결할 때는 기존과 같은 YouTube 채널을 선택해 주세요.");
      }
      for (const c of selected) {
        await tx`insert into shorts_mvp.youtube_account_links (user_id,channel_id,channel_title,token_ciphertext,scopes,status)
          values (${p.userId},${c.channelId},${c.channelTitle},${c.ciphertext},${scopes},'active')
          on conflict (user_id,channel_id) do update set channel_title=excluded.channel_title,token_ciphertext=excluded.token_ciphertext,
            scopes=excluded.scopes,status='active',version=shorts_mvp.youtube_account_links.version+1,updated_at=now(),verified_at=now(),last_used_at=now(),next_check_at=now()+interval '1 day'`;
      }
      await tx`update shorts_mvp.youtube_account_owners set disconnect_status='none',disconnect_until=null where user_id=${p.userId}`;
    });
  }
  async removeForWithdrawal(tx: TransactionSql, userId: string): Promise<RemovedConnections> {
    const epoch = await this.owner(tx, userId) + 1;
    return this.erase(tx, userId, epoch);
  }
  private async erase(tx: Db, userId: string, epoch: number): Promise<RemovedConnections> {
    const tokens = await tx`select channel_id,token_ciphertext from shorts_mvp.youtube_account_links where user_id=${userId}`;
    await tx`update shorts_mvp.youtube_account_owners set epoch=${epoch},disconnect_status='pending',disconnect_until=now()+interval '1 minute' where user_id=${userId}`;
    await tx`delete from shorts_mvp.youtube_account_oauth where user_id=${userId}`;
    await tx`delete from shorts_mvp.youtube_account_uploads where user_id=${userId}`;
    await tx`delete from shorts_mvp.youtube_account_links where user_id=${userId}`;
    return { epoch, tokens: tokens as unknown as RemovedConnections['tokens'] };
  }
  async expire(userId: string, id: string, version: number, expectedEpoch: number) {
    return this.db.begin(async tx => {
      const user = await tx`select id from shorts_mvp.app_users where id=${userId} and withdrawn_at is null for update`;
      if (!user.length) return null;
      const epoch = await this.owner(tx, userId);
      const rows = await tx`select id from shorts_mvp.youtube_account_links where user_id=${userId} and id=${id} and version=${version} for update`;
      if (epoch !== expectedEpoch || !rows.length) return null;
      return this.erase(tx, userId, epoch + 1);
    });
  }
  async disconnect(userId: string, id: string) {
    return this.db.begin(async tx => {
      const epoch = await this.owner(tx, userId) + 1;
      await this.link(userId, id, false, tx);
      // Google revocation can invalidate every client grant for this Google
      // project. The UI explicitly confirms removal of ALL this user's links.
      return this.erase(tx, userId, epoch);
    });
  }
  async finishDisconnect(userId: string, epoch: number, revoked: boolean) {
    // Keep the short cooldown to fence OAuth exchanges already in flight.
    await this.db`update shorts_mvp.youtube_account_owners set disconnect_status=${revoked ? 'revoked' : 'manual_required'} where user_id=${userId} and epoch=${epoch} and disconnect_status<>'manual_required'`;
  }
  async revocationUnconfirmed(userId: string) {
    await this.db`update shorts_mvp.youtube_account_owners set disconnect_status='manual_required' where user_id=${userId} and disconnect_status<>'none'`;
  }
  async publicationContext(userId: string, shortId: string, connectionId: string) {
    return this.db.begin(async tx => {
      const source = await this.source(userId, shortId, tx);
      const connection = await this.link(userId, connectionId, true, tx);
      return { source, connection };
    });
  }
}
