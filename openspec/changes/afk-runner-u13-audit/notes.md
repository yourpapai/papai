<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Cycle notes: afk-runner U13 — post-plan e2e weak-point audit

Pre-registration precedes evidence (the live-proof contract, carried to the
zero-spawn lane): this charter was fixed before any probe ran — the two probes
in the U13 ledger row, the baseline re-inspection, the eight-delta stress, the
F-P2 decision, the follow-up dispositions, the re-score. Zero live drills this
cycle (design D6/D7 rationale: the pre-loaded agenda is answerable from the
retained corpus; the F-P2 drill rides the follow-up change's next armed cycle).
Status: **locked at operator sign-off, 2026-09-07** — after the first-pass
probe results and the F-P2 outline were presented to the operator and
"proceed" was recorded; the numbers below are the evidence that presentation
rested on.

## Corpus (the instrument's substrate, verified 2026-09-07)

| slice                     | runs | sidecars | statuses                                |
| ------------------------- | ---- | -------- | --------------------------------------- |
| live lanes (retained)     | 5    | no       | 5 completed                             |
| C9 workdirs (p, u)        | 2    | yes      | 2 completed                            |
| C8 workdirs (a, b, c)     | 7    | yes      | 6 completed, 1 failed (A1, escal. abort) |
| real corpus (legacy)      | 10   | no       | 4 running (stale), 2 aborted, 4 completed |
| scenarios (synthetic-marked) | 17 | no      | excluded from adjudication (D1)         |

Ledger figure corrected: the "7-lane live corpus" is C8's 7 workdir runs; the
retained lane count is 5. Both numbers are now named where they are used.

## 1. Baseline re-inspection (task 1.1)

`bun run afk-runner:start -- analyze <p> <u> <a> <b> <c> --json` (read-only;
exit 0) over all five workdirs → `corpus-report.json` in this folder (57,147
bytes, 9 runs). Comparison against the C9 harvest report:

- **Both C9 workdir runs reproduce byte-identically on every report field**
  (trajectory, gates, retries, stageFailures, finding-lifecycle metrics,
  consistency, usage). Instrument valid.
- Only drift: ground truth — the C9 report's `strandedComplete: ['task',
  'task']` now reads empty because both target change folders were archived
  after folding to master (PRs #423/#424); the join honestly reports
  `exists: false` with `strandedComplete: false`. Environment drift, not
  metric drift.
- Aggregates over the 9 runs: `autoDecisionsByRule {R1: 3, R4: 4, R5: 5, none:
  6356}` (the `none` mass is F-U1's 6,333-pending flood, kept as lane
  evidence); `gatesNeverAnswered: 0`; era-contaminated: none; R1's three are
  C8-B passes 1–3's insta-approves.

## 2. Probe 1 — gap-fingerprint clustering (U10's trigger) (task 1.2)

Instrument: read-only bun script (session temp dir, quoted here in full
method) importing `fingerprintOf` from `afk-runner/src/work/concern-model.ts`;
joins `findings-N.json` + `findings-skeptic-N.json` sidecars per run into
fingerprint → rounds/classes/ids maps, and `resolutions-N.json` for the
per-round resolution actions; lexical research-share classifier
`/(unknown|unclear|assum\w*|unexplored|not (?:known|documented|specified)|need(?:s)? (?:research|deciding)|open question|\?)/iu`
over gap+question — deliberately generous, never adjudicated alone (D2). The
two C8-B corrupted-sidecar drills (`resolutions-1.json` unparseable on passes
3/4 — the `POLICY-INTEGRITY` evidence) parse-tolerant, matching the analyzer's
`sidecarFailures` accounting.

Per run (findingsTotal / lexicalShare / clusters / persisting / persistenceRate /
resolutionMix):

| run   | findings | lexical | clusters | persisting | rate  | resolutionMix                        |
| ----- | -------- | ------- | -------- | ---------- | ----- | ------------------------------------ |
| C9-P  | 16       | 0.81    | 16       | 0          | 0     | edited 16                            |
| C9-U  | 13       | 1.00    | 12       | 1          | 0.083 | edited 11, dismissed 1, evidence-answered 1 |
| C8-A1 | 0        | —       | 0        | 0          | —     | (failed before review)               |
| C8-A2 | 12       | 1.00    | 12       | 0          | 0     | edited 10, dismissed 2               |
| C8-B1 | 15       | 0.87    | 15       | 0          | 0     | edited 15                            |
| C8-B2 | 7        | 0.86    | 7        | 0          | 0     | edited 7                             |
| C8-B3 | 1        | 1.00    | 1        | 0          | 0     | (corrupted sidecar drill)            |
| C8-B4 | 1        | 1.00    | 1        | 0          | 0     | (corrupted sidecar drill)            |
| C8-C  | 6        | 0.67    | 6        | 0          | 0     | edited 5, dismissed 1                |

The one persisting cluster corpus-wide: **C9-U, rounds 1→3, MATERIAL** — gap
"`docs/architecture/afk-runner.md` (CLI/config rows), `docs/architecture/
commands.md`" (docs-landing ownership), resolved `edited` in both rounds, run
converged. Not an unknown, not an assumption — an edit that took three rounds
to land. Corpus totals: **71 findings, ~68 clusters, 1 persisting (1.5%)**;
resolution mix corpus-wide **edited 64 / dismissed 4 / evidence-answered 1 /
assumed 0**. Cross-check: the analyzer's `concernPersistence` reads 0 (7 runs)
and 0.083 (C9-U); `classChurn` 0–1 over the multi-round ids, no thrash shape
(matches drill (d) not-arisen at C9).

## 3. Probe 1b — veto/extend vs domain novelty (task 1.3)

Gate outcomes by mode/outcome over the 12 live-era runs (9 workdir + 5 lanes,
C9 pair overlapping; lane numbers include the C7 lane):

- final/extend: **1** — C7's mutation-floor-hardening run (the *most*-explored
  domain in the corpus: the SDD pipeline itself).
- final/veto: **2** — C8-A2 (`EVENT_PAYLOAD_CAP` named-decision redirect) and
  C9-P (`VETO: consolidate`, a plan-granularity redirect — F-P2-shaped, not
  domain-shaped).
- final/approve: 8 · release/approve: 2 · escalation settles: 17 (15 on the
  C9 pair — all kill/F-P1/F-P2/attempts-bound flavored; 1 C8-A1 abort; 1
  C8-C).
- The **brand-new-surface run (C9-U, the CLI config surface with zero prior
  callers) had zero think-half gate friction** — its 10 escalation settles were
  execution-half failures (F-P2's cascade), not research-shaped review
  trouble.

Reading: with n=12 the correlation runs *counter* to the research-state
hypothesis — novelty did not produce think-half vetoes/extends anywhere, and
the operator redirects that did occur were granularity/named-decision shaped.

## 4. Probe 2 — aborted sunk-spend (U11's trigger) (task 1.4)

Sunk-progress rows over every terminal-aborted corpus run + the one live
abort-at-escalation + the stale-running controls:

| run                                  | status  | events | stages reached              | rounds | conv | spawns | sunk value stranded?            |
| ------------------------------------ | ------- | ------ | --------------------------- | ------ | ---- | ------ | ------------------------------- |
| real/sdd-runner-decomposition-2nd    | aborted | 35     | intake                      | 0      | 0    | 1      | none (nothing to resume)        |
| real/2026-08-21T19-25-52…cdc4c06a    | aborted | 769    | intake, draft, review       | 3      | 3    | 11     | **partial** — draft + 3 converged rounds; a restart re-drafts from scratch |
| C8-A1 (abort-at-escalation)          | failed  | 11     | intake                      | 0      | 0    | 2      | none (drill-shaped scratch)     |
| real/2026-08-19T12-04-49… (control)  | running | 2,805  | all, parked at gate         | 10     | 10   | 43     | not U11 — `resume` reaches it today |
| + 3 more stale `running` (control)   | running | 1–576  | intake…tail                 | 0–2    | 0–2  | 0–11   | same — parked, not terminal     |

Live era (C7–C9, 12 runs): **zero terminal aborts** — when runs went bad,
escalation settles were the recovery tool every time (17 settles); abort was
never chosen on a productive run. The one run with real stranded convergence
value is sdd-runner-era, n=1, pre-graph. The stale-running controls confirm
the adjacent class (crash-never-resumed) is already served by `resume` and
needs no reopen edge.

## 5. Deliberate-delta stress (task 2.1) + C<n> sweep (task 2.2)

| delta                                        | evidence consulted                                          | hurt? | verdict     |
| -------------------------------------------- | ------------------------------------------------------------ | ----- | ----------- |
| thin context vs afk's blackboard             | every run converged within caps (rounds==convergences); duplicateIdRate 0; lensOverlap 0/unknown; no finding-loss signal anywhere | no | stays       |
| escalation-not-silent-death                  | 17 escalation settles carried every recovery across C8/C9; zero silent deaths in corpus | no | stays       |
| single-spawn-per-stage vs discussion/RAG/bus | zero role-scheduling failures across 3 cycles; reviewer stalls (C9-U r2 ×2) were endpoint-infra-shaped; walk's one-spawn-per-item held both regimes | no | stays       |
| dormant `schedule` watcher                   | foreground waiter subsumes the only candidate consumer; F-U1 was a waiter bug (fixed), not a watcher absence | no | stays dormant |
| once-bound verification round                | bought exactly once corpus-wide (C8-B pass 1, `round_open(4, cap 4)`); never needed a second | no | stays       |
| escalation extend-suppression                | R5 ×5 live at C9 with extend absent from rendered gates, all operator-answerable | no | stays       |
| gated consistency-vocabulary widening        | **C<n> sweep: zero cross-artifact findings across all 9 runs' sidecars** (3 cycles of aiming; deterministic scan never fired) | no | stays gated |
| cost-as-lower-bound                          | unpriced count honestly pinned (3); both cost-known C9 lanes priced end-to-end; R4/R5 numeric branches live | no | stays       |

## 6. Operator decision record

- 2026-09-07: first-pass probe results + F-P2 outline presented; operator
  **"proceed"** — Option A adopted (design D3), one robustness change for
  F-P3/F-P4/F-U3 (D4), U10/U11 fall (D5), zero `next` (D6), audit change +
  two follow-up proposals + re-score + validate + serial suite + house-style
  commits (this session's scope).
