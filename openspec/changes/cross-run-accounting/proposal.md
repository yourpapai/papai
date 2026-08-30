<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev. Use of this software is governed by the Business Source License 1.1. See LICENSE in the project root for details. -->

## Why

Every accounting surface in afk-runner is per-run: spend exists only as `done`-event usage summed on demand (`costSummaryOf`), duration is computed only at gate presentation, and the run-index (`readAllRunStates`) feeds session-id allocation — nothing answers "what did this cycle's runs cost, how long did they take, and which want a decision?" The U9 ledger splits its cross-run accounting half into report-level aggregation (retirement sequence step R3); without it the portfolio view must be hand-folded from each log, and the live corpus is unpriced (`costUsd: 0` with millions of tokens), so a cost-only ledger would read `$0.00 · unknown` on every run — tokens must be first-class.

## What Changes

- New passive CLI verb `afk-runner runs`: per-run roster rows (`run · status · tokens · wall`) plus a totals footer (runs by status with gate-pending count, Σtokens, Σwall, Σdwell, cost as a lower bound with the unpriced-run count).
- Doctrine-split sourcing: roster from the run-index (`state.json` scan), numbers from each run's `events.ndjson` — the memo schema stays untouched, keeping the memo-parity oracle frozen ahead of retirement (R5).
- Duration from log timestamps (`first.ts → last.ts`) — fresh for live runs where the memo is park-stale; dwell reuses the `collectGains` presented→answered math.
- Gate-pending runs render as `gate:<mode> v<version>` in the status column (the actionable marker); newest-first, all rows, no flags.
- Tolerance contract: an unreadable memo or log degrades that row (`wall —`, spend unknown) — a listing never dies, matching `listPendingGates`.

## Capabilities

### New Capabilities

- `afk-runner-runs`: cross-run roster and accounting aggregation as a passive, read-only CLI surface over the afk work dir.

### Modified Capabilities

None — no existing spec's requirements change; the per-run `report` verb keeps its contract unchanged.

## Impact

- Code: new `afk-runner/src/accounting.ts` (pure aggregation core + fs tolerance shell), `afk-runner/src/cli.ts` (verb wiring), `afk-runner/src/work/report.ts` untouched (dwell math extracted for reuse, not moved); `afk-runner/src/run-index.ts` reused as-is.
- Tests: `tests/afk-runner/` pure-aggregation suite + fs-tolerance fixtures (corrupt memo, memo-without-log, empty work dir); live-lane aggregate assertions extended as C8 adds lanes.
- Docs: `docs/architecture/afk-runner.md` (layout + CLI rows).
- No platform or task instances affected; no config-context scope impact — the surface reads work-dir local files only, writes nothing, no DB, no chat-surface state.

## Non-goals

- **Enforcement** — no cross-run ceilings, budgets, or config keys; the per-run `budget` stays the R5-ladder input only. Portfolio enforcement stays parked with U5.
- **Memo schema growth** — cost/duration stay out of `state.json` (log-is-truth; the memo-parity oracle is the retirement gate).
- **Per-stage cost attribution** and an `agentWall` column — `sum(done.wallMs)` overcounts the concurrent two-lens review; interval-union math isn't earned by a footer.
- **Row flags** (`--since`, limits, sort orders) and a `--pr` variant — added when a real work dir earns them.
- **Legacy `.sdd-runner` import** — separate work dirs by default; R5 deletes code, not data.
- **TUI rendering** — parked with U8.
