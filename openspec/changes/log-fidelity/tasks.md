<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## 1. Round-open owedness (spec: "Round-open emission owedness", design D1/D2/D6)

- [x] 1.1 Red: emission-count test in the fake-pipeline harness — an extend-at-final cycle appends exactly one `round_open` per round (the mover's, not a second from review re-entry; the live-log seq 605/607 shape) — `bun test tests/afk-runner/round-open-owedness.test.ts`
- [x] 1.2 Red: same-round resume drill (in-process kill/resume, the seq 195/202 shape) appends no fresh `round_open` — `bun test tests/afk-runner/round-open-owedness.test.ts`
- [x] 1.3 Red: under-budget escalation retry re-entering an open round appends no fresh `round_open` — `bun test tests/afk-runner/round-open-owedness.test.ts`
- [x] 1.4 Red: pure-predicate unit — cap amendment on an already-open round still emits; identical round+cap does not — `bun test tests/afk-runner/round-open-owedness.test.ts`
- [x] 1.5 Red: re-run round still emits findings, convergence, `round_close` (spec: "Work-shaped events are never suppressed") — `bun test tests/afk-runner/round-open-owedness.test.ts`
- [x] 1.6 Green: `ReviewEntry` carries the fold's round snapshot out of `reviewResumeEntry`; `runRound` guards emission by `context.round?.current !== round || context.round?.cap !== effectiveCap` — `bun test tests/afk-runner/round-open-owedness.test.ts`
- [x] 1.7 Guard check: frozen corpus unchanged — golden replay, parity, memo-parity, resume-equivalence all green — `bun test tests/afk-runner`

## 2. Resume event producer (spec: "Resume-invocation event production", design D3/D4/D5)

- [x] 2.1 Red: resume invocation appends exactly one `resume` event after owed-recovery and before any drive event (session-continuation row with the ledger session id) — `bun test tests/afk-runner/resume-event.test.ts`
- [x] 2.2 Red: path-table rows — `stage-rebuild` for an open round with no in-flight session and for a non-review work stage; `artifact-skip, review` for a never-started round — `bun test tests/afk-runner/resume-event.test.ts`
- [x] 2.3 Red: parked-gate resume emits `artifact-skip, gate`; terminal row — a W3 heal whose ladder (autonomy R1) completes the run during `resumeInputs` still emits `artifact-skip, gate` — `bun test tests/afk-runner/resume-event.test.ts`
- [x] 2.4 Red: per-invocation honesty — a second resume on the same run appends its own event — `bun test tests/afk-runner/resume-event.test.ts`
- [x] 2.5 Green: pure path table over post-recovery fold + ledger in `drive/resume.ts`; the emit in `resumeRun` after `resumeInputs`, before the parked/drivable branch — `bun test tests/afk-runner/resume-event.test.ts`
- [x] 2.6 Kernel accounting counts `resume` as tolerated; legacy fold replays it as a no-op (scenario replay carries the assertion) — `bun test tests/afk-runner`

## 3. Fixtures, cross-checks, docs

- [ ] 3.1 Add the honest synthetic scenario sibling (same-round resume without a duplicate `round_open`, carrying the `resume` event) + its inventory row — `bun test tests/afk-runner/fixtures/scenarios/inventory.test.ts`
- [ ] 3.2 Flip the `under-budget-retry-synthetic` README row's meaning from "legitimate shape" to "tolerated history" — `bun test tests/afk-runner/fixtures/scenarios/inventory.test.ts`
- [ ] 3.3 Re-read `openspec/changes/gate-settle-robustness/design.md`; confirm its re-present/extend shapes introduce no open-round re-entry the invariant misses; record the outcome in this change's design.md Risks — `openspec validate --strict`
- [ ] 3.4 Update `docs/architecture/afk-runner.md` (log-fidelity: owedness invariant, resume producer, the F-A4 observation) — `bun run lint`

## 4. Full verification

- [ ] 4.1 Run the full suite, typecheck, and lint; confirm no frozen fixture or parity oracle regressed — `bun test && bun run typecheck && bun run lint`
