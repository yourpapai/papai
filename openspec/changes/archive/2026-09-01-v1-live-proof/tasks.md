# Tasks: v1-live-proof

## 1. Pre-flight

- [x] 1.1 Write both task files. S calibration: actualize README and project docs for the GitHub task-tracker plugin (master ships it; its README mentions only Kaneo/YouTrack). M proof: the toolgate port distilled from `openspec/changes/plugin-core-separation-toolgate/proposal.md` (the rubric), with a collision-free H1 slug (`operator-tool-gates-via-registry`). Phrase both texts without the prescreen L-words — "task-tracker plugin", "operator tool gating via a registry port", never provider/auth vocabulary — and vet both through `prescreenProfile` expecting S and M. Verify: `bun -e 'import("./afk-runner/src/work/intake.js").then(m => console.log(m.prescreenProfile(require("node:fs").readFileSync("<taskFile>","utf8"))))'` prints `S` for the calibration file and `M` for the proof file
- [x] 1.2 Create the fresh target worktree off master and the five-key runner config (`budget: 15` or `5` per D5, no deadline, `repoRoot` = target worktree); confirm the target worktree is clean and needs nothing from this branch. Verify: `git -C <target> status --porcelain` is empty and `bun -e 'import("./afk-runner/src/config.js").then(m => console.log(m.loadRunnerConfig("<configPath>")))'` resolves

## 2. Calibration run (S, docs-shaped)

- [x] 2.1 Run `afk-runner start <taskFile>` from this worktree against the target; attend gates via the documented answer surfaces only; let the run reach its terminal memo. Verify: memo records `completed`, `afk-runner report <runId>` prints, and `openspec validate <changeName> --strict` passes inside the target worktree

## 3. Proof run (M) with incidents A and B

- [x] 3.1 Start the M run; during review round 1, aim the kill telescope (`tail -f` for `round_open` + `spawned`), kill the holder pid **and process group** (incident A), observe the orphaned child, then `resume`; confirm same-round re-entry with in-flight session continuation from the ledger. Verify: the log shows the killed round re-run without a fresh `round_open`, the session ledger shows the continuation, and the run proceeds
- [x] 3.2 At the converged final gate settle **veto** (incident B); let the revision round run over cap; settle the re-presented gate with approve; reach the terminal memo. Verify: `stage_failed` never appears in this run, settle count is 2 (or 3 with a blockers-open re-present — recorded either way), memo records `completed`
- [x] 3.3 Grade the produced change and the run's honesty: `openspec validate <changeName> --strict` and its task-verification commands pass in the target worktree; grade the run's proposal/design/tasks coverage against the rubric (the existing `plugin-core-separation-toolgate` folder — did the run find the same ground: the registry port, the `gate: 'operator'` declarations, the manifest-hash re-approval wrinkle, the architecture guard?); spot-check `memoFieldsOf` projections against the log at every park. Verify: validation green and the rubric comparison + memo spot-check notes land in the reflection notes file

## 4. Incident C (scratch run)

- [x] 4.1 In a scratch run dir with a bogus model name in the config, start, watch the watchdog retries burn, then answer the escalation gate with abort. Verify: the log shows `retrying` events, `stage_failed` with kind `exhausted`, an escalation-mode `presented`, and the memo records `failed` — deviations recorded as findings, not surprises

## 5. Harvest

- [x] 5.1 Review the M run's log for anything non-repo-local (prompts/task text are fine; tokens/keys must be absent by design), then copy `events.ndjson` + `state.json` into a live-marked fixture lane; write the lane's oracle test: fold(log) reproduces the persisted memo fields and every line validates against the event schemas. Verify: `bun test tests/afk-runner/fixtures/` green including the new lane test
- [x] 5.2 Confirm the corpus marking vocabulary distinguishes live from legacy/synthetic without touching ported-test expectations. Verify: `bun test tests/afk-runner/fixtures/scenarios/inventory.test.ts` (or its successor) green

## 6. Reflection and ledger re-score

- [x] 6.1 Write the reflection artifact: verdict/evidence/trigger for every U-item (exactly one `next` or an explicit tie note), the n=1 preamble, the five pre-registered findings verbatim plus whatever the runs added, the pass-criteria verdict per D3, and the incident observations (orphan behavior, watchdog count, taxonomy boundary). Verify: `openspec validate "v1-live-proof" --strict` passes with the reflection referenced from the change docs
- [x] 6.2 Move the living U-table to `docs/architecture/afk-runner.md` with the re-scored verdicts and update the stale pointer to the afk-runner change's design.md. Verify: `rg -n "re-scored after C7" docs/architecture/afk-runner.md` finds the updated living-table language, not the old pointer

## 7. Re-tighten (post-reflection)

- [x] 7.1 Split the four over-limit files along their natural seams as informed by the reflection (run.ts, gate-waiter.ts, agent-layer.ts, event-schemas.ts) — behavior-preserving moves only. Verify: `bun test tests/afk-runner/` green and `bun run typecheck`
- [x] 7.2 Convert the four StageId `as`-narrowings (drive/loop.ts ×3, drive/failure-budget.ts ×1) to zod-parse. Verify: `bun test tests/afk-runner/drive/` green and `bun run typecheck`
- [x] 7.3 Extract the C6 error-taxonomy classes to their own module, resolving the `max-classes-per-file` conflict by extraction. Verify: `bun test tests/afk-runner/` green and `bun run typecheck`
- [x] 7.4 Delete the afk-scoped oxlint overrides (max-lines pair, no-unsafe-type-assertion, max-classes-per-file); re-annotate the tests-side `no-unsafe-*` block and the jscpd ignores in `scripts/detect-duplicates.ts` as timed to the sdd-runner retirement follow-up with the recorded justification. Verify: `bun run lint` green and `bun run duplicates` unchanged
- [x] 7.5 Update `docs/architecture/afk-runner.md`: C7 row to delivered, the relaxation-window section rewritten as closed with the U9 re-time recorded, layout section updated for the splits. Verify: `rg -n "re-tighten|U9" docs/architecture/afk-runner.md` reflects the close-out

## 8. Full verification

- [x] 8.1 Run the full gate: `bun test`, `bun run typecheck`, `bun run lint`, `bun run duplicates`, and confirm `docs/architecture/` pages affected by this change are current (afk-runner.md; AGENTS.md docs-table row if stale)
