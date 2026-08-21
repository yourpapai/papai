## 1. Section extractor (design D4)

- [x] 1.1 Failing test in `tests/sdd-runner/gate-digest-extract.test.ts`: `extractChangeDigest({ proposalMd: <fixture with ## Why + ## Impact>, designMd: <fixture with ## Risks>, hasTasksMd: false })` returns `{ what: <first 1-2 sentences>, why: <full why>, touches: [<bullets>], hasTasks: false }`. Verify: `bun test tests/sdd-runner/gate-digest-extract.test.ts` (fails)
- [x] 1.2 Failing test in `tests/sdd-runner/gate-digest-extract.test.ts`: missing `## Why` → `what: null, why: null`; missing `## Impact` → `touches: null`; both present but with setext-style headings (`Why\n===`) → nulls (only ATX `## Why` recognized); malformed/empty sections → null with no throw. Verify: `bun test tests/sdd-runner/gate-digest-extract.test.ts` (fails)
- [x] 1.3 Failing test in `tests/sdd-runner/gate-digest-extract.test.ts`: `hasTasksMd: true` with `tasksDone: 8, tasksTotal: 12` populates `touches` with a trailing `tasks: 8/12` entry; `hasTasksMd: true` without task counts renders `tasks: ?/?`. Verify: `bun test tests/sdd-runner/gate-digest-extract.test.ts` (fails)
- [x] 1.4 Implement `sdd-runner/src/gate-digest-extract.ts`: `extractChangeDigest(input)` as a pure function; ATX-heading regex (`/^## (\w+)/m`); bullets-under-section collection; tolerant of missing sections (returns `null` per field). No file I/O. Verify: `bun test tests/sdd-runner/gate-digest-extract.test.ts`; `bun run typecheck`

## 2. Render section in gate MD (design D2 + D3)

- [x] 2.1 Failing test in `tests/sdd-runner/gate-digest.test.ts`: `writeGateDigest({ ..., changeDigest: { what: 'X', why: 'Y', touches: ['file-a', 'file-b'], hasTasks: false } })` renders a `### Change digest` section between `### Summary` and `### Cost / duration`, with bullets `- **WHAT**: X`, `- **WHY**: Y`, `- **TOUCHES**: file-a, file-b`, `- **RISKS**: see ...`, `- **BLAST**: see ...`. Verify: `bun test tests/sdd-runner/gate-digest.test.ts` (fails)
- [x] 2.2 Failing test in `tests/sdd-runner/gate-digest.test.ts`: null fields render `_(no "Why" section in proposal.md)_`, `_(no "Impact" section in proposal.md)_`, `_(no assumptions logged)_` as appropriate; the RISKS reference target is mode-aware (`### Open MATERIAL findings at cap` at early gate, `### Nitpicks (informational)` at final gate). Verify: `bun test tests/sdd-runner/gate-digest.test.ts` (fails)
- [x] 2.3 Add `changeDigest: ChangeDigest` to `GateDigestInput` (`sdd-runner/src/gate-model.ts`); implement `renderChangeDigest(digest, mode)` helper; wire into `writeGateDigest` between the existing `### Summary` and `### Cost / duration` blocks. Verify: `bun test tests/sdd-runner/gate-digest.test.ts`; `bun run typecheck`

## 3. Wire from orchestrator (design D5)

- [x] 3.1 Failing test in `tests/sdd-runner/orchestrator.test.ts`: `presentGateAt` with a real `proposal.md` and `design.md` fixture in `ctx.changeDir`, `tasks.md` absent (early-gate shape), produces a `GateDigestInput.changeDigest` with non-null `what`, `why`, `touches` and `hasTasks: false`. Verify: `bun test tests/sdd-runner/orchestrator.test.ts` (fails)
- [x] 3.2 Failing test in `tests/sdd-runner/orchestrator.test.ts`: same with `tasks.md` present and parsed `tasksDone: 8, tasksTotal: 12` → `changeDigest.hasTasks: true` and `touches` includes the `tasks: 8/12` entry (final-gate shape). Verify: `bun test tests/sdd-runner/orchestrator.test.ts` (fails)
- [x] 3.3 Update `presentGateAt` (`sdd-runner/src/gate-digest.ts`): read `proposal.md` and `design.md` from `ctx.changeDir` via `readFile`; check `tasks.md` via `existsSync` and parse counts from the existing `readChangeDir` helper (or `loadRunState`); call `extractChangeDigest`; thread result into the `presentGate` input. Verify: `bun test tests/sdd-runner/orchestrator.test.ts`; `bun run typecheck`

## 4. Docs + final verification

- [x] 4.1 Update `docs/architecture/sdd-pipeline.md` Gate protocol section: document the new `### Change digest` subsection, the 5-tuple source map, and the mode-aware rendering (early vs final gate). Verify: manual read
- [x] 4.2 Full verification: `bun test`, `bun run typecheck`, `bun run lint`, `openspec validate sdd-runner-gate-change-digest --strict`. Update any other affected `docs/architecture/*.md` pages surfaced by the run.
