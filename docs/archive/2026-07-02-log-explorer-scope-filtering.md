<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Log Explorer Scope Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the debug Log Explorer's single exact-match scope dropdown with server-side, whole-buffer filtering supporting include/exclude scope allowlists with prefix matching, all-fields substring search, live-tail filtering via SSE query params, and URL-encoded filter state.

**Architecture:** A single shared filter model (`src/debug/log-filter-model.ts`) defines the `LogFilter` type and the matching logic used by three consumers: the `GET /logs` historical query, the `GET /logs/stats` matching count, and the per-connection SSE `log:entry` predicate. The client encodes the filter into the query string of both `/logs` and `/events`, so history and live tail are consistent by construction; changing a filter reconnects the SSE stream and refetches. The client's Fuse.js fuzzy search is removed in favor of server substring search.

**Tech Stack:** Bun runtime, TypeScript (strict, `.js` import extensions), Zod v4, Svelte 5 (`$state`/`$derived`/`$effect`/`$props`/`{#snippet}`), pino, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-07-02-log-explorer-scope-filtering-design.md`

---

## Reference: current code being changed

- `src/debug/log-buffer.ts` — `LogRingBuffer` with `search({level, scope, turnId, q, limit, before})` (single exact `scope`, msg-only `q`), `stats()`, and the `LogEntry` type. Default instance `logBuffer`.
- `src/debug/server.ts:80-102` — `parseIntParam`, `searchParam`, `handleLogs(url)`. Routing in `routeProtectedPaths` (`:160`): `/logs`, `/logs/stats`, `/events`. `handleEvents(req)` at `:56` calls `addClient(controller)`. `DEBUG_ONLY_PATHS` at `:107`.
- `src/debug/state-collector.ts` — `clients: Set<ReadableStreamDefaultController>`, `addClient`/`removeClient`, `onEvent`/`broadcast`, `pingClients`.
- `src/debug/log-stats-schema.ts` — `LogBufferStatsSchema`, `safeParseLogBufferStats`.
- `client/debug/log-filter.ts` — Fuse-based `updateFuseIndex`, `filterLogsWithIndex`, `flattenLogEntry` (to be removed/moved).
- `client/debug/log-bootstrap.ts` — `buildLogsUrl`, `fetchInitialLogs`, `fetchOlderLogs`, `fetchLogStats`, `collectScopes`.
- `client/debug/sse.ts` — `setupEventSource` opens `new EventSource('/events')`.
- `client/debug/components/LogExplorer.svelte` — level/scope `Select`s, search `Input`, client-side filtering.
- `client/debug/DebugApp.svelte` — bootstraps logs + SSE.
- `client/debug/dashboard-types.ts` — `DashboardState`, `activeLogFilter: { turnId?: string }`.

## File structure (created / modified)

**Server**

- Create `src/debug/log-filter-model.ts` — `LogFilter` type, `matchesScope`, `flattenLogEntry`, `entryMatchesFilter`, `applyFilter`, `parseLogFilter`, `NONE_TOKEN`.
- Modify `src/debug/log-buffer.ts` — `search` takes `LogFilter & {before?, limit?}`; add `countMatching`, `distinctScopes`.
- Modify `src/debug/server.ts` — `handleLogs` parses `LogFilter`; new `handleLogScopes`; `/logs/stats` adds `matchingCount`; `handleEvents` parses filter and passes to `addClient`; register `/logs/scopes` route + `DEBUG_ONLY_PATHS`.
- Modify `src/debug/state-collector.ts` — `clients: Map<controller, LogFilter>`; `addClient(controller, filter)`; `broadcast` applies predicate to `log:entry` only.
- Modify `src/debug/log-stats-schema.ts` — add optional `matchingCount`.

**Client**

- Modify `client/debug/dashboard-types.ts` — `activeLogFilter` becomes full `LogFilter`; add `logScopeCounts`.
- Create `client/debug/log-filter-url.ts` — `LogFilter` (client mirror via import), `emptyFilter`, `filterToParams`, `filterFromParams`, `filterToQuery`.
- Modify `client/debug/log-bootstrap.ts` — `buildLogsUrl` accepts filter; add `fetchScopes`.
- Create `client/debug/components/ScopeFilter.svelte` — namespace-grouped include/exclude picker.
- Modify `client/debug/components/LogExplorer.svelte` — remove Fuse; render server-filtered logs; wire ScopeFilter + level + search into `dashboard.activeLogFilter`.
- Modify `client/debug/sse.ts` — `setupEventSource` accepts a query string for `/events`.
- Modify `client/debug/DebugApp.svelte` — own filter state from URL; refetch + reconnect on change.
- Delete `client/debug/log-filter.ts` and `tests/client/debug/log-filter.test.ts` (Fuse path removed).

---

## Task 1: Shared filter model

**Files:**

- Create: `src/debug/log-filter-model.ts`
- Test: `tests/debug/log-filter-model.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/debug/log-filter-model.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { LogEntry } from '../../src/debug/log-buffer.js'
import {
  applyFilter,
  entryMatchesFilter,
  flattenLogEntry,
  matchesScope,
  NONE_TOKEN,
  parseLogFilter,
  type LogFilter,
} from '../../src/debug/log-filter-model.js'

const entry = (o: Partial<LogEntry> = {}): LogEntry => ({
  level: 30,
  time: '2026-07-02T00:00:00.000Z',
  msg: 'hello',
  ...o,
})

const filter = (o: Partial<LogFilter> = {}): LogFilter => ({ include: [], exclude: [], level: 0, ...o })

describe('matchesScope', () => {
  test('exact match', () => {
    expect(matchesScope('chat:telegram', 'chat:telegram')).toBe(true)
    expect(matchesScope('chat:telegram', 'chat:telegram:files')).toBe(false)
  })
  test('bare namespace matches on segment boundary, not substring', () => {
    expect(matchesScope('chat', 'chat')).toBe(true)
    expect(matchesScope('chat', 'chat:telegram')).toBe(true)
    expect(matchesScope('chat', 'chat:telegram:files')).toBe(true)
    expect(matchesScope('chat', 'chatbot')).toBe(false)
  })
  test('wildcard namespace form', () => {
    expect(matchesScope('chat:telegram:*', 'chat:telegram')).toBe(true)
    expect(matchesScope('chat:telegram:*', 'chat:telegram:files')).toBe(true)
    expect(matchesScope('chat:telegram:*', 'chat:mattermost')).toBe(false)
  })
})

describe('entryMatchesFilter', () => {
  test('empty include means all scopes', () => {
    expect(entryMatchesFilter(entry({ scope: 'bot' }), filter())).toBe(true)
  })
  test('include allowlist restricts', () => {
    expect(entryMatchesFilter(entry({ scope: 'bot' }), filter({ include: ['chat'] }))).toBe(false)
    expect(entryMatchesFilter(entry({ scope: 'chat:telegram' }), filter({ include: ['chat'] }))).toBe(true)
  })
  test('exclude wins over include', () => {
    const f = filter({ include: ['chat'], exclude: ['chat:telegram:*'] })
    expect(entryMatchesFilter(entry({ scope: 'chat:mattermost' }), f)).toBe(true)
    expect(entryMatchesFilter(entry({ scope: 'chat:telegram:files' }), f)).toBe(false)
  })
  test('level is a minimum', () => {
    expect(entryMatchesFilter(entry({ level: 20 }), filter({ level: 30 }))).toBe(false)
    expect(entryMatchesFilter(entry({ level: 40 }), filter({ level: 30 }))).toBe(true)
  })
  test('scope-less entries: shown when include empty, gated by NONE_TOKEN otherwise', () => {
    expect(entryMatchesFilter(entry({}), filter())).toBe(true)
    expect(entryMatchesFilter(entry({}), filter({ include: ['chat'] }))).toBe(false)
    expect(entryMatchesFilter(entry({}), filter({ include: [NONE_TOKEN] }))).toBe(true)
    expect(entryMatchesFilter(entry({}), filter({ exclude: [NONE_TOKEN] }))).toBe(false)
  })
  test('turnId exact match', () => {
    expect(entryMatchesFilter(entry({ turnId: 'abc' }), filter({ turnId: 'abc' }))).toBe(true)
    expect(entryMatchesFilter(entry({ turnId: 'abc' }), filter({ turnId: 'xyz' }))).toBe(false)
  })
  test('q substring searches all fields', () => {
    const e = entry({ msg: 'searchTasks', scope: 'bot', userText: 'budget report' })
    expect(entryMatchesFilter(e, filter({ q: 'budget' }))).toBe(true)
    expect(entryMatchesFilter(e, filter({ q: 'BUDGET' }))).toBe(true)
    expect(entryMatchesFilter(e, filter({ q: 'nope' }))).toBe(false)
  })
})

describe('flattenLogEntry', () => {
  test('includes msg, scope, and nested metadata values', () => {
    const text = flattenLogEntry(entry({ msg: 'm', scope: 's', nested: { host: 'example.com' } }))
    expect(text).toContain('m')
    expect(text).toContain('s')
    expect(text).toContain('example.com')
  })
})

describe('applyFilter', () => {
  test('filters a list', () => {
    const list = [entry({ scope: 'a' }), entry({ scope: 'b' })]
    expect(applyFilter(list, filter({ include: ['a'] }))).toHaveLength(1)
  })
})

describe('parseLogFilter', () => {
  test('reads repeated include/exclude, level, turnId, q', () => {
    const p = new URLSearchParams('include=chat&include=tool&exclude=chat:telegram:*&level=30&turnId=t1&q=boom')
    expect(parseLogFilter(p)).toEqual({
      include: ['chat', 'tool'],
      exclude: ['chat:telegram:*'],
      level: 30,
      turnId: 't1',
      q: 'boom',
    })
  })
  test('defaults: empty arrays, level 0, undefined turnId/q; ignores blank/NaN', () => {
    expect(parseLogFilter(new URLSearchParams(''))).toEqual({ include: [], exclude: [], level: 0 })
    expect(parseLogFilter(new URLSearchParams('level=notanumber&q=')).level).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/debug/log-filter-model.test.ts`
Expected: FAIL — `Cannot find module '../../src/debug/log-filter-model.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/debug/log-filter-model.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { LogEntry } from './log-buffer.js'

/** Selectable token representing entries that carry no `scope` field. */
export const NONE_TOKEN = '(none)'

export type LogFilter = {
  /** Scope patterns to allow; empty means "all scopes". */
  include: string[]
  /** Scope patterns to reject; always wins over include. */
  exclude: string[]
  /** Minimum pino numeric level (>=). */
  level: number
  turnId?: string
  /** Case-insensitive substring across all fields. */
  q?: string
}

/**
 * Match a scope pattern against a concrete scope string.
 * - `chat:*` (wildcard) → prefix on ':' boundaries.
 * - `chat` (bare namespace, no ':' or '*') → prefix on ':' boundaries.
 * - anything else → exact match.
 */
export function matchesScope(pattern: string, scope: string): boolean {
  if (pattern === scope) return true
  if (pattern.endsWith(':*')) {
    const prefix = pattern.slice(0, -2)
    return scope === prefix || scope.startsWith(`${prefix}:`)
  }
  if (!pattern.includes(':') && !pattern.includes('*')) {
    return scope === pattern || scope.startsWith(`${pattern}:`)
  }
  return false
}

const STANDARD_FIELDS = new Set(['time', 'level', 'msg', 'scope'])

/** Flatten an entry's msg, scope, and every metadata key/value into one searchable string. */
export function flattenLogEntry(entry: LogEntry): string {
  const parts: string[] = [entry.msg]
  if (entry.scope !== undefined) parts.push(entry.scope)

  const extract = (value: unknown): void => {
    if (value === null || value === undefined) return
    if (typeof value === 'string') parts.push(value)
    else if (typeof value === 'number' || typeof value === 'boolean') parts.push(String(value))
    else if (Array.isArray(value)) for (const item of value) extract(item)
    else if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        parts.push(k)
        extract(v)
      }
    }
  }

  for (const [key, value] of Object.entries(entry)) {
    if (!STANDARD_FIELDS.has(key)) {
      parts.push(key)
      extract(value)
    }
  }
  return parts.join(' ')
}

function scopePasses(scope: string | undefined, include: string[], exclude: string[]): boolean {
  if (scope === undefined) {
    if (include.length > 0 && !include.includes(NONE_TOKEN)) return false
    if (exclude.includes(NONE_TOKEN)) return false
    return true
  }
  if (include.length > 0) {
    const allowed = include.some((p) => p !== NONE_TOKEN && matchesScope(p, scope))
    if (!allowed) return false
  }
  if (exclude.some((p) => p !== NONE_TOKEN && matchesScope(p, scope))) return false
  return true
}

export function entryMatchesFilter(entry: LogEntry, filter: LogFilter): boolean {
  if (entry.level < filter.level) return false
  if (filter.turnId !== undefined && filter.turnId !== '' && entry['turnId'] !== filter.turnId) return false
  if (!scopePasses(entry.scope, filter.include, filter.exclude)) return false
  if (filter.q !== undefined && filter.q !== '') {
    if (!flattenLogEntry(entry).toLowerCase().includes(filter.q.toLowerCase())) return false
  }
  return true
}

export function applyFilter(entries: readonly LogEntry[], filter: LogFilter): LogEntry[] {
  return entries.filter((e) => entryMatchesFilter(e, filter))
}

/** Parse a LogFilter out of URL query params (repeated include/exclude supported). */
export function parseLogFilter(params: URLSearchParams): LogFilter {
  const filter: LogFilter = {
    include: params.getAll('include'),
    exclude: params.getAll('exclude'),
    level: 0,
  }
  const levelRaw = params.get('level')
  if (levelRaw !== null && levelRaw !== '') {
    const parsed = Number.parseInt(levelRaw, 10)
    if (!Number.isNaN(parsed)) filter.level = parsed
  }
  const turnId = params.get('turnId')
  if (turnId !== null && turnId !== '') filter.turnId = turnId
  const q = params.get('q')
  if (q !== null && q !== '') filter.q = q
  return filter
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/debug/log-filter-model.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/debug/log-filter-model.ts tests/debug/log-filter-model.test.ts
git commit -m "feat(debug): shared LogFilter model with include/exclude + prefix matching"
```

---

## Task 2: Buffer search over LogFilter + scope discovery

**Files:**

- Modify: `src/debug/log-buffer.ts`
- Test: `tests/debug/log-buffer.test.ts` (append cases)

- [ ] **Step 1: Write the failing test**

Append to `tests/debug/log-buffer.test.ts` (inside the file, after the existing `describe('LogRingBuffer', …)` block — add a new `describe`):

```typescript
import { applyFilter } from '../../src/debug/log-filter-model.js'

describe('LogRingBuffer filtering', () => {
  const at = (t: string, o: Partial<LogEntry> = {}): LogEntry => ({ level: 30, time: t, msg: 'm', ...o })

  test('search applies include/exclude and paging', () => {
    const buf = new LogRingBuffer(10)
    buf.push(at('2026-07-02T00:00:01.000Z', { scope: 'chat:telegram' }))
    buf.push(at('2026-07-02T00:00:02.000Z', { scope: 'chat:mattermost' }))
    buf.push(at('2026-07-02T00:00:03.000Z', { scope: 'tool:x' }))

    const chat = buf.search({ include: ['chat'], exclude: [], level: 0, limit: 100 })
    expect(chat.map((e) => e.scope)).toEqual(['chat:telegram', 'chat:mattermost'])

    const excluded = buf.search({ include: ['chat'], exclude: ['chat:telegram'], level: 0, limit: 100 })
    expect(excluded.map((e) => e.scope)).toEqual(['chat:mattermost'])
  })

  test('search before-cursor pages backward over filtered results', () => {
    const buf = new LogRingBuffer(10)
    buf.push(at('2026-07-02T00:00:01.000Z', { scope: 'a' }))
    buf.push(at('2026-07-02T00:00:02.000Z', { scope: 'a' }))
    const page = buf.search({ include: [], exclude: [], level: 0, before: '2026-07-02T00:00:02.000Z', limit: 100 })
    expect(page.map((e) => e.time)).toEqual(['2026-07-02T00:00:01.000Z'])
  })

  test('countMatching ignores paging', () => {
    const buf = new LogRingBuffer(10)
    buf.push(at('2026-07-02T00:00:01.000Z', { scope: 'a' }))
    buf.push(at('2026-07-02T00:00:02.000Z', { scope: 'b' }))
    expect(buf.countMatching({ include: ['a'], exclude: [], level: 0 })).toBe(1)
  })

  test('distinctScopes returns sorted scope + counts, skips scope-less', () => {
    const buf = new LogRingBuffer(10)
    buf.push(at('t1', { scope: 'b' }))
    buf.push(at('t2', { scope: 'a' }))
    buf.push(at('t3', { scope: 'a' }))
    buf.push(at('t4'))
    expect(buf.distinctScopes()).toEqual([
      { scope: 'a', count: 2 },
      { scope: 'b', count: 1 },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/debug/log-buffer.test.ts`
Expected: FAIL — `search` signature mismatch / `countMatching`/`distinctScopes` not a function.

- [ ] **Step 3: Write minimal implementation**

In `src/debug/log-buffer.ts`, add the import at the top (after the existing `emitGlobal` import):

```typescript
import { applyFilter, type LogFilter } from './log-filter-model.js'
```

Replace the existing `SearchParams` type and the `search(params)` method body with:

```typescript
type SearchParams = LogFilter & {
  limit?: number
  /** Cursor for backward paging: return only entries with `time` strictly less than this ISO timestamp. */
  before?: string
}
```

```typescript
  search(params: SearchParams): LogEntry[] {
    let results = applyFilter(this.entries(), params)
    if (params.before !== undefined) {
      results = results.filter((e) => e.time < params.before!)
    }
    const limit = params.limit ?? 100
    return results.slice(-limit)
  }

  countMatching(filter: LogFilter): number {
    return applyFilter(this.entries(), filter).length
  }

  distinctScopes(): Array<{ scope: string; count: number }> {
    const counts = new Map<string, number>()
    for (const e of this.entries()) {
      if (e.scope !== undefined) counts.set(e.scope, (counts.get(e.scope) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([scope, count]) => ({ scope, count }))
      .sort((a, b) => a.scope.localeCompare(b.scope))
  }
```

Note: delete the old `SearchParams` type (the one with `level?/scope?/turnId?/q?/limit?/before?`) — it is replaced above.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/debug/log-buffer.test.ts`
Expected: PASS (existing ring-buffer tests + new filtering tests).

- [ ] **Step 5: Commit**

```bash
git add src/debug/log-buffer.ts tests/debug/log-buffer.test.ts
git commit -m "feat(debug): buffer search over LogFilter + countMatching + distinctScopes"
```

---

## Task 3: `/logs`, `/logs/scopes`, `/logs/stats` routes

**Files:**

- Modify: `src/debug/server.ts:91-102` (`handleLogs`), `:107` (`DEBUG_ONLY_PATHS`), `:160-165` (`routeProtectedPaths`)
- Modify: `src/debug/log-stats-schema.ts`
- Test: `tests/debug/logs-route-content.test.ts` (append a new `describe`)

- [ ] **Step 1: Write the failing test**

Append to `tests/debug/logs-route-content.test.ts` a new `describe` (reuses the same server/cookie from the existing `beforeAll`; add more entries there first). Update the existing `beforeAll` body's log seeding to push extra scoped rows right after the existing `logBuffer.push({...})`:

```typescript
logBuffer.push({ level: 30, time: '2026-06-15T00:00:01.000Z', msg: 'tg', scope: 'chat:telegram' })
logBuffer.push({ level: 30, time: '2026-06-15T00:00:02.000Z', msg: 'mm', scope: 'chat:mattermost' })
logBuffer.push({ level: 20, time: '2026-06-15T00:00:03.000Z', msg: 'dbg', scope: 'tool:x' })
```

Then add:

```typescript
describe('/logs filtering routes', () => {
  const base = `http://127.0.0.1:${TEST_PORT}`
  const cookieHeader = (): { Cookie: string } => ({
    Cookie: `${SESSION_COOKIE_NAME}=${mintSession(ADMIN, { secure: false }).cookieValue}`,
  })

  test('include prefix filters scopes server-side', async () => {
    const res = await fetch(`${base}/logs?include=chat`, { headers: cookieHeader() })
    const body = await readJsonArray(res)
    const scopes = body.map((e) => pick(e, 'scope'))
    expect(scopes).toContain('chat:telegram')
    expect(scopes).toContain('chat:mattermost')
    expect(scopes).not.toContain('tool:x')
    expect(scopes).not.toContain('bot')
  })

  test('exclude wins over include', async () => {
    const res = await fetch(`${base}/logs?include=chat&exclude=chat:telegram`, { headers: cookieHeader() })
    const scopes = (await readJsonArray(res)).map((e) => pick(e, 'scope'))
    expect(scopes).toEqual(['chat:mattermost'])
  })

  test('q substring searches metadata fields', async () => {
    const res = await fetch(`${base}/logs?q=top%20secret`, { headers: cookieHeader() })
    const body = await readJsonArray(res)
    expect(body).toHaveLength(1)
    expect(pick(body[0], 'msg')).toBe('searchTasks called')
  })

  test('/logs/scopes returns distinct scopes with counts', async () => {
    const res = await fetch(`${base}/logs/scopes`, { headers: cookieHeader() })
    const body = await readJsonArray(res)
    const map = new Map(body.map((r) => [pick(r, 'scope'), pick(r, 'count')]))
    expect(map.get('chat:telegram')).toBe(1)
    expect(map.has('bot')).toBe(true)
  })

  test('/logs/stats includes matchingCount for the active filter', async () => {
    const res = await fetch(`${base}/logs/stats?include=chat`, { headers: cookieHeader() })
    const stats: unknown = JSON.parse(await res.text())
    expect(pick(stats, 'matchingCount')).toBe(2)
    expect(typeof pick(stats, 'count')).toBe('number')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/debug/logs-route-content.test.ts`
Expected: FAIL — `/logs?include=` not honored; `/logs/scopes` 404; `matchingCount` undefined.

- [ ] **Step 3: Write minimal implementation**

In `src/debug/server.ts`, add the import (with the other `./` imports near the top):

```typescript
import { parseLogFilter } from './log-filter-model.js'
```

Replace `handleLogs` (`:91-102`) with:

```typescript
function handleLogs(url: URL): Response {
  const filter = parseLogFilter(url.searchParams)
  const results = logBuffer.search({
    ...filter,
    limit: parseIntParam(url.searchParams.get('limit')),
    before: searchParam(url.searchParams.get('before')),
  })
  return jsonResponse(results)
}

function handleLogScopes(): Response {
  return jsonResponse(logBuffer.distinctScopes())
}

function handleLogStats(url: URL): Response {
  const filter = parseLogFilter(url.searchParams)
  return jsonResponse({ ...logBuffer.stats(), matchingCount: logBuffer.countMatching(filter) })
}
```

Update `DEBUG_ONLY_PATHS` (`:107`) to add `/logs/scopes`:

```typescript
const DEBUG_ONLY_PATHS = new Set([
  '/debug',
  '/debug.js',
  '/debug.css',
  '/events',
  '/logs',
  '/logs/stats',
  '/logs/scopes',
  '/dashboard',
])
```

In `routeProtectedPaths` (`:160`), replace the `/logs/stats` block and add `/logs/scopes`:

```typescript
if (url.pathname === '/logs') return handleLogs(url)
if (url.pathname === '/logs/stats') return handleLogStats(url)
if (url.pathname === '/logs/scopes') return handleLogScopes()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/debug/logs-route-content.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `matchingCount` to the stats schema**

In `src/debug/log-stats-schema.ts`, change `LogBufferStatsSchema`:

```typescript
export const LogBufferStatsSchema = z.object({
  count: z.number(),
  capacity: z.number(),
  oldest: z.string().nullable(),
  newest: z.string().nullable(),
  matchingCount: z.number().optional(),
})
```

- [ ] **Step 6: Commit**

```bash
git add src/debug/server.ts src/debug/log-stats-schema.ts tests/debug/logs-route-content.test.ts
git commit -m "feat(debug): server-side /logs filtering, /logs/scopes, stats matchingCount"
```

---

## Task 4: Per-connection SSE `log:entry` filtering

**Files:**

- Modify: `src/debug/state-collector.ts`
- Modify: `src/debug/server.ts:56-78` (`handleEvents`)
- Test: `tests/debug/sse-log-filter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/debug/sse-log-filter.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { emitGlobal } from '../../src/debug/event-bus.js'
import { addClient, removeClient, init } from '../../src/debug/state-collector.js'

const collect = (): { controller: ReadableStreamDefaultController; seen: string[] } => {
  const seen: string[] = []
  const controller = {
    enqueue: (chunk: Uint8Array) => seen.push(new TextDecoder().decode(chunk)),
  } as unknown as ReadableStreamDefaultController
  return { controller, seen }
}

describe('SSE per-connection log filter', () => {
  afterEach(() => {
    // ensure no leaked subscription across tests
  })

  test('log:entry events are filtered by the connection filter; other events pass', () => {
    init('admin')
    const { controller, seen } = collect()
    addClient(controller, { include: ['chat'], exclude: [], level: 0 })
    seen.length = 0 // drop the state:init frame

    emitGlobal('log:entry', { level: 30, time: 't1', msg: 'a', scope: 'chat:telegram' })
    emitGlobal('log:entry', { level: 30, time: 't2', msg: 'b', scope: 'tool:x' })

    const logFrames = seen.filter((f) => f.includes('event: log:entry'))
    expect(logFrames).toHaveLength(1)
    expect(logFrames[0]).toContain('chat:telegram')

    removeClient(controller)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/debug/sse-log-filter.test.ts`
Expected: FAIL — `addClient` expects 1 arg / filter not applied.

- [ ] **Step 3: Write minimal implementation**

In `src/debug/state-collector.ts`:

Add import near the top:

```typescript
import { entryMatchesFilter, type LogFilter } from './log-filter-model.js'
import type { LogEntry } from './log-buffer.js'
```

Change the clients container (was `const clients = new Set<ReadableStreamDefaultController>()`):

```typescript
const clients = new Map<ReadableStreamDefaultController, LogFilter>()
const PASS_ALL: LogFilter = { include: [], exclude: [], level: 0 }
```

Update `pingClients` to iterate keys:

```typescript
function pingClients(): void {
  for (const client of clients.keys()) {
    try {
      client.enqueue(PING_FRAME)
    } catch {
      removeClient(client)
    }
  }
}
```

Change `addClient` signature and store the filter (keep the existing `state:init` body; only the signature + the `clients.add`→`clients.set` and the `clients.size === 1` guard change):

```typescript
export function addClient(controller: ReadableStreamDefaultController, filter: LogFilter = PASS_ALL): void {
  clients.set(controller, filter)
  // ... existing initData construction and sendTo(controller, {state:init ...}) unchanged ...
  if (clients.size === 1) {
    subscribe(onEvent)
    startHeartbeat()
  }
}
```

Update `removeClient` (`clients.delete` already works on a Map — no change needed to its body, but confirm it uses `clients.delete(controller)`).

Update `broadcast` to apply each client's filter to `log:entry` only:

```typescript
function broadcast(event: DebugEvent): void {
  const payload = formatSse(event)
  for (const [client, filter] of clients) {
    if (event.type === 'log:entry' && !entryMatchesFilter(event.data as LogEntry, filter)) continue
    try {
      client.enqueue(payload)
    } catch {
      removeClient(client)
    }
  }
}
```

In `src/debug/server.ts`, update `handleEvents` (`:56`) to parse the filter and pass it:

```typescript
function handleEvents(req: Request): Response {
  const filter = parseLogFilter(new URL(req.url).searchParams)
  let ctrl: ReadableStreamDefaultController
  const stream = new ReadableStream({
    start(controller): void {
      ctrl = controller
      addClient(controller, filter)
      controller.enqueue(new TextEncoder().encode('retry: 3000\n\n'))
      req.signal.addEventListener('abort', () => {
        removeClient(controller)
      })
    },
    cancel(): void {
      removeClient(ctrl)
    },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/debug/sse-log-filter.test.ts tests/debug/log-buffer.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the debug server suite to catch regressions**

Run: `bun test tests/debug/`
Expected: PASS (state-collector consumers still work; `addClient` default keeps old behavior).

- [ ] **Step 6: Commit**

```bash
git add src/debug/state-collector.ts src/debug/server.ts tests/debug/sse-log-filter.test.ts
git commit -m "feat(debug): filter live log:entry SSE events per-connection"
```

---

## Task 5: Client filter URL helpers + bootstrap

**Files:**

- Create: `client/debug/log-filter-url.ts`
- Modify: `client/debug/log-bootstrap.ts`
- Test: `tests/client/debug/log-filter-url.test.ts`, `tests/client/debug/log-bootstrap.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Create `tests/client/debug/log-filter-url.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { emptyFilter, filterFromParams, filterToParams, filterToQuery } from '../../../client/debug/log-filter-url.js'

describe('log-filter-url', () => {
  test('emptyFilter is pass-all', () => {
    expect(emptyFilter()).toEqual({ include: [], exclude: [], level: 0 })
  })

  test('filterToParams emits repeated include/exclude and skips defaults', () => {
    const p = filterToParams({ include: ['chat', 'tool'], exclude: ['chat:telegram:*'], level: 30, q: 'x' })
    expect(p.getAll('include')).toEqual(['chat', 'tool'])
    expect(p.getAll('exclude')).toEqual(['chat:telegram:*'])
    expect(p.get('level')).toBe('30')
    expect(p.get('q')).toBe('x')
  })

  test('level 0 and empty q are omitted', () => {
    const p = filterToParams({ include: [], exclude: [], level: 0 })
    expect(p.has('level')).toBe(false)
    expect(p.has('q')).toBe(false)
  })

  test('round-trips through params', () => {
    const f = { include: ['chat'], exclude: ['tool:x'], level: 40, turnId: 't1', q: 'boom' }
    expect(filterFromParams(new URLSearchParams(filterToQuery(f)))).toEqual(f)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/client/debug/log-filter-url.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `client/debug/log-filter-url.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { parseLogFilter, type LogFilter } from '../../src/debug/log-filter-model.js'

export type { LogFilter } from '../../src/debug/log-filter-model.js'

export function emptyFilter(): LogFilter {
  return { include: [], exclude: [], level: 0 }
}

export function filterToParams(filter: LogFilter): URLSearchParams {
  const params = new URLSearchParams()
  for (const p of filter.include) params.append('include', p)
  for (const p of filter.exclude) params.append('exclude', p)
  if (filter.level > 0) params.set('level', String(filter.level))
  if (filter.turnId !== undefined && filter.turnId !== '') params.set('turnId', filter.turnId)
  if (filter.q !== undefined && filter.q !== '') params.set('q', filter.q)
  return params
}

export function filterToQuery(filter: LogFilter): string {
  return filterToParams(filter).toString()
}

/** Inverse of filterToParams; reuses the server parser for identical semantics. */
export function filterFromParams(params: URLSearchParams): LogFilter {
  return parseLogFilter(params)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/client/debug/log-filter-url.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing bootstrap test**

Append to `tests/client/debug/log-bootstrap.test.ts` a new `describe` (match the file's existing import style):

```typescript
import { buildLogsUrl, fetchScopes } from '../../../client/debug/log-bootstrap.js'
import { setMockFetch, restoreFetch } from '../../utils/test-helpers.js'

describe('log-bootstrap filtering', () => {
  test('buildLogsUrl includes filter params', () => {
    const url = buildLogsUrl({ limit: 200, filter: { include: ['chat'], exclude: [], level: 30 } })
    expect(url).toContain('limit=200')
    expect(url).toContain('include=chat')
    expect(url).toContain('level=30')
  })

  test('fetchScopes returns parsed rows', async () => {
    setMockFetch(async () => new Response(JSON.stringify([{ scope: 'bot', count: 3 }])))
    try {
      expect(await fetchScopes()).toEqual([{ scope: 'bot', count: 3 }])
    } finally {
      restoreFetch()
    }
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `bun test tests/client/debug/log-bootstrap.test.ts`
Expected: FAIL — `buildLogsUrl` does not accept `filter`; `fetchScopes` not exported.

- [ ] **Step 7: Modify `client/debug/log-bootstrap.ts`**

Add import at the top:

```typescript
import { filterToParams, type LogFilter } from './log-filter-url.js'
```

Replace `buildLogsUrl` with a filter-aware version:

```typescript
/** Build a `/logs` URL. `limit` bounds the page size; `before` pages backward; `filter` scopes the query server-side. */
export function buildLogsUrl(params: { limit?: number; before?: string; filter?: LogFilter }): string {
  const search = params.filter ? filterToParams(params.filter) : new URLSearchParams()
  search.set('limit', String(params.limit ?? INITIAL_LIMIT))
  if (params.before !== undefined) search.set('before', params.before)
  return `/logs?${search.toString()}`
}
```

Update `fetchInitialLogs` and `fetchOlderLogs` to thread the filter through:

```typescript
export function fetchInitialLogs(filter?: LogFilter, limit: number = INITIAL_LIMIT): Promise<unknown[]> {
  return fetchLogsArray(buildLogsUrl({ limit, filter }))
}

export function fetchOlderLogs(
  before: string,
  filter?: LogFilter,
  limit: number = OLDER_PAGE_LIMIT,
): Promise<unknown[]> {
  return fetchLogsArray(buildLogsUrl({ limit, before, filter }))
}
```

Add a scopes fetcher and its row type at the bottom:

```typescript
export type ScopeCount = { scope: string; count: number }

export async function fetchScopes(): Promise<ScopeCount[]> {
  try {
    const res = await fetch('/logs/scopes')
    if (!res.ok) return []
    const body: unknown = await res.json()
    if (!Array.isArray(body)) return []
    return body.filter(
      (r): r is ScopeCount =>
        typeof r === 'object' &&
        r !== null &&
        typeof (r as ScopeCount).scope === 'string' &&
        typeof (r as ScopeCount).count === 'number',
    )
  } catch {
    return []
  }
}
```

Update `fetchLogStats` to accept an optional filter so `matchingCount` reflects the active filter:

```typescript
export async function fetchLogStats(filter?: LogFilter): Promise<LogBufferStats | null> {
  try {
    const params = filter ? filterToParams(filter) : new URLSearchParams()
    const res = await fetch(`/logs/stats?${params.toString()}`)
    if (!res.ok) return null
    return safeParseLogBufferStats(await res.json())
  } catch {
    return null
  }
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `bun test tests/client/debug/log-bootstrap.test.ts tests/client/debug/log-filter-url.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add client/debug/log-filter-url.ts client/debug/log-bootstrap.ts tests/client/debug/log-filter-url.test.ts tests/client/debug/log-bootstrap.test.ts
git commit -m "feat(debug): client filter URL helpers + filter-aware log bootstrap"
```

---

## Task 6: Dashboard state + ScopeFilter picker component

**Files:**

- Modify: `client/debug/dashboard-types.ts`
- Modify: `client/debug/debug.svelte.ts` (or wherever `DashboardState` is initialized — grep for `activeLogFilter:`)
- Create: `client/debug/components/ScopeFilter.svelte`
- Test: `tests/client/debug/components/ScopeFilter.test.ts`

- [ ] **Step 1: Locate the state initializer**

Run: `grep -rn "activeLogFilter" client/debug/`
Expected: the `DashboardState` object literal that sets `activeLogFilter: { turnId: undefined }` (or similar). Note the file/line for Step 3.

- [ ] **Step 2: Update `dashboard-types.ts`**

Add the import and change the two fields:

```typescript
import type { LogFilter } from './log-filter-url.js'
import type { ScopeCount } from './log-bootstrap.js'
```

In `DashboardState`, replace `activeLogFilter: { turnId?: string }` with:

```typescript
  activeLogFilter: LogFilter
  logScopeCounts: ScopeCount[]
```

(Keep `logs` and `logScopes`; `logScopes` may still seed autocomplete, but `logScopeCounts` is authoritative from `/logs/scopes`.)

- [ ] **Step 3: Update the state initializer**

At the location found in Step 1, replace the `activeLogFilter` initializer and add `logScopeCounts`:

```typescript
    activeLogFilter: { include: [], exclude: [], level: 0 },
    logScopeCounts: [],
```

- [ ] **Step 4: Write the failing component test**

Create `tests/client/debug/components/ScopeFilter.test.ts` (match the existing `LogExplorer.test.ts` render style — `@testing-library/svelte` + `bun:test`):

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { render, fireEvent } from '@testing-library/svelte'

import ScopeFilter from '../../../../client/debug/components/ScopeFilter.svelte'

describe('ScopeFilter', () => {
  test('cycling a scope emits include then exclude then clear', async () => {
    const states: Array<{ include: string[]; exclude: string[] }> = []
    const { getByText } = render(ScopeFilter, {
      props: {
        scopes: [{ scope: 'chat:telegram', count: 2 }],
        include: [],
        exclude: [],
        onChange: (include: string[], exclude: string[]) => states.push({ include, exclude }),
      },
    })

    const chip = getByText('chat:telegram')
    await fireEvent.click(chip) // -> include
    await fireEvent.click(chip) // -> exclude
    await fireEvent.click(chip) // -> cleared

    expect(states[0]).toEqual({ include: ['chat:telegram'], exclude: [] })
    expect(states[1]).toEqual({ include: [], exclude: ['chat:telegram'] })
    expect(states[2]).toEqual({ include: [], exclude: [] })
  })
})
```

- [ ] **Step 5: Run test to verify it fails**

Run: `bun test tests/client/debug/components/ScopeFilter.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 6: Create `client/debug/components/ScopeFilter.svelte`**

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { ScopeCount } from '../log-bootstrap.js'

  interface Props {
    scopes: ScopeCount[]
    include: string[]
    exclude: string[]
    onChange: (include: string[], exclude: string[]) => void
  }

  let { scopes, include, exclude, onChange }: Props = $props()

  // Three-state per scope: neutral -> include -> exclude -> neutral.
  function stateOf(scope: string): 'include' | 'exclude' | 'neutral' {
    if (include.includes(scope)) return 'include'
    if (exclude.includes(scope)) return 'exclude'
    return 'neutral'
  }

  function cycle(scope: string): void {
    const s = stateOf(scope)
    const nextInclude = include.filter((x) => x !== scope)
    const nextExclude = exclude.filter((x) => x !== scope)
    if (s === 'neutral') nextInclude.push(scope)
    else if (s === 'include') nextExclude.push(scope)
    onChange(nextInclude, nextExclude)
  }
</script>

<div class="scope-filter">
  {#each scopes as { scope, count } (scope)}
    <button
      type="button"
      class="scope-chip scope-chip--{stateOf(scope)}"
      onclick={() => cycle(scope)}
      title={`${scope} (${count})`}>
      {scope}<span class="scope-chip__count">{count}</span>
    </button>
  {/each}
</div>

<style>
  .scope-filter {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    max-height: 140px;
    overflow-y: auto;
    padding: 4px;
  }
  .scope-chip {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 1px 6px;
    border: 1px solid var(--border);
    border-radius: 2px;
    background: var(--surface);
    color: var(--fg2);
    cursor: pointer;
  }
  .scope-chip__count {
    color: var(--fg4);
    margin-left: 4px;
  }
  .scope-chip--include {
    border-color: var(--accent, #4ea1ff);
    color: var(--fg);
  }
  .scope-chip--exclude {
    border-color: var(--danger, #ff5c5c);
    color: var(--fg3);
    text-decoration: line-through;
  }
</style>
```

- [ ] **Step 7: Run test to verify it passes**

Run: `bun test tests/client/debug/components/ScopeFilter.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add client/debug/dashboard-types.ts client/debug/debug.svelte.ts client/debug/components/ScopeFilter.svelte tests/client/debug/components/ScopeFilter.test.ts
git commit -m "feat(debug): LogFilter dashboard state + ScopeFilter picker component"
```

(Adjust the second `git add` path if Step 1 found the initializer in a different file.)

---

## Task 7: Rewire LogExplorer to server-side filtering

**Files:**

- Modify: `client/debug/components/LogExplorer.svelte`
- Test: `tests/client/debug/components/LogExplorer.test.ts` (update expectations)

- [ ] **Step 1: Read the current test to see what it asserts**

Run: `bun test tests/client/debug/components/LogExplorer.test.ts`
Expected: currently PASS. Note assertions that reference client-side fuzzy filtering / the scope `<select>` — these are updated in Step 3.

- [ ] **Step 2: Rewrite `LogExplorer.svelte`**

Replace the `<script>` block's filtering wiring so the component renders `dashboard.logs` (already server-filtered) and drives `dashboard.activeLogFilter`. Remove the Fuse imports and `filterLogsWithIndex`/`updateFuseIndex`/`collectScopes` local filtering. Key changes:

Remove these imports:

```typescript
import { filterLogsWithIndex, updateFuseIndex } from '../log-filter.js'
```

Replace the local filter state (`levelFilter`, `scopeFilter`, `searchQuery`, `fuseInstance`, `filtered`) with derivations off `dashboard.activeLogFilter`:

```typescript
import ScopeFilter from './ScopeFilter.svelte'

// Level dropdown binds to the shared filter.
let levelFilter = $derived(String(dashboard.activeLogFilter.level))
let searchQuery = $derived(dashboard.activeLogFilter.q ?? '')

// Server already filtered dashboard.logs; render as-is.
const filtered = $derived(dashboard.logs.map((entry, originalIndex) => ({ entry, originalIndex })))

function setLevel(v: string): void {
  dashboard.activeLogFilter = { ...dashboard.activeLogFilter, level: Number(v) }
}
function setQuery(v: string): void {
  dashboard.activeLogFilter = { ...dashboard.activeLogFilter, q: v === '' ? undefined : v }
}
function setScopes(include: string[], exclude: string[]): void {
  dashboard.activeLogFilter = { ...dashboard.activeLogFilter, include, exclude }
}
function clearTurnFilter(): void {
  dashboard.activeLogFilter = { ...dashboard.activeLogFilter, turnId: undefined }
}
```

In the markup, replace the scope `<Select>` with the picker, and point the level `<Select>` at `setLevel`, the search `<Input>` at `setQuery`:

```svelte
        <Select
          value={levelFilter}
          options={[
            { value: '0', label: 'all levels' },
            { value: '10', label: 'trace' },
            { value: '20', label: 'debug' },
            { value: '30', label: 'info' },
            { value: '40', label: 'warn' },
            { value: '50', label: 'error' },
          ]}
          onChange={setLevel} />
        <Input value={searchQuery} placeholder="search..." onInput={setQuery} />
```

Add the ScopeFilter below the toolbar (inside the panel body, above `#log-entries`):

```svelte
    <ScopeFilter
      scopes={dashboard.logScopeCounts}
      include={dashboard.activeLogFilter.include}
      exclude={dashboard.activeLogFilter.exclude}
      onChange={setScopes} />
```

Update `loadOlder` to pass the filter and refresh filtered stats:

```typescript
const parsed = parseLogsArray(await fetchOlderLogs(before, dashboard.activeLogFilter))
// ...
bufferStats = await fetchLogStats(dashboard.activeLogFilter)
```

Update the buffer stat line to surface `matchingCount`:

```svelte
      {#if bufferStats !== null}
        <span class="log-bufferstat">
          showing {filtered.length} · {bufferStats.matchingCount ?? dashboard.logs.length} match filter of {bufferStats.count} buffered (cap {bufferStats.capacity})
        </span>
      {/if}
```

Remove the now-unused `clearLogs`'s `dashboard.logScopes.clear()` line only if it errors; leaving it is harmless.

- [ ] **Step 3: Update the LogExplorer test**

In `tests/client/debug/components/LogExplorer.test.ts`, replace any assertion that depended on client-side fuzzy filtering or the scope `<select>` with assertions that (a) entries from `dashboard.logs` render directly, and (b) changing the level select updates `dashboard.activeLogFilter.level`. Example replacement test body:

```typescript
test('level select updates the shared filter', async () => {
  const dashboard = makeDashboard({ logs: [{ level: 30, time: 't', msg: 'a', scope: 'bot' }] })
  const { getByDisplayValue } = render(LogExplorer, { props: { dashboard, onSelectLog: () => {} } })
  // (Use the harness's existing makeDashboard helper in this file.)
  expect(dashboard.logs).toHaveLength(1)
})
```

Keep it aligned with the file's existing `makeDashboard`/render helpers rather than inventing new ones.

- [ ] **Step 4: Run tests**

Run: `bun test tests/client/debug/components/LogExplorer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/debug/components/LogExplorer.svelte tests/client/debug/components/LogExplorer.test.ts
git commit -m "feat(debug): render server-filtered logs + scope picker in LogExplorer"
```

---

## Task 8: DebugApp — URL state, refetch, SSE reconnect on filter change

**Files:**

- Modify: `client/debug/sse.ts`
- Modify: `client/debug/DebugApp.svelte`
- Test: `tests/client/debug/sse.test.ts` (append) — or create if absent

- [ ] **Step 1: Write the failing SSE test**

Append to (or create) `tests/client/debug/sse.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { eventsUrl } from '../../../client/debug/sse.js'

describe('eventsUrl', () => {
  test('appends filter query when present', () => {
    expect(eventsUrl('include=chat&level=30')).toBe('/events?include=chat&level=30')
  })
  test('bare /events when query empty', () => {
    expect(eventsUrl('')).toBe('/events')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/client/debug/sse.test.ts`
Expected: FAIL — `eventsUrl` not exported.

- [ ] **Step 3: Modify `client/debug/sse.ts`**

Add an exported helper and accept a query string in `setupEventSource`:

```typescript
export function eventsUrl(query: string): string {
  return query === '' ? '/events' : `/events?${query}`
}
```

Change `setupEventSource` signature and the `EventSource` construction:

```typescript
export function setupEventSource(
  state: DashboardState,
  onConnectionChange: (connected: boolean) => void,
  query: string = '',
  handlers: Record<string, EventHandler> = buildHandlerMap(state),
): SseConnection {
  const source = new EventSource(eventsUrl(query))
  // ... rest unchanged ...
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/client/debug/sse.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire DebugApp filter lifecycle**

In `client/debug/DebugApp.svelte`, add imports:

```typescript
import { fetchInitialLogs, parseLogsArray, collectScopes, fetchScopes } from './log-bootstrap.js'
import { filterFromParams, filterToQuery } from './log-filter-url.js'
```

On mount, seed the filter from the page URL, load scopes, and (re)connect whenever the filter changes. Replace the existing `$effect` that bootstraps logs + SSE with a filter-reactive one:

```typescript
// Seed filter from URL once.
$effect(() => {
  const fromUrl = filterFromParams(new URLSearchParams(window.location.search))
  dashboard.activeLogFilter = fromUrl
})

// Refetch logs + reconnect SSE whenever the filter changes; keep the page URL in sync.
$effect(() => {
  const query = filterToQuery(dashboard.activeLogFilter)
  const next = query === '' ? window.location.pathname : `${window.location.pathname}?${query}`
  window.history.replaceState(null, '', next)

  void (async () => {
    const rawLogs = await fetchInitialLogs(dashboard.activeLogFilter)
    const parsed = parseLogsArray(rawLogs)
    dashboard.logs = parsed
    dashboard.logScopeCounts = await fetchScopes()
    for (const scope of collectScopes(parsed)) dashboard.logScopes.add(scope)
  })()

  const conn = setupEventSource(
    dashboard,
    (connected) => {
      dashboard.connected = connected
    },
    query,
  )
  return () => conn.close()
})
```

Note: because the effect reads `dashboard.activeLogFilter`, Svelte re-runs it (closing the old SSE via the returned cleanup and opening a new one) on every filter change — exactly the "refetch + reconnect" contract.

- [ ] **Step 6: Manual reasoning check (no test runtime for full SPA)**

Confirm by reading: changing `dashboard.activeLogFilter` in `LogExplorer` → effect re-runs → URL updated, `/logs?filter` refetched, SSE reopened with the same query. Older-page loads (`loadOlder`) already pass the filter (Task 7).

- [ ] **Step 7: Commit**

```bash
git add client/debug/sse.ts client/debug/DebugApp.svelte tests/client/debug/sse.test.ts
git commit -m "feat(debug): URL-encoded filter state with refetch + SSE reconnect"
```

---

## Task 9: Remove the client-side Fuse filter path

**Files:**

- Delete: `client/debug/log-filter.ts`
- Delete: `tests/client/debug/log-filter.test.ts`
- Modify: any remaining importers of `log-filter.js`

- [ ] **Step 1: Find remaining importers**

Run: `grep -rn "log-filter\.js\|log-filter'" client/ tests/ | grep -v log-filter-url | grep -v log-filter-model`
Expected: only `client/debug/components/LogExplorer.svelte` (already edited in Task 7 to drop it) and the test file. If any other importer remains, remove its usage (the shared model in `src/debug/log-filter-model.ts` covers matching; `flattenLogEntry` now lives there).

- [ ] **Step 2: Delete the files**

```bash
git rm client/debug/log-filter.ts tests/client/debug/log-filter.test.ts
```

- [ ] **Step 3: Verify no dangling imports / typecheck**

Run: `bun run typecheck`
Expected: PASS (no unresolved `log-filter.js` imports).

- [ ] **Step 4: Check whether Fuse.js is still used anywhere**

Run: `grep -rn "fuse.js\|from 'fuse'\|Fuse" client/ src/`
Expected: no remaining references. (Do NOT remove the `fuse.js` dependency from `package.json` in this task unless the grep is empty AND nothing else uses it — if empty, removing it is a valid cleanup; otherwise leave it.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(debug): remove client-side Fuse log filtering (server-side now)"
```

---

## Task 10: Build client assets, full check, final commit

**Files:**

- Modify: `public/debug.js`, `public/debug.css` (generated)

- [ ] **Step 1: Rebuild the debug client bundle**

Run: `grep -n "\"build" package.json` to find the client build script (e.g. `build:client` / `build:debug`).
Then run that script (example): `bun run build:client`
Expected: regenerates `public/debug.js` / `public/debug.css` with the new components.

- [ ] **Step 2: Run the full check suite**

Run: `bun check:full`
Expected: PASS — lint, typecheck, format, license-headers, tests all green. Fix any formatting via `bun run format` (or `bunx oxfmt <files>`) and re-run.

- [ ] **Step 3: Run the focused test set once more**

Run: `bun test tests/debug/ tests/client/debug/`
Expected: PASS.

- [ ] **Step 4: Manual smoke (optional but recommended)**

With `DEBUG_SERVER=true` and `LOG_LEVEL=debug`, open `/debug`, then:

- Click a scope chip once (include), twice (exclude), three times (neutral) — the log list and URL update each time.
- Confirm the URL reflects `include=`/`exclude=`/`level=`/`q=` and that reloading the page preserves the filter.
- Confirm new live entries appended in the tail respect the active filter.

- [ ] **Step 5: Final commit (generated assets)**

```bash
git add public/debug.js public/debug.css
git commit -m "build(debug): rebuild client bundle for scope filtering"
```

---

## Self-review notes

- **Spec coverage:** include/exclude+prefix (Task 1 `matchesScope`, Task 6 picker); whole-buffer server filtering (Tasks 2–3); `/logs/scopes` (Task 3, Task 5 fetch, Task 6 picker); `matchingCount` on `/logs/stats` (Task 3 route + schema, Task 7 display); live-tail filtering via SSE query params (Task 4 server, Task 8 client reconnect); URL-encoded state (Task 8); all-fields substring search (Task 1 `flattenLogEntry`/`q`, Task 3 route test); Fuse removal (Task 9); known-limitation note carried from spec (no code — documented boundary).
- **`(none)` token:** implemented in `scopePasses` (Task 1) and exercised by the model test. The picker (Task 6) shows only real buffer scopes; a `(none)` chip is optional future polish — filtering still works via URL if a user types it. If a `(none)` chip is desired, prepend `{ scope: NONE_TOKEN, count: <scope-less count> }` to `dashboard.logScopeCounts` — not required for spec compliance.
- **Type consistency:** `LogFilter` is defined once in `src/debug/log-filter-model.ts` and re-exported to the client via `log-filter-url.ts`; `ScopeCount` defined once in `log-bootstrap.ts` and imported by `ScopeFilter.svelte` and `dashboard-types.ts`. `addClient(controller, filter?)` default keeps existing callers/tests valid.
- **Known limitation (out of scope):** `debug`/`trace` levels stay empty in production unless `LOG_LEVEL=debug`; carried as a documented boundary, no task.
