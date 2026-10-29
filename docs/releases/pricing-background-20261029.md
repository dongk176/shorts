# Pricing background — 2026-10-29

User-authorized production visual fix. Baseline is promoted deployment dpl_6vyLKGkRXCxkSNdGjqR3GMaziWay (shorts-7pv1eli3j-artiroom.vercel.app), source fd3537ce08a058ecf57d967e44379590d1883510. Available deployed source file hashes were compared with the baseline checkout: 681 matches, zero mismatches. Isolated worktree .tmp/pricing-background-fix-20261029, branch codex/pricing-background-fix-20261029.

Target is existing production artiroom/shorts prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw, with its unchanged production configuration. No lab, DB, worker, billing, catalog or authentication configuration change. Remove only the pricing main element's oversized secondary glow. The common full-viewport backdrop remains; the extra element created visible rectangular edges, especially as the sidebar changed width.

Validation: 35 existing pricing UI tests passed; make lint (worker Ruff, frontend ESLint and typecheck) passed. Local visual check uses no production secrets, so authenticated product state is not verified locally. Verify desktop expanded/collapsed sidebar, mobile layout, actual candidate routes and pricing controls before promotion. Existing services only; bounded local check and one unaliased Vercel build, estimated a few build minutes, no new fixed cost. Promote the exact verified candidate without rebuilding.
