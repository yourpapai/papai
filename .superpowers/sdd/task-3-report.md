# Task 3 Report: Invoke Every Exported Debug Parser

## Result

Extended the existing `SCN-http-debug-schemas` story callback in
`tests/stories/http/debug-schemas.story.test.ts` to invoke the six remaining
exported `parse*` helpers (`parseStateInitEvent`, `parseStateStatsEvent`,
`parseCacheEvent`, `parseUserIdEvent`, `parseSchedulerTickEvent`,
`parsePollerEvent`) against valid payloads. Combined with the helpers already
imported by the story, **every** exported `parse*` (9/9) and `safeParse*`
(6/6) helper in `src/debug/schemas.ts` is now exercised by this single
end-to-end contract without duplicating the internal Zod detail matrix that
belongs to `tests/debug/schemas.test.ts`.

No production schema behavior was changed: every payload in the brief aligns
with its target schema (optional arrays/numbers, required `userId` strings),
so Step 3 (payload/source correction) did not apply and no defect was found.

## Files changed

- `tests/stories/http/debug-schemas.story.test.ts` — added six imports to the
  existing `../../../src/debug/schemas.js` import block (alphabetized with the
  existing entries) and appended six `toMatchObject` valid-event assertions
  inside the existing `SCN-http-debug-schemas` callback, between the
  valid-parse and invalid-input blocks. No other lines touched.

Unrelated dirty files (`docs/architecture/plugins.md`,
`docs/plugins/developer-guide.md`, `.superpowers/sdd/task-5-report.md`) were
left unstaged.

## Commands and results

| Step | Command                                                                           | Result                                                                                |
| ---- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 2    | `bun test:stories -- --fixture tests/stories/http/debug-schemas.story.test.ts`    | pass — 1 test, 23 `expect()` calls (was 17), catalog check `190/218 executable` clean |
| 4    | `bun test tests/debug/schemas.test.ts`                                            | pass — 19 tests, 64 `expect()` calls                                                  |
| —    | `bun typecheck` (`tsgo --noEmit`)                                                 | pass — no output                                                                      |
| —    | `bun lint` (`oxlint ...`)                                                         | pass — no output                                                                      |
| —    | pre-commit hook pipeline (`lint`, `typecheck`, `format:check`, `license-headers`) | 4/4 passed                                                                            |

Note on Step 2/4 invocation: the brief wrote
`bun test:stories -- tests/stories/http/debug-schemas.story.test.ts`, but
`scripts/story/cli.ts` rejects positional paths (`Unsupported story runner
argument`). The runner requires `--fixture <path>`, which is what I used.
The intent (run only this story under the hermetic sandbox) was preserved.

## Commit

- `c477bb820392ece003c3db3a6c750f027ac444f8` — `test(stories): invoke debug schema parsers`
  - 1 file changed, 17 insertions(+)
  - Staged exactly `tests/stories/http/debug-schemas.story.test.ts`; the three
    unrelated dirty files were not staged.

The report itself is delivered as a follow-up commit on the same branch
(`hermetic-stories-continue`) so the code commit matches the brief's Step 5
staging list verbatim.

## Self-review

- [x] All six named parsers imported from `../../../src/debug/schemas.js` (with
      `.js` extension per repo convention) — verified by `rg '^export function parse'`.
- [x] Import block re-alphabetized with the new entries; no duplicate or
      orphaned imports.
- [x] The six `expect(...).toMatchObject(...)` assertions are byte-for-byte the
      ones from the brief; placed in the valid-parse region before the existing
      invalid-input assertions to keep the scenario's logical structure.
- [x] Existing invalid-input assertions (`toBeNull()` / `toThrow()`) and prior
      valid-parse assertions are untouched.
- [x] No internal Zod detail re-tested; no overlap with
      `tests/debug/schemas.test.ts`.
- [x] No production file edited — every payload already satisfies its schema
      (see "Payload/schema alignment" below).
- [x] Public-contract coverage is now total: 9/9 exported `parse*` and 6/6
      exported `safeParse*` helpers are invoked. (There is no exported
      `parseMessageCacheEvent`; `MessageCacheEventSchema` has no parser helper.)
- [x] Pre-commit hook pipeline green; `bun typecheck` and `bun lint` clean.

## Concerns

1. **Brief command syntax.** Steps 2 and 4 give
   `bun test:stories -- <path>`, which the runner rejects. I used
   `--fixture <path>` instead. Worth correcting in the brief for future
   executors; not a code defect.
2. **No production defect found.** Step 3's escape hatch ("align payload or
   source from observed failures") was not triggered — all six payloads
   parsed on the first run, so no schema widening or source change was needed
   and none was made.
3. **Catalog census unaffected.** I extended an existing, already-cataloged
   scenario callback rather than adding a new scenario, so no
   `tests/stories/catalog/coverage.ts` change was required or made; the
   runner's built-in catalog check (`190/218 executable`) passed.

## Payload/schema alignment

Each payload from the brief was checked against `src/debug/schemas.ts`; all
parsed on the first run, so Step 3 did not apply.

- `StateInitEventSchema`: `sessions`, `wizards`, `recentLlm`, `recentTurns`
  are `z.array(z.unknown()).optional()`, so empty arrays are valid.
- `StateStatsEventSchema`: all four keys are `z.number().optional()`.
- `CacheEventSchema`: `userId: z.string()`, `field: z.string().optional()`.
- `UserIdEventSchema`: `userId: z.string()`.
- `SchedulerTickEventSchema`: `running` (optional boolean), `tickCount`
  (optional number).
- `PollerEventSchema`: `scheduledRunning`, `alertsRunning` (optional booleans).
