<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# papai — Core Notify Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a token-authenticated `POST /api/notify { contextId, contextType?, threadId?, markdown }` endpoint to papai's web server that resolves the platform instance from `context_settings` and delivers a proactive chat message via `ChatRouter.sendMessage`. This is the receiver for magi's milestone Notifier (plan #5), whose payload is `{ contextId, markdown }`.

**Architecture:** Spec plan #6 (`docs/superpowers/specs/2026-06-16-acp-plugin-design.md`, §6.2). A new `src/notify-token.ts` reads a `notify_token` from `system_config` (lazily seeded from the `NOTIFY_TOKEN` env var). A new `src/debug/notify-route.ts` validates a Bearer token (timing-safe) against it, parses the body with Zod v4, builds a `DeferredDeliveryTarget`, resolves the instance with `resolveDeliveryPlatformInstanceId`, and calls `getRuntimeChatRouter().sendMessage(...)`. The route is mounted in `src/debug/server.ts`'s `routeRequest` **before** `isAuthorizedRequest` (its own trust plane — not the dashboard session cookie, not `DEBUG_TOKEN`) and is **not** in `DEBUG_ONLY_PATHS`, so it is reachable regardless of `DEBUG_SERVER`.

**Scope notes:** delivery reuses the existing deferred-prompt plumbing (`resolveDeliveryPlatformInstanceId` reads `context_settings`; `ChatRouter.sendMessage` guards instance liveness). `contextType`/`threadId` are optional — DM delivery works from `contextId` alone; for unambiguous **group** delivery the caller should pass `contextType: 'group'` (+ `threadId`). magi's #5 Notifier currently sends only `{ contextId, markdown }`; carrying `contextType`/`threadId` is a small magi/#7 follow-up (the plugin captures them at session start) — documented below, not required for this plan.

**Tech Stack:** Bun, TypeScript (strict, `.js` import paths), Zod v4, pino. Existing harness: `bun run test` (bun:test, parallel), `bun check` (staged lint/typecheck/format/**license-headers**), `bun check:full` (adds knip/duplicates/test:client). TDD write-hooks block `src/**/*.ts` writes without a matching `tests/**` test that imports the module; inline lint-disable/`@ts-ignore` are blocked.

---

## House rules (papai harness — obey)

- No semicolons; single quotes; `.js` extension on every relative import; `import type` for type-only imports; Zod v4 for body validation; error idiom `error instanceof Error ? error.message : String(error)`.
- **License header** (the 4-line BUSL block) at the top of every new `src/**` and `tests/**` file — `bun check` (`license-headers`) enforces it. Run `bun run license:headers` to auto-stamp if you forget.
- **TDD hook:** write `tests/<path>.test.ts` (importing the module via its `../../src/<path>.js` path) **before** the `src` file, or the write is blocked.
- No inline suppressions; don't edit `.oxlintrc.json`. Fix root causes.
- Tests: `import { afterEach, beforeEach, describe, expect, test } from 'bun:test'`; `setupTestDb()` + `mockLogger()` from `tests/utils/test-helpers.ts`; DI-first; mock the chat router with a `class extends ChatRouter` override (see exemplar in `tests/debug/settings/admin/roster-plugins-routes.test.ts`).
- Per-task gate: `bun check`. Final: `bun run test` + `bun check:full`.

## File Structure

**Create:**

- `src/notify-token.ts` — `getNotifyToken()` (system_config-backed, lazy env seed) + `resetNotifyTokenCacheForTesting()`.
- `src/debug/notify-route.ts` — `NotifyBody`, `buildNotifyTarget()`, `handleNotifyRoute()`.
- `tests/notify-token.test.ts`, `tests/debug/notify-route.test.ts`.

**Modify:**

- `src/debug/server.ts` — mount `handleNotifyRoute` in `routeRequest` before `isAuthorizedRequest`.
- `tests/debug/server.test.ts` (or the nearest existing server-routing test) — assert `/api/notify` is reachable via `routeRequestForTest` regardless of `debugEnabled`.

---

## Task 1: `notify-token` module

`getNotifyToken()` returns the `notify_token` from `system_config`, lazily seeding it from `process.env['NOTIFY_TOKEN']` on first read (so no `index.ts` startup change is needed). Mirrors the `stats_anonymity_salt` lazy pattern in `src/stats/hashing.ts`.

**Files:** Create `src/notify-token.ts`, `tests/notify-token.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/notify-token.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { getNotifyToken, resetNotifyTokenCacheForTesting } from '../src/notify-token.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

describe('notify-token', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    resetNotifyTokenCacheForTesting()
    delete process.env['NOTIFY_TOKEN']
  })

  afterEach(() => {
    delete process.env['NOTIFY_TOKEN']
    resetNotifyTokenCacheForTesting()
  })

  test('returns null when neither db nor env has a token', () => {
    expect(getNotifyToken()).toBeNull()
  })

  test('lazily seeds from NOTIFY_TOKEN env and caches it', () => {
    process.env['NOTIFY_TOKEN'] = 'super-secret'
    expect(getNotifyToken()).toBe('super-secret')
    // a second read returns the cached value even after the env is cleared
    delete process.env['NOTIFY_TOKEN']
    expect(getNotifyToken()).toBe('super-secret')
  })

  test('persists the seeded token to system_config (survives cache reset)', () => {
    process.env['NOTIFY_TOKEN'] = 'persisted'
    expect(getNotifyToken()).toBe('persisted')
    resetNotifyTokenCacheForTesting()
    delete process.env['NOTIFY_TOKEN']
    expect(getNotifyToken()).toBe('persisted')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/notify-token.test.ts`
Expected: FAIL — `../src/notify-token.js` not found.

- [ ] **Step 3: Implement**

Create `src/notify-token.ts`. **Match the exact imports `src/system-config.ts` uses** for `getDrizzleDb`, the `systemConfig` table, and `sql` (open `src/system-config.ts` and copy its import lines — they are the source of truth for the paths):

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { sql } from 'drizzle-orm'

import { getDrizzleDb } from './db.js' // align with src/system-config.ts's actual path
import { systemConfig } from './db/schema.js' // align with src/system-config.ts's actual path
import { logger } from './logger.js'

const log = logger.child({ scope: 'notify-token' })
const NOTIFY_TOKEN_KEY = 'notify_token'

let cached: string | null = null

const readFromDb = (): string | null => {
  const rows = getDrizzleDb()
    .select()
    .from(systemConfig)
    .where(sql`${systemConfig.key} = ${NOTIFY_TOKEN_KEY}`)
    .all()
  const found = rows[0]?.value
  return found !== undefined && found !== '' ? found : null
}

const seedToDb = (value: string): void => {
  getDrizzleDb()
    .insert(systemConfig)
    .values({ key: NOTIFY_TOKEN_KEY, value, updatedAt: Date.now(), updatedBy: 'env' })
    .onConflictDoUpdate({
      target: systemConfig.key,
      set: { value: sql`excluded.value`, updatedAt: sql`excluded.updated_at`, updatedBy: sql`excluded.updated_by` },
    })
    .run()
}

export const getNotifyToken = (): string | null => {
  if (cached !== null) return cached
  const existing = readFromDb()
  if (existing !== null) {
    cached = existing
    return existing
  }
  const env = process.env['NOTIFY_TOKEN']
  if (env === undefined || env.trim() === '') return null
  const value = env.trim()
  seedToDb(value)
  cached = value
  log.info('notify_token seeded from env')
  return value
}

export const resetNotifyTokenCacheForTesting = (): void => {
  cached = null
}
```

> Verify against `src/system-config.ts`: the `systemConfig` row shape (`key`, `value`, `updatedAt`, `updatedBy`) and the `onConflictDoUpdate` form are copied from its `setSystemConfig`. If the column names differ (e.g. `updated_at` vs `updatedAt` in the Drizzle model), use the exact identifiers from the schema.

- [ ] **Step 4: Pass + gate + commit**

Run: `bun test tests/notify-token.test.ts` (PASS), then `bun check`.

```bash
git add src/notify-token.ts tests/notify-token.test.ts
git commit -m "feat(acp): notify_token from system_config with lazy env seed"
```

---

## Task 2: `notify-route` handler

`handleNotifyRoute(req)` — POST only, Bearer token (timing-safe) against `getNotifyToken()`, Zod body, build target, resolve instance, send.

**Files:** Create `src/debug/notify-route.ts`, `tests/debug/notify-route.test.ts`

- [ ] **Step 1: Write the failing test**

First, find the `context_settings` upsert (the test must map a `contextId` → `platformInstanceId`):

Run: `grep -rn "contextSettings" src/instances/context-store.ts` and note the exported setter (e.g. `setContextSettings` / `upsertContextSettings`). Use it in the test below (shown as `setContextSettings`; substitute the real name + arg shape — it writes `{ contextId, taskInstanceId, platformInstanceId }`).

Create `tests/debug/notify-route.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { ChatRouter } from '../../src/chat/router.js'
import type { DeferredDeliveryTarget } from '../../src/chat/types.js'
import { clearRuntimeChatRouter, setRuntimeChatRouter } from '../../src/debug/chat-router-runtime.js'
import { handleNotifyRoute } from '../../src/debug/notify-route.js'
import { setContextSettings } from '../../src/instances/context-store.js' // confirm exact name
import { resetNotifyTokenCacheForTesting } from '../../src/notify-token.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

interface Sent {
  platformInstanceId: string
  target: DeferredDeliveryTarget
  markdown: string
}

class RecordingRouter extends ChatRouter {
  readonly sent: Sent[] = []

  constructor() {
    super(() => {
      throw new Error('unused test factory')
    })
  }

  override sendMessage(platformInstanceId: string, target: DeferredDeliveryTarget, markdown: string): Promise<boolean> {
    this.sent.push({ platformInstanceId, target, markdown })
    return Promise.resolve(true)
  }
}

function notifyReq(token: string | null, body: unknown, method = 'POST'): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token !== null) headers['Authorization'] = `Bearer ${token}`
  return new Request('http://x/api/notify', { method, headers, body: JSON.stringify(body) })
}

describe('handleNotifyRoute', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    resetNotifyTokenCacheForTesting()
    process.env['NOTIFY_TOKEN'] = 'tok'
    // map a DM context to a platform instance
    setContextSettings({ contextId: 'user-1', taskInstanceId: 'ti-1', platformInstanceId: 'pi-1' })
  })

  afterEach(() => {
    delete process.env['NOTIFY_TOKEN']
    resetNotifyTokenCacheForTesting()
    clearRuntimeChatRouter()
  })

  test('delivers a DM notification and returns 200', async () => {
    const router = new RecordingRouter()
    setRuntimeChatRouter(router)
    const res = await handleNotifyRoute(notifyReq('tok', { contextId: 'user-1', markdown: 'hello' }))
    expect(res.status).toBe(200)
    expect(router.sent).toHaveLength(1)
    expect(router.sent[0]?.platformInstanceId).toBe('pi-1')
    expect(router.sent[0]?.markdown).toBe('hello')
    expect(router.sent[0]?.target.contextId).toBe('user-1')
  })

  test('rejects a wrong bearer token with 401', async () => {
    setRuntimeChatRouter(new RecordingRouter())
    const res = await handleNotifyRoute(notifyReq('nope', { contextId: 'user-1', markdown: 'x' }))
    expect(res.status).toBe(401)
  })

  test('returns 503 when no notify_token is configured', async () => {
    delete process.env['NOTIFY_TOKEN']
    resetNotifyTokenCacheForTesting()
    setRuntimeChatRouter(new RecordingRouter())
    const res = await handleNotifyRoute(notifyReq('tok', { contextId: 'user-1', markdown: 'x' }))
    expect(res.status).toBe(503)
  })

  test('returns 422 when the chat router is not running', async () => {
    clearRuntimeChatRouter()
    const res = await handleNotifyRoute(notifyReq('tok', { contextId: 'user-1', markdown: 'x' }))
    expect(res.status).toBe(422)
  })

  test('returns 404 when the context has no platform instance', async () => {
    setRuntimeChatRouter(new RecordingRouter())
    const res = await handleNotifyRoute(notifyReq('tok', { contextId: 'unknown-ctx', markdown: 'x' }))
    expect(res.status).toBe(404)
  })

  test('returns 400 on an invalid body', async () => {
    setRuntimeChatRouter(new RecordingRouter())
    const res = await handleNotifyRoute(notifyReq('tok', { contextId: 'user-1' }))
    expect(res.status).toBe(400)
  })

  test('returns 405 for non-POST', async () => {
    setRuntimeChatRouter(new RecordingRouter())
    const res = await handleNotifyRoute(notifyReq('tok', { contextId: 'user-1', markdown: 'x' }, 'GET'))
    expect(res.status).toBe(405)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/debug/notify-route.test.ts`
Expected: FAIL — `notify-route.js` not found (and possibly `setContextSettings` import — fix the name in Step 1).

- [ ] **Step 3: Implement**

Create `src/debug/notify-route.ts`. Confirm the scoped-context helper names with `grep -rn "isScopedThreadContextId\|getConfigContextIdFromStorageContextId" src/chat/scoped-context.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { timingSafeEqual } from 'node:crypto'

import { z } from 'zod'

import { resolveDeliveryPlatformInstanceId } from '../chat/delivery-routing.js'
import { getConfigContextIdFromStorageContextId, isScopedThreadContextId } from '../chat/scoped-context.js'
import { dmTarget } from '../chat/types.js'
import type { DeferredDeliveryTarget } from '../chat/types.js'
import { logger } from '../logger.js'
import { getNotifyToken } from '../notify-token.js'
import { getRuntimeChatRouter } from './chat-router-runtime.js'
import { jsonResponse } from './json-response.js'

const log = logger.child({ scope: 'debug:notify-route' })

const NotifyBodySchema = z.object({
  contextId: z.string().min(1),
  contextType: z.enum(['dm', 'group']).optional(),
  threadId: z.string().min(1).optional(),
  markdown: z.string().min(1),
})

export type NotifyBody = z.infer<typeof NotifyBodySchema>

const bearerToken = (req: Request): string | null => {
  const header = req.headers.get('authorization')
  if (header === null || !header.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length).trim()
  return token.length === 0 ? null : token
}

const tokensMatch = (provided: string, expected: string): boolean => {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export const buildNotifyTarget = (body: NotifyBody): DeferredDeliveryTarget => {
  const storageContextId = body.contextId
  const inferredGroup =
    body.contextType === undefined ? isScopedThreadContextId(storageContextId) : body.contextType === 'group'
  if (!inferredGroup) {
    return { ...dmTarget(storageContextId), storageContextId }
  }
  const groupId = getConfigContextIdFromStorageContextId(storageContextId)
  return {
    contextId: groupId,
    contextType: 'group',
    threadId: body.threadId === undefined ? null : body.threadId,
    audience: 'shared',
    mentionUserIds: [],
    createdByUserId: '',
    createdByUsername: null,
    storageContextId,
  }
}

export const handleNotifyRoute = async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return jsonResponse({ error: 'method not allowed' }, { status: 405 })

  const expected = getNotifyToken()
  if (expected === null) return jsonResponse({ error: 'notify not configured' }, { status: 503 })

  const provided = bearerToken(req)
  if (provided === null || !tokensMatch(provided, expected)) {
    return jsonResponse({ error: 'unauthorized' }, { status: 401 })
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return jsonResponse({ error: 'invalid JSON body' }, { status: 400 })
  }
  const parsed = NotifyBodySchema.safeParse(raw)
  if (!parsed.success) return jsonResponse({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 })

  const chat = getRuntimeChatRouter()
  if (chat === null) return jsonResponse({ error: 'chat router not running' }, { status: 422 })

  const target = buildNotifyTarget(parsed.data)
  const platformInstanceId = resolveDeliveryPlatformInstanceId(target)
  if (platformInstanceId === null) {
    return jsonResponse({ error: 'context not deliverable' }, { status: 404 })
  }

  const sent = await chat.sendMessage(platformInstanceId, target, parsed.data.markdown)
  if (sent === false) {
    log.warn({ platformInstanceId, contextId: parsed.data.contextId }, 'notify delivery failed')
    return jsonResponse({ error: 'delivery failed' }, { status: 502 })
  }
  return jsonResponse({ sent: true })
}
```

> Why resolve + `chat.sendMessage` directly (not `sendProactiveMessage`): `sendProactiveMessage` additionally probes the live router's `isInstanceActive`/`getInstance`, which a test double lacks. `resolveDeliveryPlatformInstanceId` is a pure `context_settings` read, and the real `ChatRouter.sendMessage` already guards instance liveness in production — this is exactly the seam the announce route test mocks.

- [ ] **Step 4: Pass + gate + commit**

Run: `bun test tests/debug/notify-route.test.ts` (PASS), `bun check`.

```bash
git add src/debug/notify-route.ts tests/debug/notify-route.test.ts
git commit -m "feat(acp): POST /api/notify handler"
```

---

## Task 3: Mount the route in the web server

Insert `/api/notify` into `routeRequest` **before** `isAuthorizedRequest` and **after** the `debugEnabled`/`isDebugOnlyPath` gate, so it has its own token trust plane and is reachable regardless of `DEBUG_SERVER`.

**Files:** Modify `src/debug/server.ts`; add a routing test (extend `tests/debug/server.test.ts` or create `tests/debug/notify-route-server.test.ts`)

- [ ] **Step 1: Add the failing routing test**

Create `tests/debug/notify-route-server.test.ts` (uses `routeRequestForTest`, which is exported from `src/debug/server.ts`):

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { ChatRouter } from '../../src/chat/router.js'
import type { DeferredDeliveryTarget } from '../../src/chat/types.js'
import { clearRuntimeChatRouter, setRuntimeChatRouter } from '../../src/debug/chat-router-runtime.js'
import { routeRequestForTest } from '../../src/debug/server.js'
import { setContextSettings } from '../../src/instances/context-store.js' // confirm name
import { resetNotifyTokenCacheForTesting } from '../../src/notify-token.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

class OkRouter extends ChatRouter {
  constructor() {
    super(() => {
      throw new Error('unused')
    })
  }
  override sendMessage(_p: string, _t: DeferredDeliveryTarget, _m: string): Promise<boolean> {
    return Promise.resolve(true)
  }
}

describe('/api/notify routing', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    resetNotifyTokenCacheForTesting()
    process.env['NOTIFY_TOKEN'] = 'tok'
    setContextSettings({ contextId: 'user-1', taskInstanceId: 'ti-1', platformInstanceId: 'pi-1' })
    setRuntimeChatRouter(new OkRouter())
  })

  afterEach(() => {
    delete process.env['NOTIFY_TOKEN']
    resetNotifyTokenCacheForTesting()
    clearRuntimeChatRouter()
  })

  test('is reachable with its own token even when debug is disabled', async () => {
    const req = new Request('http://x/api/notify', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
      body: JSON.stringify({ contextId: 'user-1', markdown: 'hi' }),
    })
    const res = await routeRequestForTest(req, { debugEnabled: false })
    expect(res.status).toBe(200)
  })

  test('does not fall through to the session-cookie 401 path', async () => {
    const req = new Request('http://x/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contextId: 'user-1', markdown: 'hi' }),
    })
    const res = await routeRequestForTest(req, { debugEnabled: false })
    // 401 from OUR token check (not the dashboard session), proving the route was handled here
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/debug/notify-route-server.test.ts`
Expected: FAIL — `/api/notify` currently falls through to `isAuthorizedRequest` → `401 Unauthorized` as `text/plain` (so the JSON-body assertion fails), or 404.

- [ ] **Step 3: Implement the wiring**

In `src/debug/server.ts`:

a. Add the import (with the other `./` debug imports):

```ts
import { handleNotifyRoute } from './notify-route.js'
```

b. In `routeRequest`, insert the route **immediately after** the `if (!options.debugEnabled && isDebugOnlyPath(url.pathname)) return new Response('Not found', { status: 404 })` line and **before** `if (!isAuthorizedRequest(req)) { ... }`:

```ts
if (url.pathname === '/api/notify') {
  return handleNotifyRoute(req)
}
```

- [ ] **Step 4: Pass + gate + commit**

Run: `bun test tests/debug/notify-route-server.test.ts` (PASS), `bun check`.

```bash
git add src/debug/server.ts tests/debug/notify-route-server.test.ts
git commit -m "feat(acp): mount /api/notify on its own token trust plane"
```

---

## Task 4: Full gate + manual smoke

- [ ] **Step 1: Run the suite + full gate**

Run: `bun run test` then `bun check:full`
Expected: all pass — lint, typecheck, format, **license-headers**, knip, duplicates, tests. Fix anything red. Likely knip note: ensure `buildNotifyTarget`/`NotifyBody` are imported by the test (they are) or keep them module-private if not (they are exported for the unit test).

- [ ] **Step 2: Manual smoke**

Start papai with `NOTIFY_TOKEN=dev` set and a context that has a platform instance assigned (any real DM context). Then:

```bash
curl -s -i -XPOST http://localhost:<DEBUG_PORT>/api/notify \
  -H 'Authorization: Bearer dev' -H 'Content-Type: application/json' \
  -d '{"contextId":"<a-real-storageContextId>","markdown":"magi: session done ✅"}'
```

Expected: `200 { "sent": true }` and the message arrives in that chat. Verify: wrong token → 401; unset `NOTIFY_TOKEN` (fresh DB) → 503; unknown contextId → 404. Confirm the route works with `DEBUG_SERVER` unset (it must, since magi posts to it in production where the engineer dashboard may be off).

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "chore(acp): notify endpoint passes full gate"
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** plan #6 — token-authed `POST /api/notify` resolving `context_settings` → `ChatRouter.sendMessage`, mounted on its own trust plane before `isAuthorizedRequest`, reachable regardless of `DEBUG_SERVER` (not in `DEBUG_ONLY_PATHS`). The matched receiver for magi's #5 Notifier payload `{ contextId, markdown }`.
- **Cross-service contract:** magi's #5 Notifier sends `{ contextId, markdown }`. This endpoint additionally accepts optional `contextType`/`threadId`. DM delivery works from `contextId` alone (and thread-scoped group contexts are inferred via `isScopedThreadContextId`). For unambiguous **group** delivery (esp. Discord non-thread groups), magi should include `contextType: 'group'` (+ `threadId`) — captured by the papai plugin at session start (#7) and echoed by magi's Notifier (a small magi follow-up). Flag this when planning #7/#8; it is **not** required for DM-context sessions.
- **Token:** `notify_token` lives in `system_config`, lazily seeded from `NOTIFY_TOKEN` env on first read (no `index.ts` change). It must equal magi's `MAGI_NOTIFY_TOKEN`. Compared timing-safe.
- **Delivery seam:** resolve via `resolveDeliveryPlatformInstanceId` (pure `context_settings` read) then `chat.sendMessage` directly — this is the mockable seam the announce route test uses; `sendProactiveMessage` is avoided because its router-liveness probes don't fit a test double.
- **Status codes:** 200 sent · 400 bad body · 401 bad/no token · 404 context not deliverable · 405 non-POST · 422 router not running · 502 send returned false · 503 token not configured.
- **House style:** license headers on both new files; `.js` imports; Zod v4 `safeParse`; no semicolons/single quotes; verify `setContextSettings` and the scoped-context helper names by grep before relying on them (substitute the real exported names).
