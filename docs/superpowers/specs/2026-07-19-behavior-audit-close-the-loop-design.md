<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Behavior Audit — Close the Loop (Tier 1)

Date: 2026-07-19
Status: Proposed (not yet implemented)

This is the first of three sequential specs (Tier 1 → Tier 2 → Tier 3) addressing the
behavior-audit workflow's value gap. Tier 4 (architectural rewrite) is deferred.

- **Tier 1 — Close the loop** (this document): make the audit's output visible, durable, and continuously produced.
- **Tier 2 — Configurable concurrency + grep replacement**: remove the three `pLimit(1)` serialization points; replace the `grep` shell-out with portable pure-JS.
- **Tier 3 — Relative scoring + codeindex closure check**: reorient persona scores as relative signals; ground consolidated stories in actual reachable code.

## Problem

The behavior-audit pipeline (`scripts/behavior-audit/`, `bun audit:behavior`) produces a
per-domain UX scorecard under `reports/audit-behavior/stories/`. Today this output is:

1. **Invisible by default.** `reports/` is gitignored (`reports/` listed in `.gitignore`).
   Nothing in `src/` reads it. No CI job produces it. A person must run the audit locally
   with a local LLM server to see any output.
2. **Fragile to run.** Defaults assume `Gemma-4-26B-A4B` at `http://localhost:8000/v1`
   (`scripts/behavior-audit/config.ts:56-57`). The audit starts a 20–60 minute job and
   only discovers the gateway is down via timeout/retry failures deep in Phase 1.
3. **Point-in-time only.** No history. A reader cannot see how scores evolved.

The incremental machinery that exists (`incremental-manifest.json`, fingerprints,
dirty-set propagation) is dead capital as long as the output is invisible and the job
is never run on a schedule.

## Current State (as of 2026-07-19)

- The audit runs only when a developer invokes `bun audit:behavior` locally.
- CI (`.github/workflows/ci.yml`) has 6 jobs (`build`, `security`, `check`, `stories`,
  `e2e`, `mutation-testing`); none invoke the behavior audit.
- CI runs on `ubuntu-latest` with no GPU. The audit's default local-LLM target
  (`localhost:8000`) is unreachable from CI.
- The audit already speaks the OpenAI-compatible API via `@ai-sdk/openai-compatible`
  (`extract-agent.ts:36-43`, `classify-agent.ts:22-29`, `consolidate-agent.ts:22-29`,
  `evaluate-agent.ts:22-29`). `BASE_URL`, `MODEL`, and `OPENAI_API_KEY` are all
  configurable via environment variables resolved in `config.ts:132-133`.
- Existing CI jobs already upload `reports/**` as GitHub Actions artifacts with 14-day
  retention (`ci.yml:117-124`, `ci.yml:170-176`). There is no precedent in this repo
  for orphan-branch publishing.

## Goals

- Produce a fresh audit snapshot every night, fully automated, with no GPU dependency.
- Publish snapshots to a location with full history and a stable "latest" pointer.
- Fail fast when the LLM gateway is unavailable, before consuming compute.
- Change zero audit code. Tier 1 is orchestration + a preflight script only.

## Non-goals

- Per-PR audit runs (deferred — would require state persistence and cost controls).
- Caching or incremental processing in CI (full recompute each night by design).
- Changes to the audit's runtime concurrency (Tier 2).
- Changes to the output format beyond what publishing requires (Tier 3).
- Tier 4 architectural rewrite (deferred).

## Design

### 1. New GitHub workflow `.github/workflows/behavior-audit.yml`

Triggers:

- `schedule: [{ cron: '0 3 * * *' }]` — nightly at 03:00 UTC.
- `workflow_dispatch` — manual runs from the Actions UI.

Permissions:

- `contents: write` — required to push the orphan branch.
- No other permissions.

Job shape (single job, `ubuntu-latest`, Bun 1.3.13 to match existing jobs):

```yaml
jobs:
  audit:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v9
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.13
      - run: bun install --frozen-lockfile
      - name: Preflight
        env:
          BEHAVIOR_AUDIT_BASE_URL: ${{ secrets.BEHAVIOR_AUDIT_BASE_URL }}
          BEHAVIOR_AUDIT_MODEL: ${{ secrets.BEHAVIOR_AUDIT_MODEL }}
          BEHAVIOR_AUDIT_API_KEY: ${{ secrets.BEHAVIOR_AUDIT_API_KEY }}
        run: bun run scripts/behavior-audit/preflight.ts
      - name: Run audit
        env:
          BEHAVIOR_AUDIT_BASE_URL: ${{ secrets.BEHAVIOR_AUDIT_BASE_URL }}
          BEHAVIOR_AUDIT_MODEL: ${{ secrets.BEHAVIOR_AUDIT_MODEL }}
          BEHAVIOR_AUDIT_API_KEY: ${{ secrets.BEHAVIOR_AUDIT_API_KEY }}
          OPENAI_API_KEY: ${{ secrets.BEHAVIOR_AUDIT_API_KEY }}
        run: bun audit:behavior
      - name: Publish snapshot
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: bun run scripts/behavior-audit/publish-snapshot.ts
```

### 2. Compute via secrets, no code change

The audit reads three env vars (`BEHAVIOR_AUDIT_BASE_URL`, `BEHAVIOR_AUDIT_MODEL`,
`OPENAI_API_KEY`) which `config.ts:reloadBehaviorAuditConfig()` already resolves. The
job injects them from GitHub secrets.

`OPENAI_API_KEY` is used by the audit agents as a fallback for `getEnvOrFallback`
(`extract-agent.ts:31-35`, etc.). The workflow sets `OPENAI_API_KEY` equal to
`BEHAVIOR_AUDIT_API_KEY` so existing code paths work unchanged.

Model pinning: the secret value for `BEHAVIOR_AUDIT_MODEL` MUST be a fully qualified
model identifier (e.g., `anthropic/claude-3.5-sonnet`, not `claude`). Cloud models
deprecate; the secret is the single source of truth for which model is in rotation.

### 3. New preflight script `scripts/behavior-audit/preflight.ts`

Purpose: refuse to start a long audit against an unreachable or misconfigured gateway.

Behavior:

1. Read `BEHAVIOR_AUDIT_BASE_URL` and `BEHAVIOR_AUDIT_MODEL` from environment.
2. HTTP GET `${BASE_URL}/models` with `Authorization: Bearer ${OPENAI_API_KEY}`.
3. Expect a 200 with an OpenAI-compatible `{ data: [{ id: ... }] }` payload.
4. Verify `BEHAVIOR_AUDIT_MODEL` is present in the response's `data[].id` list.
5. Exit 0 on success with a one-line confirmation; exit 1 with a clear error message
   on any failure (network error, non-200, missing model, malformed JSON).

Failure cases the preflight catches:

- Missing `BEHAVIOR_AUDIT_BASE_URL` / `BEHAVIOR_AUDIT_API_KEY`.
- Gateway down (`ECONNREFUSED`, timeout).
- Gateway up but model unavailable (typo, deprecated model, wrong account).
- Gateway up but auth invalid (401, 403).

Implementation is a single Bun TypeScript file with no external dependencies beyond
what the audit already uses. Accepts `--verbose` flag to print full response bodies.

### 4. New publisher script `scripts/behavior-audit/publish-snapshot.ts`

Purpose: write the fresh `stories/` directory to the `audit-output` orphan branch and
update the `latest` moving tag.

Algorithm:

1. Locate `reports/audit-behavior/stories/` from the audit just completed. If the
   directory is missing or empty, exit 1 with `no audit output to publish`.
2. Resolve date stamp `YYYY-MM-DD` from the run start time (UTC).
3. Use `gh api` / `git` plumbing to check whether `audit-output` exists as a branch:
   - If no: create an orphan branch with a single initial commit.
   - If yes: fetch it into a detached worktree.
4. Replace the worktree's `stories/` directory wholesale with the new content.
   - Delete existing `stories/*` (so removed files don't accumulate).
   - Copy `reports/audit-behavior/stories/*` into `stories/`.
5. Stage and commit as `chore(audit): snapshot for ${DATE}`.
6. Force-push `audit-output`.
7. Move the `audit-output-latest` lightweight tag to the new commit. Consumers
   read the latest snapshot via `git show audit-output-latest:stories/index.md`
   (a tag points to a commit, so the `<tag>:<path>` syntax works directly). Tag
   is on the orphan branch only; never on `master`.

Why orphan branch (not `gh-pages`, not artifact):

- **History**: `git log audit-output -- stories/index.md` shows score evolution.
- **Diffability**: `git diff audit-output~7 audit-output -- stories/` answers
  "what changed in the last week".
- **No Jekyll / no build**: the orphan branch holds plain markdown, no rendering
  pipeline required. Viewable directly on GitHub.
- **No retention loss**: GitHub Actions artifacts expire (14 days default);
  orphan-branch history is durable until explicitly pruned.

### 5. No changes to the audit code itself

Tier 1 introduces two new scripts (`preflight.ts`, `publish-snapshot.ts`) and one new
workflow file. It does NOT modify any file under `scripts/behavior-audit/` that
participates in the audit pipeline. This is the key property that lets Tier 2 and
Tier 3 ship independently without coordination.

## Data Flow

```
┌────────────┐   03:00 UTC   ┌─────────────┐
│ cron trigger├──────────────►│ checkout + │
└────────────┘                │ bun install│
                              └──────┬──────┘
                                     │
                              ┌──────▼──────┐  fail   ┌──────────┐
                              │ preflight.ts├────────►│ stop run │
                              └──────┬──────┘         └──────────┘
                                     │ ok
                              ┌──────▼──────┐
                              │bun audit    │  writes reports/audit-behavior/
                              │   :behavior │         stories/*.md, index.md
                              └──────┬──────┘
                                     │
                              ┌──────▼──────────┐
                              │publish-snapshot │ force-push audit-output
                              │     .ts         │ move audit-output-latest tag
                              └─────────────────┘
```

## Error Handling

| Failure                         | Behavior                                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------------------- |
| Secret missing                  | Preflight exits 1 with `Error: BEHAVIOR_AUDIT_BASE_URL is not set`. No commit.            |
| Gateway unreachable             | Preflight exits 1 with `Error: gateway unreachable: <cause>`. No commit.                  |
| Gateway up, model unavailable   | Preflight exits 1 with `Error: model "<name>" not offered by gateway`. No commit.         |
| Gateway auth failure (401/403)  | Preflight exits 1 with `Error: auth rejected (HTTP 401)`. No commit.                      |
| Audit phase partially fails     | Existing retry/timeout logic in each agent. Surviving `stories/*.md` files are published. |
| Audit produces zero stories     | Publisher exits 1 with `no audit output to publish`. No commit.                           |
| Publisher `git push` fails      | Workflow fails. GitHub sends failure notification. Retried next night.                    |
| Concurrent nightly runs overlap | GitHub Actions cancels the older run via `concurrency: { group: behavior-audit }`.        |

The workflow uses `concurrency: { group: behavior-audit, cancel-in-progress: false }`
so a straggling run is not interrupted by the next night's trigger.

## Testing Strategy

### Preflight (`preflight.ts`)

Unit tests with a stubbed global `fetch`:

- 200 response, model present → exit 0, message printed.
- 200 response, model absent → exit 1, clear error.
- 200 response, malformed JSON → exit 1.
- 401 response → exit 1, "auth rejected".
- Network error (`fetch` throws) → exit 1, "gateway unreachable".
- Missing `BEHAVIOR_AUDIT_BASE_URL` env var → exit 1 before any fetch.
- Missing `BEHAVIOR_AUDIT_API_KEY` env var → exit 1 before any fetch.

Tests live in `tests/scripts/behavior-audit/preflight.test.ts`. Reuse the
`setMockFetch` / `restoreFetch` helpers from `tests/utils/test-helpers.ts`.

### Publisher (`publish-snapshot.ts`)

Unit tests for the pure helpers:

- Date-stamp formatter (UTC).
- Branch-name resolver.
- Commit-message builder (`chore(audit): snapshot for YYYY-MM-DD`).

The actual git operations are tested manually once on first run, in a sandbox repo
on a feature branch, before merging the workflow. A full integration test that pushes
to a real branch is not worth the CI complexity; the script is simple enough that
manual verification on first run suffices.

### End-to-end

The first successful nightly run after merge is the validation milestone. Acceptance
criteria:

- Workflow completes within 90 minutes for the full audit (assume ~800 test files).
- `audit-output` branch exists with at least one commit.
- `audit-output/stories/index.md` is non-empty and renders on GitHub.
- `audit-output-latest` tag points at the new commit.
- A second nightly run produces a second commit, distinct from the first.

## Files Touched

| File                                                    | Change |
| ------------------------------------------------------- | ------ |
| `.github/workflows/behavior-audit.yml`                  | new    |
| `scripts/behavior-audit/preflight.ts`                   | new    |
| `scripts/behavior-audit/publish-snapshot.ts`            | new    |
| `tests/scripts/behavior-audit/preflight.test.ts`        | new    |
| `tests/scripts/behavior-audit/publish-snapshot.test.ts` | new    |

No existing audit pipeline files are modified.

## Risks and Mitigations

### Cloud API cost

The nightly full recompute processes ~800 test files across 4 LLM phases. At
typical OpenRouter pricing on a mid-tier model this is on the order of $0.05–$0.50
per run, $1.50–$15/month.

- **Mitigation**: choose a cheap model for the secret initially (e.g.,
  `openai/gpt-4o-mini` or `anthropic/claude-3.5-haiku`). Tune up after observing
  quality.
- **Mitigation**: workflow is `workflow_dispatch`-triggerable for testing but only
  cron-scheduled otherwise — no per-PR spend.

### Model drift

Cloud models change behavior over time, which can shift scores independent of code
changes. Tier 3's trend column will be noisy across model-version boundaries.

- **Mitigation**: pin to a specific model string in the secret. Quarterly review.
- **Mitigation**: when the model is rotated, document the rotation in the
  `audit-output` branch as a commit `chore(audit): model rotation to <new>` with an
  empty stories diff, so trend-noise cause is discoverable.

### Secret rotation

Standard GitHub secret hygiene. Document the three required secrets
(`BEHAVIOR_AUDIT_BASE_URL`, `BEHAVIOR_AUDIT_MODEL`, `BEHAVIOR_AUDIT_API_KEY`) in
the repo's secrets README or onboarding doc.

### Orphan branch growth

Each nightly commit is roughly the size of `stories/` (~tens of KB of markdown).
After a year, the orphan branch has 365 commits and a few MB of git history.

- **Mitigation**: acceptable. GitHub handles this gracefully. If it ever becomes a
  problem, periodically squash the branch (lose history) or split into yearly
  branches.

### Force-push

`publish-snapshot.ts` force-pushes `audit-output`. This is safe because the branch
is an orphan with a single writer (the nightly job) and no consumers expect linear
history.

## Interactions with Other Tiers

### Tier 2 (concurrency + grep)

The workflow needs no change for Tier 2. Tier 2 introduces a `BEHAVIOR_AUDIT_CONCURRENCY`
env var; if a future nightly run wants higher concurrency, add the env var to the
workflow's `Run audit` step. No code or workflow-structure change required.

### Tier 3 (relative scoring + closure)

Tier 3 adds fields to `stories/*.md` and a new `stories/scores.json` sidecar. The
publisher copies `stories/` wholesale, so Tier 3's additions are picked up
automatically. The orphan branch then carries trend data useful to Tier 3's trend
column (Tier 3 reads prior snapshots via `git show audit-output@audit-output-latest:
stories/scores.json`).

## Related Decisions

- ADR-0114 — Behavior Audit Phase 2 Redesign
- ADR-0103 — Behavior Audit Keyword Consolidation
- ADR-0077 — Behavior Audit Implementation (referenced from 0114; not in tree)
- Spec `2026-04-27-behavior-audit-phase1-trust-design.md` — Phase 1 trustworthiness
  design (partially scaffolded in `extract-evidence.ts` family, not wired into
  pipeline; relevant context for Tier 3).

## References

- Research basis: behavior-audit workflow analysis conducted 2026-07-19.
- Pipeline entry point: `scripts/behavior-audit/index.ts`.
- Config: `scripts/behavior-audit/config.ts:56-57, 131-155`.
- CI conventions: `.github/workflows/ci.yml`.
