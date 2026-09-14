---
description: Commit, push, and open (or update) a GitHub pull request. Does not merge.
---

# /pr

When the user writes `/pr`, `pr`, `create a PR`, `open a PR`, or `commit and PR`, treat it as an explicit request to **commit current work, push a feature branch, and create or update a pull request into `main`**.

**Do not merge.** Stop after the PR URL is reported.

## Branch model (Curtio Backend)

| Branch | Role |
|--------|------|
| `main` | Staging / integration — **default target for `/pr`** |
| `prod` | Production (also the GitHub default branch; Cloud Run / deploy target) |
| feature / ops branches | Short-lived work; never commit on `main` or `prod` |

Day-to-day: `feature` → PR → **`main`**. Promoting to production is a **separate, explicit** step (PR into `prod`). Do **not** casually merge `main` → `prod` — history has diverged (link-limit rollbacks/restores). `/pr` never opens or merges a PR into `prod` unless the user explicitly asks for a production PR.

## ClickUp sync (preferred, not blocking)

Follow `.cursor/rules/clickup.mdc`. If ClickUp MCP is unavailable, note it and continue unless the user required tracking.

### Before commit

1. From `git diff`, branch name, and the user's request, search the **Curtio** list (`1100360000003094`), then the workspace.
2. Reuse a matching task or create one (`[Backend] …`, status `in progress`, `start_date` now, Timing block).
3. Share the task URL when one exists or was created.

### After the PR exists

1. Put **PR URL**, branch, and commit SHA on the ClickUp task (description + comment) when available.
2. Keep status **`in progress`** while the PR is open. Do **not** mark **`staging`** here — opening a PR is not completion (see `clickup.mdc`).
3. Include the ClickUp URL in the PR body when available.

---

## Workflow

### 0. Feature branch only — never commit or push `main`

1. `git branch --show-current`
2. Infer a branch name from the change scope (or use the slug the user gave):
   - `feat/<topic>` — features
   - `fix/<topic>` — bug fixes
   - `chore/<topic>` — docs, tooling, Cursor rules, refactors
   - `docs/<topic>` — documentation only
3. If on `main` or `prod`:
   - Stop. Do not commit there.
   - `git pull --ff-only origin main` then `git checkout -b <inferred-branch>`
   - Carry local edits onto the new branch (stash/pop only if checkout is blocked).
4. Report which branch is used.

### 1. Review changes

Run in parallel:

- `git status`
- `git diff`
- `git log --oneline -5` (match this repo's commit style)

If there is nothing to commit **and** nothing unpushed, say so. Do not create an empty commit.

### 2. Stage and commit

- Stage only files that belong to this change.
- **Never** stage `.env`, credentials, or secrets.
- If unrelated dirty files appear, stop and ask.
- Commit with a HEREDOC message that matches recent `git log` style (prefer conventional: `feat:`, `fix:`, `chore:`).

### 3. Checks (skip only for docs/Cursor-command markdown, and say so)

- `npm test` (Jest)

Fix failures before pushing. If a check cannot run, say so — do not claim it passed.

### 4. Push

```bash
git push -u origin HEAD
```

- Push only to `origin`.
- Do not force-push unless the user explicitly asked.
- Do not skip hooks unless the user explicitly asked.

### 5. Create or update the PR into `main`

After every successful push, there must be **exactly one open PR** from this branch into `main`, with a current title and body. GitHub reuses the same PR on later pushes — if you only run `gh pr create`, it fails and the description stays stale.

1. `git fetch origin main`
2. Write the PR body covering **everything** in `origin/main..HEAD`, not just the latest commit:
   - **Summary**
   - **Test plan**
   - **Related ClickUp** (task URL, if any)
   - `### Commits` (`git log origin/main..HEAD --oneline`)
3. Title: latest commit subject, or a compound title if the branch mixes themes.
4. Open or refresh:

```bash
TITLE="$(git log -1 --pretty=%s)"
PR_NUM=$(gh pr list --base main --head "$(git branch --show-current)" --state open --json number --jq '.[0].number // empty')
if [ -n "$PR_NUM" ]; then
  gh pr edit "$PR_NUM" --title "$TITLE" --body-file /tmp/pr-body.md
else
  gh pr create --base main --head "$(git branch --show-current)" --title "$TITLE" --body-file /tmp/pr-body.md
fi
```

If `gh pr create` says a PR already exists, edit that PR instead.

Do not add GitHub reviewers unless the user asked.

### 6. Report (required)

```
## PR ready

| Step | Status |
|------|--------|
| ClickUp | task URL (or skipped / unavailable) |
| Branch | name |
| Commit | sha + message |
| Push | origin/<branch> |
| PR | created or updated |

**PR URL:** …
**ClickUp:** … (or n/a)
```

## Safety

- Never commit, push, or open a PR from `main` or `prod`.
- Never merge (`gh pr merge`) as part of `/pr`.
- Do not open a PR into `prod` unless the user explicitly asked for a production change.
- Do not run destructive git commands (`reset --hard`, `clean -fd`).
- Do not amend pushed commits unless the user asked and amend rules are satisfied.
