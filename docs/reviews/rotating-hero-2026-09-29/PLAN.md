# Personalized home headlines and natural text wrapping

User authorized the two approved 20-headline sets, occupation-based selection, 3-second rotation, unchanged description wording and natural wrapping in Korean, English and Japanese. Earlier production deployment authorization continues for this follow-up.

Production baseline verified through Vercel project: source `3c92f1261dda84d93c6c5b921120feef6c3725e5`, deployment `dpl_J4MBV2eYQnj6XGN11PzSqDVJBX4L`, READY. Reused clean attached checkout `/Users/gimdongmin/.codex/worktrees/site-copy-localization/shorts-clean`; new branch `codex/home-personalized-hero-20260929` starts exactly at that source. Prior report-only commit remains on the prior branch.

Target: existing production project `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`, team `team_3pn55cGmUE8SRRKg0D3dRiPJ`, root `web`, Node 24. Existing production DB `mvcprswvfybudtopepuj` / `shorts_mvp` and registered AWS `181651591905` workers. Existing authenticated onboarding GET may expose the caller's saved occupation, using its existing table and access scope. No schema, environment, worker, billing or lab change. No new production profile or job will be created for testing.

Creator/marketing/brand/video-production occupations receive creator copy; education/employee-freelancer receive side-hustle copy. Other/missing occupations keep the existing general headline. Korean copy is the approved text verbatim without terminal full stops. English/Japanese copy is localized to the same intent. Pause rotation when the document is hidden; provide a pause control and respect reduced-motion preference. Isolate timer updates to the headline component and reserve layout space to avoid moving the input.

Validation: occupation mapping and copy coverage; actual component timer/full-cycle, pause/reduced-motion, locale/account changes, onboarding API privacy and completion refresh; browser desktop and 320/367/390 px mobile in all locales, including no split Korean words and Japanese phrase wrapping. Build/lint/type checks, exact baseline route comparison and unfinished-publishing exclusion. Deploy unaliased candidate, inspect all protected paths and admission fingerprint, recheck live baseline, promote identical candidate. HTTP/editor route checks do not constitute paid generation or editor-save verification.

Estimate: one local and one cloud build, bounded browser/read-only HTTP checks, at most two correction builds. No new recurring resources. Evidence `/private/tmp/easycut-rotating-hero-20260929/`.
