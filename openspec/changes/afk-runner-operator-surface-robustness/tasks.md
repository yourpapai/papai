<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## 1. Settle seam — preflight returns rejection (D1)

- [x] 1.1 Red in `tests/afk-runner/work/gate-settle.test.ts`: `settleGateWithAnswers` with answers addressing an id the expected content does not declare (the F-C1 foreign item-veto shape) resolves `{kind: 'rejected', reason}` instead of throwing — no gate-file write, no appended events; then move the render/parse-back failures of `afk-runner/src/work/gate-settle.ts` onto the rejection return path. Verify: `bun test tests/afk-runner/work/gate-settle.test.ts`
- [x] 1.2 Red in `tests/afk-runner/work/gate-prelude.test.ts` and `tests/afk-runner/work/gate-deadline.test.ts`: a machine producer whose settle is rejected (ladder auto-approve / expiry settle) throws — the refusal alarm — with its `auto_decision` already appended; then add the explicit rethrow at both producer call sites (`gate-prelude.ts`, `gate-expiry.ts`). Verify: `bun test tests/afk-runner/work/gate-prelude.test.ts tests/afk-runner/work/gate-deadline.test.ts`

## 2. Steer containment (D1 waiter branch + D2 feedback artifact)

- [x] 2.1 Red in `tests/afk-runner/work/gate-waiter.test.ts`: a well-formed steer item-veto with a foreign id becomes contained feedback — the waiter stays waiting, `gate-<v>.response-error.md` is written unconditionally with a `(steer)`-marked heading and the consumed directive embedded in the reason, and the steer file is consumed; then implement the steer branch's rejection handling with the unconditional artifact write. Verify: `bun test tests/afk-runner/work/gate-waiter.test.ts`
- [x] 2.2 Red in `tests/afk-runner/work/gate-waiter.test.ts`: the steer rejection's digest (sha256 of the steer directive line) is inert for the file-path digest guard — a resumed waiter seeds `failedDigest` from the artifact yet a subsequent stable hand-edit settles without being blocked. Verify: `bun test tests/afk-runner/work/gate-waiter.test.ts`

## 3. Guarded render and settle-time expected (D3 + D4)

- [x] 3.1 Red in `tests/afk-runner/work/present-final.test.ts`: an unparseable `resolutions-<n>.json` before the final gate presents renders the substituted `POLICY-INTEGRITY` blocker row with the failure reason (`sidecar unparseable`) as the row's evidence; then guard the presenter's review result through `guardedReviewResult` (`present-final.ts`). Verify: `bun test tests/afk-runner/work/present-final.test.ts`
- [x] 3.2 Red in the early-gate suite: the same substitution renders at a cap-hit early gate with the corrupted sidecar; then wrap the early presenter's result (`early-gate.ts`). Verify: `bun test tests/afk-runner/work/`
- [x] 3.3 Red in `tests/afk-runner/work/gate-settle.test.ts`: settle-time expected content at an integrity-substituted gate declares `POLICY-INTEGRITY` (the guarded helper — `perRound` threaded through `expectedContentFor` or a wrapper) with `WaiterContext` carrying the gate round's `DigestRecord`; a response addressing the substituted blocker parses instead of rejecting as unknown. Verify: `bun test tests/afk-runner/work/gate-settle.test.ts`
- [x] 3.4 End-to-end pin in `tests/afk-runner/work/gate-waiter.test.ts`: rendered substituted gate → operator writes `→ acknowledged` + `APPROVE` (the directive trips `looksAnswered`) → the waiter settles approve through the seam; no `looksAnswered` widening. Verify: `bun test tests/afk-runner/work/gate-waiter.test.ts`

## 4. Expiry wiring (D5)

- [x] 4.1 Red in `tests/afk-runner/integration/live-run.test.ts` (fake-pipeline harness): a run parked `gate-pending` under an autonomy config with a short `deadlineMinutes`, with the injected `now` advanced past the deadline across `gateWait` ticks, auto-settles through `waitSettledGates` — the `auto_decision{rule, decision}` event lands after the settle write — and the refuse-and-rearm branch re-arms exactly once with the `pending` record; then wire `repoRoot`/`autonomy`/`now` into `awaitGateSettle`'s ports in `afk-runner/src/run-resume.ts`. Verify: `bun test tests/afk-runner/integration/live-run.test.ts`
- [x] 4.2 Confirm the fixture-pinned expiry behavior is unchanged by the wiring (existing suite green, no fixture edits). Verify: `bun test tests/afk-runner/work/gate-deadline.test.ts`

## 5. Full verification and docs close-out

- [ ] 5.1 Run the full suite and the hygiene gates. Verify: `bun test && bun run typecheck && bun run lint`
- [ ] 5.2 Close the findings in `docs/architecture/afk-runner.md`: F-C1/C2/C3 paragraphs resolve (steer settle containment, the rendered integrity blocker with its settle-side expected content, the production deadline wiring) and the C9 scope seed's first item drops; update the C8 ledger note that named this change as immediate. Verify: `bun run lint`
