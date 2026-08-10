<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Single-line live renderer for review-loop & mutation-improve

Date: 2026-08-09
Status: approved (brainstormed in session; approach A chosen)

## Problem

Agent runs scroll one permanent line per agent step (`applyStepFinish` →
`reporter.event(formatStepFooter(...))` in `review-loop/src/line-handler.ts`). A 10-iteration
mutation-improve run produced 910+ scrolled lines, burying the useful information. Additionally,
mutation-improve's build/mutation gates emit no live status at all, so the screen sits idle during
30-minute gate runs.

## Goal

Fold all live progress into one updating line per unit of work. When the unit finishes, that line
freezes as a permanent summary line and the next unit starts a new line below. Total scrolled output
for a run is then bounded by the number of units (≈10 lines for a 10-iteration run), so no output
capping is needed.

Scope: both tools share `review-loop/src/live-renderer.ts` + `line-handler.ts`; the change applies
to both.

## Definitions

- **slot** — the existing keyed live-line mechanism (`reporter.slot(key, line)`), one updating line
  per key rendered above the pinned status footer.
- **commit** — new operation that converts a slot's live line into one permanent scrolled line and
  frees the key.

## Design

### 1. Shared renderer: `commit(key, line?)`

`ProgressReporter` (`review-loop/src/progress-log.ts`) gains:

```ts
commit?(key: string, line?: string): void
```

`LiveRenderer.commit` semantics:

- If slot `key` is live: its content is replaced by `line` (if given), emitted as one permanent
  scrolled line, the slot is removed, and the live block is re-rendered.
- If no slot exists for `key` but `line` is given: the line is printed permanently anyway. This lets
  the pipeline commit an iteration summary even when the iteration died before any agent produced
  output.
- If neither slot nor `line` exists: no-op.

Non-TTY (non-dynamic) behavior changes deliberately: `slot()`/`live()` intermediate updates become
no-ops; only `event()` and `commit()` print. CI logs get one line per unit of work instead of a line
per tool call.

### 2. line-handler: fold step footers into the live line

- `applyStepFinish` stops emitting the permanent `formatStepFooter` event. It still reports usage
  deltas and tool-call stats, then re-renders the live line.
- `formatLiveLine` (`live-format.ts`) gains cumulative tokens, hidden while zero:
  `improve ▶ bash bun test… · 12m03s · 41 tools · in 850k/out 12k`
- `dispose()` commits the slot instead of clearing it: the frozen line's marker flips `▶ → ✓`.
  If the agent died before its first step (`startedAt === 0`), dispose just clears — there is
  nothing worth freezing.
- `RunAgentOptions` gains:
  - `slotKey?: string` — slot identity, defaults to `label`.
  - `commitOnDispose?: boolean` — defaults to `true`.
- review-loop callers stay untouched: each parallel worker's line freezes on completion instead of
  vanishing.

### 3. mutation-improve: one `'iter'` line per iteration

Iterations are strictly sequential with at most one agent running at a time, so a single constant
slot key suffices.

- `cli.ts`: both agent runners pass `slotKey: 'iter'`, `commitOnDispose: false`. Select → improve →
  build-fix retries all update the same line; only the label inside it changes.
- A small phase-ticker helper wraps `runBuildCheck` and `measureScore` so gates render into the same
  line (`build ⏱ 14m…`, `mutate ⏱ 3m…`), eliminating the dead air during long gates. The helper
  leaves the slot live on completion; it replaces `withLivePhase` for mutation-improve (whose
  `reporter.event('[label] running...')` and slot-clearing finally are wrong for this model).
- `pipeline.ts`: the `log` dep type widens with optional `slot?`/`commit?`. `runIteration` times
  itself and calls `commit('iter', summary)` on every exit path:

  ```
  iter 3 ✓ improved · src/providers/config-validation.ts · 62.2%→97.9% · 24m12s
  iter 1 ✓ capped · src/reply-context.ts · 50.0%→76.1% · 21m40s
  iter 5 – skipped · src/foo.ts · 91.2% ≥ threshold · 2m03s
  iter 7 ✗ failed · src/tools/compaction/result-store.ts · exception: improve exited with code 1: …
  ```

  Failure reasons are tail-bounded already; the renderer truncates to terminal width as today.
- The pinned status footer (round/elapsed/tokens/cost/+a/-r) and the end-of-run summary table
  (`summary.ts`) stay unchanged.

### Out of scope (deliberate cuts)

- No `+a/-r` on the committed iteration line — those live in the end-of-run summary; pulling them in
  would couple the pipeline to stats plumbing for little gain.
- No verbose/debug flag to restore per-step footers.
- review-loop's own `withLivePhase` build-phase behavior is unchanged.

## Error handling

- Renderer EPIPE/broken-stream behavior is unchanged (`writeSafe` downgrade still applies); commit
  degrades to a plain write in non-dynamic mode.
- An iteration that throws before any slot opened still commits its summary line via the no-slot
  branch.
- `dispose` runs in `runAgent`'s `finally` and cannot observe the outcome, so the frozen line's
  `▶ → ✓` flip happens unconditionally. A killed agent therefore freezes with `✓`; the failure is
  still unambiguous because the caller's own failure line follows (mutation-improve commits
  `iter N ✗ failed …`, review-loop logs its failure event).

## Testing

TDD per repo hooks (`review-loop/src/**` → `tests/review-loop/**`, `mutation-improve/src/**` →
`tests/mutation-improve/**`).

- `tests/review-loop/`:
  - renderer commit: freezes slot content; replaces content when `line` given; prints line with no
    slot; no-op with neither; non-TTY suppresses slot/live updates but prints commit/event.
  - line-handler: no per-step footer event; dispose commits with `✓`; `commitOnDispose: false`
    leaves slot live; `slotKey` overrides identity; pre-first-step dispose clears.
- `tests/mutation-improve/`:
  - pipeline commits the correct summary line for each outcome (improved / capped / skipped /
    failed incl. exception path) using a mock log.

## Docs

Update `review-loop/AGENTS.md` and `mutation-improve/AGENTS.md` renderer notes to describe the
commit/freeze model.
