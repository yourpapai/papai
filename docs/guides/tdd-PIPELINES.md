<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# TDD Hook Pipelines

How every `Write`, `Edit`, and `MultiEdit` call flows through the hook chain,
broken down by scenario.

---

## Architecture

Claude Code and OpenCode register **one hook per event**. Each hook is a thin orchestrator
(`.claude/hooks/pre-tool-use.mjs`, `.claude/hooks/post-tool-use.mjs` for Claude;
`.opencode/plugins/tdd-enforcement.ts` for OpenCode) that imports check functions
from `.hooks/tdd/checks/` and runs them **sequentially** with short-circuit logic.

```
settings.json (Claude) / OpenCode Plugin
  PreToolUse/tool.execute.before  ─┬─ [1] enforceTdd()
                                 ├─ [2] snapshotSurface()     ← skipped if [1] blocks
                                 └─ capture session baseline    ← coverage + mutation

  PostToolUse/tool.execute.after ─┬─ [4] trackTestWrite()
                                  ├─ [5] verifyTestsPass()
                                  └─ [6] verifyNoNewSurface()  ← skipped if [5] blocks

  SessionStop                    ── Session-level mutation verification
```

**Note:** Mutation testing ([3] `snapshotMutants` and [7] `verifyNoNewMutants`) has been
moved from **per-file** to **session-level**. Mutations are captured once at session start
and verified once at session stop, rather than on every edit. This significantly improves
performance (from ~180s per edit to ~600s once per session).

Every check function has a uniform contract:

```
Input:   ctx = { tool_name, tool_input, session_id, cwd }   (from stdin JSON)
Output:  { decision: 'block', reason: '...' } | null
```

Returning `null` means "pass". Side-effect-only checks ([2] and [4]) always return `null`.

### Short-circuit rules

**PreToolUse:** `[1]` runs first. If it returns a block, the orchestrator emits it
and exits immediately — `[2]` never executes. This avoids unnecessary work on writes
that will be rejected.

**PostToolUse:** `[4]` always runs (side-effect). `[5]` runs next. If it returns a
block (tests RED or coverage dropped), the orchestrator emits it and exits — `[6]`
never executes. If `[5]` passes, `[6]` runs to verify no new API surface was added.

### Fail-open guarantee

Every check function wraps its body in `try/catch` and returns `null` on error.
The orchestrators themselves also wrap everything in `try/catch` and `process.exit(0)`.
Double-layered: a crash in any check never blocks work.

### Gate condition

Checks [1], [2], [5], and [6] only activate for **gateable implementation files**
(`isGateableImplFile` in `test-resolver.mjs`):

- Path starts with `src/` (relative to `cwd`)
- Extension matches `*.ts`, `*.js`, `*.tsx`, `*.jsx`
- Is NOT a test file (`*.test.*` / `*.spec.*`)

Exception: `[5] verifyTestsPass` uses a broader guard (`IMPL_PATTERN`) — it runs
for **any** `.ts/.js/.tsx/.jsx` file (including test files), but only enforces
coverage regression for gateable impl files.

Check [4] activates only for test files (`*.test.*` / `*.spec.*`).

Session-level mutation testing runs independently and covers all `src/**/*.ts`
files (excluding `*.test.ts`).

### Notation

```
→  pass    check returns null, pipeline continues
✗  BLOCK   check returns { decision: 'block', reason: '...' }
⊘  skip    check returns null early (guard: wrong file type, file doesn't exist, etc.)
—  n/a     check never called (short-circuited by orchestrator)
snap       check writes a state snapshot to .hooks/sessions/ (always returns null)
base       session-level baseline captured (coverage, mutation)
```

---

## Scenario 1 — Non-gated file (docs, config, hooks)

Any file outside `src/`, or any non-TS/JS extension.

```
Tool: Write → CHANGELOG.md  (or bunfig.toml, .claude/hooks/foo.mjs, etc.)

PreToolUse:
  [1] enforceTdd        ⊘  isGateableImplFile → false
  [2] snapshotSurface   ⊘  isGateableImplFile → false

  File is written.

PostToolUse:
  [4] trackTestWrite    ⊘  isTestFile → false
  [5] verifyTestsPass   ⊘  IMPL_PATTERN → false (for .md/.toml)
                            or findTestFile → null (for .mjs outside src/)
  [6] verifyNoNewSurface  ⊘  isGateableImplFile → false
```

All checks exit early. No work done.

---

## Scenario 2 — New impl file, no test exists (TDD violation)

```
Tool: Write → src/foo/bar.ts  (file does not yet exist)

PreToolUse:
  [1] enforceTdd        ✗  BLOCK
        isGateableImplFile → true
        findTestFile → null  (no test on disk)
        session state → []   (no test written this session)
        → "No test file exists for `src/foo/bar.ts`.
           Write a failing test first: → tests/foo/bar.test.ts"
  [2]                   —  skipped (orchestrator short-circuits on [1] block)

  File is NOT written.

PostToolUse:
  (not reached — PreToolUse blocked the write)
```

---

## Scenario 3 — Red phase: writing the test first

```
Tool: Write → tests/foo/bar.test.ts  (new test, impl does not exist yet)

PreToolUse:
  [1] enforceTdd        ⊘  isTestFile → true
  [2] snapshotSurface   ⊘  isTestFile → true

  File is written.

PostToolUse:
  [4] trackTestWrite    →  isTestFile → true
                            saves abs path to .hooks/sessions/tdd-session-<id>.json
  [5] verifyTestsPass   ✗  BLOCK
        IMPL_PATTERN → true (.ts file)
        isTestFile → true, so testFile = the test itself
        bun test tests/foo/bar.test.ts → FAIL (impl missing, import error)
        → "Tests fail after writing `tests/foo/bar.test.ts`.
           Write the implementation to make this test pass."
  [6]                   —  skipped (orchestrator short-circuits on [5] block)
```

**Key design point:** The orchestrator runs `[4]` before `[5]`. So the test path is
already recorded in session state when `[5]` blocks. The block message is the Red phase
signal — the agent must now write the implementation. Because the test is registered,
the subsequent impl write (Scenario 4) passes `[1]`.

---

## Scenario 4 — Green phase: writing the impl after its test exists

```
Tool: Write → src/foo/bar.ts  (new file, test written in Scenario 3)

PreToolUse:
  [1] enforceTdd        →  findTestFile → tests/foo/bar.test.ts (exists on disk) → pass
  [2] snapshotSurface   ⊘  fs.existsSync(src/foo/bar.ts) → false (new file, nothing to snapshot)

  File is written.

PostToolUse:
  [4] trackTestWrite    ⊘  isTestFile → false
  [5] verifyTestsPass   →  findTestFile → tests/foo/bar.test.ts
                            bun test tests/foo/bar.test.ts → PASS
                            coverage check: baselineCov[src/foo/bar.ts] → undefined
                            (file is new, not in session baseline) → skip → pass
  [6] verifyNoNewSurface  ⊘  no snapshot file (new file, [2] wrote nothing) → pass
```

**Session state fallback in `[1]`:** If `findTestFile` returns null (timing edge case
where the test file is not yet on disk), `enforceTdd` falls back to checking
`FileSessionState.getWrittenTests()` for a test path that maps to this impl file.

---

## Scenario 5 — Editing an existing impl (clean refactor or bugfix)

```
Tool: Edit → src/foo/bar.ts  (file exists, tests/foo/bar.test.ts exists)

PreToolUse:
  [1] enforceTdd        →  findTestFile → tests/foo/bar.test.ts → pass
  [2] snapshotSurface   snap
        extractSurface(src/foo/bar.ts) → { exports: [...], signatures: {...} }
        getCoverage(testFile, implFile) → { covered: N, total: M }
        writes .hooks/sessions/tdd-snapshot-<id>-<key>.json

  File is written.

PostToolUse:
  [4] trackTestWrite    ⊘  not a test file
  [5] verifyTestsPass   →  bun test tests/foo/bar.test.ts → PASS
                             getSessionBaseline → cached or first-run (full suite, 120s)
                             getCoverage → currentPct >= baselinePct → pass
  [6] verifyNoNewSurface  →  loads tdd-snapshot-<id>-<key>.json
                               extractSurface on modified file
                               ① no new exports → pass
                               ② no signature expansions → pass
                               ③ uncoveredAfter <= uncoveredBefore → pass
```

This is the happy path: all checks run, all pass.

---

## Scenario 6 — Edit breaks existing tests

```
Tool: Edit → src/foo/bar.ts

PreToolUse:  same as Scenario 5 (snapshots taken)

PostToolUse:
  [4] trackTestWrite    ⊘
  [5] verifyTestsPass   ✗  BLOCK
        bun test tests/foo/bar.test.ts → FAIL
        → "Tests fail after editing `src/foo/bar.ts`.
           ── Test output ──────────────────────────────
           <up to 3000 chars of bun output>
           ─────────────────────────────────────────────
           Fix the code to make the tests pass."
  [6]                   —  skipped (orchestrator short-circuits on RED)
```

Surface check is skipped — no point analyzing a broken state.

---

## Scenario 7 — Refactor adds a new export without a test

```
Tool: Edit → src/foo/bar.ts
  adds: export function newHelper(a, b) { ... }

PreToolUse:  snapshots taken (surface before = { exports: ["existingFn"] })

PostToolUse:
  [4] ⊘
  [5] verifyTestsPass   →  tests pass (existing tests unaffected)
                             coverage may or may not drop vs session baseline
                             (see branching below)
```

**Branch A — `[5]` passes (coverage unchanged or no baseline):**

```
  [6] verifyNoNewSurface  ✗  BLOCK
        after.exports = ["existingFn", "newHelper"]
        newExports = ["newHelper"]
        → "New untested API surface in `src/foo/bar.ts`:
           1. New exports: `newHelper`. ..."
```

**Branch B — `[5]` blocks on coverage drop:**

```
  [5] verifyTestsPass   ✗  BLOCK (coverage)
        → "Line coverage dropped for `src/foo/bar.ts`. ..."
  [6]                    —  skipped
```

---

## Scenario 8 — Refactor expands a function signature

```
Tool: Edit → src/foo/bar.ts
  changes: function process(input)  →  function process(input, options)

PreToolUse:  snapshots taken (signatures["process"] = 1)

PostToolUse:
  [4] ⊘
  [5] verifyTestsPass     →  tests pass, coverage unchanged → pass
  [6] verifyNoNewSurface  ✗  BLOCK
        after.signatures["process"] = 2 > before = 1
        → "New untested API surface in `src/foo/bar.ts`:
           1. `process`: parameter count increased (1 → 2).
              Write tests for the new parameter(s)."
```

Only `[6]` blocks. The orchestrator emits `surfaceResult`.

---

## Scenario 9 — Coverage drops below session baseline

```
Tool: Edit → src/foo/bar.ts
  adds an uncovered branch inside an existing function

PreToolUse:  snapshots taken

PostToolUse:
  [4] ⊘
  [5] verifyTestsPass     ✗  BLOCK (coverage check)
        session baseline: 45/50 lines = 90.0%
        current:          45/55 lines = 81.8%
        currentPct < baselinePct
        → "Line coverage dropped for `src/foo/bar.ts`.
           Before: 90.0% (45/50 lines)
           After:  81.8% (45/55 lines), −8.2pp
           Add tests to cover the new code paths."
  [6]                     —  skipped (orchestrator short-circuits)
```

**Two distinct coverage checks exist:**

| Check                    | Baseline                                                                                                               | Scope                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `[5]` verifyTestsPass    | Session baseline — full-suite coverage captured **once per session** (cached 24h in `tdd-coverage-baseline-<id>.json`) | Compares `covered/total` ratio for this file               |
| `[6]` verifyNoNewSurface | Per-edit snapshot — coverage captured by `[2]` **moments before this edit** (in `tdd-snapshot-<id>-<key>.json`)        | Counts `total − covered` (uncovered lines) before vs after |

Because the orchestrator short-circuits on `[5]`, `[6]`'s coverage check only fires when
`[5]` passes. This can happen: `[5]` passes (session baseline was already low for this file)
but `[6]` blocks (more uncovered lines than the pre-edit snapshot had).

---

## Scenario 10 — Mutation testing disabled (`TDD_MUTATION=0`)

```
Tool: Edit → src/foo/bar.ts

PreToolUse:
  [1] enforceTdd        →  pass (test exists)
  [2] snapshotSurface   snap  (surface + coverage — unaffected by TDD_MUTATION)

PostToolUse:
  [4] trackTestWrite    ⊘
  [5] verifyTestsPass   →  runs normally
  [6] verifyNoNewSurface  →  runs normally (surface + coverage diff still active)

SessionStop:
  (mutation verification skipped when TDD_MUTATION=0)
```

When `TDD_MUTATION=0`, session-level mutation testing is bypassed entirely. The surface +
coverage checks (`[2]` and `[6]`) still enforce refactor purity.

---

## Scenario 11 — Editing a test file (adding or fixing tests)

```
Tool: Edit → tests/foo/bar.test.ts

PreToolUse:
  [1] enforceTdd        ⊘  isTestFile → true
  [2] snapshotSurface   ⊘  isTestFile → true

  File is written.

PostToolUse:
  [4] trackTestWrite    →  isTestFile → true → saves abs path to session state
  [5] verifyTestsPass   →  IMPL_PATTERN → true (.ts file)
                            isTestFile → true, so testFile = itself
                            bun test tests/foo/bar.test.ts
                            PASS → pass  /  FAIL → BLOCK
  [6] verifyNoNewSurface  ⊘  isTestFile → true (if [5] passed)
```

If the test fails after the edit, `[5]` blocks and `[6]` is skipped (though
it would have returned null anyway since test files bypass its guard).

---

## Scenario 12 — Session Stop: Mutation verification

At the end of the session, mutation testing runs on the entire `src/` directory
to detect any untested code paths introduced during the session.

```
Session: End of session

SessionStop:
  captureSessionMutationBaseline (runs on first PreToolUse)
    → Runs Stryker on all src/**/*.ts files
    → Writes baseline: tdd-session-mutation-baseline-<id>.json
    → Stores all surviving mutants at session start

  verifySessionMutationBaseline (runs on SessionStop)
    → Runs Stryker on all src/**/*.ts files again
    → Compares final survivors against baseline
    → New survivors = code paths added without tests
    → If newSurvivors.length > 0: reports violations to stderr
```

**Performance characteristics:**

- Session start: ~10 minutes for full src/ mutation testing
- Session end: ~10 minutes for verification
- Per-edit overhead: 0 (mutation testing runs only at session boundaries)

The session-level approach runs mutation testing once per session, rather than on every
edit, providing significant performance improvements for sessions with multiple edits.

---

## Summary Table

| Scenario                            | [1] | [2]  | [4]     | [5]    | [6]   |
| ----------------------------------- | --- | ---- | ------- | ------ | ----- |
| Non-gated file                      | ⊘   | ⊘    | ⊘       | ⊘      | ⊘     |
| New impl, no test                   | ✗   | —    | —       | —      | —     |
| Write test (Red)                    | ⊘   | ⊘    | → saves | ✗ RED  | —     |
| Write impl (Green)                  | →   | ⊘    | ⊘       | →      | ⊘     |
| Edit impl, clean                    | →   | snap | ⊘       | →      | →     |
| Edit impl, breaks tests             | →   | snap | ⊘       | ✗ RED  | —     |
| Edit impl, new export (no cov drop) | →   | snap | ⊘       | →      | ✗ API |
| Edit impl, new export (cov drop)    | →   | snap | ⊘       | ✗ cov  | —     |
| Edit impl, sig expansion            | →   | snap | ⊘       | →      | ✗ sig |
| Edit impl, coverage drop            | →   | snap | ⊘       | ✗ cov  | —     |
| `TDD_MUTATION=0`                    | →   | snap | ⊘       | →      | →     |
| Edit test file                      | ⊘   | ⊘    | → saves | → or ✗ | ⊘     |

**Note:** Mutation testing runs at **session-level** (Session Stop). See Scenario 12.

---

## File Layout

```
.claude/hooks/
  pre-tool-use.mjs           ← PreToolUse orchestrator (registered in settings.json)
  post-tool-use.mjs          ← PostToolUse orchestrator (registered in settings.json)
  session-stop.mjs           ← SessionStop orchestrator (runs mutation verification)

.opencode/plugins/
  tdd-enforcement.ts         ← OpenCode plugin implementing same checks

.hooks/tdd/
  checks/
    enforce-tdd.mjs           [1] enforceTdd()
    snapshot-surface.mjs       [2] snapshotSurface()
    track-test-write.mjs       [4] trackTestWrite()
    verify-tests-pass.mjs      [5] verifyTestsPass()
    verify-no-new-surface.mjs  [6] verifyNoNewSurface()
  mutation.mjs                shared Stryker utilities (extractSurvivors, buildStrykerConfig)
  test-resolver.mjs           isTestFile, isGateableImplFile, findTestFile, suggestTestPath
  session-state.mjs           FileSessionState, MemorySessionState
  session-mutation.mjs        Session-level mutation testing (captureSessionMutationBaseline, verifySessionMutationBaseline)
  test-runner.mjs             runTest()
  surface-extractor.mjs       extractSurface()
  coverage.mjs                getCoverage()
  coverage-session.mjs        getSessionBaseline()

.hooks/sessions/              ← gitignored, created on demand
  tdd-session-<id>.json                    Session state (written tests)
  tdd-snapshot-<id>-<key>.json             Per-file surface+coverage snapshots
  tdd-coverage-baseline-<id>.json          Session-level coverage baseline (24h TTL)
  tdd-session-mutation-baseline-<id>.json  Session-level mutation baseline
  stryker-session-<id>-{baseline,final}.json  Session mutation reports
  stryker-config-<id>-*.json               Temporary Stryker configs
```

---

## State Files

All session files are stored in `.hooks/sessions/` (gitignored) and keyed by `session_id`
supplied by Claude Code in the hook stdin payload. Created on demand via
`fs.mkdirSync(sessionsDir, { recursive: true })`.

| File                                         | Written by                       | Read by                         | TTL      |
| -------------------------------------------- | -------------------------------- | ------------------------------- | -------- |
| `tdd-session-<id>.json`                      | `[4]` trackTestWrite             | `[1]` enforceTdd                | 1 week   |
| `tdd-snapshot-<id>-<key>.json`               | `[2]` snapshotSurface            | `[6]` verifyNoNewSurface        | session  |
| `tdd-coverage-baseline-<id>.json`            | `getSessionBaseline` (lazy)      | `[5]` verifyTestsPass           | 24 hours |
| `tdd-session-mutation-baseline-<id>.json`    | `captureSessionMutationBaseline` | `verifySessionMutationBaseline` | session  |
| `stryker-session-<id>-{baseline,final}.json` | Stryker CLI                      | `session-mutation.mjs`          | session  |
| `stryker-config-<id>-*.json`                 | `session-mutation.mjs`           | Stryker CLI                     | session  |

The `<key>` suffix is derived from the absolute file path with `/` and `.` replaced by `_`,
making it deterministic and collision-free per file per session.

---

## OpenCode Plugin

The same TDD enforcement pipeline is available for OpenCode via `.opencode/plugins/tdd-enforcement.ts`.

### Differences from Claude Hooks

| Aspect                | Claude Code                                    | OpenCode                              |
| --------------------- | ---------------------------------------------- | ------------------------------------- |
| **Hook mechanism**    | `settings.json` → `.mjs` scripts               | TypeScript plugin with event handlers |
| **Pre-tool hook**     | `PreToolUse` event                             | `tool.execute.before` event           |
| **Post-tool hook**    | `PostToolUse` event                            | `tool.execute.after` event            |
| **Session stop**      | `Stop` event                                   | `session.stop` event                  |
| **Context shape**     | `{ tool_name, tool_input, session_id, cwd }`   | `{ tool, args, sessionID }`           |
| **Error handling**    | `process.exit(0)` on pass, JSON block response | Throws `Error` with reason message    |
| **Coverage baseline** | ✅ Captured in PreToolUse                      | ✅ Captured in tool.execute.before    |

### OpenCode Plugin Structure

```typescript
// .opencode/plugins/tdd-enforcement.ts
export const TddEnforcement: Plugin = async ({ directory }) => {
  return {
    'session.stop': (input) => {
      verifySessionMutationBaseline({ session_id: input.sessionID, cwd: directory })
    },

    'tool.execute.before': async (input, output) => {
      // Capture baselines before first edit
      getSessionBaseline(input.sessionID, directory)
      captureSessionMutationBaseline({ session_id: input.sessionID, cwd: directory })

      // [1] enforceTdd and [2] snapshotSurface
    },

    'tool.execute.after': async (input) => {
      // [4] trackTestWrite, [5] verifyTestsPass, [6] verifyNoNewSurface
    },
  }
}
```

### Known OpenCode Differences

1. **No stdin/stdout**: OpenCode plugins receive context directly rather than via stdin,
   making the check functions' contract slightly different.
