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
        rsync --delete into rive/ only, commit
        scripts/land-via-pr.sh: branch bot/transit-<run>-<attempt>, PR,
          wait for every required check, merge, wait for the pages.yml run
          that the merge push starts
   └─ .github/workflows/pages.yml deploys the whole site
        Gate C  fetch https://thebonhomme.com/rive/, assert served bytes == built bytes
        Gate D  assert the other routes, plus /rive/ and /transit/, still return 200
        on failure: git revert -m 1 of the merge, landed through a PR  (rollback)
```

The workflow display name stays **Publish /transit** so Transit's dispatch
event (`transit-publish`) and this repo's `linkcheck.yml` `workflow_run`
trigger keep working without a coordinated rename.

`main` is protected by ruleset **main protection** (id 23746008): every change
arrives through a PR whose required checks are green, with no bypass actors. A
direct `git push origin HEAD:main` is rejected with `GH013`, and a PR opened
with `GITHUB_TOKEN` never starts the required checks. Both bots
(`publish-transit.yml`, `update-flexaidds-stats.yml`) therefore land through
`scripts/land-via-pr.sh` with a GitHub App token. The App's merge is an ordinary
push, so `pages.yml` starts on its own; the script waits for that exact run.

## Bot landing token

One-time setup, done by a repo admin in the GitHub UI (it handles a private
key, so no workflow or agent does it):

1. <https://github.com/organizations/LeBonhommePharma/settings/apps/new> —
   name e.g. `bonhomme-site-bot`, uncheck **Webhook → Active**. Repository
   permissions: **Contents** read and write, **Pull requests** read and write,
   **Actions** read-only, **Checks** read-only, **Commit statuses** read-only.
   Where can it be installed: **Only on this account**.
2. On the App page: **Generate a private key** (downloads a `.pem`), note the
   **App ID**, then **Install App** → only `lebonhommepharma.github.io`.
3. In this repo → Settings → Secrets and variables → Actions:
   variable `BOT_APP_ID` = the App ID; secret `BOT_APP_PRIVATE_KEY` = the full
   contents of the `.pem`.

Until both exist, a run with something to publish fails at
**Bot landing token — preflight** naming the missing one; runs with nothing to
publish stay green.

Each landing uses a fresh branch `bot/<kind>-<run id>-<attempt>`, so re-runs
never collide. An open bot PR of the same kind left by a failed run is closed
as superseded (its branch is kept).

## Rollback

**Automatic.** If Gate C or D fails after this run's PR merged, the workflow
reverts that merge (`git revert -m 1`, the `rive/` tree only) and lands the
revert through its own PR (`bot/rollback-transit-…`). `/transit/` redirects are not part
of that commit, so they stay put.

**Manual — last verified publish:**

```sh
git -C /Users/lp.more/Projects/lebonhommepharma.github.io fetch origin
git -C /Users/lp.more/Projects/lebonhommepharma.github.io log --oneline origin/main -- rive
```

then revert the publish merge on a branch and open a PR (direct pushes to
`main` are rejected):

```sh
git -C /Users/lp.more/Projects/lebonhommepharma.github.io switch -c revert-rive origin/main
git -C /Users/lp.more/Projects/lebonhommepharma.github.io revert -m 1 --no-edit <merge sha from the log above>
git -C /Users/lp.more/Projects/lebonhommepharma.github.io push -u origin revert-rive
gh pr create -R LeBonhommePharma/lebonhommepharma.github.io --fill
```

**Manual — restore the last known snapshot** (taken before the Astra+PR6 UI
overwrite, and still a complete atlas):

```sh
rsync -a --delete transitA/ rive/
# restore the apex README the rsync would overwrite
git checkout HEAD -- rive/README.md
git add -- rive
git commit -m "Revert /rive to transitA snapshot"
# then push a branch and open a PR, as above
```

**Republish a known-good Transit commit:** Actions → **Publish /transit** →
Run workflow → `ref: <good sha>`.

Do not copy `transitA/` onto `transit/` — that directory is the public alias,
not the app.
