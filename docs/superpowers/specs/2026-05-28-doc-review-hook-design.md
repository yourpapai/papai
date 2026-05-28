<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Doc-Review Hook Design

A hook that tracks source code file changes during a session and, at session end, suggests the agent review whether CLAUDE.md and README.md files need updating.

## Goals

- Automatically detect when source files are added or updated during a session
- At session end, map changed files to their nearest relevant documentation
- Suggest the agent review and update docs if needed — non-blocking, agent can skip
- Work on both Claude Code and OpenCode platforms

## Scope

**Tracked directories:** `src/`, `client/`, `plugins/`, `scripts/`

**Target docs:** Root `CLAUDE.md`, root `README.md`, and any nested `CLAUDE.md` found by walking up from the changed file's directory.

**Out of scope:** Tracking non-source files (configs, tests, docs themselves), auto-updating docs without agent involvement, blocking session completion.

## Architecture

Follows the existing hook pattern: shared business logic in `.hooks/docs/`, platform-specific adapters in `.claude/hooks/` and `.opencode/plugins/`.

```
PreToolUse / tool.execute.after (file tracking)
  └─ writes changedSourceFiles to session state

Stop / session.idle (suggestion delivery)
  └─ reads session state
  └─ calls map-files-to-docs.mjs
  └─ calls build-doc-review-prompt.mjs
  └─ delivers suggestion to agent
```

## File Structure

```
.hooks/docs/
  map-files-to-docs.mjs       — pure function: changed paths → doc paths
  build-doc-review-prompt.mjs  — pure function: changed files + doc paths → prompt string

.claude/hooks/
  doc-review-stop.mjs          — Claude Code Stop hook adapter

.opencode/plugins/
  doc-review.ts                — OpenCode plugin adapter
```

**Modified files:**

- `.claude/settings.json` — register `doc-review-stop.mjs` in Stop array
- `opencode.json` — register `doc-review.ts` in plugin array
- `.hooks/tdd/session-state.mjs` — add `changedSourceFiles` and `docReviewSuggested` fields

## Component Details

### 1. File Tracking

**When:** Every Write/Edit/MultiEdit on a file whose relative path starts with `src/`, `client/`, `plugins/`, or `scripts/`.

**Where:** Stored in session state as `changedSourceFiles: string[]` (deduped — a file edited 5 times appears once).

**Tracking point:**

- **Claude Code:** In the existing `pre-tool-use.mjs` PreToolUse hook, alongside the TDD checks. Add a call to a new `trackSourceWrite` function that writes to session state.
- **OpenCode:** In the `tdd-enforcement.ts` plugin's `tool.execute.after` handler, alongside the existing test-tracking logic.

**Session state additions:**

```json
{
  "changedSourceFiles": ["src/tools/create-task.ts", "src/chat/router.ts", "client/debug/components/sidebar.tsx"],
  "docReviewSuggested": false
}
```

### 2. Doc Mapping (`map-files-to-docs.mjs`)

**Input:** `changedFiles: string[]` (relative paths)

**Output:** `string[]` (doc paths, deduplicated)

**Algorithm:**

1. For each changed file, walk up from its directory checking for `CLAUDE.md`. Stop at repo root.
2. Always include root `CLAUDE.md` and root `README.md` if any files changed.
3. Deduplicate the result.

**Examples:**

- `src/tools/create-task.ts` → `src/tools/CLAUDE.md`, `CLAUDE.md`, `README.md`
- `src/index.ts` → `CLAUDE.md`, `README.md` (no `src/CLAUDE.md` exists)
- `client/debug/components/sidebar.tsx` → `CLAUDE.md`, `README.md` (no nested CLAUDE.md in client/)

### 3. Prompt Builder (`build-doc-review-prompt.mjs`)

**Input:** `changedFiles: string[]`, `docPaths: string[]`

**Output:** Formatted suggestion string.

**Template:**

```
The following source files were changed this session:

- src/tools/create-task.ts (edited)
- src/chat/router.ts (written)

These documentation files may need updating to reflect the changes:

- CLAUDE.md (root)
- README.md
- src/tools/CLAUDE.md

Please review and update if needed. If no updates are required, you can ignore this.
```

### 4. Claude Code Adapter (`doc-review-stop.mjs`)

**Hook event:** Stop

**Logic:**

1. Read session state → get `changedSourceFiles`
2. If empty → exit 0 (nothing to suggest)
3. If `docReviewSuggested` is `true` → exit 0 (already suggested, don't nag)
4. Map files to affected docs via `map-files-to-docs.mjs`
5. Build suggestion prompt via `build-doc-review-prompt.mjs`
6. Set `docReviewSuggested = true` in session state
7. Exit code 1 + stdout `{ decision: "block", reason: "<suggestion prompt>" }`

**Behavior:** Agent gets the suggestion once. If it ignores it and stops again, the hook exits 0 and lets the session end.

**Timeout:** 200ms (lightweight — file lookups and string building only)

### 5. OpenCode Adapter (`doc-review.ts`)

**Hook events:** `tool.execute.after`, `session.idle`

**`tool.execute.after` — file tracking:**

1. Check if tool is Write/Edit/MultiEdit
2. Check if `output.args.filePath` starts with a tracked prefix
3. If yes, add relative path to `changedSourceFiles` in session state

**`session.idle` — suggestion delivery:**

1. Read session state → get `changedSourceFiles`
2. If empty → return
3. Map files to affected docs via `map-files-to-docs.mjs`
4. Build suggestion prompt via `build-doc-review-prompt.mjs`
5. `client.session.promptAsync(suggestionPrompt)` — non-blocking

## Registration

**`.claude/settings.json`** — add to Stop array:

```json
{
  "matcher": "",
  "hooks": [{ "type": "command", "command": "node .claude/hooks/doc-review-stop.mjs", "timeout": 200 }]
}
```

**`opencode.json`** — add to plugin array:

```json
"./.opencode/plugins/doc-review.ts"
```

## Session State Changes

Extend `.hooks/tdd/session-state.mjs` to persist two new fields:

- `changedSourceFiles: string[]` — paths of source files written/edited this session
- `docReviewSuggested: boolean` — whether the doc-review suggestion has been delivered

Both fields are read/written alongside existing fields like `writtenTests` and `needsRecheck`.

## Testing Strategy

**Unit tests:**

- `map-files-to-docs.mjs` — test path mapping with various input paths, verify deduplication, verify walk-up logic
- `build-doc-review-prompt.mjs` — test prompt formatting with sample inputs

**Integration tests:**

- Session state round-trip — write `changedSourceFiles`, read back, verify persistence
- Claude Code adapter — mock session state, verify exit code and stdout format
- OpenCode adapter — mock session state and `client.session.promptAsync`, verify call

## Non-Goals

- Auto-updating docs without agent involvement
- Tracking changes to non-source files (configs, tests, docs)
- Blocking session completion until docs are updated
- Diffing file contents — only path-level tracking
