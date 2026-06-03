<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Doc-Review Hook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a hook that tracks source code file changes during a session and suggests doc review at session end.

**Architecture:** Shared business logic in `.hooks/docs/`, platform-specific adapters in `.claude/hooks/` and `.opencode/plugins/`. Follows the existing TDD hook pattern: file tracking in pre/post hooks, suggestion delivery at session idle/stop.

**Tech Stack:** Bun, Node.js fs/path, TypeScript (OpenCode plugin), ES modules (Claude Code hooks)

---

## File Structure

| Action | File                                               | Purpose                                                  |
| ------ | -------------------------------------------------- | -------------------------------------------------------- |
| Create | `.hooks/docs/map-files-to-docs.mjs`                | Pure function: changed paths → doc paths                 |
| Create | `.hooks/docs/build-doc-review-prompt.mjs`          | Pure function: changed files + doc paths → prompt string |
| Create | `.hooks/docs/track-source-write.mjs`               | Side-effect: record source file writes in session state  |
| Create | `.claude/hooks/doc-review-stop.mjs`                | Claude Code Stop hook adapter                            |
| Create | `.opencode/plugins/doc-review.ts`                  | OpenCode plugin adapter                                  |
| Modify | `.hooks/tdd/session-state.mjs`                     | Add `changedSourceFiles` and `docReviewSuggested` fields |
| Modify | `.claude/settings.json`                            | Register doc-review-stop.mjs in Stop array               |
| Modify | `opencode.json`                                    | Register doc-review.ts in plugin array                   |
| Create | `tests/hooks/docs/map-files-to-docs.test.ts`       | Unit tests for path mapping                              |
| Create | `tests/hooks/docs/build-doc-review-prompt.test.ts` | Unit tests for prompt builder                            |
| Create | `tests/hooks/docs/track-source-write.test.ts`      | Unit tests for file tracking                             |

---

### Task 1: Extend Session State

**Files:**

- Modify: `.hooks/tdd/session-state.mjs`
- Test: `tests/hooks/docs/track-source-write.test.ts`

- [ ] **Step 1: Add `changedSourceFiles` and `docReviewSuggested` to session state**

Add two new fields to `SessionStateData` and corresponding getter/setter methods.

In `.hooks/tdd/session-state.mjs`, update the `SessionStateData` typedef:

```javascript
/**
 * @typedef {Object} SessionStateData
 * @property {string[]} writtenTests
 * @property {PendingFailure | null} pendingFailure
 * @property {Map<string, SurfaceSnapshot>} surfaceSnapshots
 * @property {Map<string, MutationSnapshot>} mutationSnapshots
 * @property {Record<string, Array<{ mutator: string; replacement: string; line?: number; description: string }>> | null} sessionMutationBaseline
 * @property {string[]} changedSourceFiles
 * @property {boolean} docReviewSuggested
 */
```

In `#createEmptyState`, add the new fields:

```javascript
#createEmptyState() {
  return {
    writtenTests: [],
    pendingFailure: null,
    surfaceSnapshots: new Map(),
    mutationSnapshots: new Map(),
    sessionMutationBaseline: null,
    needsRecheck: true,
    changedSourceFiles: [],
    docReviewSuggested: false,
  }
}
```

Add four new methods to `SessionState`:

```javascript
/**
 * @returns {string[]}
 */
getChangedSourceFiles() {
  this.#ensureLoaded()
  return this.#state.changedSourceFiles
}

/**
 * @param {string} filePath
 * @returns {void}
 */
addChangedSourceFile(filePath) {
  this.#ensureLoaded()
  if (!this.#state.changedSourceFiles.includes(filePath)) {
    this.#state.changedSourceFiles.push(filePath)
    this.#persist()
  }
}

/**
 * @returns {boolean}
 */
getDocReviewSuggested() {
  this.#ensureLoaded()
  return this.#state.docReviewSuggested
}

/**
 * @param {boolean} value
 * @returns {void}
 */
setDocReviewSuggested(value) {
  this.#ensureLoaded()
  this.#state.docReviewSuggested = value
  this.#persist()
}
```

- [ ] **Step 2: Verify session state changes work**

Run the existing test suite to confirm nothing breaks:

```bash
bun test
```

Expected: All existing tests pass.

- [ ] **Step 3: Commit**

```bash
git add .hooks/tdd/session-state.mjs
git commit -m "feat(hooks): add changedSourceFiles and docReviewSuggested to session state"
```

---

### Task 2: Doc Mapping Module

**Files:**

- Create: `.hooks/docs/map-files-to-docs.mjs`
- Test: `tests/hooks/docs/map-files-to-docs.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/hooks/docs/map-files-to-docs.test.ts
import { describe, expect, test } from 'bun:test'
import { mapFilesToDocs } from '../../.hooks/docs/map-files-to-docs.mjs'

describe('mapFilesToDocs', () => {
  test('returns empty array for empty input', () => {
    expect(mapFilesToDocs([])).toEqual([])
  })

  test('always includes root CLAUDE.md and README.md when files exist', () => {
    const result = mapFilesToDocs(['src/index.ts'])
    expect(result).toContain('CLAUDE.md')
    expect(result).toContain('README.md')
  })

  test('maps src/tools/ file to src/tools/CLAUDE.md', () => {
    const result = mapFilesToDocs(['src/tools/create-task.ts'])
    expect(result).toContain('src/tools/CLAUDE.md')
    expect(result).toContain('CLAUDE.md')
    expect(result).toContain('README.md')
  })

  test('maps src/chat/ file to src/chat/CLAUDE.md', () => {
    const result = mapFilesToDocs(['src/chat/router.ts'])
    expect(result).toContain('src/chat/CLAUDE.md')
  })

  test('maps src/providers/ file to src/providers/CLAUDE.md', () => {
    const result = mapFilesToDocs(['src/providers/kaneo.ts'])
    expect(result).toContain('src/providers/CLAUDE.md')
  })

  test('maps src/commands/ file to src/commands/CLAUDE.md', () => {
    const result = mapFilesToDocs(['src/commands/help.ts'])
    expect(result).toContain('src/commands/CLAUDE.md')
  })

  test('deduplicates docs when multiple files map to same doc', () => {
    const result = mapFilesToDocs(['src/tools/a.ts', 'src/tools/b.ts'])
    const toolClaudeCount = result.filter((d) => d === 'src/tools/CLAUDE.md').length
    expect(toolClaudeCount).toBe(1)
  })

  test('walks up directory tree when no CLAUDE.md in immediate parent', () => {
    // src/index.ts has no src/CLAUDE.md, so falls through to root
    const result = mapFilesToDocs(['src/index.ts'])
    expect(result).toContain('CLAUDE.md')
    expect(result).not.toContain('src/CLAUDE.md')
  })

  test('handles client/ files (no nested CLAUDE.md)', () => {
    const result = mapFilesToDocs(['client/debug/components/sidebar.tsx'])
    expect(result).toContain('CLAUDE.md')
    expect(result).toContain('README.md')
    // No nested CLAUDE.md in client/
    expect(result.filter((d) => d.includes('CLAUDE.md')).length).toBe(1)
  })

  test('handles plugins/ files', () => {
    const result = mapFilesToDocs(['plugins/hello-world/index.ts'])
    expect(result).toContain('CLAUDE.md')
    expect(result).toContain('README.md')
  })

  test('handles scripts/ files', () => {
    const result = mapFilesToDocs(['scripts/check.sh'])
    expect(result).toContain('CLAUDE.md')
    expect(result).toContain('README.md')
  })

  test('deduplicates across multiple directories', () => {
    const result = mapFilesToDocs(['src/tools/a.ts', 'client/debug/b.tsx'])
    const rootClaudeCount = result.filter((d) => d === 'CLAUDE.md').length
    expect(rootClaudeCount).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/hooks/docs/map-files-to-docs.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement map-files-to-docs.mjs**

```javascript
// .hooks/docs/map-files-to-docs.mjs
import fs from 'node:fs'
import path from 'node:path'

// Directories that have a CLAUDE.md file
const DOCS_DIRS = ['src/tools', 'src/chat', 'src/providers', 'src/commands', 'src/instances']

/**
 * Map changed source file paths to their nearest relevant documentation files.
 * @param {string[]} changedFiles - Relative paths of changed source files
 * @returns {string[]} Deduplicated list of doc file paths to review
 */
export function mapFilesToDocs(changedFiles) {
  if (changedFiles.length === 0) return []

  const docs = new Set()
  docs.add('CLAUDE.md')
  docs.add('README.md')

  for (const file of changedFiles) {
    const dir = path.dirname(file)
    // Walk up from file's directory looking for CLAUDE.md
    let current = dir
    while (current && current !== '.') {
      const candidate = path.join(current, 'CLAUDE.md')
      if (DOCS_DIRS.includes(current)) {
        docs.add(candidate)
        break
      }
      current = path.dirname(current)
    }
  }

  return [...docs]
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test tests/hooks/docs/map-files-to-docs.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add .hooks/docs/map-files-to-docs.mjs tests/hooks/docs/map-files-to-docs.test.ts
git commit -m "feat(hooks): add doc mapping module for source file changes"
```

---

### Task 3: Prompt Builder Module

**Files:**

- Create: `.hooks/docs/build-doc-review-prompt.mjs`
- Test: `tests/hooks/docs/build-doc-review-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/hooks/docs/build-doc-review-prompt.test.ts
import { describe, expect, test } from 'bun:test'
import { buildDocReviewPrompt } from '../../.hooks/docs/build-doc-review-prompt.mjs'

describe('buildDocReviewPrompt', () => {
  test('builds prompt with changed files and doc paths', () => {
    const changedFiles = ['src/tools/create-task.ts', 'src/chat/router.ts']
    const docPaths = ['CLAUDE.md', 'README.md', 'src/tools/CLAUDE.md']

    const result = buildDocReviewPrompt(changedFiles, docPaths)

    expect(result).toContain('source files were changed')
    expect(result).toContain('src/tools/create-task.ts')
    expect(result).toContain('src/chat/router.ts')
    expect(result).toContain('CLAUDE.md')
    expect(result).toContain('README.md')
    expect(result).toContain('src/tools/CLAUDE.md')
    expect(result).toContain('review and update')
  })

  test('lists changed files in bullet format', () => {
    const result = buildDocReviewPrompt(['src/a.ts'], ['CLAUDE.md'])
    expect(result).toContain('- src/a.ts')
  })

  test('lists doc paths in bullet format', () => {
    const result = buildDocReviewPrompt(['src/a.ts'], ['CLAUDE.md', 'README.md'])
    expect(result).toContain('- CLAUDE.md')
    expect(result).toContain('- README.md')
  })

  test('includes skip instruction', () => {
    const result = buildDocReviewPrompt(['src/a.ts'], ['CLAUDE.md'])
    expect(result).toContain('ignore this')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/hooks/docs/build-doc-review-prompt.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement build-doc-review-prompt.mjs**

```javascript
// .hooks/docs/build-doc-review-prompt.mjs

/**
 * Build a suggestion prompt for doc review after source file changes.
 * @param {string[]} changedFiles - Relative paths of changed source files
 * @param {string[]} docPaths - Doc file paths to suggest reviewing
 * @returns {string} Formatted suggestion prompt
 */
export function buildDocReviewPrompt(changedFiles, docPaths) {
  const fileList = changedFiles.map((f) => `- ${f}`).join('\n')
  const docList = docPaths.map((d) => `- ${d}`).join('\n')

  return [
    'The following source files were changed this session:',
    '',
    fileList,
    '',
    'These documentation files may need updating to reflect the changes:',
    '',
    docList,
    '',
    'Please review and update if needed. If no updates are required, you can ignore this.',
  ].join('\n')
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test tests/hooks/docs/build-doc-review-prompt.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add .hooks/docs/build-doc-review-prompt.mjs tests/hooks/docs/build-doc-review-prompt.test.ts
git commit -m "feat(hooks): add doc review prompt builder module"
```

---

### Task 4: Source File Tracking Module

**Files:**

- Create: `.hooks/docs/track-source-write.mjs`
- Test: `tests/hooks/docs/track-source-write.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/hooks/docs/track-source-write.test.ts
import { beforeEach, describe, expect, test } from 'bun:test'
import { trackSourceWrite, TRACKED_PREFIXES } from '../../.hooks/docs/track-source-write.mjs'

describe('trackSourceWrite', () => {
  test('exports TRACKED_PREFIXES', () => {
    expect(TRACKED_PREFIXES).toContain('src/')
    expect(TRACKED_PREFIXES).toContain('client/')
    expect(TRACKED_PREFIXES).toContain('plugins/')
    expect(TRACKED_PREFIXES).toContain('scripts/')
  })

  test('returns true for files in tracked directories', () => {
    expect(trackSourceWrite('src/tools/foo.ts')).toBe(true)
    expect(trackSourceWrite('client/debug/bar.tsx')).toBe(true)
    expect(trackSourceWrite('plugins/hello/index.ts')).toBe(true)
    expect(trackSourceWrite('scripts/check.sh')).toBe(true)
  })

  test('returns false for files outside tracked directories', () => {
    expect(trackSourceWrite('tests/foo.test.ts')).toBe(false)
    expect(trackSourceWrite('.claude/settings.json')).toBe(false)
    expect(trackSourceWrite('README.md')).toBe(false)
    expect(trackSourceWrite('.hooks/tdd/session-state.mjs')).toBe(false)
    expect(trackSourceWrite('docs/adr/0001.md')).toBe(false)
  })

  test('returns false for empty or null paths', () => {
    expect(trackSourceWrite('')).toBe(false)
    expect(trackSourceWrite(null)).toBe(false)
    expect(trackSourceWrite(undefined)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/hooks/docs/track-source-write.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement track-source-write.mjs**

```javascript
// .hooks/docs/track-source-write.mjs

/** @type {string[]} */
export const TRACKED_PREFIXES = ['src/', 'client/', 'plugins/', 'scripts/']

/**
 * Check if a file path should be tracked for doc review.
 * Returns true if the path starts with a tracked prefix.
 * @param {string | null | undefined} filePath - Relative file path
 * @returns {boolean}
 */
export function trackSourceWrite(filePath) {
  if (!filePath) return false
  return TRACKED_PREFIXES.some((prefix) => filePath.startsWith(prefix))
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test tests/hooks/docs/track-source-write.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add .hooks/docs/track-source-write.mjs tests/hooks/docs/track-source-write.test.ts
git commit -m "feat(hooks): add source file tracking predicate module"
```

---

### Task 5: Claude Code Stop Hook Adapter

**Files:**

- Create: `.claude/hooks/doc-review-stop.mjs`

- [ ] **Step 1: Implement doc-review-stop.mjs**

Follow the pattern from `.claude/hooks/stop.mjs`: read stdin JSON, use session state, output decision JSON.

```javascript
// .claude/hooks/doc-review-stop.mjs
import fs from 'node:fs'

import { buildDocReviewPrompt } from '../../.hooks/docs/build-doc-review-prompt.mjs'
import { mapFilesToDocs } from '../../.hooks/docs/map-files-to-docs.mjs'
import { getSessionsDir } from '../../.hooks/tdd/paths.mjs'
import { SessionState } from '../../.hooks/tdd/session-state.mjs'

try {
  const ctx = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'))
  const { session_id, cwd } = ctx

  const state = new SessionState(session_id, getSessionsDir(cwd))
  const changedFiles = state.getChangedSourceFiles()

  if (changedFiles.length === 0) {
    process.exit(0)
  }

  if (state.getDocReviewSuggested()) {
    process.exit(0)
  }

  const docPaths = mapFilesToDocs(changedFiles)
  const prompt = buildDocReviewPrompt(changedFiles, docPaths)

  state.setDocReviewSuggested(true)

  console.log(JSON.stringify({ decision: 'block', reason: prompt }))
  process.exit(1)
} catch (err) {
  console.error(
    JSON.stringify({
      level: 'error',
      msg: 'Doc review stop hook failed',
      error: err instanceof Error ? err.message : String(err),
    }),
  )
}

process.exit(0)
```

- [ ] **Step 2: Verify the hook file is syntactically valid**

```bash
node --check .claude/hooks/doc-review-stop.mjs
```

Expected: No output (syntax valid).

- [ ] **Step 3: Commit**

```bash
git add .claude/hooks/doc-review-stop.mjs
git commit -m "feat(hooks): add Claude Code doc-review stop hook"
```

---

### Task 6: OpenCode Plugin Adapter

**Files:**

- Create: `.opencode/plugins/doc-review.ts`

- [ ] **Step 1: Implement doc-review.ts**

Follow the pattern from `.opencode/plugins/tdd-enforcement.ts`: export a Plugin that returns hooks for `tool.execute.after` and `session.idle`.

```typescript
// .opencode/plugins/doc-review.ts
import type { Plugin } from '@opencode-ai/plugin'

import { buildDocReviewPrompt } from '../../.hooks/docs/build-doc-review-prompt.mjs'
import { mapFilesToDocs } from '../../.hooks/docs/map-files-to-docs.mjs'
import { trackSourceWrite } from '../../.hooks/docs/track-source-write.mjs'
import { getSessionsDir } from '../../.hooks/tdd/paths.mjs'
import { SessionState } from '../../.hooks/tdd/session-state.mjs'

const EDIT_TOOLS = new Set(['write', 'edit', 'multiedit'])

export const DocReview: Plugin = async ({ client, directory }) => {
  let currentSessionID = ''

  return {
    'tool.execute.after': async (input, output) => {
      currentSessionID = input.sessionID

      if (!EDIT_TOOLS.has(input.tool)) return

      const toolArgs = output.args as Record<string, unknown>
      const filePath = toolArgs['filePath'] as string
      if (!filePath) return

      if (!trackSourceWrite(filePath)) return

      const state = new SessionState(input.sessionID, getSessionsDir(directory))
      state.addChangedSourceFile(filePath)
    },

    'session.idle': async () => {
      const sessionID = currentSessionID
      if (!sessionID) return

      const state = new SessionState(sessionID, getSessionsDir(directory))
      const changedFiles = state.getChangedSourceFiles()

      if (changedFiles.length === 0) return

      const docPaths = mapFilesToDocs(changedFiles)
      const prompt = buildDocReviewPrompt(changedFiles, docPaths)

      void client.session.promptAsync({
        path: { id: sessionID },
        body: {
          parts: [{ type: 'text', text: prompt }],
        },
      })
    },
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
bun typecheck
```

Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add .opencode/plugins/doc-review.ts
git commit -m "feat(hooks): add OpenCode doc-review plugin"
```

---

### Task 7: Wire Up File Tracking in Existing Hooks

**Files:**

- Modify: `.claude/hooks/pre-tool-use.mjs`
- Modify: `.opencode/plugins/tdd-enforcement.ts`

- [ ] **Step 1: Add source file tracking to Claude Code pre-tool-use.mjs**

After the existing `state.setNeedsRecheck(true)` call (line 40), add source file tracking:

```javascript
// In .claude/hooks/pre-tool-use.mjs, after line 40:
const state = new SessionState(ctx.session_id, getSessionsDir(ctx.cwd))
state.setNeedsRecheck(true)

// Track source file changes for doc review
const filePath = ctx.tool_input?.file_path
if (filePath) {
  const { trackSourceWrite } = await import('../../.hooks/docs/track-source-write.mjs')
  if (trackSourceWrite(filePath)) {
    state.addChangedSourceFile(filePath)
  }
}
```

Note: Use dynamic `await import()` to avoid adding startup overhead when the feature isn't needed.

- [ ] **Step 2: Add source file tracking to OpenCode tdd-enforcement.ts**

In the `tool.execute.after` handler, after the existing `trackTestWrite(ctx)` call (line 98), add:

```typescript
// In .opencode/plugins/tdd-enforcement.ts, after line 98:
// Track source file changes for doc review
const { trackSourceWrite } = await import('../../.hooks/docs/track-source-write.mjs')
if (trackSourceWrite(filePath)) {
  const state = new SessionState(input.sessionID, getSessionsDir(directory))
  state.addChangedSourceFile(filePath)
}
```

- [ ] **Step 3: Verify both files are syntactically valid**

```bash
node --check .claude/hooks/pre-tool-use.mjs
bun typecheck
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add .claude/hooks/pre-tool-use.mjs .opencode/plugins/tdd-enforcement.ts
git commit -m "feat(hooks): wire up source file tracking in existing TDD hooks"
```

---

### Task 8: Register Hooks in Configuration

**Files:**

- Modify: `.claude/settings.json`
- Modify: `opencode.json`

- [ ] **Step 1: Register doc-review-stop.mjs in Claude Code settings**

Add a new entry to the `Stop` array in `.claude/settings.json`:

```json
{
  "matcher": "",
  "hooks": [
    {
      "type": "command",
      "command": "node .claude/hooks/doc-review-stop.mjs",
      "timeout": 200,
      "statusMessage": "Checking doc review..."
    }
  ]
}
```

The final Stop array should contain both the existing TDD stop hook and the new doc-review stop hook.

- [ ] **Step 2: Register doc-review.ts in OpenCode config**

Add the plugin path to the `plugin` array in `opencode.json`:

```json
"./.opencode/plugins/doc-review.ts"
```

- [ ] **Step 3: Verify config files are valid JSON**

```bash
node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8'))"
node -e "JSON.parse(require('fs').readFileSync('opencode.json','utf8'))"
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add .claude/settings.json opencode.json
git commit -m "feat(hooks): register doc-review hooks in configuration"
```

---

### Task 9: Full Integration Verification

- [ ] **Step 1: Run the full test suite**

```bash
bun test
```

Expected: All tests pass.

- [ ] **Step 2: Run typecheck**

```bash
bun typecheck
```

Expected: No type errors.

- [ ] **Step 3: Run lint**

```bash
bun lint
```

Expected: No lint errors.

- [ ] **Step 4: Verify hook file syntax**

```bash
node --check .claude/hooks/doc-review-stop.mjs
node --check .claude/hooks/pre-tool-use.mjs
node --check .hooks/docs/map-files-to-docs.mjs
node --check .hooks/docs/build-doc-review-prompt.mjs
node --check .hooks/docs/track-source-write.mjs
```

Expected: No output (all valid).

- [ ] **Step 5: Commit any fixes**

If any fixes were needed during verification, commit them.

```bash
git add -A && git commit -m "fix(hooks): address integration issues in doc-review hook"
```
