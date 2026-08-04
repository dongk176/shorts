# Production web release

EasyCut production web releases use one guarded command. Do not call Vercel
deployment or promotion commands directly.

## Prepare

1. Start a clean branch at the commit currently promoted to production.
2. Make only the intended web change.
3. Run the relevant focused tests.
4. Commit the complete release as one commit and push the branch.

The release command stops when the branch is dirty, unpushed, based on an older
commit, or more than one commit ahead of production. Database migrations, AWS
infrastructure, and worker images use their own release procedures.

## Verify without deploying

```bash
pnpm release:production -- --dry-run
```

This checks the active Vercel deployment ID, the complete Git tree, every App
Router page and API, the unfinished publishing exclusions, and `make verify`.

## Release

```bash
pnpm release:production
```

The command deploys an unaliased production candidate, checks protected pages
and APIs, confirms that production did not change concurrently, and promotes
the exact candidate deployment without rebuilding it. It then creates and
pushes an annotated `prod-*` tag containing the Git SHA and Vercel deployment
ID.

For rollback, read the prior `prod-*` tag's deployment ID and re-promote that
existing Vercel deployment. Do not rebuild old source for rollback.
