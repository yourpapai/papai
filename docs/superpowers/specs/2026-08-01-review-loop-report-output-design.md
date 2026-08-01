<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Review-loop report output redesign

Date: 2026-08-01
Status: approved (design)
Scope: `review-loop/` workspace — final result report (`summary.ts` → console + `summary.txt`) and live in-run rendering (`live-renderer.ts`).

## Problem

The end-of-run report is hard to read at a glance:

- **No clear verdict** — outcome must be inferred from a burndown row of zeros.
- **Zero-heavy tables are noise** — a clean one-round run prints a full burndown table and six wall-clock phases that are all `0.0s`.
- **No artifact pointers** — the report never says where `summary.txt`, `metrics.json`, the ledger, traces, or transcripts landed.
- **No per-issue detail** — counts only; finding *which* issues were fixed/rejected requires opening the ledger JSON by hand.
- **Elision losses** — the terminal harness elides long output (`[52 lines elided]`), so useful sections disappear; the report must be compact and front-load the verdict.

Live rendering also under-reports substance: a completed review round logs only `[round N] Found M issues`, and the in-phase tick shows only `[label] 45s...` with no issue counters.

## Approach

In-place extension of the existing pieces (chosen over a dedicated event-bus report module and over a post-hoc `report` subcommand):

1. Rework `buildSummary` into a verdict-first, zero-suppressed report with capped per-issue groups and an artifacts block.
2. Add a single structured `issue(event)` method to `ProgressReporter`; `LiveRenderer` uses it to print per-issue lines and maintain counters for an enriched status tick.
3. Pass the ledger snapshot and run dir into `buildSummary`; `metrics.json` stays unchanged.

## Final report format

Clean run (no issues):

```
Review loop finished: clean — reviewer found no issues in round 1.
Duration: 6m01s (review 178.3s) · Cost: $1.234 (in 120000 / out 8000 / reasoning 3000)

Artifacts (.review-loop/runs/2026-08-01T12-00-00-000Z-abcd1234/):
  summary.txt · metrics.json · ledger.json · trace.log · transcripts/
```

Run with issues:

```
Review loop finished: done — 5 issues: 3 fixed, 1 needs human, 1 rejected.
Duration: 12m40s (review 320.1s, fix 401.2s) · Cost: $2.431 (in 240000 / out 31000 / reasoning 9000)
Rounds: 2 · Pool: 4

Issues:
  needs human (1):
    ! #g7h8i9j0 [critical] src/db/migrate.ts:55 — Migration drops index concurrently
  fixed (3):
    ✓ #a1b2c3d4 [high]   src/auth/login.ts:42 — Token refresh race on 401
    ✓ #c3d4e5f6 [medium] src/chat/router.ts:117 — Unguarded null platform instance
    ✓ #e5f6a7b8 [low]    src/tools/prefs.ts:8 — Typo in deny message
  rejected (1):
    ✗ #i9j0k1l2 [medium] src/cli.ts:31 — Flag parsing duplicates

Burndown:
  round  new  open  fixed  rejected  needs_human  plan_drift  insp_rej  avgRev  avgFix
  1      4    2     2      1         0            0           0         2.8     2.5
```

Rules:

- **Verdict line** (first line) derived from `doneReason` + counts, in plain language. The mapping is total and explicit — every `doneReason` value has a defined rendering:
  - No issues ever found (`clean`) → "clean — reviewer found no issues in round N."
  - Issues found, none left open (`clean_after_rounds`, or `max_rounds`/`no_progress` with zero open) → "done — N issues: X fixed, Y needs human, Z rejected" (zero counts omitted).
  - Issues left open (`max_rounds` / `no_progress`) → "issues remaining — N open (X fixed, Y needs human, Z rejected)".
- **Zero suppression**:
  - Wall-clock phases with `0.0s` are dropped from the duration breakdown (at least one phase is always shown — the nonzero ones; if all are zero, show `0.0s` total only).
  - Zero-count status lines are dropped from the verdict counts.
  - The burndown table is omitted when there is exactly one round and every value in it is zero.
- **Issue groups**: bucketed from `Object.values(ledger.issues)` by status, ordered `needs_human → closed (fixed) → rejected → already_fixed → open` (open bucket only appears when the loop stops with non-terminal issues). Each group is capped at 20 lines, then `…and N more (see ledger.json)`.
- **Issue line format**: `<mark> #<shortId> [<severity>] <file>:<lineStart> — <title>`, taken from the `LedgerIssueRecord` (`id`, `issue.severity`, `issue.file`, `issue.lineStart`, `issue.title`). `shortId` is the first 8 characters of the ledger UUID (same convention as run ids); it is display-only — full ids live in `ledger.json`. Marks: `✓` fixed, `!` needs human, `✗` rejected, `·` already fixed/open.
- **Artifacts block** always printed, listing the run dir plus the files the run wrote: `summary.txt`, `metrics.json`, `ledger.json`, the trace log (`runState.tracePath`), and the transcripts directory. No filesystem probing — the writer lists what it knows it wrote.
- **Size budget**: a typical report is ≤ 40 lines so harness elision does not hide the verdict; the verdict is the first line and the counts stay within the tail window.
- `summary.txt` receives the identical text as the console. `metrics.json` schema is unchanged.

## Live rendering

**Streamed issue lines.** When a review round completes, replace the single `[round N] Found M issues` log with one line per issue as it enters the ledger:

```
[round 1/3] Reviewing... ✓ 178s · 14 tools · in 120000 / out 8000
  + #a1b2c3d4 [high]   src/auth/login.ts:42 — Token refresh race on 401
  + #c3d4e5f6 [medium] src/chat/router.ts:117 — Unguarded null platform instance
```

Fix/verify decisions already stream per issue; they are restyled to the same visual shape (`✓ #a1b2c3d4 → fixed`, `! #g7h8i9j0 → needs_human (merge conflict)`), replacing the current `[fix] "title" → verdict` strings.

**Persistent status line.** The `withLivePhase` tick renders an enriched single status line:

```
[fix] 1m12s… · round 1/3 · issues: 2 open · 1 fixed · 1 rejected
```

`LiveRenderer` keeps a counter bag `{ round, maxRounds, open, fixed, rejected, needsHuman }`, updated by the structured issue events; zero-count segments are omitted from the line.

**The seam.** `ProgressReporter` gains one method:

```ts
issue(event: IssueProgressEvent): void

type IssueProgressEvent =
  | { type: 'found'; id: string; severity: Severity; file: string; line: number; title: string }
  | { type: 'decided'; id: string; verdict: string; title: string; note?: string }
```

- `loop-controller` calls `issue({type: 'found', …})` per new ledger addition at the review boundary.
- `issue-processor.ts` / `issue-processor-attempts.ts` / `commit-attempt.ts` call `issue({type: 'decided', …})` where they currently emit `[fix] "…"` string logs; the old strings are replaced, not duplicated.
- `LiveRenderer.issue()` formats the line via `event()` and updates the status counters.
- Non-TTY mode (`dynamic === false`) prints the same lines with no ticker — behavior otherwise unchanged.
- Any other `ProgressReporter` implementations (test fakes, file loggers) implement `issue()` by formatting to text.

## Data flow

- `writeRunArtifacts` (cli.ts) already receives `result.ledger` and `runState.runDir`; it now passes the ledger snapshot and run dir into `buildSummary`, whose signature becomes approximately `buildSummary({ doneReason, rounds, metrics, ledger, runDir, options })`.
- `buildMetricsJson` is untouched.
- Artifact ordering is unchanged: summary/metrics/trace are written **before** `finalizeRun`, so build-failure and merge-conflict runs still produce a full report; the finalize error prints after it, as today.

## Error handling

- No new failure modes: reporting is pure formatting over data already in memory.
- If `metrics.json` write fails, the existing warn-and-continue behavior stays; the console report is unaffected.
- A run with zero ledger issues never renders an `Issues:` block.

## Testing

TDD per workspace rules (`review-loop/src/**` gates against `tests/review-loop/**`):

- **`summary` tests** (extend existing): verdict wording per `doneReason` × counts; zero suppression (all-zero single round → no burndown; `0.0s` phases dropped); group ordering and the 20-line cap with `…and N more`; issue line formatting (id/severity/file:line/title); artifacts block contents.
- **`LiveRenderer` tests** (extend existing): `issue()` found/decided line formats; counters update and appear in the tick line; zero-count segments omitted; non-TTY prints lines without a ticker; `clearLive` interplay unchanged.
- **Loop-level tests** (existing fake-reporter patterns): a run with found issues emits one `issue` event per ledger addition; fix decisions emit `decided` events instead of the old `[fix]` strings.

## Out of scope

- `metrics.json` / trace schema changes.
- A post-hoc `review-loop report` subcommand (possible future follow-up).
- HTML/GUI reports, notifications.
- New CLI flags (the new output is default-on; it is output-only).

## Rollout

Single change-set: report rework + live rendering land together, no flags. Output-only change; safe to default-on.
