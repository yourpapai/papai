# Design: Behavior-safety test audit before restarting plugin-core separation

## Context

Master already carries substantial quality machinery: `bun test:coverage` + `bun coverage:ratchet` (floor `scripts/coverage/floor.json`, 0.90 lines/functions, unweighted per-file mean), the T0 story-lane floor (`scripts/story/coverage-floor.json` via `bun test:stories:coverage`), the Stryker per-file ratchet (`scripts/mutation/baseline.json`, sharded `test:mutate:plan/:shard/:gate`), `bun run test:audit` (per-file case/assertion fragmentation), and persisted run evidence (`reports/test/last-run.json`, `reports/checks/<name>.log` from `bun check:full`). The test surface spans hermetic DI units, legacy `mock.module()` suites, DB/routes integration, and behavioral lanes T0–T3 (see proposal.md — Audit plan item 3).

PR #166 (`origin/plugin-core-separation`, planned `src/modules/`, `src/ports/`, `src/composition/`) is read-only input for intent and staleness — never the audit target. This change writes no production or test code (see proposal.md — Why / Files to touch); the deliverable is a reproducible report posted to issue #448. Shaping constraints: existing scripts only, no new tooling, no test modifications, everything ephemeral under gitignored `reports/` (`.gitignore:45`), `git status` clean at the end.

## Goals / Non-Goals

**Goals:**

- Every number in the report reproducible from one cited command; all follow-up questions answered by reading persisted `reports/`, not re-running.
- Execution order cheap → expensive so a late timeout still leaves partial evidence on disk.
- Protection matrix with explicit empty-cell = gap semantics, and a gap map phrased entirely as user-observable contracts.
- A verdict rule that is mechanical, not vibes: green floors + no empty cell on extracted paths ⇒ restart-safe.

**Non-Goals:**

- No code, test, script, dependency, or config changes; no permanent docs (the report *proposes* `docs/operations/test-strategy.md`, does not create it).
- No spec deltas (`skip_specs` — fix/research-class change).
- No mutation *measurement* — scope and floors only; running Stryker is out of audit budget.
- No checkout, build, or execution of the PR branch.

## Decisions

### D1: Measure master with the repo's own scripts; zero new tooling

Everything the audit needs already exists: `bun test:coverage` (self-builds client bundles, then `bun test --coverage`), `bun coverage:ratchet`, `bun test:stories:coverage`, `bun test:mutate:plan` (plan mode emits scope + per-module floors without measuring), `bun run test:audit`, `bun check:full`, and the query CLIs (`test:status`, `test:slowest`) over persisted reports.

- *New-module question (one level in):* none to introduce. `scripts/coverage/ratchet.ts` + `normalize-lcov.ts` are the repo-canonical lcov semantics (they are frozen inputs of the hermetic-story qualification, so their parsing is pinned); `scripts/test-audit/cli.ts` covers taxonomy data; `scripts/mutation/shard-main.ts plan` covers mutation scope. A bespoke lcov parser or analysis script would duplicate these and violate the "existing scripts only" constraint — rejected.
- *Dependencies:* none added. Bun's built-in coverage plus these scripts cover the need; nothing in the AI SDK / Grammy / discord.js / Zod / drizzle stack is touched or relevant.

### D2: Evidence pipeline, cheapest-first, full suite once

1. **Staleness first (seconds):** `git fetch origin`; `git log --oneline master..origin/plugin-core-separation`; `git diff --stat master...origin/plugin-core-separation`. Date the divergence and map planned extractions onto current master modules (`src/plugins/`, `src/llm-orchestrator*`, chat providers).
2. **Static taxonomy (sub-second):** `bun run test:audit` for per-file case/assertion data; classify lanes from directory layout + `bunfig.toml` exclusions.
3. **Expensive runs, one pass each, in cost order:** `bun test:coverage` (≥20 min shell timeout; wrapper demotes to serial under load) → `bun coverage:ratchet` (verdict vs floor) → `bun test:stories:coverage` → `bun test:mutate:plan`.
4. **Runtime/flakiness evidence from persistence, not re-runs:** `bun run test:slowest` / `reports/checks/*.log` for gate and suite runtimes; known flaky spots (JUnit basename collision, load demotion) documented from existing notes, never reproduced.

Rationale: coverage is the only multi-minute leg; everything cheap before it means a timeout still leaves items 1–2 complete. Alternative — running legs in parallel — rejected: shared-host rules forbid concurrent full suites.

### D3: Branch analysis is metadata-only

Read the PR branch exclusively through git object access (log/diff against the fetched ref). Never check out, build, or run its code. Rationale: the proposal scopes the branch to intent/staleness, and executing it would invalidate the master-only coverage numbers and risk a dirty worktree. The module-separation map (which master files each planned extraction touches) is derived from `git diff --stat` plus reading the two change folders that reference the branch (`plugin-core-separation-toolgate`, `hermetic-e2e-core-separation-proof`).

### D4: One ignored markdown report, posted via `gh`

Assemble the report section-by-section into `reports/audit/issue-448/behavior-safety-audit.md`, one section per audit-plan item 1–7 from proposal.md, then post with `gh issue comment 448 --body-file reports/audit/issue-448/behavior-safety-audit.md` (repo inferred from `origin`; `GH_TOKEN` already present in CI). If `gh` or a token is unavailable on the host, leave the file in place and hand posting to the owner — do not install anything.

Header carries the exact `master` and `origin/plugin-core-separation` SHAs so every git-derived number is pinned. End state verified with `git status` (clean) and a self-check that every table cell traces to a cited command. Alternatives: a PR with the report (rejected — proposal says no MR); a committed doc (rejected — report only *proposes* a permanent home).

### D5: Gap scoring and mechanical verdict

Each gap is scored `criticality × refactor exposure`: criticality from the protection-matrix path rank (user-facing message pipeline, tool-call loop, delivery, settings/migrations, deferred prompts, agent phases), exposure from D3's map (does PR #166 extract or move this module). Every gap line names the behavior-pinning assertion — the user-observable contract a new test would pin, never an internal. Verdict rule: restart-safe requires (a) both coverage floors green under their ratchets *and* (b) no empty protection-matrix cell for a path the branch extracts; otherwise the verdict is the ordered minimum-additions list, each item one testable contract.

## Risks / Trade-offs

- [Coverage run exceeds shell timeout or flakes under shared-host load] → budget ≥20 min, prefer serial, consult `bun run test:status` before any restart, re-run file-by-file only for load-induced flakes.
- [GitHub comment length cap (~65k chars) truncates the report] → compact tables, split into ordered follow-up comments referencing the first, keep the full file under `reports/audit/`.
- [`test:mutate:plan` sizes work but measures nothing] → the report treats `scripts/mutation/baseline.json` per-file records as the quality data and says so explicitly; no Stryker measurement run.
- [lcov misread] → parse only through the repo's `normalize-lcov.ts` path (same code the ratchet consumes), never a bespoke parser.
- [Branch data goes stale while the report is reviewed] → SHAs pinned in the report header; divergence dated explicitly.
- [Report-only deliverable rots in an issue thread] → every number stays re-derivable from cited commands; verdict section proposes the permanent home and the follow-up change.

## Migration Plan

None — no code, DB, config, or dependency changes to deploy or roll back. The only persistent artifact is the issue comment on #448; "rollback" is a corrective comment, with the source markdown retained locally under ignored `reports/audit/` for regeneration.

## Rules impact (planning-scope statements)

- **Tool surface / tool-prefs gating:** none — the audit runs as shell invocations of existing bun scripts, not as LLM tools; no capability-catalog entry, no `tool_prefs` key, no preset change.
- **Scope model:** no new persisted state; nothing keyed by storage context id, config context id, platform instance id, or user id. `reports/**` artifacts are host-local gitignored build outputs (same class as `reports/test/`, `reports/stories/`); the issue comment lives GitHub-side, keyed by issue number.
- **DB:** no drizzle migration, no backfill — nothing touches SQLite.
- **Hooks / TDD:** the Write/Edit TDD pipeline gates only gateable impl files (`src/`, `client/`, `plugins/`, `review-loop/src/`, `opencode-agent/src/`). This change writes only planning artifacts (`openspec/changes/behavior-safety-test-audit/*`) and ignored `reports/audit/**` — all pass through ungated; the test-first nudge, test tracker, and import gate have no surface here. Test-first order of work does not apply *inside* this change; the gap map is deliberately the test-first *input* for the follow-up coverage change(s) the verdict proposes.

## Open Questions

None — the audit plan in proposal.md fixes scope, commands, and deliverable; the remaining unknowns (which gaps exist, what the verdict is) are the output of the work, not inputs to it.
