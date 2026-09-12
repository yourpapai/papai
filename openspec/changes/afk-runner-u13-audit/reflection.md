<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Reflection: afk-runner U13 — post-plan e2e weak-point audit

**Preamble.** Everything below rests on three attended live cycles' retained
corpus (C7 2026-08-29, C8 2026-09-01→02, C9 2026-09-03→05 — 12 live-era runs:
5 harvested lanes + 9 sidecar-carrying workdir runs, the C9 pair overlapping)
measured this cycle (2026-09-07) by zero-spawn instruments only: the read-only
`analyze` verb, one read-only probe script, and log folds. No live drills ran
under U13 (design D6 — the agenda was answerable from the corpus; the F-P2
drill is owed by the follow-up change's next armed cycle). Verdicts stay
provisional exactly like the n=1..3 cycles'; each carries its falsifiable
trigger. Working evidence: `notes.md` in this change; the corpus instrument
output: `corpus-report.json`.

**Instrument validity:** the C9 baseline report reproduces byte-identically
over both surviving C9 workdirs; the only drift is ground-truth environment
(both target change folders archived post-merge — PRs #423/#424), which the
join reports honestly.

## Pass criteria

- **(a) Both zero-spawn probes answered with numbers, adjudicated against
  their triggers' exact wording — pass.** U10's clustering trigger does not
  fire (1 persisting cluster of ~68, resolved by edits; `assumed` resolutions
  0 corpus-wide; veto/extend counter-track novelty); U11's sunk-spend trigger
  does not fire (zero live-era terminal aborts; the one stranded-value case is
  sdd-runner-era n=1).
- **(b) Every deliberate delta stressed against live evidence — pass.** Eight
  deltas, eight "no hurt" verdicts, zero "as-is" calls made without evidence
  (notes §5; the C<n> sweep is a fresh corpus-wide measurement, not a
  carry-forward).
- **(c) The F-P2 design decision argued and recorded — pass.** Option A
  (decompose/atomicity guidance) adopted, Option B rejected on mechanism
  (design D3); the follow-up change `walk-item-green-decomposition` is
  proposed with the drill named as its live verification.
- **(d) The unguarded seams dispositioned — pass.** One robustness change
  (`afk-runner-walk-robustness`) carries F-P3/F-P4/F-U3 (design D4).
- **(e) The ledger re-scored from measurements, zero `next` remaining —
  pass.** Table below; the queue's head is now the two proposed changes,
  tracked by OpenSpec directly.

**Verdict: the audit passes; U13 delivers.** No weak point beyond the
pre-loaded agenda surfaced — the corpus, the folds, and the read-only surfaces
answered every question the cycle asked without a single spawn.

## Agenda adjudication (none silently dropped)

| Agenda item                    | Verdict              | Evidence (notes §)                                                     |
| ------------------------------ | -------------------- | ---------------------------------------------------------------------- |
| F-P2 design decision           | **decided: Option A** | both decomposers split red-first independently (prompt-shaped cause); operator hand merges were pair-merges; Option B unattributable + poison-cascade-prone (design D3) |
| F-P3 precondition crash        | **→ robustness change** | implement.ts:118-124 plain Error where the C6 taxonomy names `StageHaltError{precondition}` (atomicity.ts:70-75 the mirror) |
| F-P4 git-verb blocklist        | **→ robustness change** | `.hooks/git/checks/` two-check blocklist; reset/rm/branch-creation unblocked (C9 rampage reflog-recovered) |
| F-U3 verify check wall cap     | **→ robustness change** | `bunRunCheck` `Bun.spawnSync` has no timeout; the 30-min spawn-side cap does not reach it (6h hang at C9) |
| F-U2                           | **stays closed**     | PR #423 delivered the serial cwd-leak fix; not re-opened                |
| U10 probe (clustering)         | **absence measured** | §2/§3 — no cluster a research state would own                          |
| U11 probe (aborted sunk-spend) | **absence measured** | §4 — no live-era terminal abort at all                                 |
| Delta stress (×8)              | **no hurt anywhere** | §5 — all stay as-is                                                     |
| Live drills                    | **not needed**       | every agenda item was zero-spawn-answerable; the F-P2 drill is the follow-up's |

## Measurements (named ledger targets)

- **U4 — reflection authoring cost:** ~1.5 focused hours atop a ~6h audit
  session (the probes + adjudication dominate; the reflection itself is the
  cheap half). Under the day trigger by an order of magnitude.
- **U8 — surface-discovery cost:** effectively zero this cycle — the entire
  audit ran through `analyze`, the probe script, and log reads; no surface
  had to be discovered or worked around (the C9-era wrapper/nohup frictions
  are gone with PR #423's config surface). Discovery share of the session:
  well under 10%.

## Ledger re-score (U1–U13, post-U13 — provisional; corpus report + notes cited)

| #   | Follow-up                                      | Verdict         | Evidence                                                                                                                                              | Re-opening trigger (falsifiable)                                                                                     |
| --- | ---------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| U1  | team/mission spawner                           | hold            | single-spawn-per-stage held through both armed walks and the whole corpus; zero role-scheduling failures; no finding-loss signal                      | a stage needs >2 concurrent schema-carrying role agents and the ad-hoc merge shows measurable finding loss           |
| U2  | child-actor execution                          | park            | plan/children stayed null through both walks; sequential walk completed both regimes (carry-forward, C9)                                              | a decompose plan whose tasks genuinely parallelize and serialized wall becomes the bottleneck                       |
| U4  | documenting + reflection states                | hold            | ~1.5h this reflection; ~2.5h at C9 — both far under a day                                                                                             | reflection cost crosses a day, or re-scores are needed more than once per delivery cycle                             |
| U5  | vision intake / L4 portfolio                   | park            | admission stayed human task-file authoring through C9 and U13 (carry-forward; nothing in the audit touches admission)                                  | candidate changes queue faster than human admission can vet them                                                     |
| U6  | `conflict_detected`                            | park            | zero unresolved reviewer conflicts across the corpus (concernPersistence 0–0.083; no thrash shape; third-strike never arisen in 3 cycles)             | a live round's findings oscillate without convergence                                                               |
| U7  | snapshot memo for the fold                     | fall            | stands (C9: the 7,767-event flooded lane folds in ~40ms in the oracle)                                                                                 | logs pass ~10⁵ events or a measured resume fold exceeds perceptible latency                                          |
| U8  | TUI re-host as pure fold render                | hold            | C9 measured discovery < 20%; U13's audit ran entirely through the read-only surfaces with no discovery friction (< 10% of session)                    | a cycle where surface discovery + drill timing exceed the run wall                                                   |
| U9  | sdd-runner retirement; cross-run accounting    | **delivered**   | stands (`runs`/`analyze` were again the audit's instruments)                                                                                           | —                                                                                                                    |
| U10 | `research` state + draft back-edge             | **fall**        | **measured absence (probe 1):** 1 persisting fingerprint cluster of ~68 (1.5%), resolved by edits, converged; `assumed` resolutions 0 corpus-wide; the one extend sits on the most-explored domain and the brand-new-surface run (C9-U) had zero think-half gate friction — its 10 escalation settles were execution-half failures | a live think-half gate whose open set is dominated for ≥2 rounds by unknown/assumption-class findings that edits do not settle |
| U11 | `aborted` reopen (explicit resurrection event) | **fall**        | **measured absence (probe 2):** zero terminal aborts in the live era (12 runs — escalation settles were the recovery tool every time); the only stranded-value case (3 converged rounds + draft) is sdd-runner-era n=1; stale-running runs are `resume`-reachable already | a live-era terminal abort strands converged think-half value and the operator chooses (or regrets) restart-from-scratch |
| U12 | per-state `meta` (roles/activities)            | hold            | rides U1 (no promotion evidence; unchanged)                                                                                                           | U1 promotes                                                                                                          |
| U13 | post-plan e2e weak-point audit                 | **delivered**   | this change: probes adjudicated, deltas stressed (8× no-hurt), F-P2 decided (Option A), F-P3/F-P4/F-U3 dispositioned to one robustness change, ledger re-scored from measurements, zero `next` left | a future wake condition (U3-class delivery or a measured absence overturning)                                        |

**Zero `next` remains** (design D6). The queue's head is the two proposed
follow-up changes — `walk-item-green-decomposition` and
`afk-runner-walk-robustness` — which OpenSpec tracks directly; a `next` ledger
row would duplicate that tracking. The ledger wakes again when a trigger
fires.

## Frictions (three, above the floor — all small this cycle)

1. The retained lanes drop sidecars at harvest, so the clustering probe had to
   reach the (still-surviving) C8/C9 workdirs — corpus durability rests on
   worktrees not being cleaned. Worth a deliberate retention policy someday;
   not a change (the workdirs outlived their cycles and are now recorded as
   the audit's substrate).
2. The analyzer's report rows don't carry gate outcomes (mode/latency/settler
   only), so probe 1b read the logs directly — a one-line analyzer enrichment
   if a future re-run needs it; declined now (smallest thing).
3. The ledger's "7-lane" figure did not match any single corpus slice (it is
   C8's 7 workdir runs; the retained lanes are 5) — corrected in this
   reflection's preamble and in afk-runner.md.

## What the next live cycle should aim at

1. **Implement and drill `walk-item-green-decomposition`**: an armed run on a
   red-first-prone task asserting the walk survives with zero operator
   re-targets — F-P2's live proof, owed by that change.
2. **Land `afk-runner-walk-robustness` ahead of that cycle** (the C9 order:
   guards before drills).
3. The not-arisen shapes keep riding task selection (thrash, `C<n>` — three
   cycles aimed, zero firings; the sweep is now a one-command re-run).
