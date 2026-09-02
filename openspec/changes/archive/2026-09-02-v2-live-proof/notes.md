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

### Operator decision (mid-cycle, 2026-09-01): model switch to `zai-coding-plan/glm-5.3`

The synthetic Flash endpoint went hard-down mid-cycle (Run A's estimator stalled 3×, ~10 min each, zero
output; a trivial probe confirmed the outage) and stayed down for >1h. The operator switched the cycle's
model to **`zai-coding-plan/glm-5.3`** (probe-verified responsive) — the design's pre-registered fallback
(D1 risk table: "any priced fallback preserves the cost-known design; a free-tier fallback would flip the
branch back to cost-unknown and the reflection would note the narrowed contrast"). Consequences, recorded
per that risk note:

- **Cost becomes unknown** (free tier: done events carry costUsd 0 with tokens > 0 → `costKnown: false`).
  On **Run A (metered)** the live refusal evidence flips from the numeric-ceiling exceedance to the
  **metered cost-unknown R4 branch** — the tight `budget: 0.5` ceiling stays configured but a $0 spend can
  never cross it; that is now a **known-in-advance ceiling-miss** (D7's recorded-finding shape), and the
  numeric-exceedance branch stays fixture-proven (the proposal's Non-goal, now by circumstance rather than
  by price). On **Run B (unmetered)** nothing changes: the cost-unknown branch is metered-only and the
  verify round remains purchasable — the scratch already bought one live.
- **Scratch C's evidence stands as-is** (it ran on the priced synthetic model to completion — F-A4 report
  and calibration basis unchanged, historical fact).
- The outage attempt on Run A (`event-driven-suggestion-payloads-for-the-task-tracker-tools`, 11 events,
  3 estimator stalls → `stage_failed{intake, exhausted}` ×2 → escalation v1 → steer `abort` → memo
  `failed`) stays in target-a's workdir as honest outage-handling evidence; it feeds `analyze` via the
  workdir but harvests no lane (not a productive run).

### Run A — completed 2026-09-01 (run `event-driven-suggestion-payloads-for-the-task-tracker-tools-2`,
target `v2-live-proof-target-a`, 793 events, terminal memo `completed`, `zai-coding-plan/glm-5.3`, cost
$0.00 → cost-unknown, metered ceiling 0.5 configured)

**Outage prelude** (recorded above under the model switch): first attempt (base slug, 11 events) burned 3
estimator stalls ×10 min on the down synthetic endpoint → `stage_failed{intake, exhausted}` ×2 → escalation
v1 → steer `abort` → memo `failed`. The restart (suffix `-2`; intake's scaffold-skip idempotence held —
crash-fix #3's behavior on a fresh run) classified **M** honestly (estimator rationale: cross-module in the
four named files, existing-modules novelty; prescreen had said M — no misclassification).

**Drill (a) — holder kill mid-review-round — all assertions landed.** Round 1 opened seq 246
(`round_open{1, cap 3}`) with reviewer-r1 in flight (child 76466, own pgid — C7's premise re-confirmed);
killed the holder pid 57489 **and its pgid 57486**; the orphan survived ~15 s reparented to ppid 1 (observed
mid-flight, still emitting pre-kill output into no consumer), then died by its own group. `resume` appended
**exactly one classified `resume{path: session-continuation, stage: review, session: ses_fa322420…}`** (seq
296) and **no second `round_open`** for round 1 — F-A1/F-A2 live. The ledger's retry (attempt 2) continued
the **same** opencode session id — cross-process continuation works and is now log-visible through the
resume event.

**Drill (b) — directive grammar at the final gate.** Final gate v1 presented seq 655; the always-logging
ladder recorded `auto_decision{rule: R4, decision: gate}` seq 656 — **the metered cost-unknown R4 branch,
live** (free-tier costUsd 0 + tokens > 0 → costKnown false; the branch the proposal had parked as a
non-goal, arrived via the model switch). The gate carried an **empty** assumptions section (the drafter
logged none — the drill ran at the item-less gate, which is exactly F-B1's historically-unreachable shape):
- **Zero-signal probe — passed**: prose-only `## Gate response` section rejected with directive guidance
  ("no decision signal — write APPROVE or VETO: <redirect> …"), the `gate-1.response-error.md` artifact
  written, nothing settled, waiter alive.
- **Steer foreign-id probe — FAILED LIVE, finding F-C1**: `veto Z9=steer probe with a foreign id` was
  consumed (steer.md removed) and **crashed the waiter** — `steerAnswers` renders the foreign item id,
  `preflightRoundtrip` throws ("→ line with no preceding assumption or blocker", full stack through
  `settleGateWithAnswers` → `steerTick` gate-waiter.ts:185), and the steer branch handles `{rejected}`
  results but not **throws** — F-B2's containment covered the gate-file settle path only. The settle claim
  was released (attempt-scoped finally — no F-B3 wedge) and the run was not blocked (resume re-attaches a
  waiter; event-sourced recovery). **Not escape-clause-eligible under D5** (not run-blocking, not
  log-honesty) → recorded for a follow-up change; the drill's "waiter survived" assertion is recorded as
  failed with the log as evidence.
- **Veto directive — passed**: `VETO: <redirect>` settled `gate answered{final, v1, veto}` seq 659 — veto
  reachable at an item-less gate, live. Revision: `stage_enter draft` seq 661/662 (settle mover + the fresh
  drive's designed self-loop enter), `veto-updater` spawn seq 663; the redirect landed — the artifacts now
  carry `EVENT_PAYLOAD_CAP = 3` as a named decision **rendered identically in proposal, design, and spec
  delta** (the `C<n>` vocabulary's raw material), tasks 10→12. Final gate re-presented **v2** seq 789 +
  R4 record seq 790; `APPROVE` seq 793 → `completed`; `openspec validate --strict` green in the target.
- **Spec-vs-live observation**: the veto revision did **not** open a new review round — the "Veto at a
  final gate" scenario's middle clause ("the review loop opens a new round over the existing cap") diverges:
  the folded round state (3/3 converged) routes review straight through, the revision rides the tail re-run
  (decompose/atomicity re-ran over the revised artifacts) and no round reviews the revision — an
  unreviewed-revision shape visible at v2. Recorded for the reflection; the scenario's outer clauses (draft
  re-entry, v2 re-presentation) held.

**Task 3.4 — needs-review refusal: NOT-ARISEN.** Round 3 converged at cap (seq 573, counts 0b/0m/2n, open
0/0/0) — no needs-review cap-hit ever arose, so the refusal branch had no window; and the ceiling itself
($0.5) is uncrossable at $0 spend after the model switch (known-in-advance ceiling miss, recorded under the
model-switch note). Fixture evidence stands for both refusal branches (`verificationBudgetRefuses`:
cost-unknown and numeric-exceedance are test-pinned); the scratch run live-bought the round on a metered
run with known cost; Run B (unmetered) carries the bought-round assertion next.

**Resume-event accounting**: exactly 2 `resume` events for 2 invocations (seq 296 session-continuation; the
post-crash waiter restart artifact-skip/gate) — one per invocation, none deduplicated.

### Run B pass 1 — completed without its drills (operator miss; re-drill follows)

Run `count-killed-turns-in-the-coding-agent-workspace-usage-totals` (target-b, ~810 events, `completed`,
`zai-coding-plan/glm-5.3`, unmetered, deadline 10 armed): classified **M** honestly; four review rounds —
rounds 1–3 all `needs-review` with everything closed, **round 3 needs-review AT CAP bought the verification
round live** (`round_open{4, cap 4}` seq 604 — task 4.3's assertion landed: exactly once, `n+1/cap+1` shape);
round 4 converged → tail. **Bonus settle-origin evidence**: the final gate presented seq 805 with
`deadlineAt` stamped (armed), the ladder auto-approved via **R1** — `auto_decision{rule: R1, decision:
approve}` seq 806 **before** `gate answered` seq 808 (10 ms apart) — replay-distinguishable policy
attribution live; the deadline never claimed (armed-not-triggered on a policy-settled gate); no waiter event
on the human-free settle. Product strict-valid in the target.

**The miss**: the tail ran in ~30 s (decompose + atomicity fast on the free-tier model) — D2-d's
"minutes-wide window" premise did not hold, and the operator's polling interval blew through it: no sidecar
corruption, no unattended gate. Drills (c) and (d) are INDUCED (operator-aimable) — not-arisen does not
apply, and the spec's induced-set coverage requires them. **Re-drill launched** (same task file, config-b
unchanged; the new run suffixes `-2`; intake's scaffold-skip re-enters the existing change folder; the
draft overwrites in place — visible as an uncommitted diff in the target): corrupt the final round's
`round-hashes-<n>.json` the moment its `round_close` lands (2 s poll), then let the deadline claim the
integrity-substituted final gate unattended, then settle explicitly. The 30 s tail window itself is
recorded as a cycle finding (friction: induced-fault windows are tail-speed-bound — the D2-d premise
correction).

### Run B — completed 2026-09-02 after four passes (drills landed on pass 4; matrix slot = target-b,
`zai-coding-plan/glm-5.3`, unmetered `budget: null`, `deadline: 10` armed)

**Pass 1** (`…usage-totals`, ~810 events, completed): classified **M** honestly; rounds 1–3 all
`needs-review` with everything closed; **round 3 needs-review AT CAP bought the verification round live** —
`round_open{4, cap 4}` seq 604, exactly once, the `n+1/cap+1` shape (task 4.3's assertion, landed here);
round 4 converged → tail. Settle-origin bonus: the final gate's ladder auto-approved via **R1** with
`auto_decision{rule: R1, decision: approve}` seq 806 **before** `gate answered` seq 808 (10 ms) —
record-before-answer policy attribution, replay-distinguishable; deadline stamped (armed) and never claimed
(armed-not-triggered on a policy-settled gate); no waiter event on the human-free settle. Product
strict-valid. **Miss**: the tail ran ~30 s and outran the operator's poll — drills (c)/(d) unlanded (the
"minutes-wide window" premise of D2-d is falsified by a fast tail; recorded finding/friction).

**Pass 2** (`…-2`, completed): strike landed +2 s after the tail entered — flipped one hash in
`round-hashes-3.json` — but the flip was **inert**: round 3 converged with every resolution dismissed, so
the gate round's recomputation never keyed on digests (an `edited` claim is what makes a snapshot hash
load-bearing) and R1 approved at presentation (seq 718/720). Lesson recorded: the task-text prescription
"flip one hash" under-specifies the required round shape; the spec's alternative shape (resolver-output
corruption) is shape-independent.

**Pass 3** (`…-3`, completed): operator miss — the watch loop started minutes after the round closed
(a local-vs-UTC clock illusion in the operator's telemetry) and the unparseable-sidecar strike landed 4 min
**after** the gate had presented and R1-settled. Inert by ordering, not by shape.

**Pass 4** (`…-4`, 424+ events, completed) — **drill (d) landed, (c) blocked by F-C3**:
- **(d) POLICY-INTEGRITY**: `resolutions-1.json` corrupted to unparseable **1 s after** `round_close` (seq
  325) landed, tail ran ~3 min; final gate presented seq 419 with `deadlineAt` and the ladder recorded
  `auto_decision{rule: none, decision: gate}` seq 420 — **no rule auto-decided** (the substitution's core
  assertion; passes 1–3 had each R1-approved in ~5 ms). The operator settled explicitly (`APPROVE` seq 424)
  → `completed`; product strict-valid.
- **F-C2 (finding)**: the rendered gate file carried **no POLICY-INTEGRITY row** — `presentFinalGate`
  builds the digest's findings from the *unguarded* `readReviewResultFromSidecars` result (which degrades
  unparseable to empty-converged), while only the *ladder's* signals run through `guardedReviewResult`.
  The ladder refuses to decide but the operator surface shows a clean gate; the only trace is the
  `rule: none` record. "Check the row to acknowledge" is impossible — settled via the APPROVE directive
  with this note as the acknowledgment record.
- **(c) deadline expiry — blocked by F-C3 (finding)**: the deadline armed (presented seq 419 carries
  `deadlineAt` 05:09:29Z) but **never claimed** — `processExpiry` returns null unless its ports carry
  `now`/`repoRoot`/`autonomy`, and the production waiter wiring (`waitSettledGates` in `run-resume.ts`)
  passes none of the three, so **the deadline waiter is inert in production**; the gate sat 3 min past
  expiry with a live waiter doing nothing. Fixture suites inject full ports, so tests never see the gap.
  Drill observables degrade to: armed-never-claimed, no audit events (vacuously — no waiter settle exists),
  no human-settled gate carries a waiter event ✓, memo honest after the human settle ✓. Per D5 this is
  neither run-blocking nor log-honesty → recorded, not fixed in-change (C7's F-B1 precedent).

**Run B ledger of record for harvest**: pass 4 is the matrix slot's drill-carrying run (the `-4` log
harvests as the Run B lane); pass 1's bought-verify-round evidence (seq 604) and passes 2–3 stay
workdir-resident and reach the corpus report via `analyze` over the workdirs. Session-id suffixing
(`-2`/`-3`/`-4`) worked as designed across the re-drills (terminal holders release their slugs' live claim;
intake scaffold-skip re-entered the existing change folder each time).

### Operator missteps (recorded for honesty; none is an engine finding)

- Worktrees initially created at a nested relative path so the config's `repoRoot` pointed at a phantom dir
  holding only `.sdd-runner/`; the first launch then failed at `openspec new change` with "Schema 'auto-sdd'
  not found" — that was the phantom cwd resolving to a foreign openspec root, not an engine bug. Fixed by
  moving the worktrees to the canonical paths; the same spawn re-verified exit 0 from the real target.
- The first launch's dead run dir lived in the phantom path and was removed with it; no run-state surgery
  touched any real run.
- (3) Run B pass 1 drill miss — the 30 s tail outran the operator poll; induced drills re-aimed at the
  re-drill runs (pass 3's miss was a local-vs-UTC clock illusion; both are timing, not engine).


### Harvest record (task 5.2)

Both C8 lanes copied and the extended oracle green (9/9): `event-driven-suggestion-payloads-live` (Run A, 793 events) and `killed-turn-usage-undercount-live` (Run B pass 4, 424 events); lane README updated. Secret scan: the only sk-/key-shaped strings in Run A's log are filename fragments (`task-` substrings of `suggest-next-task-ranking.ts` etc.); Run B clean. Pass 1-3 logs and the scratch stay workdir-resident (analyze reads them there).

### Corpus report (task 6.1)

`corpus-report.json` saved in this folder — `analyze` over the three workdirs + the live lane dir, all 7 runs (outage attempt `failed`, Run A, Run B passes 1-4, Scratch C) era-current and aggregated (era-contaminated: none; the consistency-signature era flag found no contamination in any C8 log — see the D8 correction in the lane oracle). Metrics report known / unknown-with-reason with no errors (e.g. Run A r2: "no cap-hit convergence pairs"; usage costKnown false everywhere after the model switch — the free-tier shape). Ground-truth join reads 0 committed changes (all produced changes are uncommitted in their target worktrees — the honest not-on-a-ref reading). **Read-only contract confirmed**: shasum over every file in all three workdirs before/after the analyze invocation — byte-identical (204 files).

### Full verification (task 8.1)

- `bun run test`: the initial run (host loadavg 18.8 — the shared-host load-flake regime) failed 11 tests in 5 files; per the testing runbook each was re-run file-by-file: gate-deadline 15/15 green, gate-waiter 23/23 green, veto-revision 3/3 green, opencode-agent/shell 6/6 green, telegram 1 fail — **environment-shaped**: `resolveUserId` makes a real `api.telegram.org` call that hangs on this host (curl: 000 after 8s — no egress), so the fail-fast-to-null contract cannot hold; the path is untouched by this branch (empty diff vs master) and the same branch's full gate at 6ec9f2d68 was 0-fail. Everything else passed in the full run.
- `bun run typecheck`: green. `bun run lint`: green (0 problems).
- `bun run duplicates`: exit 0 — 88 clones, the pre-existing never-masked drift under the 10% threshold per the R5 adjudication.
- Docs currency: afk-runner.md re-scored ledger + C8 row + F-A4 record; AGENTS.md docs-table row updated (C1-C8, two live-proof cycles, next: U3).

### Post-cycle operator decisions (2026-09-02)

- **F-A4: FIX** (over the reflection's accept recommendation) — same-process retries will reuse the killed session via the continuation seam; follow-up change `escalation-retry-session-continuation` opened with the C8 scratch ledger as red evidence.
- **F-C1/C2/C3: fix as one change** — `afk-runner-operator-surface-robustness` opened (steer-settle containment, rendered integrity blocker, wired expiry ports).
- **Priced route: restore cost-known operation** — `opencode-priced-model-route` opened (machine-global opencode config with official API price tags, the synthetic entry as template; re-arms the numeric-ceiling refusal drill for C9).

All three validate --strict and are ready for a fresh explore/propose session.
