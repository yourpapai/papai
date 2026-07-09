<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# papai → nerv Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-party `plugins/nerv/` plugin that lets a chat user create and supervise long-running GitLab-MR coding tasks on the external **nerv** service via LLM tool-calling — a structural copy-adapt of `plugins/acp/`.

**Architecture:** A stateless HTTP client of nerv, registered as a first-party plugin. Six LLM tools (`create_coding_task`, `coding_task_status`, `list_coding_tasks`, `followup_coding_task`, `steer_coding_task`, `cancel_coding_task`) map to nerv's `POST /tasks`, `GET /tasks/:id`, `POST /tasks/:id/events`. The chat's thread-scoped `storageContextId` is passed verbatim as `contextRef.contextId` so nerv's notifications round-trip back to the thread through papai's existing `/api/notify`. One task per thread, auto-resolved from a group-scoped local record store. The **only** edit outside `plugins/nerv/` adds nerv's action tools to the existing `whoMayUse` operator gate.

**Tech Stack:** Bun + strict TypeScript, `bun:test`. Plugin runtime constraints (no bare-module imports, no `src/`/Zod imports — raw JSON-Schema `inputSchema` + structural types), mirroring `plugins/acp/`.

**Spec:** `docs/superpowers/specs/2026-07-09-papai-nerv-plugin-design.md`.

---

## File Structure

**New — `plugins/nerv/` (structural copies of the matching `plugins/acp/` files):**

| File                          | Responsibility                                                                                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plugins/nerv/plugin.json`    | Manifest: 6 tools, `nerv` command, `nerv-hint` fragment, `coding.secrets` (repo catalogue only), `storageScope: group`, admin config `nerv_base_url`/`nerv_token`.    |
| `plugins/nerv/client.ts`      | `readNervConfig`, `callNerv`, arg guards (`asObject`/`asString`/`optionalString`/`asNumber`), `NOT_CONFIGURED`. Copy-adapt of `acp/client.ts`.                        |
| `plugins/nerv/history.ts`     | `TaskRecord` type + `deriveTitle`, record read/write, `active:<thread>` pointer helpers, `isTerminal`, `listRecords`.                                                 |
| `plugins/nerv/tools.ts`       | `RuntimeContext`/`Tool` types, `deriveProjectPath`, `isDefinitelyNotGitlab`, `taskIdOf`, and the `create_coding_task`/`coding_task_status`/`list_coding_tasks` tools. |
| `plugins/nerv/event-tools.ts` | `followup_coding_task`/`steer_coding_task`/`cancel_coding_task` (POST `/tasks/:id/events`) + shared `resolveTaskId`.                                                  |
| `plugins/nerv/schemas.ts`     | Raw JSON-Schema `inputSchema` per tool.                                                                                                                               |
| `plugins/nerv/index.ts`       | Factory + `activate()`: register tools, `nerv-hint` fragment, `nerv` command.                                                                                         |

**New — tests (mirror `tests/plugins/acp/`):**

`tests/plugins/nerv/support.ts`, `manifest.test.ts`, `history.test.ts`, `create-task.test.ts`, `event-tools.test.ts`, `status-list.test.ts`, and `who-may-use-nerv.test.ts`.

**Modified — one core file:**

- `src/llm-orchestrator-tools.ts:38-58` — add `NERV_TASK_ACTION_TOOLS` and gate them in `applyWhoMayUseFilter`.

---

## Conventions for every task

- License header on every new `.ts` file (4-line `// SPDX-…` block copied from any `plugins/acp/*.ts`). The `license-headers` check fails commits without it.
- Import paths use the `.js` extension.
- Run a single test file with: `bun test tests/plugins/nerv/<file>.test.ts`.
- Commits must pass the write-hook pipeline (lint, typecheck, format:check, license-headers). If `format:check` fails, run `bunx prettier --write <files>` then re-stage.
- Work happens on the current branch `docs/papai-nerv-plugin-design` (or a fresh feature branch if you prefer — do **not** commit to `master`).

---

## Task 1: Plugin config client (`client.ts`)

**Files:**

- Create: `plugins/nerv/client.ts`
- Test: `tests/plugins/nerv/client.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { asNumber, asObject, callNerv, NOT_CONFIGURED, readNervConfig } from '../../../plugins/nerv/client.js'

const admin = (m: Record<string, string>) => ({
  get: (k: string): string | undefined => m[k],
})

test('readNervConfig trims and strips trailing slashes', () => {
  const cfg = readNervConfig(admin({ nerv_base_url: 'http://nerv:9000/// ', nerv_token: ' tok ' }))
  expect(cfg).toEqual({ baseUrl: 'http://nerv:9000', token: 'tok' })
})

test('readNervConfig returns null when unset', () => {
  expect(readNervConfig(admin({}))).toBeNull()
  expect(readNervConfig(admin({ nerv_base_url: 'http://nerv:9000' }))).toBeNull()
})

test('asNumber parses finite numbers only', () => {
  expect(asNumber(asObject({ n: 4.2 }), 'n')).toBe(4.2)
  expect(asNumber(asObject({ n: 'x' }), 'n')).toBeNull()
  expect(asNumber(asObject({}), 'n')).toBeNull()
})

test('callNerv sends bearer + JSON and normalizes non-2xx', async () => {
  const seen: { url?: string; init?: RequestInit } = {}
  const httpFetch = (url: string, init?: RequestInit): Promise<Response> => {
    seen.url = url
    seen.init = init
    return Promise.resolve(new Response(JSON.stringify({ taskId: 't1' }), { status: 201 }))
  }
  const ok = await callNerv(httpFetch, { baseUrl: 'http://nerv:9000', token: 'tok' }, 'POST', '/tasks', { a: 1 })
  expect(ok).toEqual({ taskId: 't1' })
  expect(seen.url).toBe('http://nerv:9000/tasks')
  expect((seen.init?.headers as Record<string, string>)['Authorization']).toBe('Bearer tok')

  const bad = (url: string): Promise<Response> => Promise.resolve(new Response('{"error":"x"}', { status: 500 }))
  const err = await callNerv(bad, { baseUrl: 'http://nerv:9000', token: 'tok' }, 'GET', '/tasks/1')
  expect(err).toEqual({
    error: 'nerv_error',
    status: 500,
    body: { error: 'x' },
  })
})

test('NOT_CONFIGURED is the not_configured sentinel', () => {
  expect(NOT_CONFIGURED.error).toBe('not_configured')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/plugins/nerv/client.test.ts`
Expected: FAIL — cannot resolve `../../../plugins/nerv/client.js`.

- [ ] **Step 3: Write the implementation**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>
export type AdminConfigReader = { get(key: string): string | undefined }
export type NervConfig = { baseUrl: string; token: string }

export const NOT_CONFIGURED = {
  error: 'not_configured',
  message: 'nerv base URL or token is not configured',
} as const

export function readNervConfig(adminConfig: AdminConfigReader): NervConfig | null {
  const baseUrl = adminConfig.get('nerv_base_url')
  const token = adminConfig.get('nerv_token')
  if (baseUrl === undefined || baseUrl.trim() === '' || token === undefined || token.trim() === '') return null
  return { baseUrl: baseUrl.trim().replace(/\/+$/u, ''), token: token.trim() }
}

export function asObject(input: unknown): Record<string, unknown> {
  if (typeof input === 'object' && input !== null) return Object.fromEntries(Object.entries(input))
  return {}
}

export function asString(input: Record<string, unknown>, key: string): string | null {
  const v = input[key]
  return typeof v === 'string' && v.length > 0 ? v : null
}

export function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key]
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

export function asNumber(input: Record<string, unknown>, key: string): number | null {
  const v = input[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export async function callNerv(
  httpFetch: HttpFetch,
  cfg: NervConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.token}`,
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await httpFetch(`${cfg.baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  const data: unknown = text === '' ? null : JSON.parse(text)
  if (!res.ok) return { error: 'nerv_error', status: res.status, body: data }
  return data
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/plugins/nerv/client.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/nerv/client.ts tests/plugins/nerv/client.test.ts
git commit -m "feat(nerv-plugin): nerv HTTP client + config reader"
```

---

## Task 2: Record store + active-task pointer (`history.ts`)

**Files:**

- Create: `plugins/nerv/history.ts`
- Test: `tests/plugins/nerv/history.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import {
  clearActive,
  deriveTitle,
  getActiveTaskId,
  isTerminal,
  listRecords,
  readRecord,
  setActive,
  writeRecord,
} from '../../../plugins/nerv/history.js'

function fakeKv() {
  const store = new Map<string, string>()
  return {
    store,
    kv: {
      get: (k: string): string | undefined => store.get(k),
      set: (k: string, v: string): void => {
        store.set(k, v)
      },
      delete: (k: string): void => {
        store.delete(k)
      },
      list: (prefix?: string): Array<{ key: string; value: string }> =>
        Array.from(store.entries())
          .filter(([k]) => prefix === undefined || k.startsWith(prefix))
          .map(([key, value]) => ({ key, value })),
    },
  }
}

test('deriveTitle takes the first non-empty line, clipped', () => {
  expect(deriveTitle('\n\n  fix the CI  \nmore')).toBe('fix the CI')
  expect(deriveTitle('   ')).toBe('coding task')
  expect(deriveTitle('x'.repeat(200)).length).toBe(120)
})

test('write/read round-trips a record; malformed reads null', () => {
  const { kv } = fakeKv()
  writeRecord(kv, 't1', {
    taskId: 't1',
    storageContextId: 'ctx',
    title: 'T',
    repos: ['demo'],
    createdAt: 'now',
  })
  expect(readRecord(kv, 't1')?.title).toBe('T')
  expect(readRecord(kv, 'missing')).toBeNull()
})

test('active pointer set/get/clear', () => {
  const { kv } = fakeKv()
  expect(getActiveTaskId(kv, 'ctx')).toBeNull()
  setActive(kv, 'ctx', 't1')
  expect(getActiveTaskId(kv, 'ctx')).toBe('t1')
  clearActive(kv, 'ctx')
  expect(getActiveTaskId(kv, 'ctx')).toBeNull()
})

test('listRecords returns only task: records, not active: pointers', () => {
  const { kv } = fakeKv()
  writeRecord(kv, 't1', {
    taskId: 't1',
    storageContextId: 'ctx',
    title: 'A',
    repos: [],
    createdAt: 'now',
  })
  setActive(kv, 'ctx', 't1')
  expect(listRecords(kv).map((r) => r.taskId)).toEqual(['t1'])
})

test('isTerminal recognizes completed/closed/failed', () => {
  expect(isTerminal('completed')).toBe(true)
  expect(isTerminal('closed')).toBe(true)
  expect(isTerminal('failed')).toBe(true)
  expect(isTerminal('coding')).toBe(false)
  expect(isTerminal(undefined)).toBe(false)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/plugins/nerv/history.test.ts`
Expected: FAIL — cannot resolve `history.js`.

- [ ] **Step 3: Write the implementation**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

type KvStore = {
  get(key: string): string | undefined
  set(key: string, value: string): void
  delete(key: string): void
  list(prefix?: string): Array<{ key: string; value: string }>
}

export type TaskRecord = {
  taskId: string
  storageContextId: string
  title: string
  repos: string[]
  createdAt: string
  status?: string
  mrUrl?: string
  usageUsd?: number
}

const TASK_PREFIX = 'task:'
const ACTIVE_PREFIX = 'active:'
const TERMINAL = new Set(['completed', 'closed', 'failed'])

export function isTerminal(status: string | undefined): boolean {
  return status !== undefined && TERMINAL.has(status)
}

export function deriveTitle(prompt: string): string {
  const firstLine = prompt.split('\n').find((line): boolean => line.trim().length > 0)
  const title = firstLine === undefined ? '' : firstLine.trim()
  if (title.length === 0) return 'coding task'
  return title.length <= 120 ? title : `${title.slice(0, 119)}…`
}

export function writeRecord(kv: KvStore, taskId: string, record: TaskRecord): void {
  kv.set(`${TASK_PREFIX}${taskId}`, JSON.stringify(record))
}

function toTaskRecord(parsed: object): TaskRecord | null {
  const f = new Map<string, unknown>(Object.entries(parsed))
  const taskId = f.get('taskId')
  const storageContextId = f.get('storageContextId')
  const title = f.get('title')
  const createdAt = f.get('createdAt')
  const repos = f.get('repos')
  if (typeof taskId !== 'string' || typeof storageContextId !== 'string') return null
  if (typeof title !== 'string' || typeof createdAt !== 'string') return null
  const record: TaskRecord = {
    taskId,
    storageContextId,
    title,
    createdAt,
    repos: Array.isArray(repos) ? repos.filter((r): r is string => typeof r === 'string') : [],
  }
  const status = f.get('status')
  const mrUrl = f.get('mrUrl')
  const usageUsd = f.get('usageUsd')
  if (typeof status === 'string') record.status = status
  if (typeof mrUrl === 'string') record.mrUrl = mrUrl
  if (typeof usageUsd === 'number') record.usageUsd = usageUsd
  return record
}

export function readRecord(kv: KvStore, taskId: string): TaskRecord | null {
  const raw = kv.get(`${TASK_PREFIX}${taskId}`)
  if (raw === undefined) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    return toTaskRecord(parsed)
  } catch {
    return null
  }
}

export function listRecords(kv: KvStore): TaskRecord[] {
  return kv
    .list(TASK_PREFIX)
    .map((row): TaskRecord | null => {
      try {
        const parsed: unknown = JSON.parse(row.value)
        return typeof parsed === 'object' && parsed !== null ? toTaskRecord(parsed) : null
      } catch {
        return null
      }
    })
    .filter((r): r is TaskRecord => r !== null)
}

export function setActive(kv: KvStore, storageContextId: string, taskId: string): void {
  kv.set(`${ACTIVE_PREFIX}${storageContextId}`, taskId)
}

export function getActiveTaskId(kv: KvStore, storageContextId: string): string | null {
  const v = kv.get(`${ACTIVE_PREFIX}${storageContextId}`)
  return v !== undefined && v.length > 0 ? v : null
}

export function clearActive(kv: KvStore, storageContextId: string): void {
  kv.delete(`${ACTIVE_PREFIX}${storageContextId}`)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/plugins/nerv/history.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/nerv/history.ts tests/plugins/nerv/history.test.ts
git commit -m "feat(nerv-plugin): task record store + one-task-per-thread pointer"
```

---

## Task 3: Input schemas (`schemas.ts`)

**Files:**

- Create: `plugins/nerv/schemas.ts`
- Test: `tests/plugins/nerv/schemas.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import {
  cancelSchema,
  createCodingTaskSchema,
  emptySchema,
  followupSchema,
  taskRefSchema,
} from '../../../plugins/nerv/schemas.js'

test('create schema requires prompt and forbids extra props', () => {
  expect(createCodingTaskSchema.required).toEqual(['prompt'])
  expect(createCodingTaskSchema.additionalProperties).toBe(false)
  expect(Object.keys(createCodingTaskSchema.properties)).toEqual([
    'project',
    'projects',
    'prompt',
    'kind',
    'costBudgetUsd',
  ])
})

test('followup schema requires text and allows optional taskId', () => {
  expect(followupSchema.required).toEqual(['text'])
  expect(Object.keys(followupSchema.properties)).toEqual(['taskId', 'text'])
})

test('taskRef and cancel schemas take an optional taskId only', () => {
  expect(taskRefSchema.required).toBeUndefined()
  expect(Object.keys(cancelSchema.properties)).toEqual(['taskId'])
})

test('emptySchema forbids all props', () => {
  expect(emptySchema.additionalProperties).toBe(false)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/plugins/nerv/schemas.test.ts`
Expected: FAIL — cannot resolve `schemas.js`.

- [ ] **Step 3: Write the implementation**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const emptySchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const

export const createCodingTaskSchema = {
  type: 'object',
  properties: {
    project: {
      type: 'string',
      description: 'A configured repository name to supervise (single repo).',
    },
    projects: {
      type: 'array',
      items: { type: 'string' },
      description: 'Multiple repository names for a multi-repo task (alternative to project).',
    },
    prompt: {
      type: 'string',
      description: 'What the coding task should accomplish.',
    },
    kind: {
      type: 'string',
      description: 'Task kind; defaults to gitlab-mr-supervision.',
    },
    costBudgetUsd: {
      type: 'number',
      description: 'Optional USD cost budget for the task.',
    },
  },
  required: ['prompt'],
  additionalProperties: false,
} as const

export const taskRefSchema = {
  type: 'object',
  properties: {
    taskId: {
      type: 'string',
      description: 'Optional nerv task id; defaults to this thread’s current task.',
    },
  },
  additionalProperties: false,
} as const

export const cancelSchema = taskRefSchema

export const followupSchema = {
  type: 'object',
  properties: {
    taskId: {
      type: 'string',
      description: 'Optional nerv task id; defaults to this thread’s current task.',
    },
    text: {
      type: 'string',
      description: 'Instruction to send to the running task.',
    },
  },
  required: ['text'],
  additionalProperties: false,
} as const
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/plugins/nerv/schemas.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/nerv/schemas.ts tests/plugins/nerv/schemas.test.ts
git commit -m "feat(nerv-plugin): tool input schemas"
```

---

## Task 4: projectPath helpers + create/status/list tools (`tools.ts`)

**Files:**

- Create: `plugins/nerv/tools.ts`
- Test: `tests/plugins/nerv/tools-helpers.test.ts` (pure helpers; the full tool-execution tests come in Task 7 after `support.ts` exists)

- [ ] **Step 1: Write the failing test (pure helpers only)**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { deriveProjectPath, isDefinitelyNotGitlab, resolveProjectNames, taskIdOf } from '../../../plugins/nerv/tools.js'
import { asObject } from '../../../plugins/nerv/client.js'

test('deriveProjectPath strips host, leading slash, and .git', () => {
  expect(deriveProjectPath('https://gitlab.com/group/sub/repo.git')).toBe('group/sub/repo')
  expect(deriveProjectPath('https://gitlab.corp.example/team/app')).toBe('team/app')
  expect(deriveProjectPath('not a url')).toBeNull()
})

test('isDefinitelyNotGitlab rejects github.com but passes gitlab + self-hosted', () => {
  expect(isDefinitelyNotGitlab('https://github.com/a/b.git')).toBe(true)
  expect(isDefinitelyNotGitlab('https://gitlab.com/a/b.git')).toBe(false)
  expect(isDefinitelyNotGitlab('https://gitlab.corp.example/a/b')).toBe(false)
})

test('resolveProjectNames accepts project string or projects array', () => {
  expect(resolveProjectNames(asObject({ project: 'demo' }))).toEqual(['demo'])
  expect(resolveProjectNames(asObject({ projects: ['a', 'b'] }))).toEqual(['a', 'b'])
  expect(resolveProjectNames(asObject({ projects: ['a', ''], project: 'demo' }))).toEqual(['demo', 'a'])
  expect(resolveProjectNames(asObject({}))).toEqual([])
})

test('taskIdOf extracts a non-empty taskId', () => {
  expect(taskIdOf({ taskId: 't1' })).toBe('t1')
  expect(taskIdOf({ taskId: '' })).toBeNull()
  expect(taskIdOf('nope')).toBeNull()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/plugins/nerv/tools-helpers.test.ts`
Expected: FAIL — cannot resolve `tools.js`.

- [ ] **Step 3: Write the implementation**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { asNumber, asObject, asString, callNerv, NOT_CONFIGURED, optionalString, readNervConfig } from './client.js'
import type { HttpFetch } from './client.js'
import {
  clearActive,
  deriveTitle,
  getActiveTaskId,
  isTerminal,
  listRecords,
  readRecord,
  setActive,
  writeRecord,
} from './history.js'
import type { TaskRecord } from './history.js'
import { createCodingTaskSchema, emptySchema, taskRefSchema } from './schemas.js'

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
  codingRepos: {
    list(): { name: string; baseBranch: string }[]
    get(name: string): {
      name: string
      repoUrl: string
      baseBranch: string
      permissionPreset: string
      additionalEgressDomains?: string[]
    } | null
  }
}
type ToolExecute = (input: unknown, runtimeContext: RuntimeContext, options: unknown) => Promise<unknown>
export type Tool = {
  name: string
  description: string
  inputSchema: unknown
  execute: ToolExecute
}

export function taskIdOf(result: unknown): string | null {
  const row = asObject(result)
  const id = row['taskId']
  return typeof id === 'string' && id.length > 0 ? id : null
}

export function deriveProjectPath(repoUrl: string): string | null {
  try {
    const path = new URL(repoUrl).pathname.replace(/^\/+/u, '').replace(/\.git$/u, '')
    return path.length > 0 ? path : null
  } catch {
    return null
  }
}

// A positive "is GitLab" host check would false-refuse self-hosted GitLab (arbitrary host),
// so refuse only hosts that are definitely a different forge. github.com is the one that matters
// today; everything else (gitlab.com + self-hosted) passes through for nerv/magi to validate.
export function isDefinitelyNotGitlab(repoUrl: string): boolean {
  try {
    return new URL(repoUrl).host === 'github.com'
  } catch {
    return true
  }
}

export function resolveProjectNames(args: Record<string, unknown>): string[] {
  const names: string[] = []
  const single = optionalString(args, 'project')
  if (single !== undefined) names.push(single)
  const many = args['projects']
  if (Array.isArray(many)) {
    for (const n of many) if (typeof n === 'string' && n.length > 0) names.push(n)
  }
  return names
}

type ResolvedRepos =
  | { error: string; message: string }
  | {
      repos: { projectPath: string }[]
      names: string[]
      targetBranch: string | undefined
    }

function resolveRepos(runtimeContext: RuntimeContext, names: string[]): ResolvedRepos {
  const repos: { projectPath: string }[] = []
  const resolvedNames: string[] = []
  let targetBranch: string | undefined
  for (const name of names) {
    const repo = runtimeContext.codingRepos.get(name)
    if (repo === null)
      return {
        error: 'not_found',
        message: `No repository named "${name}". Add it in settings → Repositories.`,
      }
    if (isDefinitelyNotGitlab(repo.repoUrl))
      return {
        error: 'not_configured',
        message: `nerv supervises GitLab MRs; "${name}" is on GitHub.`,
      }
    const projectPath = deriveProjectPath(repo.repoUrl)
    if (projectPath === null)
      return {
        error: 'invalid_input',
        message: `Could not derive a project path from "${name}".`,
      }
    repos.push({ projectPath })
    resolvedNames.push(name)
    if (targetBranch === undefined) targetBranch = repo.baseBranch
  }
  return { repos, names: resolvedNames, targetBranch }
}

export function createCodingTaskTool(httpFetch: HttpFetch | undefined): Tool {
  return {
    name: 'create_coding_task',
    description:
      'Create a long-running, supervised coding task on nerv for a configured GitLab project: it opens/updates ' +
      'a merge request and watches it until CI is green, iterating on review comments. Pass project (or projects ' +
      'for multi-repo) + prompt. Only one task can run per chat thread at a time.',
    inputSchema: createCodingTaskSchema,
    execute: async (input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readNervConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return NOT_CONFIGURED
      const args = asObject(input)
      const prompt = asString(args, 'prompt')
      if (prompt === null) return { error: 'invalid_input', message: 'prompt is required' }
      const names = resolveProjectNames(args)
      if (names.length === 0)
        return {
          error: 'invalid_input',
          message: 'project (or projects) is required',
        }

      const activeId = getActiveTaskId(runtimeContext.kv, runtimeContext.storageContextId)
      if (activeId !== null) {
        const active = readRecord(runtimeContext.kv, activeId)
        if (active !== null && !isTerminal(active.status))
          return {
            error: 'conflict',
            message: 'A coding task is already running in this thread — cancel it or wait for it to finish.',
          }
      }

      const resolved = resolveRepos(runtimeContext, names)
      if ('error' in resolved) return resolved

      const kind = optionalString(args, 'kind')
      const costBudgetUsd = asNumber(args, 'costBudgetUsd')
      const result = await callNerv(httpFetch, cfg, 'POST', '/tasks', {
        ...(kind === undefined ? {} : { kind }),
        prompt,
        repos: resolved.repos,
        contextRef: { contextId: runtimeContext.storageContextId },
        source: 'chat',
        ...(resolved.targetBranch === undefined ? {} : { targetBranch: resolved.targetBranch }),
        ...(costBudgetUsd === null ? {} : { costBudgetUsd }),
      })
      const taskId = taskIdOf(result)
      if (taskId !== null) {
        const record: TaskRecord = {
          taskId,
          storageContextId: runtimeContext.storageContextId,
          title: deriveTitle(prompt),
          repos: resolved.names,
          createdAt: new Date().toISOString(),
        }
        writeRecord(runtimeContext.kv, taskId, record)
        setActive(runtimeContext.kv, runtimeContext.storageContextId, taskId)
      }
      return result
    },
  }
}

// Merge nerv's live task doc onto the local record (status/mrUrl/usageUsd) and free the thread
// pointer when the task has reached a terminal status.
function refreshFromTaskDoc(runtimeContext: RuntimeContext, taskId: string, doc: unknown): void {
  const row = asObject(doc)
  const status = optionalString(row, 'status')
  const mrUrl = optionalString(row, 'mrUrl')
  const usageUsd = asNumber(row, 'usageUsd')
  const record = readRecord(runtimeContext.kv, taskId)
  if (record !== null) {
    writeRecord(runtimeContext.kv, taskId, {
      ...record,
      ...(status === undefined ? {} : { status }),
      ...(mrUrl === undefined ? {} : { mrUrl }),
      ...(usageUsd === null ? {} : { usageUsd }),
    })
  }
  if (isTerminal(status) && getActiveTaskId(runtimeContext.kv, runtimeContext.storageContextId) === taskId)
    clearActive(runtimeContext.kv, runtimeContext.storageContextId)
}

export function codingTaskStatusTool(httpFetch: HttpFetch | undefined): Tool {
  return {
    name: 'coding_task_status',
    description:
      'Get the status of a supervised coding task (status, merge-request link, cost). Defaults to this thread’s ' +
      'current task; pass taskId to target a specific one.',
    inputSchema: taskRefSchema,
    execute: async (input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readNervConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return NOT_CONFIGURED
      const taskId =
        asString(asObject(input), 'taskId') ?? getActiveTaskId(runtimeContext.kv, runtimeContext.storageContextId)
      if (taskId === null)
        return {
          error: 'not_found',
          message: 'No coding task is running in this thread.',
        }
      const result = await callNerv(httpFetch, cfg, 'GET', `/tasks/${encodeURIComponent(taskId)}`)
      if (asObject(result)['error'] === undefined) refreshFromTaskDoc(runtimeContext, taskId, result)
      return result
    },
  }
}

export function listCodingTasksTool(httpFetch: HttpFetch | undefined): Tool {
  return {
    name: 'list_coding_tasks',
    description: 'List supervised coding tasks created from this chat group, with their latest status and cost.',
    inputSchema: emptySchema,
    execute: async (_input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readNervConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return NOT_CONFIGURED
      const records = listRecords(runtimeContext.kv)
      const enriched = await Promise.all(
        records.map(async (record): Promise<unknown> => {
          const doc = await callNerv(httpFetch, cfg, 'GET', `/tasks/${encodeURIComponent(record.taskId)}`)
          const row = asObject(doc)
          if (row['error'] !== undefined)
            return {
              taskId: record.taskId,
              title: record.title,
              repos: record.repos,
              status: record.status ?? 'unknown',
            }
          refreshFromTaskDoc(runtimeContext, record.taskId, doc)
          return {
            taskId: record.taskId,
            title: record.title,
            repos: record.repos,
            status: optionalString(row, 'status') ?? record.status,
            ...(optionalString(row, 'mrUrl') === undefined ? {} : { mrUrl: optionalString(row, 'mrUrl') }),
            ...(asNumber(row, 'usageUsd') === null ? {} : { usageUsd: asNumber(row, 'usageUsd') }),
          }
        }),
      )
      return enriched
    },
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/plugins/nerv/tools-helpers.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/nerv/tools.ts tests/plugins/nerv/tools-helpers.test.ts
git commit -m "feat(nerv-plugin): create/status/list tools + projectPath derivation"
```

---

## Task 5: Event tools (`event-tools.ts`)

**Files:**

- Create: `plugins/nerv/event-tools.ts`
- Test: covered by Task 7’s `event-tools.test.ts` (needs `support.ts`). This task only writes the source; verify it compiles via typecheck at commit time.

- [ ] **Step 1: Write the implementation**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { asObject, asString, callNerv, NOT_CONFIGURED, readNervConfig } from './client.js'
import type { HttpFetch } from './client.js'
import { clearActive, getActiveTaskId } from './history.js'
import { cancelSchema, followupSchema } from './schemas.js'
import type { RuntimeContext, Tool } from './tools.js'

function resolveTaskId(runtimeContext: RuntimeContext, args: Record<string, unknown>): string | null {
  return asString(args, 'taskId') ?? getActiveTaskId(runtimeContext.kv, runtimeContext.storageContextId)
}

function eventTool(
  httpFetch: HttpFetch | undefined,
  name: string,
  description: string,
  type: 'chat_followup' | 'steer',
): Tool {
  return {
    name,
    description,
    inputSchema: followupSchema,
    execute: async (input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readNervConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return NOT_CONFIGURED
      const args = asObject(input)
      const text = asString(args, 'text')
      if (text === null) return { error: 'invalid_input', message: 'text is required' }
      const taskId = resolveTaskId(runtimeContext, args)
      if (taskId === null)
        return {
          error: 'not_found',
          message: 'No coding task is running in this thread.',
        }
      return callNerv(httpFetch, cfg, 'POST', `/tasks/${encodeURIComponent(taskId)}/events`, {
        type,
        payload: { text },
      })
    },
  }
}

export function followupCodingTaskTool(httpFetch: HttpFetch | undefined): Tool {
  return eventTool(
    httpFetch,
    'followup_coding_task',
    'Send a follow-up instruction to this thread’s running coding task (e.g. address a review comment).',
    'chat_followup',
  )
}

export function steerCodingTaskTool(httpFetch: HttpFetch | undefined): Tool {
  return eventTool(
    httpFetch,
    'steer_coding_task',
    'Steer this thread’s running coding task mid-flight with a corrective instruction.',
    'steer',
  )
}

export function cancelCodingTaskTool(httpFetch: HttpFetch | undefined): Tool {
  return {
    name: 'cancel_coding_task',
    description: 'Cancel this thread’s running coding task (closes it on nerv).',
    inputSchema: cancelSchema,
    execute: async (input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readNervConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return NOT_CONFIGURED
      const taskId = resolveTaskId(runtimeContext, asObject(input))
      if (taskId === null)
        return {
          error: 'not_found',
          message: 'No coding task is running in this thread.',
        }
      const result = await callNerv(httpFetch, cfg, 'POST', `/tasks/${encodeURIComponent(taskId)}/events`, {
        type: 'cancel',
        payload: {},
      })
      if (asObject(result)['error'] === undefined) clearActive(runtimeContext.kv, runtimeContext.storageContextId)
      return result
    },
  }
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `bun run typecheck`
Expected: no errors in `plugins/nerv/event-tools.ts`.

- [ ] **Step 3: Commit**

```bash
git add plugins/nerv/event-tools.ts
git commit -m "feat(nerv-plugin): followup/steer/cancel event tools"
```

---

## Task 6: Manifest + activation (`plugin.json`, `index.ts`)

**Files:**

- Create: `plugins/nerv/plugin.json`
- Create: `plugins/nerv/index.ts`
- Test: `tests/plugins/nerv/support.ts` (helper), `tests/plugins/nerv/manifest.test.ts`

- [ ] **Step 1: Write the manifest**

```json
{
  "id": "nerv",
  "name": "nerv Coding Tasks",
  "version": "1.0.0",
  "description": "Create and supervise long-running GitLab-MR coding tasks via the nerv supervisor service",
  "apiVersion": 1,
  "main": "index.ts",
  "contributes": {
    "tools": [
      "create_coding_task",
      "coding_task_status",
      "list_coding_tasks",
      "followup_coding_task",
      "steer_coding_task",
      "cancel_coding_task"
    ],
    "commands": ["nerv"],
    "promptFragments": ["nerv-hint"]
  },
  "permissions": ["http", "storage", "commands", "coding.secrets"],
  "storageScope": "group",
  "providerAllowedHostsFromConfig": ["nerv_base_url"],
  "defaultEnabled": false,
  "configRequirements": [
    {
      "key": "nerv_base_url",
      "label": "nerv Base URL",
      "required": true,
      "sensitive": false,
      "scope": "admin"
    },
    {
      "key": "nerv_token",
      "label": "nerv Bearer Token",
      "required": true,
      "sensitive": true,
      "scope": "admin"
    }
  ],
  "activationTimeoutMs": 5000
}
```

- [ ] **Step 2: Write `index.ts`**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { HttpFetch } from './client.js'
import { cancelCodingTaskTool, followupCodingTaskTool, steerCodingTaskTool } from './event-tools.js'
import { codingTaskStatusTool, createCodingTaskTool, listCodingTasksTool } from './tools.js'
import type { Tool } from './tools.js'

type RegisterTool = (tool: Tool) => void
type RegisterFragment = (f: { name: string; content: string }) => void
type RegisterCommand = (c: {
  name: string
  description: string
  execute: (message: unknown, reply: { text(s: string): Promise<void> | void }, auth: unknown) => Promise<void> | void
}) => void
type LogInfo = (meta: Record<string, unknown>, msg: string) => void

type ActivationContext = {
  registerTool: RegisterTool
  registerFragment: RegisterFragment
  registerCommand: RegisterCommand
  logInfo: LogInfo
  httpFetch: HttpFetch | undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (isRecord(value)) return value
  throw new Error(message)
}

function isFn(value: unknown): value is (...args: never[]) => unknown {
  return typeof value === 'function'
}

function extractActivationContext(ctx: unknown): ActivationContext {
  const context = requireRecord(ctx, 'nerv: plugin context must be an object')
  const log = requireRecord(context['log'], 'nerv: plugin context log must be an object')
  const registration = requireRecord(context['registration'], 'nerv: plugin context registration must be an object')
  const providerRuntime = context['providerRuntime']

  if (!isFn(log['info'])) throw new Error('nerv: logger.info must be a function')
  if (!isFn(registration['registerTool'])) throw new Error('nerv: registerTool must be a function')
  if (!isFn(registration['registerPromptFragment'])) throw new Error('nerv: registerPromptFragment must be a function')
  if (!isFn(registration['registerCommand'])) throw new Error('nerv: registerCommand must be a function')

  const logInfo = log['info'] as LogInfo
  const registerTool = registration['registerTool'] as RegisterTool
  const registerFragment = registration['registerPromptFragment'] as RegisterFragment
  const registerCommand = registration['registerCommand'] as RegisterCommand

  let httpFetch: HttpFetch | undefined
  if (isRecord(providerRuntime) && isFn(providerRuntime['httpFetch']))
    httpFetch = providerRuntime['httpFetch'] as HttpFetch

  return {
    registerTool,
    registerFragment,
    registerCommand,
    logInfo,
    httpFetch,
  }
}

const NERV_PROMPT_FRAGMENT =
  'Supervised coding tasks: for long-running work — open/update a GitLab merge request and watch it until CI is ' +
  'green, iterate on review comments, or work across multiple repos — use create_coding_task(project, prompt). ' +
  'It runs until done and notifies the user; use followup_coding_task/steer_coding_task to guide it, ' +
  'cancel_coding_task to stop it, and coding_task_status/list_coding_tasks to check progress. Only one task runs ' +
  'per thread. For a single one-shot change that opens a PR immediately, use start_session (the acp plugin) instead.'

const NERV_COMMAND_TEXT =
  'nerv supervised coding tasks are available. Ask me in natural language, e.g. "supervise an MR on demo to add ' +
  'retries and keep it green", "what’s the status of my coding task?", or "tell the task to address the review ' +
  'comments".'

const factory = (): { activate(ctx: unknown): void } => ({
  activate(rawCtx: unknown): void {
    const ctx = extractActivationContext(rawCtx)
    ctx.registerTool(createCodingTaskTool(ctx.httpFetch))
    ctx.registerTool(codingTaskStatusTool(ctx.httpFetch))
    ctx.registerTool(listCodingTasksTool(ctx.httpFetch))
    ctx.registerTool(followupCodingTaskTool(ctx.httpFetch))
    ctx.registerTool(steerCodingTaskTool(ctx.httpFetch))
    ctx.registerTool(cancelCodingTaskTool(ctx.httpFetch))
    ctx.registerFragment({ name: 'nerv-hint', content: NERV_PROMPT_FRAGMENT })
    ctx.registerCommand({
      name: 'nerv',
      description: 'About nerv supervised coding tasks',
      execute: (_message: unknown, reply: { text(s: string): Promise<void> | void }): Promise<void> | void =>
        reply.text(NERV_COMMAND_TEXT),
    })
    ctx.logInfo({}, 'nerv plugin activated')
  },
})

export default factory
```

- [ ] **Step 3: Write the test support helper (`tests/plugins/nerv/support.ts`)**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolExecutionOptions } from 'ai'

import factory from '../../../plugins/nerv/index.js'
import type { PluginContext } from '../../../src/plugins/context.js'
import type {
  PluginCommand,
  PluginPromptFragment,
  PluginTool,
  PluginToolRuntimeContext,
} from '../../../src/plugins/types.js'

export type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>

export type ActivateResult = {
  tools: Map<string, PluginTool>
  command: PluginCommand | undefined
  fragment: PluginPromptFragment | undefined
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function activate(httpFetch: HttpFetch): ActivateResult {
  const tools = new Map<string, PluginTool>()
  let command: PluginCommand | undefined
  let fragment: PluginPromptFragment | undefined
  const ctx = {
    pluginId: 'nerv',
    contextId: '__system__',
    permissions: new Set(['http', 'storage', 'commands', 'coding.secrets']),
    kv: {
      get: () => undefined,
      set: () => {},
      delete: () => {},
      list: () => [],
    },
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    registration: {
      registerTool: (t: PluginTool) => {
        tools.set(t.name, t)
      },
      registerPromptFragment: (f: PluginPromptFragment) => {
        fragment = f
      },
      registerCommand: (c: PluginCommand) => {
        command = c
      },
      registerScheduledJob: () => {},
      registerAttachmentTransformer: () => {},
      registerTaskProviderType: () => {},
    },
    providerRuntime: {
      httpFetch,
      allowedHosts: new Set<string>(),
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    },
    adminConfig: { get: () => undefined },
  } as PluginContext
  factory().activate(ctx)
  return { tools, command, fragment }
}

export type FakeCodingRepos = {
  list(): { name: string; baseBranch: string }[]
  get(name: string): {
    name: string
    repoUrl: string
    baseBranch: string
    permissionPreset: string
  } | null
}

export function defaultCodingRepos(): FakeCodingRepos {
  return {
    list: () => [{ name: 'demo', baseBranch: 'main' }],
    get: (name: string) =>
      name === 'demo'
        ? {
            name: 'demo',
            repoUrl: 'https://gitlab.com/acme/demo.git',
            baseBranch: 'main',
            permissionPreset: 'cautious',
          }
        : name === 'gh'
          ? {
              name: 'gh',
              repoUrl: 'https://github.com/acme/demo.git',
              baseBranch: 'main',
              permissionPreset: 'cautious',
            }
          : null,
  }
}

export function runtimeCtx(store: Map<string, string>, codingRepos?: FakeCodingRepos): PluginToolRuntimeContext {
  const notImplemented = (): Promise<never> => Promise.reject(new Error('not implemented'))
  return {
    pluginId: 'nerv',
    storageContextId: 'pi:aW5zdA:ctx:Y2hhbg:thread:dDE',
    chatUserId: 'user-1',
    kv: {
      get: (key: string) => store.get(key),
      set: (key: string, value: string) => {
        store.set(key, value)
      },
      delete: (key: string) => {
        store.delete(key)
      },
      list: (prefix?: string) =>
        Array.from(store.entries())
          .filter(([key]) => prefix === undefined || key.startsWith(prefix))
          .map(([key, value]) => ({ key, value })),
    },
    adminConfig: {
      get: (k: string) => (k === 'nerv_base_url' ? 'http://nerv:9000' : k === 'nerv_token' ? 'tok' : undefined),
    },
    contextConfig: { get: () => undefined },
    rateLimit: { check: () => ({ allowed: true }) },
    attachments: { read: () => notImplemented() },
    codingRepos: codingRepos ?? defaultCodingRepos(),
  } as unknown as PluginToolRuntimeContext
}

export function options(): ToolExecutionOptions {
  return { toolCallId: 'c1', messages: [] }
}
```

- [ ] **Step 4: Write the manifest test (`tests/plugins/nerv/manifest.test.ts`)**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { activate, jsonResponse } from './support.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function manifestTools(): Promise<string[]> {
  const raw: unknown = await Bun.file(new URL('../../../plugins/nerv/plugin.json', import.meta.url)).json()
  const contributes = isRecord(raw) ? raw['contributes'] : undefined
  const tools = isRecord(contributes) ? contributes['tools'] : undefined
  if (!Array.isArray(tools)) throw new Error('manifest contributes.tools missing')
  return tools.filter((t): t is string => typeof t === 'string')
}

describe('nerv plugin manifest', () => {
  test('contributes.tools exactly matches the tools registered in activate()', async () => {
    const { tools } = activate(() => Promise.resolve(jsonResponse({}, 200)))
    expect([...tools.keys()].sort()).toEqual([...(await manifestTools())].sort())
  })

  test('registers the nerv command and nerv-hint fragment', async () => {
    const { command, fragment } = activate(() => Promise.resolve(jsonResponse({}, 200)))
    expect(command?.name).toBe('nerv')
    expect(fragment?.name).toBe('nerv-hint')
  })
})
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test tests/plugins/nerv/manifest.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add plugins/nerv/plugin.json plugins/nerv/index.ts tests/plugins/nerv/support.ts tests/plugins/nerv/manifest.test.ts
git commit -m "feat(nerv-plugin): manifest, activation, prompt fragment + command"
```

---

## Task 7: Tool-execution tests (create / status / list / events)

**Files:**

- Test: `tests/plugins/nerv/create-task.test.ts`, `tests/plugins/nerv/status-list.test.ts`, `tests/plugins/nerv/event-tools.test.ts`

- [ ] **Step 1: Write `create-task.test.ts`**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { getActiveTaskId, readRecord, setActive, writeRecord } from '../../../plugins/nerv/history.js'
import { createCodingTaskTool } from '../../../plugins/nerv/tools.js'
import { options, runtimeCtx } from './support.js'

type Captured = { url: string; body: unknown }

function capturingFetch(captured: Captured[], response: unknown, status = 201) {
  return (url: string, init?: RequestInit): Promise<Response> => {
    const b = init?.body
    captured.push({
      url,
      body: typeof b === 'string' && b.length > 0 ? JSON.parse(b) : null,
    })
    return Promise.resolve(
      new Response(JSON.stringify(response), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  }
}

const CTX_ID = 'pi:aW5zdA:ctx:Y2hhbg:thread:dDE'

test('create posts derived projectPath, storageContextId as contextId, source chat; records + active pointer', async () => {
  const captured: Captured[] = []
  const store = new Map<string, string>()
  const tool = createCodingTaskTool(capturingFetch(captured, { taskId: 't1' }))
  const result = await tool.execute({ project: 'demo', prompt: 'fix the CI' }, runtimeCtx(store), options())

  expect(result).toEqual({ taskId: 't1' })
  expect(captured[0]?.url).toBe('http://nerv:9000/tasks')
  expect(captured[0]?.body).toEqual({
    prompt: 'fix the CI',
    repos: [{ projectPath: 'acme/demo' }],
    contextRef: { contextId: CTX_ID },
    source: 'chat',
    targetBranch: 'main',
  })
  expect(
    readRecord(
      {
        get: (k) => store.get(k),
        set: () => {},
        delete: () => {},
        list: () => [],
      },
      't1',
    )?.title,
  ).toBe('fix the CI')
  expect(
    getActiveTaskId(
      {
        get: (k) => store.get(k),
        set: () => {},
        delete: () => {},
        list: () => [],
      },
      CTX_ID,
    ),
  ).toBe('t1')
})

test('create refuses when the thread already has a live task', async () => {
  const store = new Map<string, string>()
  const kv = {
    get: (k: string) => store.get(k),
    set: (k: string, v: string) => {
      store.set(k, v)
    },
    delete: (k: string) => {
      store.delete(k)
    },
    list: () => [],
  }
  writeRecord(kv, 't0', {
    taskId: 't0',
    storageContextId: CTX_ID,
    title: 'x',
    repos: [],
    createdAt: 'now',
    status: 'coding',
  })
  setActive(kv, CTX_ID, 't0')

  let called = false
  const tool = createCodingTaskTool(() => {
    called = true
    return Promise.resolve(new Response('{}', { status: 201 }))
  })
  const result = await tool.execute({ project: 'demo', prompt: 'again' }, runtimeCtx(store), options())
  expect((result as { error?: string }).error).toBe('conflict')
  expect(called).toBe(false)
})

test('create allows a new task once the prior one is terminal', async () => {
  const store = new Map<string, string>()
  const kv = {
    get: (k: string) => store.get(k),
    set: (k: string, v: string) => {
      store.set(k, v)
    },
    delete: (k: string) => {
      store.delete(k)
    },
    list: () => [],
  }
  writeRecord(kv, 't0', {
    taskId: 't0',
    storageContextId: CTX_ID,
    title: 'x',
    repos: [],
    createdAt: 'now',
    status: 'completed',
  })
  setActive(kv, CTX_ID, 't0')

  const tool = createCodingTaskTool(capturingFetch([], { taskId: 't1' }))
  const result = await tool.execute({ project: 'demo', prompt: 'next' }, runtimeCtx(store), options())
  expect(result).toEqual({ taskId: 't1' })
})

test('create refuses a github.com repo (not GitLab)', async () => {
  const tool = createCodingTaskTool(() => Promise.resolve(new Response('{}', { status: 201 })))
  const result = await tool.execute({ project: 'gh', prompt: 'x' }, runtimeCtx(new Map()), options())
  expect((result as { error?: string }).error).toBe('not_configured')
})

test('create returns not_found for an unknown project', async () => {
  const tool = createCodingTaskTool(() => Promise.resolve(new Response('{}', { status: 201 })))
  const result = await tool.execute({ project: 'nope', prompt: 'x' }, runtimeCtx(new Map()), options())
  expect((result as { error?: string }).error).toBe('not_found')
})

test('create returns NOT_CONFIGURED when nerv config is missing', async () => {
  const store = new Map<string, string>()
  const ctx = runtimeCtx(store)
  const noCfg = { ...ctx, adminConfig: { get: () => undefined } }
  const tool = createCodingTaskTool(() => Promise.resolve(new Response('{}', { status: 201 })))
  const result = await tool.execute({ project: 'demo', prompt: 'x' }, noCfg, options())
  expect((result as { error?: string }).error).toBe('not_configured')
})

test('multi-repo passes an array of projectPaths', async () => {
  const captured: Captured[] = []
  const tool = createCodingTaskTool(capturingFetch(captured, { taskId: 't2' }))
  await tool.execute({ projects: ['demo'], prompt: 'x' }, runtimeCtx(new Map()), options())
  expect((captured[0]?.body as { repos: unknown }).repos).toEqual([{ projectPath: 'acme/demo' }])
})
```

- [ ] **Step 2: Write `status-list.test.ts`**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { getActiveTaskId, setActive, writeRecord } from '../../../plugins/nerv/history.js'
import { codingTaskStatusTool, listCodingTasksTool } from '../../../plugins/nerv/tools.js'
import { options, runtimeCtx } from './support.js'

const CTX_ID = 'pi:aW5zdA:ctx:Y2hhbg:thread:dDE'

function kvFor(store: Map<string, string>) {
  return {
    get: (k: string) => store.get(k),
    set: (k: string, v: string) => {
      store.set(k, v)
    },
    delete: (k: string) => {
      store.delete(k)
    },
    list: (prefix?: string) =>
      Array.from(store.entries())
        .filter(([k]) => prefix === undefined || k.startsWith(prefix))
        .map(([key, value]) => ({ key, value })),
  }
}

test('status auto-resolves the thread task and surfaces status + usageUsd', async () => {
  const store = new Map<string, string>()
  const kv = kvFor(store)
  writeRecord(kv, 't1', {
    taskId: 't1',
    storageContextId: CTX_ID,
    title: 'x',
    repos: ['demo'],
    createdAt: 'now',
  })
  setActive(kv, CTX_ID, 't1')

  const tool = codingTaskStatusTool((url: string) => {
    expect(url).toBe('http://nerv:9000/tasks/t1')
    return Promise.resolve(
      new Response(JSON.stringify({ status: 'review', usageUsd: 0.42 }), {
        status: 200,
      }),
    )
  })
  const result = await tool.execute({}, runtimeCtx(store), options())
  expect(result).toEqual({ status: 'review', usageUsd: 0.42 })
})

test('status clears the active pointer when the task is terminal', async () => {
  const store = new Map<string, string>()
  const kv = kvFor(store)
  writeRecord(kv, 't1', {
    taskId: 't1',
    storageContextId: CTX_ID,
    title: 'x',
    repos: [],
    createdAt: 'now',
  })
  setActive(kv, CTX_ID, 't1')

  const tool = codingTaskStatusTool(() =>
    Promise.resolve(new Response(JSON.stringify({ status: 'completed' }), { status: 200 })),
  )
  await tool.execute({}, runtimeCtx(store), options())
  expect(getActiveTaskId(kv, CTX_ID)).toBeNull()
})

test('status returns not_found when no active task and no taskId', async () => {
  const tool = codingTaskStatusTool(() => Promise.resolve(new Response('{}', { status: 200 })))
  const result = await tool.execute({}, runtimeCtx(new Map()), options())
  expect((result as { error?: string }).error).toBe('not_found')
})

test('list enriches local records via GET /tasks/:id', async () => {
  const store = new Map<string, string>()
  const kv = kvFor(store)
  writeRecord(kv, 't1', {
    taskId: 't1',
    storageContextId: CTX_ID,
    title: 'Task one',
    repos: ['demo'],
    createdAt: 'now',
  })

  const tool = listCodingTasksTool(() =>
    Promise.resolve(
      new Response(JSON.stringify({ status: 'ci_wait', usageUsd: 1.5 }), {
        status: 200,
      }),
    ),
  )
  const result = (await tool.execute({}, runtimeCtx(store), options())) as Array<Record<string, unknown>>
  expect(result).toEqual([
    {
      taskId: 't1',
      title: 'Task one',
      repos: ['demo'],
      status: 'ci_wait',
      usageUsd: 1.5,
    },
  ])
})
```

- [ ] **Step 3: Write `event-tools.test.ts`**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { cancelCodingTaskTool, followupCodingTaskTool, steerCodingTaskTool } from '../../../plugins/nerv/event-tools.js'
import { getActiveTaskId, setActive } from '../../../plugins/nerv/history.js'
import { options, runtimeCtx } from './support.js'

const CTX_ID = 'pi:aW5zdA:ctx:Y2hhbg:thread:dDE'

type Captured = { url: string; body: unknown }

function capturingFetch(captured: Captured[]) {
  return (url: string, init?: RequestInit): Promise<Response> => {
    const b = init?.body
    captured.push({
      url,
      body: typeof b === 'string' && b.length > 0 ? JSON.parse(b) : null,
    })
    return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 202 }))
  }
}

function withActive(store: Map<string, string>, taskId: string) {
  setActive(
    {
      get: (k: string) => store.get(k),
      set: (k: string, v: string) => {
        store.set(k, v)
      },
      delete: (k: string) => {
        store.delete(k)
      },
      list: () => [],
    },
    CTX_ID,
    taskId,
  )
}

test('followup posts chat_followup with text to the thread task', async () => {
  const captured: Captured[] = []
  const store = new Map<string, string>()
  withActive(store, 't1')
  const tool = followupCodingTaskTool(capturingFetch(captured))
  await tool.execute({ text: 'address review comments' }, runtimeCtx(store), options())
  expect(captured[0]?.url).toBe('http://nerv:9000/tasks/t1/events')
  expect(captured[0]?.body).toEqual({
    type: 'chat_followup',
    payload: { text: 'address review comments' },
  })
})

test('steer posts steer with text', async () => {
  const captured: Captured[] = []
  const store = new Map<string, string>()
  withActive(store, 't1')
  const tool = steerCodingTaskTool(capturingFetch(captured))
  await tool.execute({ text: 'stop touching the config' }, runtimeCtx(store), options())
  expect(captured[0]?.body).toEqual({
    type: 'steer',
    payload: { text: 'stop touching the config' },
  })
})

test('cancel posts cancel and clears the active pointer', async () => {
  const captured: Captured[] = []
  const store = new Map<string, string>()
  withActive(store, 't1')
  const ctx = runtimeCtx(store)
  const tool = cancelCodingTaskTool(capturingFetch(captured))
  await tool.execute({}, ctx, options())
  expect(captured[0]?.body).toEqual({ type: 'cancel', payload: {} })
  expect(getActiveTaskId(ctx.kv as never, CTX_ID)).toBeNull()
})

test('explicit taskId overrides the thread pointer', async () => {
  const captured: Captured[] = []
  const store = new Map<string, string>()
  withActive(store, 't1')
  const tool = followupCodingTaskTool(capturingFetch(captured))
  await tool.execute({ taskId: 't9', text: 'go' }, runtimeCtx(store), options())
  expect(captured[0]?.url).toBe('http://nerv:9000/tasks/t9/events')
})

test('followup returns not_found with no active task', async () => {
  const tool = followupCodingTaskTool(() => Promise.resolve(new Response('{}', { status: 202 })))
  const result = await tool.execute({ text: 'go' }, runtimeCtx(new Map()), options())
  expect((result as { error?: string }).error).toBe('not_found')
})

test('followup requires text', async () => {
  const store = new Map<string, string>()
  withActive(store, 't1')
  const tool = followupCodingTaskTool(() => Promise.resolve(new Response('{}', { status: 202 })))
  const result = await tool.execute({}, runtimeCtx(store), options())
  expect((result as { error?: string }).error).toBe('invalid_input')
})
```

- [ ] **Step 4: Run all nerv plugin tests**

Run: `bun test tests/plugins/nerv/`
Expected: PASS (all files green).

- [ ] **Step 5: Commit**

```bash
git add tests/plugins/nerv/create-task.test.ts tests/plugins/nerv/status-list.test.ts tests/plugins/nerv/event-tools.test.ts
git commit -m "test(nerv-plugin): create/status/list/event tool execution"
```

---

## Task 8: Operator gating — add nerv tools to `whoMayUse` (core edit)

**Files:**

- Modify: `src/llm-orchestrator-tools.ts:38-58`
- Test: `tests/plugins/nerv/who-may-use-nerv.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { applyWhoMayUseFilter } from '../../../src/llm-orchestrator-tools.js'
import type { ToolSet } from 'ai'

function toolset(names: string[]): ToolSet {
  const out: ToolSet = {}
  for (const n of names)
    out[n] = {
      description: n,
      parameters: {},
      execute: async () => ({}),
    } as unknown as ToolSet[string]
  return out
}

const NAMES = [
  'plugin_nerv__create_coding_task',
  'plugin_nerv__followup_coding_task',
  'plugin_nerv__steer_coding_task',
  'plugin_nerv__cancel_coding_task',
  'plugin_nerv__coding_task_status',
  'plugin_nerv__list_coding_tasks',
]

test('off-allowlist actor loses nerv action tools but keeps status/list', () => {
  const filtered = applyWhoMayUseFilter(toolset(NAMES), ['alice'], 'bob')
  expect(Object.keys(filtered).sort()).toEqual(['plugin_nerv__coding_task_status', 'plugin_nerv__list_coding_tasks'])
})

test('allowlisted actor keeps all nerv tools', () => {
  const filtered = applyWhoMayUseFilter(toolset(NAMES), ['bob'], 'bob')
  expect(Object.keys(filtered).length).toBe(6)
})

test('members default keeps everything (reference-identical)', () => {
  const ts = toolset(NAMES)
  expect(applyWhoMayUseFilter(ts, 'members', 'bob')).toBe(ts)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/plugins/nerv/who-may-use-nerv.test.ts`
Expected: FAIL — the four nerv action tools are still present for `bob` (they are not yet gated).

- [ ] **Step 3: Edit `src/llm-orchestrator-tools.ts`**

Replace the existing `ACP_SESSION_ACTION_TOOLS` block (lines ~38-58) with:

```typescript
const ACP_SESSION_ACTION_TOOLS = new Set([
  'plugin_acp__start_session',
  'plugin_acp__continue_session',
  'plugin_acp__finish_session',
  'plugin_acp__cancel_session',
  'plugin_acp__answer_permission',
])

const NERV_TASK_ACTION_TOOLS = new Set([
  'plugin_nerv__create_coding_task',
  'plugin_nerv__followup_coding_task',
  'plugin_nerv__steer_coding_task',
  'plugin_nerv__cancel_coding_task',
])

// Both plugins drive the same magi-backed coding work, so they share the one who-may-use gate.
const CODING_ACTION_TOOLS = new Set([...ACP_SESSION_ACTION_TOOLS, ...NERV_TASK_ACTION_TOOLS])

/**
 * Drops coding session/task action tools for actors not on the who-may-use allowlist.
 * Returns `tools` reference-identical when `whoMayUse === 'members'` (the default).
 */
export function applyWhoMayUseFilter(tools: ToolSet, whoMayUse: 'members' | string[], chatUserId: string): ToolSet {
  if (whoMayUse === 'members') return tools
  if (whoMayUse.includes(chatUserId)) return tools
  const out: ToolSet = {}
  for (const [name, t] of Object.entries(tools)) {
    if (t !== undefined && !CODING_ACTION_TOOLS.has(name)) out[name] = t
  }
  return out
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/plugins/nerv/who-may-use-nerv.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the existing acp whoMayUse tests to confirm no regression**

Run: `bun test tests/llm-orchestrator-tools-who-may-use.test.ts`
Expected: PASS — acp action tools are still gated (they remain in `CODING_ACTION_TOOLS`).

- [ ] **Step 6: Commit**

```bash
git add src/llm-orchestrator-tools.ts tests/plugins/nerv/who-may-use-nerv.test.ts
git commit -m "feat(nerv-plugin): gate nerv action tools behind the coding whoMayUse guardrail"
```

---

## Task 9: Full-suite verification + docs cross-reference

**Files:**

- Modify: `docs/architecture/coding-stack-overview.md` (add a one-line pointer to the nerv plugin under §3), `CLAUDE.md` doc index (optional row).

- [ ] **Step 1: Run the full plugin suite + typecheck + lint**

Run:

```bash
bun test tests/plugins/nerv/
bun run typecheck
bun run lint
```

Expected: all green.

- [ ] **Step 2: Confirm the auto-reindex/codeindex sees the new files (optional sanity)**

Run: `bun test tests/plugins/nerv/manifest.test.ts` once more to confirm the manifest↔activation invariant holds after all edits.
Expected: PASS.

- [ ] **Step 3: Add a docs pointer**

In `docs/architecture/coding-stack-overview.md`, under §3.2 (or a new §3.8), add:

```markdown
### 3.8 The `plugins/nerv/` plugin (supervised tasks)

A sibling of `plugins/acp/` that is a stateless HTTP client of **nerv** (the supervisor tier), for
long-running GitLab-MR supervision. Tools: `create_coding_task`, `coding_task_status`,
`list_coding_tasks`, `followup_coding_task`, `steer_coding_task`, `cancel_coding_task`. It passes the
thread `storageContextId` as `contextRef.contextId`; nerv relays milestones back via papai's existing
`/api/notify`. Admin config `nerv_base_url`/`nerv_token`. Design:
`docs/superpowers/specs/2026-07-09-papai-nerv-plugin-design.md`.
```

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/coding-stack-overview.md
git commit -m "docs(nerv-plugin): reference the nerv plugin in the coding-stack overview"
```

- [ ] **Step 5: (Optional) verify the round-trip end-to-end**

If a nerv instance is reachable, use the `verify` skill or a manual smoke: enable the plugin for a
test context, set `nerv_base_url`/`nerv_token`, send "supervise demo to add a health check", and
confirm (a) nerv receives `POST /tasks` with `contextRef.contextId` = the thread's `storageContextId`,
and (b) a nerv → papai `/api/notify` lands back in the same thread. Otherwise, note this as a
deploy-time check per the spec’s §16 checklist.

---

## Deferred / cross-repo (not this plan)

Per spec §16 — these are **not** papai code and are out of scope for this plan, tracked for coordination:

- **nerv:** add `targetBranch` to the `POST /tasks` zod schema (the plugin already sends it; nerv currently strips it).
- **Deploy:** `nerv_token` == nerv `NERV_AUTH_TOKEN`; papai `NOTIFY_TOKEN` == nerv `PAPAI_NOTIFY_TOKEN`; magi `MAGI_NOTIFY_URL` → nerv.

---

## Self-review notes (author)

- **Spec coverage:** manifest §4→T6; token matrix §5→plan header + T9 deploy note; contextId round-trip §6→T7 create test asserts `contextRef.contextId`; projectPath §7→T4 helpers + T7; tools §8→T4/T5/T7; one-task-per-thread §9→T2 + T7 conflict/terminal tests; record store §7-store→T2; gating §11→T8; fragment/command §12→T6; cost surfacing §13→T7 status/list assert `usageUsd`; testing §14→T1-T8.
- **Type consistency:** `RuntimeContext` (tools.ts) is the single shared shape imported by `event-tools.ts`; `Tool` type shared; `TaskRecord` fields (`taskId`/`storageContextId`/`title`/`repos`/`createdAt`/`status?`/`mrUrl?`/`usageUsd?`) identical across `history.ts`, `tools.ts`, tests. Tool names identical across manifest, `index.ts`, gating set, and tests.
- **Placeholder scan:** none — every step ships complete code.
