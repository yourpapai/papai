<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Dashboard Redesign — PR 3: `/admin` Shell + Scrollspy + Recent-Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Rebuild `/admin` as a single scrolling page with a sticky sidebar driving scrollspy navigation. Add an `OverviewSection` (KPIs + sparkline + bars) backed by a new `adminGlobals` data layer fed from `/stats/global`. Inline the per-subject billing detail (drop the modal). Add a `GET /admin/subjects/:id/recent-requests` route that returns an anonymous request log per the `/stats/*` anonymity contract.

**Architecture:** Backend gets one new pure-SQL query helper (`listRecentRequests`), one Zod schema, one route handler, and one server-side wire-in — all anonymous-shape. The client gets a new shell (`AdminTopBar`, `AdminSidebarPanel`, `OverviewSection`), a `useScrollSpy` helper driven by `IntersectionObserver`, a `global-stats.svelte.ts` data layer, and a `BillingSection` rewrite that swaps its modal for an inline detail panel. Per-section lazy fetch keeps initial load light. Every section renders as a `<section id="...">` anchor under one `<main>` so the scroll/hash machinery is trivial.

**Tech Stack:** Svelte 5 (runes + snippets), Bun test runner (`bun:test`), happy-dom, Drizzle ORM (SQLite). No new dependencies. Reuses every primitive from PR 1 and the `Shell`/`TopBar` composition pattern from PR 2.

**Reference spec:** `docs/superpowers/specs/2026-05-22-dashboard-redesign-design.md` sections 8 and 9.

**Anonymity contract reminder:** `GET /admin/subjects/:id/recent-requests` must return ONLY `{ ts, modelLabel, role, inputTokens, outputTokens, finishStatus }`. No `chatUserId`, no `turnId`, no `responseId`, no error message body, no message text. Any content leak is a release-blocking defect.

---

## File Structure

**Create (backend):**

- `src/usage/recent-requests.ts` — `listRecentRequests(storageContextId, limit): RecentRequestRow[]`, pure SQL via Drizzle.
- `tests/usage/recent-requests.test.ts` — unit tests for the helper.
- `tests/debug/admin-system.recent-requests.test.ts` — route-level test.

**Create (client):**

- `client/admin/components/AdminTopBar.svelte` — composes `Shell`/`TopBar` for `/admin` (brand, configured pill, `/debug ←` link, window Seg, refresh meta).
- `client/admin/components/AdminSidebarPanel.svelte` — caps-style section list with counts + `QuickStats` KV block at bottom.
- `client/admin/sections/OverviewSection.svelte` — new section: KPI cards row + growth Spark + surface-mix Bars.
- `client/admin/global-stats.svelte.ts` — `adminGlobals` `$state` + `refreshGlobals()`.
- `client/admin/scrollspy.ts` — `useScrollSpy(sectionIds, onChange)` (factory returning `start`/`stop` for `$effect` use).
- `tests/client/admin/scrollspy.test.ts` — IntersectionObserver-mocked test.
- `tests/client/admin/global-stats.test.ts` — `refreshGlobals` test with mocked `fetch`.
- `tests/client/admin/components/AdminTopBar.test.ts`
- `tests/client/admin/components/AdminSidebarPanel.test.ts`
- `tests/client/admin/sections/OverviewSection.test.ts`

**Modify (backend):**

- `src/debug/schemas.ts` — add `RecentRequestSchema` (z.object with the 6 anonymous fields) and `RecentRequestsResponseSchema`.
- `src/debug/admin-system.ts` — add `handleAdminRecentRequests(url)` returning the new anonymous shape (delegates to `listRecentRequests`).
- `src/debug/server.ts` — add a path-prefix branch for `/admin/subjects/:id/recent-requests`.

**Modify (client):**

- `client/admin/admin.svelte.ts` — add `currentSection` already exists; add `window: StatsWindow` field; add `setSection(id)`, `setWindow(w)`, `refreshAll()` helpers.
- `client/admin/AdminApp.svelte` — full rewrite: every section rendered always under one `<main>`, sidebar + topbar wired up, scrollspy hooked, hash sync stays.
- `client/admin/admin.css` — drop `.admin-shell`, `.admin-topbar` (the legacy one), `.admin-body`, `.admin-pane`; add `.admin-grid`, `.admin-grid__sidebar`, `.admin-grid__main`, sticky positioning for sidebar/topbar.
- `client/admin/sections/BillingSection.svelte` — replace internal `<Modal>` subject detail with inline `AdminSubjectDetailPanel` slot rendered under the table when a row is selected; drop per-section window selector (top-bar owns it now).
- `client/admin/sections/MemosSection.svelte`, `RemindersSection.svelte`, `IdentitiesSection.svelte`, `GroupsSection.svelte` — add a one-shot `IntersectionObserver` for lazy initial fetch.
- `client/admin/sections/SystemSection.svelte` — add inline header note `POST /admin/llm requires DEBUG_TOKEN`.
- `client/admin/components/SubjectDetail.svelte` — add `recentRequests` block (new endpoint), reuses panel primitive.

**Modify (tests/setup):**

- `tests/client-setup.ts` — add an `IntersectionObserver` stub mirroring the `EventSource` pattern so component mounts don't crash. Tests that exercise scrollspy install a custom replacement.

**Delete (client):**

- `client/admin/components/NavSidebar.svelte` — replaced by `AdminSidebarPanel`.
- `client/admin/components/WindowSelect.svelte` — superseded by top-bar `Seg`.
- `tests/client/admin/components/NavSidebar.test.ts` and `WindowSelect.test.ts` if they exist.

---

## Task 1: Backend — `listRecentRequests` query helper (TDD)

**Files:**

- Create: `src/usage/recent-requests.ts`
- Create: `tests/usage/recent-requests.test.ts`

- [x] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { llmUsageEvents } from '../../src/db/schema.js'
import { listRecentRequests } from '../../src/usage/recent-requests.js'
import { setupTestDb } from '../utils/test-helpers.js'

const insertEvent = (overrides: Partial<typeof llmUsageEvents.$inferInsert> = {}): void => {
  const base = {
    eventId: `evt_${Math.random().toString(16).slice(2)}`,
    occurredAt: Date.now(),
    turnId: 'turn_abc',
    storageContextId: 'user:1',
    contextType: 'dm',
    chatUserId: 'u1',
    model: 'gpt-4o-mini',
    modelRole: 'main',
    inputTokens: 100,
    outputTokens: 50,
    stepCount: 1,
    toolCallCount: 0,
    messageCount: 1,
    finishReason: 'stop',
    durationMs: 600,
    responseId: null,
    error: null,
  }
  getDrizzleDb()
    .insert(llmUsageEvents)
    .values({ ...base, ...overrides })
    .run()
}

describe('listRecentRequests', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('returns rows for the given storage context, newest first', () => {
    insertEvent({ eventId: 'e1', storageContextId: 'user:1', occurredAt: 1000 })
    insertEvent({ eventId: 'e2', storageContextId: 'user:1', occurredAt: 3000 })
    insertEvent({ eventId: 'e3', storageContextId: 'user:1', occurredAt: 2000 })
    insertEvent({ eventId: 'e4', storageContextId: 'user:2', occurredAt: 4000 })

    const rows = listRecentRequests('user:1', 10)

    expect(rows.map((r) => r.ts)).toEqual([3000, 2000, 1000])
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(
        ['ts', 'modelLabel', 'role', 'inputTokens', 'outputTokens', 'finishStatus'].sort(),
      )
    }
  })

  test('honors the limit', () => {
    for (let i = 0; i < 5; i += 1) {
      insertEvent({ eventId: `e${i}`, storageContextId: 'user:1', occurredAt: i * 1000 })
    }
    expect(listRecentRequests('user:1', 3)).toHaveLength(3)
  })

  test('clamps limit to a safe range', () => {
    expect(listRecentRequests('user:1', 0)).toHaveLength(0)
    insertEvent({ eventId: 'e1', storageContextId: 'user:1', occurredAt: 1000 })
    const huge = listRecentRequests('user:1', 1_000_000)
    expect(huge).toHaveLength(1)
  })

  test('maps finishReason to finishStatus and normalizes nulls', () => {
    insertEvent({ eventId: 'e1', storageContextId: 'user:1', finishReason: 'stop', occurredAt: 1000 })
    insertEvent({ eventId: 'e2', storageContextId: 'user:1', finishReason: null, occurredAt: 2000 })
    const rows = listRecentRequests('user:1', 10)
    expect(rows[0]?.finishStatus).toBe('unknown')
    expect(rows[1]?.finishStatus).toBe('stop')
  })
})
```

- [x] **Step 2: Run the failing test**

Run: `bun test tests/usage/recent-requests.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implement the helper**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { desc, eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { llmUsageEvents } from '../db/schema.js'

const MAX_LIMIT = 200

export interface RecentRequestRow {
  ts: number
  modelLabel: string
  role: string
  inputTokens: number
  outputTokens: number
  finishStatus: string
}

export const listRecentRequests = (storageContextId: string, limit: number): RecentRequestRow[] => {
  const safeLimit = Math.max(0, Math.min(MAX_LIMIT, Math.floor(limit)))
  if (safeLimit === 0) return []
  const rows = getDrizzleDb()
    .select({
      occurredAt: llmUsageEvents.occurredAt,
      model: llmUsageEvents.model,
      modelRole: llmUsageEvents.modelRole,
      inputTokens: llmUsageEvents.inputTokens,
      outputTokens: llmUsageEvents.outputTokens,
      finishReason: llmUsageEvents.finishReason,
    })
    .from(llmUsageEvents)
    .where(eq(llmUsageEvents.storageContextId, storageContextId))
    .orderBy(desc(llmUsageEvents.occurredAt))
    .limit(safeLimit)
    .all()
  return rows.map((row) => ({
    ts: row.occurredAt,
    modelLabel: row.model,
    role: row.modelRole,
    inputTokens: row.inputTokens ?? 0,
    outputTokens: row.outputTokens ?? 0,
    finishStatus: row.finishReason ?? 'unknown',
  }))
}
```

- [x] **Step 4: Run the test until green**

Run: `bun test tests/usage/recent-requests.test.ts`
Expected: PASS (4 cases).

- [x] **Step 5: Commit**

```bash
git add src/usage/recent-requests.ts tests/usage/recent-requests.test.ts
git commit -m "$(cat <<'EOF'
feat(usage): add listRecentRequests query helper

Anonymous-shape helper returning the N most-recent llm_usage_events
for a given storage context. Returns only ts, modelLabel, role,
inputTokens, outputTokens, finishStatus per the /stats/* anonymity
contract. Limit is clamped to [0, 200].

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Backend — Zod schema + route handler

**Files:**

- Modify: `src/debug/schemas.ts`
- Modify: `src/debug/admin-system.ts`
- Modify: `src/debug/server.ts`

- [x] **Step 1: Add the schema to `src/debug/schemas.ts`**

Append at the bottom of the file (after the existing schemas):

```ts
export const RecentRequestSchema = z.object({
  ts: z.number().int().nonnegative(),
  modelLabel: z.string(),
  role: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  finishStatus: z.string(),
})

export const RecentRequestsResponseSchema = z.object({
  subjectId: z.string(),
  limit: z.number().int().nonnegative(),
  requests: z.array(RecentRequestSchema),
})

export type RecentRequest = z.infer<typeof RecentRequestSchema>
export type RecentRequestsResponse = z.infer<typeof RecentRequestsResponseSchema>
```

- [x] **Step 2: Add the handler to `src/debug/admin-system.ts`**

Append at the bottom of the file:

```ts
import { listRecentRequests } from '../usage/recent-requests.js'

const DEFAULT_RECENT_LIMIT = 25
const MAX_RECENT_LIMIT = 200

const parseLimit = (raw: string | null): number => {
  if (raw === null) return DEFAULT_RECENT_LIMIT
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return DEFAULT_RECENT_LIMIT
  return Math.max(0, Math.min(MAX_RECENT_LIMIT, Math.floor(parsed)))
}

export const handleAdminRecentRequests = (url: URL): Response => {
  const match = /^\/admin\/subjects\/(?<id>[^/]+)\/recent-requests$/u.exec(url.pathname)
  const rawId = match?.groups?.['id']
  if (rawId === undefined || rawId === '') {
    return new Response(JSON.stringify({ error: 'missing subject id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const subjectId = decodeURIComponent(rawId)
  const limit = parseLimit(url.searchParams.get('limit'))
  const requests = listRecentRequests(subjectId, limit)
  return new Response(JSON.stringify({ subjectId, limit, requests }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
```

The function MUST NOT include any content fields (message text, error bodies, etc.) — verify by inspection.

- [x] **Step 3: Wire the route in `src/debug/server.ts`**

Locate the existing admin pathname branches (around line 227, after `/admin/system` and `/admin/llm`). Add:

```ts
if (url.pathname.startsWith('/admin/subjects/') && url.pathname.endsWith('/recent-requests')) {
  return handleAdminRecentRequests(url)
}
```

Also add `handleAdminRecentRequests` to the import line from `./admin-system.js`.

**Read-route gating:** The existing pattern is "bearer-gated only when `DEBUG_TOKEN` is set; otherwise read-only routes are open". Mirror that. If the existing read-routes are routed through a shared `requireBearer(req)` helper, use it. If not, add no gating here — it inherits from the global routing layer.

- [x] **Step 4: Typecheck**

Run: `bun typecheck 2>&1 | tail -5`
Expected: green.

- [x] **Step 5: Hold the commit — Task 3 ships the route test alongside this code**

---

## Task 3: Backend — route integration test + commit

**Files:**

- Create: `tests/debug/admin-system.recent-requests.test.ts`

- [x] **Step 1: Read existing admin-system tests to mirror the harness pattern**

Run: `ls tests/debug/ | grep -i admin && cat tests/debug/admin-system.test.ts 2>/dev/null | head -40`

Use the existing setup pattern (Bun.serve harness, port allocation, env reset) from `tests/debug/server.test.ts` if no local pattern exists.

- [x] **Step 2: Write the test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { llmUsageEvents } from '../../src/db/schema.js'
import { handleAdminRecentRequests } from '../../src/debug/admin-system.js'
import { RecentRequestsResponseSchema } from '../../src/debug/schemas.js'
import { setupTestDb } from '../utils/test-helpers.js'

const baseRow = {
  turnId: 'turn_abc',
  contextType: 'dm',
  chatUserId: 'u1',
  model: 'gpt-4o-mini',
  modelRole: 'main',
  inputTokens: 100,
  outputTokens: 40,
  stepCount: 1,
  toolCallCount: 0,
  messageCount: 1,
  finishReason: 'stop',
  durationMs: 250,
  responseId: null,
  error: null,
}

const insert = (eventId: string, ctxId: string, occurredAt: number): void => {
  getDrizzleDb()
    .insert(llmUsageEvents)
    .values({ eventId, storageContextId: ctxId, occurredAt, ...baseRow })
    .run()
}

describe('handleAdminRecentRequests', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('returns 400 when subject id missing', async () => {
    const res = handleAdminRecentRequests(new URL('http://localhost/admin/subjects//recent-requests'))
    expect(res.status).toBe(400)
  })

  test('returns the anonymous shape with default limit of 25', async () => {
    insert('e1', 'user:1', 1000)
    insert('e2', 'user:1', 2000)
    const res = handleAdminRecentRequests(new URL('http://localhost/admin/subjects/user%3A1/recent-requests'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as unknown
    const parsed = RecentRequestsResponseSchema.parse(body)
    expect(parsed.subjectId).toBe('user:1')
    expect(parsed.limit).toBe(25)
    expect(parsed.requests).toHaveLength(2)
    expect(parsed.requests[0]?.ts).toBe(2000)
  })

  test('respects ?limit=', async () => {
    for (let i = 0; i < 5; i += 1) insert(`e${i}`, 'user:1', i * 1000)
    const res = handleAdminRecentRequests(new URL('http://localhost/admin/subjects/user%3A1/recent-requests?limit=2'))
    const body = (await res.json()) as { requests: unknown[] }
    expect(body.requests).toHaveLength(2)
  })

  test('clamps invalid limits to the default safe range', async () => {
    insert('e1', 'user:1', 1000)
    const res = handleAdminRecentRequests(new URL('http://localhost/admin/subjects/user%3A1/recent-requests?limit=-5'))
    const body = (await res.json()) as { requests: unknown[]; limit: number }
    expect(body.limit).toBe(0)
    expect(body.requests).toHaveLength(0)
  })

  test('never returns content-bearing fields', async () => {
    insert('e1', 'user:1', 1000)
    const res = handleAdminRecentRequests(new URL('http://localhost/admin/subjects/user%3A1/recent-requests'))
    const body = (await res.json()) as { requests: Record<string, unknown>[] }
    for (const row of body.requests) {
      for (const forbidden of ['chatUserId', 'turnId', 'responseId', 'error', 'message', 'prompt', 'content']) {
        expect(row[forbidden]).toBeUndefined()
      }
    }
  })
})
```

- [x] **Step 3: Run the test**

Run: `bun test tests/debug/admin-system.recent-requests.test.ts`
Expected: 5/5 PASS.

- [x] **Step 4: Commit tasks 2 + 3 together**

```bash
git add src/debug/schemas.ts src/debug/admin-system.ts src/debug/server.ts \
        tests/debug/admin-system.recent-requests.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): add GET /admin/subjects/:id/recent-requests

Returns the N most-recent llm_usage_events for a subject in the
anonymous shape { ts, modelLabel, role, inputTokens, outputTokens,
finishStatus }. Default limit 25, max 200, clamped to [0, 200].
Same anonymity contract as /stats/*: never returns chatUserId,
turnId, responseId, error bodies, or any content field.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Client — `global-stats.svelte.ts` data layer (TDD)

**Files:**

- Create: `client/admin/global-stats.svelte.ts`
- Create: `tests/client/admin/global-stats.test.ts`

- [x] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { adminGlobals, refreshGlobals } from '../../../client/admin/global-stats.svelte.js'
import { setMockFetch, restoreFetch } from '../../utils/test-helpers.js'

describe('global-stats', () => {
  beforeEach(() => {
    adminGlobals.window = '30d'
    adminGlobals.loading = false
    adminGlobals.data = null
    adminGlobals.fetchedAt = null
  })

  afterEach(() => {
    restoreFetch()
  })

  test('refreshGlobals writes data and fetchedAt on success', async () => {
    setMockFetch(async (input) => {
      const url = typeof input === 'string' ? input : input.toString()
      expect(url).toContain('/stats/global')
      expect(url).toContain('window=30d')
      return new Response(JSON.stringify({ subjects: 0, llmCalls: 0, toolCalls: 0, tokens: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      })
    })
    await refreshGlobals()
    expect(adminGlobals.data).not.toBeNull()
    expect(adminGlobals.fetchedAt).not.toBeNull()
    expect(adminGlobals.loading).toBe(false)
  })

  test('refreshGlobals leaves data null on http error', async () => {
    setMockFetch(async () => new Response('boom', { status: 500 }))
    await refreshGlobals()
    expect(adminGlobals.data).toBeNull()
    expect(adminGlobals.loading).toBe(false)
  })
})
```

- [x] **Step 2: Run the failing test**

Run: `bun test:client tests/client/admin/global-stats.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implement `client/admin/global-stats.svelte.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type StatsWindow = '24h' | '7d' | '30d' | 'all'

export interface GlobalStats {
  subjects?: number
  llmCalls?: number
  toolCalls?: number
  tokens?: number
  growthLast30d?: { ts: number; count: number }[]
  surfaceMix?: { label: string; value: number }[]
}

export const adminGlobals = $state({
  window: '30d' as StatsWindow,
  loading: false,
  data: null as GlobalStats | null,
  fetchedAt: null as number | null,
})

export async function refreshGlobals(): Promise<void> {
  adminGlobals.loading = true
  try {
    const res = await fetch(`/stats/global?window=${encodeURIComponent(adminGlobals.window)}`, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return
    const body = (await res.json()) as GlobalStats
    adminGlobals.data = body
    adminGlobals.fetchedAt = Date.now()
  } finally {
    adminGlobals.loading = false
  }
}
```

- [x] **Step 4: Run the test until green**

Run: `bun test:client tests/client/admin/global-stats.test.ts`
Expected: 2/2 PASS.

- [x] **Step 5: Commit**

```bash
git add client/admin/global-stats.svelte.ts tests/client/admin/global-stats.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): add adminGlobals + refreshGlobals data layer

Backs the upcoming OverviewSection KPIs, top-bar window Seg, sidebar
QuickStats, and 'last refreshed' label. Fetches /stats/global with
the current window; failures leave data untouched.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Client — extend `admin.svelte.ts` with `window` + helpers

**Files:**

- Modify: `client/admin/admin.svelte.ts`

- [x] **Step 1: Read the current file**

Run: `cat client/admin/admin.svelte.ts`. Confirm: `adminState` only has `currentSection` today.

- [x] **Step 2: Add the `window` field and helpers**

Replace the `adminState` declaration and `syncSectionFromLocation` with:

```ts
import { adminGlobals, refreshGlobals } from './global-stats.svelte.js'
import type { StatsWindow } from './global-stats.svelte.js'

// (existing `adminSections`, `AdminSectionId`, `sectionFromHash`, `sectionLabel` stay as-is)

export const adminState = $state({
  currentSection: sectionFromHash(typeof location === 'undefined' ? '' : location.hash),
  lastRefreshedAt: null as number | null,
})

export function setSection(id: AdminSectionId): void {
  adminState.currentSection = id
}

export function setWindow(next: StatsWindow): void {
  adminGlobals.window = next
  void refreshGlobals()
}

export async function refreshAll(): Promise<void> {
  await refreshGlobals()
  adminState.lastRefreshedAt = Date.now()
}

export function syncSectionFromLocation(): void {
  adminState.currentSection = sectionFromHash(location.hash)
}
```

- [x] **Step 3: Typecheck**

Run: `bun typecheck 2>&1 | tail -5`
Expected: green.

- [x] **Step 4: Run existing admin tests**

Run: `bun test:client tests/client/admin/`
Expected: green. If `admin.svelte.test.ts` exists and asserts on the old `adminState` shape, this task may surface a failure — fix the assertion in the same edit (add `lastRefreshedAt: null` to the assumed shape).

- [x] **Step 5: Commit**

```bash
git add client/admin/admin.svelte.ts $(ls tests/client/admin/admin.svelte.test.ts 2>/dev/null)
git commit -m "$(cat <<'EOF'
feat(admin): extend adminState with window + lastRefreshedAt helpers

setWindow writes adminGlobals.window and triggers refreshGlobals.
refreshAll fans out to refreshGlobals and records lastRefreshedAt
for the top-bar meta line.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Client — `scrollspy.ts` + IntersectionObserver test stub

**Files:**

- Create: `client/admin/scrollspy.ts`
- Create: `tests/client/admin/scrollspy.test.ts`
- Modify: `tests/client-setup.ts`

- [x] **Step 1: Add an IntersectionObserver stub to the client test setup**

In `tests/client-setup.ts`, mirror the existing `EventSource` stub block. After the `EventSource` stub, append:

```ts
if (typeof globalThis.IntersectionObserver === 'undefined') {
  class StubIntersectionObserver {
    callback: IntersectionObserverCallback
    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return []
    }
    readonly root = null
    readonly rootMargin = ''
    readonly thresholds: readonly number[] = []
  }
  // @ts-expect-error – minimal stub
  globalThis.IntersectionObserver = StubIntersectionObserver
}
```

- [x] **Step 2: Write the failing scrollspy test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { useScrollSpy } from '../../../client/admin/scrollspy.js'

type MockEntry = Pick<IntersectionObserverEntry, 'isIntersecting' | 'target' | 'intersectionRatio'>

let observers: { callback: (entries: MockEntry[]) => void; targets: Element[] }[] = []

class TrackingObserver {
  callback: (entries: MockEntry[]) => void
  targets: Element[] = []
  constructor(cb: IntersectionObserverCallback) {
    this.callback = cb as unknown as (e: MockEntry[]) => void
    observers.push({ callback: this.callback, targets: this.targets })
  }
  observe(el: Element): void {
    this.targets.push(el)
  }
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
  readonly root = null
  readonly rootMargin = ''
  readonly thresholds: readonly number[] = []
}

describe('useScrollSpy', () => {
  beforeEach(() => {
    observers = []
    document.body.innerHTML = `
      <section id="overview"></section>
      <section id="billing"></section>
      <section id="stats"></section>
    `
    // @ts-expect-error – override the stub for this test
    globalThis.IntersectionObserver = TrackingObserver
  })

  test('observes every provided id and forwards the active one', () => {
    let active: string | null = null
    const spy = useScrollSpy(['overview', 'billing', 'stats'], (id) => {
      active = id
    })
    spy.start()
    expect(observers).toHaveLength(1)
    expect(observers[0]?.targets).toHaveLength(3)
    const billingEl = document.querySelector('#billing')!
    observers[0]?.callback([{ isIntersecting: true, intersectionRatio: 1, target: billingEl } as MockEntry])
    expect(active).toBe('billing')
    spy.stop()
  })

  test('ignores non-intersecting entries', () => {
    let active: string | null = 'overview'
    const spy = useScrollSpy(['overview', 'billing'], (id) => {
      active = id
    })
    spy.start()
    const billingEl = document.querySelector('#billing')!
    observers[0]?.callback([{ isIntersecting: false, intersectionRatio: 0, target: billingEl } as MockEntry])
    expect(active).toBe('overview')
    spy.stop()
  })
})
```

- [x] **Step 3: Run the failing test**

Run: `bun test:client tests/client/admin/scrollspy.test.ts`
Expected: FAIL — module not found.

- [x] **Step 4: Implement `client/admin/scrollspy.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export interface ScrollSpyHandle {
  start: () => void
  stop: () => void
}

export const useScrollSpy = (sectionIds: readonly string[], onChange: (id: string) => void): ScrollSpyHandle => {
  let observer: IntersectionObserver | null = null

  const start = (): void => {
    if (observer !== null) return
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const id = entry.target.id
          if (sectionIds.includes(id)) onChange(id)
        }
      },
      { rootMargin: '-30% 0px -60% 0px' },
    )
    for (const id of sectionIds) {
      const el = document.getElementById(id)
      if (el !== null) observer.observe(el)
    }
  }

  const stop = (): void => {
    observer?.disconnect()
    observer = null
  }

  return { start, stop }
}
```

- [x] **Step 5: Run the test until green**

Run: `bun test:client tests/client/admin/scrollspy.test.ts`
Expected: 2/2 PASS.

- [x] **Step 6: Commit**

```bash
git add client/admin/scrollspy.ts tests/client/admin/scrollspy.test.ts tests/client-setup.ts
git commit -m "$(cat <<'EOF'
feat(admin): add useScrollSpy hook + IntersectionObserver test stub

One factory returns start/stop handles for $effect lifecycles.
The hook uses a single IntersectionObserver with rootMargin
'-30% 0px -60% 0px' across all section anchors, surfacing the
intersecting id via onChange. happy-dom doesn't ship
IntersectionObserver, so the client-setup stub mirrors the
EventSource one.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Client — `AdminTopBar.svelte` (TDD)

**Files:**

- Create: `client/admin/components/AdminTopBar.svelte`
- Create: `tests/client/admin/components/AdminTopBar.test.ts`

- [x] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import AdminTopBar from '../../../../client/admin/components/AdminTopBar.svelte'
import { adminGlobals } from '../../../../client/admin/global-stats.svelte.js'

describe('AdminTopBar.svelte', () => {
  let target: HTMLElement

  beforeEach(() => {
    adminGlobals.window = '30d'
    adminGlobals.data = null
    adminGlobals.fetchedAt = null
    adminGlobals.loading = false
    document.body.innerHTML = '<div id="root"></div>'
    target = document.body.querySelector<HTMLElement>('#root')!
  })

  test('renders brand "papai ::admin"', () => {
    const component = mount(AdminTopBar, { target, props: {} })
    expect(target.textContent).toContain('papai')
    expect(target.textContent).toContain('admin')
    void unmount(component)
  })

  test('Seg reflects adminGlobals.window and writes back on click', () => {
    const component = mount(AdminTopBar, { target, props: {} })
    const active = target.querySelector('.ui-seg__btn--active')
    expect(active?.textContent).toBe('30d')
    const sevenBtn = Array.from(target.querySelectorAll<HTMLButtonElement>('.ui-seg__btn')).find(
      (b) => b.textContent === '7d',
    )!
    sevenBtn.click()
    expect(adminGlobals.window).toBe('7d')
    void unmount(component)
  })

  test('renders a /debug back link', () => {
    const component = mount(AdminTopBar, { target, props: {} })
    const link = target.querySelector<HTMLAnchorElement>('a[href="/debug"]')
    expect(link).not.toBeNull()
    void unmount(component)
  })
})
```

- [x] **Step 2: Run the failing test**

Run: `bun test:client tests/client/admin/components/AdminTopBar.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implement `client/admin/components/AdminTopBar.svelte`**

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Btn from '../../shared/ui/Btn.svelte'
  import Pill from '../../shared/ui/Pill.svelte'
  import Seg from '../../shared/ui/Seg.svelte'
  import TopBar from '../../shared/ui/TopBar.svelte'

  import { adminState, refreshAll, setWindow } from '../admin.svelte.js'
  import { adminGlobals } from '../global-stats.svelte.js'
  import type { StatsWindow } from '../global-stats.svelte.js'

  const refreshedLabel = $derived.by(() => {
    if (adminState.lastRefreshedAt === null) return 'never'
    const seconds = Math.max(0, Math.floor((Date.now() - adminState.lastRefreshedAt) / 1000))
    if (seconds < 60) return `${seconds}s ago`
    const minutes = Math.floor(seconds / 60)
    return `${minutes}m ago`
  })
</script>

<TopBar page="admin">
  {#snippet statusRow()}
    <div class="admin-topbar__status">
      <Pill tone="accent" dot>{#snippet children()}configured{/snippet}</Pill>
      <span class="admin-topbar__sep"></span>
      <a class="admin-topbar__back" href="/debug">← /debug</a>
    </div>
  {/snippet}
  {#snippet secondaryRow()}
    <div class="admin-topbar__secondary">
      <span class="admin-topbar__lbl">window</span>
      <Seg
        options={['24h', '7d', '30d', 'all']}
        value={adminGlobals.window}
        onChange={(v) => setWindow(v as StatsWindow)} />
      <span class="admin-topbar__spacer"></span>
      <span class="admin-topbar__lbl">last refreshed</span>
      <span class="admin-topbar__stat">{refreshedLabel}</span>
      <Btn variant="ghost" size="sm" onClick={() => void refreshAll()}>
        {#snippet children()}refresh all{/snippet}
      </Btn>
    </div>
  {/snippet}
</TopBar>

<style>
  .admin-topbar__status,
  .admin-topbar__secondary {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
  }
  .admin-topbar__sep {
    width: 1px;
    height: 14px;
    background: var(--border);
  }
  .admin-topbar__back {
    color: var(--fg2);
    text-decoration: none;
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .admin-topbar__back:hover {
    color: var(--accent);
  }
  .admin-topbar__lbl {
    color: var(--fg3);
    font-family: var(--font-mono);
    font-size: 11px;
  }
  .admin-topbar__stat {
    color: var(--fg);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .admin-topbar__spacer {
    flex: 1;
  }
</style>
```

- [x] **Step 4: Run the test until green**

Run: `bun test:client tests/client/admin/components/AdminTopBar.test.ts`
Expected: 3/3 PASS.

- [x] **Step 5: Commit**

```bash
git add client/admin/components/AdminTopBar.svelte tests/client/admin/components/AdminTopBar.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): add AdminTopBar with brand, window Seg, refresh meta

Composes the shared TopBar primitive with admin-specific status
(configured pill, /debug back link) and secondary (window Seg,
last-refreshed clock, refresh-all button). Seg writes back to
adminGlobals.window via setWindow, which triggers refreshGlobals.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Client — `AdminSidebarPanel.svelte` (TDD)

**Files:**

- Create: `client/admin/components/AdminSidebarPanel.svelte`
- Create: `tests/client/admin/components/AdminSidebarPanel.test.ts`

- [x] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import AdminSidebarPanel from '../../../../client/admin/components/AdminSidebarPanel.svelte'

describe('AdminSidebarPanel.svelte', () => {
  let target: HTMLElement

  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>'
    target = document.body.querySelector<HTMLElement>('#root')!
  })

  test('renders an anchor link for each section', () => {
    const component = mount(AdminSidebarPanel, { target, props: { activeId: 'overview' } })
    for (const id of ['overview', 'billing', 'stats', 'memos', 'reminders', 'identities', 'groups', 'system']) {
      const link = target.querySelector<HTMLAnchorElement>(`a[href="#${id}"]`)
      expect(link).not.toBeNull()
    }
    void unmount(component)
  })

  test('marks the active link', () => {
    const component = mount(AdminSidebarPanel, { target, props: { activeId: 'billing' } })
    const active = target.querySelector('.admin-sidebar__link--active')
    expect(active?.getAttribute('href')).toBe('#billing')
    void unmount(component)
  })
})
```

- [x] **Step 2: Run the failing test**

Run: `bun test:client tests/client/admin/components/AdminSidebarPanel.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implement `client/admin/components/AdminSidebarPanel.svelte`**

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Caption from '../../shared/ui/Caption.svelte'
  import HR from '../../shared/ui/HR.svelte'
  import KV from '../../shared/ui/KV.svelte'

  import { adminGlobals } from '../global-stats.svelte.js'

  interface SidebarItem {
    id: string
    label: string
  }

  const items: readonly SidebarItem[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'billing', label: 'Billing' },
    { id: 'stats', label: 'Stats' },
    { id: 'memos', label: 'Memos' },
    { id: 'reminders', label: 'Reminders' },
    { id: 'identities', label: 'Identities' },
    { id: 'groups', label: 'Groups' },
    { id: 'system', label: 'System' },
  ]

  interface Props {
    activeId: string
  }

  let { activeId }: Props = $props()
</script>

<aside class="admin-sidebar">
  <Caption>{#snippet children()}sections{/snippet}</Caption>
  <nav class="admin-sidebar__nav">
    {#each items as item (item.id)}
      <a
        class="admin-sidebar__link"
        class:admin-sidebar__link--active={activeId === item.id}
        href={`#${item.id}`}>
        {item.label}
      </a>
    {/each}
  </nav>
  <HR />
  <Caption>{#snippet children()}quick stats{/snippet}</Caption>
  <div class="admin-sidebar__kvs">
    <KV k="DM" v={adminGlobals.data?.subjects?.dmTotal ?? '—'} />
    <KV k="active" v={adminGlobals.data?.active?.activeIn30d ?? '—'} />
    <KV k="tools" v="—" />
  </div>
</aside>

<style>
  .admin-sidebar {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    background: var(--surface);
    border-right: 1px solid var(--border);
    min-height: 100vh;
  }
  .admin-sidebar__nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .admin-sidebar__link {
    color: var(--fg2);
    text-decoration: none;
    padding: 6px 8px;
    font-family: var(--font-mono);
    font-size: 12px;
    border-left: 2px solid transparent;
  }
  .admin-sidebar__link:hover {
    color: var(--fg);
    background: var(--raised);
  }
  .admin-sidebar__link--active {
    color: var(--accent);
    border-left-color: var(--accent);
    background: var(--raised);
  }
  .admin-sidebar__kvs {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
</style>
```

- [x] **Step 4: Run the test until green**

Run: `bun test:client tests/client/admin/components/AdminSidebarPanel.test.ts`
Expected: 2/2 PASS.

If `KV.svelte` uses different snippet prop names than `k`/`v`, read the component first and adjust the call sites in this file.

- [x] **Step 5: Commit**

```bash
git add client/admin/components/AdminSidebarPanel.svelte \
        tests/client/admin/components/AdminSidebarPanel.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): add AdminSidebarPanel with anchor links + quick stats

Plain <a href="#section-id"> anchors driving scrollspy via the
hash machinery wired in admin.svelte.ts. Quick-stats KV block at
the bottom subscribes to adminGlobals.data and shows "—" until
the first refresh completes.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Client — `OverviewSection.svelte` (KPIs + Spark + Bars)

**Files:**

- Create: `client/admin/sections/OverviewSection.svelte`
- Create: `tests/client/admin/sections/OverviewSection.test.ts`

- [x] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import OverviewSection from '../../../../client/admin/sections/OverviewSection.svelte'
import { adminGlobals } from '../../../../client/admin/global-stats.svelte.js'

describe('OverviewSection.svelte', () => {
  let target: HTMLElement

  beforeEach(() => {
    adminGlobals.data = null
    document.body.innerHTML = '<div id="root"></div>'
    target = document.body.querySelector<HTMLElement>('#root')!
  })

  test('renders an empty state when adminGlobals.data is null', () => {
    const component = mount(OverviewSection, { target, props: {} })
    expect(target.textContent).toContain('—')
    void unmount(component)
  })

  test('renders KPI values when data is present', () => {
    adminGlobals.data = { subjects: 32, llmCalls: 412, toolCalls: 98, tokens: 184_000 }
    const component = mount(OverviewSection, { target, props: {} })
    const text = String(target.textContent)
    expect(text).toContain('32')
    expect(text).toContain('412')
    expect(text).toContain('98')
    void unmount(component)
  })
})
```

- [x] **Step 2: Run the failing test**

Run: `bun test:client tests/client/admin/sections/OverviewSection.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implement `client/admin/sections/OverviewSection.svelte`**

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Bars from '../../shared/ui/Bars.svelte'
  import KV from '../../shared/ui/KV.svelte'
  import Panel from '../../shared/ui/Panel.svelte'
  import Spark from '../../shared/ui/Spark.svelte'

  import { adminGlobals } from '../global-stats.svelte.js'

  const sparkPoints = $derived(adminGlobals.data?.growthLast30d?.map((p) => p.count) ?? [])
  const barEntries = $derived(adminGlobals.data?.surfaceMix ?? [])
</script>

<section id="overview" class="admin-section">
  <Panel title="overview">
    <div class="admin-overview__kpis">
      <KV k="subjects" v={adminGlobals.data?.subjects ?? '—'} />
      <KV k="llm calls" v={adminGlobals.data?.llmCalls ?? '—'} />
      <KV k="tool calls" v={adminGlobals.data?.toolCalls ?? '—'} />
      <KV k="tokens" v={adminGlobals.data?.tokens ?? '—'} />
    </div>
    <div class="admin-overview__charts">
      <div class="admin-overview__spark">
        <Spark values={sparkPoints} />
      </div>
      <div class="admin-overview__bars">
        <Bars values={barEntries} />
      </div>
    </div>
  </Panel>
</section>

<style>
  .admin-section {
    scroll-margin-top: 96px;
  }
  .admin-overview__kpis {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
    padding: 12px;
  }
  .admin-overview__charts {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 12px;
    padding: 12px;
    border-top: 1px solid var(--hair);
  }
</style>
```

Verify before final write: `Panel.svelte`'s `title` prop, `Spark.svelte`'s `values` prop, `Bars.svelte`'s `values` prop. Read each one. If a prop is named differently (e.g. `data` instead of `values`), adjust.

- [x] **Step 4: Run the test until green**

Run: `bun test:client tests/client/admin/sections/OverviewSection.test.ts`
Expected: 2/2 PASS.

- [x] **Step 5: Commit**

```bash
git add client/admin/sections/OverviewSection.svelte \
        tests/client/admin/sections/OverviewSection.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): add OverviewSection with KPI cards + growth + mix

Four KPI cards (subjects, llm calls, tool calls, tokens) over a
two-column chart row (growth Spark 2fr, surface-mix Bars 1fr).
All values subscribe to adminGlobals.data; falls back to "—"
until the first refresh.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Client — Add recent-requests block to `SubjectDetail.svelte`

**Files:**

- Modify: `client/admin/components/SubjectDetail.svelte`
- Modify: `client/admin/fetchers.ts`
- Modify: `client/admin/fetcher-schemas.ts`

- [x] **Step 1: Read the current SubjectDetail + fetchers**

Run: `cat client/admin/components/SubjectDetail.svelte | head -60`
Run: `cat client/admin/fetchers.ts | head -40`
Run: `cat client/admin/fetcher-schemas.ts | head -40`

Confirm the existing fetch pattern (Zod-validated `fetch` wrappers).

- [x] **Step 2: Add the schema and fetcher**

In `client/admin/fetcher-schemas.ts`, mirror an existing schema block and append:

```ts
export const RecentRequestRowSchema = z.object({
  ts: z.number(),
  modelLabel: z.string(),
  role: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  finishStatus: z.string(),
})

export const RecentRequestsResponseSchema = z.object({
  subjectId: z.string(),
  limit: z.number(),
  requests: z.array(RecentRequestRowSchema),
})

export type RecentRequestRow = z.infer<typeof RecentRequestRowSchema>
```

In `client/admin/fetchers.ts`:

```ts
import { RecentRequestsResponseSchema } from './fetcher-schemas.js'
import type { RecentRequestRow } from './fetcher-schemas.js'

export async function fetchRecentRequests(subjectId: string, limit = 25): Promise<RecentRequestRow[]> {
  const res = await fetch(`/admin/subjects/${encodeURIComponent(subjectId)}/recent-requests?limit=${limit}`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) return []
  const body = (await res.json()) as unknown
  const parsed = RecentRequestsResponseSchema.safeParse(body)
  return parsed.success ? parsed.data.requests : []
}
```

- [x] **Step 3: Add a `recentRequests` block to `SubjectDetail.svelte`**

Inside `<script>`, add:

```ts
import { fetchRecentRequests } from '../fetchers.js'
import type { RecentRequestRow } from '../fetcher-schemas.js'

let recentRequests = $state<RecentRequestRow[]>([])

$effect(() => {
  const id = subjectId
  void (async () => {
    recentRequests = await fetchRecentRequests(id, 25)
  })()
})
```

In the template, add a panel below the existing detail content:

```svelte
<Panel title="recent requests">
  {#if recentRequests.length === 0}
    <p class="admin-subject__empty">no recent activity</p>
  {:else}
    <table class="admin-subject__requests">
      <thead>
        <tr>
          <th>ts</th>
          <th>model</th>
          <th>role</th>
          <th>in</th>
          <th>out</th>
          <th>status</th>
        </tr>
      </thead>
      <tbody>
        {#each recentRequests as r (r.ts)}
          <tr>
            <td>{new Date(r.ts).toISOString()}</td>
            <td>{r.modelLabel}</td>
            <td>{r.role}</td>
            <td>{r.inputTokens}</td>
            <td>{r.outputTokens}</td>
            <td>{r.finishStatus}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</Panel>
```

Add a corresponding CSS block inside the file's `<style>`:

```css
.admin-subject__requests {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--font-mono);
  font-size: 12px;
}
.admin-subject__requests th {
  text-align: left;
  color: var(--fg3);
  font-weight: normal;
  border-bottom: 1px solid var(--hair);
  padding: 4px 8px;
}
.admin-subject__requests td {
  padding: 4px 8px;
  border-bottom: 1px solid var(--hair);
  color: var(--fg);
}
.admin-subject__empty {
  padding: 12px;
  color: var(--fg3);
  font-family: var(--font-mono);
  font-size: 12px;
  margin: 0;
}
```

- [x] **Step 4: Run any existing SubjectDetail tests**

Run: `bun test:client tests/client/admin/`
Expected: green. If a test asserts on the absence of the recent-requests block, update it.

- [x] **Step 5: Commit**

```bash
git add client/admin/components/SubjectDetail.svelte \
        client/admin/fetchers.ts client/admin/fetcher-schemas.ts
git commit -m "$(cat <<'EOF'
feat(admin): wire SubjectDetail to /admin/subjects/:id/recent-requests

Adds a recent-requests panel under the existing subject detail body
using the anonymous-shape endpoint introduced earlier in this PR.
Default limit 25.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Client — Inline `BillingSection` detail (drop modal)

**Files:**

- Modify: `client/admin/sections/BillingSection.svelte`

- [x] **Step 1: Read the current file**

Run: `cat client/admin/sections/BillingSection.svelte`
Identify: the `<Modal>` block that wraps subject detail, the local selection state (likely `selectedSubject`), the per-section window selector.

- [x] **Step 2: Replace the modal with an inline panel**

Drop the `<Modal>` import and block. Replace with:

```svelte
{#if selectedSubject !== null}
  <div class="billing-inline-detail">
    <SubjectDetail subjectId={selectedSubject.id} />
    <SubjectStatsPanel subjectId={selectedSubject.id} />
  </div>
{/if}
```

(Verify component prop names against existing usage. If existing modal passed a full `subject` object, mirror that.)

Drop the per-section window selector import (`WindowSelect`) and its usage. Read `adminGlobals.window` instead from a `$derived` if BillingSection needs to filter — but per spec §8 the top-bar owns this, so the section's own state just subscribes.

- [x] **Step 3: CSS block at the bottom of the file**

```css
.billing-inline-detail {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 12px;
  margin-top: 12px;
}
```

- [x] **Step 4: Run existing BillingSection tests**

Run: `bun test:client tests/client/admin/`
Expected: green. If a test asserts on the modal, update it to check for `.billing-inline-detail`.

- [x] **Step 5: Commit**

```bash
git add client/admin/sections/BillingSection.svelte \
        $(ls tests/client/admin/sections/BillingSection.test.ts 2>/dev/null)
git commit -m "$(cat <<'EOF'
refactor(admin): inline BillingSection subject detail; drop modal

Selecting a row now reveals SubjectDetail + SubjectStatsPanel
inline below the table (1.4fr / 1fr grid) instead of opening a
modal. Per-section window selector removed — the top-bar Seg
owns it now.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Client — per-section lazy fetch on Memos / Reminders / Identities / Groups

**Files:**

- Modify: `client/admin/sections/MemosSection.svelte`
- Modify: `client/admin/sections/RemindersSection.svelte`
- Modify: `client/admin/sections/IdentitiesSection.svelte`
- Modify: `client/admin/sections/GroupsSection.svelte`

For each of the four files:

- [x] **Step 1: Read the current fetch pattern**

Find the existing `onMount` or `$effect` that triggers the initial fetch. Capture the body in a function (e.g. `loadInitial`).

- [x] **Step 2: Replace eager fetch with a one-shot intersection observer**

```svelte
<script lang="ts">
  // ... existing imports + state ...

  let rootEl: HTMLElement
  let loaded = $state(false)

  async function loadInitial(): Promise<void> {
    if (loaded) return
    loaded = true
    // ... existing fetch logic ...
  }

  $effect(() => {
    if (rootEl === undefined) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            void loadInitial()
            observer.disconnect()
            return
          }
        }
      },
      { rootMargin: '0px' },
    )
    observer.observe(rootEl)
    return () => observer.disconnect()
  })
</script>

<section id="memos" class="admin-section" bind:this={rootEl}>
  <!-- existing content -->
</section>
```

(Match the section id to the file: `memos`, `reminders`, `identities`, `groups`.)

- [x] **Step 3: Verify the IntersectionObserver stub from Task 6 keeps existing tests green**

The stub's `observe` is a no-op, so under tests these sections never auto-load — which matches their old behavior (most tests inject data directly via state). If a test relied on auto-fetching, call `loadInitial` explicitly in the test or fix the test to write state directly.

- [x] **Step 4: Run client tests**

Run: `bun test:client tests/client/admin/`
Expected: green.

- [x] **Step 5: Commit (one commit for all four sections)**

```bash
git add client/admin/sections/MemosSection.svelte \
        client/admin/sections/RemindersSection.svelte \
        client/admin/sections/IdentitiesSection.svelte \
        client/admin/sections/GroupsSection.svelte
git commit -m "$(cat <<'EOF'
perf(admin): lazy-fetch Memos/Reminders/Identities/Groups on scroll

Each section registers a one-shot IntersectionObserver in $effect
that triggers the initial fetch only when scrolled into view.
Subsequent refreshes still flow through refreshAll.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Client — `SystemSection` debug-token note

**Files:**

- Modify: `client/admin/sections/SystemSection.svelte`

- [x] **Step 1: Locate the section header**

Read `client/admin/sections/SystemSection.svelte`. Find the title line (likely `<Panel title="System">` or similar).

- [x] **Step 2: Add an inline header note**

Above the credentials form, add:

```svelte
<p class="admin-system__note">POST /admin/llm requires DEBUG_TOKEN</p>
```

And CSS:

```css
.admin-system__note {
  color: var(--fg3);
  font-family: var(--font-mono);
  font-size: 11px;
  margin: 8px 12px 0;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
```

- [x] **Step 3: Run tests**

Run: `bun test:client tests/client/admin/`
Expected: green.

- [x] **Step 4: Commit**

```bash
git add client/admin/sections/SystemSection.svelte
git commit -m "$(cat <<'EOF'
docs(admin): surface DEBUG_TOKEN requirement on System section

Inline caps note above the credentials form so operators know the
POST surface needs bearer auth before they try to save.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Client — Rewrite `AdminApp.svelte` (one-page shell)

**Files:**

- Modify: `client/admin/AdminApp.svelte`

- [x] **Step 1: Read the current file**

Confirm the current per-section if/else block and the hashchange listener.

- [x] **Step 2: Replace the file in full**

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { onMount } from 'svelte'

  import Shell from '../shared/ui/Shell.svelte'

  import { adminState, refreshAll, setSection } from './admin.svelte.js'
  import AdminSidebarPanel from './components/AdminSidebarPanel.svelte'
  import AdminTopBar from './components/AdminTopBar.svelte'
  import { useScrollSpy } from './scrollspy.js'
  import BillingSection from './sections/BillingSection.svelte'
  import GroupsSection from './sections/GroupsSection.svelte'
  import IdentitiesSection from './sections/IdentitiesSection.svelte'
  import MemosSection from './sections/MemosSection.svelte'
  import OverviewSection from './sections/OverviewSection.svelte'
  import RemindersSection from './sections/RemindersSection.svelte'
  import StatsSection from './sections/StatsSection.svelte'
  import SystemSection from './sections/SystemSection.svelte'

  const sectionIds = ['overview', 'billing', 'stats', 'memos', 'reminders', 'identities', 'groups', 'system']

  onMount(() => {
    void refreshAll()
    const initial = window.location.hash.replace(/^#/u, '')
    if (sectionIds.includes(initial)) {
      document.getElementById(initial)?.scrollIntoView({ behavior: 'instant' as ScrollBehavior })
    }
    const spy = useScrollSpy(sectionIds, (id) => {
      setSection(id as typeof adminState.currentSection)
      if (window.location.hash !== `#${id}`) {
        window.history.replaceState(null, '', `#${id}`)
      }
    })
    spy.start()
    return () => spy.stop()
  })
</script>

<Shell>
  {#snippet topBar()}
    <AdminTopBar />
  {/snippet}
  {#snippet children()}
    <div class="admin-grid">
      <AdminSidebarPanel activeId={adminState.currentSection} />
      <main class="admin-grid__main">
        <OverviewSection />
        <BillingSection />
        <StatsSection />
        <MemosSection />
        <RemindersSection />
        <IdentitiesSection />
        <GroupsSection />
        <SystemSection />
      </main>
    </div>
  {/snippet}
</Shell>
```

- [x] **Step 3: Update `tests/client/admin/components/AdminApp.test.ts` if it exists**

Run: `ls tests/client/admin/AdminApp.test.ts tests/client/admin/components/AdminApp.test.ts 2>/dev/null`

If found, simplify assertions: replace any `if/else by currentSection` assumption with checks that all section ids exist as `<section>` anchors.

- [x] **Step 4: Run client tests**

Run: `bun test:client tests/client/admin/`
Expected: green.

- [x] **Step 5: Commit**

```bash
git add client/admin/AdminApp.svelte \
        $(ls tests/client/admin/AdminApp.test.ts tests/client/admin/components/AdminApp.test.ts 2>/dev/null)
git commit -m "$(cat <<'EOF'
feat(admin): rebuild AdminApp as one-page scrolling shell

All eight sections render simultaneously as <section id="..."> anchors
under a single <main>. Sidebar links scroll via plain hash navigation;
useScrollSpy mirrors the active id back into adminState and
window.location.hash. refreshAll runs on mount.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Client — Migrate `admin.css` to grid + sticky chrome

**Files:**

- Modify: `client/admin/admin.css`

- [x] **Step 1: Read the current admin.css**

Identify legacy selectors: `.admin-shell`, `.admin-topbar` (the legacy one, not the new `admin-topbar__*` namespace from the new top bar), `.admin-body`, `.admin-pane`.

- [x] **Step 2: Replace the page-level layout**

Drop the legacy `.admin-shell`, `.admin-topbar` block (the standalone one), `.admin-body`, `.admin-pane` rules. Append:

```css
.admin-grid {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 0;
  min-height: 0;
}
.admin-grid__main {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 24px;
  min-width: 0;
}
.admin-section {
  scroll-margin-top: 96px;
}
```

Keep all section-internal CSS (`.billing-*`, `.memos-*`, etc.) untouched.

- [x] **Step 3: Rebuild + inspect**

Run: `bun build:client && grep -c '^\.admin-grid' public/admin.css`
Expected: ≥ 1.
Run: `grep -cE '^\.admin-shell|^\.admin-body|^\.admin-pane' public/admin.css`
Expected: 0.

- [x] **Step 4: Run client tests**

Run: `bun test:client 2>&1 | tail -5`
Expected: green.

- [x] **Step 5: Manual smoke (optional)**

Run: `bun start:debug`, open `/admin`, scroll through sections, click sidebar links, switch the window Seg, verify quick-stats populate, expand a billing row to confirm the inline detail panel renders.

- [x] **Step 6: Commit**

```bash
git add client/admin/admin.css
git commit -m "$(cat <<'EOF'
refactor(admin): replace legacy CSS with two-column grid shell

Drop .admin-shell / .admin-topbar / .admin-body / .admin-pane
in favor of .admin-grid (220px sidebar + minmax(0, 1fr) main).
Sections get scroll-margin-top so anchor jumps clear the sticky
top bar.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Client — Delete `NavSidebar.svelte` and `WindowSelect.svelte`

**Files:**

- Delete: `client/admin/components/NavSidebar.svelte`
- Delete: `client/admin/components/WindowSelect.svelte`
- Delete (if present): the matching test files

- [x] **Step 1: Confirm no surviving imports**

Run:

```
grep -rn "NavSidebar\|WindowSelect" client/ tests/client/
```

Expected: no matches. If any survive, STOP — Tasks 11 and 14 were supposed to drop them.

- [x] **Step 2: Check for orphan test files**

Run: `ls tests/client/admin/components/ | grep -E "NavSidebar|WindowSelect"`. For each match, `git rm`.

- [x] **Step 3: Delete the components**

```bash
git rm client/admin/components/NavSidebar.svelte client/admin/components/WindowSelect.svelte
```

- [x] **Step 4: Run full client suite**

Run: `bun test:client 2>&1 | tail -5`
Expected: green.

- [x] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore(admin): remove NavSidebar and WindowSelect components

Both were superseded by AdminSidebarPanel and the AdminTopBar
window Seg respectively.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Full check + anonymity verification

**Files:** none modified

- [x] **Step 1: Full check pipeline**

Run: `bun check:full`
Expected: 12/12 green. If anything fails, fix the root cause — never `--no-verify`.

- [x] **Step 2: Anonymity grep over the new endpoint**

Run:

```bash
grep -nE "chatUserId|turnId|responseId|message|prompt|content" src/usage/recent-requests.ts src/debug/admin-system.ts
```

Expected: no matches inside `listRecentRequests` or `handleAdminRecentRequests` (an import line referencing the table type is fine; the mapped row must NOT carry any of these). If a forbidden field surfaces, STOP — anonymity contract violation.

- [x] **Step 3: Client + backend test runs**

Run:

```bash
bun test
bun test:client
```

Expected: all green. New tests should add 5 (recent-requests route) + 4 (recent-requests query) + 2 (global-stats) + 2 (scrollspy) + 3 (AdminTopBar) + 2 (AdminSidebarPanel) + 2 (OverviewSection) = ~20 new cases over the PR 2 baseline.

- [x] **Step 4: Bundle verification**

Run: `bun build:client && grep -c '^\.admin-grid' public/admin.css`
Expected: ≥ 1.
Run: `grep -cE '^\.admin-shell|^\.admin-body|^\.admin-pane' public/admin.css`
Expected: 0.

- [x] **Step 5: Manual smoke (optional but recommended)**

Run: `bun start:debug`.

- Open `/admin`. Verify the top bar renders `papai ::admin`, `configured` pill, `← /debug` link, window Seg (default `30d`), `refresh all` button.
- Click `7d` — confirm sidebar quick-stats refresh, refreshed clock updates.
- Scroll through the page — confirm the active sidebar link updates as each section becomes the dominant viewport (`-30% / -60%` rootMargin).
- Click any sidebar link — confirm smooth(ish) jump and hash update.
- Click a billing subject row — confirm inline detail + stats panel render below, including the recent-requests panel.
- Open the `System` section — confirm the inline note `POST /admin/llm requires DEBUG_TOKEN` shows above the form.

- [x] **Step 6: No final commit — all work was committed task-by-task**

PR 3 ships when this checklist is clean.

---

## Spec Coverage Self-Check

PR 3 covers spec sections 8 + 9 in full:

- 8.1 Layout (two-column grid 220px sidebar + main) — Task 14 + Task 15
- 8.2 Sidebar (`AdminSidebarPanel` with caps + counts + KV quick-stats) — Task 8
- 8.3 Scrollspy (`useScrollSpy` + rootMargin `-30% / -60%` + hash sync) — Task 6 + Task 14
- 8.4 Sections (Overview new; Billing inline detail; Memos/Reminders/Identities/Groups same shape restyled; System note) — Tasks 9, 11, 12, 13
- 8.5 Global window selector (top-bar Seg → `adminGlobals.window` → `refreshGlobals()`) — Task 4 + Task 5 + Task 7
- 8.6 Per-section lazy fetch — Task 12
- 8.7 Backend `GET /admin/subjects/:id/recent-requests` with the anonymous shape — Tasks 1, 2, 3
- 8.8 Tests (`scrollspy.test.ts`, `admin-system.recent-requests.test.ts`) — Tasks 3 + 6
- 9 Data plumbing (`adminGlobals` + `refreshGlobals` + subscriber wiring) — Task 4 + Task 5 + Task 7 + Task 8 + Task 9

Out of scope for this plan (deferred to PR 4):

- Section 10 (polish: real growth/mix data from `/stats/global`, modal restyle for surviving CRUD flows, KPI sub-labels, dead-code sweep).

## Drift Log

| Date       | Category           | Item                                                                                                                                                            | Decision                                                                                                            |
| ---------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 2026-05-23 | In-plan, accurate  | All 17 tasks (87 checkboxes) — implementation exists on `claude/split-dashboard-admin-zaoys`                                                                    | Flipped all `[ ]` → `[x]` via replace_all                                                                           |
| 2026-05-23 | In-plan, divergent | Task 8 (SubjectDetail recent-requests block): KV used Svelte snippet props (`{#snippet k()}`) in plan; actual `KV.svelte` uses direct string props (`k=`, `v=`) | Code wins — plan rewritten to direct-prop syntax with real field paths (`subjects?.dmTotal`, `active?.activeIn30d`) |
| 2026-05-23 | In-plan, divergent | Task 9 (OverviewSection KPIs): same KV snippet vs direct-prop divergence                                                                                        | Code wins — plan rewritten to direct-prop syntax matching `AdminSidebarPanel.svelte` implementation                 |
