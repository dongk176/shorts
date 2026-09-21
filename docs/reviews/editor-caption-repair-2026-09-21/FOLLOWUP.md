# EC-61AEA47A: repair caption compare-and-set serialization

Production baseline: cf01373af8c8a78a61dbe8d176ca3fd273799ed6, deployment dpl_e5YXm1ftoMU1Ler6ETrasGHD5qMa. The customer retried five times at 15:55 KST, after the first repair. Each apply-edit returned 409 before any render request committed.

The preceding repair introduced a regression: JSON.stringify(originalCaption) was passed as an untyped SQL parameter cast to JSONB. postgres.js inferred JSONB from PostgreSQL and serialized that string again. The stored JSON object could therefore never equal the JSON string parameter. The update matched no rows and the transaction rolled back with EDITOR_RENDER_VERSION_CONFLICT.

Use tx.json(originalCaption) so the driver binds a JSON object. Keep the original compare-and-set predicate and all owner, state, render version, timeline version, expiry and release checks. There is no worker or schema change. The previously deployed caption geometry repair remains intact.

Read-only production SQL reproduced the old comparison failing on all seven customer outputs, showed jsonb_typeof = string, and confirmed the corrected typed parameter equals each unchanged stored object (jsonb_typeof = object). No customer render or database write was needed for this diagnosis.

The previous API test used an identity json helper and assumed every update succeeded; it did not exercise driver serialization or SQL equality. The replacement test captures the API's actual compare parameter, uses the installed postgres.js serializers, and evaluates equality in isolated PGlite PostgreSQL. It verifies unchanged data queues successfully and concurrently changed data still rejects without an outbox entry. Restoring the old implementation makes the unchanged-data test fail with 409 instead of 202. This remains a controlled integration test, not a customer's authenticated production render.

Local verification and exact candidate/production deployment receipts are stored in output/support-EC-16374A2A-20260921 with followup prefixes in the operator checkout. Existing whole-repository stale CSS hash assertion remains unrelated and unchanged. No second compensation grant is authorized or issued.
