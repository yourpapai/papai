<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Why

C7 proved the engine live once, then the branch folded master and landed the mirror wave — metered budgets, open-vs-raised verify rounds, the `analyze` corpus verb, concern memory, operator paper-cuts — all fixture/test-proven with **zero live-run evidence**, the exact condition that preceded C7, where live runs surfaced three crash-shaped bugs fixtures missed. C7's reflection also left live-unproven: armed deadlines, the gate-level veto grammar (`APPROVE`/`VETO[: <redirect>]`/`ABORT`/`→ RUN 1 MORE`), the classified `resume` event producer, and F-A4 (escalation retries consuming `killed` sessions as continuations — recorded, not fixed). The ledger re-score needs its second evidence cycle.

## What Changes

- **Three-run attended matrix** (operator: no time limit), priced model `synthetic/hf:zai-org/GLM-5.3-Flash` on all runs. **Scratch C first** — tiny doc actualization; agent-child kill (not holder) ×2 → `stage_failed{exhausted}` → escalation → approve → same-process retry, producing F-A4's evidence report (accept-vs-fix decided by the operator **after** the cycle); doubles as spend calibration. **Run A** — productive M (`suggest_next_task` increment 2: event-driven suggestion payloads; cross-module existing files, assumption-bearing, increment-1 constants as cross-artifact named decisions), metered with a **tight numeric ceiling calibrated from Scratch C's measured burn** — the priced model makes the ceiling-exceedance refusal branch live; carries holder-kill mid-round (asserting the classified `resume` event and no double `round_open`) and the veto drill through the directive grammar at an assumptions-carrying gate (zero-signal answer first). **Run B** — contained M (opencode-agent killed-turn usage under-count), **unmetered** (`budget: null`), `deadline: 10` armed; one designated gate deliberately unattended so the waiter claims expiry and emits `auto_decision` audit events; plus the induced sidecar corruption → `POLICY-INTEGRITY` drill.
- **Opportunistic drills, pre-registered**: needs-review cap-hit (Run A must *refuse* the verify round when the projection reaches its ceiling — no `auto_decision`; Run B must *buy* it at `round_open(n+1, cap+1)`); concern thrash third-strike with the `### Concern history` section and verification-round denial; a `C<n>` cross-artifact finding riding the resolver path — encouraged by task shape, never fabricated. Not-arisen never fails the cycle.
- **`analyze` as the re-score instrument**: run over the grown corpus post-runs; era-contamination flag separates development-era (incl. C7's lane) from era-current runs; the report feeds the ledger re-score.
- **Reflection + re-score**: `reflection.md` in this change (n=2 preamble); ledger re-scored in `docs/architecture/afk-runner.md` with exactly one `next` (standing expectation: U3; evidence decides). U4/U8 are the named measurement targets (reflection cost; surface-discovery cost).
- **Escape clause kept, bar stated**: crash-shaped run-blocking bugs may be fixed in-change, TDD red-first, deviation recorded; everything else is a finding.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `afk-runner-live-proof` — extends the live conformance protocol to the second cycle: both budget regimes with the ceiling-exceedance refusal live, armed deadlines with audit events, the directive-grammar veto, classified resume events, concern-memory and integrity shapes live, `analyze`-fed re-score, and the induced-fault vs operator-hack boundary. Without it the second cycle has no protocol spec and the mirror wave ships on fixtures alone.

## Impact

- Code: none planned under `afk-runner/src/**` (escape-clause fixes excepted); `tests/afk-runner/fixtures/live/` gains lanes + oracle assertions.
- Docs: `docs/architecture/afk-runner.md` (C8 row, ledger re-score, F-A4 record).
- Instances/scope: none — offline runner; no DB/chat/config-context surface.

## Non-goals

- The **cost-unknown** R4 branch live — the chosen model is priced, so that branch stays fixture-proven; recorded in the reflection.
- Multi-day unattended calendar-dominance runs — armed mechanics + audit trail only.
- Re-running settled C7 drills: stale-claim steal, bogus-model abort, stop verb, memo-parity re-proof.
- Engine behavior changes beyond escape-clause fixes; U-ledger items themselves (U3 explore, U4/U8 states) are follow-ups.
