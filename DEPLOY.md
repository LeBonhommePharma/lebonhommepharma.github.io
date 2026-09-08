# Deploying Rive (`/rive/`)

`https://thebonhomme.com/rive/` is served by **GitHub Pages from this apex
repo**. The atlas source lives in [`LeBonhommePharma/Transit`] (the GitHub
repo is still named Transit; the public product is **Rive**, to avoid colliding
with the official Transit app).

The published tree is composed by `scripts/publish-transit.mjs` in that repo
and synced here by `.github/workflows/publish-transit.yml`.

## Public URLs

| URL | What it is |
| --- | --- |
| `https://thebonhomme.com/rive/` | Primary. The Rive atlas. |
| `https://thebonhomme.com/rive/watch.html` | Watch companion page. |
| `https://thebonhomme.com/transit/` | 200 alias. Apex-authored redirect to `/rive/`, query and hash preserved. |
| `https://thebonhomme.com/transit/watch.html` | 200 alias to `/rive/watch.html`. |

GitHub Pages cannot emit an HTTP 301, so `/transit/` is a **200 HTML/JS
redirect** (`transit/index.html`, `transit/watch.html`) rather than a second
copy of the 35 MB GTFS tree. Deep asset paths under `/transit/*.js` are not
aliased; bookmarks to the HTML routes are.

## What gets published

| source (`LeBonhommePharma/Transit`) | published as |
| --- | --- |
| `public/Transit/*` | `rive/*` |
| `public/data/` | `rive/data/` |
| `public/l10n/` | `rive/l10n/` |
| `public/favicon.svg` | `rive/favicon.svg` |
| — (apex-local, preserved) | `rive/README.md` |

`publish-transit.yml` rsyncs `--delete` **only** into `rive/`. It does not
touch `transit/` (the alias), `transitA/` (rollback snapshot), or any other
route.

## Pipeline

```
push to Transit main
   └─ (optional) repository_dispatch transit-publish
apex .github/workflows/publish-transit.yml   also: */15 cron, workflow_dispatch
        Gate A  npm test on the Transit checkout
        Gate B  compose + stamp + verify artifact
        rsync --delete into rive/ only, commit, push to apex main
        dispatch pages.yml explicitly
   └─ .github/workflows/pages.yml deploys the whole site
        Gate C  fetch https://thebonhomme.com/rive/, assert served bytes == built bytes
        Gate D  assert the other routes, plus /rive/ and /transit/, still return 200
        on failure: automatic git revert + push  (rollback)
```

The workflow display name stays **Publish /transit** so Transit's dispatch
event (`transit-publish`) and this repo's `linkcheck.yml` `workflow_run`
trigger keep working without a coordinated rename.

A push made with `GITHUB_TOKEN` does not start another workflow. The publisher
therefore **dispatches `pages.yml` explicitly**.

## Rollback

**Automatic.** If Gate C or D fails, the workflow reverts its own publish
commit (the `rive/` tree only) and pushes. `/transit/` redirects are not part
of that commit, so they stay put.

**Manual — last verified publish:**

```sh
git log --oneline -- rive
git revert --no-edit <sha>
git push origin main
```

**Manual — restore the last known snapshot** (taken before the Astra+PR6 UI
overwrite, and still a complete atlas):

```sh
rsync -a --delete transitA/ rive/
# restore the apex README the rsync would overwrite
git checkout HEAD -- rive/README.md
git add -- rive
git commit -m "Revert /rive to transitA snapshot"
git push origin main
```

**Republish a known-good Transit commit:** Actions → **Publish /transit** →
Run workflow → `ref: <good sha>`.

Do not copy `transitA/` onto `transit/` — that directory is the public alias,
not the app.
