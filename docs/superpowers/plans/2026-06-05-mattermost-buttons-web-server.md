<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mattermost Buttons And Always-On Web Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the web server always available for settings/admin/auth routes and add Mattermost support for existing `ReplyFn.buttons` permission prompts.

**Architecture:** Keep the existing `src/debug/server.ts` module as the shared web server, but gate debug-only routes with a `debugEnabled` option. Mattermost buttons render as native Mattermost attachment actions whose signed context is verified by a public action route and then dispatched back into the Mattermost adapter through a small callback registry.

**Tech Stack:** Bun runtime and tests, TypeScript, Zod v4, Drizzle SQLite, Mattermost REST API, HMAC-SHA256 via Node `crypto`.

---

## File Structure

- Modify `src/index.ts`: start the shared web server unconditionally and pass `debugEnabled` from `DEBUG_SERVER === 'true'`.
- Modify `src/debug/server.ts`: accept shared web server options, make debug-only route gating explicit, expose `routeRequestForTest(req, options)` for routing tests, and route public Mattermost action callbacks before session auth.
- Create `src/chat/mattermost/action-secret.ts`: lazily creates and reads the Mattermost action signing secret from `system_config` without adding it to the LLM-facing `SystemConfigKey` union.
- Create `src/chat/mattermost/action-signing.ts`: creates and verifies stateless signed Mattermost action contexts.
- Modify `src/chat/mattermost/reply-helpers.ts`: render `ReplyFn.buttons` as Mattermost attachment actions.
- Modify `src/chat/mattermost/index.ts`: add `onInteraction`, register/unregister callback dispatchers on start/stop, and dispatch verified callbacks into the existing interaction handler.
- Create `src/chat/mattermost/action-callbacks.ts`: parse Mattermost callback payloads, verify context, maintain the dispatcher registry, and format Mattermost callback responses.
- Modify `src/chat/mattermost/metadata.ts`: add `messages.buttons` and `interactions.callbacks` capabilities.
- Modify `src/chat/types.ts`: add optional `sourceMessageText` to `IncomingInteraction`.
- Modify `src/chat/permission-prompt.ts`: export final decision formatting for permission button updates.
- Modify `src/chat/interaction-router.ts`: handle `perm:a:<id>` and `perm:d:<id>` centrally.
- Modify tests under `tests/debug/`, `tests/chat/mattermost/`, and `tests/chat/`.

---

### Task 1: Always-On Web Server And Debug Route Gating

**Files:**

- Modify: `src/debug/server.ts`
- Modify: `src/index.ts`
- Modify: `tests/debug/server-settings-static.test.ts`
- Modify: `tests/index-startup.test.ts`

- [ ] **Step 1: Write failing route-gating tests**

Add these tests to `tests/debug/server-settings-static.test.ts` after the existing `routeSettingsStatic` tests:

```ts
import { routeRequestForTest } from '../../src/debug/server.js'

describe('routeRequestForTest debug gating', () => {
  test('serves settings static routes when debug routes are disabled', async () => {
    const res = await routeRequestForTest(new Request('http://bot.test/settings'), { debugEnabled: false })
    expect(res.status).toBe(200)
  })

  test.each(['/debug', '/debug.js', '/debug.css', '/events', '/logs', '/logs/stats', '/turns/abc123'])(
    'returns 404 for debug-only route %s when debug routes are disabled',
    async (pathname) => {
      const res = await routeRequestForTest(new Request(`http://bot.test${pathname}`), { debugEnabled: false })
      expect(res.status).toBe(404)
      if (res.body !== null) await res.body.cancel()
    },
  )
})
```

- [ ] **Step 2: Run route-gating tests and verify failure**

Run: `bun test tests/debug/server-settings-static.test.ts`

Expected: FAIL because `routeRequestForTest` does not accept a `debugEnabled` option and debug-only routes are not gated before session auth.

- [ ] **Step 3: Implement route options and debug-only gating**

In `src/debug/server.ts`, add this type and default near the `server` variable:

```ts
export type WebServerRouteOptions = Readonly<{ debugEnabled: boolean }>

type WebServerStartOptions = Readonly<{
  debugEnabled?: boolean
  logLevel?: string
}>

const DEFAULT_ROUTE_OPTIONS: WebServerRouteOptions = { debugEnabled: true }

let routeOptions: WebServerRouteOptions = DEFAULT_ROUTE_OPTIONS
```

Add this helper near `routeProtectedPaths()`:

```ts
function isDebugOnlyPath(pathname: string): boolean {
  return (
    pathname === '/debug' ||
    pathname === '/debug.js' ||
    pathname === '/debug.css' ||
    pathname === '/events' ||
    pathname === '/logs' ||
    pathname === '/logs/stats' ||
    pathname.startsWith('/turns/') ||
    pathname === '/dashboard'
  )
}
```

Change `routeRequest` to accept options and fail closed before session auth:

```ts
async function routeRequest(req: Request, options: WebServerRouteOptions = routeOptions): Promise<Response> {
  const url = new URL(req.url)
  const settingsStatic = routeSettingsStatic(url.pathname)
  if (settingsStatic !== null) return settingsStatic
  // Settings trust domain: session-cookie auth only, never DEBUG_TOKEN.
  if (isSettingsPath(url.pathname)) {
    return (await routeSettingsPaths(req, url)) ?? new Response('Not found', { status: 404 })
  }

  const publicAuthResponse = routePublicAuthPaths(req, url)
  if (publicAuthResponse !== null) return publicAuthResponse

  if (!options.debugEnabled && isDebugOnlyPath(url.pathname)) {
    return new Response('Not found', { status: 404 })
  }

  if (!isAuthorizedRequest(req)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const instanceApiResponse = await handleInstanceApiRoute(req, url)
  if (instanceApiResponse !== null) return instanceApiResponse

  const protectedResponse = routeProtectedPaths(req, url)
  if (protectedResponse !== null) return protectedResponse

  const adminResponse = routeAdminPaths(req, url)
  if (adminResponse !== null) return adminResponse

  if (url.pathname === '/debug' || url.pathname === '/debug.js' || url.pathname === '/debug.css') {
    return handleClientFile('debug', url.pathname)
  }
  if (url.pathname === '/dashboard') {
    return new Response(null, { status: 301, headers: { Location: '/debug' } })
  }
  if (url.pathname.startsWith('/dashboard.') || url.pathname.startsWith('/dashboard-')) {
    return new Response('Not found', { status: 404 })
  }

  return new Response('Not found', { status: 404 })
}
```

Replace `startDebugServer` and `routeRequestForTest` with:

```ts
const resolveStartOptions = (options: WebServerStartOptions | string | undefined): Required<WebServerStartOptions> => {
  if (typeof options === 'string') return { debugEnabled: true, logLevel: options }
  return {
    debugEnabled: options?.debugEnabled ?? true,
    logLevel: options?.logLevel ?? getLogLevel(),
  }
}

export function startDebugServer(adminUserId: string, options?: WebServerStartOptions | string): void {
  init(adminUserId)
  const resolved = resolveStartOptions(options)
  routeOptions = { debugEnabled: resolved.debugEnabled }
  logMultistream.add({ stream: logBufferStream, level: resolved.logLevel })

  const port = getPort()
  const hostname = getHostname()

  server = Bun.serve({ port, hostname, idleTimeout: 0, fetch: (req) => routeRequest(req) })

  log.info({ port, hostname, debugEnabled: resolved.debugEnabled }, 'Web server started (session auth)')
}

export const routeRequestForTest = (req: Request, options?: Partial<WebServerRouteOptions>): Promise<Response> =>
  routeRequest(req, { ...DEFAULT_ROUTE_OPTIONS, ...options })
```

In `stopDebugServer()`, reset route options after stopping:

```ts
routeOptions = DEFAULT_ROUTE_OPTIONS
```

- [ ] **Step 4: Write failing startup test for unconditional server start**

Add this test to `tests/index-startup.test.ts`. It should mock the same dependencies as the neighboring startup tests and specifically mock `../src/debug/server.js`:

```ts
test('starts web server even when DEBUG_SERVER is false', async () => {
  const originalAdminUserId = process.env['ADMIN_USER_ID']
  const originalDebugServer = process.env['DEBUG_SERVER']
  process.env['ADMIN_USER_ID'] = 'admin-1'
  delete process.env['DEBUG_SERVER']
  let startWebServerArgs: unknown[] | null = null

  void mock.module('../src/announcements.js', () => ({ announceNewVersion: (): void => {} }))
  void mock.module('../src/attachments/index.js', () => ({ isS3Configured: (): boolean => false }))
  void mock.module('../src/attachments/staged-download.js', () => ({
    createStagedDownloader: (): (() => Promise<null>) => () => Promise.resolve(null),
  }))
  void mock.module('../src/bot.js', () => ({ setupBot: (): void => {} }))
  void mock.module('../src/chat/registry.js', () => ({
    createChatProviderFromConfig: (): unknown => ({
      name: 'mock',
      threadCapabilities: { supportsThreads: false, canCreateThreads: false, threadScope: 'message' },
      capabilities: new Set(),
      traits: { observedGroupMessages: 'all' },
      configRequirements: [],
      registerCommand: (): void => {},
      onMessage: (): void => {},
      sendMessage: (): Promise<void> => Promise.resolve(),
      renderContext: (): unknown => ({ method: 'text', content: 'mock' }),
      start: (): Promise<void> => Promise.resolve(),
      stop: (): Promise<void> => Promise.resolve(),
    }),
  }))
  void mock.module('../src/chat/startup.js', () => ({ registerCommandMenuIfSupported: (): void => {} }))
  void mock.module('../src/db/index.js', () => ({ initDb: (): void => {}, closeMigrationDbInstance: (): void => {} }))
  void mock.module('../src/db/drizzle.js', () => ({ closeDrizzleDb: (): void => {} }))
  void mock.module('../src/debug/chat-router-runtime.js', () => ({
    setRuntimeChatRouter: (): void => {},
    clearRuntimeChatRouter: (): void => {},
  }))
  void mock.module('../src/debug/server.js', () => ({
    startDebugServer: (...args: unknown[]): void => {
      startWebServerArgs = args
    },
    stopDebugServer: (): void => {},
  }))
  void mock.module('../src/deferred-prompts/poller.js', () => ({
    startPollers: (): void => {},
    stopPollers: (): void => {},
  }))
  void mock.module('../src/instances/bootstrap.js', () => ({
    bootstrapInstancesFromEnv: (): unknown => ({ bootstrapped: false, reason: 'already-bootstrapped' }),
  }))
  void mock.module('../src/instances/platform-store.js', () => ({
    listActivePlatformInstancesSafe: (): unknown => ({ instances: [], failures: [] }),
  }))
  void mock.module('../src/instances/task-store.js', () => ({
    listTaskInstancesSafe: (): unknown => ({ instances: [], failures: [] }),
  }))
  void mock.module('../src/logger.js', () => ({
    logger: {
      child: (): unknown => ({
        info: (): void => {},
        error: (): void => {},
        debug: (): void => {},
        warn: (): void => {},
        fatal: (): void => {},
      }),
    },
  }))
  void mock.module('../src/message-cache/index.js', () => ({ initializeMessageCache: (): void => {} }))
  void mock.module('../src/message-queue/index.js', () => ({ flushOnShutdown: (): Promise<void> => Promise.resolve() }))
  void mock.module('../src/plugins/discovery.js', () => ({
    discoverPlugins: (): unknown => ({ plugins: [], errors: [] }),
  }))
  void mock.module('../src/plugins/loader.js', () => ({
    activatePlugins: (): Promise<void> => Promise.resolve(),
    deactivateAllPlugins: (): Promise<void> => Promise.resolve(),
    getActivatedPluginIds: (): unknown[] => [],
  }))
  void mock.module('../src/plugins/registry.js', () => ({
    syncRegistryFromDb: (): void => {},
    pluginRegistry: {
      evaluateCompatibilityAcrossInstances: (): void => {},
      getApprovedCompatiblePlugins: (): unknown[] => [],
    },
  }))
  void mock.module('../src/plugins/startup-guard.js', () => ({
    evaluateStartupGuard: (): unknown => ({ action: 'continue' }),
  }))
  void mock.module('../src/providers/resolver.js', () => ({
    defaultTaskProviderResolver: { resolve: (): null => null },
  }))
  void mock.module('../src/scheduler-instance.js', () => ({
    scheduler: { startAll: (): void => {}, stopAll: (): void => {} },
  }))
  void mock.module('../src/scheduler.js', () => ({ startScheduler: (): void => {}, stopScheduler: (): void => {} }))
  void mock.module('../src/system-config.js', () => ({
    seedSystemConfigFromEnv: (): void => {},
    missingSystemConfigKeys: (): string[] => [],
  }))
  void mock.module('../src/usage/index.js', () => ({ initUsageRecorder: (): void => {} }))

  try {
    await import(`../src/index.ts?always-web-server=${Date.now()}`)
  } finally {
    restoreAdminUserId(originalAdminUserId)
    if (originalDebugServer === undefined) delete process.env['DEBUG_SERVER']
    else process.env['DEBUG_SERVER'] = originalDebugServer
  }

  expect(startWebServerArgs).toEqual(['admin-1', { debugEnabled: false }])
})
```

- [ ] **Step 5: Run startup test and verify failure**

Run: `bun test tests/index-startup.test.ts --path-ignore-patterns ''`

Expected: FAIL because `src/index.ts` still starts the server only inside the `DEBUG_SERVER=true` branch.

- [ ] **Step 6: Start the web server unconditionally**

In `src/index.ts`, replace lines 189-195 with:

```ts
const { startDebugServer, stopDebugServer } = await import('./debug/server.js')
startDebugServer(adminUserId, { debugEnabled: process.env['DEBUG_SERVER'] === 'true' })
const stopDebugServerFn: (() => void) | null = stopDebugServer
```

Keep the existing shutdown call:

```ts
if (stopDebugServerFn !== null) stopDebugServerFn()
```

- [ ] **Step 7: Run tests and commit**

Run: `bun test tests/debug/server-settings-static.test.ts tests/index-startup.test.ts --path-ignore-patterns ''`

Expected: PASS.

Commit:

```bash
git add src/debug/server.ts src/index.ts tests/debug/server-settings-static.test.ts tests/index-startup.test.ts
git commit -m "fix(server): start web UI server unconditionally"
```

---

### Task 2: Mattermost Action Signing Secret

**Files:**

- Create: `src/chat/mattermost/action-secret.ts`
- Create: `tests/chat/mattermost/action-secret.test.ts`

- [ ] **Step 1: Write failing secret tests**

Create `tests/chat/mattermost/action-secret.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { systemConfig } from '../../../src/db/schema.js'
import {
  getMattermostActionSigningSecret,
  MATTERMOST_ACTION_SIGNING_SECRET_KEY,
} from '../../../src/chat/mattermost/action-secret.js'
import { getTestDb, mockLogger, setupTestDb } from '../../utils/test-helpers.js'

describe('Mattermost action signing secret', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('creates and persists a secret on first use', () => {
    const secret = getMattermostActionSigningSecret()
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/u)

    const row = getTestDb()
      .select()
      .from(systemConfig)
      .all()
      .find((entry) => entry.key === MATTERMOST_ACTION_SIGNING_SECRET_KEY)

    expect(row?.value).toBe(secret)
    expect(row?.updatedBy).toBe('mattermost-action-signing')
  })

  test('reuses existing persisted secret', () => {
    getTestDb()
      .insert(systemConfig)
      .values({ key: MATTERMOST_ACTION_SIGNING_SECRET_KEY, value: 'persisted-secret', updatedAt: 1, updatedBy: 'test' })
      .run()

    expect(getMattermostActionSigningSecret()).toBe('persisted-secret')
  })
})
```

- [ ] **Step 2: Run secret tests and verify failure**

Run: `bun test tests/chat/mattermost/action-secret.test.ts`

Expected: FAIL because `src/chat/mattermost/action-secret.ts` does not exist.

- [ ] **Step 3: Implement secret store helper**

Create `src/chat/mattermost/action-secret.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomBytes } from 'node:crypto'

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../../db/drizzle.js'
import { systemConfig } from '../../db/schema.js'
import { logger } from '../../logger.js'

const log = logger.child({ scope: 'chat:mattermost:action-secret' })

export const MATTERMOST_ACTION_SIGNING_SECRET_KEY = 'mattermost_action_signing_secret'
const UPDATED_BY = 'mattermost-action-signing'

const generateSecret = (): string => randomBytes(32).toString('base64url')

const readSecret = (): string | null => {
  const row = getDrizzleDb()
    .select({ value: systemConfig.value })
    .from(systemConfig)
    .where(eq(systemConfig.key, MATTERMOST_ACTION_SIGNING_SECRET_KEY))
    .get()
  return row?.value ?? null
}

export function getMattermostActionSigningSecret(): string {
  const existing = readSecret()
  if (existing !== null) return existing

  const value = generateSecret()
  getDrizzleDb()
    .insert(systemConfig)
    .values({ key: MATTERMOST_ACTION_SIGNING_SECRET_KEY, value, updatedAt: Date.now(), updatedBy: UPDATED_BY })
    .onConflictDoNothing({ target: systemConfig.key })
    .run()

  const stored = readSecret()
  if (stored === null) {
    throw new Error('Failed to initialize Mattermost action signing secret')
  }
  log.info({ key: MATTERMOST_ACTION_SIGNING_SECRET_KEY }, 'Mattermost action signing secret initialized')
  return stored
}
```

- [ ] **Step 4: Run tests and commit**

Run: `bun test tests/chat/mattermost/action-secret.test.ts`

Expected: PASS.

Commit:

```bash
git add src/chat/mattermost/action-secret.ts tests/chat/mattermost/action-secret.test.ts
git commit -m "feat(mattermost): add action signing secret"
```

---

### Task 3: Stateless Mattermost Action Context Signing

**Files:**

- Create: `src/chat/mattermost/action-signing.ts`
- Create: `tests/chat/mattermost/action-signing.test.ts`

- [ ] **Step 1: Write failing signing tests**

Create `tests/chat/mattermost/action-signing.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  createMattermostActionContext,
  verifyMattermostActionContext,
} from '../../../src/chat/mattermost/action-signing.js'

const secret = 'test-secret'

describe('Mattermost action signing', () => {
  test('round-trips a signed context', () => {
    const context = createMattermostActionContext(
      {
        platformInstanceId: 'mattermost-main',
        callbackData: 'perm:a:abc12345',
        sourceMessageText: 'Run `delete_task`?\n\nReason',
        expiresAt: 1_900_000_000_000,
      },
      secret,
    )

    expect(verifyMattermostActionContext(context, secret, 1_800_000_000_000)).toEqual({
      ok: true,
      value: {
        platformInstanceId: 'mattermost-main',
        callbackData: 'perm:a:abc12345',
        sourceMessageText: 'Run `delete_task`?\n\nReason',
        expiresAt: 1_900_000_000_000,
      },
    })
  })

  test('rejects modified callback data', () => {
    const context = createMattermostActionContext(
      {
        platformInstanceId: 'mattermost-main',
        callbackData: 'perm:a:abc12345',
        sourceMessageText: 'prompt',
        expiresAt: 1_900_000_000_000,
      },
      secret,
    )

    const result = verifyMattermostActionContext(
      { ...context, callbackData: 'perm:d:abc12345' },
      secret,
      1_800_000_000_000,
    )
    expect(result).toEqual({ ok: false, reason: 'bad_signature' })
  })

  test('rejects expired contexts', () => {
    const context = createMattermostActionContext(
      {
        platformInstanceId: 'mattermost-main',
        callbackData: 'perm:a:abc12345',
        sourceMessageText: 'prompt',
        expiresAt: 1000,
      },
      secret,
    )

    expect(verifyMattermostActionContext(context, secret, 1001)).toEqual({ ok: false, reason: 'expired' })
  })
})
```

- [ ] **Step 2: Run signing tests and verify failure**

Run: `bun test tests/chat/mattermost/action-signing.test.ts`

Expected: FAIL because `src/chat/mattermost/action-signing.ts` does not exist.

- [ ] **Step 3: Implement signing helper**

Create `src/chat/mattermost/action-signing.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

import { z } from 'zod'

const SIGNING_VERSION = 1

export type MattermostActionContextInput = Readonly<{
  platformInstanceId: string
  callbackData: string
  sourceMessageText: string
  expiresAt: number
}>

export const MattermostSignedActionContextSchema = z.object({
  version: z.literal(SIGNING_VERSION),
  platformInstanceId: z.string().min(1),
  callbackData: z.string().min(1),
  sourceMessageText: z.string(),
  expiresAt: z.number().int().positive(),
  nonce: z.string().min(16),
  signature: z.string().min(43),
})

export type MattermostSignedActionContext = z.infer<typeof MattermostSignedActionContextSchema>

export type VerifiedMattermostActionContext = MattermostActionContextInput
export type MattermostActionVerificationResult =
  | { ok: true; value: VerifiedMattermostActionContext }
  | { ok: false; reason: 'invalid_shape' | 'expired' | 'bad_signature' }

const canonicalPayload = (context: Omit<MattermostSignedActionContext, 'signature'>): string =>
  JSON.stringify({
    version: context.version,
    platformInstanceId: context.platformInstanceId,
    callbackData: context.callbackData,
    sourceMessageText: context.sourceMessageText,
    expiresAt: context.expiresAt,
    nonce: context.nonce,
  })

const sign = (payload: string, secret: string): string =>
  createHmac('sha256', secret).update(payload).digest('base64url')

const signaturesMatch = (actual: string, expected: string): boolean => {
  const actualBuffer = Buffer.from(actual, 'base64url')
  const expectedBuffer = Buffer.from(expected, 'base64url')
  if (actualBuffer.length !== expectedBuffer.length) return false
  return timingSafeEqual(actualBuffer, expectedBuffer)
}

export function createMattermostActionContext(
  input: MattermostActionContextInput,
  secret: string,
): MattermostSignedActionContext {
  const unsigned = {
    version: SIGNING_VERSION,
    platformInstanceId: input.platformInstanceId,
    callbackData: input.callbackData,
    sourceMessageText: input.sourceMessageText,
    expiresAt: input.expiresAt,
    nonce: randomBytes(16).toString('base64url'),
  }
  return { ...unsigned, signature: sign(canonicalPayload(unsigned), secret) }
}

export function verifyMattermostActionContext(
  value: unknown,
  secret: string,
  now: number = Date.now(),
): MattermostActionVerificationResult {
  const parsed = MattermostSignedActionContextSchema.safeParse(value)
  if (!parsed.success) return { ok: false, reason: 'invalid_shape' }
  const { signature, ...unsigned } = parsed.data
  if (parsed.data.expiresAt <= now) return { ok: false, reason: 'expired' }
  const expected = sign(canonicalPayload(unsigned), secret)
  if (!signaturesMatch(signature, expected)) return { ok: false, reason: 'bad_signature' }
  return {
    ok: true,
    value: {
      platformInstanceId: parsed.data.platformInstanceId,
      callbackData: parsed.data.callbackData,
      sourceMessageText: parsed.data.sourceMessageText,
      expiresAt: parsed.data.expiresAt,
    },
  }
}
```

- [ ] **Step 4: Run tests and commit**

Run: `bun test tests/chat/mattermost/action-signing.test.ts`

Expected: PASS.

Commit:

```bash
git add src/chat/mattermost/action-signing.ts tests/chat/mattermost/action-signing.test.ts
git commit -m "feat(mattermost): sign action contexts"
```

---

### Task 4: Mattermost `reply.buttons()` Rendering

**Files:**

- Modify: `src/chat/mattermost/reply-helpers.ts`
- Modify: `src/chat/mattermost/index.ts`
- Modify: `tests/chat/mattermost/reply-helpers.test.ts`

- [ ] **Step 1: Replace failing rejection tests with rendering tests**

In `tests/chat/mattermost/reply-helpers.test.ts`, update `makeReplyFn()` to accept callback base URL and create action context:

```ts
function makeReplyFn(callbackBaseUrl: string | null = 'https://bot.example'): ReplyFnResult {
  const posts: unknown[] = []
  const apiFetch = (_method: string, _path: string, body: unknown): Promise<Record<string, string>> => {
    posts.push(body)
    return Promise.resolve({ id: 'post-1' })
  }
  const wsSend = (): void => {}
  const uploadFile = (): Promise<string> => Promise.resolve('file-1')

  const reply = createMattermostReplyFn({
    channelId: 'chan-1',
    postId: 'post-1',
    threadId: undefined,
    baseUrl: 'http://localhost:8065',
    platformInstanceId: 'mattermost-main',
    callbackBaseUrl,
    getWsSeq: () => 1,
    apiFetch,
    wsSend,
    uploadFile,
    createActionContext: (input) => ({
      version: 1,
      platformInstanceId: input.platformInstanceId,
      callbackData: input.callbackData,
      sourceMessageText: input.sourceMessageText,
      expiresAt: input.expiresAt,
      nonce: 'nonce-nonce-nonce',
      signature: 'signature-signature-signature-signature-signature',
    }),
  })

  return { reply, posts }
}
```

Replace the two rejection tests in the `buttons` describe block with:

```ts
test('posts Mattermost attachment actions', async () => {
  const { reply, posts } = makeReplyFn()

  await reply.buttons('choose', {
    buttons: [
      { text: 'Allow', callbackData: 'perm:a:abc12345', style: 'primary' },
      { text: 'Deny', callbackData: 'perm:d:abc12345', style: 'secondary' },
    ],
  })

  expect(posts).toHaveLength(1)
  expect(posts[0]).toMatchObject({
    channel_id: 'chan-1',
    message: 'choose',
    root_id: '',
    props: {
      attachments: [
        {
          actions: [
            {
              id: 'action0',
              type: 'button',
              name: 'Allow',
              style: 'primary',
              integration: {
                url: 'https://bot.example/mattermost/actions',
                context: { callbackData: 'perm:a:abc12345', sourceMessageText: 'choose' },
              },
            },
            {
              id: 'action1',
              type: 'button',
              name: 'Deny',
              style: 'default',
              integration: {
                url: 'https://bot.example/mattermost/actions',
                context: { callbackData: 'perm:d:abc12345', sourceMessageText: 'choose' },
              },
            },
          ],
        },
      ],
    },
  })
})

test('rejects when callback base URL is missing', async () => {
  const { reply } = makeReplyFn(null)

  await expect(
    reply.buttons('choose', { buttons: [{ text: 'Allow', callbackData: 'perm:a:abc12345' }] }),
  ).rejects.toThrow('Mattermost interactive buttons require SETTINGS_PUBLIC_BASE_URL')
})
```

- [ ] **Step 2: Run reply-helper tests and verify failure**

Run: `bun test tests/chat/mattermost/reply-helpers.test.ts`

Expected: FAIL because `reply.buttons()` still rejects and `createMattermostReplyFn()` does not accept the new parameters.

- [ ] **Step 3: Implement button rendering**

In `src/chat/mattermost/reply-helpers.ts`, import the signing type and extend params:

```ts
import type { MattermostActionContextInput, MattermostSignedActionContext } from './action-signing.js'

const ACTION_TTL_MS = 5 * 60 * 1000
const MATTERMOST_MAX_BUTTONS = 5

type MattermostButtonAction = Readonly<{
  id: string
  type: 'button'
  name: string
  style: string
  integration: { url: string; context: MattermostSignedActionContext }
}>
```

Add these fields to `MattermostReplyHelpersParams`:

```ts
platformInstanceId: string
callbackBaseUrl: string | null
createActionContext: (input: MattermostActionContextInput) => MattermostSignedActionContext
```

Add these helpers above `createMattermostReplyFn()`:

```ts
const callbackUrl = (baseUrl: string): string => `${baseUrl.replace(/\/+$/u, '')}/mattermost/actions`

const mattermostStyle = (style: 'primary' | 'secondary' | 'danger' | undefined): string => {
  if (style === 'primary') return 'primary'
  if (style === 'danger') return 'danger'
  return 'default'
}

const buildActions = (
  content: string,
  options: ButtonReplyOptions,
  platformInstanceId: string,
  baseUrl: string,
  createActionContext: (input: MattermostActionContextInput) => MattermostSignedActionContext,
): MattermostButtonAction[] => {
  const buttons = options.buttons ?? []
  if (buttons.length > MATTERMOST_MAX_BUTTONS) {
    throw new Error(`too many Mattermost buttons: got ${String(buttons.length)}, max ${String(MATTERMOST_MAX_BUTTONS)}`)
  }
  return buttons.map((button, index) => ({
    id: `action${String(index)}`,
    type: 'button',
    name: button.text,
    style: mattermostStyle(button.style),
    integration: {
      url: callbackUrl(baseUrl),
      context: createActionContext({
        platformInstanceId,
        callbackData: button.callbackData,
        sourceMessageText: content,
        expiresAt: Date.now() + ACTION_TTL_MS,
      }),
    },
  }))
}
```

Update the destructuring and `buttons` method:

```ts
const {
  channelId,
  postId,
  threadId,
  baseUrl: _baseUrl,
  platformInstanceId,
  callbackBaseUrl,
  getWsSeq,
  apiFetch,
  wsSend,
  uploadFile,
  createActionContext,
} = params
```

```ts
buttons: (content: string, options: ButtonReplyOptions): Promise<void> => {
  if (callbackBaseUrl === null) {
    return Promise.reject(new Error('Mattermost interactive buttons require SETTINGS_PUBLIC_BASE_URL'))
  }
  const actions = buildActions(content, options, platformInstanceId, callbackBaseUrl, createActionContext)
  return post(content, options, { props: { attachments: [{ actions }] } })
},
```

In `src/chat/mattermost/index.ts`, import helpers:

```ts
import { getSettingsPublicBaseUrl } from '../../settings/config.js'
import { createMattermostActionContext } from './action-signing.js'
import { getMattermostActionSigningSecret } from './action-secret.js'
```

Pass new fields to `createMattermostReplyFn()`:

```ts
platformInstanceId: this.platformInstanceId,
callbackBaseUrl: getSettingsPublicBaseUrl(),
createActionContext: (input) => createMattermostActionContext(input, getMattermostActionSigningSecret()),
```

- [ ] **Step 4: Run tests and commit**

Run: `bun test tests/chat/mattermost/reply-helpers.test.ts tests/chat/mattermost/index.test.ts`

Expected: PASS.

Commit:

```bash
git add src/chat/mattermost/reply-helpers.ts src/chat/mattermost/index.ts tests/chat/mattermost/reply-helpers.test.ts
git commit -m "feat(mattermost): render reply buttons"
```

---

### Task 5: Permission Callback Routing And Final Decision Text

**Files:**

- Modify: `src/chat/types.ts`
- Modify: `src/chat/permission-prompt.ts`
- Modify: `src/chat/interaction-router.ts`
- Modify: `tests/chat/permission-prompt.test.ts`
- Modify: `tests/chat/interaction-router.test.ts`

- [ ] **Step 1: Write failing permission formatter tests**

In `tests/chat/permission-prompt.test.ts`, add `formatPermissionDecisionText` to the import and append:

```ts
describe('formatPermissionDecisionText', () => {
  test('keeps prompt text and appends allow decision', () => {
    expect(formatPermissionDecisionText('Run `delete_task`?\n\nReason', 'allow')).toBe(
      'Run `delete_task`?\n\nReason\n\nAllowed.',
    )
  })

  test('keeps prompt text and appends deny decision', () => {
    expect(formatPermissionDecisionText('Run `delete_task`?\n\nReason', 'deny')).toBe(
      'Run `delete_task`?\n\nReason\n\nDenied.',
    )
  })
})
```

- [ ] **Step 2: Write failing interaction-router tests**

In `tests/chat/interaction-router.test.ts`, import helpers:

```ts
import { askPermissionViaChat, resetPermissionPromptForTesting } from '../../src/chat/permission-prompt.js'
```

Change the `describe` name to `routeInteraction` and add cleanup:

```ts
beforeEach(() => resetPermissionPromptForTesting())
afterEach(() => resetPermissionPromptForTesting())
```

Add this helper:

```ts
async function createPendingPermissionId(): Promise<string> {
  const calls: Array<{ options: { buttons?: Array<{ callbackData: string }> } }> = []
  const reply = {
    text: () => Promise.resolve(),
    formatted: () => Promise.resolve(),
    typing: () => {},
    buttons: (_content: string, options: { buttons?: Array<{ callbackData: string }> }) => {
      calls.push({ options })
      return Promise.resolve()
    },
  }
  void askPermissionViaChat(reply, 'tg:u1', { toolName: 'delete_task', reason: 'cleanup' })
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  return calls[0]!.options.buttons![0]!.callbackData.replace('perm:a:', '')
}
```

Append tests:

```ts
test('resolves allow permission callbacks and replaces the prompt when possible', async () => {
  const id = await createPendingPermissionId()
  const replacements: string[] = []
  const { reply } = createMockReply()
  reply.replaceText = (content: string): Promise<void> => {
    replacements.push(content)
    return Promise.resolve()
  }

  const handled = await routeInteraction(
    { ...interaction(`perm:a:${id}`), sourceMessageText: 'Run `delete_task`?\n\ncleanup' },
    reply,
    auth(true),
  )

  expect(handled).toBe(true)
  expect(replacements).toEqual(['Run `delete_task`?\n\ncleanup\n\nAllowed.'])
})

test('resolves deny permission callbacks and replaces the prompt when possible', async () => {
  const id = await createPendingPermissionId()
  const replacements: string[] = []
  const { reply } = createMockReply()
  reply.replaceText = (content: string): Promise<void> => {
    replacements.push(content)
    return Promise.resolve()
  }

  const handled = await routeInteraction(
    { ...interaction(`perm:d:${id}`), sourceMessageText: 'Run `delete_task`?\n\ncleanup' },
    reply,
    auth(true),
  )

  expect(handled).toBe(true)
  expect(replacements).toEqual(['Run `delete_task`?\n\ncleanup\n\nDenied.'])
})

test('reports missing permission requests as unavailable', async () => {
  const { reply, getReplies } = createMockReply()
  const handled = await routeInteraction(interaction('perm:a:missing1'), reply, auth(true))

  expect(handled).toBe(true)
  expect(getReplies()[0]).toContain('Action is no longer available')
})
```

- [ ] **Step 3: Run tests and verify failure**

Run: `bun test tests/chat/permission-prompt.test.ts tests/chat/interaction-router.test.ts`

Expected: FAIL because permission decision formatting and `perm:` routing are not implemented.

- [ ] **Step 4: Implement permission decision formatting**

In `src/chat/types.ts`, add this optional field to `IncomingInteraction`:

```ts
/** Original interactive message content when the adapter can provide it. */
sourceMessageText: string
```

In `src/chat/permission-prompt.ts`, export:

```ts
export function formatPermissionDecisionText(sourceMessageText: string, decision: PermissionDecision): string {
  const label = decision === 'allow' ? 'Allowed.' : 'Denied.'
  return `${sourceMessageText.trimEnd()}\n\n${label}`
}
```

- [ ] **Step 5: Implement `perm:` routing**

In `src/chat/interaction-router.ts`, add imports:

```ts
import { formatPermissionDecisionText, resolvePermissionRequest, type PermissionDecision } from './permission-prompt.js'
```

Add helpers above `routeInteraction()`:

```ts
const PERMISSION_CALLBACK_PATTERN = /^perm:(a|d):([A-Za-z0-9_-]+)$/u

const permissionDecisionFromCode = (code: string): PermissionDecision => (code === 'a' ? 'allow' : 'deny')

async function replyToPermissionDecision(
  reply: ReplyFn,
  sourceMessageText: string | undefined,
  decision: PermissionDecision,
): Promise<void> {
  const fallback = decision === 'allow' ? 'Allowed.' : 'Denied.'
  const content = sourceMessageText === undefined ? fallback : formatPermissionDecisionText(sourceMessageText, decision)
  if (reply.replaceText !== undefined) {
    await reply.replaceText(content)
    return
  }
  await reply.text(content)
}
```

In `routeInteraction()`, after the authorization check and before the no-match log:

```ts
const permissionMatch = PERMISSION_CALLBACK_PATTERN.exec(interaction.callbackData)
if (permissionMatch !== null) {
  const decision = permissionDecisionFromCode(permissionMatch[1]!)
  const id = permissionMatch[2]!
  if (!resolvePermissionRequest(id, decision)) {
    await reply.text('Action is no longer available.')
    return true
  }
  await replyToPermissionDecision(reply, interaction.sourceMessageText, decision)
  return true
}
```

- [ ] **Step 6: Run tests and commit**

Run: `bun test tests/chat/permission-prompt.test.ts tests/chat/interaction-router.test.ts`

Expected: PASS.

Commit:

```bash
git add src/chat/types.ts src/chat/permission-prompt.ts src/chat/interaction-router.ts tests/chat/permission-prompt.test.ts tests/chat/interaction-router.test.ts
git commit -m "feat(chat): route permission button callbacks"
```

---

### Task 6: Mattermost Action Callback Dispatch

**Files:**

- Create: `src/chat/mattermost/action-callbacks.ts`
- Create: `tests/chat/mattermost/action-callbacks.test.ts`
- Modify: `src/chat/mattermost/index.ts`

- [ ] **Step 1: Write failing callback tests**

Create `tests/chat/mattermost/action-callbacks.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import {
  handleMattermostActionRequest,
  registerMattermostActionDispatcher,
  unregisterMattermostActionDispatcher,
} from '../../../src/chat/mattermost/action-callbacks.js'
import { createMattermostActionContext } from '../../../src/chat/mattermost/action-signing.js'

const secret = 'test-secret'

const validContext = () =>
  createMattermostActionContext(
    {
      platformInstanceId: 'mattermost-main',
      callbackData: 'perm:a:abc12345',
      sourceMessageText: 'Run `delete_task`?\n\nReason',
      expiresAt: Date.now() + 60_000,
    },
    secret,
  )

const requestWithContext = (context: unknown): Request =>
  new Request('https://bot.example/mattermost/actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: 'user-1',
      post_id: 'post-1',
      channel_id: 'chan-1',
      team_id: 'team-1',
      context,
    }),
  })

describe('Mattermost action callbacks', () => {
  afterEach(() => unregisterMattermostActionDispatcher('mattermost-main'))

  test('dispatches valid signed callbacks to registered provider', async () => {
    const calls: unknown[] = []
    registerMattermostActionDispatcher('mattermost-main', (payload) => {
      calls.push(payload)
      return Promise.resolve({ update: { message: 'updated', props: {} } })
    })

    const res = await handleMattermostActionRequest(requestWithContext(validContext()), { getSecret: () => secret })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ update: { message: 'updated', props: {} } })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      userId: 'user-1',
      postId: 'post-1',
      channelId: 'chan-1',
      teamId: 'team-1',
      action: { platformInstanceId: 'mattermost-main', callbackData: 'perm:a:abc12345' },
    })
  })

  test('returns Mattermost error for invalid signature', async () => {
    const context = { ...validContext(), callbackData: 'perm:d:abc12345' }
    const res = await handleMattermostActionRequest(requestWithContext(context), { getSecret: () => secret })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ error: { message: 'This action is no longer valid.' } })
  })

  test('returns unavailable response when no dispatcher is registered', async () => {
    const res = await handleMattermostActionRequest(requestWithContext(validContext()), { getSecret: () => secret })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ephemeral_text: 'Action is no longer available.' })
  })
})
```

- [ ] **Step 2: Run callback tests and verify failure**

Run: `bun test tests/chat/mattermost/action-callbacks.test.ts`

Expected: FAIL because `src/chat/mattermost/action-callbacks.ts` does not exist.

- [ ] **Step 3: Implement callback registry and route handler**

Create `src/chat/mattermost/action-callbacks.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { logger } from '../../logger.js'
import { getMattermostActionSigningSecret } from './action-secret.js'
import { verifyMattermostActionContext, type VerifiedMattermostActionContext } from './action-signing.js'

const log = logger.child({ scope: 'chat:mattermost:actions' })

export type MattermostActionPayload = Readonly<{
  userId: string
  postId: string
  channelId: string
  teamId?: string
  action: VerifiedMattermostActionContext
}>

export type MattermostActionResponse =
  | { update: { message: string; props: Record<string, unknown> } }
  | { ephemeral_text: string }
  | { error: { message: string } }

type MattermostActionDispatcher = (payload: MattermostActionPayload) => Promise<MattermostActionResponse>

const MattermostActionRequestSchema = z.object({
  user_id: z.string().min(1),
  post_id: z.string().min(1),
  channel_id: z.string().min(1),
  team_id: z.string().optional(),
  context: z.unknown(),
})

const dispatchers = new Map<string, MattermostActionDispatcher>()

export const registerMattermostActionDispatcher = (
  platformInstanceId: string,
  dispatcher: MattermostActionDispatcher,
): void => {
  dispatchers.set(platformInstanceId, dispatcher)
}

export const unregisterMattermostActionDispatcher = (platformInstanceId: string): void => {
  dispatchers.delete(platformInstanceId)
}

const json = (body: MattermostActionResponse, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const actionError = (message: string): Response => json({ error: { message } })

export function isMattermostActionPath(req: Request, url: URL): boolean {
  return url.pathname === '/mattermost/actions'
}

export async function handleMattermostActionRequest(
  req: Request,
  deps: { getSecret?: () => string } = {},
): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) return actionError('Invalid action payload.')

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return actionError('Invalid action payload.')
  }

  const parsed = MattermostActionRequestSchema.safeParse(raw)
  if (!parsed.success) return actionError('Invalid action payload.')

  const secret = deps.getSecret?.() ?? getMattermostActionSigningSecret()
  const verification = verifyMattermostActionContext(parsed.data.context, secret)
  if (!verification.ok) return actionError('This action is no longer valid.')

  const dispatcher = dispatchers.get(verification.value.platformInstanceId)
  if (dispatcher === undefined) return json({ ephemeral_text: 'Action is no longer available.' })

  try {
    return json(
      await dispatcher({
        userId: parsed.data.user_id,
        postId: parsed.data.post_id,
        channelId: parsed.data.channel_id,
        teamId: parsed.data.team_id,
        action: verification.value,
      }),
    )
  } catch (error) {
    log.error(
      {
        platformInstanceId: verification.value.platformInstanceId,
        channelId: parsed.data.channel_id,
        postId: parsed.data.post_id,
        error: error instanceof Error ? error.message : String(error),
      },
      'Mattermost action dispatcher failed',
    )
    return actionError('Unable to process action.')
  }
}
```

- [ ] **Step 4: Run callback tests and commit callback module**

Run: `bun test tests/chat/mattermost/action-callbacks.test.ts`

Expected: PASS.

Commit:

```bash
git add src/chat/mattermost/action-callbacks.ts tests/chat/mattermost/action-callbacks.test.ts
git commit -m "feat(mattermost): add action callback registry"
```

- [ ] **Step 5: Add provider dispatch tests**

In `tests/chat/mattermost/index.test.ts`, add a focused test near other provider behavior tests:

```ts
test('dispatches Mattermost action callbacks through onInteraction handler', async () => {
  const provider = createMattermostProvider()
  const interactions: Array<{ callbackData: string; sourceMessageText: string | undefined }> = []
  provider.onInteraction?.((interaction, reply) => {
    interactions.push({ callbackData: interaction.callbackData, sourceMessageText: interaction.sourceMessageText })
    return reply.replaceText?.('updated') ?? reply.text('updated')
  })

  const apiFetch = (method: string, path: string, _body: unknown): Promise<unknown> => {
    if (method === 'GET' && path === '/api/v4/channels/chan-1') return Promise.resolve({ type: 'O' })
    if (method === 'GET' && path === '/api/v4/channels/chan-1/members/user-1') return Promise.resolve({ roles: '' })
    return Promise.resolve({})
  }
  Reflect.set(provider, 'apiFetch', apiFetch)

  const dispatch = Reflect.get(provider, 'dispatchMattermostAction') as (payload: unknown) => Promise<unknown>
  const response = await dispatch.call(provider, {
    userId: 'user-1',
    postId: 'post-1',
    channelId: 'chan-1',
    teamId: 'team-1',
    action: {
      platformInstanceId: TEST_PLATFORM_ID,
      callbackData: 'perm:a:abc12345',
      sourceMessageText: 'Run `delete_task`?\n\nReason',
      expiresAt: Date.now() + 60_000,
    },
  })

  expect(interactions).toEqual([{ callbackData: 'perm:a:abc12345', sourceMessageText: 'Run `delete_task`?\n\nReason' }])
  expect(response).toEqual({ update: { message: 'updated', props: {} } })
})
```

- [ ] **Step 6: Run provider test and verify failure**

Run: `bun test tests/chat/mattermost/index.test.ts --path-ignore-patterns ''`

Expected: FAIL because Mattermost provider does not expose `onInteraction` or action dispatching.

- [ ] **Step 7: Implement provider dispatching**

In `src/chat/mattermost/index.ts`, import registry and response type:

```ts
import {
  registerMattermostActionDispatcher,
  unregisterMattermostActionDispatcher,
  type MattermostActionPayload,
  type MattermostActionResponse,
} from './action-callbacks.js'
```

Add private handler field:

```ts
private interactionHandler: ((interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>) | null = null
```

Add public method near `onMessage()`:

```ts
onInteraction(handler: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>): void {
  this.interactionHandler = handler
}
```

In `start()`, after bot user initialization:

```ts
registerMattermostActionDispatcher(this.platformInstanceId, (payload) => this.dispatchMattermostAction(payload))
```

In `stop()`, before logging:

```ts
unregisterMattermostActionDispatcher(this.platformInstanceId)
```

Add this private reply builder and dispatcher:

```ts
private buildActionReply(): { reply: ReplyFn; getResponse: () => MattermostActionResponse } {
  let response: MattermostActionResponse = { ephemeral_text: 'Action processed.' }
  const setEphemeral = (content: string): Promise<void> => {
    response = { ephemeral_text: content }
    return Promise.resolve()
  }
  const reply: ReplyFn = {
    text: setEphemeral,
    formatted: setEphemeral,
    typing: () => {},
    buttons: (content) => {
      response = { update: { message: content, props: {} } }
      return Promise.resolve()
    },
    replaceText: (content) => {
      response = { update: { message: content, props: {} } }
      return Promise.resolve()
    },
    replaceButtons: (content) => {
      response = { update: { message: content, props: {} } }
      return Promise.resolve()
    },
  }
  return { reply, getResponse: () => response }
}

private async dispatchMattermostAction(payload: MattermostActionPayload): Promise<MattermostActionResponse> {
  const api = this.apiFetch.bind(this)
  const channelInfo = await fetchMattermostChannelInfo(api, payload.channelId)
  const contextType: ContextType = channelInfo.type === 'D' ? 'dm' : 'group'
  const isAdmin = await checkChannelAdmin(payload.channelId, payload.userId, api)
  const incoming: IncomingInteraction = {
    kind: 'button',
    user: { id: payload.userId, username: null, isAdmin },
    contextId: payload.channelId,
    contextType,
    platformInstanceId: this.platformInstanceId,
    storageContextId: contextType === 'dm' ? payload.userId : payload.channelId,
    callbackData: payload.action.callbackData,
    messageId: payload.postId,
    sourceMessageText: payload.action.sourceMessageText,
  }
  const { reply, getResponse } = this.buildActionReply()
  if (this.interactionHandler === null) {
    await reply.text('Action is no longer available.')
    return getResponse()
  }
  await this.interactionHandler(incoming, reply)
  return getResponse()
}
```

- [ ] **Step 8: Run provider tests and commit**

Run: `bun test tests/chat/mattermost/index.test.ts tests/chat/mattermost/action-callbacks.test.ts --path-ignore-patterns ''`

Expected: PASS.

Commit:

```bash
git add src/chat/mattermost/index.ts tests/chat/mattermost/index.test.ts
git commit -m "feat(mattermost): dispatch action callbacks"
```

---

### Task 7: Wire Mattermost Actions Into Web Server And Capabilities

**Files:**

- Modify: `src/debug/server.ts`
- Modify: `src/chat/mattermost/metadata.ts`
- Modify: `tests/debug/server-settings-static.test.ts`
- Modify: `tests/chat/mattermost/metadata.test.ts`

- [ ] **Step 1: Write failing server route test**

In `tests/debug/server-settings-static.test.ts`, import action callback registry and signing:

```ts
import {
  registerMattermostActionDispatcher,
  unregisterMattermostActionDispatcher,
} from '../../src/chat/mattermost/action-callbacks.js'
import { createMattermostActionContext } from '../../src/chat/mattermost/action-signing.js'
```

Add after the debug gating tests:

```ts
describe('Mattermost action route', () => {
  test('is public and available when debug routes are disabled', async () => {
    registerMattermostActionDispatcher('mattermost-main', () => Promise.resolve({ ephemeral_text: 'handled' }))
    const context = createMattermostActionContext(
      {
        platformInstanceId: 'mattermost-main',
        callbackData: 'perm:a:abc12345',
        sourceMessageText: 'prompt',
        expiresAt: Date.now() + 60_000,
      },
      'test-secret',
    )
    const req = new Request('http://bot.test/mattermost/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'user-1', post_id: 'post-1', channel_id: 'chan-1', context }),
    })

    const res = await routeRequestForTest(req, { debugEnabled: false, mattermostActionSecretForTest: 'test-secret' })

    unregisterMattermostActionDispatcher('mattermost-main')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ephemeral_text: 'handled' })
  })
})
```

Add `mattermostActionSecretForTest?: string` to the test route options in the implementation step below.

- [ ] **Step 2: Write failing metadata test**

In `tests/chat/mattermost/metadata.test.ts`, update the capabilities test:

```ts
it('should export capabilities as ReadonlySet', () => {
  expect(mattermostCapabilities.has('users.resolve')).toBe(true)
  expect(mattermostCapabilities.has('messages.buttons')).toBe(true)
  expect(mattermostCapabilities.has('interactions.callbacks')).toBe(true)
})
```

- [ ] **Step 3: Run tests and verify failure**

Run: `bun test tests/debug/server-settings-static.test.ts tests/chat/mattermost/metadata.test.ts`

Expected: FAIL because the web server does not route `/mattermost/actions` and Mattermost capabilities do not include buttons/callbacks.

- [ ] **Step 4: Wire public action route**

In `src/debug/server.ts`, import:

```ts
import { handleMattermostActionRequest, isMattermostActionPath } from '../chat/mattermost/action-callbacks.js'
```

Extend `WebServerRouteOptions`:

```ts
export type WebServerRouteOptions = Readonly<{
  debugEnabled: boolean
  mattermostActionSecretForTest?: string
}>
```

In `routeRequest()`, after public auth routes and before debug-only gating, add:

```ts
if (isMattermostActionPath(req, url)) {
  return handleMattermostActionRequest(req, {
    getSecret:
      options.mattermostActionSecretForTest === undefined ? undefined : () => options.mattermostActionSecretForTest!,
  })
}
```

- [ ] **Step 5: Add Mattermost capabilities**

In `src/chat/mattermost/metadata.ts`, add these entries to `mattermostCapabilities`:

```ts
'interactions.callbacks',
'messages.buttons',
```

- [ ] **Step 6: Run tests and commit**

Run: `bun test tests/debug/server-settings-static.test.ts tests/chat/mattermost/metadata.test.ts`

Expected: PASS.

Commit:

```bash
git add src/debug/server.ts src/chat/mattermost/metadata.ts tests/debug/server-settings-static.test.ts tests/chat/mattermost/metadata.test.ts
git commit -m "feat(mattermost): expose action callback route"
```

---

### Task 8: End-To-End Unit Coverage For Mattermost Permission Callback

**Files:**

- Modify: `tests/chat/mattermost/action-callbacks.test.ts`
- Modify: `tests/chat/mattermost/index.test.ts`
- Modify: `tests/chat/interaction-router.test.ts`

- [ ] **Step 1: Add callback-through-permission test**

In `tests/chat/mattermost/action-callbacks.test.ts`, add this test using the existing helper functions:

```ts
test('returns original prompt plus decision update for permission callbacks', async () => {
  const { askPermissionViaChat, resetPermissionPromptForTesting } =
    await import('../../../src/chat/permission-prompt.js')
  const { routeInteraction } = await import('../../../src/chat/interaction-router.js')
  resetPermissionPromptForTesting()
  const calls: Array<{ options: { buttons?: Array<{ callbackData: string }> } }> = []
  const promptReply = {
    text: () => Promise.resolve(),
    formatted: () => Promise.resolve(),
    typing: () => {},
    buttons: (_content: string, options: { buttons?: Array<{ callbackData: string }> }) => {
      calls.push({ options })
      return Promise.resolve()
    },
  }
  void askPermissionViaChat(promptReply, 'chan-1', { toolName: 'delete_task', reason: 'cleanup' })
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  const callbackData = calls[0]!.options.buttons![0]!.callbackData
  const context = createMattermostActionContext(
    {
      platformInstanceId: 'mattermost-main',
      callbackData,
      sourceMessageText: 'Run `delete_task`?\n\ncleanup',
      expiresAt: Date.now() + 60_000,
    },
    secret,
  )
  registerMattermostActionDispatcher('mattermost-main', async (payload) => {
    let response: { update: { message: string; props: Record<string, unknown> } } | { ephemeral_text: string } = {
      ephemeral_text: 'not handled',
    }
    const reply = {
      text: (content: string) => {
        response = { ephemeral_text: content }
        return Promise.resolve()
      },
      formatted: (content: string) => {
        response = { ephemeral_text: content }
        return Promise.resolve()
      },
      typing: () => {},
      buttons: () => Promise.resolve(),
      replaceText: (content: string) => {
        response = { update: { message: content, props: {} } }
        return Promise.resolve()
      },
    }
    await routeInteraction(
      {
        kind: 'button',
        user: { id: payload.userId, username: null, isAdmin: false },
        contextId: payload.channelId,
        contextType: 'group',
        platformInstanceId: payload.action.platformInstanceId,
        storageContextId: payload.channelId,
        callbackData: payload.action.callbackData,
        messageId: payload.postId,
        sourceMessageText: payload.action.sourceMessageText,
      },
      reply,
      { allowed: true, isBotAdmin: false, isGroupAdmin: false, storageContextId: payload.channelId },
    )
    return response
  })

  const res = await handleMattermostActionRequest(requestWithContext(context), { getSecret: () => secret })

  resetPermissionPromptForTesting()
  expect(await res.json()).toEqual({ update: { message: 'Run `delete_task`?\n\ncleanup\n\nAllowed.', props: {} } })
})
```

- [ ] **Step 2: Run integration-style unit tests**

Run: `bun test tests/chat/mattermost/action-callbacks.test.ts tests/chat/interaction-router.test.ts tests/chat/permission-prompt.test.ts`

Expected: PASS. If this fails, fix only the touched callback and permission routing code until this command passes.

- [ ] **Step 3: Run Mattermost test set**

Run: `bun test tests/chat/mattermost/ tests/chat/interaction-router.test.ts tests/chat/permission-prompt.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit test coverage refinements**

Commit:

```bash
git add tests/chat/mattermost/action-callbacks.test.ts tests/chat/mattermost/index.test.ts tests/chat/interaction-router.test.ts
git commit -m "test(mattermost): cover permission action callbacks"
```

---

### Task 9: Final Verification

**Files:**

- No planned source changes.

- [ ] **Step 1: Run focused server and Mattermost tests**

Run: `bun test tests/debug/server-settings-static.test.ts tests/debug/server.test.ts tests/chat/mattermost/ tests/chat/interaction-router.test.ts tests/chat/permission-prompt.test.ts tests/system-config.test.ts --path-ignore-patterns ''`

Expected: PASS.

- [ ] **Step 2: Run formatter check**

Run: `bun run format:check`

Expected: `All matched files use the correct format.`

- [ ] **Step 3: Run full check**

Run: `bun check:full`

Expected: all checks pass.

- [ ] **Step 4: Inspect final diff**

Run: `git status --short` and `git diff --stat`

Expected: only files from this plan are modified if commits were not made; if each task was committed, the working tree is clean.
