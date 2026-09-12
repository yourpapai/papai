# Behavior-safety test audit before restarting plugin-core separation (PR #166)

## Goal

Produce hard data on how well current **master** behavior is protected by tests, and a prioritized gap map, so the owner can decide whether PR #166 (`plugin-core-separation` branch — new `src/modules/`, `src/ports/`, `src/composition/`) can restart safely. Deliverable is **data and a gap map posted as an issue report** — no code, no test edits, no MR.

## Files to touch

None in production or tests. Ephemeral artifacts only, under ignored `reports/` (coverage lcov, test-run logs, mutation plan output). The audit report itself is posted to the issue thread. If findings deserve a permanent home (e.g. `docs/operations/test-strategy.md`), the report **proposes** it but does not create it.

## Intended behaviour change

None — research only. (`skip_specs` proposed because this is a research/analysis issue whose deliverable is a report, not a system behavior change; no capability is added, changed, or removed.)

## Audit plan (each finding cites its command/data)

1. **Refactor shape & staleness** — read the PR #166 head branch (referenced in `openspec/changes/plugin-core-separation-toolgate` and `hermetic-e2e-core-separation-proof` as `plugin-core-separation`): `git fetch origin`, `git log --oneline master..origin/plugin-core-separation`, `git diff --stat master...origin/plugin-core-separation`. Map its planned module separations onto current master modules (`src/plugins/`, `src/llm-orchestrator*`, chat providers, `src/ports/` if any) and date the divergence.
2. **Per-module coverage** — full-suite coverage with the repo's own ratchet tooling: `bun test:coverage` (budget ≥20 min shell timeout; wrapper demotes to serial under load), then `bun coverage:ratchet` (floor `scripts/coverage/floor.json` = 0.90 lines/functions, unweighted per-file mean). Parse the lcov report for a per-module line/branch table over `src/`, `plugins/`, `client/`, workspace roots; also run `bun test:stories:coverage` for the T0 story-lane floor (`scripts/story/coverage-floor.json`). Highlight weakest-covered modules the refactor touches/extracts.
3. **Test taxonomy** — classify `tests/` (181 entries) into hermetic units (DI seams), legacy `mock.module()`/delayed-import suites, integration (`tests/db/`, migrations, routes), and behavioral lanes: T0 `tests/stories/` (hermetic full-stack, `test:stories:contracts`), T1 `tests/e2e/` (Docker Kaneo), T2 `tests/smoke/`, T3 `tests/platform/` (nightly), `tests/operational/`, `tests/visual/`. Use `bun run test:audit` for per-file case/assertion data. Flag implementation-coupled tests (assert private internals, module-eval order, mock boundaries that die under refactor) vs behavior-pinning tests (assert user-observable contracts).
4. **Critical-path protection matrix** — for each user-facing path (message pipeline `bot-message-handler`, tool-call loop `llm-orchestrator-*`, response delivery, settings persistence + DB migrations, deferred-prompts scheduling/firing, opencode-agent phases, git/issue flows): name protecting tests and which lane goes red if broken; empty cells = gaps.
5. **Quality machinery** — mutation scope + per-module floors from `scripts/mutation/baseline.json` / `bun test:mutate:plan`, gate semantics (plan→shard→gate, ratchet rules), coverage floors, known flaky spots (JUnit basename collision, load demotion), full-suite and gate runtimes from `bun check:full` / persisted `reports/`.
6. **Prioritized gap map** — ordered by behavior criticality × refactor exposure; each gap one line on what a behavior-pinning test would assert (user-observable contract, never implementation).
7. **Verdict** — restart-safe now, or the minimum coverage additions that must land first.

## Verification

- Every number in the report is reproducible from a cited command (`test:coverage` + `coverage:ratchet`, `test:stories:coverage`, `test:mutate:plan`, `test:audit`, `check:full`, git log/diff).
- Report posted to issue #448; `git status` clean at the end (no modified production/test files, no commits).
- Constraints honored: existing scripts only, no new tooling, no test modifications; audit targets master, branch read only for intent/staleness.
