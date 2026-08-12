## 1. Updater prompt builder (design D2)

- [x] 1.1 Failing test in `tests/sdd-runner/gate-digest.test.ts`: `buildVetoUpdaterPrompt` produces a prompt naming each vetoed entry (id + original text/gap + redirect), includes current artifact content, instructs the agent to apply redirects and scan for stale references, and names the report sidecar path. Verify: `bun test tests/sdd-runner/gate-digest.test.ts` (fails)
- [x] 1.2 Implement `buildVetoUpdaterPrompt` in `gate-digest.ts`; the prompt includes vetoed assumptions (id + text + redirect) and vetoed findings (id + gap + redirect), current artifact content, and the report write target. Verify: `bun test tests/sdd-runner/gate-digest.test.ts`; `bun run typecheck`

## 2. Assumption sidecar update (design D3)

- [x] 2.1 Failing test in `tests/sdd-runner/gate-digest.test.ts`: `updateAssumptionsFromVetoes(sidecarDir, round, vetoes)` reads `resolutions-<round>.json`, updates each vetoed assumption's `text` to the redirect (or marks vetoed if no redirect), writes the updated sidecar. Finding vetoes update the matching resolution's outcome to the redirect. Verify: `bun test tests/sdd-runner/gate-digest.test.ts` (fails)
- [x] 2.2 Implement `updateAssumptionsFromVetoes` in `gate-digest.ts`; reads the last round's sidecar, applies assumption text updates + finding outcome updates from the veto list, writes back. Verify: `bun test tests/sdd-runner/gate-digest.test.ts`; `bun run typecheck`

## 3. Veto updater spawn + validate (design D1)

- [x] 3.1 Failing test in `tests/sdd-runner/gate-digest.test.ts`: `runVetoUpdater(deps, state, ctx, vetoes)` spawns a resolver agent with the veto updater prompt, reads the report sidecar (`files_updated`), and calls `driver.validateStrict`. On validation failure, retries once with the error appended. Returns the list of updated files. Verify: `bun test tests/sdd-runner/gate-digest.test.ts` (fails)
- [x] 3.2 Implement `runVetoUpdater` in `gate-digest.ts` using `runStageAgent` with role `'resolver'`, the veto updater prompt, report schema `{ files_updated: string[] }`, and validate+retry (up to 2 attempts, same as drafter). Verify: `bun test tests/sdd-runner/gate-digest.test.ts`; `bun run typecheck`

## 4. Wire veto branch in runGateResume (design D1 + D3)

- [x] 4.1 Failing test in `tests/sdd-runner/orchestrator.test.ts`: a veto at a final gate (assumption A1 unchecked with redirect) produces `gate-2.md` where A1's text reflects the redirect, the artifact hashes differ from gate-1, and `outcome` is `'veto'` with `version: 2`. Verify: `bun test tests/sdd-runner/orchestrator.test.ts` (fails)
- [x] 4.2 Update `runGateResume` (`orchestrator.ts`): in the veto branch (currently lines 286-295), call `updateAssumptionsFromVetoes` + `runVetoUpdater` before `presentGateAt`. Pass the updater's `files_updated` to the drift-check if tasks.md or specs changed. Thread the existing `vetoRedirects(outcome)` as the veto input. Verify: `bun test tests/sdd-runner/orchestrator.test.ts`; `bun run typecheck`

## 5. Docs + final verification

- [x] 5.1 Update `docs/architecture/sdd-pipeline.md` "Gate protocol" section: note the veto resolver pass (updater agent applies redirect, validates, re-materializes, re-presents). Verify: manual read
- [x] 5.2 Full verification: `bun test`, `bun run typecheck`, `bun run lint`, `openspec validate sdd-veto-resolver-pass --strict`. Update any other affected `docs/architecture/*.md` pages surfaced by the run.
