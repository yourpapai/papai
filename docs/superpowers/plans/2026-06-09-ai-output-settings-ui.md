<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# AI Output Settings UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the three existing AI-output keys (`ai_tool_visibility`, `ai_reasoning_visibility`, `ai_output_detail_level`) as editable controls in the settings web UI, in both personal and group contexts.

**Architecture:** Approach A — extend the generic `ConfigField` pipeline to carry an optional enum control descriptor (`control` + `options`), register the three keys so the existing GET/PATCH config route accepts them, and render them through a new `AiOutputSection` using the existing `SegmentedControl` (save-on-change). No orchestrator or `getAiOutputSettings` change; the read side is already wired.

**Tech Stack:** Bun + `bun:test`, TypeScript (strict, `.js` import paths), Zod v4, Svelte 5 (runes), happy-dom for client tests.

**Spec:** `docs/superpowers/specs/2026-06-09-ai-output-settings-ui-design.md`
**Branch:** `feat/ai-output-settings-ui` (already created; the spec is committed there)

---

## Background the engineer must know

- **Config storage.** Per-context settings live in the `user_config` table, fronted by an in-memory cache. `setConfigValue(contextId, key, value)` (`src/config.ts:64`) writes the cache immediately (DB syncs in background) and **throws if the key is not allow-listed** by `isAllowedDynamicConfigKey`. `getConfigValue` returns `null` for non-allow-listed keys. So the three keys MUST be added to `ALL_CONFIG_KEYS` or both read and write fail.
- **The read side is done.** `getAiOutputSettings(contextId)` (`src/ai-output-settings.ts`) reads the three keys via `getCachedConfig` and the orchestrator consumes them. Once the write path stores values into the same cache, the bot picks them up with no further wiring.
- **Defaults are not stored.** Absent keys resolve to `off`/`off`/`sanitized` via the parsers in `ai-output-settings.ts`. The GET route returns `value: ''` for an unset key; the new section maps an empty value to the first option (which is the default) for display.
- **`required: false` is mandatory for these fields.** `getRequiredProviderConfigKeysForContext` (`src/config-keys.ts:103`) returns every field where `required && kind !== 'preference'`, and `llm-orchestrator-config.ts` treats those as "context not fully configured." A `required: true` ai-output field would wrongly block the bot. Keep them `required: false`.
- **Enum values pass through unchanged.** `normalizeDynamicConfigValue`/`readDynamicConfigValue` only special-case `timezone`; `on`/`off`/`sanitized`/`raw` are stored and read verbatim.
- **Test commands.**
  - Server test (single file): `bun test <path>`
  - Client test (single file): `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' <path>`
  - Typecheck: `bun run typecheck`
- **TDD hook.** Every edit to a `src/`/`client/` implementation file runs a hook that requires the resolved test file to pass. Always write/extend the test first, watch it fail, then implement. Do not add `eslint-disable`/`@ts-ignore` — the hook blocks them.

## File structure

**Backend**

- `src/types/config.ts` — extend `ConfigField` (add `control?`, `options?`, `kind: 'ai-output'`); add `AiOutputConfigKey` to `ConfigKey` + `ALL_CONFIG_KEYS`.
- `src/config-keys.ts` — add `AI_OUTPUT_FIELDS`; append to every `getConfigFieldsForContext` return path.
- `src/config-editor/validation.ts` — generic enum check when `field.options` is set.
- `src/debug/settings/config-routes.ts` — forward `control`/`options` in the GET field mapping.

**Frontend**

- `client/settings/fetcher-schemas.ts` — add optional `control`/`options` to `ConfigFieldSchema`.
- `client/settings/components/ConfigFieldRow.svelte` — render `SegmentedControl` for enum controls (save-on-change, revert-on-error); text/secret branch unchanged.
- `client/settings/sections/AiOutputSection.svelte` — new section; filters `kind === 'ai-output'`, maps empty→default.
- `client/settings/SettingsApp.svelte` — register the section + Personal sidebar item.

**Docs**

- `docs/adr/0144-ai-output-visibility.md` — correct the stale `setAiOutputSetting()` reference.

**Tests touched:** `tests/types/config.test.ts`, `tests/config-editor/validation.test.ts`, `tests/config-keys.test.ts`, `tests/debug/settings/config-routes.test.ts`, `tests/client/settings/fetcher-schemas.test.ts`, `tests/client/settings/components/ConfigFieldRow.test.ts`, `tests/client/settings/sections/AiOutputSection.test.ts` (new), `tests/client/settings/SettingsApp.test.ts`.

---

## Task 1: Extend `ConfigField` and register the three keys

**Files:**

- Modify: `src/types/config.ts`
- Test: `tests/types/config.test.ts`

- [ ] **Step 1: Update the failing tests**

In `tests/types/config.test.ts`, replace the `ALL_CONFIG_KEYS` assertion (currently `expect(ALL_CONFIG_KEYS).toEqual(['timezone', 'mcp_endpoints'])`) and add allow-list coverage:

```ts
describe('ALL_CONFIG_KEYS', () => {
  test('ALL_CONFIG_KEYS contains the static preference and AI-output keys', () => {
    expect(ALL_CONFIG_KEYS).toEqual([
      'timezone',
      'mcp_endpoints',
      'ai_tool_visibility',
      'ai_reasoning_visibility',
      'ai_output_detail_level',
    ])
  })
})
```

Then add, inside the `isAllowedDynamicConfigKey` describe block:

```ts
test('accepts the AI-output config keys', () => {
  expect(isAllowedDynamicConfigKey('ai_tool_visibility')).toBe(true)
  expect(isAllowedDynamicConfigKey('ai_reasoning_visibility')).toBe(true)
  expect(isAllowedDynamicConfigKey('ai_output_detail_level')).toBe(true)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/types/config.test.ts`
Expected: FAIL — `ALL_CONFIG_KEYS` does not yet contain the three keys.

- [ ] **Step 3: Implement the type + key changes**

In `src/types/config.ts`:

Add the AI-output key type next to the other key types:

```ts
// AI output visibility config keys (always available)
export type AiOutputConfigKey = 'ai_tool_visibility' | 'ai_reasoning_visibility' | 'ai_output_detail_level'
```

Extend the `ConfigKey` union:

```ts
export type ConfigKey = PreferenceConfigKey | McpConfigKey | AiOutputConfigKey
```

Extend `ALL_CONFIG_KEYS`:

```ts
export const ALL_CONFIG_KEYS: readonly ConfigKey[] = [
  'timezone',
  'mcp_endpoints',
  'ai_tool_visibility',
  'ai_reasoning_visibility',
  'ai_output_detail_level',
]
```

Extend the `ConfigField` type with the optional control descriptor and the new `kind`:

```ts
export type ConfigFieldOption = {
  readonly value: string
  readonly label: string
}

export type ConfigField = {
  readonly key: string
  readonly storageKey: string
  readonly label: string
  readonly required: boolean
  readonly sensitive: boolean
  readonly kind: 'preference' | 'provider-context' | 'plugin-context' | 'ai-output'
  readonly control?: 'text' | 'toggle' | 'select'
  readonly options?: readonly ConfigFieldOption[]
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/types/config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types/config.ts tests/types/config.test.ts
git commit -m "feat(config): add AI-output keys and typed ConfigField controls"
```

---

## Task 2: Enum validation in `validateConfigField`

**Files:**

- Modify: `src/config-editor/validation.ts`
- Test: `tests/config-editor/validation.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/config-editor/validation.test.ts`, inside the `validateConfigField` describe block. Note the existing `field()` helper accepts `Partial<ConfigField>` overrides, so `control`/`options` flow through:

```ts
test('validates enum fields against their options', () => {
  const enumField = field('ai_output_detail_level', {
    kind: 'ai-output',
    required: false,
    control: 'select',
    options: [
      { value: 'sanitized', label: 'Sanitized' },
      { value: 'raw', label: 'Raw' },
    ],
  })

  expect(validateConfigField(enumField, 'raw').valid).toBe(true)
  expect(validateConfigField(enumField, 'sanitized').valid).toBe(true)

  const bad = validateConfigField(enumField, 'verbose')
  expect(bad.valid).toBe(false)
  expect(bad.error).toContain('must be one of')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/config-editor/validation.test.ts`
Expected: FAIL — `'verbose'` currently validates as `{ valid: true }`.

- [ ] **Step 3: Implement the enum check**

In `src/config-editor/validation.ts`, replace the body of `validateConfigField`:

```ts
export function validateConfigField(field: ConfigField, value: string): ValidationResult {
  if (field.required && value.trim().length === 0) {
    return { valid: false, error: `${field.label} cannot be empty` }
  }
  if (field.storageKey === 'timezone') return validateTimezone(value)
  if (field.options !== undefined && !field.options.some((option) => option.value === value)) {
    const allowed = field.options.map((option) => option.value).join(', ')
    return { valid: false, error: `${field.label} must be one of: ${allowed}` }
  }
  return { valid: true }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/config-editor/validation.test.ts`
Expected: PASS (all existing tests still pass)

- [ ] **Step 5: Commit**

```bash
git add src/config-editor/validation.ts tests/config-editor/validation.test.ts
git commit -m "feat(config): validate enum config fields against their options"
```

---

## Task 3: Surface AI-output fields from `getConfigFieldsForContext`

**Files:**

- Modify: `src/config-keys.ts`
- Test: `tests/config-keys.test.ts`

- [ ] **Step 1: Update existing key assertions and add a field test**

In `tests/config-keys.test.ts`, the AI-output keys now append to every `getConfigKeysForContext` result. Update the **six** exact-array assertions:

Lines asserting `toEqual(['timezone', 'mcp_endpoints'])` (the unassigned, kaneo, missing, and stopped cases) become:

```ts
expect(getConfigKeysForContext('ctx-unassigned')).toEqual([
  'timezone',
  'mcp_endpoints',
  'ai_tool_visibility',
  'ai_reasoning_visibility',
  'ai_output_detail_level',
])
```

Apply the same five-element array to the `ctx-kaneo`, `ctx-missing`, and `ctx-stopped` assertions.

The YouTrack assertion becomes:

```ts
expect(getConfigKeysForContext('ctx-yt')).toEqual([
  'plugin:task-provider-youtrack:provider:token',
  'timezone',
  'mcp_endpoints',
  'ai_tool_visibility',
  'ai_reasoning_visibility',
  'ai_output_detail_level',
])
```

The demo-tracker assertion becomes:

```ts
expect(getConfigKeysForContext('ctx-demo')).toEqual([
  'plugin:demo-plugin:provider:token',
  'timezone',
  'mcp_endpoints',
  'ai_tool_visibility',
  'ai_reasoning_visibility',
  'ai_output_detail_level',
])
```

(The `getAllConfig('ctx-yt')` test that expects `{ timezone: 'UTC' }` does **not** change — unset AI-output keys have no cached value and are skipped.)

Then add a new test in the `getConfigFieldsForContext` describe block:

```ts
test('includes the three AI-output fields as enum controls in any context', () => {
  const fields = getConfigFieldsForContext('ctx-any')
  const byKey = new Map(fields.map((field) => [field.storageKey, field]))

  const tool = byKey.get('ai_tool_visibility')
  expect(tool?.kind).toBe('ai-output')
  expect(tool?.required).toBe(false)
  expect(tool?.control).toBe('toggle')
  expect(tool?.options).toEqual([
    { value: 'off', label: 'Off' },
    { value: 'on', label: 'On' },
  ])

  expect(byKey.get('ai_reasoning_visibility')?.control).toBe('toggle')

  const detail = byKey.get('ai_output_detail_level')
  expect(detail?.control).toBe('select')
  expect(detail?.options).toEqual([
    { value: 'sanitized', label: 'Sanitized' },
    { value: 'raw', label: 'Raw' },
  ])
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/config-keys.test.ts`
Expected: FAIL — the new field test fails (fields absent) and the updated key assertions fail until implementation.

- [ ] **Step 3: Implement `AI_OUTPUT_FIELDS`**

In `src/config-keys.ts`, add the import for the key constants at the top:

```ts
import {
  AI_OUTPUT_DETAIL_LEVEL_KEY,
  AI_REASONING_VISIBILITY_KEY,
  AI_TOOL_VISIBILITY_KEY,
} from './ai-output-settings.js'
```

Add the constant next to `PREFERENCE_FIELDS`:

```ts
const AI_OUTPUT_FIELDS: readonly ConfigField[] = [
  {
    key: 'ai_tool_visibility',
    storageKey: AI_TOOL_VISIBILITY_KEY,
    label: 'Show tool calls',
    required: false,
    sensitive: false,
    kind: 'ai-output',
    control: 'toggle',
    options: [
      { value: 'off', label: 'Off' },
      { value: 'on', label: 'On' },
    ],
  },
  {
    key: 'ai_reasoning_visibility',
    storageKey: AI_REASONING_VISIBILITY_KEY,
    label: 'Show reasoning',
    required: false,
    sensitive: false,
    kind: 'ai-output',
    control: 'toggle',
    options: [
      { value: 'off', label: 'Off' },
      { value: 'on', label: 'On' },
    ],
  },
  {
    key: 'ai_output_detail_level',
    storageKey: AI_OUTPUT_DETAIL_LEVEL_KEY,
    label: 'Detail level',
    required: false,
    sensitive: false,
    kind: 'ai-output',
    control: 'select',
    options: [
      { value: 'sanitized', label: 'Sanitized' },
      { value: 'raw', label: 'Raw' },
    ],
  },
]
```

In `getConfigFieldsForContext`, append `...AI_OUTPUT_FIELDS` to **every** return statement. There are four early returns plus the final return; each currently ends with `...PREFERENCE_FIELDS]`. Change each to:

```ts
return [...pluginFields, ...PREFERENCE_FIELDS, ...AI_OUTPUT_FIELDS]
```

and the final one to:

```ts
return [...providerFields, ...pluginFields, ...PREFERENCE_FIELDS, ...AI_OUTPUT_FIELDS]
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/config-keys.test.ts`
Expected: PASS

- [ ] **Step 5: Run the config consumer suites to confirm no other assertions broke**

Run: `bun test tests/config.test.ts tests/llm-orchestrator-config.test.ts`
Expected: PASS (AI-output fields are `required:false`, so required-key logic is unaffected)

- [ ] **Step 6: Commit**

```bash
git add src/config-keys.ts tests/config-keys.test.ts
git commit -m "feat(config): surface AI-output fields from getConfigFieldsForContext"
```

---

## Task 4: Forward `control`/`options` through the config GET route

**Files:**

- Modify: `src/debug/settings/config-routes.ts`
- Test: `tests/debug/settings/config-routes.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/debug/settings/config-routes.test.ts`. Extend the local `GetResponseSchema` near the top of the file to capture the new optional fields:

```ts
const GetResponseSchema = z.object({
  fields: z.array(
    z.object({
      key: z.string(),
      sensitive: z.boolean(),
      hasValue: z.boolean(),
      value: z.string(),
      control: z.string().optional(),
      options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
    }),
  ),
})
```

Then add a test inside the `settings config routes` describe block:

```ts
test('GET forwards control and options for AI-output fields', async () => {
  const res = await handleConfigRoutes(
    new Request('https://x/settings/api/config', {
      headers: authHeaders(session),
    }),
    new URL('https://x/settings/api/config'),
  )
  expect(res.status).toBe(200)
  const body = GetResponseSchema.parse(await res.json())
  const detail = body.fields.find((f) => f.key === 'ai_output_detail_level')
  assert(detail, 'expected ai_output_detail_level field in GET response')
  expect(detail.control).toBe('select')
  expect(detail.options).toEqual([
    { value: 'sanitized', label: 'Sanitized' },
    { value: 'raw', label: 'Raw' },
  ])
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/debug/settings/config-routes.test.ts`
Expected: FAIL — `detail.control` is `undefined` (route does not forward it yet).

- [ ] **Step 3: Implement the forwarding**

In `src/debug/settings/config-routes.ts`, in `handleGet`, add the two properties to the mapped object (after `kind: field.kind,`):

```ts
return {
  key: field.key,
  storageKey: field.storageKey,
  label: field.label,
  required: field.required,
  sensitive: field.sensitive,
  kind: field.kind,
  control: field.control,
  options: field.options,
  hasValue,
  value: hasValue && field.sensitive ? maskSensitiveValue(raw) : (raw ?? ''),
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/debug/settings/config-routes.test.ts`
Expected: PASS

- [ ] **Step 5: Run the parity suite (it compares config field shapes)**

Run: `bun test tests/debug/settings/config-parity.test.ts`
Expected: PASS — if it fails because it asserts an exact field-key set, update its expected shape to include `control`/`options` (optional) the same way, then re-run.

- [ ] **Step 6: Commit**

```bash
git add src/debug/settings/config-routes.ts tests/debug/settings/config-routes.test.ts
git commit -m "feat(settings): forward control/options in config GET response"
```

---

## Task 5: Extend the client `ConfigFieldSchema`

**Files:**

- Modify: `client/settings/fetcher-schemas.ts`
- Test: `tests/client/settings/fetcher-schemas.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/client/settings/fetcher-schemas.test.ts`, inside the `fetcher-schemas` describe block:

```ts
test('ConfigResponseSchema parses enum control fields', () => {
  const parsed = ConfigResponseSchema.parse({
    contextId: 'user:1',
    fields: [
      {
        key: 'ai_output_detail_level',
        storageKey: 'ai_output_detail_level',
        label: 'Detail level',
        required: false,
        sensitive: false,
        kind: 'ai-output',
        control: 'select',
        options: [
          { value: 'sanitized', label: 'Sanitized' },
          { value: 'raw', label: 'Raw' },
        ],
        hasValue: false,
        value: '',
      },
    ],
  })
  expect(parsed.fields[0]!.control).toBe('select')
  expect(parsed.fields[0]!.options).toHaveLength(2)
})
```

Confirm `ConfigResponseSchema` is already imported at the top of the test file (it is used by the existing `ConfigResponseSchema parses fields` test).

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/fetcher-schemas.test.ts`
Expected: FAIL — `parsed.fields[0].control` is `undefined` because the schema strips unknown keys.

- [ ] **Step 3: Implement the schema change**

In `client/settings/fetcher-schemas.ts`, extend `ConfigFieldSchema`:

```ts
export const ConfigFieldSchema = z.object({
  key: z.string(),
  storageKey: z.string(),
  label: z.string(),
  required: z.boolean(),
  sensitive: z.boolean(),
  kind: z.string(),
  control: z.enum(['text', 'toggle', 'select']).optional(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  hasValue: z.boolean(),
  value: z.string(),
})
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/fetcher-schemas.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/settings/fetcher-schemas.ts tests/client/settings/fetcher-schemas.test.ts
git commit -m "feat(settings): parse control/options on client ConfigField schema"
```

---

## Task 6: Render enum controls in `ConfigFieldRow`

**Files:**

- Modify: `client/settings/components/ConfigFieldRow.svelte`
- Test: `tests/client/settings/components/ConfigFieldRow.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/client/settings/components/ConfigFieldRow.test.ts`, inside the `ConfigFieldRow` describe block:

```ts
test('an enum field renders a SegmentedControl and PATCHes on change', async () => {
  setCsrfToken('c')
  let body = ''
  setMockFetch((_url, init) => {
    body = bodyString(init)
    return Promise.resolve(json({ ok: true, contextId: 'user:1' }))
  })
  let saved = false
  const { component, target } = render({
    contextId: 'user:1',
    field: {
      key: 'ai_tool_visibility',
      storageKey: 'ai_tool_visibility',
      label: 'Show tool calls',
      required: false,
      sensitive: false,
      kind: 'ai-output',
      control: 'toggle',
      options: [
        { value: 'off', label: 'Off' },
        { value: 'on', label: 'On' },
      ],
      hasValue: false,
      value: 'off',
    },
    onSaved: () => {
      saved = true
    },
  })
  flushSync()
  target.querySelector<HTMLButtonElement>('[data-testid="cfg-seg-ai_tool_visibility-on"]')!.click()
  await drain()
  expect(body).toBe(
    JSON.stringify({
      key: 'ai_tool_visibility',
      value: 'on',
      contextId: 'user:1',
    }),
  )
  expect(saved).toBe(true)
  void unmount(component)
})

test('an enum field reverts to the previous value when the PATCH fails', async () => {
  setCsrfToken('c')
  setMockFetch(() => Promise.resolve(new Response('nope', { status: 500 })))
  const { component, target } = render({
    contextId: 'user:1',
    field: {
      key: 'ai_output_detail_level',
      storageKey: 'ai_output_detail_level',
      label: 'Detail level',
      required: false,
      sensitive: false,
      kind: 'ai-output',
      control: 'select',
      options: [
        { value: 'sanitized', label: 'Sanitized' },
        { value: 'raw', label: 'Raw' },
      ],
      hasValue: false,
      value: 'sanitized',
    },
    onSaved: () => undefined,
  })
  flushSync()
  target.querySelector<HTMLButtonElement>('[data-testid="cfg-seg-ai_output_detail_level-raw"]')!.click()
  await drain()
  expect(target.querySelector('.status-error')).not.toBeNull()
  const sanitizedBtn = target.querySelector<HTMLButtonElement>(
    '[data-testid="cfg-seg-ai_output_detail_level-sanitized"]',
  )!
  expect(sanitizedBtn.getAttribute('aria-checked')).toBe('true')
  void unmount(component)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/components/ConfigFieldRow.test.ts`
Expected: FAIL — no `cfg-seg-*` elements exist yet.

- [ ] **Step 3: Implement the enum branch**

In `client/settings/components/ConfigFieldRow.svelte`, add the import:

```svelte
  import SegmentedControl from '../../shared/ui/SegmentedControl.svelte'
```

Add state after the existing `let saving = $state(false)`:

```svelte
  const isEnum = $derived(field.control === 'toggle' || field.control === 'select')
  let current = $state(field.value)
```

Update the existing `$effect` so it also re-syncs `current`:

```svelte
  $effect(() => {
    // Re-sync local edit state when the field prop changes (parent re-fetch / context switch).
    const sensitive = field.sensitive
    const value = field.value
    void field.key
    untrack(() => {
      draft = sensitive ? '' : value
      current = value
      replacing = false
    })
  })
```

Add the enum save handler after the existing `save` function:

```svelte
  async function saveEnum(next: string): Promise<void> {
    const previous = current
    current = next
    error = null
    saving = true
    try {
      await patchConfig({ key: field.key, value: next, contextId })
      onSaved()
    } catch (err) {
      current = previous
      error = err instanceof Error ? err.message : String(err)
    } finally {
      saving = false
    }
  }
```

Wrap the markup so enum fields render the segmented control and everything else keeps the current behavior. Replace the existing single root `<div class="settings-field" ...>...</div>` with:

```svelte
{#if isEnum}
  <div class="settings-field" data-testid={`cfg-row-${field.key}`}>
    <div class="settings-field__head">
      <span class="t-label settings-field__label">{field.label}</span>
      <SegmentedControl
        options={field.options ?? []}
        value={current}
        ariaLabel={field.label}
        onChange={(v) => void saveEnum(v)}
        testidPrefix={`cfg-seg-${field.key}`} />
    </div>
    {#if error !== null}
      <p class="status-error">{error}</p>
    {/if}
  </div>
{:else}
  <div class="settings-field" data-testid={`cfg-row-${field.key}`}>
    <!-- existing head + editor + error markup, unchanged -->
  </div>
{/if}
```

Keep the entire existing `<div class="settings-field">…</div>` body verbatim inside the `{:else}` branch — do not modify the text/secret editor.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/components/ConfigFieldRow.test.ts`
Expected: PASS (including all pre-existing text/secret tests — the `{:else}` branch is unchanged)

- [ ] **Step 5: Commit**

```bash
git add client/settings/components/ConfigFieldRow.svelte tests/client/settings/components/ConfigFieldRow.test.ts
git commit -m "feat(settings): render enum config controls via SegmentedControl"
```

---

## Task 7: New `AiOutputSection`

**Files:**

- Create: `client/settings/sections/AiOutputSection.svelte`
- Test: `tests/client/settings/sections/AiOutputSection.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/client/settings/sections/AiOutputSection.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import AiOutputSection from '../../../../client/settings/sections/AiOutputSection.svelte'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

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
      key: 'ai_tool_visibility',
      storageKey: 'ai_tool_visibility',
      label: 'Show tool calls',
      required: false,
      sensitive: false,
      kind: 'ai-output',
      control: 'toggle',
      options: [
        { value: 'off', label: 'Off' },
        { value: 'on', label: 'On' },
      ],
      hasValue: false,
      value: '',
    },
    {
      key: 'ai_output_detail_level',
      storageKey: 'ai_output_detail_level',
      label: 'Detail level',
      required: false,
      sensitive: false,
      kind: 'ai-output',
      control: 'select',
      options: [
        { value: 'sanitized', label: 'Sanitized' },
        { value: 'raw', label: 'Raw' },
      ],
      hasValue: false,
      value: '',
    },
  ],
}

afterEach(() => {
  restoreFetch()
})

describe('AiOutputSection', () => {
  test('renders only ai-output fields and defaults an empty value to the first option', async () => {
    setMockFetch(() => Promise.resolve(json(configPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AiOutputSection, {
      target,
      props: { contextId: 'user:1' },
    })
    await drain()

    expect(target.querySelector('#ai-output')).not.toBeNull()
    expect(target.querySelector('[data-testid="cfg-row-ai_tool_visibility"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="cfg-row-ai_output_detail_level"]')).not.toBeNull()
    // preference fields are excluded
    expect(target.querySelector('[data-testid="cfg-row-timezone"]')).toBeNull()

    // empty value defaults to the first option (off / sanitized)
    const offBtn = target.querySelector<HTMLButtonElement>('[data-testid="cfg-seg-ai_tool_visibility-off"]')!
    expect(offBtn.getAttribute('aria-checked')).toBe('true')
    const sanitizedBtn = target.querySelector<HTMLButtonElement>(
      '[data-testid="cfg-seg-ai_output_detail_level-sanitized"]',
    )!
    expect(sanitizedBtn.getAttribute('aria-checked')).toBe('true')
    void unmount(component)
  })

  test('shows an error message when the config fetch fails', async () => {
    setMockFetch(() => Promise.resolve(new Response('Internal Server Error', { status: 500 })))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AiOutputSection, {
      target,
      props: { contextId: 'user:1' },
    })
    await drain()
    expect(target.querySelector('.status-error')).not.toBeNull()
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/AiOutputSection.test.ts`
Expected: FAIL — the section file does not exist (import error).

- [ ] **Step 3: Create the section**

Create `client/settings/sections/AiOutputSection.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import ConfigFieldRow from '../components/ConfigFieldRow.svelte'
  import type { ConfigField } from '../fetcher-schemas.js'
  import { fetchConfig } from '../fetchers.js'
  import EmptyState from '../../shared/ui/EmptyState.svelte'
  import IconButton from '../../shared/ui/IconButton.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  let fields: ConfigField[] = $state([])
  let error: string | null = $state(null)
  let loading = $state(false)

  // Unset keys come back as value: ''. Display the first option (the default) so the
  // control is never rendered in an indeterminate state.
  const visible = $derived(
    fields
      .filter((field) => field.kind === 'ai-output')
      .map((field) => ({
        ...field,
        value: field.value === '' ? (field.options?.[0]?.value ?? '') : field.value,
      })),
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

<section id="ai-output" class="settings-section">
  <PageHeader eyebrow="Personal" title="AI output">
    {#snippet action()}
      <IconButton
        label="Refresh"
        glyph="⟳"
        busy={loading}
        onClick={() => void load(contextId)}
        testid="ai-output-refresh" />
    {/snippet}
  </PageHeader>

  {#if error !== null}
    <p class="status-error">{error}</p>
  {:else if loading}
    <p class="placeholder">Loading…</p>
  {:else if visible.length === 0}
    <EmptyState title="No AI output settings" hint="This context has no editable AI output settings." />
  {:else}
    <div class="settings-field-list">
      {#each visible as field (field.key)}
        <ConfigFieldRow {contextId} {field} onSaved={() => void load(contextId)} />
      {/each}
      <p class="ai-output-hint">Raw detail shows unredacted tool inputs/outputs and reasoning in chat.</p>
    </div>
  {/if}
</section>

<style>
  .settings-field-list {
    display: grid;
    gap: 12px;
  }
  .ai-output-hint {
    color: var(--fg2);
    font-size: 12px;
  }
</style>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/AiOutputSection.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/AiOutputSection.svelte tests/client/settings/sections/AiOutputSection.test.ts
git commit -m "feat(settings): add AI output settings section"
```

---

## Task 8: Register the section in `SettingsApp`

**Files:**

- Modify: `client/settings/SettingsApp.svelte`
- Test: `tests/client/settings/SettingsApp.test.ts`

- [ ] **Step 1: Update the failing test**

In `tests/client/settings/SettingsApp.test.ts`, the test `renders the always-on user sections for a personal context` iterates a list of section ids. Add `'ai-output'`:

```ts
for (const id of ['profile', 'task-provider', 'tools', 'ai-output', 'byok', 'mcp', 'plugins', 'identity']) {
  expect(document.querySelector(`#${id}`)).not.toBeNull()
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/SettingsApp.test.ts`
Expected: FAIL — `#ai-output` is not rendered yet.

- [ ] **Step 3: Implement the registration**

In `client/settings/SettingsApp.svelte`:

Add the import next to the other section imports:

```svelte
  import AiOutputSection from './sections/AiOutputSection.svelte'
```

Add the sidebar item to the Personal group, immediately after the `tools` item:

```svelte
          { id: 'tools', label: 'Tools' },
          { id: 'ai-output', label: 'AI output' },
          { id: 'byok', label: 'BYOK LLM' },
```

Render the section in the first `settings-group`, immediately after `<ToolsSection contextId={ctx} />`:

```svelte
            <ToolsSection contextId={ctx} />
            <AiOutputSection contextId={ctx} />
            <ByokSection contextId={ctx} />
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/SettingsApp.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/settings/SettingsApp.svelte tests/client/settings/SettingsApp.test.ts
git commit -m "feat(settings): register AI output section in settings SPA"
```

---

## Task 9: Update ADR-0144 and run full verification

**Files:**

- Modify: `docs/adr/0144-ai-output-visibility.md`

- [ ] **Step 1: Correct the stale ADR**

In `docs/adr/0144-ai-output-visibility.md`, update the file table row for `src/ai-output-settings.ts` to remove the non-existent `setAiOutputSetting()` reference, and add a short note that the write path is the settings-web-UI AI output section via the generic config route. Example replacement for that row:

```markdown
| `src/ai-output-settings.ts` | Setting keys, value unions, defaults, parsers, `getAiOutputSettings()` (read side) |
```

Add a sentence under the relevant section:

```markdown
The write path is the settings web UI: the **AI output** section
(`client/settings/sections/AiOutputSection.svelte`) reads and writes the three
keys through the generic config route (`/settings/api/config`), which validates
enum values and persists them via `setConfigValue`.
```

- [ ] **Step 2: Run the full server test suite**

Run: `bun test`
Expected: PASS

- [ ] **Step 3: Run the full client test suite**

Run: `bun test:client`
Expected: PASS

- [ ] **Step 4: Typecheck and staged-file checks**

Run: `bun run typecheck`
Expected: no errors

Run: `bun check`
Expected: lint/format/license checks pass on staged files

- [ ] **Step 5: Commit**

```bash
git add docs/adr/0144-ai-output-visibility.md
git commit -m "docs(adr): correct AI-output write-path reference (settings UI)"
```

---

## Manual verification (optional, recommended)

1. Start the bot with the debug server: `bun start:debug` (requires `SETTINGS_PUBLIC_BASE_URL`).
2. DM the bot `/config`, open the single-use link.
3. In the **AI output** section, toggle **Show tool calls** to **On** and set **Detail level** to **Raw**.
4. Send the bot a message that triggers a tool call; confirm an "AI execution details" message appears with raw tool input/output.
5. Toggle back to **Off**; confirm only the main response is sent.
6. Repeat in a managed-group context to confirm the section appears and applies group-wide.

## Spec coverage check

- Three independent controls (two toggles + select) → Tasks 3, 6, 7.
- Personal + group editability → Task 3 (fields in every context) + Task 8 (Personal sidebar group renders for both).
- Approach A typed `ConfigField` pipeline → Tasks 1, 4, 5, 6.
- Enum validation + `422` defense-in-depth → Task 2 (validation) consumed by existing PATCH handler.
- Empty-value → default display → Task 7.
- Error revert on failed save → Task 6.
- `raw` informational helper line → Task 7.
- ADR-0144 staleness fix → Task 9.
- Out of scope (no migration, no orchestrator change, no new endpoint, no preset, no raw gating) → respected; no tasks add them.
  </content>
