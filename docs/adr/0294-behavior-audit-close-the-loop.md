<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0294: Behavior Audit — Close the Loop (Tier 1): Nightly CI Orchestration, Gateway Preflight, and Orphan-Branch Snapshot Publishing

## Status

Implemented (with divergence)

## Date

2026-07-19

## Context

The behavior-audit pipeline (`scripts/behavior-audit/`, `bun audit:behavior`) produces a per-domain UX scorecard under `reports/audit-behavior/stories/`, but as of 2026-07-19 that output was invisible and fragile:

1. **Invisible by default.** `reports/` is gitignored; nothing in `src/` reads it and no CI job produced it. A developer had to run the audit locally against a local LLM server to see any output.
2. **Fragile to run.** Defaults assumed a local model (`Gemma-4-26B-A4B` at `http://localhost:8000/v1`). The audit started a 20–60 minute job and only discovered the gateway was down via timeout/retry failures deep in Phase 1.
3. **Point-in-time only.** No history: a reader could not see how scores evolved. The incremental machinery (`incremental-manifest.json`, fingerprints, dirty-set propagation) was dead capital while the output was invisible and never run on a schedule.

The pipeline already spoke the OpenAI-compatible API (`BEHAVIOR_AUDIT_BASE_URL`/`BEHAVIOR_AUDIT_MODEL`/`OPENAI_API_KEY` resolved in `config.ts`), so it could target a cloud gateway with zero code change — but nothing scheduled it, validated the gateway up front, or persisted snapshots.

This is the first of three sequential tiers (Tier 1 → Tier 2 → Tier 3). The design (`docs/superpowers/specs/2026-07-19-behavior-audit-close-the-loop-design.md`) and plan (`docs/superpowers/plans/2026-07-19-behavior-audit-close-the-loop-implementation.md`) chose to close the loop with **orchestration only**: a nightly GitHub Actions workflow plus a preflight script and a publish-snapshot script, changing **zero** audit-pipeline code so Tier 2 (concurrency + grep) and Tier 3 (relative scoring + closure) can ship independently without coordination.

## Decision Drivers

- **Make the output visible and continuously produced, with no GPU.** A nightly CI job must run the audit against an external OpenAI-compatible gateway on `ubuntu-latest` and publish the result to a durable, history-carrying location.
- **Fail fast before consuming compute.** A preflight check must refuse to start a 20–60 minute audit when the gateway is unreachable, auth is rejected, or the configured model is not offered — so the job fails in seconds rather than timing out deep in Phase 1.
- **History + a stable "latest" pointer, not an expiring artifact.** Snapshots must live on an orphan branch (`audit-output`) with a moving lightweight tag (`audit-output-latest`) so score evolution is `git log`/`git diff`-able and does not expire like the 14-day GitHub Actions artifacts. Consumers read the latest via `git show audit-output-latest:stories/index.md`.
- **Change zero audit code.** Tier 1 is a workflow + two orchestration scripts only; no file under `scripts/behavior-audit/` that participates in the audit pipeline may be modified, so Tier 2 and Tier 3 can ship independently.
- **Compute via secrets, not code.** The audit reads three env vars (`config.ts` already resolves); the job injects them from GitHub secrets, with the gateway key mapped onto `OPENAI_API_KEY` (the env the Vercel AI SDK reads).
- **Single nightly writer; force-push safe.** The orphan branch has one writer (the nightly job) and no consumers expect linear history, so a force-push and a `concurrency: { group: behavior-audit }` guard are acceptable.

## Considered Options

### Option 1 — Nightly cron + preflight + orphan-branch publisher, zero audit-code changes (chosen)

A single new workflow (`.github/workflows/behavior-audit.yml`) on `schedule: 0 3 * * *` + `workflow_dispatch`, plus two scripts: `preflight.ts` (GET `${BASE_URL}/models`, verify the configured model is offered, exit 1 on any failure) and `publish-snapshot.ts` (replace `stories/` on an `audit-output` orphan branch, move `audit-output-latest`). No audit-pipeline file is touched.

- **Pros:** publishes durable, diffable history with a stable latest pointer; fails fast before spending compute; decouples Tier 2/Tier 3 entirely (they only touch audit code the publisher copies wholesale); the agent contract is unchanged.
- **Cons:** introduces the repo's first orphan-branch publishing convention (no precedent — existing CI only uploads expiring artifacts); an extra nightly job with real cloud-API cost; force-push to the orphan branch.

### Option 2 — Publish as a GitHub Actions artifact (rejected)

Reuse the existing `actions/upload-artifact` for `reports/**` with longer retention instead of an orphan branch.

- **Pros:** no new git conventions; no force-push; smallest workflow delta.
- **Cons:** artifacts expire (default 14 days) and lose history; no `git log`/`git diff` of score evolution; no stable pointer a consumer can `git show`; directly defeats Tier 1's "history" goal and Tier 3's trend-column needs.

### Option 3 — Run on PRs in addition to nightly (rejected)

Trigger the audit per-PR so changes are scored immediately.

- **Pros:** fastest feedback on score-affecting changes.
- **Cons:** a 20–60 minute, ~800-file, 4-phase LLM job per PR is too expensive and slow for a gate; needs state persistence and cost controls this tier explicitly defers; conflicts with the no-GPU CI runners.

## Decision

The chosen Option 1 shipped as three new files plus their tests, and the three required secrets were documented. What shipped:

1. **Workflow `.github/workflows/behavior-audit.yml`.** Triggers `schedule: 0 3 * * *` and `workflow_dispatch`; `permissions: contents: write`; `concurrency: { group: behavior-audit, cancel-in-progress: false }`; one `ubuntu-latest` job on Bun 1.3.13 running install → preflight → (fetch prior snapshot) → `bun audit:behavior` → configure git → publish via a detached worktree.
2. **`preflight.ts`.** Reads `BEHAVIOR_AUDIT_BASE_URL`/`BEHAVIOR_AUDIT_MODEL`/`OPENAI_API_KEY`; GETs `${baseUrl}/models` with a bearer token; classifies the failure (missing env, network error, auth-rejected 401/403, non-200, malformed JSON, model not offered) and exits 1 with a clear message, or 0 with a one-line confirmation.
3. **`publish-snapshot.ts`.** Resolves the stories path, branch (`audit-output`), tag (`audit-output-latest`), and UTC date stamp via pure helpers; `runPublish` rebuilds a fresh orphan branch, replaces `stories/` wholesale, commits `chore(audit): snapshot for ${DATE}`, moves the tag, and the `main` flow force-pushes branch + tag to `origin`. Git access is behind a `GitOps` interface (real + fake) for testability.
4. **Tests.** `preflight.test.ts` covers the success path and every failure path via the shared `setMockFetch`/`restoreFetch` helpers; `publish-snapshot.test.ts` covers the pure helpers, the publish flow against a fake `GitOps` (asserting the exact `branch -D → checkout --orphan → rm -rf . → add → commit → tag -f` ordering), git-error propagation, and a real-git integration suite.
5. **Secrets documented.** `docs/architecture/environment.md` records `BEHAVIOR_AUDIT_BASE_URL`, `BEHAVIOR_AUDIT_MODEL`, and `BEHAVIOR_AUDIT_API_KEY` (mapped onto `OPENAI_API_KEY`).
6. **Zero audit-pipeline code changed** — only `preflight.ts` and `publish-snapshot.ts` were added under `scripts/behavior-audit/`.

## Consequences

### Positive

- The audit's output is now continuously produced and durably visible: every night the fresh `stories/` snapshot lands as a commit on the `audit-output` orphan branch with `audit-output-latest` moved to it, so score evolution is `git log audit-output -- stories/index.md` and week-over-week change is `git diff audit-output~7 audit-output -- stories/`.
- Failures are early and cheap: a down/misconfigured gateway fails the preflight in seconds with an actionable message, rather than timing out deep in Phase 1 after minutes of compute.
- Tier 2 and Tier 3 are fully decoupled — the publisher copies `stories/` wholesale, so any field/sidecar Tier 3 adds is picked up automatically, and the orphan branch then carries the trend data Tier 3 will read via `git show audit-output-latest:stories/scores.json`.
- The publisher's git access is behind a `GitOps` seam, so the publish algorithm is unit-testable without a real repo (and additionally exercised by a real-git integration suite).

### Negative

- **The repo's first orphan-branch publishing convention.** There is no prior precedent; consumers and tooling must learn the `audit-output-latest` tag / `<tag>:<path>` access pattern.
- **Real nightly cloud-API cost.** A full recompute over ~800 files across 4 phases, every night — mitigated by pinning a cheap model in the secret and keeping the job cron-only (no per-PR spend).
- **Force-push to `audit-output`.** Acceptable because the branch is an orphan with a single writer and no linear-history expectation, but it is a force-push that must not be pointed at `master`.

### Risks

- **Model drift.** Cloud models change behavior over time, shifting scores independent of code changes; the design mitigates by pinning a specific model string in the secret and documenting rotations as empty-diff commits on the branch.
- **Orphan-branch growth.** Each nightly commit is ~tens of KB of markdown; after a year the branch carries ~365 commits and a few MB of history — acceptable, and squattable if it ever matters.
- **The orphan rebuild assumes the prior `audit-output` ref is fetchable, not checked out in another worktree.** `resetToFreshOrphanBranch` best-effort deletes the local ref before `checkout --orphan` (logging the breadcrumb if the delete fails), so a ref checked out elsewhere would surface as a downstream `checkout --orphan` "branch already exists" error rather than a silent mispublish.

## Related Decisions

- [ADR-0114](0114-behavior-audit-phase2-redesign.md) — Behavior Audit Phase 2 Redesign: the per-behavior classification + feature consolidation pipeline whose `stories/` output this ADR makes continuously visible. The spec cites 0114 as the immediate upstream whose value gap (invisible output) Tier 1 closes.
- [ADR-0103](0103-behavior-audit-keyword-consolidation.md) — Behavior Audit Keyword Consolidation: the Phase 1b embedding-based vocabulary subsystem whose output flows into the snapshots published here.
- [ADR-0102](0102-behavior-audit-progress-reporting.md) — Behavior Audit Progress Reporting with Structured Events: the structured-event pipeline that the nightly run now exercises against a real gateway on a schedule.
- [ADR-0107](0107-behavior-audit-progress-ux-plan-execution.md) — Behavior Audit Progress UX Plan: the progress-UX execution whose observed phase timing now has a recurring, history-carrying consumer.
- [ADR-0073](README.md) — Behavior Audit Incremental Runs: the incremental selection/checkpoint machinery that becomes live capital once the audit runs nightly (referenced via the index; 0073's file is in the pruned 0001–0100 range).
- [ADR-0077](0077-behavior-audit-implementation.md) — Behavior Audit Test-Driven UX Evaluation: the base audit pipeline/phase-runner architecture that this ADR wraps with CI orchestration without modifying.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`. The no-audit-code-modification property holds: under `scripts/behavior-audit/` only `preflight.ts` and `publish-snapshot.ts` are new; the workflow is the only new file under `.github/workflows/`, and the secrets are documented in `docs/architecture/environment.md`.

| File | Role | Evidence |
| --- | --- | --- |
| `.github/workflows/behavior-audit.yml:3-6` | Triggers `schedule: 0 3 * * *` + `workflow_dispatch`. | `read` confirms. |
| `.github/workflows/behavior-audit.yml:8-13` | `permissions: contents: write`; `concurrency: { group: behavior-audit, cancel-in-progress: false }`. | `read` confirms. |
| `.github/workflows/behavior-audit.yml:20-23` | `actions/checkout` (SHA-pinned v7.0.1) + `oven-sh/setup-bun@v2.2.0` with `bun-version: 1.3.13`. | `read` confirms. |
| `.github/workflows/behavior-audit.yml:26-31` | Preflight step injects `BEHAVIOR_AUDIT_BASE_URL`/`BEHAVIOR_AUDIT_MODEL`/`OPENAI_API_KEY` (mapped from `BEHAVIOR_AUDIT_API_KEY`) and runs `bun run scripts/behavior-audit/preflight.ts`. | `read` confirms. |
| `.github/workflows/behavior-audit.yml:36-41` | Run-audit step runs `bun audit:behavior` (see divergence: a trend-fetch step precedes it). | `read` confirms. |
| `.github/workflows/behavior-audit.yml:42-52` | Configure git + Publish step: `git worktree add "$BEHAVIOR_AUDIT_WORKTREE_DIR" --detach` then `bun run scripts/behavior-audit/publish-snapshot.ts` (no `GH_TOKEN` — uses git push, see divergence). | `read` confirms. |
| `scripts/behavior-audit/preflight.ts:14-16` | `ModelsPayloadSchema` (Zod) for the `{ data: [{ id }] }` payload — added over the plan's hand-rolled parse (see divergence). | `read` confirms. |
| `scripts/behavior-audit/preflight.ts:18-35` | `readPreflightConfig` validates the three env vars and returns a `PreflightConfig | undefined`; exits 1 per missing var. | `read` confirms. |
| `scripts/behavior-audit/preflight.ts:37-42` | `classifyHttpFailure` maps 401/403 to "auth rejected", other non-200 to "gateway returned HTTP". | `read` confirms. |
| `scripts/behavior-audit/preflight.ts:44-50` | `pickOfferedModelIds` parses with Zod and filters to string `id`s. | `read` confirms. |
| `scripts/behavior-audit/preflight.ts:52-89` | `runPreflight`: fetch `${baseUrl}/models` with bearer, classify status, parse JSON, verify `model` in `ids`, exit 0/1. | `read` confirms. |
| `scripts/behavior-audit/publish-snapshot.ts:11-32` | Pure helpers `formatDateStamp` (UTC YYYY-MM-DD), `resolveBranchName` (`audit-output`), `resolveTagName` (`audit-output-latest`), `buildCommitMessage`, `resolveStoriesPath` (returns `STORIES_DIR`). | `read` confirms. |
| `scripts/behavior-audit/publish-snapshot.ts:34-50` | `GitOps` interface (`run`/`checkoutOrphan`/`worktreePath`) and `PublishDeps`/`PublishResult` types — note `branchExists()` absent (see divergence). | `read` confirms. |
| `scripts/behavior-audit/publish-snapshot.ts:52-87` | `runPublish`: readdir stories (exit 1 if missing/empty), rebuild orphan, clear+recreate `stories/`, recursive `cp` of entries, `add`/`commit`/`tag -f`. | `read` confirms. |
| `scripts/behavior-audit/publish-snapshot.ts:89-112` | `resetToFreshOrphanBranch`: best-effort `git branch -D <branch>` → `checkout --orphan` → `git rm -rf .` to clear the inherited index (see divergence). | `read` confirms. |
| `scripts/behavior-audit/publish-snapshot.ts:114-136` | `RealGitOps`: constructor takes `worktree` only; `run` captures stderr and throws on non-zero exit; `checkoutOrphan`; `worktreePath`. | `read` confirms. |
| `scripts/behavior-audit/publish-snapshot.ts:138-159` | `publishSnapshotMain`: builds `RealGitOps`, calls `runPublish`, then `git push --force origin <branch>:<branch> refs/tags/<tag>`; exits on push code. | `read` confirms. |
| `scripts/behavior-audit/config.ts:68` | `export let STORIES_DIR = resolve(DEFAULT_AUDIT_BEHAVIOR_DIR, 'stories')` — the path `resolveStoriesPath` returns. | `read` confirms. |
| `package.json:70` | `"audit:behavior": "bun scripts/behavior-audit/index.ts"` — the audit entry point the workflow runs. | `read` confirms. |
| `docs/architecture/environment.md:50-56` | "Behavior audit CI secrets" section documents `BEHAVIOR_AUDIT_BASE_URL`/`BEHAVIOR_AUDIT_MODEL`/`BEHAVIOR_AUDIT_API_KEY` and the preflight env validation (Task 6 Step 4). | `read` confirms. |
| `tests/scripts/behavior-audit/preflight.test.ts:9` | Imports shared `restoreFetch`/`setMockFetch` from `tests/utils/test-helpers.js` (spec's testing-strategy note), not raw `globalThis.fetch` (see divergence). | `read` confirms. |
| `tests/scripts/behavior-audit/preflight.test.ts:19-96` | 8 success/failure-path tests matching the plan (missing env vars, network error, 401, model absent, malformed JSON). | `read` confirms. |
| `tests/scripts/behavior-audit/preflight.test.ts:98-131` | 2 extra tests: trailing-slash stripping and non-string `id` tolerance (see divergence). | `read` confirms. |
| `tests/scripts/behavior-audit/publish-snapshot.test.ts:60-94` | Pure-helper tests (`formatDateStamp`, `resolveBranchName`, `resolveTagName`, `buildCommitMessage`). | `read` confirms. |
| `tests/scripts/behavior-audit/publish-snapshot.test.ts:130-216` | Publish-flow tests against a fake `GitOps`: asserts the exact `branch -D → checkout --orphan → rm -rf . → add → commit → tag -f` ordering, git-error propagation, and empty-stories exit 1. | `read` confirms. |
| `tests/scripts/behavior-audit/publish-snapshot.test.ts:219-275` | Real-git integration suite that runs `runPublish` twice against a temp repo and asserts `git show audit-output:stories/index.md` (see divergence). | `read` confirms. |

Plan-vs-implementation notes:

- **`preflight.ts` was refactored into helpers and gained Zod validation + trailing-slash stripping.** The plan shipped a single flat `runPreflight` that parsed the JSON by hand. Shipped splits `readPreflightConfig`/`classifyHttpFailure`/`pickOfferedModelIds`, parses the models payload with `ModelsPayloadSchema` (Zod, `preflight.ts:14-16,44-50`), and strips trailing slashes from `BEHAVIOR_AUDIT_BASE_URL` before appending `/models` (`preflight.ts:19`) — covered by two extra tests (`preflight.test.ts:98-131`). Additive; the exit-code contract and every failure message are preserved.
- **`GitOps` dropped `branchExists()` and `RealGitOps` was simplified and made error-checking.** The plan's interface had a `branchExists()` probe and `RealGitOps` took `(worktree, branch)` and ignored git exit codes. Shipped (`publish-snapshot.ts:34-38`) the interface has only `run`/`checkoutOrphan`/`worktreePath`; `RealGitOps` takes `worktree` only, and `run` captures stderr and throws on non-zero (`publish-snapshot.ts:114-127`) so git failures surface instead of silently producing an empty publish.
- **A `resetToFreshOrphanBranch` step was added to clear the inherited index.** The plan's `runPublish` went straight to `rm stories` → copy → add → commit → tag. Shipped (`publish-snapshot.ts:89-112`) does a best-effort `git branch -D <branch>` (logging the breadcrumb on failure so a ref-checked-out-elsewhere failure is not masked), then `checkout --orphan`, then `git rm -rf .` to ensure the published history contains only the `stories/` snapshot and never the workflow's checkout lineage. The publish-flow tests assert this exact ordering (`publish-snapshot.test.ts:140-154,168-174,204-216`).
- **Snapshot copy uses recursive `cp` with bounded `Promise.all`, not a per-file `copyFile` loop.** `publish-snapshot.ts:75-79` copies each entry with `{ recursive: true }`; intent (replace `stories/` wholesale, including subdirectories) preserved and slightly more capable.
- **The workflow gained a "Fetch prior audit snapshot (for trend)" step and dropped the plan's `GH_TOKEN`.** Shipped `.github/workflows/behavior-audit.yml:32-35` adds a `git fetch --depth=1 origin audit-output:audit-output` + tag fetch before the audit (Tier 3 trend groundwork, not in the plan). The Publish step omits the plan's `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` env because `publish-snapshot.ts` publishes via `git push --force` (`publish-snapshot.ts:150-156`), not the `gh` CLI. The `actions/checkout` SHA is also bumped from the plan's v7.0.0 to v7.0.1.
- **The publisher test suite expanded well beyond the plan.** The plan specified 6 helper tests + 2 flow tests (8 total) and the spec stated a full integration test "is not worth the CI complexity." Shipped adds git-command-ordering assertions, an orphan-recreation test, a git-error-propagation test, and a full `describe('publishSnapshot real-git integration')` suite (`publish-snapshot.test.ts:219-275`) that runs real git against a temp repo twice and asserts `git show audit-output:stories/index.md`. The pure-helper and exit-1-on-empty coverage the plan specified is preserved.

The source plan `docs/superpowers/plans/2026-07-19-behavior-audit-close-the-loop-implementation.md` and design `docs/superpowers/specs/2026-07-19-behavior-audit-close-the-loop-design.md` are archived alongside this ADR to `docs/archive/`.
