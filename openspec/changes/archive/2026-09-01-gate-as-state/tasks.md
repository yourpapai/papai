# gate-as-state — tasks

Ordered per design.md Migration Plan; every face starts with its failing test (TDD hooks gate each new `afk-runner/src/**` file).

## 1. Reader face — the latent bug the producers expose

- [x] 1.1 Add failing tests folding the marathon fixture (`2026-08-19T12-04…`) truncated after each `answered` point (seq 1188/1194/1200): outcome reader must report the extended round as drivable, not cap-hit. Verify: `bun test tests/afk-runner/review-outcome.test.ts` (fails)
- [x] 1.2 Guard the review outcome reader: only an unanswered gate parks cap-hit (`gate !== null && !gate.answered`). Verify: `bun test tests/afk-runner/review-outcome.test.ts` and `bun test tests/afk-runner/`

## 2. Kernel face — outcome and deadline fields

- [x] 2.1 Failing tests: `gate answered` maps to a kernel event with optional `outcome`; `gate presented` maps with optional `deadlineAt`; both absent on historical logs. Verify: `bun test tests/afk-runner/kernel-fold.test.ts` (fails)
- [x] 2.2 Extend event schemas (additive optional fields), `toKernelEvent`, and the fold; context unchanged for all historical fixtures. Verify: `bun test tests/afk-runner/` (parity suites green)

## 3. Graph face — the awaiting substate

- [x] 3.1 Failing graph-shape tests: `gate` compound with `awaiting` initial child; `gate.presented` edge from review moves position without stage-map writes; re-presentation re-enters awaiting at v+1; mover edges (`round.open`→review carrying `openRound`, `stage.enter(decompose)`→decompose, `stage.enter(draft)`→draft); `gate.answered`+`outcome=abort`→aborted; existing answered+all-done→completed edge intact. Verify: `bun test tests/afk-runner/graph-shape.test.ts` (fails)
- [x] 3.2 Land the state config changes; full parity over all fixtures plus re-answer fold-tolerance (marathon fixture unchanged). Verify: `bun test tests/afk-runner/parity.test.ts tests/afk-runner/graph-shape.test.ts`
- [x] 3.3 Compound-position handling in the drive loop (flatten `gate.awaiting` to a drivable position key; awaiting declares no work, parks gate-pending positionally). Failing loop test with the fake pipeline first. Verify: `bun test tests/afk-runner/drive-loop.test.ts`

## 4. Seam face — presentation and settlement

- [x] 4.1 Port gate rendering copies (gate-model, gate-answers, gate-digest/render/extract, hashes sidecar) with ported unit tests. Verify: `bun test tests/afk-runner/gate-render.test.ts`
- [x] 4.2 Upgrade review's cap-hit presentation to full presentation: write `gate-<n>.md` + `gate-hashes-<n>.json`, then append `presented`. Failing integration test with stubbed agents. Verify: `bun test tests/afk-runner/review-work.test.ts`
- [x] 4.3 Implement the settle seam: answers → render → parse-back → integrity → append `answered`(+`outcome`) through the boundary. Failing seam tests (approve/extend/veto/abort answer objects). Verify: `bun test tests/afk-runner/gate-settle.test.ts`
- [x] 4.4 First-writer-wins claims: `gate-<n>.settle-claim` exclusive-create, loser rejected naming the winner, legacy `expiry-claim` counts. Verify: `bun test tests/afk-runner/gate-claims.test.ts`

## 5. Waiter face — foreground continuation

- [x] 5.1 Port the waiter as a run-level post-park continuation: 1s poll of gate file and `steer.md`, external-settlement exit, holder alive while waiting, calm-stop no-op at gate-pending. Failing tests with a fake clock. Verify: `bun test tests/afk-runner/gate-waiter.test.ts`
- [x] 5.2 Stability guard (3 consecutive ticks, same content, looks-answered) and steer translation (extend-at-final skipped with warning). Verify: `bun test tests/afk-runner/gate-waiter.test.ts`

## 6. Ladder face — autonomy producer

- [x] 6.1 Port auto-policy (R1–R4, never-cut pre-checks, blast classification) with ported rule tests. Verify: `bun test tests/afk-runner/auto-policy.test.ts`
- [x] 6.2 Presentation-time prelude: always append `auto_decision` (rule=none included; `preview`/`gate` drift tolerated); R1 auto-approves and R2 auto-extends through the seam; allowance derived from folded records. Failing tests, then wire. Verify: `bun test tests/afk-runner/gate-prelude.test.ts`

## 7. Resume face — owed movers and heal

- [x] 7.1 Failing resume tests: explicit `outcome` with missing mover → resume appends the owed mover (`round_open` / `stage_enter(decompose)` and parks awaiting-tail until C5); historical answered-no-outcome parks awaiting settlement. Verify: `bun test tests/afk-runner/resume-gate.test.ts` (fails)
- [x] 7.2 Implement owed-mover recovery and heal-on-settle (next settlement of a historical log appends an explicit-outcome event); end-to-end drill: settle-by-file-edit on a fixture-shaped run continues per outcome. Verify: `bun test tests/afk-runner/resume-gate.test.ts tests/afk-runner/integration.test.ts`

## 8. Veto face — synthetic attestation

- [x] 8.1 Add the synthetic-marked veto scenario fixture (veto answer → `stage_enter(draft)` mover) and lock its fold. Verify: `bun test tests/afk-runner/fixtures/scenarios/inventory.test.ts`
- [x] 8.2 Port the veto-updater revision round as draft re-entry work. Verify: `bun test tests/afk-runner/veto-revision.test.ts`

## 9. Deadline face — thin, config-gated

- [x] 9.1 Stamp optional `deadlineAt` at presentation when configured (absolute time; nothing when unconfigured). Verify: `bun test tests/afk-runner/gate-deadline.test.ts`
- [x] 9.2 Expiry: exclusive claim, conservative-ladder re-run (approve/extend only), re-arm at most once via one additive event, never auto-abort. Verify: `bun test tests/afk-runner/gate-deadline.test.ts`

## 10. Full verification and docs

- [x] 10.1 Run full `bun test`, `bun run typecheck`, `bun run lint`, `bun run knip`, `bun workflows:lint`; fix findings. Verify: all green
- [x] 10.2 Update `docs/architecture/afk-runner.md` (C4 row delivered, engine loop gate note, `schedule`-dormant rationale) and the C4 row of the delivery plan. Verify: docs reflect implemented state
