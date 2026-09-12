<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev. Use of this software is governed by the Business Source License 1.1. See LICENSE in the project root for details. -->

## Context

The run-index (`afk-runner/src/run-index.ts`) already scans every run's `state.json` — it feeds session-id allocation and gate routing, skips unreadable entries, and sorts newest-first. Spend exists only inside each run's `events.ndjson` (`done` events carry usage); `costSummaryOf` in `work/gate-signals.ts` sums it on demand per run, and `collectGains` in `work/report.ts` computes per-gate dwell for the per-run report's median. Nothing aggregates across runs, and the memo carries no cost or duration by design. The memo-parity oracle (`memo-parity.test.ts`, full field parity with sdd-runner's persisted states) is the retirement gate this change must not disturb. See proposal.md for motivation; specs/afk-runner-runs/spec.md for the behavior contract.

## Goals / Non-Goals

**Goals:**

- A passive `runs` verb whose numbers are fold-derived from the same truth the engine uses (logs), with a pure, fs-free aggregation core.
- Zero movement in the memo schema, the parity oracle, or any existing surface's output.

**Non-Goals** (beyond the proposal's):

- No changes to `report`, `status`, or the per-run surfaces' contracts.
- No interval-union active-time math (agentWall is declined, not deferred).

## Decisions

### D1 — Roster from memos, numbers from logs; memo schema frozen

`readAllRunStates` supplies the roster (it already returns identity, status, gate, updatedAt — everything a row needs). Each run's numbers come from one pass over its event log. **Alternative rejected:** growing `PersistedRunStateSchema` with cumulative cost/duration projections written at parks — stale between parks, and it forces re-framing the memo-parity oracle immediately before retirement for a cache the ledger just ruled unearned (U7 fell). The logs are cheap at known scale (~7 ms/776 events, reflection U7 evidence).

### D2 — New module `accounting.ts`; two shared extractions, no moves

No existing module aggregates across runs: `run-index.ts` is roster-only, `report.ts` is per-run and near the line budget. `afk-runner/src/accounting.ts` gets a pure `aggregate(rows)` core (in-memory row → row+totals, fixture-testable without fs) plus a thin fs shell that reads the roster and scans logs under `p-limit` (small fixed concurrency — the unbounded-`Promise.all` convention applies to N log reads). Two extractions back it without duplication:

- `usageTotalsOf(events) → {costUsd, costKnown, tokens}` homed in `work/gate-signals.ts`, with `costSummaryOf` delegating to it (its render consumers keep their shape; accounting gains tokens from the same fold).
- `gateDwellsMs(events) → number[]` extracted from `collectGains`' presented→answered walk; the report keeps its median math over the list, accounting sums it.

### D3 — Duration from log timestamps

Wall = last event `ts` − first event `ts` per run: identical to memo duration for terminal runs (verified on the live lane — `createdAt` equals the first event ts) and **fresh for live runs**, since events append continuously while the memo only writes at parks. Memo timestamps are not read for duration. A run with a readable memo but missing/short log renders `—` (degraded row), never a fabricated zero.

### D4 — Cost honesty carries the corpus's unpriced shape

Per-run tokens are the primary column; the live corpus is wholly unpriced (`costUsd: 0`, millions of tokens), so cost renders only in the footer as a lower bound with the unpriced count — the same fail-closed convention as the R5 ladder and escalation gates. A per-run cost cell is elided when unpriced (nothing to say) rather than printing `$0.00` that reads as free.

### D5 — Degradation contract mirrors `listPendingGates`

Unreadable memo → row skipped (existing index behavior). Readable memo but missing log, ENOENT, or mid-file corruption (readEvents hard-errors there by design) → per-run catch keeps the row with `tokens —` / `wall —` and marks spend unknown for the footer's lower bound. A listing never dies on one run's data.

### D6 — CLI verb and dispatch

`afk-runner runs` as a named command dispatched before the bare-positional fold form (which today errors on a `runs/` path anyway — nothing is shadowed). No flags. The gate-pending marker (`gate:<mode> v<version>`) renders from the roster's existing gate field.

### D7 — Scope-model and gating impact

None: no platform or task instances, no chat-surface tool, no `tool_prefs` surface, no DB, no persisted config-context state. The verb reads work-dir local files and writes nothing (the passive-read-only requirement is spec'd and tested).

### D8 — Hook/TDD interactions

The Write/Edit TDD hooks gate everything under `afk-runner/src/**` (unchanged since C1), so the work is strictly test-first: the pure `aggregate()` suite and the extraction seams (`usageTotalsOf`, `gateDwellsMs`) get failing tests before any src write; the fs shell and CLI verb follow under the same discipline with tolerance fixtures. The live-lane aggregate assertion extends the existing lane inventory test so the footer stays honest as C8's second live cycle adds lanes.

## Risks / Trade-offs

- [Σ wall overcounts calendar time when runs overlap] → footer labels it as summed per-run wall, and dwell is reported separately; calendar-time math is out of scope.
- [Numbers race concurrent appends on live runs] → acceptable for a passive view; the torn-tail reader tolerates the crash window and mid-scan reads at worst miss events appended after the scan.
- [Roster scan + N log reads is 2N file reads] → trivial at any foreseeable work-dir size (U7 evidence); revisit only if work dirs reach hundreds of runs.

## Migration Plan

Additive verb; no migration. Rollback is deleting the verb and the module — no state, no schema, no aliases touched (R4's repoint list is unaffected).

## Open Questions

None — the operator-facing choices (verb, columns, duration rendering, sort) were settled during exploration with corpus evidence.
