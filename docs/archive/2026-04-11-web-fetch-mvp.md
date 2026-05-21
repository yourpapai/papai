<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Web Fetch MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe `web_fetch` tool that can read generic public HTML/PDF URLs, return a bounded summary/excerpt for the current reasoning turn, and let the model feed that result into existing memo/task tools.

**Architecture:** Build a small `src/web/` subsystem for URL normalization, rate limiting, Bun-compatible safe fetching, generic extraction, cache persistence, and optional distillation. Keep provider integration unchanged: the new tool is wired through `src/tools/tools-builder.ts`, prompt guidance is added in `src/system-prompt.ts`, and durable storage still happens only through existing memo/task tools. Because Bun `fetch` does not honor Node-style `agent` hooks, SSRF protection in this plan uses manual DNS/IP validation before each fetch and redirect instead of the older Node-agent assumption.

**Tech Stack:** TypeScript, Bun, Vercel AI SDK v6, Bun SQLite + Drizzle, `defuddle`, `linkedom`, `unpdf`, `ipaddr.js`, existing OpenAI-compatible model config, existing pino logging

---

## Scope Check

This stays as one implementation plan. The migration/schema work, safe fetch boundary, extraction pipeline, cache/rate-limit storage, tool wiring, and prompt guidance form one vertical feature slice. Splitting those apart would leave partially-usable behavior behind, such as a registered tool with no safe fetch path or a fetch subsystem with no way for the model to invoke it.

Two implementation details intentionally refine the MVP design so it remains buildable under Bun:

1. **SSRF protection:** use manual DNS/IP validation plus `ipaddr.js`, because Bun `fetch` does not support Node-style `agent` injection.
2. **HTML -> markdown:** use Defuddle's markdown output path directly, instead of adding a second standalone Turndown pass.

Neither change expands product scope; they translate the approved MVP into Bun-compatible implementation detail.

## File Structure

```text
package.json                         # Add runtime deps and include tests/web in the default test script
bun.lock                             # Updated by Bun after installing runtime deps
CLAUDE.md                            # Document the new web_fetch tool in the tool inventory

src/
├── db/
│   ├── index.ts                     # Register migration019 + migration020 in runtime order
│   ├── schema.ts                    # Add webCache + webRateLimit tables
│   └── migrations/
│       └── 020_web_fetch.ts         # Create web_cache + web_rate_limit tables and indexes
├── errors.ts                        # Add typed WebFetchError branch + user-message mapping
├── system-prompt.ts                 # Tell the model when to use web_fetch
├── tools/
│   ├── tools-builder.ts             # Register web_fetch when storageContextId exists
│   └── web-fetch.ts                 # Vercel AI SDK tool wrapper
└── web/
    ├── types.ts                     # Shared WebFetchResult, SafeFetchResponse, RateLimitResult types
    ├── url-normalize.ts             # Canonicalize URLs for cache keys
    ├── rate-limit.ts                # 20 requests / 5 minutes / actor fixed-window counter
    ├── safe-fetch.ts                # Manual DNS/IP validation + redirect-aware public-web fetch
    ├── extract.ts                   # Generic HTML/text/markdown extraction
    ├── pdf.ts                       # PDF text extraction with unpdf
    ├── cache.ts                     # web_cache CRUD + TTL handling
    ├── distill.ts                   # Small-model-or-main-model distillation for oversized content
    └── fetch-extract.ts             # Top-level orchestration for cache/fetch/extract/distill

tests/
├── db/
│   ├── migrations/
│   │   └── 020_web_fetch.test.ts    # Migration creates both tables and indexes
│   └── schema.test.ts               # Drizzle exports webCache + webRateLimit
├── errors.test.ts                   # WebFetchError constructors + getUserMessage mapping
├── system-prompt.test.ts            # Prompt mentions web_fetch guidance and stays static
├── tools/
│   ├── index.test.ts                # makeTools includes/excludes web_fetch correctly
│   ├── tools-builder.test.ts        # buildTools wires web_fetch with context-aware gating
│   └── web-fetch.test.ts            # Tool wrapper forwards context and abortSignal
├── utils/
│   └── test-helpers.ts              # Add migration020 to ALL_MIGRATIONS
└── web/
    ├── url-normalize.test.ts
    ├── rate-limit.test.ts
    ├── safe-fetch.test.ts
    ├── extract.test.ts
    ├── pdf.test.ts
    ├── cache.test.ts
    ├── distill.test.ts
    ├── fetch-extract.test.ts
    └── fetch-extract.integration.test.ts
```

**Testing note:** `package.json` currently omits `tests/web` from `bun test`, so Task 1 must fix test discovery before the new `src/web/*` modules can participate in the normal suite or `check:full`.

---

### Task 1: Prepare dependencies and test discovery

**Files:**

- Modify: `package.json`
- Modify: `bun.lock`

- [ ] **Step 1: Expand the default Bun test script to include the new `tests/web` directory**

```json
{
  "scripts": {
    "test": "bun test tests/providers tests/tools tests/web tests/db tests/utils tests/schemas tests/proactive tests/debug tests/*.test.ts"
  }
}
```

- [ ] **Step 2: Install the runtime dependencies needed for the MVP**

```bash
bun add defuddle linkedom unpdf ipaddr.js
```

Expected: `package.json` gains the four dependencies above and Bun rewrites `bun.lock`.

- [ ] **Step 3: Run a smoke check to make sure the script/dependency change did not break the current suite shape**

Run: `bun test tests/system-prompt.test.ts tests/tools/index.test.ts`

Expected: PASS. No new web-fetch tests exist yet, but the repo should still execute the existing prompt/tool smoke tests.

- [ ] **Step 4: Commit the package/test-discovery prep**

```bash
git add package.json bun.lock
git commit -m "build: prepare web fetch dependencies and tests"
```

---

### Task 2: Add the typed web-fetch error branch

**Files:**

- Modify: `src/errors.ts`
- Modify: `tests/errors.test.ts`

- [ ] **Step 1: Write the failing error-model tests**

```typescript
// tests/errors.test.ts
import { describe, expect, test } from 'bun:test'

import { getUserMessage, isAppError, webFetchError } from '../src/errors.js'

describe('webFetchError constructors', () => {
  test('invalidUrl creates correct structure', () => {
    expect(webFetchError.invalidUrl()).toEqual({ type: 'web-fetch', code: 'invalid-url' })
  })

  test('upstreamError captures optional status', () => {
    expect(webFetchError.upstreamError(502)).toEqual({
      type: 'web-fetch',
      code: 'upstream-error',
      status: 502,
    })
  })
})

describe('web fetch AppError behavior', () => {
  test('isAppError accepts web-fetch errors', () => {
    expect(isAppError(webFetchError.blockedHost())).toBe(true)
  })

  test('getUserMessage returns a specific message for each code', () => {
    expect(getUserMessage(webFetchError.invalidUrl())).toContain("doesn't look valid")
    expect(getUserMessage(webFetchError.blockedHost())).toContain('public web')
    expect(getUserMessage(webFetchError.blockedContentType())).toContain("isn't supported")
    expect(getUserMessage(webFetchError.tooLarge())).toContain('too large')
    expect(getUserMessage(webFetchError.timeout())).toContain('too long')
    expect(getUserMessage(webFetchError.rateLimited())).toContain('too quickly')
    expect(getUserMessage(webFetchError.extractFailed())).toContain("couldn't extract")
    expect(getUserMessage(webFetchError.upstreamError(502))).toContain('returned an error')
  })
})
```

- [ ] **Step 2: Run the focused error tests to verify they fail**

Run: `bun test tests/errors.test.ts`

Expected: FAIL with missing `webFetchError` export and/or missing `web-fetch` handling in `isAppError()` / `getUserMessage()`.

- [ ] **Step 3: Extend `src/errors.ts` with `WebFetchError`, constructors, type-guard coverage, and user messages**

```typescript
// src/errors.ts
export type WebFetchError =
  | { type: 'web-fetch'; code: 'invalid-url' }
  | { type: 'web-fetch'; code: 'blocked-host' }
  | { type: 'web-fetch'; code: 'blocked-content-type' }
  | { type: 'web-fetch'; code: 'too-large' }
  | { type: 'web-fetch'; code: 'timeout' }
  | { type: 'web-fetch'; code: 'rate-limited' }
  | { type: 'web-fetch'; code: 'extract-failed' }
  | { type: 'web-fetch'; code: 'upstream-error'; status?: number }

export type AppError = ProviderError | LlmError | ValidationError | SystemError | WebFetchError

export const webFetchError = {
  invalidUrl: (): AppError => ({ type: 'web-fetch', code: 'invalid-url' }),
  blockedHost: (): AppError => ({ type: 'web-fetch', code: 'blocked-host' }),
  blockedContentType: (): AppError => ({ type: 'web-fetch', code: 'blocked-content-type' }),
  tooLarge: (): AppError => ({ type: 'web-fetch', code: 'too-large' }),
  timeout: (): AppError => ({ type: 'web-fetch', code: 'timeout' }),
  rateLimited: (): AppError => ({ type: 'web-fetch', code: 'rate-limited' }),
  extractFailed: (): AppError => ({ type: 'web-fetch', code: 'extract-failed' }),
  upstreamError: (status?: number): AppError => ({ type: 'web-fetch', code: 'upstream-error', status }),
}

const appErrorTypeSchema = z.object({
  type: z.enum(['provider', 'llm', 'validation', 'system', 'web-fetch']),
})

const getWebFetchMessage = (error: WebFetchError): string => {
  switch (error.code) {
    case 'invalid-url':
      return `That URL doesn't look valid.`
    case 'blocked-host':
      return `I can't fetch that address because it isn't on the public web.`
    case 'blocked-content-type':
      return `That content type isn't supported.`
    case 'too-large':
      return `That page is too large for me to read safely.`
    case 'timeout':
      return `Fetching that page took too long.`
    case 'rate-limited':
      return `You're fetching URLs too quickly. Please try again in a moment.`
    case 'extract-failed':
      return `I couldn't extract readable content from that page.`
    case 'upstream-error':
      return `The site returned an error.`
    default:
      return `I couldn't fetch that page.`
  }
}

export const getUserMessage = (error: AppError): string => {
  switch (error.type) {
    case 'provider':
      return getProviderMessage(error)
    case 'llm':
      return getLlmMessage(error)
    case 'validation':
      return getValidationMessage(error)
    case 'system':
      return getSystemMessage(error)
    case 'web-fetch':
      return getWebFetchMessage(error)
    default:
      return `An unexpected error occurred. Please try again later.`
  }
}
```

- [ ] **Step 4: Re-run the error tests and make sure they pass**

Run: `bun test tests/errors.test.ts`

Expected: PASS. `webFetchError` constructors, `isAppError()`, and `getUserMessage()` now cover the new branch.

- [ ] **Step 5: Commit the error-model slice**

```bash
git add src/errors.ts tests/errors.test.ts
git commit -m "feat: add web fetch error model"
```

---

### Task 3: Add the web-fetch migration, runtime registration, and Drizzle schema

**Files:**

- Create: `src/db/migrations/020_web_fetch.ts`
- Modify: `src/db/index.ts`
- Modify: `src/db/schema.ts`
- Modify: `tests/utils/test-helpers.ts`
- Create: `tests/db/migrations/020_web_fetch.test.ts`
- Create: `tests/db/schema.test.ts`

- [ ] **Step 1: Write the failing migration and schema tests**

```typescript
// tests/db/migrations/020_web_fetch.test.ts
import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { migration020WebFetch } from '../../../src/db/migrations/020_web_fetch.js'
import { mockLogger } from '../../utils/test-helpers.js'

const getNames = (db: Database, type: 'table' | 'index'): string[] =>
  db
    .query<{ name: string }, [string]>('SELECT name FROM sqlite_master WHERE type = ?')
    .all(type)
    .map((row) => row.name)

describe('migration020WebFetch', () => {
  let db: Database

  beforeEach(() => {
    mockLogger()
    db = new Database(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  test('creates web_cache and web_rate_limit tables', () => {
    migration020WebFetch.up(db)
    expect(getNames(db, 'table')).toContain('web_cache')
    expect(getNames(db, 'table')).toContain('web_rate_limit')
    expect(getNames(db, 'index')).toContain('idx_web_cache_expires')
  })
})

// tests/db/schema.test.ts
import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { webCache, webRateLimit } from '../../src/db/schema.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('web fetch schema', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('exports the web fetch tables', () => {
    const db = getDrizzleDb()
    expect(db).toBeDefined()
    expect(webCache.urlHash).toBeDefined()
    expect(webRateLimit.actorId).toBeDefined()
  })
})
```

- [ ] **Step 2: Run the DB tests to verify they fail**

Run: `bun test tests/db/migrations/020_web_fetch.test.ts tests/db/schema.test.ts`

Expected: FAIL with `Cannot find module '../../../src/db/migrations/020_web_fetch.js'` and/or missing `webCache` / `webRateLimit` exports from `src/db/schema.ts`.

- [ ] **Step 3: Add migration020, register it after the existing migration019, expose the Drizzle tables, and extend the test helper migration list**

```typescript
// src/db/migrations/020_web_fetch.ts
import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

export const migration020WebFetch: Migration = {
  id: '020_web_fetch',
  up(db: Database): void {
    db.run(`
      CREATE TABLE web_cache (
        url_hash      TEXT PRIMARY KEY,
        url           TEXT NOT NULL,
        final_url     TEXT NOT NULL,
        title         TEXT NOT NULL,
        summary       TEXT NOT NULL,
        excerpt       TEXT NOT NULL,
        truncated     INTEGER NOT NULL DEFAULT 0,
        content_type  TEXT NOT NULL,
        fetched_at    INTEGER NOT NULL,
        expires_at    INTEGER NOT NULL
      )
    `)
    db.run(`CREATE INDEX idx_web_cache_expires ON web_cache(expires_at)`)
    db.run(`
      CREATE TABLE web_rate_limit (
        actor_id      TEXT NOT NULL,
        window_start  INTEGER NOT NULL,
        count         INTEGER NOT NULL,
        PRIMARY KEY (actor_id, window_start)
      )
    `)
  },
}

// src/db/index.ts
import { migration018Memos } from './migrations/018_memos.js'
import { migration019UserIdentityMappings } from './migrations/019_user_identity_mappings.js'
import { migration020WebFetch } from './migrations/020_web_fetch.js'

const MIGRATIONS = [
  migration001Initial,
  migration002ConversationHistory,
  migration003MultiuserSupport,
  migration004KaneoWorkspace,
  migration005RenameConfigKeys,
  migration006VersionAnnouncements,
  migration007PlatformUserId,
  migration008GroupMembers,
  migration009RecurringTasks,
  migration010RecurringTaskOccurrences,
  migration011ProactiveAlerts,
  migration012UserInstructions,
  migration013DeferredPrompts,
  migration014BackgroundEvents,
  migration015DropBackgroundEvents,
  migration016ExecutionMetadata,
  migration017MessageMetadata,
  migration018Memos,
  migration019UserIdentityMappings,
  migration020WebFetch,
] as const

// src/db/schema.ts
export const webCache = sqliteTable(
  'web_cache',
  {
    urlHash: text('url_hash').primaryKey(),
    url: text('url').notNull(),
    finalUrl: text('final_url').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    excerpt: text('excerpt').notNull(),
    truncated: integer('truncated', { mode: 'boolean' }).notNull().default(false),
    contentType: text('content_type').notNull(),
    fetchedAt: integer('fetched_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [index('idx_web_cache_expires').on(table.expiresAt)],
)

export const webRateLimit = sqliteTable(
  'web_rate_limit',
  {
    actorId: text('actor_id').notNull(),
    windowStart: integer('window_start').notNull(),
    count: integer('count').notNull(),
  },
  (table) => [primaryKey({ columns: [table.actorId, table.windowStart] })],
)

// tests/utils/test-helpers.ts
import { migration020WebFetch } from '../../src/db/migrations/020_web_fetch.js'

const ALL_MIGRATIONS: readonly Migration[] = [
  migration001Initial,
  migration002ConversationHistory,
  migration003MultiuserSupport,
  migration004KaneoWorkspace,
  migration005RenameConfigKeys,
  migration006VersionAnnouncements,
  migration007PlatformUserId,
  migration008GroupMembers,
  migration009RecurringTasks,
  migration010RecurringTaskOccurrences,
  migration011ProactiveAlerts,
  migration012UserInstructions,
  migration013DeferredPrompts,
  migration014BackgroundEvents,
  migration015DropBackgroundEvents,
  migration016ExecutionMetadata,
  migration017MessageMetadata,
  migration018Memos,
  migration019UserIdentityMappings,
  migration020WebFetch,
]
```

- [ ] **Step 4: Re-run the DB tests and make sure they pass**

Run: `bun test tests/db/migrations/020_web_fetch.test.ts tests/db/schema.test.ts`

Expected: PASS. The migration creates both tables, runtime startup includes migration019 + 020 in order, and the test helper can build the new schema.

- [ ] **Step 5: Commit the schema slice**

```bash
git add src/db/index.ts src/db/schema.ts src/db/migrations/020_web_fetch.ts tests/utils/test-helpers.ts tests/db/migrations/020_web_fetch.test.ts tests/db/schema.test.ts
git commit -m "feat: add web fetch database tables"
```

---

### Task 4: Add shared web types, URL normalization, and fixed-window rate limiting

**Files:**

- Create: `src/web/types.ts`
- Create: `src/web/url-normalize.ts`
- Create: `src/web/rate-limit.ts`
- Create: `tests/web/url-normalize.test.ts`
- Create: `tests/web/rate-limit.test.ts`

- [ ] **Step 1: Write the failing normalization and rate-limit tests**

```typescript
// tests/web/url-normalize.test.ts
import { describe, expect, test } from 'bun:test'

import { normalizeWebUrl } from '../../src/web/url-normalize.js'

describe('normalizeWebUrl', () => {
  test('lowercases host, strips fragment, removes tracking params, and sorts query params', () => {
    expect(normalizeWebUrl('HTTPS://Example.com/path?b=2&utm_source=x&a=1#frag')).toBe(
      'https://example.com/path?a=1&b=2',
    )
  })

  test('preserves ordinary query params', () => {
    expect(normalizeWebUrl('https://example.com/article?topic=llm&page=2')).toBe(
      'https://example.com/article?page=2&topic=llm',
    )
  })
})

// tests/web/rate-limit.test.ts
import { beforeEach, describe, expect, test } from 'bun:test'

import { consumeWebFetchQuota } from '../../src/web/rate-limit.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('consumeWebFetchQuota', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('allows the first 20 requests in the same window and blocks the 21st', () => {
    for (let i = 0; i < 20; i++) {
      expect(consumeWebFetchQuota('actor-1', 0).allowed).toBe(true)
    }

    expect(consumeWebFetchQuota('actor-1', 0)).toEqual({
      allowed: false,
      remaining: 0,
      retryAfterSec: 300,
    })
  })

  test('resets once the next 5-minute window starts', () => {
    for (let i = 0; i < 20; i++) {
      consumeWebFetchQuota('actor-1', 0)
    }

    expect(consumeWebFetchQuota('actor-1', 301_000)).toEqual({
      allowed: true,
      remaining: 19,
    })
  })
})
```

- [ ] **Step 2: Run the new web tests to verify they fail**

Run: `bun test tests/web/url-normalize.test.ts tests/web/rate-limit.test.ts`

Expected: FAIL with `Cannot find module '../../src/web/url-normalize.js'` and `../../src/web/rate-limit.js`.

- [ ] **Step 3: Add the shared web types plus the first pure/storage-backed helpers**

```typescript
// src/web/types.ts
export type WebFetchResult = {
  readonly url: string
  readonly title: string
  readonly summary: string
  readonly excerpt: string
  readonly truncated: boolean
  readonly contentType: string
  readonly source: 'cache' | 'fetch'
  readonly fetchedAt: number
}

export type RateLimitResult =
  | { readonly allowed: true; readonly remaining: number }
  | { readonly allowed: false; readonly remaining: 0; readonly retryAfterSec: number }

export type SafeFetchResponse = {
  readonly finalUrl: string
  readonly contentType: string
  readonly body: Uint8Array
}

// src/web/url-normalize.ts
const TRACKING_PARAM_PATTERNS = [/^utm_/i, /^fbclid$/i, /^gclid$/i]

function isTrackingParam(key: string): boolean {
  return TRACKING_PARAM_PATTERNS.some((pattern) => pattern.test(key))
}

export function normalizeWebUrl(rawUrl: string): string {
  const url = new URL(rawUrl)
  url.hostname = url.hostname.toLowerCase()
  url.hash = ''

  const kept = [...url.searchParams.entries()]
    .filter(([key]) => !isTrackingParam(key))
    .sort(([aKey, aValue], [bKey, bValue]) => {
      if (aKey === bKey) return aValue.localeCompare(bValue)
      return aKey.localeCompare(bKey)
    })

  url.search = ''
  for (const [key, value] of kept) {
    url.searchParams.append(key, value)
  }

  return url.toString()
}

// src/web/rate-limit.ts
import { and, eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { webRateLimit } from '../db/schema.js'
import { logger } from '../logger.js'
import type { RateLimitResult } from './types.js'

const log = logger.child({ scope: 'web:rate-limit' })

const WINDOW_MS = 5 * 60 * 1000
const LIMIT = 20

export function consumeWebFetchQuota(actorId: string, nowMs: number = Date.now()): RateLimitResult {
  const db = getDrizzleDb()
  const windowStart = Math.floor(nowMs / WINDOW_MS) * WINDOW_MS
  const existing = db
    .select()
    .from(webRateLimit)
    .where(and(eq(webRateLimit.actorId, actorId), eq(webRateLimit.windowStart, windowStart)))
    .get()

  if (existing === undefined) {
    db.insert(webRateLimit).values({ actorId, windowStart, count: 1 }).run()
    log.info({ actorId, windowStart, count: 1 }, 'Web fetch quota initialized')
    return { allowed: true, remaining: LIMIT - 1 }
  }

  if (existing.count >= LIMIT) {
    const retryAfterSec = Math.ceil((windowStart + WINDOW_MS - nowMs) / 1000)
    log.warn({ actorId, windowStart, count: existing.count }, 'Web fetch quota exceeded')
    return { allowed: false, remaining: 0, retryAfterSec }
  }

  db.update(webRateLimit)
    .set({ count: existing.count + 1 })
    .where(and(eq(webRateLimit.actorId, actorId), eq(webRateLimit.windowStart, windowStart)))
    .run()

  return { allowed: true, remaining: LIMIT - existing.count - 1 }
}
```

- [ ] **Step 4: Re-run the web helper tests**

Run: `bun test tests/web/url-normalize.test.ts tests/web/rate-limit.test.ts`

Expected: PASS. URL canonicalization is deterministic and the fixed-window quota behavior matches the spec.

- [ ] **Step 5: Commit the helper slice**

```bash
git add src/web/types.ts src/web/url-normalize.ts src/web/rate-limit.ts tests/web/url-normalize.test.ts tests/web/rate-limit.test.ts
git commit -m "feat: add web fetch URL normalization and quota"
```

---

### Task 5: Add Bun-compatible safe public-web fetching

**Files:**

- Create: `src/web/safe-fetch.ts`
- Create: `tests/web/safe-fetch.test.ts`

- [ ] **Step 1: Write the failing safe-fetch tests**

```typescript
// tests/web/safe-fetch.test.ts
import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { webFetchError } from '../../src/errors.js'
import { safeFetchContent, type SafeFetchDeps } from '../../src/web/safe-fetch.js'
import { mockLogger } from '../utils/test-helpers.js'

describe('safeFetchContent', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('validates the initial URL and each redirect target', async () => {
    const responses = [
      new Response(null, { status: 302, headers: { location: 'https://example.com/final' } }),
      new Response('<html><body>Hello</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    ]

    const fetchImpl = mock((input: RequestInfo | URL) => Promise.resolve(responses.shift() ?? new Response('missing')))
    const assertPublicUrl = mock(async (_url: URL) => {})
    const deps: SafeFetchDeps = { fetch: fetchImpl as typeof fetch, assertPublicUrl }

    const result = await safeFetchContent('https://example.com/start', { abortSignal: AbortSignal.timeout(1000) }, deps)

    expect(result.finalUrl).toBe('https://example.com/final')
    expect(result.contentType).toBe('text/html')
    expect(new TextDecoder().decode(result.body)).toContain('Hello')
    expect(assertPublicUrl).toHaveBeenCalledTimes(2)
  })

  test('rejects unsupported content types', async () => {
    const deps: SafeFetchDeps = {
      fetch: mock(() =>
        Promise.resolve(
          new Response('PK', {
            status: 200,
            headers: { 'content-type': 'application/zip' },
          }),
        ),
      ) as typeof fetch,
      assertPublicUrl: async () => {},
    }

    await expect(
      safeFetchContent('https://example.com/archive.zip', { abortSignal: AbortSignal.timeout(1000) }, deps),
    ).rejects.toEqual(webFetchError.blockedContentType())
  })

  test('rejects oversized text bodies', async () => {
    const body = 'x'.repeat(2_000_001)
    const deps: SafeFetchDeps = {
      fetch: mock(() =>
        Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { 'content-type': 'text/plain' },
          }),
        ),
      ) as typeof fetch,
      assertPublicUrl: async () => {},
    }

    await expect(
      safeFetchContent('https://example.com/big', { abortSignal: AbortSignal.timeout(1000) }, deps),
    ).rejects.toEqual(webFetchError.tooLarge())
  })
})
```

- [ ] **Step 2: Run the safe-fetch test and verify it fails**

Run: `bun test tests/web/safe-fetch.test.ts`

Expected: FAIL with `Cannot find module '../../src/web/safe-fetch.js'`.

- [ ] **Step 3: Implement Bun-compatible DNS/IP validation, redirect handling, and bounded body reads**

```typescript
// src/web/safe-fetch.ts
import { lookup } from 'node:dns/promises'

import * as ipaddr from 'ipaddr.js'

import { webFetchError } from '../errors.js'
import { logger } from '../logger.js'
import type { SafeFetchResponse } from './types.js'

const log = logger.child({ scope: 'web:safe-fetch' })

const MAX_TEXT_BYTES = 2_000_000
const MAX_PDF_BYTES = 10_000_000
const MAX_REDIRECTS = 5
const TOTAL_TIMEOUT_MS = 30_000

export interface SafeFetchDeps {
  fetch: typeof fetch
  assertPublicUrl: (url: URL) => Promise<void>
}

const defaultDeps: SafeFetchDeps = {
  fetch,
  assertPublicUrl,
}

function isBlockedAddress(address: string): boolean {
  const parsed = ipaddr.parse(address)
  const range = parsed.range()
  return (
    range === 'loopback' ||
    range === 'private' ||
    range === 'linkLocal' ||
    range === 'uniqueLocal' ||
    range === 'carrierGradeNat' ||
    range === 'unspecified'
  )
}

export async function assertPublicUrl(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw webFetchError.blockedHost()
  }
  if (url.username !== '' || url.password !== '') {
    throw webFetchError.blockedHost()
  }

  const resolved = await lookup(url.hostname, { all: true, verbatim: true })
  if (resolved.length === 0 || resolved.some((entry) => isBlockedAddress(entry.address))) {
    throw webFetchError.blockedHost()
  }
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = response.body?.getReader()
  if (reader === undefined) return new Uint8Array()

  const chunks: Uint8Array[] = []
  let total = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value === undefined) continue
    total += value.byteLength
    if (total > maxBytes) throw webFetchError.tooLarge()
    chunks.push(value)
  }

  const combined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return combined
}

export async function safeFetchContent(
  rawUrl: string,
  options: { abortSignal?: AbortSignal; redirectCount?: number } = {},
  deps: SafeFetchDeps = defaultDeps,
): Promise<SafeFetchResponse> {
  const url = new URL(rawUrl)
  await deps.assertPublicUrl(url)

  const redirectCount = options.redirectCount ?? 0
  if (redirectCount > MAX_REDIRECTS) throw webFetchError.upstreamError(310)

  const signal =
    options.abortSignal === undefined
      ? AbortSignal.timeout(TOTAL_TIMEOUT_MS)
      : AbortSignal.any([options.abortSignal, AbortSignal.timeout(TOTAL_TIMEOUT_MS)])

  const response = await deps.fetch(url.toString(), {
    method: 'GET',
    redirect: 'manual',
    signal,
    headers: {
      Accept: 'text/html, application/xhtml+xml, text/plain, text/markdown, application/pdf',
      'User-Agent': `papai-bot/${process.env['npm_package_version'] ?? 'dev'}`,
    },
  })

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location')
    if (location === null) throw webFetchError.upstreamError(response.status)
    const redirected = new URL(location, url)
    return safeFetchContent(redirected.toString(), { abortSignal: signal, redirectCount: redirectCount + 1 }, deps)
  }

  if (!response.ok) {
    throw webFetchError.upstreamError(response.status)
  }

  const contentType = (response.headers.get('content-type') ?? 'application/octet-stream').split(';')[0].trim()
  const isPdf = contentType === 'application/pdf'
  const isTextLike = ['text/html', 'application/xhtml+xml', 'text/plain', 'text/markdown'].includes(contentType)
  if (!isPdf && !isTextLike) throw webFetchError.blockedContentType()

  const body = await readBoundedBody(response, isPdf ? MAX_PDF_BYTES : MAX_TEXT_BYTES)
  log.info({ url: rawUrl, finalUrl: response.url, contentType, bytes: body.byteLength }, 'Fetched web content')
  return { finalUrl: response.url === '' ? url.toString() : response.url, contentType, body }
}
```

- [ ] **Step 4: Re-run the safe-fetch unit tests**

Run: `bun test tests/web/safe-fetch.test.ts`

Expected: PASS. Redirect validation, content-type blocking, and byte limits all work under the injectable Bun-compatible fetch boundary.

- [ ] **Step 5: Commit the safe-fetch slice**

```bash
git add src/web/safe-fetch.ts tests/web/safe-fetch.test.ts
git commit -m "feat: add Bun-compatible safe web fetch"
```

---

### Task 6: Add generic HTML extraction and PDF text extraction

**Files:**

- Create: `src/web/extract.ts`
- Create: `src/web/pdf.ts`
- Create: `tests/web/extract.test.ts`
- Create: `tests/web/pdf.test.ts`

- [ ] **Step 1: Write the failing extraction tests**

```typescript
// tests/web/extract.test.ts
import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { webFetchError } from '../../src/errors.js'
import { extractHtmlContent, type ExtractHtmlDeps } from '../../src/web/extract.js'
import { mockLogger } from '../utils/test-helpers.js'

describe('extractHtmlContent', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('returns title and markdown content from Defuddle output', async () => {
    const deps: ExtractHtmlDeps = {
      parseDocument: () => ({ document: { title: 'ignored' } as unknown as Document }),
      defuddle: mock(async () => ({ title: 'Sample Article', content: '# Hello\n\nThis is clean markdown.' })),
    }

    const result = await extractHtmlContent('<html></html>', 'https://example.com/post', deps)
    expect(result).toEqual({
      title: 'Sample Article',
      content: '# Hello\n\nThis is clean markdown.',
    })
  })

  test('throws extract-failed when content is empty', async () => {
    const deps: ExtractHtmlDeps = {
      parseDocument: () => ({ document: { title: 'Empty' } as unknown as Document }),
      defuddle: mock(async () => ({ title: 'Empty', content: '' })),
    }

    await expect(extractHtmlContent('<html></html>', 'https://example.com/post', deps)).rejects.toEqual(
      webFetchError.extractFailed(),
    )
  })
})

// tests/web/pdf.test.ts
import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { extractPdfText, type PdfDeps } from '../../src/web/pdf.js'
import { mockLogger } from '../utils/test-helpers.js'

describe('extractPdfText', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('returns merged text from unpdf', async () => {
    const deps: PdfDeps = {
      getDocumentProxy: mock(async () => ({ id: 'pdf-proxy' })),
      extractText: mock(async () => ({ text: 'Page one\n\nPage two', totalPages: 2 })),
    }

    await expect(extractPdfText(new Uint8Array([37, 80, 68, 70]), deps)).resolves.toBe('Page one\n\nPage two')
  })
})
```

- [ ] **Step 2: Run the extraction tests and verify they fail**

Run: `bun test tests/web/extract.test.ts tests/web/pdf.test.ts`

Expected: FAIL with missing `../../src/web/extract.js` and `../../src/web/pdf.js`.

- [ ] **Step 3: Implement the local extraction helpers with dependency injection**

```typescript
// src/web/extract.ts
import { Defuddle } from 'defuddle/node'
import { parseHTML } from 'linkedom'

import { webFetchError } from '../errors.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'web:extract' })

export interface ExtractHtmlDeps {
  parseDocument: typeof parseHTML
  defuddle: typeof Defuddle
}

const defaultDeps: ExtractHtmlDeps = {
  parseDocument: parseHTML,
  defuddle: Defuddle,
}

export async function extractHtmlContent(
  html: string,
  url: string,
  deps: ExtractHtmlDeps = defaultDeps,
): Promise<{ title: string; content: string }> {
  const { document } = deps.parseDocument(html)
  const result = await deps.defuddle(document, url, { markdown: true })
  const title = result.title?.trim() || document.title?.trim() || new URL(url).hostname
  const content = result.content?.trim() ?? ''

  if (content.length === 0) {
    log.warn({ url }, 'HTML extraction returned empty content')
    throw webFetchError.extractFailed()
  }

  return { title, content }
}

// src/web/pdf.ts
import { extractText, getDocumentProxy } from 'unpdf'

import { logger } from '../logger.js'

const log = logger.child({ scope: 'web:pdf' })

export interface PdfDeps {
  getDocumentProxy: typeof getDocumentProxy
  extractText: typeof extractText
}

const defaultDeps: PdfDeps = {
  getDocumentProxy,
  extractText,
}

export async function extractPdfText(bytes: Uint8Array, deps: PdfDeps = defaultDeps): Promise<string> {
  const document = await deps.getDocumentProxy(bytes)
  const { text, totalPages } = await deps.extractText(document, { mergePages: true })
  log.info({ totalPages }, 'Extracted PDF text')
  return text.trim()
}
```

- [ ] **Step 4: Re-run the extraction unit tests**

Run: `bun test tests/web/extract.test.ts tests/web/pdf.test.ts`

Expected: PASS. HTML extraction produces clean markdown and PDF extraction reads text via the injected `unpdf` boundary.

- [ ] **Step 5: Commit the extraction slice**

```bash
git add src/web/extract.ts src/web/pdf.ts tests/web/extract.test.ts tests/web/pdf.test.ts
git commit -m "feat: add web content extraction helpers"
```

---

### Task 7: Add cache persistence and model-based distillation

**Files:**

- Create: `src/web/cache.ts`
- Create: `src/web/distill.ts`
- Create: `tests/web/cache.test.ts`
- Create: `tests/web/distill.test.ts`

- [ ] **Step 1: Write the failing cache and distillation tests**

```typescript
// tests/web/cache.test.ts
import { beforeEach, describe, expect, test } from 'bun:test'

import { getCachedWebFetch, putCachedWebFetch } from '../../src/web/cache.js'
import type { WebFetchResult } from '../../src/web/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const entry: WebFetchResult = {
  url: 'https://example.com/article',
  title: 'Example',
  summary: 'Short summary',
  excerpt: 'Longer excerpt',
  truncated: false,
  contentType: 'text/html',
  source: 'fetch',
  fetchedAt: 1_000,
}

describe('web cache', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns a fresh cached entry', () => {
    putCachedWebFetch('https://example.com/article', entry, 1_000 + 900_000)
    expect(getCachedWebFetch('https://example.com/article', 1_000 + 1)).toEqual({ ...entry, source: 'cache' })
  })

  test('returns null after expiry', () => {
    putCachedWebFetch('https://example.com/article', entry, 1_000 + 10)
    expect(getCachedWebFetch('https://example.com/article', 2_000)).toBeNull()
  })
})

// tests/web/distill.test.ts
import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { setCachedConfig } from '../../src/cache.js'
import { distillWebContent, type DistillDeps } from '../../src/web/distill.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('distillWebContent', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    setCachedConfig('ctx-1', 'llm_apikey', 'test-key')
    setCachedConfig('ctx-1', 'llm_baseurl', 'https://llm.example.test')
    setCachedConfig('ctx-1', 'main_model', 'gpt-main')
  })

  test('returns content unchanged when it is already small', async () => {
    await expect(
      distillWebContent({ storageContextId: 'ctx-1', title: 'Small', content: 'short text', goal: 'summarize' }),
    ).resolves.toEqual({
      summary: 'short text',
      excerpt: 'short text',
      truncated: false,
    })
  })

  test('falls back to main_model when small_model is missing', async () => {
    let capturedModel = ''
    const deps: DistillDeps = {
      generateText: mock(async ({ model }) => {
        capturedModel = String(model)
        return { text: 'Summary line\n\nImportant excerpt' }
      }),
      buildModel: (_apiKey, _baseUrl, modelId) => `model:${modelId}`,
    }

    const result = await distillWebContent(
      {
        storageContextId: 'ctx-1',
        title: 'Big article',
        content: 'x'.repeat(9_000),
        goal: 'summarize the main claim',
      },
      deps,
    )

    expect(capturedModel).toBe('model:gpt-main')
    expect(result.truncated).toBe(true)
    expect(result.summary).toContain('Summary line')
  })
})
```

- [ ] **Step 2: Run the cache/distillation tests and verify they fail**

Run: `bun test tests/web/cache.test.ts tests/web/distill.test.ts`

Expected: FAIL with missing `../../src/web/cache.js` and `../../src/web/distill.js`.

- [ ] **Step 3: Implement cache CRUD and context-aware distillation**

```typescript
// src/web/cache.ts
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { webCache } from '../db/schema.js'
import type { WebFetchResult } from './types.js'

const hashUrl = (normalizedUrl: string): string => createHash('sha256').update(normalizedUrl).digest('hex')

export function getCachedWebFetch(normalizedUrl: string, nowMs: number = Date.now()): WebFetchResult | null {
  const db = getDrizzleDb()
  const row = db
    .select()
    .from(webCache)
    .where(eq(webCache.urlHash, hashUrl(normalizedUrl)))
    .get()
  if (row === undefined || row.expiresAt <= nowMs) return null
  return {
    url: row.finalUrl,
    title: row.title,
    summary: row.summary,
    excerpt: row.excerpt,
    truncated: row.truncated,
    contentType: row.contentType,
    source: 'cache',
    fetchedAt: row.fetchedAt,
  }
}

export function putCachedWebFetch(normalizedUrl: string, result: WebFetchResult, expiresAt: number): void {
  const db = getDrizzleDb()
  db.insert(webCache)
    .values({
      urlHash: hashUrl(normalizedUrl),
      url: normalizedUrl,
      finalUrl: result.url,
      title: result.title,
      summary: result.summary,
      excerpt: result.excerpt,
      truncated: result.truncated,
      contentType: result.contentType,
      fetchedAt: result.fetchedAt,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: webCache.urlHash,
      set: {
        url: normalizedUrl,
        finalUrl: result.url,
        title: result.title,
        summary: result.summary,
        excerpt: result.excerpt,
        truncated: result.truncated,
        contentType: result.contentType,
        fetchedAt: result.fetchedAt,
        expiresAt,
      },
    })
    .run()
}

// src/web/distill.ts
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, type LanguageModel } from 'ai'

import { getConfig } from '../config.js'
import { fetchWithoutTimeout } from '../utils/fetch.js'

const MAX_EXCERPT_CHARS = 8_000

export interface DistillDeps {
  generateText: typeof generateText
  buildModel: (apiKey: string, baseUrl: string, modelId: string) => LanguageModel
}

const defaultDeps: DistillDeps = {
  generateText: (...args) => generateText(...args),
  buildModel: (apiKey, baseUrl, modelId) =>
    createOpenAICompatible({ name: 'openai-compatible', apiKey, baseURL: baseUrl, fetch: fetchWithoutTimeout })(
      modelId,
    ),
}

export async function distillWebContent(
  input: { storageContextId: string; title: string; content: string; goal?: string },
  deps: DistillDeps = defaultDeps,
): Promise<{ summary: string; excerpt: string; truncated: boolean }> {
  if (input.content.length <= MAX_EXCERPT_CHARS) {
    return { summary: input.content, excerpt: input.content, truncated: false }
  }

  const apiKey = getConfig(input.storageContextId, 'llm_apikey')!
  const baseUrl = getConfig(input.storageContextId, 'llm_baseurl')!
  const modelId = getConfig(input.storageContextId, 'small_model') ?? getConfig(input.storageContextId, 'main_model')!
  const model = deps.buildModel(apiKey, baseUrl, modelId)

  const result = await deps.generateText({
    model,
    prompt: [
      `Title: ${input.title}`,
      `Goal: ${input.goal ?? 'Summarize the page for later memo/task use.'}`,
      `Reply with a one-to-three sentence summary, then a blank line, then an excerpt under ${MAX_EXCERPT_CHARS} characters.`,
      '',
      input.content,
    ].join('\n'),
    timeout: 1_200_000,
  })

  const [summary, ...rest] = result.text.trim().split('\n\n')
  const excerpt = rest.join('\n\n').slice(0, MAX_EXCERPT_CHARS)
  return { summary: summary ?? excerpt, excerpt, truncated: true }
}
```

- [ ] **Step 4: Re-run the cache/distillation tests**

Run: `bun test tests/web/cache.test.ts tests/web/distill.test.ts`

Expected: PASS. Cache hits honor TTL, small content bypasses the model, and missing `small_model` falls back to `main_model`.

- [ ] **Step 5: Commit the cache/distillation slice**

```bash
git add src/web/cache.ts src/web/distill.ts tests/web/cache.test.ts tests/web/distill.test.ts
git commit -m "feat: add web fetch cache and distillation"
```

---

### Task 8: Add the top-level fetch/extract orchestrator

**Files:**

- Create: `src/web/fetch-extract.ts`
- Create: `tests/web/fetch-extract.test.ts`

- [ ] **Step 1: Write the failing orchestrator tests**

```typescript
// tests/web/fetch-extract.test.ts
import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { fetchAndExtract, type FetchAndExtractDeps } from '../../src/web/fetch-extract.js'
import type { WebFetchResult } from '../../src/web/types.js'
import { mockLogger } from '../utils/test-helpers.js'

const cachedResult: WebFetchResult = {
  url: 'https://example.com/post',
  title: 'Cached',
  summary: 'Cached summary',
  excerpt: 'Cached excerpt',
  truncated: false,
  contentType: 'text/html',
  source: 'cache',
  fetchedAt: 1_000,
}

describe('fetchAndExtract', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('returns a cache hit without fetching', async () => {
    const safeFetchContent = mock(async () => {
      throw new Error('should not fetch when cache is warm')
    })

    const deps: FetchAndExtractDeps = {
      consumeWebFetchQuota: () => ({ allowed: true, remaining: 19 }),
      normalizeWebUrl: (url) => url,
      getCachedWebFetch: () => cachedResult,
      putCachedWebFetch: () => {},
      safeFetchContent,
      extractHtmlContent: mock(async () => ({ title: 'unused', content: 'unused' })),
      extractPdfText: mock(async () => 'unused'),
      distillWebContent: mock(async () => ({ summary: 'unused', excerpt: 'unused', truncated: false })),
      now: () => 1_000,
    }

    await expect(
      fetchAndExtract({ storageContextId: 'ctx-1', actorUserId: 'actor-1', url: 'https://example.com/post' }, deps),
    ).resolves.toEqual(cachedResult)
    expect(safeFetchContent).not.toHaveBeenCalled()
  })

  test('uses actorUserId for quota and storageContextId for model config', async () => {
    let capturedActorId = ''
    let capturedStorageContextId = ''
    const deps: FetchAndExtractDeps = {
      consumeWebFetchQuota: (actorId) => {
        capturedActorId = actorId
        return { allowed: true, remaining: 19 }
      },
      normalizeWebUrl: (url) => url,
      getCachedWebFetch: () => null,
      putCachedWebFetch: () => {},
      safeFetchContent: mock(async () => ({
        finalUrl: 'https://example.com/post',
        contentType: 'text/html',
        body: new TextEncoder().encode('<html><body>Hello</body></html>'),
      })),
      extractHtmlContent: mock(async () => ({ title: 'Example', content: 'Hello world' })),
      extractPdfText: mock(async () => 'unused'),
      distillWebContent: mock(async (input) => {
        capturedStorageContextId = input.storageContextId
        return { summary: 'Hello world', excerpt: 'Hello world', truncated: false }
      }),
      now: () => 5_000,
    }

    const result = await fetchAndExtract(
      { storageContextId: 'group-123', actorUserId: 'user-456', url: 'https://example.com/post' },
      deps,
    )

    expect(capturedActorId).toBe('user-456')
    expect(capturedStorageContextId).toBe('group-123')
    expect(result.title).toBe('Example')
  })
})
```

- [ ] **Step 2: Run the orchestrator test and verify it fails**

Run: `bun test tests/web/fetch-extract.test.ts`

Expected: FAIL with `Cannot find module '../../src/web/fetch-extract.js'`.

- [ ] **Step 3: Implement the orchestration layer that composes quota, cache, safe fetch, extraction, and distillation**

```typescript
// src/web/fetch-extract.ts
import { webFetchError } from '../errors.js'
import { extractHtmlContent } from './extract.js'
import { getCachedWebFetch, putCachedWebFetch } from './cache.js'
import { extractPdfText } from './pdf.js'
import { consumeWebFetchQuota } from './rate-limit.js'
import { normalizeWebUrl } from './url-normalize.js'
import { safeFetchContent } from './safe-fetch.js'
import { distillWebContent } from './distill.js'
import type { RateLimitResult, WebFetchResult } from './types.js'

const DEFAULT_TTL_MS = 15 * 60 * 1000

export interface FetchAndExtractDeps {
  consumeWebFetchQuota: (actorId: string, nowMs?: number) => RateLimitResult
  normalizeWebUrl: typeof normalizeWebUrl
  getCachedWebFetch: typeof getCachedWebFetch
  putCachedWebFetch: typeof putCachedWebFetch
  safeFetchContent: typeof safeFetchContent
  extractHtmlContent: typeof extractHtmlContent
  extractPdfText: typeof extractPdfText
  distillWebContent: typeof distillWebContent
  now: () => number
}

const defaultDeps: FetchAndExtractDeps = {
  consumeWebFetchQuota,
  normalizeWebUrl,
  getCachedWebFetch,
  putCachedWebFetch,
  safeFetchContent,
  extractHtmlContent,
  extractPdfText,
  distillWebContent,
  now: () => Date.now(),
}

export async function fetchAndExtract(
  input: {
    storageContextId: string
    actorUserId?: string
    url: string
    goal?: string
    abortSignal?: AbortSignal
  },
  deps: FetchAndExtractDeps = defaultDeps,
): Promise<WebFetchResult> {
  const actorId = input.actorUserId ?? input.storageContextId
  const quota = deps.consumeWebFetchQuota(actorId, deps.now())
  if (!quota.allowed) throw webFetchError.rateLimited()

  const normalizedUrl = deps.normalizeWebUrl(input.url)
  const cached = deps.getCachedWebFetch(normalizedUrl, deps.now())
  if (cached !== null) return cached

  const fetched = await deps.safeFetchContent(normalizedUrl, { abortSignal: input.abortSignal })

  let title = new URL(fetched.finalUrl).hostname
  let content = new TextDecoder().decode(fetched.body)

  if (fetched.contentType === 'application/pdf') {
    content = await deps.extractPdfText(fetched.body)
  } else if (fetched.contentType === 'text/html' || fetched.contentType === 'application/xhtml+xml') {
    const extracted = await deps.extractHtmlContent(content, fetched.finalUrl)
    title = extracted.title
    content = extracted.content
  }

  const distilled = await deps.distillWebContent({
    storageContextId: input.storageContextId,
    title,
    content,
    goal: input.goal,
  })

  const result: WebFetchResult = {
    url: fetched.finalUrl,
    title,
    summary: distilled.summary,
    excerpt: distilled.excerpt,
    truncated: distilled.truncated,
    contentType: fetched.contentType,
    source: 'fetch',
    fetchedAt: deps.now(),
  }

  deps.putCachedWebFetch(normalizedUrl, result, deps.now() + DEFAULT_TTL_MS)
  return result
}
```

- [ ] **Step 4: Re-run the orchestrator tests**

Run: `bun test tests/web/fetch-extract.test.ts`

Expected: PASS. The orchestrator respects actor/context scoping, reuses cache hits, and returns the final structured result.

- [ ] **Step 5: Commit the orchestration slice**

```bash
git add src/web/fetch-extract.ts tests/web/fetch-extract.test.ts
git commit -m "feat: add web fetch orchestration"
```

---

### Task 9: Wire the `web_fetch` tool into the toolset and prompt, then document it

**Files:**

- Create: `src/tools/web-fetch.ts`
- Modify: `src/tools/tools-builder.ts`
- Modify: `src/system-prompt.ts`
- Modify: `CLAUDE.md`
- Create: `tests/tools/web-fetch.test.ts`
- Modify: `tests/tools/index.test.ts`
- Modify: `tests/tools/tools-builder.test.ts`
- Modify: `tests/system-prompt.test.ts`

- [ ] **Step 1: Write the failing tool-wiring and prompt tests**

```typescript
// tests/tools/web-fetch.test.ts
import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { makeWebFetchTool } from '../../src/tools/web-fetch.js'
import { mockLogger } from '../utils/test-helpers.js'

describe('makeWebFetchTool', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('forwards storage context, actor user, url, goal, and abortSignal to fetchAndExtract', async () => {
    let captured: unknown = null
    const fetchAndExtract = mock(async (input) => {
      captured = input
      return {
        url: 'https://example.com/post',
        title: 'Example',
        summary: 'Summary',
        excerpt: 'Excerpt',
        truncated: false,
        contentType: 'text/html',
        source: 'fetch',
        fetchedAt: 123,
      }
    })

    const tool = makeWebFetchTool('group-123', 'user-456', { fetchAndExtract })
    if (!tool.execute) throw new Error('Tool execute is undefined')

    const abortSignal = AbortSignal.timeout(1000)
    await tool.execute(
      { url: 'https://example.com/post', goal: 'summarize' },
      { toolCallId: '1', messages: [], abortSignal },
    )

    expect(captured).toEqual({
      storageContextId: 'group-123',
      actorUserId: 'user-456',
      url: 'https://example.com/post',
      goal: 'summarize',
      abortSignal,
    })
  })
})

// tests/tools/index.test.ts
test('includes web_fetch when storageContextId is defined', () => {
  const tools = makeTools(provider, { storageContextId: 'user-1', chatUserId: 'user-1' })
  expect(tools).toHaveProperty('web_fetch')
})

test('excludes web_fetch when storageContextId is undefined', () => {
  const tools = makeTools(provider, { chatUserId: 'user-1' })
  expect(tools).not.toHaveProperty('web_fetch')
})

// tests/tools/tools-builder.test.ts
it('adds web_fetch when a storage context exists', () => {
  const provider = createMockProvider()
  const tools = buildTools(provider, 'user-123', 'group-456', 'normal', 'group')
  expect(tools).toHaveProperty('web_fetch')
})

// tests/system-prompt.test.ts
test('includes web_fetch guidance in the static prompt', () => {
  const prompt = buildSystemPrompt(provider, 'user-1')
  expect(prompt).toContain('web_fetch')
  expect(prompt).toContain('public URL')
})
```

- [ ] **Step 2: Run the tool/prompt tests and verify they fail**

Run: `bun test tests/tools/web-fetch.test.ts tests/tools/index.test.ts tests/tools/tools-builder.test.ts tests/system-prompt.test.ts`

Expected: FAIL with missing `../../src/tools/web-fetch.js`, missing `web_fetch` in the tool builders, and prompt text that does not yet mention the new tool.

- [ ] **Step 3: Add the tool wrapper, register it in `tools-builder`, extend the prompt, and document the new tool**

```typescript
// src/tools/web-fetch.ts
import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import { fetchAndExtract as defaultFetchAndExtract } from '../web/fetch-extract.js'

const log = logger.child({ scope: 'tool:web-fetch' })

export interface WebFetchToolDeps {
  fetchAndExtract: typeof defaultFetchAndExtract
}

const defaultDeps: WebFetchToolDeps = {
  fetchAndExtract: defaultFetchAndExtract,
}

export function makeWebFetchTool(
  storageContextId: string,
  actorUserId?: string,
  deps: WebFetchToolDeps = defaultDeps,
): ToolSet[string] {
  return tool({
    description:
      'Fetch a public URL, extract readable content, and return a bounded summary plus excerpt. Use when the user shares or refers to a URL and you need the page contents to answer or create a memo/task.',
    inputSchema: z.object({
      url: z.string().url().describe('Fully qualified public http(s) URL'),
      goal: z.string().optional().describe('Optional extraction goal that guides summarization'),
    }),
    execute: async ({ url, goal }, { abortSignal }) => {
      log.debug({ storageContextId, actorUserId, url, hasGoal: goal !== undefined }, 'web_fetch called')
      const result = await deps.fetchAndExtract({ storageContextId, actorUserId, url, goal, abortSignal })
      log.info({ storageContextId, actorUserId, url, finalUrl: result.url }, 'Web fetch succeeded')
      return result
    },
  })
}

// src/tools/tools-builder.ts
import { makeWebFetchTool } from './web-fetch.js'

function addWebFetchTool(tools: ToolSet, storageContextId: string | undefined, actorUserId: string | undefined): void {
  if (storageContextId === undefined) return
  tools['web_fetch'] = makeWebFetchTool(storageContextId, actorUserId)
}

export function buildTools(
  provider: TaskProvider,
  chatUserId: string | undefined,
  contextId: string | undefined,
  mode: ToolMode,
  contextType?: ContextType,
): ToolSet {
  const tools = makeCoreTools(provider, chatUserId)
  addWebFetchTool(tools, contextId, chatUserId)
  maybeAddProjectTools(tools, provider)
  maybeAddCommentTools(tools, provider)
  // keep the remaining builder order unchanged
  return tools
}

// src/system-prompt.ts
const STATIC_RULES = `WORKFLOW:
...
WEB FETCH — When the user shares a public URL or refers back to one and you need the page contents, call web_fetch before answering. Use the returned summary/excerpt as source material, and only persist that information if the user explicitly wants a memo or task.
...
`
```

```markdown
<!-- CLAUDE.md -->

| `web_fetch` | Fetch a public URL and return a bounded summary/excerpt for memo/task enrichment |
```

- [ ] **Step 4: Re-run the tool/prompt tests**

Run: `bun test tests/tools/web-fetch.test.ts tests/tools/index.test.ts tests/tools/tools-builder.test.ts tests/system-prompt.test.ts`

Expected: PASS. The new tool is registered only when a storage context exists, the wrapper forwards context and aborts correctly, and the prompt now teaches the model when to use the feature.

- [ ] **Step 5: Commit the user-visible wiring slice**

```bash
git add src/tools/web-fetch.ts src/tools/tools-builder.ts src/system-prompt.ts CLAUDE.md tests/tools/web-fetch.test.ts tests/tools/index.test.ts tests/tools/tools-builder.test.ts tests/system-prompt.test.ts
git commit -m "feat: wire web fetch tool and prompt guidance"
```

---

### Task 10: Add local integration coverage and run the full verification set

**Files:**

- Create: `tests/web/fetch-extract.integration.test.ts`
- Modify: `src/web/safe-fetch.ts`
- Modify: `src/web/fetch-extract.ts`

- [ ] **Step 1: Write the failing integration tests using a local `Bun.serve` fixture server and an explicit test-only host validator override**

```typescript
// tests/web/fetch-extract.integration.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { setCachedConfig } from '../../src/cache.js'
import { fetchAndExtract } from '../../src/web/fetch-extract.js'
import { safeFetchContent, type SafeFetchDeps } from '../../src/web/safe-fetch.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('fetchAndExtract integration', () => {
  let server: ReturnType<typeof Bun.serve>
  let baseUrl: string

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    setCachedConfig('ctx-1', 'llm_apikey', 'test-key')
    setCachedConfig('ctx-1', 'llm_baseurl', 'https://llm.example.test')
    setCachedConfig('ctx-1', 'main_model', 'gpt-main')

    server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === '/html') {
          return new Response(
            '<html><head><title>Example</title></head><body><article><h1>Hello</h1><p>World</p></article></body></html>',
            {
              headers: { 'content-type': 'text/html' },
            },
          )
        }
        if (url.pathname === '/redirect') {
          return Response.redirect(`${baseUrl}/html`, 302)
        }
        return new Response('missing', { status: 404 })
      },
    })
    baseUrl = `http://127.0.0.1:${server.port}`
  })

  afterEach(() => {
    server.stop(true)
  })

  test('fetches HTML once and returns the cached result on the second call', async () => {
    const safeFetchDeps: SafeFetchDeps = { fetch, assertPublicUrl: async () => {} }

    const first = await fetchAndExtract(
      { storageContextId: 'ctx-1', actorUserId: 'actor-1', url: `${baseUrl}/html` },
      {
        safeFetchContent: (url, options) => safeFetchContent(url, options, safeFetchDeps),
      },
    )
    const second = await fetchAndExtract(
      { storageContextId: 'ctx-1', actorUserId: 'actor-1', url: `${baseUrl}/html` },
      {
        safeFetchContent: (url, options) => safeFetchContent(url, options, safeFetchDeps),
      },
    )

    expect(first.source).toBe('fetch')
    expect(second.source).toBe('cache')
    expect(second.summary.length).toBeGreaterThan(0)
  })

  test('follows a redirect when each hop is explicitly allowed by the test validator', async () => {
    const safeFetchDeps: SafeFetchDeps = { fetch, assertPublicUrl: async () => {} }

    const result = await fetchAndExtract(
      { storageContextId: 'ctx-1', actorUserId: 'actor-1', url: `${baseUrl}/redirect` },
      {
        safeFetchContent: (url, options) => safeFetchContent(url, options, safeFetchDeps),
      },
    )

    expect(result.url).toBe(`${baseUrl}/html`)
    expect(result.title).toContain('Example')
  })
})
```

- [ ] **Step 2: Run the integration test and verify it fails**

Run: `bun test tests/web/fetch-extract.integration.test.ts`

Expected: FAIL until `fetchAndExtract()` cleanly accepts a `safeFetchContent` dependency override all the way through the pipeline and the cache/source behavior is fully wired.

- [ ] **Step 3: Make the final plumbing adjustments the integration test exposed**

```typescript
// src/web/fetch-extract.ts
const defaultDeps: FetchAndExtractDeps = {
  consumeWebFetchQuota,
  normalizeWebUrl,
  getCachedWebFetch,
  putCachedWebFetch,
  safeFetchContent,
  extractHtmlContent,
  extractPdfText,
  distillWebContent,
  now: () => Date.now(),
}

export async function fetchAndExtract(
  input: {
    storageContextId: string
    actorUserId?: string
    url: string
    goal?: string
    abortSignal?: AbortSignal
  },
  overrides: Partial<FetchAndExtractDeps> = {},
): Promise<WebFetchResult> {
  const deps: FetchAndExtractDeps = { ...defaultDeps, ...overrides }
  // existing orchestrator body stays the same
}

// src/web/safe-fetch.ts
export interface SafeFetchDeps {
  fetch: typeof fetch
  assertPublicUrl: (url: URL) => Promise<void>
}

const defaultDeps: SafeFetchDeps = {
  fetch,
  assertPublicUrl,
}
```

The only purpose of this task is to ensure the real pipeline remains integration-testable without weakening production host validation.

- [ ] **Step 4: Run the integration test, then the full repo verification**

Run: `bun test tests/web/fetch-extract.integration.test.ts && bun test && bun run check:full`

Expected: PASS. The local end-to-end fetch path works, the new `tests/web` directory is part of the default suite, and the repo-wide checks stay green.

- [ ] **Step 5: Commit the integration and verification slice**

```bash
git add src/web/safe-fetch.ts src/web/fetch-extract.ts tests/web/fetch-extract.integration.test.ts
git commit -m "test: add web fetch integration coverage"
```
