<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Silent PostToolUse + Stop-Gated Full Check

## Problem

PostToolUse hooks send detailed test failure output, coverage regression reports, and surface diffs back to the LLM on every file edit. This costs input tokens without proportional value — the LLM often fixes the issue on its own, or the same failure is reported multiple times as it iterates.

## Solution

Shift all quality enforcement to a single `Stop` hook that runs `bun check:full` once when the LLM finishes responding. PostToolUse becomes lightweight — it only performs fast static checks. A session-scoped `needsRecheck` flag coordinates the two hooks and provides an escape hatch for user interrupts.

## Changes

### PreToolUse (before Write/Edit/MultiEdit)

**Remove:**

- `getSessionBaseline` — coverage baseline capture no longer needed
- `snapshotSurface` — surface diff no longer needed

**Keep:**

- `enforce-write-policy` — blocks protected config edits and suppression comments
- `enforce-tdd` — blocks impl writes without a test file

**Add:**

- Set `needsRecheck = true` in session state

### PostToolUse (after Write/Edit/MultiEdit)

**Remove:**

- `verify-tests-pass` — no longer runs tests or checks coverage per-edit
- `verify-no-new-surface` — no longer diffs API surface per-edit

**Keep:**

- `track-test-write` — records test files written to session state (side-effect only)
- `verify-test-import` — blocks test files that don't import their impl module (fast static check)

### New Stop Hook

Registered as a `Stop` event hook in `.claude/settings.json`.

#### Session flag

`needsRecheck` — boolean stored in session state, defaults to `true`.

- **PreToolUse** sets `needsRecheck = true` — signals "LLM made changes, verify on next Stop"
- **Stop** reads the flag to decide behavior

#### Stop flow

1. Read `needsRecheck` from session state
2. If `false` → the LLM was already blocked with a failure prompt and did nothing since. This is a user interrupt. Clear the flag, allow stop.
3. If `true` → run `bun check:full`
4. If check passes → allow stop
5. If check fails → set `needsRecheck = false`, return `decision: "block"` with a concise failure summary

#### Escape hatch

The flag prevents infinite prompt loops. `needsRecheck` can only be `false` across two consecutive Stop events if no PreToolUse fired in between — which only happens on user interrupt. Any LLM activity (PreToolUse) resets it to `true`, enabling a fresh check on the next Stop.

#### Failure message format

Concise summary, not full output:

```
check:full found issues. Fix before stopping:

- lint: 3 errors (src/foo.ts, src/bar.ts, src/baz.ts)
- typecheck: 1 error (src/qux.ts)
- test: 2 failures (tests/foo.test.ts, tests/bar.test.ts)

Run `bun check:full` for details.
```

The hook parses the check output to extract file lists per category, grouped and deduplicated.

### Session state

Add a `needsRecheck` boolean field to the existing `SessionState` class (`.hooks/tdd/session-state.mjs`). No new files needed.

## Files to modify

| File                               | Change                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| `.claude/settings.json`            | Add `Stop` hook entry                                                              |
| `.claude/hooks/pre-tool-use.mjs`   | Remove `getSessionBaseline` and `snapshotSurface` calls; add `needsRecheck = true` |
| `.claude/hooks/post-tool-use.mjs`  | Remove `verifyTestsPass` and `verifyNoNewSurface` calls                            |
| `.hooks/tdd/session-state.mjs`     | Add `needsRecheck` field with getter/setter                                        |
| `.hooks/tdd/checks/check-full.mjs` | Parse output into concise failure summary for Stop hook                            |
| `.claude/hooks/stop.mjs`           | New file — Stop hook orchestrator                                                  |

## What stays the same

- PreToolUse `enforce-write-policy` and `enforce-tdd` behavior is unchanged
- PreToolUse `pre-bash.mjs` (git stash block) is unchanged
- PostToolUse `track-test-write` and `verify-test-import` behavior is unchanged
- All existing session state (written tests, surface snapshots, coverage baselines) remains available for other consumers; only the hook pipeline stops reading/writing certain fields
