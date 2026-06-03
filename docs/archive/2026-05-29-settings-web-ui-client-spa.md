<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Settings Web UI — Client SPA (Part B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `client/settings/` single-page app — a Svelte 5 SPA that lets an authenticated chat user manage their personal/group settings (and, for bot admins, the admin surface) through the already-implemented `/settings/api/*` HTTP routes.

**Architecture:** The SPA mirrors the existing `client/admin/` app: a Bun-bundled IIFE served as static assets, a reactive `$state` session store seeded from `GET /settings/api/bootstrap` (or `POST /settings/auth/exchange` when arriving with a `?code=`), a hash-navigated shell with a context switcher and a role-gated sidebar, and section components that each re-fetch when the active `contextId` changes. All writes attach the in-memory CSRF token via the `X-Settings-CSRF` header and `credentials: 'include'`. The server's `/settings/*` HTTP surface (Part A) already exists; this plan adds only the client and the static-serving wiring.

**Tech Stack:** Svelte 5 (runes: `$state`/`$derived`/`$props`/`$effect`), Bun bundler (`scripts/build-client.ts` + `scripts/svelte-plugin.ts`), Zod v4 for response validation, `bun test:client` (happy-dom) for component tests.

---

## Background: what already exists (do not rebuild)

Part A (the HTTP API) is implemented and tested. The SPA consumes these routes:

**Auth/bootstrap (owned by `src/debug/settings-router.ts`):**

- `POST /settings/auth/exchange` — body `{ code }` → `200 { csrfToken, display, principal: { isBotAdmin, isSuperAdmin }, contexts: [{ kind, contextId, label }] }` + `Set-Cookie`. `401 { error }` on bad/expired code.
- `GET /settings/api/bootstrap` — cookie auth → same body shape as exchange (minus Set-Cookie). `401` when no/invalid session.
- `POST /settings/auth/logout` — cookie + CSRF → clears session.

**User-tier data routes (`/settings/api/*`), all accept `contextId` (query for GET, body for writes):**

- `GET /settings/api/config?contextId=` → `{ contextId, fields: [{ key, storageKey, label, required, sensitive, kind, hasValue, value }] }`; `PATCH /settings/api/config` body `{ key, value, contextId? }` → `{ ok, contextId, unchanged? }`.
- `GET /settings/api/tools?contextId=` → `{ contextId, domains: [{ domain, status: 'on'|'off'|'partial', tools: [{ name, enabled, risk }] }] }`; `POST /settings/api/tools/toggle` body `{ kind: 'domain'|'tool', domain?, tool?, contextId? }` → same `{ contextId, domains }` shape.
- `GET /settings/api/mcp?contextId=` → `{ contextId, endpoints: [{ id, url, label?, headers?, enabled, toolFilter? }] }` (header values masked); `PUT /settings/api/mcp` body `{ endpoints: [...], contextId? }` → `{ ok, contextId }`.
- `GET /settings/api/plugins?contextId=` → `{ contextId, plugins: [{ id, name, active, enabled, eligibility, contextConfig: [{ key, label, required, sensitive, hasValue }] }] }`; `POST /settings/api/plugins/toggle` body `{ pluginId, enabled, contextId? }` → `{ ok, contextId }` or `422 { error, missingKeys? }`; `PATCH /settings/api/plugins/config` body `{ pluginId, key, value, contextId? }` → `{ ok, contextId, unchanged? }`.
- `GET /settings/api/identity?contextId=` → `{ contextId, providerName, mapping: { providerUserId, providerUserLogin, displayName, matchMethod, confidence } }`; `PUT /settings/api/identity` body `{ providerUserId, providerUserLogin?, displayName?, contextId? }` → `{ ok, contextId }`; `DELETE /settings/api/identity?contextId=` → `{ ok, contextId }`.
- `POST /settings/api/provision/kaneo` body `{ contextId? }` → `200 { status: 'provisioned', contextId, email, password, kaneoUrl, workspaceId }` or `422 { status, error }`.

**Group-tier routes (require a managed-group `contextId`):**

- `GET /settings/api/group/members?contextId=` → `{ contextId, members: [{ user_id, added_by, added_at }] }`; `POST`/`DELETE /settings/api/group/members` body `{ userId, contextId }` → `{ ok, contextId }`.
- `GET /settings/api/group/task-instance?contextId=` → `{ contextId, taskInstanceId, available: [{ id, type, status }] }`; `PATCH` body `{ taskInstanceId, contextId }` → `{ ok, contextId }`.

**Bot-admin-tier routes (`/settings/api/admin/*`):**

- Platform instances: `GET/POST /settings/api/admin/platform-instances`, `PATCH/DELETE /settings/api/admin/platform-instances/:id` → `{ instances: [...] }` / `{ ok, id }`.
- Task instances: `GET/POST /settings/api/admin/task-instances`, `PATCH/DELETE /settings/api/admin/task-instances/:id`.
- Provider types: `GET /settings/api/admin/platform-provider-types`, `GET /settings/api/admin/task-provider-types` → `{ providerTypes: [...] }`.
- System config: `GET /settings/api/admin/system` → `{ config: <AdminLlmSnapshot> }`; `POST` body `{ key, value }` → `{ ok, key }`.
- Users: `GET/POST/DELETE /settings/api/admin/users` → `{ users: [...] }` / `{ ok }`.
- Groups: `GET/POST/DELETE /settings/api/admin/groups` → `{ groups: [...] }` / `{ ok }`.
- Admins (SA-gated writes): `GET/POST/DELETE /settings/api/admin/admins` → `{ admins: [...] }` / `{ ok }`.
- Plugin approval (SA-gated): `POST /settings/api/admin/plugin-approval` body `{ pluginId, action: 'approve'|'reject' }` → `{ ok, state }`.
- Announce: `POST /settings/api/admin/announce` body `{ message }` → `{ totalUsers, successCount, failCount }`.

**Error contract:** 401 = unauthenticated (the SPA shows "request a new link"); 403 = forbidden (out of scope); 422 = validation failure with `{ error }` message.

---

## File Structure

All new client files live under `client/settings/`. Every `.ts`/`.svelte` file under `client/` is TDD-hook-gated and **must** have a matching test under `tests/client/settings/` (the `client/` tree mirrors to `tests/client/`). `.html`/`.css` files are not gated.

```text
client/settings/
  settings.html                     # SPA shell (CSP default-src 'self'), <div id="app">           [not gated]
  settings.css                      # local layout styles (grid, sidebar, sections)                [not gated]
  fetcher-schemas.ts                # Zod schemas + inferred types for every response               [Task 3]
  fetchers.ts                       # settingsFetch (CSRF + credentials + 401 hook) + typed fetchers [Task 4]
  session.svelte.ts                 # reactive $state session store + bootstrap/context helpers      [Task 5]
  scrollspy.ts                      # IntersectionObserver scroll-spy (copy of admin pattern)        [Task 6]
  components/
    SettingsTopBar.svelte           # brand + context switcher + sign out                           [Task 7]
    SettingsSidebar.svelte          # role-gated section nav                                         [Task 8]
    ConfigFieldRow.svelte           # one config field: masked/plain value + edit/replace + save     [Task 9]
  sections/
    ProfileSection.svelte           # preference config fields (timezone, …)                         [Task 10]
    TaskProviderSection.svelte      # provider-context creds + Kaneo provision                       [Task 11]
    ToolsSection.svelte             # domain → per-tool toggles with risk indicators                 [Task 12]
    McpSection.svelte               # structured MCP endpoint rows                                   [Task 13]
    PluginsSection.svelte           # per-context enable + per-context config                        [Task 14]
    IdentitySection.svelte          # manual provider identity mapping                               [Task 15]
    MembersSection.svelte           # group members (group context only)                             [Task 16]
    GroupProviderSection.svelte     # group → task-instance selection (group context only)           [Task 17]
    admin/
      AdminInstancesSection.svelte  # platform + task instances CRUD                                 [Task 18]
      AdminSystemSection.svelte     # LLM/system config                                              [Task 19]
      AdminUsersSection.svelte      # authorized users                                               [Task 20]
      AdminGroupsSection.svelte     # authorized groups                                              [Task 21]
      AdminAdminsSection.svelte     # admin roster (SA only)                                          [Task 22]
      AdminPluginsApprovalSection.svelte # plugin approve/reject (SA only)                           [Task 23]
      AdminAnnounceSection.svelte   # broadcast announce                                             [Task 24]
  SettingsApp.svelte                # root: shell + switcher + sidebar + sections + scrollspy gating [Task 25]
  index.ts                          # mount entry: read code, bootstrap, strip code, mount           [Task 26]
```

Files modified outside `client/settings/`:

- `scripts/build-client.ts` — add a third `BUNDLES` entry. [Task 1, not gated]
- `scripts/check-bundle-isolation.ts` — add `public/settings.js` to `BUNDLES`. [Task 1, not gated]
- `src/debug/server.ts` — extend `handleClientFile` to serve the settings bundle publicly. [Task 2, gated]

**Reuse, do not duplicate:** all visual primitives come from `client/shared/ui/*` (`Shell`, `TopBar`, `Btn`, `Input`, `Select`, `Seg`, `Pill`, `Caption`, `KV`, `HR`, `Panel`) and helpers from `client/shared/fetcher-helpers.ts` (`readBody`, `requireOk`). Config-backed sections (Profile, Task provider) share `ConfigFieldRow`.

---

## Phasing

Execute in order; each phase yields working, testable software.

1. **Phase 1 — Build & serving (Tasks 1–2):** the bundle is built, isolation-guarded, and served.
2. **Phase 2 — Data layer (Tasks 3–5):** schemas, fetchers, session store.
3. **Phase 3 — Shared UI (Tasks 6–9):** scroll-spy, top bar, sidebar, config-field row.
4. **Phase 4 — User-tier sections (Tasks 10–15).**
5. **Phase 5 — Group-tier sections (Tasks 16–17).**
6. **Phase 6 — Admin-tier sections (Tasks 18–24).**
7. **Phase 7 — App composition & entry (Tasks 25–26).**

---

# Phase 1 — Build & serving

### Task 1: Add the settings bundle to the build pipeline + isolation guard

**Files:**

- Create: `client/settings/settings.html`
- Create: `client/settings/settings.css`
- Create: `client/settings/index.ts` (temporary minimal stub so the bundle has an entrypoint; replaced in Task 26)
- Create: `tests/client/settings/index.test.ts` (stub test; replaced in Task 26)
- Modify: `scripts/build-client.ts:24-43` (the `BUNDLES` array)
- Modify: `scripts/check-bundle-isolation.ts:21` (the `BUNDLES` array)

- [ ] **Step 1: Create the SPA shell HTML**

`client/settings/settings.html` (mirror `client/admin/admin.html`; strict CSP):

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'" />
    <title>papai settings</title>
    <link rel="stylesheet" href="/settings.css" />
  </head>
  <body>
    <div id="app"></div>
    <script src="/settings.js" defer></script>
  </body>
</html>
```

- [ ] **Step 2: Create the local CSS**

`client/settings/settings.css` (mirror `client/admin/admin.css` layout classes; the design tokens and `base.css` are prepended by the bundler):

```css
/* SPDX-License-Identifier: BUSL-1.1 */
/* Copyright (c) 2026 Dmitriy Lazarev */
/* Use of this software is governed by the Business Source License 1.1. */
/* See LICENSE in the project root for details. */

.eyebrow {
  margin-bottom: 4px;
  color: var(--fg3);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.settings-grid {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 0;
  min-height: 0;
}

.settings-grid__main {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 24px;
  min-width: 0;
}

.settings-section {
  padding: 20px;
  scroll-margin-top: 96px;
  color: var(--fg);
}

.settings-section-header {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 16px;
}

.settings-form {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: end;
  margin-bottom: 16px;
}

.settings-form label {
  display: grid;
  gap: 6px;
  min-width: 180px;
}

.settings-form input,
.settings-form select,
.settings-form button,
.settings-section-header button {
  padding: 10px 12px;
  border: 1px solid var(--strong);
  border-radius: 2px;
  background: var(--bg);
  color: var(--fg);
}

.settings-table-wrap {
  overflow-x: auto;
}

.settings-table {
  width: 100%;
  border-collapse: collapse;
}

.settings-table th,
.settings-table td {
  padding: 10px 12px;
  border-top: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
}

.status-error {
  color: var(--danger);
}

.status-success {
  color: var(--success);
}

.placeholder {
  color: var(--fg2);
}

.masked-value {
  background: var(--inset);
  border: 1px solid var(--hair);
  padding: 4px 10px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--fg3);
  letter-spacing: 0.04em;
}

.settings-gate {
  font-family: var(--font-mono);
  max-width: 540px;
  margin: 4rem auto;
  padding: 1rem;
  line-height: 1.5;
  color: var(--fg);
}

@media (max-width: 720px) {
  .settings-grid {
    grid-template-columns: 1fr;
  }
  .settings-section-header {
    flex-direction: column;
    align-items: stretch;
  }
}
```

- [ ] **Step 3: Create a temporary entry stub (replaced in Task 26)**

`client/settings/index.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/// <reference lib="dom" />

export const SETTINGS_ENTRY_PLACEHOLDER = true
```

- [ ] **Step 4: Create a temporary stub test (replaced in Task 26)**

`tests/client/settings/index.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { SETTINGS_ENTRY_PLACEHOLDER } from '../../../client/settings/index.js'

describe('settings entry (stub)', () => {
  test('module loads', () => {
    expect(SETTINGS_ENTRY_PLACEHOLDER).toBe(true)
  })
})
```

- [ ] **Step 5: Add the bundle config**

In `scripts/build-client.ts`, append a third entry to the `BUNDLES` array (after the `admin` entry, before the closing `]`):

```ts
  {
    entry: 'client/settings/index.ts',
    htmlSrc: 'client/settings/settings.html',
    jsName: 'settings.js',
    htmlName: 'settings.html',
    cssName: 'settings.css',
    baseCssPath: 'client/shared/base.css',
    localCssPath: 'client/settings/settings.css',
  },
```

- [ ] **Step 6: Add the bundle to the isolation guard**

In `scripts/check-bundle-isolation.ts:21`, change:

```ts
const BUNDLES = ['public/debug.js', 'public/admin.js'] as const
```

to:

```ts
const BUNDLES = ['public/debug.js', 'public/admin.js', 'public/settings.js'] as const
```

- [ ] **Step 7: Build and verify the bundle + isolation guard**

Run: `bun build:client`
Expected: console prints `Bundle complete: settings.js -> .../public` and `public/settings.js`, `public/settings.html`, `public/settings.css` exist.

Run: `bun check:bundle-isolation`
Expected: exits 0 (no harness leakage in any of the three bundles).

- [ ] **Step 8: Run the stub test**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/index.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add client/settings/settings.html client/settings/settings.css client/settings/index.ts tests/client/settings/index.test.ts scripts/build-client.ts scripts/check-bundle-isolation.ts
git commit -m "build(settings): add client/settings bundle entry and isolation guard"
```

---

### Task 2: Serve the settings bundle as public static assets

The server must serve `/settings`, `/settings.js`, and `/settings.css` **without** a `DEBUG_TOKEN` (the shell is public; the data behind it is session-gated by Part A). `/settings` matches `isSettingsPath` and is otherwise 404'd by `routeSettingsPaths`; `/settings.js` and `/settings.css` do not match `isSettingsPath` and would currently fall through to the `DEBUG_TOKEN` gate. Add a single public static branch at the top of `routeRequest`, before the `isSettingsPath` check.

**Files:**

- Modify: `src/debug/server.ts:109-122` (`handleClientFile`), `src/debug/server.ts:189-194` (`routeRequest` top)
- Test: `tests/debug/server-settings-static.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/debug/server-settings-static.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { routeSettingsStatic } from '../../src/debug/server.js'

describe('routeSettingsStatic', () => {
  test('serves the settings shell for /settings', () => {
    const res = routeSettingsStatic('/settings')
    expect(res).not.toBeNull()
    expect(res!.status).toBe(200)
  })

  test('serves the settings JS bundle with a JS content type', () => {
    const res = routeSettingsStatic('/settings.js')
    expect(res).not.toBeNull()
    expect(res!.headers.get('Content-Type')).toContain('javascript')
  })

  test('serves the settings CSS bundle', () => {
    const res = routeSettingsStatic('/settings.css')
    expect(res).not.toBeNull()
    expect(res!.status).toBe(200)
  })

  test('returns null for non-static settings paths', () => {
    expect(routeSettingsStatic('/settings/api/bootstrap')).toBeNull()
    expect(routeSettingsStatic('/settings/auth/exchange')).toBeNull()
    expect(routeSettingsStatic('/debug')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/debug/server-settings-static.test.ts`
Expected: FAIL — `routeSettingsStatic` is not exported from `src/debug/server.ts`.

- [ ] **Step 3: Extend `handleClientFile` to know the settings prefix**

In `src/debug/server.ts`, change the `handleClientFile` signature (line ~109) to accept `'settings'`:

```ts
function handleClientFile(prefix: 'debug' | 'admin' | 'settings', pathname: string): Response {
```

The body already works for any prefix (it derives `${prefix}.html` / `${prefix}.js` / `${prefix}.css`), so no further change inside the function.

- [ ] **Step 4: Add the public static router and wire it in**

In `src/debug/server.ts`, add an exported helper just above `routeRequest` (after `handleClientFile`):

```ts
/**
 * Public static serving for the settings SPA shell + assets. These are reachable
 * without DEBUG_TOKEN (the shell is public; the data behind it is settings-session
 * gated). Returns null for every non-static path so callers fall through.
 */
export function routeSettingsStatic(pathname: string): Response | null {
  if (pathname === '/settings' || pathname === '/settings.js' || pathname === '/settings.css') {
    return handleClientFile('settings', pathname)
  }
  return null
}
```

Then, at the very top of `routeRequest` (before the `isSettingsPath` block at line ~192), add:

```ts
const settingsStatic = routeSettingsStatic(url.pathname)
if (settingsStatic !== null) return settingsStatic
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test tests/debug/server-settings-static.test.ts`
Expected: PASS (all four tests).

- [ ] **Step 6: Verify the settings router still 404s its non-owned subpaths**

Run: `bun test tests/debug/settings-router.test.ts`
Expected: PASS (unchanged — `routeSettingsStatic` short-circuits `/settings` before `routeSettingsPaths`, but the router's own unit tests call `routeSettingsPaths` directly and are unaffected).

- [ ] **Step 7: Commit**

```bash
git add src/debug/server.ts tests/debug/server-settings-static.test.ts
git commit -m "feat(settings): serve client/settings bundle as public static assets"
```

---

# Phase 2 — Data layer

### Task 3: Response schemas (`fetcher-schemas.ts`)

Zod schemas validate every server response and export inferred types. User-tier shapes are tight (we know them exactly). Admin-tier list shapes are kept lenient with `.passthrough()` so the SPA renders without overfitting to store internals.

**Files:**

- Create: `client/settings/fetcher-schemas.ts`
- Test: `tests/client/settings/fetcher-schemas.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/client/settings/fetcher-schemas.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  BootstrapSchema,
  ConfigResponseSchema,
  IdentityResponseSchema,
  McpResponseSchema,
  PluginsResponseSchema,
  ToolsResponseSchema,
} from '../../../client/settings/fetcher-schemas.js'

describe('fetcher-schemas', () => {
  test('BootstrapSchema parses a full bootstrap payload', () => {
    const parsed = BootstrapSchema.parse({
      csrfToken: 'tok',
      display: 'alice',
      principal: { isBotAdmin: true, isSuperAdmin: false },
      contexts: [{ kind: 'personal', contextId: 'user:1', label: 'Personal' }],
    })
    expect(parsed.principal.isBotAdmin).toBe(true)
    expect(parsed.contexts).toHaveLength(1)
  })

  test('ConfigResponseSchema parses fields', () => {
    const parsed = ConfigResponseSchema.parse({
      contextId: 'user:1',
      fields: [
        {
          key: 'timezone',
          storageKey: 'timezone',
          label: 'Timezone',
          required: true,
          sensitive: false,
          kind: 'preference',
          hasValue: true,
          value: 'UTC',
        },
      ],
    })
    expect(parsed.fields[0]!.kind).toBe('preference')
  })

  test('ToolsResponseSchema parses domains and tool risk', () => {
    const parsed = ToolsResponseSchema.parse({
      contextId: 'user:1',
      domains: [{ domain: 'task', status: 'partial', tools: [{ name: 'create_task', enabled: true, risk: 'write' }] }],
    })
    expect(parsed.domains[0]!.status).toBe('partial')
    expect(parsed.domains[0]!.tools[0]!.risk).toBe('write')
  })

  test('McpResponseSchema parses endpoints with optional headers', () => {
    const parsed = McpResponseSchema.parse({
      contextId: 'user:1',
      endpoints: [{ id: 'a', url: 'https://x/y', enabled: true, headers: { Authorization: '****' } }],
    })
    expect(parsed.endpoints[0]!.id).toBe('a')
  })

  test('PluginsResponseSchema parses eligibility variants', () => {
    const parsed = PluginsResponseSchema.parse({
      contextId: 'user:1',
      plugins: [
        {
          id: 'p',
          name: 'P',
          active: true,
          enabled: false,
          eligibility: { eligible: false, reason: 'config_missing', missingKeys: ['k'] },
          contextConfig: [],
        },
      ],
    })
    expect(parsed.plugins[0]!.eligibility.eligible).toBe(false)
  })

  test('IdentityResponseSchema accepts null mapping fields', () => {
    const parsed = IdentityResponseSchema.parse({
      contextId: 'user:1',
      providerName: 'kaneo',
      mapping: { providerUserId: null, providerUserLogin: null, displayName: null, matchMethod: null, confidence: 0 },
    })
    expect(parsed.mapping.providerUserId).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/fetcher-schemas.test.ts`
Expected: FAIL — module `fetcher-schemas.js` not found.

- [ ] **Step 3: Write the schemas**

`client/settings/fetcher-schemas.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

// --- Bootstrap / session ---

export const AvailableContextSchema = z.object({
  kind: z.enum(['personal', 'group']),
  contextId: z.string(),
  label: z.string(),
})
export type AvailableContext = z.infer<typeof AvailableContextSchema>

export const BootstrapSchema = z.object({
  csrfToken: z.string(),
  display: z.string(),
  principal: z.object({ isBotAdmin: z.boolean(), isSuperAdmin: z.boolean() }),
  contexts: z.array(AvailableContextSchema),
})
export type BootstrapData = z.infer<typeof BootstrapSchema>

// --- Config ---

export const ConfigFieldSchema = z.object({
  key: z.string(),
  storageKey: z.string(),
  label: z.string(),
  required: z.boolean(),
  sensitive: z.boolean(),
  kind: z.string(),
  hasValue: z.boolean(),
  value: z.string(),
})
export type ConfigField = z.infer<typeof ConfigFieldSchema>

export const ConfigResponseSchema = z.object({ contextId: z.string(), fields: z.array(ConfigFieldSchema) })
export type ConfigResponse = z.infer<typeof ConfigResponseSchema>

// --- Tools ---

export const ToolRiskSchema = z.enum(['read', 'write', 'destructive', 'open-world'])
export type ToolRisk = z.infer<typeof ToolRiskSchema>

export const ToolEntrySchema = z.object({ name: z.string(), enabled: z.boolean(), risk: ToolRiskSchema })
export const ToolDomainSchema = z.object({
  domain: z.string(),
  status: z.enum(['on', 'off', 'partial']),
  tools: z.array(ToolEntrySchema),
})
export const ToolsResponseSchema = z.object({ contextId: z.string(), domains: z.array(ToolDomainSchema) })
export type ToolsResponse = z.infer<typeof ToolsResponseSchema>
export type ToolDomainView = z.infer<typeof ToolDomainSchema>

// --- MCP ---

export const McpEndpointSchema = z.object({
  id: z.string(),
  url: z.string(),
  label: z.string().optional(),
  enabled: z.boolean(),
  headers: z.record(z.string(), z.string()).optional(),
  toolFilter: z.object({ allow: z.array(z.string()).optional(), deny: z.array(z.string()).optional() }).optional(),
})
export type McpEndpoint = z.infer<typeof McpEndpointSchema>
export const McpResponseSchema = z.object({ contextId: z.string(), endpoints: z.array(McpEndpointSchema) })
export type McpResponse = z.infer<typeof McpResponseSchema>

// --- Plugins ---

export const PluginEligibilitySchema = z.union([
  z.object({ eligible: z.literal(true) }),
  z.object({ eligible: z.literal(false), reason: z.enum(['inactive', 'disabled']) }),
  z.object({ eligible: z.literal(false), reason: z.literal('config_missing'), missingKeys: z.array(z.string()) }),
  z.object({
    eligible: z.literal(false),
    reason: z.literal('capability_missing'),
    missingCapabilities: z.array(z.string()),
  }),
])
export type PluginEligibility = z.infer<typeof PluginEligibilitySchema>

export const PluginConfigFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  required: z.boolean(),
  sensitive: z.boolean(),
  hasValue: z.boolean(),
})
export const PluginEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  active: z.boolean(),
  enabled: z.boolean(),
  eligibility: PluginEligibilitySchema,
  contextConfig: z.array(PluginConfigFieldSchema),
})
export type PluginEntry = z.infer<typeof PluginEntrySchema>
export const PluginsResponseSchema = z.object({ contextId: z.string(), plugins: z.array(PluginEntrySchema) })
export type PluginsResponse = z.infer<typeof PluginsResponseSchema>

// --- Identity ---

export const IdentityMappingSchema = z.object({
  providerUserId: z.string().nullable(),
  providerUserLogin: z.string().nullable(),
  displayName: z.string().nullable(),
  matchMethod: z.string().nullable(),
  confidence: z.number(),
})
export const IdentityResponseSchema = z.object({
  contextId: z.string(),
  providerName: z.string(),
  mapping: IdentityMappingSchema,
})
export type IdentityResponse = z.infer<typeof IdentityResponseSchema>

// --- Provision ---

export const ProvisionResultSchema = z.object({
  status: z.literal('provisioned'),
  contextId: z.string(),
  email: z.string(),
  password: z.string(),
  kaneoUrl: z.string(),
  workspaceId: z.string(),
})
export type ProvisionResult = z.infer<typeof ProvisionResultSchema>

// --- Group ---

export const GroupMemberSchema = z.object({ user_id: z.string(), added_by: z.string(), added_at: z.string() })
export const GroupMembersResponseSchema = z.object({ contextId: z.string(), members: z.array(GroupMemberSchema) })
export type GroupMembersResponse = z.infer<typeof GroupMembersResponseSchema>

export const TaskInstanceOptionSchema = z.object({ id: z.string(), type: z.string(), status: z.string() })
export const GroupTaskInstanceResponseSchema = z.object({
  contextId: z.string(),
  taskInstanceId: z.string().nullable(),
  available: z.array(TaskInstanceOptionSchema),
})
export type GroupTaskInstanceResponse = z.infer<typeof GroupTaskInstanceResponseSchema>

// --- Admin (lenient: store-shaped rows rendered generically) ---

export const AdminInstanceRowSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    status: z.string(),
    config: z.record(z.string(), z.unknown()).optional(),
    createdAt: z.union([z.string(), z.number()]).nullable().optional(),
  })
  .passthrough()
export const AdminInstancesResponseSchema = z.object({ instances: z.array(AdminInstanceRowSchema) })
export type AdminInstanceRow = z.infer<typeof AdminInstanceRowSchema>

export const ProviderTypeFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  required: z.boolean(),
  sensitive: z.boolean(),
})
export const ProviderTypeSchema = z
  .object({
    type: z.string(),
    displayName: z.string(),
    instanceConfigSchema: z.array(ProviderTypeFieldSchema).default([]),
  })
  .passthrough()
export const ProviderTypesResponseSchema = z.object({ providerTypes: z.array(ProviderTypeSchema) })
export type ProviderType = z.infer<typeof ProviderTypeSchema>

export const AdminLlmKeyStateSchema = z.object({
  value: z.string().nullable(),
  updatedAt: z.number().nullable(),
  updatedBy: z.string().nullable(),
})
export const AdminSystemResponseSchema = z.object({ config: z.record(z.string(), AdminLlmKeyStateSchema) })
export type AdminSystemResponse = z.infer<typeof AdminSystemResponseSchema>

export const AdminUserRowSchema = z
  .object({
    platform_user_id: z.string(),
    platform_instance_id: z.string(),
    username: z.string().nullable().optional(),
  })
  .passthrough()
export const AdminUsersResponseSchema = z.object({ users: z.array(AdminUserRowSchema) })
export type AdminUserRow = z.infer<typeof AdminUserRowSchema>

export const AdminGroupRowSchema = z
  .object({ group_id: z.string(), added_by: z.string(), added_at: z.string() })
  .passthrough()
export const AdminGroupsResponseSchema = z.object({ groups: z.array(AdminGroupRowSchema) })
export type AdminGroupRow = z.infer<typeof AdminGroupRowSchema>

export const AdminRosterRowSchema = z
  .object({
    userId: z.string(),
    platformInstanceId: z.string(),
    createdAt: z.union([z.string(), z.number()]).nullable().optional(),
  })
  .passthrough()
export const AdminRosterResponseSchema = z.object({ admins: z.array(AdminRosterRowSchema) })
export type AdminRosterRow = z.infer<typeof AdminRosterRowSchema>

export const PluginApprovalResultSchema = z.object({ ok: z.boolean(), state: z.string().nullable() })
export type PluginApprovalResult = z.infer<typeof PluginApprovalResultSchema>

export const AnnounceResultSchema = z.object({
  totalUsers: z.number(),
  successCount: z.number(),
  failCount: z.number(),
})
export type AnnounceResult = z.infer<typeof AnnounceResultSchema>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/fetcher-schemas.test.ts`
Expected: PASS (six tests).

- [ ] **Step 5: Commit**

```bash
git add client/settings/fetcher-schemas.ts tests/client/settings/fetcher-schemas.test.ts
git commit -m "feat(settings): response schemas for the settings SPA"
```

---

### Task 4: Fetch layer (`fetchers.ts`)

Holds the in-memory CSRF token, the `settingsFetch` wrapper (attaches `credentials: 'include'`, the `X-Settings-CSRF` header on writes, and fires registered 401 handlers), and one typed function per route.

**Files:**

- Create: `client/settings/fetchers.ts`
- Test: `tests/client/settings/fetchers.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/client/settings/fetchers.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import {
  exchangeCode,
  fetchConfig,
  onUnauthorized,
  patchConfig,
  setCsrfToken,
} from '../../../client/settings/fetchers.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

describe('fetchers', () => {
  test('exchangeCode posts the code and returns the bootstrap payload', async () => {
    let seenBody: string | null = null
    setMockFetch((_url, init) => {
      seenBody = typeof init.body === 'string' ? init.body : null
      return Promise.resolve(
        json({ csrfToken: 't', display: 'a', principal: { isBotAdmin: false, isSuperAdmin: false }, contexts: [] }),
      )
    })
    const data = await exchangeCode('CODE123')
    expect(seenBody).toBe(JSON.stringify({ code: 'CODE123' }))
    expect(data.csrfToken).toBe('t')
  })

  test('writes attach the CSRF header from the stored token', async () => {
    setCsrfToken('csrf-xyz')
    let header: string | null = null
    setMockFetch((_url, init) => {
      header = new Headers(init.headers).get('X-Settings-CSRF')
      return Promise.resolve(json({ ok: true, contextId: 'user:1' }))
    })
    await patchConfig({ key: 'timezone', value: 'UTC', contextId: 'user:1' })
    expect(header).toBe('csrf-xyz')
  })

  test('GET passes contextId in the query string', async () => {
    let seenUrl = ''
    setMockFetch((url) => {
      seenUrl = url
      return Promise.resolve(json({ contextId: 'g:1', fields: [] }))
    })
    await fetchConfig('g:1')
    expect(seenUrl).toContain('contextId=g%3A1')
  })

  test('a 401 fires registered unauthorized handlers', async () => {
    let fired = false
    const off = onUnauthorized(() => {
      fired = true
    })
    setMockFetch(() => Promise.resolve(json({ error: 'unauthenticated' }, 401)))
    await expect(fetchConfig('user:1')).rejects.toThrow()
    expect(fired).toBe(true)
    off()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/fetchers.test.ts`
Expected: FAIL — module `fetchers.js` not found.

- [ ] **Step 3: Write the fetch layer**

`client/settings/fetchers.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readBody, requireOk } from '../shared/fetcher-helpers.js'

import {
  AdminGroupsResponseSchema,
  AdminInstancesResponseSchema,
  AdminRosterResponseSchema,
  AdminSystemResponseSchema,
  AdminUsersResponseSchema,
  AnnounceResultSchema,
  BootstrapSchema,
  ConfigResponseSchema,
  GroupMembersResponseSchema,
  GroupTaskInstanceResponseSchema,
  IdentityResponseSchema,
  McpResponseSchema,
  PluginApprovalResultSchema,
  PluginsResponseSchema,
  ProviderTypesResponseSchema,
  ProvisionResultSchema,
  ToolsResponseSchema,
  type AdminGroupsResponse,
  type AdminInstancesResponse,
  type AdminRosterResponse,
  type AdminSystemResponse,
  type AdminUsersResponse,
  type AnnounceResult,
  type BootstrapData,
  type ConfigResponse,
  type GroupMembersResponse,
  type GroupTaskInstanceResponse,
  type IdentityResponse,
  type McpEndpoint,
  type McpResponse,
  type PluginApprovalResult,
  type PluginsResponse,
  type ProviderTypesResponse,
  type ProvisionResult,
  type ToolsResponse,
} from './fetcher-schemas.js'

const CSRF_HEADER = 'X-Settings-CSRF'
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

let csrfToken = ''
export const setCsrfToken = (token: string): void => {
  csrfToken = token
}

type UnauthorizedHandler = () => void
const unauthorizedHandlers = new Set<UnauthorizedHandler>()
export const onUnauthorized = (handler: UnauthorizedHandler): (() => void) => {
  unauthorizedHandlers.add(handler)
  return (): void => {
    unauthorizedHandlers.delete(handler)
  }
}

/** Same-origin fetch with cookie credentials + CSRF on writes; fires 401 handlers. */
async function settingsFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  if (WRITE_METHODS.has(method)) {
    if (csrfToken.length > 0) headers.set(CSRF_HEADER, csrfToken)
    if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  }
  const res = await fetch(path, { ...init, headers, credentials: 'include' })
  if (res.status === 401) for (const handler of unauthorizedHandlers) handler()
  return res
}

const ctxQuery = (contextId: string): string => `contextId=${encodeURIComponent(contextId)}`

async function getJson<T>(path: string, parse: (body: unknown) => T): Promise<T> {
  const res = await settingsFetch(path)
  const body = await readBody(res)
  requireOk(res, body)
  return parse(body)
}

async function writeJson<T>(path: string, method: string, payload: unknown, parse: (body: unknown) => T): Promise<T> {
  const res = await settingsFetch(path, { method, body: JSON.stringify(payload) })
  const body = await readBody(res)
  requireOk(res, body)
  return parse(body)
}

// --- Bootstrap / session ---

export const exchangeCode = async (code: string): Promise<BootstrapData> => {
  // Plain fetch: exchange establishes the session/CSRF and must not trip the 401 handler.
  const res = await fetch('/settings/auth/exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
    credentials: 'include',
  })
  const body = await readBody(res)
  requireOk(res, body)
  return BootstrapSchema.parse(body)
}

export const fetchBootstrap = (): Promise<BootstrapData> =>
  getJson('/settings/api/bootstrap', (b) => BootstrapSchema.parse(b))

export const logout = async (): Promise<void> => {
  await settingsFetch('/settings/auth/logout', { method: 'POST' })
}

// --- Config ---

export const fetchConfig = (contextId: string): Promise<ConfigResponse> =>
  getJson(`/settings/api/config?${ctxQuery(contextId)}`, (b) => ConfigResponseSchema.parse(b))

export const patchConfig = (input: { key: string; value: string; contextId: string }): Promise<unknown> =>
  writeJson('/settings/api/config', 'PATCH', input, (b) => b)

// --- Tools ---

export const fetchTools = (contextId: string): Promise<ToolsResponse> =>
  getJson(`/settings/api/tools?${ctxQuery(contextId)}`, (b) => ToolsResponseSchema.parse(b))

export const toggleTool = (
  input: { kind: 'domain'; domain: string; contextId: string } | { kind: 'tool'; tool: string; contextId: string },
): Promise<ToolsResponse> => writeJson('/settings/api/tools/toggle', 'POST', input, (b) => ToolsResponseSchema.parse(b))

// --- MCP ---

export const fetchMcp = (contextId: string): Promise<McpResponse> =>
  getJson(`/settings/api/mcp?${ctxQuery(contextId)}`, (b) => McpResponseSchema.parse(b))

export const putMcp = (input: { endpoints: McpEndpoint[]; contextId: string }): Promise<unknown> =>
  writeJson('/settings/api/mcp', 'PUT', input, (b) => b)

// --- Plugins ---

export const fetchPlugins = (contextId: string): Promise<PluginsResponse> =>
  getJson(`/settings/api/plugins?${ctxQuery(contextId)}`, (b) => PluginsResponseSchema.parse(b))

export const togglePlugin = (input: { pluginId: string; enabled: boolean; contextId: string }): Promise<unknown> =>
  writeJson('/settings/api/plugins/toggle', 'POST', input, (b) => b)

export const patchPluginConfig = (input: {
  pluginId: string
  key: string
  value: string
  contextId: string
}): Promise<unknown> => writeJson('/settings/api/plugins/config', 'PATCH', input, (b) => b)

// --- Identity ---

export const fetchIdentity = (contextId: string): Promise<IdentityResponse> =>
  getJson(`/settings/api/identity?${ctxQuery(contextId)}`, (b) => IdentityResponseSchema.parse(b))

export const putIdentity = (input: {
  providerUserId: string
  providerUserLogin?: string | null
  displayName?: string | null
  contextId: string
}): Promise<unknown> => writeJson('/settings/api/identity', 'PUT', input, (b) => b)

export const deleteIdentity = (contextId: string): Promise<unknown> =>
  settingsFetch(`/settings/api/identity?${ctxQuery(contextId)}`, { method: 'DELETE' }).then(async (res) => {
    const body = await readBody(res)
    requireOk(res, body)
    return body
  })

// --- Provision ---

export const provisionKaneo = (contextId: string): Promise<ProvisionResult> =>
  writeJson('/settings/api/provision/kaneo', 'POST', { contextId }, (b) => ProvisionResultSchema.parse(b))

// --- Group ---

export const fetchGroupMembers = (contextId: string): Promise<GroupMembersResponse> =>
  getJson(`/settings/api/group/members?${ctxQuery(contextId)}`, (b) => GroupMembersResponseSchema.parse(b))

export const addGroupMember = (input: { userId: string; contextId: string }): Promise<unknown> =>
  writeJson('/settings/api/group/members', 'POST', input, (b) => b)

export const removeGroupMember = (input: { userId: string; contextId: string }): Promise<unknown> =>
  writeJson('/settings/api/group/members', 'DELETE', input, (b) => b)

export const fetchGroupTaskInstance = (contextId: string): Promise<GroupTaskInstanceResponse> =>
  getJson(`/settings/api/group/task-instance?${ctxQuery(contextId)}`, (b) => GroupTaskInstanceResponseSchema.parse(b))

export const patchGroupTaskInstance = (input: { taskInstanceId: string; contextId: string }): Promise<unknown> =>
  writeJson('/settings/api/group/task-instance', 'PATCH', input, (b) => b)

// --- Admin: instances ---

export const fetchAdminPlatformInstances = (): Promise<AdminInstancesResponse> =>
  getJson('/settings/api/admin/platform-instances', (b) => AdminInstancesResponseSchema.parse(b))

export const fetchAdminTaskInstances = (): Promise<AdminInstancesResponse> =>
  getJson('/settings/api/admin/task-instances', (b) => AdminInstancesResponseSchema.parse(b))

export const fetchAdminPlatformProviderTypes = (): Promise<ProviderTypesResponse> =>
  getJson('/settings/api/admin/platform-provider-types', (b) => ProviderTypesResponseSchema.parse(b))

export const fetchAdminTaskProviderTypes = (): Promise<ProviderTypesResponse> =>
  getJson('/settings/api/admin/task-provider-types', (b) => ProviderTypesResponseSchema.parse(b))

export const createAdminPlatformInstance = (input: {
  id: string
  type: string
  config: Record<string, string>
}): Promise<unknown> => writeJson('/settings/api/admin/platform-instances', 'POST', input, (b) => b)

export const createAdminTaskInstance = (input: {
  id: string
  type: string
  config: Record<string, string>
}): Promise<unknown> => writeJson('/settings/api/admin/task-instances', 'POST', input, (b) => b)

export const updateAdminPlatformInstance = (
  id: string,
  input: { status?: string; config?: Record<string, string> },
): Promise<unknown> =>
  writeJson(`/settings/api/admin/platform-instances/${encodeURIComponent(id)}`, 'PATCH', input, (b) => b)

export const deleteAdminPlatformInstance = (id: string): Promise<unknown> =>
  settingsFetch(`/settings/api/admin/platform-instances/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(
    async (res) => {
      const body = await readBody(res)
      requireOk(res, body)
      return body
    },
  )

export const deleteAdminTaskInstance = (id: string): Promise<unknown> =>
  settingsFetch(`/settings/api/admin/task-instances/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(
    async (res) => {
      const body = await readBody(res)
      requireOk(res, body)
      return body
    },
  )

// --- Admin: system / access / roster / plugins / announce ---

export const fetchAdminSystem = (): Promise<AdminSystemResponse> =>
  getJson('/settings/api/admin/system', (b) => AdminSystemResponseSchema.parse(b))

export const submitAdminSystem = (input: { key: string; value: string }): Promise<unknown> =>
  writeJson('/settings/api/admin/system', 'POST', input, (b) => b)

export const fetchAdminUsers = (): Promise<AdminUsersResponse> =>
  getJson('/settings/api/admin/users', (b) => AdminUsersResponseSchema.parse(b))

export const addAdminUser = (input: { userId: string; username?: string }): Promise<unknown> =>
  writeJson('/settings/api/admin/users', 'POST', input, (b) => b)

export const removeAdminUser = (input: { userId: string }): Promise<unknown> =>
  writeJson('/settings/api/admin/users', 'DELETE', input, (b) => b)

export const fetchAdminGroups = (): Promise<AdminGroupsResponse> =>
  getJson('/settings/api/admin/groups', (b) => AdminGroupsResponseSchema.parse(b))

export const addAdminGroup = (input: { groupId: string }): Promise<unknown> =>
  writeJson('/settings/api/admin/groups', 'POST', input, (b) => b)

export const removeAdminGroup = (input: { groupId: string }): Promise<unknown> =>
  writeJson('/settings/api/admin/groups', 'DELETE', input, (b) => b)

export const fetchAdminRoster = (): Promise<AdminRosterResponse> =>
  getJson('/settings/api/admin/admins', (b) => AdminRosterResponseSchema.parse(b))

export const addRosterAdmin = (input: { userId: string; platformInstanceId: string }): Promise<unknown> =>
  writeJson('/settings/api/admin/admins', 'POST', input, (b) => b)

export const removeRosterAdmin = (input: { userId: string; platformInstanceId: string }): Promise<unknown> =>
  writeJson('/settings/api/admin/admins', 'DELETE', input, (b) => b)

export const setPluginApproval = (input: {
  pluginId: string
  action: 'approve' | 'reject'
}): Promise<PluginApprovalResult> =>
  writeJson('/settings/api/admin/plugin-approval', 'POST', input, (b) => PluginApprovalResultSchema.parse(b))

export const sendAnnounce = (input: { message: string }): Promise<AnnounceResult> =>
  writeJson('/settings/api/admin/announce', 'POST', input, (b) => AnnounceResultSchema.parse(b))
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/fetchers.test.ts`
Expected: PASS (four tests).

- [ ] **Step 5: Commit**

```bash
git add client/settings/fetchers.ts tests/client/settings/fetchers.test.ts
git commit -m "feat(settings): typed fetch layer with CSRF + 401 handling"
```

---

### Task 5: Session store (`session.svelte.ts`)

Reactive `$state` holding role flags, contexts, active `contextId`, and a status (`loading`/`ready`/`unauthenticated`). Seeded by exchange or bootstrap; flips to `unauthenticated` on any 401.

**Files:**

- Create: `client/settings/session.svelte.ts`
- Test: `tests/client/settings/session.svelte.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/client/settings/session.svelte.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { setCsrfToken } from '../../../client/settings/fetchers.js'
import {
  activeContext,
  bootstrapSession,
  registerExpiryHandler,
  setActiveContext,
  settingsSession,
} from '../../../client/settings/session.svelte.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

const bootstrapPayload = {
  csrfToken: 'tok',
  display: 'alice',
  principal: { isBotAdmin: true, isSuperAdmin: false },
  contexts: [
    { kind: 'personal', contextId: 'user:1', label: 'Personal' },
    { kind: 'group', contextId: 'group:7', label: 'Team' },
  ],
}

afterEach(() => {
  restoreFetch()
  settingsSession.status = 'loading'
  settingsSession.contexts = []
  settingsSession.activeContextId = ''
  setCsrfToken('')
})

describe('session store', () => {
  test('bootstrapSession with no code calls bootstrap and populates state', async () => {
    setMockFetch(() => Promise.resolve(json(bootstrapPayload)))
    await bootstrapSession(null)
    expect(settingsSession.status).toBe('ready')
    expect(settingsSession.isBotAdmin).toBe(true)
    expect(settingsSession.activeContextId).toBe('user:1')
    expect(activeContext()?.kind).toBe('personal')
  })

  test('bootstrapSession with a code calls exchange', async () => {
    let calledUrl = ''
    setMockFetch((url) => {
      calledUrl = url
      return Promise.resolve(json(bootstrapPayload))
    })
    await bootstrapSession('CODE')
    expect(calledUrl).toContain('/settings/auth/exchange')
    expect(settingsSession.status).toBe('ready')
  })

  test('setActiveContext only accepts known contexts', async () => {
    setMockFetch(() => Promise.resolve(json(bootstrapPayload)))
    await bootstrapSession(null)
    setActiveContext('group:7')
    expect(settingsSession.activeContextId).toBe('group:7')
    setActiveContext('unknown')
    expect(settingsSession.activeContextId).toBe('group:7')
  })

  test('a failed bootstrap marks the session unauthenticated', async () => {
    setMockFetch(() => Promise.resolve(json({ error: 'unauthenticated' }, 401)))
    await bootstrapSession(null)
    expect(settingsSession.status).toBe('unauthenticated')
  })

  test('registerExpiryHandler flips status on a later 401', async () => {
    registerExpiryHandler()
    setMockFetch(() => Promise.resolve(json(bootstrapPayload)))
    await bootstrapSession(null)
    expect(settingsSession.status).toBe('ready')
    // Trigger a 401 through the shared fetch layer.
    const { fetchConfig } = await import('../../../client/settings/fetchers.js')
    setMockFetch(() => Promise.resolve(json({ error: 'unauthenticated' }, 401)))
    await fetchConfig('user:1').catch(() => undefined)
    expect(settingsSession.status).toBe('unauthenticated')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/session.svelte.test.ts`
Expected: FAIL — module `session.svelte.js` not found.

- [ ] **Step 3: Write the session store**

`client/settings/session.svelte.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { exchangeCode, fetchBootstrap, onUnauthorized, setCsrfToken } from './fetchers.js'
import type { AvailableContext, BootstrapData } from './fetcher-schemas.js'

type Status = 'loading' | 'ready' | 'unauthenticated'

export const settingsSession = $state({
  status: 'loading' as Status,
  display: '',
  isBotAdmin: false,
  isSuperAdmin: false,
  contexts: [] as AvailableContext[],
  activeContextId: '',
})

function applyBootstrap(data: BootstrapData): void {
  setCsrfToken(data.csrfToken)
  settingsSession.display = data.display
  settingsSession.isBotAdmin = data.principal.isBotAdmin
  settingsSession.isSuperAdmin = data.principal.isSuperAdmin
  settingsSession.contexts = [...data.contexts]
  const stillValid = data.contexts.some((c) => c.contextId === settingsSession.activeContextId)
  settingsSession.activeContextId = stillValid ? settingsSession.activeContextId : (data.contexts[0]?.contextId ?? '')
  settingsSession.status = 'ready'
}

export function setActiveContext(contextId: string): void {
  if (settingsSession.contexts.some((c) => c.contextId === contextId)) {
    settingsSession.activeContextId = contextId
  }
}

export function activeContext(): AvailableContext | undefined {
  return settingsSession.contexts.find((c) => c.contextId === settingsSession.activeContextId)
}

export async function bootstrapSession(code: string | null): Promise<void> {
  try {
    const data = code !== null && code.length > 0 ? await exchangeCode(code) : await fetchBootstrap()
    applyBootstrap(data)
  } catch {
    settingsSession.status = 'unauthenticated'
  }
}

let registered = false
export function registerExpiryHandler(): void {
  if (registered) return
  registered = true
  onUnauthorized(() => {
    settingsSession.status = 'unauthenticated'
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/session.svelte.test.ts`
Expected: PASS (five tests).

- [ ] **Step 5: Commit**

```bash
git add client/settings/session.svelte.ts tests/client/settings/session.svelte.test.ts
git commit -m "feat(settings): reactive session store with bootstrap + expiry"
```

---

# Phase 3 — Shared UI

### Task 6: Scroll-spy (`scrollspy.ts`)

A per-app copy of the admin scroll-spy (established pattern: each client app owns its own). Pure and `IntersectionObserver`-based; `tests/client-setup.ts` already stubs `IntersectionObserver`.

**Files:**

- Create: `client/settings/scrollspy.ts`
- Test: `tests/client/settings/scrollspy.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/client/settings/scrollspy.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { useScrollSpy } from '../../../client/settings/scrollspy.js'

describe('useScrollSpy', () => {
  test('start and stop are idempotent and return a handle', () => {
    const spy = useScrollSpy(['profile', 'tools'], () => undefined)
    expect(typeof spy.start).toBe('function')
    expect(typeof spy.stop).toBe('function')
    spy.start()
    spy.start()
    spy.stop()
    spy.stop()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/scrollspy.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the scroll-spy (identical structure to `client/admin/scrollspy.ts`)**

`client/settings/scrollspy.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export interface ScrollSpyHandle {
  start: () => void
  stop: () => void
}

export const useScrollSpy = (sectionIds: readonly string[], onChange: (id: string) => void): ScrollSpyHandle => {
  let observer: IntersectionObserver | null = null

  const start = (): void => {
    if (observer !== null) return
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const id = entry.target.id
          if (sectionIds.includes(id)) onChange(id)
        }
      },
      { rootMargin: '-30% 0px -60% 0px' },
    )
    for (const id of sectionIds) {
      const el = document.getElementById(id)
      if (el !== null) observer.observe(el)
    }
  }

  const stop = (): void => {
    observer?.disconnect()
    observer = null
  }

  return { start, stop }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/scrollspy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/settings/scrollspy.ts tests/client/settings/scrollspy.test.ts
git commit -m "feat(settings): scroll-spy hook"
```

---

### Task 7: Top bar with context switcher (`components/SettingsTopBar.svelte`)

Brand + a `<select>` context switcher (Personal | each managed group) + sign-out. Switching the context calls `setActiveContext`.

**Files:**

- Create: `client/settings/components/SettingsTopBar.svelte`
- Test: `tests/client/settings/components/SettingsTopBar.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/client/settings/components/SettingsTopBar.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import SettingsTopBar from '../../../../client/settings/components/SettingsTopBar.svelte'
import { settingsSession } from '../../../../client/settings/session.svelte.js'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const seed = (): void => {
  settingsSession.status = 'ready'
  settingsSession.display = 'alice'
  settingsSession.contexts = [
    { kind: 'personal', contextId: 'user:1', label: 'Personal' },
    { kind: 'group', contextId: 'group:7', label: 'Team' },
  ]
  settingsSession.activeContextId = 'user:1'
}

const render = (): { component: ReturnType<typeof mount>; target: HTMLElement } => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  return { component: mount(SettingsTopBar, { target }), target }
}

afterEach(() => {
  restoreFetch()
})

describe('SettingsTopBar', () => {
  test('renders one option per context and the display name', () => {
    setMockFetch(() => Promise.resolve(new Response('{}')))
    seed()
    const { component, target } = render()
    flushSync()
    expect(target.textContent).toContain('alice')
    expect(target.querySelectorAll('option')).toHaveLength(2)
    void unmount(component)
  })

  test('changing the switcher updates the active context', () => {
    setMockFetch(() => Promise.resolve(new Response('{}')))
    seed()
    const { component, target } = render()
    flushSync()
    const select = target.querySelector<HTMLSelectElement>('[data-testid="context-switcher"]')!
    select.value = 'group:7'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    expect(settingsSession.activeContextId).toBe('group:7')
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/components/SettingsTopBar.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Write the component**

`client/settings/components/SettingsTopBar.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Btn from '../../shared/ui/Btn.svelte'
  import Pill from '../../shared/ui/Pill.svelte'
  import TopBar from '../../shared/ui/TopBar.svelte'

  import { logout } from '../fetchers.js'
  import { setActiveContext, settingsSession } from '../session.svelte.js'

  async function signOut(): Promise<void> {
    await logout()
    window.location.href = '/settings'
  }
</script>

<TopBar page="settings">
  {#snippet statusRow()}
    <div class="settings-topbar__status">
      <Pill tone="accent" dot>{#snippet children()}{settingsSession.display}{/snippet}</Pill>
      <span class="settings-topbar__spacer"></span>
      <label class="settings-topbar__ctx">
        <span class="settings-topbar__lbl">context</span>
        <select
          data-testid="context-switcher"
          value={settingsSession.activeContextId}
          onchange={(event) => setActiveContext((event.target as HTMLSelectElement).value)}>
          {#each settingsSession.contexts as ctx (ctx.contextId)}
            <option value={ctx.contextId}>{ctx.label}</option>
          {/each}
        </select>
      </label>
      <Btn variant="ghost" size="sm" onClick={() => void signOut()}>
        {#snippet children()}sign out{/snippet}
      </Btn>
    </div>
  {/snippet}
</TopBar>

<style>
  .settings-topbar__status {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
  }
  .settings-topbar__spacer {
    flex: 1;
  }
  .settings-topbar__ctx {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .settings-topbar__lbl {
    color: var(--fg3);
    font-family: var(--font-mono);
    font-size: 11px;
  }
  .settings-topbar__ctx select {
    background: var(--raised);
    border: 1px solid var(--border);
    color: var(--fg);
    font-family: var(--font-mono);
    font-size: 12px;
    padding: 4px 8px;
    border-radius: 2px;
  }
</style>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/components/SettingsTopBar.test.ts`
Expected: PASS (two tests).

- [ ] **Step 5: Commit**

```bash
git add client/settings/components/SettingsTopBar.svelte tests/client/settings/components/SettingsTopBar.test.ts
git commit -m "feat(settings): top bar with context switcher"
```

---

### Task 8: Role-gated sidebar (`components/SettingsSidebar.svelte`)

Renders nav links from a section list passed in by the parent (so gating logic lives in one place — `SettingsApp`). Highlights the active id.

**Files:**

- Create: `client/settings/components/SettingsSidebar.svelte`
- Test: `tests/client/settings/components/SettingsSidebar.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/client/settings/components/SettingsSidebar.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import SettingsSidebar from '../../../../client/settings/components/SettingsSidebar.svelte'

const render = (props: Record<string, unknown>): { component: ReturnType<typeof mount>; target: HTMLElement } => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  return { component: mount(SettingsSidebar, { target, props }), target }
}

describe('SettingsSidebar', () => {
  test('renders one link per item with hash hrefs', () => {
    const { component, target } = render({
      items: [
        { id: 'profile', label: 'Profile' },
        { id: 'tools', label: 'Tools' },
      ],
      activeId: 'profile',
    })
    flushSync()
    const links = Array.from(target.querySelectorAll('a'))
    expect(links).toHaveLength(2)
    expect(links[0]!.getAttribute('href')).toBe('#profile')
    void unmount(component)
  })

  test('marks the active item', () => {
    const { component, target } = render({
      items: [{ id: 'profile', label: 'Profile' }],
      activeId: 'profile',
    })
    flushSync()
    expect(target.querySelector('.settings-sidebar__link--active')).not.toBeNull()
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/components/SettingsSidebar.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Write the component**

`client/settings/components/SettingsSidebar.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Caption from '../../shared/ui/Caption.svelte'

  export interface SidebarItem {
    id: string
    label: string
  }

  interface Props {
    items: readonly SidebarItem[]
    activeId: string
  }

  let { items, activeId }: Props = $props()
</script>

<aside class="settings-sidebar">
  <Caption>{#snippet children()}sections{/snippet}</Caption>
  <nav class="settings-sidebar__nav">
    {#each items as item (item.id)}
      <a
        class="settings-sidebar__link"
        class:settings-sidebar__link--active={activeId === item.id}
        href={`#${item.id}`}>
        {item.label}
      </a>
    {/each}
  </nav>
</aside>

<style>
  .settings-sidebar {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    background: var(--surface);
    border-right: 1px solid var(--border);
    min-height: 100vh;
  }
  .settings-sidebar__nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .settings-sidebar__link {
    color: var(--fg2);
    text-decoration: none;
    padding: 6px 8px;
    font-family: var(--font-mono);
    font-size: 12px;
    border-left: 2px solid transparent;
  }
  .settings-sidebar__link:hover {
    color: var(--fg);
    background: var(--raised);
  }
  .settings-sidebar__link--active {
    color: var(--accent);
    border-left-color: var(--accent);
    background: var(--raised);
  }
</style>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/components/SettingsSidebar.test.ts`
Expected: PASS (two tests).

- [ ] **Step 5: Commit**

```bash
git add client/settings/components/SettingsSidebar.svelte tests/client/settings/components/SettingsSidebar.test.ts
git commit -m "feat(settings): role-gated sidebar navigation"
```

---

### Task 9: Config field row (`components/ConfigFieldRow.svelte`)

A single editable config field, reused by Profile and Task-provider sections. Non-sensitive fields show an editable input prefilled with the value; sensitive fields show a masked placeholder + a "Replace" affordance (empty submit = no change, enforced server-side). Calls `patchConfig` and notifies the parent to refresh.

**Files:**

- Create: `client/settings/components/ConfigFieldRow.svelte`
- Test: `tests/client/settings/components/ConfigFieldRow.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/client/settings/components/ConfigFieldRow.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import ConfigFieldRow from '../../../../client/settings/components/ConfigFieldRow.svelte'
import { setCsrfToken } from '../../../../client/settings/fetchers.js'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const render = (props: Record<string, unknown>): { component: ReturnType<typeof mount>; target: HTMLElement } => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  return { component: mount(ConfigFieldRow, { target, props }), target }
}

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

describe('ConfigFieldRow', () => {
  test('saving a non-sensitive field PATCHes the new value', async () => {
    setCsrfToken('c')
    let body: string | null = null
    setMockFetch((_url, init) => {
      body = typeof init.body === 'string' ? init.body : null
      return Promise.resolve(json({ ok: true, contextId: 'user:1' }))
    })
    let saved = false
    const { component, target } = render({
      contextId: 'user:1',
      field: {
        key: 'timezone',
        storageKey: 'timezone',
        label: 'Timezone',
        required: true,
        sensitive: false,
        kind: 'preference',
        hasValue: true,
        value: 'UTC',
      },
      onSaved: () => {
        saved = true
      },
    })
    flushSync()
    const input = target.querySelector<HTMLInputElement>('[data-testid="cfg-input-timezone"]')!
    input.value = 'Europe/Berlin'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="cfg-save-timezone"]')!.click()
    await drain()
    expect(body).toBe(JSON.stringify({ key: 'timezone', value: 'Europe/Berlin', contextId: 'user:1' }))
    expect(saved).toBe(true)
    void unmount(component)
  })

  test('a sensitive field with a value shows the masked placeholder and a replace control', () => {
    setMockFetch(() => Promise.resolve(json({})))
    const { component, target } = render({
      contextId: 'user:1',
      field: {
        key: 'kaneo_apikey',
        storageKey: 'kaneo_apikey',
        label: 'Kaneo API Key',
        required: false,
        sensitive: true,
        kind: 'provider-context',
        hasValue: true,
        value: '****1234',
      },
      onSaved: () => undefined,
    })
    flushSync()
    expect(target.textContent).toContain('****1234')
    expect(target.querySelector('[data-testid="cfg-replace-kaneo_apikey"]')).not.toBeNull()
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/components/ConfigFieldRow.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Write the component**

`client/settings/components/ConfigFieldRow.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { ConfigField } from '../fetcher-schemas.js'
  import { patchConfig } from '../fetchers.js'

  interface Props {
    contextId: string
    field: ConfigField
    onSaved: () => void
  }

  let { contextId, field, onSaved }: Props = $props()

  // Editing state. Sensitive fields start collapsed (masked); "Replace" opens an empty input.
  let replacing = $state(false)
  let draft = $state(field.sensitive ? '' : field.value)
  let error: string | null = $state(null)
  let saving = $state(false)

  const editorOpen = $derived(!field.sensitive || replacing)

  async function save(): Promise<void> {
    error = null
    saving = true
    try {
      await patchConfig({ key: field.key, value: draft, contextId })
      replacing = false
      if (!field.sensitive) draft = field.value
      onSaved()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      saving = false
    }
  }
</script>

<div class="settings-field" data-testid={`cfg-row-${field.key}`}>
  <div class="settings-field__head">
    <span class="settings-field__label">{field.label}{field.required ? ' *' : ''}</span>
    {#if field.sensitive && field.hasValue && !replacing}
      <span class="masked-value">{field.value}</span>
      <button type="button" data-testid={`cfg-replace-${field.key}`} onclick={() => (replacing = true)}>Replace</button>
    {/if}
  </div>

  {#if editorOpen}
    <div class="settings-field__editor">
      <input
        data-testid={`cfg-input-${field.key}`}
        type={field.sensitive ? 'password' : 'text'}
        value={draft}
        placeholder={field.sensitive ? 'enter a new value' : ''}
        oninput={(event) => (draft = (event.target as HTMLInputElement).value)} />
      <button type="button" data-testid={`cfg-save-${field.key}`} disabled={saving} onclick={() => void save()}>
        {saving ? 'Saving…' : 'Save'}
      </button>
      {#if field.sensitive}
        <button type="button" data-testid={`cfg-cancel-${field.key}`} onclick={() => { replacing = false; draft = '' }}>
          Cancel
        </button>
      {/if}
    </div>
  {/if}

  {#if error !== null}
    <p class="status-error">{error}</p>
  {/if}
</div>

<style>
  .settings-field {
    display: grid;
    gap: 8px;
    padding: 12px;
    border: 1px solid var(--border);
    background: var(--surface);
  }
  .settings-field__head {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .settings-field__label {
    color: var(--fg2);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .settings-field__editor {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .settings-field__editor input {
    flex: 1;
    min-width: 200px;
    background: var(--raised);
    border: 1px solid var(--border);
    color: var(--fg);
    padding: 8px 10px;
    border-radius: 2px;
  }
  .settings-field__editor button,
  .settings-field__head button {
    border: 1px solid var(--strong);
    background: var(--bg);
    color: var(--fg);
    padding: 8px 10px;
    border-radius: 2px;
  }
</style>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/components/ConfigFieldRow.test.ts`
Expected: PASS (two tests).

- [ ] **Step 5: Commit**

```bash
git add client/settings/components/ConfigFieldRow.svelte tests/client/settings/components/ConfigFieldRow.test.ts
git commit -m "feat(settings): reusable config field row"
```

---

# Phase 4 — User-tier sections

Every section component takes a `contextId: string` prop and re-fetches via `$effect` when it changes. Each renders inside a `<section id="…" class="settings-section">` so the sidebar/scroll-spy can target it.

### Task 10: Profile section (`sections/ProfileSection.svelte`)

Renders the `kind: 'preference'` config fields (timezone, etc.), excluding `mcp_endpoints` (which has its own MCP section), via `ConfigFieldRow`.

**Files:**

- Create: `client/settings/sections/ProfileSection.svelte`
- Test: `tests/client/settings/sections/ProfileSection.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/client/settings/sections/ProfileSection.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import ProfileSection from '../../../../client/settings/sections/ProfileSection.svelte'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const configPayload = {
  contextId: 'user:1',
  fields: [
    {
      key: 'timezone',
      storageKey: 'timezone',
      label: 'Timezone',
      required: true,
      sensitive: false,
      kind: 'preference',
      hasValue: true,
      value: 'UTC',
    },
    {
      key: 'mcp_endpoints',
      storageKey: 'mcp_endpoints',
      label: 'MCP Endpoints',
      required: false,
      sensitive: false,
      kind: 'preference',
      hasValue: false,
      value: '',
    },
    {
      key: 'kaneo_apikey',
      storageKey: 'kaneo_apikey',
      label: 'Kaneo API Key',
      required: false,
      sensitive: true,
      kind: 'provider-context',
      hasValue: false,
      value: '',
    },
  ],
}

afterEach(() => {
  restoreFetch()
})

describe('ProfileSection', () => {
  test('renders only preference fields excluding mcp_endpoints', async () => {
    setMockFetch(() => Promise.resolve(json(configPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ProfileSection, { target, props: { contextId: 'user:1' } })
    await drain()
    expect(target.querySelector('#profile')).not.toBeNull()
    expect(target.querySelector('[data-testid="cfg-row-timezone"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="cfg-row-mcp_endpoints"]')).toBeNull()
    expect(target.querySelector('[data-testid="cfg-row-kaneo_apikey"]')).toBeNull()
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/sections/ProfileSection.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Write the component**

`client/settings/sections/ProfileSection.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import ConfigFieldRow from '../components/ConfigFieldRow.svelte'
  import type { ConfigField } from '../fetcher-schemas.js'
  import { fetchConfig } from '../fetchers.js'

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  let fields: ConfigField[] = $state([])
  let error: string | null = $state(null)
  let loading = $state(false)

  const visible = $derived(
    fields.filter((field) => field.kind === 'preference' && field.storageKey !== 'mcp_endpoints'),
  )

  async function load(id: string): Promise<void> {
    error = null
    loading = true
    try {
      fields = (await fetchConfig(id)).fields
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  $effect(() => {
    void load(contextId)
  })
</script>

<section id="profile" class="settings-section">
  <header class="settings-section-header">
    <div>
      <p class="eyebrow">Personal</p>
      <h2>Profile</h2>
    </div>
    <button type="button" onclick={() => void load(contextId)}>{loading ? 'Refreshing…' : 'Refresh'}</button>
  </header>

  {#if error !== null}
    <p class="status-error">{error}</p>
  {/if}

  {#if visible.length === 0}
    <p class="placeholder">No editable profile settings for this context.</p>
  {:else}
    <div class="settings-field-list">
      {#each visible as field (field.key)}
        <ConfigFieldRow {contextId} {field} onSaved={() => void load(contextId)} />
      {/each}
    </div>
  {/if}
</section>

<style>
  .settings-field-list {
    display: grid;
    gap: 12px;
  }
</style>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/sections/ProfileSection.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/ProfileSection.svelte tests/client/settings/sections/ProfileSection.test.ts
git commit -m "feat(settings): profile section"
```

---

### Task 11: Task provider section (`sections/TaskProviderSection.svelte`)

Renders `kind: 'provider-context'` config fields (credentials) via `ConfigFieldRow`, plus a Kaneo auto-provision button that reveals the one-time generated email/password.

**Files:**

- Create: `client/settings/sections/TaskProviderSection.svelte`
- Test: `tests/client/settings/sections/TaskProviderSection.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/client/settings/sections/TaskProviderSection.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import TaskProviderSection from '../../../../client/settings/sections/TaskProviderSection.svelte'
import { setCsrfToken } from '../../../../client/settings/fetchers.js'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const configPayload = {
  contextId: 'user:1',
  fields: [
    {
      key: 'timezone',
      storageKey: 'timezone',
      label: 'Timezone',
      required: true,
      sensitive: false,
      kind: 'preference',
      hasValue: true,
      value: 'UTC',
    },
    {
      key: 'kaneo_apikey',
      storageKey: 'kaneo_apikey',
      label: 'Kaneo API Key',
      required: false,
      sensitive: true,
      kind: 'provider-context',
      hasValue: false,
      value: '',
    },
  ],
}

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

describe('TaskProviderSection', () => {
  test('renders provider-context fields only', async () => {
    setMockFetch(() => Promise.resolve(json(configPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(TaskProviderSection, { target, props: { contextId: 'user:1' } })
    await drain()
    expect(target.querySelector('[data-testid="cfg-row-kaneo_apikey"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="cfg-row-timezone"]')).toBeNull()
    void unmount(component)
  })

  test('provision reveals one-time credentials', async () => {
    setCsrfToken('c')
    setMockFetch((url) => {
      if (url.includes('/settings/api/provision/kaneo')) {
        return Promise.resolve(
          json({
            status: 'provisioned',
            contextId: 'user:1',
            email: 'a@b.c',
            password: 'p@ss',
            kaneoUrl: 'https://k',
            workspaceId: 'w1',
          }),
        )
      }
      return Promise.resolve(json(configPayload))
    })
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(TaskProviderSection, { target, props: { contextId: 'user:1' } })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="provision-kaneo"]')!.click()
    await drain()
    expect(target.textContent).toContain('a@b.c')
    expect(target.textContent).toContain('p@ss')
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/sections/TaskProviderSection.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Write the component**

`client/settings/sections/TaskProviderSection.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import ConfigFieldRow from '../components/ConfigFieldRow.svelte'
  import type { ConfigField, ProvisionResult } from '../fetcher-schemas.js'
  import { fetchConfig, provisionKaneo } from '../fetchers.js'

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  let fields: ConfigField[] = $state([])
  let error: string | null = $state(null)
  let loading = $state(false)
  let provisioning = $state(false)
  let provisionError: string | null = $state(null)
  let provisioned: ProvisionResult | null = $state(null)

  const visible = $derived(fields.filter((field) => field.kind === 'provider-context'))

  async function load(id: string): Promise<void> {
    error = null
    loading = true
    try {
      fields = (await fetchConfig(id)).fields
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function provision(): Promise<void> {
    provisionError = null
    provisioning = true
    provisioned = null
    try {
      provisioned = await provisionKaneo(contextId)
      await load(contextId)
    } catch (err) {
      provisionError = err instanceof Error ? err.message : String(err)
    } finally {
      provisioning = false
    }
  }

  $effect(() => {
    void load(contextId)
  })
</script>

<section id="task-provider" class="settings-section">
  <header class="settings-section-header">
    <div>
      <p class="eyebrow">Task provider</p>
      <h2>Task provider</h2>
    </div>
    <button type="button" onclick={() => void load(contextId)}>{loading ? 'Refreshing…' : 'Refresh'}</button>
  </header>

  {#if error !== null}
    <p class="status-error">{error}</p>
  {/if}

  {#if visible.length === 0}
    <p class="placeholder">No task-provider credentials for this context.</p>
  {:else}
    <div class="settings-field-list">
      {#each visible as field (field.key)}
        <ConfigFieldRow {contextId} {field} onSaved={() => void load(contextId)} />
      {/each}
    </div>
  {/if}

  <div class="settings-provision">
    <h3>Kaneo auto-provision</h3>
    <p class="placeholder">Creates a Kaneo account and stores its API key for this context. Credentials are shown once.</p>
    <button type="button" data-testid="provision-kaneo" disabled={provisioning} onclick={() => void provision()}>
      {provisioning ? 'Provisioning…' : 'Provision Kaneo'}
    </button>
    {#if provisionError !== null}
      <p class="status-error">{provisionError}</p>
    {/if}
    {#if provisioned !== null}
      <div class="settings-provision__reveal" data-testid="provision-result">
        <p class="status-success">Provisioned — copy these now, they will not be shown again:</p>
        <dl>
          <div><dt>Email</dt><dd>{provisioned.email}</dd></div>
          <div><dt>Password</dt><dd>{provisioned.password}</dd></div>
          <div><dt>Kaneo URL</dt><dd>{provisioned.kaneoUrl}</dd></div>
        </dl>
      </div>
    {/if}
  </div>
</section>

<style>
  .settings-field-list {
    display: grid;
    gap: 12px;
    margin-bottom: 16px;
  }
  .settings-provision {
    display: grid;
    gap: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--border);
  }
  .settings-provision button {
    justify-self: start;
    border: 1px solid var(--strong);
    background: var(--bg);
    color: var(--fg);
    padding: 8px 12px;
    border-radius: 2px;
  }
  .settings-provision__reveal dl {
    display: grid;
    gap: 6px;
  }
  .settings-provision__reveal div {
    display: flex;
    gap: 10px;
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .settings-provision__reveal dt {
    color: var(--fg3);
    min-width: 80px;
  }
</style>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/sections/TaskProviderSection.test.ts`
Expected: PASS (two tests).

- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/TaskProviderSection.svelte tests/client/settings/sections/TaskProviderSection.test.ts
git commit -m "feat(settings): task provider section with Kaneo provision"
```

---

### Task 12: Tools section (`sections/ToolsSection.svelte`)

Domain list with on/off/partial status → expand to per-tool toggles with risk indicators. Toggling a domain or a tool POSTs to `/settings/api/tools/toggle` and replaces the domain view from the response.

**Files:**

- Create: `client/settings/sections/ToolsSection.svelte`
- Test: `tests/client/settings/sections/ToolsSection.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/client/settings/sections/ToolsSection.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import ToolsSection from '../../../../client/settings/sections/ToolsSection.svelte'
import { setCsrfToken } from '../../../../client/settings/fetchers.js'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const toolsPayload = {
  contextId: 'user:1',
  domains: [
    {
      domain: 'task',
      status: 'partial',
      tools: [
        { name: 'create_task', enabled: true, risk: 'write' },
        { name: 'delete_task', enabled: false, risk: 'destructive' },
      ],
    },
  ],
}

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

describe('ToolsSection', () => {
  test('renders domains and per-tool risk', async () => {
    setMockFetch(() => Promise.resolve(json(toolsPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ToolsSection, { target, props: { contextId: 'user:1' } })
    await drain()
    expect(target.textContent).toContain('task')
    expect(target.textContent).toContain('create_task')
    expect(target.textContent).toContain('destructive')
    void unmount(component)
  })

  test('toggling a tool posts kind=tool', async () => {
    setCsrfToken('c')
    let body: string | null = null
    setMockFetch((url, init) => {
      if (url.includes('/tools/toggle')) {
        body = typeof init.body === 'string' ? init.body : null
        return Promise.resolve(json(toolsPayload))
      }
      return Promise.resolve(json(toolsPayload))
    })
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ToolsSection, { target, props: { contextId: 'user:1' } })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="tool-toggle-create_task"]')!.click()
    await drain()
    expect(body).toBe(JSON.stringify({ kind: 'tool', tool: 'create_task', contextId: 'user:1' }))
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/sections/ToolsSection.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Write the component**

`client/settings/sections/ToolsSection.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Pill from '../../shared/ui/Pill.svelte'

  import type { ToolDomainView, ToolRisk } from '../fetcher-schemas.js'
  import { fetchTools, toggleTool } from '../fetchers.js'

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  let domains: ToolDomainView[] = $state([])
  let expanded: Record<string, boolean> = $state({})
  let error: string | null = $state(null)
  let loading = $state(false)

  const riskTone = (risk: ToolRisk): 'mute' | 'info' | 'warn' | 'danger' => {
    if (risk === 'read') return 'mute'
    if (risk === 'write') return 'info'
    if (risk === 'open-world') return 'warn'
    return 'danger'
  }

  async function load(id: string): Promise<void> {
    error = null
    loading = true
    try {
      domains = (await fetchTools(id)).domains
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function onToggleDomain(domain: string): Promise<void> {
    try {
      domains = (await toggleTool({ kind: 'domain', domain, contextId })).domains
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  async function onToggleTool(tool: string): Promise<void> {
    try {
      domains = (await toggleTool({ kind: 'tool', tool, contextId })).domains
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  $effect(() => {
    void load(contextId)
  })
</script>

<section id="tools" class="settings-section">
  <header class="settings-section-header">
    <div>
      <p class="eyebrow">Tools</p>
      <h2>Tools</h2>
    </div>
    <button type="button" onclick={() => void load(contextId)}>{loading ? 'Refreshing…' : 'Refresh'}</button>
  </header>

  {#if error !== null}
    <p class="status-error">{error}</p>
  {/if}

  {#if domains.length === 0}
    <p class="placeholder">No togglable tools for this context.</p>
  {:else}
    <div class="settings-tools">
      {#each domains as domain (domain.domain)}
        <div class="settings-tools__domain">
          <div class="settings-tools__domain-head">
            <button type="button" class="settings-tools__expand" onclick={() => (expanded[domain.domain] = !expanded[domain.domain])}>
              {expanded[domain.domain] ? '▾' : '▸'} {domain.domain}
            </button>
            <span class="settings-tools__status">{domain.status}</span>
            <button
              type="button"
              data-testid={`domain-toggle-${domain.domain}`}
              onclick={() => void onToggleDomain(domain.domain)}>
              {domain.status === 'off' ? 'Enable all' : 'Disable all'}
            </button>
          </div>
          {#if expanded[domain.domain]}
            <ul class="settings-tools__list">
              {#each domain.tools as tool (tool.name)}
                <li class="settings-tools__tool">
                  <span class="settings-tools__name">{tool.name}</span>
                  <Pill tone={riskTone(tool.risk)}>{#snippet children()}{tool.risk}{/snippet}</Pill>
                  <button
                    type="button"
                    data-testid={`tool-toggle-${tool.name}`}
                    onclick={() => void onToggleTool(tool.name)}>
                    {tool.enabled ? 'Disable' : 'Enable'}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .settings-tools {
    display: grid;
    gap: 8px;
  }
  .settings-tools__domain {
    border: 1px solid var(--border);
    background: var(--surface);
  }
  .settings-tools__domain-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
  }
  .settings-tools__expand {
    background: none;
    border: none;
    color: var(--fg);
    font-family: var(--font-mono);
    font-size: 12px;
    cursor: pointer;
  }
  .settings-tools__status {
    color: var(--fg3);
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
  }
  .settings-tools__domain-head button:last-child,
  .settings-tools__tool button {
    margin-left: auto;
    border: 1px solid var(--strong);
    background: var(--bg);
    color: var(--fg);
    padding: 4px 8px;
    border-radius: 2px;
  }
  .settings-tools__list {
    list-style: none;
    margin: 0;
    padding: 0 10px 10px;
    display: grid;
    gap: 6px;
  }
  .settings-tools__tool {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .settings-tools__name {
    font-family: var(--font-mono);
    font-size: 12px;
  }
</style>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/sections/ToolsSection.test.ts`
Expected: PASS (two tests).

- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/ToolsSection.svelte tests/client/settings/sections/ToolsSection.test.ts
git commit -m "feat(settings): tools section with domain drill-down"
```

---

### Task 13: MCP section (`sections/McpSection.svelte`)

Structured rows of `{ label, url, enabled }` (header/toolFilter editing kept minimal — preserved across saves by the server's masked-header restore). "Save" sends the whole array via `PUT /settings/api/mcp`.

**Files:**

- Create: `client/settings/sections/McpSection.svelte`
- Test: `tests/client/settings/sections/McpSection.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/client/settings/sections/McpSection.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import McpSection from '../../../../client/settings/sections/McpSection.svelte'
import { setCsrfToken } from '../../../../client/settings/fetchers.js'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const mcpPayload = {
  contextId: 'user:1',
  endpoints: [{ id: 'srv1', url: 'https://mcp.example/sse', label: 'Example', enabled: true }],
}

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

describe('McpSection', () => {
  test('renders existing endpoint rows', async () => {
    setMockFetch(() => Promise.resolve(json(mcpPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(McpSection, { target, props: { contextId: 'user:1' } })
    await drain()
    expect(target.querySelector('[data-testid="mcp-row-srv1"]')).not.toBeNull()
    void unmount(component)
  })

  test('save PUTs the endpoints array', async () => {
    setCsrfToken('c')
    let method: string | undefined
    setMockFetch((url, init) => {
      if (url.includes('/settings/api/mcp') && (init.method ?? 'GET') !== 'GET') {
        method = init.method
        return Promise.resolve(json({ ok: true, contextId: 'user:1' }))
      }
      return Promise.resolve(json(mcpPayload))
    })
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(McpSection, { target, props: { contextId: 'user:1' } })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="mcp-save"]')!.click()
    await drain()
    expect(method).toBe('PUT')
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/sections/McpSection.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Write the component**

`client/settings/sections/McpSection.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { McpEndpoint } from '../fetcher-schemas.js'
  import { fetchMcp, putMcp } from '../fetchers.js'

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  let endpoints: McpEndpoint[] = $state([])
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)
  let saving = $state(false)
  let nextId = $state(1)

  async function load(id: string): Promise<void> {
    error = null
    status = null
    loading = true
    try {
      endpoints = (await fetchMcp(id)).endpoints.map((endpoint) => ({ ...endpoint }))
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  function addRow(): void {
    endpoints = [...endpoints, { id: `srv-${nextId}`, url: '', label: '', enabled: true }]
    nextId += 1
  }

  function removeRow(index: number): void {
    endpoints = endpoints.filter((_, i) => i !== index)
  }

  async function save(): Promise<void> {
    error = null
    status = null
    saving = true
    try {
      await putMcp({ endpoints, contextId })
      status = 'Saved.'
      await load(contextId)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      saving = false
    }
  }

  $effect(() => {
    void load(contextId)
  })
</script>

<section id="mcp" class="settings-section">
  <header class="settings-section-header">
    <div>
      <p class="eyebrow">Integrations</p>
      <h2>MCP endpoints</h2>
    </div>
    <button type="button" onclick={() => void load(contextId)}>{loading ? 'Refreshing…' : 'Refresh'}</button>
  </header>

  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

  <div class="settings-mcp">
    {#each endpoints as endpoint, index (endpoint.id)}
      <div class="settings-mcp__row" data-testid={`mcp-row-${endpoint.id}`}>
        <label><span>Label</span><input value={endpoint.label ?? ''} oninput={(e) => (endpoint.label = (e.target as HTMLInputElement).value)} /></label>
        <label><span>URL (https)</span><input value={endpoint.url} oninput={(e) => (endpoint.url = (e.target as HTMLInputElement).value)} /></label>
        <label class="settings-mcp__enabled">
          <input type="checkbox" checked={endpoint.enabled} onchange={(e) => (endpoint.enabled = (e.target as HTMLInputElement).checked)} />
          <span>Enabled</span>
        </label>
        <button type="button" data-testid={`mcp-remove-${endpoint.id}`} onclick={() => removeRow(index)}>Remove</button>
      </div>
    {/each}
    <div class="settings-mcp__actions">
      <button type="button" data-testid="mcp-add" onclick={addRow}>Add endpoint</button>
      <button type="button" data-testid="mcp-save" disabled={saving} onclick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button>
    </div>
  </div>
</section>

<style>
  .settings-mcp {
    display: grid;
    gap: 12px;
  }
  .settings-mcp__row {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: end;
    padding: 12px;
    border: 1px solid var(--border);
    background: var(--surface);
  }
  .settings-mcp__row label {
    display: grid;
    gap: 6px;
    min-width: 200px;
  }
  .settings-mcp__row span {
    color: var(--fg3);
    font-family: var(--font-mono);
    font-size: 11px;
  }
  .settings-mcp__row input[type='text'],
  .settings-mcp__row input:not([type]) {
    background: var(--raised);
    border: 1px solid var(--border);
    color: var(--fg);
    padding: 8px 10px;
    border-radius: 2px;
  }
  .settings-mcp__enabled {
    flex-direction: row;
    align-items: center;
    gap: 6px;
    min-width: auto;
  }
  .settings-mcp__row button,
  .settings-mcp__actions button {
    border: 1px solid var(--strong);
    background: var(--bg);
    color: var(--fg);
    padding: 8px 12px;
    border-radius: 2px;
  }
  .settings-mcp__actions {
    display: flex;
    gap: 12px;
  }
</style>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/sections/McpSection.test.ts`
Expected: PASS (two tests).

- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/McpSection.svelte tests/client/settings/sections/McpSection.test.ts
git commit -m "feat(settings): structured MCP endpoints section"
```

---

### Task 14: Plugins section (`sections/PluginsSection.svelte`)

Per-plugin enable/disable for the active context + per-context plugin config keys (via `ConfigFieldRow`-style inline editing using `patchPluginConfig`). Shows eligibility reasons (e.g. `config_missing`).

**Files:**

- Create: `client/settings/sections/PluginsSection.svelte`
- Test: `tests/client/settings/sections/PluginsSection.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/client/settings/sections/PluginsSection.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import PluginsSection from '../../../../client/settings/sections/PluginsSection.svelte'
import { setCsrfToken } from '../../../../client/settings/fetchers.js'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const pluginsPayload = {
  contextId: 'user:1',
  plugins: [
    {
      id: 'hello-world',
      name: 'Hello World',
      active: true,
      enabled: false,
      eligibility: { eligible: true },
      contextConfig: [],
    },
    {
      id: 'needs-cfg',
      name: 'Needs Config',
      active: true,
      enabled: false,
      eligibility: { eligible: false, reason: 'config_missing', missingKeys: ['token'] },
      contextConfig: [{ key: 'token', label: 'Token', required: true, sensitive: true, hasValue: false }],
    },
  ],
}

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

describe('PluginsSection', () => {
  test('renders plugins and eligibility reasons', async () => {
    setMockFetch(() => Promise.resolve(json(pluginsPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(PluginsSection, { target, props: { contextId: 'user:1' } })
    await drain()
    expect(target.textContent).toContain('Hello World')
    expect(target.textContent).toContain('config_missing')
    void unmount(component)
  })

  test('enabling an eligible plugin posts enabled=true', async () => {
    setCsrfToken('c')
    let body: string | null = null
    setMockFetch((url, init) => {
      if (url.includes('/plugins/toggle')) {
        body = typeof init.body === 'string' ? init.body : null
        return Promise.resolve(json({ ok: true, contextId: 'user:1' }))
      }
      return Promise.resolve(json(pluginsPayload))
    })
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(PluginsSection, { target, props: { contextId: 'user:1' } })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="plugin-toggle-hello-world"]')!.click()
    await drain()
    expect(body).toBe(JSON.stringify({ pluginId: 'hello-world', enabled: true, contextId: 'user:1' }))
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/sections/PluginsSection.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Write the component**

`client/settings/sections/PluginsSection.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { PluginEntry } from '../fetcher-schemas.js'
  import { fetchPlugins, patchPluginConfig, togglePlugin } from '../fetchers.js'

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  let plugins: PluginEntry[] = $state([])
  let error: string | null = $state(null)
  let loading = $state(false)
  let drafts: Record<string, string> = $state({})

  const eligibilityLabel = (plugin: PluginEntry): string => {
    if (plugin.eligibility.eligible) return 'eligible'
    if (plugin.eligibility.reason === 'config_missing') {
      return `config_missing: ${plugin.eligibility.missingKeys.join(', ')}`
    }
    if (plugin.eligibility.reason === 'capability_missing') {
      return `capability_missing: ${plugin.eligibility.missingCapabilities.join(', ')}`
    }
    return plugin.eligibility.reason
  }

  const draftKey = (pluginId: string, key: string): string => `${pluginId}::${key}`

  async function load(id: string): Promise<void> {
    error = null
    loading = true
    try {
      plugins = (await fetchPlugins(id)).plugins
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function toggle(plugin: PluginEntry): Promise<void> {
    try {
      await togglePlugin({ pluginId: plugin.id, enabled: !plugin.enabled, contextId })
      await load(contextId)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  async function saveConfig(pluginId: string, key: string): Promise<void> {
    try {
      await patchPluginConfig({ pluginId, key, value: drafts[draftKey(pluginId, key)] ?? '', contextId })
      drafts[draftKey(pluginId, key)] = ''
      await load(contextId)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  $effect(() => {
    void load(contextId)
  })
</script>

<section id="plugins" class="settings-section">
  <header class="settings-section-header">
    <div>
      <p class="eyebrow">Plugins</p>
      <h2>Plugins</h2>
    </div>
    <button type="button" onclick={() => void load(contextId)}>{loading ? 'Refreshing…' : 'Refresh'}</button>
  </header>

  {#if error !== null}<p class="status-error">{error}</p>{/if}

  {#if plugins.length === 0}
    <p class="placeholder">No plugins discovered.</p>
  {:else}
    <div class="settings-plugins">
      {#each plugins as plugin (plugin.id)}
        <div class="settings-plugins__card">
          <div class="settings-plugins__head">
            <span class="settings-plugins__name">{plugin.name}</span>
            <span class="settings-plugins__elig">{eligibilityLabel(plugin)}</span>
            <button
              type="button"
              data-testid={`plugin-toggle-${plugin.id}`}
              disabled={!plugin.active}
              onclick={() => void toggle(plugin)}>
              {plugin.enabled ? 'Disable' : 'Enable'}
            </button>
          </div>
          {#if plugin.contextConfig.length > 0}
            <div class="settings-plugins__cfg">
              {#each plugin.contextConfig as cfg (cfg.key)}
                <label>
                  <span>{cfg.label}{cfg.required ? ' *' : ''}{cfg.hasValue ? ' (set)' : ''}</span>
                  <input
                    type={cfg.sensitive ? 'password' : 'text'}
                    value={drafts[draftKey(plugin.id, cfg.key)] ?? ''}
                    placeholder={cfg.sensitive ? 'enter a new value' : ''}
                    oninput={(e) => (drafts[draftKey(plugin.id, cfg.key)] = (e.target as HTMLInputElement).value)} />
                  <button
                    type="button"
                    data-testid={`plugin-cfg-save-${plugin.id}-${cfg.key}`}
                    onclick={() => void saveConfig(plugin.id, cfg.key)}>Save</button>
                </label>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .settings-plugins {
    display: grid;
    gap: 12px;
  }
  .settings-plugins__card {
    border: 1px solid var(--border);
    background: var(--surface);
    padding: 12px;
    display: grid;
    gap: 10px;
  }
  .settings-plugins__head {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .settings-plugins__name {
    font-family: var(--font-mono);
    font-size: 13px;
  }
  .settings-plugins__elig {
    color: var(--fg3);
    font-family: var(--font-mono);
    font-size: 11px;
  }
  .settings-plugins__head button {
    margin-left: auto;
    border: 1px solid var(--strong);
    background: var(--bg);
    color: var(--fg);
    padding: 6px 10px;
    border-radius: 2px;
  }
  .settings-plugins__cfg {
    display: grid;
    gap: 10px;
  }
  .settings-plugins__cfg label {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  .settings-plugins__cfg span {
    color: var(--fg3);
    font-family: var(--font-mono);
    font-size: 11px;
    min-width: 140px;
  }
  .settings-plugins__cfg input {
    flex: 1;
    min-width: 180px;
    background: var(--raised);
    border: 1px solid var(--border);
    color: var(--fg);
    padding: 6px 10px;
    border-radius: 2px;
  }
  .settings-plugins__cfg button {
    border: 1px solid var(--strong);
    background: var(--bg);
    color: var(--fg);
    padding: 6px 10px;
    border-radius: 2px;
  }
</style>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/sections/PluginsSection.test.ts`
Expected: PASS (two tests).

- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/PluginsSection.svelte tests/client/settings/sections/PluginsSection.test.ts
git commit -m "feat(settings): plugins section (per-context enable + config)"
```

---

### Task 15: Identity section (`sections/IdentitySection.svelte`)

Shows the current provider identity mapping and lets the user set/clear it. GET returns `422` when no task instance is configured — surface that as an inline notice rather than an error toast.

**Files:**

- Create: `client/settings/sections/IdentitySection.svelte`
- Test: `tests/client/settings/sections/IdentitySection.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/client/settings/sections/IdentitySection.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import IdentitySection from '../../../../client/settings/sections/IdentitySection.svelte'
import { setCsrfToken } from '../../../../client/settings/fetchers.js'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const identityPayload = {
  contextId: 'user:1',
  providerName: 'kaneo',
  mapping: {
    providerUserId: 'u-9',
    providerUserLogin: 'jane',
    displayName: 'Jane',
    matchMethod: 'manual_nl',
    confidence: 1,
  },
}

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

describe('IdentitySection', () => {
  test('renders the current mapping', async () => {
    setMockFetch(() => Promise.resolve(json(identityPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(IdentitySection, { target, props: { contextId: 'user:1' } })
    await drain()
    expect(target.textContent).toContain('kaneo')
    expect(target.querySelector<HTMLInputElement>('[data-testid="identity-user-id"]')!.value).toBe('u-9')
    void unmount(component)
  })

  test('shows a notice when no task instance is configured (422)', async () => {
    setMockFetch(() => Promise.resolve(json({ error: 'no task instance configured for this context' }, 422)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(IdentitySection, { target, props: { contextId: 'user:1' } })
    await drain()
    expect(target.textContent).toContain('no task instance')
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/sections/IdentitySection.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Write the component**

`client/settings/sections/IdentitySection.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { IdentityResponse } from '../fetcher-schemas.js'
  import { deleteIdentity, fetchIdentity, putIdentity } from '../fetchers.js'

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  let data: IdentityResponse | null = $state(null)
  let notice: string | null = $state(null)
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let providerUserId = $state('')
  let providerUserLogin = $state('')
  let displayName = $state('')

  async function load(id: string): Promise<void> {
    error = null
    notice = null
    status = null
    data = null
    try {
      const result = await fetchIdentity(id)
      data = result
      providerUserId = result.mapping.providerUserId ?? ''
      providerUserLogin = result.mapping.providerUserLogin ?? ''
      displayName = result.mapping.displayName ?? ''
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('no task instance')) notice = message
      else error = message
    }
  }

  async function save(): Promise<void> {
    error = null
    status = null
    try {
      await putIdentity({ providerUserId, providerUserLogin, displayName, contextId })
      status = 'Identity saved.'
      await load(contextId)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  async function clear(): Promise<void> {
    error = null
    status = null
    try {
      await deleteIdentity(contextId)
      status = 'Identity cleared.'
      await load(contextId)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  $effect(() => {
    void load(contextId)
  })
</script>

<section id="identity" class="settings-section">
  <header class="settings-section-header">
    <div>
      <p class="eyebrow">Identity</p>
      <h2>Identity{#if data !== null} · {data.providerName}{/if}</h2>
    </div>
    <button type="button" onclick={() => void load(contextId)}>Refresh</button>
  </header>

  {#if notice !== null}
    <p class="placeholder">{notice}</p>
  {:else}
    {#if error !== null}<p class="status-error">{error}</p>{/if}
    {#if status !== null}<p class="status-success">{status}</p>{/if}
    <form class="settings-form" onsubmit={(event) => { event.preventDefault(); void save() }}>
      <label>
        <span>Provider user ID</span>
        <input data-testid="identity-user-id" value={providerUserId} oninput={(e) => (providerUserId = (e.target as HTMLInputElement).value)} />
      </label>
      <label>
        <span>Provider login</span>
        <input value={providerUserLogin} oninput={(e) => (providerUserLogin = (e.target as HTMLInputElement).value)} />
      </label>
      <label>
        <span>Display name</span>
        <input value={displayName} oninput={(e) => (displayName = (e.target as HTMLInputElement).value)} />
      </label>
      <button type="submit" data-testid="identity-save">Save</button>
      <button type="button" data-testid="identity-clear" onclick={() => void clear()}>Clear</button>
    </form>
  {/if}
</section>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/sections/IdentitySection.test.ts`
Expected: PASS (two tests).

- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/IdentitySection.svelte tests/client/settings/sections/IdentitySection.test.ts
git commit -m "feat(settings): identity mapping section"
```

---

# Phase 5 — Group-tier sections

These render only when the active context is a managed group (gated by `SettingsApp` in Task 25). They still take a `contextId` prop.

### Task 16: Members section (`sections/MembersSection.svelte`)

Lists group members and adds/removes them.

**Files:**

- Create: `client/settings/sections/MembersSection.svelte`
- Test: `tests/client/settings/sections/MembersSection.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/client/settings/sections/MembersSection.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import MembersSection from '../../../../client/settings/sections/MembersSection.svelte'
import { setCsrfToken } from '../../../../client/settings/fetchers.js'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const membersPayload = {
  contextId: 'group:7',
  members: [{ user_id: '42', added_by: '1', added_at: '2026-05-01' }],
}

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

describe('MembersSection', () => {
  test('lists members', async () => {
    setMockFetch(() => Promise.resolve(json(membersPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(MembersSection, { target, props: { contextId: 'group:7' } })
    await drain()
    expect(target.textContent).toContain('42')
    void unmount(component)
  })

  test('adding a member posts userId + contextId', async () => {
    setCsrfToken('c')
    let body: string | null = null
    setMockFetch((url, init) => {
      if (url.includes('/group/members') && (init.method ?? 'GET') === 'POST') {
        body = typeof init.body === 'string' ? init.body : null
        return Promise.resolve(json({ ok: true, contextId: 'group:7' }))
      }
      return Promise.resolve(json(membersPayload))
    })
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(MembersSection, { target, props: { contextId: 'group:7' } })
    await drain()
    const input = target.querySelector<HTMLInputElement>('[data-testid="member-add-input"]')!
    input.value = '99'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="member-add"]')!.click()
    await drain()
    expect(body).toBe(JSON.stringify({ userId: '99', contextId: 'group:7' }))
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/sections/MembersSection.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Write the component**

`client/settings/sections/MembersSection.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { addGroupMember, fetchGroupMembers, removeGroupMember } from '../fetchers.js'
  import type { GroupMembersResponse } from '../fetcher-schemas.js'

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  let members: GroupMembersResponse['members'] = $state([])
  let error: string | null = $state(null)
  let loading = $state(false)
  let newUserId = $state('')

  async function load(id: string): Promise<void> {
    error = null
    loading = true
    try {
      members = (await fetchGroupMembers(id)).members
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function add(): Promise<void> {
    const userId = newUserId.trim()
    if (userId === '') return
    try {
      await addGroupMember({ userId, contextId })
      newUserId = ''
      await load(contextId)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  async function remove(userId: string): Promise<void> {
    try {
      await removeGroupMember({ userId, contextId })
      await load(contextId)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  $effect(() => {
    void load(contextId)
  })
</script>

<section id="members" class="settings-section">
  <header class="settings-section-header">
    <div>
      <p class="eyebrow">Group</p>
      <h2>Members</h2>
    </div>
    <button type="button" onclick={() => void load(contextId)}>{loading ? 'Refreshing…' : 'Refresh'}</button>
  </header>

  {#if error !== null}<p class="status-error">{error}</p>{/if}

  <form class="settings-form" onsubmit={(event) => { event.preventDefault(); void add() }}>
    <label>
      <span>User ID</span>
      <input data-testid="member-add-input" value={newUserId} oninput={(e) => (newUserId = (e.target as HTMLInputElement).value)} />
    </label>
    <button type="submit" data-testid="member-add">Add member</button>
  </form>

  <div class="settings-table-wrap">
    <table class="settings-table">
      <thead><tr><th>User ID</th><th>Added by</th><th>Added at</th><th>Actions</th></tr></thead>
      <tbody>
        {#each members as member (member.user_id)}
          <tr>
            <td>{member.user_id}</td><td>{member.added_by}</td><td>{member.added_at}</td>
            <td><button type="button" data-testid={`member-remove-${member.user_id}`} onclick={() => void remove(member.user_id)}>Remove</button></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/sections/MembersSection.test.ts`
Expected: PASS (two tests).

- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/MembersSection.svelte tests/client/settings/sections/MembersSection.test.ts
git commit -m "feat(settings): group members section"
```

---

### Task 17: Group provider section (`sections/GroupProviderSection.svelte`)

Shows the group's current task-instance and lets the admin select another from `available`. (Per OQ-H2, only _selection_ is in scope here, not creation.)

**Files:**

- Create: `client/settings/sections/GroupProviderSection.svelte`
- Test: `tests/client/settings/sections/GroupProviderSection.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/client/settings/sections/GroupProviderSection.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import GroupProviderSection from '../../../../client/settings/sections/GroupProviderSection.svelte'
import { setCsrfToken } from '../../../../client/settings/fetchers.js'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const payload = {
  contextId: 'group:7',
  taskInstanceId: 'kaneo-a',
  available: [
    { id: 'kaneo-a', type: 'kaneo', status: 'active' },
    { id: 'kaneo-b', type: 'kaneo', status: 'active' },
  ],
}

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

describe('GroupProviderSection', () => {
  test('selects the current task instance and saves a change', async () => {
    setCsrfToken('c')
    let body: string | null = null
    setMockFetch((url, init) => {
      if (url.includes('/group/task-instance') && (init.method ?? 'GET') === 'PATCH') {
        body = typeof init.body === 'string' ? init.body : null
        return Promise.resolve(json({ ok: true, contextId: 'group:7' }))
      }
      return Promise.resolve(json(payload))
    })
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(GroupProviderSection, { target, props: { contextId: 'group:7' } })
    await drain()
    const select = target.querySelector<HTMLSelectElement>('[data-testid="group-task-instance"]')!
    expect(select.value).toBe('kaneo-a')
    select.value = 'kaneo-b'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="group-task-instance-save"]')!.click()
    await drain()
    expect(body).toBe(JSON.stringify({ taskInstanceId: 'kaneo-b', contextId: 'group:7' }))
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/sections/GroupProviderSection.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Write the component**

`client/settings/sections/GroupProviderSection.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { fetchGroupTaskInstance, patchGroupTaskInstance } from '../fetchers.js'
  import type { GroupTaskInstanceResponse } from '../fetcher-schemas.js'

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  let data: GroupTaskInstanceResponse | null = $state(null)
  let selected = $state('')
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)

  async function load(id: string): Promise<void> {
    error = null
    status = null
    loading = true
    try {
      const result = await fetchGroupTaskInstance(id)
      data = result
      selected = result.taskInstanceId ?? (result.available[0]?.id ?? '')
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function save(): Promise<void> {
    if (selected === '') return
    error = null
    status = null
    try {
      await patchGroupTaskInstance({ taskInstanceId: selected, contextId })
      status = 'Task instance updated.'
      await load(contextId)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  $effect(() => {
    void load(contextId)
  })
</script>

<section id="group-provider" class="settings-section">
  <header class="settings-section-header">
    <div>
      <p class="eyebrow">Group</p>
      <h2>Group task provider</h2>
    </div>
    <button type="button" onclick={() => void load(contextId)}>{loading ? 'Refreshing…' : 'Refresh'}</button>
  </header>

  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

  {#if data !== null}
    <form class="settings-form" onsubmit={(event) => { event.preventDefault(); void save() }}>
      <label>
        <span>Task instance</span>
        <select data-testid="group-task-instance" value={selected} onchange={(e) => (selected = (e.target as HTMLSelectElement).value)}>
          {#each data.available as option (option.id)}
            <option value={option.id}>{option.id} ({option.type} · {option.status})</option>
          {/each}
        </select>
      </label>
      <button type="submit" data-testid="group-task-instance-save">Save</button>
    </form>
  {/if}
</section>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/sections/GroupProviderSection.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/GroupProviderSection.svelte tests/client/settings/sections/GroupProviderSection.test.ts
git commit -m "feat(settings): group task-provider selection section"
```

---

# Phase 6 — Admin-tier sections

These render only when `settingsSession.isBotAdmin` is true (Admins + Plugin-approval additionally require `isSuperAdmin`); gating lives in `SettingsApp` (Task 25). They are global (not context-scoped), so they take no `contextId` prop. They call the session-authorized `/settings/api/admin/*` routes — never the `DEBUG_TOKEN` `/api/*` routes.

### Task 18: Admin instances (`sections/admin/AdminInstancesSection.svelte`)

Lists platform + task instances and supports create (type-driven config fields), start/stop (platform PATCH status), and delete. Mirrors `client/admin/sections/InstancesSection.svelte` markup but with the simpler `/settings/api/admin/*` surface (no apply step, no admin roster — that is Task 22).

**Files:**

- Create: `client/settings/sections/admin/AdminInstancesSection.svelte`
- Test: `tests/client/settings/sections/admin/AdminInstancesSection.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/client/settings/sections/admin/AdminInstancesSection.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import AdminInstancesSection from '../../../../../client/settings/sections/admin/AdminInstancesSection.svelte'
import { restoreFetch, setMockFetch } from '../../../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) await Promise.resolve()
  flushSync()
}

const installFetch = (): void => {
  setMockFetch((url) => {
    if (url.includes('/admin/platform-instances'))
      return Promise.resolve(
        json({ instances: [{ id: 'tg', type: 'telegram', status: 'active', config: {}, createdAt: 1 }] }),
      )
    if (url.includes('/admin/task-instances'))
      return Promise.resolve(
        json({ instances: [{ id: 'k', type: 'kaneo', status: 'active', config: {}, createdAt: 1 }] }),
      )
    if (url.includes('/admin/platform-provider-types'))
      return Promise.resolve(
        json({ providerTypes: [{ type: 'telegram', displayName: 'Telegram', instanceConfigSchema: [] }] }),
      )
    if (url.includes('/admin/task-provider-types'))
      return Promise.resolve(
        json({ providerTypes: [{ type: 'kaneo', displayName: 'Kaneo', instanceConfigSchema: [] }] }),
      )
    return Promise.resolve(json({}))
  })
}

afterEach(() => {
  restoreFetch()
})

describe('AdminInstancesSection', () => {
  test('renders platform and task instance rows', async () => {
    installFetch()
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminInstancesSection, { target })
    await drain()
    expect(target.querySelector('#instances')).not.toBeNull()
    expect(target.textContent).toContain('tg')
    expect(target.textContent).toContain('kaneo')
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/sections/admin/AdminInstancesSection.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Write the component**

`client/settings/sections/admin/AdminInstancesSection.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { AdminInstanceRow, ProviderType } from '../../fetcher-schemas.js'
  import {
    createAdminPlatformInstance,
    createAdminTaskInstance,
    deleteAdminPlatformInstance,
    deleteAdminTaskInstance,
    fetchAdminPlatformInstances,
    fetchAdminPlatformProviderTypes,
    fetchAdminTaskInstances,
    fetchAdminTaskProviderTypes,
    updateAdminPlatformInstance,
  } from '../../fetchers.js'

  let platforms: AdminInstanceRow[] = $state([])
  let tasks: AdminInstanceRow[] = $state([])
  let platformTypes: ProviderType[] = $state([])
  let taskTypes: ProviderType[] = $state([])
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)

  let platformId = $state('')
  let platformType = $state('')
  let platformConfig: Record<string, string> = $state({})
  let taskId = $state('')
  let taskType = $state('')
  let taskConfig: Record<string, string> = $state({})

  const selectedPlatformType = $derived(platformTypes.find((t) => t.type === platformType))
  const selectedTaskType = $derived(taskTypes.find((t) => t.type === taskType))

  const setErr = (err: unknown): void => {
    error = err instanceof Error ? err.message : String(err)
  }

  async function load(): Promise<void> {
    error = null
    loading = true
    try {
      const [p, t, pt, tt] = await Promise.all([
        fetchAdminPlatformInstances(),
        fetchAdminTaskInstances(),
        fetchAdminPlatformProviderTypes(),
        fetchAdminTaskProviderTypes(),
      ])
      platforms = p.instances
      tasks = t.instances
      platformTypes = pt.providerTypes
      taskTypes = tt.providerTypes
      if (platformType === '' && platformTypes.length > 0) platformType = platformTypes[0]!.type
      if (taskType === '' && taskTypes.length > 0) taskType = taskTypes[0]!.type
    } catch (err) {
      setErr(err)
    } finally {
      loading = false
    }
  }

  function collectConfig(schema: ProviderType['instanceConfigSchema'], fields: Record<string, string>): Record<string, string> {
    const config: Record<string, string> = {}
    for (const field of schema) {
      const value = (fields[field.key] ?? '').trim()
      if (field.required && value === '') throw new Error(`${field.label} is required`)
      if (value !== '') config[field.key] = value
    }
    return config
  }

  async function createPlatform(): Promise<void> {
    error = null
    status = null
    try {
      const config = collectConfig(selectedPlatformType?.instanceConfigSchema ?? [], platformConfig)
      await createAdminPlatformInstance({ id: platformId.trim(), type: platformType, config })
      platformId = ''
      platformConfig = {}
      status = 'Platform instance created.'
      await load()
    } catch (err) {
      setErr(err)
    }
  }

  async function createTask(): Promise<void> {
    error = null
    status = null
    try {
      const config = collectConfig(selectedTaskType?.instanceConfigSchema ?? [], taskConfig)
      await createAdminTaskInstance({ id: taskId.trim(), type: taskType, config })
      taskId = ''
      taskConfig = {}
      status = 'Task instance created.'
      await load()
    } catch (err) {
      setErr(err)
    }
  }

  async function toggleStatus(row: AdminInstanceRow): Promise<void> {
    try {
      await updateAdminPlatformInstance(row.id, { status: row.status === 'active' ? 'stopped' : 'active' })
      await load()
    } catch (err) {
      setErr(err)
    }
  }

  async function deletePlatform(id: string): Promise<void> {
    if (!window.confirm(`Delete platform instance ${id}?`)) return
    try {
      await deleteAdminPlatformInstance(id)
      await load()
    } catch (err) {
      setErr(err)
    }
  }

  async function deleteTask(id: string): Promise<void> {
    if (!window.confirm(`Delete task instance ${id}?`)) return
    try {
      await deleteAdminTaskInstance(id)
      await load()
    } catch (err) {
      setErr(err)
    }
  }

  $effect(() => {
    void load()
  })
</script>

<section id="instances" class="settings-section">
  <header class="settings-section-header">
    <div>
      <p class="eyebrow">Admin · Runtime</p>
      <h2>Instances</h2>
    </div>
    <button type="button" onclick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh'}</button>
  </header>

  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

  <h3>Platform instances</h3>
  <form class="settings-form" onsubmit={(event) => { event.preventDefault(); void createPlatform() }}>
    <label><span>ID</span><input data-testid="platform-id" value={platformId} oninput={(e) => (platformId = (e.target as HTMLInputElement).value)} /></label>
    <label>
      <span>Type</span>
      <select value={platformType} onchange={(e) => (platformType = (e.target as HTMLSelectElement).value)}>
        {#each platformTypes as t (t.type)}<option value={t.type}>{t.displayName}</option>{/each}
      </select>
    </label>
    {#each selectedPlatformType?.instanceConfigSchema ?? [] as field (field.key)}
      <label>
        <span>{field.label}{field.required ? ' *' : ''}</span>
        <input type={field.sensitive ? 'password' : 'text'} value={platformConfig[field.key] ?? ''} oninput={(e) => (platformConfig[field.key] = (e.target as HTMLInputElement).value)} />
      </label>
    {/each}
    <button type="submit">Create</button>
  </form>
  <div class="settings-table-wrap">
    <table class="settings-table">
      <thead><tr><th>ID</th><th>Type</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>
        {#each platforms as row (row.id)}
          <tr>
            <td>{row.id}</td><td>{row.type}</td><td>{row.status}</td>
            <td>
              <button type="button" data-testid={`platform-status-${row.id}`} onclick={() => void toggleStatus(row)}>{row.status === 'active' ? 'Stop' : 'Start'}</button>
              <button type="button" data-testid={`platform-delete-${row.id}`} onclick={() => void deletePlatform(row.id)}>Delete</button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <h3>Task instances</h3>
  <form class="settings-form" onsubmit={(event) => { event.preventDefault(); void createTask() }}>
    <label><span>ID</span><input data-testid="task-id" value={taskId} oninput={(e) => (taskId = (e.target as HTMLInputElement).value)} /></label>
    <label>
      <span>Type</span>
      <select value={taskType} onchange={(e) => (taskType = (e.target as HTMLSelectElement).value)}>
        {#each taskTypes as t (t.type)}<option value={t.type}>{t.displayName}</option>{/each}
      </select>
    </label>
    {#each selectedTaskType?.instanceConfigSchema ?? [] as field (field.key)}
      <label>
        <span>{field.label}{field.required ? ' *' : ''}</span>
        <input type={field.sensitive ? 'password' : 'text'} value={taskConfig[field.key] ?? ''} oninput={(e) => (taskConfig[field.key] = (e.target as HTMLInputElement).value)} />
      </label>
    {/each}
    <button type="submit">Create</button>
  </form>
  <div class="settings-table-wrap">
    <table class="settings-table">
      <thead><tr><th>ID</th><th>Type</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>
        {#each tasks as row (row.id)}
          <tr>
            <td>{row.id}</td><td>{row.type}</td><td>{row.status}</td>
            <td><button type="button" data-testid={`task-delete-${row.id}`} onclick={() => void deleteTask(row.id)}>Delete</button></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/sections/admin/AdminInstancesSection.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/admin/AdminInstancesSection.svelte tests/client/settings/sections/admin/AdminInstancesSection.test.ts
git commit -m "feat(settings): admin instances section"
```

---

### Task 19: Admin system/LLM (`sections/admin/AdminSystemSection.svelte`)

Edits the system LLM config keys. GET returns `{ config: { <key>: { value, updatedAt, updatedBy } } }`; values are masked server-side. Each key has an inline editor; submit POSTs `{ key, value }`.

**Files:**

- Create: `client/settings/sections/admin/AdminSystemSection.svelte`
- Test: `tests/client/settings/sections/admin/AdminSystemSection.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/client/settings/sections/admin/AdminSystemSection.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import AdminSystemSection from '../../../../../client/settings/sections/admin/AdminSystemSection.svelte'
import { setCsrfToken } from '../../../../../client/settings/fetchers.js'
import { restoreFetch, setMockFetch } from '../../../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const systemPayload = {
  config: {
    llm_apikey: { value: '****1234', updatedAt: 1, updatedBy: 'admin' },
    main_model: { value: 'gpt-main', updatedAt: 2, updatedBy: 'admin' },
  },
}

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

describe('AdminSystemSection', () => {
  test('renders one row per config key', async () => {
    setMockFetch(() => Promise.resolve(json(systemPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminSystemSection, { target })
    await drain()
    expect(target.querySelector('#system')).not.toBeNull()
    expect(target.textContent).toContain('llm_apikey')
    expect(target.textContent).toContain('gpt-main')
    void unmount(component)
  })

  test('saving a key posts key + value', async () => {
    setCsrfToken('c')
    let body: string | null = null
    setMockFetch((url, init) => {
      if (url.includes('/admin/system') && (init.method ?? 'GET') === 'POST') {
        body = typeof init.body === 'string' ? init.body : null
        return Promise.resolve(json({ ok: true, key: 'main_model' }))
      }
      return Promise.resolve(json(systemPayload))
    })
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminSystemSection, { target })
    await drain()
    const input = target.querySelector<HTMLInputElement>('[data-testid="system-input-main_model"]')!
    input.value = 'gpt-next'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="system-save-main_model"]')!.click()
    await drain()
    expect(body).toBe(JSON.stringify({ key: 'main_model', value: 'gpt-next' }))
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/sections/admin/AdminSystemSection.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Write the component**

`client/settings/sections/admin/AdminSystemSection.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { fetchAdminSystem, submitAdminSystem } from '../../fetchers.js'
  import type { AdminSystemResponse } from '../../fetcher-schemas.js'

  let config: AdminSystemResponse['config'] = $state({})
  let drafts: Record<string, string> = $state({})
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)

  const keys = $derived(Object.keys(config))

  async function load(): Promise<void> {
    error = null
    loading = true
    try {
      config = (await fetchAdminSystem()).config
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function save(key: string): Promise<void> {
    error = null
    status = null
    try {
      await submitAdminSystem({ key, value: drafts[key] ?? '' })
      drafts[key] = ''
      status = `${key} updated.`
      await load()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  $effect(() => {
    void load()
  })
</script>

<section id="system" class="settings-section">
  <header class="settings-section-header">
    <div>
      <p class="eyebrow">Admin · System</p>
      <h2>System (LLM)</h2>
    </div>
    <button type="button" onclick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh'}</button>
  </header>

  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

  <div class="settings-field-list">
    {#each keys as key (key)}
      <div class="settings-field" data-testid={`system-row-${key}`}>
        <div class="settings-field__head">
          <span class="settings-field__label">{key}</span>
          {#if config[key]?.value !== null}<span class="masked-value">{config[key]?.value}</span>{:else}<span class="placeholder">unset</span>{/if}
        </div>
        <div class="settings-field__editor">
          <input
            data-testid={`system-input-${key}`}
            value={drafts[key] ?? ''}
            placeholder="enter a new value"
            oninput={(e) => (drafts[key] = (e.target as HTMLInputElement).value)} />
          <button type="button" data-testid={`system-save-${key}`} onclick={() => void save(key)}>Save</button>
        </div>
      </div>
    {/each}
  </div>
</section>

<style>
  .settings-field-list {
    display: grid;
    gap: 12px;
  }
  .settings-field {
    display: grid;
    gap: 8px;
    padding: 12px;
    border: 1px solid var(--border);
    background: var(--surface);
  }
  .settings-field__head {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .settings-field__label {
    color: var(--fg2);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .settings-field__editor {
    display: flex;
    gap: 8px;
  }
  .settings-field__editor input {
    flex: 1;
    background: var(--raised);
    border: 1px solid var(--border);
    color: var(--fg);
    padding: 8px 10px;
    border-radius: 2px;
  }
  .settings-field__editor button {
    border: 1px solid var(--strong);
    background: var(--bg);
    color: var(--fg);
    padding: 8px 12px;
    border-radius: 2px;
  }
</style>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/sections/admin/AdminSystemSection.test.ts`
Expected: PASS (two tests).

- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/admin/AdminSystemSection.svelte tests/client/settings/sections/admin/AdminSystemSection.test.ts
git commit -m "feat(settings): admin system/LLM section"
```

---

### Task 20: Admin users (`sections/admin/AdminUsersSection.svelte`)

Lists authorized users for the principal's platform instance; add/remove.

**Files:**

- Create: `client/settings/sections/admin/AdminUsersSection.svelte`
- Test: `tests/client/settings/sections/admin/AdminUsersSection.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/client/settings/sections/admin/AdminUsersSection.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import AdminUsersSection from '../../../../../client/settings/sections/admin/AdminUsersSection.svelte'
import { setCsrfToken } from '../../../../../client/settings/fetchers.js'
import { restoreFetch, setMockFetch } from '../../../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const usersPayload = { users: [{ platform_user_id: '42', platform_instance_id: 'tg', username: 'jane' }] }

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

describe('AdminUsersSection', () => {
  test('lists users', async () => {
    setMockFetch(() => Promise.resolve(json(usersPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    expect(target.querySelector('#users')).not.toBeNull()
    expect(target.textContent).toContain('jane')
    void unmount(component)
  })

  test('adding a user posts userId', async () => {
    setCsrfToken('c')
    let body: string | null = null
    setMockFetch((url, init) => {
      if (url.includes('/admin/users') && (init.method ?? 'GET') === 'POST') {
        body = typeof init.body === 'string' ? init.body : null
        return Promise.resolve(json({ ok: true }))
      }
      return Promise.resolve(json(usersPayload))
    })
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    const input = target.querySelector<HTMLInputElement>('[data-testid="user-add-input"]')!
    input.value = '99'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="user-add"]')!.click()
    await drain()
    expect(body).toBe(JSON.stringify({ userId: '99' }))
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/sections/admin/AdminUsersSection.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Write the component**

`client/settings/sections/admin/AdminUsersSection.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { addAdminUser, fetchAdminUsers, removeAdminUser } from '../../fetchers.js'
  import type { AdminUserRow } from '../../fetcher-schemas.js'

  let users: AdminUserRow[] = $state([])
  let error: string | null = $state(null)
  let loading = $state(false)
  let newUserId = $state('')
  let newUsername = $state('')

  async function load(): Promise<void> {
    error = null
    loading = true
    try {
      users = (await fetchAdminUsers()).users
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function add(): Promise<void> {
    const userId = newUserId.trim()
    if (userId === '') return
    try {
      const username = newUsername.trim()
      await addAdminUser(username === '' ? { userId } : { userId, username })
      newUserId = ''
      newUsername = ''
      await load()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  async function remove(userId: string): Promise<void> {
    try {
      await removeAdminUser({ userId })
      await load()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  $effect(() => {
    void load()
  })
</script>

<section id="users" class="settings-section">
  <header class="settings-section-header">
    <div>
      <p class="eyebrow">Admin · Access</p>
      <h2>Users</h2>
    </div>
    <button type="button" onclick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh'}</button>
  </header>

  {#if error !== null}<p class="status-error">{error}</p>{/if}

  <form class="settings-form" onsubmit={(event) => { event.preventDefault(); void add() }}>
    <label><span>User ID</span><input data-testid="user-add-input" value={newUserId} oninput={(e) => (newUserId = (e.target as HTMLInputElement).value)} /></label>
    <label><span>Username (optional)</span><input value={newUsername} oninput={(e) => (newUsername = (e.target as HTMLInputElement).value)} /></label>
    <button type="submit" data-testid="user-add">Add user</button>
  </form>

  <div class="settings-table-wrap">
    <table class="settings-table">
      <thead><tr><th>User ID</th><th>Username</th><th>Actions</th></tr></thead>
      <tbody>
        {#each users as user (user.platform_user_id)}
          <tr>
            <td>{user.platform_user_id}</td><td>{user.username ?? '—'}</td>
            <td><button type="button" data-testid={`user-remove-${user.platform_user_id}`} onclick={() => void remove(user.platform_user_id)}>Remove</button></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/sections/admin/AdminUsersSection.test.ts`
Expected: PASS (two tests).

- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/admin/AdminUsersSection.svelte tests/client/settings/sections/admin/AdminUsersSection.test.ts
git commit -m "feat(settings): admin users section"
```

---

### Task 21: Admin groups (`sections/admin/AdminGroupsSection.svelte`)

Lists authorized groups; add/remove.

**Files:**

- Create: `client/settings/sections/admin/AdminGroupsSection.svelte`
- Test: `tests/client/settings/sections/admin/AdminGroupsSection.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/client/settings/sections/admin/AdminGroupsSection.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import AdminGroupsSection from '../../../../../client/settings/sections/admin/AdminGroupsSection.svelte'
import { setCsrfToken } from '../../../../../client/settings/fetchers.js'
import { restoreFetch, setMockFetch } from '../../../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const groupsPayload = { groups: [{ group_id: 'g-1', added_by: '1', added_at: '2026-05-01' }] }

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

describe('AdminGroupsSection', () => {
  test('lists groups and adds one', async () => {
    setCsrfToken('c')
    let body: string | null = null
    setMockFetch((url, init) => {
      if (url.includes('/admin/groups') && (init.method ?? 'GET') === 'POST') {
        body = typeof init.body === 'string' ? init.body : null
        return Promise.resolve(json({ ok: true }))
      }
      return Promise.resolve(json(groupsPayload))
    })
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminGroupsSection, { target })
    await drain()
    expect(target.querySelector('#groups')).not.toBeNull()
    expect(target.textContent).toContain('g-1')
    const input = target.querySelector<HTMLInputElement>('[data-testid="group-add-input"]')!
    input.value = 'g-2'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="group-add"]')!.click()
    await drain()
    expect(body).toBe(JSON.stringify({ groupId: 'g-2' }))
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/sections/admin/AdminGroupsSection.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Write the component**

`client/settings/sections/admin/AdminGroupsSection.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { addAdminGroup, fetchAdminGroups, removeAdminGroup } from '../../fetchers.js'
  import type { AdminGroupRow } from '../../fetcher-schemas.js'

  let groups: AdminGroupRow[] = $state([])
  let error: string | null = $state(null)
  let loading = $state(false)
  let newGroupId = $state('')

  async function load(): Promise<void> {
    error = null
    loading = true
    try {
      groups = (await fetchAdminGroups()).groups
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function add(): Promise<void> {
    const groupId = newGroupId.trim()
    if (groupId === '') return
    try {
      await addAdminGroup({ groupId })
      newGroupId = ''
      await load()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  async function remove(groupId: string): Promise<void> {
    try {
      await removeAdminGroup({ groupId })
      await load()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  $effect(() => {
    void load()
  })
</script>

<section id="groups" class="settings-section">
  <header class="settings-section-header">
    <div>
      <p class="eyebrow">Admin · Access</p>
      <h2>Groups</h2>
    </div>
    <button type="button" onclick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh'}</button>
  </header>

  {#if error !== null}<p class="status-error">{error}</p>{/if}

  <form class="settings-form" onsubmit={(event) => { event.preventDefault(); void add() }}>
    <label><span>Group ID</span><input data-testid="group-add-input" value={newGroupId} oninput={(e) => (newGroupId = (e.target as HTMLInputElement).value)} /></label>
    <button type="submit" data-testid="group-add">Add group</button>
  </form>

  <div class="settings-table-wrap">
    <table class="settings-table">
      <thead><tr><th>Group ID</th><th>Added by</th><th>Added at</th><th>Actions</th></tr></thead>
      <tbody>
        {#each groups as group (group.group_id)}
          <tr>
            <td>{group.group_id}</td><td>{group.added_by}</td><td>{group.added_at}</td>
            <td><button type="button" data-testid={`group-remove-${group.group_id}`} onclick={() => void remove(group.group_id)}>Remove</button></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/sections/admin/AdminGroupsSection.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/admin/AdminGroupsSection.svelte tests/client/settings/sections/admin/AdminGroupsSection.test.ts
git commit -m "feat(settings): admin groups section"
```

---

### Task 22: Admin roster (`sections/admin/AdminAdminsSection.svelte`) — SA only

Lists admins and (super-admin only) adds/removes platform-scoped admins. The section is only mounted when `isSuperAdmin` (gated in Task 25), but the server still enforces SA on writes.

**Files:**

- Create: `client/settings/sections/admin/AdminAdminsSection.svelte`
- Test: `tests/client/settings/sections/admin/AdminAdminsSection.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/client/settings/sections/admin/AdminAdminsSection.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import AdminAdminsSection from '../../../../../client/settings/sections/admin/AdminAdminsSection.svelte'
import { setCsrfToken } from '../../../../../client/settings/fetchers.js'
import { restoreFetch, setMockFetch } from '../../../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const rosterPayload = { admins: [{ userId: '1', platformInstanceId: 'tg', createdAt: 1 }] }

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

describe('AdminAdminsSection', () => {
  test('lists admins and adds one', async () => {
    setCsrfToken('c')
    let body: string | null = null
    setMockFetch((url, init) => {
      if (url.includes('/admin/admins') && (init.method ?? 'GET') === 'POST') {
        body = typeof init.body === 'string' ? init.body : null
        return Promise.resolve(json({ ok: true }))
      }
      return Promise.resolve(json(rosterPayload))
    })
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminAdminsSection, { target })
    await drain()
    expect(target.querySelector('#admins')).not.toBeNull()
    const userInput = target.querySelector<HTMLInputElement>('[data-testid="admin-user-input"]')!
    userInput.value = '2'
    userInput.dispatchEvent(new Event('input', { bubbles: true }))
    const platformInput = target.querySelector<HTMLInputElement>('[data-testid="admin-platform-input"]')!
    platformInput.value = 'tg'
    platformInput.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="admin-add"]')!.click()
    await drain()
    expect(body).toBe(JSON.stringify({ userId: '2', platformInstanceId: 'tg' }))
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/sections/admin/AdminAdminsSection.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Write the component**

`client/settings/sections/admin/AdminAdminsSection.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { addRosterAdmin, fetchAdminRoster, removeRosterAdmin } from '../../fetchers.js'
  import type { AdminRosterRow } from '../../fetcher-schemas.js'

  let admins: AdminRosterRow[] = $state([])
  let error: string | null = $state(null)
  let loading = $state(false)
  let userId = $state('')
  let platformInstanceId = $state('')

  async function load(): Promise<void> {
    error = null
    loading = true
    try {
      admins = (await fetchAdminRoster()).admins
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function add(): Promise<void> {
    const u = userId.trim()
    const p = platformInstanceId.trim()
    if (u === '' || p === '') return
    try {
      await addRosterAdmin({ userId: u, platformInstanceId: p })
      userId = ''
      platformInstanceId = ''
      await load()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  async function remove(row: AdminRosterRow): Promise<void> {
    try {
      await removeRosterAdmin({ userId: row.userId, platformInstanceId: row.platformInstanceId })
      await load()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  $effect(() => {
    void load()
  })
</script>

<section id="admins" class="settings-section">
  <header class="settings-section-header">
    <div>
      <p class="eyebrow">Admin · Roster</p>
      <h2>Admins</h2>
    </div>
    <button type="button" onclick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh'}</button>
  </header>

  {#if error !== null}<p class="status-error">{error}</p>{/if}

  <form class="settings-form" onsubmit={(event) => { event.preventDefault(); void add() }}>
    <label><span>User ID</span><input data-testid="admin-user-input" value={userId} oninput={(e) => (userId = (e.target as HTMLInputElement).value)} /></label>
    <label><span>Platform instance ID</span><input data-testid="admin-platform-input" value={platformInstanceId} oninput={(e) => (platformInstanceId = (e.target as HTMLInputElement).value)} /></label>
    <button type="submit" data-testid="admin-add">Add admin</button>
  </form>

  <div class="settings-table-wrap">
    <table class="settings-table">
      <thead><tr><th>User ID</th><th>Platform instance</th><th>Actions</th></tr></thead>
      <tbody>
        {#each admins as admin (`${admin.userId}:${admin.platformInstanceId}`)}
          <tr>
            <td>{admin.userId}</td><td>{admin.platformInstanceId}</td>
            <td><button type="button" data-testid={`admin-remove-${admin.userId}`} onclick={() => void remove(admin)}>Remove</button></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/sections/admin/AdminAdminsSection.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/admin/AdminAdminsSection.svelte tests/client/settings/sections/admin/AdminAdminsSection.test.ts
git commit -m "feat(settings): admin roster section (SA)"
```

---

### Task 23: Plugin approval (`sections/admin/AdminPluginsApprovalSection.svelte`) — SA only

Lists discovered plugins (reusing the `/settings/api/plugins` GET against the personal context for the catalog) and approves/rejects via `POST /settings/api/admin/plugin-approval`.

**Files:**

- Create: `client/settings/sections/admin/AdminPluginsApprovalSection.svelte`
- Test: `tests/client/settings/sections/admin/AdminPluginsApprovalSection.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/client/settings/sections/admin/AdminPluginsApprovalSection.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import AdminPluginsApprovalSection from '../../../../../client/settings/sections/admin/AdminPluginsApprovalSection.svelte'
import { setCsrfToken } from '../../../../../client/settings/fetchers.js'
import { restoreFetch, setMockFetch } from '../../../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const pluginsPayload = {
  contextId: 'user:1',
  plugins: [
    {
      id: 'hello-world',
      name: 'Hello World',
      active: false,
      enabled: false,
      eligibility: { eligible: false, reason: 'inactive' },
      contextConfig: [],
    },
  ],
}

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

describe('AdminPluginsApprovalSection', () => {
  test('approves a plugin', async () => {
    setCsrfToken('c')
    let body: string | null = null
    setMockFetch((url, init) => {
      if (url.includes('/admin/plugin-approval')) {
        body = typeof init.body === 'string' ? init.body : null
        return Promise.resolve(json({ ok: true, state: 'approved' }))
      }
      return Promise.resolve(json(pluginsPayload))
    })
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminPluginsApprovalSection, { target, props: { catalogContextId: 'user:1' } })
    await drain()
    expect(target.querySelector('#plugin-approval')).not.toBeNull()
    target.querySelector<HTMLButtonElement>('[data-testid="plugin-approve-hello-world"]')!.click()
    await drain()
    expect(body).toBe(JSON.stringify({ pluginId: 'hello-world', action: 'approve' }))
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/sections/admin/AdminPluginsApprovalSection.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Write the component**

`client/settings/sections/admin/AdminPluginsApprovalSection.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { fetchPlugins, setPluginApproval } from '../../fetchers.js'
  import type { PluginEntry } from '../../fetcher-schemas.js'

  interface Props {
    catalogContextId: string
  }

  let { catalogContextId }: Props = $props()

  let plugins: PluginEntry[] = $state([])
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)

  async function load(): Promise<void> {
    error = null
    loading = true
    try {
      plugins = (await fetchPlugins(catalogContextId)).plugins
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function decide(pluginId: string, action: 'approve' | 'reject'): Promise<void> {
    error = null
    status = null
    try {
      const result = await setPluginApproval({ pluginId, action })
      status = `${pluginId}: ${result.state ?? action}`
      await load()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  $effect(() => {
    void load()
  })
</script>

<section id="plugin-approval" class="settings-section">
  <header class="settings-section-header">
    <div>
      <p class="eyebrow">Admin · Plugins</p>
      <h2>Plugin approval</h2>
    </div>
    <button type="button" onclick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh'}</button>
  </header>

  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

  <div class="settings-table-wrap">
    <table class="settings-table">
      <thead><tr><th>Plugin</th><th>Active</th><th>Actions</th></tr></thead>
      <tbody>
        {#each plugins as plugin (plugin.id)}
          <tr>
            <td>{plugin.name} <span class="placeholder">({plugin.id})</span></td>
            <td>{plugin.active ? 'yes' : 'no'}</td>
            <td>
              <button type="button" data-testid={`plugin-approve-${plugin.id}`} onclick={() => void decide(plugin.id, 'approve')}>Approve</button>
              <button type="button" data-testid={`plugin-reject-${plugin.id}`} onclick={() => void decide(plugin.id, 'reject')}>Reject</button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/sections/admin/AdminPluginsApprovalSection.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/admin/AdminPluginsApprovalSection.svelte tests/client/settings/sections/admin/AdminPluginsApprovalSection.test.ts
git commit -m "feat(settings): plugin approval section (SA)"
```

---

### Task 24: Announce (`sections/admin/AdminAnnounceSection.svelte`)

Broadcasts a message; shows the delivery result counts.

**Files:**

- Create: `client/settings/sections/admin/AdminAnnounceSection.svelte`
- Test: `tests/client/settings/sections/admin/AdminAnnounceSection.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/client/settings/sections/admin/AdminAnnounceSection.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import AdminAnnounceSection from '../../../../../client/settings/sections/admin/AdminAnnounceSection.svelte'
import { setCsrfToken } from '../../../../../client/settings/fetchers.js'
import { restoreFetch, setMockFetch } from '../../../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

describe('AdminAnnounceSection', () => {
  test('sends a message and shows result counts', async () => {
    setCsrfToken('c')
    let body: string | null = null
    setMockFetch((_url, init) => {
      body = typeof init.body === 'string' ? init.body : null
      return Promise.resolve(json({ totalUsers: 3, successCount: 2, failCount: 1 }))
    })
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminAnnounceSection, { target })
    flushSync()
    const textarea = target.querySelector<HTMLTextAreaElement>('[data-testid="announce-message"]')!
    textarea.value = 'hello all'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="announce-send"]')!.click()
    await drain()
    expect(body).toBe(JSON.stringify({ message: 'hello all' }))
    expect(target.textContent).toContain('2')
    expect(target.textContent).toContain('1')
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/sections/admin/AdminAnnounceSection.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Write the component**

`client/settings/sections/admin/AdminAnnounceSection.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { sendAnnounce } from '../../fetchers.js'
  import type { AnnounceResult } from '../../fetcher-schemas.js'

  let message = $state('')
  let error: string | null = $state(null)
  let result: AnnounceResult | null = $state(null)
  let sending = $state(false)

  async function send(): Promise<void> {
    const text = message.trim()
    if (text === '') return
    error = null
    result = null
    sending = true
    try {
      result = await sendAnnounce({ message: text })
      message = ''
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      sending = false
    }
  }
</script>

<section id="announce" class="settings-section">
  <header class="settings-section-header">
    <div>
      <p class="eyebrow">Admin</p>
      <h2>Announce</h2>
    </div>
  </header>

  {#if error !== null}<p class="status-error">{error}</p>{/if}

  <form class="settings-form" onsubmit={(event) => { event.preventDefault(); void send() }}>
    <label style="flex: 1; min-width: 280px;">
      <span>Message</span>
      <textarea data-testid="announce-message" rows="3" value={message} oninput={(e) => (message = (e.target as HTMLTextAreaElement).value)}></textarea>
    </label>
    <button type="submit" data-testid="announce-send" disabled={sending}>{sending ? 'Sending…' : 'Send announcement'}</button>
  </form>

  {#if result !== null}
    <p class="status-success" data-testid="announce-result">
      Delivered to {result.successCount}/{result.totalUsers} (failed: {result.failCount}).
    </p>
  {/if}
</section>

<style>
  textarea {
    background: var(--raised);
    border: 1px solid var(--border);
    color: var(--fg);
    padding: 8px 10px;
    border-radius: 2px;
    font-family: var(--font-mono);
    width: 100%;
    resize: vertical;
  }
</style>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/sections/admin/AdminAnnounceSection.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/admin/AdminAnnounceSection.svelte tests/client/settings/sections/admin/AdminAnnounceSection.test.ts
git commit -m "feat(settings): announce section"
```

---

# Phase 7 — App composition & entry

### Task 25: Root app (`SettingsApp.svelte`)

Composes the shell. Renders a gate message when `status !== 'ready'`. When ready: builds the visible section list from role flags + the active context kind, renders the top bar, the role-gated sidebar, and the section components, and runs the scroll-spy (restarting when the section list changes). Each user/group section receives `contextId={settingsSession.activeContextId}`.

**Files:**

- Create: `client/settings/SettingsApp.svelte`
- Test: `tests/client/settings/SettingsApp.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/client/settings/SettingsApp.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import SettingsApp from '../../../client/settings/SettingsApp.svelte'
import { settingsSession } from '../../../client/settings/session.svelte.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const drain = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
  flushSync()
}

const mountApp = (): ReturnType<typeof mount> => {
  document.body.innerHTML = '<div id="root"></div>'
  history.replaceState(null, '', '/settings')
  const target = document.querySelector<HTMLElement>('#root')!
  return mount(SettingsApp, { target })
}

const seed = (overrides: Partial<typeof settingsSession>): void => {
  settingsSession.status = 'ready'
  settingsSession.display = 'alice'
  settingsSession.isBotAdmin = false
  settingsSession.isSuperAdmin = false
  settingsSession.contexts = [{ kind: 'personal', contextId: 'user:1', label: 'Personal' }]
  settingsSession.activeContextId = 'user:1'
  Object.assign(settingsSession, overrides)
}

afterEach(() => {
  restoreFetch()
  settingsSession.status = 'loading'
})

describe('SettingsApp', () => {
  test('renders the gate message when unauthenticated', async () => {
    setMockFetch(() => Promise.resolve(new Response('{}')))
    settingsSession.status = 'unauthenticated'
    const component = mountApp()
    await drain()
    expect(document.body.textContent).toContain('/config')
    expect(document.querySelector('#profile')).toBeNull()
    void unmount(component)
  })

  test('renders the always-on user sections for a personal context', async () => {
    setMockFetch(() => Promise.resolve(new Response('{}')))
    seed({})
    const component = mountApp()
    await drain()
    for (const id of ['profile', 'task-provider', 'tools', 'mcp', 'plugins', 'identity']) {
      expect(document.querySelector(`#${id}`)).not.toBeNull()
    }
    expect(document.querySelector('#members')).toBeNull()
    expect(document.querySelector('#instances')).toBeNull()
    void unmount(component)
  })

  test('shows group sections when the active context is a group', async () => {
    setMockFetch(() => Promise.resolve(new Response('{}')))
    seed({
      contexts: [
        { kind: 'personal', contextId: 'user:1', label: 'Personal' },
        { kind: 'group', contextId: 'group:7', label: 'Team' },
      ],
      activeContextId: 'group:7',
    })
    const component = mountApp()
    await drain()
    expect(document.querySelector('#members')).not.toBeNull()
    expect(document.querySelector('#group-provider')).not.toBeNull()
    void unmount(component)
  })

  test('shows admin sections for a bot admin and SA-only sections for a super admin', async () => {
    setMockFetch(() => Promise.resolve(new Response('{}')))
    seed({ isBotAdmin: true, isSuperAdmin: true })
    const component = mountApp()
    await drain()
    for (const id of ['instances', 'system', 'users', 'groups', 'announce', 'admins', 'plugin-approval']) {
      expect(document.querySelector(`#${id}`)).not.toBeNull()
    }
    void unmount(component)
  })

  test('hides SA-only sections for a non-super bot admin', async () => {
    setMockFetch(() => Promise.resolve(new Response('{}')))
    seed({ isBotAdmin: true, isSuperAdmin: false })
    const component = mountApp()
    await drain()
    expect(document.querySelector('#instances')).not.toBeNull()
    expect(document.querySelector('#admins')).toBeNull()
    expect(document.querySelector('#plugin-approval')).toBeNull()
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/SettingsApp.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Write the component**

`client/settings/SettingsApp.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Shell from '../shared/ui/Shell.svelte'

  import SettingsSidebar from './components/SettingsSidebar.svelte'
  import type { SidebarItem } from './components/SettingsSidebar.svelte'
  import SettingsTopBar from './components/SettingsTopBar.svelte'
  import { useScrollSpy } from './scrollspy.js'
  import { activeContext, settingsSession } from './session.svelte.js'
  import ProfileSection from './sections/ProfileSection.svelte'
  import TaskProviderSection from './sections/TaskProviderSection.svelte'
  import ToolsSection from './sections/ToolsSection.svelte'
  import McpSection from './sections/McpSection.svelte'
  import PluginsSection from './sections/PluginsSection.svelte'
  import IdentitySection from './sections/IdentitySection.svelte'
  import MembersSection from './sections/MembersSection.svelte'
  import GroupProviderSection from './sections/GroupProviderSection.svelte'
  import AdminInstancesSection from './sections/admin/AdminInstancesSection.svelte'
  import AdminSystemSection from './sections/admin/AdminSystemSection.svelte'
  import AdminUsersSection from './sections/admin/AdminUsersSection.svelte'
  import AdminGroupsSection from './sections/admin/AdminGroupsSection.svelte'
  import AdminAdminsSection from './sections/admin/AdminAdminsSection.svelte'
  import AdminPluginsApprovalSection from './sections/admin/AdminPluginsApprovalSection.svelte'
  import AdminAnnounceSection from './sections/admin/AdminAnnounceSection.svelte'

  let activeId = $state('profile')

  const isGroup = $derived(activeContext()?.kind === 'group')

  const items = $derived.by((): SidebarItem[] => {
    const list: SidebarItem[] = [
      { id: 'profile', label: 'Profile' },
      { id: 'task-provider', label: 'Task provider' },
      { id: 'tools', label: 'Tools' },
      { id: 'mcp', label: 'MCP' },
      { id: 'plugins', label: 'Plugins' },
      { id: 'identity', label: 'Identity' },
    ]
    if (isGroup) {
      list.push({ id: 'members', label: 'Members' }, { id: 'group-provider', label: 'Group provider' })
    }
    if (settingsSession.isBotAdmin) {
      list.push(
        { id: 'instances', label: 'Instances' },
        { id: 'system', label: 'System' },
        { id: 'users', label: 'Users' },
        { id: 'groups', label: 'Groups' },
        { id: 'announce', label: 'Announce' },
      )
    }
    if (settingsSession.isSuperAdmin) {
      list.push({ id: 'admins', label: 'Admins' }, { id: 'plugin-approval', label: 'Plugin approval' })
    }
    return list
  })

  const ctx = $derived(settingsSession.activeContextId)

  $effect(() => {
    if (settingsSession.status !== 'ready') return
    const ids = items.map((item) => item.id)
    const spy = useScrollSpy(ids, (id) => {
      activeId = id
      if (window.location.hash !== `#${id}`) window.history.replaceState(null, '', `#${id}`)
    })
    spy.start()
    return (): void => spy.stop()
  })
</script>

{#if settingsSession.status === 'loading'}
  <main class="settings-gate"><p>Loading…</p></main>
{:else if settingsSession.status === 'unauthenticated'}
  <main class="settings-gate">
    <h1>Session expired or missing</h1>
    <p>Request a new settings link by sending <code>/config</code> to the bot.</p>
  </main>
{:else}
  <Shell>
    {#snippet topBar()}
      <SettingsTopBar />
    {/snippet}
    {#snippet children()}
      <div class="settings-grid">
        <SettingsSidebar {items} {activeId} />
        <main class="settings-grid__main">
          <ProfileSection contextId={ctx} />
          <TaskProviderSection contextId={ctx} />
          <ToolsSection contextId={ctx} />
          <McpSection contextId={ctx} />
          <PluginsSection contextId={ctx} />
          <IdentitySection contextId={ctx} />
          {#if isGroup}
            <MembersSection contextId={ctx} />
            <GroupProviderSection contextId={ctx} />
          {/if}
          {#if settingsSession.isBotAdmin}
            <AdminInstancesSection />
            <AdminSystemSection />
            <AdminUsersSection />
            <AdminGroupsSection />
            <AdminAnnounceSection />
          {/if}
          {#if settingsSession.isSuperAdmin}
            <AdminAdminsSection />
            <AdminPluginsApprovalSection catalogContextId={ctx} />
          {/if}
        </main>
      </div>
    {/snippet}
  </Shell>
{/if}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/SettingsApp.test.ts`
Expected: PASS (five tests).

- [ ] **Step 5: Commit**

```bash
git add client/settings/SettingsApp.svelte tests/client/settings/SettingsApp.test.ts
git commit -m "feat(settings): root app shell with role + context gating"
```

---

### Task 26: Entry point (`index.ts`) — replaces the Task 1 stub

Reads `?code=` from the URL, runs the session bootstrap, strips the code from the URL (history replace), registers the expiry handler, and mounts `SettingsApp`.

**Files:**

- Modify (replace stub): `client/settings/index.ts`
- Modify (replace stub): `tests/client/settings/index.test.ts`

- [ ] **Step 1: Replace the stub test with the real failing test**

`tests/client/settings/index.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { readCodeFromLocation, start, stripCodeFromUrl } from '../../../client/settings/index.js'
import { settingsSession } from '../../../client/settings/session.svelte.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

afterEach(() => {
  restoreFetch()
  settingsSession.status = 'loading'
  history.replaceState(null, '', '/settings')
})

describe('settings entry', () => {
  test('readCodeFromLocation extracts a non-empty code', () => {
    expect(readCodeFromLocation('?code=ABC')).toBe('ABC')
    expect(readCodeFromLocation('?code=')).toBeNull()
    expect(readCodeFromLocation('')).toBeNull()
  })

  test('stripCodeFromUrl removes the code param', () => {
    history.replaceState(null, '', '/settings?code=ABC&x=1')
    stripCodeFromUrl()
    expect(window.location.search).not.toContain('code=')
    expect(window.location.search).toContain('x=1')
  })

  test('start bootstraps and mounts the app into the target', async () => {
    setMockFetch(() =>
      Promise.resolve(
        json({
          csrfToken: 't',
          display: 'a',
          principal: { isBotAdmin: false, isSuperAdmin: false },
          contexts: [{ kind: 'personal', contextId: 'user:1', label: 'Personal' }],
        }),
      ),
    )
    history.replaceState(null, '', '/settings?code=ABC')
    document.body.innerHTML = '<div id="app"></div>'
    const target = document.querySelector<HTMLElement>('#app')!
    await start(target)
    await drain()
    expect(settingsSession.status).toBe('ready')
    expect(window.location.search).not.toContain('code=')
    expect(document.querySelector('#profile')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/index.test.ts`
Expected: FAIL — `readCodeFromLocation`/`start`/`stripCodeFromUrl` not exported (the stub only exports `SETTINGS_ENTRY_PLACEHOLDER`).

- [ ] **Step 3: Replace the stub entry with the real entry**

`client/settings/index.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/// <reference lib="dom" />
import { mount } from 'svelte'

import SettingsApp from './SettingsApp.svelte'
import { bootstrapSession, registerExpiryHandler } from './session.svelte.js'

export function readCodeFromLocation(search: string): string | null {
  const params = new URLSearchParams(search)
  const code = params.get('code')
  return code !== null && code.length > 0 ? code : null
}

export function stripCodeFromUrl(): void {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('code')) return
  url.searchParams.delete('code')
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}

export async function start(target: Element): Promise<void> {
  registerExpiryHandler()
  const code = readCodeFromLocation(window.location.search)
  await bootstrapSession(code)
  if (code !== null) stripCodeFromUrl()
  mount(SettingsApp, { target })
}

if (typeof document !== 'undefined' && document.getElementById('app') !== null) {
  void start(document.getElementById('app')!)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/index.test.ts`
Expected: PASS (three tests).

- [ ] **Step 5: Commit**

```bash
git add client/settings/index.ts tests/client/settings/index.test.ts
git commit -m "feat(settings): SPA entry point with session bootstrap"
```

---

### Task 27: Full-suite verification

- [ ] **Step 1: Run the full client suite**

Run: `bun test:client`
Expected: PASS, including every `tests/client/settings/**` file.

- [ ] **Step 2: Rebuild and re-check bundle isolation**

Run: `bun build:client && bun check:bundle-isolation`
Expected: builds all three bundles; isolation check exits 0.

- [ ] **Step 3: Typecheck**

Run: `bun typecheck`
Expected: no errors.

- [ ] **Step 4: Lint the new client paths**

Run: `bun lint:agent-strict -- client/settings`
Expected: no errors. (If `max-lines`/`max-lines-per-function` fires on a section, extract a child component or helper — do not add suppression comments.)

- [ ] **Step 5: Commit any fixups**

```bash
git add -A
git commit -m "chore(settings): client SPA full-suite green"
```

---

## Self-Review

**1. Spec coverage (Part B):**

- Stack & build integration → Tasks 1–2 (third `BUNDLES` entry, `settings.html` with strict CSP, public static serving, bundle-isolation guard updated).
- Entry & session bootstrap (code exchange, code-stripping, in-memory CSRF, no-login gate) → Tasks 4 (`exchangeCode`), 5 (`bootstrapSession`), 26 (`start`/`stripCodeFromUrl`).
- Layout (root app, context switcher, role-gated sidebar, section components, shared fetchers attaching CSRF + contextId, reuse `client/shared/*`) → Tasks 4, 7, 8, 25.
- Sections — Always (Profile, Task provider, Tools, MCP, Plugins, Identity) → Tasks 10–15.
- Sections — Group (Members, Group provider) → Tasks 16–17.
- Sections — Bot admin (Instances, System, Users, Groups, Admins, Plugins approval, Announce) → Tasks 18–24; SA-only gating (Admins, Plugin approval) honored in Task 25.
- UX notes — MCP structured form (Task 13), Tools drill-down with risk indicators (Task 12), masked secrets with replace/empty-submit (Task 9, ConfigFieldRow; admin system Task 19), session-expiry → "/config" prompt (Tasks 5 + 25), strict CSP / no third-party scripts (Task 1).
- Testing — `tests/client/settings/*` mirrors `tests/client/admin/*`; every component is test-gated (every task).

**2. Placeholder scan:** No `TBD`/`TODO`/"handle errors appropriately"/"similar to Task N". Every code step contains complete, runnable code.

**3. Type consistency:** Fetcher function names used by sections (`fetchConfig`, `patchConfig`, `fetchTools`, `toggleTool`, `fetchMcp`, `putMcp`, `fetchPlugins`, `togglePlugin`, `patchPluginConfig`, `fetchIdentity`, `putIdentity`, `deleteIdentity`, `provisionKaneo`, `fetchGroupMembers`, `addGroupMember`, `removeGroupMember`, `fetchGroupTaskInstance`, `patchGroupTaskInstance`, admin `fetch*`/`create*`/`update*`/`delete*`/`add*`/`remove*`/`submitAdminSystem`/`setPluginApproval`/`sendAnnounce`) are all defined in Task 4. Schema/type names (`ConfigField`, `ToolDomainView`, `ToolRisk`, `McpEndpoint`, `PluginEntry`, `IdentityResponse`, `ProvisionResult`, `GroupMembersResponse`, `GroupTaskInstanceResponse`, `AdminInstanceRow`, `ProviderType`, `AdminSystemResponse`, `AdminUserRow`, `AdminGroupRow`, `AdminRosterRow`, `AnnounceResult`) are all defined in Task 3. `SidebarItem` is exported from Task 8 and imported by Task 25. Session helpers (`settingsSession`, `setActiveContext`, `activeContext`, `bootstrapSession`, `registerExpiryHandler`) are defined in Task 5 and consumed in Tasks 7, 25, 26.

**Notes / deviations from a literal reading of the spec:**

- The spec's step 3 ("then calls `GET /settings/api/bootstrap`") is satisfied more efficiently: `POST /settings/auth/exchange` already returns the identical bootstrap payload, so the SPA seeds from the exchange response when a `code` is present and only calls `GET /settings/api/bootstrap` on the no-code path. Both paths flow through `applyBootstrap`, so role flags / contexts / CSRF are populated identically.
- Per the established per-app pattern (admin owns its own `scrollspy.ts`), the scroll-spy is copied into `client/settings/` rather than hoisted to `client/shared/` — hoisting would touch `client/admin/` and its tests, which is out of scope for Part B.
- Admin-tier response schemas are intentionally lenient (`.passthrough()`) since they render store-shaped rows generically; user-tier schemas are tight.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-29-settings-web-ui-client-spa.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
