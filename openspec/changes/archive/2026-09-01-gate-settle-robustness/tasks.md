<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## 1. Decision grammar (D1)

- [x] 1.1 Red-first: extend `tests/afk-runner/work/gate-model.test.ts` — `APPROVE` and `VETO[: <redirect>]` own-line directives parse; `VETO` precedes required-ack; `VETO` rejects at escalation mode; `APPROVE` + unchecked declared items rejects naming them; zero-signal response at an item-less gate rejects with directive guidance (today it approves). Verify: `bun test tests/afk-runner/work/gate-model.test.ts`
- [x] 1.2 Implement in `afk-runner/src/work/gate-model.ts`: shared directive constants, parse-state fields, precedence chain, zero-signal rejection (unreachable at item-carrying gates — presentation boxes guarantee signal). Verify: `bun test tests/afk-runner/work/gate-model.test.ts`
- [x] 1.3 Teach `looksAnswered` the directive lines; update the rendered instructions + `### Decisions` block in `afk-runner/src/work/gate-render.ts` to self-document the directives. Verify: `bun test tests/afk-runner/work/gate-model.test.ts tests/afk-runner/work/gate-waiter.test.ts`

## 2. Roundtrip-safe renders (D2)

- [x] 2.1 Red-first: extend `tests/afk-runner/work/gate-answers.test.ts` — veto-decision with zero items renders the `VETO` directive (redirect preserved); approve renders `APPROVE`; `renderGateAnswers` → `parseGateResponse` roundtrips every decision shape including `renderAutoApproveAnswers` at item-less gates. Verify: `bun test tests/afk-runner/work/gate-answers.test.ts`
- [x] 2.2 Implement the render branches in `afk-runner/src/work/gate-answers.ts` (GateAnswers gains the gate-level redirect field); pre-flight the in-memory parse in `settleGateWithAnswers` — a failed roundtrip writes nothing and appends nothing. Verify: `bun test tests/afk-runner/work/gate-answers.test.ts tests/afk-runner/work/gate-settle-escalation.test.ts`

## 3. Gate-level veto revision (D6)

- [x] 3.1 Red-first: new revision-consumer tests — a settled gate-level veto (with and without redirect) runs `runVetoUpdater` with the whole-gate instruction; no synthetic item id reaches the prompt; the no-op path requires vetoes-empty AND null redirect. Verify: `bun test tests/afk-runner/work/veto-updater.test.ts`
- [x] 3.2 Plumb `gateVetoRedirect` through `GateResponse` → `runVetoRevision` in `afk-runner/src/graph/pipeline-work.ts` → a first-class `VetoUpdaterInput` field with its own prompt section in `afk-runner/src/work/veto-updater.ts`. Verify: `bun test tests/afk-runner/work/veto-updater.test.ts`

## 4. Settle containment (D3)

- [x] 4.1 Red-first: extend `tests/afk-runner/work/gate-waiter.test.ts` — a malformed hand edit yields a rejected result, the waiter stays alive, `gate-<v>.response-error.md` appears with the reason, no re-attempt until the gate-file digest changes; an unchanged poisoned file on resume does not re-attempt; the empty-expected rejection message hints at a missing sidecar. Verify: `bun test tests/afk-runner/work/gate-waiter.test.ts`
- [x] 4.2 Make `settleGateFile` total over operator input in `afk-runner/src/work/gate-settle.ts` (rejected-shape result for parse/integrity/sidecar failures; producer-lane stays throwing); wire the waiter feedback loop with the digest guard in `afk-runner/src/work/gate-waiter.ts`. Verify: `bun test tests/afk-runner/work/gate-waiter.test.ts tests/afk-runner/work/gate-settle-escalation.test.ts`

## 5. Attempt-scoped claims (D4)

- [x] 5.1 Red-first: extend `tests/afk-runner/work/gate-waiter.test.ts` — a rejected settle releases the claim and the corrected answer settles; self-reclaim passes for the same holder. Verify: `bun test tests/afk-runner/work/gate-waiter.test.ts`
- [x] 5.2 Red-first: extend `tests/afk-runner/work/gate-deadline.test.ts` with the natural-sequence harness — first expiry (claim, rule-none, re-arm) → hand settle during the window succeeds → separately, second deadline re-runs the ladder instead of reporting an already-held claim. Verify: `bun test tests/afk-runner/work/gate-deadline.test.ts`
- [x] 5.3 Implement in `afk-runner/src/work/gate-claims.ts` (release-on-outcome, idempotent self-reclaim, legacy `expiry-claim` honored-as-held check retired) and `afk-runner/src/work/gate-expiry.ts` (expiry takes the shared pid-carried claim around its ladder settle). Verify: `bun test tests/afk-runner/work/gate-deadline.test.ts tests/afk-runner/work/gate-waiter.test.ts`

## 6. Mid-presentation crash recovery (D5)

- [x] 6.1 Red-first: new recovery tests in `tests/afk-runner/` — a log ending at presented-unanswered with an orphaned active presenting stage (atomicity, and the depth-S decompose shape) heals by appending the owed `stage_exit` on resume, and a subsequent approve completes the run; the waiter exits external on an already-answered gate record (no duplicate settle storm). Verify: `bun test tests/afk-runner/run-recovery.test.ts tests/afk-runner/work/gate-waiter.test.ts`
- [x] 6.2 Implement the owed-exit rule in `afk-runner/src/drive/resume.ts` + `afk-runner/src/run-recovery.ts` (beside the owed-presentation/escalation/mover family) and the answered-check in the waiter tick. Verify: `bun test tests/afk-runner/run-recovery.test.ts tests/afk-runner/work/gate-waiter.test.ts`

## 7. Steer grammar and hygiene (D7)

- [x] 7.1 Red-first: extend the steer tests — bare `veto` and `veto <text>` map to gate-level veto (settling an item-less final gate without crashing); `veto <id>=<redirect>` stays item veto; an unparseable first line is warned and consumed. Verify: `bun test tests/afk-runner/work/gate-waiter.test.ts`
- [x] 7.2 Implement in `afk-runner/src/work/waiter-steer.ts` (`peekSteer` grammar, `steerAnswers` mapping) and the consume-with-warning path. Verify: `bun test tests/afk-runner/work/gate-waiter.test.ts`

## 8. Docs and full verification

- [x] 8.1 Update `docs/architecture/afk-runner.md` — the gate lifecycle section (directives, containment, attempt-scoped claims, the healed window) and the C-plan pointer for this change. Verify: `bun run typecheck && bun run lint`
- [x] 8.2 Full gate: `bun run test`, `bun run typecheck`, `bun run lint`, `openspec validate gate-settle-robustness --strict`; confirm no parity-suite regressions (`bun test tests/afk-runner/parity.test.ts`).
