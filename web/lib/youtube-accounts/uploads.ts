import "server-only";
import fs from "node:fs/promises";
import type { HostedYoutubeSources } from "./hosted-sources";
import path from "node:path";
import { createReadStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { z } from "zod";
import { HttpError } from "@/lib/http";
import { sourceAttribution } from "./attribution-server";
import { privacyValues } from "./visibility";
import { uuid, type Actor } from "./contracts";
import type { TokenVault } from "./crypto";
import type { YoutubeAccountStore } from "./store";
import type { YoutubeAccounts } from "./service";
import { Google, metadata, type UploadJob } from "./upload-engine.mjs";

export const uploadInput = z.object({ shortId: uuid, connectionId: uuid, title: z.string().trim().min(1).max(100), description: z.string().refine(value=>Buffer.byteLength(value,"utf8")<=5000,"설명은 UTF-8 기준 5,000바이트 이하여야 합니다."), privacy: z.enum(privacyValues).default("private"), madeForKids: z.boolean(), synthetic: z.boolean() }).strict();
type Config = { clientId: string; clientSecret: string; allowNonPrivateUploads?: boolean };
export class YoutubeAccountUploads {
  constructor(private db: Sql, private store: YoutubeAccountStore, private accounts: YoutubeAccounts, private vault: TokenVault, private config: Config, private sourceRoot: string, private fetcher: typeof fetch = fetch, private hostedSources?: HostedYoutubeSources) {}
  async cleanup() { await this.hostedSources?.cleanup(); }
  private readonly requestDeadline = Date.now() + 210_000;
  capabilities() { return { nonPrivateUploads: this.config.allowNonPrivateUploads === true }; }
  private assertPrivacy(privacy: string) {
    if (!privacyValues.includes(privacy as typeof privacyValues[number])) throw new HttpError(400,"공개 범위를 확인해 주세요.");
    if (privacy !== "private" && !this.config.allowNonPrivateUploads) throw new HttpError(403,"현재는 비공개 업로드만 가능합니다. 공개·일부 공개 업로드는 심사 승인 후 지원합니다.");
  }
  private view(row: Record<string, unknown>) {
    if (row.status === 'expired' || (row.createdAt && new Date(row.createdAt as string).getTime() <= Date.now()-29*86400000)) return { id:String(row.id),shortId:String(row.shortId),title:'이전 업로드',status:'expired',progress:0,requestedPrivacy:null,actualPrivacy:null,privacyCheckedAt:null,videoId:null,error:null };
    return { id: String(row.id), shortId: String(row.shortId), title: String(row.title), status: String(row.status), progress: Number(row.progress), requestedPrivacy: String(row.requestedPrivacy), actualPrivacy: row.actualPrivacy ? String(row.actualPrivacy) : null, privacyCheckedAt: row.privacyCheckedAt ? new Date(row.privacyCheckedAt as string).toISOString() : null, videoId: row.videoId ? String(row.videoId) : null, error: row.errorMessage ? String(row.errorMessage) : null };
  }
  async list(actor: Actor, shortId: string) {
    await this.accounts.list(actor, shortId);
    const rows=await this.db`select id,short_id,title,status,progress,video_id,error_message,requested_privacy,actual_privacy,privacy_checked_at,created_at from shorts_mvp.youtube_account_uploads where user_id=${actor.userId} and short_id=${shortId} order by created_at desc`;
    return rows.map(row=>this.view(row));
  }
  async attribution(actor: Actor, shortId: string) {
    await this.accounts.list(actor, shortId);
    return sourceAttribution(this.db, actor.userId, shortId);
  }
  async preview(actor: Actor, shortId: string) {
    await this.accounts.list(actor, shortId);
    const source = await this.store.source(actor.userId, shortId);
    return this.hostedSources ? { ...await this.hostedSources.preview(source.outputS3Key), hosted: true as const } : { ...await this.sourceFile(source.outputS3Key), hosted: false as const };
  }
  private async sourceFile(key: string) {
    if (!/^outputs\/[a-zA-Z0-9/_-]+\.mp4$/.test(key) || key.includes('..')) throw new HttpError(400,"이 환경에서 게시할 수 없는 영상입니다.");
    if (this.hostedSources) return this.hostedSources.file(key);
    const root=await fs.realpath(this.sourceRoot);
    const file=await fs.realpath(path.join(root,key));
    if(!file.startsWith(root+path.sep))throw new HttpError(400,"영상 경로를 확인할 수 없습니다.");
    const stat=await fs.stat(file);
    if(!stat.isFile()||stat.size<12||stat.size>250*1024*1024)throw new HttpError(400,"250MB 이하 완성 영상만 게시할 수 있습니다.");
    return {file,size:stat.size};
  }
  private async fingerprint(file: string) {
    const digest = createHash("sha256");
    for await (const chunk of createReadStream(file)) digest.update(chunk);
    return digest.digest("hex");
  }
  async create(actor: Actor, raw: unknown) {
    const input=uploadInput.parse(raw);
    await this.accounts.eligibility(actor,input.shortId,input.connectionId);
    this.assertPrivacy(input.privacy);
    const {source,connection}=await this.store.publicationContext(actor.userId,input.shortId,input.connectionId);
    const file=await this.sourceFile(source.outputS3Key);
    const id=randomUUID();
    const job: UploadJob={size:file.size,channelId:String(connection.channelId),metadata:metadata(input),sourceKey:source.outputS3Key,sourceHash:await this.fingerprint(file.file),status:'queued'};
    const state=this.vault.seal(JSON.stringify(job),actor.userId,`upload:${id}`);
    const rows=await this.db`insert into shorts_mvp.youtube_account_uploads(id,user_id,connection_id,short_id,render_version,connection_version,title,state_ciphertext,status,requested_privacy)
      values(${id},${actor.userId},${input.connectionId},${input.shortId},${source.renderVersion},${connection.version},${input.title},${state},'queued',${input.privacy})
      on conflict(user_id,short_id,render_version,connection_id) do nothing returning id,requested_privacy,status`;
    const existing=rows[0]|| (await this.db`select id,requested_privacy,status from shorts_mvp.youtube_account_uploads where user_id=${actor.userId} and short_id=${input.shortId} and render_version=${source.renderVersion} and connection_id=${input.connectionId}`)[0];
    if (!existing) throw new HttpError(404,"연결 또는 게시 기록이 삭제되었습니다.");
    if (existing.status==='expired') throw new HttpError(410,"보관 기간이 지난 게시 기록입니다. 중복 업로드를 막기 위해 다시 전송하지 않습니다. YouTube에서 기존 영상을 확인해 주세요.");
    if (existing.requestedPrivacy !== input.privacy) throw new HttpError(409,"이 영상은 다른 공개 범위로 업로드한 기록이 있습니다. 기존 영상의 공개 범위는 YouTube에서 변경해 주세요.");
    return this.run(actor,String(existing.id));
  }
  async run(actor: Actor, id: string) {
    uuid.parse(id);
    const target=(await this.db`select short_id from shorts_mvp.youtube_account_uploads where id=${id} and user_id=${actor.userId}`)[0];
    if(!target)throw new HttpError(404,"게시 기록을 찾을 수 없습니다.");
    await this.accounts.list(actor,String(target.shortId));
    const lease=randomUUID();
    const row=await this.db.begin(async tx=>{
      await tx`select pg_advisory_xact_lock(hashtextextended(${actor.userId},0))`;
      const rows=await tx`select * from shorts_mvp.youtube_account_uploads where id=${id} and user_id=${actor.userId} for update`;
      const r=rows[0];if(!r)throw new HttpError(404,"게시 기록을 찾을 수 없습니다.");
      if(r.status==='expired' || new Date(r.createdAt).getTime()<=Date.now()-29*86400000) throw new HttpError(410,"보관 기간이 지난 게시 기록입니다. 중복 업로드를 막기 위해 다시 전송하지 않습니다. YouTube에서 기존 영상을 확인해 주세요.");
      if(r.status==='complete' && r.actualPrivacy)return r;
      this.assertPrivacy(String(r.requestedPrivacy));
      const active=await tx`select id from shorts_mvp.youtube_account_uploads where user_id=${actor.userId} and lease_until>now()`;
      if(active.length)throw new HttpError(409,"진행 중인 게시가 있습니다. 잠시 후 상태를 확인해 주세요.");
      const state=JSON.parse(this.vault.open(String(r.stateCiphertext),actor.userId,`upload:${id}`)) as UploadJob;
      if (state.metadata.status.privacyStatus !== r.requestedPrivacy) throw new HttpError(409,"저장된 공개 범위가 일치하지 않습니다.");
      const source=await this.store.source(actor.userId,String(r.shortId),tx);
      const connection=await this.store.link(actor.userId,String(r.connectionId),true,tx);
      if(state.channelId!==connection.channelId||source.renderVersion!==r.renderVersion||source.outputS3Key!==state.sourceKey)throw new HttpError(409,"게시할 채널이나 영상이 변경됐습니다.");
      // A new explicit request may resume after reconnecting the same channel.
      // An already running upload still rejects any subsequent version change.
      r.connectionVersion=connection.version;
      await tx`update shorts_mvp.youtube_account_uploads set connection_version=${connection.version},lease_id=${lease},lease_until=now()+interval '15 minutes',status='uploading',error_message=null where id=${id} and user_id=${actor.userId}`;
      return r;
    });
    if(row.status==='complete' && row.actualPrivacy){await this.accounts.list(actor,String(row.shortId));return this.view(row);}
    let job: UploadJob | undefined;
    try {
      job=JSON.parse(this.vault.open(String(row.stateCiphertext),actor.userId,`upload:${id}`)) as UploadJob;
      const state=job;
      state.status='uploading';
      const verifyAccess=async()=>{
        const live = await this.db`select id from shorts_mvp.youtube_account_uploads where id=${id} and user_id=${actor.userId} and lease_id=${lease} and status<>'expired' and created_at>now()-interval '29 days'`;
        if(!live.length) throw new HttpError(404,"삭제되었거나 보관 기간이 지난 게시 기록입니다.");
        await this.accounts.eligibility(actor,String(row.shortId),String(row.connectionId));
        const current=await this.store.publicationContext(actor.userId,String(row.shortId),String(row.connectionId));
        if(current.connection.version!==row.connectionVersion||current.source.renderVersion!==row.renderVersion||current.source.outputS3Key!==state.sourceKey)throw new HttpError(409,"연결 또는 영상이 변경돼 게시를 중단했습니다.");
        return current;
      };
      const current=await verifyAccess();
      const source=await this.sourceFile(state.sourceKey);
      if(source.size!==state.size||await this.fingerprint(source.file)!==state.sourceHash)throw new HttpError(409,"영상 파일이 변경됐습니다.");
      const google=new Google({client_id:this.config.clientId,client_secret:this.config.clientSecret},async(url,init)=>{
        await verifyAccess();
        const controller = new AbortController();
        const remaining = this.requestDeadline - Date.now();
        if (this.hostedSources && remaining <= 0) throw new Error("Review request deadline exceeded");
        let checking = false;
        const timer = setInterval(async () => {
          if (checking) return;
          checking = true;
          try { await verifyAccess(); } catch { controller.abort(); }
          finally { checking = false; }
        }, 500);
        try {
          const signals = [controller.signal, ...(init?.signal ? [init.signal] : []), ...(this.hostedSources ? [AbortSignal.timeout(Math.max(1, remaining))] : [])];
          const signal = AbortSignal.any(signals);
          const response = await this.fetcher(url, { ...init, signal });
          await verifyAccess();
          return response;
        } finally { clearInterval(timer); }
      });
      const save=async()=>{
        await verifyAccess();
        const ciphertext=this.vault.seal(JSON.stringify(state),actor.userId,`upload:${id}`);
        const saved=await this.db`update shorts_mvp.youtube_account_uploads set state_ciphertext=${ciphertext},status=${state.status},progress=${state.progress||0},video_id=${state.videoId||null},actual_privacy=${state.actualPrivacy||null},privacy_checked_at=${state.privacyCheckedAt||null},updated_at=now() where id=${id} and user_id=${actor.userId} and lease_id=${lease} returning id`;
        if(!saved.length)throw new Error('Upload lease lost');
      };
      await google.upload(state,{refreshToken:this.vault.open(String(current.connection.tokenCiphertext),actor.userId,`channel:${current.connection.channelId}`)},save,source.file);
    } catch {
      // Never log provider messages, access tokens, or resumable session URLs.
      await this.db`update shorts_mvp.youtube_account_uploads set status='interrupted',error_message='게시가 중단됐습니다. 연결과 영상 상태를 확인한 뒤 이어서 확인해 주세요.',updated_at=now() where id=${id} and user_id=${actor.userId} and lease_id=${lease}`;
    } finally {
      await this.db`update shorts_mvp.youtube_account_uploads set lease_id=null,lease_until=null where id=${id} and user_id=${actor.userId} and lease_id=${lease}`;
    }
    const final = (await this.db`select * from shorts_mvp.youtube_account_uploads where id=${id} and user_id=${actor.userId}`)[0];
    if (!final) throw new HttpError(404,"연결 해제로 게시 기록이 삭제되었습니다.");
    return this.view(final);
  }
}
