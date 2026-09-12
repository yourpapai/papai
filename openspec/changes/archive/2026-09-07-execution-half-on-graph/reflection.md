<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Reflection: execution-half-on-graph §9 (de-facto C9)

**n=3 preamble.** Everything below rests on three attended live cycles — C7 (2026-08-29,
free-tier, three runs), C8 (2026-09-01→02, seven runs), and this one (2026-09-03→05, two armed
productive runs through the new execution states plus their re-drill churn) — on the priced
zai-coding-plan route (list-rate metering; the subscription bills nothing per token — the priced
model's cost figures are what the run would have cost at API rates). Verdicts stay provisional;
each carries its falsifiable trigger. The working evidence (event-line cites, run ids, the
operator decision log) is `notes.md` in this change; the corpus report is `corpus-report.json`.

**Runs and artifacts cited:** Run P `task` (target-p, glm-5.3-flash → glm-5.3 at the endgame per
the pre-registered fallback, metered $0.10 crossed mid-draft, $13.32 nominal, 3,285 events,
harvested lane `mutation-gate-widening-live`, terminal `completed`, product strict-valid at 16
commits); Run U `task` (target-u, glm-5.3, `budget: null`, `deadline: 10`, $6.35 nominal, 7,767
events — F-U1's flood kept as evidence — harvested lane `runner-cli-config-live`, terminal
`completed`, product strict-valid at 5 commits). Both regimes traversed the full execution half:
armed final approve (D3), the walk, verify as routing, the release gate (D7).

## Pass criteria

- **(a) No operator surgery — pass with the surgery ledger open.** Events were appended only by
  the runner; operator writes were gate answers (gate files, all settles), the resume/stop verbs,
  the pre-registered induced faults (holder+pgid kills, implementer-child kills), and — heavier
  than any prior cycle — the resumeHint's designed hand re-targets escalating into **operator
  product surgery on Run U** (the batch merges and the final surgical completion of items 8.1–8.4
  after the walk could not land them). Every deviation is recorded in notes.md with its cause
  (F-P2's cascade); no state was faked — but the engine-authored claim for Run U's implementation
  items is honestly weakened: the walk's own residue says `0/24 done`.
- **(b) Incidents through documented verbs only — pass.** Both crashes (my own shell timeout; the
  F-P3 plain-Error crash) recovered via `resume` alone; every gate settled through the file/verb
  grammar; the kills recovered exactly per the fold. Two escape-clause fixes landed in-change,
  red-first, deviations recorded (F-P1 `--no-verify`, F-U1 per-gate-once pending).
- **(c) Products validate strictly — pass.** Both targets' changes pass
  `openspec validate task --strict`; both trees clean; both serial suites green at their
  terminals (Run P's verify-2; Run U's verify-4 after its three reds).
- **(d) Memo/report honesty — pass.** Both lanes fold to their persisted memos under the extended
  oracle (tasks projection included); the release digests were brutally honest (Run U's `0/24`
  with the walked-done overwritten by the fix-mode restart — status last-wins working as
  designed); the `runs`/`report` surfaces were this cycle's instruments throughout.
- **(e) ≥3 concrete frictions — pass.** Nine named below.

**Verdict: the cycle passes with findings.** Both budget regimes completed the full execution
half live; the drills landed their assertions; and the cycle returned two escape-clause fixes,
five recorded findings, and one design-level weak point (F-P2) that the post-plan audit (U13)
inherits as its first agenda item.

## Pre-registered drills, adjudicated (none silently dropped)

| Drill                                                                                       | Verdict                   | Evidence                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| (a) Holder kill mid-implement → one classified resume, no double-open, session continuation | **landed**                | Run U seq 7122: exactly one `resume{stage-rebuild, implement}`; the re-pick's spawn continued the killed session (`--session ses_f926150beffe…`, ledger attempt 2 same id)                                                                                                     |
| (b) Implementer-child kill → escalation-approve, killed-session continuation live           | **landed**                | Run P seq 995–1046: `retrying{stall}` → `stage_failed` → the under-budget re-run riding the killed-session continuation (the F-A4 fix's first live proof) → escalation v3 → approve movers → skip-forward past the hand-re-targeted item                                       |
| (c) Numeric-ceiling refusal (priced, metered)                                               | **landed**, twice over    | Run P: `auto_decision{rule: R5}` at the escalation (cost-known $0.38 ≥ $0.10) with extend suppressed from the rendered gate; plus the think-half shape — round 3 needs-review at cap refused its verification round with no `auto_decision` (the R4 numeric branch, live)      |
| (d) Third-strike concern thrash                                                             | **not-arisen**            | no fingerprint reached a third raise on either run; fixture evidence stands                                                                                                                                                                                                    |
| (e) `C<n>` cross-artifact finding                                                           | **not-arisen**            | the deterministic scan found no cross-artifact disagreement; task selection aimed (named constants, baseline floors) but the artifacts stayed consistent                                                                                                                       |
| (f) Red-verify routing                                                                      | **landed** (both runs)    | Run P verify-1 red → routed back as a normal outcome, the fix re-target answered the artifact by appending past the verdict, verify-2 green; Run U verify red ×3 (cwd leak, killed hang, real lint) → green — the routing and the self-answering ledger carried every recovery |
| (g) Release-veto cycle                                                                      | **not-arisen-with-cause** | no honest redirect existed at either release digest; a fabricated veto is forbidden by the pre-registration. The veto path itself was live-proven at Run P's FINAL gate (v1 `VETO: consolidate` → revision → v2)                                                               |
| (h) Unattended gate past armed deadline                                                     | **landed, with F-U1**     | Run U: the wired expiry claimed long after attach (`auto_decision{none, pending}` — the F-C3 fix's first live proof), then flooded one pending per tick until settled (F-U1, fixed per-gate-once)                                                                              |
| (i) Zero-signal probe at the release gate                                                   | **landed**                | Run P gate-8: prose-only rejected, `gate-8.response-error.md` written, nothing settled, waiter alive                                                                                                                                                                           |

## Findings and fixes (all in notes.md with event cites)

- **F-P1 (fixed in-change, escape clause): runner slice commits fail silently under a rejecting
  pre-commit hook.** The hook rejects; `EXEC_GIT`'s contract carries no exit code; the item marks
  done with its work uncommitted — and the staged-set poisoning makes the first rejection
  permanent. Fix: `--no-verify` (the verify boundary is the walk's quality gate), red-first,
  proven live by the very next green slice. The exit-code visibility half stays follow-up
  material.
- **F-P2 (recorded — the design-level weak point): red-first decomposition structurally fails the
  walk's green-per-item affected check.** Both cycles' decomposers followed the repo's own TDD
  conventions and split test/impl items; the walk's check demands green per item; a legitimately
  red pre-implementation test records failure, and its uncommitted red then poisons every later
  check. Run P lost 4 items to it; Run U lost the whole walk to it (0/24). The escape hatches
  (hand re-target, baseline-resetting commits) work but make the operator the implementer.
  U13 inherits: either decompose-guidance forbids red-first pairs at walk granularity, or the
  check tolerates declared-red pre-impl tests.
- **F-P3 (recorded): the missing-tasks.md precondition crashes instead of escalating** —
  `implement.ts`'s read-catch wraps as plain Error (refusal alarm) where the C6 taxonomy names
  the shape `StageHaltError{precondition}`. Recoverable by `resume` after the operator's git
  restore.
- **F-P4 (recorded): the agent git-verb blocklist is too narrow** — `git reset`/`git rm`/branch
  creation are unblocked; an implementer reset the branch to baseline and deleted the change
  folder mid-walk. Fully reflog-recoverable; the guard should widen.
- **F-U1 (fixed in-change, escape clause): the post-re-arm park floods the log** — one
  `auto_decision{none, pending}` per waiter tick, 6,333 duplicates over ~2.4h. Fix: per-gate-once
  emission (`pendingRecordedFor`); the flooded log rides the lane as evidence.
- **F-U3 (recorded): verify's command seam carries no wall cap** — a hung suite check hangs the
  walk (6h this cycle). The spawn-side 30-min cap does not reach the check seam.
- **F-U2 (recorded, operator-shaped): the serial cwd-leak class** — a surgical test's afterEach
  restoring to `import.meta.dir` poisoned every later serial file's relative paths (34
  env-shaped failures). The runbook's file-by-file re-verification discipline found it.
- **Operational lessons (honesty section):** the foreground `start` under a shell timeout is the
  C8 nohup lesson re-learned; `start` parks-and-exits so an unattended gate has NO waiter until
  `resume` (bit twice — the F-U1 flood ran for hours before attach); the staged-deletion rampage
  needs index+worktree restore, not soft reset alone.

## Measurements (named targets)

- **U4 — reflection authoring cost:** ~2.5 focused hours atop a ~48h calendar span — but the
  cycle's operator load was dominated not by reflection but by gate attendance and the re-target
  loop (six operator gates on Run P, eleven on Run U). Under the promote trigger's spirit this
  stays `hold`, sharpened below.
- **U8 — surface-discovery cost:** the wrapper/CLI-config gap, the nohup lesson, the
  waiter-attach shape, and the two git-recovery episodes ≈ 2–3h of the attended span — but the
  dominant friction was not discovery, it was the RE-TARGET LOOP (F-P2): ~15 hand edits and two
  surgical completions. Discovery itself stayed under 20% of attended wall.

## Ledger re-score (U1–U13, n=3 — provisional; corpus report cited where a metric is the ground)

| #   | Follow-up                                   | Verdict       | Evidence                                                                                                                                                                                                                                                                                                                                                                                                  | Re-opening trigger (falsifiable)                                                                           |
| --- | ------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| U1  | team/mission spawner                        | hold          | every stage still single-spawn across both armed runs; zero role-scheduling failures                                                                                                                                                                                                                                                                                                                      | a stage needs >2 concurrent schema-carrying role agents and the ad-hoc merge shows measurable finding loss |
| U2  | child-actor execution                       | park          | plan/children stayed null through both walks; the sequential walk itself was the bottleneck's witness                                                                                                                                                                                                                                                                                                     | a decompose plan whose tasks genuinely parallelize and serialized wall becomes the bottleneck              |
| U3  | execution-half states                       | **delivered** | both budget regimes completed the full execution half live (armed approve D3, walk+slice commits, verify-as-routing incl. the self-answering artifact, release D7 with verb-only grammar); all drills landed; two escape-clause fixes rode the cycle                                                                                                                                                      | an execution-half behavior regresses in a later live cycle                                                 |
| U4  | documenting + reflection states             | hold          | ~2.5h this reflection (under the day trigger); the operator load lives in gate attendance, not authoring                                                                                                                                                                                                                                                                                                  | reflection cost crosses a day, or re-scores are needed more than once per delivery cycle                   |
| U5  | vision intake / L4 portfolio                | park          | admission stayed human task-file authoring; absence of evidence again                                                                                                                                                                                                                                                                                                                                     | candidate changes queue faster than human admission can vet them                                           |
| U6  | `conflict_detected`                         | park          | zero unresolved reviewer conflicts across both cycles' rounds                                                                                                                                                                                                                                                                                                                                             | a live round's findings oscillate without convergence                                                      |
| U7  | snapshot memo for the fold                  | fall          | the 7,767-event flooded lane folds in ~40ms in the oracle; resume re-folds instant                                                                                                                                                                                                                                                                                                                        | logs pass ~10⁵ events or a measured resume fold exceeds perceptible latency                                |
| U8  | TUI re-host as pure fold render             | hold          | discovery < 20%; the re-target loop was engine-design-shaped (F-P2), not surface-shaped                                                                                                                                                                                                                                                                                                                   | a cycle where surface discovery + drill timing exceed the run wall                                         |
| U9  | sdd-runner retirement; cross-run accounting | delivered     | stands (the `runs`/`analyze` surfaces were again this cycle's instruments)                                                                                                                                                                                                                                                                                                                                | —                                                                                                          |
| U10 | `research` state + draft back-edge          | hold          | no live evidence; the zero-spawn analyze probe (gap-fingerprint clustering) is U13's first pass                                                                                                                                                                                                                                                                                                           | U13's corpus probes find clustering that a research state would own                                        |
| U11 | `aborted` reopen (explicit resurrection)    | hold          | no abort-and-continue shape arose (all aborts were terminal-confirmed); `runs` sunk-spend probe pending                                                                                                                                                                                                                                                                                                   | U13's aborted sunk-spend probe shows resumable value stranded by terminal aborts                           |
| U12 | per-state `meta` (roles/activities)         | hold          | rides U1 (no promotion evidence)                                                                                                                                                                                                                                                                                                                                                                          | U1 promotes                                                                                                |
| U13 | post-plan e2e weak-point audit              | **next**      | **the wake condition fired** — U3 delivered; the cycle itself pre-loaded the audit's agenda: F-P2 (the walk's check vs red-first decomposition — the measured dominant operator load), F-P3/F-P4 (unguarded seams the fixtures could not see), F-U3 (the uncapped check seam), and the zero-spawn first probes (analyze gap-fingerprint clustering over the now-7-lane corpus; `runs` aborted sunk-spend) | the audit's probes all come back clean and measured absences stay fallen                                   |

**Exactly one `next`: U13.** No tie: U3's delivery is the ledger's one promotion; U13's wake
condition is its direct consequence and its agenda is already evidence-loaded from this cycle.
The audit re-scores the whole hold/park queue from measurements when it runs.

## Frictions (nine, above the floor of three)

1. The re-target loop (F-P2): ~15 hand edits across two runs; the operator became the
   implementer on Run U.
2. Silent slice-commit failure (F-P1) — fixed mid-cycle, but it burned items 2–4 before capture.
3. The staged-set + tree poisoning made every failure permanent until an operator baseline reset.
4. The unguarded agent git verbs (F-P4) — one rampage cost a crash (F-P3) and a two-step recovery.
5. The verify check seam has no wall cap (F-U3) — a 6-hour hang.
6. `start` parks-and-exits: an unattended gate has no waiter until `resume` — the F-U1 flood and
   the deadline claim both sat for hours unobserved.
7. The CLI could not express budget/deadline/model per run (the wrapper workaround) — fixed by
   Run U's own product, which now needs folding to master.
8. The serial cwd-leak class (F-U2): one afterEach poisoned 34 tests' relative paths.
9. glm-5.3 endpoint stalls (two 10-min inactivity kills drove Run U's first escalation) and the
   flash mapper wall (two attempts burned before the fallback model landed it first try).

## What the next live cycle should aim at (U13's audit agenda)

1. **F-P2 first**: decompose-guidance vs check tolerance — a deliberate red-first-decomposed
   armed run under whichever fix lands, asserting the walk survives without operator re-targets.
2. The zero-spawn corpus probes (gap-fingerprint clustering over the 7-lane corpus; aborted
   sunk-spend) to re-score the hold queue on measurements.
3. The unguarded seams (F-P3 precondition crash, F-P4 git verbs, F-U3 wall cap) as one
   robustness change ahead of any further armed cycle.
4. The not-arisen shapes ride again (thrash, `C<n>`) — task selection keeps aiming.
