#!/usr/bin/env bash
# Land a bot commit on protected main through a pull request.
#
# Why this exists: ruleset "main protection" (id 23746008, since 2026-09-21)
# requires every change to main to arrive through a PR with the required
# status checks green, and has no bypass actors. A direct
# `git push origin HEAD:main` from a workflow is rejected with GH013. A PR
# opened with GITHUB_TOKEN does not start any workflow, so its required
# checks would never arrive and it could never merge. This script must
# therefore run with a GitHub App installation token in GH_TOKEN (see
# DEPLOY.md, "Bot landing token").
#
# Subcommands
#   land <kind> <title>      push HEAD to bot/<kind>-<run>-<attempt>, open a
#                            PR, wait for every required check, merge, wait
#                            for the pages.yml push run on the merge commit.
#                            Prints merge_sha=<sha> to $GITHUB_OUTPUT.
#   required-checks          print the required check names for main, one per
#                            line. Fails if the ruleset lists none.
#   checks-state <pr>        print pass | pending | fail for the PR's required
#                            checks (and the per-check table on stderr).
#   wait-pages <sha>         wait for the pages.yml push run on <sha>, then
#                            watch it to completion.
#
# Every failure exits non-zero with an ::error:: line at the step it happens.

set -euo pipefail

REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is not set}"
BASE="${LAND_BASE:-main}"
CHECKS_TIMEOUT_S="${LAND_CHECKS_TIMEOUT_S:-1800}"
PAGES_START_TIMEOUT_S="${LAND_PAGES_START_TIMEOUT_S:-300}"
POLL_S="${LAND_POLL_S:-15}"

die() { echo "::error::land-via-pr: $*" >&2; exit 1; }

required_checks() {
  local names
  names=$(gh api "repos/$REPO/rules/branches/$BASE" \
    -q '[.[] | select(.type == "required_status_checks") | .parameters.required_status_checks[].context] | unique | .[]')
  [ -n "$names" ] || die "the rules for $BASE list 0 required status checks — refusing to merge with nothing verified."
  printf '%s\n' "$names"
}

# pass: every required check has a passing run. fail: any required check
# failed or was cancelled. pending: anything else (not reported yet, running).
checks_state() {
  local pr="$1" required table name bucket state=pass
  required=$(required_checks)
  table=$(gh pr checks "$pr" -R "$REPO" --json name,bucket -q '.[] | [.name, .bucket] | @tsv') || {
    # `gh pr checks` exits non-zero while no check has been reported yet.
    table=""
  }
  while IFS= read -r name; do
    bucket=$(printf '%s\n' "$table" | awk -F '\t' -v n="$name" '$1 == n { print $2 }' | sort -u | head -1)
    [ -n "$bucket" ] || bucket="not-reported"
    printf '  %-45s %s\n' "$name" "$bucket" >&2
    case "$bucket" in
      pass) ;;
      fail|cancel) state=fail ;;
      skipping) state=fail; echo "::error::required check '$name' was skipped — a skipped required check never satisfies the ruleset" >&2 ;;
      *) [ "$state" = fail ] || state=pending ;;
    esac
  done <<<"$required"
  echo "$state"
}

wait_pages() {
  local sha="$1" id="" waited=0
  while [ -z "$id" ]; do
    id=$(gh run list -R "$REPO" --workflow=pages.yml --commit "$sha" --event push \
      -L 1 --json databaseId -q '.[0].databaseId // empty')
    [ -n "$id" ] && break
    [ "$waited" -lt "$PAGES_START_TIMEOUT_S" ] || die "no pages.yml push run started for $sha within ${PAGES_START_TIMEOUT_S}s."
    sleep "$POLL_S"; waited=$((waited + POLL_S))
  done
  echo "pages.yml run $id on $sha"
  gh run watch "$id" -R "$REPO" --exit-status
}

land() {
  local kind="$1" title="$2" sha branch pr state waited=0 old merged merge_sha
  [ -n "${GH_TOKEN:-}" ] || die "GH_TOKEN is empty — the bot App token step did not run."
  [[ "$kind" =~ ^[a-z0-9-]+$ ]] || die "kind '$kind' must be [a-z0-9-]+"
  sha=$(git rev-parse HEAD)
  git merge-base --is-ancestor "origin/$BASE" HEAD \
    || die "HEAD $sha does not descend from origin/$BASE — fetch and rebuild the commit first."
  [ "$(git rev-list --count "origin/$BASE..HEAD")" -gt 0 ] \
    || die "HEAD has no commits ahead of origin/$BASE — nothing to land."

  # Collision-free: one branch per run attempt, so a re-run never reuses or
  # force-pushes a branch another run is still waiting on.
  branch="bot/${kind}-${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:?}"
  # Push with the App token, not the read-only GITHUB_TOKEN that
  # actions/checkout persisted as an http.extraheader. Per git-config(1), an
  # empty http.extraHeader resets the list, so only the token in the URL is
  # sent. The token is masked in logs by create-github-app-token.
  git -c "http.https://github.com/.extraheader=" \
    push "https://x-access-token:${GH_TOKEN}@github.com/${REPO}.git" "HEAD:refs/heads/$branch"

  # Idempotent across runs: an earlier run of the same kind that died before
  # merging left an open PR behind. It is superseded by this one; close it
  # (its branch is kept, so nothing is deleted).
  while IFS= read -r old; do
    [ -n "$old" ] || continue
    gh pr close "$old" -R "$REPO" --comment "Superseded by the bot landing from run ${GITHUB_RUN_ID} (${branch})."
    echo "closed superseded PR #$old"
  done < <(gh pr list -R "$REPO" --state open --base "$BASE" --json number,headRefName \
             -q ".[] | select(.headRefName | startswith(\"bot/${kind}-\")) | select(.headRefName != \"$branch\") | .number")

  pr=$(gh pr create -R "$REPO" --base "$BASE" --head "$branch" --title "$title" \
        --body "Automated landing from ${GITHUB_SERVER_URL}/${REPO}/actions/runs/${GITHUB_RUN_ID}.

Merged by the same run once every required check passes. If this PR is still open, that run failed — its log says which check." \
        | sed -n 's#.*/pull/\([0-9][0-9]*\).*#\1#p')
  [ -n "$pr" ] || die "gh pr create returned no PR number."
  echo "opened PR #$pr ($branch @ $sha)"

  while :; do
    state=$(checks_state "$pr") || die "PR #$pr: could not read the required checks (see the error above)."
    case "$state" in
      pass) break ;;
      fail) die "PR #$pr: a required check failed — not merging. ${GITHUB_SERVER_URL}/${REPO}/pull/$pr" ;;
    esac
    [ "$waited" -lt "$CHECKS_TIMEOUT_S" ] || die "PR #$pr: required checks still pending after ${CHECKS_TIMEOUT_S}s."
    sleep "$POLL_S"; waited=$((waited + POLL_S))
  done
  echo "PR #$pr: all required checks passed"

  # --match-head-commit: merge exactly the commit whose checks we watched.
  gh pr merge "$pr" -R "$REPO" --merge --match-head-commit "$sha"
  merged=$(gh pr view "$pr" -R "$REPO" --json state,mergeCommit -q '[.state, (.mergeCommit.oid // "")] | @tsv')
  [ "${merged%%$'\t'*}" = "MERGED" ] || die "PR #$pr is '${merged%%$'\t'*}' after merge, not MERGED."
  merge_sha="${merged#*$'\t'}"
  [ -n "$merge_sha" ] || die "PR #$pr merged but reported no merge commit."
  echo "merged PR #$pr as $merge_sha"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    { echo "merge_sha=$merge_sha"; echo "pr=$pr"; } >> "$GITHUB_OUTPUT"
  fi

  # A merge made with an App token is a normal push to main, so pages.yml
  # starts on its own. Wait for that exact run rather than dispatching a
  # second, racing deploy.
  wait_pages "$merge_sha"
}

cmd="${1:-}"; shift || true
case "$cmd" in
  land)            [ $# -eq 2 ] || die "usage: land <kind> <title>"; land "$1" "$2" ;;
  required-checks) required_checks ;;
  checks-state)    [ $# -eq 1 ] && [[ "$1" =~ ^[0-9]+$ ]] || die "usage: checks-state <pr number>"; checks_state "$1" ;;
  wait-pages)      [ $# -eq 1 ] && [[ "$1" =~ ^[0-9a-f]{40}$ ]] || die "usage: wait-pages <full 40-hex sha>"; wait_pages "$1" ;;
  *)               die "unknown subcommand '${cmd}' (land | required-checks | checks-state | wait-pages)" ;;
esac
