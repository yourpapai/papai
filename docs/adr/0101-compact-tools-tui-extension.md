<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0101: Compact Tools TUI Extension for pi

## Status

Accepted

## Context

The pi coding agent's default TUI rendering for built-in tools (`read`, `bash`, `edit`, `write`) produces verbose multi-line output for every tool invocation. During extended agent sessions with dozens of tool calls, this creates significant visual noise and makes it hard to follow the conversation flow at a glance. The full output still needs to reach the LLM context — only the TUI display should be compact.

The extension mechanism in pi supports global extensions via `~/.pi/agent/extensions/*.ts`, which can re-register built-in tools by name and provide custom `renderCall` and `renderResult` functions.

## Decision Drivers

- **Reduce visual noise** during long agent sessions with many tool calls
- **Preserve LLM context** — compact rendering must be TUI-only, not affect tool output sent to the model
- **Zero behavioral regression** — tool execution logic must remain unchanged
- **Expand-on-demand** — users must still be able to inspect full output (built-in Ctrl+E support)
- **Global application** — should work across all projects without per-project configuration

## Considered Options

### Option 1: Overwrite pi dist files directly

Patch pi's built-in rendering code in-place under `node_modules`.

- **Pros**: No indirection, direct control over rendering
- **Cons**: Breaks on every pi upgrade; fragile; not maintainable

### Option 2: Per-project extension

Place a compact-tools extension in each project's `.pi/extensions/`.

- **Pros**: Can vary per project
- **Cons**: Duplicated effort; easy to forget to copy; not DRY

### Option 3: Global pi extension with delegate pattern (chosen)

Create a single global extension at `~/.pi/agent/extensions/compact-tools.ts` that re-registers each tool by name, delegates execution to the original `create*Tool()` factory functions, and provides custom `renderCall`/`renderResult` handlers.

- **Pros**: Survives pi upgrades (original factories stay authoritative); zero execution regression; applies universally; single source of truth
- **Cons**: Extension API surface must remain stable; render API must expose `expanded` state and `theme` helpers

## Decision

We will create a single global pi extension at `~/.pi/agent/extensions/compact-tools.ts` that overrides the TUI rendering for `read`, `bash`, `edit`, and `write` while delegating all execution to the original tool factories.

## Rationale

The delegate pattern provides the safest path:

1. **Execution fidelity** — `execute()` calls the original tool's `execute()` verbatim, eliminating any risk of behavioral drift
2. **Upgrade resilience** — pi bug fixes and feature additions in the core tools automatically propagate through
3. **Incremental evolution** — rendering improvements (spinner, duration, command compaction) can be added without touching execution logic
4. **No LLM impact** — the extension only overrides TUI rendering; the tool result objects passed to the model are unchanged

## Consequences

### Positive

- Dramatically reduced visual noise during multi-tool agent sessions
- Single file (`~/.pi/agent/extensions/compact-tools.ts`) governs the experience across all projects
- Built-in Ctrl+E expand toggles still reveal full output on demand
- Errors, exit codes, and truncation warnings remain visible in the compact summary line

### Negative

- Extension depends on pi's `ExtensionAPI` and `create*Tool()` signatures remaining stable
- `renderCall`/`renderResult` context objects (e.g., `lastComponent`, `state`, `invalidate`) are internal pi APIs subject to change
- Extension is TypeScript, so any upstream type changes in `@earendil-works/pi-coding-agent` require a re-sync

### Risks

- **API drift**: If pi removes or changes `createReadTool()` etc., the extension fails to load.
  - _Mitigation_: The extension is small (~250 lines) and the delegate pattern is simple to adapt.
- **Namespace drift**: Package was renamed from `@mariozechner/pi-coding-agent` to `@earendil-works/pi-coding-agent`.
  - _Mitigation_: Already handled; imports updated.

## Evolution After Acceptance

Since the initial implementation (commit `2c4e0c88`), the extension has gained several UX improvements beyond the original spec:

| Enhancement              | Description                                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------- |
| Animated spinner         | Braille spinner (`⠋⠙⠹...`) during partial execution via `setInterval`/`invalidate()`                |
| Duration tracking        | Elapsed time shown on completion (e.g., "done, 1.2s")                                               |
| Command compaction       | Strips redundant `cd $CWD &&` prefix, truncates chained commands, adds badges (`[+1]`, `[3 lines]`) |
| Relative path display    | Shows `./relative/path` when target is inside CWD instead of absolute paths                         |
| Rich diff preview        | Colored +/- highlighting, additions/removals count, truncated preview with "more lines" indicator   |
| Write line-count summary | Shows "42 lines, written" instead of just "Written"                                                 |

Note: The reference copy in `docs/superpowers/extensions/compact-tools.ts` and the original design spec (`docs/superpowers/specs/2026-04-29-compact-tools-extension-design.md`) reflect the _initial_ design only. The live global extension at `~/.pi/agent/extensions/compact-tools.ts` is the authoritative current implementation.

## Tool-by-Tool Compact Behavior

### read

| State           | Display                             |
| --------------- | ----------------------------------- |
| In progress     | `-> read ./relative/path`           |
| Done, collapsed | `42 lines` or `N lines [truncated]` |
| Done, expanded  | First 15 lines dimmed, then "more"  |
| Image           | `image` status suffix               |

### bash

| State           | Display                                    |
| --------------- | ------------------------------------------ |
| In progress     | `$ commandDisplay [+1] [spinner]`          |
| Done, collapsed | `done, 1.2s, 5 lines` or `exit 1, 3 lines` |
| Done, expanded  | Full output with dimmed lines              |

### edit

| State           | Display                             |
| --------------- | ----------------------------------- |
| In progress     | `<- edit ./relative/path [spinner]` |
| Done, collapsed | `+12 / -3` (additions / removals)   |
| Done, expanded  | Colored diff preview                |

### write

| State           | Display                              |
| --------------- | ------------------------------------ |
| In progress     | `<- write ./relative/path [spinner]` |
| Done, collapsed | `42 lines, written`                  |
| Error           | Error text shown                     |

## Dependencies

- `@earendil-works/pi-coding-agent` — `ExtensionAPI`, `createReadTool`, `createBashTool`, `createEditTool`, `createWriteTool`, `ReadToolDetails`, `BashToolDetails`, `EditToolDetails`
- `@earendil-works/pi-tui` — `Text`, `Container`

## Non-Goals

- Modifying LLM-visible tool output
- Adding a runtime toggle (`/compact` command)
- Covering `grep`, `find`, `ls`, or custom tools
- Per-project configuration

## Related Decisions

- ADR-0097: Pi Migration Partial Implementation — established the pi extension mechanism and auto-discovery paths

## References

- Original design spec (archived): `docs/archive/2026-04-29-compact-tools-extension-design.md`
- Original implementation plan (archived): `docs/archive/2026-04-29-compact-tools-extension.md`
- Reference extension copy: `docs/superpowers/extensions/compact-tools.ts`
- Live extension: `~/.pi/agent/extensions/compact-tools.ts`
