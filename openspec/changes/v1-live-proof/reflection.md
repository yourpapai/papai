<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Reflection: v1-live-proof (C7)

**n=1 preamble.** Everything below rests on one attended live session (2026-08-29, three runs: one S-shaped
calibration, one M proof run carrying incidents A and B, one scratch declared-failure drill), free-tier
`zai-coding-plan/glm-5.3`, $0.00 metered spend, ~3h wall. Every verdict is provisional; each carries the
falsifiable trigger that re-opens it. This artifact is itself the prototype output schema an automated
reflection state (U4) would emit.

**Runs and artifacts cited:** S run `docs-actualization-for-the-github-task-tracker-plugin` (target worktree
`v1-live-proof-target`, branch `live-proof-target`, 817 events, completed); M first pick
`operator-tool-gates-via-registry` (target `v1-live-proof-target-m`, depth L, calm-stopped at draft — evidence
keeper); M proof run `mutation-floor-hardening-for-analytics-normalizer-and-intent-cla` (target
`v1-live-proof-target-m2`, 776 events, harvested as `tests/afk-runner/fixtures/live/mutation-floor-hardening-live/`);
scratch `scratch-drill-bogus-model` (target-m, 14 events, terminal `failed`).

## Pass criteria (design D3)

- **(a) Zero operator hacks — pass, with three recorded deviations.** Events were appended only by the
  runner; operator writes were exclusively gate answers, steer directives, the resume/stop verbs, and one
  gate-file response rewrite (the gate file is the documented answer surface). Deviations, all under the
  design's crash-bug escape clause ("a crash-shaped bug that blocks completing the run at all may be fixed,
  with the deviation recorded"), all TDD red-first and committed: (1) settle-claims now steal from dead
  claimants (`afk-runner/src/work/gate-claims.ts`); (2) `AgentRunError` classified `exhausted`
  (`afk-runner/src/drive/failure-budget.ts`); (3) intake resume made idempotent against `openspec new change`
  (`afk-runner/src/work/intake.ts`).
- **(b) Incidents recover through documented verbs only — partial.** Incident A (kill -9): `resume` alone
  recovered, same round, session-ledger continuation — clean pass. Incident C: chain reached after the two
  crash fixes above; the escalation gate settled via steer `abort`. Incident B: the veto **never settled** —
  no documented surface can veto an item-less final gate, and the steer-veto attempt crashed the waiter
  (findings F-B1/F-B2/F-B3). The run recovered via extend-at-final instead. This criterion failed as
  specified and is recorded as the run's biggest scar.
- **(c) The produced change validates and its tests pass — pass.** Both completed runs' changes pass
  `openspec validate --strict` in their target worktrees (think-half contract: planning artifacts; the
  implementation tasks are authored for the apply phase).
- **(d) Memo/report honesty — pass.** `memoFieldsOf(fold(log))` ≡ persisted `state.json` at every park
  (terminal: exact field equality, now a permanent oracle in the live lane; parks at gate v1/v2 verified by
  prefix projection); `report` prints and matches the log.
- **(e) ≥3 concrete frictions — pass.** Seven named (below).

**Verdict: the proof passes with findings.** The engine completed both productive runs end-to-end with honest
memos; the induced incidents exposed three real defects (all crash-shaped, two fixed within the escape
clause) and one structural hole (veto unreachability) that fixtures could not cover.

## Pre-registered findings (D8), verbatim, then adjudicated

1. **Prescreen substring over-match** (`authorization` hits the `auth` L-keyword; the regex is a faithful
   copy of sdd-runner's frozen original, fix deferred post-C7). **Confirmed and sharpened**: the live vetting
   tripped on `docs\b` inside "record it in the change docs" (S-keyword side) and required euphemism loops
   ("task-tracker plugin", "operator tool gating via a registry port") around the L-keywords. Three task
   texts were shaped by keyword avoidance before one vetted clean per profile.
2. **Honest-S ≈ docs-only** (the classifier's conservative max makes S unreachable for real code work).
   **Confirmed with a stronger form**: even docs-about-a-provider reads `provider_surface: true` → L — the
   S calibration run itself classified **L** (estimator rationale: "Docs-only accuracy pass; no code edits …
   provider_surface true (cells and bootstrap wording must be derived from the plugin's actual capability
   surface)"). Honest-S is narrower than docs-only; it is docs-about-nothing-operational.
3. **Gate-wait calendar dominance** (already visible: 2.7–3.8-day historical spans on 10–12 spawns). **Not
   reproduced in attended mode**: no deadlines were configured and gates were answered in minutes; total
   gate-park dwell across the M run was ~24 minutes of a 101-minute run. The historical spans stand as
   evidence about unattended operation, not the attended proof.
4. **Cache economics of session continuation** (53.8M cached vs 4.85M fresh tokens across five M fixtures).
   **Confirmed live**: the M run burned 11,634,688 cached-read vs 1,004,077 fresh input tokens across 16
   successful spawns (11.6:1); the kill-drill continuation (attempt 2, same opencode session) contributed to
   that ratio without a fresh-context rebuild.
5. **Orphaned-child behavior at kill.** **Confirmed and extended** (below, incident observations).

## Incident observations (pre-registered unknowns, now answered)

- **Orphan behavior (D4/D8-5):** the spawned `opencode` child runs in **its own process group** (pgid =
   own pid ≠ holder pgid) — killing the holder's process group would not have reaped it. The orphan survived
   the holder kill, reparented to ppid 1, kept working for ~100 s (spending tokens with no consumer), and
   died only when killed by its own group. Drill premise correction: "kill the holder and the process group"
   must mean both groups.
- **Watchdog count (design open question):** on a failed-exit spawn, `runAgent` retries exactly **once**
   (`retrying{attempt:1}`) and then throws — a single retry, not a burn-down ladder; three spawns produced
   three retries across the drill.
- **Taxonomy boundary (design open question):** a non-zero agent exit is **neither** `infra` (that is
   launch/transport: `SpawnError`) **nor** schema-exhaustion (`AgentValidationError`) — `AgentRunError` was
   outside the typed taxonomy entirely, crash-shaped and crash-looping on every resume until classified
   `exhausted` (crash-fix #2). The boundary now has three declared lanes: transport, schema, process.

## Additional findings (the runs added; none silently dropped)

- **F-A1 — same-round resume re-appends `round_open`** (`review-loop.ts` runRound emits unconditionally):
  the task expected "no fresh round_open"; the fold stays correct (round 1, cap intact) and the
  under-budget-retry fixture legitimizes the shape, but the log double-counts round opens on resume.
- **F-A2 — the `resume{session-continuation}` event has no producer**: sdd-runner emits it
  (`resume-flow.ts:151`); the re-host kept the schema and built fixtures over it, but no code path appends
  it. Live resumptions are visible only through the session ledger.
- **F-B1 — veto is unreachable at item-less final gates**: every veto encoding requires an item id the gate
  declared; a converged 0/0/0 gate offers none. The incident-B protocol implicitly assumes the gate carries
  assumptions.
- **F-B2 — settle parse errors kill the waiter**: a malformed operator answer (or a steer veto with a
  foreign id) escapes the waiter loop unhandled; the process dies. A crashed waiter then leaves its
  half-rendered response in the gate file — a poisoned file that crashes the next settle attempt too.
- **F-B3 — stale settle-claims wedge a crashed run forever**: first-writer-wins claims carried no liveness
  and no release; the dead waiter's claim sent every later settler down the `external` path in a hot loop.
  Fixed by dead-pid claim stealing.
- **The M-band squeeze (classifier shape)**: honest-M is now "edits confined to existing modules, no
  provider prose": docs-about-a-plugin reads provider_surface→L (S run), any new top-level module reads
  new-subsystem→L (M first pick). Two runs, two L-bounds around the M band.
- **Detached-HEAD targets break `report`** (`discoverBranch` throws) — friction only, environment-shaped.
- **`slugify` truncates at 64 chars**: the proof run's change name is
  `mutation-floor-hardening-for-analytics-normalizer-and-intent-cla` (truncated mid-word); harmless, cosmetic.

## Frictions (D3e — seven, above the floor of three)

1. Detached-HEAD target worktree breaks `report` (env fix: branch checkout).
2. Prescreen keyword avoidance shapes task phrasing (three vetting rounds).
3. Attending item-less gates by hand: reading raw gate files, appending markdown response sections, timing
   the 3-tick stability window — workable, clunky, exactly TUI-shaped (U8).
4. Steer-veto crash loop (F-B1/F-B2) and the manual un-poisoning of the gate file.
5. Stale-claim wedge (F-B3) — invisible until the resumed waiter prints "already claimed" forever.
6. Resume-into-intake crash on non-idempotent scaffolding (crash-fix #3).
7. Two nohup'd runners sharing one output file (operator log hygiene; events log unaffected).

## Ledger re-score (U1–U9)

| #  | Follow-up                                   | Verdict | Evidence (run artifacts)                                                                                                                                   | Re-opening trigger (falsifiable)                                                                                                                        |
|----|---------------------------------------------|---------|------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------|
| U1 | team/mission spawner                        | hold    | every stage ran single-spawn or the existing two-lens review concurrency; 20 spawns, zero role-scheduling failures (M log spawned/done events)               | a stage needs >2 concurrent schema-carrying role agents and the ad-hoc lens merge shows measurable finding loss                                          |
| U2 | child-actor execution                       | park    | plan/children stayed dormant through both runs (`memo.plan: null`, `memo.children: null` — persisted memos); single-threaded rounds completed everything     | a decompose plan whose tasks genuinely parallelize and a serialized run's wall time becomes the bottleneck                                               |
| U3 | execution-half states                       | hold    | both runs completed the think-half tail to finals without execution states (tail choreography, seq 500–776 M log)                                           | the first execution-half change enters the pipeline and verify/release states must host it                                                                |
| U4 | documenting + reflection states             | rise    | this artifact is the manual prototype: park→human-writes-reflection is exactly the state's job; the re-score table below is the reflection→backlog edge      | the next live run's reflection costs more than a day of operator time, or re-scores are needed more than once per delivery cycle                          |
| U5 | vision intake / L4 portfolio                | park    | no run surface touched vision intake; admission happened at human task-file authoring (absence of evidence — parked, not fall)                              | more than a handful of candidate changes queue per week and human admission becomes the measured bottleneck                                              |
| U6 | `conflict_detected`                         | park    | zero unresolved reviewer-vs-drafter conflicts across 6 review rounds; the resolver closed every finding class chain (convergence events, M log seq 229–508)  | a live round's findings oscillate across rounds without convergence and the resolver re-opens the same gap twice                                         |
| U7 | snapshot memo for the fold                  | fall    | 776-event log folds in ~7 ms in the lane oracle; resume re-folds are instant at this scale (live-lane oracle test timing)                                    | logs pass ~10⁵ events or a measured resume fold exceeds perceptible latency — then the (event count, machine hash) cache earns its complexity            |
| U8 | TUI re-host as pure fold render             | hold    | attendance through raw gate files + steer + report completed the whole protocol (frictions 3–5 are surface-shaped, not blockers)                            | a second attended multi-run session where surface discovery (where is the run dir, what does the gate want) costs more than the run itself                 |
| U9 | sdd-runner retirement; cross-run accounting | **next**| the live proof removed the last "unproven engine" reason to keep sdd-runner: end-to-end runs, memo parity at every park, strict-validated products, a
  live-authored corpus lane; the remaining relaxations (jscpd oracle ignores, tests `no-unsafe-*`) are timed to retirement by design | any of: a live run needs a behavior only sdd-runner has; the parity oracle (legacy-fold over the frozen corpus) regresses; retirement's deletion surface
  turns out to depend on sdd-runner code the corpus still reads |

**Exactly one `next`: U9.** No tie: U4's rise is real but strictly follows a second live cycle; retirement is
the consolidation the proof exists to unlock, and it is what re-tightening (section 7) is timed against.

## What the next live cycle should aim at (for U4/U8's triggers)

A second attended session with: deadlines set (the calendar-dominance shape untested live), a gate that
carries assumptions (the live veto path — F-B1 makes this target-selection-sensitive), and the
resume-event producer restored (F-A2) so resumptions are log-visible.
