# YouTube ingestion risk policy

Status: **controlled production use; legal review pending**
Last reviewed: 2026-08-18
Owner: 아티룸

This is an engineering risk policy, not legal advice. YouTube's policies can
change, and qualified counsel should review the commercial service.

## Operating decision

The service may process any supported public YouTube URL.
Paid, region-restricted, or DRM-protected content remains unsupported.

The service may use company-controlled egress paths,
including direct AWS egress, WARP, ISP proxy pools, or contracted fallback proxies, for ordinary
network routing and availability. Every egress must be documented, access-controlled,
monitored, and subject to the same concurrency and request budgets.

An egress path may fail over for connection failures (such as DNS, TLS,
connection reset, timeout, unavailable proxy) or when encountering a bot challenge
or HTTP 429. After the server-side availability gate succeeds, yt-dlp's exact media-data
HTTP 403 failure may also retry as a transient delivery failure only when the response has
no payment, region, membership, or DRM restriction marker.
Geographic restriction or content restriction must not trigger
identity, account, region, client, cookie, or token rotation intended to defeat the restriction.
Bot challenges, HTTP 429 responses, and eligible media-data HTTP 403 failures may be retried on
the same or an alternative egress up to the worker's standard limit.

For supported public videos, a feature-gated Proof-of-Origin provider may generate
per-video request attestation for the same selected egress path. The provider must
not receive YouTube account credentials, account cookies, browser profiles, or
account-bound session material. Attestation values are ephemeral and must never be
persisted or logged.

## Controls

- Accept only supported YouTube hostnames and validate the video ID before work starts.

- Keep the one-download-at-a-time default and enforce a shared request budget across
  all workers and egress paths.
- Retry bot challenges, HTTP 429 responses, and eligible media-data HTTP 403 failures within
  the video acquisition work only, with bounded jittered delays.
  A successful video acquisition must not be restarted by later processing stages.
- Do not pass YouTube account credentials, account cookies, browser profiles, or
  account-bound tokens to workers.
- Keep the Proof-of-Origin provider disabled by default, pin its source and package
  versions, fail closed when its runtime validation fails, and retain an immediate
  kill switch.
- Do not access paid, region-restricted, or DRM content.
- Keep full source media only on task ephemeral storage and delete it in `finally`.
- Record the selected egress class and error category without logging proxy URLs,
  credentials, signed URLs, tokens, cookies, or full command output.
- Provide a direct source upload path as the durable fallback when URL ingestion fails.

## Network path registry

Each enabled path must have an owner and stated purpose. Secrets and endpoint URLs
belong in the runtime secret store, not in this document.

| Path | Permitted purpose | Bot/429 behavior |
| --- | --- | --- |
| AWS direct egress | Operator-controlled emergency fallback; inactive by default | Standard retry |
| WARP | Manual rollback only; inactive in worker job definitions | Standard retry |
| Dedicated ISP proxy pool | Default public-video retrieval, one active download per IP | Standard retry |
| Contracted fallback proxy | Network outage failover only | Standard retry |



## Official policy context

The current primary sources include:

- [YouTube API Services Developer Policies](https://developers.google.com/youtube/terms/developer-policies),
  which restrict downloading or storing YouTube audiovisual content without prior
  written approval and restrict non-API retrieval in API clients;
- [Complying with YouTube's Developer Policies](https://developers.google.com/youtube/terms/developer-policies-guide),
  which recommends a compliance audit when a service's status is unclear;
- [Download videos that you've uploaded](https://support.google.com/youtube/answer/56100),
  which documents YouTube Studio and Google Takeout for creator-owned source files.

User permission addresses content rights but does not itself grant a platform waiver.
Before paid commercial launch, counsel must document the contractual risk, decide
whether written YouTube approval or a compliance audit is required, and verify that
the public terms and actual data flow match.

## Review checklist

- [ ] Counsel has reviewed copyright, contract, privacy, and platform-policy risk.
- [ ] Enabled egress paths are recorded and use a shared request budget.
- [ ] Failover tests prove bot/429 responses cannot cause identity rotation.
- [ ] Authentication, age, payment, region, private-video, and DRM restrictions fail closed.
- [ ] Proof-of-Origin tests prove that no account cookies or account-bound tokens enter workers.
- [ ] Circuit breaker, backoff, audit events, ephemeral cleanup, and kill switch are tested.
- [ ] Public terms and privacy disclosures match the implemented data flow.
- [ ] Direct upload is available as the non-YouTube fallback.
- [ ] A 90-day policy re-review owner and reminder are assigned.
