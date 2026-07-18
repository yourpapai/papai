<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ACP Phase-3 Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four targeted cleanup items — split `plugins/acp/tools.ts` under max-lines; drop the dead `project` field from two POST bodies; add a thread-scope test for `buildCodingReposFacade`; add DELETE CSRF assertion to client fetcher tests.

**Architecture:** All changes are in-place refactors or test additions. `tools.ts` is split into `tools.ts` (read/utility tools) and `session-tools.ts` (write/lifecycle tools). `index.ts` imports from both. No business logic changes; only the `project` field removal changes runtime behavior.

**Tech Stack:** Bun test runner (`bun:test`), TypeScript, oxlint (`bun run lint`), knip (`bun run knip`). Plugin files must NOT import from `src/` or `zod` (bare-module restriction).

---

## File Map

| Action     | File                                                                                                                                                                                                                                                                         |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Modify** | `plugins/acp/tools.ts` — keep: `getTool`, `listProjectsTool`, `buildProjectSpec`, `sessionIdOf`, types. Remove: session lifecycle tools (start, list, status, finish, cancel, answer permission, review PR).                                                                 |
| **Create** | `plugins/acp/session-tools.ts` — contains: `startSessionTool`, `listSessionsTool`, `sessionStatusTool`, `finishSessionTool`, `cancelSessionTool`, `answerPermissionTool`, `reviewPrTool`. Also remove `project` field from `start_session` and `review_pr` POST bodies here. |
| **Modify** | `plugins/acp/index.ts` — add import of all session tools from `./session-tools.js`.                                                                                                                                                                                          |
| **Modify** | `tests/plugins/acp/start-session.test.ts` — update the captured body assertion to no longer include `project`.                                                                                                                                                               |
| **Modify** | `tests/plugins/acp/review-command.test.ts` — update the captured body assertion to no longer include `project`.                                                                                                                                                              |
| **Modify** | `tests/plugins/coding-repos-facade.test.ts` — add one new test: facade built with thread-scoped id reads repos stored at config-context.                                                                                                                                     |
| **Modify** | `tests/client/settings/repos-fetchers.test.ts` — add CSRF header assertion to the DELETE test.                                                                                                                                                                               |

---

## Task 1: Create `plugins/acp/session-tools.ts`

Extract the seven session lifecycle tool factories from `tools.ts` into a new sibling file. This new file only imports from `./client.js` and `./schemas.js` (no `src/`, no `zod`). Also remove the dead `project` field from `start_session` and `review_pr` POST bodies in this new file.

**Files:**

- Create: `plugins/acp/session-tools.ts`

- [ ] **Step 1.1: Write `plugins/acp/session-tools.ts` with all session tools and the `project` field removed**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  asObject,
  asPositiveInt,
  asString,
  callMagi,
  NOT_CONFIGURED,
  optionalString,
  readMagiConfig,
} from './client.js'
import type { HttpFetch } from './client.js'
import {
  answerPermissionSchema,
  finishSessionSchema,
  listSessionsSchema,
  reviewPrSchema,
  sessionIdSchema,
  startSessionSchema,
} from './schemas.js'
import type { RuntimeContext, Tool } from './tools.js'
import { buildProjectSpec, sessionIdOf } from './tools.js'

const DEFAULT_AGENT = 'claude-code-acp'
const SESSION_FILTERS = ['new', 'active', 'waiting', 'review', 'done']
const DEFAULT_FINISH_MESSAGE = 'Apply changes from magi coding session'

export function startSessionTool(httpFetch: HttpFetch | undefined): Tool {
  return {
    name: 'start_session',
    description: 'Start a sandboxed coding-agent session on a configured project.',
    inputSchema: startSessionSchema,
    execute: async (input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readMagiConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return NOT_CONFIGURED
      const args = asObject(input)
      const project = asString(args, 'project')
      const prompt = asString(args, 'prompt')
      if (project === null || prompt === null)
        return { error: 'invalid_input', message: 'project and prompt are required' }
      const repo = runtimeContext.codingRepos.get(project)
      if (repo === null)
        return {
          error: 'not_found',
          message: `No repository named "${project}". Add it in settings → Repositories.`,
        }
      const secrets = runtimeContext.codingSecrets.resolve()
      if (secrets === null)
        return {
          error: 'not_configured',
          message: 'Set up your AI provider key in settings → Coding sessions before starting a session.',
        }
      const forgeToken = runtimeContext.codingSecrets.resolveForgeToken()
      const agent = optionalString(args, 'agent') ?? DEFAULT_AGENT
      const projectSpec = buildProjectSpec(repo)
      const result = await callMagi(httpFetch, cfg, 'POST', '/sessions', {
        agent,
        contextId: runtimeContext.storageContextId,
        prompt,
        secrets,
        ...(forgeToken === null ? {} : { forgeToken }),
        projectSpec,
      })
      const id = sessionIdOf(result)
      if (id !== null) runtimeContext.kv.set(`session:${id}`, '1')
      return result
    },
  }
}

export function listSessionsTool(httpFetch: HttpFetch | undefined): Tool {
  return {
    name: 'list_sessions',
    description: 'List coding sessions started from this chat (filter: new|active|waiting|review|done).',
    inputSchema: listSessionsSchema,
    execute: async (input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readMagiConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return NOT_CONFIGURED
      const filter = optionalString(asObject(input), 'filter') ?? 'active'
      if (!SESSION_FILTERS.includes(filter))
        return { error: 'invalid_input', message: `filter must be one of ${SESSION_FILTERS.join(', ')}` }
      const result = await callMagi(httpFetch, cfg, 'GET', `/sessions?filter=${encodeURIComponent(filter)}`)
      if (!Array.isArray(result)) return result
      const known = new Set(runtimeContext.kv.list('session:').map((row): string => row.key.slice('session:'.length)))
      return result.filter((s): boolean => {
        const id = sessionIdOf(s)
        return id !== null && known.has(id)
      })
    },
  }
}

export function sessionStatusTool(httpFetch: HttpFetch | undefined): Tool {
  return {
    name: 'session_status',
    description: 'Get the status and metadata of a coding session.',
    inputSchema: sessionIdSchema,
    execute: (input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readMagiConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return Promise.resolve(NOT_CONFIGURED)
      const sessionId = asString(asObject(input), 'sessionId')
      if (sessionId === null) return Promise.resolve({ error: 'invalid_input', message: 'sessionId is required' })
      return callMagi(httpFetch, cfg, 'GET', `/sessions/${encodeURIComponent(sessionId)}`)
    },
  }
}

export function finishSessionTool(httpFetch: HttpFetch | undefined): Tool {
  return {
    name: 'finish_session',
    description: 'Finish a session: commit + push the branch, or open a PR.',
    inputSchema: finishSessionSchema,
    execute: (input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readMagiConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return Promise.resolve(NOT_CONFIGURED)
      const forgeToken = runtimeContext.codingSecrets.resolveForgeToken()
      if (forgeToken === null)
        return Promise.resolve({
          error: 'not_configured',
          message: 'Connect a code host in settings → Coding sessions before pushing or opening a PR.',
        })
      const args = asObject(input)
      const sessionId = asString(args, 'sessionId')
      const action = asString(args, 'action')
      if (sessionId === null || (action !== 'push' && action !== 'pr'))
        return Promise.resolve({ error: 'invalid_input', message: 'sessionId and action (push|pr) are required' })
      const bodyFields: Record<string, string | undefined> = {
        message: optionalString(args, 'message') ?? DEFAULT_FINISH_MESSAGE,
        action,
        title: optionalString(args, 'title'),
        body: optionalString(args, 'body'),
      }
      const payload = {
        ...Object.fromEntries(Object.entries(bodyFields).filter(([, v]) => v !== undefined)),
        forgeToken,
      }
      return callMagi(httpFetch, cfg, 'POST', `/sessions/${encodeURIComponent(sessionId)}/finish`, payload)
    },
  }
}

export function cancelSessionTool(httpFetch: HttpFetch | undefined): Tool {
  return {
    name: 'cancel_session',
    description: 'Cancel a running coding session and tear down its sandbox.',
    inputSchema: sessionIdSchema,
    execute: (input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readMagiConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return Promise.resolve(NOT_CONFIGURED)
      const sessionId = asString(asObject(input), 'sessionId')
      if (sessionId === null) return Promise.resolve({ error: 'invalid_input', message: 'sessionId is required' })
      return callMagi(httpFetch, cfg, 'POST', `/sessions/${encodeURIComponent(sessionId)}/cancel`)
    },
  }
}

export function answerPermissionTool(httpFetch: HttpFetch | undefined): Tool {
  return {
    name: 'answer_permission',
    description: 'Answer a coding agent pending permission request (allow or deny).',
    inputSchema: answerPermissionSchema,
    execute: async (input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readMagiConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return NOT_CONFIGURED
      const args = asObject(input)
      const sessionId = asString(args, 'sessionId')
      const decision = asString(args, 'decision')
      if (sessionId === null || (decision !== 'allow' && decision !== 'deny'))
        return { error: 'invalid_input', message: 'sessionId and decision (allow|deny) are required' }
      const pending = await callMagi(httpFetch, cfg, 'GET', `/sessions/${encodeURIComponent(sessionId)}/permissions`)
      if (!Array.isArray(pending)) return pending
      const toolCallIds = pending
        .map((p): string | null => asString(asObject(p), 'toolCallId'))
        .filter((id): id is string => id !== null)
      if (toolCallIds.length === 0) return { resolved: 0, message: 'no pending permission requests' }
      await Promise.all(
        toolCallIds.map(
          (toolCallId): Promise<unknown> =>
            callMagi(httpFetch, cfg, 'POST', `/sessions/${encodeURIComponent(sessionId)}/permission`, {
              toolCallId,
              decision,
            }),
        ),
      )
      return { resolved: toolCallIds.length, decision }
    },
  }
}

export function reviewPrTool(httpFetch: HttpFetch | undefined): Tool {
  return {
    name: 'review_pr',
    description: 'Start a review session for an open pull/merge request; findings are posted as inline comments.',
    inputSchema: reviewPrSchema,
    execute: async (input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readMagiConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return NOT_CONFIGURED
      const args = asObject(input)
      const project = asString(args, 'project')
      const prNumber = asPositiveInt(args, 'prNumber')
      if (project === null || prNumber === null)
        return { error: 'invalid_input', message: 'project and a positive prNumber are required' }
      const repo = runtimeContext.codingRepos.get(project)
      if (repo === null)
        return {
          error: 'not_found',
          message: `No repository named "${project}". Add it in settings → Repositories.`,
        }
      const secrets = runtimeContext.codingSecrets.resolve()
      if (secrets === null)
        return {
          error: 'not_configured',
          message: 'Set up your AI provider key in settings → Coding sessions before starting a review.',
        }
      const forgeToken = runtimeContext.codingSecrets.resolveForgeToken()
      if (forgeToken === null)
        return {
          error: 'not_configured',
          message: 'Connect a code host in settings → Coding sessions before pushing or opening a PR.',
        }
      const projectSpec = buildProjectSpec(repo)
      const result = await callMagi(httpFetch, cfg, 'POST', '/reviews', {
        prNumber,
        contextId: runtimeContext.storageContextId,
        secrets,
        forgeToken,
        projectSpec,
      })
      const id = sessionIdOf(result)
      if (id !== null) runtimeContext.kv.set(`session:${id}`, '1')
      return result
    },
  }
}
```

- [ ] **Step 1.2: Count lines to verify session-tools.ts is under 300**

Run: `wc -l plugins/acp/session-tools.ts`
Expected output: a number less than 300.

---

## Task 2: Trim `plugins/acp/tools.ts` (remove session tools, keep read/utility tools)

After creating `session-tools.ts`, remove the seven session tool factories from `tools.ts`, remove their now-unused imports (schemas), and export the shared helpers that `session-tools.ts` needs.

**Files:**

- Modify: `plugins/acp/tools.ts`

- [ ] **Step 2.1: Rewrite `plugins/acp/tools.ts` to keep only shared types and read/utility tools**

Replace the entire content with:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { callMagi, NOT_CONFIGURED, readMagiConfig } from './client.js'
import type { HttpFetch } from './client.js'
import { emptySchema } from './schemas.js'

type AdminConfigReader = { get(key: string): string | undefined }
type KvStore = {
  get(key: string): string | undefined
  set(key: string, value: string): void
  delete(key: string): void
  list(prefix?: string): Array<{ key: string; value: string }>
}
export type RuntimeContext = {
  storageContextId: string
  adminConfig: AdminConfigReader
  kv: KvStore
  codingSecrets: { resolve(): Record<string, string> | null; resolveForgeToken(): string | null }
  codingRepos: {
    list(): { name: string; baseBranch: string }[]
    get(name: string): { name: string; repoUrl: string; baseBranch: string; permissionPreset: string } | null
  }
}
type ToolExecute = (input: unknown, runtimeContext: RuntimeContext, options: unknown) => Promise<unknown>
export type Tool = { name: string; description: string; inputSchema: unknown; execute: ToolExecute }

export type RepoEntry = { name: string; repoUrl: string; baseBranch: string; permissionPreset: string }

export function sessionIdOf(result: unknown): string | null {
  if (typeof result !== 'object' || result === null) return null
  const map: Map<string, unknown> = new Map(Object.entries(result))
  const id = map.get('id')
  return typeof id === 'string' && id.length > 0 ? id : null
}

export function buildProjectSpec(repo: RepoEntry): {
  name: string
  repoUrl: string
  baseBranch: string
  permissionPreset: string
} {
  return {
    name: repo.name,
    repoUrl: repo.repoUrl,
    baseBranch: repo.baseBranch,
    permissionPreset: repo.permissionPreset,
  }
}

export function getTool(name: string, description: string, path: string, httpFetch: HttpFetch | undefined): Tool {
  return {
    name,
    description,
    inputSchema: emptySchema,
    execute: (_input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readMagiConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return Promise.resolve(NOT_CONFIGURED)
      return callMagi(httpFetch, cfg, 'GET', path)
    },
  }
}

export function listProjectsTool(): Tool {
  return {
    name: 'list_projects',
    description: 'List coding projects configured in your repository catalogue.',
    inputSchema: emptySchema,
    execute: (_input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      return Promise.resolve(runtimeContext.codingRepos.list())
    },
  }
}
```

- [ ] **Step 2.2: Count lines to verify tools.ts is under 300**

Run: `wc -l plugins/acp/tools.ts`
Expected output: a number less than 300 (should be around 80).

---

## Task 3: Update `plugins/acp/index.ts` to import from both files

**Files:**

- Modify: `plugins/acp/index.ts`

- [ ] **Step 3.1: Add session-tools imports to index.ts**

In `plugins/acp/index.ts`, change the import block from:

```typescript
import {
  answerPermissionTool,
  cancelSessionTool,
  finishSessionTool,
  getTool,
  listProjectsTool,
  listSessionsTool,
  reviewPrTool,
  sessionStatusTool,
  startSessionTool,
} from './tools.js'
import type { Tool } from './tools.js'
```

To:

```typescript
import {
  answerPermissionTool,
  cancelSessionTool,
  finishSessionTool,
  listSessionsTool,
  reviewPrTool,
  sessionStatusTool,
  startSessionTool,
} from './session-tools.js'
import { getTool, listProjectsTool } from './tools.js'
import type { Tool } from './tools.js'
```

---

## Task 4: Update tests to expect no `project` field in POST bodies

The `start_session.test.ts` test currently asserts `project: 'demo'` in `capturedBody` for the start_session tool. The `review-command.test.ts` test asserts `project: 'demo'` for the review_pr tool. Both must be updated to expect `project` absent.

**Files:**

- Modify: `tests/plugins/acp/start-session.test.ts`
- Modify: `tests/plugins/acp/review-command.test.ts`

- [ ] **Step 4.1: Update start-session.test.ts — remove `project` from expected captured body**

In `tests/plugins/acp/start-session.test.ts`, find the assertion:

```typescript
expect(capturedBody).toEqual({
  project: 'demo',
  agent: 'claude-code-acp',
  contextId: 'ctx-1',
  prompt: 'do it',
  secrets: { ANTHROPIC_API_KEY: 'sk-test' },
  forgeToken: 'ghp-test',
  projectSpec: {
    name: 'demo',
    repoUrl: 'https://github.com/acme/demo.git',
    baseBranch: 'main',
    permissionPreset: 'cautious',
  },
})
```

Replace with:

```typescript
expect(capturedBody).toEqual({
  agent: 'claude-code-acp',
  contextId: 'ctx-1',
  prompt: 'do it',
  secrets: { ANTHROPIC_API_KEY: 'sk-test' },
  forgeToken: 'ghp-test',
  projectSpec: {
    name: 'demo',
    repoUrl: 'https://github.com/acme/demo.git',
    baseBranch: 'main',
    permissionPreset: 'cautious',
  },
})
```

- [ ] **Step 4.2: Update review-command.test.ts — remove `project` from expected captured body**

In `tests/plugins/acp/review-command.test.ts`, find the assertion:

```typescript
expect(capturedBody).toEqual({
  project: 'demo',
  prNumber: 42,
  contextId: 'ctx-1',
  secrets: { ANTHROPIC_API_KEY: 'sk-test' },
  forgeToken: 'ghp-test',
  projectSpec: {
    name: 'demo',
    repoUrl: 'https://github.com/acme/demo.git',
    baseBranch: 'main',
    permissionPreset: 'cautious',
  },
})
```

Replace with:

```typescript
expect(capturedBody).toEqual({
  prNumber: 42,
  contextId: 'ctx-1',
  secrets: { ANTHROPIC_API_KEY: 'sk-test' },
  forgeToken: 'ghp-test',
  projectSpec: {
    name: 'demo',
    repoUrl: 'https://github.com/acme/demo.git',
    baseBranch: 'main',
    permissionPreset: 'cautious',
  },
})
```

---

## Task 5: Run ACP tests to confirm green before adding new tests

**Files:** (none changed)

- [ ] **Step 5.1: Run the ACP test suite**

Run: `bun test tests/plugins/acp/ --timeout 30000`
Expected: all tests PASS (no failures).

- [ ] **Step 5.2: Run lint to confirm 0 errors**

Run: `bun run lint`
Expected: `Found 0 warnings and 0 errors.`

---

## Task 6: Add thread-scope test to `coding-repos-facade.test.ts`

This test proves `buildCodingReposFacade` reads at the config-context when the provided storage context id has a thread suffix. Mirror the pattern from `tests/coding-credentials/resolve-agent-secrets.test.ts` test "reads credentials at config-context when called with a thread-scoped storage context id".

**Files:**

- Modify: `tests/plugins/coding-repos-facade.test.ts`

- [ ] **Step 6.1: Add import of `toScopedThreadContextId` and `getConfigContextIdFromStorageContextId`**

At the top of `tests/plugins/coding-repos-facade.test.ts`, add to the existing imports:

```typescript
import { getConfigContextIdFromStorageContextId, toScopedThreadContextId } from '../../src/chat/scoped-context.js'
```

- [ ] **Step 6.2: Add the thread-scope test**

Append at the end of `tests/plugins/coding-repos-facade.test.ts`:

```typescript
test('list and get resolve repos stored at the config-context when called with a thread-scoped storage context id', () => {
  const threadContextId = toScopedThreadContextId({
    platformInstanceId: 'pi-test',
    nativeContextId: 'group-7',
    threadId: 'thread-3',
  })
  const configContextId = getConfigContextIdFromStorageContextId(threadContextId)
  upsertRepo(
    configContextId,
    {
      name: 'thread-repo',
      repoUrl: 'https://github.com/acme/thread-repo.git',
      baseBranch: 'main',
      permissionPreset: 'cautious',
    },
    'user-3',
  )
  const facade = buildCodingReposFacade('acp', threadContextId, true)
  expect(facade.list()).toEqual([{ name: 'thread-repo', baseBranch: 'main' }])
  expect(facade.get('thread-repo')).toEqual({
    name: 'thread-repo',
    repoUrl: 'https://github.com/acme/thread-repo.git',
    baseBranch: 'main',
    permissionPreset: 'cautious',
  })
})
```

- [ ] **Step 6.3: Run the coding-repos-facade test suite**

Run: `bun test tests/plugins/coding-repos-facade.test.ts --timeout 30000`
Expected: all tests PASS including the new thread-scope test.

---

## Task 7: Add DELETE CSRF assertion to `repos-fetchers.test.ts`

Mirror the existing `addRepo attaches the CSRF header on POST` test, but for `deleteRepo`.

**Files:**

- Modify: `tests/client/settings/repos-fetchers.test.ts`

- [ ] **Step 7.1: Add the DELETE CSRF test**

Append inside the `describe('repos fetchers', ...)` block (after the last existing test):

```typescript
test('deleteRepo attaches the CSRF header on DELETE', async () => {
  setCsrfToken('csrf-del')
  installFetch({ ok: true, contextId: 'pi:telegram:ctx:u1' })
  await deleteRepo({ contextId: 'pi:telegram:ctx:u1', repoId: 'r1' })
  const csrfHeader = new Headers(lastRequest().init.headers).get('X-Settings-CSRF')
  expect(csrfHeader).toBe('csrf-del')
})
```

- [ ] **Step 7.2: Run the client repos-fetchers test suite**

Run: `bun test:client tests/client/settings/repos-fetchers.test.ts`
Expected: all tests PASS including the new DELETE CSRF test.

---

## Task 8: Final verification and commit

- [ ] **Step 8.1: Run full ACP and facade test suites**

Run: `bun test tests/plugins/acp/ tests/plugins/coding-repos-facade.test.ts --timeout 30000`
Expected: all tests PASS.

- [ ] **Step 8.2: Run client test**

Run: `bun test:client tests/client/settings/repos-fetchers.test.ts`
Expected: all tests PASS.

- [ ] **Step 8.3: Run lint**

Run: `bun run lint`
Expected: `Found 0 warnings and 0 errors.`

- [ ] **Step 8.4: Run knip**

Run: `bun run knip`
Expected: exit code 0.

- [ ] **Step 8.5: Commit**

```bash
git add plugins/acp/tools.ts plugins/acp/session-tools.ts plugins/acp/index.ts \
  tests/plugins/acp/start-session.test.ts tests/plugins/acp/review-command.test.ts \
  tests/plugins/coding-repos-facade.test.ts \
  tests/client/settings/repos-fetchers.test.ts
git commit -m "refactor(acp): split tools.ts under max-lines; drop dead project field; cover thread-scope + delete CSRF"
```

---

## Self-Review

**Spec coverage:**

1. Item 1 (split tools.ts under max-lines): Task 1 creates `session-tools.ts` (~190 lines), Task 2 trims `tools.ts` to ~80 lines. Both under 300. Task 3 updates `index.ts`. Covered.
2. Item 2 (drop `project` field): Task 1 removes `project` from `startSessionTool` and `reviewPrTool` POST bodies. Tasks 4.1 and 4.2 update the corresponding test assertions. Covered.
3. Item 3 (thread-scoped repos facade test): Task 6 adds the test using `toScopedThreadContextId` + `getConfigContextIdFromStorageContextId`, stores the repo at the config-context, builds the facade with the thread-scoped id, asserts `list()` and `get()` resolve. Covered.
4. Item 4 (DELETE CSRF assertion): Task 7 adds the test. Covered.

**Placeholder scan:** No TBDs or TODOs found. All steps include complete code.

**Type consistency:**

- `RuntimeContext` and `Tool` are defined in `tools.ts` and re-exported; `session-tools.ts` imports them with `import type { RuntimeContext, Tool } from './tools.js'`. Consistent.
- `RepoEntry` is defined in `tools.ts` and used internally by `buildProjectSpec`; `session-tools.ts` calls `buildProjectSpec(repo)` where `repo` is typed from `runtimeContext.codingRepos.get(project)` which returns `{ name, repoUrl, baseBranch, permissionPreset } | null`. The `buildProjectSpec` function accepts `RepoEntry` which matches that shape. Consistent.
- The `index.ts` change imports `answerPermissionTool`, `cancelSessionTool`, `finishSessionTool`, `listSessionsTool`, `reviewPrTool`, `sessionStatusTool`, `startSessionTool` from `./session-tools.js` — all seven are exported from `session-tools.ts`. Consistent.
- `getTool` and `listProjectsTool` remain in `tools.ts` and are imported from `./tools.js`. Consistent.

**Bare-module restriction check:** `session-tools.ts` imports only from `./client.js`, `./schemas.js`, and `./tools.js` — all sibling plugin files. No `src/` or `zod`. Compliant.
