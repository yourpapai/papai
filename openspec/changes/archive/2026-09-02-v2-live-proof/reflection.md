<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Reflection: v2-live-proof (C8)

**n=2 preamble.** Everything below rests on two attended live cycles — C7 (2026-08-29, free-tier, three
runs) and this one (2026-09-01→02, seven runs across three matrix slots: Scratch C on the priced
`synthetic/hf:zai-org/GLM-5.3-Flash` until its endpoint's outage, then the operator's pre-registered
free-tier fallback `zai-coding-plan/glm-5.3` for Run A and Run B, cost-unknown). Verdicts stay provisional;
each carries its falsifiable trigger. The working evidence (event-line cites, run ids, calibration math) is
`notes.md` in this change; the corpus report is `corpus-report.json`.

**Runs and artifacts cited:** Scratch C `actualize-the-coding-sessions-architecture-page` (target-c, 583
events, completed, $0.233 metered — the priced-model run); Run A first attempt
`event-driven-suggestion-payloads-for-the-task-tracker-tools` (11 events, `failed` — outage abort) and the
proof `…-tools-2` (793 events, completed — harvested lane `event-driven-suggestion-payloads-live`); Run B
passes 1–4 `count-killed-turns-in-the-coding-agent-workspace-usage-totals{,-2,-3,-4}` (all completed; pass 4
harvested as `killed-turn-usage-undercount-live`; pass 1 carries the bought-verify-round evidence).

## Pass criteria

- **(a) No operator surgery — pass, with the induced-fault audit.** Events were appended only by the
  runner; operator writes were gate answers (gate files + one steer `abort`), steer probes, the
  resume/stop verbs, and the pre-registered induced faults: 4 agent-child kills (holder alive), 1
  holder+both-pgid kill, 2 sidecar corruptions (one inert by shape, one inert by ordering, one effective),
  1 deliberately unattended gate, 2 malformed-answer probes (zero-signal prose, foreign-id steer veto).
  Every induced fault's condition was real — the engine handled each honestly (declared failures,
  continuation, substitution, rejection); no state was faked. Three operator missteps (phantom worktree
  path, a local-vs-UTC clock illusion, two blown tail windows) are recorded in the notes and touched no
  run state.
- **(b) Incidents through documented verbs only — pass with findings.** The kill recovered via `resume`
  alone (one classified `resume{session-continuation}`, no second `round_open` — F-A1/F-A2 closed live);
  the escalation-approve settled through the gate file; the veto settled through the directive grammar
  (F-B1's fix live at an item-less gate); the integrity gate settled explicitly. Two probes exposed new
  holes recorded as findings, not fixed (F-C1, F-C2, F-C3 below) — all below D5's bar (none run-blocking,
  none log-honesty).
- **(c) Products validate strictly — pass.** All five completed productive runs' changes pass
  `openspec validate --strict` in their target worktrees (Scratch C, Run A, Run B passes 1–4 share the B
  change folder; each re-draft validated).
- **(d) Memo/report honesty — pass.** `memoFieldsOf(fold(log))` ≡ persisted memo at terminal for every
  harvested lane (now a permanent per-lane oracle assertion); both budget regimes reached terminal memos
  through the full pipeline (Scratch C + Run A metered; Run B unmetered) — the spec's regime scenario
  holds; parks checked during attendance matched.
- **(e) ≥3 concrete frictions — pass.** Six named below.

**Verdict: the cycle passes with findings.** The post-mirror-wave engine ran the full matrix live with
honest logs; four new findings (F-A4's answer plus F-C1/C2/C3) and two spec-expectation corrections came
back — exactly what a second live cycle is for.

## Pre-registered drills, adjudicated (none silently dropped)

| Drill | Verdict | Evidence |
|---|---|---|
| (a) Holder kill mid-round → classified resume, no double round_open | **landed** | Run A seq 246/296: one `resume{session-continuation}` carrying the ledger's in-flight session; round 1 never re-opened; attempt-2 ledger reused the same opencode session |
| (b) Veto through the directive grammar (zero-signal first) | **landed, with F-C1** | zero-signal rejected with guidance (response-error artifact, nothing settled); `VETO:` settled seq 659; redirect carried (`EVENT_PAYLOAD_CAP = 3` identical across artifacts); the steer foreign-id probe **crashed the waiter** (F-C1) — the probe's survival assertion failed live |
| (c) Unattended gate past armed deadline | **blocked by F-C3** | deadline armed on every Run B gate (`deadlineAt` on presented events); expiry never claimed — the production waiter omits the expiry ports (F-C3); no audit events exist to assert; armed-not-triggered observed on R1-settled gates (pass 1 seq 805–808) |
| (d) Sidecar corruption → POLICY-INTEGRITY | **landed, with F-C2** | pass 4: unparseable `resolutions-1.json` → ladder `auto_decision{rule: none}` (no rule auto-decided, vs 5 ms R1 insta-approves on clean passes); explicit human settle; the rendered gate file omitted the blocker row (F-C2) |
| (e) Agent-child kill → escalation-approve (F-A4) | **landed** | Scratch C: `stage_failed{exhausted}` pair seq 38/50, escalation v1, first live approve settle seq 54; evidence report below |
| needs-review refusal (metered, by ceiling) | **not-arisen** | Run A round 3 converged at cap — no cap-hit; and after the model switch the $0 spend can never cross the 0.5 ceiling (known-in-advance miss, per the fallback risk note); the cost-unknown refusal branch did run live as R4 at both final presentations (seq 656/790) — refusal-shaped evidence, different branch; numeric-exceedance stays fixture-proven |
| needs-review bought round (unmetered) | **landed** (twice) | Scratch C round 1→`round_open(2, cap 2)`; Run B pass 1 round 3 at cap → `round_open(4, cap 4)` seq 604 — exactly once each, `n+1/cap+1` |
| third-strike thrash | **not-arisen** | no fingerprint reached a third raise in any run (no thrash `concerns` clusters); fixture evidence stands |
| `C<n>` cross-artifact finding | **not-arisen** | the deterministic scan found no cross-artifact disagreement (Run A's artifacts render the named decisions identically — verified by hand at the veto drill); not-arisen, never fabricated |

Not-arisen shapes seed the next cycle (below); per the spec they do not fail this one.

## Findings (all recorded for follow-ups; none escape-clause-eligible)

- **F-A4 answered (report below): same-process escalation retries rebuild fresh — no continuation.**
- **F-C1 — the steer settle path crashes the waiter on throws.** A well-formed steer item-veto with a
  foreign id renders an answer whose preflight parse-back throws; `steerTick` handles `{rejected}` results
  but not throws (gate-waiter.ts:185; full stack in notes). F-B2's containment covered the gate-file path
  only. The claim released cleanly; `resume` re-attaches; not run-blocking.
- **F-C2 — the substituted POLICY-INTEGRITY blocker is invisible in the rendered gate.** The ladder's
  signals run through `guardedReviewResult` but `finalDigestInput` builds findings from the unguarded
  reader (which degrades unparseable to empty-converged): the ladder refuses to decide, the operator sees a
  clean gate. "Check the row to acknowledge" is impossible today.
- **F-C3 — the deadline waiter is inert in production.** `processExpiry` requires ports
  `now`/`repoRoot`/`autonomy`; `waitSettledGates` passes none — deadlines arm (event field) and never
  claim. Fixture suites inject full ports, so tests pass. This blocks drill (c) evidence until fixed.
- **Era-flag expectation corrected (design D8 vs measurement):** the era-contamination flag keys on
  consistency signatures, not grammar dates; C7's internally-consistent lane reads era-current. The
  oracle asserts the measured truth; the development-era exclusion demonstrates over the legacy corpus.
- **Veto revision opens no new review round:** after a final-gate veto the folded round state routes
  review straight through — the revision rides the tail re-run unreviewed (the spec scenario's middle
  clause diverges; outer clauses held). Whether a post-veto re-review is owed is a policy question for a
  follow-up.
- **R1 insta-settle vs induced-fault windows:** a clean-converged final round auto-approves ~5 ms after
  presentation, and the tail can run ~30 s — operator-aimed tail-window faults (D2-d) get a window that
  is tail-speed-bound, not "minutes-wide" (D2-d's premise correction; two passes were lost to it).

## F-A4 evidence report (D6) — the operator's accept-or-fix input

Recorded hypothesis (log-fidelity): same-process escalation retries consume `killed` ledger sessions as
continuations — possibly deliberate. **Disproven in the continuation direction by Scratch C:** every
post-kill spawn — watchdog retry, under-budget re-run, and the escalation-approve retry — minted a fresh
opencode session id; none referenced a killed id; the retry prompt is the plain base prompt
(`buildContinuationPrompt` rides only the cross-process resume seam, where continuation demonstrably works
— Run A's drill (a) attempt-2 continued the killed reviewer's session). Context preservation: none
same-process — the rebuild was softened only by endpoint prefix caching (first step cacheRead 16.4K of
18.8K input vs 64 on the original fresh spawn); the killed attempt's partial work is lost. Coherence: the
run completed end-to-end after both failures with an honest memo and a strict-valid product.
**Recommendation: accept as deliberate** — fresh-retry is the simpler honest semantic, cheap at prefix-cache
prices, and continuation remains where it matters (cross-process resume). **Decision: presented to the
operator — pending at reflection time** (recorded as pending with the follow-up named
`escalation-retry-session-continuation` should the operator choose fix).

## Measurements (named targets)

- **U4 — reflection authoring cost:** this artifact + the ledger re-score + notes upkeep ≈ 1.5 focused
  hours of session time atop a ~25 h calendar cycle (~10 h attended) — under the "> 1 day/cycle" promote
  trigger and not cheap enough to fall below hold's bar. The manual prototype remains one-session-sized
  at n=2.
- **U8 — surface-discovery cost:** locating run dirs, timing kill/corruption windows, diagnosing the
  phantom-path schema error and the clock illusion ≈ 1.5–2 h of the ~10 h attended span — discovery stays
  well under run wall (< 20%); the misses were operator-telemetry-shaped (clock illusion, polling
  cadence), not surface-absence-shaped. Raw gate files + steer + events.ndjson `tail` remained sufficient.

## Ledger re-score (U1–U9, n=2 — provisional; corpus report cited where a metric is the ground)

| #  | Follow-up                                   | Verdict | Evidence (run artifacts / corpus report)                                                                                       | Re-opening trigger (falsifiable)                                                                 |
|----|---------------------------------------------|---------|------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------|
| U1 | team/mission spawner                        | hold    | every stage single-spawn or the two-lens merge across 7 runs; zero role-scheduling failures (corpus: retry taxonomy clean) | a stage needs >2 concurrent schema-carrying role agents and the ad-hoc merge shows measurable finding loss |
| U2 | child-actor execution                       | park    | plan/children `null` in every persisted memo across both cycles                                 | a decompose plan whose tasks genuinely parallelize and serialized wall becomes the bottleneck     |
| U3 | execution-half states                       | **next**| two live cycles prove the think-half end-to-end (7 runs, 5 productive completions, honest memos at every park); retirement removed the legacy twin; all four C8 findings live in operator surfaces (F-C1/C2/C3) and artifact quality — the engine's frontier moved past think-half state | the first execution-half change enters the pipeline and verify/release states must host it |
| U4 | documenting + reflection states             | hold    | measured ~1.5 h this cycle (under the trigger); the reflection is still a manual prototype with growing per-cycle finding load (4 this cycle) | reflection cost crosses a day per cycle, or re-scores are needed more than once per delivery cycle |
| U5 | vision intake / L4 portfolio                | park    | admission stayed human task-file authoring; absence of evidence again                           | candidate changes queue faster than human admission can vet them                                  |
| U6 | `conflict_detected`                         | park    | zero unresolved reviewer-vs-drafter conflicts across 11 review rounds (corpus: concern persistence clean, no thrash clusters) | a live round's findings oscillate without convergence and the resolver re-opens one gap twice     |
| U7 | snapshot memo for the fold                  | fall    | largest C8 log (793 events) folds in ~10 ms in the lane oracle; resume re-folds instant            | logs pass ~10⁵ events or a measured resume fold exceeds perceptible latency                      |
| U8 | TUI re-host as pure fold render             | hold    | measured discovery < 20% of attended wall; attendance completed the whole protocol through raw surfaces again | a cycle where surface discovery + drill timing exceed the run wall (the clock-illusion class recurs) |
| U9 | sdd-runner retirement; cross-run accounting | delivered | no action (both halves landed pre-C8; the `runs`/`analyze` surfaces were this cycle's instruments) | — |

**Exactly one `next`: U3.** No tie: U4's and U8's triggers were measured and not crossed; the
findings-follow-up (F-C1/C2/C3) is a robustness change, not a ledger row, and is named below as the
immediate next change ahead of U3.

## Frictions (six, above the floor of three)

1. Tail-window drills are tail-speed-bound (~30 s tails vs "minutes-wide" premise; two passes lost).
2. The steer probe crashes the waiter (F-C1) — a malformed operator answer kills the attending process.
3. The integrity blocker is invisible in the gate file (F-C2) — the operator acknowledges a failure they
   cannot see rendered.
4. Deadlines arm and never claim (F-C3) — the armed field implies a behavior nothing delivers.
5. Operator telemetry illusions: local-vs-UTC clock confusion and no first-class "where is the window"
   signal (U8-shaped, but caused no damage beyond lost passes).
6. Free-tier cost-unknown collapses the metered contrast (the ceiling branch needs priced spend; the
   fallback was pre-registered and still narrowed the cycle's evidence).

## What the next live cycle should aim at (C9 scope seed)

1. **The operator-surface robustness change** (immediate): F-C1 (contain steer-settle throws),
   F-C2 (render the substituted blocker), F-C3 (wire the expiry ports) — all three block or degraded
   pre-registered drills; F-C3 alone re-opens the deadline drill.
2. **The not-arisen shapes:** numeric-ceiling refusal (needs a priced run), third-strike thrash,
   `C<n>` cross-artifact finding — task selection can aim at them again.
3. **U3's argument** stands for the planning cycle after those: execution-half states.
