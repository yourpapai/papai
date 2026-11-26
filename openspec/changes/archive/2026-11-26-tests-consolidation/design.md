# Design — tests-consolidation

How the consolidation capability is implemented: the grouped-assertion mechanism, the fragmentation
audit, the pilot, and the gate interactions. Motivation and measured motivation-evidence
(~0.16 ms marginal runner cost per case, 47% single-assert share) are in
[`proposal.md`](proposal.md); binding requirements are in
[`specs/test-case-consolidation/spec.md`](specs/test-case-consolidation/spec.md) — this document does
not restate them.

## Context

The fragmentation measure — **1,499 files, 15,274 cases, 47.2% of cases wrap at most one assertion**
(v1 regex scan, see D3; proposal's wider count includes other lanes) — is taken over D3's audit scan
set, not the whole lane. The unit-test lane (default `bun test` discovery: `tests/**` minus
`tests/{stories,e2e,client,visual}/**` per `bunfig.toml`, plus the non-discovered `.smoke.ts`/
`.platform.ts` suffixes which belong to other lanes) carries 1,512 case-bearing `*.test.ts` files; the
scan set further drops `tests/{operational,smoke,platform}/**` (13 case-bearing files, per D3's lane
exclusions) and files with no counted case, yielding exactly 1,499 — the figure the audit's before-run
matches by construction.

Runner facts that constrain the mechanism, all verified on the pinned Bun 1.3.13:

- `expect.soft` **does not exist** (`TypeError: expect.soft is not a function`) — no native
  continue-on-failure assertion.
- `expect(value, message)` supports a custom message that appears verbatim in failure output.
- A catch-and-aggregate helper (per-row `try`/`catch` around the row's `expect` calls, one thrown
  `Error` listing every failed row with label + input + the matcher's Expected/Received diff) makes a
  grouped matrix register as **one runner case** while attributing failures per row — verified by probe.
- `test.each` rows each count as their own runner case (proposal-verified) — it is not consolidation.

Harness constraints:

- `tests/utils/test-helpers.ts`, `tests/utils/logger-mock.ts`, `tests/setup.ts`,
  `tests/mock-reset.ts`, `bunfig.toml` (plus `tests/stories/**`, `scripts/story/**`, and the frozen
  `scripts/coverage/` modules) are byte-frozen under the standing story-refactor qualification
  freeze — new shared test utilities must not edit them.
- Mutation score-cache fingerprints hash the content of candidate test files
  (`scripts/mutation/score-fingerprint.ts`), so editing a pilot test file invalidates the cached scores
  of the sources it covers — but the cache only matters for targets a run selects, and
  `test:mutate:changed` selects gateable implementation files from the branch diff only
  (`selectChangedMutationTargets` in `scripts/mutation/changed-files.ts`). A tests-only diff selects
  nothing: the pilot's mutation evidence is D5's explicit per-source runs, not the changed-file gate.
- `reports/` is gitignored; every check writes its evidence there.

## Goals / Non-Goals

**Goals:**

- A reusable, spec-compliant grouping mechanism (helper) that keeps every assertion, registers as one
  runner case, and names the failing case in the output.
- A read-only fragmentation audit that produces the per-file numbers the spec's rollout gate and
  follow-on changes cite.
- A bounded pilot on four deterministically selected pure-function suites that yields before/after
  evidence (case count, assertion count, wall time) for the "worth rolling out?" decision.
- Authoring guidance in `tests/CLAUDE.md` so agent authors stop producing per-value wrappers.

**Non-Goals:**

- No merging or deduplication of test *files* — the hypothesis is about case granularity; file layout
  is untouched.
- No runner, wrapper, or report-pipeline changes (owned by `lighter-unit-tests-under-load`); no gate
  changes of any kind.
- No DB, migration, runtime, or product-code changes; nothing under `src/`, `client/`, `plugins/`
  production code, or any frozen/harness file.
- No rollout beyond the pilot — that is spec-gated on audit evidence in follow-on changes.

## Decisions

### D1 — Grouping mechanism: one `test()` + a labeled aggregation helper

Each eligible group becomes a single `test('…matrix', …)` whose body calls
`assertEach(rows, run)` (name provisional): the helper executes rows **sequentially**, catches each
row's assertion error, and throws one aggregated `Error` — `[label] input…` followed by the matcher's
own Expected/Received text — when any row failed. This is the only mechanism found that satisfies all
three spec constraints at once (one runner case, every assertion preserved, per-case failure
identification with stable labels derived from row data).

Alternatives rejected:

- `test.each` — runner counts each row as a case (spec: "row generators are not consolidation").
- Bare sequential `expect`s in one test — first failure masks later cases; attribution depends on
  stack line numbers, not labels.
- `expect.soft` — not implemented in Bun 1.3.13 (verified).
- An external soft-assertion dependency — ~20 lines of helper replace it; violates the
  no-new-dependency-when-the-stack-covers-it rule.

### D2 — Helper lives in a new module `tests/utils/grouped-assertions.ts`

`assertEach<T>(rows: readonly Row<T>[], run: (row: T) => void | Promise<void>): Promise<void>` —
`Row<T>` carries `label: string` plus the case's fields; async `run` is awaited per row so async units
group too. **Not** added to `tests/utils/test-helpers.ts`: that file (plus `tests/utils/logger-mock.ts`,
`tests/setup.ts`, `tests/mock-reset.ts`, `bunfig.toml`) is byte-frozen under the standing story
refactor qualification freeze, and the pilot must not break or wait on any in-flight qualification. No existing helper covers the need — the
catalogued helpers (`schemaValidates`, `expectAppError`, …) assert single outcomes and none aggregates
labeled rows. A new file under `tests/utils/` is invisible to the qualification snapshot, which only
hashes the frozen set.

### D3 — Fragmentation audit: new `scripts/test-audit/` (read-only static analysis)

`scripts/test-audit/fragmentation.ts` (pure analysis: regex case/matcher counting over an injected
`read/scan/exists` deps interface, mirroring `scripts/test/import-graph.ts`'s DI-over-fs shape so it is
unit-testable against an in-memory file map) plus `cli.ts` (wires real fs, writes
`reports/test-audit/fragmentation.json`). `bun run test:audit` (name free in `package.json`). The scan
set is the unit lane minus `tests/operational/**`, `tests/smoke/**`, and `tests/platform/**`: those
trees' `*.test.ts` files (`tests/operational/catalog-crosscheck.test.ts`,
`tests/smoke/catalog-crosscheck.test.ts`, the smoke scenario/harness tests, and the platform
catalog-crosscheck/harness tests) are inside default `bun test` discovery (bunfig ignores only
stories/e2e/client/visual) yet belong to the operational, smoke, and platform-adapter lanes the spec's
Lane exclusions requirement bars from grouping — the audit must never present them as unit-lane
consolidation material.

Counting heuristic, applied identically before and after so comparisons are internally consistent:

- cases: `test(`/`it(` call sites with a literal first argument, plus `test.each(`/`it.each(` row
  generators counted at their literal row count when the first argument is a static array literal (1
  when computed) — the runner registers each row as its own case (proposal-verified), so an audit
  blind to row generators cannot see the case-count reduction of a row-generator → grouped rewrite;
- matcher calls per case: `expect(`, `node:assert` `assert.*(` calls, `schemaValidates(`,
  `expectAppError(` attributed to the enclosing case segment. This is a *textual* call-site count:
  in a grouped `assertEach` form, N per-row assertions execute through one shared callback, so the
  count drops by construction across a compliant rewrite. It is the fragmentation signal, never the
  preservation discriminator — preservation evidence is the row-by-row accounting of merged cases
  plus the mutation gate (spec wording pins this);
- report fields per file: case count, matcher-call count, single-or-zero-assert share; plus a
  `heuristicVersion` so a future counting change cannot silently invalidate old numbers.

Counting row-generator cases is a heuristic change: the Context and proposal figures were measured
under heuristic v1 (`test(`/`it(` only); v2 numbers are not comparable with them, and the
`heuristicVersion` bump records that. Residual imprecision (computed assertions in loops, computed row
lists, exotic matchers) shifts absolute shares slightly but never the *comparison*, and compliance with assertion preservation
rests on the spec's row-by-row accounting of merged cases plus the per-source mutation re-measure (D5),
not on the audit being a parser.

Alternatives rejected:

- Deriving counts from JUnit reports (`scripts/test/junit.ts`) — JUnit carries no per-case assertion
  counts, and the known basename-collision defect forbids building on `report.files`.
- A TypeScript AST parse — no established parser dependency exists in `scripts/` precedent (TS in the
  tree is the native v7 preview); the repo's established script pattern for static analysis is
  regex + DI (`import-graph.ts`, `mutation/changed-files.ts`), and decision-relevant precision does
  not need a parser.
- Extending `scripts/test/query.ts` — it queries *persisted run reports*; the audit reads *source
  files*. Different input, different lane; no existing module counts per-case assertions
  (`scripts/coverage` measures lcov, `scripts/mutation` measures scores).

### D4 — Pilot set: deterministic rule, four files

Selection rule (reproducible by the audit itself): unit-lane `.test.ts` files with ≥ 20 cases,
single-assert share ≥ 60%, pure-function heuristic (no `setupTestDb` / `mock.module` / `setMockFetch` /
`waitFor` / `setTimeout` / `spyOn`), ranked by single-assert case count, top 4:

| File | Single-assert / cases | Share |
| --- | --- | --- |
| `tests/plugins/task-provider-youtrack/classify-error.test.ts` | 63/77 | 82% |
| `tests/live-status/tool-status-labels.test.ts` | 42/43 | 98% |
| `tests/review-loop/summary.test.ts` | 38/56 | 68% |
| `tests/plugins/manifest-schema.test.ts` | 37/43 | 86% |

These are exactly the two files the proposal cites plus the next two by the same measure — one rule,
no curated list. All four are same-fixture, order-independent, exact-equality matrices (verified by
reading them), i.e. squarely inside the spec's eligibility requirement, including their boundary cases
(40/41-char truncation boundaries, fallback paths), which survive as rows. The ranking was derived
under heuristic v1; under v2's row-inclusive counting the audit may surface row-generator-heavy files
v1 could not see — those are follow-on candidates, and the pilot set stands as selected (only
`manifest-schema.test.ts` of the four contains `test.each`, so v2 can only grow its counted cases).

Alternatives rejected: hook-heavy files (`tests/auth.test.ts`, 5–11 ms/test) — higher expected payoff
but grouping eligibility around mock-reset/module-mock state is judgment-heavy; they belong to
evidence-gated follow-ons, not the pilot. `tests/opencode-agent/orchestrator.test.ts` (58 single-assert
cases) fails the share rule (21%) and mixes concerns.

### D5 — Gates: change nothing; mutation evidence is an explicit per-source re-measure

No floor, baseline, or threshold is touched — but the changed-file gate provides no mutation evidence
for this change by itself: `test:mutate:changed` selects only gateable implementation files present in
the branch diff (`selectChangedMutationTargets` in `scripts/mutation/changed-files.ts` filters the diff
through `isGateableImplFile`), and a consolidation-only diff contains none, so the run prints "No
changed mutation targets … nothing to measure" and exits green without measuring anything (the CI PR
job will do exactly that; expected, not a failure). The pilot therefore re-measures every source its
four test files cover explicitly — one `bun test:mutate:file <source>` per source over `src/errors.ts`,
`src/live-status/tool-status-labels.ts`, `src/plugins/types.ts`, `review-loop/src/summary.ts`,
`plugins/task-provider-youtrack/classify-error.ts`, and `plugins/task-provider-youtrack/client.ts` (the
value imports of the four pilot files — `classify-error.ts` is `classify-error.test.ts`'s primary unit
under test, reached through a multi-line import) — and records each
score in `tasks.md` against its `scripts/mutation/baseline.json` entry (`client.ts` has no entry:
first-touch, its score is recorded for the seed job; the binding bar of the six is
`review-loop/src/summary.ts` at 1 — a perfect score, so any lost kill in the `summary.test.ts` rewrite
fails the recorded comparison — followed by `src/errors.ts` at 0.9876 and
`src/live-status/tool-status-labels.ts` at 0.9764, with `classify-error.ts` at 0.949 and
`src/plugins/types.ts` at 0.57). The paired run's exit code gates on
`--threshold` (default 0), not on baselines, so the baseline comparison is part of the recorded
evidence rather than of the tool's exit status. Test-content fingerprints still matter where sources
*are* selected: on any branch whose diff also touches a pilot-covered source, the changed test hash
invalidates its cached score and forces a fresh measure.

Two ops consequences are budgeted up front: adding the `"test:audit"` script edits `package.json`,
which `score-fingerprint.ts` hashes whole into every source fingerprint — merging this change
one-time invalidates every carried-over mutation score, so each open branch's next mutation job
re-measures its full diff from a cold cache (safe direction; within the mutation job's existing
90-minute ceiling). And the `bun run test:slowest` deltas are taken against a pre-consolidation
full-suite baseline captured in Migration step 2 — `reports/` is gitignored, so no committed timing
artifact can exist and the before-run must be scheduled or the delta's before-half never materializes.

Coverage is verified by one full-suite `bun test:coverage` + `bun coverage:ratchet` run
before finishing — the run itself cannot be scoped to the pilot's sources (bun's coverage denominator
spans every discovered production file and the ratchet gates the aggregate floor, so a subset run
measures far below it); the pilot's coverage risk is confined to the pilot files' sources.
Before/after audit numbers (cases and share; the textual matcher-call count is recorded too but is
expected to drop by construction under grouping), the row-by-row accounting that every former case's
input/expected pair survived as a row, and the `test:slowest` deltas (vs the step-2 baseline) are
recorded in the change's `tasks.md` as the rollout evidence.

### D6 — Guidance: extend `tests/CLAUDE.md`, keep per-behavior as default

Add a "Grouped assertion tests" subsection: the `assertEach` pattern, the eligibility checklist
(same fixture, order-independent, no per-case isolation or timing dependence), the explicit
non-mechanisms (`test.each` is not consolidation), and the lane exclusions — naming
`tests/operational/**`, `tests/smoke/**`, and `tests/platform/**` explicitly, since those trees'
`*.test.ts` files sit inside default `bun test` discovery yet belong to the excluded operational,
smoke, and platform-adapter lanes. The subsection states one-test-per-behavior as the default — it is
currently only the de facto convention of the New Test File Pattern example, not documented guidance;
grouping is a sanctioned shape for same-fixture value matrices, not a new default. This is the durable
lever against re-fragmentation, since agent authoring is what produces per-value wrappers.

### Constraint confirmations (project rules)

- **Tool surface / capability gating**: none — test infrastructure only; no tool, plugin, or
  `tool_prefs` interaction.
- **Scope model**: no persisted runtime state anywhere. The audit report is a repo-level ignored
  artifact under `reports/test-audit/`; no storage-context, config-context, platform-instance, or
  user-scoped data exists in this change.
- **DB**: no schema or data changes; no drizzle migration.
- **New dependencies**: none — helper is plain `bun:test` + stdlib; audit uses Bun `Glob` + regex like
  `scripts/test/import-graph.ts`.
- **New modules**: justified in D2/D3 (no existing module covers labeled assertion aggregation or
  per-case assertion counting).
- **Hook/TDD interactions**: the Write/Edit TDD pipeline gates only impl files under the gateable
  source roots (`src/`, `client/`, `plugins/`, `review-loop/src/`, `sdd-runner/src/`; `scripts/` is
  not gateable), so it never fires for this change's edits; work still proceeds test-first — `tests/utils/grouped-assertions.test.ts`
  and `tests/scripts/test-audit/fragmentation.test.ts` are written before their implementations. The
  once-per-session doc-review stop hook will fire for `scripts/test-audit/` and `tests/CLAUDE.md`
  edits (advisory only). All new files carry the SPDX license header the pre-commit/full checks
  enforce.

## Risks / Trade-offs

- [Misjudged eligibility: an agent groups order-dependent or isolation-dependent cases] → the spec's
  eligibility requirement plus pilot files being verified pure matrices; the per-source mutation
  re-measure (D5) catches lost kills; review catches the rest. Follow-ons must cite audit evidence per file.
- [Grouping weakens matchers (exact → shape) to fit a table] → spec scenario makes it non-compliant;
  the row-by-row accounting of merged cases surfaces dropped or coarsened expectations; the
  per-source re-measure must clear its recorded baseline (D5).
- [A helper-level bug masks failures (e.g., swallowing non-assertion throws)] → the helper re-reports
  every caught error with its row label, and its own tests pin: multi-failure aggregation, label/input
  presence, async rows, non-assertion throw reporting, zero-failure pass-through.
- [First-failure diagnosability regression vs N separate cases] → verified probe output shows *all*
  failed rows with Expected/Received diffs, strictly more information than N separate first-failures.
- [Audit heuristic drift makes old numbers incomparable] → `heuristicVersion` in the report;
  before/after pairs must share a version.
- [Larger tests cost agent readers more context per file] → labels + one-row-per-case table shape keep
  row-level navigation; `tests/CLAUDE.md` guidance keeps grouping bounded to value matrices.
- [Pilot shows negligible payoff] → that is a valid outcome of the hypothesis test; the capability,
  audit, and guidance still stand, and rollout simply does not proceed (spec-gated).

## Migration Plan

1. Write `tests/utils/grouped-assertions.test.ts` (failing) → implement
   `tests/utils/grouped-assertions.ts`; `bun test tests/utils/grouped-assertions.test.ts`.
2. Write `tests/scripts/test-audit/fragmentation.test.ts` (failing) → implement
   `scripts/test-audit/fragmentation.ts` + `cli.ts`; add `"test:audit"` script; run it — the report's
   "before" numbers for the four pilot files are copied into `tasks.md`. Run one full `bun run test`
   before any rewrite and capture `bun run test:slowest` plus per-file `bun test <file>` timings for
   the four pilot files into `tasks.md`: `reports/` is gitignored, so this run is the only producer of
   the wall-time evidence's "before" half.
3. Consolidate the four pilot files one file at a time (eligibility check → `assertEach` rewrite →
   `bun test <file>` → re-run audit for that file: case count drops; every former case's input/expected
   pair is accounted for as a surviving row — the textual matcher-call count drops by construction and
   is recorded only as the fragmentation signal).
4. Full `bun run test`; then `bun test:coverage` + `bun coverage:ratchet`; then one
   `bun test:mutate:file <source>` per pilot-covered source with each recorded score compared against
   its `scripts/mutation/baseline.json` entry in `tasks.md` (no baseline adjustment); finally one
   `bun test:mutate:changed` run, expected to report "No changed mutation targets" on this tests-only
   diff — the mutation evidence is the per-source runs, not that green gate.
5. Update `tests/CLAUDE.md` (D6) and record after-numbers + `test:slowest` delta (vs the step-2
   baseline) in `tasks.md`.
6. Every new file gets the SPDX header; `bun check` before commit.

Rollback: plain `git revert` of the test-file rewrites — no runtime or config coupling; the audit
script and helper are additive and independently revertible.

## Open Questions

- Wire `test:audit` into CI as an informational (non-gating) job, or keep it a local/change-artifact
  tool? Deferrable: the spec gates rollout on cited numbers, not on a CI job.
- Should the audit later gain `test:status`-style query commands? Deferrable: reading the JSON
  artifact suffices for the pilot and any near-term follow-on.
