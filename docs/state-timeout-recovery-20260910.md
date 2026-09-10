# State request timeout recovery

Baseline: currently promoted production commit
`1e147cf0e06f94d5a02ec3f2f228c6d5f37c1204`.

The home page and `/api/mvp/state` could wait until Vercel's 300-second limit.
The browser gave up after 12 seconds and retried while server-side work could
remain pending. `/api/templates` had the same missing read deadline. Production
Supavisor transaction connections reported a two-minute statement timeout even
though the ordinary pool supplied a ten-second startup setting.

State and template reads now use an isolated, request-owned connection to the
existing transaction pooler. Each transaction is read-only and applies actual
transaction-local four-second statement and one-second lock limits. A ten-second
request deadline also covers connection acquisition and authentication. Success,
failure and client cancellation close the connection; delayed callbacks cannot
retrieve a live database after their request ends. At most four such connections
are active per function instance; excess work gets a retryable response without
joining an unbounded queue. This adds a connection handshake per request, while
Supavisor retains backend pooling. Production read probes took 290–551 ms.

Read-only session lookup does not create sessions or update last-seen timestamps.
Completed public state can be shared for 30 seconds; pending promises are no
longer shared across requests. Managed-account authentication remains inside its
own read lifetime. The browser deadline allows the existing eight-second auth
middleware and the ten-second server deadline to finish before starting a retry.
Slow/failing reads record operation stages and timings without user data or SQL.

Ordinary database access and session behavior outside these two read paths are
preserved. No Toss or ThePayOne payment/refund/provider logic, data, schema,
environment setting, worker or infrastructure is changed. There is no automatic
retry of a payment or database mutation.

Validation:

- Web suite: 2,414 passed, 28 skipped (including three opt-in local DB cases).
- Local PostgreSQL 16: three integration cases passed, covering actual limits,
  read-only enforcement, slow-query cancellation/recovery and browser abort.
- Unit tests cover stalled connection cleanup, concurrent request isolation,
  admission limits, late callbacks, ordinary pool preservation and cache recovery.
- Existing repository script tests: 204 passed.
- Production read-only probes: public state and two paid account states returned
  valid plans, usage and recent jobs; transaction settings were confirmed as
  `read_only=on` and `statement_timeout=4s` through the real Supavisor connection.
- Local test container was removed after verification. No new recurring resources.
- Candidate build, route manifest, five protected paths and runtime target
  fingerprint must pass before promoting that exact deployment without rebuild.

Verification costs are bounded local tests/builds, one candidate build and a small
number of read-only probes on existing services (expected under KRW 1,000); these
use the user's standing ordinary-test authorization.
