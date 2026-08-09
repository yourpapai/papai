<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0355: Review-Loop Slot-Based Live Status and Final-Report Polish

## Status

Accepted

## Date

2026-08-02

## Context

After the verdict-first report landed (ADR-0351), the review-loop CLI still had four observable defects:

- **No persistent live status.** Per-tool progress was a single self-rewriting line (`live([line])`) shared by every concurrent activity; with parallel fixers (ADR-0303) the lines clobbered each other, and piped (non-TTY) output was flooded with one line per tool call.
- **Burndown misalignment.** The header literal used double spaces while rows used single-space padding, so columns never lined up; zero-activity rounds printed all-zero rows.
- **Dishonest cost/token reporting.** The cost line printed `Cost: $0.000` whenever the provider reported no cost, and token counts had no thousands separators (`in 120000 / …`).
- **No wall clock.** The duration line summed phase timings only, hiding queue/spawn time — the number a user actually experiences.

Spec: `docs/superpowers/specs/2026-08-02-review-loop-live-status-and-report-polish-design.md`. Plan: `docs/superpowers/plans/2026-08-02-review-loop-live-status-and-report-polish.md`.

## Decision Drivers

- **Multi-line TTY status area.** With parallel fixer workers, a single live line cannot represent concurrent activity; each activity needs its own slot line under a shared status line.
- **Silence in piped output.** Non-TTY consumers (CI logs, terminal harness elision) must not receive per-tool redraw noise; slot updates are a TTY-only concern.
- **In-place seam extension.** Extend the existing `ProgressReporter`/`LiveRenderer` seam (ADR-0289, ADR-0351) with optional methods rather than introducing a new output subsystem; test fakes must keep compiling and behaving byte-identically.
- **Honest numbers.** Wall-clock duration measured in `cli.ts`; cost shown only when `costUsd > 0`, otherwise a `Tokens:` line; all counts with `en-US` separators.
- **Pure formatting.** Burndown and status-line content stay pure/testable; `metrics.json` shape unchanged.

## Considered Options

### Option 1 — Optional `slot()`/`usage()` seam + multi-line block renderer (chosen)

`ProgressReporter` gains optional `slot?(key, line | null)` (set/clear a per-activity line) and `usage?(delta)` (accumulate token/cost totals). `LiveRenderer` keeps a slot map and redraws a `[status line, ...slot lines]` block with ANSI cursor-up multi-line redraw; `event()` clears the block, prints, and redraws so log lines interleave correctly. Any stream write throw permanently downgrades `dynamic` to `false` (EPIPE safety). The status line composes round, activity verbs derived from slot keys (`fixer-w2-retry` → `fix`, duplicates as `fix×2`), elapsed, issue counters, and token totals. `line-handler.renderLive` and `withLivePhase` route through `slot()` when present, falling back to `live()`/`clearLive()` for legacy fakes. Report fixes are pure formatting in `summary.ts`/`summary-burndown.ts` plus a `wallMs` measured in `cli.ts`.

- **Pros:** smallest diff on the existing seam; optional methods keep every test fake compiling; non-TTY is a no-op by construction; EPIPE downgrade removes a whole class of CI crashes; zero-row suppression and column alignment are pure-function changes.
- **Cons:** ANSI cursor arithmetic is fiddly (block shrink ghost lines needed a follow-up fix); slot-key → activity-verb mapping is a convention, not type-enforced.

### Option 2 — Full-screen TUI (alternate buffer / blessed-style)

- **Pros:** robust multi-region rendering; no hand-rolled cursor math.
- **Cons:** heavy dependency for a CLI that mostly runs piped in CI; conflicts with the harness's line-elision expectations; far beyond the scale of the problem.

### Option 3 — Keep single live line, aggregate only

- **Pros:** zero renderer changes.
- **Cons:** cannot show concurrent fixer/matcher/inspector activity; doesn't address burndown/cost/wall-clock defects at all.

## Decision

Adopt Option 1. Implemented as five task-scoped commits: (1) burndown columns generated from shared widths with zero-activity rows dropped and `burndownIsEmpty` deleted; (2) `SummaryInput.wallMs` with a rewritten timing line (`Duration: <wall> wall · phases <sum> (<nonzero>) · Cost:|Tokens:`) and `startedAt` measured in `runCli`; (3) `UsageDelta` + `slot?`/`usage?` on `ProgressReporter`, multi-line block redraw and EPIPE downgrade in `LiveRenderer`; (4) status-line content builder (`activitySummary`, `formatTokenCount`); (5) `line-handler` and `withLivePhase` rerouted through slots with `step_finish` forwarding usage to the reporter.

## Rationale

The reporter was already the single output funnel, so an optional per-activity slot channel is the smallest change that supports parallel workers without breaking any existing consumer. Non-TTY gets silence for free because `slot()` renders nothing unless the stream is a TTY, while `event()` still prints substantive lines. Measuring `wallMs` at the CLI entry point is the only honest place to capture queue/spawn time that phase sums exclude. Suppressing zero burndown rows and hiding zero cost continue the elision-driven compactness strategy from ADR-0351.

## Consequences

### Positive

- TTY runs show a stable status line plus one live line per concurrent activity; parallel fixer progress is observable (`fix×2`).
- Piped output contains only substantive event lines — no per-tool redraw spam in CI logs.
- Burndown header and rows align; clean rounds no longer print all-zero tables.
- Duration reflects real wall time; zero-cost runs admit it (`Tokens: …`) instead of printing `Cost: $0.000`.
- EPIPE (closed pipe) downgrades the renderer instead of crashing the run.
- `metrics.json` consumers unaffected; legacy reporter fakes work unchanged via the `live()`/`clearLive()` fallback.

### Negative

- `ProgressReporter` optional surface grows again (`slot`, `usage` after `issue`, `statusSuffix`); enrichment is opt-in per implementor.
- Slot-key → verb mapping (`reviewer`/`matcher`/`fixer`/`inspector`/`build`, suffix stripping) is a naming convention maintained by hand; a mislabeled slot key degrades the status line silently.
- Multi-line ANSI redraw is stateful (`renderedLines` bookkeeping); a shrink bug produced ghost lines requiring a follow-up commit.

### Risks

- Terminal emulators with partial ANSI cursor-movement support could garble the block — mitigated by the EPIPE/write-failure downgrade and by non-TTY detection covering CI.
- Status-line width can exceed narrow terminals — mitigated by truncating each rendered line to `stream.columns`.

## Implementation Notes

- Commits: `180fffd9a` burndown alignment + zero-row suppression; `e4b746342` wall-clock + cost/token honesty; `6ebf9b071` slot seam + multi-line redraw + EPIPE downgrade; `01e2ec860` status-line content; `c2efd4d9e` slot/usage wiring through `line-handler` and `withLivePhase`; follow-up `1ba806116` erases ghost lines when the block shrinks.
- Formatting helpers (`formatLiveLine`, `formatTokenCount`, `activitySummary`, mark constants) were consolidated into `live-format.ts`; `formatLiveLine` dropped its 6th `status` parameter since the status line now carries that information.
- `statusSuffix()` remains on the interface for compatibility even though the status line no longer consumes it.
- `dynamic` changed from a readonly field to a getter over `tty && !broken`, satisfying the interface's `readonly dynamic`.

## Related Decisions

- ADR-0289: Review-Loop Live Progress Reporting — established the `ProgressReporter`/`LiveRenderer` seam.
- ADR-0303: Review-Loop Parallel Fixes + Inspector — introduced the concurrency that single-line rendering couldn't represent.
- ADR-0351: Review-Loop Verdict-First Report and Structured Issue Events — the report/event seam this decision polishes and extends.

## References

- Spec: `docs/superpowers/specs/2026-08-02-review-loop-live-status-and-report-polish-design.md`
- Plan: `docs/superpowers/plans/2026-08-02-review-loop-live-status-and-report-polish.md`
