<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Settings Web UI — Part A (HTTP API) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `/settings/api/*` HTTP route family — session-authorized, CSRF-gated, scope-checked JSON endpoints that expose per-context config, tools, MCP, plugins, identity, Kaneo provisioning, group admin, and bot-admin operations on top of the existing settings access-model layer.

**Architecture:** Each route is a thin handler that (1) authenticates the settings session, (2) verifies CSRF on writes, (3) calls `requireScope` to obtain a validated `contextId`, and (4) delegates to the existing store/validator functions — reusing the exact code paths the chat `cfg:`/`tgl:`/`plg:` flows and the `DEBUG_TOKEN`-gated `/api/*` + `/admin/*` handlers use. A new `settings-api-router.ts` dispatches `/settings/api/*` (the existing `settings-router.ts` continues to own `/settings/auth/*` and `/settings/api/session`). Admin routes are thin `/settings/api/admin/*` wrappers (spec OQ-H1 option (a)) that call stores directly, never the `DEBUG_TOKEN` handlers, preserving the strict trust-domain split.

**Tech Stack:** Bun + `Bun.serve`, Zod v4 validation, Drizzle/SQLite stores, the existing `src/settings/*` access-model modules. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-28-settings-web-ui-surface-design.md` (Part A). Part B (client SPA) is a separate plan and depends on these routes existing.

---

## Conventions used throughout this plan

- Every new source file starts with the BUSL header (copy from any existing `src/debug/*.ts`).
- All imports use the `.js` extension.
- Error extraction: `error instanceof Error ? error.message : String(error)`.
- Status codes (spec §"Error & masking contract"): `401` no/invalid session; `403` scope failure or bad CSRF; `400` malformed JSON; `422` validation failure (carry the validator's message); `429` rate limited; `404` unknown subpath; `405` wrong method.
- Sensitive values are never returned in plaintext. Reads mask; the client resubmits real values or the masked sentinel (treated as "no change").
- Logging: never log codes, tokens, session ids, header values, or free-form user content (project CLAUDE.md "Logging").
- Run the targeted test after each implementation step. The TDD hook pipeline will also run it on write.

## File structure (created/modified by this plan)

| File                                                | Responsibility                                                                      |
| --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `src/debug/settings/respond.ts`                     | Shared JSON response + auth/CSRF/scope guard helpers (Task 1)                       |
| `src/debug/settings-api-router.ts`                  | Dispatch `/settings/api/*` to the handlers below (Task 2)                           |
| `src/debug/settings-router.ts` _(modify)_           | Delegate non-`session` `/settings/api/*` paths to the new router (Task 2)           |
| `src/debug/settings-routes.ts` _(modify)_           | Add `display` to bootstrap payload (Task 3)                                         |
| `src/debug/settings/config-routes.ts`               | `GET`/`PATCH /settings/api/config` (Task 4)                                         |
| `src/debug/settings/tools-routes.ts`                | `GET /settings/api/tools`, `POST /settings/api/tools/toggle` (Task 5)               |
| `src/debug/settings/mcp-routes.ts`                  | `GET`/`PUT /settings/api/mcp` (Task 6)                                              |
| `src/debug/settings/plugins-routes.ts`              | `GET /settings/api/plugins`, `.../toggle`, `.../config` (Task 7)                    |
| `src/debug/settings/identity-routes.ts`             | `GET`/`PUT`/`DELETE /settings/api/identity` (Task 8)                                |
| `src/debug/settings/provision-routes.ts`            | `POST /settings/api/provision/kaneo` (Task 9)                                       |
| `src/debug/settings/group-routes.ts`                | group members + group task-instance (Task 10)                                       |
| `src/commands/announce-broadcast.ts`                | Extracted reusable broadcast (Task 11)                                              |
| `src/commands/admin.ts` _(modify)_                  | Call the extracted broadcast (Task 11)                                              |
| `src/debug/settings/admin/instances-routes.ts`      | admin platform/task instances + provider types (Task 12)                            |
| `src/debug/settings/admin/system-access-routes.ts`  | admin system/LLM + users + groups (Task 13)                                         |
| `src/debug/settings/admin/roster-plugins-routes.ts` | admin roster (SA) + plugin approve/reject (SA) + plugin config + announce (Task 14) |
| `CLAUDE.md` _(modify)_                              | Document the new route family (Task 15)                                             |
| `tests/debug/settings/*.test.ts`                    | One test file per handler module                                                    |

---

## Task 1: Shared response & guard helpers

Centralizes the auth → CSRF → scope preamble so every route handler is a few lines. Mirrors the private `jsonResponse` in `src/debug/settings-routes.ts:25` but exported and adds scope resolution.

**Files:**

- Create: `src/debug/settings/respond.ts`
- Create: `tests/debug/settings/respond.test.ts`
- Create: `tests/debug/settings/helpers.ts` (shared test helper to establish a session)

- [ ] **Step 1: Write the shared test helper**

Create `tests/debug/settings/helpers.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import assert from 'node:assert/strict'

import { handleSettingsExchange } from '../../../src/debug/settings-routes.js'
import { issueAuthCode } from '../../../src/settings/auth-code-store.js'
import { SESSION_COOKIE_NAME } from '../../../src/settings/cookies.js'
import { CSRF_HEADER } from '../../../src/settings/request-auth.js'

export interface SettingsSession {
  cookie: string
  csrf: string
}

/** Issue a code, exchange it, and return the cookie + CSRF token for the principal. */
export async function establishSession(
  principal: { platformInstanceId: string; platformUserId: string },
  nowMs = 1000,
): Promise<SettingsSession> {
  const code = issueAuthCode(principal, nowMs)
  const req = new Request('https://x/settings/auth/exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  const res = await handleSettingsExchange(req, nowMs + 1)
  assert.equal(res.status, 200, 'exchange should succeed')
  const setCookie = res.headers.get('Set-Cookie')
  assert(setCookie !== null, 'expected Set-Cookie')
  const cookie = setCookie.split(';')[0]!.split('=')[1]!
  const body = (await res.json()) as { csrfToken: string }
  return { cookie, csrf: body.csrfToken }
}

/** Build request headers carrying the session cookie and (optionally) the CSRF token. */
export function authHeaders(session: SettingsSession, withCsrf = false): Record<string, string> {
  const headers: Record<string, string> = { Cookie: `${SESSION_COOKIE_NAME}=${session.cookie}` }
  if (withCsrf) headers[CSRF_HEADER] = session.csrf
  return headers
}
```

- [ ] **Step 2: Write the failing test for `respond.ts`**

Create `tests/debug/settings/respond.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { authenticate, requireCsrf, resolveContextScope, settingsJson } from '../../../src/debug/settings/respond.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession } from './helpers.js'

describe('settings respond helpers', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
  })

  test('settingsJson sets status, JSON content type, and extra headers', async () => {
    const res = settingsJson(422, { error: 'bad' }, { 'X-Test': '1' })
    expect(res.status).toBe(422)
    expect(res.headers.get('Content-Type')).toBe('application/json')
    expect(res.headers.get('X-Test')).toBe('1')
    expect(await res.json()).toEqual({ error: 'bad' })
  })

  test('authenticate returns 401 outcome without a session', () => {
    const out = authenticate(new Request('https://x/settings/api/config'))
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.response.status).toBe(401)
  })

  test('authenticate succeeds with a valid session', async () => {
    const session = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'u-1' })
    const out = authenticate(new Request('https://x/settings/api/config', { headers: authHeaders(session) }))
    expect(out.ok).toBe(true)
  })

  test('requireCsrf rejects a write missing the header', async () => {
    const session = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'u-1' })
    const out = authenticate(
      new Request('https://x/settings/api/config', { method: 'PATCH', headers: authHeaders(session) }),
    )
    expect(out.ok).toBe(true)
    if (out.ok) {
      const blocked = requireCsrf(
        new Request('https://x/settings/api/config', { method: 'PATCH', headers: authHeaders(session) }),
        out.authed,
      )
      expect(blocked?.status).toBe(403)
    }
  })

  test('resolveContextScope falls back to personal when contextId is omitted', async () => {
    const session = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'u-1' })
    const out = authenticate(new Request('https://x', { headers: authHeaders(session) }))
    expect(out.ok).toBe(true)
    if (out.ok) {
      const scope = resolveContextScope(out.authed.principal, 'read', undefined)
      expect(scope.ok).toBe(true)
      if (scope.ok) expect(scope.scope.kind).toBe('personal')
    }
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test tests/debug/settings/respond.test.ts`
Expected: FAIL — `Cannot find module '.../src/debug/settings/respond.js'`.

- [ ] **Step 4: Implement `respond.ts`**

Create `src/debug/settings/respond.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { SettingsPrincipal } from '../../settings/principal.js'
import {
  authenticateSettingsRequest,
  verifyCsrf,
  type AuthenticatedSettingsRequest,
} from '../../settings/request-auth.js'
import { requireScope, type ScopeResult } from '../../settings/scope-guard.js'

export const settingsJson = (status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  })

export type AuthOutcome =
  | { readonly ok: true; readonly authed: AuthenticatedSettingsRequest }
  | { readonly ok: false; readonly response: Response }

export function authenticate(req: Request, nowMs: number = Date.now()): AuthOutcome {
  const authed = authenticateSettingsRequest(req, nowMs)
  if (authed === null) return { ok: false, response: settingsJson(401, { error: 'unauthenticated' }) }
  return { ok: true, authed }
}

/** Returns a 403 Response when the CSRF header is missing/invalid, otherwise null. */
export function requireCsrf(req: Request, authed: AuthenticatedSettingsRequest): Response | null {
  if (!verifyCsrf(req, authed.session)) return settingsJson(403, { error: 'invalid csrf token' })
  return null
}

export type ParsedBody =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly response: Response }

export async function parseJsonBody(req: Request): Promise<ParsedBody> {
  try {
    return { ok: true, value: await req.json() }
  } catch {
    return { ok: false, response: settingsJson(400, { error: 'invalid JSON body' }) }
  }
}

export type ContextScope = { readonly contextId: string; readonly kind: 'personal' | 'group' }
export type ScopeOutcome =
  | { readonly ok: true; readonly scope: ContextScope }
  | { readonly ok: false; readonly response: Response }

/**
 * Resolve a client-supplied raw contextId into a validated, canonical contextId.
 * Omitted or personal-matching ids resolve to the personal scope; everything else
 * is treated as a managed-group target. Always use `scope.contextId` for storage
 * access — never the raw client value.
 */
export function resolveContextScope(
  principal: SettingsPrincipal,
  action: 'read' | 'write',
  rawContextId: string | undefined,
): ScopeOutcome {
  const isPersonal = rawContextId === undefined || rawContextId === principal.personalConfigContextId
  const result: ScopeResult = isPersonal
    ? requireScope(principal, { action, target: { kind: 'personal' } })
    : requireScope(principal, { action, target: { kind: 'group', contextId: rawContextId } })
  if (!result.ok) return { ok: false, response: settingsJson(403, { error: 'forbidden' }) }
  return { ok: true, scope: { contextId: result.contextId, kind: isPersonal ? 'personal' : 'group' } }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test tests/debug/settings/respond.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/debug/settings/respond.ts tests/debug/settings/respond.test.ts tests/debug/settings/helpers.ts
git commit -m "feat(settings): shared response/auth/scope helpers for /settings/api"
```

---

## Task 2: Settings API router skeleton + wire-up

Adds `routeSettingsApi(req, url)` and delegates from `settings-router.ts`. Returns `null` for unowned `/settings/api/*` subpaths so the existing 404 fallthrough still works.

**Files:**

- Create: `src/debug/settings-api-router.ts`
- Modify: `src/debug/settings-router.ts:29-35`
- Create: `tests/debug/settings/settings-api-router.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/debug/settings/settings-api-router.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { routeSettingsApi } from '../../../src/debug/settings-api-router.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'

describe('routeSettingsApi', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns null for an unowned subpath', async () => {
    const res = await routeSettingsApi(
      new Request('https://x/settings/api/nope'),
      new URL('https://x/settings/api/nope'),
    )
    expect(res).toBeNull()
  })

  test('returns 401 for an owned route without a session', async () => {
    const res = await routeSettingsApi(
      new Request('https://x/settings/api/config?contextId=c'),
      new URL('https://x/settings/api/config?contextId=c'),
    )
    expect(res).not.toBeNull()
    expect(res?.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/debug/settings/settings-api-router.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the router skeleton**

Create `src/debug/settings-api-router.ts`. Each handler import is added as its task lands; start with `config` wired so the test's 401 passes (Task 4 fills the body — but for now reference a placeholder-free stub that returns the 401 via the shared guard). To avoid forward references, implement the dispatch with only the routes that exist; later tasks add their `if` branch here.

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { handleConfigRoutes } from './settings/config-routes.js'

const methodNotAllowed = (): Response => new Response('Method not allowed', { status: 405 })

/**
 * Dispatch `/settings/api/*` requests (excluding `/settings/api/session`, owned by
 * settings-router.ts). Returns a Response for owned paths, or null to fall through
 * to the 404 handler. Never consults DEBUG_TOKEN.
 */
export async function routeSettingsApi(req: Request, url: URL): Promise<Response | null> {
  if (url.pathname === '/settings/api/config') return handleConfigRoutes(req, url)
  return null
}

export { methodNotAllowed }
```

> Note for the executor: `handleConfigRoutes` is created in Task 4. To keep this task self-contained and green, temporarily create `src/debug/settings/config-routes.ts` with a minimal authenticate-only stub:
>
> ```typescript
> // SPDX-License-Identifier: BUSL-1.1
> // Copyright (c) 2026 Dmitriy Lazarev
> // Use of this software is governed by the Business Source License 1.1.
> // See LICENSE in the project root for details.
>
> import { authenticate, settingsJson } from './respond.js'
>
> export async function handleConfigRoutes(req: Request, _url: URL): Promise<Response> {
>   const auth = authenticate(req)
>   if (!auth.ok) return auth.response
>   return settingsJson(501, { error: 'not implemented' })
> }
> ```
>
> Task 4 replaces this stub with the real GET/PATCH implementation and its own tests.

- [ ] **Step 4: Wire the router into `settings-router.ts`**

In `src/debug/settings-router.ts`, add the import at the top:

```typescript
import { routeSettingsApi } from './settings-api-router.js'
```

Then replace the block at lines 29-35 (the `/settings/api/session` branch + the 404 fallthrough) with:

```typescript
if (url.pathname === '/settings/api/session') {
  return Promise.resolve(req.method === 'GET' ? handleSettingsBootstrap(req) : methodNotAllowed())
}

if (url.pathname.startsWith('/settings/api/')) {
  return routeSettingsApi(req, url).then((res) => res ?? new Response('Not found', { status: 404 }))
}

// Static SPA serving (client/settings) is delivered by the Surface spec Part B.
// Anything else is 404.
return Promise.resolve(new Response('Not found', { status: 404 }))
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test tests/debug/settings/settings-api-router.test.ts tests/debug/settings-router.test.ts`
Expected: PASS (router test 2 tests + existing settings-router suite still green).

- [ ] **Step 6: Commit**

```bash
git add src/debug/settings-api-router.ts src/debug/settings-router.ts src/debug/settings/config-routes.ts tests/debug/settings/settings-api-router.test.ts
git commit -m "feat(settings): /settings/api router skeleton wired into settings-router"
```

---

## Task 3: Bootstrap display name

The spec's `/settings/api/bootstrap` returns "principal display" beyond role flags. The existing `/settings/api/session` (`handleSettingsBootstrap`) already returns role flags + contexts + CSRF; add a `display` string and register `/settings/api/bootstrap` as an alias so the SPA (Part B) can call either.

**Files:**

- Modify: `src/debug/settings-routes.ts:81-99`
- Modify: `src/debug/settings-router.ts` (add `/settings/api/bootstrap` alias)
- Modify: `tests/debug/settings-routes.test.ts` (assert `display`)

- [ ] **Step 1: Write the failing test**

Append to `tests/debug/settings-routes.test.ts` inside the `describe('settings routes', ...)` block:

```typescript
test('bootstrap returns a display string for the principal', async () => {
  addUser({ userId: 'u-2', platformInstanceId: 'pi-1', addedBy: 'admin', username: 'alice' })
  const code = issueAuthCode({ platformInstanceId: 'pi-1', platformUserId: 'u-2' }, 1000)
  const exchanged = await handleSettingsExchange(exchangeRequest(code), 2000)
  const sid = cookieFrom(exchanged)
  const res = handleSettingsBootstrap(
    new Request('https://x/settings/api/session', { headers: { Cookie: `${SESSION_COOKIE_NAME}=${sid}` } }),
    3000,
  )
  const body = await readJson(res)
  expect(pickString(body, 'display')).toBe('alice')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/debug/settings-routes.test.ts`
Expected: FAIL — `expected display to be a string` (key absent).

- [ ] **Step 3: Implement display resolution**

In `src/debug/settings-routes.ts` add the import:

```typescript
import { listUsers } from '../users.js'
```

Add a helper above `handleSettingsExchange`:

```typescript
/** Best-effort display name: the authorized username, else the platform user id. */
function principalDisplay(platformInstanceId: string, platformUserId: string): string {
  const match = listUsers(platformInstanceId).find((u) => u.platform_user_id === platformUserId)
  const username = match?.username
  return username !== null && username !== undefined && username.length > 0 ? username : platformUserId
}
```

In `handleSettingsExchange`, change the returned `principal` object (line 74) to include the display, and add it to the body:

```typescript
    {
      csrfToken: created.csrfToken,
      display: principalDisplay(authPrincipal.platformInstanceId, authPrincipal.platformUserId),
      principal: { isBotAdmin: resolved.isBotAdmin, isSuperAdmin: resolved.isSuperAdmin },
      contexts: listAvailableContexts(resolved),
    },
```

In `handleSettingsBootstrap`, change the returned body (line 94) to:

```typescript
return jsonResponse(200, {
  csrfToken,
  display: principalDisplay(authed.principal.platformInstanceId, authed.principal.platformUserId),
  principal: { isBotAdmin: authed.principal.isBotAdmin, isSuperAdmin: authed.principal.isSuperAdmin },
  contexts: listAvailableContexts(authed.principal),
})
```

- [ ] **Step 4: Register the `/settings/api/bootstrap` alias**

In `src/debug/settings-router.ts`, immediately after the `/settings/api/session` branch added in Task 2, add:

```typescript
if (url.pathname === '/settings/api/bootstrap') {
  return Promise.resolve(req.method === 'GET' ? handleSettingsBootstrap(req) : methodNotAllowed())
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test tests/debug/settings-routes.test.ts tests/debug/settings-router.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/debug/settings-routes.ts src/debug/settings-router.ts tests/debug/settings-routes.test.ts
git commit -m "feat(settings): add principal display + /settings/api/bootstrap alias"
```

---

## Task 4: Config GET/PATCH

Replaces the `cfg:` editor flow. `GET` returns each field descriptor + masked current value; `PATCH` validates one field and persists it. Reuses `getConfigFieldsForContext`, `getConfigValue`/`setConfigValue`, `validateConfigField`, and `maskSensitiveValue`.

**Files:**

- Modify (replace stub): `src/debug/settings/config-routes.ts`
- Create: `tests/debug/settings/config-routes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/debug/settings/config-routes.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { handleConfigRoutes } from '../../../src/debug/settings/config-routes.js'
import { getConfigValue } from '../../../src/config.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

describe('settings config routes', () => {
  let session: SettingsSession

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
    session = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'u-1' })
  })

  test('GET returns field descriptors with masked values', async () => {
    const res = await handleConfigRoutes(
      new Request('https://x/settings/api/config', { headers: authHeaders(session) }),
      new URL('https://x/settings/api/config'),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { fields: Array<{ key: string; sensitive: boolean }> }
    expect(body.fields.some((f) => f.key === 'timezone')).toBe(true)
  })

  test('PATCH validates and persists a field', async () => {
    const req = new Request('https://x/settings/api/config', {
      method: 'PATCH',
      headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'timezone', value: 'America/New_York' }),
    })
    const res = await handleConfigRoutes(req, new URL('https://x/settings/api/config'))
    expect(res.status).toBe(200)
    // Personal scope resolves to the principal's personalConfigContextId; assert via read-back.
    const body = (await res.json()) as { contextId: string }
    expect(getConfigValue(body.contextId, 'timezone')).toBe('America/New_York')
  })

  test('PATCH rejects an invalid value with 422', async () => {
    const req = new Request('https://x/settings/api/config', {
      method: 'PATCH',
      headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'timezone', value: 'Not/AZone' }),
    })
    const res = await handleConfigRoutes(req, new URL('https://x/settings/api/config'))
    expect(res.status).toBe(422)
  })

  test('PATCH without CSRF is 403', async () => {
    const req = new Request('https://x/settings/api/config', {
      method: 'PATCH',
      headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'timezone', value: 'UTC' }),
    })
    const res = await handleConfigRoutes(req, new URL('https://x/settings/api/config'))
    expect(res.status).toBe(403)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/debug/settings/config-routes.test.ts`
Expected: FAIL — GET returns 501 from the Task 2 stub (`body.fields` undefined).

- [ ] **Step 3: Implement the real handler**

Replace the entire contents of `src/debug/settings/config-routes.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { getConfigFieldsForContext } from '../../config-keys.js'
import { getConfigValue, maskSensitiveValue, setConfigValue } from '../../config.js'
import { validateConfigField } from '../../config-editor/validation.js'
import { logger } from '../../logger.js'
import { authenticate, parseJsonBody, requireCsrf, resolveContextScope, settingsJson } from './respond.js'

const log = logger.child({ scope: 'debug-server:settings-config' })

const PatchBodySchema = z.object({
  key: z.string().min(1),
  value: z.string(),
  contextId: z.string().optional(),
})

function handleGet(req: Request, url: URL): Response {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  const scope = resolveContextScope(auth.authed.principal, 'read', url.searchParams.get('contextId') ?? undefined)
  if (!scope.ok) return scope.response

  const fields = getConfigFieldsForContext(scope.scope.contextId).map((field) => {
    const raw = getConfigValue(scope.scope.contextId, field.storageKey)
    const hasValue = raw !== null && raw.length > 0
    return {
      key: field.key,
      storageKey: field.storageKey,
      label: field.label,
      required: field.required,
      sensitive: field.sensitive,
      kind: field.kind,
      hasValue,
      value: hasValue && field.sensitive ? maskSensitiveValue(raw) : (raw ?? ''),
    }
  })
  return settingsJson(200, { contextId: scope.scope.contextId, fields })
}

async function handlePatch(req: Request): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  const csrf = requireCsrf(req, auth.authed)
  if (csrf !== null) return csrf

  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = PatchBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  const scope = resolveContextScope(auth.authed.principal, 'write', body.data.contextId)
  if (!scope.ok) return scope.response

  const field = getConfigFieldsForContext(scope.scope.contextId).find(
    (f) => f.key === body.data.key || f.storageKey === body.data.key,
  )
  if (field === undefined) return settingsJson(422, { error: 'unknown config field' })

  // Masked secrets: an empty submit means "no change".
  if (field.sensitive && body.data.value.length === 0) {
    return settingsJson(200, { ok: true, contextId: scope.scope.contextId, unchanged: true })
  }

  const validation = validateConfigField(field, body.data.value)
  if (!validation.valid) return settingsJson(422, { error: validation.error ?? 'validation failed' })

  setConfigValue(scope.scope.contextId, field.storageKey, body.data.value)
  log.info({ contextId: scope.scope.contextId, key: field.key }, 'Settings config field updated')
  return settingsJson(200, { ok: true, contextId: scope.scope.contextId })
}

export async function handleConfigRoutes(req: Request, url: URL): Promise<Response> {
  if (req.method === 'GET') return handleGet(req, url)
  if (req.method === 'PATCH') return handlePatch(req)
  return settingsJson(405, { error: 'method not allowed' })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/debug/settings/config-routes.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/debug/settings/config-routes.ts tests/debug/settings/config-routes.test.ts
git commit -m "feat(settings): config GET/PATCH route backed by existing validators"
```

---

## Task 5: Tools GET + toggle

Replaces the `tgl:` flow. GET returns the **computed available set** (capability+context gated) grouped by domain with per-domain status and per-tool risk; toggle flips a domain or a single tool. Reuses `safeBuildProvider`, `buildTools`, `getToolMetadata`, `getToolPrefs`/`setToolPrefs`/`toggleDomain`/`toggleTool`/`getDomainStatus`/`isToolEnabled`.

**Files:**

- Create: `src/debug/settings/tools-routes.ts`
- Modify: `src/debug/settings-api-router.ts`
- Create: `tests/debug/settings/tools-routes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/debug/settings/tools-routes.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { handleToolsRoutes } from '../../../src/debug/settings/tools-routes.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

describe('settings tools routes', () => {
  let session: SettingsSession

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
    session = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'u-1' })
  })

  test('GET returns domains array (empty when no provider configured)', async () => {
    const url = new URL('https://x/settings/api/tools')
    const res = await handleToolsRoutes(new Request(url, { headers: authHeaders(session) }), url, '/settings/api/tools')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { domains: unknown[] }
    expect(Array.isArray(body.domains)).toBe(true)
  })

  test('toggle without CSRF is 403', async () => {
    const url = new URL('https://x/settings/api/tools/toggle')
    const res = await handleToolsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'domain', domain: 'task' }),
      }),
      url,
      '/settings/api/tools/toggle',
    )
    expect(res.status).toBe(403)
  })

  test('toggle rejects an unknown domain with 422', async () => {
    const url = new URL('https://x/settings/api/tools/toggle')
    const res = await handleToolsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'domain', domain: 'not-a-domain' }),
      }),
      url,
      '/settings/api/tools/toggle',
    )
    expect(res.status).toBe(422)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/debug/settings/tools-routes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the handler**

Create `src/debug/settings/tools-routes.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { safeBuildProvider } from '../../commands/context-tool-resolution.js'
import { logger } from '../../logger.js'
import { getToolMetadata, TOOL_METADATA, type ToolDomain } from '../../tools/tool-metadata.js'
import {
  getDomainStatus,
  getToolPrefs,
  isToolEnabled,
  setToolPrefs,
  toggleDomain,
  toggleTool,
  type ToolPrefs,
} from '../../tools/tool-preferences.js'
import { buildTools } from '../../tools/tools-builder.js'
import { authenticate, parseJsonBody, requireCsrf, resolveContextScope, settingsJson } from './respond.js'

const log = logger.child({ scope: 'debug-server:settings-tools' })
const DOMAIN_SET = new Set<string>(Object.values(TOOL_METADATA).map((m) => m.domain))

function isToolDomain(value: string): value is ToolDomain {
  return DOMAIN_SET.has(value)
}

/** Computed, capability+context-gated tool names for a context (mirrors the tgl: flow). */
function availableToolNames(contextId: string, actorUserId: string, contextType: 'dm' | 'group'): string[] {
  const provider = safeBuildProvider(contextId)
  if (provider === null) return []
  const tools = buildTools(provider, actorUserId, contextId, 'normal', contextType)
  return Object.keys(tools).filter((name) => getToolMetadata(name) !== undefined)
}

function groupByDomain(names: readonly string[]): Map<ToolDomain, string[]> {
  const map = new Map<ToolDomain, string[]>()
  for (const name of names) {
    const meta = getToolMetadata(name)
    if (meta === undefined) continue
    const existing = map.get(meta.domain)
    if (existing === undefined) map.set(meta.domain, [name])
    else existing.push(name)
  }
  return map
}

function buildDomainView(names: readonly string[], prefs: ToolPrefs): unknown[] {
  const grouped = groupByDomain(names)
  return [...grouped.entries()].map(([domain, domainTools]) => ({
    domain,
    status: getDomainStatus(prefs, domain, domainTools),
    tools: [...domainTools].toSorted().map((name) => {
      const meta = getToolMetadata(name)
      return { name, enabled: isToolEnabled(prefs, name), risk: meta?.risk ?? 'read' }
    }),
  }))
}

function handleGet(req: Request, url: URL): Response {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  const scope = resolveContextScope(auth.authed.principal, 'read', url.searchParams.get('contextId') ?? undefined)
  if (!scope.ok) return scope.response

  const contextType = scope.scope.kind === 'group' ? 'group' : 'dm'
  const names = availableToolNames(scope.scope.contextId, auth.authed.principal.platformUserId, contextType)
  const prefs = getToolPrefs(scope.scope.contextId)
  return settingsJson(200, { contextId: scope.scope.contextId, domains: buildDomainView(names, prefs) })
}

const ToggleBodySchema = z.object({
  kind: z.enum(['domain', 'tool']),
  domain: z.string().optional(),
  tool: z.string().optional(),
  contextId: z.string().optional(),
})

async function handleToggle(req: Request): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  const csrf = requireCsrf(req, auth.authed)
  if (csrf !== null) return csrf

  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = ToggleBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  const scope = resolveContextScope(auth.authed.principal, 'write', body.data.contextId)
  if (!scope.ok) return scope.response

  const contextType = scope.scope.kind === 'group' ? 'group' : 'dm'
  const names = availableToolNames(scope.scope.contextId, auth.authed.principal.platformUserId, contextType)
  const prefs = getToolPrefs(scope.scope.contextId)

  if (body.data.kind === 'domain') {
    const domain = body.data.domain ?? ''
    if (!isToolDomain(domain)) return settingsJson(422, { error: 'unknown tool domain' })
    const domainNames = names.filter((n) => getToolMetadata(n)?.domain === domain)
    setToolPrefs(scope.scope.contextId, toggleDomain(prefs, domain, domainNames))
    log.info({ contextId: scope.scope.contextId, domain }, 'Settings tool domain toggled')
  } else {
    const toolName = body.data.tool ?? ''
    const meta = getToolMetadata(toolName)
    if (meta === undefined || !names.includes(toolName)) return settingsJson(422, { error: 'unknown tool' })
    const domainNames = names.filter((n) => getToolMetadata(n)?.domain === meta.domain)
    setToolPrefs(scope.scope.contextId, toggleTool(prefs, toolName, domainNames))
    log.info({ contextId: scope.scope.contextId, tool: toolName }, 'Settings tool toggled')
  }

  const updated = getToolPrefs(scope.scope.contextId)
  return settingsJson(200, { contextId: scope.scope.contextId, domains: buildDomainView(names, updated) })
}

export async function handleToolsRoutes(req: Request, url: URL, pathname: string): Promise<Response> {
  if (pathname === '/settings/api/tools') {
    if (req.method === 'GET') return handleGet(req, url)
    return settingsJson(405, { error: 'method not allowed' })
  }
  if (pathname === '/settings/api/tools/toggle') {
    if (req.method === 'POST') return handleToggle(req)
    return settingsJson(405, { error: 'method not allowed' })
  }
  return settingsJson(404, { error: 'not found' })
}
```

- [ ] **Step 4: Add the dispatch branch**

In `src/debug/settings-api-router.ts`, add the import and branch:

```typescript
import { handleToolsRoutes } from './settings/tools-routes.js'
```

```typescript
if (url.pathname === '/settings/api/tools' || url.pathname === '/settings/api/tools/toggle') {
  return handleToolsRoutes(req, url, url.pathname)
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test tests/debug/settings/tools-routes.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/debug/settings/tools-routes.ts src/debug/settings-api-router.ts tests/debug/settings/tools-routes.test.ts
git commit -m "feat(settings): tools GET + toggle backed by tool-preferences"
```

---

## Task 6: MCP GET/PUT

Replaces raw-JSON editing. GET returns parsed endpoints with header values masked; PUT validates each entry with `mcpEndpointConfigSchema`, restores masked headers from the stored config, and writes `mcp_endpoints` via `setConfigValue` (which invalidates the tool cache). Reuses `parseMcpEndpoints` and `mcpEndpointConfigSchema`.

**Files:**

- Create: `src/debug/settings/mcp-routes.ts`
- Modify: `src/debug/settings-api-router.ts`
- Create: `tests/debug/settings/mcp-routes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/debug/settings/mcp-routes.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { handleMcpRoutes } from '../../../src/debug/settings/mcp-routes.js'
import { getConfigValue } from '../../../src/config.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

describe('settings mcp routes', () => {
  let session: SettingsSession

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
    session = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'u-1' })
  })

  test('PUT validates and persists endpoints; GET masks headers', async () => {
    const put = await handleMcpRoutes(
      new Request('https://x/settings/api/mcp', {
        method: 'PUT',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoints: [
            {
              id: 'srv1',
              url: 'https://mcp.example.com',
              enabled: true,
              headers: { Authorization: 'Bearer abcd1234' },
            },
          ],
        }),
      }),
      new URL('https://x/settings/api/mcp'),
    )
    expect(put.status).toBe(200)
    const stored = getConfigValue(((await put.json()) as { contextId: string }).contextId, 'mcp_endpoints')
    expect(stored).toContain('mcp.example.com')

    const get = await handleMcpRoutes(
      new Request('https://x/settings/api/mcp', { headers: authHeaders(session) }),
      new URL('https://x/settings/api/mcp'),
    )
    const body = (await get.json()) as { endpoints: Array<{ headers?: Record<string, string> }> }
    expect(body.endpoints[0]?.headers?.['Authorization']).not.toBe('Bearer abcd1234')
  })

  test('PUT rejects an http:// url with 422', async () => {
    const res = await handleMcpRoutes(
      new Request('https://x/settings/api/mcp', {
        method: 'PUT',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoints: [{ id: 'x', url: 'http://insecure.example.com', enabled: true }] }),
      }),
      new URL('https://x/settings/api/mcp'),
    )
    expect(res.status).toBe(422)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/debug/settings/mcp-routes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the handler**

Create `src/debug/settings/mcp-routes.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { getConfigValue, maskSensitiveValue, setConfigValue } from '../../config.js'
import { logger } from '../../logger.js'
import { mcpEndpointConfigSchema, type McpEndpointConfig } from '../../mcp/types.js'
import { parseMcpEndpoints } from '../../mcp/user-endpoints.js'
import { authenticate, parseJsonBody, requireCsrf, resolveContextScope, settingsJson } from './respond.js'

const log = logger.child({ scope: 'debug-server:settings-mcp' })
const PutBodySchema = z.object({ endpoints: z.array(z.unknown()), contextId: z.string().optional() })

function maskHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (headers === undefined) return undefined
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, maskSensitiveValue(v)]))
}

/** Replace any header value equal to the masked form of the stored value with the stored plaintext. */
function restoreMaskedHeaders(incoming: McpEndpointConfig, stored: readonly McpEndpointConfig[]): McpEndpointConfig {
  if (incoming.headers === undefined) return incoming
  const prior = stored.find((e) => e.id === incoming.id)?.headers ?? {}
  const merged: Record<string, string> = {}
  for (const [key, value] of Object.entries(incoming.headers)) {
    const priorValue = prior[key]
    merged[key] = priorValue !== undefined && value === maskSensitiveValue(priorValue) ? priorValue : value
  }
  return { ...incoming, headers: merged }
}

function handleGet(req: Request, url: URL): Response {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  const scope = resolveContextScope(auth.authed.principal, 'read', url.searchParams.get('contextId') ?? undefined)
  if (!scope.ok) return scope.response
  const endpoints = parseMcpEndpoints(getConfigValue(scope.scope.contextId, 'mcp_endpoints')).map((e) => ({
    ...e,
    headers: maskHeaders(e.headers),
  }))
  return settingsJson(200, { contextId: scope.scope.contextId, endpoints })
}

async function handlePut(req: Request): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  const csrf = requireCsrf(req, auth.authed)
  if (csrf !== null) return csrf

  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = PutBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  const scope = resolveContextScope(auth.authed.principal, 'write', body.data.contextId)
  if (!scope.ok) return scope.response

  const stored = parseMcpEndpoints(getConfigValue(scope.scope.contextId, 'mcp_endpoints'))
  const validated: McpEndpointConfig[] = []
  for (const raw of body.data.endpoints) {
    const entry = mcpEndpointConfigSchema.safeParse(raw)
    if (!entry.success) return settingsJson(422, { error: entry.error.issues[0]?.message ?? 'invalid endpoint' })
    validated.push(restoreMaskedHeaders(entry.data, stored))
  }

  setConfigValue(scope.scope.contextId, 'mcp_endpoints', JSON.stringify(validated))
  log.info({ contextId: scope.scope.contextId, count: validated.length }, 'Settings MCP endpoints updated')
  return settingsJson(200, { ok: true, contextId: scope.scope.contextId })
}

export async function handleMcpRoutes(req: Request, url: URL): Promise<Response> {
  if (req.method === 'GET') return handleGet(req, url)
  if (req.method === 'PUT') return handlePut(req)
  return settingsJson(405, { error: 'method not allowed' })
}
```

- [ ] **Step 4: Add the dispatch branch**

In `src/debug/settings-api-router.ts`:

```typescript
import { handleMcpRoutes } from './settings/mcp-routes.js'
```

```typescript
if (url.pathname === '/settings/api/mcp') return handleMcpRoutes(req, url)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test tests/debug/settings/mcp-routes.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/debug/settings/mcp-routes.ts src/debug/settings-api-router.ts tests/debug/settings/mcp-routes.test.ts
git commit -m "feat(settings): structured MCP endpoint GET/PUT with masked-header preservation"
```

---

## Task 7: Plugins GET + toggle + config

Replaces the `plg:` flow. GET lists per-plugin eligibility + enabled state for the context; toggle enables/disables (refusing to enable when config is missing); config PATCH writes a context-scoped plugin config key validated against the manifest's `configRequirements`. Reuses `pluginRegistry`, `getPluginContextEligibility`, `setPluginEnabledForContext`, `isPluginEnabledForContext`, `getPluginConfig`/`setPluginConfig`.

**Files:**

- Create: `src/debug/settings/plugins-routes.ts`
- Modify: `src/debug/settings-api-router.ts`
- Create: `tests/debug/settings/plugins-routes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/debug/settings/plugins-routes.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { handlePluginsRoutes } from '../../../src/debug/settings/plugins-routes.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

describe('settings plugins routes', () => {
  let session: SettingsSession

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
    session = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'u-1' })
  })

  test('GET returns a plugins array (empty when none discovered)', async () => {
    const url = new URL('https://x/settings/api/plugins')
    const res = await handlePluginsRoutes(
      new Request(url, { headers: authHeaders(session) }),
      url,
      '/settings/api/plugins',
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { plugins: unknown[] }
    expect(Array.isArray(body.plugins)).toBe(true)
  })

  test('toggle of an unknown plugin returns 422', async () => {
    const url = new URL('https://x/settings/api/plugins/toggle')
    const res = await handlePluginsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginId: 'ghost', enabled: true }),
      }),
      url,
      '/settings/api/plugins/toggle',
    )
    expect(res.status).toBe(422)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/debug/settings/plugins-routes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the handler**

Create `src/debug/settings/plugins-routes.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { getPluginConfig, setPluginConfig } from '../../config.js'
import { logger } from '../../logger.js'
import {
  getPluginContextEligibility,
  isPluginActiveForContext,
  pluginRegistry,
  setPluginEnabledForContext,
} from '../../plugins/registry.js'
import { isPluginEnabledForContext } from '../../plugins/store.js'
import { authenticate, parseJsonBody, requireCsrf, resolveContextScope, settingsJson } from './respond.js'

const log = logger.child({ scope: 'debug-server:settings-plugins' })

function handleGet(req: Request, url: URL): Response {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  const scope = resolveContextScope(auth.authed.principal, 'read', url.searchParams.get('contextId') ?? undefined)
  if (!scope.ok) return scope.response

  const plugins = pluginRegistry.getAllEntries().map((entry) => {
    const id = entry.discoveredPlugin.manifest.id
    const contextConfig = entry.discoveredPlugin.manifest.configRequirements
      .filter((r) => r.scope === 'context')
      .map((r) => ({
        key: r.key,
        label: r.label,
        required: r.required,
        sensitive: r.sensitive,
        hasValue: (getPluginConfig(scope.scope.contextId, id, r.key) ?? '').length > 0,
      }))
    return {
      id,
      name: entry.discoveredPlugin.manifest.name,
      active: isPluginActiveForContext(id, scope.scope.contextId),
      enabled: isPluginEnabledForContext(id, scope.scope.contextId),
      eligibility: getPluginContextEligibility(id, scope.scope.contextId),
      contextConfig,
    }
  })
  return settingsJson(200, { contextId: scope.scope.contextId, plugins })
}

const ToggleBodySchema = z.object({
  pluginId: z.string().min(1),
  enabled: z.boolean(),
  contextId: z.string().optional(),
})

async function handleToggle(req: Request): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  const csrf = requireCsrf(req, auth.authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = ToggleBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  const scope = resolveContextScope(auth.authed.principal, 'write', body.data.contextId)
  if (!scope.ok) return scope.response

  if (pluginRegistry.getEntry(body.data.pluginId) === undefined) {
    return settingsJson(422, { error: 'unknown plugin' })
  }
  if (body.data.enabled) {
    const eligibility = getPluginContextEligibility(body.data.pluginId, scope.scope.contextId)
    if (!eligibility.eligible && eligibility.reason === 'config_missing') {
      return settingsJson(422, { error: 'plugin config missing', missingKeys: eligibility.missingKeys })
    }
  }
  setPluginEnabledForContext(body.data.pluginId, scope.scope.contextId, body.data.enabled)
  log.info(
    { contextId: scope.scope.contextId, pluginId: body.data.pluginId, enabled: body.data.enabled },
    'Settings plugin toggled',
  )
  return settingsJson(200, { ok: true, contextId: scope.scope.contextId })
}

const ConfigBodySchema = z.object({
  pluginId: z.string().min(1),
  key: z.string().min(1),
  value: z.string(),
  contextId: z.string().optional(),
})

async function handleConfig(req: Request): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  const csrf = requireCsrf(req, auth.authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = ConfigBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  const scope = resolveContextScope(auth.authed.principal, 'write', body.data.contextId)
  if (!scope.ok) return scope.response

  const entry = pluginRegistry.getEntry(body.data.pluginId)
  if (entry === undefined) return settingsJson(422, { error: 'unknown plugin' })
  const requirement = entry.discoveredPlugin.manifest.configRequirements.find(
    (r) => r.scope === 'context' && r.key === body.data.key,
  )
  if (requirement === undefined) return settingsJson(422, { error: 'unknown plugin config key' })
  if (requirement.sensitive && body.data.value.length === 0) {
    return settingsJson(200, { ok: true, contextId: scope.scope.contextId, unchanged: true })
  }
  setPluginConfig(scope.scope.contextId, body.data.pluginId, body.data.key, body.data.value)
  log.info(
    { contextId: scope.scope.contextId, pluginId: body.data.pluginId, key: body.data.key },
    'Settings plugin config updated',
  )
  return settingsJson(200, { ok: true, contextId: scope.scope.contextId })
}

export async function handlePluginsRoutes(req: Request, url: URL, pathname: string): Promise<Response> {
  if (pathname === '/settings/api/plugins') {
    if (req.method === 'GET') return handleGet(req, url)
    return settingsJson(405, { error: 'method not allowed' })
  }
  if (pathname === '/settings/api/plugins/toggle') {
    if (req.method === 'POST') return handleToggle(req)
    return settingsJson(405, { error: 'method not allowed' })
  }
  if (pathname === '/settings/api/plugins/config') {
    if (req.method === 'PATCH') return handleConfig(req)
    return settingsJson(405, { error: 'method not allowed' })
  }
  return settingsJson(404, { error: 'not found' })
}
```

- [ ] **Step 4: Add the dispatch branch**

In `src/debug/settings-api-router.ts`:

```typescript
import { handlePluginsRoutes } from './settings/plugins-routes.js'
```

```typescript
if (url.pathname.startsWith('/settings/api/plugins')) return handlePluginsRoutes(req, url, url.pathname)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test tests/debug/settings/plugins-routes.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/debug/settings/plugins-routes.ts src/debug/settings-api-router.ts tests/debug/settings/plugins-routes.test.ts
git commit -m "feat(settings): plugins GET + toggle + config (manifest-validated)"
```

---

## Task 8: Identity GET/PUT/DELETE

Replaces manual `set_my_identity`/`clear_my_identity`. The provider name is derived from the context's assigned task instance. Reuses `getIdentityMapping`/`setIdentityMapping`/`clearIdentityMapping`, `getContextSettings`, `getTaskInstance`.

**Files:**

- Create: `src/debug/settings/identity-routes.ts`
- Modify: `src/debug/settings-api-router.ts`
- Create: `tests/debug/settings/identity-routes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/debug/settings/identity-routes.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { handleIdentityRoutes } from '../../../src/debug/settings/identity-routes.js'
import { insertTaskInstance } from '../../../src/instances/task-store.js'
import { setContextSettings } from '../../../src/instances/context-store.js'
import { resolveSettingsPrincipal } from '../../../src/settings/principal.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

describe('settings identity routes', () => {
  let session: SettingsSession
  let contextId: string

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
    insertTaskInstance({ id: 'ti-1', type: 'kaneo', config: {}, status: 'active' })
    contextId = resolveSettingsPrincipal('pi-1', 'u-1').personalConfigContextId
    setContextSettings({ contextId, taskInstanceId: 'ti-1', platformInstanceId: 'pi-1' })
    session = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'u-1' })
  })

  test('PUT then GET reflects the manual mapping', async () => {
    const put = await handleIdentityRoutes(
      new Request('https://x/settings/api/identity', {
        method: 'PUT',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerUserId: 'kaneo-42', providerUserLogin: 'me', displayName: 'Me' }),
      }),
      new URL('https://x/settings/api/identity'),
    )
    expect(put.status).toBe(200)

    const get = await handleIdentityRoutes(
      new Request('https://x/settings/api/identity', { headers: authHeaders(session) }),
      new URL('https://x/settings/api/identity'),
    )
    const body = (await get.json()) as { mapping: { providerUserId: string | null } | null }
    expect(body.mapping?.providerUserId).toBe('kaneo-42')
  })

  test('DELETE clears the mapping', async () => {
    const res = await handleIdentityRoutes(
      new Request('https://x/settings/api/identity', { method: 'DELETE', headers: authHeaders(session, true) }),
      new URL('https://x/settings/api/identity'),
    )
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/debug/settings/identity-routes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the handler**

Create `src/debug/settings/identity-routes.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { clearIdentityMapping, getIdentityMapping, setIdentityMapping } from '../../identity/mapping.js'
import { getContextSettings } from '../../instances/context-store.js'
import { getTaskInstance } from '../../instances/task-store.js'
import { logger } from '../../logger.js'
import {
  authenticate,
  parseJsonBody,
  requireCsrf,
  resolveContextScope,
  settingsJson,
  type ContextScope,
} from './respond.js'

const log = logger.child({ scope: 'debug-server:settings-identity' })

/** Resolve the task-provider name (e.g. 'kaneo') for a context, or null if unconfigured. */
function providerNameFor(contextId: string): string | null {
  const settings = getContextSettings(contextId)
  if (settings === null) return null
  const instance = getTaskInstance(settings.taskInstanceId)
  return instance?.type ?? null
}

function handleGet(req: Request, url: URL): Response {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  const scope = resolveContextScope(auth.authed.principal, 'read', url.searchParams.get('contextId') ?? undefined)
  if (!scope.ok) return scope.response
  const provider = providerNameFor(scope.scope.contextId)
  if (provider === null) return settingsJson(422, { error: 'no task instance configured for this context' })
  return settingsJson(200, {
    contextId: scope.scope.contextId,
    providerName: provider,
    mapping: getIdentityMapping(scope.scope.contextId, provider),
  })
}

const PutBodySchema = z.object({
  providerUserId: z.string().min(1),
  providerUserLogin: z.string().nullable().optional(),
  displayName: z.string().nullable().optional(),
  contextId: z.string().optional(),
})

async function resolveWriteScope(
  req: Request,
  rawContextId: string | undefined,
): Promise<{ ok: true; scope: ContextScope; provider: string } | { ok: false; response: Response }> {
  const auth = authenticate(req)
  if (!auth.ok) return { ok: false, response: auth.response }
  const csrf = requireCsrf(req, auth.authed)
  if (csrf !== null) return { ok: false, response: csrf }
  const scope = resolveContextScope(auth.authed.principal, 'write', rawContextId)
  if (!scope.ok) return { ok: false, response: scope.response }
  const provider = providerNameFor(scope.scope.contextId)
  if (provider === null)
    return { ok: false, response: settingsJson(422, { error: 'no task instance configured for this context' }) }
  return { ok: true, scope: scope.scope, provider }
}

async function handlePut(req: Request): Promise<Response> {
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = PutBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })
  const resolved = await resolveWriteScope(req, body.data.contextId)
  if (!resolved.ok) return resolved.response

  setIdentityMapping({
    contextId: resolved.scope.contextId,
    providerName: resolved.provider,
    providerUserId: body.data.providerUserId,
    providerUserLogin: body.data.providerUserLogin ?? null,
    displayName: body.data.displayName ?? null,
    matchMethod: 'manual_nl',
    confidence: 1,
  })
  log.info({ contextId: resolved.scope.contextId, providerName: resolved.provider }, 'Settings identity mapping set')
  return settingsJson(200, { ok: true, contextId: resolved.scope.contextId })
}

async function handleDelete(req: Request, url: URL): Promise<Response> {
  const resolved = await resolveWriteScope(req, url.searchParams.get('contextId') ?? undefined)
  if (!resolved.ok) return resolved.response
  clearIdentityMapping(resolved.scope.contextId, resolved.provider)
  log.info(
    { contextId: resolved.scope.contextId, providerName: resolved.provider },
    'Settings identity mapping cleared',
  )
  return settingsJson(200, { ok: true, contextId: resolved.scope.contextId })
}

export async function handleIdentityRoutes(req: Request, url: URL): Promise<Response> {
  if (req.method === 'GET') return handleGet(req, url)
  if (req.method === 'PUT') return handlePut(req)
  if (req.method === 'DELETE') return handleDelete(req, url)
  return settingsJson(405, { error: 'method not allowed' })
}
```

- [ ] **Step 4: Add the dispatch branch**

In `src/debug/settings-api-router.ts`:

```typescript
import { handleIdentityRoutes } from './settings/identity-routes.js'
```

```typescript
if (url.pathname === '/settings/api/identity') return handleIdentityRoutes(req, url)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test tests/debug/settings/identity-routes.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/debug/settings/identity-routes.ts src/debug/settings-api-router.ts tests/debug/settings/identity-routes.test.ts
git commit -m "feat(settings): identity GET/PUT/DELETE for manual provider linking"
```

---

## Task 9: Kaneo provision POST

`POST /settings/api/provision/kaneo` runs `provisionAndConfigure` for the scoped context and returns the generated credentials once (spec OQ-H3). The Kaneo public/internal URLs come from env (`KANEO_CLIENT_URL`, `KANEO_INTERNAL_URL`) — the same source the bootstrap/setup wizard uses.

**Files:**

- Create: `src/debug/settings/provision-routes.ts`
- Modify: `src/debug/settings-api-router.ts`
- Create: `tests/debug/settings/provision-routes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/debug/settings/provision-routes.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { handleProvisionKaneo } from '../../../src/debug/settings/provision-routes.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

describe('settings kaneo provision route', () => {
  let session: SettingsSession
  const originalUrl = process.env['KANEO_CLIENT_URL']

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
    session = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'u-1' })
    delete process.env['KANEO_CLIENT_URL']
  })

  test('returns 422 when no Kaneo public URL is configured', async () => {
    const res = await handleProvisionKaneo(
      new Request('https://x/settings/api/provision/kaneo', {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(422)
    if (originalUrl !== undefined) process.env['KANEO_CLIENT_URL'] = originalUrl
  })

  test('POST without CSRF is 403', async () => {
    const res = await handleProvisionKaneo(
      new Request('https://x/settings/api/provision/kaneo', {
        method: 'POST',
        headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(403)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/debug/settings/provision-routes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the handler**

Create `src/debug/settings/provision-routes.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { logger } from '../../logger.js'
import { provisionAndConfigure } from '../../providers/kaneo/provision.js'
import { authenticate, parseJsonBody, requireCsrf, resolveContextScope, settingsJson } from './respond.js'

const log = logger.child({ scope: 'debug-server:settings-provision' })
const BodySchema = z.object({ contextId: z.string().optional() })

export async function handleProvisionKaneo(req: Request): Promise<Response> {
  if (req.method !== 'POST') return settingsJson(405, { error: 'method not allowed' })
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  const csrf = requireCsrf(req, auth.authed)
  if (csrf !== null) return csrf

  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = BodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  const scope = resolveContextScope(auth.authed.principal, 'write', body.data.contextId)
  if (!scope.ok) return scope.response

  const publicUrl = process.env['KANEO_CLIENT_URL']
  const internalUrl = process.env['KANEO_INTERNAL_URL']
  const outcome = await provisionAndConfigure(scope.scope.contextId, auth.authed.principal.platformUserId, {
    publicUrl,
    internalUrl,
  })

  if (outcome.status === 'provisioned') {
    log.info({ contextId: scope.scope.contextId }, 'Settings Kaneo provision succeeded')
    // One-time credential reveal: email/password are not stored in plaintext anywhere we read back.
    return settingsJson(200, {
      status: 'provisioned',
      contextId: scope.scope.contextId,
      email: outcome.email,
      password: outcome.password,
      kaneoUrl: outcome.kaneoUrl,
      workspaceId: outcome.workspaceId,
    })
  }
  if (outcome.status === 'registration_disabled') {
    return settingsJson(422, { status: 'registration_disabled', error: 'Kaneo registration is disabled' })
  }
  log.warn({ contextId: scope.scope.contextId }, 'Settings Kaneo provision failed')
  return settingsJson(422, { status: 'failed', error: outcome.error })
}
```

- [ ] **Step 4: Add the dispatch branch**

In `src/debug/settings-api-router.ts`:

```typescript
import { handleProvisionKaneo } from './settings/provision-routes.js'
```

```typescript
if (url.pathname === '/settings/api/provision/kaneo') return handleProvisionKaneo(req)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test tests/debug/settings/provision-routes.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/debug/settings/provision-routes.ts src/debug/settings-api-router.ts tests/debug/settings/provision-routes.test.ts
git commit -m "feat(settings): Kaneo auto-provision route with one-time credential reveal"
```

---

## Task 10: Group members + group task-instance

Group-only routes (scope kind must be `group`). Members list/add/remove via `src/groups.ts`; group→task-instance read/select via `src/instances/context-store.ts`. Per spec OQ-H2, group task-instance **creation** stays bot-admin-only; this route only reads + selects an existing task instance.

**Files:**

- Create: `src/debug/settings/group-routes.ts`
- Modify: `src/debug/settings-api-router.ts`
- Create: `tests/debug/settings/group-routes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/debug/settings/group-routes.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { handleGroupRoutes } from '../../../src/debug/settings/group-routes.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

describe('settings group routes', () => {
  let session: SettingsSession

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
    session = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'u-1' })
  })

  test('members GET on a personal context is 403 (group scope required)', async () => {
    // A personal user with no manageable groups cannot reach a group route.
    const url = new URL('https://x/settings/api/group/members?contextId=personal-only')
    const res = await handleGroupRoutes(
      new Request(url, { headers: authHeaders(session) }),
      url,
      '/settings/api/group/members',
    )
    expect(res.status).toBe(403)
  })
})
```

> Note: a fuller test that exercises a real managed group requires seeding a manageable group for the principal. Mirror `tests/settings/scope-guard.test.ts` for the group-seeding pattern (it sets up `manageableGroups`); add a happy-path `members` POST/GET test there once the seeding helper is identified. The 403 test above is the guard contract that must always hold.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/debug/settings/group-routes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the handler**

Create `src/debug/settings/group-routes.ts`. These routes require a **group** scope explicitly, so they call `requireScope` with `kind: 'group'` directly (not `resolveContextScope`, which would fall back to personal).

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { addGroupMember, listGroupMembers, removeGroupMember } from '../../groups.js'
import { getContextSettings, setContextSettings } from '../../instances/context-store.js'
import { getTaskInstance, listTaskInstances } from '../../instances/task-store.js'
import { logger } from '../../logger.js'
import { requireScope } from '../../settings/scope-guard.js'
import type { AuthenticatedSettingsRequest } from '../../settings/request-auth.js'
import { authenticate, parseJsonBody, requireCsrf, settingsJson } from './respond.js'

const log = logger.child({ scope: 'debug-server:settings-group' })

type GroupContext = { contextId: string }

/** Resolve a required group scope from a raw contextId; 403 if not a manageable group. */
function requireGroup(
  authed: AuthenticatedSettingsRequest,
  action: 'read' | 'write',
  rawContextId: string | null,
): { ok: true; group: GroupContext } | { ok: false; response: Response } {
  if (rawContextId === null || rawContextId.length === 0) {
    return { ok: false, response: settingsJson(403, { error: 'forbidden' }) }
  }
  const result = requireScope(authed.principal, { action, target: { kind: 'group', contextId: rawContextId } })
  if (!result.ok) return { ok: false, response: settingsJson(403, { error: 'forbidden' }) }
  return { ok: true, group: { contextId: result.contextId } }
}

function handleMembersGet(authed: AuthenticatedSettingsRequest, url: URL): Response {
  const group = requireGroup(authed, 'read', url.searchParams.get('contextId'))
  if (!group.ok) return group.response
  return settingsJson(200, { contextId: group.group.contextId, members: listGroupMembers(group.group.contextId) })
}

const MemberBodySchema = z.object({ userId: z.string().min(1), contextId: z.string().min(1) })

async function handleMembersWrite(req: Request, authed: AuthenticatedSettingsRequest): Promise<Response> {
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = MemberBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })
  const group = requireGroup(authed, 'write', body.data.contextId)
  if (!group.ok) return group.response

  if (req.method === 'POST') {
    addGroupMember(group.group.contextId, body.data.userId, authed.principal.platformUserId)
    log.info({ contextId: group.group.contextId }, 'Settings group member added')
  } else {
    removeGroupMember(group.group.contextId, body.data.userId)
    log.info({ contextId: group.group.contextId }, 'Settings group member removed')
  }
  return settingsJson(200, { ok: true, contextId: group.group.contextId })
}

function handleTaskInstanceGet(authed: AuthenticatedSettingsRequest, url: URL): Response {
  const group = requireGroup(authed, 'read', url.searchParams.get('contextId'))
  if (!group.ok) return group.response
  const settings = getContextSettings(group.group.contextId)
  return settingsJson(200, {
    contextId: group.group.contextId,
    taskInstanceId: settings?.taskInstanceId ?? null,
    available: listTaskInstances().map((t) => ({ id: t.id, type: t.type, status: t.status })),
  })
}

const TaskInstanceBodySchema = z.object({ taskInstanceId: z.string().min(1), contextId: z.string().min(1) })

async function handleTaskInstancePatch(req: Request, authed: AuthenticatedSettingsRequest): Promise<Response> {
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = TaskInstanceBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })
  const group = requireGroup(authed, 'write', body.data.contextId)
  if (!group.ok) return group.response

  if (getTaskInstance(body.data.taskInstanceId) === null) {
    return settingsJson(422, { error: 'unknown task instance' })
  }
  const existing = getContextSettings(group.group.contextId)
  setContextSettings({
    contextId: group.group.contextId,
    taskInstanceId: body.data.taskInstanceId,
    platformInstanceId: existing?.platformInstanceId ?? authed.principal.platformInstanceId,
  })
  log.info(
    { contextId: group.group.contextId, taskInstanceId: body.data.taskInstanceId },
    'Settings group task instance set',
  )
  return settingsJson(200, { ok: true, contextId: group.group.contextId })
}

export async function handleGroupRoutes(req: Request, url: URL, pathname: string): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response

  if (pathname === '/settings/api/group/members') {
    if (req.method === 'GET') return handleMembersGet(auth.authed, url)
    if (req.method === 'POST' || req.method === 'DELETE') return handleMembersWrite(req, auth.authed)
    return settingsJson(405, { error: 'method not allowed' })
  }
  if (pathname === '/settings/api/group/task-instance') {
    if (req.method === 'GET') return handleTaskInstanceGet(auth.authed, url)
    if (req.method === 'PATCH') return handleTaskInstancePatch(req, auth.authed)
    return settingsJson(405, { error: 'method not allowed' })
  }
  return settingsJson(404, { error: 'not found' })
}
```

- [ ] **Step 4: Add the dispatch branch**

In `src/debug/settings-api-router.ts`:

```typescript
import { handleGroupRoutes } from './settings/group-routes.js'
```

```typescript
if (url.pathname.startsWith('/settings/api/group/')) return handleGroupRoutes(req, url, url.pathname)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test tests/debug/settings/group-routes.test.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add src/debug/settings/group-routes.ts src/debug/settings-api-router.ts tests/debug/settings/group-routes.test.ts
git commit -m "feat(settings): group members + group task-instance selection routes"
```

---

## Task 11: Extract reusable `broadcastMessage`

The admin announce route (Task 14) needs the `/announce` fan-out without the chat-command wrapper. Extract it from `src/commands/admin.ts` into a reusable function and have the command call it.

**Files:**

- Create: `src/commands/announce-broadcast.ts`
- Modify: `src/commands/admin.ts` (the inline broadcast in `handleAnnounce`)
- Create: `tests/commands/announce-broadcast.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/commands/announce-broadcast.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { broadcastMessage } from '../../src/commands/announce-broadcast.js'
import { addUser } from '../../src/users.js'
import { createMockChat, mockLogger, seedTestPlatformInstance, setupTestDb } from '../utils/test-helpers.js'

describe('broadcastMessage', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
    addUser({ userId: 'u-2', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
  })

  test('sends to every authorized user and returns counts', async () => {
    const chat = createMockChat()
    const sendMessage = mock(async () => true)
    chat.sendMessage = sendMessage as unknown as typeof chat.sendMessage
    const result = await broadcastMessage(chat, 'pi-1', 'hello')
    expect(result.totalUsers).toBe(2)
    expect(result.successCount).toBe(2)
    expect(sendMessage).toHaveBeenCalledTimes(2)
  })

  test('returns zero counts when there are no users', async () => {
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    const chat = createMockChat()
    const result = await broadcastMessage(chat, 'pi-1', 'hello')
    expect(result.totalUsers).toBe(0)
  })
})
```

> If `createMockChat()`'s default `sendMessage` already records calls, prefer asserting on it directly rather than overriding. Adapt to the helper's actual shape (`tests/utils/test-helpers.ts`).

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/commands/announce-broadcast.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the extracted function**

Create `src/commands/announce-broadcast.ts` (move the existing logic from `handleAnnounce` in `src/commands/admin.ts` verbatim, parameterized):

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'

import type { ChatProvider } from '../chat/types.js'
import { logger } from '../logger.js'
import { dmTarget } from './dm-target.js'
import { listUsers } from '../users.js'

const log = logger.child({ scope: 'commands:announce-broadcast' })
const MAX_CONCURRENT_SENDS = 5

export interface BroadcastResult {
  totalUsers: number
  successCount: number
  failCount: number
}

/** Send `message` to every authorized (non-placeholder) user of a platform instance. */
export async function broadcastMessage(
  chat: Readonly<ChatProvider>,
  platformInstanceId: string,
  message: string,
): Promise<BroadcastResult> {
  const users = listUsers(platformInstanceId).filter((u) => !u.platform_user_id.startsWith('placeholder-'))
  if (users.length === 0) return { totalUsers: 0, successCount: 0, failCount: 0 }

  const limit = pLimit(MAX_CONCURRENT_SENDS)
  const results = await Promise.allSettled(
    users.map((user) =>
      limit(async () => {
        const result = await chat.sendMessage(platformInstanceId, dmTarget(user.platform_user_id), message)
        return result !== false
      }),
    ),
  )
  const successCount = results.filter((r) => r.status === 'fulfilled' && r.value).length
  log.info({ platformInstanceId, totalUsers: users.length, successCount }, 'Broadcast complete')
  return { totalUsers: users.length, successCount, failCount: results.length - successCount }
}
```

> Adjust the `dmTarget` import to wherever that helper currently lives in `src/commands/admin.ts` (search for `dmTarget(`). If it is a local function in `admin.ts`, export it from there and import it here, or move it alongside this file — keep one definition (DRY).

- [ ] **Step 4: Rewire `handleAnnounce` to call the extracted function**

In `src/commands/admin.ts`, replace the inline `listUsers` + `pLimit` + `Promise.allSettled` block inside `handleAnnounce` with:

```typescript
const { totalUsers, successCount, failCount } = await broadcastMessage(chat, msg.platformInstanceId, message)
if (totalUsers === 0) {
  await reply.text('No authorized users to announce to.')
  return
}
await reply.text(`Announcement sent to ${successCount} user(s)${failCount > 0 ? `, ${failCount} failed` : ''}.`)
```

Add the import at the top of `src/commands/admin.ts`:

```typescript
import { broadcastMessage } from './announce-broadcast.js'
```

Remove the now-unused `pLimit`/`MAX_CONCURRENT_SENDS` symbols from `admin.ts` if nothing else uses them (run `bun knip` to confirm).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test tests/commands/announce-broadcast.test.ts && bun test tests/commands/admin.test.ts`
Expected: PASS (new suite + existing admin command suite still green).

- [ ] **Step 6: Commit**

```bash
git add src/commands/announce-broadcast.ts src/commands/admin.ts tests/commands/announce-broadcast.test.ts
git commit -m "refactor(commands): extract reusable broadcastMessage from /announce"
```

---

## Task 12: Admin wrappers — instances + provider types

Thin `/settings/api/admin/*` wrappers gated by `requireScope({ kind: 'admin' })`. Calls the platform/task instance stores and the provider-type registries directly (never the `DEBUG_TOKEN` handlers). Masks instance config with `maskConfig`.

**Files:**

- Create: `src/debug/settings/admin/instances-routes.ts`
- Modify: `src/debug/settings-api-router.ts`
- Create: `tests/debug/settings/admin-instances-routes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/debug/settings/admin-instances-routes.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { handleAdminInstancesRoutes } from '../../../src/debug/settings/admin/instances-routes.js'
import { addAdmin } from '../../../src/instances/admin-store.js'
import { insertTaskInstance } from '../../../src/instances/task-store.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

describe('settings admin instances routes', () => {
  let adminSession: SettingsSession
  let userSession: SettingsSession

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'admin-1', platformInstanceId: 'pi-1', addedBy: 'boot', username: undefined })
    addUser({ userId: 'user-1', platformInstanceId: 'pi-1', addedBy: 'admin-1', username: undefined })
    addAdmin('admin-1', 'pi-1')
    insertTaskInstance({ id: 'ti-1', type: 'kaneo', config: { kaneo_apikey: 'secret-value' }, status: 'active' })
    adminSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'admin-1' })
    userSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'user-1' })
  })

  test('non-admin gets 403', async () => {
    const url = new URL('https://x/settings/api/admin/task-instances')
    const res = await handleAdminInstancesRoutes(
      new Request(url, { headers: authHeaders(userSession) }),
      url,
      '/settings/api/admin/task-instances',
    )
    expect(res.status).toBe(403)
  })

  test('admin lists task instances with masked config', async () => {
    const url = new URL('https://x/settings/api/admin/task-instances')
    const res = await handleAdminInstancesRoutes(
      new Request(url, { headers: authHeaders(adminSession) }),
      url,
      '/settings/api/admin/task-instances',
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { instances: Array<{ config: Record<string, string> }> }
    expect(body.instances[0]?.config['kaneo_apikey']).not.toBe('secret-value')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/debug/settings/admin-instances-routes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the wrapper**

Create `src/debug/settings/admin/instances-routes.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { listPlatformProviderTypes } from '../../../chat/registry.js'
import { maskConfig } from '../../../instances/encryption.js'
import {
  deletePlatformInstance,
  insertPlatformInstance,
  listPlatformInstances,
  updatePlatformInstance,
} from '../../../instances/platform-store.js'
import {
  deleteTaskInstance,
  insertTaskInstance,
  listTaskInstances,
  updateTaskInstance,
} from '../../../instances/task-store.js'
import type { PlatformInstance, TaskInstance } from '../../../instances/types.js'
import { logger } from '../../../logger.js'
import { listTaskProviderTypes } from '../../../providers/registry.js'
import { requireScope } from '../../../settings/scope-guard.js'
import type { AuthenticatedSettingsRequest } from '../../../settings/request-auth.js'
import { authenticate, parseJsonBody, requireCsrf, settingsJson } from '../respond.js'

const log = logger.child({ scope: 'debug-server:settings-admin-instances' })

function requireAdmin(authed: AuthenticatedSettingsRequest, action: 'read' | 'write'): Response | null {
  const result = requireScope(authed.principal, { action, target: { kind: 'admin' } })
  return result.ok ? null : settingsJson(403, { error: 'forbidden' })
}

const maskPlatform = (i: PlatformInstance): unknown => ({ ...i, config: maskConfig(i.config) })
const maskTask = (i: TaskInstance): unknown => ({ ...i, config: maskConfig(i.config) })

const InstanceCreateSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  config: z.record(z.string(), z.string()).default({}),
  status: z.enum(['pending', 'active', 'stopped']).default('pending'),
})
const InstancePatchSchema = z.object({
  config: z.record(z.string(), z.string()).optional(),
  status: z.enum(['pending', 'active', 'stopped']).optional(),
})

function lastPathSegment(url: URL): string | undefined {
  const parts = url.pathname.split('/').filter((p) => p.length > 0)
  return parts.at(-1)
}

async function handleTaskInstances(req: Request, url: URL, authed: AuthenticatedSettingsRequest): Promise<Response> {
  if (req.method === 'GET') {
    const guard = requireAdmin(authed, 'read')
    if (guard !== null) return guard
    return settingsJson(200, { instances: listTaskInstances().map(maskTask) })
  }
  const writeGuard = requireAdmin(authed, 'write')
  if (writeGuard !== null) return writeGuard
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf

  if (req.method === 'POST' && url.pathname === '/settings/api/admin/task-instances') {
    const parsed = await parseJsonBody(req)
    if (!parsed.ok) return parsed.response
    const body = InstanceCreateSchema.safeParse(parsed.value)
    if (!body.success) return settingsJson(422, { error: 'invalid request' })
    insertTaskInstance(body.data)
    log.info({ id: body.data.id }, 'Settings admin created task instance')
    return settingsJson(201, { ok: true, id: body.data.id })
  }
  const id = lastPathSegment(url)
  if (id === undefined || id === 'task-instances') return settingsJson(404, { error: 'not found' })
  if (req.method === 'PATCH') {
    const parsed = await parseJsonBody(req)
    if (!parsed.ok) return parsed.response
    const body = InstancePatchSchema.safeParse(parsed.value)
    if (!body.success) return settingsJson(422, { error: 'invalid request' })
    updateTaskInstance(id, { config: body.data.config, status: body.data.status })
    return settingsJson(200, { ok: true, id })
  }
  if (req.method === 'DELETE') {
    deleteTaskInstance(id)
    return settingsJson(200, { ok: true, id })
  }
  return settingsJson(405, { error: 'method not allowed' })
}

async function handlePlatformInstances(
  req: Request,
  url: URL,
  authed: AuthenticatedSettingsRequest,
): Promise<Response> {
  if (req.method === 'GET') {
    const guard = requireAdmin(authed, 'read')
    if (guard !== null) return guard
    return settingsJson(200, { instances: listPlatformInstances().map(maskPlatform) })
  }
  const writeGuard = requireAdmin(authed, 'write')
  if (writeGuard !== null) return writeGuard
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf

  if (req.method === 'POST' && url.pathname === '/settings/api/admin/platform-instances') {
    const parsed = await parseJsonBody(req)
    if (!parsed.ok) return parsed.response
    const body = InstanceCreateSchema.safeParse(parsed.value)
    if (!body.success) return settingsJson(422, { error: 'invalid request' })
    insertPlatformInstance({
      id: body.data.id,
      type: body.data.type as PlatformInstance['type'],
      config: body.data.config,
      status: body.data.status,
    })
    log.info({ id: body.data.id }, 'Settings admin created platform instance')
    return settingsJson(201, { ok: true, id: body.data.id })
  }
  const id = lastPathSegment(url)
  if (id === undefined || id === 'platform-instances') return settingsJson(404, { error: 'not found' })
  if (req.method === 'PATCH') {
    const parsed = await parseJsonBody(req)
    if (!parsed.ok) return parsed.response
    const body = InstancePatchSchema.safeParse(parsed.value)
    if (!body.success) return settingsJson(422, { error: 'invalid request' })
    updatePlatformInstance(id, { config: body.data.config, status: body.data.status })
    return settingsJson(200, { ok: true, id })
  }
  if (req.method === 'DELETE') {
    deletePlatformInstance(id)
    return settingsJson(200, { ok: true, id })
  }
  return settingsJson(405, { error: 'method not allowed' })
}

export async function handleAdminInstancesRoutes(req: Request, url: URL, pathname: string): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response

  if (pathname === '/settings/api/admin/platform-provider-types') {
    const guard = requireAdmin(auth.authed, 'read')
    if (guard !== null) return guard
    return settingsJson(200, { providerTypes: listPlatformProviderTypes() })
  }
  if (pathname === '/settings/api/admin/task-provider-types') {
    const guard = requireAdmin(auth.authed, 'read')
    if (guard !== null) return guard
    return settingsJson(200, { providerTypes: listTaskProviderTypes() })
  }
  if (pathname.startsWith('/settings/api/admin/task-instances')) return handleTaskInstances(req, url, auth.authed)
  if (pathname.startsWith('/settings/api/admin/platform-instances'))
    return handlePlatformInstances(req, url, auth.authed)
  return settingsJson(404, { error: 'not found' })
}
```

> Verify the exact export names of the provider-type registries: the explorer found `listPlatformProviderTypes` in `src/chat/registry.ts` and `listTaskProviderTypes` in `src/providers/registry.js`. If `maskConfig`'s default sensitive-key heuristic does not mask `kaneo_apikey`, pass an explicit `sensitiveKeys` set: `maskConfig(i.config, new Set(['kaneo_apikey', 'youtrack_token', 'mattermost_bot_token', 'discord_bot_token', 'telegram_bot_token']))`. Confirm against `src/instances/encryption.ts`.

- [ ] **Step 4: Add the dispatch branch**

In `src/debug/settings-api-router.ts`:

```typescript
import { handleAdminInstancesRoutes } from './settings/admin/instances-routes.js'
```

```typescript
if (
  url.pathname.startsWith('/settings/api/admin/platform-instances') ||
  url.pathname.startsWith('/settings/api/admin/task-instances') ||
  url.pathname === '/settings/api/admin/platform-provider-types' ||
  url.pathname === '/settings/api/admin/task-provider-types'
) {
  return handleAdminInstancesRoutes(req, url, url.pathname)
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test tests/debug/settings/admin-instances-routes.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/debug/settings/admin/instances-routes.ts src/debug/settings-api-router.ts tests/debug/settings/admin-instances-routes.test.ts
git commit -m "feat(settings): admin instance + provider-type wrappers (session-authorized)"
```

---

## Task 13: Admin wrappers — system/LLM + users + groups

Thin admin wrappers reusing the pure logic functions from `src/debug/admin-llm.ts` (`getAdminLlmSnapshot`, `applyAdminLlmUpdate`) and the `users.ts` / `authorized-groups.ts` stores.

**Files:**

- Create: `src/debug/settings/admin/system-access-routes.ts`
- Modify: `src/debug/settings-api-router.ts`
- Create: `tests/debug/settings/admin-system-access-routes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/debug/settings/admin-system-access-routes.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { handleAdminSystemAccessRoutes } from '../../../src/debug/settings/admin/system-access-routes.js'
import { addAdmin } from '../../../src/instances/admin-store.js'
import { addUser, listUsers } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

describe('settings admin system/access routes', () => {
  let adminSession: SettingsSession

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'admin-1', platformInstanceId: 'pi-1', addedBy: 'boot', username: undefined })
    addAdmin('admin-1', 'pi-1')
    adminSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'admin-1' })
  })

  test('GET system returns an LLM snapshot with masked api key', async () => {
    const url = new URL('https://x/settings/api/admin/system')
    const res = await handleAdminSystemAccessRoutes(
      new Request(url, { headers: authHeaders(adminSession) }),
      url,
      '/settings/api/admin/system',
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { config: Record<string, unknown> }
    expect(body.config).toBeDefined()
  })

  test('POST users adds an authorized user', async () => {
    const url = new URL('https://x/settings/api/admin/users')
    const res = await handleAdminSystemAccessRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'newbie' }),
      }),
      url,
      '/settings/api/admin/users',
    )
    expect(res.status).toBe(200)
    expect(listUsers('pi-1').some((u) => u.platform_user_id === 'newbie')).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/debug/settings/admin-system-access-routes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the wrapper**

Create `src/debug/settings/admin/system-access-routes.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { addAuthorizedGroup, listAuthorizedGroups, removeAuthorizedGroup } from '../../../authorized-groups.js'
import { applyAdminLlmUpdate, getAdminLlmSnapshot } from '../../admin-llm.js'
import { logger } from '../../../logger.js'
import { requireScope } from '../../../settings/scope-guard.js'
import type { AuthenticatedSettingsRequest } from '../../../settings/request-auth.js'
import { addUser, listUsers, removeUser } from '../../../users.js'
import { authenticate, parseJsonBody, requireCsrf, settingsJson } from '../respond.js'

const log = logger.child({ scope: 'debug-server:settings-admin-system' })

function requireAdmin(authed: AuthenticatedSettingsRequest, action: 'read' | 'write'): Response | null {
  const result = requireScope(authed.principal, { action, target: { kind: 'admin' } })
  return result.ok ? null : settingsJson(403, { error: 'forbidden' })
}

const UserBodySchema = z.object({ userId: z.string().min(1), username: z.string().optional() })
const GroupBodySchema = z.object({ groupId: z.string().min(1) })
const LlmBodySchema = z.object({ key: z.string().min(1), value: z.string() })

async function handleSystem(req: Request, authed: AuthenticatedSettingsRequest): Promise<Response> {
  if (req.method === 'GET') {
    const guard = requireAdmin(authed, 'read')
    if (guard !== null) return guard
    return settingsJson(200, { config: getAdminLlmSnapshot() })
  }
  if (req.method === 'POST') {
    const guard = requireAdmin(authed, 'write')
    if (guard !== null) return guard
    const csrf = requireCsrf(req, authed)
    if (csrf !== null) return csrf
    const parsed = await parseJsonBody(req)
    if (!parsed.ok) return parsed.response
    const body = LlmBodySchema.safeParse(parsed.value)
    if (!body.success) return settingsJson(422, { error: 'invalid request' })
    try {
      const result = applyAdminLlmUpdate(body.data, authed.principal.platformUserId)
      log.info({ key: body.data.key }, 'Settings admin updated system config')
      return settingsJson(200, { ok: true, key: result.key })
    } catch (error) {
      return settingsJson(422, { error: error instanceof Error ? error.message : String(error) })
    }
  }
  return settingsJson(405, { error: 'method not allowed' })
}

async function handleUsers(req: Request, authed: AuthenticatedSettingsRequest): Promise<Response> {
  if (req.method === 'GET') {
    const guard = requireAdmin(authed, 'read')
    if (guard !== null) return guard
    return settingsJson(200, { users: listUsers(authed.principal.platformInstanceId) })
  }
  const guard = requireAdmin(authed, 'write')
  if (guard !== null) return guard
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = UserBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  if (req.method === 'POST') {
    addUser({
      userId: body.data.userId,
      platformInstanceId: authed.principal.platformInstanceId,
      addedBy: authed.principal.platformUserId,
      username: body.data.username,
    })
    log.info({ platformInstanceId: authed.principal.platformInstanceId }, 'Settings admin added user')
    return settingsJson(200, { ok: true })
  }
  if (req.method === 'DELETE') {
    const removed = removeUser(body.data.userId, authed.principal.platformInstanceId)
    return settingsJson(200, { ok: removed })
  }
  return settingsJson(405, { error: 'method not allowed' })
}

async function handleGroups(req: Request, authed: AuthenticatedSettingsRequest): Promise<Response> {
  if (req.method === 'GET') {
    const guard = requireAdmin(authed, 'read')
    if (guard !== null) return guard
    return settingsJson(200, { groups: listAuthorizedGroups() })
  }
  const guard = requireAdmin(authed, 'write')
  if (guard !== null) return guard
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = GroupBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  if (req.method === 'POST') {
    addAuthorizedGroup(body.data.groupId, authed.principal.platformUserId)
    return settingsJson(200, { ok: true })
  }
  if (req.method === 'DELETE') {
    return settingsJson(200, { ok: removeAuthorizedGroup(body.data.groupId) })
  }
  return settingsJson(405, { error: 'method not allowed' })
}

export async function handleAdminSystemAccessRoutes(req: Request, _url: URL, pathname: string): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  if (pathname === '/settings/api/admin/system') return handleSystem(req, auth.authed)
  if (pathname === '/settings/api/admin/users') return handleUsers(req, auth.authed)
  if (pathname === '/settings/api/admin/groups') return handleGroups(req, auth.authed)
  return settingsJson(404, { error: 'not found' })
}
```

- [ ] **Step 4: Add the dispatch branch**

In `src/debug/settings-api-router.ts`:

```typescript
import { handleAdminSystemAccessRoutes } from './settings/admin/system-access-routes.js'
```

```typescript
if (
  url.pathname === '/settings/api/admin/system' ||
  url.pathname === '/settings/api/admin/users' ||
  url.pathname === '/settings/api/admin/groups'
) {
  return handleAdminSystemAccessRoutes(req, url, url.pathname)
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test tests/debug/settings/admin-system-access-routes.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/debug/settings/admin/system-access-routes.ts src/debug/settings-api-router.ts tests/debug/settings/admin-system-access-routes.test.ts
git commit -m "feat(settings): admin system/LLM + users + groups wrappers"
```

---

## Task 14: Admin wrappers — roster (SA) + plugin approve/reject (SA) + plugin config + announce

The last admin wrappers. Roster and plugin approve/reject are super-admin-gated (`requireSuperAdmin: true`); plugin config and announce are bot-admin-gated. Reuses `admin-store.ts`, `plugins/store.ts` (`upsertPluginAdminState`), the existing admin plugin-config logic, and the extracted `broadcastMessage`.

**Files:**

- Create: `src/debug/settings/admin/roster-plugins-routes.ts`
- Modify: `src/debug/settings-api-router.ts`
- Create: `tests/debug/settings/admin-roster-plugins-routes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/debug/settings/admin-roster-plugins-routes.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { handleAdminRosterPluginsRoutes } from '../../../src/debug/settings/admin/roster-plugins-routes.js'
import { addAdmin, listAdmins, SUPER_ADMIN_PLATFORM_ID } from '../../../src/instances/admin-store.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

describe('settings admin roster/plugins routes', () => {
  let superSession: SettingsSession
  let botAdminSession: SettingsSession

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'sa-1', platformInstanceId: 'pi-1', addedBy: 'boot', username: undefined })
    addUser({ userId: 'ba-1', platformInstanceId: 'pi-1', addedBy: 'sa-1', username: undefined })
    addAdmin('sa-1', SUPER_ADMIN_PLATFORM_ID)
    addAdmin('ba-1', 'pi-1')
    superSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'sa-1' })
    botAdminSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'ba-1' })
  })

  test('bot-admin (non-SA) cannot add to the roster (403)', async () => {
    const url = new URL('https://x/settings/api/admin/admins')
    const res = await handleAdminRosterPluginsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(botAdminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'x', platformInstanceId: 'pi-1' }),
      }),
      url,
      '/settings/api/admin/admins',
    )
    expect(res.status).toBe(403)
  })

  test('super-admin adds to the roster', async () => {
    const url = new URL('https://x/settings/api/admin/admins')
    const res = await handleAdminRosterPluginsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(superSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'newadmin', platformInstanceId: 'pi-1' }),
      }),
      url,
      '/settings/api/admin/admins',
    )
    expect(res.status).toBe(200)
    expect(listAdmins().some((a) => a.userId === 'newadmin')).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/debug/settings/admin-roster-plugins-routes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the wrapper**

Create `src/debug/settings/admin/roster-plugins-routes.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { getChatRouter } from '../../../chat/router-singleton.js'
import { broadcastMessage } from '../../../commands/announce-broadcast.js'
import { addAdmin, listAdmins, removeAdmin } from '../../../instances/admin-store.js'
import { logger } from '../../../logger.js'
import { pluginRegistry } from '../../../plugins/registry.js'
import { getPluginAdminState, upsertPluginAdminState } from '../../../plugins/store.js'
import { requireScope } from '../../../settings/scope-guard.js'
import type { AuthenticatedSettingsRequest } from '../../../settings/request-auth.js'
import { authenticate, parseJsonBody, requireCsrf, settingsJson } from '../respond.js'

const log = logger.child({ scope: 'debug-server:settings-admin-roster' })

function guard(authed: AuthenticatedSettingsRequest, action: 'read' | 'write', superAdmin: boolean): Response | null {
  const result = requireScope(authed.principal, { action, target: { kind: 'admin', requireSuperAdmin: superAdmin } })
  return result.ok ? null : settingsJson(403, { error: 'forbidden' })
}

const AdminBodySchema = z.object({ userId: z.string().min(1), platformInstanceId: z.string().min(1) })

async function handleRoster(req: Request, authed: AuthenticatedSettingsRequest): Promise<Response> {
  if (req.method === 'GET') {
    const g = guard(authed, 'read', false)
    if (g !== null) return g
    return settingsJson(200, { admins: listAdmins() })
  }
  const g = guard(authed, 'write', true) // SA only
  if (g !== null) return g
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = AdminBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  if (req.method === 'POST') {
    addAdmin(body.data.userId, body.data.platformInstanceId)
    log.info({ platformInstanceId: body.data.platformInstanceId }, 'Settings SA added admin')
    return settingsJson(200, { ok: true })
  }
  if (req.method === 'DELETE') {
    removeAdmin(body.data.userId, body.data.platformInstanceId)
    return settingsJson(200, { ok: true })
  }
  return settingsJson(405, { error: 'method not allowed' })
}

const PluginActionSchema = z.object({ pluginId: z.string().min(1), action: z.enum(['approve', 'reject']) })

async function handlePluginApproval(req: Request, authed: AuthenticatedSettingsRequest): Promise<Response> {
  const g = guard(authed, 'write', true) // SA only
  if (g !== null) return g
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = PluginActionSchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  const entry = pluginRegistry.getEntry(body.data.pluginId)
  if (entry === undefined) return settingsJson(422, { error: 'unknown plugin' })

  if (body.data.action === 'approve') {
    upsertPluginAdminState(body.data.pluginId, 'approved', {
      approvedBy: authed.principal.platformUserId,
      approvedManifestHash: entry.discoveredPlugin.manifestHash,
    })
  } else {
    upsertPluginAdminState(body.data.pluginId, 'rejected', { approvedBy: null, approvedManifestHash: null })
  }
  log.info({ pluginId: body.data.pluginId, action: body.data.action }, 'Settings SA changed plugin approval')
  return settingsJson(200, { ok: true, state: getPluginAdminState(body.data.pluginId)?.state ?? null })
}

const AnnounceSchema = z.object({ message: z.string().min(1) })

async function handleAnnounce(req: Request, authed: AuthenticatedSettingsRequest): Promise<Response> {
  const g = guard(authed, 'write', false)
  if (g !== null) return g
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = AnnounceSchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  const chat = getChatRouter()
  if (chat === null) return settingsJson(422, { error: 'chat router not running' })
  const result = await broadcastMessage(chat, authed.principal.platformInstanceId, body.data.message)
  return settingsJson(200, result)
}

export async function handleAdminRosterPluginsRoutes(req: Request, _url: URL, pathname: string): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  if (pathname === '/settings/api/admin/admins') return handleRoster(req, auth.authed)
  if (pathname === '/settings/api/admin/plugin-approval') return handlePluginApproval(req, auth.authed)
  if (pathname === '/settings/api/admin/announce') return handleAnnounce(req, auth.authed)
  return settingsJson(404, { error: 'not found' })
}
```

> Verify the chat-router accessor: the announce route needs the live `ChatRouter` to send DMs. Search for how other non-command code obtains the router singleton (e.g. `grep -rn "ChatRouter" src/index.ts src/chat/`). If there is no `router-singleton.ts`, add a tiny accessor module (`setChatRouter`/`getChatRouter`) set during startup in `src/index.ts`, or thread the router into the settings router construction. Do NOT import a chat adapter directly. If wiring the router proves out of scope, split the announce route into its own follow-up task and keep roster + plugin-approval in this commit.
>
> Also confirm `getPluginAdminState` and `upsertPluginAdminState` are exported from `src/plugins/store.ts` (the explorer confirmed both). Plugin **config** admin view (`/admin/plugin-config` equivalent) can be added here later by wrapping `getAdminPluginConfigSnapshot`/`setPluginAdminConfig` from `src/debug/admin-plugin-config.ts`; it is lower priority than approval and may be deferred to the SPA plan if time-boxed.

- [ ] **Step 4: Add the dispatch branch**

In `src/debug/settings-api-router.ts`:

```typescript
import { handleAdminRosterPluginsRoutes } from './settings/admin/roster-plugins-routes.js'
```

```typescript
if (
  url.pathname === '/settings/api/admin/admins' ||
  url.pathname === '/settings/api/admin/plugin-approval' ||
  url.pathname === '/settings/api/admin/announce'
) {
  return handleAdminRosterPluginsRoutes(req, url, url.pathname)
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test tests/debug/settings/admin-roster-plugins-routes.test.ts`
Expected: PASS (2 tests). If the announce route's router wiring is deferred, also remove the announce dispatch branch and its test until the follow-up.

- [ ] **Step 6: Commit**

```bash
git add src/debug/settings/admin/roster-plugins-routes.ts src/debug/settings-api-router.ts tests/debug/settings/admin-roster-plugins-routes.test.ts
git commit -m "feat(settings): admin roster (SA) + plugin approval (SA) + announce wrappers"
```

---

## Task 15: Documentation + full verification

Document the new route family and run the full local check suite.

**Files:**

- Modify: `CLAUDE.md` (the `src/settings/` bullet under "Main Modules")

- [ ] **Step 1: Update `CLAUDE.md`**

In the `src/settings/` bullet under "Main Modules", append a sentence after the existing description of `src/debug/settings-routes.ts`:

```markdown
The per-capability data routes live under `/settings/api/*`, dispatched by
`src/debug/settings-api-router.ts` to handlers in `src/debug/settings/`
(`config-routes.ts`, `tools-routes.ts`, `mcp-routes.ts`, `plugins-routes.ts`,
`identity-routes.ts`, `provision-routes.ts`, `group-routes.ts`) and
`src/debug/settings/admin/*` for the bot-admin/super-admin wrappers. Every
handler authenticates the settings session, verifies the `X-Settings-CSRF`
header on writes, and resolves a validated `contextId` through `requireScope`
before delegating to the same stores the chat `/config` flow and the
`DEBUG_TOKEN`-gated `/api/*` + `/admin/*` handlers use. Admin routes are thin
wrappers (no settings cookie ever satisfies a `DEBUG_TOKEN` route).
```

- [ ] **Step 2: Run the full settings + debug test suites**

Run: `bun test tests/debug/settings/ tests/debug/settings-routes.test.ts tests/debug/settings-router.test.ts tests/commands/announce-broadcast.test.ts`
Expected: PASS (all new suites green).

- [ ] **Step 3: Run lint, typecheck, format, knip, duplicates**

Run: `bun typecheck && bun lint && bun format:check && bun knip && bun duplicates`
Expected: all pass. Fix any `max-lines`/`max-lines-per-function` violations by extracting helpers (do not game the limit). If `knip` flags an unused export (e.g. the temporary `methodNotAllowed` re-export from Task 2), remove it.

- [ ] **Step 4: Run the security scan**

Run: `bun security`
Expected: no new findings. The settings routes must never log codes/tokens/headers/free-form content — confirm no `log.*` call includes a secret value.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(settings): document the /settings/api route family"
```

---

## Self-Review

**Spec coverage (Part A):**

| Spec section                                                   | Task                          |
| -------------------------------------------------------------- | ----------------------------- |
| Bootstrap (`/settings/api/bootstrap`)                          | Task 3                        |
| User config GET/PATCH                                          | Task 4                        |
| Tools GET + toggle (computed available set)                    | Task 5                        |
| MCP GET/PUT (structured, schema-validated, cache-invalidating) | Task 6                        |
| Plugins GET/toggle/config                                      | Task 7                        |
| Identity GET/PUT/DELETE                                        | Task 8                        |
| Kaneo provision (one-time reveal, OQ-H3)                       | Task 9                        |
| Group members + group task-instance (OQ-H2: select only)       | Task 10                       |
| Admin platform/task instances + provider types                 | Task 12                       |
| Admin system/LLM + users + groups                              | Task 13                       |
| Admin roster (SA) + plugin approve/reject (SA) + announce      | Task 14                       |
| Error & masking contract (401/403/422, masked reads)           | every task (via `respond.ts`) |
| OQ-H1 (thin `/settings/api/admin/*` wrappers)                  | Tasks 12–14                   |

**Known open verification points the executor must confirm against live code (flagged inline):**

- Provider-type registry export names (`listPlatformProviderTypes` / `listTaskProviderTypes`) — Task 12.
- `maskConfig` default sensitive-key heuristic vs. an explicit `sensitiveKeys` set — Task 12.
- Chat-router singleton accessor for the announce route — Task 14 (may be deferred).
- `dmTarget` helper location — Task 11.

**Type consistency:** `resolveContextScope` returns `{ contextId, kind }` used uniformly; `requireScope` returns `{ ok, contextId }`; `authenticate` returns `{ ok, authed }`; `requireCsrf` returns `Response | null`. Handler signatures are consistent: context-scoped modules take `(req, url)` or `(req, url, pathname)`; admin modules take `(req, url, pathname)`. `settingsJson(status, body, extraHeaders?)` matches the existing private helper's argument order.

**No placeholders:** every code step contains complete, runnable code. Two intentional, clearly-labeled scaffolds exist: the Task 2 `config-routes.ts` stub (replaced wholesale in Task 4) and the deferrable announce-router wiring in Task 14 — both call out exactly what replaces them.
