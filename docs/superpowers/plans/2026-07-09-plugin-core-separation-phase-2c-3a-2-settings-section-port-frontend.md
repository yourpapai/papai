<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plugin / Core Separation — Phase 2c-3a-2: SettingsSectionPort (Frontend) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render module-contributed admin settings sections in the settings SPA — the frontend half of `SettingsSectionPort`. Add a generic admin Svelte section that fetches `GET /settings/api/admin/module-sections` (built in 2c-3a) and renders each section's fields, plus the fetcher/schema and SPA wiring. This completes the settings surface so the coding module (2c-3c) can expose its magi config with a working UI.

**Architecture:** Mirror the existing `AdminPluginsConfigSection.svelte` + its fetcher/schema, which render the parallel `/settings/api/admin/plugin-config` surface — reusing the shared UI primitives (`SettingsFieldShell`, `Secret`, `Input`, `Btn`, `Confirm`, `EmptyState`, `PageHeader`, `IconButton`). One generic component renders all module sections returned by the endpoint; it is data-driven within itself (existing hand-written sections are untouched — the broader "delete all hand-written sections" migration is future work).

**Tech Stack:** Svelte 5 (runes), Zod v4, Bun. Client tests via `bun test:client` (happy-dom); storybook stories + `@crvy/strybk` visual specs. Imports use the `.js` extension.

---

## Scope & Deferred (read first)

**This is plan 2c-3a-2 of the "acp becomes a trusted module" sub-epic:**

- 2c-1/2c-2 (done): module tools / commands / prompt fragments. 2c-3a (done): SettingsSectionPort backend.
- **2c-3a-2 (this plan): SettingsSectionPort FRONTEND.** Generic renderer + fetcher/schema + SPA wiring. Foundational; no module declares sections yet; renders an EmptyState in production.
- 2c-3b (later): module per-context eligibility gate.
- 2c-3c (later): migrate acp into `src/modules/coding/` (declares the `'acp'` magi section, which this UI then renders).
- 2c-4 (later): remove `codingSecrets`/`codingRepos` + the `coding.secrets` permission.

**In scope:**

- `client/settings/fetcher-schemas-module-sections.ts` — Zod response schema + inferred type.
- `client/settings/admin-fetchers.ts` — `fetchModuleSections` / `patchModuleSection` / `unsetModuleSection`.
- `client/settings/sections/admin/AdminModuleSectionsSection.svelte` — the generic renderer (mirrors `AdminPluginsConfigSection.svelte`).
- `client/settings/SettingsApp.svelte` — import + bot-admin sidebar entry + mount.
- `client/settings/sections/admin/AdminModuleSectionsSection.stories.svelte` + msw handler family + scenario registration.
- `tests/client/settings/module-sections-fetchers.test.ts` (fetcher tests) + `tests/client/settings/sections/admin/AdminModuleSectionsSection.test.ts` (component test).
- Generated `tests/visual/settings/sections/admin/AdminModuleSectionsSection.spec.ts` (via `bun shoot:gen`).

**Deliberately deferred:** the eligibility gate (2c-3b), the acp migration (2c-3c), the full data-driven rip-out of `SettingsApp.svelte`'s hardcoded sections (this slice ADDS one generic module-sections area; it does not delete existing sections), richer field controls (select/toggle) and non-admin scopes.

**Behavior invariant:** production shows an **empty** "Module sections" admin area (an `EmptyState`), because no module declares `settingsSections` yet — exactly how `AdminPluginsConfigSection` behaves when no plugin has admin config. The sidebar entry is shown unconditionally to bot-admins (the codebase's existing convention; hiding-when-empty has no precedent and is not introduced here). Existing behavior is otherwise unchanged. `bun check:full` stays green.

**Empty/loading convention (mirror exactly):** `{#if sections.length === 0 && !loading}<EmptyState .../>{/if}` rendered inline after the `{#each}` (the `<section>`, `PageHeader`, and refresh button always render). Do not hide the whole section.

**Note on the gotcha found in the mirror file:** `AdminPluginsConfigSection.svelte` imports its response type from a stale path (`../../fetcher-schemas.js`) that only survives because `tsgo` doesn't typecheck `.svelte`. Do NOT reproduce that — import the inferred type from the new `fetcher-schemas-module-sections.js` where it's defined.

---

## Reference: files to mirror (read them first)

- Component: `client/settings/sections/admin/AdminPluginsConfigSection.svelte` (Svelte 5 runes; `$state`; `$effect(() => void load())` fetch-on-mount; per-entry→per-field loop; Save via patch fetcher; Clear via `Confirm` dialog → unset fetcher; inline `EmptyState`; `<section id="plugin-config">`).
- Fetchers: `client/settings/admin-fetchers.ts` (`fetchAdminPluginConfig`/`patchAdminPluginConfig`/`unsetAdminPluginConfig`) + `getJson`/`writeJson` in `client/settings/fetchers.ts`.
- Schema: `client/settings/fetcher-schemas-plugin-config.ts`.
- SPA: `client/settings/SettingsApp.svelte` (import line ~42; `buildAdminSidebarItems()` bot-admin block ~67–81; mount block ~253–265).
- Story/msw: `client/settings/sections/admin/AdminPluginsConfigSection.stories.svelte`; `client/stories/msw/settings-handlers-admin.ts` (`adminPluginConfigHandlers`); `client/stories/msw/scenarios.ts`.
- Tests: `tests/client/settings/admin-fetchers.test.ts`; `tests/client/settings/sections/admin/AdminPluginsConfigSection.test.ts`.

Backend contract (2c-3a): `GET /settings/api/admin/module-sections` → `{ sections: [{ id, label, fields: [{ key, label, value: string|null, sensitive, required }] }] }` (sensitive values masked `****last4`); `PATCH` body `{ id, key, value }` (set) or `{ action: 'unset', id, key }`.

---

## Task 1: Response schema + fetchers

**Files:** Create `client/settings/fetcher-schemas-module-sections.ts`; Modify `client/settings/admin-fetchers.ts`; Test `tests/client/settings/module-sections-fetchers.test.ts`.

- [ ] **Step 1: Write the failing fetcher test**

Read `tests/client/settings/admin-fetchers.test.ts` first (esp. the `unsetAdminPluginConfig` test, ~lines 127–146) to mirror the `setMockFetch` + `csrfHeader`/`methodOf`/`parseBody` helper pattern. Create `tests/client/settings/module-sections-fetchers.test.ts` covering:

- `fetchModuleSections` GETs `/settings/api/admin/module-sections` and parses a realistic `{ sections: [...] }` body (this exercises `ModuleSectionsResponseSchema.parse`).
- `patchModuleSection({ id, key, value })` PATCHes with that body + the CSRF header.
- `unsetModuleSection({ id, key })` PATCHes `{ action: 'unset', id, key }` + CSRF header.

Mirror the exact harness from `admin-fetchers.test.ts` (import helpers, `setCsrfToken`, `setMockFetch`, assert `seenUrl`/`seenMethod`/`seenCsrf`/`seenBody`). Keep it lint-clean (no `as unknown as`, no disable comments).

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test:client tests/client/settings/module-sections-fetchers.test.ts` (or the repo's client-test invocation — the fetchers/schema don't exist yet).
Expected: FAIL — module `fetcher-schemas-module-sections.js` / the fetchers cannot be resolved.

- [ ] **Step 3: Write the schema**

Create `client/settings/fetcher-schemas-module-sections.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

export const ModuleSectionFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.string().nullable(),
  sensitive: z.boolean(),
  required: z.boolean(),
})

export const ModuleSectionSchema = z.object({
  id: z.string(),
  label: z.string(),
  fields: z.array(ModuleSectionFieldSchema),
})

export const ModuleSectionsResponseSchema = z.object({
  sections: z.array(ModuleSectionSchema),
})

export type ModuleSectionsResponse = z.infer<typeof ModuleSectionsResponseSchema>
export type ModuleSection = z.infer<typeof ModuleSectionSchema>
export type ModuleSectionField = z.infer<typeof ModuleSectionFieldSchema>
```

- [ ] **Step 4: Add the fetchers**

In `client/settings/admin-fetchers.ts`, add the schema import (mirroring the existing `fetcher-schemas-plugin-config.js` import), and the three functions (mirroring `fetchAdminPluginConfig`/`unsetAdminPluginConfig`):

```ts
import { ModuleSectionsResponseSchema, type ModuleSectionsResponse } from './fetcher-schemas-module-sections.js'
// ...
export const fetchModuleSections = (): Promise<ModuleSectionsResponse> =>
  getJson('/settings/api/admin/module-sections', (b) => ModuleSectionsResponseSchema.parse(b))

export const patchModuleSection = (input: { id: string; key: string; value: string }): Promise<unknown> =>
  writeJson('/settings/api/admin/module-sections', 'PATCH', input, (b) => b)

export const unsetModuleSection = (input: { id: string; key: string }): Promise<unknown> =>
  writeJson('/settings/api/admin/module-sections', 'PATCH', { action: 'unset', ...input }, (b) => b)
```

(`getJson`/`writeJson` are already imported in this file. Match the existing import ordering; `bun run format` will fix.)

- [ ] **Step 5: Run test to verify it passes**

Run the client fetcher test again.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/settings/fetcher-schemas-module-sections.ts client/settings/admin-fetchers.ts tests/client/settings/module-sections-fetchers.test.ts
git commit -m "feat(settings): module-sections response schema + admin fetchers"
```

> Transient `knip` "unused" for the new exports is expected until the component (Task 2) consumes them — not a pre-commit gate.

---

## Task 2: The generic `AdminModuleSectionsSection.svelte`

**Files:** Create `client/settings/sections/admin/AdminModuleSectionsSection.svelte`; Test `tests/client/settings/sections/admin/AdminModuleSectionsSection.test.ts`.

Mirror `AdminPluginsConfigSection.svelte` closely, with these adaptations:

- Fetch via `fetchModuleSections()`; hold `sections: ModuleSection[] = $state([])`.
- Loop `{#each sections as section (section.id)}` → inner `{#each section.fields as field (field.key)}` (vs. `plugins`/`keys`). Show `section.label` (and/or `section.id`) as the block heading.
- Field rendering rules (identical to the mirror): non-null `field.value` → `<Secret value={field.value} />`; null → `unset` placeholder; `field.required` → required badge; `field.sensitive` → `<Input type="password">` else `text`; Save `<Btn>` disabled until the draft is non-blank → `patchModuleSection({ id: section.id, key: field.key, value })`; Clear `<Btn>` only `{#if field.value !== null}` → sets `pendingClear` → `Confirm` dialog → `unsetModuleSection({ id: section.id, key: field.key })`.
- `draftKey(sectionId, key)` = `` `${sectionId}::${key}` `` (composite, mirror).
- `$effect(() => { void load() })` fetch-on-mount; `load()` resets error/status, sets `loading`, assigns `.sections`, returns a success boolean, resets `loading` in `finally`.
- Header: `<PageHeader eyebrow="Admin · Modules" title="Module settings">` + refresh `IconButton`.
- `<section id="module-sections" class="settings-section">` — this exact id must equal the sidebar item id in Task 3.
- Empty state (inline, after the `{#each}`): `{#if sections.length === 0 && !loading}<EmptyState title="No module settings" hint="No installed modules expose admin settings." />{/if}`.
- Status/error: `<p class="status-error" role="alert">` / `<p class="status-success" role="status">`, gated by `!== null`.
- Testids: use stable `data-testid`s parallel to the mirror (e.g. `module-sections-refresh`, `module-section-field-${section.id}-${field.key}`, `module-section-input-${section.id}-${field.key}`) so the component test + future visual specs can target them.
- **Do NOT** copy the mirror's stale `fetcher-schemas.js` type import — import `ModuleSection` from `../../fetcher-schemas-module-sections.js`.

- [ ] **Step 1: Write the failing component test**

Read `tests/client/settings/sections/admin/AdminPluginsConfigSection.test.ts` first to mirror its harness (`mount`/`unmount`/`flushSync` from `svelte`, `json()` helper, `drain()`, `setMockFetch`/`restoreFetch`, `setCsrfToken`, mount into a fresh `#root`). Create `tests/client/settings/sections/admin/AdminModuleSectionsSection.test.ts` covering at minimum:

- Renders section + fields from a mock snapshot (assert `#module-sections` exists and the field labels/values render; masked `Secret` for a non-null sensitive value; `unset` placeholder for a null value).
- Save PATCHes the correct JSON body `{ id, key, value }` (assert via a captured body).
- Sensitive field → password input type.
- Empty response → `EmptyState` renders (and the section shell still renders).
- A 422 on Save surfaces `.status-error[role=alert]` while rows stay visible.

Keep it lint-clean.

- [ ] **Step 2: Run test to verify it fails**

Run the client component test.
Expected: FAIL — the component cannot be resolved.

- [ ] **Step 3: Write the component**

Create `client/settings/sections/admin/AdminModuleSectionsSection.svelte` per the adaptations above, mirroring `AdminPluginsConfigSection.svelte`'s structure (state, `load`, `save`, `confirmClear`, markup, styles). Reuse the same shared-UI imports the mirror uses (adjust the relative paths — same directory as the mirror, so identical `../../../shared/ui/*` / `../../components/SettingsFieldShell.svelte` / `../../../shared/Confirm.svelte`). Import the fetchers from `../../admin-fetchers.js` and the `ModuleSection` type from `../../fetcher-schemas-module-sections.js`.

- [ ] **Step 4: Run test to verify it passes**

Run the client component test.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/admin/AdminModuleSectionsSection.svelte tests/client/settings/sections/admin/AdminModuleSectionsSection.test.ts
git commit -m "feat(settings): generic AdminModuleSectionsSection renderer"
```

---

## Task 3: Wire into `SettingsApp.svelte`

**Files:** Modify `client/settings/SettingsApp.svelte`.

No new test — verified by `bun build:client` (compiles the SPA) + the storybook admin-ready shell (Task 4) + the full suite. (Note: `tsgo` does not typecheck `.svelte`, so a broken import here surfaces via `bun build:client`, not `typecheck` — run build:client in this task.)

- [ ] **Step 1: Add the import**

Alongside `import AdminPluginsConfigSection from './sections/admin/AdminPluginsConfigSection.svelte'` (~line 42), add:

```ts
import AdminModuleSectionsSection from './sections/admin/AdminModuleSectionsSection.svelte'
```

- [ ] **Step 2: Add the sidebar entry**

In `buildAdminSidebarItems()`, inside the `if (session.isBotAdmin)` block (where `{ id: 'plugin-config', label: 'Plugin config' }` is pushed), add:

```ts
{ id: 'module-sections', label: 'Module settings' },
```

- [ ] **Step 3: Mount the component**

In the admin markup zone, inside the inner `{#if settingsSession.isBotAdmin}` block (alongside `<AdminPluginsConfigSection />`), add (no props — it self-fetches):

```svelte
<AdminModuleSectionsSection />
```

- [ ] **Step 4: Build + verify no regression**

Run: `bun build:client`
Expected: builds cleanly (compiles `SettingsApp.svelte` + the new component; a bad import/mount fails here).

Run: `bun test:client tests/client/settings/`
Expected: PASS (existing settings client tests + the new ones).

- [ ] **Step 5: Commit**

```bash
git add client/settings/SettingsApp.svelte
git commit -m "feat(settings): mount Module settings admin section + sidebar entry"
```

---

## Task 4: Storybook story + msw + generated visual spec

**Files:** Create `client/settings/sections/admin/AdminModuleSectionsSection.stories.svelte`; Modify `client/stories/msw/settings-handlers-admin.ts`, `client/stories/msw/scenarios.ts`; generated `tests/visual/settings/sections/admin/AdminModuleSectionsSection.spec.ts`.

- [ ] **Step 1: Add the msw handler family**

In `client/stories/msw/settings-handlers-admin.ts`, mirror `adminPluginConfigHandlers` (reuse `boom`, `NEVER_RESOLVE_MS`, `delay`, `HandlerFamily`). Add `adminModuleSectionsHandlers` with `populated`/`empty`/`error`/`loading` for `GET /settings/api/admin/module-sections`. Populated fixture (an `'acp'` magi section):

```ts
const adminModuleSectionsPopulated = {
  sections: [
    {
      id: 'acp',
      label: 'Coding sessions (magi)',
      fields: [
        {
          key: 'magi_base_url',
          label: 'Magi Base URL',
          value: 'https://magi.example.com',
          sensitive: false,
          required: true,
        },
        { key: 'magi_token', label: 'Magi Token', value: '****abcd', sensitive: true, required: true },
      ],
    },
  ],
}
```

`empty` → `{ sections: [] }`.

- [ ] **Step 2: Register the scenarios**

In `client/stories/msw/scenarios.ts`, add the four `settings-admin-module-sections-{populated,empty,error,loading}` entries (mirroring the `settings-admin-plugin-config-*` entries), and add `...adminModuleSectionsHandlers.populated` to the aggregate `settings-shell-admin-ready` scenario.

- [ ] **Step 3: Add the story**

Create `client/settings/sections/admin/AdminModuleSectionsSection.stories.svelte`, mirroring `AdminPluginsConfigSection.stories.svelte` (title `settings/sections/admin/AdminModuleSectionsSection`, four `<Story>`s with `fixtures` params matching the scenario ids above).

- [ ] **Step 4: Generate the visual spec**

Run: `bun shoot:gen`
Expected: generates `tests/visual/settings/sections/admin/AdminModuleSectionsSection.spec.ts` (one `test()` per Story, between `@generated` markers), formats, and license-stamps it. This does NOT need a running browser. (Do NOT hand-write the spec.)

> Actual screenshot capture (`bun shoot -g AdminModuleSections`, which needs a warm `bun storybook`) is optional manual visual QA — it produces gitignored PNGs under `.storybook-shots/` and is not part of `bun check:full`. If the storybook harness is available in your environment, run it and eyeball the Populated/Empty stories; otherwise note it as a manual follow-up. Only the generated `.spec.ts` is committed.

- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/admin/AdminModuleSectionsSection.stories.svelte client/stories/msw/settings-handlers-admin.ts client/stories/msw/scenarios.ts tests/visual/settings/sections/admin/AdminModuleSectionsSection.spec.ts
git commit -m "test(settings): story + msw + visual spec for AdminModuleSectionsSection"
```

---

## Task 5: Full verification

- [ ] **Step 1: Build client bundles + run the full suite**

```bash
bun build:client
```

Run: `bun test`
Expected: PASS (server-side suite unchanged; client + visual tests are excluded from this runner per `bunfig.toml`).

- [ ] **Step 2: Client tests**

Run: `bun test:client`
Expected: PASS — includes the new fetcher + component tests.

- [ ] **Step 3: Full check pipeline**

Run: `bun check:full`
Expected: all green (lint, typecheck, format:check, license-headers, knip, test, test:client, duplicates, review-loop checks). Fix formatting with `bun run format` and re-run if needed.

> knip note: the fetchers + schema + component are all reachable once `SettingsApp.svelte` imports the component and `admin-fetchers` are consumed by it. If knip flags any as unused, a wiring step was missed.

- [ ] **Step 4: (Optional) visual QA**

If a storybook environment is available: `bun storybook` (keep warm), then `bun shoot -g AdminModuleSections`, and eyeball the Populated (renders the magi section with a masked token) and Empty (renders the EmptyState) shots. Otherwise, record as a manual follow-up.

---

## Done criteria

- A generic `AdminModuleSectionsSection.svelte` fetches `/settings/api/admin/module-sections` and renders each returned section's fields (masked secrets, Save/Clear wired to `patchModuleSection`/`unsetModuleSection`), mounted in the bot-admin settings zone with a sidebar entry (`id: 'module-sections'`).
- The fetcher/schema (`fetchModuleSections`/`patchModuleSection`/`unsetModuleSection` + `ModuleSectionsResponseSchema`) mirror the plugin-config pattern; client fetcher + component tests pass under `bun test:client`.
- A storybook story + msw handlers + a generated visual spec exist.
- `bun check:full` green; production renders an EmptyState (no module declares sections yet) — behavior otherwise unchanged.
- SettingsSectionPort is now complete (backend + frontend), so **2c-3b** (module per-context eligibility) and **2c-3c** (the acp migration — which declares the real `'acp'` magi section that this UI renders) can proceed, followed by **2c-4** (the `codingSecrets`/`codingRepos` leak removal).
