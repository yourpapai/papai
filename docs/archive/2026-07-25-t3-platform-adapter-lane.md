<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# T3 Platform-Adapter Lane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Tier-3 platform-adapter lane (`tests/platform/`) and prove two Mattermost adapter paths — the permalink resolver (`fetch_chat_link`) and the HTTP action-callback route — against the real built image talking to fake platform servers, in-container.

**Architecture:** A new nightly-only lane mirrors the T2 smoke lane's separate-lane structure (`.platform.ts` non-discovered scenarios, a boot-order aggregator, a catalog crosscheck). It reuses T2's `fake-llm-server.ts` and `container.ts` verbatim and extends the shared `fake-mattermost-server.ts` with the two REST endpoints the resolver needs. One narrowly-scoped production seam lets the container accept a known action-signing secret via env, so the test can sign a valid action context. Both Mattermost catalog pends flip from `needs-seam@3` to `executable(provingTier:'3')`.

**Tech Stack:** Bun test, TypeScript (strict), Zod v4, Docker, GitHub Actions.

## Global Constraints

- **SPDX header on every new file.** `.ts` → the 4-line `//` header; `.md` → the HTML-comment header; `.yml` → `#`-comment header. Copy the exact text from any existing file of that type (enforced by `check.sh` `license-headers`).
- **`.js` extension in every import path** (even for `.ts` sources). Strict TypeScript; no `any` leaks; no lint-disable / type-ignore comments (hook-blocked).
- **Zod v4** for all schema validation. **Error extraction:** `error instanceof Error ? error.message : String(error)`.
- **Reuse, don't copy, the T2 harness.** Import `fake-llm-server.ts`, `container.ts`, and the extended `fake-mattermost-server.ts` from `tests/smoke/harness/`. No duplicate harness under `tests/platform/`.
- **T3 is Nightly-only** — never a PR-gating job in `.github/workflows/ci.yml`.
- **The action-secret env seam is opt-in and non-overwriting:** it seeds `system_config[mattermost_action_signing_secret]` only when `PAPAI_MATTERMOST_ACTION_SIGNING_SECRET` is set, via `.onConflictDoNothing({ target: systemConfig.key })`. Absent env → the existing random-generate path is unchanged.
- **Deterministic identity:** the container's Mattermost instance id is `mattermost-default` (`src/instances/bootstrap.ts:95`, `'${chatType}-default'`). The action route is `POST /mattermost/actions` (`src/chat/mattermost/action-callbacks.ts:68`), reachable on the container's published web port before any `debugEnabled` gate.
- **Structured pino logging**, metadata-first; never log secrets/tokens.
- **Scenario titles are contract strings.** Each scenario's human title appears byte-identical in three places: the `PLATFORM_STORIES` registry (Task 3), the `storyIds` of the flipped catalog record (Task 6), and the `title('SCN-…')` value the scenario file resolves. Keep them identical.

---

### Task 1: Extend the shared fake Mattermost server (single-post + thread + seeding + GET capture)

**Files:**
- Modify: `tests/smoke/harness/fake-mattermost-server.ts`
- Test: `tests/smoke/harness/fake-mattermost-server.test.ts` (exists; append cases)

**Interfaces:**
- Consumes: nothing new.
- Produces (added to the `FakeMattermostServer` type):
  - `seedPost(post: SeededPost): void` where
    `export type SeededPost = { id: string; channelId: string; userId: string; message: string; createAt?: number; rootId?: string; userName?: string }`
  - `observedGets(): readonly string[]` — the pathnames of every GET the fake received, in order.
  - New GET handlers: `GET /api/v4/posts/{id}` → the seeded post; `GET /api/v4/posts/{id}/thread` → `{ order, posts }` for the post's thread.

- [ ] **Step 1: Write the failing test**

Append to `tests/smoke/harness/fake-mattermost-server.test.ts`:

```typescript
import { startFakeMattermostServer } from './fake-mattermost-server.js'

describe('fake Mattermost server — T3 post + thread endpoints', () => {
  test('serves a seeded single post and records the GET', async () => {
    const mm = startFakeMattermostServer({ botUserId: 'bot-1', botUsername: 'bot' })
    try {
      mm.seedPost({ id: 'post-1', channelId: 'chan-1', userId: 'author-1', message: 'ship it', createAt: 1_700_000_000_000 })
      const res = await fetch(`${mm.localBaseUrl}/api/v4/posts/post-1`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { id: string; channel_id: string; message: string; create_at: number }
      expect(body).toMatchObject({ id: 'post-1', channel_id: 'chan-1', message: 'ship it', create_at: 1_700_000_000_000 })
      expect(mm.observedGets()).toContain('/api/v4/posts/post-1')
    } finally {
      await mm.stop()
    }
  })

  test('serves a seeded post thread as { order, posts }', async () => {
    const mm = startFakeMattermostServer()
    try {
      mm.seedPost({ id: 'root-1', channelId: 'chan-1', userId: 'author-1', message: 'hello', createAt: 1000 })
      const res = await fetch(`${mm.localBaseUrl}/api/v4/posts/root-1/thread`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { order: string[]; posts: Record<string, { id: string }> }
      expect(body.order).toEqual(['root-1'])
      expect(body.posts['root-1']?.id).toBe('root-1')
      expect(mm.observedGets()).toContain('/api/v4/posts/root-1/thread')
    } finally {
      await mm.stop()
    }
  })

  test('returns 404 for an unseeded single post', async () => {
    const mm = startFakeMattermostServer()
    try {
      const res = await fetch(`${mm.localBaseUrl}/api/v4/posts/missing`)
      expect(res.status).toBe(404)
    } finally {
      await mm.stop()
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/smoke/harness/fake-mattermost-server.test.ts`
Expected: FAIL — `mm.seedPost` / `mm.observedGets` are not functions; `/api/v4/posts/post-1` currently returns `{}` (the catch-all), not the seeded post.

- [ ] **Step 3: Implement the extension**

In `tests/smoke/harness/fake-mattermost-server.ts`:

Add the exported type near the top (after `CapturedPost`):

```typescript
export type SeededPost = {
  id: string
  channelId: string
  userId: string
  message: string
  createAt?: number
  rootId?: string
  userName?: string
}
```

Add these regexes next to the existing `CHANNEL_RE` / `MEMBER_RE`:

```typescript
const POST_SINGLE_RE = /^\/api\/v4\/posts\/([^/]+)$/u
const POST_THREAD_RE = /^\/api\/v4\/posts\/([^/]+)\/thread$/u
```

Inside `startFakeMattermostServer`, add state next to `postBuffer`:

```typescript
const seededPosts = new Map<string, SeededPost>()
const observedGetPaths: string[] = []

const toThreadPost = (post: SeededPost): Record<string, unknown> => ({
  id: post.id,
  user_id: post.userId,
  channel_id: post.channelId,
  message: post.message,
  create_at: post.createAt ?? 0,
  ...(post.rootId === undefined ? {} : { root_id: post.rootId }),
})
```

In `handleHttp`, record every GET and add the two handlers **before** the existing `/api/v4/` catch-all. Change the top of `handleHttp`:

```typescript
  const handleHttp = async (req: Request, url: URL): Promise<Response> => {
    const path = url.pathname
    if (req.method === 'GET') observedGetPaths.push(path)
    if (req.method === 'GET' && path === '/api/v4/users/me') {
      return Response.json({ id: botUserId, username: botUsername })
    }
```

Then, immediately before the `// Tolerate any other v4 GET …` catch-all line, insert:

```typescript
    if (req.method === 'GET') {
      const threadMatch = POST_THREAD_RE.exec(path)
      if (threadMatch !== null) {
        const rootId = threadMatch[1] ?? ''
        const root = seededPosts.get(rootId)
        if (root === undefined) return new Response('not found', { status: 404 })
        const order = [rootId, ...[...seededPosts.values()].filter((p) => p.rootId === rootId).map((p) => p.id)]
        const posts = Object.fromEntries(order.map((id) => [id, toThreadPost(seededPosts.get(id)!)]))
        return Response.json({ order, posts })
      }
      const singleMatch = POST_SINGLE_RE.exec(path)
      if (singleMatch !== null) {
        const post = seededPosts.get(singleMatch[1] ?? '')
        if (post === undefined) return new Response('not found', { status: 404 })
        return Response.json(toThreadPost(post))
      }
    }
```

Extend the returned object with the two new members (next to `deliverMessage`):

```typescript
    seedPost(post) {
      seededPosts.set(post.id, post)
    },
    observedGets() {
      return observedGetPaths.slice()
    },
```

Add both to the `FakeMattermostServer` type:

```typescript
  seedPost(post: SeededPost): void
  observedGets(): readonly string[]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/smoke/harness/fake-mattermost-server.test.ts`
Expected: PASS (all cases, including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add tests/smoke/harness/fake-mattermost-server.ts tests/smoke/harness/fake-mattermost-server.test.ts
git commit -m "test(harness): fake Mattermost single-post + thread endpoints for T3"
```

---

### Task 2: Production seam — env-seeded Mattermost action signing secret

**Files:**
- Modify: `src/chat/mattermost/action-secret.ts`
- Modify: `src/runtime/production-deps.ts:57` area (inside `startDatabase()`, after `bootstrapInstancesFromEnv()`)
- Test: `tests/chat/mattermost/action-secret.test.ts` (exists; append cases)

**Interfaces:**
- Produces: `export function seedMattermostActionSigningSecretFromEnv(): void` — idempotent; reads `PAPAI_MATTERMOST_ACTION_SIGNING_SECRET`; inserts it into `system_config` with `.onConflictDoNothing`; no-op when the env var is unset/blank.

- [ ] **Step 1: Write the failing test**

Append to `tests/chat/mattermost/action-secret.test.ts` (follow the file's existing DB-setup pattern for `getDrizzleDb`/reset; mirror the existing tests' imports):

```typescript
import { seedMattermostActionSigningSecretFromEnv, getMattermostActionSigningSecret } from '../../../src/chat/mattermost/action-secret.js'

describe('seedMattermostActionSigningSecretFromEnv', () => {
  const KEY = 'PAPAI_MATTERMOST_ACTION_SIGNING_SECRET'
  const original = process.env[KEY]
  afterEach(() => {
    if (original === undefined) delete process.env[KEY]
    else process.env[KEY] = original
  })

  test('seeds the configured secret when the env var is set', () => {
    process.env[KEY] = 'known-secret-value'
    seedMattermostActionSigningSecretFromEnv()
    expect(getMattermostActionSigningSecret()).toBe('known-secret-value')
  })

  test('is a no-op when the env var is unset (existing generate path still works)', () => {
    delete process.env[KEY]
    seedMattermostActionSigningSecretFromEnv()
    // getMattermostActionSigningSecret generates + stores a random secret on first read.
    expect(getMattermostActionSigningSecret()).toMatch(/^[A-Za-z0-9_-]+$/u)
  })

  test('never overwrites an already-stored secret', () => {
    const first = getMattermostActionSigningSecret() // generates + stores
    process.env[KEY] = 'different-value'
    seedMattermostActionSigningSecretFromEnv()
    expect(getMattermostActionSigningSecret()).toBe(first)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/chat/mattermost/action-secret.test.ts`
Expected: FAIL — `seedMattermostActionSigningSecretFromEnv` is not exported.

- [ ] **Step 3: Implement the seam**

In `src/chat/mattermost/action-secret.ts`, add after `getMattermostActionSigningSecret`:

```typescript
const getTrimmedEnv = (name: string): string | undefined => {
  const raw = process.env[name]
  if (raw === undefined) return undefined
  const trimmed = raw.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Optionally pin the Mattermost action signing secret from the environment.
 * When PAPAI_MATTERMOST_ACTION_SIGNING_SECRET is set, seed it into system_config
 * once. `onConflictDoNothing` means an already-stored (operator-chosen or
 * previously generated) secret is never overwritten. No-op when the env var is
 * absent, leaving the lazy random-generate path in getMattermostActionSigningSecret.
 */
export function seedMattermostActionSigningSecretFromEnv(): void {
  const configured = getTrimmedEnv('PAPAI_MATTERMOST_ACTION_SIGNING_SECRET')
  if (configured === undefined) return
  getDrizzleDb()
    .insert(systemConfig)
    .values({ key: MATTERMOST_ACTION_SIGNING_SECRET_KEY, value: configured, updatedAt: Date.now(), updatedBy: UPDATED_BY })
    .onConflictDoNothing({ target: systemConfig.key })
    .run()
  log.info({ key: MATTERMOST_ACTION_SIGNING_SECRET_KEY }, 'Mattermost action signing secret seeded from environment')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/chat/mattermost/action-secret.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the seed into startup**

In `src/runtime/production-deps.ts`, import the new function alongside the existing chat imports:

```typescript
import { seedMattermostActionSigningSecretFromEnv } from '../chat/mattermost/action-secret.js'
```

Inside `startDatabase()`, call it after `bootstrapInstancesFromEnv()` (migrations already ran via `initDb()`; `system_config` exists):

```typescript
  const bootstrapResult = bootstrapInstancesFromEnv()
  log.info({ bootstrapResult }, 'instance bootstrap evaluated')
  seedMattermostActionSigningSecretFromEnv()
```

- [ ] **Step 6: Run the surrounding unit suite + typecheck**

Run: `bun test tests/chat/mattermost/action-secret.test.ts && bun run typecheck`
Expected: PASS; no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/chat/mattermost/action-secret.ts src/runtime/production-deps.ts tests/chat/mattermost/action-secret.test.ts
git commit -m "feat(mattermost): env-seedable action signing secret (T3 seam)"
```

---

### Task 3: T3 lane scaffold — registry, aggregator, package script

**Files:**
- Create: `tests/platform/scenarios/catalog.ts`
- Create: `tests/platform/run-platform.ts`
- Modify: `package.json` (add `test:platform` script)

**Interfaces:**
- Produces:
  - `PLATFORM_STORIES` — `Record<string, { scenarioId: string; title: string; file: string }>` (same shape as `tests/smoke/scenarios/catalog.ts`'s `SmokeStory`).
  - `PLATFORM_STORY_IDS` — `Record<string, string>` mapping scenarioId → `"<file>#<title>"`.
  - `platformStoryId(story)` helper.
- The two registry entries define the canonical titles used by Tasks 4, 5, 6.

- [ ] **Step 1: Create the registry**

Create `tests/platform/scenarios/catalog.ts` (with the `.ts` SPDX header):

```typescript
// tests/platform/scenarios/catalog.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type PlatformStory = { scenarioId: string; title: string; file: string }

const FETCH_CHAT_LINK = 'tests/platform/scenarios/mattermost-fetch-chat-link.platform.ts'
const HTTP_ACTION = 'tests/platform/scenarios/mattermost-http-action.platform.ts'

export const PLATFORM_STORIES = {
  'SCN-fetch-chat-link': {
    scenarioId: 'SCN-fetch-chat-link',
    title: 'resolves a Mattermost permalink thread through fetch_chat_link against a fake server',
    file: FETCH_CHAT_LINK,
  },
  'SCN-http-mattermost-action': {
    scenarioId: 'SCN-http-mattermost-action',
    title: 'verifies a signed action context and dispatches over POST /mattermost/actions',
    file: HTTP_ACTION,
  },
} as const satisfies Record<string, PlatformStory>

export function platformStoryId(story: PlatformStory): string {
  return `${story.file}#${story.title}`
}

export const PLATFORM_STORY_IDS: Record<string, string> = Object.fromEntries(
  Object.entries(PLATFORM_STORIES).map(([scenarioId, story]) => [scenarioId, platformStoryId(story)]),
)
```

- [ ] **Step 2: Create the aggregator**

Create `tests/platform/run-platform.ts`:

```typescript
// tests/platform/run-platform.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// Registers every T3 platform lane in boot order. Run explicitly with
// `bun test tests/platform/run-platform.ts`; the `.platform.ts` scenario files
// use a non-discovered suffix so the default `bun test` never runs this Docker lane.
import './scenarios/mattermost-fetch-chat-link.platform.js'
import './scenarios/mattermost-http-action.platform.js'
```

- [ ] **Step 3: Add the package script**

In `package.json`, add next to `test:smoke`:

```json
    "test:platform": "bun test ./tests/platform/run-platform.ts",
```

- [ ] **Step 4: Verify the scaffold typechecks (aggregator imports resolve after Tasks 4–5)**

Run: `bun run typecheck`
Expected: FAIL only on the two not-yet-created scenario imports in `run-platform.ts` (they land in Tasks 4–5). Confirm `catalog.ts` itself has no errors: `bun run typecheck 2>&1 | grep -i catalog.ts` returns nothing.

> Note: do not commit yet — `run-platform.ts` references scenario files created in Tasks 4–5. Commit at the end of Task 5 so the tree stays typecheck-green at every committed boundary. (Steps that create the scenarios follow.)

---

### Task 4: Scenario — `SCN-fetch-chat-link` (resolver against the fake)

**Files:**
- Create: `tests/platform/scenarios/mattermost-fetch-chat-link.platform.ts`

**Interfaces:**
- Consumes: `buildContainerEnv`, `startPapaiContainer`, `PapaiContainer` from `../../smoke/harness/container.js`; `startFakeLlmServer`, `toolResponse`, `textResponse` from `../../smoke/harness/fake-llm-server.js`; `startFakeMattermostServer` + `seedPost`/`observedGets` from `../../smoke/harness/fake-mattermost-server.js`; `ensurePapaiE2eImage` from `../../smoke/harness/image.js`; `isDockerAvailable` from `../../smoke/harness/docker.js`; `PLATFORM_STORIES` from `./catalog.js`.
- Produces: a `title('SCN-fetch-chat-link')` test that drives one chat turn whose tool loop calls `fetch_chat_link` with a `/pl/<postId>` permalink and asserts the fake observed the single-post + thread GETs.

- [ ] **Step 1: Write the scenario (it is the test)**

Create `tests/platform/scenarios/mattermost-fetch-chat-link.platform.ts`:

```typescript
// tests/platform/scenarios/mattermost-fetch-chat-link.platform.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { buildContainerEnv, startPapaiContainer, type PapaiContainer } from '../../smoke/harness/container.js'
import { isDockerAvailable } from '../../smoke/harness/docker.js'
import { startFakeLlmServer, textResponse, toolResponse, type FakeLlmServer } from '../../smoke/harness/fake-llm-server.js'
import { startFakeMattermostServer, type FakeMattermostServer } from '../../smoke/harness/fake-mattermost-server.js'
import { ensurePapaiE2eImage } from '../../smoke/harness/image.js'
import { PLATFORM_STORIES } from './catalog.js'

const ADMIN_USER_ID = 'admin-user-1'
const title = (key: keyof typeof PLATFORM_STORIES): string => PLATFORM_STORIES[key].title

const DOCKER = await isDockerAvailable()
if (!DOCKER) console.warn('[platform] Docker unavailable — skipping T3 fetch-chat-link lane')

type Handle = { container: PapaiContainer; llm: FakeLlmServer; mm: FakeMattermostServer; stopped: boolean }
let handle: Handle | undefined

describe.skipIf(!DOCKER)('T3 Mattermost — fetch_chat_link resolver', () => {
  beforeAll(async () => {
    await ensurePapaiE2eImage()
    const llm = startFakeLlmServer()
    const mm = startFakeMattermostServer({ botUserId: 'bot-user-1', botUsername: 'smokebot' })
    try {
      const container = await startPapaiContainer({
        env: buildContainerEnv({ llmBaseUrl: llm.containerBaseUrl, mattermostUrl: mm.containerBaseUrl }),
        readyTimeoutMs: 90_000,
      })
      handle = { container, llm, mm, stopped: false }
    } catch (error) {
      await mm.stop()
      await llm.stop()
      throw error
    }
  }, 180_000)

  afterAll(async () => {
    if (handle === undefined) return
    if (!handle.stopped) await handle.container.stop().catch(() => undefined)
    await handle.container.remove().catch(() => undefined)
    await handle.mm.stop()
    await handle.llm.stop()
  })

  test(
    title('SCN-fetch-chat-link'),
    async () => {
      await handle!.mm.whenConnected()
      handle!.mm.seedPost({
        id: 'post-1',
        channelId: 'dm-chat',
        userId: 'author-1',
        message: 'ship the release notes',
        createAt: 1_700_000_000_000,
      })
      const permalink = `${handle!.mm.containerBaseUrl}/team/pl/post-1`
      handle!.llm.enqueue([
        toolResponse('call_load', 'load_tool', { names: ['fetch_chat_link'] }),
        toolResponse('call_fetch', 'fetch_chat_link', { url: permalink, scope: 'thread' }),
        textResponse('Summarized the linked thread.'),
      ])
      const status = handle!.mm.waitForPost()
      handle!.mm.deliverMessage({
        channelId: 'dm-chat',
        message: `summarize ${permalink}`,
        userId: ADMIN_USER_ID,
      })
      await status
      const reply = await handle!.mm.waitForPost()
      expect(reply.message).toContain('Summarized the linked thread.')
      // The real adapter resolved the permalink through the fake REST API end to end.
      expect(handle!.mm.observedGets()).toContain('/api/v4/posts/post-1')
      expect(handle!.mm.observedGets()).toContain('/api/v4/posts/post-1/thread')
    },
    60_000,
  )
})
```

- [ ] **Step 2: Run it (Docker required) to verify it passes**

Run: `bun test tests/platform/scenarios/mattermost-fetch-chat-link.platform.ts`
Expected: PASS with Docker available (boots the image, resolves the permalink); SKIPPED with a `[platform] Docker unavailable` warning otherwise.

> If the tool loop needs a different disclosure shape than `load_tool` → `fetch_chat_link` → text, inspect the container logs (`docker logs`) the harness prints on failure and align the enqueued responses; the container-P `SCN-chat-turn-tool-loop` scenario is the reference for the loop shape.

- [ ] **Step 3: Confirm the title matches the registry**

Run: `grep -c "resolves a Mattermost permalink thread through fetch_chat_link against a fake server" tests/platform/scenarios/mattermost-fetch-chat-link.platform.ts`
Expected: `1` (the title string is byte-identical to `PLATFORM_STORIES['SCN-fetch-chat-link'].title`).

---

### Task 5: Scenario — `SCN-http-mattermost-action` (signed-context dispatch)

**Files:**
- Create: `tests/platform/scenarios/mattermost-http-action.platform.ts`
- Test: this scenario file is the test.

**Interfaces:**
- Consumes: the same harness imports as Task 4, plus `createMattermostActionContext` from `../../../src/chat/mattermost/action-signing.js`.
- Produces: a `title('SCN-http-mattermost-action')` test that POSTs a context signed with the env-seeded secret to `POST /mattermost/actions` and asserts verify+dispatch (200, no `error`, not "no longer available"); a wrong-secret control asserts the rejection body.

- [ ] **Step 1: Write the scenario**

Create `tests/platform/scenarios/mattermost-http-action.platform.ts`:

```typescript
// tests/platform/scenarios/mattermost-http-action.platform.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { createMattermostActionContext } from '../../../src/chat/mattermost/action-signing.js'
import { buildContainerEnv, startPapaiContainer, type PapaiContainer } from '../../smoke/harness/container.js'
import { isDockerAvailable } from '../../smoke/harness/docker.js'
import { startFakeLlmServer, type FakeLlmServer } from '../../smoke/harness/fake-llm-server.js'
import { startFakeMattermostServer, type FakeMattermostServer } from '../../smoke/harness/fake-mattermost-server.js'
import { ensurePapaiE2eImage } from '../../smoke/harness/image.js'
import { PLATFORM_STORIES } from './catalog.js'

const ADMIN_USER_ID = 'admin-user-1'
const CHANNEL_ID = 'chan-1'
const KNOWN_SECRET = 'smoke-t3-action-secret'
const title = (key: keyof typeof PLATFORM_STORIES): string => PLATFORM_STORIES[key].title

const DOCKER = await isDockerAvailable()
if (!DOCKER) console.warn('[platform] Docker unavailable — skipping T3 http-action lane')

type Handle = { container: PapaiContainer; llm: FakeLlmServer; mm: FakeMattermostServer; stopped: boolean }
let handle: Handle | undefined

const signedContext = (secret: string): unknown =>
  createMattermostActionContext(
    {
      platformInstanceId: 'mattermost-default',
      channelId: CHANNEL_ID,
      callbackData: 'perm:d:nonexistent-prompt',
      sourceMessageText: 'do the thing',
      expiresAt: 1_700_000_000_000 + 3_600_000,
    },
    secret,
  )

const postAction = (webBaseUrl: string, context: unknown): Promise<Response> =>
  fetch(`${webBaseUrl}/mattermost/actions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ user_id: ADMIN_USER_ID, post_id: 'post-1', channel_id: CHANNEL_ID, context }),
  })

describe.skipIf(!DOCKER)('T3 Mattermost — HTTP action callback', () => {
  beforeAll(async () => {
    await ensurePapaiE2eImage()
    const llm = startFakeLlmServer()
    const mm = startFakeMattermostServer({ botUserId: 'bot-user-1', botUsername: 'smokebot' })
    try {
      const container = await startPapaiContainer({
        env: {
          ...buildContainerEnv({ llmBaseUrl: llm.containerBaseUrl, mattermostUrl: mm.containerBaseUrl }),
          PAPAI_MATTERMOST_ACTION_SIGNING_SECRET: KNOWN_SECRET,
        },
        readyTimeoutMs: 90_000,
      })
      handle = { container, llm, mm, stopped: false }
    } catch (error) {
      await mm.stop()
      await llm.stop()
      throw error
    }
  }, 180_000)

  afterAll(async () => {
    if (handle === undefined) return
    if (!handle.stopped) await handle.container.stop().catch(() => undefined)
    await handle.container.remove().catch(() => undefined)
    await handle.mm.stop()
    await handle.llm.stop()
  })

  test(
    title('SCN-http-mattermost-action'),
    async () => {
      await handle!.mm.whenConnected() // adapter started -> dispatcher registered for mattermost-default
      const res = await postAction(handle!.container.webBaseUrl, signedContext(KNOWN_SECRET))
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      // Verify passed (not a bad-signature/expired/shape error) and a dispatcher was found.
      expect(body).not.toHaveProperty('error')
      expect(body).not.toEqual({ ephemeral_text: 'Action is no longer available.' })
    },
    60_000,
  )

  test('rejects a context signed with the wrong secret (seam gates)', async () => {
    const res = await postAction(handle!.container.webBaseUrl, signedContext('a-different-secret'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toEqual({ error: { message: 'This action is no longer valid.' } })
  })
})
```

- [ ] **Step 2: Run it (Docker required) to verify it passes**

Run: `bun test tests/platform/scenarios/mattermost-http-action.platform.ts`
Expected: PASS with Docker (positive dispatch + wrong-secret rejection); SKIPPED otherwise.

> The wrong-secret case proves the container verifies against the env-seeded secret; the positive case proves the same secret verifies and routes to the registered `mattermost-default` dispatcher. If the positive body unexpectedly carries `error`, inspect `docker logs` — a thrown dispatcher yields `{ error: { message: 'Unable to process action.' } }`, which correctly fails this assertion.

- [ ] **Step 3: Typecheck the whole scaffold now that both scenarios exist**

Run: `bun run typecheck`
Expected: PASS — `run-platform.ts`'s imports now resolve.

- [ ] **Step 4: Commit the scaffold + both scenarios**

```bash
git add tests/platform/ package.json
git commit -m "test(platform): T3 lane scaffold + Mattermost fetch-chat-link and http-action scenarios"
```

---

### Task 6: Flip both catalog pends to executable@3 + make tier 3 live + crosscheck

**Files:**
- Modify: `tests/stories/catalog/coverage.ts` (add `'3'` to `LIVE_STORY_TIERS`; move `SCN-fetch-chat-link` + `SCN-http-mattermost-action` from `AUDIT_RECORDS` into `EXECUTABLE_STORY_MAPPINGS`)
- Modify: `tests/stories/harness/catalog-coverage.test.ts` (update the counts/sets the flip changes)
- Create: `tests/platform/catalog-crosscheck.test.ts`

**Interfaces:**
- Consumes: `PLATFORM_STORIES`, `PLATFORM_STORY_IDS` from `tests/platform/scenarios/catalog.ts`; `catalogCoverage` from `tests/stories/catalog/coverage.ts`.
- Produces: two `provingTier:'3'` executable records; a crosscheck test binding them to invoked `.platform.ts` scenarios.

- [ ] **Step 1: Write the failing crosscheck test**

Create `tests/platform/catalog-crosscheck.test.ts` (mirrors `tests/smoke/catalog-crosscheck.test.ts`):

```typescript
// tests/platform/catalog-crosscheck.test.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { repoRoot } from '../smoke/harness/docker.js'
import { catalogCoverage } from '../stories/catalog/coverage.js'
import { PLATFORM_STORIES, PLATFORM_STORY_IDS } from './scenarios/catalog.js'

describe('@3 catalog crosscheck', () => {
  test('every @3 catalog record maps one-to-one to a PLATFORM_STORIES id', () => {
    const executable = catalogCoverage.filter(
      (coverage): coverage is Extract<(typeof catalogCoverage)[number], { kind: 'executable' }> =>
        coverage.kind === 'executable',
    )
    const t3 = executable.filter((coverage) => coverage.provingTier === '3')

    expect(t3).toHaveLength(2)
    const byScenario: Map<string, readonly string[]> = new Map(
      t3.map((coverage) => [coverage.scenarioId, coverage.storyIds]),
    )
    for (const [scenarioId, storyId] of Object.entries(PLATFORM_STORY_IDS)) {
      expect(byScenario.get(scenarioId)).toEqual([storyId])
    }
    for (const coverage of t3) expect(PLATFORM_STORY_IDS[coverage.scenarioId]).toBeDefined()
  })

  test('each scenario file actually invokes its scenario id under that title', async () => {
    for (const story of Object.values(PLATFORM_STORIES)) {
      const bytes = await Bun.file(`${repoRoot()}${story.file}`).text()
      expect(bytes.includes(`title('${story.scenarioId}')`)).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test --path-ignore-patterns '' tests/platform/catalog-crosscheck.test.ts`
Expected: FAIL — `t3` has length 0 (records not yet flipped).

- [ ] **Step 3: Make tier 3 live**

In `tests/stories/catalog/coverage.ts:16`:

```typescript
export const LIVE_STORY_TIERS: readonly StoryTier[] = Object.freeze(['0', '1', '2', '3'])
```

- [ ] **Step 4: Move the two records from pending to executable**

In `tests/stories/catalog/coverage.ts`, **delete** the `'SCN-fetch-chat-link'` and `'SCN-http-mattermost-action'` entries from `AUDIT_RECORDS` (the `needs('F3', …)` and `needs('F4', …)` blocks around lines 1171–1183). Keep the `// F3 —` / `// F4 —` comments only if other entries remain under them (they don't for these two — remove the now-empty comment lines).

**Add** to `EXECUTABLE_STORY_MAPPINGS`, immediately after the `@2` block (after `SCN-graceful-shutdown`), a `@3` block:

```typescript
  // @3 — platform-adapter lane (nightly); storyIds are byte-identical to PLATFORM_STORY_IDS.
  'SCN-fetch-chat-link': {
    verifiedAt: '2026-07-25',
    provingTier: '3',
    storyIds: [
      'tests/platform/scenarios/mattermost-fetch-chat-link.platform.ts#resolves a Mattermost permalink thread through fetch_chat_link against a fake server',
    ],
  },
  'SCN-http-mattermost-action': {
    verifiedAt: '2026-07-25',
    provingTier: '3',
    storyIds: [
      'tests/platform/scenarios/mattermost-http-action.platform.ts#verifies a signed action context and dispatches over POST /mattermost/actions',
    ],
  },
```

- [ ] **Step 5: Update the catalog-coverage audit expectations**

In `tests/stories/harness/catalog-coverage.test.ts`, apply exactly these edits (2 records moved pending→executable):

- Line ~216: `.toHaveLength(138)` → `.toHaveLength(140)`
- Line ~225: `expect(executable).toHaveLength(138)` → `.toHaveLength(140)`
- Line ~227: `new Set(['0', '1', '2'])` → `new Set(['0', '1', '2', '3'])`
- Line ~305: `expect(pendingIds).toHaveLength(27)` → `.toHaveLength(25)`
- Lines ~342–351 (the seam-pending sorted list): remove `'SCN-fetch-chat-link'` and `'SCN-http-mattermost-action'`, leaving:

```typescript
    expect(sorted(seamPending.map(({ scenarioId }) => scenarioId))).toEqual([
      'SCN-interaction-discord-router-wrapped',
      'SCN-interaction-discord-standalone-fallback',
      'SCN-interaction-telegram-callback',
    ])
    expect(unblockingTiers).toEqual(['3', '3', '3'])
```

- Line ~354: `expect(states.filter((state) => state === 'needs-seam')).toHaveLength(5)` → `.toHaveLength(3)`

> The `FAMILY_QUEUE_EXPECTATIONS` prefixes `['SCN-fetch-', 'F3']` and `['SCN-http-', 'F4']` may be left as-is: the `familyQueueMismatches` check only asserts every *pending* scenario matches a prefix, never that every prefix matches a pending, so an unused prefix is harmless.

- [ ] **Step 6: Run the full catalog audit + crosscheck to verify green**

Run:
```bash
bun test --path-ignore-patterns '' tests/stories/harness/catalog-coverage.test.ts
bun test --path-ignore-patterns '' tests/platform/catalog-crosscheck.test.ts
```
Expected: both PASS. If the catalog audit reports a count/set mismatch, reconcile the number it prints against Step 5 (the flip moves exactly 2 records).

- [ ] **Step 7: Confirm no other suite asserted the old counts**

Run: `bun test --path-ignore-patterns '' tests/smoke/catalog-crosscheck.test.ts`
Expected: PASS (the `@2` crosscheck's `toHaveLength(8)` is unaffected by the flip).

- [ ] **Step 8: Commit**

```bash
git add tests/stories/catalog/coverage.ts tests/stories/harness/catalog-coverage.test.ts tests/platform/catalog-crosscheck.test.ts
git commit -m "feat(catalog): open tier 3 live; flip both Mattermost pends to executable@3"
```

---

### Task 7: CI nightly job + docs

**Files:**
- Create: `.github/workflows/nightly.yml`
- Modify: `tests/CLAUDE.md` (add a T3 subsection)

**Interfaces:**
- Consumes: the `test:platform` script (Task 3), `papai:e2e` image build (mirrors the `smoke` job).
- Produces: a scheduled `platform` job; documentation of the lane.

- [ ] **Step 1: Create the nightly workflow**

Create `.github/workflows/nightly.yml` (mirror the `smoke` job in `ci.yml:171-197`, but `on: schedule`; T3 is never a PR gate):

```yaml
# SPDX-License-Identifier: BUSL-1.1
# Copyright (c) 2026 Dmitriy Lazarev
# Use of this software is governed by the Business Source License 1.1.
# See LICENSE in the project root for details.

name: Nightly

on:
  schedule:
    - cron: '0 3 * * *'
  workflow_dispatch: {}

permissions:
  contents: read

jobs:
  platform:
    name: T3 Platform-Adapter Lane
    runs-on: ubuntu-latest
    # Backstop for a hung container or an unreachable host fake. The lane is two full
    # boots. Replace this value with the measured lane time (rounded up to ~2x) after
    # the first green nightly run, matching the T2 smoke job's methodology.
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
      - uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0
        with:
          bun-version: 1.3.13
      - name: Set up Docker
        uses: docker/setup-buildx-action@bb05f3f5519dd87d3ba754cc423b652a5edd6d2c # v4.2.0
        with:
          driver: docker
      - name: Install dependencies
        run: bun install
      - name: Build papai:e2e image
        run: docker build -t papai:e2e .
      - name: Run T3 platform lane
        # host.docker.internal resolves via --add-host (set by the harness).
        timeout-minutes: 6
        run: bun run test:platform
      - name: Upload platform reports
        if: always()
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        with:
          name: platform-adapter-reports
          path: reports/platform/**
          if-no-files-found: warn
          retention-days: 14
```

- [ ] **Step 2: Validate the workflow YAML**

Run: `bun x --yes js-yaml .github/workflows/nightly.yml >/dev/null && echo OK`
Expected: `OK` (well-formed YAML). If `js-yaml` is unavailable, visually confirm indentation matches the `smoke` job in `ci.yml`.

- [ ] **Step 3: Document the lane**

In `tests/CLAUDE.md`, add a subsection near the tier descriptions:

```markdown
### Tier 3 — platform-adapter lane (`tests/platform/`, nightly)

Real adapter code (Mattermost) exercised in-container against fake platform
servers (HTTP/WS), reusing the T2 harness (`tests/smoke/harness/`). Scenario
files use the non-discovered `.platform.ts` suffix, so the default `bun test`
never boots Docker. Run locally with `bun run test:platform`. The lane is
**nightly only** (`.github/workflows/nightly.yml`), never a PR gate. Live
scenarios: `SCN-fetch-chat-link` (permalink resolver) and
`SCN-http-mattermost-action` (signed action-callback route). The Discord and
Telegram interaction pends remain `needs-seam@3`, deferred until fake
discord.js / grammY servers exist. The action-callback scenario relies on the
`PAPAI_MATTERMOST_ACTION_SIGNING_SECRET` env seam so the container verifies
against a test-known secret.
```

- [ ] **Step 4: Confirm CI stays a non-gate for T3**

Run: `grep -n "test:platform\|tests/platform" .github/workflows/ci.yml`
Expected: no matches (T3 is absent from the PR-gating workflow).

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/nightly.yml tests/CLAUDE.md
git commit -m "ci: nightly T3 platform-adapter lane + docs"
```

---

## Self-Review

**Spec coverage** (each spec section → task):
- §1 Lane scaffold → Task 3 (`tests/platform/`, `run-platform.ts`, `test:platform`) + Task 6 Step 3 (`LIVE_STORY_TIERS += '3'`).
- §2 Fake server extension → Task 1 (single-post + thread endpoints, `seedPost`, `observedGets`, in the shared harness).
- §3 `SCN-fetch-chat-link` → Task 4 + Task 6 record flip.
- §4 `SCN-http-mattermost-action` + env seam → Task 2 (seam) + Task 5 (scenario) + Task 6 record flip.
- §5 Catalog crosscheck → Task 6 (`tests/platform/catalog-crosscheck.test.ts`).
- §6 CI Nightly → Task 7 (`nightly.yml`, absent from `ci.yml`).
- §7 Docs → Task 7 (`tests/CLAUDE.md`).

**Placeholder scan:** no TBD/TODO; every code step shows complete code; catalog-audit edits give exact line targets and before→after values.

**Type consistency:** `SeededPost` (Task 1) is used by Task 4's `seedPost` call. `PLATFORM_STORIES`/`PLATFORM_STORY_IDS` (Task 3) are consumed identically by Tasks 4, 5 (`title`) and Task 6 (crosscheck). The signed-context shape matches `MattermostActionContextInput` (`createMattermostActionContext` from `action-signing.ts`) and the request body matches `MattermostActionRequestSchema` (`{ user_id, post_id, channel_id, context }`). `platformInstanceId: 'mattermost-default'` matches `seedInstances`' `'${chatType}-default'`. Scenario titles are byte-identical across registry, storyIds, and `title()` calls.

**Global-constraint check:** every created file lists its SPDX header; all imports use `.js`; the env seam uses `onConflictDoNothing`; T3 never appears in `ci.yml`.

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-25-t3-platform-adapter-lane.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
