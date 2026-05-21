<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Client Build Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move debug dashboard UI to a `client/` directory with a proper Bun.build() step, happy-dom client tests, and adapted TDD hooks/CI.

**Architecture:** Client source in `client/debug/`, built to `public/` via `scripts/build-client.ts`. Server serves static files from `public/`. TDD hooks extended to recognize `client/` as a second source root. CI gets a dedicated build job.

**Tech Stack:** Bun.build() (IIFE), happy-dom (devDependency), existing Bun test runner.

**Design doc:** `docs/plans/2026-04-06-client-build-pipeline-design.md`

---

## File Inventory

### Client source files to create in `client/debug/`

| New path                          | Origin                                     | Notes                                                 |
| --------------------------------- | ------------------------------------------ | ----------------------------------------------------- |
| `client/debug/index.ts`           | NEW                                        | Single entry point — imports all modules in order     |
| `client/debug/dashboard-api.ts`   | `src/debug/dashboard-ui/index.ts`          | Renamed to avoid clash with index.ts entry point      |
| `client/debug/helpers.ts`         | `src/debug/dashboard-ui/helpers.ts`        |                                                       |
| `client/debug/logs.ts`            | `src/debug/dashboard-ui/logs.ts`           |                                                       |
| `client/debug/trace-detail.ts`    | `src/debug/dashboard-ui/trace-detail.ts`   |                                                       |
| `client/debug/session-detail.ts`  | `src/debug/dashboard-ui/session-detail.ts` |                                                       |
| `client/debug/session-card.ts`    | `src/debug/dashboard-ui/session-card.ts`   |                                                       |
| `client/debug/log-detail.ts`      | `src/debug/dashboard-ui/log-detail.ts`     |                                                       |
| `client/debug/types.ts`           | `src/debug/dashboard-ui/types.ts`          |                                                       |
| `client/debug/state.ts`           | `src/debug/dashboard/state.ts`             |                                                       |
| `client/debug/handlers.ts`        | `src/debug/dashboard/handlers.ts`          |                                                       |
| `client/debug/sse.ts`             | `src/debug/dashboard/sse.ts`               |                                                       |
| `client/debug/search.ts`          | `src/debug/dashboard/search.ts`            |                                                       |
| `client/debug/init.ts`            | `src/debug/dashboard/init.ts`              |                                                       |
| `client/debug/tree-view.ts`       | `src/debug/dashboard/tree-view.ts`         |                                                       |
| `client/debug/logs-bootstrap.ts`  | `src/debug/dashboard/logs.ts`              | Renamed to avoid name clash with dashboard-ui/logs.ts |
| `client/debug/dashboard-types.ts` | `src/debug/dashboard-types.ts`             |                                                       |
| `client/debug/dashboard.html`     | `src/debug/dashboard.html`                 | Updated: single script tag, no inline script          |
| `client/debug/dashboard.css`      | `src/debug/dashboard.css`                  | Unchanged content                                     |

### Client test files to create in `tests/client/debug/`

| New path                                     | Origin                                            |
| -------------------------------------------- | ------------------------------------------------- |
| `tests/client/debug/dashboard-api.test.ts`   | `tests/debug/dashboard-ui/index.test.ts`          |
| `tests/client/debug/helpers.test.ts`         | `tests/debug/dashboard-ui/helpers.test.ts`        |
| `tests/client/debug/logs.test.ts`            | `tests/debug/dashboard-ui/logs.test.ts`           |
| `tests/client/debug/trace-detail.test.ts`    | `tests/debug/dashboard-ui/trace-detail.test.ts`   |
| `tests/client/debug/session-detail.test.ts`  | `tests/debug/dashboard-ui/session-detail.test.ts` |
| `tests/client/debug/session-card.test.ts`    | `tests/debug/dashboard-ui/session-card.test.ts`   |
| `tests/client/debug/log-detail.test.ts`      | `tests/debug/dashboard-ui/log-detail.test.ts`     |
| `tests/client/debug/types.test.ts`           | `tests/debug/dashboard-ui/types.test.ts`          |
| `tests/client/debug/search.test.ts`          | `tests/debug/dashboard/search.test.ts`            |
| `tests/client/debug/tree-view.test.ts`       | `tests/debug/dashboard/tree-view.test.ts`         |
| `tests/client/debug/dashboard-types.test.ts` | `tests/debug/dashboard-types.test.ts`             |

### Files to create (new)

- `scripts/build-client.ts` — build script
- `tests/client-setup.ts` — happy-dom preload

### Files to modify

- `.hooks/tdd/test-resolver.mjs` — recognize `client/` as source root
- `src/debug/server.ts` — serve from `public/`, remove transpilation
- `package.json` — new scripts, happy-dom dep
- `bunfig.toml` — exclude `tests/client/**`
- `.gitignore` — add `public/`
- `.github/workflows/ci.yml` — add build job
- `Dockerfile` — add build stage
- `knip.jsonc` — add `client/` to project scope
- `scripts/check.sh` — add `test:client` to full check pipeline
- `tests/debug/dashboard-smoke.test.ts` — adapt for single bundle + static serving

### Files to delete

- `src/debug/dashboard-ui/` (entire directory)
- `src/debug/dashboard/` (entire directory)
- `src/debug/dashboard-types.ts`
- `src/debug/dashboard.html`
- `src/debug/dashboard.css`
- `tests/debug/dashboard-ui/` (entire directory)
- `tests/debug/dashboard/` (entire directory)
- `tests/debug/dashboard-types.test.ts`
- `tests/debug/dashboard-ui.test.ts` (source introspection test, no longer relevant)
- `tests/debug/fuse-search.test.ts` (if it tests `dashboard/search.ts` — move or delete)
- `tests/debug/snapshots.test.ts` (if it tests client render output — move or delete)

---

## Task 1: Add happy-dom and update .gitignore

**Files:**

- Modify: `.gitignore`
- Modify: `package.json` (via bun add)

**Step 1: Add happy-dom as devDependency**

Run: `bun add -d happy-dom`

**Step 2: Add `public/` to .gitignore**

Append to `.gitignore`:

```
# Client build output
public/
```

**Step 3: Verify**

Run: `git diff .gitignore` and `grep happy-dom package.json`

**Step 4: Commit**

```bash
git add .gitignore package.json bun.lock
git commit -m "chore: add happy-dom and gitignore public/"
```

---

## Task 2: Create build script with test

**Files:**

- Create: `tests/scripts/build-client.test.ts`
- Create: `scripts/build-client.ts`

**Step 1: Write the failing test**

Create `tests/scripts/build-client.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

const PUBLIC_DIR = path.resolve(import.meta.dir, '../../public')

describe('build-client', () => {
  beforeAll(async () => {
    // Clean output dir
    if (fs.existsSync(PUBLIC_DIR)) {
      fs.rmSync(PUBLIC_DIR, { recursive: true })
    }

    // Run the build script
    const proc = Bun.spawnSync(['bun', 'scripts/build-client.ts'], {
      cwd: path.resolve(import.meta.dir, '../..'),
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    if (proc.exitCode !== 0) {
      throw new Error(`Build failed: ${proc.stderr.toString()}`)
    }
  })

  afterAll(() => {
    // Clean up
    if (fs.existsSync(PUBLIC_DIR)) {
      fs.rmSync(PUBLIC_DIR, { recursive: true })
    }
  })

  test('creates public/ directory', () => {
    expect(fs.existsSync(PUBLIC_DIR)).toBe(true)
  })

  test('outputs dashboard.js as IIFE', () => {
    const jsPath = path.join(PUBLIC_DIR, 'dashboard.js')
    expect(fs.existsSync(jsPath)).toBe(true)
    const content = fs.readFileSync(jsPath, 'utf8')
    expect(content.length).toBeGreaterThan(0)
    // IIFE format: starts with ( or !
    expect(content.startsWith('(') || content.startsWith('!')).toBe(true)
    // No ES module syntax
    expect(content).not.toContain('export *')
    expect(content).not.toContain('export {')
    expect(content).not.toMatch(/^import /m)
  })

  test('copies dashboard.html', () => {
    const htmlPath = path.join(PUBLIC_DIR, 'dashboard.html')
    expect(fs.existsSync(htmlPath)).toBe(true)
    const content = fs.readFileSync(htmlPath, 'utf8')
    expect(content).toContain('<!doctype html>')
    expect(content).toContain('dashboard.js')
    // Single script reference (not dashboard-ui.js + dashboard-state.js)
    expect(content).not.toContain('dashboard-ui.js')
    expect(content).not.toContain('dashboard-state.js')
  })

  test('copies dashboard.css', () => {
    const cssPath = path.join(PUBLIC_DIR, 'dashboard.css')
    expect(fs.existsSync(cssPath)).toBe(true)
    const content = fs.readFileSync(cssPath, 'utf8')
    expect(content).toContain('{')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/scripts/build-client.test.ts`
Expected: FAIL — `scripts/build-client.ts` does not exist.

**Step 3: Write minimal build script**

Create `scripts/build-client.ts`:

```typescript
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')
const CLIENT_DIR = path.join(ROOT, 'client', 'debug')
const PUBLIC_DIR = path.join(ROOT, 'public')

async function build(): Promise<void> {
  // Ensure output directory exists
  fs.mkdirSync(PUBLIC_DIR, { recursive: true })

  // Build client JS bundle
  const result = await Bun.build({
    entrypoints: [path.join(CLIENT_DIR, 'index.ts')],
    outdir: PUBLIC_DIR,
    format: 'iife',
    naming: 'dashboard.js',
  })

  if (!result.success) {
    for (const log of result.logs) {
      console.error(log)
    }
    process.exit(1)
  }

  // Verify output is non-empty
  const jsOutput = path.join(PUBLIC_DIR, 'dashboard.js')
  const stat = fs.statSync(jsOutput)
  if (stat.size === 0) {
    console.error('Build produced empty dashboard.js')
    process.exit(1)
  }

  // Copy static assets
  fs.copyFileSync(path.join(CLIENT_DIR, 'dashboard.html'), path.join(PUBLIC_DIR, 'dashboard.html'))
  fs.copyFileSync(path.join(CLIENT_DIR, 'dashboard.css'), path.join(PUBLIC_DIR, 'dashboard.css'))

  console.log(`Build complete: ${PUBLIC_DIR}`)
}

await build()
```

Note: this test will still fail because `client/debug/index.ts` doesn't exist yet. That's expected — the build script is correct but needs source files. The test will pass after Task 4.

**Step 4: Commit**

```bash
git add scripts/build-client.ts tests/scripts/build-client.test.ts
git commit -m "feat: add client build script and test"
```

---

## Task 3: Update TDD hooks for client/ support

The `.hooks/tdd/test-resolver.mjs` functions need to recognize `client/` alongside `src/`. Both Claude Code hooks (`.claude/hooks/`) and opencode plugin (`.opencode/plugins/tdd-enforcement.ts`) delegate to these functions, so a single change fixes both.

**Files:**

- Modify: `.hooks/tdd/test-resolver.mjs`

**Step 1: Update `isGateableImplFile()`**

In `.hooks/tdd/test-resolver.mjs`, change the path check in `isGateableImplFile`:

```javascript
// Before:
if (!rel.startsWith('src/') && !rel.startsWith('src\\')) return false

// After:
const isSrc = rel.startsWith('src/') || rel.startsWith('src\\')
const isClient = rel.startsWith('client/') || rel.startsWith('client\\')
if (!isSrc && !isClient) return false
```

**Step 2: Update `suggestTestPath()`**

```javascript
// Before:
export function suggestTestPath(implRelPath) {
  const withoutSrc = implRelPath.replace(/^src[/\\]/, '')
  const ext = path.extname(withoutSrc)
  const base = withoutSrc.slice(0, -ext.length)
  return path.join('tests', `${base}.test${ext}`)
}

// After:
export function suggestTestPath(implRelPath) {
  // client/debug/helpers.ts → tests/client/debug/helpers.test.ts (keep client/ prefix)
  if (implRelPath.startsWith('client/') || implRelPath.startsWith('client\\')) {
    const ext = path.extname(implRelPath)
    const base = implRelPath.slice(0, -ext.length)
    return path.join('tests', `${base}.test${ext}`)
  }
  // src/foo/bar.ts → tests/foo/bar.test.ts (strip src/ prefix)
  const withoutSrc = implRelPath.replace(/^src[/\\]/, '')
  const ext = path.extname(withoutSrc)
  const base = withoutSrc.slice(0, -ext.length)
  return path.join('tests', `${base}.test${ext}`)
}
```

**Step 3: Update `findTestFile()`**

Add a new block before the existing `src/` block:

```javascript
export function findTestFile(implAbsPath, projectRoot) {
  const rel = path.relative(projectRoot, implAbsPath)

  // Client files: client/debug/helpers.ts → tests/client/debug/helpers.test.ts
  if (rel.startsWith('client/') || rel.startsWith('client\\')) {
    const ext = path.extname(rel)
    const base = rel.slice(0, -ext.length)

    for (const suffix of ['.test', '.spec']) {
      const candidate = path.join(projectRoot, 'tests', `${base}${suffix}${ext}`)
      if (fs.existsSync(candidate)) return candidate
    }
  }

  // Primary: parallel tests/ directory (src/foo/bar.ts → tests/foo/bar.test.ts)
  if (rel.startsWith('src/') || rel.startsWith('src\\')) {
    // ... existing code unchanged ...
  }

  // Fallback: colocated test file (same directory)
  // ... existing code unchanged ...
}
```

**Step 4: Update `resolveImplPath()`**

```javascript
// Before:
export function resolveImplPath(testRelPath) {
  const ext = path.extname(testRelPath)
  const base = path.basename(testRelPath, ext).replace(/\.(test|spec)$/, '')

  if (testRelPath.startsWith('tests/') || testRelPath.startsWith('tests\\')) {
    const dir = path.dirname(testRelPath).replace(/^tests[/\\]?/, '')
    return path.join('src', dir, `${base}${ext}`)
  }

  return path.join(path.dirname(testRelPath), `${base}${ext}`)
}

// After:
export function resolveImplPath(testRelPath) {
  const ext = path.extname(testRelPath)
  const base = path.basename(testRelPath, ext).replace(/\.(test|spec)$/, '')

  if (testRelPath.startsWith('tests/') || testRelPath.startsWith('tests\\')) {
    const dir = path.dirname(testRelPath).replace(/^tests[/\\]?/, '')
    // tests/client/debug/helpers.test.ts → client/debug/helpers.ts (client/ stays)
    if (dir.startsWith('client/') || dir.startsWith('client\\')) {
      return path.join(dir, `${base}${ext}`)
    }
    // tests/foo/bar.test.ts → src/foo/bar.ts (prepend src/)
    return path.join('src', dir, `${base}${ext}`)
  }

  return path.join(path.dirname(testRelPath), `${base}${ext}`)
}
```

**Step 5: Verify existing tests still pass**

Run: `bun test tests/`
Expected: All existing tests pass (hook changes are backwards-compatible).

**Step 6: Commit**

```bash
git add .hooks/tdd/test-resolver.mjs
git commit -m "feat: extend TDD hooks to recognize client/ source root"
```

---

## Task 4: Move client source files to client/debug/

This is a file-move refactoring. Use `git mv` for history preservation where possible. Files that need renaming are created fresh.

**Files:**

- Create: `client/debug/` directory
- Move: all files from `src/debug/dashboard-ui/` and `src/debug/dashboard/`
- Move: `src/debug/dashboard-types.ts`, `src/debug/dashboard.html`, `src/debug/dashboard.css`

**Step 1: Create directory and move dashboard-ui/ files**

```bash
mkdir -p client/debug

# Move dashboard-ui files (rename index.ts → dashboard-api.ts)
git mv src/debug/dashboard-ui/helpers.ts client/debug/helpers.ts
git mv src/debug/dashboard-ui/logs.ts client/debug/logs.ts
git mv src/debug/dashboard-ui/trace-detail.ts client/debug/trace-detail.ts
git mv src/debug/dashboard-ui/session-detail.ts client/debug/session-detail.ts
git mv src/debug/dashboard-ui/session-card.ts client/debug/session-card.ts
git mv src/debug/dashboard-ui/log-detail.ts client/debug/log-detail.ts
git mv src/debug/dashboard-ui/types.ts client/debug/types.ts
# Rename: index.ts → dashboard-api.ts
cp src/debug/dashboard-ui/index.ts client/debug/dashboard-api.ts
git rm src/debug/dashboard-ui/index.ts
```

**Step 2: Move dashboard/ files**

```bash
git mv src/debug/dashboard/state.ts client/debug/state.ts
git mv src/debug/dashboard/handlers.ts client/debug/handlers.ts
git mv src/debug/dashboard/sse.ts client/debug/sse.ts
git mv src/debug/dashboard/search.ts client/debug/search.ts
git mv src/debug/dashboard/init.ts client/debug/init.ts
git mv src/debug/dashboard/tree-view.ts client/debug/tree-view.ts
# Rename: logs.ts → logs-bootstrap.ts (avoid name clash)
cp src/debug/dashboard/logs.ts client/debug/logs-bootstrap.ts
git rm src/debug/dashboard/logs.ts
# Remove the barrel file (consolidated into new index.ts)
git rm src/debug/dashboard/dashboard-state.ts
```

**Step 3: Move shared types and static assets**

```bash
git mv src/debug/dashboard-types.ts client/debug/dashboard-types.ts
git mv src/debug/dashboard.html client/debug/dashboard.html
git mv src/debug/dashboard.css client/debug/dashboard.css
```

**Step 4: Clean up empty directories**

```bash
# git mv should leave these empty; remove them
rmdir src/debug/dashboard-ui src/debug/dashboard 2>/dev/null || true
```

**Step 5: Commit the raw move (before updating imports)**

```bash
git add -A
git commit -m "refactor: move client source files to client/debug/"
```

---

## Task 5: Update imports in moved client files

After the move, all intra-client imports need updating. The `../schemas.js` imports become `../../src/debug/schemas.js` (Bun.build resolves these at build time). Intra-module imports go from `../dashboard-types.js` / `./helpers.js` etc. to same-directory `./` imports.

**Files:**

- Modify: all `.ts` files in `client/debug/`

**Step 1: Update imports in dashboard-api.ts (was dashboard-ui/index.ts)**

The file currently has:

```typescript
import type { DashboardAPI } from '../dashboard-types.js'
import type { LogEntry, LlmTrace } from '../schemas.js'
import { escapeHtml, formatTime, formatTokens, formatUptime } from './helpers.js'
import { renderLogDetailHTML, renderLogDetailTitle } from './log-detail.js'
import { filterLogs, getLogFilterElements, getLogModalElements, renderLogEntry, updateFuseIndex } from './logs.js'
import { buildSessionCard } from './session-card.js'
import { getSessionModalElements, renderSessionDetail } from './session-detail.js'
import { getTraceModalElements, renderTraceDetail } from './trace-detail.js'
import type { SessionDetail } from './types.js'
```

Change to:

```typescript
import type { DashboardAPI } from './dashboard-types.js'
import type { LogEntry, LlmTrace } from '../../src/debug/schemas.js'
import { escapeHtml, formatTime, formatTokens, formatUptime } from './helpers.js'
import { renderLogDetailHTML, renderLogDetailTitle } from './log-detail.js'
import { filterLogs, getLogFilterElements, getLogModalElements, renderLogEntry, updateFuseIndex } from './logs.js'
import { buildSessionCard } from './session-card.js'
import { getSessionModalElements, renderSessionDetail } from './session-detail.js'
import { getTraceModalElements, renderTraceDetail } from './trace-detail.js'
import type { SessionDetail } from './types.js'
```

**Step 2: Update imports across all moved files**

Apply these import path changes throughout `client/debug/`:

| Old import                     | New import                          | Files affected                                                                                                 |
| ------------------------------ | ----------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `from '../schemas.js'`         | `from '../../src/debug/schemas.js'` | dashboard-api.ts, types.ts, logs.ts, trace-detail.ts, log-detail.ts, handlers.ts, logs-bootstrap.ts, search.ts |
| `from '../dashboard-types.js'` | `from './dashboard-types.js'`       | dashboard-api.ts, state.ts, handlers.ts                                                                        |
| `from './state.js'`            | `from './state.js'`                 | handlers.ts, logs-bootstrap.ts, sse.ts (unchanged — same directory now)                                        |
| `from './handlers.js'`         | `from './handlers.js'`              | sse.ts (unchanged)                                                                                             |
| `from './logs.js'`             | `from './logs-bootstrap.js'`        | init.ts (renamed file)                                                                                         |

Also update `client/debug/dashboard-types.ts`:

```typescript
// Before:
import type { ... } from './schemas.js'

// After:
import type { ... } from '../../src/debug/schemas.js'
```

**Step 3: Standardize Fuse.js imports**

In `client/debug/logs.ts` (was dashboard-ui/logs.ts), it declares `Fuse` as a CDN global. In `client/debug/search.ts` (was dashboard/search.ts), it imports `Fuse` from the npm package.

Since we're bundling, standardize to the npm import approach:

In `client/debug/logs.ts`, replace the `declare const Fuse` block with:

```typescript
import Fuse from 'fuse.js'
```

And update the `updateFuseIndex` function's Fuse availability check — remove the `typeof Fuse === 'undefined'` guard since the import guarantees it's available.

**Step 4: Verify TypeScript compiles**

Run: `bun typecheck`
Expected: No errors.

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor: update imports in moved client files"
```

---

## Task 6: Create single entry point and update HTML

**Files:**

- Create: `client/debug/index.ts`
- Modify: `client/debug/dashboard.html`

**Step 1: Create the single entry point**

Create `client/debug/index.ts`:

```typescript
/// <reference lib="dom" />

// Single entry point for the debug dashboard client.
// Import order matters — each module has side effects.

// 1. Dashboard API setup (creates window.dashboard with render functions)
import './dashboard-api.js'

// 2. State management (sets window.dashboard.__state, clearLogs, uptime ticker)
import './state.js'

// 3. Tree view toggle handler (moved from inline HTML script)
document.addEventListener('click', (e: Event) => {
  const target = e.target
  if (!(target instanceof HTMLElement)) return
  if (!target.classList.contains('tree-toggle')) return

  const targetId = target.getAttribute('data-target')
  if (targetId === null) return
  const children = document.getElementById(targetId)
  if (children === null) return

  children.classList.toggle('collapsed')
  target.classList.toggle('collapsed')
  target.textContent = children.classList.contains('collapsed') ? '\u25b6' : '\u25bc'
})

// 4. Bootstrap (fetches initial logs, sets up SSE — must be last)
import './init.js'
```

**Step 2: Update dashboard.html**

In `client/debug/dashboard.html`, replace the three script tags at the bottom:

```html
<!-- Before: -->
<script src="https://cdn.jsdelivr.net/npm/fuse.js@7.3.0/dist/fuse.basic.min.js"></script>
<script src="/dashboard-ui.js" defer></script>
<script src="/dashboard-state.js" defer></script>
<script>
  // Tree view toggle functionality
  document.addEventListener('click', function (e) {
    if (e.target.classList.contains('tree-toggle')) {
      const targetId = e.target.getAttribute('data-target')
      const children = document.getElementById(targetId)
      if (children) {
        children.classList.toggle('collapsed')
        e.target.classList.toggle('collapsed')
        e.target.textContent = children.classList.contains('collapsed') ? '▶' : '▼'
      }
    }
  })
</script>

<!-- After: -->
<script src="/dashboard.js" defer></script>
```

Fuse.js CDN removed (now bundled). Inline tree-view script removed (now in index.ts). Two JS files collapsed to one.

**Step 3: Verify build works**

Run: `bun scripts/build-client.ts`
Expected: Build succeeds, `public/dashboard.js` created.

**Step 4: Verify build test passes**

Run: `bun test tests/scripts/build-client.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add client/debug/index.ts client/debug/dashboard.html
git commit -m "feat: create single entry point and update HTML"
```

---

## Task 7: Create happy-dom test setup

**Files:**

- Create: `tests/client-setup.ts`

**Step 1: Create the preload file**

Create `tests/client-setup.ts`:

```typescript
import { GlobalRegistrator } from '@happy-dom/global-registrator'

GlobalRegistrator.register()
```

Check happy-dom docs for the exact API. If `GlobalRegistrator` is the correct import, this registers `window`, `document`, `HTMLElement`, etc. on `globalThis`.

**Step 2: Verify it works**

Run: `bun --preload ./tests/client-setup.ts -e "console.log(typeof document)"`
Expected: `object` (not `undefined`).

**Step 3: Commit**

```bash
git add tests/client-setup.ts
git commit -m "feat: add happy-dom test setup preload"
```

---

## Task 8: Move and adapt client tests

Move all client-related tests to `tests/client/debug/`. Update import paths to point to `client/debug/` source files.

**Files:**

- Move: `tests/debug/dashboard-ui/*.test.ts` → `tests/client/debug/`
- Move: `tests/debug/dashboard/*.test.ts` → `tests/client/debug/`
- Move: `tests/debug/dashboard-types.test.ts` → `tests/client/debug/`
- Move: `tests/debug/fuse-search.test.ts` → `tests/client/debug/` (if it tests client code)
- Move: `tests/debug/snapshots.test.ts` → `tests/client/debug/` (if it tests client code)

**Step 1: Create directory and move files**

```bash
mkdir -p tests/client/debug

# dashboard-ui tests → client tests (rename index.test.ts → dashboard-api.test.ts)
git mv tests/debug/dashboard-ui/helpers.test.ts tests/client/debug/helpers.test.ts
git mv tests/debug/dashboard-ui/logs.test.ts tests/client/debug/logs.test.ts
git mv tests/debug/dashboard-ui/trace-detail.test.ts tests/client/debug/trace-detail.test.ts
git mv tests/debug/dashboard-ui/session-detail.test.ts tests/client/debug/session-detail.test.ts
git mv tests/debug/dashboard-ui/session-card.test.ts tests/client/debug/session-card.test.ts
git mv tests/debug/dashboard-ui/log-detail.test.ts tests/client/debug/log-detail.test.ts
git mv tests/debug/dashboard-ui/types.test.ts tests/client/debug/types.test.ts
cp tests/debug/dashboard-ui/index.test.ts tests/client/debug/dashboard-api.test.ts
git rm tests/debug/dashboard-ui/index.test.ts

# dashboard state tests
git mv tests/debug/dashboard/search.test.ts tests/client/debug/search.test.ts
git mv tests/debug/dashboard/tree-view.test.ts tests/client/debug/tree-view.test.ts

# dashboard-types test
git mv tests/debug/dashboard-types.test.ts tests/client/debug/dashboard-types.test.ts

# fuse-search and snapshots — check if they test client code first
# If tests/debug/fuse-search.test.ts imports from dashboard/search.ts → move
# If tests/debug/snapshots.test.ts tests render output → move
```

Investigate `tests/debug/fuse-search.test.ts` and `tests/debug/snapshots.test.ts` to decide if they should move.

**Step 2: Update import paths in all moved test files**

The import path pattern changes:

| Old pattern                                         | New pattern                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------------- |
| `from '../../../src/debug/dashboard-ui/helpers.js'` | `from '../../../client/debug/helpers.js'`                                 |
| `from '../../../src/debug/dashboard/search.js'`     | `from '../../../client/debug/search.js'`                                  |
| `from '../../../src/debug/dashboard-types.js'`      | `from '../../../client/debug/dashboard-types.js'`                         |
| `from '../../../src/debug/schemas.js'`              | `from '../../../src/debug/schemas.js'` (unchanged — schemas stays in src) |

For test files at depth `tests/client/debug/`, the relative path to `client/debug/` is `../../../client/debug/`.

**Step 3: Remove old test directories**

```bash
# Remove old directories (should be empty after moves)
git rm -r tests/debug/dashboard-ui/ tests/debug/dashboard/ 2>/dev/null || true
# Remove dashboard-ui.test.ts (source introspection test, no longer relevant)
git rm tests/debug/dashboard-ui.test.ts 2>/dev/null || true
```

**Step 4: Verify client tests pass with happy-dom**

Run: `bun test --preload ./tests/client-setup.ts tests/client/`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor: move client tests to tests/client/debug/"
```

---

## Task 9: Update package.json scripts and bunfig.toml

**Files:**

- Modify: `package.json`
- Modify: `bunfig.toml`

**Step 1: Add new scripts to package.json**

```json
{
  "scripts": {
    "build:client": "bun scripts/build-client.ts",
    "start": "bun build:client && bun run src/index.ts",
    "start:debug": "bun build:client && DEBUG_SERVER=true bun run src/index.ts",
    "test:client": "bun test --preload ./tests/client-setup.ts tests/client/"
  }
}
```

Leave all other scripts unchanged.

**Step 2: Update bunfig.toml to exclude client tests**

```toml
[test]
# Exclude E2E and client tests from default test discovery
# Client tests require happy-dom and should be run with: bun test:client
pathIgnorePatterns = ["tests/e2e/**", "tests/client/**"]

# Preload global setup to suppress console output during tests
preload = ["./tests/setup.ts", "./tests/mock-reset.ts"]
```

**Step 3: Verify**

Run: `bun test:client` — should run client tests with happy-dom.
Run: `bun test` — should run server tests without client tests.

**Step 4: Commit**

```bash
git add package.json bunfig.toml
git commit -m "feat: add build:client and test:client scripts"
```

---

## Task 10: Update server to serve from public/

**Files:**

- Modify: `src/debug/server.ts`
- Modify: `tests/debug/server.test.ts`

**Step 1: Update server test for new behavior**

In `tests/debug/server.test.ts`, update expectations:

- Server should serve `/dashboard` from `public/dashboard.html`
- Server should serve `/dashboard.js` from `public/dashboard.js`
- Server should serve `/dashboard.css` from `public/dashboard.css`
- No `transpileDashboard()` call in `startDebugServer()`

The smoke test (`tests/debug/dashboard-smoke.test.ts`) also needs updating — handle in next task.

**Step 2: Run server tests to verify they fail**

Run: `bun test tests/debug/server.test.ts`
Expected: Some tests may fail if they assert transpilation behavior.

**Step 3: Rewrite server.ts**

Remove from `src/debug/server.ts`:

- `const jsCache = new Map<string, string>()`
- The entire `transpileDashboard()` function
- The `jsCache.get()` logic in `handleDashboardFile()`

Replace with static file serving:

```typescript
import path from 'node:path'

const PUBLIC_DIR = path.resolve(import.meta.dir, '../../public')

function handleDashboardFile(pathname: string): Response {
  if (pathname === '/dashboard') {
    return new Response(Bun.file(path.join(PUBLIC_DIR, 'dashboard.html')))
  }

  const filename = pathname.slice(1) // Remove leading /
  const ext = filename.split('.').pop()

  // Serve JS from public/
  if (ext === 'js' && filename === 'dashboard.js') {
    return new Response(Bun.file(path.join(PUBLIC_DIR, filename)), {
      headers: { 'Content-Type': 'text/javascript' },
    })
  }

  // Serve CSS from public/
  if (ext === 'css' && filename === 'dashboard.css') {
    return new Response(Bun.file(path.join(PUBLIC_DIR, filename)))
  }

  return new Response('Not found', { status: 404 })
}
```

In `startDebugServer()`, remove the `await transpileDashboard()` call.

Update the route matching — currently it matches `/dashboard-*` for `dashboard-ui.js` and `dashboard-state.js`. Now it only needs `/dashboard` and `/dashboard.*`:

```typescript
if (url.pathname === '/dashboard' || url.pathname === '/dashboard.js' || url.pathname === '/dashboard.css') {
  return handleDashboardFile(url.pathname)
}
```

**Step 4: Run server tests**

Run: `bun test tests/debug/server.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/debug/server.ts tests/debug/server.test.ts
git commit -m "refactor: serve dashboard from pre-built public/ directory"
```

---

## Task 11: Update smoke tests

**Files:**

- Modify: `tests/debug/dashboard-smoke.test.ts`

**Step 1: Run the build before smoke tests**

The smoke test needs `public/` to exist. Add a `beforeAll` that runs `bun build:client`:

```typescript
beforeAll(async () => {
  restoreFetch()
  // Build client first
  const proc = Bun.spawnSync(['bun', 'build:client'], {
    cwd: path.resolve(import.meta.dir, '../..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (proc.exitCode !== 0) {
    throw new Error(`Client build failed: ${proc.stderr.toString()}`)
  }

  process.env['DEBUG_PORT'] = String(TEST_PORT)
  await startDebugServer('test-admin')
})
```

**Step 2: Consolidate test assertions**

Currently tests check for two separate JS files (`dashboard-ui.js`, `dashboard-state.js`). Update to check for single `dashboard.js`:

- Remove the `dashboard-ui.js` and `dashboard-state.js` describe blocks
- Add a single `dashboard.js` describe block that verifies:
  - Returns 200 with IIFE format
  - Contains `window.dashboard`, `getElementById`, `EventSource`
  - No ES module syntax
- Update the HTML test to check for single `dashboard.js` reference
- Remove checks for `dashboard-ui.js` and `dashboard-state.js` references in HTML

**Step 3: Run smoke tests**

Run: `bun test tests/debug/dashboard-smoke.test.ts`
Expected: PASS.

**Step 4: Commit**

```bash
git add tests/debug/dashboard-smoke.test.ts
git commit -m "test: adapt smoke tests for single-bundle serving"
```

---

## Task 12: Update scripts/check.sh

**Files:**

- Modify: `scripts/check.sh`

**Step 1: Add test:client to the full check pipeline**

In `scripts/check.sh`, the full-mode `checks` array:

```bash
# Before:
checks=("lint" "typecheck" "format:check" "knip" "test" "duplicates")

# After:
checks=("lint" "typecheck" "format:check" "knip" "test" "test:client" "duplicates")
```

**Step 2: Verify**

Run: `bun check:full`
Expected: All checks pass including `test:client`.

**Step 3: Commit**

```bash
git add scripts/check.sh
git commit -m "chore: add test:client to check:full pipeline"
```

---

## Task 13: Update CI workflow

**Files:**

- Modify: `.github/workflows/ci.yml`

**Step 1: Add build job and update dependencies**

```yaml
jobs:
  build:
    name: Build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.11
      - name: Install dependencies
        run: bun install
      - name: Build client
        run: bun build:client
      - name: Upload build output
        uses: actions/upload-artifact@v4
        with:
          name: build-output
          path: public/
          retention-days: 1

  security:
    name: Security Scan
    runs-on: ubuntu-latest
    # No dependency on build — doesn't need client artifacts
    # ... unchanged ...

  check:
    name: Checks
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.11
      - name: Install dependencies
        run: bun install
      - name: Download build output
        uses: actions/download-artifact@v4
        with:
          name: build-output
          path: public/
      - name: Run all checks
        run: bun check:full

  e2e:
    name: E2E Tests
    needs: build
    # ... add download-artifact step before running tests ...

  mutation-testing:
    name: Mutation Testing
    needs: build
    # ... add download-artifact step before running Stryker ...
```

**Step 2: Verify YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"`
Expected: No errors.

**Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add build job for client assets"
```

---

## Task 14: Update Dockerfile

**Files:**

- Modify: `Dockerfile`

**Step 1: Add build stage**

```dockerfile
FROM oven/bun:1-alpine@sha256:32f1fcccb1523960b254c4f80973bee1a910d60be000a45c20c9129a1efcffee AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY client ./client
COPY src ./src
COPY scripts ./scripts
COPY package.json tsconfig.json ./
RUN bun build:client

FROM base AS final
COPY --from=build /app/public ./public
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY package.json tsconfig.json CHANGELOG.md ./

ENV NODE_ENV=production

# Create data directory with proper permissions for the bun user
RUN mkdir -p /data && chown -R bun:bun /data

USER bun

CMD ["bun", "run", "src/index.ts"]
```

Key changes:

- New `build` stage: copies `client/`, `src/` (for schema imports), `scripts/`, runs `bun build:client`
- `final` stage: copies `public/` from `build` stage instead of source dashboard files
- CMD stays `bun run src/index.ts` (no build:client needed — already built)

**Step 2: Verify Docker build**

Run: `docker build .`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add Dockerfile
git commit -m "chore: add client build stage to Dockerfile"
```

---

## Task 15: Update knip.jsonc

**Files:**

- Modify: `knip.jsonc`

**Step 1: Add client/ to project scope**

```jsonc
{
  // Standalone scripts not auto-detected from package.json
  "entry": ["src/scripts/*.ts!", "scripts/build-client.ts!"],

  // All source files (production only)
  "project": ["src/**/*.ts!", "client/**/*.ts!"],

  // ... rest unchanged ...
}
```

**Step 2: Verify**

Run: `bun knip`
Expected: No new errors.

**Step 3: Commit**

```bash
git add knip.jsonc
git commit -m "chore: add client/ to knip project scope"
```

---

## Task 16: Clean up stale test files and verify

**Files:**

- Delete: `tests/debug/dashboard-ui.test.ts` (source introspection test, not relevant post-move)
- Review: `tests/debug/fuse-search.test.ts`, `tests/debug/snapshots.test.ts`

**Step 1: Check and move/delete remaining test files**

Read `tests/debug/fuse-search.test.ts` — if it imports from `src/debug/dashboard/search.ts`, move to `tests/client/debug/` and update imports.

Read `tests/debug/snapshots.test.ts` — if it tests client render output, move to `tests/client/debug/`.

Delete `tests/debug/dashboard-ui.test.ts`.

**Step 2: Run full test suite**

Run: `bun test && bun test:client`
Expected: All tests pass.

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: clean up stale test files after client migration"
```

---

## Task 17: Update CLAUDE.md and project documentation

**Files:**

- Modify: `CLAUDE.md`

**Step 1: Update Architecture section**

Add `client/debug/` to the architecture description. Update the `src/debug/` section to note that client code has moved.

Add new commands:

```markdown
- `bun build:client` — build debug dashboard client to public/
- `bun test:client` — run client tests with happy-dom
```

Update the `src/debug/server.ts` description to mention static serving from `public/`.

**Step 2: Add client path-scoped conventions**

Add entry to the Path-Scoped Conventions table:

```markdown
| `client/CLAUDE.md` | Client modules, build pipeline, happy-dom testing |
```

Create `client/CLAUDE.md` if conventions are needed (optional — can be brief).

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for client build pipeline"
```

---

## Task 18: Final verification

**Step 1: Run all checks**

```bash
bun check:full
```

Expected: All checks pass (lint, typecheck, format, knip, test, test:client, duplicates).

**Step 2: Run build + start**

```bash
bun start
```

Expected: Build succeeds, server starts, dashboard accessible at `http://localhost:9100/dashboard`.

**Step 3: Run Docker build**

```bash
docker build -t papai-test .
```

Expected: Build succeeds.

**Step 4: Verify no leftover files**

```bash
# Should be empty:
ls src/debug/dashboard-ui/ 2>/dev/null
ls src/debug/dashboard/ 2>/dev/null
ls tests/debug/dashboard-ui/ 2>/dev/null
ls tests/debug/dashboard/ 2>/dev/null
```

**Step 5: Final commit if needed**

```bash
git status
# If any uncommitted changes, commit them
```
