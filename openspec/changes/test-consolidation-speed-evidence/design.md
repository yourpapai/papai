# Design — test-consolidation-speed-evidence

How the consolidation speed question gets answered with a number: a paired synthetic benchmark over
the real runner, joined to the audit's population counts. Motivation and the pilot's flat result are in
[`proposal.md`](proposal.md); binding requirements are in
[`specs/test-consolidation-speed-evidence/spec.md`](specs/test-consolidation-speed-evidence/spec.md) — this
document does not restate them.

## Context

Measured facts this design builds on:

- The pilot (change `tests-consolidation`, PR #356) consolidated four pure-function files: 226 runner
  cases → 8, every assertion verbatim, per-file wall time flat (~0.63–0.66 s before and after), full-suite
  wall flat — consistent with the proposal's ~0.16 ms/case runner-floor micro-benchmark.
- Hook-heavy suites are the hypothesized payoff: `tests/auth.test.ts` measured 0.15–0.36 s of in-test
  time beyond process spawn across 32 tests (~5–11 ms/test) in the `lighter-unit-tests-under-load`
  investigation.
- Population (measured on this tree, unit lane): 479 files use `setupTestDb` (4,709 cases in them,
  ~1,902 single-or-zero-assert); 711 files carry a `beforeEach` (7,666 cases); the lane totals 15,752
  audit cases. CI runs the suite serially (`scripts/check.sh`, `CI=true`), so serial in-test time is the
  runner-minutes that matter.
- Harness constraints carried over: `tests/utils/test-helpers.ts` & co. are byte-frozen (the benchmark
  may *call* `setupTestDb` from generated files but never edit it); `reports/` is gitignored and is where
  every check's evidence lives; `scripts/test-audit/` (audit) already establishes the regex+DI,
  injected-fs module shape and the `heuristicVersion` discipline.

The runner's own reporting is the timing instrument: bun emits per-test durations in its JUnit output
(the wrapper already persists JUnit at `reports/test/junit.xml`), so the benchmark can measure in-test
time without a wall-clock stopwatch around the process (which would include spawn noise).

## Goals / Non-Goals

**Goals:**

- A causal per-case marginal cost number per hook class, with dispersion, measured on the real runner —
  not inferred from per-file wall times.
- A reproducible decision number: "consolidating eligible hook-heavy cases saves ≈ X s = Y% of CI serial
  in-test time", joinable from persisted artifacts, with eligibility assumptions stated rather than
  hidden.
- TDD-built analysis code (generator + JUnit parsing + projection are pure functions over injected
  inputs; only the spawn-and-run step touches the world).

**Non-Goals:**

- No real-suite rewrites — rollout stays gated per the `test-case-consolidation` spec; this change
  produces evidence for that gate, it does not exercise it.
- No claim that parallel *wall* time equals serial savings — the projection reports against serial
  in-test time only, and says so.
- No new timing methodology beyond what the runner already reports (no e.g. `performance.mark`
  instrumentation inside test files).

## Decisions

### D1 — Benchmark shape: generated paired files, measured via the runner's JUnit durations

`scripts/test-audit/benchmark.ts` (CLI) generates, per hook class, a matched pair of `.test.ts` files
into an ignored directory (`reports/test-audit/bench/` — inside `reports/`, so gitignored and outside
`bun test`'s default `tests/` root; the audit's scan pattern `tests/**/*.test.ts` never sees it):

- **spread arm**: N per-value `test()` cases, each wrapped in the class's hook (`beforeEach` with cheap
  work / `setupTestDb()` / mock-heavy setup mirroring `auth.test.ts`'s shape);
- **grouped arm**: one `test()` containing the same N inputs as `assertEach` rows under the same hook
  paid once;

with identical assertions (exact `expect(...).toBe` on a pure function per row), identical imports, N
fixed (e.g. 100) and a small suite of filler rows so both arms import the same modules. It then runs
`bun test --reporter-outfile=junit.xml` on each arm (serially, repeats configurable, default ~5) and
derives per-case marginal cost = (spread in-test time − grouped in-test time) / N, reporting median ±
IQR per class into `reports/test-audit/benchmark.json` (carrying bun's version and the repeat count).

Hook classes are generated against the **real** frozen helpers where they exist (`setupTestDb` from
`tests/utils/test-helpers.ts` imported into the generated file — using it is not editing it), and
synthetic stand-ins for the cheap-mock and mock-heavy classes (`mockLogger()` is also importable; the
mock-heavy class synthesizes `mock.module`-style setup only if importable helpers can express it —
otherwise a documented synthetic equivalent, stated in the report).

*Why JUnit durations and not `process.hrtime` around the run:* spawn/load noise dominates at these
scales; in-test durations are the runner's own accounting of where time went, they are what
`test:slowest` already trusts, and they sum to the serial runner-minutes CI pays.

*Why generated files under `reports/` and not `tests/bench/`:* the spec bars generated files from
discovery and from the audit scan set; `reports/` is the repo's established ignored-evidence tree and
needs no bunfig change (editing `bunfig.toml` is frozen-adjacent and would touch runner config).

*Alternatives rejected:* instrumenting real hook-heavy suites in place (that **is** the rollout —
eligibility judgment first, evidence gate applies, wrong order for a measurement); timing bare
functions outside the runner (measures the fixture, not the per-case runner overhead — the thing
consolidation removes).

### D2 — Projection: join benchmark costs to audit population, eligibility explicit

`scripts/test-audit/project.ts` (CLI, reads `benchmark.json` + `fragmentation.json`, both persisted)
computes per hook class:

```
candidates = Σ caseCount over audit files whose source matches the class's hook signature
             (rg-class detection: setupTestDb / beforeEach / mock.module presence, same
              exclusion set as the audit)
eligible   = candidates × eligibility fraction
savings    = eligible × per-case marginal cost (benchmark median)
projected  = Σ savings vs the serial suite's total in-test time (from reports/test/last-run.json)
```

The eligibility fraction is **not** invented per class: the tool reports two bounds —

- **upper bound**: all single-or-zero-assert cases in hook-bearing files (everything *could* group);
- **lower bound**: zero (pessimistic floor = no eligible cases without per-file review);

and a **stated midpoint heuristic** (e.g. same-fixture exact-equality shape detectable statically, the
D4 selection rule from `tests-consolidation`: no `waitFor`/`setTimeout`/`spyOn`/stateful mock resets in
the case segment) whose assumptions print alongside the number. Populations the static signals cannot
clear are reported as "requires per-file eligibility review" with their case counts — per the spec, they
are named, never silently folded into savings.

*Why bounds + heuristic rather than one number:* the honest decision variable is a range; a point
estimate invites treating judgment as measurement. The pilot's D4 rule already exists as the sanctioned
static heuristic, so the midpoint is not new policy.

### D3 — Harness is analysis-pure; only the spawn step touches the world

Generator, JUnit parsing, and projection are pure functions (string/file-map in → structures out),
unit-tested under `tests/scripts/test-audit/benchmark.test.ts` against in-memory inputs, mirroring the
audit's DI shape (`AuditDeps`-style injected fs; a `RunDeps` seam for "run bun test on this file,
return JUnit text" so tests never spawn). The CLI wires real fs + `Bun.spawn`. SPDX headers, `u`-flag
regexes, explicit return types, ≤50-line functions — the usual gates apply; `scripts/` is not a gateable
TDD root, but the work is still test-first.

### D4 — What the pilot's speed evidence becomes

The change records, in its `tasks.md`: per-class benchmark table (median ± IQR), the projection's
bounds and heuristic midpoint, and the explicit statement of what the pilot already measured (pure
class ≈ 0; the grouped mechanism itself is free). The pair (pilot result + this benchmark) is the
"worth rolling out?" evidence the `tests-consolidation` spec's rollout requirement asks follow-on
changes to cite. If the benchmark says hook-class cost is near the runner floor (< ~1 ms/case), the
projection will show single-digit seconds and the recorded conclusion is "not worth rolling out for
speed" — a valid outcome, not a failure.

## Risks / Trade-offs

- [Synthetic setup overstates/understates real hook cost] → the mock-heavy and cheap classes are
  calibrated against one real anchor (`auth.test.ts`'s measured 5–11 ms/test) and the report names each
  class's fixture source (frozen real helper vs synthetic stand-in); interpretation stays per-class.
- [Grouping changes what hooks do (beforeEach per case vs once per group) — is that a fair pairing?]
  → that asymmetry **is** the measured quantity: it is exactly what a real consolidation pays
  differently. The spec's eligibility rules (shareable fixture) define when the paired shape is
  legitimate in reality; the benchmark measures its value when it is.
- [JUnit parsing is a new surface; the known basename-collision defect forbids building on
  `report.files`] → the benchmark parses its **own generated arms'** JUnit (fresh files, one file per
  run, no collision surface), never the full-suite report; parsing is pure and unit-tested.
- [`reports/test-audit/bench/**` discovered accidentally by some future glob] → it sits under
  `reports/`, which no test lane scans; the audit's own scan pattern is `tests/**`; a test asserts the
  generated tree's path is outside both (spec scenario).
- [package.json edit invalidates mutation score caches repo-wide (one-time)] → budgeted up front, same
  as `tests-consolidation`'s `test:audit` edit; safe direction (re-measure from cold cache).
- [Benchmark flakes on a loaded host distort medians] → repeats with median ± IQR (not mean), serial
  execution, and the shared-host rule applies (run when load is low); the report records the host's
  load shape for context.

## Migration Plan

1. TDD the generator + JUnit parser + projection (`tests/scripts/test-audit/benchmark.test.ts` red →
   implement in `scripts/test-audit/benchmark.ts` / `project.ts`).
2. Wire CLIs (`benchmark.ts` run+parse, `project.ts` join), add `"test:benchmark"` (and reuse for
   projection: `bun run test:benchmark -- --project`) to `package.json`; run on a quiet host; persist
   `benchmark.json` + projection output.
3. Record results and the go/no-go reading in the change's `tasks.md`; cite the pair (pilot flat,
   per-class costs) for any future rollout change.
4. `bun check` before commit; SPDX on every new file.

Rollback: additive scripts; `git revert` removes them. No suite, gate, or runtime coupling.

## Open Questions

- Should the benchmark also emit a machine-readable comparison against `test:slowest` per-file totals
  (sanity anchor), or is the JUnit-internal measurement sufficient? Deferrable — does not change the
  harness shape.
- CI wiring (informational job persisting `benchmark.json` per merge-base) — deferrable, mirrors the
  `test:audit` open question; the spec requires reproducibility from artifacts, not a CI job.
