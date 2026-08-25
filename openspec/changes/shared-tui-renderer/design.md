## Context

`review-loop`, `sdd-runner`, and `mutation-improve` are sibling Bun workspaces (root `package.json:7-12`) for local developer tooling — none is part of the papai runtime. All three draw the same in-place TUI block onto a writable stream. See `proposal.md` for why this consolidation exists and `specs/tui-renderer/spec.md` for the byte-level contract every primitive must keep.

The duplication has three distinct shapes, which drives the migration design:

1. **Canonical copy** — `review-loop/src/live-format.ts` (pure helpers: `formatDuration`, `truncate`, `formatTokenCount`, `MIDDLE_DOT`) and `review-loop/src/live-renderer.ts` (the `RendererStream` interface plus the ANSI redraw engine as the private methods `writeBlock`/`clearBlock`/`writeSafe`/`fit` and the private state `renderedLines`/`broken` on `LiveRenderer`).
2. **Inlined copy** — `sdd-runner/src/live-renderer.ts:15-36,132-170` carries byte-identical bodies of those same private methods and helpers (with a TODO at `live-renderer.ts:38-48` pointing at this proposal); `sdd-runner/src/renderer.ts:14-30` re-declares `RendererStream`, `MIDDLE_DOT`, `formatTokenCount`.
3. **Relative-path borrower** — `mutation-improve/src/summary.ts:6` imports `formatDuration`/`formatTokenCount` from `../../review-loop/src/live-format.js`; `mutation-improve/src/cli.ts:10` imports `LiveRenderer` from `../../review-loop/src/live-renderer.js`. `mutation-improve/package.json` declares no dependency on `review-loop` — the link is pure TypeScript relative-path resolution against source.

The one structural wrinkle that shapes the design: the redraw engine is **private methods plus private state on two unrelated classes** (`LiveRenderer`, `DynamicRenderer`), not free functions. The bodies are byte-identical (`writeBlock`/`clearBlock`/`writeSafe`/`fit`), so consolidating them means extracting the methods *and* their state into a shared, composable unit — not just moving free functions between files.

Two repo scripts hardcode the workspace prefix set and must be taught about the new workspace: the TDD resolver (`.hooks/tdd/test-resolver.mjs`) enumerates `review-loop/src/` and `sdd-runner/src/` (note: `mutation-improve/src/` is **not** gated today), and `scripts/mutation/coverage-map.ts:203-210` mirrors the same mapping for the mutation ratchet. `scripts/add-license-headers.ts:15` lists `review-loop/src`/`opencode-agent/src` in `SOURCE_ROOTS` but omits the other workspaces — pre-existing inconsistency, addressed opportunistically.

## Goals / Non-Goals

**Goals:**
- Establish `tui-renderer` as the single source of the redraw engine, `RendererStream`, and the four format helpers, consumed via a real Bun workspace dependency — not relative paths, not re-inlined copies.
- Terminal output of all three consumers stays byte-identical (the spec's `Consolidation is byte-identical across consumers` requirement, `spec.md:151-163`); existing renderer/format suites under `tests/{review-loop,sdd-runner,mutation-improve}/` pass **unaltered**.
- The new workspace is test-first gated by the Write/Edit TDD hook pipeline like its siblings, and ships its own unit tests pinning the primitives' byte output.

**Non-Goals** (design-level; see `proposal.md` Non-goals for scope):
- No unified domain renderer — `LiveRenderer`, `DynamicRenderer`, `LineRenderer`, and their slot/status-line/pipeline-map logic stay put; only the primitives they share move.
- No general TUI framework — only the primitives the three already duplicate.
- No build step and no runtime dependency for the shared module; source-only, like the other workspaces.
- No change to the papai runtime, providers, tools, or any persisted/config scope.

## Decisions

### D1 — New `tui-renderer` workspace, source-only, real package resolution

Create `tui-renderer/` as a sibling workspace listed in root `package.json` `workspaces`. Its `package.json` exposes the entry as source — `"exports": { ".": "./src/index.ts" }` — mirroring the root package's own `".": "./src/index.ts"` pattern (`package.json:15-18`). No build, no `main`/`module` split, `.js` import extensions internally per repo convention.

Consumers depend on it as `"tui-renderer": "workspace:*"`, which Bun resolves to the workspace by `name`. This is the only mechanism that gives a real resolution seam.

**Alternatives rejected:**
- *Shared directory without a package* (e.g. a top-level `shared/tui/` imported by relative path) — no resolution seam; just replaces `../../review-loop/src/...` with `../../shared/tui/...`, the same fragility the proposal flags.
- *Publish `review-loop` as the shared package* — forces `review-loop` to own presentation primitives that have nothing to do with code review, and makes the domain renderer (`LiveRenderer`) share a package with the primitives its sibling consumes. The proposal explicitly retires "review-loop as de-facto shared library" (`proposal.md:26`).

### D2 — Module split: pure helpers vs. stateful engine

`tui-renderer/src/` ships four files:
- `stream.ts` — the `RendererStream` interface.
- `format.ts` — pure helpers `formatDuration`, `truncate`, `formatTokenCount`, `MIDDLE_DOT`, plus the module-private `ELLIPSIS` that `truncate` needs.
- `engine.ts` — the in-place block-redraw engine (see D3) and its private ANSI constants (`ERASE_LINE`, `CURSOR_DOWN`, `cursorUp`).
- `index.ts` — barrel re-exporting the public surface.

Rationale: the format helpers are pure functions with no I/O; the engine is stateful and writes ANSI bytes to a stream. Keeping them in separate modules lets the format helpers be tested with trivial input→output assertions while the engine is tested with byte-sequence capture over a fake stream (matching how `tests/review-loop/live-renderer.test.ts` already asserts exact `\r\u001b[2K…` sequences).

### D3 — Extract the redraw engine as a composed `BlockEngine` class

The shared engine is a stateful class — not free functions, not a base class to inherit:

```ts
class BlockEngine {
  constructor(stream: RendererStream)
  render(lines: string[]): void   // formerly writeBlock
  clear(): void                   // formerly clearBlock
  write(chunk: string): void      // formerly writeSafe — broken-aware raw write
  get broken(): boolean           // formerly private state
  get dynamic(): boolean          // stream.isTTY === true && !broken
}
```

`render`/`clear` move verbatim from the existing private method bodies (`review-loop/src/live-renderer.ts:210-248`; `sdd-runner/src/live-renderer.ts:132-170` — byte-identical). The `renderedLines`/`broken` fields and the `writeSafe`/`fit` helpers move into `BlockEngine` with them. `writeSafe` is exposed as the public `write(chunk)` because both domain renderers call it directly in their non-TTY (append-only) branches — `review-loop/src/live-renderer.ts:140,144,155` (`event`/`live` non-TTY) and `sdd-runner/src/live-renderer.ts:69,80` (`renderState`/`renderEvent` non-TTY); keeping it private would force each consumer to re-duplicate the broken-aware write logic, defeating the consolidation. `fit` stays private because it is used only inside `render`. `LiveRenderer` and `DynamicRenderer` each compose a `BlockEngine` instance and delegate their redraw and non-TTY append calls; where they previously read `this.broken` they now read `this.engine.broken`, and the public `dynamic`/`broken` indicators they already expose (`tests/review-loop/live-renderer.test.ts` exercises the EPIPE downgrade) are forwarded from the engine.

**Alternatives rejected:**
- *Base class (`BaseRenderer`)* — the two domain renderers have unrelated constructors, status-line composition, and event types (`ProgressReporter` vs `Renderer`/`Verbosity`); inheritance would force a leaky shared spine and shared state layout where there is no shared domain. Composition keeps the engine an implementation detail.
- *Free functions threaded explicit state* — callers would have to own and pass `{ renderedLines, broken, stream }` everywhere; uglier and easier to desync than a self-contained object.

### D4 — `RendererStream` takes the `readonly` form

The two declarations differ only in `readonly` modifiers: `sdd-runner/src/renderer.ts:14-18` marks `isTTY?`/`columns?` `readonly`; `review-loop/src/live-renderer.ts:19-23` does not. The shared interface adopts `readonly` — it is strictly safer, matches how the fields are used (consumers only read them; both domain renderers hold `private readonly stream`), and is the shape sdd-runner already chose. This is a non-breaking tightening for review-loop: a grep confirms no consumer assigns to `stream.isTTY`/`stream.columns`, and `tests/review-loop/test-helpers.ts:14` (which re-imports the interface for its `MemoryStream` double) is compatible with readonly members.

### D5 — Consumer wiring minimizes churn while killing every cross-workspace relative path

- **`review-loop`**: `live-format.ts` keeps its domain helpers (`formatToolArg`, `formatLiveLine`, `formatStepFooter`, `activitySummary`, `ACTIVITY_VERB`) and **re-exports** the four primitives from `tui-renderer`; `live-renderer.ts` re-exports `type RendererStream` from `tui-renderer` and composes a `BlockEngine`. This keeps `tests/review-loop/live-format.test.ts` (which imports the primitives from `../../review-loop/src/live-format.js`) and `tests/review-loop/test-helpers.ts` (which imports `RendererStream` from `../../review-loop/src/live-renderer.js`) **unaltered**, and internal callers (`summary.ts`, `line-handler.ts`, `build-checker.ts`, `cli.ts`) keep their existing import paths.
- **`sdd-runner`**: `renderer.ts` and `live-renderer.ts` drop the inlined copies and import `RendererStream`/`MIDDLE_DOT`/`formatTokenCount`/`formatDuration`/`truncate` and `BlockEngine` directly from `tui-renderer`. No sdd-runner file outside the renderer pair imports `RendererStream` (only `Verbosity`/`createRenderer`/`formatDigestBody`/`formatTrajectoryBlock` cross module boundaries — confirmed via `index.ts`/`cli.ts`/`orchestrator.ts`/`materialize.ts`/`gate-model.ts`), so no re-export shim is needed there. As a cleanup bonus, sourcing the primitives from a third module removes the `renderer.ts ↔ live-renderer.ts` import edge for those primitives, partially breaking today's value/type cycle between the two files. The byte-literal `MIDDLE_DOT` in `sdd-runner/src/agent-reporter.ts:10` is explicitly **out of scope**: that file is a slot-line *parser* that matches the U+00B7 byte as a delimiter pattern (`afterArrow.indexOf(\` ${MIDDLE_DOT} \`)` at `:22`), not a status-line composer; the spec's `Separator glyph` requirement and its `single source` consolidation scenario reach consumers *composing* status lines, so a parser matching a fixed byte literal is left untouched to minimize churn.
- **`mutation-improve`**: `summary.ts:6` switches its `formatDuration`/`formatTokenCount` import from `../../review-loop/src/live-format.js` to `tui-renderer`. `cli.ts:10` keeps importing `LiveRenderer` from `review-loop` — that class is domain-specific and stays (proposal Non-goal). All other `../../review-loop/src/...` imports in `mutation-improve` (`run-stats`, `cost`, `diff-stats`, `spawn`, `worktree`, `agent-runner`, `build-checker`) are explicitly out of scope and remain on relative paths for this change.

`tests/mutation-improve/contracts.test.ts:124-138` (the Tier B `typeof` inventory) lists `runAgent`/`agentWritePath`/`realSpawn`/`createWorktree`/`execGit`/`mergeWorktree`/`removeWorktree`/`resetWorktree`/`detectGitRoot` — none of which move — so it is unaffected. Its Tier A `LiveRenderer.log` smoke test (`tests/mutation-improve/contracts.test.ts:104-114`) also stays green because `LiveRenderer` remains in `review-loop`.

### D6 — Register the workspace with the TDD hook and mutation coverage map before writing primitives

For the new workspace to be test-first gated like `review-loop`/`sdd-runner`, extend three places **before** authoring `tui-renderer/src/`:
- `.hooks/tdd/test-resolver.mjs` — add a `tui-renderer/src/` branch to `isGateableImplFile` (line 22-34), `suggestTestPath` (line 41-73), `findTestFile` (line 81-153), and `resolveImplPath` (line 160-194), each a verbatim copy of the `review-loop/src/` branch with the prefix swapped. The resolver already encodes the `tui-renderer/src/x.ts → tests/tui-renderer/x.test.ts` mapping convention.
- `scripts/mutation/coverage-map.ts:203-210` — add the matching `tui-renderer/src/` arm to `samePackageTestDir` so the per-file mutation ratchet can compute a floor for the new files.
- `scripts/add-license-headers.ts:15` — add `tui-renderer/src` to `SOURCE_ROOTS` (and, for consistency, the currently-missing `sdd-runner/src` and `mutation-improve/src`; these are pre-existing omissions, not introduced here).

### D7 — `tui-renderer` package shape

`package.json`: `name: "tui-renderer"`, `private: true`, `type: "module"`, `exports: { ".": "./src/index.ts" }`, **no runtime `dependencies`** (the primitives are pure TypeScript with no imports outside `node:path`-free logic), `devDependencies` mirroring siblings (`typescript`). `tsconfig.json` extends `../tsconfig.json` with `types: ["bun"]`, `include: ["src/**/*.ts"]`. Scripts follow the sibling pattern (`test`, `typecheck`, `lint`, `format`, `format:check`), all `cd ..`-ing to repo root, and root `package.json` gains `tui-renderer:test`/`:typecheck`/`:lint`/`:format:check` aliases plus a slot in `check:verbose` (`package.json:99`).

## Risks / Trade-offs

- **[Extracting private methods into `BlockEngine` subtly changes emitted bytes]** (e.g. a cursor-up count off-by-one from mis-threading `renderedLines`) → Mitigation: the existing byte-assertion suites (`tests/review-loop/live-renderer.test.ts:176-299` pins the exact `\r\u001b[2A` / leftover-erase sequences; `tests/sdd-runner/live-renderer.test.ts:48-65` pins `\r`/`\u001b[2K`/`▶`/`5.0k`) are the contract and must pass unaltered; the new `tests/tui-renderer/engine.test.ts` re-asserts the same sequences at the engine level as a primary net.
- **[`readonly` tightening on `RendererStream` breaks a writer]** → Mitigation: grep shows no assignment sites; both domain renderers already hold `readonly stream`. Pure widening of safety.
- **[TDD resolver branch mis-shape silently mis-gates new files]** (wrong test-path suggestion blocks the Write/Edit hook) → Mitigation: copy the `review-loop/src/` branch verbatim, swap the prefix; the resolver's existing behavior for the two siblings is the reference. Order this as migration step 0, before any primitive is written.
- **[Re-export shim in `review-loop/src/live-format.ts` reads to a future maintainer as "review-loop is still the shared library"]** → Mitigation: no external consumer routes through it after this change (mutation-improve and sdd-runner import `tui-renderer` directly); the `review-loop/CLAUDE.md`/`mutation-improve/CLAUDE.md` updates noted in `proposal.md:27` state the new relationship.
- **[Trade-off: a local re-export remains in `review-loop` rather than updating every internal caller]** → chosen deliberately to satisfy the spec's "existing tests pass without alteration" scenario (`spec.md:155-158`); the alternative (rewriting all review-loop internal imports + the test's import target) is strictly more churn for zero behavioral benefit.

## Migration Plan

Each step lands independently green and is independently revertible (pure refactor; no DB, no runtime, no migration). Rollback at any point = `git revert` the step.

0. **Hook/coverage registration (D6).** Extend the TDD resolver, mutation coverage map, and license-headers `SOURCE_ROOTS` for `tui-renderer/src/`. No behavior; lets the remaining steps write test-first under the gate.
1. **Land `tui-renderer` standalone.** Add the workspace (`package.json`, `tsconfig.json`, `src/{stream,format,engine,index}.ts`) with its unit tests under `tests/tui-renderer/`, authored test-first. Add the root `workspaces` entry, script aliases, and `check:verbose` slot. Nothing else imports it yet; all existing suites stay green.
2. **Switch `review-loop` to consume it (D5).** `live-format.ts` re-exports the four primitives; `live-renderer.ts` re-exports `RendererStream` and composes `BlockEngine`. Add `"tui-renderer": "workspace:*"` to `review-loop/package.json`. `tests/review-loop/{live-format,live-renderer}.test.ts` pass unaltered.
3. **Switch `sdd-runner` to consume it (D5).** Drop the inlined copies in `renderer.ts`/`live-renderer.ts`; import primitives + `BlockEngine` from `tui-renderer`; compose `BlockEngine` in `DynamicRenderer`. Add the workspace dependency. `tests/sdd-runner/{renderer,live-renderer}.test.ts` pass unaltered.
4. **Switch `mutation-improve` to consume it (D5).** `summary.ts` imports `formatDuration`/`formatTokenCount` from `tui-renderer`. Add `"tui-renderer": "workspace:*"` to `mutation-improve/package.json` (mirroring steps 2/3; without it Bun cannot resolve the `tui-renderer` workspace import and typecheck fails). Update `mutation-improve/CLAUDE.md:49` (the "imported by relative path (not a package dependency)" bullet) to reflect that the format helpers now come from a real workspace dep, leaving the still-relative `run-stats`/`spawn`/`worktree`/etc. imports noted. `tests/mutation-improve/{summary,contracts}.test.ts` pass unaltered.
5. **Verify the byte-identical contract.** Full `bun run test` (covers `tests/{review-loop,sdd-runner,mutation-improve}/`) plus `bun run check:full` (workspace lint/typecheck/format/knip for all four workspaces). The byte-assertion tests in step 2-4 are the contract; this step is the consolidated confirmation.

## Project-rule impact

- **Capability / `tool_prefs` gating:** none. These three workspaces are local developer CLI tooling with no papai tool surface; no new tools, no capability gating, no `tool_prefs` entries. (Restates `proposal.md:28`.)
- **Scope model:** none. The shared module introduces no persisted state of any kind — no storage-context, config-context, platform-instance, task-instance, or per-user key. It is in-memory terminal rendering only.
- **DB / drizzle:** none. No schema, no migration, no backfill.
- **New dependencies:** none external. `tui-renderer` has zero runtime `dependencies` (the primitives need nothing outside pure TS), and the `workspace:*` link is a Bun-internal workspace resolution, not an npm fetch. The existing stack (Grammy, discord.js, AI SDK, Zod, drizzle) does not provide terminal ANSI redraw primitives, so there is no existing dependency to lean on; consolidation into a workspace package is the Bun-native fix for the duplication, not a new third-party import.
- **Hook / TDD interactions:** the new gateable files are `tui-renderer/src/{stream,format,engine,index}.ts`, mapped test-first to `tests/tui-renderer/{format,engine}.test.ts` (`stream.ts` is interface-only and is covered transitively by `engine.test.ts`; `index.ts` is a barrel with no behavior). Step 0 (D6) registers the prefix so the Write/Edit pipeline gates these from the first write. Note: `mutation-improve/src/` is not TDD-hook-gated today and this change does not alter that — the edits to `mutation-improve/src/{cli,summary}.ts` are covered by the full `bun run test` suite (`tests/mutation-improve/`), not by the per-write hook. The test-first authoring order is: `tests/tui-renderer/format.test.ts` → `src/format.ts` → `tests/tui-renderer/engine.test.ts` → `src/engine.ts` → `src/stream.ts` + `src/index.ts`.

## Open Questions

- Whether to fold `mutation-improve/src/summary.ts:36`'s literal `' · '` join into an imported `MIDDLE_DOT` (a soft duplication of the glyph, not of the constant). Pure cosmetic consistency; deferrable without touching the spec or the migration.
- Whether to expand the shared glyph set beyond `MIDDLE_DOT` (e.g. expose `ELLIPSIS`/`ARROW`/`CHECK`). Today only `MIDDLE_DOT` is shared (spec `Separator glyph` requirement) and `ELLIPSIS` rides along privately inside `truncate`; the other glyphs stay domain-local. A later change can grow the surface without breaking consumers.
