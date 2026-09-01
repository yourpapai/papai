<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Cycle notes: v2-live-proof (C8)

The locked operator plan (recorded pre-flight per tasks 1.1; every drill the spec scenarios name is on this
roster). Working notes accumulate below; the reflection (task 7.1) is the closing artifact.

## Locked cycle plan

- **Model (all three runs, priced — cost known):** `synthetic/hf:zai-org/GLM-5.3-Flash`
  (input $0.075/M, output $0.25/M, cache-read $0.015/M — priced locally in opencode's provider table).
- **Attendance:** no time limit (operator decision).
- **Run B deadline:** `deadline: 10` (minutes) — armed on every gate; one designated gate deliberately
  unattended (drill c).
- **F-A4:** report-then-decide — the cycle produces the evidence report (task 2.2); the operator accepts or
  fixes **after** the cycle (task 7.2).

### Run matrix (design D1)

| Run | Task pick (D3) | Fallback | Budget | Deadline |
|---|---|---|---|---|
| **C** (scratch, first) | actualize `docs/architecture/coding-sessions.md` (stale `review_pr` ×7, `shareToken`, `/t/:token/*` routes; drift note in `coding-stack-overview.md` names them) | `scripts/check.sh` enumeration gap (mutation-improve/ + sdd-runner/ paths missing from two predicates) | `5` (generous; calibration) | none |
| **A** (proof, metered) | `suggest_next_task` increment 2 — event-driven suggestion payloads (files: `src/tools/suggest-next-task.ts`, `create-task.ts`, `update-task.ts`, `src/completion/verified-completion.ts`; grading reference: archived increment-1 folder) | (rejected first pick: toolgate registry port — C7 live-classified L) | placeholder `5` → **tight, calibrated from Scratch C burn at task 2.2** | none |
| **B** (proof, unmetered) | coding-agent workspace killed-turn usage under-count (files: `opencode-agent/src/claude-{contract,usage,spend,turn-classify}.ts`; documented open in `opencode-agent/README.md`) | mutation-ratchet scope for the coding-agent workspace (S6-5) | `null` (unmetered) | `10` |

### Drill roster (design D2 — induced a–e + opportunistic; the spec's scenario names)

**Induced (operator-aimable):**

- **(a) Holder kill mid-review-round** (Run A): telescope `tail -f events.ndjson` for `round_open` +
  `spawned`; kill the holder pid **and both process groups** (holder's pgid + the child's own pgid — C7
  premise correction); observe the orphan; then `resume`. Assert: exactly one classified
  `resume{session-continuation}` event for the invocation, **no second `round_open`** for the re-entered
  round (F-A1/F-A2 live), ledger continuation session, terminal memo.
- **(b) Veto through the directive grammar** (Run A, first gate carrying an assumptions section): answer
  first with a **zero-signal response** (expect rejection with directive guidance, nothing settled), then
  `VETO: <redirect>`; micro-drill while waiting: steer line `veto <foreign-id>` (expect
  consume-with-warning, waiter survives). Assert: revision work carries the gate-level redirect
  (`VetoUpdaterInput.gateRedirect`).
- **(c) Deadline expiry, unattended** (Run B, designated gate): do not answer; waiter claims at expiry;
  ladder settles (`auto_decision{rule}`) or stays pending (`auto_decision{none, pending}` + single re-arm;
  optional second expiry). All other gates answered promptly. Assert: audit events match the outcome, no
  human-settled gate carries a waiter event, memo honest after the auto outcome.
- **(d) Sidecar corruption → `POLICY-INTEGRITY`** (Run B, tail window after last `round_close`, before the
  final gate presents): flip one hash in `sidecars/round-hashes-<n>.json`. Assert: the final gate presents
  with the open `POLICY-INTEGRITY` BLOCKER substituted, no rule auto-decides, explicit human settle,
  terminal memo, strict-valid product.
- **(e) Agent-child kill → escalation-approve** (Scratch C, during draft's spawn; ×2): kill the agent
  **child** only (holder alive); watchdog retries once → fail → `stage_failed{exhausted}` → same-process
  under-budget re-run → kill again → second `stage_failed` → escalation gate (mode `escalation`) → answer
  **approve**. Capture: the same-process retry's session-ledger behavior against the `killed` entry (F-A4
  evidence — D6). Then let the run complete (`completed` memo).

**Opportunistic (pre-registered protocols; not-arisen never fails the cycle):**

- **needs-review cap-hit** — Run A: assert **refusal by ceiling** (projected spend reaching the tight
  ceiling; no verify round opens; **no `auto_decision`**; tail proceeds with unreviewed edits visible). Run
  B: assert the **bought** verification round (`round_open(n+1, cap+1)` exactly once; settles by that
  round's result).
- **third-strike thrash** — a concern fingerprint reaching its third raise: loop ends with cluster ids on
  the convergence event, verification round denied fold-derived, following gate renders
  `### Concern history`.
- **`C<n>` cross-artifact finding** — a seeded decision term rendered differently across
  proposal/design/spec becomes a synthesized MATERIAL finding naming both files and renderings, riding the
  lens→resolver path with a fingerprint.

**Cycle-level protocol points:** both budget regimes reach terminal memos through the full pipeline;
misclassification stays a recorded finding, never a `--depth` override; induced faults are pre-registered
here (the D4 boundary — an induced fault is a real condition the engine must handle honestly; faking state
remains a hack and fails the cycle); escape clause at design D5 (crash-shaped run-blockers + log-honesty
bugs, red-first, deviation recorded).

## Pre-flight record

- 2026-09-01: D3 ground paths verified on `origin/master` (78b52a1b5): all Run A/B/Scratch C files present;
  `coding-sessions.md` carries 7 `review_pr` hits + `shareToken` + `/t/:token/*` prose;
  `coding-stack-overview.md`'s drift note confirms the staleness. Task files written and prescreened
  (task 1.2); target worktrees + five-key configs created (task 1.3).
- Run A ceiling calibration: **pending task 2.2** (Scratch C per-spawn burn × C7's M spawn profile ≈ 20
  spawns; target band — the round-3 verify-round projection `spent × 4/3` crosses it, base-round
  projections do not).

## Working notes (append-only during the cycle)

(Entries land here as the cycle progresses: run ids, drill observations with event line cites, findings,
escape-clause deviations, F-A4 evidence, calibration numbers, round-shape assertions.)
