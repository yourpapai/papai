<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev. Use of this software is governed by the Business Source License 1.1. See LICENSE in the project root for details. -->

## 1. Shared extraction seams (test-first)

- [x] 1.1 Write failing tests for `usageTotalsOf(events)` in a new `tests/afk-runner/work/gate-signals.test.ts` (token sum across `done` events; `costKnown: false` on tokens>0 ∧ costUsd=0; priced+unpriced mix; empty log), then implement it in `afk-runner/src/work/gate-signals.ts` with `costSummaryOf` delegating to it — its existing consumers' shapes are unchanged. Verify: `bun test tests/afk-runner/work/gate-signals.test.ts`
- [x] 1.2 Write failing tests for `gateDwellsMs(events)` (human-gate presented→answered distances, auto-decided gates excluded, unanswered presentations excluded), extract it from `collectGains` in `afk-runner/src/work/report.ts` preserving the median inputs exactly, and have `collectGains` use it. Verify: `bun test tests/afk-runner/work/report.test.ts`

## 2. Pure aggregation core

- [x] 2.1 Write failing unit tests for the pure `aggregate()` in a new `tests/afk-runner/accounting.test.ts`: roster rows + per-run numbers → rendered rows and totals (gate-pending status marker `gate:<mode> v<version>`; tokens/Σtokens; wall = last−first event ts; Σdwell from `gateDwellsMs`; cost lower bound with unpriced count incl. degraded rows; empty roster → zeroed totals). Implement `aggregate()` in the new `afk-runner/src/accounting.ts`. Verify: `bun test tests/afk-runner/accounting.test.ts`
- [x] 2.2 Write failing tests for the formatting helpers (tokens → `13.2M`-style, ms → `101m`-style, unknown → `—`), then implement them in `afk-runner/src/accounting.ts` as pure functions the renderer composes. Verify: `bun test tests/afk-runner/accounting.test.ts`

## 3. fs shell with degradation tolerance

- [x] 3.1 Write failing fs tests in `tests/afk-runner/accounting.test.ts` over a temp work dir: mixed-status runs (scenario logs copied in), unreadable memo skipped, memo-without-log degraded row (`tokens —`/`wall —`, counted unpriced), torn final log line tolerated (numbers from the readable prefix), empty/absent runs dir → empty summary without error. Implement the shell: `readAllRunStates` roster + per-run log scan under bounded `p-limit` concurrency with a per-run catch feeding `aggregate()`. Verify: `bun test tests/afk-runner/accounting.test.ts`

## 4. CLI verb

- [x] 4.1 Write a failing CLI test (`tests/afk-runner/cli.test.ts`) for `afk-runner runs` over a fixture work dir: roster + footer print, and a read-only assertion (no file content or mtime change under the work dir); update the usage text. Wire the `runs` command in `afk-runner/src/cli.ts` (named-command dispatch before the bare-positional form; no flags). Verify: `bun test tests/afk-runner/cli.test.ts`

## 5. Live-lane aggregate assertion

- [ ] 5.1 Extend `tests/afk-runner/fixtures/live/inventory.test.ts` with an aggregate-over-all-lanes describe: run count equals the lane count, Σtokens > 0, unpriced count matches the corpus, Σdwell ≥ 0, every row status valid — so the footer stays honest as C8's second live cycle adds lanes. Verify: `bun test tests/afk-runner/fixtures/live/inventory.test.ts`

## 6. Docs and full verification

- [ ] 6.1 Update `docs/architecture/afk-runner.md`: layout row for `accounting.ts`, the `runs` verb in the CLI section (passive, report-family), and the U9 note that cross-run accounting's report half landed (enforcement still parked with U5). Verify: `openspec validate cross-run-accounting --strict`
- [ ] 6.2 Run the full gate: `bun run test`, `bun run typecheck`, `bun run lint` — all green before commit.
