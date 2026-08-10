# Easy Cut clean local workspace

This folder is an independent clone of the production `main` branch. The
original mixed local folder at `/Users/gimdongmin/shorts` is intentionally
left untouched.

## Current branch

- Production baseline: `1efb1995e7b85d02aaa0931cf42dd89f1bd7b8f7`
- Local development branch: `codex/local-admin-preview-20260810`
- Content calendar and YouTube publishing experiments are not included.

## Fast admin UI preview

```bash
cd /Users/gimdongmin/shorts-clean/web
npm install
npm run dev
```

Open `http://localhost:3000/?localAdminPreview=1`.

The preview supplies local fixtures for the source range, stock templates,
admin subtitle templates, caption placement, brand colors, aspect ratios, and
two sample custom templates. It does not call the database, payment APIs,
YouTube analysis API, job creation API, event claim action, or support API.

The preview requires all three conditions and therefore fails closed in
production:

1. `NODE_ENV=development`
2. `LOCAL_ADMIN_PREVIEW_ENABLED=true`
3. `?localAdminPreview=1`

The root `.env.local` enables only the local preview flag and is ignored by
Git. Production database, payment, AWS, AI, and signing secrets are not copied
into this workspace.

## Working rules for future Codex tasks

1. Start each feature from the latest `main`.
2. Test UI changes in the local preview before deploying.
3. Run targeted tests while iterating, then `make verify` once before release.
4. Deploy one unaliased candidate, verify protected paths, and promote that
   exact deployment without rebuilding.
5. Never commit `.env*`, `.secrets/`, local storage, outputs, or credentials.
6. Never merge the isolated content-calendar or YouTube-publishing branch into
   production.
