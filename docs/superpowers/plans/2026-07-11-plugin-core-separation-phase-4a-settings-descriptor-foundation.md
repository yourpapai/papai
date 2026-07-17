<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 4a — Settings Descriptor Foundation (types + serialization + renderer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing `SettingsSectionPort` descriptor contract (types + serialization + client schema + generic renderer) with the richer field kinds (`reveal-secret`, `readonly-derived`, `action-button`), section `scope`, section `visibleWhen`, and section `actions` — the additive foundation the rest of Phase 4 builds on. NO behavior change: the one existing contributor (the coding module's magi admin section) sets none of the new attributes and renders identically.

**Architecture:** The `SettingsSectionPort` already exists (`src/ports/settings-sections.ts`, admin-scoped, key/label/required/sensitive fields), served by `/settings/api/admin/module-sections` and rendered by `AdminModuleSectionsSection.svelte`. This slice grows the descriptor type with optional attributes (so existing contributors are unaffected), threads them through the backend serializer and the client Zod schema, and adds renderer support for the one display-only kind that needs no backend (`readonly-derived`). The `reveal-secret` and `action-button` render paths + the per-context serving + `visibleWhen` evaluation are deliberately deferred to 4b/4d (they need backend routes/eligibility that don't exist yet). The port stays feature-agnostic (architecture-guard scanned).

**Tech Stack:** Bun; strict TypeScript (`.js` import extensions); Zod v4; Svelte; `bun:test` + client tests.

---

## Context for the implementer (read before starting)

- **Additive only — zero behavior change.** Every new field/section attribute is OPTIONAL. The existing contributor `codingAcpSettingsSection` (`src/modules/coding/acp/contributions.ts`) uses only `key/label/required/sensitive` and must keep rendering exactly as today (text/password Input + Save/Clear). Verify with the existing admin-module-sections tests + the visual spec.
- **Architecture guard:** `src/ports/settings-sections.ts` is scanned for `/\b(kaneo|youtrack|magi|coding)\b/iu`. Your additions (types, comments, examples) must contain NONE of those words. Use provider-neutral examples (`'members.provision'` is fine — it's a capability string, not a banned word). Run `bun test tests/architecture-guard.test.ts` after editing the port.
- **Scope discipline for 4a:** define the TYPES for `visibleWhen` + `actions` + `reveal-secret`/`action-button` controls, and serialize the ones that need no backend, but do NOT implement: per-context/group serving (4b), `visibleWhen` evaluation (4b), the `reveal-secret` reveal flow (4d — needs an HttpRoutePort route), or `action-button` invocation (4d). Only `readonly-derived` gets a live renderer path here (its value is serialized in the descriptor; no backend action needed).
- **Verified current shapes** (from recon):
  - Port `src/ports/settings-sections.ts`: `SettingsField = { key; label; required?; sensitive? }`, `SettingsSection = { id; label; fields }`, `moduleSettingsRegistry`.
  - Backend serializer `src/debug/admin-module-sections.ts`: `buildModuleSectionDescriptors()` + `getModuleSectionsSnapshot(...)` → `ModuleSectionState = { id; label; fields: ModuleSectionFieldState[] }`, `ModuleSectionFieldState = { key; label; value: string|null; sensitive; required }`; values read via `getPluginAdminConfig(section.id, field.key)`.
  - Client schema `client/settings/fetcher-schemas-module-sections.ts`: `ModuleSectionFieldSchema { key; label; value: nullable; sensitive; required }`, `ModuleSectionSchema { id; label; fields }`, `ModuleSectionsResponseSchema { sections }`.
  - Renderer `client/settings/sections/admin/AdminModuleSectionsSection.svelte`: `#each section.fields` → `SettingsFieldShell` with a text/password `Input` + Save/Clear; `Secret` for the current value.

---

## File Structure

- Modify: `src/ports/settings-sections.ts` (descriptor types), `src/debug/admin-module-sections.ts` (serialize new attributes), `client/settings/fetcher-schemas-module-sections.ts` (client schema), `client/settings/sections/admin/AdminModuleSectionsSection.svelte` (renderer: readonly-derived)
- Modify (tests): `tests/ports/settings-sections.test.ts` (or wherever the port is tested), `tests/debug/admin-module-sections.test.ts`, `tests/client/settings/fetcher-schemas-module-sections.test.ts`, `tests/client/settings/sections/AdminModuleSectionsSection.test.ts`

---

## Task 1: Extend the port descriptor types

**Files:**

- Modify: `src/ports/settings-sections.ts`
- Test: the port's test suite (find via `rg -l "moduleSettingsRegistry|SettingsSection" tests`)

- [ ] **Step 1: Write/extend the failing test**

In the port's test suite, assert the new type surface is usable and feature-agnostic. Add a test constructing a section that uses the new attributes (a `readonly-derived` field, a `reveal-secret` field, an `action-button` field wired to an action, a `visibleWhen` rule, `scope: 'context'`) and register/list it — plus a test that a minimal `{ id, label, fields:[{key,label}] }` section still typechecks/registers unchanged. Example:

```ts
test('registry accepts a rich descriptor with new field kinds + visibleWhen + actions', () => {
  const registry = createSettingsSectionRegistry()
  const section: SettingsSection = {
    id: 'demo',
    label: 'Demo',
    scope: 'context',
    visibleWhen: { kind: 'providerCapability', capability: 'members.provision' },
    actions: [{ id: 'provision', label: 'Provision', route: '/ext/demo/provision', method: 'POST' }],
    fields: [
      { key: 'login', label: 'Login', control: 'readonly-derived' },
      { key: 'password', label: 'Password', control: 'reveal-secret', sensitive: true },
      { key: 'provision', label: 'Provision', control: 'action-button', actionId: 'provision' },
    ],
  }
  registry.register([section])
  expect(registry.list()).toHaveLength(1)
})

test('a minimal descriptor (no new attributes) still registers', () => {
  const registry = createSettingsSectionRegistry()
  registry.register([{ id: 'm', label: 'M', fields: [{ key: 'k', label: 'K' }] }])
  expect(registry.list()[0]?.fields[0]?.control).toBeUndefined()
})
```

Run → FAIL (new types don't exist).

- [ ] **Step 2: Extend the types in `src/ports/settings-sections.ts`**

Add (keep the file feature-agnostic — no kaneo/youtrack/magi/coding in any name/comment/example):

```ts
/** Render control for a settings field. Defaults to a text input (password when `sensitive`). */
export type SettingsFieldControl = 'text' | 'select' | 'toggle' | 'reveal-secret' | 'readonly-derived' | 'action-button'

/** An option for `select`/`toggle` controls. */
export type SettingsFieldOption = { value: string; label: string }

/** An action a section exposes (e.g. a provision button), invoked via a contributed route. */
export type SettingsAction = { id: string; label: string; route: string; method?: 'POST' | 'GET' }

/** Section-level visibility, evaluated server-side per context; the client only receives resolved sections. */
export type SettingsVisibilityRule = { kind: 'providerCapability'; capability: string }

/** Config scope a section reads/writes. Defaults to `'admin'` (the only scope supported before Phase 4b). */
export type SettingsSectionScope = 'admin' | 'context' | 'group'
```

Extend `SettingsField` (all new attributes optional):

```ts
export type SettingsField = {
  key: string
  label: string
  required?: boolean
  sensitive?: boolean
  /** Render control. Omitted → a text input (password when `sensitive`). */
  control?: SettingsFieldControl
  /** Options for `select`/`toggle` controls. */
  options?: readonly SettingsFieldOption[]
  /** For `action-button` fields: the id of the `SettingsAction` this button invokes. */
  actionId?: string
}
```

Extend `SettingsSection` (all new attributes optional):

```ts
export type SettingsSection = {
  id: string
  label: string
  fields: readonly SettingsField[]
  /** Config scope. Omitted → `'admin'`. */
  scope?: SettingsSectionScope
  /** Section-level visibility, evaluated server-side per context. */
  visibleWhen?: SettingsVisibilityRule
  /** Actions (buttons) the section exposes. */
  actions?: readonly SettingsAction[]
}
```

Leave `SettingsSectionRegistry`/`createSettingsSectionRegistry`/`moduleSettingsRegistry` unchanged.

- [ ] **Step 3: Verify**

Run the port test → PASS. `bun run typecheck` → clean (the existing `codingAcpSettingsSection` + any other contributor still satisfy the widened-but-optional type). `bun test tests/architecture-guard.test.ts` → PASS (no banned words leaked into the port).

- [ ] **Step 4: Commit**

```bash
git add src/ports/settings-sections.ts <the port test file>
git commit -m "feat(ports): extend SettingsSection descriptor with field kinds, visibleWhen, actions, scope"
```

---

## Task 2: Serialize the new descriptor attributes (backend)

Thread the new field/section attributes through the descriptor serializer so the client receives them. Behavior-preserving: the existing contributor sets none of them, so the serialized output for the magi section is byte-identical (new keys are absent/undefined).

**Files:**

- Modify: `src/debug/admin-module-sections.ts`
- Test: `tests/debug/admin-module-sections.test.ts`

- [ ] **Step 1: Read `src/debug/admin-module-sections.ts`**

Understand `buildModuleSectionDescriptors()` + `getModuleSectionsSnapshot(...)` and the `ModuleSectionState`/`ModuleSectionFieldState` types. Identify where each field is mapped to its serialized shape.

- [ ] **Step 2: Extend the serialized field/section shapes**

Add the new OPTIONAL attributes to `ModuleSectionFieldState` and `ModuleSectionState`, carrying them from the descriptor:

- Field: `control?: SettingsFieldControl` (from `field.control`), `options?: readonly SettingsFieldOption[]` (from `field.options`), `actionId?: string` (from `field.actionId`).
- Section: `scope?: SettingsSectionScope` (from `section.scope`), `actions?: readonly SettingsAction[]` (from `section.actions`).
  Do NOT serialize `visibleWhen` to the client (it is server-evaluated — deferred to 4b; the client only ever sees resolved/visible sections). For a `readonly-derived` field, the serialized `value` is the resolved value (same `getPluginAdminConfig` read as today; a future context-scoped source arrives in 4b). Keep the existing `value`/`sensitive`/`required` fields untouched.
  Import the new types from `../ports/settings-sections.js`.

- [ ] **Step 3: Add a test**

In `tests/debug/admin-module-sections.test.ts`: register a fabricated section that sets `control`/`options`/`actionId`/`scope`/`actions`, snapshot it, and assert the new attributes round-trip into the serialized output; and assert a plain section (no new attributes) serializes with those keys ABSENT/undefined (behavior-preserving). Confirm the existing magi-section test still passes unchanged. Run → the new test drives the serialization change.

- [ ] **Step 4: Verify + commit**

`bun test tests/debug/admin-module-sections.test.ts` → PASS. `bun run typecheck` → clean.

```bash
git add src/debug/admin-module-sections.ts tests/debug/admin-module-sections.test.ts
git commit -m "feat(settings): serialize descriptor field-kind/scope/actions attributes"
```

---

## Task 3: Client schema + `readonly-derived` renderer support

Extend the client Zod schema for the new attributes, and add the one new render path that needs no backend (`readonly-derived`). The other new controls (`reveal-secret`, `action-button`) get their render paths in 4d when their backend routes exist.

**Files:**

- Modify: `client/settings/fetcher-schemas-module-sections.ts`, `client/settings/sections/admin/AdminModuleSectionsSection.svelte`
- Test: `tests/client/settings/fetcher-schemas-module-sections.test.ts`, `tests/client/settings/sections/AdminModuleSectionsSection.test.ts`

- [ ] **Step 1: Extend the client Zod schema**

In `client/settings/fetcher-schemas-module-sections.ts`, add the new OPTIONAL fields (matching the serialized shape from Task 2):

```ts
export const SettingsFieldControlSchema = z.enum([
  'text',
  'select',
  'toggle',
  'reveal-secret',
  'readonly-derived',
  'action-button',
])
export const SettingsFieldOptionSchema = z.object({ value: z.string(), label: z.string() })
export const SettingsActionSchema = z.object({
  id: z.string(),
  label: z.string(),
  route: z.string(),
  method: z.enum(['POST', 'GET']).optional(),
})

export const ModuleSectionFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.string().nullable(),
  sensitive: z.boolean(),
  required: z.boolean(),
  control: SettingsFieldControlSchema.optional(),
  options: z.array(SettingsFieldOptionSchema).optional(),
  actionId: z.string().optional(),
})

export const ModuleSectionSchema = z.object({
  id: z.string(),
  label: z.string(),
  fields: z.array(ModuleSectionFieldSchema),
  scope: z.enum(['admin', 'context', 'group']).optional(),
  actions: z.array(SettingsActionSchema).optional(),
})
```

(`ModuleSectionsResponseSchema` unchanged.) Update `knip.jsonc` if a new type-only export trips knip (mirror the existing `fetcher-schemas-*` `["types"]` entries).

- [ ] **Step 2: Add schema tests**

In `tests/client/settings/fetcher-schemas-module-sections.test.ts`: parse a field with `control: 'readonly-derived'` and one with `control: 'action-button'` + `actionId`; parse a section with `scope: 'context'` + `actions`; and confirm a legacy field/section (no new keys) still parses (backward-compatible). Run → drives the schema change.

- [ ] **Step 3: Add the `readonly-derived` render path**

In `AdminModuleSectionsSection.svelte`, in the per-field `#each`, branch on `field.control`:

- `control === 'readonly-derived'`: render a display-only row (the value via a read-only display — e.g. `Secret` for sensitive, else plain text) with NO `Input`/Save/Clear editor. (A read-only field cannot be edited or cleared.)
- default (undefined / `'text'` / `'select'` / `'toggle'`): the EXISTING rendering — unchanged.
- `control === 'reveal-secret'` / `'action-button'`: for THIS phase, render them the same as the default (or a clearly-inert placeholder) — their real render paths land in 4d with the backend. Do NOT wire a reveal/action flow here (no backend route exists yet). Prefer: fall through to the existing editor for now, OR render a disabled placeholder — pick whichever keeps the component test simple and does not fabricate a non-functional button; note your choice.

Keep the existing rendering for all current fields IDENTICAL (the magi section has no `control` → default path). This is the load-bearing no-behavior-change requirement.

- [ ] **Step 4: Component test**

In `tests/client/settings/sections/AdminModuleSectionsSection.test.ts` (create if absent, mirroring a sibling section test's harness): render the component with a mocked `fetchModuleSections` returning a section with a `readonly-derived` field → assert its value renders read-only and there is NO save/clear editor for it; and a legacy text field still renders its editor. Confirm the existing magi-section behavior is unchanged.

- [ ] **Step 5: Full verification**

- `bun run typecheck` + `bun run lint` + `bun run knip` → clean.
- `bun test:client tests/client/settings/` → PASS.
- Visual: the existing `module-sections` admin section screenshot must be UNCHANGED (no live section uses the new controls yet). Run the repo's visual check for it if one exists; a pixel change here means the default path was altered — fix it.
- `bun check:full` → 12/12.

- [ ] **Step 6: Commit**

```bash
git add client/settings/fetcher-schemas-module-sections.ts client/settings/sections/admin/AdminModuleSectionsSection.svelte \
  tests/client/settings/fetcher-schemas-module-sections.test.ts tests/client/settings/sections/AdminModuleSectionsSection.test.ts <knip.jsonc if changed>
git commit -m "feat(settings-ui): descriptor schema + readonly-derived renderer support"
```

---

## Self-Review notes (author)

- **Spec coverage (§7 foundation):** the descriptor now carries field kinds (`reveal-secret`/`readonly-derived`/`action-button`), `scope`, `visibleWhen`, and `actions`; the serializer + client schema thread the serializable ones; the renderer handles `readonly-derived`. The remaining kinds + per-context serving + `visibleWhen` evaluation are the explicit jobs of 4b/4d.
- **Additive / no behavior change:** every new attribute is optional; the one existing contributor sets none, so its serialized output + rendering are identical (guarded by the unchanged magi-section tests + visual spec).
- **Guard:** the port stays feature-agnostic (verified by running the guard after Task 1); provider-neutral examples only.
- **Deferred (documented):** `reveal-secret` reveal flow + `action-button` invocation (need HttpRoutePort routes — 4d); per-context/group serving + `visibleWhen` evaluation (4b); the two different reveal-once secret mechanisms map on in 4d/4e; SettingsApp descriptor-driven rewrite (4g).
- **Decision defaults applied:** `visibleWhen` is a closed discriminated union (one `providerCapability` rule kind for now, keyed off a capability string — the taxonomy the code checks today); `reveal-secret` is one field kind (the stored reveal-once contract, wired in 4d); `SettingsAction.route` points at the future `/ext/*` routes.
