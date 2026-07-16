<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Kiss MCP Feature Parity — Plan F4: `mcp-gitlab` Write Tools

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the four GitLab review-collaboration write tools — `gitlab_post_comment`, `gitlab_create_discussion`, `gitlab_update_mr`, `gitlab_set_mr_state` — to the `mcp-gitlab` plugin, following the forge-write boundary decision of record (**plugin = talk about the MR; magi = deliver the code**).

**Architecture:** Mirror the proven `mcp-youtrack` write structure. Extract the shared request-guards from `index.ts` into `guards.ts` (so a new `write-tools.ts` can reuse `withGitLabGuards` without a circular import). Add write methods to the GitLab client via a `sendJson` (POST/PUT) helper alongside the existing GET path. Tools carry `WRITE: … (mutates GitLab)` descriptions — the same convention as `mcp-youtrack`/`mcp-mattermost` writes — so operators gate them via `tool_prefs` (`ask`/`deny`) at enable time.

**Tech Stack:** Bun + `bun:test`; TypeScript strict, `.js` imports; no new dependencies. Runs on the injected SSRF-validated `httpFetch`; no magi/geofront changes.

> **Policy / `ask` enforcement (important).** papai has NO code-level "default `ask`" for plugin MCP tools; enforcement for the coding-agent path is **magi-side** (the MCP broker gate) plus the operator's `tool_prefs`. F4 ships the writes with `WRITE:`-labelled descriptions (the signal the gate/operator key off) exactly like the existing `mcp-youtrack`/`mcp-mattermost` writes. Per the roadmap, F4's `ask` guarantee is **contingent on the deferred magi `ask` fail-open fix** (`magi/src/mcp-broker/gate.ts`) — until that lands, `ask` behaves as `allow` in the sandbox. F4 still ships the correct labelling (future-correct, no harm) and documents the operator policy step. The two should ideally land together.

**Source of truth:** kiss `mcp/gitlab-mcp/server.ts` (write tool handlers) + `src/services/GitlabService.ts` (`postComment`/`createDiscussion`/`updateMergeRequest`). kiss delegates HTTP to `@gitbeaker`; the papai REST endpoints below are authoritative.

---

## Reference & carried process rules (Plans 1–9, F1–F3)

Read `plugins/mcp-gitlab/` and `plugins/mcp-youtrack/` (the write-tools/guards/write-client split to mirror). Carry:

- FULL `bun run lint` + `bun run knip` before EVERY commit.
- SPDX headers; `.js` import extensions; no lint-disable / type-ignore.
- **No `as` on `unknown`**; use the `isRecord`/`stringOr`/`numberOr` guards. **`strict-boolean-expressions`** — compare explicitly. **`no-inline-comments`**. **No bare-module imports** (breaks plugin discovery — the F2 lesson).
- `encodeURIComponent` EVERY caller-supplied path segment (projectPath, mrIid).
- `max-lines` 300/file, 50/function — the split below keeps every file focused; do not game.
- `bunx oxfmt` changed files before each commit. Free port 9100 before test runs: `lsof -ti :9100 | xargs kill -9`. Never run two `check:full`/`bun test --parallel` concurrently (port-9100 self-contention).
- This branch has concurrent activity from other sessions: `git add` ONLY this task's exact files (never `git add -A`).

## GitLab write REST endpoints (papai, authoritative)

| Tool                       | Method + path                                        | Body                                       | Returns                                                        |
| -------------------------- | ---------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------- |
| `gitlab_post_comment`      | `POST /projects/:id/merge_requests/:iid/notes`       | `{ body }`                                 | note `{ id }` → `{ noteId }`                                   |
| `gitlab_create_discussion` | `POST /projects/:id/merge_requests/:iid/discussions` | `{ body }`                                 | discussion `{ id, notes:[{id}] }` → `{ discussionId, noteId }` |
| `gitlab_update_mr`         | `PUT /projects/:id/merge_requests/:iid`              | `{ title?, description?, target_branch? }` | MR object → `shapeMr`                                          |
| `gitlab_set_mr_state`      | `PUT /projects/:id/merge_requests/:iid`              | `{ state_event: 'close'\|'reopen' }`       | MR object → `shapeMr`                                          |

**Scoped OUT of F4 (follow-up):** kiss's `update_mr` also resolves `assigneeUsername`/`reviewerUsernames` → user ids via a `/users?username=` lookup. That extra resolution is deferred; F4's `update_mr` covers `title`/`description`/`target_branch` (direct PUT fields, no lookup). Noted in Follow-ups.

## File structure

```
plugins/mcp-gitlab/
  guards.ts        # NEW: extracted from index.ts — ValidationError, toRecord, read* helpers,
                   #      readCreds, buildExecutionError, withGitLabGuards, GitLabToolDefinition type
  client.ts        # ADD sendJson(POST/PUT) + postComment/createDiscussion/updateMr/setMrState
  format.ts        # ADD shapePostedComment, shapeCreatedDiscussion
  input-schema.ts  # ADD 4 write schemas (+ shared mrIid const)
  write-tools.ts   # NEW: execute* writes + buildWriteToolDefinitions (mirrors mcp-youtrack/write-tools.ts)
  index.ts         # import guards from ./guards.js; register read + write tool definitions
  plugin.json      # contributes.tools += the 4 write tool names
  README.md        # writes section + operator tool_prefs policy note + magi-ask caveat
tests/plugins/
  mcp-gitlab-writes.test.ts   # NEW: client write methods + tool-level execution + validation
  mcp-gitlab.test.ts          # (unchanged unless a read helper moved breaks an import path)
tests/mcp-server/
  mcp-gitlab-listing.test.ts  # MODIFY: 5 -> 9 tools
docs/architecture/coding-stack-overview.md  # note gitlab writes (talk-about-the-MR boundary)
```

---

## Task 1: extract shared `guards.ts` (pure refactor, no behavior change)

**Files:** `plugins/mcp-gitlab/guards.ts` (new), `plugins/mcp-gitlab/index.ts` (import from it).

- [ ] **Step 1: Create `plugins/mcp-gitlab/guards.ts`** by MOVING these members out of `index.ts` verbatim (adjust to `export`). It imports `GitLabClient` from `./client.js` and the types from `./context.js`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { GitLabClient } from './client.js'
import type { HttpFetch, PluginToolRuntimeContextLike } from './context.js'

export class ValidationError extends Error {}

export type GitLabToolDefinition = {
  name: string
  description: string
  inputSchema: unknown
  execute: (input: unknown, runtimeContext: PluginToolRuntimeContextLike) => Promise<unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function toRecord(input: unknown): Record<string, unknown> {
  if (!isRecord(input)) {
    throw new ValidationError('input must be an object')
  }
  return input
}

export function readRequiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value === '') {
    throw new ValidationError(`${key} must be a non-empty string`)
  }
  return value
}

export function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

export function readOptionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  return typeof value === 'number' ? value : undefined
}

export function readOptionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key]
  return typeof value === 'boolean' ? value : undefined
}

function resolveRateLimitActorId(runtimeContext: PluginToolRuntimeContextLike): string {
  if (runtimeContext.chatUserId !== '') return runtimeContext.chatUserId
  return runtimeContext.storageContextId
}

type GitLabCreds = { baseUrl: string; token: string }

function readCreds(runtimeContext: PluginToolRuntimeContextLike): GitLabCreds | undefined {
  const baseUrl = runtimeContext.adminConfig.get('base_url')
  const token = runtimeContext.adminConfig.get('token')
  if (baseUrl === undefined || token === undefined) return undefined
  return { baseUrl, token }
}

export function buildExecutionError(err: unknown): unknown {
  if (err instanceof ValidationError) {
    return { error: 'validation_error', message: err.message }
  }
  const message = err instanceof Error ? err.message : String(err)
  if (err instanceof Error && err.name === 'AbortError') {
    return { error: 'timeout', message }
  }
  return { error: 'gitlab_error', message }
}

export async function withGitLabGuards(
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
  run: (client: GitLabClient) => Promise<unknown>,
): Promise<unknown> {
  const rateResult = runtimeContext.rateLimit.check(resolveRateLimitActorId(runtimeContext))
  if (!rateResult.allowed) {
    return { error: 'rate_limited', retryAfterSec: rateResult.retryAfterSec }
  }

  const creds = readCreds(runtimeContext)
  if (creds === undefined || httpFetch === undefined) {
    return { error: 'not_configured', message: 'GitLab is not configured' }
  }

  const client = new GitLabClient({ baseUrl: creds.baseUrl, token: creds.token, httpFetch })

  try {
    return await run(client)
  } catch (err) {
    return buildExecutionError(err)
  }
}
```

- [ ] **Step 2: Edit `plugins/mcp-gitlab/index.ts`** — DELETE the moved members (`ValidationError`, `isRecord`, `toRecord`, `readRequiredString`, `readOptionalString`, `readOptionalNumber`, `readOptionalBoolean`, `resolveRateLimitActorId`, `GitLabCreds`, `readCreds`, `buildExecutionError`, `withGitLabGuards`, and the local `GitLabToolDefinition` type) and instead import what it still uses from `./guards.js`:

```typescript
import {
  ValidationError,
  readOptionalBoolean,
  readOptionalNumber,
  readOptionalString,
  readRequiredString,
  toRecord,
  withGitLabGuards,
  type GitLabToolDefinition,
} from './guards.js'
```

Keep everything else in `index.ts` (the `executeGet*` read functions, `buildToolDefinitions`, `factory`). The `executeGetJob` still uses `parseJobUrl` (from `./format.js`) and `ValidationError` (now from guards). `buildToolDefinitions` returns `GitLabToolDefinition[]` (now imported). If any moved helper is now unused in index.ts, remove its usage cleanly (there should be none left dangling).

- [ ] **Step 3: Run** `lsof -ti :9100 | xargs kill -9`, then `bun test tests/plugins/mcp-gitlab.test.ts tests/plugins/mcp-gitlab-pagination.test.ts tests/mcp-server/mcp-gitlab-listing.test.ts tests/plugins/mcp-gitlab-schema.test.ts` → ALL PASS unchanged (pure refactor — reads behave identically).
- [ ] **Step 4: Gate.** `bun run typecheck`; FULL `bun run lint`; `bun run knip` — `guards.ts` is consumed by `index.ts` (and `write-tools.ts` in Task 3). If knip flags any `guards.ts` export as unused at this point (e.g. `withGitLabGuards` is used, but `readOptionalBoolean` etc. — all are used by index reads), it should be clean; if a specific export is flagged because only write-tools will use it, add a temporary `"plugins/mcp-gitlab/guards.ts": ["exports"]` ignore with a `// TEMP F4 T1: consumed by write-tools.ts in Task 3` comment, removed in Task 3. `bunx oxfmt` changed files.
- [ ] **Step 5: Commit.**

```bash
git add plugins/mcp-gitlab/guards.ts plugins/mcp-gitlab/index.ts knip.jsonc
git commit -m "refactor(mcp-gitlab): extract request guards into guards.ts"
```

---

## Task 2: client write methods + format shapers + write schemas

**Files:** `plugins/mcp-gitlab/client.ts`, `plugins/mcp-gitlab/format.ts`, `plugins/mcp-gitlab/input-schema.ts`, `tests/plugins/mcp-gitlab-writes.test.ts` (new, client portion).

- [ ] **Step 1: Add shapers to `plugins/mcp-gitlab/format.ts`** (reuse existing `isRecord`/`stringOr`/`numberOr`):

```typescript
export function shapePostedComment(raw: unknown): { noteId?: number } {
  if (!isRecord(raw)) return {}
  const noteId = numberOr(raw['id'])
  return noteId === undefined ? {} : { noteId }
}

export function shapeCreatedDiscussion(raw: unknown): { discussionId?: string; noteId?: number } {
  if (!isRecord(raw)) return {}
  const discussionId = stringOr(raw['id'])
  const notes = raw['notes']
  const firstNote = Array.isArray(notes) && isRecord(notes[0]) ? notes[0] : undefined
  const noteId = firstNote === undefined ? undefined : numberOr(firstNote['id'])
  return {
    ...(discussionId === undefined ? {} : { discussionId }),
    ...(noteId === undefined ? {} : { noteId }),
  }
}
```

- [ ] **Step 2: Add write methods to `plugins/mcp-gitlab/client.ts`.** Add `shapePostedComment`, `shapeCreatedDiscussion`, `shapeMr` to the `./format.js` import (shapeMr is already imported). Add a private `sendJson` helper and the four write methods (place after `getJob`):

```typescript
  private async sendJson(method: 'POST' | 'PUT', path: string, body: unknown): Promise<unknown> {
    const res = await this.httpFetch(`${this.baseUrl}/api/v4${path}`, {
      method,
      headers: {
        'PRIVATE-TOKEN': this.token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      throw new Error(`GitLab API ${res.status} for ${path}`)
    }
    return res.json()
  }

  async postComment(projectPath: string, mrIid: string, body: string): Promise<unknown> {
    const base = `/projects/${encodeURIComponent(projectPath)}/merge_requests/${encodeURIComponent(mrIid)}`
    return shapePostedComment(await this.sendJson('POST', `${base}/notes`, { body }))
  }

  async createDiscussion(projectPath: string, mrIid: string, body: string): Promise<unknown> {
    const base = `/projects/${encodeURIComponent(projectPath)}/merge_requests/${encodeURIComponent(mrIid)}`
    return shapeCreatedDiscussion(await this.sendJson('POST', `${base}/discussions`, { body }))
  }

  async updateMr(
    projectPath: string,
    mrIid: string,
    fields: { title?: string; description?: string; targetBranch?: string },
  ): Promise<unknown> {
    const body: Record<string, unknown> = {}
    if (fields.title !== undefined) body['title'] = fields.title
    if (fields.description !== undefined) body['description'] = fields.description
    if (fields.targetBranch !== undefined) body['target_branch'] = fields.targetBranch
    const path = `/projects/${encodeURIComponent(projectPath)}/merge_requests/${encodeURIComponent(mrIid)}`
    return shapeMr(await this.sendJson('PUT', path, body))
  }

  async setMrState(projectPath: string, mrIid: string, stateEvent: 'close' | 'reopen'): Promise<unknown> {
    const path = `/projects/${encodeURIComponent(projectPath)}/merge_requests/${encodeURIComponent(mrIid)}`
    return shapeMr(await this.sendJson('PUT', path, { state_event: stateEvent }))
  }
```

- [ ] **Step 3: Add write schemas to `plugins/mcp-gitlab/input-schema.ts`.** Add a shared `mrIid` const near the existing `projectPath` const, then the four schemas:

```typescript
const mrIid = { type: 'string', minLength: 1, description: 'MR iid, e.g. "42"' } as const

export const gitlabPostCommentSchema = {
  type: 'object',
  properties: { projectPath, mrIid, body: { type: 'string', minLength: 1, description: 'Comment body (Markdown)' } },
  required: ['projectPath', 'mrIid', 'body'],
  additionalProperties: false,
} as const

export const gitlabCreateDiscussionSchema = {
  type: 'object',
  properties: {
    projectPath,
    mrIid,
    body: { type: 'string', minLength: 1, description: 'First note of the new discussion thread (Markdown)' },
  },
  required: ['projectPath', 'mrIid', 'body'],
  additionalProperties: false,
} as const

export const gitlabUpdateMrSchema = {
  type: 'object',
  properties: {
    projectPath,
    mrIid,
    title: { type: 'string', minLength: 1, description: 'New MR title' },
    description: { type: 'string', description: 'New MR description (Markdown)' },
    targetBranch: { type: 'string', minLength: 1, description: 'New target branch' },
  },
  required: ['projectPath', 'mrIid'],
  additionalProperties: false,
} as const

export const gitlabSetMrStateSchema = {
  type: 'object',
  properties: { projectPath, mrIid, stateEvent: { type: 'string', enum: ['close', 'reopen'] } },
  required: ['projectPath', 'mrIid', 'stateEvent'],
  additionalProperties: false,
} as const
```

> Note: `gitlabGetMrInfoSchema` already inlines its own `mrIid` property; leave it as-is (do not refactor it to the shared const — out of scope).

- [ ] **Step 4: Write failing client tests** — `tests/plugins/mcp-gitlab-writes.test.ts` (client portion). Mirror the mock-`httpFetch` capture style from `tests/plugins/mcp-gitlab-pagination.test.ts` (capture method + url + body):

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { GitLabClient } from '../../plugins/mcp-gitlab/client.js'

interface Captured {
  url: string
  method: string | undefined
  body: unknown
}

function captureFetch(responseBody: unknown): {
  httpFetch: (url: string, init: RequestInit | undefined) => Promise<Response>
  captured: Captured[]
} {
  const captured: Captured[] = []
  const httpFetch = (url: string, init: RequestInit | undefined): Promise<Response> => {
    const rawBody = typeof init?.body === 'string' ? init.body : undefined
    captured.push({ url, method: init?.method, body: rawBody === undefined ? undefined : JSON.parse(rawBody) })
    return Promise.resolve(new Response(JSON.stringify(responseBody), { status: 201 }))
  }
  return { httpFetch, captured }
}

function client(httpFetch: (url: string, init: RequestInit | undefined) => Promise<Response>): GitLabClient {
  return new GitLabClient({ baseUrl: 'https://gl.example.com', token: 'tok', httpFetch })
}

describe('GitLabClient writes', () => {
  test('postComment POSTs a note and returns the noteId', async () => {
    const { httpFetch, captured } = captureFetch({ id: 7, body: 'hi' })
    const out = await client(httpFetch).postComment('group/proj', '42', 'hi')
    expect(out).toEqual({ noteId: 7 })
    expect(captured[0]?.method).toBe('POST')
    expect(captured[0]?.url).toBe('https://gl.example.com/api/v4/projects/group%2Fproj/merge_requests/42/notes')
    expect(captured[0]?.body).toEqual({ body: 'hi' })
  })

  test('createDiscussion POSTs a discussion and returns discussionId + noteId', async () => {
    const { httpFetch, captured } = captureFetch({ id: 'abc123', notes: [{ id: 9 }] })
    const out = await client(httpFetch).createDiscussion('group/proj', '42', 'thread start')
    expect(out).toEqual({ discussionId: 'abc123', noteId: 9 })
    expect(captured[0]?.url).toBe('https://gl.example.com/api/v4/projects/group%2Fproj/merge_requests/42/discussions')
    expect(captured[0]?.body).toEqual({ body: 'thread start' })
  })

  test('updateMr PUTs only provided fields (targetBranch -> target_branch) and shapes the MR', async () => {
    const { httpFetch, captured } = captureFetch({ title: 'New', state: 'opened' })
    const out = await client(httpFetch).updateMr('group/proj', '42', { title: 'New', targetBranch: 'main' })
    expect(out).toEqual({ title: 'New', state: 'opened' })
    expect(captured[0]?.method).toBe('PUT')
    expect(captured[0]?.url).toBe('https://gl.example.com/api/v4/projects/group%2Fproj/merge_requests/42')
    expect(captured[0]?.body).toEqual({ title: 'New', target_branch: 'main' })
  })

  test('setMrState PUTs state_event and shapes the MR', async () => {
    const { httpFetch, captured } = captureFetch({ title: 'X', state: 'closed' })
    const out = await client(httpFetch).setMrState('group/proj', '42', 'close')
    expect(out).toEqual({ title: 'X', state: 'closed' })
    expect(captured[0]?.body).toEqual({ state_event: 'close' })
  })

  test('a non-ok write surfaces a clean error', async () => {
    const httpFetch = (): Promise<Response> => Promise.resolve(new Response('{}', { status: 403 }))
    await expect(client(httpFetch).postComment('group/proj', '42', 'hi')).rejects.toThrow(/GitLab API 403/u)
  })
})
```

- [ ] **Step 5: Run** `bun test tests/plugins/mcp-gitlab-writes.test.ts` → RED first (methods missing), then implement Steps 1–3 → GREEN (5 pass).
- [ ] **Step 6: Gate.** `bun run typecheck`; FULL `bun run lint`; `bun run knip` (the new shapers/schemas are consumed by the test now and by write-tools in Task 3 — if knip flags a shaper/schema export as unused at this point, add a temporary `["exports"]` ignore for `plugins/mcp-gitlab/format.ts` and/or `input-schema.ts` with a `// TEMP F4 T2: consumed by write-tools.ts in Task 3` comment, removed in Task 3). `bunx oxfmt` changed files.
- [ ] **Step 7: Commit.**

```bash
git add plugins/mcp-gitlab/client.ts plugins/mcp-gitlab/format.ts plugins/mcp-gitlab/input-schema.ts tests/plugins/mcp-gitlab-writes.test.ts knip.jsonc
git commit -m "feat(mcp-gitlab): client write methods (comment/discussion/update/state)"
```

---

## Task 3: `write-tools.ts` + register + manifest + tool-level tests

**Files:** `plugins/mcp-gitlab/write-tools.ts` (new), `plugins/mcp-gitlab/index.ts`, `plugins/mcp-gitlab/plugin.json`, `tests/plugins/mcp-gitlab-writes.test.ts` (tool portion), `tests/mcp-server/mcp-gitlab-listing.test.ts`, `knip.jsonc` (remove temp ignores).

- [ ] **Step 1: Create `plugins/mcp-gitlab/write-tools.ts`** (mirrors `mcp-youtrack/write-tools.ts`):

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { HttpFetch, PluginToolRuntimeContextLike } from './context.js'
import {
  ValidationError,
  readOptionalString,
  readRequiredString,
  toRecord,
  withGitLabGuards,
  type GitLabToolDefinition,
} from './guards.js'
import {
  gitlabCreateDiscussionSchema,
  gitlabPostCommentSchema,
  gitlabSetMrStateSchema,
  gitlabUpdateMrSchema,
} from './input-schema.js'

function executePostComment(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withGitLabGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.postComment(
      readRequiredString(record, 'projectPath'),
      readRequiredString(record, 'mrIid'),
      readRequiredString(record, 'body'),
    )
  })
}

function executeCreateDiscussion(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withGitLabGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.createDiscussion(
      readRequiredString(record, 'projectPath'),
      readRequiredString(record, 'mrIid'),
      readRequiredString(record, 'body'),
    )
  })
}

function executeUpdateMr(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withGitLabGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    const fields = {
      title: readOptionalString(record, 'title'),
      description: readOptionalString(record, 'description'),
      targetBranch: readOptionalString(record, 'targetBranch'),
    }
    if (fields.title === undefined && fields.description === undefined && fields.targetBranch === undefined) {
      throw new ValidationError('provide at least one of title, description, targetBranch')
    }
    return client.updateMr(readRequiredString(record, 'projectPath'), readRequiredString(record, 'mrIid'), fields)
  })
}

function readStateEvent(record: Record<string, unknown>): 'close' | 'reopen' {
  const value = readRequiredString(record, 'stateEvent')
  if (value !== 'close' && value !== 'reopen') {
    throw new ValidationError('stateEvent must be "close" or "reopen"')
  }
  return value
}

function executeSetMrState(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withGitLabGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.setMrState(
      readRequiredString(record, 'projectPath'),
      readRequiredString(record, 'mrIid'),
      readStateEvent(record),
    )
  })
}

export function buildWriteToolDefinitions(getHttpFetch: () => HttpFetch | undefined): GitLabToolDefinition[] {
  return [
    {
      name: 'gitlab_post_comment',
      description: 'WRITE: post a comment on a GitLab merge request (mutates GitLab)',
      inputSchema: gitlabPostCommentSchema,
      execute: (input, runtimeContext) => executePostComment(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'gitlab_create_discussion',
      description: 'WRITE: open a new discussion thread on a GitLab merge request (mutates GitLab)',
      inputSchema: gitlabCreateDiscussionSchema,
      execute: (input, runtimeContext) => executeCreateDiscussion(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'gitlab_update_mr',
      description: 'WRITE: update a GitLab merge request title/description/target branch (mutates GitLab)',
      inputSchema: gitlabUpdateMrSchema,
      execute: (input, runtimeContext) => executeUpdateMr(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'gitlab_set_mr_state',
      description: 'WRITE: close or reopen a GitLab merge request (mutates GitLab)',
      inputSchema: gitlabSetMrStateSchema,
      execute: (input, runtimeContext) => executeSetMrState(input, runtimeContext, getHttpFetch()),
    },
  ]
}
```

- [ ] **Step 2: Register the writes in `plugins/mcp-gitlab/index.ts`.** Import `buildWriteToolDefinitions` from `./write-tools.js`. In `activate`, after registering the read tools, register the writes too:

```typescript
for (const tool of buildToolDefinitions(() => httpFetch)) {
  pluginContext.registration.registerTool(tool)
}
for (const tool of buildWriteToolDefinitions(() => httpFetch)) {
  pluginContext.registration.registerTool(tool)
}
```

- [ ] **Step 3: Add the four tool names to `plugins/mcp-gitlab/plugin.json`** `contributes.tools`:

```json
    "tools": [
      "gitlab_get_repository_tree",
      "gitlab_get_file_content",
      "gitlab_get_mr_info",
      "gitlab_get_mrs",
      "gitlab_get_job",
      "gitlab_post_comment",
      "gitlab_create_discussion",
      "gitlab_update_mr",
      "gitlab_set_mr_state"
    ],
```

- [ ] **Step 4: Remove any temporary knip ignores** added in Tasks 1–2 for `guards.ts`/`format.ts`/`input-schema.ts` — all their exports are now reached from `index.ts` via `write-tools.ts`. Keep `"plugins/mcp-gitlab/index.ts": ["exports"]`.

- [ ] **Step 5: Add tool-level tests** to `tests/plugins/mcp-gitlab-writes.test.ts`. Mirror the mock runtime-context pattern from the tool-execution tests in `tests/plugins/mcp-gitlab.test.ts` (build a runtimeContext whose `adminConfig.get` returns `base_url`/`token`, `rateLimit.check` returns `{allowed:true}`; activate the plugin factory with a mock httpFetch; grab the registered tool by name; call its `execute`). Add:
  - `gitlab_post_comment` execution posts the note and returns `{ noteId }`.
  - `gitlab_update_mr` with NO title/description/targetBranch returns `{ error: 'validation_error', ... }` (message contains "at least one").
  - `gitlab_set_mr_state` with `stateEvent: 'merge'` (invalid) → JSON-schema wise it's rejected upstream, but the `readStateEvent` guard also returns `{ error: 'validation_error' }` — assert that path by calling execute with `stateEvent: 'bogus'`.
    Follow the file's existing harness exactly; do not invent a new one.

- [ ] **Step 6: Update `tests/mcp-server/mcp-gitlab-listing.test.ts`** — the plugin now exposes 9 tools. Update the `GITLAB_TOOL_NAMES` constant (add the 4 write names) and the `toHaveLength(5)` → `toHaveLength(9)`. The test asserts names sorted + non-empty descriptions + object input schemas; the writes satisfy all three.

- [ ] **Step 7: Run** `lsof -ti :9100 | xargs kill -9`, then `bun test tests/plugins/mcp-gitlab-writes.test.ts tests/mcp-server/mcp-gitlab-listing.test.ts tests/plugins/mcp-gitlab.test.ts` → PASS.
- [ ] **Step 8: Gate.** `bun run typecheck`; FULL `bun run lint`; `bun run knip` (clean; no leftover temp ignores). `bunx oxfmt` changed files.
- [ ] **Step 9: Commit.**

```bash
git add plugins/mcp-gitlab/write-tools.ts plugins/mcp-gitlab/index.ts plugins/mcp-gitlab/plugin.json tests/plugins/mcp-gitlab-writes.test.ts tests/mcp-server/mcp-gitlab-listing.test.ts knip.jsonc
git commit -m "feat(mcp-gitlab): register 4 MR write tools (comment/discussion/update/state)"
```

---

## Task 4: README + docs + schema test + full gate

**Files:** `plugins/mcp-gitlab/README.md`, `docs/architecture/coding-stack-overview.md`, `tests/plugins/mcp-gitlab-schema.test.ts`.

- [ ] **Step 1: Update `plugins/mcp-gitlab/README.md`.** Add a "Write tools" section listing the four (`gitlab_post_comment`, `gitlab_create_discussion`, `gitlab_update_mr`, `gitlab_set_mr_state`) and what each mutates. Add an operator-policy note mirroring `plugins/mcp-youtrack/README.md`/`plugins/mcp-mattermost/README.md`: these four `WRITE:` tools mutate live GitLab state; operators who want a confirmation gate should set their `tool_prefs` policy to `ask` (or `deny`) at enable time via the settings UI. Add the boundary note: this plugin handles **review-collaboration** writes (comments/discussions/MR metadata & state) using its own GitLab token; **code delivery** (push/PR-open/merge) remains magi's domain. Optionally note that `ask` enforcement in coding sessions depends on the magi broker gate.

- [ ] **Step 2: Update `docs/architecture/coding-stack-overview.md`** — the `mcp-gitlab` mention now includes write tools (the talk-about-the-MR boundary). Small, consistent edit.

- [ ] **Step 3: Update `tests/plugins/mcp-gitlab-schema.test.ts`** if it asserts the exact tool-schema set — add acceptance/rejection assertions for the four write schemas (e.g. `gitlabPostCommentSchema` requires `projectPath`/`mrIid`/`body`; `gitlabSetMrStateSchema.properties.stateEvent.enum` = `['close','reopen']`; `gitlabUpdateMrSchema.required` = `['projectPath','mrIid']`). Follow the file's existing assertion style.

- [ ] **Step 4: Full gate.** `lsof -ti :9100 | xargs kill -9`, then `bun run check:full` → 12/12 (if the `test` step flakes under contention, re-run standalone `bun test` to confirm environmental — do NOT run concurrent gates). Commit:

```bash
git add plugins/mcp-gitlab/README.md docs/architecture/coding-stack-overview.md tests/plugins/mcp-gitlab-schema.test.ts
git commit -m "docs(mcp-gitlab): document MR write tools + operator policy"
```

---

## Self-review (plan author)

- **Spec coverage (F4):** the four writes (`post_comment`/`create_discussion`/`update_mr`/`set_mr_state`) with `WRITE:` labelling per the forge-write boundary decision → Tasks 2–3; operator `tool_prefs` policy + magi-`ask` caveat documented → Task 4. `update_mr` covers title/description/target_branch; assignee/reviewer resolution scoped OUT (follow-up).
- **Type consistency:** `GitLabToolDefinition` defined once in `guards.ts`, imported by `index.ts` + `write-tools.ts`. Write methods return `unknown` (shaped); `updateMr` fields typed `{title?,description?,targetBranch?}`; `setMrState` param `'close'|'reopen'` narrowed via `readStateEvent`. `sendJson` method `'POST'|'PUT'`.
- **Security / correctness:** every path segment `encodeURIComponent`'d; writes reuse `withGitLabGuards` (rate-limit + creds + error shaping); non-ok → `GitLab API <status>`; the plugin's existing `not_configured`/`rate_limited`/`validation_error`/`gitlab_error` shapes apply to writes too. No token in any error string. No new bare-module imports.
- **Refactor safety:** Task 1 is a pure move (reads keep passing) so the write additions in Tasks 2–3 build on a stable, deduplicated guard surface. The circular-import risk (`index.ts` ↔ `write-tools.ts`) is avoided by both importing guards from `guards.ts`.
- **Deliberate divergence from kiss:** kiss's `update_mr` resolves assignee/reviewer usernames → ids; F4 defers that (needs a `/users` lookup) and covers the direct PUT fields. kiss uses `@gitbeaker`; papai issues the REST calls directly via `sendJson`.
- **Placeholders:** none — all code inline. Tool-level test harness references the existing pattern in `mcp-gitlab.test.ts` (the plan does not re-paste that whole harness, since it already exists in-repo and the subagent is told to mirror it exactly).

## Follow-ups (this plan + carried)

- **`update_mr` assignee/reviewer resolution** (username → id via `/users?username=`) — deferred; add as a small enhancement if demanded.
- **magi `ask` fail-open fix** (`magi/src/mcp-broker/gate.ts`) — until it lands, F4's `ask` policy behaves as `allow` in coding sessions. Highest-leverage carried security item; should ideally land alongside F4.
- Carried (roadmap §5): per-plugin redaction-prompt override, `mcp_redaction` settings-UI + unset/DELETE, `abortSignal` threading, figma follow-ons, mattermost binary delivery (F5), the dead `key === 'key'` branch in `mcp-sentry/format.ts`, magi `npm_publish`.
- **Next in sequence:** F5 (Mattermost binary-attachment delivery via a papai-hosted signed URL).
