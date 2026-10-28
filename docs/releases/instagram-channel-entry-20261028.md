# Instagram channel entry — 2026-10-28

Authorized production UI correction, based on currently promoted dbac235ac1abb0a839561a50f500393fd736ff34 / dpl_FgSpsPqfZysbryAoCJB7NVjjtbwC. Isolated branch codex/instagram-channel-fix-20261028. Target artiroom/shorts prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw; existing production configuration, no database/environment/worker changes.

Meta portal read-only verification: EasyCut 2307294366687280 is published; instagram_business_basic and instagram_business_content_publish both show ready for publication. The existing production upload dialog loads an enabled Instagram account-connect control. No account authorization or real social post was submitted.

The channel page previously always advertised Instagram as coming soon despite its public launch. Reuse the existing server public-access check, display a localized Instagram card linking to projects, and explain the existing finished-short Upload → Instagram connection flow. Do not change the short-bound OAuth protocol, owner/paid guards, Threads access or YouTube maintenance.

Validation: 25 existing/new channel and publishing UI tests passed. React checklist: independent server reads parallelized, no new client effect or API request, accessible section/link, localized destinations. Full lint/typecheck and candidate route/HTTP checks recorded in task outputs. Estimated cost: one ordinary Vercel candidate build, bounded retry if necessary; no recurring resources or media jobs.
