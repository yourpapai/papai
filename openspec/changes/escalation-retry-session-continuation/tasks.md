<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## 1. Session ledger: killed-only continuation lookup

- [x] 1.1 Red, then green: extend `tests/afk-runner/session/session-ledger.test.ts` — the lookup returns the latest id-bearing entry with status `killed` for a `(label, round)`; dangling `spawned` and settled `done` entries are excluded; no match → null. Implement as a status filter on `findInFlightSession` or a killed-only sibling in `afk-runner/src/session-ledger.ts` (design D6). Verify: `bun test tests/afk-runner/session/session-ledger.test.ts`

## 2. Agent layer: stage re-entry continuation seam

- [x] 2.1 Red, then green: extend `tests/afk-runner/work/agent-layer.test.ts` — `runStageAgent` with no explicit `continueSessionId` and a killed `(label, round)` entry spawns the continuation (continuation prompt, `--session` arg, the same opencode session id recorded on a new attempt line); no ledger entry → today's fresh spawn. Implement the seam at `runStageAgent` entry in `afk-runner/src/agent-layer.ts` (design D1, precedence explicit > seam > fresh). Verify: `bun test tests/afk-runner/work/agent-layer.test.ts`
- [x] 2.2 Red, then green: same file — a continuation failure at the seam falls back to the fresh prompt-rebuild spawn with the existing `retrying` event (inherited D2 fallback), and a dangling-`spawned` entry spawns fresh. Verify: `bun test tests/afk-runner/work/agent-layer.test.ts`
- [x] 2.3 Pin, red first if not already covered: the intra-bracket schema-validation retry (attempt 2) still spawns fresh with the validator error appended and no `--session` — the D3 exclusion. Verify: `bun test tests/afk-runner/work/agent-layer.test.ts`
- [x] 2.4 Scenario test at the drive level: an under-budget re-run (and an escalation-approve re-entry) of a non-review stage continues the killed session's id — extend `tests/afk-runner/drive/loop-failure.test.ts` (or `resume-escalation.test.ts` for the approve path) with a fake spawn asserting the `--session` arg on the re-entry spawn. Verify: `bun test tests/afk-runner/drive/loop-failure.test.ts tests/afk-runner/drive/resume-escalation.test.ts`

## 3. review-loop: stall retry continues the captured session

- [ ] 3.1 Red, then green: extend `tests/review-loop/agent-command.test.ts` — the command builder maps a continuation id per backend (`--session <id>` opencode, `--resume <id>` claude); absent id adds no flag (design D4). Verify: `bun test tests/review-loop/agent-command.test.ts`
- [ ] 3.2 Red, then green: extend `tests/review-loop/agent-runner.test.ts` — the stall retry re-spawns continuing `ctx.sessionId` when one was captured; with no captured id the retry is byte-identical to today's fresh re-spawn. Implement in `review-loop/src/agent-runner.ts`. Verify: `bun test tests/review-loop/agent-runner.test.ts`

## 4. Docs and full gates

- [ ] 4.1 Close F-A4 in `docs/architecture/afk-runner.md` as fixed, citing this change (design Migration Plan). Verify: `rg -n "F-A4" docs/architecture/afk-runner.md`
- [ ] 4.2 Full suite and gates: `bun test`, `bun run typecheck`, `bun run lint` — all green.
