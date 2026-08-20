<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0327: CI Line-Coverage Floor — Custom Aggregate Gate over a JSON Floor File, Enforced by `coverage:ratchet` in `scripts/check.sh`

## Status

Accepted

## Date

2026-07-24

## Context

The in-process test suite's production-code coverage could silently decline in CI: nothing gated it, and every regression would be invisible until someone measured by hand. The goal was a hard CI gate with a floor that **ratchets upward** as coverage grows — never silently loosens, raised only from a green run, and never written by CI itself.

The original plan design assumed Bun's native `coverageThreshold` in `bunfig.toml` could enforce that aggregate floor: set the key to a baseline fraction and let bun gate on `--coverage` runs. During final review (recorded as errata in the plan, 2026-07-26), that assumption was measured to be false on Bun 1.3.13: `coverageThreshold` is a **per-file** rule — every covered file must individually clear the bar. On this repo 202 of 1108 covered files sit below 90% lines (two at 0.00%), so a per-file gate at any real baseline can never pass. The measurement that proved it: on a fixture whose worst file was 54.55% (pooled 58.33%, reported mean 77.27%), threshold `0.50` exited 0 and `0.56` exited 1 — 0.56 is above the per-file minimum but below both aggregate metrics, so only a per-file rule explains it. The `All files` row bun's text reporter prints is the unweighted per-file mean and has no bearing on the gate; the gate also **fails silently**, with no output naming coverage as the cause.

Source: plan `docs/superpowers/plans/2026-07-24-ci-line-coverage-floor.md` (with errata); design `docs/superpowers/specs/2026-07-24-ci-line-coverage-floor-design.md`.

## Decision Drivers

- **Aggregate, not per-file, semantics.** The floor must express "the suite's overall production-code coverage may not drop below X%", not "every file must be above X%" — the repo legitimately has low-covered files.
- **Ratchet, don't just gate.** When coverage improves, the floor must rise so gains are locked in; it must never lower itself.
- **CI never writes the floor.** The floor file changes only via a deliberate local command on a green run, committed by a human.
- **No extra CI suite run.** Coverage collection must piggyback `--coverage` onto the existing CI-serial `test` run inside `scripts/check.sh`; local `--parallel` `check:full` must stay unaffected.
- **Opt-in coverage.** `coverage = true` must never be set in bunfig — stories/e2e/smoke/client runs and local parallel checks must not pay for or be gated by coverage.
- **Gate failures must name coverage as the cause.** Bun's silent threshold failure mode is unacceptable for a CI gate.
- **The measured number must match the tool's own metric.** The ratchet computes the unweighted per-file mean so its output matches bun's own `All files` row exactly; pooled found/hit division would yield a different, lower number (measured: 92.32% mean vs 90.83% pooled lines).

## Considered Options

### Option 1 — Custom aggregate gate: JSON floor file + `coverage:ratchet` CLI enforced in `scripts/check.sh` (chosen)

Remove `coverageThreshold` from `bunfig.toml` entirely. Store the floor in `scripts/coverage/floor.json` (`{ lines, functions }`, 0..1 fractions, Zod-validated). Piggyback `--coverage` onto the CI-serial `bun test` run in `scripts/check.sh`; after a passing run, execute `bun coverage:ratchet` (`scripts/coverage/ratchet.ts`), which parses `reports/coverage/lcov.info` with `parseLcovTotals` (unweighted per-file mean) and exits 1 with an explicit "coverage below committed floor" message when measured < committed. Locally, `bun coverage:ratchet --update` computes `nextFloor(current, measured, epsilon = 0.005)` — `floor((measured - epsilon) * 100) / 100`, never below `current` — and rewrites `floor.json`. bunfig keeps reporter configuration only: `coverageReporter = ["text", "lcov"]`, `coverageDir = "reports/coverage"`.

- **Pros:** true aggregate semantics with an audible failure message; floor is a small reviewable JSON diff; ratchet math is pure and trivially testable (`ratchet-lib.ts` has no filesystem access); zero extra CI runtime (reuses the serial run's lcov); the local parallel branch is untouched.
- **Cons:** we own the parsing/gating code bun would otherwise provide; the gate is two commands deep in `check.sh` rather than a single bun feature, so the mechanism needs a comment (present at `scripts/check.sh:351-359`) to stop future editors "simplifying" it back to `coverageThreshold`.

### Option 2 — Bun's native `coverageThreshold` from `bunfig.toml` (rejected; the plan's original design)

Set `coverageThreshold = { lines = 0.90, functions = 0.90 }` and let bun gate `--coverage` runs natively.

- **Pros:** zero custom code; single-key configuration.
- **Cons:** measured to be a per-file rule — it gates every covered file individually, so it can never express the aggregate floor this repo needs (202 files below 90% would fail the suite immediately); fails silently with no coverage-named output; the plan was corrected in place via errata rather than shipping this.

### Option 3 — External coverage service (Coveralls/Codecov-style) or a separate CI coverage job (rejected)

Upload lcov to a hosted service that enforces a project-level threshold, or add a second CI job that reruns the suite with `--coverage`.

- **Pros:** hosted history/diff views; no in-repo gating code.
- **Cons:** a second suite run doubles CI time for the serial lane; an external service adds a network dependency, secrets, and egress to a repo whose gates are all local; the ratchet-stays-local requirement (CI never writes the floor) is trivially satisfied in-repo and awkward through a service.

## Decision

Implement Option 1:

- **`scripts/coverage/ratchet-lib.ts`** — pure functions: `parseLcovTotals` (unweighted per-file mean over records with `found > 0`, pooled `found`/`hit` retained for reporting), `parseFloor`/`serializeFloor` (Zod-validated 0..1 fractions; a percentage-shaped `90` is a contract violation, not a silent 0% gate), `nextFloor` (epsilon-buffered ratchet, monotone non-decreasing).
- **`scripts/coverage/floor.json`** — committed floor, starts at `0.90 / 0.90` (epsilon below the measured 92.32% / 91.16% baseline).
- **`scripts/coverage/ratchet.ts` + `coverage:ratchet` package script** — default `--check` mode exits 1 on regression; `--update` raises the floor from a green local run.
- **`scripts/check.sh`** — CI-serial branch runs `bun test --coverage --timeout 15000` (line 350) and then `bun coverage:ratchet` (line 360) only when the test run passed; the local `--parallel` branch carries no `--coverage`.
- **`bunfig.toml`** — reporter/dir config only, with a comment explaining why `coverageThreshold` is deliberately absent.
- **CI surfacing + docs** — `.github/workflows/ci.yml` uploads `reports/coverage/lcov.info` as the `coverage-lcov` artifact (`if: always()`, 14-day retention); `tests/CLAUDE.md` documents the floor and the ratchet workflow.

## Consequences

### Positive

- Coverage regressions fail CI audibly on the existing serial run, at zero additional CI cost.
- The floor is monotone: improvements are locked in via an explicit, reviewable `floor.json` diff; CI cannot weaken or raise it.
- The ratchet's number matches bun's own reported mean, so local measurement and CI gating never disagree about what "coverage" is.
- Local workflows are untouched: parallel `check:full` collects no coverage, and subset `bun test --coverage <file>` runs remain possible (and are documented as expected-to-fail against the full-suite floor).
- The errata process produced durable knowledge: `scripts/check.sh:351-359` and `bunfig.toml:22-27` both record why the "obvious" bun feature must not be reintroduced.

### Negative

- The repo maintains its own lcov parsing and gate logic that a runner feature could in principle provide; the parser must track lcov's record semantics (`end_of_record` flushing) correctly.
- The gate runs only on the CI-serial lane, so a coverage drop introduced in a lane that skips the serial run would surface later, not at commit time.
- `floor.json` is a second source of truth next to bunfig; future editors must know the floor does not live in `coverageThreshold` (mitigated by comments in both files).

### Risks

- Bun could change its coverage metric or lcov output, desynchronizing the ratchet from the runner. Mitigation: `parseLcovTotals` is pinned to the unweighted per-file mean bun prints, and `tests/scripts/coverage-ratchet.test.ts` locks the parsing contract.
- Someone could "simplify" the gate back to `coverageThreshold`. Mitigation: the per-file-rule trap is documented inline at both edit points and in this ADR.
- The provisional `0.90 / 0.90` floor sat below the real baseline until the blocked Item 5 tests went green; the post-implementation `coverage:ratchet --update` step was deferred by design, so the floor's tightness depended on that follow-up running.

## Implementation Notes

- The plan's Task 1 names changed during execution per the errata: `parseBunfigThreshold`/`applyThreshold` became `parseFloor`/`serializeFloor`; `parseLcovTotals` switched from pooled-count division to the unweighted per-file mean for the `pct` field.
- Task 3's bunfig edit shipped as reporter configuration only; the gate-mechanism verification was done on a clean scratch project (floor `0.99/0.99` exits 1; `0.10/0.10` exits 0 with lcov written), not the plan's original one-file subset run, which measured ~21% because bun's denominator spans every discovered production file.
- `tests/scripts/check.test.ts` asserts `check.sh` invokes `bun coverage:ratchet` on the CI branch and never on the local parallel branch.
- Verified in the codebase: `scripts/coverage/{ratchet-lib,ratchet}.ts`, `scripts/coverage/floor.json`, `package.json:52`, `scripts/check.sh:350-360`, `bunfig.toml:29-30`, `.github/workflows/ci.yml:96-101`, `tests/CLAUDE.md:149` (`### Coverage floor`).

## Related Decisions

- The sibling plan `docs/superpowers/plans/2026-07-24-t0-story-runner-coverage.md` reuses this machinery: `parseLcovTotals` is shared, and `coverage:ratchet:stories` applies the same JSON-floor ratchet pattern to the T0 story runner's `scripts/story/coverage-floor.json`.
- ADR-0315 (archive of the test-improvement roadmap) routes new test coverage through this floor.

## References

- Plan: `docs/superpowers/plans/2026-07-24-ci-line-coverage-floor.md` (including the 2026-07-26 errata correcting the `coverageThreshold` mechanism)
- Design: `docs/superpowers/specs/2026-07-24-ci-line-coverage-floor-design.md`
- Code: `scripts/coverage/ratchet-lib.ts`, `scripts/coverage/ratchet.ts`, `scripts/coverage/floor.json`, `scripts/check.sh`, `bunfig.toml`, `.github/workflows/ci.yml`, `tests/CLAUDE.md`
