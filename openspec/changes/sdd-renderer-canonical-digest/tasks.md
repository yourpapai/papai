## 1. DigestRecord type + reducer (design D1, D2)

- [x] 1.1 Failing tests in `tests/sdd-runner/events.test.ts` (extend the `replayEvents` describe near line 119): after replaying a round's `finding` (classified/resolved/dismissed) events followed by a `convergence` event, `state.perRound` contains one `DigestRecord` whose `{ round, counts, resolved, dismissed, verdict }` match the inputs; `state.lastVerdict` is the same record (full shape, including `resolved`/`dismissed`). Verify: `bun test tests/sdd-runner/events.test.ts` (fails)
- [x] 1.2 Add `DigestRecord` to `sdd-runner/src/events.ts`; extend `ReplayState` with `perRound: readonly DigestRecord[]`; widen `lastVerdict` to `DigestRecord | null` (derived from `perRound[perRound.length - 1]`). Extend `foldEvent` (events.ts:273) to accumulate per-round `{ resolved, dismissed }` from `finding` events keyed by `event.round`, flush a `DigestRecord` on `convergence`. Update any existing `lastVerdict` readers that assumed the old shape. Verify: `bun test tests/sdd-runner/events.test.ts`; `bun run typecheck`

## 2. formatBurndownLine + wire at round close (design D7)

- [x] 2.1 Failing tests in `tests/sdd-runner/renderer.test.ts` (new describe): `formatBurndownLine(record)` produces `round <k>: <B>b <M>m <N>n · <R> resolved · <D> dismissed · <verdict>` — all five fields present, trailing verdict, lowercase class letters. Verify: `bun test tests/sdd-runner/renderer.test.ts` (fails)
- [x] 2.2 Implement `formatBurndownLine(record: DigestRecord): string` in `sdd-runner/src/renderer.ts`. Wire at `round_close` in `createRenderer`: when `renderEvent` receives a `round_close`, look up `state.perRound[last]` and write `formatBurndownLine(...)` to the stream. Drop the `convergence` case from `formatEvent` (the burndown supersedes it; the convergence event itself becomes a non-rendered L2 record, like `round_open`/`round_close` adjacent to it). Verify: `bun test tests/sdd-runner/renderer.test.ts`; `bun run typecheck`

## 3. formatTrajectoryBlock — ship speculative API (design D5)

- [x] 3.1 Failing tests in `tests/sdd-runner/renderer.test.ts` (new describe): `formatTrajectoryBlock(records[])` renders a `### Cap-hit trajectory` heading followed by one `formatBurndownLine(record)` per record; empty input returns an empty string (no heading). Verify: `bun test tests/sdd-runner/renderer.test.ts` (fails)
- [x] 3.2 Implement `formatTrajectoryBlock(records: readonly DigestRecord[]): string` in `renderer.ts`. No consumer yet — first consumer is `sdd-runner-cap-hit-fidelity`'s `writeGateDigest`. Verify: `bun test tests/sdd-runner/renderer.test.ts`; `bun run typecheck`

## 4. Delete dead code (design D4)

- [x] 4.1 Delete `renderBurndown` from `sdd-runner/src/renderer.ts` (subsumed by `formatBurndownLine`) and its describe block from `tests/sdd-runner/renderer.test.ts`. Drop the `renderBurndown` import from the test file's import list. Verify: `bun test tests/sdd-runner/renderer.test.ts`; `bun run typecheck`
- [x] 4.2 Delete `renderGateScreen` from `sdd-runner/src/renderer.ts` and its describe block from `tests/sdd-runner/renderer.test.ts`. Drop the `renderGateScreen` import. Verify: `bun test tests/sdd-runner/renderer.test.ts`; `bun run typecheck`
- [x] 4.3 Remove `--wait`: drop the parse block in `sdd-runner/src/cli.ts:59-65`, the `wait: boolean` field from `StartOptions` (`orchestrator.ts:41`), the `wait` thread at `cli.ts:22`, and the `[--wait]` mention in the help string at `sdd-runner/src/index.ts:29`. Verify: `bun test tests/sdd-runner/cli.test.ts`; `bun run typecheck`

## 5. review.md round header alignment (design D6)

- [x] 5.1 Failing test in `tests/sdd-runner/materialize.test.ts` (extend `materializeReview` describe near line 60): the round header's verdict body matches `formatBurndownLine`'s field set (resolves OQ1 in favor of sharing — extract a `formatDigestBody(record)` helper used by both). The `**Verdict**:` markdown prefix stays; only the body is shared. Verify: `bun test tests/sdd-runner/materialize.test.ts` (fails)
- [x] 5.2 Extract `formatDigestBody(record: DigestRecord): string` in `renderer.ts` (the part after `round <k>:`); refactor `formatBurndownLine` to use it; refactor `materialize.ts:63` to format from a `DigestRecord` via the same helper. Verify: `bun test tests/sdd-runner/{renderer,materialize}.test.ts`; `bun run typecheck`

## 6. Cross-change coordination + docs + final verification

- [x] 6.1 Update `openspec/changes/shared-tui-renderer/proposal.md` (line 10 — "keeps its domain logic (`renderPipelineMap`, `formatEvent`, `renderGateScreen`)" — drop `renderGateScreen`) and `openspec/changes/shared-tui-renderer/design.md` (line 110 — "Domain functions (`renderPipelineMap`, `formatEvent`, `renderGateScreen`, `createRenderer`) stay unchanged" — drop `renderGateScreen`). The function is deleted by this change; `shared-tui-renderer`'s migration step 7 (which only touched `RendererStream` import + middle dots) is unaffected. Verify: `openspec validate shared-tui-renderer`; `rg -n 'renderGateScreen' openspec/changes/shared-tui-renderer/` (no matches)
- [x] 6.2 Update `docs/architecture/sdd-pipeline.md` command surface (line 56): drop `[--wait]` from the documented flags for `sdd-runner:start`. Leave the `/sdd:auto` wrapper reference (line 62) — it's still the intended thin wrapper, just not yet implemented. Verify: manual read
- [x] 6.3 Full verification: `bun test`, `bun run typecheck`, `bun run lint`, `openspec validate sdd-renderer-canonical-digest --strict`. Confirm no other `docs/architecture/*.md` page references `--wait` or `renderGateScreen`.
