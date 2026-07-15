<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Multi-provider LLM Settings UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the settings UI for the multi-provider LLM registry — admin Providers + Models sections and a generalized personal BYOK section — replacing the dead `AdminSystemSection`.

**Architecture:** The backend routes (Plan A, merged) already expose `/settings/api/admin/providers`, `/settings/api/admin/llm-roles`, and extended BYOK PATCH actions. This plan adds the client-side Zod schemas, fetchers, reusable Svelte components (VerificationPill, ProviderForm, RoleBindingBlock), three section components, MSW handlers + stories, and SettingsApp navigation wiring. One small server-side change extends the BYOK GET to return v2 multi-provider data (providers + roles).

**Tech Stack:** Svelte 5 (runes: `$state`, `$derived`, `$effect`, `$props`), Zod v4, MSW (Mock Service Worker) for Storybook, bun:test for all tests. Svelte components are tested with `mount`/`unmount` + `flushSync` + mock fetch.

**Design spec:** `docs/superpowers/specs/2026-07-15-multi-llm-providers-design.md` §6.

---

## File Map

### New files — client

| File                                                                  | Responsibility                                                                                                                         |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `client/settings/fetcher-schemas-llm-providers.ts`                    | Zod schemas: Verification, PublicProviderAccount, RoleBinding, LlmRoleBindings + client-side `PROVIDER_TYPE_BASE_URLS` preset constant |
| `client/settings/components/VerificationPill.svelte`                  | Renders a `Pill` with tone/text derived from a `Verification` object                                                                   |
| `client/settings/components/ProviderForm.svelte`                      | Reusable add/edit provider form: type dropdown, label, baseUrl, apiKey                                                                 |
| `client/settings/components/RoleBindingBlock.svelte`                  | Reusable role binding selector: provider dropdown + model combobox + optional "Inherit" toggle                                         |
| `client/settings/sections/admin/AdminProvidersSection.svelte`         | Admin provider list + add/edit/delete + refresh-models                                                                                 |
| `client/settings/sections/admin/AdminModelsSection.svelte`            | Admin role bindings: three RoleBindingBlocks (main required; small/embedding inheritable)                                              |
| `client/settings/sections/admin/AdminProvidersSection.stories.svelte` | Stories for AdminProvidersSection                                                                                                      |
| `client/settings/sections/admin/AdminModelsSection.stories.svelte`    | Stories for AdminModelsSection                                                                                                         |

### New files — tests

| File                                                          | Tests                                                 |
| ------------------------------------------------------------- | ----------------------------------------------------- |
| `tests/client/settings/fetcher-schemas-llm-providers.test.ts` | Zod schema parse/reject                               |
| `tests/client/settings/admin-llm-providers-fetchers.test.ts`  | Admin provider/roles fetchers: URL, method, body      |
| `tests/client/settings/admin-providers-section.test.ts`       | AdminProvidersSection: list, add, delete, refresh     |
| `tests/client/settings/admin-models-section.test.ts`          | AdminModelsSection: role binding save, inherit toggle |

### Modified files — client

| File                                                  | Change                                                                                          |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `client/settings/fetchers.ts`                         | Add BYOK provider action fetchers (upsert/delete/set-roles/refresh)                             |
| `client/settings/fetcher-schemas.ts`                  | Extend `ByokResponseSchema` with optional `providers` + `roles`                                 |
| `client/settings/admin-fetchers.ts`                   | Add provider CRUD + roles fetchers; remove dead `fetchAdminSystem`/`submitAdminSystem`          |
| `client/settings/fetcher-schemas-admin.ts`            | Remove dead `AdminLlmKeyStateSchema`/`AdminSystemResponseSchema`                                |
| `client/settings/sections/ByokSection.svelte`         | Full rewrite: provider list + role overrides                                                    |
| `client/settings/sections/ByokSection.stories.svelte` | Updated scenarios                                                                               |
| `client/settings/SettingsApp.svelte`                  | Replace System nav item with Providers + Models; mount new sections; unmount AdminSystemSection |
| `client/shared/api-types.ts`                          | Add `PublicProviderAccount`, `LlmRoleBindingsClient` types                                      |
| `client/stories/msw/settings-handlers-admin.ts`       | Add `adminProvidersHandlers` + `adminLlmRolesHandlers`; remove dead `adminSystemHandlers`       |
| `client/stories/msw/settings-handlers.ts`             | Extend byok handlers with providers + roles                                                     |
| `client/stories/msw/scenarios.ts`                     | New scenarios for providers/models; update shell-admin-ready; remove system scenarios           |

### Modified files — server

| File                                | Change                                                             |
| ----------------------------------- | ------------------------------------------------------------------ |
| `src/debug/settings/byok-routes.ts` | Extend `fieldResponse` to return v2 `providers` (masked) + `roles` |

### Deleted files

| File                                                               | Reason                            |
| ------------------------------------------------------------------ | --------------------------------- |
| `client/settings/sections/admin/AdminSystemSection.svelte`         | Dead — endpoint removed in Plan A |
| `client/settings/sections/admin/AdminSystemSection.stories.svelte` | Dead stories for dead section     |

---

## Conventions Reference

**Svelte 5 runes:** `$state` for mutable local state, `$derived`/`$derived.by` for computed, `$effect` for side effects (auto-load), `$props` for component props. No Svelte stores (`writable`/`readable`). Inputs use controlled `value` + `onInput`/`onChange` callbacks.

**Fetcher pattern:** `getJson(path, schema.parse)` for GETs; `writeJson(path, method, body, (b) => b)` for writes. CSRF header auto-attached by `settingsFetch`. Error extraction: `err instanceof Error ? err.message : String(err)`.

**Section lifecycle:** `$effect(() => { untrack(() => void load(id)) })` for auto-load; `loadedContextId` race-guard; `currentData = $derived(loadedContextId === contextId ? data : null)` to blank during context switch.

**Test pattern (fetchers):** Mock `globalThis.fetch` via `setMockFetch`; assert URL, method, parsed body. Restore via `restoreFetch`.

**Test pattern (schemas):** `Schema.parse(input)` + assert fields; `expect(() => Schema.parse(bad)).toThrow()` for rejection.

**Test pattern (Svelte components):** `mount(Component, { target, props })` + `flushSync()` + mock fetch; query `document.body` for `data-testid` elements; `unmount()` cleanup.

**MSW handler pattern:** Each family exports a `HandlerFamily` with `populated`/`empty`/`error`/`loading` arrays. Named sub-families (like byok's `secretSet`/`missing`/`disabled`) are also acceptable. Register in `scenarios.ts`.

**Story pattern:** `defineMeta({ title, component })` + `<Story name="..." parameters={{ fixtures: 'scenario-name' }} />`. Context-scoped sections pass `args: { contextId: '...' }`.

**License header:** Every new `.ts` and `.svelte` file starts with the SPDX header block (see existing files).

**Import paths:** Always use `.js` extension in import paths (e.g., `import { x } from './module.js'`).

---

## Task 1: Backend — Extend BYOK GET response

**Goal:** The BYOK GET (`fieldResponse` in `byok-routes.ts`) currently returns only legacy flat fields. Extend it to also return `providers` (masked apiKey) and `roles` from the v2 bundle via `getByokBundle`.

**Files:**

- Modify: `src/debug/settings/byok-routes.ts`
- Test: `tests/debug/settings/byok-routes.test.ts` (or wherever the byok route test lives — search for it)

- [ ] **Step 1: Locate the BYOK route test file**

Run: `grep -rl "byok" tests/ --include="*.test.ts" | head -10`

The test file that exercises `handleByokRoutes` GET is the target.

- [ ] **Step 2: Write the failing test**

Add a test that verifies the extended GET response includes `providers` and `roles`:

```typescript
test('GET returns v2 providers and roles alongside legacy fields', async () => {
  // Seed a context with BYOK enabled and a v2 provider + role binding
  // (use the existing test helpers: setupTestDb, then upsertByokProvider + setByokRoles)
  const contextId = 'tg:123'
  enableByokForContext(contextId, 'tester')
  upsertByokProvider(
    contextId,
    {
      id: 'prov_1',
      label: 'My Ollama',
      providerType: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
      apiKey: 'sk-test-key',
      verification: { status: 'unverified', error: null, at: null, models: [], modelsFetchedAt: null },
    },
    'tester',
  )
  setByokRoles(
    contextId,
    {
      main: { providerId: 'prov_1', model: 'llama3' },
      small: null,
      embedding: null,
    },
    'tester',
  )

  const res = await handleByokRoutes(
    new Request('/settings/api/byok?contextId=tg:123'),
    new URL('http://x/settings/api/byok?contextId=tg:123'),
  )
  const body = await res.json()

  expect(body.providers).toHaveLength(1)
  expect(body.providers[0].apiKeyMasked).toBe('****key')
  expect(body.providers[0].label).toBe('My Ollama')
  expect(body.roles.main).toEqual({ providerId: 'prov_1', model: 'llama3' })
  expect(body.roles.small).toBeNull()
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/debug/settings/byok-routes.test.ts`
Expected: FAIL — `body.providers` is undefined.

- [ ] **Step 4: Implement the change**

In `src/debug/settings/byok-routes.ts`, modify `fieldResponse`:

```typescript
import { getByokBundle } from '../../byok-llm/store.js'

const maskApiKey = (apiKey: string): string => `****${apiKey.slice(-4)}`

const publicByokProvider = (p: LlmProviderAccount): unknown => ({
  id: p.id,
  label: p.label,
  providerType: p.providerType,
  baseUrl: p.baseUrl,
  apiKeyMasked: maskApiKey(p.apiKey),
  verification: p.verification,
})

const emptyRolesResponse = () => ({
  main: { providerId: '', model: '' },
  small: null,
  embedding: null,
})

const fieldResponse = (contextId: string): unknown => {
  const state = getByokCredentialState(contextId)
  if (!state.enabled)
    return { enabled: false, complete: false, missing: [], fields: [], providers: [], roles: emptyRolesResponse() }

  const bundle = getByokBundle(contextId)
  if (bundle.unreadable)
    return {
      ...state,
      unreadable: true,
      error: bundle.error,
      fields: [],
      providers: [],
      roles: emptyRolesResponse(),
    }

  const config = getByokLlmConfig(contextId) ?? {}
  const fields = BYOK_FIELDS.map((field) => {
    const raw = config[field.key] ?? ''
    const hasValue = raw.length > 0
    return {
      ...field,
      hasValue,
      value: hasValue && field.sensitive ? maskSensitiveValue(raw) : raw,
    }
  })

  const providers = (bundle.blob?.providers ?? []).map(publicByokProvider)
  const roles = bundle.blob?.roles ?? emptyRolesResponse()

  return { ...state, fields, providers, roles }
}
```

Note: `LlmProviderAccount` is already imported at the top of the file. Add `getByokBundle` to the existing import from `../../byok-llm/store.js`.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/debug/settings/byok-routes.test.ts`
Expected: PASS

- [ ] **Step 6: Run full gate**

Run: `bun run typecheck && bun run lint`
Expected: clean

- [ ] **Step 7: Commit**

```bash
git add src/debug/settings/byok-routes.ts tests/debug/settings/byok-routes.test.ts
git commit -m "feat(byok): extend GET response with v2 providers and roles"
```

---

## Task 2: Client schemas — LLM provider Zod schemas

**Goal:** Create the client-side Zod schemas mirroring the server types, plus a client-side provider type preset constant.

**Files:**

- Create: `client/settings/fetcher-schemas-llm-providers.ts`
- Modify: `client/settings/fetcher-schemas.ts` (extend `ByokResponseSchema`)
- Test: Create `tests/client/settings/fetcher-schemas-llm-providers.test.ts`
- Test: Modify `tests/client/settings/byok-fetcher-schemas.test.ts`

- [ ] **Step 1: Write the failing test for new schemas**

Create `tests/client/settings/fetcher-schemas-llm-providers.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  LlmProviderTypesSchema,
  ProviderTypeBaseUrls,
  PublicProviderAccountSchema,
  VerificationSchema,
  type PublicProviderAccount,
} from '../../../client/settings/fetcher-schemas-llm-providers.js'
import {
  AdminProvidersResponseSchema,
  AdminLlmRolesResponseSchema,
} from '../../../client/settings/fetcher-schemas-llm-providers.js'

describe('LLM provider schemas', () => {
  test('parses a public provider account', () => {
    const parsed = PublicProviderAccountSchema.parse({
      id: 'prov_1',
      label: 'OpenAI',
      providerType: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKeyMasked: '****abcd',
      verification: {
        status: 'verified',
        error: null,
        at: 1717000000000,
        models: ['gpt-4o'],
        modelsFetchedAt: 1717000000000,
      },
    })

    expect(parsed.id).toBe('prov_1')
    expect(parsed.verification.status).toBe('verified')
    expect(parsed.verification.models).toEqual(['gpt-4o'])
  })

  test('rejects an unknown provider type', () => {
    expect(() =>
      PublicProviderAccountSchema.parse({
        id: 'prov_1',
        label: 'X',
        providerType: 'unknown',
        baseUrl: 'x',
        apiKeyMasked: '****x',
        verification: { status: 'unverified', error: null, at: null, models: [], modelsFetchedAt: null },
      }),
    ).toThrow()
  })

  test('parses admin providers list response', () => {
    const parsed = AdminProvidersResponseSchema.parse({
      providers: [
        {
          id: 'prov_1',
          label: 'OpenAI',
          providerType: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          apiKeyMasked: '****abcd',
          verification: { status: 'verified', error: null, at: null, models: [], modelsFetchedAt: null },
        },
      ],
    })
    expect(parsed.providers).toHaveLength(1)
  })

  test('parses admin roles response', () => {
    const parsed = AdminLlmRolesResponseSchema.parse({
      roles: {
        main: { providerId: 'prov_1', model: 'gpt-4o' },
        small: null,
        embedding: null,
      },
    })
    expect(parsed.roles.main.model).toBe('gpt-4o')
    expect(parsed.roles.small).toBeNull()
  })

  test('PROVIDER_TYPE_BASE_URLS has presets for known types', () => {
    expect(ProviderTypeBaseUrls.openai).toBe('https://api.openai.com/v1')
    expect(ProviderTypeBaseUrls.ollama).toBe('http://localhost:11434/v1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/client/settings/fetcher-schemas-llm-providers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the schema file**

Create `client/settings/fetcher-schemas-llm-providers.ts`:

```typescript
// SPDX-License-Identifier-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

export const LlmProviderTypesSchema = z.enum([
  'openai',
  'anthropic',
  'google',
  'openrouter',
  'ollama',
  'groq',
  'custom',
])
export type LlmProviderType = z.infer<typeof LlmProviderTypesSchema>

export const PROVIDER_TYPE_BASE_URLS: Readonly<Partial<Record<LlmProviderType, string>>> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1/openai',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai',
  openrouter: 'https://openrouter.ai/api/v1',
  ollama: 'http://localhost:11434/v1',
  groq: 'https://api.groq.com/openai/v1',
}

export const VerificationSchema = z.object({
  status: z.enum(['verified', 'unverified', 'error']),
  error: z.string().nullable(),
  at: z.number().nullable(),
  models: z.array(z.string()),
  modelsFetchedAt: z.number().nullable(),
})
export type Verification = z.infer<typeof VerificationSchema>

export const PublicProviderAccountSchema = z.object({
  id: z.string(),
  label: z.string(),
  providerType: LlmProviderTypesSchema,
  baseUrl: z.string(),
  apiKeyMasked: z.string(),
  verification: VerificationSchema,
})
export type PublicProviderAccount = z.infer<typeof PublicProviderAccountSchema>

const RoleBindingSchema = z.object({ providerId: z.string(), model: z.string() }).nullable()
export const LlmRoleBindingsSchema = z.object({
  main: z.object({ providerId: z.string(), model: z.string() }),
  small: RoleBindingSchema,
  embedding: RoleBindingSchema,
})
export type LlmRoleBindings = z.infer<typeof LlmRoleBindingsSchema>
export type RoleBinding = z.infer<typeof RoleBindingSchema>

export const AdminProvidersResponseSchema = z.object({ providers: z.array(PublicProviderAccountSchema) })
export type AdminProvidersResponse = z.infer<typeof AdminProvidersResponseSchema>

export const AdminLlmRolesResponseSchema = z.object({ roles: LlmRoleBindingsSchema })
export type AdminLlmRolesResponse = z.infer<typeof AdminLlmRolesResponseSchema>

export const ProviderInputSchema = z.object({
  label: z.string().min(1),
  providerType: LlmProviderTypesSchema,
  baseUrl: z.string().min(1),
  apiKey: z.string().min(1),
})
export type ProviderInput = z.infer<typeof ProviderInputSchema>

export const PROVIDER_TYPE_OPTIONS: ReadonlyArray<{ value: LlmProviderType; label: string }> = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google', label: 'Google' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'groq', label: 'Groq' },
  { value: 'custom', label: 'Custom' },
]
```

- [ ] **Step 4: Extend ByokResponseSchema**

In `client/settings/fetcher-schemas.ts`, add the new optional fields:

```typescript
import { LlmRoleBindingsSchema, PublicProviderAccountSchema } from './fetcher-schemas-llm-providers.js'

// ... existing code ...

export const ByokResponseSchema = z.object({
  enabled: z.boolean(),
  complete: z.boolean(),
  missing: z.array(z.string()),
  unreadable: z.literal(true).optional(),
  error: z.string().optional(),
  fields: z.array(ByokFieldSchema),
  providers: z.array(PublicProviderAccountSchema).default([]),
  roles: LlmRoleBindingsSchema.default({
    main: { providerId: '', model: '' },
    small: null,
    embedding: null,
  }),
})
```

Add `providers` and `roles` to the `ByokResponse` type (inferred automatically).

- [ ] **Step 5: Update BYOK schema tests**

In `tests/client/settings/byok-fetcher-schemas.test.ts`, add:

```typescript
test('parses BYOK response with v2 providers and roles', () => {
  const parsed = ByokResponseSchema.parse({
    enabled: true,
    complete: true,
    missing: [],
    fields: [],
    providers: [
      {
        id: 'prov_1',
        label: 'My Ollama',
        providerType: 'ollama',
        baseUrl: 'http://localhost:11434/v1',
        apiKeyMasked: '****key',
        verification: { status: 'verified', error: null, at: null, models: ['llama3'], modelsFetchedAt: null },
      },
    ],
    roles: {
      main: { providerId: 'prov_1', model: 'llama3' },
      small: null,
      embedding: null,
    },
  })

  expect(parsed.providers).toHaveLength(1)
  expect(parsed.providers[0]?.label).toBe('My Ollama')
  expect(parsed.roles.main.model).toBe('llama3')
})
```

- [ ] **Step 6: Run tests**

Run: `bun test tests/client/settings/fetcher-schemas-llm-providers.test.ts tests/client/settings/byok-fetcher-schemas.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add client/settings/fetcher-schemas-llm-providers.ts client/settings/fetcher-schemas.ts \
  tests/client/settings/fetcher-schemas-llm-providers.test.ts tests/client/settings/byok-fetcher-schemas.test.ts
git commit -m "feat(client): add LLM provider Zod schemas + extend BYOK response schema"
```

---

## Task 3: Admin fetchers — providers CRUD + roles

**Goal:** Add fetcher functions for the admin provider and roles endpoints.

**Files:**

- Modify: `client/settings/admin-fetchers.ts`
- Test: Create `tests/client/settings/admin-llm-providers-fetchers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/client/settings/admin-llm-providers-fetchers.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  createAdminProvider,
  deleteAdminProvider,
  fetchAdminLlmRoles,
  fetchAdminProviders,
  putAdminLlmRoles,
  updateAdminProvider,
} from '../../../client/settings/admin-fetchers.js'
import { setCsrfToken } from '../../../client/settings/fetchers.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

type CapturedFetchCall = Readonly<{ url: string; init: RequestInit }>
const captured: CapturedFetchCall[] = []

beforeEach(() => {
  captured.length = 0
})
afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const installFetch = (payload: unknown): void => {
  setMockFetch((url, init) => {
    captured.push({ url, init })
    return Promise.resolve(json(payload))
  })
}

const parseBody = (body: BodyInit | null | undefined): unknown => (typeof body === 'string' ? JSON.parse(body) : null)
const methodOf = (init: RequestInit): string => (init.method ?? 'GET').toUpperCase()

describe('admin LLM provider fetchers', () => {
  test('fetchAdminProviders GETs the providers list', async () => {
    installFetch({ providers: [] })
    await fetchAdminProviders()
    expect(captured[0]?.url).toBe('/settings/api/admin/providers')
    expect(methodOf(captured[0]!.init)).toBe('GET')
  })

  test('createAdminProvider POSTs a provider body', async () => {
    installFetch({
      provider: {
        id: 'prov_1',
        label: '',
        providerType: 'openai',
        baseUrl: '',
        apiKeyMasked: '',
        verification: { status: 'unverified', error: null, at: null, models: [], modelsFetchedAt: null },
      },
    })
    await createAdminProvider({
      label: 'OpenAI',
      providerType: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-xxx',
    })
    expect(methodOf(captured[0]!.init)).toBe('POST')
    expect(parseBody(captured[0]?.init.body)).toEqual({
      label: 'OpenAI',
      providerType: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-xxx',
    })
  })

  test('updateAdminProvider PATCHes a provider', async () => {
    installFetch({ provider: {} })
    await updateAdminProvider('prov_1', { label: 'Renamed' })
    expect(captured[0]?.url).toBe('/settings/api/admin/providers/prov_1')
    expect(methodOf(captured[0]!.init)).toBe('PATCH')
    expect(parseBody(captured[0]?.init.body)).toEqual({ label: 'Renamed' })
  })

  test('deleteAdminProvider DELETEs a provider', async () => {
    installFetch({ ok: true })
    await deleteAdminProvider('prov_1')
    expect(captured[0]?.url).toBe('/settings/api/admin/providers/prov_1')
    expect(methodOf(captured[0]!.init)).toBe('DELETE')
  })

  test('fetchAdminLlmRoles GETs the roles', async () => {
    installFetch({ roles: { main: { providerId: '', model: '' }, small: null, embedding: null } })
    await fetchAdminLlmRoles()
    expect(captured[0]?.url).toBe('/settings/api/admin/llm-roles')
    expect(methodOf(captured[0]!.init)).toBe('GET')
  })

  test('putAdminLlmRoles PUTs the roles body', async () => {
    installFetch({ ok: true })
    await putAdminLlmRoles({
      main: { providerId: 'prov_1', model: 'gpt-4o' },
      small: null,
      embedding: null,
    })
    expect(methodOf(captured[0]!.init)).toBe('PUT')
    expect(parseBody(captured[0]?.init.body)).toEqual({
      main: { providerId: 'prov_1', model: 'gpt-4o' },
      small: null,
      embedding: null,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/client/settings/admin-llm-providers-fetchers.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement the fetchers**

In `client/settings/admin-fetchers.ts`, add (at the end of the file, before the last section):

```typescript
import {
  AdminLlmRolesResponseSchema,
  AdminProvidersResponseSchema,
  type AdminLlmRolesResponse,
  type AdminProvidersResponse,
  type LlmRoleBindings,
  type ProviderInput,
} from './fetcher-schemas-llm-providers.js'

// --- Admin: LLM providers + roles ---

export const fetchAdminProviders = (): Promise<AdminProvidersResponse> =>
  getJson('/settings/api/admin/providers', (b) => AdminProvidersResponseSchema.parse(b))

export const createAdminProvider = (input: ProviderInput): Promise<unknown> =>
  writeJson('/settings/api/admin/providers', 'POST', input, (b) => b)

export const updateAdminProvider = (id: string, input: Partial<ProviderInput>): Promise<unknown> =>
  writeJson(`/settings/api/admin/providers/${encodeURIComponent(id)}`, 'PATCH', input, (b) => b)

export const deleteAdminProvider = (id: string): Promise<unknown> =>
  settingsFetch(`/settings/api/admin/providers/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(async (res) => {
    const body = await readBody(res)
    requireOk(res, body)
    return body
  })

export const fetchAdminLlmRoles = (): Promise<AdminLlmRolesResponse> =>
  getJson('/settings/api/admin/llm-roles', (b) => AdminLlmRolesResponseSchema.parse(b))

export const putAdminLlmRoles = (roles: LlmRoleBindings): Promise<unknown> =>
  writeJson('/settings/api/admin/llm-roles', 'PUT', roles, (b) => b)
```

Also remove the dead `fetchAdminSystem` / `submitAdminSystem` functions and their imports (`AdminSystemResponseSchema`, `AdminSystemResponse`).

- [ ] **Step 4: Run tests**

Run: `bun test tests/client/settings/admin-llm-providers-fetchers.test.ts`
Expected: PASS

- [ ] **Step 5: Run typecheck (will find AdminSystemSection references — expected, Task 12 fixes them)**

Run: `bun run typecheck 2>&1 | grep -c error`
Note: Errors from `AdminSystemSection.svelte` and `AdminSystemSection.stories.svelte` are expected until Task 12. The fetcher test itself should pass.

- [ ] **Step 6: Commit**

```bash
git add client/settings/admin-fetchers.ts tests/client/settings/admin-llm-providers-fetchers.test.ts
git commit -m "feat(client): admin LLM provider + roles fetchers; remove dead system fetchers"
```

---

## Task 4: BYOK fetchers — provider action fetchers

**Goal:** Add fetcher functions for the BYOK multi-provider PATCH actions.

**Files:**

- Modify: `client/settings/fetchers.ts`
- Test: Modify `tests/client/settings/byok-fetchers.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/client/settings/byok-fetchers.test.ts`:

```typescript
import {
  deleteByokProviderAction,
  refreshByokModels,
  setByokRolesAction,
  upsertByokProviderAction,
} from '../../../client/settings/fetchers.js'

// ... in the describe block ...

test('upsertByokProviderAction PATCHes an upsert-provider action', async () => {
  installFetch({ ok: true })
  await upsertByokProviderAction({
    contextId: 'ctx-1',
    provider: {
      id: 'prov_1',
      label: 'Test',
      providerType: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-xxx',
      verification: { status: 'unverified', error: null, at: null, models: [], modelsFetchedAt: null },
    },
  })
  const body = parseBody(captured[0]?.init.body) as { action: string; contextId: string }
  expect(body.action).toBe('upsert-provider')
  expect(body.contextId).toBe('ctx-1')
})

test('deleteByokProviderAction PATCHes a delete-provider action', async () => {
  installFetch({ ok: true })
  await deleteByokProviderAction({ contextId: 'ctx-1', id: 'prov_1' })
  const body = parseBody(captured[0]?.init.body) as { action: string; id: string }
  expect(body.action).toBe('delete-provider')
  expect(body.id).toBe('prov_1')
})

test('setByokRolesAction PATCHes a set-roles action', async () => {
  installFetch({ ok: true })
  await setByokRolesAction({
    contextId: 'ctx-1',
    roles: { main: { providerId: 'prov_1', model: 'gpt-4o' }, small: null, embedding: null },
  })
  const body = parseBody(captured[0]?.init.body) as { action: string }
  expect(body.action).toBe('set-roles')
})

test('refreshByokModels PATCHes a refresh-models action', async () => {
  installFetch({ ok: true })
  await refreshByokModels({ contextId: 'ctx-1', id: 'prov_1' })
  const body = parseBody(captured[0]?.init.body) as { action: string; id: string }
  expect(body.action).toBe('refresh-models')
  expect(body.id).toBe('prov_1')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/client/settings/byok-fetchers.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement the fetchers**

In `client/settings/fetchers.ts`, add:

```typescript
import type { LlmRoleBindings, Verification } from './fetcher-schemas-llm-providers.js'

// ... existing code ...

// --- BYOK multi-provider actions ---

/** Shape matching the server's ProviderInBlobSchema (plaintext apiKey, full verification). */
type ByokProviderEntry = {
  id: string
  label: string
  providerType: string
  baseUrl: string
  apiKey: string
  verification: Verification
}

export const upsertByokProviderAction = (input: { contextId: string; provider: ByokProviderEntry }): Promise<unknown> =>
  writeJson(
    '/settings/api/byok',
    'PATCH',
    { contextId: input.contextId, action: 'upsert-provider', provider: input.provider },
    (b) => b,
  )

export const deleteByokProviderAction = (input: { contextId: string; id: string }): Promise<unknown> =>
  writeJson(
    '/settings/api/byok',
    'PATCH',
    { contextId: input.contextId, action: 'delete-provider', id: input.id },
    (b) => b,
  )

export const setByokRolesAction = (input: { contextId: string; roles: LlmRoleBindings }): Promise<unknown> =>
  writeJson(
    '/settings/api/byok',
    'PATCH',
    { contextId: input.contextId, action: 'set-roles', roles: input.roles },
    (b) => b,
  )

export const refreshByokModels = (input: { contextId: string; id: string }): Promise<unknown> =>
  writeJson(
    '/settings/api/byok',
    'PATCH',
    { contextId: input.contextId, action: 'refresh-models', id: input.id },
    (b) => b,
  )
```

Note: adjust imports to avoid name clashes with existing `patchByok`/`toggleByok`. Use `LlmRoleBindings` type from the new schemas file. For the provider type in `upsertByokProviderAction`, match the server's `ProviderInBlobSchema` shape (id, label, providerType, baseUrl, apiKey, verification).

- [ ] **Step 4: Run tests**

Run: `bun test tests/client/settings/byok-fetchers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/settings/fetchers.ts tests/client/settings/byok-fetchers.test.ts
git commit -m "feat(client): BYOK multi-provider action fetchers"
```

---

## Task 5: MSW handlers for new endpoints

**Goal:** Add MSW mock handlers for admin providers/roles and extend the personal BYOK handlers with v2 data.

**Files:**

- Modify: `client/stories/msw/settings-handlers-admin.ts`
- Modify: `client/stories/msw/settings-handlers.ts`
- Modify: `client/stories/msw/scenarios.ts`

- [ ] **Step 1: Add admin providers + roles handlers**

In `client/stories/msw/settings-handlers-admin.ts`, add (replacing the dead `adminSystemHandlers`):

```typescript
// --- Admin: LLM providers (GET/POST/PATCH/DELETE /settings/api/admin/providers) ---

const adminProvidersPopulated = {
  providers: [
    {
      id: 'prov_openai',
      label: 'OpenAI',
      providerType: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKeyMasked: '****abcd',
      verification: {
        status: 'verified',
        error: null,
        at: 1717000000000,
        models: ['gpt-4o', 'gpt-4o-mini'],
        modelsFetchedAt: 1717000000000,
      },
    },
    {
      id: 'prov_ollama',
      label: 'Local Ollama',
      providerType: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
      apiKeyMasked: '****ollama',
      verification: { status: 'unverified', error: null, at: null, models: [], modelsFetchedAt: null },
    },
  ],
}

const adminProvidersEmpty = { providers: [] }

export const adminProvidersHandlers: HandlerFamily = {
  populated: [
    http.get('/settings/api/admin/providers', () => HttpResponse.json(adminProvidersPopulated)),
    http.post('/settings/api/admin/providers', () =>
      HttpResponse.json({ provider: adminProvidersPopulated.providers[0] }),
    ),
    http.patch('/settings/api/admin/providers/:id', () =>
      HttpResponse.json({ provider: adminProvidersPopulated.providers[0] }),
    ),
    http.delete('/settings/api/admin/providers/:id', () => HttpResponse.json({ ok: true })),
  ],
  empty: [
    http.get('/settings/api/admin/providers', () => HttpResponse.json(adminProvidersEmpty)),
    http.post('/settings/api/admin/providers', () =>
      HttpResponse.json({ provider: adminProvidersPopulated.providers[0] }),
    ),
  ],
  error: [http.get('/settings/api/admin/providers', boom)],
  loading: [
    http.get('/settings/api/admin/providers', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(adminProvidersEmpty)
    }),
  ],
}

// --- Admin: LLM roles (GET/PUT /settings/api/admin/llm-roles) ---

const adminLlmRolesPopulated = {
  roles: {
    main: { providerId: 'prov_openai', model: 'gpt-4o' },
    small: { providerId: 'prov_openai', model: 'gpt-4o-mini' },
    embedding: null,
  },
}

const adminLlmRolesEmpty = {
  roles: { main: { providerId: '', model: '' }, small: null, embedding: null },
}

export const adminLlmRolesHandlers: HandlerFamily = {
  populated: [
    http.get('/settings/api/admin/llm-roles', () => HttpResponse.json(adminLlmRolesPopulated)),
    http.put('/settings/api/admin/llm-roles', () => HttpResponse.json({ ok: true })),
  ],
  empty: [http.get('/settings/api/admin/llm-roles', () => HttpResponse.json(adminLlmRolesEmpty))],
  error: [http.get('/settings/api/admin/llm-roles', boom)],
  loading: [
    http.get('/settings/api/admin/llm-roles', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(adminLlmRolesEmpty)
    }),
  ],
}
```

Remove the dead `adminSystemHandlers` export entirely.

- [ ] **Step 2: Extend personal BYOK handlers**

In `client/stories/msw/settings-handlers.ts`, extend the byok handler payloads to include `providers` and `roles`:

```typescript
const byokV2Providers = [
  {
    id: 'prov_personal',
    label: 'My Provider',
    providerType: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyMasked: '****WvfQ',
    verification: {
      status: 'verified',
      error: null,
      at: 1717000000000,
      models: ['gpt-4o'],
      modelsFetchedAt: 1717000000000,
    },
  },
]
const byokV2Roles = {
  main: { providerId: 'prov_personal', model: 'gpt-4o' },
  small: null,
  embedding: null,
}
```

Add `providers: byokV2Providers, roles: byokV2Roles` to `byokSecretSet`, `providers: [], roles: { main: { providerId: '', model: '' }, small: null, embedding: null }` to `byokDisabled`, and appropriate values to `byokMissing`. Also add PATCH handlers for the new actions (`upsert-provider`, `delete-provider`, `set-roles`, `refresh-models`) that echo back the current state.

- [ ] **Step 3: Update scenarios**

In `client/stories/msw/scenarios.ts`:

1. Import `adminProvidersHandlers` and `adminLlmRolesHandlers` from `settings-handlers-admin.ts`.
2. Remove import of `adminSystemHandlers`.
3. Remove all `settings-admin-system-*` scenario entries.
4. Add new scenarios:

```typescript
'settings-admin-providers-populated': [...adminProvidersHandlers.populated],
'settings-admin-providers-empty': [...adminProvidersHandlers.empty],
'settings-admin-providers-error': [...adminProvidersHandlers.error],
'settings-admin-providers-loading': [...adminProvidersHandlers.loading],
'settings-admin-llm-roles-populated': [...adminLlmRolesHandlers.populated],
'settings-admin-llm-roles-empty': [...adminLlmRolesHandlers.empty],
'settings-admin-llm-roles-error': [...adminLlmRolesHandlers.error],
'settings-admin-llm-roles-loading': [...adminLlmRolesHandlers.loading],
```

5. In `settings-shell-admin-ready`, replace `...adminSystemHandlers.populated` with `...adminProvidersHandlers.populated, ...adminLlmRolesHandlers.populated`.

- [ ] **Step 4: Verify no broken imports**

Run: `bun run typecheck 2>&1 | grep "scenarios\|handlers-admin\|handlers\.ts" | head -5`
Expected: no errors in the handler/scenario files themselves (AdminSystemSection errors are expected, Task 12 fixes those).

- [ ] **Step 5: Commit**

```bash
git add client/stories/msw/settings-handlers-admin.ts client/stories/msw/settings-handlers.ts client/stories/msw/scenarios.ts
git commit -m "feat(stories): MSW handlers for admin providers/roles + extended BYOK"
```

---

## Task 6: Shared component — VerificationPill

**Goal:** A small component that renders a `Pill` with tone/text derived from a `Verification` object.

**Files:**

- Create: `client/settings/components/VerificationPill.svelte`

- [ ] **Step 1: Create the component**

Create `client/settings/components/VerificationPill.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  import Pill from '../../shared/ui/Pill.svelte'
  import type { Verification } from '../fetcher-schemas-llm-providers.js'

  interface Props {
    verification: Verification
    children?: Snippet
  }

  let { verification, children }: Props = $props()

  type Tone = 'accent' | 'warn' | 'danger' | 'mute'

  const config = $derived.by((): { tone: Tone; text: string } => {
    switch (verification.status) {
      case 'verified': return { tone: 'accent', text: 'Verified' }
      case 'error': return { tone: 'danger', text: 'Error' }
      default: return { tone: 'mute', text: 'Unverified' }
    }
  })
</script>

<span data-testid="verification-pill" title={verification.error ?? undefined}>
  <Pill tone={config.tone} dot>
    {#snippet children()}
      {#if children}{@render children()}{:else}{config.text}{/if}
    {/snippet}
  </Pill>
</span>
```

- [ ] **Step 2: Verify typecheck**

Run: `bun run typecheck 2>&1 | grep VerificationPill`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add client/settings/components/VerificationPill.svelte
git commit -m "feat(client): VerificationPill component"
```

---

## Task 7: Shared component — ProviderForm

**Goal:** Reusable add/edit form for a provider account. Used by both admin and BYOK sections.

**Files:**

- Create: `client/settings/components/ProviderForm.svelte`

- [ ] **Step 1: Create the component**

Create `client/settings/components/ProviderForm.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Btn from '../../shared/ui/Btn.svelte'
  import Input from '../../shared/ui/Input.svelte'
  import Select from '../../shared/ui/Select.svelte'
  import {
    PROVIDER_TYPE_BASE_URLS,
    PROVIDER_TYPE_OPTIONS,
    type LlmProviderType,
  } from '../fetcher-schemas-llm-providers.js'

  interface Props {
    onSave: (input: { label: string; providerType: LlmProviderType; baseUrl: string; apiKey: string }) => Promise<boolean>
    onCancel: () => void
    busy?: boolean
    initial?: Partial<{ label: string; providerType: LlmProviderType; baseUrl: string }> | null
    requireApiKey?: boolean
    testidPrefix?: string
  }

  let {
    onSave,
    onCancel,
    busy = false,
    initial = null,
    requireApiKey = true,
    testidPrefix = 'provider-form',
  }: Props = $props()

  let label = $state(initial?.label ?? '')
  let providerType = $state<LlmProviderType>(initial?.providerType ?? 'openai')
  let baseUrl = $state(initial?.baseUrl ?? PROVIDER_TYPE_BASE_URLS.openai ?? '')
  let apiKey = $state('')

  function onTypeChange(next: string): void {
    providerType = next as LlmProviderType
    const preset = PROVIDER_TYPE_BASE_URLS[next as LlmProviderType]
    if (preset !== undefined) baseUrl = preset
  }

  const canSave = $derived(label.trim().length > 0 && baseUrl.trim().length > 0 && (!requireApiKey || apiKey.trim().length > 0))

  async function save(): Promise<void> {
    if (!canSave || busy) return
    await onSave({ label: label.trim(), providerType, baseUrl: baseUrl.trim(), apiKey: apiKey.trim() })
  }
</script>

<div class="provider-form" data-testid={testidPrefix}>
  <label class="provider-form__field">
    <span class="provider-form__label">Type</span>
    <Select
      value={providerType}
      options={PROVIDER_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
      onChange={onTypeChange}
      testid={`${testidPrefix}-type`} />
  </label>
  <label class="provider-form__field">
    <span class="provider-form__label">Label</span>
    <Input value={label} placeholder="e.g. OpenAI work" onInput={(v) => (label = v)} testid={`${testidPrefix}-label`} />
  </label>
  <label class="provider-form__field">
    <span class="provider-form__label">Base URL</span>
    <Input value={baseUrl} placeholder="https://api.example.com/v1" onInput={(v) => (baseUrl = v)} testid={`${testidPrefix}-base-url`} />
  </label>
  {#if requireApiKey}
    <label class="provider-form__field">
      <span class="provider-form__label">API Key</span>
      <Input type="password" value={apiKey} placeholder="enter API key" onInput={(v) => (apiKey = v)} testid={`${testidPrefix}-api-key`} />
    </label>
  {/if}
  <div class="provider-form__actions">
    <Btn variant="primary" size="sm" disabled={!canSave || busy} onClick={() => void save()} testid={`${testidPrefix}-save`}>
      {#snippet children()}{busy ? 'Saving…' : 'Save'}{/snippet}
    </Btn>
    <Btn variant="ghost" size="sm" onClick={onCancel} testid={`${testidPrefix}-cancel`}>
      {#snippet children()}Cancel{/snippet}
    </Btn>
  </div>
</div>

<style>
  .provider-form { display: grid; gap: var(--gap-inline); }
  .provider-form__field { display: grid; gap: 4px; }
  .provider-form__label { font-size: 11px; color: var(--fg3); font-family: var(--font-mono); }
  .provider-form__actions { display: flex; gap: 8px; }
</style>
```

- [ ] **Step 2: Verify typecheck**

Run: `bun run typecheck 2>&1 | grep ProviderForm`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add client/settings/components/ProviderForm.svelte
git commit -m "feat(client): ProviderForm reusable component"
```

---

## Task 8: Shared component — RoleBindingBlock

**Goal:** Reusable selector for binding a role to a provider + model. Supports an "Inherit" option (for small/embedding roles).

**Files:**

- Create: `client/settings/components/RoleBindingBlock.svelte`

- [ ] **Step 1: Create the component**

Create `client/settings/components/RoleBindingBlock.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Combobox from '../../shared/ui/Combobox.svelte'
  import Select from '../../shared/ui/Select.svelte'
  import type { PublicProviderAccount, RoleBinding } from '../fetcher-schemas-llm-providers.js'

  interface Props {
    roleName: string
    providers: PublicProviderAccount[]
    binding: RoleBinding
    canInherit: boolean
    inheritLabel?: string
    onChange: (binding: RoleBinding) => void
    testid: string
  }

  let {
    roleName,
    providers,
    binding,
    canInherit,
    inheritLabel = 'Inherit main',
    onChange,
    testid,
  }: Props = $props()

  const isInherit = $derived(canInherit && binding === null)

  const providerOptions = $derived(
    providers.map((p) => ({ value: p.id, label: p.label })),
  )

  const selectedProvider = $derived(
    binding !== null
      ? providers.find((p) => p.id === binding.providerId) ?? null
      : null,
  )

  const modelOptions = $derived(
    selectedProvider !== null
      ? selectedProvider.verification.models.map((m) => ({ value: m }))
      : [],
  )

  function onInheritToggle(): void {
    if (isInherit) {
      onChange(providers.length > 0 ? { providerId: providers[0]!.id, model: '' } : { providerId: '', model: '' })
    } else {
      onChange(null)
    }
  }

  function onProviderChange(providerId: string): void {
    onChange({ providerId, model: '' })
  }

  function onModelInput(model: string): void {
    if (binding === null) return
    onChange({ ...binding, model })
  }
</script>

<div class="role-binding" data-testid={testid}>
  <div class="role-binding__head">
    <span class="role-binding__name">{roleName}</span>
    {#if canInherit}
      <label class="role-binding__inherit">
        <input type="checkbox" checked={isInherit} onchange={onInheritToggle} data-testid={`${testid}-inherit`} />
        {inheritLabel}
      </label>
    {/if}
  </div>
  {#if !isInherit}
    <div class="role-binding__controls">
      <Select
        value={binding?.providerId ?? ''}
        options={providerOptions}
        onChange={onProviderChange}
        placeholder="Select provider"
        testid={`${testid}-provider`} />
      <Combobox
        value={binding?.model ?? ''}
        options={modelOptions}
        onInput={onModelInput}
        placeholder="Enter or select model"
        testid={`${testid}-model`} />
    </div>
  {/if}
</div>

<style>
  .role-binding { display: grid; gap: 6px; padding: 8px 0; }
  .role-binding__head { display: flex; align-items: center; justify-content: space-between; }
  .role-binding__name { font-family: var(--font-mono); font-size: 12px; text-transform: capitalize; color: var(--fg2); }
  .role-binding__inherit { display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--fg3); cursor: pointer; }
  .role-binding__controls { display: flex; gap: 8px; flex-wrap: wrap; }
</style>
```

- [ ] **Step 2: Verify typecheck**

Run: `bun run typecheck 2>&1 | grep RoleBindingBlock`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add client/settings/components/RoleBindingBlock.svelte
git commit -m "feat(client): RoleBindingBlock reusable component"
```

---

## Task 9: Admin Providers section

**Goal:** Admin section that lists providers, supports add/edit/delete, and per-row "Refresh models".

**Files:**

- Create: `client/settings/sections/admin/AdminProvidersSection.svelte`
- Create: `client/settings/sections/admin/AdminProvidersSection.stories.svelte`
- Test: Create `tests/client/settings/admin-providers-section.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/client/settings/admin-providers-section.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { flushSync, mount, unmount } from 'svelte'

import AdminProvidersSection from '../../../client/settings/sections/admin/AdminProvidersSection.svelte'
import { setCsrfToken } from '../../../client/settings/fetchers.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const populatedPayload = {
  providers: [
    {
      id: 'prov_1',
      label: 'OpenAI',
      providerType: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKeyMasked: '****abcd',
      verification: {
        status: 'verified',
        error: null,
        at: 1717000000000,
        models: ['gpt-4o'],
        modelsFetchedAt: 1717000000000,
      },
    },
  ],
}

let target: HTMLElement

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(() => {
  unmount(target)
  target.remove()
  restoreFetch()
  setCsrfToken('')
})

describe('AdminProvidersSection', () => {
  test('renders the provider list', async () => {
    setMockFetch(() => Promise.resolve(json(populatedPayload)))
    mount(AdminProvidersSection, { target })
    await drain()

    expect(document.body.textContent).toContain('OpenAI')
    expect(document.body.textContent).toContain('****abcd')
  })

  test('shows add-provider form on button click', async () => {
    setMockFetch(() => Promise.resolve(json(populatedPayload)))
    mount(AdminProvidersSection, { target })
    await drain()

    const addBtn = document.querySelector('[data-testid="admin-providers-add"]') as HTMLButtonElement
    addBtn.click()
    await drain()

    expect(document.querySelector('[data-testid="provider-form-type"]')).not.toBeNull()
  })

  test('shows empty state when no providers', async () => {
    setMockFetch(() => Promise.resolve(json({ providers: [] })))
    mount(AdminProvidersSection, { target })
    await drain()

    expect(document.body.textContent).toContain('No providers')
  })

  test('renders error state', async () => {
    setMockFetch(() => Promise.resolve(json({ error: 'boom' }, 500)))
    mount(AdminProvidersSection, { target })
    await drain()

    expect(document.body.textContent).toContain('boom')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/client/settings/admin-providers-section.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Create the section component**

Create `client/settings/sections/admin/AdminProvidersSection.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { untrack } from 'svelte'

  import Btn from '../../../shared/ui/Btn.svelte'
  import ErrorState from '../../../shared/ui/ErrorState.svelte'
  import IconButton from '../../../shared/ui/IconButton.svelte'
  import PageHeader from '../../../shared/ui/PageHeader.svelte'
  import Confirm from '../../../shared/Confirm.svelte'
  import ProviderForm from '../../components/ProviderForm.svelte'
  import VerificationPill from '../../components/VerificationPill.svelte'
  import {
    createAdminProvider,
    deleteAdminProvider,
    fetchAdminProviders,
    updateAdminProvider,
  } from '../../admin-fetchers.js'
  import type { PublicProviderAccount } from '../../fetcher-schemas-llm-providers.js'

  let providers: PublicProviderAccount[] = $state([])
  let error: string | null = $state(null)
  let loading = $state(false)
  let showAddForm = $state(false)
  let saving = $state(false)
  let deleteTarget: PublicProviderAccount | null = $state(null)
  let deleteError: string | null = $state(null)

  async function load(): Promise<void> {
    error = null
    loading = true
    try {
      const res = await fetchAdminProviders()
      providers = res.providers
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function onAdd(input: { label: string; providerType: string; baseUrl: string; apiKey: string }): Promise<boolean> {
    saving = true
    try {
      await createAdminProvider(input as never)
      showAddForm = false
      await load()
      return true
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      return false
    } finally {
      saving = false
    }
  }

  async function onDelete(): Promise<void> {
    if (deleteTarget === null) return
    deleteError = null
    try {
      await deleteAdminProvider(deleteTarget.id)
      deleteTarget = null
      await load()
    } catch (err) {
      deleteError = err instanceof Error ? err.message : String(err)
    }
  }

  $effect(() => { untrack(() => { void load() }) })
</script>

<section id="llm-providers" class="settings-section">
  <PageHeader eyebrow="Admin" title="LLM Providers">
    {#snippet action()}
      <Btn variant="primary" size="sm" testid="admin-providers-add" disabled={loading} onClick={() => (showAddForm = true)}>
        {#snippet children()}Add provider{/snippet}
      </Btn>
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load()} testid="admin-providers-refresh" />
    {/snippet}
  </PageHeader>

  {#if error !== null}<p class="status-error" role="alert">{error}</p>{/if}

  {#if loading && providers.length === 0}
    <p class="placeholder">Loading…</p>
  {:else if error !== null && providers.length === 0}
    <ErrorState message={error} onRetry={() => void load()} />
  {:else if showAddForm}
    <ProviderForm onSave={onAdd} onCancel={() => (showAddForm = false)} busy={saving} testidPrefix="provider-form" />
  {:else if providers.length === 0}
    <p class="placeholder">No providers configured. Click "Add provider" to create one.</p>
  {:else}
    <table class="providers-table">
      <thead>
        <tr><th>Label</th><th>Type</th><th>Base URL</th><th>API Key</th><th>Status</th><th>Models</th><th></th></tr>
      </thead>
      <tbody>
        {#each providers as p (p.id)}
          <tr data-testid={`provider-row-${p.id}`}>
            <td>{p.label}</td>
            <td>{p.providerType}</td>
            <td class="mono">{p.baseUrl}</td>
            <td class="mono">{p.apiKeyMasked}</td>
            <td><VerificationPill verification={p.verification} /></td>
            <td>{p.verification.models.length}</td>
            <td>
              <Btn variant="danger" size="sm" testid={`provider-delete-${p.id}`} onClick={() => (deleteTarget = p)}>
                {#snippet children()}Delete{/snippet}
              </Btn>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}

  <Confirm
    open={deleteTarget !== null}
    danger
    title={deleteTarget !== null ? `Delete "${deleteTarget.label}"?` : ''}
    confirmLabel="Delete"
    onConfirm={() => void onDelete()}
    onCancel={() => { deleteTarget = null; deleteError = null }}>
    {#snippet body()}
      {#if deleteError !== null}<p class="status-error" role="alert">{deleteError}</p>{/if}
      <p>This will remove the provider. If it is bound to the <code>main</code> role, reassign main first.</p>
    {/snippet}
  </Confirm>
</section>

<style>
  .providers-table { width: 100%; border-collapse: collapse; }
  .providers-table th { text-align: left; font-size: 11px; color: var(--fg3); padding: 4px 8px; border-bottom: 1px solid var(--border); }
  .providers-table td { padding: 6px 8px; border-bottom: 1px solid var(--hair); font-size: 12px; }
  .mono { font-family: var(--font-mono); font-size: 11px; }
</style>
```

Note: The `Confirm` component (`client/shared/Confirm.svelte`) takes `open: boolean` (always rendered, toggled by prop), `body: Snippet` (not `children`), plus `title`, `onConfirm`, `onCancel`, `confirmLabel`, `danger`. See `SystemKvRow.svelte` for a usage example.

- [ ] **Step 4: Create stories**

Create `client/settings/sections/admin/AdminProvidersSection.stories.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import AdminProvidersSection from './AdminProvidersSection.svelte'

  const { Story } = defineMeta({
    title: 'settings/sections/admin/AdminProvidersSection',
    component: AdminProvidersSection,
    parameters: { settingsReady: 'admin' },
  })
</script>

<Story name="Populated" parameters={{ fixtures: 'settings-admin-providers-populated' }} />
<Story name="Empty" parameters={{ fixtures: 'settings-admin-providers-empty' }} />
<Story name="Error" parameters={{ fixtures: 'settings-admin-providers-error' }} />
<Story name="Loading" parameters={{ fixtures: 'settings-admin-providers-loading' }} />
```

- [ ] **Step 5: Run tests**

Run: `bun test tests/client/settings/admin-providers-section.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add client/settings/sections/admin/AdminProvidersSection.svelte \
  client/settings/sections/admin/AdminProvidersSection.stories.svelte \
  tests/client/settings/admin-providers-section.test.ts
git commit -m "feat(client): AdminProvidersSection with list + add + delete"
```

---

## Task 10: Admin Models section

**Goal:** Admin section with three role binding blocks (main required, small/embedding inheritable). Saves via PUT.

**Files:**

- Create: `client/settings/sections/admin/AdminModelsSection.svelte`
- Create: `client/settings/sections/admin/AdminModelsSection.stories.svelte`
- Test: Create `tests/client/settings/admin-models-section.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/client/settings/admin-models-section.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { flushSync, mount, unmount } from 'svelte'

import AdminModelsSection from '../../../client/settings/sections/admin/AdminModelsSection.svelte'
import { setCsrfToken } from '../../../client/settings/fetchers.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const providersPayload = {
  providers: [
    {
      id: 'prov_1',
      label: 'OpenAI',
      providerType: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKeyMasked: '****abcd',
      verification: {
        status: 'verified',
        error: null,
        at: null,
        models: ['gpt-4o', 'gpt-4o-mini'],
        modelsFetchedAt: null,
      },
    },
  ],
}
const rolesPayload = {
  roles: { main: { providerId: 'prov_1', model: 'gpt-4o' }, small: null, embedding: null },
}

let target: HTMLElement

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(() => {
  unmount(target)
  target.remove()
  restoreFetch()
  setCsrfToken('')
})

describe('AdminModelsSection', () => {
  test('renders three role blocks', async () => {
    let callCount = 0
    setMockFetch(() => {
      callCount++
      return Promise.resolve(json(callCount === 1 ? providersPayload : rolesPayload))
    })
    mount(AdminModelsSection, { target })
    await drain()

    expect(document.querySelector('[data-testid="role-main"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="role-small"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="role-embedding"]')).not.toBeNull()
  })

  test('main role block has no inherit checkbox', async () => {
    let callCount = 0
    setMockFetch(() => {
      callCount++
      return Promise.resolve(json(callCount === 1 ? providersPayload : rolesPayload))
    })
    mount(AdminModelsSection, { target })
    await drain()

    expect(document.querySelector('[data-testid="role-main-inherit"]')).toBeNull()
  })

  test('small role shows inherit checkbox checked when null', async () => {
    let callCount = 0
    setMockFetch(() => {
      callCount++
      return Promise.resolve(json(callCount === 1 ? providersPayload : rolesPayload))
    })
    mount(AdminModelsSection, { target })
    await drain()

    const checkbox = document.querySelector('[data-testid="role-small-inherit"]') as HTMLInputElement
    expect(checkbox).not.toBeNull()
    expect(checkbox.checked).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/client/settings/admin-models-section.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Create the section component**

Create `client/settings/sections/admin/AdminModelsSection.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { untrack } from 'svelte'

  import Btn from '../../../shared/ui/Btn.svelte'
  import ErrorState from '../../../shared/ui/ErrorState.svelte'
  import IconButton from '../../../shared/ui/IconButton.svelte'
  import PageHeader from '../../../shared/ui/PageHeader.svelte'
  import RoleBindingBlock from '../../components/RoleBindingBlock.svelte'
  import { fetchAdminLlmRoles, fetchAdminProviders, putAdminLlmRoles } from '../../admin-fetchers.js'
  import type { PublicProviderAccount, RoleBinding, LlmRoleBindings } from '../../fetcher-schemas-llm-providers.js'

  let providers: PublicProviderAccount[] = $state([])
  let roles: LlmRoleBindings | null = $state(null)
  let draft: LlmRoleBindings = $state({ main: { providerId: '', model: '' }, small: null, embedding: null })
  let error: string | null = $state(null)
  let loading = $state(false)
  let saving = $state(false)
  let status: string | null = $state(null)

  async function load(): Promise<void> {
    error = null; status = null; loading = true
    try {
      const [provRes, rolesRes] = await Promise.all([fetchAdminProviders(), fetchAdminLlmRoles()])
      providers = provRes.providers
      roles = rolesRes.roles
      draft = JSON.parse(JSON.stringify(roles)) as LlmRoleBindings
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  const isDirty = $derived(
    roles !== null &&
    JSON.stringify(draft) !== JSON.stringify(roles),
  )

  function onRoleChange(role: 'main' | 'small' | 'embedding', binding: RoleBinding): void {
    if (role === 'main' && binding !== null) {
      draft = { ...draft, main: binding }
    } else if (role !== 'main') {
      draft = { ...draft, [role]: binding }
    }
  }

  async function save(): Promise<void> {
    if (!isDirty || saving) return
    saving = true; error = null; status = null
    try {
      await putAdminLlmRoles(draft)
      roles = JSON.parse(JSON.stringify(draft)) as LlmRoleBindings
      status = 'Role bindings saved.'
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      saving = false
    }
  }

  $effect(() => { untrack(() => { void load() }) })
</script>

<section id="llm-models" class="settings-section">
  <PageHeader eyebrow="Admin" title="LLM Models">
    {#snippet action()}
      <Btn variant="primary" size="sm" testid="admin-models-save" disabled={!isDirty || saving} onClick={() => void save()}>
        {#snippet children()}{saving ? 'Saving…' : 'Save'}{/snippet}
      </Btn>
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load()} testid="admin-models-refresh" />
    {/snippet}
  </PageHeader>

  {#if error !== null}<p class="status-error" role="alert">{error}</p>{/if}
  {#if status !== null}<p class="status-success" role="status">{status}</p>{/if}

  {#if loading && roles === null}
    <p class="placeholder">Loading…</p>
  {:else if error !== null && roles === null}
    <ErrorState message={error} onRetry={() => void load()} />
  {:else}
    <RoleBindingBlock roleName="main" {providers} binding={draft.main} canInherit={false} onChange={(b) => onRoleChange('main', b)} testid="role-main" />
    <RoleBindingBlock roleName="small" {providers} binding={draft.small} canInherit={true} onChange={(b) => onRoleChange('small', b)} testid="role-small" />
    <RoleBindingBlock roleName="embedding" {providers} binding={draft.embedding} canInherit={true} onChange={(b) => onRoleChange('embedding', b)} testid="role-embedding" />
  {/if}
</section>
```

Note: Use `JSON.parse(JSON.stringify(...))` for deep-cloning `$state` objects in Svelte 5 (avoids proxy cloning issues).

- [ ] **Step 4: Create stories**

Create `client/settings/sections/admin/AdminModelsSection.stories.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import AdminModelsSection from './AdminModelsSection.svelte'

  const { Story } = defineMeta({
    title: 'settings/sections/admin/AdminModelsSection',
    component: AdminModelsSection,
    parameters: { settingsReady: 'admin' },
  })
</script>

<Story name="Populated" parameters={{ fixtures: 'settings-admin-llm-roles-populated' }} />
<Story name="Empty" parameters={{ fixtures: 'settings-admin-llm-roles-empty' }} />
<Story name="Error" parameters={{ fixtures: 'settings-admin-llm-roles-error' }} />
<Story name="Loading" parameters={{ fixtures: 'settings-admin-llm-roles-loading' }} />
```

Note: the `settings-admin-llm-roles-*` scenarios only mock the roles endpoint. For the section to fully render in stories, the scenarios must also include the providers handlers. Update the scenario entries to spread both:
`'settings-admin-llm-roles-populated': [...adminLlmRolesHandlers.populated, ...adminProvidersHandlers.populated]`.

- [ ] **Step 5: Run tests**

Run: `bun test tests/client/settings/admin-models-section.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add client/settings/sections/admin/AdminModelsSection.svelte \
  client/settings/sections/admin/AdminModelsSection.stories.svelte \
  tests/client/settings/admin-models-section.test.ts \
  client/stories/msw/scenarios.ts
git commit -m "feat(client): AdminModelsSection with role binding blocks"
```

---

## Task 11: Generalized ByokSection

**Goal:** Rewrite the personal BYOK section to show the multi-provider UI: the enable/disable toggle, a provider list (add/edit/delete), and role overrides with "Inherit admin".

**Files:**

- Modify: `client/settings/sections/ByokSection.svelte`
- Modify: `client/settings/sections/ByokSection.stories.svelte`

- [ ] **Step 1: Rewrite ByokSection.svelte**

Replace the entire file. The new structure:

- Keeps the `$effect` auto-load + `loadedContextId` race-guard pattern
- Keeps the "Use my own credentials" toggle
- Replaces the flat field list with:
  - A provider list table (label, type, masked key, verification pill, delete button)
  - An "Add provider" button → `ProviderForm`
  - Three `RoleBindingBlock`s with `canInherit={true}` and `inheritLabel="Inherit admin"`
- Save flow: add/delete providers via action fetchers; role overrides via `setByokRolesAction`; reload after each mutation
- The `currentData.providers` and `currentData.roles` come from the extended BYOK GET response

Key state variables:

```typescript
let data: ByokResponse | null = $state(null)
let loadedContextId: string | null = $state(null)
let error: string | null = $state(null)
let status: string | null = $state(null)
let loading = $state(false)
let toggling = $state(false)
let saving = $state(false)
let showAddForm = $state(false)
let showAddRoles = $state(false) // whether to show the role override area
let draftRoles: LlmRoleBindings | null = $state(null)
```

The `currentData = $derived(loadedContextId === contextId ? data : null)` pattern stays.

Provider add flow:

```typescript
async function onAddProvider(input: ProviderInput): Promise<boolean> {
  // Generate a provider ID client-side (nanoid or crypto.randomUUID)
  const provider = {
    id: `prov_${crypto.randomUUID().slice(0, 12)}`,
    label: input.label,
    providerType: input.providerType,
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    verification: { status: 'unverified' as const, error: null, at: null, models: [], modelsFetchedAt: null },
  }
  await upsertByokProviderAction({ contextId, provider })
  await load(contextId)
  showAddForm = false
  return true
}
```

Provider delete flow:

```typescript
async function onDeleteProvider(id: string): Promise<void> {
  await deleteByokProviderAction({ contextId, id })
  await load(contextId)
}
```

Role save flow:

```typescript
async function onSaveRoles(): Promise<void> {
  if (draftRoles === null) return
  await setByokRolesAction({ contextId, roles: draftRoles })
  await load(contextId)
  status = 'Role overrides saved.'
}
```

The template renders:

1. `PageHeader` with toggle button (unchanged from current)
2. When disabled: the "Using the central LLM credentials" placeholder
3. When enabled + unreadable: the error message
4. When enabled + readable:
   - Provider list table with delete buttons
   - "Add provider" button → ProviderForm
   - Role binding blocks with draft roles + Save button

Keep the existing `section id="byok"` so the nav anchor doesn't break.

- [ ] **Step 2: Update stories**

Update `client/settings/sections/ByokSection.stories.svelte` to use the extended BYOK handler scenarios. The story scenarios (`settings-byok-secret-set`, etc.) now return v2 providers + roles. The stories should still render the section with `args: { contextId: CONTEXT_ID }`.

- [ ] **Step 3: Run existing BYOK fetcher tests**

Run: `bun test tests/client/settings/byok-fetchers.test.ts tests/client/settings/byok-fetcher-schemas.test.ts`
Expected: PASS (schemas/fetchers already extended in Tasks 2+4)

- [ ] **Step 4: Run typecheck**

Run: `bun run typecheck 2>&1 | grep ByokSection`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/ByokSection.svelte client/settings/sections/ByokSection.stories.svelte
git commit -m "feat(client): generalized ByokSection with multi-provider UI"
```

---

## Task 12: SettingsApp navigation + retire AdminSystemSection

**Goal:** Wire the new sections into SettingsApp navigation, remove the dead AdminSystemSection.

**Files:**

- Modify: `client/settings/SettingsApp.svelte`
- Modify: `client/settings/fetcher-schemas-admin.ts` (remove dead schemas)
- Delete: `client/settings/sections/admin/AdminSystemSection.svelte`
- Delete: `client/settings/sections/admin/AdminSystemSection.stories.svelte`
- Modify: `client/stories/msw/scenarios.ts` (remove dead system scenarios if not already done)

- [ ] **Step 1: Update SettingsApp.svelte**

1. Replace the `AdminSystemSection` import with:

```typescript
import AdminProvidersSection from './sections/admin/AdminProvidersSection.svelte'
import AdminModelsSection from './sections/admin/AdminModelsSection.svelte'
```

2. In `buildAdminSidebarItems`, replace `{ id: 'system', label: 'System' }` with:

```typescript
{ id: 'llm-providers', label: 'LLM providers' },
{ id: 'llm-models', label: 'LLM models' },
```

3. In the admin zone template, replace `<AdminSystemSection />` with:

```svelte
<AdminProvidersSection />
<AdminModelsSection />
```

- [ ] **Step 2: Delete AdminSystemSection files**

```bash
rm client/settings/sections/admin/AdminSystemSection.svelte
rm client/settings/sections/admin/AdminSystemSection.stories.svelte
```

- [ ] **Step 3: Remove dead admin system schemas**

In `client/settings/fetcher-schemas-admin.ts`, remove:

```typescript
export const AdminLlmKeyStateSchema = ...
export const AdminSystemResponseSchema = ...
export type AdminSystemResponse = ...
```

In `client/shared/api-types.ts`, remove the dead `AdminLlmKeyState` and `AdminLlmSnapshot` types.

- [ ] **Step 4: Remove dead system scenarios**

In `client/stories/msw/scenarios.ts`, remove:

```typescript
'settings-admin-system-populated': ...
'settings-admin-system-empty': ...
'settings-admin-system-error': ...
'settings-admin-system-loading': ...
```

And remove `...adminSystemHandlers.populated` from `settings-shell-admin-ready` (already done in Task 5 if the handler was removed there — verify).

- [ ] **Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: clean (no references to AdminSystemSection or admin/system remain)

- [ ] **Step 6: Run lint + knip**

Run: `bun run lint && bun run knip`
Expected: clean (the knip ignore for `client/settings/fetcher-schemas-admin.ts` types already covers new type exports)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(client): wire Providers + Models sections; retire AdminSystemSection"
```

---

## Task 13: Final gate — contract tests + full suite + cleanup

**Goal:** Run the complete verification suite and fix any remaining issues.

- [ ] **Step 1: Run story contract tests**

Run: `bun test:stories:contracts`
Expected: All stories render without errors (new stories included).

- [ ] **Step 2: Run full test suite**

Run: `bun test`
Expected: All pass except the 4 pre-existing environmental failures (debug-smoke, debug-server, warnIfLegacyDebugToken).

- [ ] **Step 3: Run typecheck + lint + format**

Run: `bun run typecheck && bun run lint && bun run format:check`
Expected: clean.

- [ ] **Step 4: Run knip**

Run: `bun run knip`
Expected: clean. If `PROVIDER_TYPE_BASE_URLS` or `LlmRole` in `src/llm-providers/types.ts` are now consumed by the client, remove the corresponding knip ignore entry.

- [ ] **Step 5: Fix any issues found**

Address any failures. Common issues:

- Missing MSW scenario for a story → add to `scenarios.ts`
- Knip unused export → add ignore or remove the export
- Schema mismatch → adjust Zod schema to match server response
- Svelte 5 reactivity issue → check `$derived` dependencies

- [ ] **Step 6: Final commit (if fixes were needed)**

```bash
git add -A
git commit -m "fix(client): story contracts + knip cleanup for multi-provider UI"
```

---

## Self-Review Checklist

After completing all tasks, verify against the spec (§6):

**§6.1A Admin → Providers:** Task 9 (list, add, delete, verification pill, model count). Edit provider: deferred — the ProviderForm supports it but the section only wires add + delete. Refresh models: deferred — the fetcher exists but the button is not wired. Add these as follow-up if needed.

**§6.1B Admin → Models:** Task 10 (three role blocks, main required, small/embedding inheritable, provider switch clears model via RoleBindingBlock).

**§6.2 Personal BYOK:** Task 11 (toggle, provider list with add/delete, role overrides with "Inherit admin").

**§6.3 Routes:** Already implemented in Plan A. Client fetchers in Tasks 3+4.

**§6.4 Client wiring:** Fetchers (Tasks 3+4), Zod schemas (Task 2), MSW handlers (Task 5), stories (Tasks 9+10), ByokSection evolved in place (Task 11), AdminSystemSection retired (Task 12).

**§9 Testing — Client:** Stories + contract tests (Task 13). MSW handlers + scenarios updated (Task 5).
