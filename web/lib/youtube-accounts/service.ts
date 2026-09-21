import "server-only";
import { HttpError } from "@/lib/http";
import { challenge, hash, type TokenVault } from "./crypto";
import { returnPath, startInput, uuid, type Actor, type StartInput } from "./contracts";
import type { YoutubeAccountGoogle } from "./google";
import type { RemovedConnections, YoutubeAccountStore } from "./store";

export class YoutubeAccounts {
  constructor(private store: YoutubeAccountStore, private vault: TokenVault, private google: YoutubeAccountGoogle, private paidAccess: (userId: string) => Promise<void>) {}
  private actor(actor: Actor) {
    uuid.parse(actor.userId);
    if (!actor.sessionId) throw new HttpError(401, "로그인이 필요합니다.");
  }
  async list(actor: Actor, shortId?: string) {
    this.actor(actor);
    if (shortId) { uuid.parse(shortId); await this.paidAccess(actor.userId); await this.store.source(actor.userId, shortId); }
    return this.store.list(actor.userId);
  }
  async disconnectStatus(actor: Actor) {
    this.actor(actor);
    return this.store.disconnectStatus(actor.userId);
  }
  async disconnectState(actor: Actor) {
    this.actor(actor);
    return this.store.disconnectState(actor.userId);
  }
  async start(actor: Actor, raw: StartInput) {
    this.actor(actor);
    const input = startInput.parse(raw);
    if (input.shortId) await this.paidAccess(actor.userId);
    const c = challenge();
    await this.store.start(actor, input, hash(c.state), this.vault.seal(c.verifier, actor.userId, `oauth:${hash(c.state)}`));
    return this.google.authorization(c.state, c.challenge);
  }
  async callback(actor: Actor, query: URLSearchParams) {
    this.actor(actor);
    const state = query.get("state") || "";
    if (!/^acct_[A-Za-z0-9_-]{43}$/.test(state)) throw new HttpError(400, "유효하지 않은 인증 응답입니다.");
    const pending = await this.store.consume(actor, hash(state));
    const path = returnPath.parse(pending.returnPath);
    // Never reflect provider error text or codes/tokens in redirects.
    const result = (outcome: string) => ({ returnPath: path, outcome });
    if (query.has("error")) return result("cancelled");
    let issuedToken: string | undefined;
    try {
      const code = query.get("code");
      if (!code || code.length > 4096) throw new Error("Invalid code");
      if (pending.shortId) await this.paidAccess(actor.userId);
      const verifier = this.vault.open(pending.verifierCiphertext, actor.userId, `oauth:${hash(state)}`);
      const tokens = await this.google.exchange(code, verifier, token => { issuedToken = token; });
      issuedToken = tokens.refreshToken;
      const channels = tokens.channels.map(c => ({ ...c, ciphertext: this.vault.seal(tokens.refreshToken, actor.userId, `channel:${c.channelId}`) }));
      await this.store.finish(pending, channels, tokens.scopes);
      return result("connected");
    } catch {
      // A consent exchange already in flight may complete after deletion. Do
      // not leave that newly issued grant behind when the local epoch rejects it.
      if (issuedToken && !await this.google.revoke(issuedToken)) await this.store.revocationUnconfirmed(actor.userId);
      return result("failed");
    }
  }
  async disconnect(actor: Actor, id: string) {
    this.actor(actor); uuid.parse(id);
    const removed = await this.store.disconnect(actor.userId, id);
    const result = await this.revokeRemoved(actor.userId, removed);
    return { ...result, revocation: await this.store.disconnectStatus(actor.userId) };
  }
  async revokeRemoved(userId: string, removed: RemovedConnections) {
    // Local deletion commits before any provider request; failure cannot leave
    // usable credentials or upload session URLs in the application database.
    let readable = true;
    const tokens = new Set<string>();
    for (const row of removed.tokens) {
      if (!row.tokenCiphertext) continue;
      try { tokens.add(this.vault.open(String(row.tokenCiphertext), userId, `channel:${row.channelId}`)); }
      catch { readable = false; }
    }
    const outcomes = await Promise.all([...tokens].map(token => this.google.revoke(token)));
    const revoked = readable && outcomes.every(Boolean);
    tokens.clear();
    await this.store.finishDisconnect(userId, removed.epoch, revoked);
    return { deleted: true, revocation: revoked ? "revoked" : "manual_required" };
  }
  // This is an eligibility check, not an upload capability. A future dispatcher
  // must revalidate ownership and active connection when it actually starts.
  async eligibility(actor: Actor, shortId: string, connectionId: string) {
    this.actor(actor); uuid.parse(shortId); uuid.parse(connectionId);
    await this.paidAccess(actor.userId);
    const { source, connection } = await this.store.publicationContext(actor.userId, shortId, connectionId);
    return { shortId: source.id, renderVersion: source.renderVersion, connectionId: String(connection.id), channelTitle: String(connection.channelTitle), eligible: true };
  }
}
