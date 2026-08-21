## Why

`opencode-agent` stamps every git commit as `opencode-agent[bot]` (`opencode-agent/src/config.ts:166`). Three problems converge: (a) that bot has no GitHub user — it pollutes `git log`/`shortlog` and never verifies; (c) branch protection / DCO gates that expect a real, verifiable noreply or a human author reject or flag it; (d) maintainers want blame to follow the *per-run actor* (`bob`'s `/approve` commits say `bob`, `carol`'s `/review` fixes say `carol`), not a single static identity. Without this, attribution is wrong for (d), noisy for (a), and can block delivery for (c).

## What Changes

- Flip the static default author from `opencode-agent[bot]` / `opencode-agent@users.noreply.github.com` to `github-actions[bot]` / `41898282+github-actions[bot]@users.noreply.github.com` — the token's actual runtime identity (`opencode-agent/src/identity.ts:27`, `.github/workflows/agent-pipeline.yml:484`, `opencode-agent/README.md`).
- Attribute **per-run** when a human triggered the run: `kind ∈ {issue, pull-request}` → `senderLogin` (already validated as maintainer by `guardrails.ts:93`). Fallback to `github-actions[bot]` when no human ( `workflow_run` CI fixes, `pr-merged` archive `D7`, lookup failure, local `--event-path`).
- Resolve GitHub noreply email as `<id>+<login>@users.noreply.github.com` via `GET /users/:login` (public); short `<login>@users.noreply.github.com` on lookup failure.
- Split git `author` vs `committer`: **author = actor (or fallback), committer = `github-actions[bot]`** so blame shows the human while push provenance stays service. Add `Co-authored-by` trailer only when explicitly requested (follow-up).
- Precedence: explicit `AGENT_COMMIT_NAME`/`AGENT_COMMIT_EMAIL` (`vars.*` in `agent-pipeline.yml:484`) still wins outright when set — operator escape hatch, matching `AGENT_SELF_LOGIN` ladder.
- Apply the same resolved identity to the review-loop's `commitAuthor` (`review-runner.ts:70`, `deps.ts:84`) so loop fixes carry the same author.

## Capabilities

### New Capabilities

- `agent-commit-identity`: How the agent chooses the git author/committer for every commit it pushes (implement steps, salvage, review-loop fixes, `ARCHIVE`), including per-run actor resolution, noreply email construction, and fallback.

Without it: (a) history shows a phantom bot, (d) every step attributes to one static user regardless of who typed `/approve`, (c) unverifiable author can trip protection/DCO.

### Modified Capabilities

- _None_ — `openspec/specs` is currently empty; opencode-agent has no prior spec. This change introduces first coverage rather than modifying one.

## Impact

- Affected code: `opencode-agent/src/config.ts`, `config-shape.ts`, `deps.ts`, `git.ts`, `git-commit.ts`, `github.ts` (new `getUser`), `review-runner.ts`, `orchestrator.ts`/phase wiring, ` .github/workflows/agent-pipeline.yml` vars documentation.
- Docs: `opencode-agent/README.md` (config table), `opencode-agent/CLAUDE.md` (commit-identity rule).
- No papai runtime impact — `src/` under `platform instance`/`task instance`/`config context id` scope model (`docs/architecture/behaviors.md`, `src/chat/context-scope.ts`) unchanged; this is GitHub Actions identity only.
- No new dependencies; one extra public `GET /users/:login` per human-triggered job.

## Non-goals

- Changing `selfLogin` / `AGENT_SELF_LOGIN` resolution (`identity.ts`) — only git commit identity.
- Signing commits with GPG/SSH or changing branch-protection bypass lists.
- Attributing to the *issue opener* for the whole issue lifetime (rejected — violates (d)).
- Contribution-graph inflation via `Co-authored-by` for every opener — deferred.
- `Co-authored-by` / `Signed-off-by` trailer injection (follow-up if DCO needs it).
- Changing push credentials or `AGENT_GITHUB_TOKEN` handling.
