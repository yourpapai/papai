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

### Scratch C — completed 2026-09-01 (run `actualize-the-coding-sessions-architecture-page`, target
`v2-live-proof-target-c`, 583 events, wall 04:27:26Z→09:33:30Z attended, terminal memo `completed`, spend
$0.233 metered, 13 spawns / 8 successful)

**Drill (e) — agent-child kill → escalation-approve — landed as designed.** Killed drafter children only
(holder alive) at four points: attempt 1 (pid 3762, session recorded), the watchdog retry (3815), the
under-budget re-run (3861), its watchdog retry (3907). Event chain: `retrying{stall}` seq 37 →
`stage_failed{draft, exhausted}` seq 38 → same-process re-run `spawned` seq 39 → `stage_failed` seq 50 →
`gate presented{escalation v1}` seq 51 + ladder `auto_decision{none, gate}` seq 52 → start parked and exited
cleanly. Resume appended one classified `resume{artifact-skip, gate}` seq 53; the gate file's T1 box checked
settled `gate answered{escalation, v1, approve}` seq 54 → settle mover `stage_exit/stage_enter draft` seq
55/56 → the fresh drive call's own self-loop `stage_enter` seq 57 (each foreground settle → fresh `drive()` →
one self-loop enter; the `runWorkBracket` `!bracketOpen || !loop.entered` guard makes this the designed
resume-equivalence shape, not a defect — first live escalation-**approve**; C7's settled abort).

**F-A4 evidence report (design D6; the operator's accept-or-fix input — task 7.2 decides).**

- **Ledger lines around the kills/retry** (`sessions.jsonl`, all `drafter-proposal` r0):
  - attempt 1 `ses_fa4c70f1…`→ no — attempt 1 `ses_fa4c5776affe…` status `spawned`→`killed` (kill #1)
  - attempt 2 `ses_fa4c4f147ffe…` (the watchdog retry's own fresh session) → `killed` (kill #2)
  - attempt 3 `ses_fa4c48965ffe…` (the under-budget re-run's fresh session) → `killed` (kill #3)
  - attempt 4 `ses_fa4c31258ffe…` (the escalation-approve retry) → **fresh session id**, `done`.
- **Does the retry continue the `killed` session?** **No.** Every post-kill spawn — watchdog retry,
  under-budget re-run, and the escalation-approve retry — minted a **fresh** opencode session id; none
  referenced a killed id; the retry prompt is the plain base prompt (`buildContinuationPrompt` rides only the
  cross-process resume seam, which is exactly where C7's incident A proved continuation *does* work). The
  recorded F-A4 hypothesis ("same-process escalation retries consume `killed` ledger sessions as
  continuations — possibly deliberate") is **disproven in the continuation direction**: same-process retries
  rebuild.
- **Context-preservation shape:** the retry's first step shows `input 18,773 / cacheRead 16,448` vs the
  original spawn's `input 35,152 / cacheRead 64` — the rebuild was softened by the endpoint's transparent
  prefix caching (same prompt prefix), but the killed attempt's partial work/thoughts were lost, not
  preserved. Cost consequence is bounded: one rebuilt first step (~$0.001 at Flash cache-read prices); no
  wedge, no mis-attached session, no ledger corruption.
- **Coherence verdict:** the run proceeded coherently end to end after both failures — attempt 4 completed
  the draft ($0.031), the run converged, terminal memo `completed`, produced change strict-valid in the
  target (`openspec validate --strict` green), memo matched the folded log at every park checked.
- **Branch:** this is **accept-shaped evidence** — behavior is honest (fresh-retry), cheap (prefix cache),
  and coherent; the alternative (continuing a killed child's session) is what the cross-process resume seam
  already does where it matters. Recommendation to the operator: **accept as deliberate**; F-A4's paragraph
  should close saying same-process retries rebuild fresh (with the prefix-cache observation), reserving
  session continuation for cross-process resume. The operator decides at 7.2.

**Bonus live shapes the scratch already exercised** (recorded here; reflection cites them):

- **Needs-review cap-hit → verify round bought — live, on the scratch** (unmetered-of-consequence: ceiling
  $5 never approached): round 1 verdict `needs-review` at cap (seq 417, counts 0b/2m/2n, open 0/0/0) →
  `round_open(2, cap 2)` seq 421 — the bought verification round, exactly once; round 2 converged (seq 535,
  0b/0m/2n, open 0/0/1) → tail. The Run B assertion (4.3) has its fixture-plus-scratch-live precedent.
- **Specs-skip path live**: drafter-specs wrote `specs-skip-record.md` + `.openspec.yaml skip_specs: true`
  for the docs-only change (one validation retry first) — the skip-specs contract works live.
- Estimator classified **S** honestly with a code-verified rationale (found all three stale claim families
  itself); prescreen had said S — no misclassification to record.

**Run A ceiling calibration (design D1/D7).** Scratch actuals: per-role successful-spawn burn — estimator
$0.0085, drafters avg $0.045 (n=2), reviewers avg $0.039 (n=2), resolvers avg $0.022 (n=2), decomposer
$0.0135; run total $0.233 over 13 spawns (8 successful). Scaled against C7's M spawn profile (~20 spawns:
estimator 1, drafters 4, review 3 rounds × reviewer+skeptic+resolver, decompose + atomicity + retry slack):
estimated spend at a round-3 cap-hit S3 ≈ $0.37 (no-skeptic shape, as the scratch actually ran) to $0.49
(skeptic shape); verify-round projection S3×4/3 ≈ $0.50–$0.65; round-2 projection ≈ $0.47–$0.58. **Set
`budget: 0.5`**: the round-3 verify projection crosses it in both shapes (no-skeptic borderline ≥), the
round-2 projection does not in the no-skeptic shape; the skeptic shape may label one early gate R4
(cosmetic — an attribution label, never an auto-settle or a cut; recorded if seen). Stated uncertainty (D7):
scratch burn is S-scale — M drafters read more (4 src files + the increment-1 folder), pushing S3 up and
favoring the crossing; if the ceiling is never crossed (or crossed early), both are recorded findings per
D7, never-cut invariants bound the damage, and recalibration + re-drill is the operator's option.

### Operator missteps (recorded for honesty; neither is an engine finding)

- Worktrees initially created at a nested relative path so the config's `repoRoot` pointed at a phantom dir
  holding only `.sdd-runner/`; the first launch then failed at `openspec new change` with "Schema 'auto-sdd'
  not found" — that was the phantom cwd resolving to a foreign openspec root, not an engine bug. Fixed by
  moving the worktrees to the canonical paths; the same spawn re-verified exit 0 from the real target.
- The first launch's dead run dir lived in the phantom path and was removed with it; no run-state surgery
  touched any real run.

