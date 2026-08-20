<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0329: T0 Story-Runner Line Coverage — Opt-In `--coverage` Collection with SF-Normalized Lcov and a Ratcheting JSON Floor Gate

## Status

Accepted

## Date

2026-07-24

## Context

The T0 hermetic story lane (one sandboxed `bun test` child over all story files, per ADR-0225/0283/0286) is the refactor-resilient test tier, but nothing measured which `src/` lines the stories actually reach. The in-process suite got its own aggregate coverage floor in ADR-0327, yet that number says nothing about the story lane: the story child runs in a Docker sandbox against a frozen snapshot with its own `snapshot-bunfig.toml`, so its coverage had to be collected inside the sandbox and carried out across the container boundary.

Two hard constraints shaped the design. First, coverage must be **opt-in**: the default `bun test:stories` run had to remain byte-for-byte unchanged in behavior, so no runner could pay the coverage cost or be gated by it unless it asked. Second, the lcov the child writes uses **container-absolute `SF:` paths** (`/session/app/src/...`), which are meaningless on the host — any gate consuming that lcov on the host needs repo-relative paths.

Item 1 (ADR-0327) had already landed `scripts/coverage/ratchet-lib.ts` with `parseLcovTotals`, `nextFloor`, and the `CoverageMetric` type (0..1 fractions); this plan is explicitly a consumer of that library, not a reinvention.

Source: plan `docs/superpowers/plans/2026-07-24-t0-story-runner-coverage.md`.

## Decision Drivers

- **Opt-in collection.** `--coverage` is a runner-level flag; without it the child command, the session lifecycle, and the exit code are exactly as before.
- **Aggregate, not per-file, gate semantics.** Reuses ADR-0327's measured finding that bun's `coverageThreshold` is a per-file rule and cannot express an aggregate floor.
- **Host-meaningful artifacts.** The lcov copied to `reports/stories/coverage/lcov.info` must carry repo-relative `SF:` paths so tooling, diffs, and humans can read it.
- **Single-child reality.** The story runner spawns exactly one sandboxed child, so there is one lcov — no multi-file merge machinery.
- **Ratchet, don't just gate.** The committed floor (`scripts/story/coverage-floor.json`, 0..1 fractions) only rises, from a green local run via an explicit command; CI never writes it.
- **Preserve the child's failure signal.** When the child already failed, its exit code wins; a below-floor coverage result can only turn a green child run red, never mask a red one.
- **Missing lcov is a warning, not a failure.** If the child produced no coverage file, the run warns and keeps the child's exit code rather than failing on an absent artifact.

## Considered Options

### Option 1 — Opt-in runner flag + in-sandbox lcov + copy/normalize + shared-lib gate and ratchet (chosen)

`--coverage` on the runner makes the child `bun test` append `--coverage --coverage-reporter=lcov --coverage-dir=<tempRoot>/coverage`; the sandbox translator maps the host temp path to `/session/tmp/coverage` exactly as it already does for `--config=` and `--reporter-outfile=`. After the run, `session.copyCoverage()` copies the lcov out through the existing safe-copy machinery with `normalizeLcov` applied (strips `/session/app/` and `./` prefixes from `SF:` lines) to `reports/stories/coverage/lcov.info`, returning `false` when no lcov exists. `gateStoryCoverage` then parses totals with `parseLcovTotals`, compares against the Zod-validated `coverage-floor.json`, prints a formatted summary, and returns exit 1 only when below floor and the child exited 0. `bun coverage:ratchet:stories` (`scripts/coverage/ratchet-stories.ts`) raises the floor via `nextFloor(current, measured, epsilon = 0.005)`, never lowering it. The CI `stories` job runs `bun test:stories:coverage`; the existing `reports/stories/**` artifact upload already captures the lcov.

- **Pros:** zero cost to the default story run; reuses the proven ratchet math, floor format, and safe-copy guarantees from Item 1; the gate failure message names coverage and the failing metric; one lcov means no merge step; the floor diff is a tiny reviewable JSON change.
- **Cons:** a second coverage-floor JSON to keep in mind next to ADR-0327's `scripts/coverage/floor.json`; the copy path adds one more privilege-sensitive file operation to the session lifecycle (mitigated by reusing the existing `copyReport` hardening rather than writing a new copier).

### Option 2 — Always-on coverage in the story lane (rejected)

Set coverage flags unconditionally in the child's bun invocation so every story run collects and gates.

- **Pros:** no flag plumbing; nothing to forget locally.
- **Cons:** violates the opt-in constraint — the default `bun test:stories` behavior must remain byte-for-byte unchanged; coverage instrumentation slows the child run everyone executes, and a provisional floor would gate runs that never asked for it.

### Option 3 — Bun's native `coverageThreshold` in `snapshot-bunfig.toml` (rejected)

Add a threshold key to the story child's bunfig and let bun gate inside the sandbox.

- **Pros:** no gate code in the runner.
- **Cons:** measured in ADR-0327 to be a per-file rule that fails silently with no coverage-named output — it cannot express the aggregate floor and its failure mode is unacceptable for CI; the story bunfig must stay a frozen minimal snapshot, not accumulate gate policy.

### Option 4 — External coverage service or a separate CI coverage job (rejected)

Upload the story lcov to a hosted service for thresholding, or add a second CI job that reruns stories with coverage.

- **Pros:** hosted trend views; no in-repo gate.
- **Cons:** doubles the story lane's CI time or adds a network/secrets dependency to a repo whose gates are all local; the "CI never writes the floor" ratchet contract is trivial in-repo and awkward through a service (same reasoning as ADR-0327 Option 3).

## Decision

Implement Option 1:

- **`scripts/coverage/normalize-lcov.ts`** — `normalizeLcov(text)` rewrites `SF:` lines to repo-relative paths (strips `/session/app/` and `./`); all other lines pass through.
- **`scripts/coverage/story-coverage-gate.ts`** — `STORY_COVERAGE_FLOOR_PATH`, Zod-validated `parseCoverageFloor`/`readCoverageFloor` (fractions in `[0,1]`), `evaluateStoryCoverage` (per-metric pass/fail against the floor), `formatStoryCoverageEvaluation` (prints percentages and names failing metrics).
- **`scripts/story/coverage-floor.json`** — committed floor, starts provisional at `0.50 / 0.50` because the number was unmeasured; the real baseline is locked by a later ratchet run once the suite is green.
- **`scripts/story/cli.ts`** — `ParsedStoryRunnerArguments.coverage: boolean` (default `false`); `--coverage` is consumed by the runner and never forwarded to the child verbatim.
- **`scripts/story/sandbox.ts`** — `translateLinuxCommandArgument` rewrites `--coverage-dir=` values into the container temp path, alongside `--config=` and `--reporter-outfile=`.
- **`scripts/story/child.ts`** — `childCommand` appends `--coverage --coverage-reporter=lcov --coverage-dir=<tempRoot>/coverage` before the file list when `parsed.coverage` is set.
- **`scripts/story/reports.ts` + `session.ts`** — `STORY_COVERAGE_LCOV_PATH = 'reports/stories/coverage/lcov.info'`; `copyStoryCoverage` (existence check via `lstat`, then the hardened `copyReport` with a `normalizeLcov` transform); `StoryRunnerSession.copyCoverage(): Promise<boolean>`.
- **`scripts/story/coverage-gate.ts` + `test-stories.ts`** — post-child wiring: `if (!parsed.coverage) return exitCode`, otherwise copy, parse, print, and force exit 1 on below-floor green runs; warn-and-passthrough when no lcov was produced.
- **`scripts/coverage/ratchet-stories.ts` + `coverage:ratchet:stories`** — local-only ratchet rewriting `coverage-floor.json` when measured coverage (minus `0.005` epsilon) exceeds the current floor.
- **CI + docs** — the `stories` job runs `bun test:stories:coverage`; `tests/CLAUDE.md` documents the floor, the ratchet workflow, and the independence from the in-process bunfig floor.

## Consequences

### Positive

- The T0 lane has its own reachability number, gated in CI at zero extra CI cost (the same sandboxed run, plus flags).
- Coverage is genuinely opt-in: the default story run's command line, lifecycle, and exit semantics are unchanged.
- The published lcov is repo-relative and human-readable, and lands in the existing `reports/stories/**` artifact upload with no new CI wiring.
- The floor is monotone and human-controlled: CI can only enforce it, never move it; improvements are locked in via an explicit reviewable JSON diff.
- Ratchet math, floor parsing, and lcov totals are shared with ADR-0327, so both floors speak the same 0..1-fraction language and the same per-file-mean metric.

### Negative

- Two coverage floors now exist (`scripts/coverage/floor.json` for the in-process suite, `scripts/story/coverage-floor.json` for stories); editors must know which one a given lane enforces (mitigated by `tests/CLAUDE.md` documenting both).
- The gate runs only in the `stories` CI job, so a story-reachability drop introduced where that job is skipped surfaces later, not at commit time.
- The provisional `0.50 / 0.50` floor is deliberately loose; its tightness depends on the deferred post-implementation ratchet running once the suite is green.

### Risks

- Bun could change its lcov output or the `--coverage-dir` flag shape, silently desynchronizing collection from the gate. Mitigation: `tests/scripts/story-child-coverage.test.ts` and `story-sandbox.test.ts` lock the exact flag strings and path translation.
- The sandbox path translation assumes `/session/app/` and `/session/tmp/` container layouts; a sandbox layout change would break normalization. Mitigation: `normalizeLcov` is deliberately minimal (two prefixes) and its contract is pinned by `tests/scripts/story-coverage-normalize.test.ts`.
- Someone could "simplify" the gate into `coverageThreshold` in `snapshot-bunfig.toml`. Mitigation: ADR-0327 documents the per-file-rule trap, and this ADR records why the story bunfig must not carry gate policy.

## Implementation Notes

- All nine plan tasks landed: `scripts/coverage/{normalize-lcov,story-coverage-gate,ratchet-stories}.ts`, `scripts/story/coverage-floor.json`, the `--coverage` flag in `scripts/story/cli.ts:44,155-160`, `--coverage-dir=` translation in `scripts/story/sandbox.ts:150`, coverage flags in `scripts/story/child.ts:58-59`, `STORY_COVERAGE_LCOV_PATH`/`copyStoryCoverage` in `scripts/story/reports.ts:15,217-233`, `copyCoverage` in `scripts/story/session.ts:45,214`, the gate extracted to `scripts/story/coverage-gate.ts` and wired in `scripts/story/test-stories.ts:10,261`, `package.json` scripts `test:stories:coverage` and `coverage:ratchet:stories`, `.github/workflows/ci.yml:138`, and `tests/CLAUDE.md:173` (`### T0 story-lane line coverage`).
- Divergence from the plan's letter: the `gateStoryCoverage` helper landed in its own module (`scripts/story/coverage-gate.ts`) rather than inline in `test-stories.ts`, keeping the runner entry below the line budget; `scripts/story/inputs.ts` additionally freezes the `scripts/coverage/` modules into the story snapshot so the sandboxed child can load them.
- The plan's checkbox tracking was not maintained (all boxes remain `- [ ]`); verification was done against the code instead — the five new coverage test files pass (15/15) alongside the extended sandbox/reports/runner suites.
- The post-implementation ratchet (tightening `0.50/0.50` to the measured baseline) was deferred by design until the story suite was green, mirroring ADR-0327's deferred `--update` step.

## Implementation Status

**Implemented.** Every planned file and wiring point verified present in the codebase (see Implementation Notes for paths and line references); the coverage test suite passes locally; the CI `stories` job invokes the coverage variant.

## Related Decisions

- ADR-0327 (in-process CI line-coverage floor) — supplies `ratchet-lib.ts`, the JSON-floor format, the ratchet pattern, and the rejected-`coverageThreshold` evidence this decision depends on.
- ADR-0225 / ADR-0283 / ADR-0286 (hermetic story sandbox) — define the single sandboxed child, the `/session/` container layout, and the safe-copy machinery this decision extends.
- ADR-0324 (tier-aware scenario catalog ledger) — the story lane's tier model this coverage number describes.

## References

- Plan: `docs/superpowers/plans/2026-07-24-t0-story-runner-coverage.md`
- Code: `scripts/coverage/{normalize-lcov,story-coverage-gate,ratchet-stories,ratchet-lib}.ts`, `scripts/story/{cli,sandbox,child,reports,session,coverage-gate,test-stories,inputs}.ts`, `scripts/story/coverage-floor.json`, `package.json`, `.github/workflows/ci.yml`, `tests/CLAUDE.md`
- Tests: `tests/scripts/{story-coverage-normalize,story-coverage-gate,story-runner-coverage-cli,story-child-coverage,story-coverage-ratchet,story-sandbox,story-reports,test-stories}.test.ts`
