<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: v2-live-proof

Live runs need real spend and operator attendance (no time limit — operator decision). Operator decisions
locked at exploration: priced model `synthetic/hf:zai-org/GLM-5.3-Flash` on every run; task picks per design
D3; Run B `deadline: 10`; F-A4 is report-then-decide. Drill protocols, pass criteria, and the escape clause
are in design.md (D1–D10).

## 1. Pre-flight

- [x] 1.1 Record the locked cycle plan in the change's notes: model, task picks with fallbacks (Run A `suggest_next_task` increment 2, Run B killed-turn usage under-count / S6-5 fallback, Scratch C coding-sessions.md actualization / check.sh-gap fallback), `deadline: 10` on Run B, no attendance limit, F-A4 report-then-decide. Verify: the note exists and names every drill the change's spec scenarios name (D2 a–e plus the opportunistic protocols)
- [x] 1.2 Write the three task files from the D3 picks; phrase them off the prescreen L-keywords ("task-tracker tools", "coding-agent workspace" — never provider/auth/migration vocabulary) and vet each through `prescreenProfile` expecting M, M, and S-or-M respectively — misclassification stays a recorded finding, never a `--depth` override. Verify: `bun -e 'import("./afk-runner/src/work/intake.js").then(m => console.log(m.prescreenProfile(require("node:fs").readFileSync("<taskFile>","utf8"))))'` prints the expected profile for each file
- [x] 1.3 Create fresh target worktrees off master and the configs: Scratch C and Run A with `model: synthetic/hf:zai-org/GLM-5.3-Flash` and `budget: 5` (C; A's placeholder — tightened in 2.2), Run B with the same model, `budget: null`, `deadline: 10`; all `repoRoot` = their target, `workDir` default. Verify: `git -C <target> status --porcelain` is empty per target and `loadRunnerConfig` resolves each config printing `budget`/`metered`/`deadline` as designed

## 2. Scratch C — first: F-A4 evidence + spend calibration + plumbing shakeout

- [x] 2.1 Start Scratch C; during draft's spawn kill the agent **child** only (holder alive; child pid via `ps`/the session ledger); let the watchdog retry once and fail → `stage_failed{exhausted}` → same-process under-budget re-run → kill the child again → escalation gate → answer **approve** → capture the same-process retry's session-ledger behavior against the `killed` entry; then let the run complete. Verify: the log shows the `stage_failed` pair, the escalation-mode `presented`, the approve settle, the retry's session continuation evidence, and a terminal memo
- [x] 2.2 Write the F-A4 evidence report per design D6 (ledger lines around each kill/retry, context-preservation shape, coherence verdict per branch: accept-evidence vs fix-evidence) and calibrate Run A's ceiling from this run's per-spawn burn × C7's M spawn profile (20 spawns) — a value the verify-round projection crosses while base rounds do not; set it in Run A's config. Verify: the report lands in the change's notes and Run A's config `loadRunnerConfig` prints the calibrated `budget`
- [x] 2.3 If the run surfaces a crash-shaped blocker, fix under the escape clause (red-first, deviation recorded) or record the finding. Verify: any fix has its failing test first and the deviation note; otherwise the finding is recorded

## 3. Run A — metered proof run (kill + veto grammar + tight ceiling)

- [x] 3.1 Start Run A; watch the first gates closest among the productive runs (post-scratch, the mirror wave's gate/prompt/convergence surfaces meet a full M run here). Attend every gate through the documented surfaces only. Verify: the run proceeds through intake/draft/review with events appending normally; any crash-shaped blocker follows the escape-clause protocol
- [x] 3.2 Aim the kill telescope (`tail -f events.ndjson` for `round_open` + `spawned`), kill the holder pid and both process groups (holder's and child's own pgid — C7 premise correction), observe the orphan, then `resume`. Verify: the log shows exactly one classified `resume{session-continuation}` event for the invocation, **no second `round_open`** for the re-entered round (F-A1/F-A2 live), the ledger shows the continuation session, and the run proceeds to its terminal memo
- [x] 3.3 At the first gate carrying an assumptions section: answer with a zero-signal response first, then `VETO: <redirect>`; while waiting, probe steer with `veto <foreign-id>`. Verify: zero-signal rejected with directive guidance and nothing settled; the veto directive settles with its redirect; revision work carries the gate-level redirect; the steer foreign-id probe consumed-with-warning and the waiter survived; memo `completed` and the produced change passes `openspec validate <changeName> --strict` in the target worktree
- [x] 3.4 If a needs-review cap-hit arises: assert the **refusal by ceiling** — projected spend reaching the calibrated ceiling, no verification round opens, no `auto_decision` appended, run proceeds to its final gate with unreviewed edits visible. If it does not arise (ceiling never crossed included), record not-arisen with the ceiling-miss note. Verify: round-shape assertions (or the not-arisen note) land in the reflection notes with event line cites

## 4. Run B — unmetered proof run (deadline expiry + POLICY-INTEGRITY)

- [x] 4.1 Start Run B (`budget: null`, `deadline: 10` armed). On the designated gate, do not answer: let the waiter claim expiry. Observe the ladder outcome — settle (`auto_decision{rule}`) or stay-pending (`auto_decision{none, pending}` + single re-arm; optionally wait out a second expiry for the once-only re-arm). Answer all other gates promptly. Verify: the log carries the `auto_decision` audit event(s) matching the claimed outcome, no human-settled gate carries a waiter event, and every park's memo matches the folded log after the auto outcome
- [x] 4.2 During Run B's tail window (after the last `round_close`, before the final gate presents), corrupt the closed round's `sidecars/round-hashes-<n>.json` (flip one hash) — pre-registered fault D2-d. Verify: the final gate presents with the `POLICY-INTEGRITY` BLOCKER substituted (no rule auto-decides), the operator settles it explicitly, the run reaches its terminal memo, and the produced change passes `openspec validate <changeName> --strict` in the target worktree
- [x] 4.3 If a needs-review cap-hit arises: assert the **bought** verification round — `round_open(n+1, cap+1)` opens exactly once and the run settles by that round's result. If thrash ends the round instead, assert the denial + `### Concern history` section. Not-arisen shapes recorded. Verify: round-shape assertions (or not-arisen notes) land in the reflection notes with event line cites

## 5. Harvest (red-first)

- [x] 5.1 Before copying, write the extended lane oracle red-first: per harvested run — fold(log) ≡ persisted memo fields, every line validates against the event schemas, and `analyze` reads the lane with the correct era flag (C7's lane development-era, C8's era-current). Watch it fail against the not-yet-populated lanes. Verify: `bun test tests/afk-runner/fixtures/live/` fails for the missing lanes (red), then
- [x] 5.2 Review both productive runs' logs for anything non-repo-local (prompts/task text fine; tokens/keys must be absent by design), copy `events.ndjson` + `state.json` per run into live-marked lanes, and bring the oracle green; update the lane README (runs, dates, drills carried). Verify: `bun test tests/afk-runner/fixtures/live/` green including the extended oracle and the inventory lane list

## 6. Corpus report (the re-score instrument)

- [x] 6.1 Run `bun afk-runner/src/cli.ts analyze <runA> <runB> <scratchC> tests/afk-runner/fixtures/live/ --json` and save the report into the change folder; confirm the era-contamination flag excludes development-era runs from aggregates and the C8 runs read era-current; confirm a gate-pending corpus run completed byte-unchanged (read-only contract). Verify: the saved report shows per-metric `known`/`unknown-with-reason` (no errors) and the era split as expected

## 7. Reflection, F-A4 decision, and ledger re-score

- [x] 7.1 Write `reflection.md` per design D9 and the C7 form: n=2 preamble; pass-criteria verdict (D3/D4 boundary, induced-fault list audited); every pre-registered drill adjudicated (induced and opportunistic — not-arisen is a verdict, never a silence); the F-A4 evidence report with the accept-or-fix recommendation; U4 (reflection cost) and U8 (surface-discovery cost) measurements; every U-row re-scored with evidence citing run artifacts or the corpus report; exactly one `next` (standing expectation U3 — argued or displaced) or an explicit tie note. Verify: `openspec validate "v2-live-proof" --strict` passes with the reflection referenced from the change docs
- [x] 7.2 Present the F-A4 accept-or-fix decision to the operator; on accept, close F-A4's paragraph in `docs/architecture/afk-runner.md` with the live citation; on fix, open the follow-up change with the scratch log as red evidence (in-change only under the escape-clause bar); a pending decision is recorded as pending with the follow-up named. Verify: the F-A4 paragraph names the evidence and the decision (or the explicit pending state)
- [x] 7.3 Re-score the living ledger table in `docs/architecture/afk-runner.md`, add the C8 row to the C-table, and note the not-arisen shapes as the next cycle's scope seed. Verify: `rg -n "re-scored after C8|U-ledger" docs/architecture/afk-runner.md` finds the updated living-table language and exactly one `next` verdict

## 8. Full verification

- [x] 8.1 Run the full gate: `bun test`, `bun run typecheck`, `bun run lint`, `bun run duplicates`, and confirm `docs/architecture/` pages affected by this change are current (afk-runner.md; AGENTS.md docs-table row only if stale)
