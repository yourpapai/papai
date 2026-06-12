<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0164: Doc-Review Hook

## Status

Implemented

## Date

2026-05-28 – 2026-06-02

## Context

papai's `CLAUDE.md` and `README.md` files serve as the primary onboarding and
convention documents for agentic workers. When source code changes during a
session — new tools added, interfaces renamed, modules moved — these docs
frequently drift out of date. There was no mechanism to remind the agent that
documentation may need updating after code changes, leading to stale guidance
that caused incorrect tool use and wasted recovery effort.

The existing TDD hook pattern (`.hooks/tdd/`, `.claude/hooks/`,
`.opencode/plugins/`) already tracked session-scoped state for test enforcement.
A doc-review hook could follow the same architecture: shared pure business logic
in `.hooks/docs/`, platform-specific adapters for Claude Code and OpenCode.

The design spec (`docs/archive/2026-05-28-doc-review-hook-design.md`) and
implementation plan (`docs/archive/2026-05-28-doc-review-hook.md`) established
the scope: track source file writes during a session, and at session end,
suggest that the agent review relevant documentation files.

## Decision Drivers

- **Non-blocking suggestions**: The hook must suggest, not block, session
  completion. The agent decides whether docs need updating.
- **Once per session**: The suggestion fires once; repeated stop/idle events
  must not nag the agent.
- **Path-level tracking only**: No content diffing — only which files were
  written/edited, not what changed inside them.
- **Shared logic, dual adapters**: Pure functions in `.hooks/docs/`, thin
  adapters in `.claude/hooks/` and `.opencode/plugins/`.
- **Low overhead**: Hook execution must be fast (string building and file-path
  lookups only); no network calls or heavy computation.

## Considered Options

### Option A: Blocking gate — session cannot end until docs are confirmed updated

- **Pros**: Guarantees docs stay current.
- **Cons**: Overly coercive; many source changes don't require doc updates;
  blocks legitimate workflow completion.

### Option B: Non-blocking suggestion at session end (chosen)

- **Pros**: Agent retains autonomy; low friction; suggestion fires once then
  silences itself.
- **Cons**: Agent may ignore the suggestion; docs still drift.

### Option C: Per-commit doc lint check

- **Pros**: Catches drift at commit time, independent of session lifecycle.
- **Cons**: Requires a doc-lint rule engine that doesn't exist; would need to
  parse both code and docs to detect drift; far more complex than needed.

### Option D: Inline doc-review reminders during file writes

- **Pros**: Immediate feedback per write.
- **Cons**: Noisy; a single session may write many files before the full picture
  of doc impact is clear; would clutter the TDD hook's pre-write output.

## Decision

**Option B** — non-blocking suggestion at session end — with the following
subsidiary decisions:

| Topic               | Decision                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tracked directories | `src/`, `client/`, `plugins/`, `scripts/` — implementation code only. Config, test, and doc files are excluded.                                                    |
| Target docs         | Root `CLAUDE.md`, root `README.md`, and any nested `CLAUDE.md` found by walking up from the changed file's directory (e.g. `src/tools/CLAUDE.md`).                 |
| Doc directories     | Known directories with a `CLAUDE.md`: `src/tools`, `src/chat`, `src/providers`, `src/commands`, `src/instances`. Walk-up stops at the first match.                 |
| Session state       | Two new fields in `SessionStateData`: `changedSourceFiles: string[]` (deduped) and `docReviewSuggested: boolean`. Persisted via the existing session state module. |
| Claude Code adapter | Stop hook (`doc-review-stop.mjs`): exits 1 with `{ decision: "block", reason }` once; subsequent stops exit 0. Timeout: 200ms.                                     |
| OpenCode adapter    | Plugin (`doc-review.ts`): tracks writes in `tool.execute.after`, delivers suggestion via `client.session.promptAsync` in `session.idle`.                           |
| Deduplication       | `changedSourceFiles` stores each file path at most once regardless of how many times it was edited.                                                                |

## Consequences

### Positive

- Agents receive a timely reminder to review docs after code changes, reducing
  documentation drift without forcing updates.
- Once-per-session guarantee prevents nagging on repeated stop/idle events.
- Shared pure modules (`map-files-to-docs.mjs`, `build-doc-review-prompt.mjs`,
  `track-source-write.mjs`) are independently testable and reusable.
- Follows the established hook architecture, keeping adapter code thin and the
  platform integration consistent with the TDD hooks.

### Negative

- No guarantee that docs are actually updated; the suggestion can be ignored.
- Path-level tracking cannot detect when a change to a file outside its
  directory's `CLAUDE.md` scope requires a doc update elsewhere.
- The `DOCS_DIRS` list must be maintained manually when new nested `CLAUDE.md`
  files are added.

### Risks

- If the `DOCS_DIRS` list falls out of sync with the actual `CLAUDE.md`
  locations, the walk-up may miss relevant docs or produce stale suggestions.
- Mitigation: the root `CLAUDE.md` and `README.md` are always included as
  fallback targets when any source file changes.

## Implementation Notes

Key modules (`.hooks/docs/`):

| File                          | Role                                                       |
| ----------------------------- | ---------------------------------------------------------- |
| `track-source-write.mjs`      | Predicate: does a file path start with a tracked prefix?   |
| `map-files-to-docs.mjs`       | Pure function: changed paths → deduplicated doc paths      |
| `build-doc-review-prompt.mjs` | Pure function: changed files + doc paths → suggestion text |

Platform adapters:

| File                                | Role                                                       |
| ----------------------------------- | ---------------------------------------------------------- |
| `.claude/hooks/doc-review-stop.mjs` | Claude Code Stop hook; reads state, outputs block decision |
| `.opencode/plugins/doc-review.ts`   | OpenCode plugin; tracks writes, delivers idle suggestion   |

Modified files:

- `.hooks/tdd/session-state.mjs` — `changedSourceFiles` and `docReviewSuggested`
  fields with getter/setter methods.
- `.claude/settings.json` — `doc-review-stop.mjs` registered in Stop array.
- `opencode.json` — `doc-review.ts` registered in plugin array.
- `.claude/hooks/pre-tool-use.mjs` — dynamic import of `trackSourceWrite` for
  write tracking in the existing PreToolUse hook.
- `.opencode/plugins/tdd-enforcement.ts` — source file tracking alongside
  existing test-tracking in `tool.execute.after`.

## Related Decisions

- ADR-0123: Trusted-Local Plugin System — the plugin architecture pattern that
  the OpenCode adapter follows.
- Existing TDD hook architecture (`.hooks/tdd/`, `.claude/hooks/`,
  `.opencode/plugins/tdd-enforcement.ts`) — the doc-review hook extends this
  pattern with a second concern in the same session-state model.
