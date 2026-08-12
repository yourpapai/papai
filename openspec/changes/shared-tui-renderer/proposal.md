## Why

`review-loop`, `mutation-improve`, and `sdd-runner` each draw the same in-place TUI block — a slot region that redraws in place plus a rolling status footer. The ANSI redraw engine (`writeBlock` / `clearBlock` / `writeSafe` / `fit`, `cursorUp`, `ERASE_LINE`), the `RendererStream` contract, and the small format helpers (`formatDuration`, `truncate`, `formatTokenCount`, `MIDDLE_DOT`) are duplicated verbatim across `review-loop/src/live-renderer.ts` and `sdd-runner/src/live-renderer.ts` — the latter carries a TODO explicitly pointing at this proposal — while `mutation-improve` reaches into `review-loop/src/*` by fragile relative path (`../../review-loop/src/...`) rather than a real dependency. Three copies of the same primitives now drift independently.

## What Changes

- Add a new shared Bun workspace (`tui-renderer/`, sibling to `review-loop/` and listed in the root `package.json` `workspaces`) exporting the consolidated primitives: the in-place block-redraw engine, the `RendererStream` interface, and the format helpers (`formatDuration`, `truncate`, `formatTokenCount`, `MIDDLE_DOT`).
- `review-loop/src/{live-renderer,live-format}.ts`: source the primitives from the new workspace; keep the domain-specific `LiveRenderer`, slot/status-line, and issue-progress logic in place.
- `sdd-runner/src/{live-renderer,renderer}.ts`: drop the inlined `writeBlock`/`clearBlock`/`writeSafe`/`fit`, `cursorUp`, the re-declared `RendererStream`, and the re-inlined `formatDuration`/`truncate`/`formatTokenCount` in favor of the shared module; keep `DynamicRenderer`/`LineRenderer`/`renderPipelineMap`.
- `mutation-improve/src/{cli,summary}.ts`: replace the `../../review-loop/src/live-format.js` / `live-renderer.js` relative imports with a real workspace dependency.
- Terminal output stays byte-identical — pure consolidation, no behavior change.

## Capabilities

### New Capabilities

`tui-renderer` — shared terminal-rendering primitives capability, added as the delta at `specs/tui-renderer/spec.md`: an in-place ANSI block-redraw engine, the renderer-stream contract it targets, and the duration/truncate/token-count/middle-dot format helpers. Consumed byte-identically by the `review-loop`, `mutation-improve`, and `sdd-runner` developer-tooling workspaces; terminal output of all three consumers is unchanged (pure refactor — byte-identity is the consolidation's compatibility contract, not new behavior).

### Modified Capabilities

_None_ — `openspec/specs/` holds no existing capability specs to modify, and terminal rendering behavior is unchanged. The change does **not** set `skip_specs` in `.openspec.yaml`, because it adds the new `tui-renderer` capability spec above.

## Impact

- **Code:** `review-loop/src/{live-renderer,live-format}.ts`, `sdd-runner/src/{live-renderer,renderer}.ts`, `mutation-improve/src/{cli,summary}.ts`; new `tui-renderer/` workspace (`package.json`, `tsconfig.json`, `src/`, own test dir).
- **Workspaces:** root `package.json` `workspaces` gains `tui-renderer`; `review-loop`, `mutation-improve`, and `sdd-runner` `package.json` each gain an explicit `tui-renderer` workspace dependency (review-loop composes a `BlockEngine` and re-exports the primitives per D5, so it needs the dep alongside its siblings). `review-loop` stops being the de-facto shared library for the TUI primitives only; the wider cross-workspace borrowing (`run-stats`/`cost`/`diff-stats`/`spawn`/`agent-runner`/`worktree`/`build-checker`) stays on relative paths per the Non-goals, so review-loop remains a shared library for those modules until a later change.
- **Docs:** in-workspace `review-loop/CLAUDE.md` and `mutation-improve/CLAUDE.md` — the latter's "imported by relative path (not a package dependency)" note for the renderer/format helpers becomes outdated. `docs/architecture/sdd-pipeline.md` is unaffected at the behavior level.
- **Platform/task instances:** none — all three workspaces are local developer tooling with no papai runtime, config-context, per-user, group-shared, or thread-isolated scope impact.
- **Tests:** existing `tests/{review-loop,mutation-improve}/` and sdd-runner suites must stay green byte-for-byte; the new workspace ships unit tests for the primitives.

## Non-goals

- Unifying the domain-specific renderers (`LiveRenderer` vs `DynamicRenderer`/`LineRenderer`) — only the shared primitives move.
- Changing any terminal output, status-line composition, slot semantics, or verbosity/altitude filtering.
- Touching the papai runtime (`src/`, `client/`), chat/task providers, or any config-context scope.
- Migrating the wider cross-workspace borrowing (`RunStats`/`cost`/`diff-stats`, `spawn`/`agent-runner`) noted in `mutation-improve/CLAUDE.md` — those stay by relative import for a later change.
