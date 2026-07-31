<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ACP Transcript Web Viewer + Shareable Links — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give papai a stable, no-login shareable URL that renders a magi coding-session transcript live (SSE) and historically, by teaching the acp plugin to surface magi's `transcriptUrl`, adding a public papai proxy to magi's token-scoped endpoints, and building a small Svelte viewer SPA.

**Architecture:** Three isolated papai concerns. (1) The acp plugin reads `shareToken`/`transcriptUrl` from magi's session-creation responses and stores them on the `SessionRecord`; magi's raw response already flows to the model, so the link surfaces for free. (2) A public `src/debug/transcript-viewer.ts` dispatcher (mounted before the dashboard-auth gate, like `/api/notify`) serves the viewer assets and blind-proxies `/t/:token/stream` (long-lived SSE) and `/t/:token/transcript` (JSON) to magi using the acp plugin's admin `magi_base_url`/`magi_token`. (3) A `client/transcript/` Svelte SPA stitches history + live by `seq` and renders the timeline read-only.

**Tech Stack:** Bun, TypeScript (strict, `.js` import extensions), Zod v4, Svelte 5 (`mount()` + runes + snippets), Bun test. magi endpoints are a **precondition** (separate magi-side spec) — this plan codes against the contract and tests against a mock magi.

**Spec:** `docs/superpowers/specs/2026-07-05-acp-transcript-web-viewer-design.md`

---

## Contract assumed from magi (NOT built here)

- `POST /sessions`, `POST /sessions/:id/follow-up`, `POST /reviews` responses include `shareToken: string` and `transcriptUrl: string` (`<papaiBase>/t/<token>`), alongside the existing `id`.
- `GET /t/:token/stream` — SSE live tail; `GET /t/:token/transcript?after=<seq>&limit=<n>` — paginated history `{ events, nextCursor, recording? }`. Both bearer-authed with the same `magi_token`. Unknown token → `404`.

Wire event shape (both endpoints): `{ "seq": number, "ts": string, "type": "prompt"|"update"|"permission_request"|"permission_decision"|"result", "payload": object }`.

## File structure

**New (papai source):**

- `src/debug/transcript-viewer.ts` — public route dispatcher + magi proxy (config accessor, SSE proxy, history proxy, asset/shell serve).

**New (client SPA — `client/transcript/`):**

- `index.ts` — mount + token parse. `transcript.html` — shell. `transcript.css` — layout.
- `TranscriptApp.svelte` — root. `transcript.svelte.ts` — runes state + load orchestration.
- `stitch.ts` — pure history+live dedupe. `fetcher-schemas.ts` — Zod. `fetchers.ts` — history paging. `sse.ts` — EventSource wrapper.
- `components/TimelineEvent.svelte` — per-event renderer. `components/StatusBanner.svelte` — connection/error states.
- `TranscriptApp.stories.svelte`, `components/TimelineEvent.stories.svelte` — Storybook.

**New (tests):**

- `tests/debug/transcript-viewer.test.ts`, `tests/client/transcript/stitch.test.ts`, `tests/client/transcript/fetcher-schemas.test.ts`.

**Modified:**

- `plugins/acp/history.ts` — `shareToken`/`transcriptUrl` on `SessionRecord` + parser.
- `plugins/acp/tools.ts` — `shareFieldsOf(result)` helper.
- `plugins/acp/session-tools.ts` — store share fields in `recordStartedSession`/`recordReviewSession`; surface `transcriptUrl` in `enrichSession`.
- `plugins/acp/continue-tool.ts` — store share fields on the child record.
- `plugins/acp/index.ts` — prompt fragment nudges sharing the link.
- `src/debug/server.ts` — import + mount `routeTranscriptPaths` before the auth gate.
- `scripts/build-client.ts` — `BUNDLES` entry `transcript`.
- `scripts/check-bundle-isolation.ts` — add `public/transcript.js`.
- `tests/plugins/acp/history.test.ts`, `tests/plugins/acp/start-session.test.ts` — new cases.
- `docs/architecture/coding-sessions.md`, `docs/architecture/environment.md` — docs.

---

## Phase 1 — Plugin: surface & store the share fields

### Task 1: `SessionRecord` gains `shareToken` / `transcriptUrl`

**Files:**

- Modify: `plugins/acp/history.ts:11-19` (type), `:42-59` (`toSessionRecord`)
- Test: `tests/plugins/acp/history.test.ts`

- [ ] **Step 1: Write the failing test** — append to `tests/plugins/acp/history.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { readRecord, writeRecord } from '../../../plugins/acp/history.js'

function fakeKv(): {
  get(k: string): string | undefined
  set(k: string, v: string): void
} {
  const map = new Map<string, string>()
  return { get: (k) => map.get(k), set: (k, v) => void map.set(k, v) }
}

describe('SessionRecord share fields', () => {
  test('round-trips shareToken and transcriptUrl', () => {
    const kv = fakeKv()
    writeRecord(kv, 'sess-1', {
      project: 'app',
      title: 'fix bug',
      createdAt: '2026-07-05T00:00:00.000Z',
      shareToken: 'tok_abc',
      transcriptUrl: 'https://papai.example/t/tok_abc',
    })
    const rec = readRecord(kv, 'sess-1')
    expect(rec?.shareToken).toBe('tok_abc')
    expect(rec?.transcriptUrl).toBe('https://papai.example/t/tok_abc')
  })

  test('ignores non-string share fields', () => {
    const kv = fakeKv()
    kv.set(
      'session:sess-2',
      JSON.stringify({
        project: 'a',
        title: 't',
        createdAt: 'x',
        shareToken: 42,
      }),
    )
    expect(readRecord(kv, 'sess-2')?.shareToken).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `bun test tests/plugins/acp/history.test.ts -t "share fields"`
Expected: FAIL — `shareToken` is `undefined` (type/parser drop it).

- [ ] **Step 3: Add the fields to the type** — `plugins/acp/history.ts:11-19`:

```ts
export type SessionRecord = {
  project: string
  title: string
  createdAt: string
  parentSessionId?: string
  prNumber?: number
  prUrl?: string
  status?: string
  shareToken?: string
  transcriptUrl?: string
}
```

- [ ] **Step 4: Parse them in `toSessionRecord`** — in `plugins/acp/history.ts:42-58`, add the two reads and assignments (mirror the existing optional-string handling for `prUrl`):

```ts
const status = fields.get('status')
const shareToken = fields.get('shareToken')
const transcriptUrl = fields.get('transcriptUrl')
if (typeof project !== 'string' || typeof title !== 'string' || typeof createdAt !== 'string') return null

const result: SessionRecord = { project, title, createdAt }
if (typeof parentSessionId === 'string') result.parentSessionId = parentSessionId
if (typeof prNumber === 'number') result.prNumber = prNumber
if (typeof prUrl === 'string') result.prUrl = prUrl
if (typeof status === 'string') result.status = status
if (typeof shareToken === 'string') result.shareToken = shareToken
if (typeof transcriptUrl === 'string') result.transcriptUrl = transcriptUrl
return result
```

- [ ] **Step 5: Run it, verify it passes**

Run: `bun test tests/plugins/acp/history.test.ts -t "share fields"`
Expected: PASS (both cases).

- [ ] **Step 6: Commit**

```bash
git add plugins/acp/history.ts tests/plugins/acp/history.test.ts
git commit -m "feat(acp): store shareToken/transcriptUrl on SessionRecord"
```

### Task 2: Extract share fields from magi responses & store them

**Files:**

- Modify: `plugins/acp/tools.ts` (add `shareFieldsOf` near `sessionIdOf` at `:51-56`)
- Modify: `plugins/acp/session-tools.ts:32-47` (`recordStartedSession`, `recordReviewSession`), `:116-120` (`enrichSession` return)
- Modify: `plugins/acp/continue-tool.ts` (child-record write)
- Test: `tests/plugins/acp/start-session.test.ts`

- [ ] **Step 1: Add `shareFieldsOf` to `plugins/acp/tools.ts`** (directly after `sessionIdOf`):

```ts
export function shareFieldsOf(result: unknown): {
  shareToken?: string
  transcriptUrl?: string
} {
  if (typeof result !== 'object' || result === null) return {}
  const map: Map<string, unknown> = new Map(Object.entries(result))
  const shareToken = map.get('shareToken')
  const transcriptUrl = map.get('transcriptUrl')
  return {
    ...(typeof shareToken === 'string' && shareToken.length > 0 ? { shareToken } : {}),
    ...(typeof transcriptUrl === 'string' && transcriptUrl.length > 0 ? { transcriptUrl } : {}),
  }
}
```

- [ ] **Step 2: Write the failing test** — append to `tests/plugins/acp/start-session.test.ts`. First open the file and reuse its existing harness for building `runtimeContext` and stubbing `callMagi`/`httpFetch` (find the existing `start_session` happy-path test and copy its setup). Add:

```ts
test('start_session stores shareToken + transcriptUrl from magi response', async () => {
  // Reuse this file's existing harness: a runtimeContext with a Map-backed kv,
  // and an httpFetch stub whose /sessions response body includes the share fields.
  const ctx = makeRuntimeContext() // existing helper in this file
  const httpFetch = stubHttpFetch({
    'POST /sessions': {
      status: 200,
      body: {
        id: 'sess-9',
        shareToken: 'tok_z',
        transcriptUrl: 'https://papai.example/t/tok_z',
      },
    },
  }) // existing helper/pattern in this file
  await getExecutor(startSessionTool(httpFetch)).execute({ project: 'app', prompt: 'do it' }, ctx)
  const stored = readRecord(ctx.kv, 'sess-9')
  expect(stored?.shareToken).toBe('tok_z')
  expect(stored?.transcriptUrl).toBe('https://papai.example/t/tok_z')
})
```

> If the file's helpers are named differently, adapt the three helper calls (`makeRuntimeContext`, `stubHttpFetch`, `getExecutor`) to the local equivalents — the assertions on `readRecord(...)` are the point.

- [ ] **Step 3: Run it, verify it fails**

Run: `bun test tests/plugins/acp/start-session.test.ts -t "stores shareToken"`
Expected: FAIL — `shareToken` undefined (not yet stored).

- [ ] **Step 4: Store share fields in `recordStartedSession` and `recordReviewSession`** — `plugins/acp/session-tools.ts:32-47`. Add `shareFieldsOf` to the import on line 26 (`import { buildSessionProjectSpec, canDeriveForge, sessionIdOf, shareFieldsOf } from './tools.js'`), then:

```ts
function recordStartedSession(runtimeContext: RuntimeContext, result: unknown, project: string, prompt: string): void {
  const id = sessionIdOf(result)
  if (id !== null)
    writeRecord(runtimeContext.kv, id, {
      project,
      title: deriveTitle(prompt),
      createdAt: new Date().toISOString(),
      ...shareFieldsOf(result),
    })
}

function recordReviewSession(runtimeContext: RuntimeContext, result: unknown, project: string, prNumber: number): void {
  const id = sessionIdOf(result)
  if (id !== null)
    writeRecord(runtimeContext.kv, id, {
      project,
      title: `review PR #${prNumber}`,
      createdAt: new Date().toISOString(),
      prNumber,
      ...shareFieldsOf(result),
    })
}
```

- [ ] **Step 5: Surface `transcriptUrl` in `enrichSession`** — `plugins/acp/session-tools.ts:116-120`. The rewrite on `:109` already preserves the fields via `...record`; add `transcriptUrl` to the returned row so `list_sessions` exposes it:

```ts
return {
  ...row,
  ...(record === null
    ? {}
    : {
        title: record.title,
        parentSessionId: record.parentSessionId,
        ...(record.transcriptUrl === undefined ? {} : { transcriptUrl: record.transcriptUrl }),
      }),
  ...(prNumber === undefined ? {} : { prNumber }),
}
```

- [ ] **Step 6: Store share fields on the follow-up child record** — `plugins/acp/continue-tool.ts`. Add `shareFieldsOf` to its import from `./tools.js`, and at the child-record write site (`writeRecord(runtimeContext.kv, childId, buildChildRecord(...))`) merge the fields:

```ts
writeRecord(runtimeContext.kv, childId, {
  ...buildChildRecord(parentId, parentRecord, prompt),
  ...shareFieldsOf(result),
})
```

- [ ] **Step 7: Run it, verify it passes**

Run: `bun test tests/plugins/acp/start-session.test.ts -t "stores shareToken"`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add plugins/acp/tools.ts plugins/acp/session-tools.ts plugins/acp/continue-tool.ts tests/plugins/acp/start-session.test.ts
git commit -m "feat(acp): capture magi share token/url on session records"
```

### Task 3: Prompt fragment nudges sharing the live link

**Files:**

- Modify: `plugins/acp/index.ts:93-101` (`ACP_PROMPT_FRAGMENT`)

- [ ] **Step 1: Append a sentence** to `ACP_PROMPT_FRAGMENT` (after the existing final sentence, still one string):

```ts
'Use list_projects/list_agents to discover what is configured. The user is notified when a session ' +
  'finishes or needs input. ' +
  'When start_session/continue_session/review_pr returns a transcriptUrl, include that link in your reply ' +
  'so the user can watch the session live in the browser and share it.'
```

- [ ] **Step 2: Verify the fragment test still passes** (if `tests/plugins/acp/*` asserts fragment content, update the expectation; otherwise the manifest/lifecycle tests should stay green):

Run: `bun test tests/plugins/acp/`
Expected: PASS (adjust any snapshot/exact-string assertion on the fragment to include the new sentence).

- [ ] **Step 3: Commit**

```bash
git add plugins/acp/index.ts tests/plugins/acp/
git commit -m "feat(acp): prompt agent to share the transcript link"
```

---

## Phase 2 — Core: public proxy routes

### Task 4: Viewer magi-config accessor

**Files:**

- Create: `src/debug/transcript-viewer.ts`
- Test: `tests/debug/transcript-viewer.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/debug/transcript-viewer.test.ts`:

```ts
import { afterEach, describe, expect, test } from 'bun:test'
import { setupTestDb } from '../utils/test-helpers.js'
import { setPluginAdminConfig } from '../../src/plugins/store.js'
import { getViewerMagiConfig } from '../../src/debug/transcript-viewer.js'

describe('getViewerMagiConfig', () => {
  afterEach(() => {
    /* setupTestDb resets per test */
  })

  test('reads and normalizes acp admin config', async () => {
    await setupTestDb()
    setPluginAdminConfig('acp', 'magi_base_url', 'https://magi.example/', 'test')
    setPluginAdminConfig('acp', 'magi_token', '  sekret  ', 'test')
    expect(getViewerMagiConfig()).toEqual({
      baseUrl: 'https://magi.example',
      token: 'sekret',
    })
  })

  test('returns null when unset', async () => {
    await setupTestDb()
    expect(getViewerMagiConfig()).toBeNull()
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `bun test tests/debug/transcript-viewer.test.ts -t getViewerMagiConfig`
Expected: FAIL — module `src/debug/transcript-viewer.ts` does not exist.

- [ ] **Step 3: Create `src/debug/transcript-viewer.ts`** with the license header and the accessor:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import { getPluginAdminConfig } from '../plugins/store.js'

const PUBLIC_DIR = path.resolve(import.meta.dir, '../../public')

export type ViewerMagiConfig = { baseUrl: string; token: string }

export function getViewerMagiConfig(): ViewerMagiConfig | null {
  const baseUrl = getPluginAdminConfig('acp', 'magi_base_url')
  const token = getPluginAdminConfig('acp', 'magi_token')
  if (baseUrl === undefined || baseUrl.trim() === '' || token === undefined || token.trim() === '') return null
  return { baseUrl: baseUrl.trim().replace(/\/+$/u, ''), token: token.trim() }
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `bun test tests/debug/transcript-viewer.test.ts -t getViewerMagiConfig`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/debug/transcript-viewer.ts tests/debug/transcript-viewer.test.ts
git commit -m "feat(debug): read acp magi config from core for transcript proxy"
```

### Task 5: Historical JSON proxy

**Files:**

- Modify: `src/debug/transcript-viewer.ts`
- Test: `tests/debug/transcript-viewer.test.ts`

- [ ] **Step 1: Write the failing test** — append:

```ts
import { proxyTranscriptHistory } from '../../src/debug/transcript-viewer.js'

describe('proxyTranscriptHistory', () => {
  const cfg = { baseUrl: 'https://magi.example', token: 'sekret' }

  test('forwards token + query and attaches bearer; passes body through', async () => {
    let seenUrl = ''
    let seenAuth: string | null = null
    const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
      seenUrl = input
      seenAuth = new Headers(init?.headers).get('authorization')
      return new Response(JSON.stringify({ events: [], nextCursor: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const url = new URL('https://papai.example/t/tok_z/transcript?after=5&limit=100')
    const res = await proxyTranscriptHistory(url, 'tok_z', cfg, fetchImpl)
    expect(seenUrl).toBe('https://magi.example/t/tok_z/transcript?after=5&limit=100')
    expect(seenAuth).toBe('Bearer sekret')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ events: [], nextCursor: null })
  })

  test('passes magi 404 through', async () => {
    const fetchImpl = async (): Promise<Response> => new Response('nope', { status: 404 })
    const res = await proxyTranscriptHistory(new URL('https://papai.example/t/bad/transcript'), 'bad', cfg, fetchImpl)
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `bun test tests/debug/transcript-viewer.test.ts -t proxyTranscriptHistory`
Expected: FAIL — `proxyTranscriptHistory` not exported.

- [ ] **Step 3: Implement `proxyTranscriptHistory`** in `src/debug/transcript-viewer.ts`:

```ts
type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>

const ALLOWED_QUERY = new Set(['after', 'limit'])

export async function proxyTranscriptHistory(
  url: URL,
  token: string,
  cfg: ViewerMagiConfig,
  fetchImpl: FetchImpl = fetch,
): Promise<Response> {
  const params = new URLSearchParams()
  for (const [k, v] of url.searchParams) if (ALLOWED_QUERY.has(k)) params.set(k, v)
  const qs = params.toString()
  const target = `${cfg.baseUrl}/t/${encodeURIComponent(token)}/transcript${qs === '' ? '' : `?${qs}`}`
  const upstream = await fetchImpl(target, {
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  })
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
    },
  })
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `bun test tests/debug/transcript-viewer.test.ts -t proxyTranscriptHistory`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/debug/transcript-viewer.ts tests/debug/transcript-viewer.test.ts
git commit -m "feat(debug): proxy historical transcript reads to magi"
```

### Task 6: Long-lived SSE proxy

**Files:**

- Modify: `src/debug/transcript-viewer.ts`
- Test: `tests/debug/transcript-viewer.test.ts`

The load-bearing invariant: this uses a plain `fetch` bound to the **client** `AbortSignal` — never `providerRuntime.httpFetch` (30s cap) — so a multi-minute session streams uninterrupted, and a client disconnect aborts the upstream.

- [ ] **Step 1: Write the failing test** — append:

```ts
import { proxyTranscriptStream } from '../../src/debug/transcript-viewer.js'

describe('proxyTranscriptStream', () => {
  const cfg = { baseUrl: 'https://magi.example', token: 'sekret' }

  test('pipes SSE body through with event-stream headers and bearer; binds client signal', async () => {
    const clientAbort = new AbortController()
    let seenSignal: AbortSignal | undefined
    let seenAuth: string | null = null
    const upstreamBody = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('id: 1\nevent: update\ndata: {"seq":1}\n\n'))
        c.close()
      },
    })
    const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
      seenSignal = init?.signal ?? undefined
      seenAuth = new Headers(init?.headers).get('authorization')
      return new Response(upstreamBody, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }
    const res = await proxyTranscriptStream('tok_z', cfg, clientAbort.signal, fetchImpl)
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    expect(seenAuth).toBe('Bearer sekret')
    expect(seenSignal).toBe(clientAbort.signal) // client disconnect propagates upstream, NOT a 30s timeout
    expect(await res.text()).toContain('event: update')
  })

  test('returns upstream status when magi rejects', async () => {
    const fetchImpl = async (): Promise<Response> => new Response('nope', { status: 404 })
    const res = await proxyTranscriptStream('bad', cfg, new AbortController().signal, fetchImpl)
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `bun test tests/debug/transcript-viewer.test.ts -t proxyTranscriptStream`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement `proxyTranscriptStream`**:

```ts
export async function proxyTranscriptStream(
  token: string,
  cfg: ViewerMagiConfig,
  clientSignal: AbortSignal,
  fetchImpl: FetchImpl = fetch,
): Promise<Response> {
  const target = `${cfg.baseUrl}/t/${encodeURIComponent(token)}/stream`
  const upstream = await fetchImpl(target, {
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'text/event-stream',
    },
    signal: clientSignal, // client disconnect aborts the upstream; NO AbortSignal.timeout here
  })
  if (!upstream.ok || upstream.body === null) {
    return new Response('upstream stream unavailable', {
      status: upstream.ok ? 502 : upstream.status,
    })
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `bun test tests/debug/transcript-viewer.test.ts -t proxyTranscriptStream`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/debug/transcript-viewer.ts tests/debug/transcript-viewer.test.ts
git commit -m "feat(debug): long-lived SSE proxy for live transcript tail"
```

### Task 7: Path dispatcher (`routeTranscriptPaths`) + asset/shell serve

**Files:**

- Modify: `src/debug/transcript-viewer.ts`
- Test: `tests/debug/transcript-viewer.test.ts`

Routes owned by this module (all before the auth gate): `GET /t.js`, `GET /t.css` (bundle assets), `GET /t/<token>` (SPA shell), `GET /t/<token>/stream`, `GET /t/<token>/transcript`. Anything else under `/t/` → `404`; non-`/t` paths → `null` (fall through).

- [ ] **Step 1: Write the failing test** — append:

```ts
import { routeTranscriptPaths } from '../../src/debug/transcript-viewer.js'

describe('routeTranscriptPaths dispatch', () => {
  test('returns null for unrelated paths', async () => {
    const res = await routeTranscriptPaths(
      new Request('https://papai.example/settings'),
      new URL('https://papai.example/settings'),
    )
    expect(res).toBeNull()
  })

  test('unknown /t/ subpath is 404', async () => {
    const res = await routeTranscriptPaths(
      new Request('https://papai.example/t/tok/bogus'),
      new URL('https://papai.example/t/tok/bogus'),
    )
    expect(res?.status).toBe(404)
  })

  test('stream/transcript without magi config is 503', async () => {
    await setupTestDb() // no acp config set → getViewerMagiConfig() null
    const res = await routeTranscriptPaths(
      new Request('https://papai.example/t/tok/stream'),
      new URL('https://papai.example/t/tok/stream'),
    )
    expect(res?.status).toBe(503)
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `bun test tests/debug/transcript-viewer.test.ts -t "routeTranscriptPaths dispatch"`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement asset serve + dispatcher** in `src/debug/transcript-viewer.ts`:

```ts
function serveAsset(file: 'transcript.js' | 'transcript.css', contentType: string): Response {
  return new Response(Bun.file(path.join(PUBLIC_DIR, file)), {
    headers: { 'Content-Type': contentType },
  })
}

function serveShell(): Response {
  return new Response(Bun.file(path.join(PUBLIC_DIR, 'transcript.html')), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

export async function routeTranscriptPaths(req: Request, url: URL): Promise<Response | null> {
  if (url.pathname === '/t.js') return serveAsset('transcript.js', 'text/javascript')
  if (url.pathname === '/t.css') return serveAsset('transcript.css', 'text/css')
  if (!url.pathname.startsWith('/t/')) return null

  const rest = url.pathname.slice('/t/'.length)
  const slash = rest.indexOf('/')
  const token = slash === -1 ? rest : rest.slice(0, slash)
  const sub = slash === -1 ? '' : rest.slice(slash + 1)
  if (token === '') return new Response('Not found', { status: 404 })

  if (sub === '') return serveShell()

  if (sub === 'stream' || sub === 'transcript') {
    const cfg = getViewerMagiConfig()
    if (cfg === null) return new Response('transcript viewer not configured', { status: 503 })
    return sub === 'stream' ? proxyTranscriptStream(token, cfg, req.signal) : proxyTranscriptHistory(url, token, cfg)
  }
  return new Response('Not found', { status: 404 })
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `bun test tests/debug/transcript-viewer.test.ts`
Expected: PASS (whole file).

- [ ] **Step 5: Commit**

```bash
git add src/debug/transcript-viewer.ts tests/debug/transcript-viewer.test.ts
git commit -m "feat(debug): transcript viewer path dispatcher (assets, shell, proxy)"
```

### Task 8: Mount the dispatcher before the auth gate

**Files:**

- Modify: `src/debug/server.ts` (import near `:18`; mount between `:227` and `:229`)

- [ ] **Step 1: Add the import** near the other route imports (top of `src/debug/server.ts`):

```ts
import { routeTranscriptPaths } from './transcript-viewer.js'
```

- [ ] **Step 2: Mount it** immediately after the `/api/notify` line (`src/debug/server.ts:227`), still **before** `if (!isAuthorizedRequest(req))` on `:229`:

```ts
  if (url.pathname === '/api/notify') return handleNotifyRoute(req)

  const transcriptResponse = await routeTranscriptPaths(req, url)
  if (transcriptResponse !== null) return transcriptResponse

  if (!isAuthorizedRequest(req)) {
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: PASS (no type errors; `routeRequest` is already `async`).

- [ ] **Step 4: Commit**

```bash
git add src/debug/server.ts
git commit -m "feat(debug): mount public /t transcript routes before auth gate"
```

---

## Phase 3 — Client build wiring (skeleton that builds)

### Task 9: Register the `transcript` bundle with a minimal SPA

**Files:**

- Create: `client/transcript/index.ts`, `client/transcript/transcript.html`, `client/transcript/transcript.css`, `client/transcript/TranscriptApp.svelte`
- Modify: `scripts/build-client.ts:38-66` (`BUNDLES`), `scripts/check-bundle-isolation.ts:21`

- [ ] **Step 1: Create `client/transcript/transcript.html`** (mirror `client/admin/admin.html`; note CSP `default-src 'self'` — the viewer only talks same-origin so this is sufficient):

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'" />
    <title>papai · coding session</title>
    <link rel="stylesheet" href="/t.css" />
  </head>
  <body>
    <div id="app"></div>
    <script src="/t.js" defer></script>
  </body>
</html>
```

- [ ] **Step 2: Create `client/transcript/index.ts`** (Svelte 5 `mount`, parse token from `/t/<token>`):

```ts
/// <reference lib="dom" />
import { mount } from 'svelte'

import TranscriptApp from './TranscriptApp.svelte'

export function tokenFromPath(pathname: string): string {
  const rest = pathname.replace(/^\/t\//u, '')
  const seg = rest.split('/')[0] ?? ''
  try {
    return decodeURIComponent(seg)
  } catch {
    return seg
  }
}

if (typeof document !== 'undefined' && document.getElementById('app') !== null) {
  mount(TranscriptApp, {
    target: document.getElementById('app')!,
    props: { token: tokenFromPath(location.pathname) },
  })
}
```

- [ ] **Step 3: Create `client/transcript/transcript.css`** (minimal layout; component styles come later via Svelte `<style>`):

```css
.tx-wrap {
  max-width: 860px;
  margin: 0 auto;
  padding: 1.5rem 1rem 4rem;
}
.tx-timeline {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
```

- [ ] **Step 4: Create a minimal `client/transcript/TranscriptApp.svelte`** (placeholder body — real rendering in Phase 5):

```svelte
<script lang="ts">
  let { token }: { token: string } = $props()
</script>

<main class="tx-wrap">
  <h1>Coding session</h1>
  <p>token: {token}</p>
</main>
```

- [ ] **Step 5: Add the bundle entry** to `scripts/build-client.ts` `BUNDLES` (append a 4th entry mirroring the others):

```ts
  {
    entry: 'client/transcript/index.ts',
    htmlSrc: 'client/transcript/transcript.html',
    jsName: 'transcript.js',
    htmlName: 'transcript.html',
    cssName: 'transcript.css',
    baseCssPath: 'client/shared/base.css',
    localCssPath: 'client/transcript/transcript.css',
  },
```

- [ ] **Step 6: Add the bundle to isolation check** — `scripts/check-bundle-isolation.ts:21`:

```ts
const BUNDLES = ['public/debug.js', 'public/admin.js', 'public/settings.js', 'public/transcript.js'] as const
```

- [ ] **Step 7: Build and verify output files exist**

Run: `bun run build:client && ls public/transcript.js public/transcript.css public/transcript.html`
Expected: build succeeds; all three files listed.

- [ ] **Step 8: Commit**

```bash
git add client/transcript scripts/build-client.ts scripts/check-bundle-isolation.ts
git commit -m "feat(client): register transcript viewer SPA bundle"
```

---

## Phase 4 — Client logic (pure, TDD)

### Task 10: Event + history Zod schemas

**Files:**

- Create: `client/transcript/fetcher-schemas.ts`
- Test: `tests/client/transcript/fetcher-schemas.test.ts`

- [ ] **Step 1: Write the failing test**:

```ts
import { describe, expect, test } from 'bun:test'
import { HistoryResponseSchema, TranscriptEventSchema } from '../../../client/transcript/fetcher-schemas.js'

describe('transcript schemas', () => {
  test('parses a raw event envelope', () => {
    const e = TranscriptEventSchema.parse({
      seq: 3,
      ts: '2026-07-05T00:00:00Z',
      type: 'update',
      payload: { a: 1 },
    })
    expect(e.seq).toBe(3)
    expect(e.type).toBe('update')
  })

  test('rejects unknown type', () => {
    expect(() =>
      TranscriptEventSchema.parse({
        seq: 1,
        ts: 'x',
        type: 'bogus',
        payload: {},
      }),
    ).toThrow()
  })

  test('parses history page with recording marker', () => {
    const page = HistoryResponseSchema.parse({
      events: [],
      nextCursor: null,
      recording: 'disabled',
    })
    expect(page.recording).toBe('disabled')
    expect(page.nextCursor).toBeNull()
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `bun test tests/client/transcript/fetcher-schemas.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Create `client/transcript/fetcher-schemas.ts`**:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

export const TRANSCRIPT_EVENT_TYPES = [
  'prompt',
  'update',
  'permission_request',
  'permission_decision',
  'result',
] as const

export const TranscriptEventSchema = z.object({
  seq: z.number(),
  ts: z.string(),
  type: z.enum(TRANSCRIPT_EVENT_TYPES),
  payload: z.unknown(),
})
export type TranscriptEvent = z.infer<typeof TranscriptEventSchema>

export const HistoryResponseSchema = z.object({
  events: z.array(TranscriptEventSchema),
  nextCursor: z.number().nullable(),
  recording: z.literal('disabled').optional(),
})
export type HistoryResponse = z.infer<typeof HistoryResponseSchema>
```

- [ ] **Step 4: Run it, verify it passes**

Run: `bun test tests/client/transcript/fetcher-schemas.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/transcript/fetcher-schemas.ts tests/client/transcript/fetcher-schemas.test.ts
git commit -m "feat(client): transcript event + history Zod schemas"
```

### Task 11: Pure stitch/dedupe

**Files:**

- Create: `client/transcript/stitch.ts`
- Test: `tests/client/transcript/stitch.test.ts`

This is the correctness core: concatenate history + live, drop any live event with `seq` ≤ max history `seq`, keep total order by `seq`, and never duplicate.

- [ ] **Step 1: Write the failing test**:

```ts
import { describe, expect, test } from 'bun:test'
import { mergeBySeq } from '../../../client/transcript/stitch.js'
import type { TranscriptEvent } from '../../../client/transcript/fetcher-schemas.js'

const ev = (seq: number): TranscriptEvent => ({
  seq,
  ts: `t${seq}`,
  type: 'update',
  payload: {},
})

describe('mergeBySeq', () => {
  test('drops live events already covered by history', () => {
    const merged = mergeBySeq([ev(1), ev(2), ev(3)], [ev(3), ev(4), ev(5)])
    expect(merged.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5])
  })

  test('is idempotent on repeated seqs from either side', () => {
    const merged = mergeBySeq([ev(1), ev(2)], [ev(2), ev(2), ev(3)])
    expect(merged.map((e) => e.seq)).toEqual([1, 2, 3])
  })

  test('sorts out-of-order input by seq', () => {
    const merged = mergeBySeq([ev(2), ev(1)], [ev(4), ev(3)])
    expect(merged.map((e) => e.seq)).toEqual([1, 2, 3, 4])
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `bun test tests/client/transcript/stitch.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Create `client/transcript/stitch.ts`**:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { TranscriptEvent } from './fetcher-schemas.js'

/** Merge history + live into one seq-ordered list with no duplicates. */
export function mergeBySeq(history: TranscriptEvent[], live: TranscriptEvent[]): TranscriptEvent[] {
  const bySeq = new Map<number, TranscriptEvent>()
  for (const e of history) bySeq.set(e.seq, e)
  for (const e of live) if (!bySeq.has(e.seq)) bySeq.set(e.seq, e)
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq)
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `bun test tests/client/transcript/stitch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/transcript/stitch.ts tests/client/transcript/stitch.test.ts
git commit -m "feat(client): pure seq-ordered transcript stitch"
```

### Task 12: History fetcher + SSE wrapper

**Files:**

- Create: `client/transcript/fetchers.ts`, `client/transcript/sse.ts`

No dedicated unit test (thin I/O adapters exercised in Phase 5 + manual verification); keep them tiny and pure-ish.

- [ ] **Step 1: Create `client/transcript/fetchers.ts`** (page history until `nextCursor` is null):

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { HistoryResponseSchema, type HistoryResponse, type TranscriptEvent } from './fetcher-schemas.js'

export async function fetchHistoryPage(token: string, after: number): Promise<HistoryResponse> {
  const res = await fetch(`/t/${encodeURIComponent(token)}/transcript?after=${after}&limit=200`)
  if (res.status === 404) throw new Error('not_found')
  return HistoryResponseSchema.parse(await res.json())
}

/** Page from `after` until caught up. Returns all events + the recording marker of the first page. */
export async function fetchAllHistory(
  token: string,
  after = -1,
): Promise<{ events: TranscriptEvent[]; recordingDisabled: boolean }> {
  const events: TranscriptEvent[] = []
  let cursor = after
  let recordingDisabled = false
  for (;;) {
    const page = await fetchHistoryPage(token, cursor)
    if (page.recording === 'disabled') recordingDisabled = true
    events.push(...page.events)
    if (page.nextCursor === null) return { events, recordingDisabled }
    cursor = page.nextCursor
  }
}
```

- [ ] **Step 2: Create `client/transcript/sse.ts`** (EventSource wrapper; the five event types + terminal `end`):

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { TranscriptEventSchema, TRANSCRIPT_EVENT_TYPES, type TranscriptEvent } from './fetcher-schemas.js'

export interface StreamHandlers {
  onEvent(e: TranscriptEvent): void
  onEnd(): void
  onError(): void
}

export function openTranscriptStream(token: string, handlers: StreamHandlers): { close(): void } {
  const source = new EventSource(`/t/${encodeURIComponent(token)}/stream`)
  const handle = (raw: string): void => {
    try {
      const parsed = TranscriptEventSchema.safeParse(JSON.parse(raw))
      if (parsed.success) handlers.onEvent(parsed.data)
    } catch {
      /* skip malformed frame */
    }
  }
  for (const type of TRANSCRIPT_EVENT_TYPES) {
    source.addEventListener(type, (e) => handle((e as MessageEvent).data))
  }
  source.addEventListener('end', () => {
    handlers.onEnd()
    source.close()
  })
  source.addEventListener('error', () => handlers.onError())
  return { close: () => source.close() }
}
```

- [ ] **Step 3: Typecheck the client sources**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add client/transcript/fetchers.ts client/transcript/sse.ts
git commit -m "feat(client): transcript history fetcher + SSE wrapper"
```

---

## Phase 5 — Client rendering

### Task 13: Runes state store + load orchestration

**Files:**

- Create: `client/transcript/transcript.svelte.ts`

- [ ] **Step 1: Create `client/transcript/transcript.svelte.ts`** — runes-based state driving the documented stitch order (open stream → buffer; page history; merge; then apply live), with status + reconnect:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { fetchAllHistory } from './fetchers.js'
import type { TranscriptEvent } from './fetcher-schemas.js'
import { openTranscriptStream } from './sse.js'
import { mergeBySeq } from './stitch.js'

export type ViewerStatus = 'connecting' | 'live' | 'finished' | 'recording-disabled' | 'invalid-token' | 'error'

export function createTranscriptState(token: string) {
  let events = $state<TranscriptEvent[]>([])
  let status = $state<ViewerStatus>('connecting')

  const buffer: TranscriptEvent[] = []
  let historyLoaded = false
  let maxSeq = -1

  const apply = (list: TranscriptEvent[]): void => {
    events = mergeBySeq(events, list)
    for (const e of events) maxSeq = Math.max(maxSeq, e.seq)
  }

  const start = (): { close(): void } =>
    openTranscriptStream(token, {
      onEvent: (e) => {
        if (!historyLoaded) buffer.push(e)
        else apply([e])
        if (status === 'connecting') status = 'live'
      },
      onEnd: () => {
        if (status !== 'recording-disabled') status = 'finished'
      },
      onError: () => {
        if (status !== 'finished') status = 'error'
      },
    })

  const load = async (): Promise<void> => {
    const conn = start()
    try {
      const { events: hist, recordingDisabled } = await fetchAllHistory(token, -1)
      apply(hist)
      historyLoaded = true
      apply(buffer.splice(0))
      if (recordingDisabled && events.length === 0) status = 'recording-disabled'
    } catch (err) {
      conn.close()
      status = err instanceof Error && err.message === 'not_found' ? 'invalid-token' : 'error'
    }
  }

  return {
    get events() {
      return events
    },
    get status() {
      return status
    },
    load,
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add client/transcript/transcript.svelte.ts
git commit -m "feat(client): transcript viewer state + stitch orchestration"
```

### Task 14: Event + status components and wire the app

**Files:**

- Create: `client/transcript/components/TimelineEvent.svelte`, `client/transcript/components/StatusBanner.svelte`
- Modify: `client/transcript/TranscriptApp.svelte`

- [ ] **Step 1: Create `client/transcript/components/StatusBanner.svelte`**:

```svelte
<script lang="ts">
  import type { ViewerStatus } from '../transcript.svelte.js'

  let { status }: { status: ViewerStatus } = $props()

  const TEXT: Record<ViewerStatus, string> = {
    connecting: 'Connecting…',
    live: '● Live',
    finished: 'Session finished',
    'recording-disabled': 'Transcript not retained — live only',
    'invalid-token': 'This link is invalid or has expired',
    error: 'Temporarily unavailable — retrying',
  }
</script>

<div class="tx-banner tx-banner--{status}">{TEXT[status]}</div>

<style>
  .tx-banner {
    font-family: var(--font-mono);
    font-size: 0.85rem;
    padding: 0.4rem 0.7rem;
    border-radius: 6px;
    background: var(--surface-1);
    color: var(--fg);
    display: inline-block;
  }
  .tx-banner--live {
    color: var(--accent);
  }
  .tx-banner--invalid-token,
  .tx-banner--error {
    color: var(--danger);
  }
</style>
```

- [ ] **Step 2: Create `client/transcript/components/TimelineEvent.svelte`** — discriminate the raw ACP event; read-only for permissions:

```svelte
<script lang="ts">
  import type { TranscriptEvent } from '../fetcher-schemas.js'

  let { event }: { event: TranscriptEvent } = $props()

  // Narrow the untyped payload just enough to render; unknown shapes fall back to JSON.
  const payload = (event.payload ?? {}) as Record<string, unknown>
  const updateKind = typeof payload['sessionUpdate'] === 'string' ? (payload['sessionUpdate'] as string) : ''

  function text(v: unknown): string {
    return typeof v === 'string' ? v : JSON.stringify(v, null, 2)
  }
</script>

<div class="tx-ev tx-ev--{event.type}">
  {#if event.type === 'update' && updateKind === 'agent_message_chunk'}
    <div class="tx-msg">{text(payload['content'] ?? payload['text'])}</div>
  {:else if event.type === 'update' && updateKind === 'agent_thought_chunk'}
    <details class="tx-thought"><summary>thinking</summary><pre>{text(payload['content'] ?? payload['text'])}</pre></details>
  {:else if event.type === 'update' && (updateKind === 'tool_call' || updateKind === 'tool_call_update')}
    <div class="tx-tool"><span class="tx-tool__name">{text(payload['title'] ?? payload['toolCallId'] ?? 'tool')}</span>
      <span class="tx-tool__status">{text(payload['status'] ?? '')}</span></div>
  {:else if event.type === 'update' && updateKind === 'plan'}
    <pre class="tx-plan">{text(payload['entries'] ?? payload)}</pre>
  {:else if event.type === 'permission_request'}
    <div class="tx-perm">🔒 asked for permission — approve or deny in chat</div>
  {:else if event.type === 'permission_decision'}
    <div class="tx-perm tx-perm--decided">decision recorded in chat</div>
  {:else if event.type === 'result'}
    <div class="tx-result">✔ finished — {text(payload['stopReason'] ?? '')}</div>
  {:else}
    <pre class="tx-raw">{text(payload)}</pre>
  {/if}
</div>

<style>
  .tx-ev {
    font-family: var(--font-mono);
    font-size: 0.85rem;
    border-left: 2px solid var(--border);
    padding: 0.3rem 0.7rem;
  }
  .tx-msg {
    white-space: pre-wrap;
  }
  .tx-tool {
    display: flex;
    gap: 0.5rem;
    color: var(--accent);
  }
  .tx-perm {
    color: var(--danger);
  }
  .tx-thought pre,
  .tx-plan,
  .tx-raw {
    white-space: pre-wrap;
    color: var(--muted, #888);
  }
</style>
```

- [ ] **Step 3: Wire `client/transcript/TranscriptApp.svelte`**:

```svelte
<script lang="ts">
  import { onMount } from 'svelte'

  import StatusBanner from './components/StatusBanner.svelte'
  import TimelineEvent from './components/TimelineEvent.svelte'
  import { createTranscriptState } from './transcript.svelte.js'

  let { token }: { token: string } = $props()
  const state = createTranscriptState(token)

  onMount(() => {
    void state.load()
  })
</script>

<main class="tx-wrap">
  <header><h1>Coding session</h1><StatusBanner status={state.status} /></header>
  <div class="tx-timeline">
    {#each state.events as event (event.seq)}
      <TimelineEvent {event} />
    {/each}
  </div>
</main>
```

- [ ] **Step 4: Build to verify the SPA compiles**

Run: `bun run build:client`
Expected: build succeeds, `public/transcript.js` non-empty.

- [ ] **Step 5: Commit**

```bash
git add client/transcript
git commit -m "feat(client): render transcript timeline + status states"
```

### Task 15: Storybook stories + shoot specs

**Files:**

- Create: `client/transcript/TranscriptApp.stories.svelte`, `client/transcript/components/TimelineEvent.stories.svelte`

- [ ] **Step 1: Create `client/transcript/components/TimelineEvent.stories.svelte`** (cover each branch — this is the visual contract):

```svelte
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import TimelineEvent from './TimelineEvent.svelte'

  const { Story } = defineMeta({ title: 'transcript/TimelineEvent', component: TimelineEvent })
</script>

<Story name="Message" args={{ event: { seq: 1, ts: 't', type: 'update', payload: { sessionUpdate: 'agent_message_chunk', content: 'Reading the file…' } } }} />
<Story name="Tool call" args={{ event: { seq: 2, ts: 't', type: 'update', payload: { sessionUpdate: 'tool_call', title: 'edit history.ts', status: 'completed' } } }} />
<Story name="Permission (read-only)" args={{ event: { seq: 3, ts: 't', type: 'permission_request', payload: {} } }} />
<Story name="Result" args={{ event: { seq: 4, ts: 't', type: 'result', payload: { stopReason: 'end_turn' } } }} />
```

- [ ] **Step 2: Create `client/transcript/TranscriptApp.stories.svelte`** for the app shell / status states (drive `StatusBanner` variants). Reuse the same `defineMeta` pattern with `title: 'transcript/TranscriptApp'`; add stories that mount `StatusBanner` directly for `connecting`, `live`, `finished`, `recording-disabled`, `invalid-token`.

- [ ] **Step 3: Verify stories load and generate shots** (per `docs/architecture/storybook-screenshots.md`):

Run: `bun shoot:gen && bun shoot -g transcript`
Expected: specs generated under `tests/visual/**`; PNGs written to `.storybook-shots/` for the transcript stories. Review the PNGs (Read the files) to confirm each event type and status renders legibly.

- [ ] **Step 4: Commit**

```bash
git add client/transcript tests/visual
git commit -m "test(client): storybook stories + visual specs for transcript viewer"
```

---

## Phase 6 — Docs & end-to-end verification

### Task 16: Documentation

**Files:**

- Modify: `docs/architecture/coding-sessions.md`, `docs/architecture/environment.md`

- [ ] **Step 1: Add a "Transcript viewer" subsection** to `docs/architecture/coding-sessions.md` describing: the public `/t/*` routes (mounted before the auth gate), that magi returns `shareToken`/`transcriptUrl` which the plugin stores on `SessionRecord` and surfaces via `list_sessions`, the read-only capability-URL model, and that the proxy reads `magi_base_url`/`magi_token` from acp admin config via `getPluginAdminConfig`.

- [ ] **Step 2: Note in `docs/architecture/environment.md`** that `MAGI_TRANSCRIPT_BASE_URL` is a **magi-side** variable (papai's public origin) and that papai adds **no** new env var for the viewer.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/coding-sessions.md docs/architecture/environment.md
git commit -m "docs(acp): document the transcript viewer + shareable links"
```

### Task 17: End-to-end verification against a mock magi

**Files:** none (verification only)

- [ ] **Step 1: Run the full check suite**

Run: `bun test tests/plugins/acp tests/debug/transcript-viewer.test.ts tests/client/transcript && bun run typecheck && bun run build:client`
Expected: all green; `public/transcript.*` present.

- [ ] **Step 2: Drive the proxy against a local stub magi.** Start a tiny stub that serves `GET /t/:token/transcript` (returns a couple of events + `nextCursor: null`) and `GET /t/:token/stream` (SSE emitting an `update` then `end`). Set acp admin config to point at it:

```bash
# in a bun repl / scratch script, using the test DB helpers or a running instance:
#   setPluginAdminConfig('acp', 'magi_base_url', 'http://localhost:9099', 'manual')
#   setPluginAdminConfig('acp', 'magi_token', 'stub', 'manual')
# then start the debug server and:
curl -N http://localhost:<port>/t/tok_demo/stream        # expect SSE frames then a close
curl http://localhost:<port>/t/tok_demo/transcript        # expect {"events":[...],"nextCursor":null}
open http://localhost:<port>/t/tok_demo                    # expect the timeline to render + "finished"
```

Expected: the browser viewer loads history, shows the live `update`, then flips to "Session finished". A bogus token (`/t/nope`) shows "link invalid or has expired".

- [ ] **Step 3: Use the `verify` skill** to confirm the change end-to-end (drives the real `/t/*` flow, not just tests), then report results.

---

## Self-review notes (author)

- **Spec coverage:** capability URL (Tasks 4-8, no auth on `/t/*`); magi returns `shareToken`+`transcriptUrl` (Tasks 1-2, contract); read-only viewer (Task 14 permission branches render status only); direct links only (no index built); papai proxies / magi private (Tasks 5-6); long-lived SSE avoids the 30s cap (Task 6 test asserts client-signal binding); back-compat with older magi (Task 2 `shareFieldsOf` returns `{}`); recording-disabled + invalid-token states (Tasks 13-14). All spec sections map to a task.
- **No new papai config:** proxy reads acp admin config (Task 4) — matches the refined spec.
- **Type consistency:** `ViewerMagiConfig`, `TranscriptEvent`, `HistoryResponse`, `ViewerStatus`, `mergeBySeq`, `shareFieldsOf`, `routeTranscriptPaths` are defined once and reused verbatim across tasks.
- **Deviation from spec text:** the proxy is a single file `src/debug/transcript-viewer.ts` (spec wrote `src/debug/transcript-viewer/` folder) — simpler for this size; harmless.
