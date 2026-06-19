<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Follow Mattermost Chat Links (`fetch_chat_link`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a capability-gated `fetch_chat_link` LLM tool that resolves a Mattermost permalink the user shares into the linked message — or its whole thread — as structured, name-resolved messages, gated by the requesting user's channel membership.

**Architecture:** A dedicated resolver module (`src/chat/mattermost/link-resolver.ts`) reads the conversation's platform-instance config (decrypted `baseUrl` + bot token) from the instances store and issues Mattermost REST calls via an extracted `makeMattermostApiFetch` helper. A thin tool wrapper (`src/tools/fetch-chat-link.ts`) calls the resolver. The tool is registered in `provider-independent-tools-builder.ts` only when the conversation's instance is Mattermost (derived from the scoped `contextId`) and a requester id is present. No `ChatProvider` interface change.

**Tech Stack:** TypeScript (strict, `.js` import paths), Bun test runner, Zod v4, Vercel AI SDK `tool()`, `p-limit` for bounded concurrency, `pino` logging.

**Spec:** `docs/superpowers/specs/2026-06-19-follow-mattermost-chat-links-design.md`

**Deviation from spec (intentional):** The spec listed editing `src/tools/types.ts` (add `platformInstanceId`) and `src/llm-orchestrator-tools.ts`. During planning we found `platformInstanceId` is derivable from the scoped `contextId` directly inside the tool builder via `parseScopedContextId`, so those two edits are dropped — gating lives entirely in `provider-independent-tools-builder.ts`.

---

## Conventions for every task

- Work on the current branch (`master`). Do **not** create a worktree.
- Every new file starts with the BUSL license header:
  ```ts
  // SPDX-License-Identifier: BUSL-1.1
  // Copyright (c) 2026 Dmitriy Lazarev
  // Use of this software is governed by the Business Source License 1.1.
  // See LICENSE in the project root for details.
  ```
- Use `.js` extensions in all import paths.
- Never add `eslint-disable`/`@ts-ignore`/`@ts-expect-error`/`as`-assertions — hook policy blocks them.
- No `await` inside a `for`/`while` loop in `src/` (`no-await-in-loop`); use `Promise.all` + `p-limit`.
- After each task, the TDD write-hook runs the targeted test + coverage automatically. The commit `bash` step shows what to stage.
- Run a single test file with: `bun test <path>` (serial, fine for one file).

---

## File Structure

**New files**

- `src/chat/mattermost/api-fetch.ts` — `makeMattermostApiFetch(baseUrl, token)` factory + `MattermostApiError` (carries HTTP status). Single responsibility: authenticated Mattermost REST fetch.
- `src/chat/mattermost/link-resolver.ts` — `parseMattermostPermalink`, `resolveChatLink`, `ChatLinkError`, and the result/message types. Single responsibility: turn a permalink + requester into structured messages.
- `src/tools/fetch-chat-link.ts` — `makeFetchChatLinkTool` factory. Single responsibility: the AI-SDK tool surface over the resolver.

**Modified files**

- `src/chat/mattermost/index.ts` — refactor the private `apiFetch` to delegate to `makeMattermostApiFetch`.
- `src/chat/mattermost/schema.ts` — add `MattermostThreadPostSchema` + `MattermostPostListSchema`.
- `src/tools/tool-metadata.ts` — add the `fetch_chat_link` classification.
- `src/tools/provider-independent-tools-builder.ts` — gate + register the tool.
- `src/system-prompt.ts` — add the permission-aware usage fragment.

**New test files**

- `tests/chat/mattermost/api-fetch.test.ts`
- `tests/chat/mattermost/link-resolver.test.ts`
- `tests/tools/fetch-chat-link.test.ts`
- `tests/tools/fetch-chat-link-gating.test.ts`
- `tests/system-prompt-chat-link.test.ts`
- `tests/chat/mattermost/schema-thread.test.ts`

---

## Task 1: Extract `makeMattermostApiFetch` + `MattermostApiError`

**Files:**

- Create: `src/chat/mattermost/api-fetch.ts`
- Test: `tests/chat/mattermost/api-fetch.test.ts`
- Modify: `src/chat/mattermost/index.ts` (constructor + private `apiFetch`, lines ~68-99, ~287-295)

Today the provider inlines the fetch closure (`index.ts:287-295`) and loses the HTTP status on failure. The resolver needs the status to distinguish "not accessible" (403/404) from transient errors. Extract a reusable factory that throws a status-carrying error.

- [ ] **Step 1: Write the failing test**

Create `tests/chat/mattermost/api-fetch.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { MattermostApiError, makeMattermostApiFetch } from '../../../src/chat/mattermost/api-fetch.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

describe('makeMattermostApiFetch', () => {
  afterEach(() => {
    restoreFetch()
  })

  test('GET returns parsed JSON and sends bearer auth to baseUrl', async () => {
    const seen: { url: string; auth: string | null } = { url: '', auth: null }
    setMockFetch((url, init) => {
      seen.url = url
      const headers = new Headers(init.headers)
      seen.auth = headers.get('Authorization')
      return Promise.resolve(new Response(JSON.stringify({ id: 'p1' }), { status: 200 }))
    })

    const apiFetch = makeMattermostApiFetch('https://mm.example.com', 'tok-123')
    const result = await apiFetch('GET', '/api/v4/posts/p1', undefined)

    expect(result).toEqual({ id: 'p1' })
    expect(seen.url).toBe('https://mm.example.com/api/v4/posts/p1')
    expect(seen.auth).toBe('Bearer tok-123')
  })

  test('non-2xx throws MattermostApiError carrying the status', async () => {
    setMockFetch(() => Promise.resolve(new Response('nope', { status: 404 })))
    const apiFetch = makeMattermostApiFetch('https://mm.example.com', 'tok')

    const error = await apiFetch('GET', '/api/v4/posts/x', undefined).then(
      () => null,
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(MattermostApiError)
    expect(error).toBeInstanceOf(Error)
    expect((error as MattermostApiError).status).toBe(404)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/chat/mattermost/api-fetch.test.ts`
Expected: FAIL — `Cannot find module '.../api-fetch.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/chat/mattermost/api-fetch.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { MattermostApiFetch } from './file-helpers.js'

/** Error thrown by the Mattermost REST helper, carrying the HTTP status for classification. */
export class MattermostApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'MattermostApiError'
  }
}

/** Build an authenticated Mattermost REST fetch bound to one instance's baseUrl + bot token. */
export function makeMattermostApiFetch(baseUrl: string, token: string): MattermostApiFetch {
  return async (method, path, body) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!res.ok) {
      throw new MattermostApiError(`Mattermost API ${method} ${path} failed: ${res.status}`, res.status)
    }
    return res.json() as Promise<unknown>
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/chat/mattermost/api-fetch.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Refactor the provider to delegate**

In `src/chat/mattermost/index.ts`:

Add the import near the other `./` imports (after line 29):

```ts
import { makeMattermostApiFetch } from './api-fetch.js'
```

Add a field next to the other private fields (after line 70 `private readonly platformInstanceId: string`):

```ts
  private readonly mmFetch: import('./file-helpers.js').MattermostApiFetch
```

In the constructor, after `this.platformInstanceId = resolved.platformInstanceId` (line 83), add:

```ts
this.mmFetch = makeMattermostApiFetch(this.baseUrl, this.token)
```

Replace the private `apiFetch` method body (lines 287-295) with a delegation:

```ts
  private apiFetch(method: string, path: string, body: unknown): Promise<unknown> {
    return this.mmFetch(method, path, body)
  }
```

- [ ] **Step 6: Run the Mattermost provider suite to confirm no regression**

Run: `bun test tests/chat/mattermost/`
Expected: PASS (existing suites still green — `MattermostApiError` extends `Error` with the same message format).

- [ ] **Step 7: Commit**

```bash
git add src/chat/mattermost/api-fetch.ts tests/chat/mattermost/api-fetch.test.ts src/chat/mattermost/index.ts
git commit -m "refactor(mattermost): extract makeMattermostApiFetch with status-carrying error"
```

---

## Task 2: Thread schemas

**Files:**

- Modify: `src/chat/mattermost/schema.ts`
- Test: `tests/chat/mattermost/schema-thread.test.ts`

The existing `MattermostPostSchema` lacks `create_at` (needed for timestamps) and there is no schema for the thread `PostList` response.

- [ ] **Step 1: Write the failing test**

Create `tests/chat/mattermost/schema-thread.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { MattermostPostListSchema, MattermostThreadPostSchema } from '../../../src/chat/mattermost/schema.js'

describe('Mattermost thread schemas', () => {
  test('MattermostThreadPostSchema parses a post with create_at', () => {
    const parsed = MattermostThreadPostSchema.parse({
      id: 'p1',
      user_id: 'u1',
      channel_id: 'c1',
      message: 'hello',
      create_at: 1700000000000,
    })
    expect(parsed.create_at).toBe(1700000000000)
    expect(parsed.id).toBe('p1')
  })

  test('MattermostPostListSchema parses order + posts map', () => {
    const parsed = MattermostPostListSchema.parse({
      order: ['p2', 'p1'],
      posts: {
        p1: { id: 'p1', user_id: 'u1', channel_id: 'c1', message: 'root', create_at: 1 },
        p2: { id: 'p2', user_id: 'u2', channel_id: 'c1', message: 'reply', create_at: 2, root_id: 'p1' },
      },
    })
    expect(parsed.order).toEqual(['p2', 'p1'])
    expect(parsed.posts['p2']?.root_id).toBe('p1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/chat/mattermost/schema-thread.test.ts`
Expected: FAIL — `MattermostThreadPostSchema` / `MattermostPostListSchema` are not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/chat/mattermost/schema.ts`, after the `MattermostPost` type (line 59), add:

```ts
export const MattermostThreadPostSchema = MattermostPostSchema.extend({
  create_at: z.number(),
})
export type MattermostThreadPost = z.infer<typeof MattermostThreadPostSchema>

export const MattermostPostListSchema = z.object({
  order: z.array(z.string()),
  posts: z.record(z.string(), MattermostThreadPostSchema),
})
export type MattermostPostList = z.infer<typeof MattermostPostListSchema>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/chat/mattermost/schema-thread.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/chat/mattermost/schema.ts tests/chat/mattermost/schema-thread.test.ts
git commit -m "feat(mattermost): add thread post + post-list schemas"
```

---

## Task 3: Permalink parser

**Files:**

- Create: `src/chat/mattermost/link-resolver.ts` (parser + types only in this task)
- Test: `tests/chat/mattermost/link-resolver.test.ts` (parser describe block)

`parseMattermostPermalink(url, baseUrl)` returns the post id only when the link's host matches the instance baseUrl host and the path is a `/pl/<postId>` permalink; otherwise `null`. The resolver (Task 4) turns `null` into an invalid-input failure.

- [ ] **Step 1: Write the failing test**

Create `tests/chat/mattermost/link-resolver.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { parseMattermostPermalink } from '../../../src/chat/mattermost/link-resolver.js'

describe('parseMattermostPermalink', () => {
  const base = 'https://mm.example.com'

  test('extracts post id from a permalink on the same host', () => {
    expect(parseMattermostPermalink('https://mm.example.com/eng/pl/abc123', base)).toBe('abc123')
  })

  test('tolerates a trailing slash', () => {
    expect(parseMattermostPermalink('https://mm.example.com/eng/pl/abc123/', base)).toBe('abc123')
  })

  test('rejects a link on a different host', () => {
    expect(parseMattermostPermalink('https://evil.example.com/eng/pl/abc123', base)).toBeNull()
  })

  test('rejects a non-permalink path', () => {
    expect(parseMattermostPermalink('https://mm.example.com/eng/channels/town-square', base)).toBeNull()
  })

  test('rejects a non-URL string', () => {
    expect(parseMattermostPermalink('not a url', base)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/chat/mattermost/link-resolver.test.ts`
Expected: FAIL — module `link-resolver.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `src/chat/mattermost/link-resolver.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

const PERMALINK_PATTERN = /\/pl\/([a-z0-9]+)\/?$/i

/**
 * Return the Mattermost post id from a permalink, but only when the link's host
 * matches the instance baseUrl host and the path is a `/pl/<postId>` permalink.
 * Returns null otherwise. The URL is parsed for identifiers only — never fetched.
 */
export function parseMattermostPermalink(url: string, baseUrl: string): string | null {
  let parsed: URL
  let base: URL
  try {
    parsed = new URL(url)
    base = new URL(baseUrl)
  } catch {
    return null
  }
  if (parsed.host !== base.host) return null
  const match = PERMALINK_PATTERN.exec(parsed.pathname)
  if (match === null) return null
  return match[1] ?? null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/chat/mattermost/link-resolver.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/chat/mattermost/link-resolver.ts tests/chat/mattermost/link-resolver.test.ts
git commit -m "feat(mattermost): add permalink parser with host validation"
```

---

## Task 4: Resolver — single-post path, membership gate, error mapping

**Files:**

- Modify: `src/chat/mattermost/link-resolver.ts` (add `ChatLinkError`, types, `resolveChatLink`)
- Test: `tests/chat/mattermost/link-resolver.test.ts` (add `resolveChatLink` describe block)

This task implements `scope: 'post'`, the membership gate, and the error mapping. Task 5 adds the thread path + identity caching + cap.

- [ ] **Step 1: Write the failing tests**

Append to `tests/chat/mattermost/link-resolver.test.ts` (add these imports at the top, below the existing import):

```ts
import { afterEach, beforeEach } from 'bun:test'

import { ChatLinkError, resolveChatLink } from '../../../src/chat/mattermost/link-resolver.js'
import {
  mockLogger,
  restoreFetch,
  seedTestPlatformInstance,
  setMockFetch,
  setupTestDb,
} from '../../utils/test-helpers.js'

// Route a Mattermost REST path to a canned JSON response (status 200 unless overridden).
function routeFetch(routes: Record<string, { status?: number; body: unknown }>): void {
  setMockFetch((url) => {
    const path = new URL(url).pathname
    const route = routes[path]
    if (route === undefined) return Promise.resolve(new Response('not mapped', { status: 404 }))
    return Promise.resolve(new Response(JSON.stringify(route.body), { status: route.status ?? 200 }))
  })
}

const BASE = 'https://mm.example.com'
function seedMm(): void {
  seedTestPlatformInstance({ id: 'mm-1', type: 'mattermost', config: { baseUrl: BASE, token: 'tok' } })
}
```

Then add this describe block:

```ts
describe('resolveChatLink (single post)', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedMm()
  })
  afterEach(() => {
    restoreFetch()
  })

  test("scope 'post' returns the linked message, flagged root + linked", async () => {
    routeFetch({
      '/api/v4/posts/abc123': {
        body: { id: 'abc123', user_id: 'u1', channel_id: 'c1', message: 'hello there', create_at: 1700000000000 },
      },
      '/api/v4/channels/c1/members/user-1': { body: { roles: 'channel_user' } },
      '/api/v4/users/u1': { body: { id: 'u1', username: 'alice', first_name: 'Alice', last_name: 'A', nickname: '' } },
    })

    const result = await resolveChatLink({
      platformInstanceId: 'mm-1',
      requesterUserId: 'user-1',
      url: `${BASE}/eng/pl/abc123`,
      scope: 'post',
    })

    expect(result.source).toBe('mattermost')
    expect(result.linkedPostId).toBe('abc123')
    expect(result.rootPostId).toBe('abc123')
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]).toEqual({
      authorId: 'u1',
      author: 'Alice A (@alice)',
      timestamp: new Date(1700000000000).toISOString(),
      text: 'hello there',
      isRoot: true,
      isLinked: true,
    })
  })

  test('membership denied (members endpoint 403) → not-accessible AppError, no content', async () => {
    routeFetch({
      '/api/v4/posts/abc123': {
        body: { id: 'abc123', user_id: 'u1', channel_id: 'c1', message: 'secret', create_at: 1 },
      },
      '/api/v4/channels/c1/members/user-1': { status: 403, body: { message: 'forbidden' } },
    })

    const error = await resolveChatLink({
      platformInstanceId: 'mm-1',
      requesterUserId: 'user-1',
      url: `${BASE}/eng/pl/abc123`,
      scope: 'post',
    }).then(
      () => null,
      (e: unknown) => e,
    )

    expect(error).toBeInstanceOf(ChatLinkError)
    expect((error as ChatLinkError).appError).toEqual({
      type: 'provider',
      code: 'not-found',
      resourceType: 'Chat message',
      resourceId: 'abc123',
    })
  })

  test('post not found (404) → not-found AppError', async () => {
    routeFetch({ '/api/v4/posts/abc123': { status: 404, body: {} } })

    const error = await resolveChatLink({
      platformInstanceId: 'mm-1',
      requesterUserId: 'user-1',
      url: `${BASE}/eng/pl/abc123`,
      scope: 'post',
    }).then(
      () => null,
      (e: unknown) => e,
    )
    expect((error as ChatLinkError).appError.code).toBe('not-found')
  })

  test('foreign host → invalid-input AppError', async () => {
    routeFetch({})
    const error = await resolveChatLink({
      platformInstanceId: 'mm-1',
      requesterUserId: 'user-1',
      url: 'https://evil.example.com/eng/pl/abc123',
      scope: 'post',
    }).then(
      () => null,
      (e: unknown) => e,
    )
    expect((error as ChatLinkError).appError).toEqual({
      type: 'validation',
      code: 'invalid-input',
      field: 'url',
      reason: 'not a Mattermost permalink for this workspace',
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/chat/mattermost/link-resolver.test.ts`
Expected: FAIL — `ChatLinkError` / `resolveChatLink` are not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/chat/mattermost/link-resolver.ts`, add imports at the top (below the license header):

```ts
import type { AppError } from '../../errors.js'
import { providerError, systemError } from '../../errors.js'
import { getPlatformInstance } from '../../instances/platform-store.js'
import { logger } from '../../logger.js'
import { makeMattermostApiFetch, MattermostApiError } from './api-fetch.js'
import type { MattermostApiFetch } from './file-helpers.js'
import { resolveMattermostUserLabel } from './label-helpers.js'
import { MattermostThreadPostSchema, type MattermostThreadPost } from './schema.js'
```

Then add (below `parseMattermostPermalink`):

```ts
const log = logger.child({ scope: 'chat:mattermost:link-resolver' })

export type ChatLinkScope = 'post' | 'thread'

export interface ChatLinkMessage {
  authorId: string
  author: string
  timestamp: string
  text: string
  isRoot: boolean
  isLinked: boolean
}

export interface ChatLinkResult {
  source: 'mattermost'
  channelId: string
  rootPostId: string
  linkedPostId: string
  scope: ChatLinkScope
  messages: ChatLinkMessage[]
  truncated?: boolean
}

export interface ResolveChatLinkArgs {
  platformInstanceId: string
  requesterUserId: string
  url: string
  scope: ChatLinkScope
  apiFetchFactory?: typeof makeMattermostApiFetch
}

/** Error carrying an AppError; recognised by buildToolFailureResult and expectAppError. */
export class ChatLinkError extends Error {
  constructor(
    message: string,
    readonly appError: AppError,
  ) {
    super(message)
    this.name = 'ChatLinkError'
  }
}

function toChatLinkError(e: unknown, postId: string): ChatLinkError {
  if (e instanceof ChatLinkError) return e
  if (e instanceof MattermostApiError) {
    if (e.status === 403 || e.status === 404) {
      return new ChatLinkError(`Post ${postId} not accessible`, providerError.notFound('Chat message', postId))
    }
    if (e.status === 429) {
      return new ChatLinkError('Mattermost rate limited', providerError.rateLimited())
    }
    return new ChatLinkError(
      `Mattermost API error ${e.status}`,
      systemError.networkError(`Mattermost returned ${e.status}`),
    )
  }
  const message = e instanceof Error ? e.message : String(e)
  return new ChatLinkError(message, systemError.networkError(message))
}

type MattermostInstanceConfig = { apiFetch: MattermostApiFetch; baseUrl: string }

function loadMattermostInstance(
  platformInstanceId: string,
  factory: typeof makeMattermostApiFetch,
): MattermostInstanceConfig {
  const instance = getPlatformInstance(platformInstanceId)
  if (instance === null || instance.type !== 'mattermost') {
    throw new ChatLinkError('Mattermost instance unavailable', systemError.configMissing('mattermost instance'))
  }
  const baseUrl = instance.config['baseUrl']
  const token = instance.config['token']
  if (baseUrl === undefined || token === undefined) {
    throw new ChatLinkError('Mattermost config incomplete', systemError.configMissing('mattermost baseUrl/token'))
  }
  return { apiFetch: factory(baseUrl, token), baseUrl }
}

async function assertRequesterMember(
  apiFetch: MattermostApiFetch,
  channelId: string,
  requesterUserId: string,
  postId: string,
): Promise<void> {
  try {
    await apiFetch(
      'GET',
      `/api/v4/channels/${encodeURIComponent(channelId)}/members/${encodeURIComponent(requesterUserId)}`,
      undefined,
    )
  } catch {
    // Identical failure whether the channel is missing or the user is not a member.
    throw new ChatLinkError('Requester not a channel member', providerError.notFound('Chat message', postId))
  }
}

function toMessage(post: MattermostThreadPost, rootId: string, linkedId: string, author: string): ChatLinkMessage {
  return {
    authorId: post.user_id,
    author,
    timestamp: new Date(post.create_at).toISOString(),
    text: post.message,
    isRoot: post.id === rootId,
    isLinked: post.id === linkedId,
  }
}

export async function resolveChatLink(args: ResolveChatLinkArgs): Promise<ChatLinkResult> {
  const { platformInstanceId, requesterUserId, url, scope } = args
  const factory = args.apiFetchFactory ?? makeMattermostApiFetch
  const { apiFetch, baseUrl } = loadMattermostInstance(platformInstanceId, factory)

  const postId = parseMattermostPermalink(url, baseUrl)
  if (postId === null) {
    throw new ChatLinkError('Not a Mattermost permalink for this workspace', {
      type: 'validation',
      code: 'invalid-input',
      field: 'url',
      reason: 'not a Mattermost permalink for this workspace',
    })
  }
  log.debug({ platformInstanceId, postId, scope }, 'resolveChatLink')

  let linked: MattermostThreadPost
  try {
    const raw = await apiFetch('GET', `/api/v4/posts/${encodeURIComponent(postId)}`, undefined)
    linked = MattermostThreadPostSchema.parse(raw)
  } catch (e) {
    throw toChatLinkError(e, postId)
  }

  const channelId = linked.channel_id
  const rootId = linked.root_id !== undefined && linked.root_id !== '' ? linked.root_id : linked.id
  await assertRequesterMember(apiFetch, channelId, requesterUserId, postId)

  const author = (await resolveMattermostUserLabel(apiFetch, linked.user_id)) ?? linked.user_id
  const messages: ChatLinkMessage[] = [toMessage(linked, rootId, postId, author)]

  log.info({ platformInstanceId, channelId, postId, scope, count: messages.length }, 'fetch_chat_link resolved')
  return { source: 'mattermost', channelId, rootPostId: rootId, linkedPostId: postId, scope, messages }
}
```

Note: this Task-4 version handles only `scope: 'post'` (it ignores the thread branch — Task 5 adds it). The `scope` field is still returned as given.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/chat/mattermost/link-resolver.test.ts`
Expected: PASS (parser tests + 4 single-post tests).

- [ ] **Step 5: Commit**

```bash
git add src/chat/mattermost/link-resolver.ts tests/chat/mattermost/link-resolver.test.ts
git commit -m "feat(mattermost): resolveChatLink single-post path with membership gate"
```

---

## Task 5: Resolver — thread path, identity caching, 100-post cap

**Files:**

- Modify: `src/chat/mattermost/link-resolver.ts`
- Test: `tests/chat/mattermost/link-resolver.test.ts` (add `resolveChatLink (thread)` describe block)

- [ ] **Step 1: Write the failing tests**

Add to the top imports of the test file:

```ts
import { MattermostPostListSchema } from '../../../src/chat/mattermost/schema.js'
```

Add this describe block to `tests/chat/mattermost/link-resolver.test.ts`:

```ts
describe('resolveChatLink (thread)', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedMm()
  })
  afterEach(() => {
    restoreFetch()
  })

  test('link to a reply with scope thread returns whole thread, ordered, with isLinked on the reply', async () => {
    routeFetch({
      // linked post is a reply (root_id = root1)
      '/api/v4/posts/reply2': {
        body: { id: 'reply2', user_id: 'u2', channel_id: 'c1', message: 'the reply', create_at: 20, root_id: 'root1' },
      },
      '/api/v4/channels/c1/members/user-1': { body: { roles: 'channel_user' } },
      '/api/v4/posts/root1/thread': {
        body: {
          order: ['reply2', 'root1'],
          posts: {
            root1: { id: 'root1', user_id: 'u1', channel_id: 'c1', message: 'the root', create_at: 10 },
            reply2: {
              id: 'reply2',
              user_id: 'u2',
              channel_id: 'c1',
              message: 'the reply',
              create_at: 20,
              root_id: 'root1',
            },
          },
        },
      },
      '/api/v4/users/u1': { body: { id: 'u1', username: 'alice' } },
      '/api/v4/users/u2': { body: { id: 'u2', username: 'bob' } },
    })

    const result = await resolveChatLink({
      platformInstanceId: 'mm-1',
      requesterUserId: 'user-1',
      url: `${BASE}/eng/pl/reply2`,
      scope: 'thread',
    })

    expect(result.rootPostId).toBe('root1')
    expect(result.linkedPostId).toBe('reply2')
    expect(result.messages.map((m) => m.text)).toEqual(['the root', 'the reply']) // chronological
    const root = result.messages[0]
    const reply = result.messages[1]
    expect(root?.isRoot).toBe(true)
    expect(root?.isLinked).toBe(false)
    expect(reply?.isRoot).toBe(false)
    expect(reply?.isLinked).toBe(true)
  })

  test('threads over the 100-post cap are truncated', async () => {
    const posts: Record<string, unknown> = {}
    const order: string[] = []
    for (let i = 0; i < 130; i++) {
      const id = `p${i}`
      order.push(id)
      posts[id] = { id, user_id: 'u1', channel_id: 'c1', message: `m${i}`, create_at: i, root_id: i === 0 ? '' : 'p0' }
    }
    routeFetch({
      '/api/v4/posts/p0': { body: posts['p0'] },
      '/api/v4/channels/c1/members/user-1': { body: { roles: 'channel_user' } },
      '/api/v4/posts/p0/thread': { body: { order, posts } },
      '/api/v4/users/u1': { body: { id: 'u1', username: 'alice' } },
    })

    const result = await resolveChatLink({
      platformInstanceId: 'mm-1',
      requesterUserId: 'user-1',
      url: `${BASE}/eng/pl/p0`,
      scope: 'thread',
    })

    expect(result.messages).toHaveLength(100)
    expect(result.truncated).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/chat/mattermost/link-resolver.test.ts`
Expected: FAIL — thread scope currently returns only the single linked post (length 1, no ordering / truncation).

- [ ] **Step 3: Write minimal implementation**

In `src/chat/mattermost/link-resolver.ts`:

Add the cap constant near the top (below `PERMALINK_PATTERN`):

```ts
const MAX_THREAD_POSTS = 100
```

Extend the imports:

```ts
import pLimit from 'p-limit'
```

and add `MattermostPostListSchema` to the existing schema import:

```ts
import { MattermostPostListSchema, MattermostThreadPostSchema, type MattermostThreadPost } from './schema.js'
```

Add a helper to fetch + order + cap thread posts (place above `resolveChatLink`):

```ts
async function fetchThreadPosts(
  apiFetch: MattermostApiFetch,
  rootId: string,
  postId: string,
): Promise<{ posts: MattermostThreadPost[]; truncated: boolean }> {
  let list
  try {
    const raw = await apiFetch('GET', `/api/v4/posts/${encodeURIComponent(rootId)}/thread`, undefined)
    list = MattermostPostListSchema.parse(raw)
  } catch (e) {
    throw toChatLinkError(e, postId)
  }
  const ordered = list.order
    .map((id) => list.posts[id])
    .filter((p): p is MattermostThreadPost => p !== undefined)
    .sort((a, b) => a.create_at - b.create_at)
  if (ordered.length > MAX_THREAD_POSTS) {
    return { posts: ordered.slice(0, MAX_THREAD_POSTS), truncated: true }
  }
  return { posts: ordered, truncated: false }
}

async function resolveAuthorLabels(
  apiFetch: MattermostApiFetch,
  posts: readonly MattermostThreadPost[],
): Promise<Map<string, string>> {
  const distinct = [...new Set(posts.map((p) => p.user_id))]
  const limit = pLimit(5)
  const cache = new Map<string, string>()
  await Promise.all(
    distinct.map((userId) =>
      limit(async () => {
        const label = await resolveMattermostUserLabel(apiFetch, userId)
        cache.set(userId, label ?? userId)
      }),
    ),
  )
  return cache
}
```

Replace the single-post tail of `resolveChatLink` (from `const author = ...` through the `return`) with:

```ts
const selection =
  scope === 'thread' ? await fetchThreadPosts(apiFetch, rootId, postId) : { posts: [linked], truncated: false }

const labels = await resolveAuthorLabels(apiFetch, selection.posts)
const messages = selection.posts.map((post) =>
  toMessage(post, rootId, postId, labels.get(post.user_id) ?? post.user_id),
)

log.info(
  { platformInstanceId, channelId, postId, scope, count: messages.length, truncated: selection.truncated },
  'fetch_chat_link resolved',
)
const result: ChatLinkResult = {
  source: 'mattermost',
  channelId,
  rootPostId: rootId,
  linkedPostId: postId,
  scope,
  messages,
}
if (selection.truncated) result.truncated = true
return result
```

Remove the now-unused single-post `const author` / `const messages` lines and the old `return` from Task 4 (the block above replaces them). Keep the `assertRequesterMember` call and everything above it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/chat/mattermost/link-resolver.test.ts`
Expected: PASS (parser + single-post + 2 thread tests).

- [ ] **Step 5: Commit**

```bash
git add src/chat/mattermost/link-resolver.ts tests/chat/mattermost/link-resolver.test.ts
git commit -m "feat(mattermost): resolveChatLink thread path, identity cache, 100-post cap"
```

---

## Task 6: The `fetch_chat_link` tool

**Files:**

- Create: `src/tools/fetch-chat-link.ts`
- Test: `tests/tools/fetch-chat-link.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/tools/fetch-chat-link.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { ChatLinkResult } from '../../src/chat/mattermost/link-resolver.js'
import { makeFetchChatLinkTool } from '../../src/tools/fetch-chat-link.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'

const sampleResult: ChatLinkResult = {
  source: 'mattermost',
  channelId: 'c1',
  rootPostId: 'p1',
  linkedPostId: 'p1',
  scope: 'thread',
  messages: [
    {
      authorId: 'u1',
      author: 'Alice',
      timestamp: '2026-01-01T00:00:00.000Z',
      text: 'hi',
      isRoot: true,
      isLinked: true,
    },
  ],
}

describe('fetch_chat_link tool', () => {
  test('input schema accepts url with and without scope, rejects bad scope', () => {
    const tool = makeFetchChatLinkTool('mm-1', 'user-1', { resolveChatLink: () => Promise.resolve(sampleResult) })
    expect(schemaValidates(tool, { url: 'https://mm.example.com/eng/pl/p1', scope: 'post' })).toBe(true)
    expect(schemaValidates(tool, { url: 'https://mm.example.com/eng/pl/p1' })).toBe(true)
    expect(schemaValidates(tool, { url: 'x', scope: 'sideways' })).toBe(false)
    expect(schemaValidates(tool, {})).toBe(false)
  })

  test('execute passes bound ids + input to the resolver and returns its result', async () => {
    mockLogger()
    const calls: unknown[] = []
    const tool = makeFetchChatLinkTool('mm-1', 'user-1', {
      resolveChatLink: (a) => {
        calls.push(a)
        return Promise.resolve(sampleResult)
      },
    })
    const execute = getToolExecutor(tool)
    const result = await execute({ url: 'https://mm.example.com/eng/pl/p1', scope: 'thread' }, { toolCallId: 'c' })

    expect(result).toEqual(sampleResult)
    expect(calls[0]).toEqual({
      platformInstanceId: 'mm-1',
      requesterUserId: 'user-1',
      url: 'https://mm.example.com/eng/pl/p1',
      scope: 'thread',
    })
  })

  test('execute rethrows resolver errors', async () => {
    mockLogger()
    const tool = makeFetchChatLinkTool('mm-1', 'user-1', {
      resolveChatLink: () => Promise.reject(new Error('boom')),
    })
    const execute = getToolExecutor(tool)
    await expect(
      execute({ url: 'https://mm.example.com/eng/pl/p1', scope: 'post' }, { toolCallId: 'c' }),
    ).rejects.toThrow('boom')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools/fetch-chat-link.test.ts`
Expected: FAIL — module `fetch-chat-link.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `src/tools/fetch-chat-link.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { resolveChatLink as defaultResolveChatLink } from '../chat/mattermost/link-resolver.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:fetch-chat-link' })

const inputSchema = z.object({
  url: z.string().describe('A Mattermost message permalink the user shared (…/<team>/pl/<postId>)'),
  scope: z
    .enum(['post', 'thread'])
    .default('thread')
    .describe("'thread' (default) returns the whole thread; 'post' returns only the linked message"),
})

export interface FetchChatLinkToolDeps {
  resolveChatLink: typeof defaultResolveChatLink
}

const defaultDeps: FetchChatLinkToolDeps = { resolveChatLink: defaultResolveChatLink }

export function makeFetchChatLinkTool(
  platformInstanceId: string,
  requesterUserId: string,
  deps: FetchChatLinkToolDeps = defaultDeps,
): ToolSet[string] {
  return tool({
    description:
      'Follow a Mattermost chat permalink the user shared and return the linked message — or its whole thread — as structured messages, for summarizing or creating a task from it. Only works for links in this workspace and only if you (the requesting user) can access that channel.',
    inputSchema,
    execute: async ({ url, scope }) => {
      try {
        log.debug({ platformInstanceId, requesterUserId, scope }, 'Executing fetch_chat_link')
        return await deps.resolveChatLink({ platformInstanceId, requesterUserId, url, scope })
      } catch (error) {
        log.error(
          {
            platformInstanceId,
            requesterUserId,
            error: error instanceof Error ? error.message : String(error),
            tool: 'fetch_chat_link',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/tools/fetch-chat-link.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/fetch-chat-link.ts tests/tools/fetch-chat-link.test.ts
git commit -m "feat(tools): add fetch_chat_link tool over the Mattermost resolver"
```

---

## Task 7: Tool metadata classification

**Files:**

- Modify: `src/tools/tool-metadata.ts`
- Test: `tests/tools/fetch-chat-link.test.ts` (add a metadata assertion)

- [ ] **Step 1: Write the failing test**

Add to `tests/tools/fetch-chat-link.test.ts` (new import + test):

```ts
import { TOOL_METADATA } from '../../src/tools/tool-metadata.js'

test('fetch_chat_link is classified as open-world history-read', () => {
  expect(TOOL_METADATA['fetch_chat_link']).toEqual({ domain: 'history', operation: 'read', risk: 'open-world' })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools/fetch-chat-link.test.ts`
Expected: FAIL — `TOOL_METADATA['fetch_chat_link']` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `src/tools/tool-metadata.ts`, in the `TOOL_METADATA` object next to `web_fetch` (line 172), add:

```ts
  fetch_chat_link: { domain: 'history', operation: 'read', risk: 'open-world' },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/tools/fetch-chat-link.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/tool-metadata.ts tests/tools/fetch-chat-link.test.ts
git commit -m "feat(tools): classify fetch_chat_link as open-world history-read"
```

---

## Task 8: Builder gating + registration

**Files:**

- Modify: `src/tools/provider-independent-tools-builder.ts`
- Test: `tests/tools/fetch-chat-link-gating.test.ts`

The tool is registered only when the conversation's scoped `contextId` resolves to an active Mattermost platform instance and a `chatUserId` (requester) is present.

- [ ] **Step 1: Write the failing test**

Create `tests/tools/fetch-chat-link-gating.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { ToolSet } from 'ai'

import { toScopedContextId } from '../../src/chat/scoped-context.js'
import { addProviderIndependentTools } from '../../src/tools/provider-independent-tools-builder.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../utils/test-helpers.js'

const baseOptions = {
  mode: 'normal' as const,
  contextType: 'group' as const,
  username: null,
  stagedDownloadFn: undefined,
}

describe('fetch_chat_link gating', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({
      id: 'mm-1',
      type: 'mattermost',
      config: { baseUrl: 'https://mm.example.com', token: 't' },
    })
    seedTestPlatformInstance({ id: 'tg-1', type: 'telegram', config: {} })
  })
  afterEach(() => {
    // setupTestDb resets DB state on next call; nothing else to clean.
  })

  test('registered for a Mattermost instance with a requester id', () => {
    const tools: ToolSet = {}
    const contextId = toScopedContextId({ platformInstanceId: 'mm-1', nativeContextId: 'c1' })
    addProviderIndependentTools(tools, { ...baseOptions, chatUserId: 'user-1', contextId })
    expect(tools['fetch_chat_link']).toBeDefined()
  })

  test('absent for a non-Mattermost instance', () => {
    const tools: ToolSet = {}
    const contextId = toScopedContextId({ platformInstanceId: 'tg-1', nativeContextId: 'c1' })
    addProviderIndependentTools(tools, { ...baseOptions, chatUserId: 'user-1', contextId })
    expect(tools['fetch_chat_link']).toBeUndefined()
  })

  test('absent when there is no requester id', () => {
    const tools: ToolSet = {}
    const contextId = toScopedContextId({ platformInstanceId: 'mm-1', nativeContextId: 'c1' })
    addProviderIndependentTools(tools, { ...baseOptions, chatUserId: undefined, contextId })
    expect(tools['fetch_chat_link']).toBeUndefined()
  })

  test('absent for a non-scoped (legacy) contextId', () => {
    const tools: ToolSet = {}
    addProviderIndependentTools(tools, { ...baseOptions, chatUserId: 'user-1', contextId: 'legacy-raw-id' })
    expect(tools['fetch_chat_link']).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools/fetch-chat-link-gating.test.ts`
Expected: FAIL — `tools['fetch_chat_link']` is `undefined` in the first test.

- [ ] **Step 3: Write minimal implementation**

In `src/tools/provider-independent-tools-builder.ts`:

Change the scoped-context import (line 11) to also import `parseScopedContextId`:

```ts
import { hasThreadContextId, parseScopedContextId } from '../chat/scoped-context.js'
```

Add two imports next to the other tool imports:

```ts
import { getPlatformInstance } from '../instances/platform-store.js'
import { makeFetchChatLinkTool } from './fetch-chat-link.js'
```

Add a helper next to `addLookupGroupHistoryTool` (after line 83):

```ts
function addFetchChatLinkTool(tools: ToolSet, chatUserId: string | undefined, contextId: string | undefined): void {
  if (chatUserId === undefined || contextId === undefined) return
  const parsed = parseScopedContextId(contextId)
  if (parsed === null) return
  const instance = getPlatformInstance(parsed.platformInstanceId)
  if (instance === null || instance.type !== 'mattermost') return
  tools['fetch_chat_link'] = makeFetchChatLinkTool(parsed.platformInstanceId, chatUserId)
}
```

Call it inside `addProviderIndependentTools`, right after the `web_fetch` registration (line 121):

```ts
addFetchChatLinkTool(tools, chatUserId, contextId)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/tools/fetch-chat-link-gating.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/provider-independent-tools-builder.ts tests/tools/fetch-chat-link-gating.test.ts
git commit -m "feat(tools): gate + register fetch_chat_link for Mattermost contexts"
```

---

## Task 9: System-prompt usage fragment

**Files:**

- Modify: `src/system-prompt.ts`
- Test: `tests/system-prompt-chat-link.test.ts`

The fragment appears only when `fetch_chat_link` is in the enabled tool names (permission-aware, like `web_fetch`).

- [ ] **Step 1: Write the failing test**

Create `tests/system-prompt-chat-link.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { buildProviderlessSystemPrompt } from '../src/system-prompt.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

describe('chat-link system prompt fragment', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('included when fetch_chat_link is enabled', () => {
    const prompt = buildProviderlessSystemPrompt('ctx-1', new Set(['fetch_chat_link']))
    expect(prompt).toContain('CHAT LINKS')
    expect(prompt).toContain('fetch_chat_link')
  })

  test('absent when fetch_chat_link is not enabled', () => {
    const prompt = buildProviderlessSystemPrompt('ctx-1', new Set<string>())
    expect(prompt).not.toContain('CHAT LINKS')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/system-prompt-chat-link.test.ts`
Expected: FAIL — prompt does not contain `CHAT LINKS`.

- [ ] **Step 3: Write minimal implementation**

In `src/system-prompt.ts`, define the fragment text next to `WEB_FETCH` (line 108):

```ts
const CHAT_LINK = `CHAT LINKS — When the user shares a Mattermost message permalink and asks you to act on it (e.g. create a task or summarize), call fetch_chat_link with that URL. Use scope 'thread' for the whole discussion or 'post' for only the linked message. It works only for links in this workspace that the requesting user can access.`
```

Register it in the `FRAGMENTS` array next to the `WEB_FETCH` entry (line 159):

```ts
  { text: CHAT_LINK, requiredTools: ['fetch_chat_link'] },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/system-prompt-chat-link.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/system-prompt.ts tests/system-prompt-chat-link.test.ts
git commit -m "feat(system-prompt): add fetch_chat_link usage fragment"
```

---

## Task 10: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Lint + typecheck + format**

Run: `bun run lint`
Expected: `Found 0 warnings and 0 errors.`

- [ ] **Step 2: Run all the new + adjacent suites**

Run:

```bash
bun test tests/chat/mattermost/ tests/tools/fetch-chat-link.test.ts tests/tools/fetch-chat-link-gating.test.ts tests/system-prompt-chat-link.test.ts
```

Expected: all PASS.

- [ ] **Step 3: Run the server test suite**

Run: `bun run test`
Expected: green (or only pre-existing unrelated failures from other in-progress work).

- [ ] **Step 4: Final commit (if any incidental changes)**

```bash
git status
# commit only if Task 10 surfaced fixes; otherwise nothing to do
```

---

## Self-Review

**Spec coverage:**

- Permalink → identifiers only, all HTTP to instance baseUrl → Tasks 1, 3, 4 (host validation in parser; apiFetch bound to baseUrl).
- LLM tool only, capability/context gated → Tasks 6, 8.
- `scope` post vs thread, default thread → Tasks 4, 5, 6.
- Requester membership gate, non-leaking identical failure → Task 4 (`assertRequesterMember`).
- Structured messages with display names, root + linked flags, `linkedPostId` → Tasks 4, 5.
- 100-post cap + `truncated` → Task 5.
- Classification `history` / `open-world` → Task 7.
- Failure mapping (invalid-input / not-accessible / not-found / transient) → Task 4 (`toChatLinkError`, invalid-input throw).
- `apiFetch` extraction reused by provider + resolver → Task 1.
- System-prompt hint → Task 9.
- Tests: parser, single-post, thread/reply, membership deny, truncation, gating, schema, prompt → Tasks 1-9.

**Placeholder scan:** none — every code/test step contains full code and exact run commands.

**Type consistency:** `ChatLinkResult` / `ChatLinkMessage` / `ChatLinkScope` / `ResolveChatLinkArgs` defined in Task 4 are used unchanged in Tasks 5-6; `makeFetchChatLinkTool(platformInstanceId, requesterUserId, deps)` signature is consistent across Tasks 6 and 8; `MattermostThreadPost` / `MattermostPostListSchema` defined in Task 2 are used in Tasks 4-5; `MattermostApiError` from Task 1 is used in Task 4.

**Note on the working tree:** the repo currently has unrelated WIP staged (a reply-tracking feature) including `src/chat/telegram/index.ts` failing `max-lines`. Each task's commit stages only its own files by explicit path, so it will not bundle that WIP — but `bun run test` in Task 10 may surface pre-existing failures from it that are out of scope here.
