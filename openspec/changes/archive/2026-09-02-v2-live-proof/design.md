<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: v2-live-proof

> Second live cycle (C8), successor to `v1-live-proof` (C7). Explored before any live run; nothing here
> edits `afk-runner/src/**`. The C7 artifacts under `openspec/changes/archive/2026-09-01-v1-live-proof/`
> are the template; this design inherits their shape and changes only what the mirror wave changed.

## Context

C7 proved the engine live once (three runs, three crash-shaped fixes under the escape clause, one structural
hole — F-B1 veto unreachability — since closed by `gate-settle-robustness`). The branch then folded
`origin/master` (829793afc) and landed the mirror wave — `afk-runner-metered-budget`,
`afk-runner-open-vs-raised`, `afk-runner-run-analysis`, `afk-runner-loop-memory`,
`afk-runner-operator-paper-cuts` — plus `log-fidelity` (F-A1/F-A2 closed, F-A4 recorded-not-fixed). All are
fixture/test-proven; none has live-run evidence. C7's reflection §"What the next live cycle should aim at"
named deadlines, an assumptions-carrying veto, and the resume producer — written **before** the wave, so
necessary but not sufficient. The operator's C8 scope adds the wave's behaviors, and the operator's decisions
lock the instrumentation: the priced model `synthetic/hf:zai-org/GLM-5.3-Flash` on every run, so **cost is
known** — the metered run's live refusal branch is the **numeric-ceiling exceedance** (a projection reaching
a tight ceiling), exactly the branch C7 had to decline; the cost-unknown branch stays fixture-proven. A tight
ceiling on the metered run against a null ceiling on the unmetered run gives the needs-review drill both
halves without contrivance: refused-by-projection on one, bought on the other. No attendance time limit; the
Run B deadline is 10 minutes; F-A4 is report-then-decide (the operator accepts or fixes after the cycle).

## Goals / Non-goals

Goals: one attended cycle exercising the post-merge engine end to end; the mirror wave's behaviors
live-proven or honestly recorded as not-arisen; F-A4 exercised with its evidence reported for the operator's
accept-or-fix decision; the corpus report as the re-score's evidence instrument; a reflection that re-scores
the ledger with exactly one `next`. Non-goals beyond proposal.md: no performance claims beyond C7's scale;
the cost-unknown R4 branch live (the chosen model is priced — fixture evidence stands, recorded in the
reflection); no new engine behavior (escape clause excepted).

## Decisions

### D1 — Run matrix: three runs, budget regime as the independent variable

| Run | Shape | Config (five keys) | Drills |
|---|---|---|---|
| **C** — scratch, **first** | tiny doc actualization, scratch run dir | `model: synthetic/hf:zai-org/GLM-5.3-Flash`, `budget: 5`, no deadline | agent-child kill ×2 → `stage_failed{exhausted}` → escalation → **approve** → same-process retry (F-A4, D2-e); spend calibration for Run A's ceiling; plumbing shakeout |
| **A** — proof, metered | productive M: `suggest_next_task` increment 2 (D3) | same model, `budget: <tight, calibrated>` (⇒ metered), no deadline | holder kill mid-round (D2-a); veto grammar at assumptions-carrying gate (D2-b); opportunistic: needs-review **refusal by ceiling**, thrash, `C<n>` |
| **B** — proof, unmetered | productive M: killed-turn usage under-count (D3) | same model, `budget: null` (⇒ unmetered), `deadline: 10` | unattended gate → waiter expiry audit (D2-c); sidecar corruption → `POLICY-INTEGRITY` (D2-d); opportunistic: needs-review **verify round**, thrash, `C<n>` |

Scratch C runs first: it doubles as the cycle's plumbing shakeout (the mirror wave touched config parse, gate
rendering, prompts, convergence, and the waiter — cheapest place to surface a port-shaped crash) and as spend
calibration — its per-spawn burn at Flash prices, scaled against C7's M-run spawn profile (20 spawns), sets
Run A's ceiling: a value the verify-round projection crosses while the base rounds' projections do not.
Run A still gets its gates watched closest among the productive runs. No separate S/docs run: C7's
calibration purpose (config/spawn/gate/waiter plumbing) is covered by C+A, and honest-S proved ≈
docs-about-nothing-operational (C7 finding 2), so a dedicated S run buys little. Runs execute from this
worktree against fresh master worktrees via `repoRoot` (copies, never imports; targets' ground on master).
No attendance time limit (operator decision); expected wall follows C7's shape (~3–4h per M run). **The
budget regime split means a needs-review cap-hit arising on both runs yields the full contrast: refused (no
`auto_decision`, tail with unreviewed edits) on A, bought (`round_open(n+1, cap+1)`) on B.**

### D2 — Drill set: induced vs opportunistic, per-run

**Induced (operator-aimable):**

- **(a) Holder kill, re-run with new assertions.** C7's incident A, upgraded: telescope `tail -f` for
  `round_open` + `spawned`, kill the holder pid **and both process groups** (C7's premise correction — the
  child runs in its own pgid). New live assertions: exactly one classified `resume` event
  (`session-continuation` with the ledger's in-flight session id) for the resume invocation, and **no second
  `round_open`** for the re-entered round — the log-fidelity fixes F-A1/F-A2 proven live, not just in
  fixtures.
- **(b) Veto through the directive grammar.** F-B1's fix (`APPROVE` / `VETO[: <redirect>]` / `ABORT` /
  `→ RUN 1 MORE`) made veto reachable at any gate. The drill: at Run A's first gate carrying an assumptions
  section, answer first with a **zero-signal response** (expect rejection with directive guidance, nothing
  settled — the pre-flighted seam must not destroy the presentation), then `VETO: <redirect>`; the revision
  round carries the whole-gate redirect (`VetoUpdaterInput.gateRedirect`). Micro-drill while waiting: a steer
  `veto <foreign-id>` line — expect consume-with-warning, no waiter crash. Task selection makes an
  assumptions-carrying gate likely (D3).
- **(c) Deadline expiry, unattended.** Run B arms `deadline`. On one designated gate the operator does not
  answer: the waiter claims at expiry, re-runs the ladder over real gate state, and either settles (R1/R2 —
  `auto_decision{rule}` after the write) or stays pending (`auto_decision{none, pending}`, single re-arm).
  Both outcomes pass; the drill requires the audit event for whatever outcome occurred, memo honesty after
  it, and — if the ladder stayed pending — optionally a second expiry to observe the once-only re-arm.
  Subsequent gates are answered promptly (the deadline stays armed; that is itself the "armed, not
  triggered" evidence).
- **(d) `POLICY-INTEGRITY`, induced by sidecar corruption.** Window: after Run B's last review round closes
  (`round_close` on the telescope) the tail runs (decompose/atomicity) before the final gate presents — a
  minutes-wide window. Corrupt the closed round's `sidecars/round-hashes-<n>.json` (flip one hash) during
  it. Expect: the cross-check substitutes the open `POLICY-INTEGRITY` BLOCKER at presentation, no rule
  auto-decides, the operator settles explicitly (check the row to acknowledge, or veto). The corruption is
  pre-registered as an induced fault (D4), never an operator hack.
- **(e) F-A4 scratch.** Scratch run with a **real** model and a tiny task. During draft's spawn, kill the
  agent child only (its pid observable via `ps`/the session ledger; the holder stays alive). Expect: the
  watchdog's single retry, then `AgentRunError` → `stage_failed{kind: exhausted}` → under-budget same-process
  re-run; kill the child again → second `stage_failed` → escalation gate (mode `escalation`) → answer
  **approve** → the stage re-enters in the same process. **Evidence (D6)**: what the retry spawn does
  with the `killed` ledger session (`latestInFlight` counts `spawned|killed`) — continuation with preserved
  context (the accept branch's evidence) or a wedge/mis-continuation (the fix branch's). Then let the run
  complete: `completed` memo. This is also the first live escalation-**approve** (C7 incident C settled
  abort), and the run's per-spawn burn at Flash prices is Run A's ceiling calibration (D1).

**Opportunistic (pre-registered, protocol-only):**

- **needs-review cap-hit** — constructibility assessed **likely**: the verdict needs only "resolver edited
  above nitpick in the final round, everything else closed" — resolver edits are the common case
  (`resolverActionMix` measurable). Protocol: if Run A cap-hits needs-review → assert refusal (projected
  spend reaching the tight ceiling — no `auto_decision`); if Run B → assert the bought round and
  settle-by-result.
- **third-strike thrash** — moderate odds; aimed by task shape (a genuinely contentious trade-off reviewers
  keep flagging). Protocol: if a fingerprint reaches its third raise → assert the loop ends with cluster ids
  on the convergence event, the verification round is denied, and the following gate renders
  `### Concern history`.
- **`C<n>` cross-artifact finding** — aimed by task shape: a task requiring a named decision (table/column
  identifier, interval constant) that must render identically across proposal/design/spec gives the
  deterministic scan its raw material. Protocol: assert the synthesized finding names both files and
  renderings and rides the resolver path (dismissed twice + re-raised = the thrash end above).

Non-arousal never fails the cycle (spec: not-arisen scenario); it degrades to a reflection note with fixture
evidence standing, and the not-arisen shapes list feeds the next cycle's scope.

### D3 — Task candidates: named, from master's real backlog (operator delegated the pick)

Mined from `origin/master` (folders, archived Non-goals, issues; every ground path verified). Shape levers:
cross-module M in existing modules (C7's M-band squeeze — no new top-level modules, no provider prose),
assumption-bearing, contentious named decisions; all phrased off the prescreen L-keywords and vetted through
`prescreenProfile` at pre-flight (C7's three-round keyword-avoidance lesson — misclassification stays a
recorded finding, never a `--depth` override).

- **Run A — `suggest_next_task` increment 2 (event-driven suggestion payloads).** The archived increment 1
  explicitly deferred it ("attach suggestion payloads after create/update/completion"). Cross-module in
  existing files (`src/tools/suggest-next-task.ts`, `create-task.ts`, `update-task.ts`,
  `src/completion/verified-completion.ts`); assumption-bearing (payload-vs-noise, suppression during
  confirmation flows, verified-completion interplay — reviewers can contest each); contentious named
  decisions = increment-1's ranking constants (overdue ×30, 48h +20, priority +25/+20/+15/+5, recency +2)
  and the `{ suggestions, considered }` shape, which must re-render identically across artifacts
  (`C<n>`/thrash raw material); a real noise-vs-helpfulness trade-off magnet. Grading reference: the archived
  increment-1 folder. *Rejected first pick:* the toolgate registry port — C7's own live M-first-pick
  **classified L** (calm-stopped at draft; live evidence beats shape analysis).
- **Run B — opencode-agent killed-turn usage under-count.** Documented open in `opencode-agent/README.md`
  (killed turns invisible to the token budget), re-confirmed by the done `token-ceiling-excludes-cache-reads`
  Non-goals. Contained in `opencode-agent/src/claude-{contract,usage,spend,turn-classify}.ts` — logic-bearing
  M, better review-round fodder than the alternate (mutation-ratchet scope for `opencode-agent/`, S6-5 — kept
  as fallback). Task text avoids provider vocabulary (internal tooling, not a papai provider surface).
- **Scratch C — actualize `docs/architecture/coding-sessions.md`.** The drift note in
  `docs/architecture/coding-stack-overview.md` names it: stale `review_pr` references (7 hits),
  `shareToken`, `/t/:token/*` routes — none exist in `plugins/acp/` on master. Tiny, real, doc-shaped (fast
  draft — what the child-kill drill wants). Fallback: the `scripts/check.sh` enumeration gap
  (`mutation-improve/` + `sdd-runner/` paths missing from two predicates, named in
  `remove-redundant-workspace-checks`'s Non-goals).

### D4 — Induced fault vs operator hack (the pass-criteria boundary)

C7's criterion (a) said "zero operator hacks" with gate/steer/verb writes only. C8 induces faults beyond
kills: child kills, sidecar corruption, deliberately unattended gates, malformed answers. The boundary, made
explicit: **an induced fault creates a real condition the engine must then handle honestly; an operator hack
fakes state the engine did not earn.** Kills, corrupted sidecars, unanswered gates, and malformed responses
are all real-world conditions (crash, bit-rot, operator absence, operator typos) — the engine's honesty under
them is exactly what is being proven. Appending events, editing run-state to skip work, or rewriting a
settled outcome remains a hack and fails the cycle. Every induced fault is pre-registered in the drill plan
before its run starts.

### D5 — Escape clause: kept, at C7's bar plus one clause

Kept: a **crash-shaped bug that blocks completing a run at all** may be fixed inside the change, TDD
red-first, deviation recorded in the reflection (C7 precedent — all three fixes landed that way and were
correct calls). Added clause: a **log-honesty bug** (double emission, missing owed events) that would
corrupt the harvested corpus may be fixed in-change under the same bar — a harvested lane that lies is worse
than no lane. Everything else — wrong-but-non-blocking behavior, policy disagreements, cosmetic findings —
is recorded as a finding for a follow-up change. Rationale for keeping the clause at all: the mirror wave is
five re-implementations on a different engine, precisely the shape that produced C7's three; a proof change
that cannot fix a run-blocking crash proves only that runs get abandoned.

### D6 — F-A4 protocol: report, then the operator decides

Exercise per D2-e. The drill's output is an **evidence report**, not an in-cycle verdict: session-ledger
lines around each kill and retry (does the retry spawn continue the `killed` session?), whether the
continuation demonstrably preserved context (no fresh-context rebuild — cache/token shape of the retry
spawn), and whether the run proceeded coherently to its terminal memo. The reflection presents the evidence
with an accept-or-fix recommendation; **the operator decides after the cycle** (their call, verbatim:
"report and then we decide what to accept and what to fix"). If accept → F-A4's paragraph in
`docs/architecture/afk-runner.md` closes as deliberate with the live citation. If fix → a follow-up change
opens immediately with the scratch log as its red evidence (in-change only under D5's crash-shaped bar).
Either way "unproven" stops being F-A4's terminal state at cycle end; a pending decision is recorded as
pending, with the follow-up named.

### D7 — Five keys, spend, deadlines (operator decisions locked)

`workDir: .sdd-runner` default; `repoRoot` = fresh target worktree per run; `model:
synthetic/hf:zai-org/GLM-5.3-Flash` on every run — **priced**, so spend is real and cost-known, and the
live refusal branch is the numeric-ceiling exceedance (the cost-unknown branch stays fixture-proven, a
recorded non-goal). Budgets: `5` (C — generous; calibration only), **tight + calibrated** (A — see D1:
scratch-C per-spawn burn × C7's M spawn profile, set so the verify-round projection crosses it while base
rounds do not; the exact number is computed at pre-flight and recorded in the change notes), `null` (B —
unmetered). `deadline`: absent (C, A) / **10 minutes** (B — approved; long enough to answer normally, short
enough that waiting one expiry out is tolerable). No attendance time limit (operator decision). A ceiling
that misses its window (never crossed, or crossed so early mid-run spends halt) is a recorded finding — the
ladder's refusal is honest either way, and the never-cut invariants bound the damage; recalibrating and
re-running the drill is the operator's option, not the cycle's obligation.

### D8 — `analyze` as the re-score instrument

After the runs: `bun afk-runner/src/cli.ts analyze <runA workdir> <runB workdir> <scratch workdir>
tests/afk-runner/fixtures/live/ --json` (read-only; a gate-pending corpus run completes byte-unchanged).
Era handling: C7's lane (2026-08-29, pre-wave grammar — no open sets, no fingerprints) is development-era
and excluded from aggregates; C8's runs report era-current. The report's role per metric family: gate
forensics + settle-origin (waiter vs policy vs human attribution by emission order) → D2-c evidence;
`r2`-blocking-cause table → the metered/unmetered contrast; concern persistence / duplicate-id /
lens-overlap → U1/U6 evidence; retry taxonomy + `stage_failed` → D2-e evidence; consistency audit → memo
honesty across the cycle; ground-truth join → the produced changes' fate. The reflection cites the report
where a metric — not a single run — is the ground (spec requirement).

### D9 — Re-score acceptance: which evidence moves which row

| Row | Acceptance evidence this cycle |
|---|---|
| U4 (rise) | measured reflection-authoring cost this cycle (operator wall-time, honest estimate); > 1 day/cycle or re-scores needed > 1×/delivery-cycle → promote; cheap → fall to hold |
| U8 (hold) | C8 **is** the named trigger's "second attended multi-run session": measure surface-discovery cost (locating run dirs, reading gates, timing stability windows, steer) vs run wall; discovery > run → rise; else hold with the measurement recorded |
| U1/U2/U5/U6/U7 | re-check triggers against the corpus report (role concurrency, plan/children dormancy, admission bottleneck absence, concern-thrash handling — sharper now that `fingerprintOf` metrics exist, fold latency at C8 log scale) |
| U3 (hold; standing expectation: `next`) | promoted only with evidence — the two live cycles + retirement leaving execution-half as the pipeline's next frontier; the reflection argues it or displaces it; exactly one `next` regardless (tie note if forced) |
| U9 | stays delivered; no action |

n=2 preamble (both cycles named, verdicts still provisional). F-A4's evidence report and the operator's
accept-or-fix decision recorded (D6).

### D10 — Deliverable homes

`reflection.md` in this change folder (C7 pattern; the artifact doubles as the U4 prototype schema output).
Ledger table re-scored in `docs/architecture/afk-runner.md`; its C-table gains the C8 row at delivery; the
F-A4 paragraph closes, reopens, or records the pending decision per D6 + the operator's call. Harvest: every
productive run's log + memo joins
`tests/afk-runner/fixtures/live/` with the lane oracle extended (fold ≡ memo, per-line schema validation,
era reading via analyze). No new modules anywhere; no engine file is touched except under D5.

## Risks / Trade-offs

- [Neither run cap-hits needs-review] → the contrast degrades to fixture evidence; recorded not-arisen; the
  verify round stays live-unproven and the reflection says so — an honest n=2 outcome, not a failure.
- [Thrash never arises] → same protocol; concern memory's live proof shrinks to the digest/history surfaces
  that every round exercises anyway (the known-concerns digest rides every reviewer prompt).
- [Sidecar corruption kills Run B] → the corruption is of a closed round's snapshot; the gate substitution
  path is fixture-proven; if the run dies anyway, that is an escape-clause candidate and the drill's finding.
- [Deadline arms on every Run B gate and auto-decides one the operator wanted] → that is the drill working;
  auto-decisions are honest audit events and the memo reflects them; if it settles a gate prematurely the
  ladder decided by its rules — evidence, not damage (the never-cut invariants bound it).
- [Run A's calibrated ceiling misses its window] → never crossed (refusal not observable live) or crossed
  early (mid-run halts) — both recorded findings; the ladder's refusal is honest either way, never-cut
  invariants bound the damage, and re-calibrating + re-drilling is the operator's option (D7).
- [Scratch-C burn undersamples M-scale spend] → the ceiling carries explicit uncertainty; C7's M spawn
  profile is the scaling reference; a miss is D7's recorded finding, not a silent pass.
- [Model route unavailable on the day] → operator pre-flight key; any priced fallback preserves the
  cost-known design; a free-tier fallback would flip the branch back to cost-unknown and the reflection
  would note the narrowed contrast.
- [F-A4 wedge bricks the scratch run] → exactly the evidence report's bug branch (D6); the scratch log is
  the evidence; C7's incident-C abort path remains the escape.

## Migration plan

None — no runtime surface changes; artifacts and fixtures are additive. Rollback = revert the change's
commits; live runs live in operator-local run dirs and the harvested lane.

## TDD / Hook interactions

Planned code is zero (the proof runs the engine as merged). Where code can appear, the write hooks gate
`afk-runner/src/**` and the order is red-first: (1) escape-clause fixes — failing test reproducing the live
bug, then the fix, deviation recorded; (2) F-A4's bug branch, same; (3) harvest — the lane's oracle
assertions land with the harvested logs (fold ≡ memo, schema validation, analyze era reading). Config,
drill telescopes, and the reflection are outside hook scope. Full gates close the change per repo convention.
