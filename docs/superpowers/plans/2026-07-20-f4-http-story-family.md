<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# F4 HTTP-Surfaces Story Family Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make 6 `SCN-http-*` scenarios real (auth-claim, notify, transcript-viewer, admin-dashboard, billing-stats-readonly, debug-live-panels), moving the catalog ledger from 81 to 87 executable, reclassifying `http-mcp-plugin` F4→F7, with zero production `src/` changes.

**Architecture:** Five harness-only seams land first, each reviewed alone (rule 2): a `debugEnabled` world option threaded through `scenario()`, a `dashboard-auth` session vault cloned from the settings vault, a `notify_token` seed + cache reset, a fake-magi transcript responder, and a `given.publicBaseUrl` env seam. Then four story files grouped by trust domain. Then the ledger + totals update, a spec reconciliation, and a verification gate. Every route is driven in-process through `PapaiRuntime.request()` → `routeRequest` — no socket is bound.

**Tech Stack:** Bun, TypeScript (strict), bun:test.

**Spec:** `docs/superpowers/specs/2026-07-20-f4-http-story-family-design.md`

**Ledger after this plan:** 128 ids, 87 executable, 41 pending (1 `executable-as-is`, 18 `needs-seam`, 22 `blocked`). Story suite grows by 6 scenarios.

**Frozen-tree note:** this plan changes frozen inputs (harness `world.ts`, `scenario.ts`, `fixtures.ts`, `fake-magi.ts`, new harness helpers, catalog `coverage.ts`, and `tests/stories/commands/surface.story.test.ts`) plus `tests/utils/test-helpers.ts`. Re-record the compat baseline after landing. No `src/` file changes. Stories run sandboxed (`bun test:stories`, Docker required); contract files run via `bun test:stories:contracts`.

## Global Constraints

- Strict TypeScript; **use `.js` extension in import paths** (repo convention).
- **Never add lint-disable or type-ignore comments** — the write hook blocks them; fix the underlying issue.
- Error extraction: `error instanceof Error ? error.message : String(error)`.
- Prefer DI over module mocking. Harness DB access is "import the real `src/*` function" or a `getTestDb().insert(...)` helper in `tests/utils/test-helpers.ts` — there is no `world.db`.
- Every new file keeps the BUSL license header already present in its siblings (see any `tests/stories/harness/*.ts`).
- Markdown/TS are formatted by `oxfmt` (`bun run format`), not prettier. Run it before every commit that touches a formatted file.
- Roadmap rules: (2) each harness seam lands first and is reviewed independently; (3) no assertion-only stories — every scenario qualifies through a delivered reply, a durable change on a following turn, an authorization flip, or an exact proxied payload; (5) ledger updates ride in this PR; (6) reclassification records its rationale.

## Domain facts (verified against source) — read before writing any task

- **One in-process entry.** `world.ts:447-452` wires `web: { route: (request) => routeRequest(request, { debugEnabled: false, nowMs: clock.now().getTime(), pluginProviderRuntimeDeps }) }`; `startNetworkServer: false` (`world.ts:466`) means no socket. `PapaiRuntime.request(req)` → `routeRequest` — the same function production serves. `debugEnabled` is hardcoded `false` at `world.ts:449`.
- **World options are not threaded to stories.** `ScenarioWorldOptions` (`world.ts:96-100`) = `{ runtimeExtensions?, testHooks?, tempRoot? }`. `scenario()` (`scenario.ts:817-819`) always calls `executeScenario(name, run)`; the default factory (`scenario.ts:786-787`) passes only `{ tempRoot: guard?.tempRoot }`. Adding a story-reachable option requires editing all three layers.
- **HTTP request/response DSL.** `when.request(path, init?)` → `Response` via `scenarioUrl(path)` = `new URL(path, 'https://scenario.invalid')` (`scenario.ts:314, 684-687`). `when.settingsRequest(session, path, init?, {csrf?})` attaches the settings cookie/CSRF but `settingsUrl` **throws unless `path` is under `/settings`** (`scenario.ts:316-334`) — so `/admin`, `/stats`, `/debug`, `/api/notify`, `/auth/claim`, `/t/...` must use `when.request` (or the new `when.dashboardRequest`), never `when.settingsRequest`. `then.responseStatus(res, code)` traces through the event formatter (`scenario.ts:762-764`); response bodies are read raw via `await res.json()` (settings stories parse with a `zod` schema, e.g. `admin-surfaces.story.test.ts:213`).
- **Session vault pattern** (`fixtures.ts:81-130`): a private `Map<Handle, Secrets>` keyed by a frozen handle carrying a unique `owner` symbol; `parseExchange`/`buildHeaders`/`reset`/`revoke`. The vault is attached to the fixtures object (`fixtures.ts:245`), `reset()` in `setupDatabase` (`:248`), `revoke()` in `teardown` (`:240`). `createSettingsSession` (`scenario.ts:357-366`) issues a code, POSTs `/settings/auth/exchange`, and calls `parseExchange`.
- **Dashboard trust domain** (`src/dashboard-auth/index.ts`): `issueClaim(adminUserId, platformInstanceId): { nonce, expiresAt }` (`:48`), `consumeClaim(nonce)` (`:57`), `mintSession(adminUserId, { secure })` (`:68`), `authenticate(req)` reads the cookie (`:85`). Cookie name `dashboard_session`, `HttpOnly; SameSite=Strict; Path=/` (`cookie.ts:6,33-43`). `POST /auth/claim` (`auth-routes.ts:85-109`) reads form field `n`, consumes the claim, mints a session, and returns **`302` → `/debug` with `Set-Cookie`** (empty body). `/auth/claim` is mounted **before** both gates, so it needs no session. The runtime operator id is `ADMIN_USER_ID = 'scenario-admin'` (`world.ts:37`).
- **Dashboard/debug gating order** (`src/debug/server.ts`): the `debugEnabled` 404 gate runs **before** the `isAuthorizedRequest` (dashboard-cookie) 401 gate. So `/debug` with `debugEnabled:false` → 404; with `debugEnabled:true` and no dashboard cookie → 401; with both → 200. `/admin/*` and `/stats/*` are gated only by the dashboard cookie (401 without).
- **notify-token** (`src/notify-token.ts`): `getNotifyToken()` (`:35`) reads a **process-lifetime module cache** (`let cached`, `:16`), then the DB `systemConfig` row keyed `notify_token`, then env. `resetNotifyTokenCacheForTesting()` (`:51`) clears the cache. `setSystemConfig` (`src/system-config.ts:43`) **cannot** write `notify_token` (its `SystemConfigKey` union excludes it) — a direct `getTestDb().insert(schema.systemConfig)` helper is required. `POST /api/notify` needs `Authorization: Bearer <token>`; body `{ contextId, contextType?, threadId?, markdown }`; success delivers a real proactive `chat.sendMessage` and appends a `recordProactiveInHistory` row.
- **Transcript proxy** (`src/debug/transcript-viewer.ts`): `getViewerMagiConfig()` (`:17`) reads acp `magi_base_url`/`magi_token` — exactly what `given.codingSession` seeds via `setPluginAdminConfig('acp', …)` (`configure.ts:59-60`). `proxyTranscriptHistory` (`:28-56`) GETs `${base}/t/${encodeURIComponent(token)}/transcript`, forwards `Authorization: Bearer <magi_token>`, and **passes upstream status/body through verbatim**; returns `502` only on a thrown fetch, and the caller returns `503` when config is null (`:125-127`).
- **strict-http already drains.** `strict-http.ts` has `idle()` + in-flight tracking (F3 built it); `world.settle()` awaits `http.idle()` (`world.ts:554-557`). Outbound calls (the transcript proxy's fetch to fake-magi) go through the global-fetch patch → `world.http`, matched FIFO.
- **Assertion helper.** `tracedAssertion(world, () => expect(...))` (`scenario.ts:368-375`) wraps a sync assertion so failures carry the sanitized event trace. `given.*` methods call `prerequisite('given.<name>')` (asserts the world is unstarted); `when.*` call `world.events.setPhase('when.<name>')` then `ensureStarted()`.

## Refinements to reconcile into the spec (Task 11 rewrites these)

- The `then.responseJson` helper takes the **already-parsed body** (`then.responseJson(await res.json())`) and exposes traced `.contains()`/`.equals()` — `response.json()` is async, so the parse stays inline and only the assertion is traced.
- `notify-token-fixture` is realized as `resetNotifyTokenCacheForTesting()` **in `setupDatabase`** (unconditional per-scenario reset) plus a `given.notifyToken` seed — simpler and more robust than the spec's "setup + cleanup-coordinator dual reset" (there is no generic cleanup-registration API; the per-scenario `setupDatabase` reset defeats the module cache for both the seeded and the unconfigured case).
- `given.publicBaseUrl(url)` sets `SETTINGS_PUBLIC_BASE_URL` and restores it inside `fixtures.teardown` (which already runs as a cleanup step at `world.ts:343`), because `world` exposes no arbitrary teardown-callback registration.
- The dashboard session vault parses the cookie off the **`302`** claim response (not a `200` JSON exchange).

---

### Task 1: `debugEnabled` world option + `then.responseJson` helper

**Files:**

- Modify: `tests/stories/harness/world.ts` (`ScenarioWorldOptions`, the `web.route` literal)
- Modify: `tests/stories/harness/scenario.ts` (`ScenarioOptions`, `scenario`/`executeScenario` threading, `then.responseJson` + `ScenarioThen`)
- Test: `tests/stories/harness/scenario.test.ts`

**Interfaces:**

- Produces:
  - `ScenarioWorldOptions.debugEnabled?: boolean` (default `false`).
  - `scenario(name, run, options?: { debugEnabled?: boolean })` and `executeScenario(name, run, createWorld?, options?)`.
  - `then.responseJson(body: unknown): { contains(needle: string): void; equals(expected: unknown): void }`.

- [ ] **Step 1: Write the failing tests** — in `tests/stories/harness/scenario.test.ts`, add:

```ts
test('debugEnabled world option unlocks the debug-gated 404 → 401 boundary', async () => {
  await executeScenario('debug-gate-off', async ({ when, then }) => {
    then.responseStatus(await when.request('/debug'), 404)
  })
  await executeScenario(
    'debug-gate-on',
    async ({ when, then }) => {
      then.responseStatus(await when.request('/debug'), 401)
    },
    undefined,
    { debugEnabled: true },
  )
})

test('then.responseJson traces contains/equals assertions against a parsed body', async () => {
  await executeScenario('response-json', async ({ then }) => {
    then.responseJson({ principal: { display: 'bob' } }).contains('bob')
    then.responseJson({ ok: true }).equals({ ok: true })
  })
})
```

(`executeScenario` is already imported in this file. The 404→401 pair proves the option reaches `routeRequest`: `debugEnabled:false` 404s `/debug` at the debug gate; `debugEnabled:true` passes the debug gate and 401s at the dashboard-cookie gate.)

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/stories/harness/scenario.test.ts`
Expected: FAIL — `executeScenario` takes no 4th argument yet (the on-case still 404s), and `then.responseJson` is not a function.

- [ ] **Step 3: Add the world option** — in `tests/stories/harness/world.ts`, extend `ScenarioWorldOptions` (lines 96-100):

```ts
export type ScenarioWorldOptions = Readonly<{
  runtimeExtensions?: readonly ScenarioRuntimeExtension[]
  testHooks?: ScenarioWorldTestHooks
  tempRoot?: string
  debugEnabled?: boolean
}>
```

Then change the `web.route` literal (line 449) from `debugEnabled: false,` to:

```ts
                debugEnabled: options.debugEnabled ?? false,
```

- [ ] **Step 4: Thread the option through `scenario()`** — in `tests/stories/harness/scenario.ts`:

Add the options type near `WorldFactory` (line 264):

```ts
export type ScenarioOptions = Readonly<{ debugEnabled?: boolean }>
```

Change `executeScenario` (line 778) to accept and forward options — add the 4th parameter and merge it into the default factory (line 786-787):

```ts
export function executeScenario(
  name: string,
  run: (api: ScenarioApi) => void | Promise<void>,
  createWorld?: WorldFactory,
  options?: ScenarioOptions,
): Promise<void> {
  return runWithScenarioIoGuard(name, async (guard): Promise<void> => {
    const factory =
      createWorld ??
      ((scenarioName): Promise<ScenarioWorld> =>
        import('./world.js').then((module) =>
          module.createScenarioWorld(scenarioName, { tempRoot: guard?.tempRoot, debugEnabled: options?.debugEnabled }),
        ))
    // The try/run/verify/teardown body (scenario.ts:790-814) is unchanged — keep it verbatim.
```

Change `scenario()` (line 817-819) to pass options through:

```ts
export function scenario(
  name: string,
  run: (api: ScenarioApi) => void | Promise<void>,
  options?: ScenarioOptions,
): void {
  test(name, () => executeScenario(name, run, undefined, options))
}
```

- [ ] **Step 5: Add `then.responseJson`** — in `tests/stories/harness/scenario.ts`, add the assertion type near `ScenarioThen` (line 235) and the member (line 248-255):

```ts
type ResponseJsonAssertion = Readonly<{ contains(needle: string): void; equals(expected: unknown): void }>
```

Add to the `ScenarioThen` type:

```ts
  responseJson(body: unknown): ResponseJsonAssertion
```

Implement it in `createThen` (beside `responseStatus`, line 762):

```ts
      responseJson(body): ResponseJsonAssertion {
        return {
          contains: (needle) => tracedAssertion(world, () => expect(JSON.stringify(body)).toContain(needle)),
          equals: (expected) => tracedAssertion(world, () => expect(body).toEqual(expected)),
        }
      },
```

- [ ] **Step 6: Run to verify it passes**

Run: `bun test tests/stories/harness/scenario.test.ts`
Expected: PASS (all existing cases plus the two new ones).

- [ ] **Step 7: Format, typecheck, lint, commit**

```bash
bun run format && bun run typecheck && bun run lint
git add tests/stories/harness/world.ts tests/stories/harness/scenario.ts tests/stories/harness/scenario.test.ts
git commit -m "test(stories): thread a debugEnabled world option and a traced responseJson helper"
```

---

### Task 2: `dashboard-auth` session vault

**Files:**

- Modify: `tests/stories/harness/world.ts` (export `ADMIN_USER_ID`)
- Modify: `tests/stories/harness/fixtures.ts` (dashboard vault, `ScenarioFixtures` member, attach/reset/revoke)
- Modify: `tests/stories/harness/scenario.ts` (`given.dashboardSession`, `when.dashboardRequest` + types)
- Test: `tests/stories/harness/scenario.test.ts`

**Interfaces:**

- Consumes: `issueClaim` (`src/dashboard-auth/index.js`), `SESSION_COOKIE_NAME` (`src/dashboard-auth/cookie.js`), `ADMIN_USER_ID` (`world.ts`), `SCENARIO_PLATFORM_INSTANCE_ID` (`fixtures.ts`).
- Produces:
  - `DashboardSessionHandle` (opaque, brand-symbol owned).
  - `ScenarioFixtures.dashboardSessions: DashboardSessionVault` with `parseClaim(response) → Promise<DashboardSessionHandle>`, `buildHeaders(session, initial?) → Headers`, `reset()`, `revoke()`.
  - `given.dashboardSession(): Promise<DashboardSessionHandle>` and `when.dashboardRequest(session, path, init?): Promise<Response>`.

- [ ] **Step 1: Write the failing contract test** — in `tests/stories/harness/scenario.test.ts`:

```ts
test('given.dashboardSession authorizes a dashboard-gated route that rejects anonymous callers', async () => {
  await executeScenario('dashboard-session', async ({ given, when, then }) => {
    const anon = await when.request('/admin/identity/mappings')
    then.responseStatus(anon, 401)
    const session = await given.dashboardSession()
    const authorized = await when.dashboardRequest(session, '/admin/identity/mappings')
    then.responseStatus(authorized, 200)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/stories/harness/scenario.test.ts`
Expected: FAIL — `given.dashboardSession is not a function`.

- [ ] **Step 3: Export the operator id** — in `tests/stories/harness/world.ts`, change line 37 from `const ADMIN_USER_ID = 'scenario-admin'` to:

```ts
export const ADMIN_USER_ID = 'scenario-admin'
```

- [ ] **Step 4: Add the dashboard vault** — in `tests/stories/harness/fixtures.ts`, mirror `createSettingsSessionVault` (81-130). Add near it:

```ts
const dashboardSessionOwner: unique symbol = Symbol('scenario-dashboard-session-owner')

export type DashboardSessionHandle = Readonly<{
  kind: 'dashboard-session'
  readonly [dashboardSessionOwner]: object
}>

export type DashboardSessionVault = Readonly<{
  parseClaim(response: Response): Promise<DashboardSessionHandle>
  buildHeaders(session: DashboardSessionHandle, initial?: HeadersInit): Headers
  reset(): void
  revoke(): void
}>

export function createDashboardSessionVault(): DashboardSessionVault {
  const owner = Object.freeze({})
  const cookies = new Map<DashboardSessionHandle, string>()
  let active = true

  const resolve = (session: DashboardSessionHandle): string => {
    if (!active) throw new Error('Scenario dashboard sessions are no longer active')
    if (typeof session !== 'object' || session === null || !Object.hasOwn(session, dashboardSessionOwner)) {
      throw new Error('Unknown dashboard session handle')
    }
    if (session[dashboardSessionOwner] !== owner) {
      throw new Error('Dashboard session handle belongs to a different scenario world')
    }
    const stored = cookies.get(session)
    if (stored === undefined) throw new Error('Unknown dashboard session handle')
    return stored
  }

  return {
    async parseClaim(response): Promise<DashboardSessionHandle> {
      if (!active) throw new Error('Scenario dashboard sessions are no longer active')
      if (response.status !== 302) throw new Error(`Dashboard claim failed with status ${response.status}`)
      const cookie = extractDashboardCookie(response.headers.get('Set-Cookie'))
      const handle: DashboardSessionHandle = Object.freeze({
        kind: 'dashboard-session',
        [dashboardSessionOwner]: owner,
      })
      cookies.set(handle, cookie)
      return handle
    },
    buildHeaders(session, initial): Headers {
      const cookie = resolve(session)
      const headers = new Headers(initial)
      headers.set('Cookie', `${DASHBOARD_SESSION_COOKIE_NAME}=${cookie}`)
      return headers
    },
    reset(): void {
      cookies.clear()
      active = true
    },
    revoke(): void {
      cookies.clear()
      active = false
    },
  }
}
```

Add the cookie-extraction helper (mirror the existing `extractSessionCookie` at `fixtures.ts:62-69`, but keyed to `dashboard_session`) and import the cookie name:

```ts
import { SESSION_COOKIE_NAME as DASHBOARD_SESSION_COOKIE_NAME } from '../../../src/dashboard-auth/cookie.js'

function extractDashboardCookie(setCookie: string | null): string {
  if (setCookie === null) throw new Error('Dashboard claim response had no Set-Cookie header')
  const match = new RegExp(`${DASHBOARD_SESSION_COOKIE_NAME}=([^;]+)`, 'u').exec(setCookie)
  if (match?.[1] === undefined) throw new Error('Dashboard claim response did not set a dashboard_session cookie')
  return match[1]
}
```

- [ ] **Step 5: Attach the vault to `ScenarioFixtures`** — in `fixtures.ts`, add to the `ScenarioFixtures` type (beside `settingsSessions`, line 177):

```ts
dashboardSessions: DashboardSessionVault
```

Construct it in `createScenarioFixtures` (beside line 230):

```ts
const dashboardSessions = createDashboardSessionVault()
```

Expose it on the returned object (beside line 245 `settingsSessions,`): add `dashboardSessions,`. Reset it in `setupDatabase` (after line 248 `settingsSessions.reset()`): add `dashboardSessions.reset()`. Revoke it in `teardown` (after line 240 `settingsSessions.revoke()`): add `dashboardSessions.revoke()`.

- [ ] **Step 6: Add the DSL** — in `tests/stories/harness/scenario.ts`:

Import the claim issuer, operator id, and handle type:

```ts
import { issueClaim } from '../../../src/dashboard-auth/index.js'
import { ADMIN_USER_ID } from './world.js'
import type { DashboardSessionHandle } from './fixtures.js'
```

Add a `createDashboardSession` helper (beside `createSettingsSession`, line 357):

```ts
async function createDashboardSession(world: ScenarioWorld): Promise<DashboardSessionHandle> {
  const claim = issueClaim(ADMIN_USER_ID, SCENARIO_PLATFORM_INSTANCE_ID)
  const response = await runtimeRequest(world, '/auth/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ n: claim.nonce }).toString(),
  })
  return world.fixtures.dashboardSessions.parseClaim(response)
}
```

Add to `ScenarioGiven` (line 108-208) and `createGiven` (return object):

```ts
    dashboardSession(): Promise<DashboardSessionHandle> {
      prerequisite('given.dashboardSession')
      return createDashboardSession(world)
    },
```

Add to `ScenarioWhen` (line 210-233) and `createWhen`:

```ts
    dashboardRequest(session, path, init): Promise<Response> {
      world.events.setPhase('when.dashboardRequest')
      const headers = world.fixtures.dashboardSessions.buildHeaders(session, init?.headers)
      return runtimeRequest(world, path, { ...init, headers })
    },
```

Type members: `dashboardSession(): Promise<DashboardSessionHandle>` in `ScenarioGiven`; `dashboardRequest(session: DashboardSessionHandle, path: string, init?: RequestInit): Promise<Response>` in `ScenarioWhen`. `SCENARIO_PLATFORM_INSTANCE_ID` is already imported in `scenario.ts` (used by `given.user`); if not, import it from `./fixtures.js`.

Note: `runtimeRequest` with no `settingsAuth` uses `scenarioUrl(path)` (any path) — `/auth/claim` and `/admin/*` resolve to `https://scenario.invalid/...`. The `302` claim response is returned as-is (no redirect following on the inbound path).

- [ ] **Step 7: Run to verify it passes**

Run: `bun test tests/stories/harness/scenario.test.ts`
Expected: PASS. If `/admin/identity/mappings` 404s instead of 200, confirm the exact admin route path against `src/debug/server.ts` `routeAdminPaths` and adjust the test's path (this is the only route-name assumption in the seam test).

- [ ] **Step 8: Format, typecheck, lint, commit**

```bash
bun run format && bun run typecheck && bun run lint
git add tests/stories/harness/world.ts tests/stories/harness/fixtures.ts tests/stories/harness/scenario.ts tests/stories/harness/scenario.test.ts
git commit -m "test(stories): add a dashboard-auth session fixture"
```

---

### Task 3: `notify_token` seed fixture + cache reset

**Files:**

- Modify: `tests/utils/test-helpers.ts` (`seedTestSystemConfig`)
- Modify: `tests/stories/harness/fixtures.ts` (`setupDatabase` reset, `seedNotifyToken`, type)
- Modify: `tests/stories/harness/scenario.ts` (`given.notifyToken`)
- Test: `tests/stories/harness/scenario.test.ts`

**Interfaces:**

- Consumes: `getTestDb()`, `schema` (`tests/utils/test-helpers.ts`); `getNotifyToken`, `resetNotifyTokenCacheForTesting` (`src/notify-token.js`).
- Produces: `seedTestSystemConfig({ key, value })`; `ScenarioFixtures.seedNotifyToken(token: string): void`; `given.notifyToken(token: string): void`.

- [ ] **Step 1: Write the failing contract test** — in `tests/stories/harness/scenario.test.ts`:

```ts
import { getNotifyToken } from '../../../src/notify-token.js'

test('given.notifyToken seeds a token isolated per scenario despite the module cache', async () => {
  await executeScenario('notify-token-a', async ({ given }) => {
    given.notifyToken('token-alpha')
    expect(getNotifyToken()).toBe('token-alpha')
  })
  // A later scenario in the same worker must not see the previous cached token.
  await executeScenario('notify-token-b', async () => {
    expect(getNotifyToken()).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/stories/harness/scenario.test.ts`
Expected: FAIL — `given.notifyToken is not a function`; and (proving the cache hazard) without the `setupDatabase` reset, `notify-token-b` would read `token-alpha`.

- [ ] **Step 3: Add the direct system-config seed helper** — in `tests/utils/test-helpers.ts`, mirror `seedTestPlatformInstance` (218-229):

```ts
export function seedTestSystemConfig(input: { key: string; value: string }): void {
  getTestDb()
    .insert(schema.systemConfig)
    .values({ key: input.key, value: input.value, updatedAt: Date.now(), updatedBy: 'scenario' })
    .onConflictDoUpdate({ target: schema.systemConfig.key, set: { value: input.value, updatedAt: Date.now() } })
    .run()
}
```

(`notify_token` is a valid row in the `systemConfig` table but is not in production's `SystemConfigKey` union, so this direct insert — not `setSystemConfig` — is the seam. If drizzle narrows the `key` column type, keep the parameter as `string` and let the insert widen; do not add a type-ignore.)

- [ ] **Step 4: Reset the module cache per scenario** — in `tests/stories/harness/fixtures.ts`, import the reset and add it to `setupDatabase` (after line 250 `resetSystemConfigCacheForTesting()`):

```ts
import { resetNotifyTokenCacheForTesting } from '../../../src/notify-token.js'
// inside setupDatabase, after resetSystemConfigCacheForTesting():
resetNotifyTokenCacheForTesting()
```

Add the seed method and its type member:

```ts
// ScenarioFixtures type:
  seedNotifyToken(token: string): void
// factory return object:
    seedNotifyToken(token): void {
      seedTestSystemConfig({ key: 'notify_token', value: token })
    },
```

Import `seedTestSystemConfig` alongside the other `seedTest*` imports.

- [ ] **Step 5: Add the DSL** — in `tests/stories/harness/scenario.ts`, add to `ScenarioGiven` and `createGiven`:

```ts
    notifyToken(token): void {
      prerequisite('given.notifyToken')
      world.fixtures.seedNotifyToken(token)
    },
```

Type member: `notifyToken(token: string): void`.

- [ ] **Step 6: Run to verify it passes**

Run: `bun test tests/stories/harness/scenario.test.ts`
Expected: PASS — `notify-token-a` reads `token-alpha`; `notify-token-b` reads `null` (the `setupDatabase` reset cleared the cache).

- [ ] **Step 7: Format, typecheck, lint, commit**

```bash
bun run format && bun run typecheck && bun run lint
git add tests/utils/test-helpers.ts tests/stories/harness/fixtures.ts tests/stories/harness/scenario.ts tests/stories/harness/scenario.test.ts
git commit -m "test(stories): add a seedable notify-token fixture with per-scenario cache reset"
```

---

### Task 4: fake-magi transcript responder

**Files:**

- Modify: `tests/stories/harness/fake-magi.ts` (`FakeMagi` type + `expectTranscriptHistory`)
- Test: `tests/stories/harness/fake-magi.test.ts`

**Interfaces:**

- Produces: `FakeMagi.expectTranscriptHistory(token: string, body: unknown, response?: FakeMagiResponse): void` — declares `GET {baseUrl}/t/{token}/transcript`, asserts the `Bearer <token>` auth, returns `body` as JSON.

- [ ] **Step 1: Write the failing test** — in `tests/stories/harness/fake-magi.test.ts`, mirroring the existing `expectSession`-style tests:

```ts
test('expectTranscriptHistory serves declared bytes to an authorized transcript proxy', async () => {
  const events = createScenarioEvents('transcript')
  const http = createStrictHttpDispatcher(events)
  const magi = createFakeMagi({ http, events, baseUrl: 'https://magi.invalid', token: 'magi-secret' })
  magi.expectTranscriptHistory('viewer-token', { turns: [{ role: 'assistant', text: 'build is green' }] })

  const response = await http.fetch('https://magi.invalid/t/viewer-token/transcript', {
    headers: { Authorization: 'Bearer magi-secret', Accept: 'application/json' },
  })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ turns: [{ role: 'assistant', text: 'build is green' }] })
  expect(() => magi.verifyConsumed()).not.toThrow()
})
```

(Use the file's existing imports for `createScenarioEvents`, `createStrictHttpDispatcher`, `createFakeMagi`; add any missing.)

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/stories/harness/fake-magi.test.ts`
Expected: FAIL — `magi.expectTranscriptHistory is not a function`.

- [ ] **Step 3: Implement the method** — in `tests/stories/harness/fake-magi.ts`, add to the `FakeMagi` type (beside the other `expect*` members, line 121-137):

```ts
  expectTranscriptHistory(token: string, body: unknown, response?: FakeMagiResponse): void
```

Add the method to `createFakeMagi` (beside `expectSession`, mirroring it):

```ts
    expectTranscriptHistory(token, body, expectedResponse): void {
      options.http.expect(
        { method: 'GET', url: `${baseUrl}/t/${encodeURIComponent(token)}/transcript` },
        async (request) => {
          authorized(request)
          const response = resolveResponse(expectedResponse, body, 200)
          recordEvent(options.events, 'magi.transcript', { token, status: response.status })
          return jsonResponse(response.body, response.status)
        },
      )
    },
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/stories/harness/fake-magi.test.ts`
Expected: PASS.

- [ ] **Step 5: Format, typecheck, lint, commit**

```bash
bun run format && bun run typecheck && bun run lint
git add tests/stories/harness/fake-magi.ts tests/stories/harness/fake-magi.test.ts
git commit -m "test(stories): serve transcript bytes from the fake magi"
```

---

### Task 5: `given.publicBaseUrl` env seam (replaces the commands one-off)

**Files:**

- Modify: `tests/stories/harness/fixtures.ts` (`setPublicBaseUrl` + teardown restore + type)
- Modify: `tests/stories/harness/scenario.ts` (`given.publicBaseUrl`)
- Modify: `tests/stories/commands/surface.story.test.ts` (use the seam)
- Test: `tests/stories/harness/scenario.test.ts`

**Interfaces:**

- Produces: `ScenarioFixtures.setPublicBaseUrl(url: string): void` (restored in `teardown`); `given.publicBaseUrl(url: string): void`.

- [ ] **Step 1: Write the failing test** — in `tests/stories/harness/scenario.test.ts`:

```ts
test('given.publicBaseUrl sets and restores SETTINGS_PUBLIC_BASE_URL around the scenario', async () => {
  expect(process.env['SETTINGS_PUBLIC_BASE_URL']).toBeUndefined()
  await executeScenario('public-base-url', async ({ given }) => {
    given.publicBaseUrl('https://settings.example')
    expect(process.env['SETTINGS_PUBLIC_BASE_URL']).toBe('https://settings.example')
  })
  expect(process.env['SETTINGS_PUBLIC_BASE_URL']).toBeUndefined()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/stories/harness/scenario.test.ts`
Expected: FAIL — `given.publicBaseUrl is not a function`.

- [ ] **Step 3: Add the fixture method + restore** — in `tests/stories/harness/fixtures.ts`, inside `createScenarioFixtures`, track the prior value and set/restore it. Near the top of the factory (beside `let nextInstructionId = 0`, line 231):

```ts
let priorPublicBaseUrl: string | undefined
let publicBaseUrlOverridden = false
```

Fold the restore into the existing `teardown` closure (lines 238-241):

```ts
const teardown = (): void => {
  teardownRegistries()
  settingsSessions.revoke()
  dashboardSessions.revoke()
  if (publicBaseUrlOverridden) {
    if (priorPublicBaseUrl === undefined) Reflect.deleteProperty(process.env, 'SETTINGS_PUBLIC_BASE_URL')
    else process.env['SETTINGS_PUBLIC_BASE_URL'] = priorPublicBaseUrl
    publicBaseUrlOverridden = false
  }
}
```

Add the method + its type member:

```ts
// ScenarioFixtures type:
  setPublicBaseUrl(url: string): void
// factory return object:
    setPublicBaseUrl(url): void {
      if (!publicBaseUrlOverridden) {
        priorPublicBaseUrl = process.env['SETTINGS_PUBLIC_BASE_URL']
        publicBaseUrlOverridden = true
      }
      process.env['SETTINGS_PUBLIC_BASE_URL'] = url
    },
```

(`teardown` runs as the `world.cleanup.provider.unregister` step at `world.ts:343`, before the I/O guard's env check at `executeScenario` teardown — so the net env mutation is zero.)

- [ ] **Step 4: Add the DSL** — in `tests/stories/harness/scenario.ts`, add to `ScenarioGiven` and `createGiven`:

```ts
    publicBaseUrl(url): void {
      prerequisite('given.publicBaseUrl')
      world.fixtures.setPublicBaseUrl(url)
    },
```

Type member: `publicBaseUrl(url: string): void`.

- [ ] **Step 5: Retire the commands one-off** — in `tests/stories/commands/surface.story.test.ts`, replace the manual env juggling (lines 66-71) so the scenario body becomes:

```ts
const alice = given.user('alice')
const dm = given.dm(alice)
given.publicBaseUrl(SETTINGS_BASE_URL)
await when.message(alice, dm, '/config')

then.replyTo(alice).contains('Open your settings:')
then.replyTo(alice).contains(SETTINGS_BASE_URL)
then.replyTo(alice).contains('single-use and expires in 10 minutes')
```

(`given.publicBaseUrl` runs while the world is unstarted, before `/config` reads the env at dispatch. Remove the now-unused `try`/`finally` and `Reflect.deleteProperty`.)

- [ ] **Step 6: Run both the contract test and the commands story**

Run: `bun test tests/stories/harness/scenario.test.ts`
Run: `bun test:stories 2>&1 | grep -iE "cmd-config-dm|fail|pass"`
Expected: both PASS; `SCN-cmd-config-dm` still asserts the settings link with no env leak (the I/O guard would fail an unrestored mutation).

- [ ] **Step 7: Format, typecheck, lint, commit**

```bash
bun run format && bun run typecheck && bun run lint
git add tests/stories/harness/fixtures.ts tests/stories/harness/scenario.ts tests/stories/commands/surface.story.test.ts tests/stories/harness/scenario.test.ts
git commit -m "test(stories): add a given.publicBaseUrl seam and retire the env one-off"
```

---

### Task 6: auth-claim story (settings domain, 1 scenario)

**Files:**

- Create: `tests/stories/http/auth-claim.story.test.ts`

- [ ] **Step 1: Write the scenario**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { scenario } from '../harness/scenario.js'

scenario(
  'SCN-http-auth-claim: a single-use code exchanges for a session that authorizes reads',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const session = await given.settingsSession(alice)

    // The minted session authorizes an authenticated settings read; anonymous callers are rejected.
    const authorized = await when.settingsRequest(session, '/settings/api/bootstrap')
    then.responseStatus(authorized, 200)
    const anonymous = await when.request('/settings/api/bootstrap')
    then.responseStatus(anonymous, 401)

    // A code cannot be replayed: the first exchange succeeds, the second is rejected.
    const principal = { platformInstanceId: alice.platformInstanceId, platformUserId: alice.id }
    const code = world.fixtures.issueSettingsAuthCode(principal, world.clock.now().getTime())
    const first = await when.request('/settings/auth/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    then.responseStatus(first, 200)
    then.responseJson(await first.json()).contains('csrfToken')
    const replay = await when.request('/settings/auth/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    then.responseStatus(replay, 401)
  },
)
```

- [ ] **Step 2: Run the story sandboxed**

Run: `bun test:stories 2>&1 | grep -iE "auth-claim|fail|pass"`
Expected: PASS. Diagnosis: if `/settings/api/bootstrap` is not the authenticated read path, substitute `/settings/api/session` (confirm against `src/debug/settings-router.ts`); the 200-with-cookie vs 401-anonymous contrast is the invariant, not the exact path. `then.responseJson(await first.json()).contains('csrfToken')` confirms the exchange body shape `{ csrfToken, display, principal, contexts }`.

- [ ] **Step 3: Format, typecheck, lint, commit**

```bash
bun run format && bun run typecheck && bun run lint
git add tests/stories/http/auth-claim.story.test.ts
git commit -m "test(stories): observe the settings auth-claim exchange as a first-class subject"
```

---

### Task 7: dashboard story (dashboard domain, 3 scenarios)

**Files:**

- Create: `tests/stories/http/dashboard.story.test.ts`

- [ ] **Step 1: Write the three scenarios**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { scenario } from '../harness/scenario.js'

scenario(
  'SCN-http-admin-dashboard: the dashboard session authorizes admin reads that reject anonymous callers',
  async ({ given, when, then }) => {
    const alice = given.user('alice')
    given.identity(alice, { providerUserId: 'u-42', login: 'alice-dev', displayName: 'Alice Dev' })

    const anonymous = await when.request('/admin/identity/mappings')
    then.responseStatus(anonymous, 401)

    const session = await given.dashboardSession()
    const mappings = await when.dashboardRequest(session, '/admin/identity/mappings')
    then.responseStatus(mappings, 200)
    then.responseJson(await mappings.json()).contains('alice-dev')
  },
)

scenario(
  'SCN-http-billing-stats-readonly: the dashboard session reads stats that reject anonymous callers',
  async ({ given, when, then }) => {
    const session = await given.dashboardSession()

    const anonymous = await when.request('/stats/global')
    then.responseStatus(anonymous, 401)

    const stats = await when.dashboardRequest(session, '/stats/global?window=7d')
    then.responseStatus(stats, 200)
    then.responseJson(await stats.json()).contains('7d')

    const badWindow = await when.dashboardRequest(session, '/stats/global?window=not-a-window')
    then.responseStatus(badWindow, 400)
  },
)

scenario(
  'SCN-http-debug-live-panels: debug panels require both the world flag and the dashboard session',
  async ({ given, when, then }) => {
    // debugEnabled:true (3rd arg) passes the debug gate; the dashboard gate still applies.
    const noSession = await when.request('/debug')
    then.responseStatus(noSession, 401)

    const session = await given.dashboardSession()
    const panel = await when.dashboardRequest(session, '/debug')
    then.responseStatus(panel, 200)
  },
  { debugEnabled: true },
)
```

- [ ] **Step 2: Run the story sandboxed**

Run: `bun test:stories 2>&1 | grep -iE "admin-dashboard|billing-stats|debug-live|fail|pass"`
Expected: the three scenarios PASS.

- [ ] **Step 3: Diagnose real failures** — resolve exact route names/response shapes against `src/debug/server.ts` (`routeAdminPaths`, `routeProtectedPaths`) and `src/debug/stats-routes.ts`: (a) if `/admin/identity/mappings` does not echo the login, assert on whatever identity field the response carries (keep a real seeded token, not a bare 200); (b) confirm the stats window query param name and the 400-on-unknown-window branch (`stats-routes.ts`), adjusting `window=7d`/`not-a-window` to the real contract; (c) if `/debug` with a session returns HTML rather than 200 JSON, keep `then.responseStatus(panel, 200)` and drop any body assertion — the 404 (Task 1 test) → 401 (no session) → 200 (session) gate flips are the rule-3 authorization proof. Do not weaken any assertion to a bare 200 without a companion flip.

- [ ] **Step 4: Format, typecheck, lint, commit**

```bash
bun run format && bun run typecheck && bun run lint
git add tests/stories/http/dashboard.story.test.ts
git commit -m "test(stories): cover the dashboard trust domain (admin, stats, debug)"
```

---

### Task 8: notify story (token domain, 1 scenario)

**Files:**

- Create: `tests/stories/http/notify.story.test.ts`

- [ ] **Step 1: Write the scenario**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { scenario } from '../harness/scenario.js'

scenario('SCN-http-notify: an authorized notify delivers a proactive message', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  given.notifyToken('notify-secret')
  const contextId = world.scopedStorageContextId(dm)

  const body = JSON.stringify({ contextId, contextType: 'dm', markdown: 'Your build finished: **green**.' })

  // Wrong bearer is rejected before any delivery.
  const unauthorized = await when.request('/api/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong-token' },
    body,
  })
  then.responseStatus(unauthorized, 401)

  // Authorized notify delivers a real proactive message captured by the scenario chat.
  const delivered = await when.request('/api/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer notify-secret' },
    body,
  })
  then.responseStatus(delivered, 200)
  then.replyTo(alice).contains('build finished')
})
```

- [ ] **Step 2: Run the story sandboxed**

Run: `bun test:stories 2>&1 | grep -iE "http-notify|fail|pass"`
Expected: PASS.

- [ ] **Step 3: Diagnose real failures** — the notify route resolves `contextId` → platform instance via `resolveDeliveryPlatformInstanceId`; if it returns 404, the DM context needs a platform-instance mapping — seed it (e.g. `given.assign(dm, given.taskInstance())` or the default platform-instance seed) and use `world.scopedStorageContextId(dm)` as `contextId`. If the proactive send is not captured by `then.replyTo(alice)`, assert via `then.replyIn(dm).contains('build finished')` (the delivery target is the dm context; `chat.ts:244-249` records it as `kind:'proactive'`). Keep the delivered-message assertion — a bare 200 is not acceptable (rule 3).

- [ ] **Step 4: Format, typecheck, lint, commit**

```bash
bun run format && bun run typecheck && bun run lint
git add tests/stories/http/notify.story.test.ts
git commit -m "test(stories): deliver a proactive message through the notify route"
```

---

### Task 9: transcript-viewer story (proxy domain, 1 scenario)

**Files:**

- Create: `tests/stories/http/transcript-viewer.story.test.ts`

- [ ] **Step 1: Write the scenario**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createFakeMagi } from '../harness/fake-magi.js'
import { scenario } from '../harness/scenario.js'

const MAGI_URL = 'https://magi.invalid'
const MAGI_TOKEN = 'magi-secret'

scenario(
  'SCN-http-transcript-viewer: the viewer proxies transcript bytes from magi',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const group = given.group('team')
    given.member(group, alice)

    // Before magi config exists, the transcript route reports "not configured".
    const unconfigured = await when.request('/t/viewer-token/transcript')
    then.responseStatus(unconfigured, 503)

    // Seed acp magi config (what getViewerMagiConfig reads) and declare the upstream response.
    given.codingSession({
      pluginDirectory: 'plugins',
      context: group,
      magiBaseUrl: MAGI_URL,
      magiToken: MAGI_TOKEN,
      updatedBy: 'scenario-admin',
    })
    const magi = createFakeMagi({ http: world.http, events: world.events, baseUrl: MAGI_URL, token: MAGI_TOKEN })
    magi.expectTranscriptHistory('viewer-token', { turns: [{ role: 'assistant', text: 'deploy succeeded' }] })

    const proxied = await when.request('/t/viewer-token/transcript')
    then.responseStatus(proxied, 200)
    then.responseJson(await proxied.json()).equals({ turns: [{ role: 'assistant', text: 'deploy succeeded' }] })
  },
)
```

- [ ] **Step 2: Run the story sandboxed**

Run: `bun test:stories 2>&1 | grep -iE "transcript-viewer|fail|pass"`
Expected: PASS. The upstream `Authorization: Bearer magi-secret` is enforced by fake-magi's `authorized(request)`, and the client body equals the served bytes verbatim (`proxyTranscriptHistory` passes upstream through). Note: this scenario is story-mode-only — the proxy's `fetchImpl` defaults to the global fetch that `bun test:stories` patches to `world.http`; it is not exercised under `--contracts`.

- [ ] **Step 3: Diagnose real failures** — if the pre-config request does not 503, confirm `given.codingSession` has not already run (it must be seeded after the 503 check). If the proxied fetch is undeclared, confirm `MAGI_URL`/token match between `given.codingSession` and `createFakeMagi`, and that `expectTranscriptHistory` is declared before the request (strict-http is FIFO).

- [ ] **Step 4: Format, typecheck, lint, commit**

```bash
bun run format && bun run typecheck && bun run lint
git add tests/stories/http/transcript-viewer.story.test.ts
git commit -m "test(stories): proxy transcript bytes through the viewer route"
```

---

### Task 10: Ledger + totals update

**Files:**

- Modify: `tests/stories/catalog/coverage.ts` (`EXECUTABLE_STORY_MAPPINGS`, `AUDIT_RECORDS`, `GAP_SCENARIO_IDS`)
- Modify: `tests/stories/harness/catalog-coverage.test.ts` (counts + family-queue override)
- Modify: `tests/scripts/story-coverage-totals.test.ts` (totals)

**Interfaces:**

- Consumes: story ids exactly as they appear in the four new files (`<relative path>#<scenario name>`).

- [ ] **Step 1: Update the failing contract totals first** — in `tests/stories/harness/catalog-coverage.test.ts`: line 196 `toHaveLength(81)` → `87`; line 232 `toHaveLength(47)` → `41`; line 261 `executable-as-is` `toHaveLength(2)` → `1`; line 262 `needs-seam` `toHaveLength(23)` → `18` (line 263 `blocked` stays `22`). Add a family-queue override so `http-mcp-plugin` maps to F7 while `http-mattermost-action` stays F4 — in `FAMILY_QUEUE_EXPECTATIONS` (line 76-93), insert **before** `['SCN-http-', 'F4']` (line 85):

```ts
  ['SCN-http-mcp-plugin', 'F7'],
```

In `tests/scripts/story-coverage-totals.test.ts` (lines 12-22), change `executable: 81` → `87`, `pending: 47` → `41`, `readiness: { 'executable-as-is': 1, 'needs-seam': 18, blocked: 22 }`, and the formatted line to:

```ts
'story catalog: 87/128 executable; pending 41 (1 executable-as-is, 18 needs-seam, 22 blocked)',
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test:stories:contracts 2>&1 | grep -iE "coverage|totals|fail"`
Expected: FAIL — mapping/audit counts don't match yet.

- [ ] **Step 3: Move the 6 entries to `EXECUTABLE_STORY_MAPPINGS`** — add (each `verifiedAt: '2026-07-20'`, `storyIds` matching the exact scenario names):

```ts
  'SCN-http-auth-claim': { verifiedAt: '2026-07-20', storyIds: ['tests/stories/http/auth-claim.story.test.ts#SCN-http-auth-claim: a single-use code exchanges for a session that authorizes reads'] },
  'SCN-http-admin-dashboard': { verifiedAt: '2026-07-20', storyIds: ['tests/stories/http/dashboard.story.test.ts#SCN-http-admin-dashboard: the dashboard session authorizes admin reads that reject anonymous callers'] },
  'SCN-http-billing-stats-readonly': { verifiedAt: '2026-07-20', storyIds: ['tests/stories/http/dashboard.story.test.ts#SCN-http-billing-stats-readonly: the dashboard session reads stats that reject anonymous callers'] },
  'SCN-http-debug-live-panels': { verifiedAt: '2026-07-20', storyIds: ['tests/stories/http/dashboard.story.test.ts#SCN-http-debug-live-panels: debug panels require both the world flag and the dashboard session'] },
  'SCN-http-notify': { verifiedAt: '2026-07-20', storyIds: ['tests/stories/http/notify.story.test.ts#SCN-http-notify: an authorized notify delivers a proactive message'] },
  'SCN-http-transcript-viewer': { verifiedAt: '2026-07-20', storyIds: ['tests/stories/http/transcript-viewer.story.test.ts#SCN-http-transcript-viewer: the viewer proxies transcript bytes from magi'] },
```

Delete those 6 keys from `AUDIT_RECORDS` (the `F4` `needs(...)`/`ready(...)` block). Remove `'SCN-http-transcript-viewer'` from `GAP_SCENARIO_IDS` (line 217) so its executable entry resolves to `confirmed` (the builder applies `catalogStatusFor` to executable entries too, `coverage.ts:932`).

- [ ] **Step 4: Reclassify `SCN-http-mcp-plugin` to F7** — move its record out of the `// F4` block into the `// F7 — settings MCP administration` block, with the corrected family + rationale:

```ts
  'SCN-http-mcp-plugin': needs(
    'F7',
    ['fake-mcp-server'],
    'The /mcp/plugin route makes papai the MCP server (in-process dispatch to a fixture plugin tool), unlike F7 admin-MCP which needs papai as a client to an external fake MCP server; F7 owns all MCP-harness machinery. Reclassified F4 to F7 (rule 6).',
  ),
```

`SCN-http-mattermost-action` is unchanged (stays `needs(['mattermost-action-fixture'])`, family F4, forward-only).

- [ ] **Step 5: Run the ledger contract tests**

Run: `bun test:stories:contracts 2>&1 | grep -iE "coverage|totals|fail|pass"`
Expected: PASS — 87 executable / 41 pending / 18 needs-seam; the family-queue test passes (mcp-plugin → F7, mattermost-action → F4); the totals-line test matches.

- [ ] **Step 6: Format, typecheck, lint, commit**

```bash
bun run format && bun run typecheck && bun run lint
git add tests/stories/catalog/coverage.ts tests/stories/harness/catalog-coverage.test.ts tests/scripts/story-coverage-totals.test.ts
git commit -m "test(stories): map F4 http scenarios and reclassify mcp-plugin to F7"
```

---

### Task 11: Spec reconciliation

**Files:**

- Modify: `docs/superpowers/specs/2026-07-20-f4-http-story-family-design.md`

- [ ] **Step 1: Reconcile the refinements** — add a dated `## Post-implementation deviations (2026-07-20)` section (mirroring the F1/F3 spec precedent) recording: (a) `then.responseJson` takes the parsed body, not the `Response`; (b) `debugEnabled` is a `scenario(name, run, { debugEnabled })` option threaded through `executeScenario`'s default factory; (c) `notify-token-fixture` resets in `setupDatabase` (not a cleanup-coordinator dual reset); (d) `given.publicBaseUrl` restores via `fixtures.teardown`; (e) the dashboard vault parses the `302` claim cookie; (f) any story assertion whose exact route/body was resolved during diagnosis (e.g. the settings read path, the stats window param, the notify delivery target).

- [ ] **Step 2: Format + commit**

```bash
bun run format
git add docs/superpowers/specs/2026-07-20-f4-http-story-family-design.md
git commit -m "docs(testing): reconcile F4 spec with implementation learnings"
```

---

### Task 12: Final verification gate

- [ ] **Step 1: Sandboxed story suite** — `bun test:stories` → all stories pass, including the 6 new `SCN-http-*` scenarios, 0 fail.
- [ ] **Step 2: Sandboxed contract suites** — `bun test:stories:contracts` → all pass (catalog coverage, scenario, fixtures, fake-magi).
- [ ] **Step 3: Touched unit suites** — `bun test tests/scripts/story-coverage-totals.test.ts` and any `tests/utils` suite touching `test-helpers.ts` → pass.
- [ ] **Step 4: Typecheck, lint, format** — `bun run typecheck && bun run lint && bun run format:check` → clean.
- [ ] **Step 5: Totals line + clean tree + compat** — `bun test:stories:manifest 2>&1 | grep "story catalog"` prints `story catalog: 87/128 executable; pending 41 (1 executable-as-is, 18 needs-seam, 22 blocked)`; then `git status --short` (clean). Because this plan changed frozen harness inputs, re-record the compat baseline per the repo procedure and confirm `BASE_REF=<new-baseline-sha> bun test:stories:compat --manifest-only` reports the intended harness delta, not an accidental one.

## Self-Review

- **Spec coverage:** debug-enabled-world-option + then.responseJson (Task 1) ✓; dashboard-auth-fixture (Task 2) ✓; notify-token-fixture (Task 3) ✓; fake-magi-transcript (Task 4) ✓; given.publicBaseUrl replacing the commands one-off (Task 5) ✓; auth-claim / dashboard×3 / notify / transcript = 6 scenarios (Tasks 6-9) ✓; mcp-plugin→F7 reclassification + ledger + totals (Task 10) ✓; zero production `src/` changes (no task touches `src/`) ✓; spec reconciliation (Task 11) ✓; verification incl. compat rebaseline (Task 12) ✓. `http-mattermost-action` stays forward-only (untouched) ✓.
- **Placeholder scan:** every code step carries real code or an exact command. The genuine discovery points are flagged explicitly, never silent: the settings authenticated-read path (Task 6), the admin/stats route names + response fields + stats window param (Task 7), and the notify delivery-target mapping (Task 8) — each with a diagnosis step that preserves the rule-3 invariant (a real token or an authorization flip, never a bare 200).
- **Type consistency:** `given.dashboardSession()`/`when.dashboardRequest(session, path, init?)`, `given.notifyToken(token)`, `given.publicBaseUrl(url)`, `then.responseStatus(res, code)`/`then.responseJson(body).contains/equals`, `scenario(name, run, { debugEnabled })`, and `magi.expectTranscriptHistory(token, body)` are used identically across the seam tasks and the story tasks. `DashboardSessionHandle` is produced in Task 2 and consumed in Task 7; `ScenarioOptions.debugEnabled` is produced in Task 1 and consumed in Task 7.
