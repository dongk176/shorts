import "server-only";
import type { Sql } from "postgres";
import type { TokenVault } from "./crypto";
import type { YoutubeAccountGoogle, ChannelCheck } from "./google";
import type { YoutubeAccountStore } from "./store";
import type { YoutubeAccounts } from "./service";

// A 29-day limit leaves a day of margin before the provider's 30-day ceiling.
// This job never uploads, deletes, or modifies videos on YouTube.
export class YoutubeRetention {
  constructor(private db: Sql, private store: YoutubeAccountStore, private accounts: YoutubeAccounts, private vault: TokenVault, private google: YoutubeAccountGoogle) {}

  async run() {
    const oauth = await this.db`delete from shorts_mvp.youtube_account_oauth where expires_at<=now() returning state_hash`;
    // Keep only local IDs needed to prevent an implicit duplicate. Clear every
    // provider value and encrypted state (including resumable URLs and metadata).
    const uploads = await this.db`update shorts_mvp.youtube_account_uploads set
      status='expired',title='',state_ciphertext='',video_id=null,progress=0,
      requested_privacy=null,actual_privacy=null,privacy_checked_at=null,error_message=null,
      lease_id=null,lease_until=null
      where status<>'expired' and created_at<=now()-interval '29 days' returning id`;
    const result = { expiredAuthorizations: oauth.length, erasedUploadDetails: uploads.length, checked: 0, refreshed: 0, removed: 0, retry: 0, superseded: 0 };
    // Claim bounded work before network I/O. Competing runs cannot repeatedly
    // pick these rows, and a crash becomes retryable after one hour.
    const links = await this.db.begin(async tx => {
      const rows = await tx`select l.id,l.user_id,l.channel_id,l.token_ciphertext,l.version,o.epoch,
        (l.verified_at<=now()-interval '29 days' or l.last_used_at<=now()-interval '29 days') as expired
        from shorts_mvp.youtube_account_links l join shorts_mvp.youtube_account_owners o on o.user_id=l.user_id
        where l.next_check_at<=now() order by l.next_check_at limit 10 for update of l skip locked`;
      for (const row of rows) await tx`update shorts_mvp.youtube_account_links set next_check_at=least(now()+interval '1 hour',verified_at+interval '29 days',last_used_at+interval '29 days') where id=${row.id}`;
      return rows;
    });
    for (const link of links) {
      result.checked++;
      let check: ChannelCheck = { status: "revoked" };
      if (!link.expired) {
        try { check = await this.google.checkChannel(this.vault.open(String(link.tokenCiphertext), String(link.userId), `channel:${link.channelId}`), String(link.channelId)); }
        catch { check = { status: "retry" }; }
      }
      if (link.expired || check.status === "revoked") {
        const removed = await this.store.expire(String(link.userId), String(link.id), Number(link.version), Number(link.epoch));
        if (!removed) { result.superseded++; continue; }
        await this.accounts.revokeRemoved(String(link.userId), removed);
        result.removed++;
      } else if (check.status === "valid") {
        const saved = await this.db`update shorts_mvp.youtube_account_links set channel_title=${check.title},verified_at=now(),next_check_at=least(now()+interval '1 day',last_used_at+interval '29 days')
          where id=${link.id} and user_id=${link.userId} and version=${link.version}
          and exists(select 1 from shorts_mvp.youtube_account_owners o where o.user_id=${link.userId} and o.epoch=${link.epoch}) returning id`;
        if (saved.length) result.refreshed++; else result.superseded++;
      } else result.retry++;
    }
    return result; // Counts only. Never return identifiers or provider messages.
  }
}
