<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0351: Review-Loop Verdict-First Report and Structured Issue Events

## Status

Accepted

## Date

2026-08-01

## Context

The review-loop CLI's end-of-run report was hard to read at a glance, and its live output under-reported substance:

- **No clear verdict** — the run outcome had to be inferred from a burndown row of zeros.
- **Zero-heavy noise** — a clean one-round run printed a full burndown table and six wall-clock phases that were all `0.0s`.
- **No artifact pointers** — the report never said where `summary.txt`, `metrics.json`, the ledger, traces, or transcripts landed.
- **No per-issue detail** — counts only; finding *which* issues were fixed or rejected required opening `ledger.json` by hand.
- **Elision losses** — the terminal harness elides long output (`[52 lines elided]`), so the report must be compact and front-load the verdict.

Live rendering had matching gaps: a completed review round logged only `[round N] Found M issues`, fixer decisions were unstructured log strings (`[fix] "title" → fixed`), and the in-phase tick (`[label] 45s...`) carried no issue counters.

Spec: `docs/superpowers/specs/2026-08-01-review-loop-report-output-design.md`. Plan: `docs/superpowers/plans/2026-08-01-review-loop-report-output.md`.

## Decision Drivers

- **Verdict first.** The first line must state the outcome (`clean` / `done` / `issues remaining`) with a zero-suppressed breakdown.
- **Compactness under elision.** Front-load substance; cap per-issue groups at 20 lines with a `see ledger.json` overflow note.
- **Structured events over log strings.** Decision and discovery lines must be machine-derivable from typed events, not parsed out of `[fix] "…" → …` strings.
- **In-place extension.** Reuse the existing `ProgressReporter` seam and `buildSummary` module rather than adding a report subsystem; `metrics.json` shape stays unchanged.
- **Testability.** Issue-line formatting must be a pure module so rendering is unit-testable without a TTY.

## Considered Options

### Option 1 — In-place extension: pure format module + optional reporter seam (chosen)

Add a pure `issue-format.ts` module holding all issue-line rendering (`formatIssueRef`, `formatFoundLine`, `formatDecidedLine`, `groupForStatus`, group order/labels/marks). Extend `ProgressReporter` with optional `issue?(event)` / `statusSuffix?()` methods; `LiveRenderer` implements them with a counter bag. `loop-controller`, `issue-processor*`, and `commit-attempt` emit typed `round` / `found` / `decided` events instead of log strings. Rewrite `buildSummary` to take a single `SummaryInput` object (doneReason, rounds, metrics, ledger snapshot, runDir, options) and render verdict, zero-suppressed timing/cost, capped issue groups, burndown (only with activity), and an artifacts block.

- **Pros:** small diff surface; pure formatting is trivially testable; optional seam keeps existing fake reporters compiling; events are consumable by both live rendering and tests; `metrics.json` untouched.
- **Cons:** reporter interface grows; optional methods mean non-TTY reporters silently skip the enrichment.

### Option 2 — Dedicated event-bus report module

Introduce a separate event bus that all producers publish to and a report module subscribes to.

- **Pros:** full decoupling of producers from rendering.
- **Cons:** new subsystem for a single-consumer problem; more indirection than the CLI's scale justifies (YAGNI).

### Option 3 — Post-hoc `report` subcommand

Keep runtime output minimal; generate the rich report on demand from run artifacts.

- **Pros:** zero runtime cost; report logic fully separate.
- **Cons:** the report is wanted at run end in the terminal/CI log; a second command adds friction and doesn't fix live under-reporting.

## Decision

Adopt Option 1. `buildSummary` is rewritten verdict-first with zero suppression and capped per-issue groups; `ProgressReporter` gains the optional `issue()`/`statusSuffix()` seam carrying typed `IssueProgressEvent`s; all ledger-affecting decisions and discoveries are emitted as events (one `decided` per decision, one `found` per new ledger record, one `round` per round start); the artifacts block always lists the run dir and known artifact files.

## Rationale

The reporter already existed as the single funnel for all output, so a typed event on it is the smallest change that makes decisions structured. A pure formatting module keeps Unicode mark/padding logic in one tested place shared by live lines and the final report. Suppressing zero segments (phases, burndown, verdict counts, rounds/pool line) directly targets the elision problem: the report shrinks to only what happened.

## Consequences

### Positive

- First line of every run states the outcome; clean runs collapse to verdict + duration + artifacts.
- Every fixed/rejected/needs-human issue is visible in the terminal with id, severity, file:line, and title — no manual ledger spelunking.
- Decision lines are short regardless of issue title length (no more truncation hacks on `[fix]` strings).
- Live tick can show `round N/M · issues: X open · Y fixed`, making multi-round progress observable.
- `metrics.json` consumers are unaffected (signature and shape preserved).

### Negative

- `ProgressReporter` implementors outside `LiveRenderer` get no enrichment unless they opt into the optional methods.
- Callers of the old positional `buildSummary` had to migrate to the `SummaryInput` object (only `cli.ts` in practice).
- Behavioral contract "exactly one event per decision/discovery" must be maintained by hand in each processor; there is no type-level enforcement.

### Risks

- Group cap (20) could hide issues from a reader who never opens `ledger.json` — mitigated by the explicit `…and N more (see ledger.json)` line and the artifacts block pointing at the run dir.

## Implementation Notes

- Implemented in four commits matching the plan: `issue-format.ts` module; reporter seam + `LiveRenderer` counters; event emission from loop-controller/processors/commit-attempt (via an `emitDecision` helper); `summary.ts` rewrite + `cli.ts` wiring.
- Later work superseded the exact live-tick wiring: rendering moved to a slot-based model (`live-format.ts`, per-activity slots) whose `statusLine()` composes round, activity, issues, and tokens — the counter-enrichment goal of this ADR is preserved through that newer shape. `buildSummary` also gained a `wallMs` input for honest wall-clock duration (see ADR-0289 lineage).
- Unicode marks (`✓`, `✗`, `!`, `·`, `…`, `—`) are centralized in `issue-format.ts` / `live-format.ts` constants.

## Related Decisions

- ADR-0289: Review-Loop Live Progress Reporting — established the `ProgressReporter`/`LiveRenderer` seam this decision extends.
- ADR-0290: Review-Loop Simplification — prior structural cleanup of the same workspace.
- ADR-0303: Review-Loop Parallel Fixes + Inspector — later multi-slot rendering that reshaped the live status line.

## References

- Spec: `docs/superpowers/specs/2026-08-01-review-loop-report-output-design.md`
- Plan: `docs/superpowers/plans/2026-08-01-review-loop-report-output.md`
