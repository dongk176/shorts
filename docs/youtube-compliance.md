# YouTube ingestion risk policy

Status: **controlled production use; legal review pending**
Last reviewed: 2026-07-14
Owner: 아티룸

This is an engineering risk policy, not legal advice. YouTube's policies can
change, and qualified counsel should review the commercial service.

## Operating decision

The service may process a supported public YouTube URL when the user expressly
confirms that they own the content or have permission from the rights holder.
Private, paid, age-restricted, region-restricted, login-required, removed, or
DRM-protected content remains unsupported.

The service may use a small, preconfigured set of company-controlled egress paths,
including direct AWS egress, WARP, or a contracted fallback proxy, for ordinary
network routing and availability. Every egress must be documented, access-controlled,
monitored, and subject to the same concurrency and request budgets.

An egress path may fail over for connection failures such as DNS, TLS,
connection reset, timeout, or an unavailable proxy. A bot challenge, HTTP 429,
geographic restriction, authentication requirement, or content restriction
must not trigger identity, account, proxy, IP, region, client, cookie,
or token rotation intended to defeat the restriction, but bot challenges
and HTTP 429 responses may be retried up to the worker's standard limit.

## Controls

- Accept only supported YouTube hostnames and validate the video ID before work starts.
- Require an affirmative ownership or license representation for every job.
- Keep the one-download-at-a-time default and enforce a shared request budget across
  all workers and egress paths.
- Retry bot challenges and HTTP 429 responses within the failing asset work only,
  for at most ten total attempts on the same egress, with bounded jittered delays.
  A successful sibling video or subtitle acquisition must not be restarted.
- Do not pass YouTube account credentials, account cookies, or browser profiles to workers.
- Do not access private, paid, age-restricted, region-restricted, removed, or DRM content.
- Keep full source media only on task ephemeral storage and delete it in `finally`.
- Record the selected egress class and error category without logging proxy URLs,
  credentials, signed URLs, tokens, cookies, or full command output.
- Provide a direct source upload path as the durable fallback when URL ingestion fails.

## Network path registry

Each enabled path must have an owner and stated purpose. Secrets and endpoint URLs
belong in the runtime secret store, not in this document.

| Path | Permitted purpose | Bot/429 behavior |
| --- | --- | --- |
| AWS direct egress | Default public-video retrieval | Standard retry; do not rotate |
| WARP | Stable company-controlled routing | Standard retry; do not rotate |
| Contracted fallback proxy | Network outage failover only | Standard retry; do not rotate |

Residential proxy pools, per-request IP rotation, user-supplied proxies, and routing
selected to evade a platform restriction are not approved.

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
- [ ] Failover tests prove bot/429 responses cannot cause IP or identity rotation.
- [ ] Authentication, age, payment, region, private-video, and DRM restrictions fail closed.
- [ ] Circuit breaker, backoff, audit events, ephemeral cleanup, and kill switch are tested.
- [ ] Public terms and privacy disclosures match the implemented data flow.
- [ ] Direct upload is available as the non-YouTube fallback.
- [ ] A 90-day policy re-review owner and reminder are assigned.
