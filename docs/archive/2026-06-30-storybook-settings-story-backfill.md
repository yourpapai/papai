<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Storybook Settings Story Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backfill Storybook coverage for the representative settings sections deferred from the screenshot-pipeline plan — `ReposSection`, `ByokSection`, `KaneoAccessSection`, `AdminUsersSection`, and the full `SettingsApp` shell — so the agent screenshot pipeline has meaningful settings targets across `Loading · Empty · Populated · Error` states.

**Architecture:** These sections fetch through module-level fetchers hitting `/settings/api/…`, so stories are driven by **MSW scenarios** (the established admin/debug pattern), not DI props. A new `client/stories/msw/settings-handlers.ts` holds the handler families; scenarios are registered in `client/stories/msw/scenarios.ts`; the `fixturesLoader` is extended to reset `settingsSession` (and optionally set it "ready" for the shell story). Each new `*.stories.svelte` is then consumed by the existing `bun shoot:gen` → `bun shoot` pipeline with no pipeline changes.

**Tech Stack:** Storybook 9 (`@storybook/svelte-vite` + `addon-svelte-csf` + `msw-storybook-addon`), MSW 2, Svelte 5 runes, `@crvy/strybk` + Playwright (already wired).

**Prior plan / spec:**

- Spec: `docs/superpowers/specs/2026-06-30-storybook-agent-screenshot-pipeline-design.md` (§5 Story Fuel, §2 deferred scope)
- Pipeline plan (done): `docs/superpowers/plans/2026-06-30-storybook-agent-screenshot-pipeline.md`

## Prerequisites & conventions (read once)

- The screenshot pipeline is already built: `bun shoot:gen` regenerates `tests/visual/**` specs **and auto-formats + stamps headers**; `bun shoot -g <name>` captures PNGs into the gitignored `.storybook-shots/`. Generated specs are committed; PNGs are not.
- **Storybook must be running** for `bun shoot:gen` (it reads `/index.json`) and for `bun shoot`. Start it once in a background shell: `bun storybook` and wait for `http://localhost:6006/index.json` to return 200. HMR picks up new `.stories.svelte` files automatically.
- Existing MSW patterns to mirror: `client/stories/msw/handlers.ts` (the `HandlerFamily` interface and `http.get(...)` style), `client/stories/msw/scenarios.ts` (named scenario → handler arrays), `client/stories/decorators/withFixtures.ts` (`fixturesLoader` + `resetAllSingletons`). Story examples: `client/admin/sections/BillingSection.stories.svelte` (states via `parameters={{ fixtures: '<scenario>' }}`).
- The `client/stories/` harness is excluded from knip and the production bundle, and `.stories.svelte` files are not bundled — so these changes do not affect `bun knip` or `bun check:bundle-isolation`. `bun test` ignores the `tests/visual/` specs.
- MSW handlers are **persistent** (not `.once`), and `http.get('/path', …)` matches regardless of query string — so one handler serves repeated/`?contextId=`-suffixed calls.
- `requireOk` in the fetchers **throws on any non-2xx**, which the sections render as an error message. So: Error state = return 500; Loading state = `await delay(NEVER_RESOLVE_MS)` then return; Populated/Empty = 200 with a schema-valid body. **Zod field names/casing must be exact** (`taskInstanceId`, `hasStoredDefaults`, `canProvision`, …) or the parse throws → error render.

---

## File Structure

| File                                                              | Responsibility                                                                                      | Created/Modified |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------- |
| `client/stories/msw/settings-handlers.ts`                         | MSW `HandlerFamily` groups for repos, byok, kaneo, admin-users, and the shell's always-on endpoints | Create           |
| `client/stories/msw/scenarios.ts`                                 | register the new settings scenarios                                                                 | Modify           |
| `client/stories/decorators/withFixtures.ts`                       | `resetSettingsSession()` + `settingsReady` loader branch; call reset in `resetAllSingletons()`      | Modify           |
| `client/settings/sections/ReposSection.stories.svelte`            | Repos states                                                                                        | Create           |
| `client/settings/sections/ByokSection.stories.svelte`             | BYOK states (incl. masked secret)                                                                   | Create           |
| `client/settings/sections/KaneoAccessSection.stories.svelte`      | Kaneo states (incl. 404 not-provisioned)                                                            | Create           |
| `client/settings/sections/admin/AdminUsersSection.stories.svelte` | Admin users states                                                                                  | Create           |
| `client/settings/SettingsApp.stories.svelte`                      | Full personal ready shell                                                                           | Create           |
| `tests/visual/settings/**`                                        | regenerated specs (committed)                                                                       | Generated        |

---

## Task 1: Settings MSW handler families

**Files:**

- Create: `client/stories/msw/settings-handlers.ts`

- [ ] **Step 1: Write the handler module**

Create `client/stories/msw/settings-handlers.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { HttpResponse, delay, http } from 'msw'
import type { HttpHandler } from 'msw'

const NEVER_RESOLVE_MS = 60_000
const boom = (): HttpResponse => HttpResponse.json({ error: 'boom' }, { status: 500 })

export interface HandlerFamily {
  populated: HttpHandler[]
  empty: HttpHandler[]
  error: HttpHandler[]
  loading: HttpHandler[]
}

// --- Repos (GET/POST/DELETE /settings/api/coding-repos) ---

const reposBody = (repos: unknown[]): Record<string, unknown> => ({ repos })
const reposSample = [
  {
    repoId: 'repo_abc123',
    name: 'my-project',
    repoUrl: 'https://github.com/org/my-project.git',
    baseBranch: 'main',
    permissionPreset: 'cautious',
  },
  {
    repoId: 'repo_def456',
    name: 'api-service',
    repoUrl: 'https://github.com/org/api-service.git',
    baseBranch: 'develop',
    permissionPreset: 'readonly',
  },
]

export const reposHandlers: HandlerFamily = {
  populated: [
    http.get('/settings/api/coding-repos', () => HttpResponse.json(reposBody(reposSample))),
    http.post('/settings/api/coding-repos', () => HttpResponse.json({ ok: true })),
    http.delete('/settings/api/coding-repos', () => HttpResponse.json({ ok: true })),
  ],
  empty: [http.get('/settings/api/coding-repos', () => HttpResponse.json(reposBody([])))],
  error: [http.get('/settings/api/coding-repos', boom)],
  loading: [
    http.get('/settings/api/coding-repos', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(reposBody([]))
    }),
  ],
}

// --- BYOK (GET/PATCH /settings/api/byok) ---

const byokSecretSet = {
  enabled: true,
  complete: true,
  missing: [],
  fields: [
    {
      key: 'ANTHROPIC_API_KEY',
      label: 'Anthropic API Key',
      required: true,
      sensitive: true,
      hasValue: true,
      value: '****WvfQ',
    },
  ],
}
const byokMissing = {
  enabled: true,
  complete: false,
  missing: ['ANTHROPIC_API_KEY'],
  fields: [
    {
      key: 'ANTHROPIC_API_KEY',
      label: 'Anthropic API Key',
      required: true,
      sensitive: true,
      hasValue: false,
      value: '',
    },
    { key: 'LLM_MODEL', label: 'Model', required: false, sensitive: false, hasValue: true, value: 'claude-opus-4-5' },
  ],
}
const byokDisabled = { enabled: false, complete: false, missing: ['ANTHROPIC_API_KEY'], fields: [] }

const byokFamily = (body: Record<string, unknown>): HandlerFamily['populated'] => [
  http.get('/settings/api/byok', () => HttpResponse.json(body)),
  http.patch('/settings/api/byok', () => HttpResponse.json(body)),
]

export const byokHandlers = {
  secretSet: byokFamily(byokSecretSet),
  missing: byokFamily(byokMissing),
  disabled: byokFamily(byokDisabled),
  error: [http.get('/settings/api/byok', boom)],
  loading: [
    http.get('/settings/api/byok', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(byokDisabled)
    }),
  ],
}

// --- Kaneo (GET/POST /settings/api/kaneo/credentials) ---

export const kaneoHandlers = {
  populated: [
    http.get('/settings/api/kaneo/credentials', () =>
      HttpResponse.json({
        contextId: 'ctx-personal-1',
        login: 'alice@example.com',
        status: 'active',
        kaneoUrl: 'https://workspace.kaneo.app',
      }),
    ),
    http.post('/settings/api/kaneo/credentials', () =>
      HttpResponse.json({ password: 's3cr3tP@ssw0rd!', warning: 'This password will not be shown again.' }),
    ),
  ],
  notProvisioned: [http.get('/settings/api/kaneo/credentials', () => new HttpResponse(null, { status: 404 }))],
  error: [http.get('/settings/api/kaneo/credentials', boom)],
  loading: [
    http.get('/settings/api/kaneo/credentials', async () => {
      await delay(NEVER_RESOLVE_MS)
      return new HttpResponse(null, { status: 404 })
    }),
  ],
}

// --- Admin users (GET/POST/DELETE /settings/api/admin/users + open-access) ---

const adminUsersSample = {
  users: [
    {
      platform_user_id: '123456789',
      platform_instance_id: 'tg-main',
      username: 'alice_tg',
      added_by: 'admin',
      blocked_at: null,
    },
    {
      platform_user_id: 'placeholder-@bob_handle',
      platform_instance_id: 'tg-main',
      username: '@bob_handle',
      added_by: 'admin',
      blocked_at: null,
    },
    {
      platform_user_id: '987654321',
      platform_instance_id: 'tg-main',
      username: 'charlie',
      added_by: 'open_access',
      blocked_at: '2026-01-15T10:00:00Z',
    },
  ],
}

const adminUsersWrites: HttpHandler[] = [
  http.post('/settings/api/admin/users', () => HttpResponse.json({ ok: true, pending: false })),
  http.delete('/settings/api/admin/users', () => HttpResponse.json({ ok: true })),
  http.post('/settings/api/admin/users/block', () => HttpResponse.json({ ok: true })),
  http.post('/settings/api/admin/open-access', () => HttpResponse.json({ ok: true })),
]

export const adminUsersHandlers: HandlerFamily = {
  populated: [
    http.get('/settings/api/admin/users', () => HttpResponse.json(adminUsersSample)),
    http.get('/settings/api/admin/open-access', () => HttpResponse.json({ openDmAccess: true })),
    ...adminUsersWrites,
  ],
  empty: [
    http.get('/settings/api/admin/users', () => HttpResponse.json({ users: [] })),
    http.get('/settings/api/admin/open-access', () => HttpResponse.json({ openDmAccess: false })),
    ...adminUsersWrites,
  ],
  error: [http.get('/settings/api/admin/users', boom), http.get('/settings/api/admin/open-access', boom)],
  loading: [
    http.get('/settings/api/admin/users', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json({ users: [] })
    }),
    http.get('/settings/api/admin/open-access', () => HttpResponse.json({ openDmAccess: false })),
  ],
}

// --- Shell always-on sections (personal, Advanced collapsed): config, task-instance, tools, release ---

export const shellReadyHandlers: HttpHandler[] = [
  http.get('/settings/api/config', () =>
    HttpResponse.json({
      contextId: 'ctx-personal-1',
      fields: [
        {
          key: 'display_name',
          label: 'Display name',
          required: false,
          sensitive: false,
          hasValue: true,
          value: 'Alice',
          storageKey: 'display_name',
          kind: 'preference',
          control: 'text',
        },
      ],
    }),
  ),
  http.get('/settings/api/context/task-instance', () =>
    HttpResponse.json({
      contextId: 'ctx-personal-1',
      taskInstanceId: null,
      available: [{ id: 'inst_abc', type: 'kaneo', status: 'active' }],
      canProvision: false,
    }),
  ),
  http.get('/settings/api/tools', () =>
    HttpResponse.json({
      contextId: 'ctx-personal-1',
      domains: [
        {
          domain: 'files',
          summary: 'allow',
          tools: [
            { name: 'read_file', permission: 'allow', risk: 'read' },
            { name: 'write_file', permission: 'ask', risk: 'write' },
          ],
        },
      ],
      activePreset: null,
      hasStoredDefaults: false,
    }),
  ),
  http.get('/settings/api/release-subscription', () => HttpResponse.json({ enabled: false })),
]
```

- [ ] **Step 2: Verify it type-checks**

Run: `bunx tsgo --noEmit` (project-wide; do not pass the filename).
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add client/stories/msw/settings-handlers.ts
git commit -m "test(storybook): add settings MSW handler families"
```

---

## Task 2: Register scenarios + settings-session reset wiring

**Files:**

- Modify: `client/stories/msw/scenarios.ts`
- Modify: `client/stories/decorators/withFixtures.ts`

- [ ] **Step 1: Add settings scenarios to `scenarios.ts`**

At the top of `client/stories/msw/scenarios.ts`, add to the existing import block an import of the new families:

```ts
import {
  adminUsersHandlers,
  byokHandlers,
  kaneoHandlers,
  reposHandlers,
  shellReadyHandlers,
} from './settings-handlers.js'
```

Then inside the `scenarios` object literal (before the closing `} satisfies …`), add these entries:

```ts
  'settings-repos-populated': [...reposHandlers.populated],
  'settings-repos-empty': [...reposHandlers.empty],
  'settings-repos-error': [...reposHandlers.error],
  'settings-repos-loading': [...reposHandlers.loading],
  'settings-byok-secret-set': [...byokHandlers.secretSet],
  'settings-byok-missing': [...byokHandlers.missing],
  'settings-byok-disabled': [...byokHandlers.disabled],
  'settings-byok-error': [...byokHandlers.error],
  'settings-byok-loading': [...byokHandlers.loading],
  'settings-kaneo-populated': [...kaneoHandlers.populated],
  'settings-kaneo-not-provisioned': [...kaneoHandlers.notProvisioned],
  'settings-kaneo-error': [...kaneoHandlers.error],
  'settings-kaneo-loading': [...kaneoHandlers.loading],
  'settings-admin-users-populated': [...adminUsersHandlers.populated],
  'settings-admin-users-empty': [...adminUsersHandlers.empty],
  'settings-admin-users-error': [...adminUsersHandlers.error],
  'settings-admin-users-loading': [...adminUsersHandlers.loading],
  'settings-shell-ready': [...shellReadyHandlers],
```

- [ ] **Step 2: Add `resetSettingsSession` + a ready helper to `withFixtures.ts`**

In `client/stories/decorators/withFixtures.ts`, add this import near the other imports:

```ts
import { settingsSession } from '../../settings/session.svelte.js'
```

Add these two functions (export the reset; keep the ready helper module-local):

```ts
export function resetSettingsSession(): void {
  settingsSession.status = 'loading'
  settingsSession.display = ''
  settingsSession.isBotAdmin = false
  settingsSession.isSuperAdmin = false
  settingsSession.contexts = []
  settingsSession.activeContextId = ''
}

// Personal, non-admin "ready" shell: status ready + a single personal context.
// Advanced + Admin zones stay hidden (isGroup=false, isBotAdmin=false).
function applyReadySettingsSession(): void {
  settingsSession.status = 'ready'
  settingsSession.display = 'Alice'
  settingsSession.isBotAdmin = false
  settingsSession.isSuperAdmin = false
  settingsSession.contexts = [{ kind: 'personal', contextId: 'ctx-personal-1', label: 'Alice (personal)' }]
  settingsSession.activeContextId = 'ctx-personal-1'
}
```

- [ ] **Step 3: Call the reset in `resetAllSingletons()` and add the `settingsReady` branch**

In `resetAllSingletons()`, add `resetSettingsSession()` as the last line of its body.

In `fixturesLoader`, inside the `if (typeof scenario === 'string') { … }` block, after the existing `if (context.parameters['refreshGlobals'] === true) await refreshGlobals()` line, add:

```ts
if (context.parameters['settingsReady'] === true) applyReadySettingsSession()
```

- [ ] **Step 4: Verify type-check + that the harness still loads**

Run:

- `bunx tsgo --noEmit` → zero errors.
- `bun run lint` → 0 errors.
  Expected: both clean. (`client/stories/**` is knip-ignored, so no knip change needed.)

- [ ] **Step 5: Commit**

```bash
git add client/stories/msw/scenarios.ts client/stories/decorators/withFixtures.ts
git commit -m "test(storybook): register settings scenarios and session reset"
```

---

## Task 3: ReposSection stories

**Files:**

- Create: `client/settings/sections/ReposSection.stories.svelte`
- Generated: `tests/visual/settings/sections/ReposSection.spec.ts`

- [ ] **Step 1: Write the story**

Create `client/settings/sections/ReposSection.stories.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import ReposSection from './ReposSection.svelte'

  const CONTEXT_ID = 'ctx-personal-1'

  const { Story } = defineMeta({
    title: 'settings/sections/ReposSection',
    component: ReposSection,
    args: { contextId: CONTEXT_ID },
  })
</script>

<Story name="Populated" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-repos-populated' }} />

<Story name="Empty" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-repos-empty' }} />

<Story name="Error" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-repos-error' }} />

<Story name="Loading" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-repos-loading' }} />
```

- [ ] **Step 2: Confirm the story is indexed (HMR)**

Run: `curl -sf http://localhost:6006/index.json | grep -o 'settings-sections-repossection--[a-z-]*' | sort -u`
Expected: `--populated`, `--empty`, `--error`, `--loading`.

- [ ] **Step 3: Regenerate + shoot**

Run:

```bash
bun shoot:gen
bun shoot -g ReposSection
```

Expected: `bun shoot:gen` prints an incremented file count and creates `tests/visual/settings/sections/ReposSection.spec.ts` (4 tests); `bun shoot -g ReposSection` runs 4 tests, all pass.

- [ ] **Step 4: Verify renders (Read the PNGs)**

`find .storybook-shots -path '*ReposSection*' -name '*.png'` → 4 PNGs. Read each:

- **Populated**: two repo rows (`my-project` / `api-service`) + the add-repo form below.
- **Empty**: just the add-repo form, no rows.
- **Error**: a `status-error` message (the `boom` failure) plus the form.
- **Loading**: the `Loading…` placeholder.
  Report what you see; if Populated is blank, add a `waitForLoadState('networkidle')` settle test in the spec's manual region (below `// @generated-end`) and re-shoot.

- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/ReposSection.stories.svelte tests/visual/settings/sections/ReposSection.spec.ts
git commit -m "feat(storybook): add ReposSection stories"
```

---

## Task 4: ByokSection stories

**Files:**

- Create: `client/settings/sections/ByokSection.stories.svelte`
- Generated: `tests/visual/settings/sections/ByokSection.spec.ts`

- [ ] **Step 1: Write the story**

Create `client/settings/sections/ByokSection.stories.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import ByokSection from './ByokSection.svelte'

  const CONTEXT_ID = 'ctx-personal-1'

  const { Story } = defineMeta({
    title: 'settings/sections/ByokSection',
    component: ByokSection,
    args: { contextId: CONTEXT_ID },
  })
</script>

<!-- enabled, secret stored: masked value + Replace button -->
<Story name="Secret set" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-byok-secret-set' }} />

<!-- enabled, required key missing: missing-fields error + open editor -->
<Story name="Missing required" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-byok-missing' }} />

<!-- disabled: using central credentials -->
<Story name="Disabled" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-byok-disabled' }} />

<Story name="Error" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-byok-error' }} />

<Story name="Loading" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-byok-loading' }} />
```

- [ ] **Step 2: Confirm indexed**

Run: `curl -sf http://localhost:6006/index.json | grep -o 'settings-sections-byoksection--[a-z-]*' | sort -u`
Expected: `--secret-set`, `--missing-required`, `--disabled`, `--error`, `--loading`.

- [ ] **Step 3: Regenerate + shoot**

```bash
bun shoot:gen
bun shoot -g ByokSection
```

Expected: `ByokSection.spec.ts` with 5 tests; all pass.

- [ ] **Step 4: Verify renders (Read the PNGs)**

5 PNGs under `*ByokSection*`. Read each:

- **Secret set**: a field row showing a masked value (`••••WvfQ`) + a `Replace` button.
- **Missing required**: "Missing required fields: ANTHROPIC_API_KEY" error + an open input editor; the `LLM_MODEL` field shows its value.
- **Disabled**: "Using the central LLM credentials…" placeholder.
- **Error**: `status-error` message.
- **Loading**: `Loading…` placeholder.
  Report what you see; settle-fix if any populated shot is blank.

- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/ByokSection.stories.svelte tests/visual/settings/sections/ByokSection.spec.ts
git commit -m "feat(storybook): add ByokSection stories"
```

---

## Task 5: KaneoAccessSection stories

**Files:**

- Create: `client/settings/sections/KaneoAccessSection.stories.svelte`
- Generated: `tests/visual/settings/sections/KaneoAccessSection.spec.ts`

- [ ] **Step 1: Write the story**

Create `client/settings/sections/KaneoAccessSection.stories.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import KaneoAccessSection from './KaneoAccessSection.svelte'

  const CONTEXT_ID = 'ctx-personal-1'

  const { Story } = defineMeta({
    title: 'settings/sections/KaneoAccessSection',
    component: KaneoAccessSection,
    args: { contextId: CONTEXT_ID },
  })
</script>

<Story name="Populated" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-kaneo-populated' }} />

<!-- 404 from the credentials endpoint -->
<Story
  name="Not provisioned"
  args={{ contextId: CONTEXT_ID }}
  parameters={{ fixtures: 'settings-kaneo-not-provisioned' }} />

<Story name="Error" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-kaneo-error' }} />

<Story name="Loading" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-kaneo-loading' }} />
```

- [ ] **Step 2: Confirm indexed**

Run: `curl -sf http://localhost:6006/index.json | grep -o 'settings-sections-kaneoaccesssection--[a-z-]*' | sort -u`
Expected: `--populated`, `--not-provisioned`, `--error`, `--loading`.

- [ ] **Step 3: Regenerate + shoot**

```bash
bun shoot:gen
bun shoot -g KaneoAccessSection
```

Expected: `KaneoAccessSection.spec.ts` with 4 tests; all pass.

- [ ] **Step 4: Verify renders (Read the PNGs)**

4 PNGs. Read each:

- **Populated**: a `<dl>` with login (`alice@example.com`), workspace URL, status `active`, and a "Reveal password" button.
- **Not provisioned**: "Your Kaneo account is not provisioned…" message.
- **Error**: `error` message text.
- **Loading**: `Loading…`.
  Report what you see.

- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/KaneoAccessSection.stories.svelte tests/visual/settings/sections/KaneoAccessSection.spec.ts
git commit -m "feat(storybook): add KaneoAccessSection stories"
```

---

## Task 6: AdminUsersSection stories

**Files:**

- Create: `client/settings/sections/admin/AdminUsersSection.stories.svelte`
- Generated: `tests/visual/settings/sections/admin/AdminUsersSection.spec.ts`

Note: `AdminUsersSection` takes **no props** (no `contextId`); it calls no-arg admin fetchers. The scenario provides both `/settings/api/admin/users` and `/settings/api/admin/open-access`.

- [ ] **Step 1: Write the story**

Create `client/settings/sections/admin/AdminUsersSection.stories.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import AdminUsersSection from './AdminUsersSection.svelte'

  const { Story } = defineMeta({
    title: 'settings/sections/admin/AdminUsersSection',
    component: AdminUsersSection,
  })
</script>

<Story name="Populated" parameters={{ fixtures: 'settings-admin-users-populated' }} />

<Story name="Empty" parameters={{ fixtures: 'settings-admin-users-empty' }} />

<Story name="Error" parameters={{ fixtures: 'settings-admin-users-error' }} />

<Story name="Loading" parameters={{ fixtures: 'settings-admin-users-loading' }} />
```

- [ ] **Step 2: Confirm indexed**

Run: `curl -sf http://localhost:6006/index.json | grep -o 'settings-sections-admin-adminuserssection--[a-z-]*' | sort -u`
Expected: `--populated`, `--empty`, `--error`, `--loading`.

- [ ] **Step 3: Regenerate + shoot**

```bash
bun shoot:gen
bun shoot -g AdminUsersSection
```

Expected: `tests/visual/settings/sections/admin/AdminUsersSection.spec.ts` with 4 tests; all pass.

- [ ] **Step 4: Verify renders (Read the PNGs)**

4 PNGs. Read each:

- **Populated**: open-access card (toggle showing "Disable", since `openDmAccess: true`), the add-user input, and a user table with 3 rows including a `pending` badge on the `placeholder-@bob_handle` row and a blocked `charlie` row.
- **Empty**: open-access card (toggle "Enable") + "No users" empty row.
- **Error**: a `status-error` message.
- **Loading**: the table area in a loading state (open-access card still renders).
  Report what you see.

- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/admin/AdminUsersSection.stories.svelte "tests/visual/settings/sections/admin/AdminUsersSection.spec.ts"
git commit -m "feat(storybook): add AdminUsersSection stories"
```

---

## Task 7: SettingsApp shell story (full personal ready layout)

**Files:**

- Create: `client/settings/SettingsApp.stories.svelte`
- Generated: `tests/visual/settings/SettingsApp.spec.ts`

`SettingsApp` does not self-bootstrap (the real entry is `index.ts#start`), so mounting it in Storybook reads `settingsSession` directly. The `settingsReady` loader parameter sets it to a personal ready state; with Advanced **collapsed by default** and admin flags false, only the 4 always-on sections mount and fetch — covered by `settings-shell-ready`.

- [ ] **Step 1: Write the story**

Create `client/settings/SettingsApp.stories.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import SettingsApp from './SettingsApp.svelte'

  const { Story } = defineMeta({
    title: 'settings/SettingsApp',
    component: SettingsApp,
  })
</script>

<!-- Personal, non-admin, Advanced collapsed: sidebar + top bar + the always-on sections. -->
<Story name="Personal ready" parameters={{ fixtures: 'settings-shell-ready', settingsReady: true }} />
```

- [ ] **Step 2: Confirm indexed**

Run: `curl -sf http://localhost:6006/index.json | grep -o 'settings-settingsapp--[a-z-]*' | sort -u`
Expected: `--personal-ready`.

- [ ] **Step 3: Regenerate + shoot**

```bash
bun shoot:gen
bun shoot -g SettingsApp
```

Expected: `tests/visual/settings/SettingsApp.spec.ts` with 1 test; it passes. (This story has more async sections; if the shot is captured mid-load, add a manual-region settle test with `await sharedPage.waitForLoadState('networkidle')` below `// @generated-end` and re-shoot.)

- [ ] **Step 4: Verify the full-page render (Read the PNG)**

`find .storybook-shots -path '*SettingsApp*' -name '*.png'` → 1 PNG. Read it and confirm:

- The top bar and left sidebar render (sidebar lists Profile, Task provider, Tools, Releases, and a collapsed "Advanced" group).
- The main column shows the Profile section (a "Display name" preference row), Task provider (a task-instance dropdown), Tools (a `files` domain row), and Releases (a Subscribe button).
- No red error banners in any of the four sections (means all four `settings-shell-ready` handlers parsed cleanly).
  If any section shows an error, the corresponding handler body drifted from its Zod schema — fix that body in `settings-handlers.ts` (`shellReadyHandlers`) to match, re-shoot, and report the change.

- [ ] **Step 5: Commit**

```bash
git add client/settings/SettingsApp.stories.svelte tests/visual/settings/SettingsApp.spec.ts
git commit -m "feat(storybook): add SettingsApp personal-ready shell story"
```

---

## Final verification

- [ ] **Confirm the suite is green with everything present**

Stop the background Storybook, then run:

```bash
bun run check:full
```

Expected: lint, typecheck, format:check, knip, duplicates, and the test suite all pass. (`tests/visual/**` is excluded from `bun test`, ignored by knip, and the new handler/story files live under `client/stories/**` + `.stories.svelte`, excluded from the bundle.)

- [ ] **Confirm the new settings coverage shoots cleanly end-to-end**

```bash
bun storybook   # background
bun shoot:gen && bun shoot -g "ReposSection|ByokSection|KaneoAccessSection|AdminUsersSection|SettingsApp"
find .storybook-shots -path '*settings*' -name '*.png' | wc -l
```

Expected: specs regenerate, all shots pass, and PNGs exist for every new settings story (≈ 4+5+4+4+1 = 18 settings-section PNGs plus the existing ToolsSection 5).

---

## Notes & follow-ups (out of scope here)

- **Group-scope and admin-zone shell variants** (isGroup=true → Members/GroupProvider/GuestMode/CodingIdentity/Kaneo; isBotAdmin=true → the Admin zone) are deliberately not storied here; they require broader MSW coverage for every mounted section. Add as a later increment by extending `applyReadySettingsSession()` (a `settingsReady: 'group' | 'admin'` parameter) and a matching aggregate scenario.
- **Interaction states** (confirm-removal dialog open, secret revealed, Advanced expanded) can be added as manual-region tests in the generated specs per `docs/architecture/storybook-screenshots.md`.
- The remaining ~28 settings sections beyond this representative set follow the exact same handler-family + scenario + story pattern.
