<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Compact Tools Extension Design

**Date:** 2026-04-29
**Status:** Approved

## Goal

Reduce TUI visual noise for the four chattiest built-in tools (`read`, `bash`, `edit`, `write`) by replacing their default renderers with compact summaries. LLM context is unaffected — the full tool output still reaches the model.

## Design Decisions

| Decision      | Choice                                   | Rationale                                                           |
| ------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| Scope         | `read`, `bash`, `edit`, `write` only     | These produce the most visual noise; `grep`, `find`, `ls` are terse |
| Placement     | Global (`~/.pi/agent/extensions/`)       | Applies across all projects, no per-project config needed           |
| Structure     | Single flat file                         | ~80 lines total, identical patterns per tool, trivial to modify     |
| Execution     | Delegate to originals via create\*Tool() | Zero risk of behavior regression                                    |
| LLM context   | Unchanged                                | Compact rendering is TUI-only; model receives full output           |
| Expandability | Built-in Ctrl+E support                  | Users can still view details on demand                              |
| Error display | Preserved                                | Exit codes, error text, and truncation warnings shown               |

## Tool-by-Tool Behavior

### read

| State               | Display                                             |
| ------------------- | --------------------------------------------------- |
| **In progress**     | `read path/to/file` (offset/limit shown if present) |
| **Done, collapsed** | `42 lines` (truncated warning if applicable)        |
| **Done, expanded**  | First 15 lines of content + `... 27 more lines`     |
| **Image**           | `Image loaded`                                      |
| **Error**           | Falls through to built-in error rendering           |

### bash

| State               | Display                                                     |
| ------------------- | ----------------------------------------------------------- |
| **In progress**     | `$ <command>` (truncated to 80 chars, timeout shown if set) |
| **Done, collapsed** | `done (5 lines)` or `exit 1 (3 lines)`                      |
| **Done, expanded**  | First 20 lines of output                                    |
| **Truncated**       | `[truncated]` suffix added to collapsed line                |

### edit

| State               | Display                                   |
| ------------------- | ----------------------------------------- |
| **In progress**     | `edit path/to/file`                       |
| **Done, collapsed** | `+12 / -3` (additions/removals from diff) |
| **Done, expanded**  | First 30 diff lines with +/- highlighting |
| **Error**           | Error text shown                          |
| Render shell        | `"self"` — tool owns its outer framing    |

### write

| State           | Display                         |
| --------------- | ------------------------------- |
| **In progress** | `write path/to/file (42 lines)` |
| **Done**        | `Written`                       |
| **Error**       | Error text shown                |

## Architecture

```
~/.pi/agent/extensions/compact-tools.ts
  ├─ import createReadTool, createBashTool, createEditTool, createWriteTool
  ├─ export default function(pi)
  │   ├─ pi.registerTool({ name: "read", ... })
  │   │   ├─ execute → originalRead.execute(...)
  │   │   ├─ renderCall → path + offset/limit
  │   │   └─ renderResult → line count | collapsed, first 15 lines | expanded
  │   ├─ pi.registerTool({ name: "bash", ... })
  │   │   ├─ execute → originalBash.execute(...)
  │   │   ├─ renderCall → truncated command
  │   │   └─ renderResult → exit code + line count | collapsed, first 20 lines | expanded
  │   ├─ pi.registerTool({ name: "edit", ... })
  │   │   ├─ execute → originalEdit.execute(...)
  │   │   ├─ renderCall → path
  │   │   └─ renderResult → diff stats | collapsed, diff lines | expanded
  │   └─ pi.registerTool({ name: "write", ... })
  │       ├─ execute → originalWrite.execute(...)
  │       ├─ renderCall → path + line count
  │       └─ renderResult → "Written" (or error)
```

## Dependencies

- `@mariozechner/pi-coding-agent` — `createReadTool`, `createBashTool`, `createEditTool`, `createWriteTool`, `ExtensionAPI`, `ReadToolDetails`, `BashToolDetails`, `EditToolDetails`
- `@mariozechner/pi-tui` — `Text`

## Non-Goals

- Modifying LLM context (tool output sent to model unchanged)
- Dynamic toggle (always compact; no `/compact` command needed)
- Covering `grep`, `find`, `ls`, or custom tools
- Per-project configuration
