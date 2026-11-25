# Preserve social editing after extraction recovery

Production web baseline remains 0ac4a03e914109e8e7f853b6e66500ef9c6b979d.
The existing social editors hard-code their supported generation IDs. New
generation catalog rows therefore need corresponding editor successors, even
though their document format and layout are unchanged.

The image bases are the exact currently registered social editor images from
fd35cadf2f801b5908063b312bb1e078babe2b40. The two copied modules are taken from
that exact source and change only generation allowlists and the new editor
identity constants. The current web worktree's unrelated worker modules are
not copied. Existing generation IDs stay in each allowlist. zlib is updated
to the fixed Alpine 3.22 package, 1.4-r0, and rescanned.

Use separate immutable SNS/community images and new catalog IDs. Keep all old
editor definitions and catalog rows for pending/existing requests. The new
bindings must pass exact-image runtime verification, synthetic social editor
checks and the existing document/font checks before candidate web selection.
The live submitter's corresponding identity allowlist must be updated narrowly
with its actual deployed source retained, not replaced by an older checkout.

These files prepare candidates only; no runtime selection has changed.
