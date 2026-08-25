#!/usr/bin/env bash

set -euo pipefail

deploy_repo_root=$(git rev-parse --show-toplevel)
cd "$deploy_repo_root"

deploy_branch=$(git branch --show-current)
if [[ -z "$deploy_branch" || "$deploy_branch" == "main" || "$deploy_branch" == "master" ]]; then
  echo "deploy.sh must run from a committed feature branch" >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "commit tracked changes before running deploy.sh" >&2
  exit 1
fi

git fetch origin main
deploy_feature_commit=$(git rev-parse HEAD)
git push -u origin "$deploy_branch"

deploy_tmp_root=$(mktemp -d "${TMPDIR:-/tmp}/chrona-deploy.XXXXXX")
deploy_worktree="$deploy_tmp_root/main"
git worktree add --detach "$deploy_worktree" origin/main

if ! git -C "$deploy_worktree" merge --no-ff "$deploy_feature_commit" -m "merge: ${deploy_branch#codex/}"; then
  echo "merge failed; integration worktree preserved at $deploy_worktree" >&2
  exit 1
fi

deploy_main_commit=$(git -C "$deploy_worktree" rev-parse HEAD)
if ! git -C "$deploy_worktree" push origin HEAD:main; then
  echo "main push failed; integration worktree preserved at $deploy_worktree" >&2
  exit 1
fi

git worktree remove "$deploy_worktree"
rmdir "$deploy_tmp_root"

deploy_refresh_root=${TMPDIR:-/tmp}
cd "$deploy_refresh_root"
codex plugin marketplace upgrade chrona-3d-assets --json
codex plugin add chrona@chrona-3d-assets --json

echo "feature=$deploy_feature_commit"
echo "main=$deploy_main_commit"
echo "chrona plugin refreshed; start a new task to load version 0.1.3"
