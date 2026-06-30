<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Storybook Settings — Full Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Storybook coverage to the remaining **26 settings section components** and add the **group-context and admin-zone variants** of the `SettingsApp` shell, so the screenshot pipeline can render every settings surface across `Loading · Empty · Populated · Error` states.

**Architecture:** This is a _scale-out_ of the pattern already proven in `2026-06-30-storybook-settings-story-backfill.md` — no new infrastructure. Each section gets an MSW **handler family** (`populated/empty/error/loading`), named **scenarios**, and a `*.stories.svelte`. The shell variants extend `applyReadySettingsSession()` and add aggregate scenarios. Handlers are split across files to respect `max-lines`. Everything flows through the existing `bun shoot:gen` → `bun shoot` pipeline unchanged.

**Tech Stack:** Storybook 9 + `addon-svelte-csf` + `msw-storybook-addon`, MSW 2, Svelte 5 runes, `@crvy/strybk` + Playwright (already wired).

**Prior art (read first):**

- Recipe + worked sections: `docs/superpowers/plans/2026-06-30-storybook-settings-story-backfill.md`
- Pipeline mechanics: `docs/architecture/storybook-screenshots.md`
- Already-built: `client/stories/msw/settings-handlers.ts`, the `settings-*` scenarios in `client/stories/msw/scenarios.ts`, and `resetSettingsSession()`/`applyReadySettingsSession()` in `client/stories/decorators/withFixtures.ts`.

---

## The Recipe (applies to every section)

For a section `XSection` that loads via `GET <endpoint>` and parses `<Schema>`:

1. **Handler family** — add to the appropriate handlers file:
   ```ts
   export const xHandlers: HandlerFamily = {
     populated: [http.get('<endpoint>', () => HttpResponse.json(<valid populated body>))],
     empty: [http.get('<endpoint>', () => HttpResponse.json(<valid empty body>))],
     error: [http.get('<endpoint>', boom)],
     loading: [http.get('<endpoint>', async () => { await delay(NEVER_RESOLVE_MS); return HttpResponse.json(<empty body>) })],
   }
   ```
   The body must satisfy `<Schema>` exactly (a Zod parse failure renders the section's error state). Read the schema at the cited `client/settings/fetcher-schemas*.ts` location to get field names/types.
2. **Scenarios** — register `settings-<x>-populated/empty/error/loading` in `client/stories/msw/scenarios.ts` pointing at the family.
3. **Story** — create `client/settings/sections/<XSection>.stories.svelte` mirroring `ByokSection.stories.svelte` (committed): `defineMeta({ title: 'settings/sections/<XSection>', component, args: { contextId } })` + one `<Story name parameters={{ fixtures: 'settings-<x>-<state>' }} />` per state. Sections that take no `contextId` (the `Admin*` ones) omit `args`.
4. **Generate + shoot + verify** — `bun shoot:gen` then `bun shoot -g <XSection>`; Read the PNGs and confirm each state renders (no unintended error banner on populated/empty).

**Hard rules for every task (learned the hard way):**

- A subagent commits **only the files it created/edited for its task**. Never `git add -A`/`.`/`<dir>`.
- The pre-commit hook runs a **whole-project typecheck**; if it fails on a file you did NOT touch, **STOP and report BLOCKED** — never edit a foreign file to clear the gate.
- `bun shoot:gen` runs a repo-wide `bun run format`; it may reformat unrelated files — do not stage them.
- Storybook must be running (`bun storybook`, port 6006) for `shoot:gen`/`shoot`; reuse the existing server.

---

## Section Inventory (all 26 + endpoints + schema)

`ctx` = takes `contextId` prop. `GET` paths are the load endpoint(s). Schema lives in `client/settings/fetcher-schemas*.ts` unless noted.

### Personal / Advanced scope (10) — `args={{ contextId }}`, scope mounts in personal shell

| Section                      | GET endpoint(s)                                                | Schema                                                                           |
| ---------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `ProfileSection`             | `/settings/api/config`                                         | `ConfigResponseSchema` (`fetcher-schemas.ts`) — filter `kind==='preference'`     |
| `TaskProviderSection`        | `/settings/api/config` + `/settings/api/context/task-instance` | `ConfigResponseSchema` + `GroupTaskInstanceResponseSchema`                       |
| `AiOutputSection`            | `/settings/api/config`                                         | `ConfigResponseSchema` — filter `kind==='ai-output'`/preference subset           |
| `ReleaseSubscriptionSection` | `/settings/api/release-subscription` (personal)                | `ReleaseSubscriptionResponseSchema` (`fetcher-schemas-release.ts`) `{ enabled }` |
| `IdentitySection`            | `/settings/api/identity`                                       | `IdentityResponseSchema` `{ contextId, providerName, mapping }`                  |
| `MemorySection`              | `/settings/api/memory`                                         | `MemoryResponseSchema` `{ contextId, scopeType, enabled, profile, records[] }`   |
| `CodingCredentialsSection`   | `/settings/api/coding-credentials`                             | `CodingCredentialsResponseSchema`                                                |
| `CodeHostSection`            | `/settings/api/coding-credentials`                             | `CodingCredentialsResponseSchema` (same endpoint, different namespace/render)    |
| `McpSection`                 | `/settings/api/mcp`                                            | `McpResponseSchema` `{ contextId, endpoints[] }`                                 |
| `PluginsSection`             | `/settings/api/plugins`                                        | `PluginsResponseSchema` `{ contextId, plugins[] }`                               |

`config`, `context/task-instance`, `release-subscription`, and `tools` bodies already exist in `shellReadyHandlers` — reuse those shapes.

### Group scope (4) — `args={{ contextId }}`, only mount when context kind is `group`

| Section                 | GET endpoint(s)                                                       | Schema                                                                              |
| ----------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `MembersSection`        | `/settings/api/group/members`                                         | `GroupMembersResponseSchema` `{ contextId, members:[{user_id,added_by,added_at}] }` |
| `GroupProviderSection`  | `/settings/api/group/task-instance`                                   | `GroupTaskInstanceResponseSchema`                                                   |
| `GuestModeSection`      | `/settings/api/group/guest-mode`                                      | `GroupGuestModeResponseSchema` `{ contextId, enabled }`                             |
| `CodingIdentitySection` | `/settings/api/group/coding-identity` + `/settings/api/group/members` | group-coding-identity + members                                                     |

### Admin zone (12) — **no `contextId` prop**, only mount when `isBotAdmin`/`isSuperAdmin`

| Section                        | GET endpoint(s)                                                                                       | Schema (`fetcher-schemas*.ts`)                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `AdminInstancesSection`        | `/settings/api/admin/{platform-instances,task-instances,platform-provider-types,task-provider-types}` | `AdminInstancesResponseSchema`, `ProviderTypesResponseSchema` (`-instances.ts`) |
| `AdminSystemSection`           | `/settings/api/admin/system`                                                                          | `AdminSystemResponseSchema`                                                     |
| `AdminByokSection`             | `/settings/api/admin/byok`                                                                            | `AdminByokResponseSchema` `{ contexts[] }`                                      |
| `AdminGroupsSection`           | `/settings/api/admin/groups`                                                                          | `AdminGroupsResponseSchema`                                                     |
| `AdminAdminsSection`           | `/settings/api/admin/admins`                                                                          | `AdminRosterResponseSchema`                                                     |
| `AdminPluginsConfigSection`    | `/settings/api/admin/plugin-config`                                                                   | `AdminPluginConfigSnapshotSchema` (`-plugin-config.ts`)                         |
| `AdminPluginsApprovalSection`  | `/settings/api/plugins`                                                                               | `PluginsResponseSchema`                                                         |
| `AdminFeatureFlagsSection`     | `/settings/api/admin/feature-flags`                                                                   | `AdminFeatureFlagsSnapshotSchema`                                               |
| `AdminToolDefaultsSection`     | `/settings/api/admin/tool-defaults`                                                                   | `ToolsResponseSchema` (`-tools.ts`) — same shape as ToolsSection                |
| `AdminReleaseNotesSection`     | `/settings/api/admin/release-notes`                                                                   | `ReleaseNotesResponseSchema`                                                    |
| `AdminCodingGuardrailsSection` | `/settings/api/admin/coding-guardrails`                                                               | `AdminCodingGuardrailsResponseSchema` (`-coding-guardrails.ts`)                 |
| `AdminAnnounceSection`         | _(none — POST-only form)_                                                                             | renders immediately; minimal/no MSW                                             |

For any schema not quoted verbatim in this plan, the implementer reads it at the cited file before writing the body (same discovery the prior plan's research agents did). Bodies must match exactly.

---

## Task 1: Personal/advanced handler families + scenarios

**Files:** Create `client/stories/msw/settings-handlers-personal.ts`; modify `client/stories/msw/scenarios.ts`. (New file keeps `settings-handlers.ts` under `max-lines`.) A companion test `tests/client/stories/msw/settings-handlers-personal.test.ts` is required by the TDD pre-write hook — mirror `tests/client/stories/msw/settings-handlers.test.ts`.

- [ ] **Step 1 (TDD): companion test** — create `tests/client/stories/msw/settings-handlers-personal.test.ts` asserting each exported family has the four variants and its `populated` covers the right path (mirror the existing handler test).

- [ ] **Step 2: handler families** — create `client/stories/msw/settings-handlers-personal.ts` with the license header, the same `boom`/`NEVER_RESOLVE_MS`/`HandlerFamily` preamble as `settings-handlers.ts`, and these families (bodies are schema-valid):

```ts
// Coding credentials (CodingCredentialsSection + CodeHostSection share the endpoint)
const codingCredsConfigured = {
  namespace: 'forge',
  configured: true,
  complete: true,
  missing: [],
  fields: [
    { key: 'forge_token', label: 'Forge token', required: true, sensitive: true, hasValue: true, value: '****ab12' },
    {
      key: 'instance_url',
      label: 'Instance URL',
      required: false,
      sensitive: false,
      hasValue: true,
      value: 'https://gitlab.example.com',
    },
  ],
  allowedAgents: ['claude'],
}
const codingCredsEmpty = {
  namespace: 'forge',
  configured: false,
  complete: false,
  missing: ['forge_token'],
  fields: [],
}
export const codingCredentialsHandlers: HandlerFamily = {
  populated: [http.get('/settings/api/coding-credentials', () => HttpResponse.json(codingCredsConfigured))],
  empty: [http.get('/settings/api/coding-credentials', () => HttpResponse.json(codingCredsEmpty))],
  error: [http.get('/settings/api/coding-credentials', boom)],
  loading: [
    http.get('/settings/api/coding-credentials', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(codingCredsEmpty)
    }),
  ],
}

// Memory
const memoryPopulated = {
  contextId: 'ctx-personal-1',
  scopeType: 'personal',
  enabled: true,
  profile: 'Prefers concise answers.',
  records: [
    {
      id: 'm1',
      kind: 'fact',
      content: 'Works in TypeScript',
      summary: null,
      tags: ['lang'],
      confidence: 0.9,
      status: 'active',
      source: 'chat',
      createdAt: '2026-05-01T00:00:00Z',
      updatedAt: '2026-05-01T00:00:00Z',
      lastSeenAt: '2026-06-01T00:00:00Z',
    },
  ],
}
const memoryEmpty = { contextId: 'ctx-personal-1', scopeType: 'personal', enabled: false, profile: '', records: [] }
export const memoryHandlers: HandlerFamily = {
  populated: [http.get('/settings/api/memory', () => HttpResponse.json(memoryPopulated))],
  empty: [http.get('/settings/api/memory', () => HttpResponse.json(memoryEmpty))],
  error: [http.get('/settings/api/memory', boom)],
  loading: [
    http.get('/settings/api/memory', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(memoryEmpty)
    }),
  ],
}

// MCP
const mcpPopulated = {
  contextId: 'ctx-personal-1',
  endpoints: [{ id: 'e1', url: 'https://mcp.example.com/sse', label: 'Example', enabled: true }],
}
const mcpEmpty = { contextId: 'ctx-personal-1', endpoints: [] }
export const mcpHandlers: HandlerFamily = {
  populated: [http.get('/settings/api/mcp', () => HttpResponse.json(mcpPopulated))],
  empty: [http.get('/settings/api/mcp', () => HttpResponse.json(mcpEmpty))],
  error: [http.get('/settings/api/mcp', boom)],
  loading: [
    http.get('/settings/api/mcp', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(mcpEmpty)
    }),
  ],
}

// Plugins
const pluginsPopulated = {
  contextId: 'ctx-personal-1',
  plugins: [
    {
      id: 'task-provider-kaneo',
      name: 'Kaneo',
      active: true,
      enabled: true,
      eligibility: { eligible: true },
      contextConfig: [],
    },
  ],
}
const pluginsEmpty = { contextId: 'ctx-personal-1', plugins: [] }
export const pluginsHandlers: HandlerFamily = {
  populated: [http.get('/settings/api/plugins', () => HttpResponse.json(pluginsPopulated))],
  empty: [http.get('/settings/api/plugins', () => HttpResponse.json(pluginsEmpty))],
  error: [http.get('/settings/api/plugins', boom)],
  loading: [
    http.get('/settings/api/plugins', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(pluginsEmpty)
    }),
  ],
}

// Identity
const identityMapped = {
  contextId: 'ctx-personal-1',
  providerName: 'GitHub',
  mapping: {
    providerUserId: '42',
    providerUserLogin: 'alice',
    displayName: 'Alice',
    matchedAt: '2026-05-01T00:00:00Z',
    matchMethod: 'oauth',
    confidence: 1,
  },
}
const identityUnmapped = { contextId: 'ctx-personal-1', providerName: 'GitHub', mapping: null }
export const identityHandlers: HandlerFamily = {
  populated: [http.get('/settings/api/identity', () => HttpResponse.json(identityMapped))],
  empty: [http.get('/settings/api/identity', () => HttpResponse.json(identityUnmapped))],
  error: [http.get('/settings/api/identity', boom)],
  loading: [
    http.get('/settings/api/identity', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(identityUnmapped)
    }),
  ],
}

// Config (Profile / AiOutput) — reuse the shellReadyHandlers config body shape; vary `kind`.
const configBody = (fields: unknown[]): Record<string, unknown> => ({ contextId: 'ctx-personal-1', fields })
const preferenceField = {
  key: 'display_name',
  label: 'Display name',
  required: false,
  sensitive: false,
  hasValue: true,
  value: 'Alice',
  storageKey: 'display_name',
  kind: 'preference',
  control: 'text',
}
export const configHandlers: HandlerFamily = {
  populated: [http.get('/settings/api/config', () => HttpResponse.json(configBody([preferenceField])))],
  empty: [http.get('/settings/api/config', () => HttpResponse.json(configBody([])))],
  error: [http.get('/settings/api/config', boom)],
  loading: [
    http.get('/settings/api/config', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(configBody([]))
    }),
  ],
}

// Release subscription (personal)
const releaseHandlers = (enabled: boolean): HttpHandler[] => [
  http.get('/settings/api/release-subscription', () => HttpResponse.json({ enabled })),
]
export const releaseSubscriptionHandlers: HandlerFamily = {
  populated: releaseHandlers(true),
  empty: releaseHandlers(false),
  error: [http.get('/settings/api/release-subscription', boom)],
  loading: [
    http.get('/settings/api/release-subscription', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json({ enabled: false })
    }),
  ],
}
```

For `TaskProviderSection` (needs config **and** task-instance) and `AiOutputSection` (config with `ai-output` fields), compose handlers from `configHandlers` plus the task-instance body already in `shellReadyHandlers`; read each section's field-filter to pick `kind` values that produce a non-empty populated render.

- [ ] **Step 3: scenarios** — register `settings-config-*`, `settings-coding-credentials-*`, `settings-memory-*`, `settings-mcp-*`, `settings-plugins-*`, `settings-identity-*`, `settings-release-*` in `scenarios.ts` (import from `./settings-handlers-personal.js`).

- [ ] **Step 4: verify + commit** — `bunx tsgo --noEmit`, `bun run lint`, run the new client test; commit the handlers file, the personal scenarios, and the test. Message: `test(storybook): personal settings handler families + scenarios`.

## Task 2: Personal/advanced section stories (10 sections)

For EACH of `ProfileSection`, `TaskProviderSection`, `AiOutputSection`, `ReleaseSubscriptionSection`, `IdentitySection`, `MemorySection`, `CodingCredentialsSection`, `CodeHostSection`, `McpSection`, `PluginsSection`:

- [ ] Apply the Recipe steps 3–4. Story `args={{ contextId: 'ctx-personal-1' }}`, one `<Story>` per available state pointing at the matching `settings-<x>-<state>` scenario. Worked template = the committed `ByokSection.stories.svelte`.
- [ ] `bun shoot:gen && bun shoot -g <Section>`, Read each PNG, confirm the state renders (populated shows data; empty shows the section's `EmptyState`/placeholder; error shows the red message; loading shows the placeholder).
- [ ] Commit each section's story + its generated spec separately: `feat(storybook): add <XSection> stories`.

(10 commits. A driver may batch the dispatch but must keep one commit per section for reviewability.)

## Task 3: Group handler families + scenarios + stories

**Files:** create `client/stories/msw/settings-handlers-group.ts` (+ companion test); modify `scenarios.ts`; create 4 stories.

- [ ] **Handlers** — families (schema-valid bodies):

```ts
const membersPopulated = {
  contextId: 'ctx-group-1',
  members: [
    { user_id: 'u1', added_by: 'admin', added_at: '2026-05-01T00:00:00Z' },
    { user_id: 'u2', added_by: 'u1', added_at: '2026-05-02T00:00:00Z' },
  ],
}
const membersEmpty = { contextId: 'ctx-group-1', members: [] }
export const groupMembersHandlers: HandlerFamily = {
  populated: [http.get('/settings/api/group/members', () => HttpResponse.json(membersPopulated))],
  empty: [http.get('/settings/api/group/members', () => HttpResponse.json(membersEmpty))],
  error: [http.get('/settings/api/group/members', boom)],
  loading: [
    http.get('/settings/api/group/members', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(membersEmpty)
    }),
  ],
}
export const guestModeHandlers: HandlerFamily = {
  populated: [
    http.get('/settings/api/group/guest-mode', () => HttpResponse.json({ contextId: 'ctx-group-1', enabled: true })),
  ],
  empty: [
    http.get('/settings/api/group/guest-mode', () => HttpResponse.json({ contextId: 'ctx-group-1', enabled: false })),
  ],
  error: [http.get('/settings/api/group/guest-mode', boom)],
  loading: [
    http.get('/settings/api/group/guest-mode', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json({ contextId: 'ctx-group-1', enabled: false })
    }),
  ],
}
// GroupProviderSection → /settings/api/group/task-instance (GroupTaskInstanceResponseSchema; reuse the shell task-instance body but contextId 'ctx-group-1')
// CodingIdentitySection → /settings/api/group/coding-identity (read its schema) + /settings/api/group/members (reuse membersPopulated)
```

Read the group-coding-identity schema (search `client/settings/fetcher-schemas*.ts`) and the `GroupTaskInstanceResponseSchema` (already in `fetcher-schemas.ts`) to fill the remaining two families.

- [ ] **Scenarios** — `settings-members-*`, `settings-group-provider-*`, `settings-guest-mode-*`, `settings-coding-identity-*`.
- [ ] **Stories** — `MembersSection`, `GroupProviderSection`, `GuestModeSection`, `CodingIdentitySection`. Use `args={{ contextId: 'ctx-group-1' }}`. shoot + verify + commit per section.

## Task 4: Group shell variant

**Files:** modify `client/stories/decorators/withFixtures.ts` (+ its test); add an aggregate scenario; add a `<Story>` to `client/settings/SettingsApp.stories.svelte`.

- [ ] **Extend the ready helper** — change `applyReadySettingsSession()` to accept a mode, keeping the current default:

```ts
function applyReadySettingsSession(mode: 'personal' | 'group' = 'personal'): void {
  settingsSession.status = 'ready'
  settingsSession.display = 'Alice'
  settingsSession.isBotAdmin = false
  settingsSession.isSuperAdmin = false
  const ctx =
    mode === 'group'
      ? { kind: 'group' as const, contextId: 'ctx-group-1', label: 'Acme team' }
      : { kind: 'personal' as const, contextId: 'ctx-personal-1', label: 'Alice (personal)' }
  settingsSession.contexts = [ctx]
  settingsSession.activeContextId = ctx.contextId
}
```

In `fixturesLoader`, read the mode from a parameter: `const ready = context.parameters['settingsReady']; if (ready === true || ready === 'personal') applyReadySettingsSession('personal'); else if (ready === 'group') applyReadySettingsSession('group')`. Update `withFixtures.test.ts` to cover the group branch.

- [ ] **Aggregate scenario** — `settings-shell-group-ready`: spread `shellReadyHandlers` PLUS the group families' `populated` handlers (members, group task-instance, guest-mode, coding-identity, group release-subscription) so every section that mounts in a group shell is mocked. (Any unmocked mounted section renders a red banner.)
- [ ] **Story** — add `<Story name="Group ready" parameters={{ fixtures: 'settings-shell-group-ready', settingsReady: 'group' }} />` to `SettingsApp.stories.svelte`. shoot `-g SettingsApp`; Read the PNG; confirm the sidebar now shows the group-only sections (Members, Group provider, Guest mode, Coding identity) and **no error banners**. Commit.

## Task 5: Admin handler families + scenarios + stories (12 sections)

**Files:** create `client/stories/msw/settings-handlers-admin.ts` (+ companion test); modify `scenarios.ts`; create 12 stories. Admin stories take **no `args`**.

- [ ] **Handlers** — one family per admin endpoint. Worked example (AdminByok):

```ts
const adminByokPopulated = {
  contexts: [
    { contextId: 'tg:1', enabled: true, complete: true, missing: [], updatedAt: 1717000000000, updatedBy: 'alice' },
    {
      contextId: 'tg:2',
      enabled: true,
      complete: false,
      missing: ['ANTHROPIC_API_KEY'],
      updatedAt: 1717000000000,
      updatedBy: 'bob',
    },
  ],
}
export const adminByokHandlers: HandlerFamily = {
  populated: [http.get('/settings/api/admin/byok', () => HttpResponse.json(adminByokPopulated))],
  empty: [http.get('/settings/api/admin/byok', () => HttpResponse.json({ contexts: [] }))],
  error: [http.get('/settings/api/admin/byok', boom)],
  loading: [
    http.get('/settings/api/admin/byok', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json({ contexts: [] })
    }),
  ],
}
// AdminToolDefaultsSection → /settings/api/admin/tool-defaults returns ToolsResponseSchema — reuse the ToolsSection populated body shape.
// AdminInstancesSection → mock all four GET endpoints (platform-instances, task-instances, platform-provider-types, task-provider-types).
// AdminPluginsApprovalSection → /settings/api/plugins (reuse pluginsHandlers from Task 1).
```

For the remaining admin sections (`AdminSystemSection`, `AdminGroupsSection`, `AdminAdminsSection`, `AdminPluginsConfigSection`, `AdminFeatureFlagsSection`, `AdminReleaseNotesSection`, `AdminCodingGuardrailsSection`, `AdminInstancesSection`): read the cited schema in the inventory table, then write a populated/empty/error/loading family mirroring the AdminByok example. `AdminAnnounceSection` has no load endpoint — its story needs no scenario (or an empty one).

- [ ] **Scenarios** — `settings-admin-<x>-*` per family.
- [ ] **Stories** — one per admin section, no `args`. shoot + verify + commit per section.

## Task 6: Admin shell variant

**Files:** `withFixtures.ts` (+ test), aggregate scenario, `SettingsApp.stories.svelte`.

- [ ] Extend the ready helper's mode union to include `'admin'` → sets `isBotAdmin: true` (and a `'super-admin'` → also `isSuperAdmin: true`) with a personal context. Update the loader branch + test.
- [ ] **Aggregate scenario** `settings-shell-admin-ready` — spread `shellReadyHandlers` + every admin family's `populated` (all 12 admin endpoints) so the whole Admin zone renders. This is the largest scenario; double-check each admin endpoint is present (an unmocked one = red banner).
- [ ] **Story** — `<Story name="Admin ready" parameters={{ fixtures: 'settings-shell-admin-ready', settingsReady: 'admin' }} />`. shoot; Read PNG; confirm the Admin zone renders all admin sections without error banners. Commit.

## Final verification

- [ ] `bun run check:full` → 12/12 green with all new files present.
- [ ] Coverage check:

```bash
comm -23 \
  <(find client/settings/sections -name '*.svelte' ! -name '*.stories.svelte' | sed 's|.*/||;s|.svelte||' | sort) \
  <(find client/settings -name '*.stories.svelte' | sed 's|.*/||;s|.stories.svelte||' | sort)
```

Expected: empty output (every section component has a story).

- [ ] `bun storybook` then `bun shoot:gen && bun shoot` (no `-g`, shoot everything) → all specs pass; spot-check a sampling of new PNGs.

## Notes

- **Sequencing:** Tasks 1→2 (personal) and 3→4 (group) and 5→6 (admin) are independent tracks; within a track, handlers precede stories. A driver can run the three tracks in any order but must finish each track's handler task before its story tasks.
- **`max-lines`:** handlers are split into `settings-handlers{,-personal,-group,-admin}.ts`. If any single file still trips `max-lines`, split further by sub-area — do not compress formatting to dodge the limit.
- **Schemas not quoted here** are cited by name + file in the inventory; read them before writing the body (a Zod mismatch renders the error state instead of the intended one). The prior plan's parallel-research approach is the fast way to extract several at once.
- **Interaction states** (modals, secret-reveal, expanded Advanced) remain available as manual-region tests per `docs/architecture/storybook-screenshots.md`, but are out of scope for this coverage pass.
