# tests-consolidation

## Why

The suite carries ~17.1k `bun:test` cases across 1,743 files; 47% (8,102) wrap **at most one assertion each** — e.g. `tests/live-status/tool-status-labels.test.ts` (42/43 single-assert), `tests/plugins/task-provider-youtrack/classify-error.test.ts` (63/77). The hypothesis verifies as fragmentation, but its "much more efficient" claim is bounded by measurement: a controlled micro-benchmark (identical 1,000 assertions, same imports) shows only ~0.16 ms marginal runner cost per case — under 2% of the 3–4 min suite — while hook-heavy suites pay 5–11 ms/test (`tests/auth.test.ts`: 32 tests, 0.15–0.36 s beyond process spawn) and agents pay the reading/writing cost of 17k per-value wrappers. `lighter-unit-tests-under-load` fixed runner-level efficiency and explicitly left test count out of scope; granularity is the remaining lever, and agent authoring keeps adding per-value cases.

## What Changes

- New capability `test-case-consolidation` (below): rules for grouping same-fixture assertion matrices into one test without losing assertions or failure diagnosability.
- Consolidation pilot on a bounded set of top fragmented pure-function suites (e.g. the two files cited above plus the next two by the same selection rule; design D4 pins all four), preserving **every** assertion.
- A fragmentation audit metric (script + persisted report): single-assert share per file, gating any rollout beyond the pilot.
- `tests/CLAUDE.md` gains the grouped-assertion authoring pattern, stating the one-test-per-behavior default explicitly (today it is only the de facto convention of the New Test File Pattern, not documented guidance).
- All quality gates unchanged: coverage floor, mutation baseline, story lanes.

## Capabilities

### New Capabilities

- `test-case-consolidation`: governs when multiple assertions may share one test case — assertion preservation (consolidation SHALL NOT drop or weaken assertions), per-case failure context (each grouped case SHALL identify itself in the failure output), and scope (grouping only for cases sharing a fixture with order-independent assertions; forbidden in isolation-sensitive or timing-dependent suites).
  - Without it, nothing stops an agent "reducing test count" from silently dropping assertions — the aggregate coverage floor and changed-file mutation gate cannot catch small drops — and grouped-test failures degrade to anonymous first-failure stops. No existing spec covers authoring granularity: `openspec/specs/mutation-gate` governs score gating; `test-wrapper`/`test-hermeticity` (change `lighter-unit-tests-under-load`) govern execution and host-independence — how tests run, not how they are shaped.

### Modified Capabilities

- None. `mutation-gate` requirements are untouched; a tests-only consolidation diff selects no changed-file mutation target, so each consolidation change explicitly re-measures its covered sources (per-file paired runs) against the existing baselines where an entry exists; first-touch sources with no entry record their score to seed a future baseline, without exemption from the re-measure.

## Impact

- Code: pilot test files under `tests/`; new helper `tests/utils/grouped-assertions.ts` plus its test; `tests/CLAUDE.md`; audit modules `scripts/test-audit/fragmentation.ts` + `cli.ts`; `package.json` gains the `test:audit` script (whose one-time repo-wide mutation-cache invalidation design D5 budgets).
- No runtime/product code. No platform or task instances affected; no config-context scope impact (not per-user, group-shared, or thread-isolated — test suite only).
- No `docs/architecture/*.md` content changes; no existing spec under `openspec/specs/` is modified.
- `test.each` is not a consolidation mechanism (verified: each row still counts as one case) — grouping means table/loop inside a single test.

## Non-goals

- No deletion or weakening of assertions, coverage floors, or mutation baselines — declined in `lighter-unit-tests-under-load` and still declined.
- No changes to `tests/stories/**` (frozen by refactor qualification), E2E, or platform lanes; no runner/wrapper changes (owned by `lighter-unit-tests-under-load`).
- No blanket rewrite of stable legacy suites (`tests/CLAUDE.md` reality check stands).
- No wall-time target: evidence shows case-count alone saves <2%; the expected value is hook amortization in DB/mock-heavy suites plus agent maintenance cost, to be quantified by the pilot before any rollout.
