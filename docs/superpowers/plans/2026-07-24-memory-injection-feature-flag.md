<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Memory Record-Injection Feature Flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate the per-turn injection of long-term-memory records behind a per-memory-scope boolean (`inject_records`) that defaults **off**, exposed as an opt-in toggle in the settings `MemorySection`.

> **Execution status (2026-07-26): Historical — implemented.** The original unchecked step
> boxes are authoring history; the reconciliation table and drift log at the end are
> authoritative. Do not start new work from this plan; use
> `2026-07-26-memory-production-roadmap.md`.

**Architecture:** A new boolean column on `memory_profiles` (beside the existing capture `enabled` flag), read from the profile that `buildMessagesWithMemory` already loads — so no new reads, no signature change, no call-site churn. When off, the long-term-memory system message still carries the profile; only records are suppressed. End-to-end plumbing mirrors the existing capture-enabled toggle.

**Tech Stack:** Bun 1.3, strict TypeScript, Drizzle ORM over `bun:sqlite`, Zod v4, `bun:test`, Svelte 5 (runes) settings SPA.

**Spec:** `docs/superpowers/specs/2026-07-24-memory-injection-feature-flag-design.md`

## Global Constraints

- Runtime **Bun**; strict TypeScript; **use `.js` extension in import paths**.
- Add the SPDX/BUSL header to every new TypeScript file (copy from `src/db/migrations/069_memory_tombstones.ts`).
- **Never** add lint-disable or type-ignore comments — fix the underlying issue.
- Error extraction: `error instanceof Error ? error.message : String(error)`.
- Write each behavior test first, run it, confirm it fails, then implement.
- New config default is **opt-in**: `inject_records` defaults to `false` (contrast: capture `enabled` defaults `true`).
- Do not touch capture, extraction, promotion, retrieval, or the `search_memory` tool.
- Run `bun run typecheck` and the relevant `bun test <file>` before each commit; the Write/Edit hook also runs lint/typecheck/format/license gates on staged files.

---

### Task 1: Storage foundation — `inject_records` column, type, serialization

**Files:**
- Create: `src/db/migrations/070_memory_record_injection.ts`
- Modify: `src/db/index.ts` (import + register in `MIGRATIONS`)
- Modify: `src/db/long-term-memory-schema.ts:9-23` (add column to `memoryProfiles`)
- Modify: `src/long-term-memory/types.ts:34-40` (add `injectRecords` to `MemoryProfile`)
- Modify: `src/long-term-memory/serialization.ts` (`rowToProfile`)
- Test: `tests/long-term-memory/store.test.ts` (update existing profile-shape expectation + add default assertion)

**Interfaces:**
- Produces: `MemoryProfile` gains `injectRecords: boolean`. `memoryProfiles` table gains `injectRecords` (SQL `inject_records`, integer boolean, default `false`). `migration070MemoryRecordInjection: Migration`.

- [ ] **Step 1: Write the failing test** — add to `tests/long-term-memory/store.test.ts`, in the profile suite:

```typescript
test('a freshly saved profile defaults injectRecords to false', () => {
  const scope = { scopeId: 'ctx-inject-default', scopeType: 'personal' as const }
  saveMemoryProfile(scope, 'hello', '2026-07-24T00:00:00.000Z')
  const profile = getMemoryProfile(scope)
  expect(profile?.injectRecords).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/long-term-memory/store.test.ts -t "injectRecords to false"`
Expected: FAIL — `injectRecords` is `undefined` (property does not exist yet).

- [ ] **Step 3: Create the migration**

Create `src/db/migrations/070_memory_record_injection.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:070' })

const up = (db: Database): void => {
  db.run(`
    ALTER TABLE memory_profiles
      ADD COLUMN inject_records INTEGER NOT NULL DEFAULT 0
  `)
  log.info('migration 070: memory_profiles.inject_records column added')
}

export const migration070MemoryRecordInjection: Migration = {
  id: '070_memory_record_injection',
  up,
}

export default migration070MemoryRecordInjection
```

- [ ] **Step 4: Register the migration** in `src/db/index.ts`

Add the import beside the 069 import (line ~82):

```typescript
import { migration070MemoryRecordInjection } from './migrations/070_memory_record_injection.js'
```

Add to the `MIGRATIONS` array immediately after `migration069MemoryTombstones` (line ~186):

```typescript
  migration069MemoryTombstones,
  migration070MemoryRecordInjection,
```

- [ ] **Step 5: Add the Drizzle column** in `src/db/long-term-memory-schema.ts`, inside the `memoryProfiles` table definition (after the `enabled` line):

```typescript
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    injectRecords: integer('inject_records', { mode: 'boolean' }).notNull().default(false),
```

- [ ] **Step 6: Extend the `MemoryProfile` type** in `src/long-term-memory/types.ts`:

```typescript
export type MemoryProfile = MemoryScope &
  Readonly<{
    profile: string
    enabled: boolean
    injectRecords: boolean
    version: number
    updatedAt: string
  }>
```

- [ ] **Step 7: Map the column in `rowToProfile`** (`src/long-term-memory/serialization.ts`):

```typescript
export const rowToProfile = (row: MemoryProfileRow): MemoryProfile => ({
  scopeId: row.scopeId,
  scopeType: row.scopeType,
  profile: row.profile,
  enabled: row.enabled,
  injectRecords: row.injectRecords,
  version: row.version,
  updatedAt: row.updatedAt,
})
```

- [ ] **Step 8: Fix the existing profile-shape assertion** in `tests/long-term-memory/store.test.ts:67`

The existing deep-equality assertion on a profile object must include the new field. Locate the object literal that asserts `enabled: true` and add `injectRecords: false,` beside it (default for a profile saved without opting in). If any other test (e.g. `tests/long-term-memory/serialization.test.ts`, `tests/long-term-memory/types.test.ts`) deep-equals a `MemoryProfile`, add `injectRecords: false` there too. Find them with:

Run: `grep -rn "enabled: true" tests/long-term-memory/`

- [ ] **Step 9: Run tests to verify they pass**

Run: `bun test tests/long-term-memory/store.test.ts tests/long-term-memory/serialization.test.ts`
Expected: PASS (new default test green; updated shape assertions green).

- [ ] **Step 10: Typecheck and commit**

```bash
bun run typecheck
git add src/db/migrations/070_memory_record_injection.ts src/db/index.ts src/db/long-term-memory-schema.ts src/long-term-memory/types.ts src/long-term-memory/serialization.ts tests/long-term-memory/store.test.ts tests/long-term-memory/serialization.test.ts
git commit -m "feat(memory): add memory_profiles.inject_records column (default off)"
```

---

### Task 2: Store setter `setMemoryRecordInjectionEnabled`

**Files:**
- Modify: `src/long-term-memory/store.ts` (new setter beside `setMemoryCaptureEnabled`)
- Test: `tests/long-term-memory/store.test.ts`

**Interfaces:**
- Consumes: `MemoryProfile.injectRecords` (Task 1).
- Produces: `setMemoryRecordInjectionEnabled(scope: MemoryScope, enabled: boolean, now: string): MemoryProfile` — upserts on `[scopeType, scopeId]`, sets only `inject_records` (+ bumps `version`, `updatedAt`), never touches `enabled` (capture); a fresh insert lets `enabled` fall to its column default (`true`).

- [ ] **Step 1: Write the failing test** — add to `tests/long-term-memory/store.test.ts`:

```typescript
test('setMemoryRecordInjectionEnabled toggles inject flag without disturbing capture', () => {
  const scope = { scopeId: 'ctx-inject-set', scopeType: 'personal' as const }
  const enabled = setMemoryRecordInjectionEnabled(scope, true, '2026-07-24T00:00:00.000Z')
  expect(enabled.injectRecords).toBe(true)
  expect(enabled.enabled).toBe(true) // capture default preserved on fresh insert

  const disabled = setMemoryRecordInjectionEnabled(scope, false, '2026-07-24T00:01:00.000Z')
  expect(disabled.injectRecords).toBe(false)
  expect(disabled.version).toBe(enabled.version + 1)
})
```

Add `setMemoryRecordInjectionEnabled` to the existing import from `../src/long-term-memory/store.js` at the top of the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/long-term-memory/store.test.ts -t "setMemoryRecordInjectionEnabled"`
Expected: FAIL — `setMemoryRecordInjectionEnabled is not a function`.

- [ ] **Step 3: Implement the setter** in `src/long-term-memory/store.ts`, directly below `setMemoryCaptureEnabled`:

```typescript
export function setMemoryRecordInjectionEnabled(scope: MemoryScope, enabled: boolean, now: string): MemoryProfile {
  getDrizzleDb()
    .insert(memoryProfiles)
    .values({ scopeId: scope.scopeId, scopeType: scope.scopeType, profile: '', injectRecords: enabled, version: 1, updatedAt: now })
    .onConflictDoUpdate({
      target: [memoryProfiles.scopeType, memoryProfiles.scopeId],
      set: {
        injectRecords: enabled,
        version: sql`${memoryProfiles.version} + 1`,
        updatedAt: now,
      },
    })
    .run()
  return loadProfile(scope)
}
```

(Note: `enabled` is omitted from `.values(...)`, so a fresh insert uses the column default `true`; on conflict only `inject_records`/`version`/`updatedAt` change, leaving capture untouched.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/long-term-memory/store.test.ts -t "setMemoryRecordInjectionEnabled"`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
bun run typecheck
git add src/long-term-memory/store.ts tests/long-term-memory/store.test.ts
git commit -m "feat(memory): add setMemoryRecordInjectionEnabled store setter"
```

---

### Task 3: Gate record injection in `buildMessagesWithMemory`

**Files:**
- Modify: `src/conversation.ts:66-72`
- Test: `tests/conversation.test.ts` (in the `buildMessagesWithMemory` suite)

**Interfaces:**
- Consumes: `getMemoryProfile(scope)` now returns `injectRecords` (Task 1); `setMemoryRecordInjectionEnabled` (Task 2).
- Produces: `buildMessagesWithMemory` injects records only when the scope's profile has `injectRecords === true`; otherwise no records and `listMemoryRecords` is not called. Signature unchanged.

- [ ] **Step 1: Write the failing tests** — add to `tests/conversation.test.ts` inside `describe('buildMessagesWithMemory', ...)`:

```typescript
test('does not inject records when injectRecords flag is off (default)', () => {
  const scope = { scopeId: 'user-inject-off', scopeType: 'personal' as const }
  saveMemoryProfile(scope, 'Prefers dark mode', '2026-07-24T00:00:00.000Z')
  const record: MemoryRecordInput = {
    ...scope,
    kind: 'preference',
    content: 'Likes espresso',
    summary: null,
    tags: [],
    confidence: 0.9,
    status: 'active',
    source: 'tool',
    evidence: {},
  }
  saveMemoryRecord(record, '2026-07-24T00:00:00.000Z')

  const listSpy = spyOn(longTermMemoryStore, 'listMemoryRecords')
  const result = buildMessagesWithMemory('user-inject-off', [])
  expect(result.memoryMsg?.content ?? '').not.toContain('Likes espresso')
  expect(result.memoryMsg?.content ?? '').toContain('Prefers dark mode') // profile still injected
  expect(listSpy).not.toHaveBeenCalled()
  listSpy.mockRestore()
})

test('injects records when injectRecords flag is on', () => {
  const scope = { scopeId: 'user-inject-on', scopeType: 'personal' as const }
  saveMemoryProfile(scope, 'Prefers dark mode', '2026-07-24T00:00:00.000Z')
  const record: MemoryRecordInput = {
    ...scope,
    kind: 'preference',
    content: 'Likes espresso',
    summary: null,
    tags: [],
    confidence: 0.9,
    status: 'active',
    source: 'tool',
    evidence: {},
  }
  saveMemoryRecord(record, '2026-07-24T00:00:00.000Z')
  setMemoryRecordInjectionEnabled(scope, true, '2026-07-24T00:00:01.000Z')

  const result = buildMessagesWithMemory('user-inject-on', [])
  expect(result.memoryMsg?.content ?? '').toContain('Likes espresso')
})
```

Add `setMemoryRecordInjectionEnabled` to the existing `import { saveMemoryProfile, saveMemoryRecord } from '../src/long-term-memory/store.js'` line.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/conversation.test.ts -t "injectRecords"`
Expected: FAIL — the "off" test fails because records are currently always injected.

- [ ] **Step 3: Implement the gate** in `src/conversation.ts`. Replace lines 70-71:

```typescript
  const profile = getMemoryProfile(scope)?.profile ?? null
  const records = listMemoryRecords({ ...scope, status: 'active', limit: 3 })
```

with:

```typescript
  const memoryProfile = getMemoryProfile(scope)
  const profile = memoryProfile?.profile ?? null
  const records =
    memoryProfile?.injectRecords === true
      ? listMemoryRecords({ ...scope, status: 'active', limit: 3 })
      : []
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/conversation.test.ts -t "injectRecords"`
Expected: PASS (both). Also run the whole file to catch regressions: `bun test tests/conversation.test.ts`.

- [ ] **Step 5: Typecheck and commit**

```bash
bun run typecheck
git add src/conversation.ts tests/conversation.test.ts
git commit -m "feat(memory): gate long-term record injection behind inject_records flag"
```

---

### Task 4: Settings API — expose and toggle the flag

**Files:**
- Modify: `src/debug/settings/memory-routes.ts` (GET payload + new PATCH route + dispatch)
- Test: `tests/debug/settings/memory-routes.test.ts`

**Interfaces:**
- Consumes: `setMemoryRecordInjectionEnabled` (Task 2); `getMemoryProfile().injectRecords` (Task 1).
- Produces: `GET /settings/api/memory` returns `injectRecords: boolean`. `PATCH /settings/api/memory/record-injection` with body `{ contextId?: string, enabled: boolean }` toggles it and returns `{ ok, contextId, scopeType, injectRecords }`.

- [ ] **Step 1: Write the failing test** — add to `tests/debug/settings/memory-routes.test.ts` (mirror the existing capture PATCH test; reuse its auth/CSRF/context helpers):

```typescript
test('PATCH /memory/record-injection toggles inject flag and GET reflects it', async () => {
  // <use the same authenticated-request + CSRF helpers the capture test uses>
  const patch = await handleMemoryRoutes(
    makeAuthedRequest('PATCH', '/settings/api/memory/record-injection', { enabled: true }),
    new URL('http://x/settings/api/memory/record-injection'),
  )
  expect(patch.status).toBe(200)
  expect(await patch.json()).toMatchObject({ ok: true, injectRecords: true })

  const get = await handleMemoryRoutes(
    makeAuthedRequest('GET', '/settings/api/memory'),
    new URL('http://x/settings/api/memory'),
  )
  expect(await get.json()).toMatchObject({ injectRecords: true })
})
```

(Match the concrete request/helper style already used by the capture test in this file — do not invent new helpers.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/debug/settings/memory-routes.test.ts -t "record-injection"`
Expected: FAIL — route returns 404/unhandled and GET has no `injectRecords`.

- [ ] **Step 3: Add `injectRecords` to the GET payload.** In `handleGet` (`src/debug/settings/memory-routes.ts`), extend the `settingsJson(200, {...})` object:

```typescript
  return settingsJson(200, {
    contextId: memoryScope.scopeId,
    scopeType: memoryScope.scopeType,
    enabled: profile?.enabled ?? true,
    injectRecords: profile?.injectRecords ?? false,
    profile: profile?.profile ?? '',
    records,
  })
```

- [ ] **Step 4: Add the schema + handler.** Near `CapturePatchBodySchema`:

```typescript
const RecordInjectionPatchBodySchema = z.object({
  contextId: z.string().optional(),
  enabled: z.boolean(),
})
```

Add `setMemoryRecordInjectionEnabled` to the existing import from `../../long-term-memory/store.js`. Then add a handler beside `handleCapturePatch`:

```typescript
async function handleRecordInjectionPatch(req: Request): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  const csrf = requireCsrf(req, auth.authed)
  if (csrf !== null) return csrf

  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = RecordInjectionPatchBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  const scope = resolveContextScope(auth.authed.principal, 'write', body.data.contextId)
  if (!scope.ok) return scope.response

  const memoryScope = toMemoryScope(scope.scope)
  const profile = setMemoryRecordInjectionEnabled(memoryScope, body.data.enabled, new Date().toISOString())
  log.info(
    {
      scopeId: memoryScope.scopeId,
      scopeType: memoryScope.scopeType,
      action: 'record-injection.update',
      injectRecords: profile.injectRecords,
    },
    'Settings memory record injection updated',
  )
  return settingsJson(200, {
    ok: true,
    contextId: memoryScope.scopeId,
    scopeType: memoryScope.scopeType,
    injectRecords: profile.injectRecords,
  })
}
```

- [ ] **Step 5: Dispatch the route.** Beside the existing capture route (`if (url.pathname === '/settings/api/memory/capture') {...}`):

```typescript
  if (url.pathname === '/settings/api/memory/record-injection') {
    if (req.method === 'PATCH') return handleRecordInjectionPatch(req)
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test tests/debug/settings/memory-routes.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck and commit**

```bash
bun run typecheck
git add src/debug/settings/memory-routes.ts tests/debug/settings/memory-routes.test.ts
git commit -m "feat(memory): settings API to read and toggle record injection"
```

---

### Task 5: Client — schema, fetcher, and MemorySection toggle

**Files:**
- Modify: `client/settings/fetcher-schemas.ts:115-121` (`MemoryResponseSchema`)
- Modify: `client/settings/fetchers.ts` (new `setMemoryRecordInjection`)
- Modify: `client/settings/sections/MemorySection.svelte` (state + toggle fn + button)
- Test: `client/settings/sections/MemorySection.stories.svelte` (story asserting the toggle renders/acts)

**Interfaces:**
- Consumes: `GET/PATCH` endpoints from Task 4.
- Produces: `MemoryResponse.injectRecords: boolean`; `setMemoryRecordInjection({ contextId, enabled })`; a `memory-record-injection-toggle` control in `MemorySection`.

- [ ] **Step 1: Add the field to the response schema** in `client/settings/fetcher-schemas.ts`:

```typescript
export const MemoryResponseSchema = z.object({
  contextId: z.string(),
  scopeType: z.enum(['personal', 'group']),
  enabled: z.boolean(),
  injectRecords: z.boolean(),
  profile: z.string(),
  records: z.array(MemoryRecordSchema),
})
```

- [ ] **Step 2: Add the fetcher** in `client/settings/fetchers.ts`, below `setMemoryCapture`:

```typescript
export const setMemoryRecordInjection = (input: { contextId: string; enabled: boolean }): Promise<unknown> =>
  writeJson('/settings/api/memory/record-injection', 'PATCH', input, (b) => b)
```

- [ ] **Step 3: Wire the toggle in `MemorySection.svelte`.** Add the import to the existing fetchers import block:

```typescript
    setMemoryRecordInjection,
```

Add state beside `togglingCapture` (line ~40):

```typescript
  let togglingInjection = $state(false)
```

Add a handler beside `toggleCapture`:

```typescript
  async function toggleRecordInjection(): Promise<void> {
    if (currentMemory === null) return
    error = null
    status = null
    togglingInjection = true
    try {
      await setMemoryRecordInjection({ contextId, enabled: !currentMemory.injectRecords })
      await load(contextId)
    } catch (err) {
      error = messageFrom(err)
    } finally {
      togglingInjection = false
    }
  }
```

Add a button in the header actions block beside the capture toggle (mirror its markup):

```svelte
        <Button
          testid="memory-record-injection-toggle"
          variant={currentMemory?.injectRecords ? 'outline' : 'primary'}
          disabled={currentMemory === null || loading || togglingInjection}
          onClick={() => void toggleRecordInjection()}>
          {#snippet children()}{currentMemory?.injectRecords ? 'Stop injecting records' : 'Inject records each turn'}{/snippet}
        </Button>
```

- [ ] **Step 4: Add/extend a Storybook story** in `MemorySection.stories.svelte` so the toggle has coverage. Add an interaction (mirroring the capture-toggle story) that mounts with `injectRecords: false`, finds `memory-record-injection-toggle`, and asserts its label reads "Inject records each turn". If the story fixture provides a mocked memory response, add `injectRecords: false` to it.

- [ ] **Step 5: Typecheck / build client and run the story test**

Run: `bun run typecheck`
Run: `bun test client/settings/sections/MemorySection.stories.svelte` (or the project's story-test command; check `docs/architecture/commands.md` if unsure)
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/settings/fetcher-schemas.ts client/settings/fetchers.ts client/settings/sections/MemorySection.svelte client/settings/sections/MemorySection.stories.svelte
git commit -m "feat(memory): MemorySection toggle for per-turn record injection"
```

---

### Task 6: Document the behavior change (ADR note)

**Files:**
- Create: `docs/adr/0225-memory-record-injection-opt-in.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Write the ADR.** Create `docs/adr/0225-memory-record-injection-opt-in.md`:

```markdown
<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# 0225 — Long-term memory record injection is opt-in

## Status

Accepted (2026-07-24)

## Context

Since the long-term-memory foundation (2026-06-12), `buildMessagesWithMemory` has injected
the three most-recently-touched active records into a position-0 system message every turn.
This is a placeholder "recency injection, not retrieval" (`docs/research/agent-memory/01-current-state-audit.md`).
It is the most volatile part of the prompt prefix — its contents change as `lastSeenAt`
updates — so it repeatedly invalidates the cacheable prefix, and the frozen research measured
only retrieval rank with no live reader, so its effect on answer quality is unmeasured.

## Decision

Gate record injection behind a per-memory-scope boolean `memory_profiles.inject_records`,
defaulting **off**. When off, the long-term-memory message still carries the profile; only
records are suppressed. The flag is an opt-in toggle in the settings MemorySection.

## Consequences

- **Behavior change:** existing scopes stop receiving record injection until they opt in.
  The durable profile is retained, and records remain reachable on demand via the
  `search_memory` tool.
- The default prompt prefix becomes more cache-stable.
- How memory *should* reach the conversation (push vs. trailing placement vs. tool-pull/JIT
  vs. agentic selection) is deferred to a separate deep-research effort; this flag is the
  safety valve that keeps the default stable while that research runs.
```

- [ ] **Step 2: Commit**

```bash
git add docs/adr/0225-memory-record-injection-opt-in.md
git commit -m "docs(memory): ADR 0225 record injection opt-in"
```

---

## Self-Review

**Spec coverage:**
- Storage column on `memory_profiles`, default off → Task 1. ✅
- Type + serialization → Task 1. ✅
- Store setter (does not disturb capture) → Task 2. ✅
- Injection gate, profile retained, `listMemoryRecords` not called when off → Task 3. ✅
- Settings API GET field + PATCH route → Task 4. ✅
- Client schema + fetcher + MemorySection toggle → Task 5. ✅
- Behavior-change ADR note → Task 6. ✅
- Spec test #6 (migration applies; pre-existing profiles read `false`): covered by Task 1's default assertion via `setupTestDb`, which applies migration 070 and reads the default. ✅

**Type consistency:** `injectRecords` (camelCase, TS) ↔ `inject_records` (snake_case, SQL) used consistently; `setMemoryRecordInjectionEnabled(scope, enabled, now): MemoryProfile` signature identical across Tasks 2/3/4; `MemoryResponse.injectRecords` matches the GET payload key in Task 4.

**Placeholder scan:** every code step shows concrete code; the two test steps that defer to existing local helpers (Task 4 route helpers, Task 5 story fixture) explicitly say to mirror the file's existing capture test/story rather than invent helpers — appropriate because those helpers are file-local and already established.

## Execution Reconciliation — 2026-07-26

| Tasks | Status | Code evidence |
| --- | --- | --- |
| 1–6 | Complete in code | Migration 070, profile/store/API/client toggle, `buildMessagesWithMemory` gate, ADR 0225, and migration/conversation/settings tests; commits `52767da` through `a6ed1ef`. |

## Drift Log

| Date | Category | Item | Decision |
| --- | --- | --- |
| 2026-07-26 | In-plan, stale task state | Tasks 1–6 had landed commits but every step box remained unchecked. | Recorded completion above; retained original boxes as authoring history. |
| 2026-07-26 | Scope boundary | This flag only stops automatic `memory_records` injection; it does not make a future query-aware injection safe or approved. | Tier 3 remains blocked by the active roadmap’s P1/P2 gates. |
