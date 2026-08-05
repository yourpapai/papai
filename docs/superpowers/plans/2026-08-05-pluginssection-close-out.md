<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# PluginsSection Close-Out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all 14 open findings in `docs/ux-reviews/PluginsSection.md`, taking the UX backlog to 0 open across 19 sections.

**Architecture:** The plugin card moves out of `PluginsSection.svelte` into a new `client/settings/components/PluginCard.svelte`, so the section's single `error` variable stops multiplexing four unrelated failures and becomes "the load failed" — which is what makes an `ErrorState` + retry, per-card mutation errors, and per-field validation possible. Eligibility copy moves to a pure `client/settings/lib/plugin-eligibility.ts`. The server route gains the `value` field its three siblings already return.

**Tech Stack:** Svelte 5 runes, TypeScript (strict), Zod v4, Bun test runner, Storybook + msw, Playwright via `@crvy/strybk`.

**Spec:** `docs/superpowers/specs/2026-08-05-pluginssection-close-out-design.md`

## Global Constraints

- Branch is `ui-ux-review-02`. **No merge into master, no push.** Commit locally only.
- Never add a lint-disable or type-ignore comment. The Write/Edit hook blocks them; fix the underlying issue.
- Never pass `--no-verify` to `git commit`.
- Formatter is **oxfmt**, invoked as `bun run format`. Not prettier.
- Import paths use the `.js` extension even for TypeScript sources.
- Component tests under `tests/client/**` run **only** with `bun run test:client`. A bare `bun test tests/client/...` reports success without executing anything (`bunfig.toml:8` path-ignores that tree).
- `docs/ux-reviews/_BACKLOG.md` is generated. Regenerate with `bun run ux:backlog`; never hand-edit.
- Finding status vocabulary, exact strings: `open`, `fixed`, `superseded`, `wont-fix`, `deferred`. Any non-`open` status requires a non-empty `- **Resolved:**` line.
- Spacing values come from `client/shared/tokens.css`: `--gap-inline: 12px`, `--gap-tight: 8px`, `--radius: 6px`.
- Never log tokens, API keys, or session cookies.
- **Visual baselines:** `bun shoot` is `playwright test --update-snapshots=all` — it rewrites **every** baseline in the repo. Always scope it: `bun shoot -g PluginsSection`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/debug/settings/plugins-routes.ts` (modify `:27-46`) | GET mapper also returns `value`, masked when sensitive |
| `client/settings/fetcher-schemas.ts` (modify `:151`) | `PluginConfigFieldSchema` stops omitting `value`; add `PluginConfigPatchResultSchema` |
| `client/settings/fetchers.ts` (modify `:190-195`) | `patchPluginConfig` parses a real result so `unchanged` reaches the caller |
| `client/settings/lib/plugin-eligibility.ts` (create) | Pure eligibility → pill + explanation sentence |
| `client/settings/components/PluginCard.svelte` (create) | One plugin: head, toggle, config rows, per-card errors and in-flight state |
| `client/settings/sections/PluginsSection.svelte` (modify) | Fetch + race guard, four page states, section-level clear `Confirm` |
| `client/stories/msw/settings-handlers-plugins.ts` (create) | New plugins fixtures; `settings-plugins-populated` stays untouched |
| `client/stories/msw/scenarios.ts` (modify) | Register the two new scenario keys |
| `client/settings/sections/PluginsSection.stories.svelte` (modify) | Two new stories |
| `docs/ux-reviews/PluginsSection.md` (modify, last task) | All 14 findings → `fixed` |

---

## Task 1: Return the stored config value from the plugins route

**Files:**
- Modify: `src/debug/settings/plugins-routes.ts:27-46`
- Modify: `client/settings/fetcher-schemas.ts:151`
- Modify: `client/settings/fetchers.ts:190-195`
- Test: `tests/debug/settings/plugins-routes.test.ts` (append two tests inside the existing `describe`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: every `contextConfig` entry in `GET /settings/api/plugins` now carries `value: string` — the verbatim stored value for a non-sensitive field, `maskSensitiveValue(raw)` (e.g. `****WvfQ`) for a sensitive one, `''` when unset. `patchPluginConfig(...)` now resolves to `{ ok: true; contextId: string; unchanged?: boolean }`.

This is the only task that touches `src/`, so it is the only one inside the Stryker mutation ratchet's scope. Its tests must kill mutants, not merely execute the new line — that is why both the masked and the verbatim branch get an assertion.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe('settings plugins routes', ...)` block in `tests/debug/settings/plugins-routes.test.ts`, after the `GET returns a plugins array` test:

```typescript
  test('GET returns the verbatim stored value for a non-sensitive context config field', async () => {
    const plugin = makePlugin({
      manifest: {
        ...makePlugin().manifest,
        configRequirements: [{ key: 'base_url', label: 'Base URL', required: false, sensitive: false, scope: 'context' }],
      },
    })
    pluginRegistry.registerDiscovered(plugin)
    const { personalConfigContextId } = resolveSettingsPrincipal('pi-1', 'u-1')
    setPluginConfig(personalConfigContextId, 'test-plugin', 'base_url', 'https://example.test')

    const url = new URL('https://x/settings/api/plugins')
    const res = await handlePluginsRoutes(
      new Request(url, { headers: authHeaders(session) }),
      url,
      '/settings/api/plugins',
    )

    expect(res.status).toBe(200)
    const body = z
      .object({
        plugins: z.array(
          z.object({
            id: z.string(),
            contextConfig: z.array(z.object({ key: z.string(), hasValue: z.boolean(), value: z.string() })),
          }),
        ),
      })
      .parse(await res.json())
    const field = body.plugins.find((p) => p.id === 'test-plugin')?.contextConfig[0]
    expect(field?.hasValue).toBe(true)
    expect(field?.value).toBe('https://example.test')
  })

  test('GET masks the stored value for a sensitive context config field and returns empty when unset', async () => {
    const plugin = makePlugin({
      manifest: {
        ...makePlugin().manifest,
        configRequirements: [
          { key: 'token', label: 'Token', required: true, sensitive: true, scope: 'context' },
          { key: 'note', label: 'Note', required: false, sensitive: false, scope: 'context' },
        ],
      },
    })
    pluginRegistry.registerDiscovered(plugin)
    const { personalConfigContextId } = resolveSettingsPrincipal('pi-1', 'u-1')
    const plaintext = 'secret-plugin-token-xyz'
    setPluginConfig(personalConfigContextId, 'test-plugin', 'token', plaintext)

    const url = new URL('https://x/settings/api/plugins')
    const res = await handlePluginsRoutes(
      new Request(url, { headers: authHeaders(session) }),
      url,
      '/settings/api/plugins',
    )

    const body = z
      .object({
        plugins: z.array(
          z.object({
            id: z.string(),
            contextConfig: z.array(z.object({ key: z.string(), hasValue: z.boolean(), value: z.string() })),
          }),
        ),
      })
      .parse(await res.json())
    const fields = body.plugins.find((p) => p.id === 'test-plugin')?.contextConfig ?? []
    const token = fields.find((f) => f.key === 'token')
    const note = fields.find((f) => f.key === 'note')

    expect(token?.value).toBe(maskSensitiveValue(plaintext))
    expect(token?.value).not.toBe(plaintext)
    expect(note?.hasValue).toBe(false)
    expect(note?.value).toBe('')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/debug/settings/plugins-routes.test.ts`
Expected: FAIL — both new tests error in `.parse(...)` with a Zod issue on `contextConfig.0.value` (`invalid_type`, `expected string, received undefined`). The eight pre-existing tests still pass.

- [ ] **Step 3: Return `value` from the GET mapper**

In `src/debug/settings/plugins-routes.ts`, replace the `.map((r) => ({ ... }))` at `:31-37` with a block body that hoists `raw`:

```typescript
      .map((r) => {
        const raw = getPluginConfig(scope.scope.contextId, id, r.key) ?? ''
        const hasValue = raw.length > 0
        return {
          key: r.key,
          label: r.label,
          required: r.required,
          sensitive: r.sensitive,
          hasValue,
          value: hasValue && r.sensitive ? maskSensitiveValue(raw) : raw,
        }
      })
```

`maskSensitiveValue` is already imported at `:8`. This is character-identical to the expression at `config-routes.ts:49`, `byok-field-response.ts:79` and `coding-credentials-routes.ts:75`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/debug/settings/plugins-routes.test.ts`
Expected: PASS — 10 pass, 0 fail.

- [ ] **Step 5: Accept `value` on the client schema and give the PATCH a real result**

In `client/settings/fetcher-schemas.ts`, replace line `:151`:

```typescript
export const PluginConfigFieldSchema = StoredConfigValueSchema.omit({ value: true })
```

with:

```typescript
export const PluginConfigFieldSchema = StoredConfigValueSchema
```

Do **not** add a `PluginConfigField` type export here. `knip --strict` gates `check:full` and fails on an exported type with no consumer; the first consumer arrives in Task 4, which adds the export itself.

Then, immediately after the `PluginsResponse` type export at `:162`, add:

```typescript
export const PluginConfigPatchResultSchema = z.object({
  ok: z.literal(true),
  contextId: z.string(),
  // The route answers an empty or masked-equal submit on a sensitive field with this
  // flag instead of writing (plugins-routes.ts:137-142). Without it the caller cannot
  // tell a real save from a silent no-op.
  unchanged: z.boolean().optional(),
})
export type PluginConfigPatchResult = z.infer<typeof PluginConfigPatchResultSchema>
```

`StoredConfigValueSchema` declares `control` and `options` as optional, so the plugins payload stays valid without emitting them.

In `client/settings/fetchers.ts`, add `PluginConfigPatchResultSchema` and `type PluginConfigPatchResult` to the existing import block from `./fetcher-schemas.js` (alphabetical: both go directly after `PluginsResponseSchema` / before `ProvisionResultSchema`, and after `type PluginsResponse` / before `type ProvisionResult` respectively), then replace `:190-195`:

```typescript
export const patchPluginConfig = (input: {
  pluginId: string
  key: string
  value: string
  contextId: string
}): Promise<PluginConfigPatchResult> =>
  writeJson('/settings/api/plugins/config', 'PATCH', input, (b) => PluginConfigPatchResultSchema.parse(b))
```

- [ ] **Step 6: Verify types and the existing client suite still pass**

Run: `bun run typecheck`
Expected: PASS, 0 errors.

Run: `bun run test:client`
Expected: PASS. `PluginsSection.test.ts` fixtures already omit `value` from `contextConfig`, so if `PluginsResponseSchema.parse` now rejects them, this is the failure you will see — add `value: ''` to every `contextConfig` entry in that file (there are six, at `:41`, `:80`, `:123`, `:274`, `:300`, `:382`), using `value: ''` wherever `hasValue: false` and `value: 'stored-value'` wherever `hasValue: true`.

- [ ] **Step 7: Format and commit**

```bash
bun run format
git add src/debug/settings/plugins-routes.ts client/settings/fetcher-schemas.ts client/settings/fetchers.ts tests/debug/settings/plugins-routes.test.ts tests/client/settings/sections/PluginsSection.test.ts
git commit -m "fix(settings): return stored plugin config values from the plugins route

The GET mapper computed hasValue but never emitted value, so a non-sensitive
stored plugin setting rendered as an empty box labelled '(set)'. Align with
config-routes, byok-field-response and coding-credentials-routes: verbatim for
non-sensitive, masked for sensitive. patchPluginConfig now parses its result so
the route's 'unchanged' no-op flag reaches the caller."
```

---

## Task 2: Extract eligibility copy into a pure module

**Files:**
- Create: `client/settings/lib/plugin-eligibility.ts`
- Test: `tests/client/settings/lib/plugin-eligibility.test.ts` (create)

**Interfaces:**
- Consumes: `PluginEntry` from `client/settings/fetcher-schemas.js` (unchanged by Task 1 apart from `contextConfig[].value`).
- Produces:
  ```typescript
  type EligibilityTone = 'accent' | 'warn' | 'mute'
  interface EligibilityCopy { tone: EligibilityTone; label: string; explanation?: string }
  function eligibilityCopy(plugin: PluginEntry): EligibilityCopy
  ```
  Task 3 imports `eligibilityCopy` and reads all three members.

`src/plugins/eligibility-message.ts` is deliberately **not** reused: it is chat-facing, backtick-quotes plugin ids, joins raw keys, and has no access to field labels.

- [ ] **Step 1: Write the failing test**

Create `tests/client/settings/lib/plugin-eligibility.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { PluginEntry } from '../../../../client/settings/fetcher-schemas.js'
import { eligibilityCopy } from '../../../../client/settings/lib/plugin-eligibility.js'

const plugin = (over: Partial<PluginEntry>): PluginEntry => ({
  id: 'p',
  name: 'P',
  active: true,
  enabled: false,
  eligibility: { eligible: true },
  contextConfig: [],
  ...over,
})

describe('eligibilityCopy', () => {
  test('an eligible plugin reads Ready with no explanation', () => {
    const copy = eligibilityCopy(plugin({ eligibility: { eligible: true } }))
    expect(copy).toEqual({ tone: 'accent', label: 'Ready' })
  })

  test('a context-disabled plugin reads Off with no explanation — the button already says Enable', () => {
    const copy = eligibilityCopy(plugin({ eligibility: { eligible: false, reason: 'disabled' } }))
    expect(copy).toEqual({ tone: 'mute', label: 'Off' })
  })

  test('an inactive plugin names operator approval as the gate', () => {
    const copy = eligibilityCopy(plugin({ eligibility: { eligible: false, reason: 'inactive' } }))
    expect(copy.tone).toBe('mute')
    expect(copy.label).toBe('Unavailable')
    expect(copy.explanation).toBe('An operator must approve this plugin before it can be enabled here.')
  })

  test('missing config names the fields by their labels, not their keys', () => {
    const copy = eligibilityCopy(
      plugin({
        eligibility: { eligible: false, reason: 'config_missing', missingKeys: ['api_key', 'workspace'] },
        contextConfig: [
          { key: 'api_key', label: 'API key', required: true, sensitive: true, hasValue: false, value: '' },
          { key: 'workspace', label: 'Workspace', required: true, sensitive: false, hasValue: false, value: '' },
        ],
      }),
    )
    expect(copy.tone).toBe('warn')
    expect(copy.label).toBe('Needs setup')
    expect(copy.explanation).toBe('Needs API key and Workspace before it can run.')
  })

  test('a missing key with no matching field falls back to the key itself', () => {
    const copy = eligibilityCopy(
      plugin({ eligibility: { eligible: false, reason: 'config_missing', missingKeys: ['ghost'] }, contextConfig: [] }),
    )
    expect(copy.explanation).toBe('Needs ghost before it can run.')
  })

  test('missing capabilities blame the assigned providers and quote the ids verbatim', () => {
    const copy = eligibilityCopy(
      plugin({
        eligibility: { eligible: false, reason: 'capability_missing', missingCapabilities: ['tasks.search'] },
      }),
    )
    expect(copy.tone).toBe('warn')
    expect(copy.label).toBe('Not supported here')
    expect(copy.explanation).toBe(
      'The task or chat provider assigned to this context does not support tasks.search.',
    )
  })

  test('three missing labels are joined with commas and a trailing "and"', () => {
    const copy = eligibilityCopy(
      plugin({
        eligibility: { eligible: false, reason: 'capability_missing', missingCapabilities: ['a', 'b', 'c'] },
      }),
    )
    expect(copy.explanation).toBe('The task or chat provider assigned to this context does not support a, b and c.')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test:client -t "eligibilityCopy"`
Expected: FAIL — module resolution error, `Cannot find module '.../client/settings/lib/plugin-eligibility.js'`.

- [ ] **Step 3: Write the module**

Create `client/settings/lib/plugin-eligibility.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { PluginEntry } from '../fetcher-schemas.js'

export type EligibilityTone = 'accent' | 'warn' | 'mute'

export interface EligibilityCopy {
  tone: EligibilityTone
  /** Short status shown in the Pill. */
  label: string
  /** Sentence naming the consequence and the next step; absent when the pill says it all. */
  explanation?: string
}

/** "a", "a and b", "a, b and c" — an inline list a sentence can end with. */
function joinPhrases(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/**
 * Missing keys arrive as storage keys. The user chose values against the *labels*,
 * so resolve back through the plugin's own declared fields; fall back to the key
 * when a plugin reports a requirement it does not declare as a context field.
 */
function labelsForKeys(plugin: PluginEntry, keys: readonly string[]): string[] {
  return keys.map((key) => plugin.contextConfig.find((c) => c.key === key)?.label ?? key)
}

export function eligibilityCopy(plugin: PluginEntry): EligibilityCopy {
  if (plugin.eligibility.eligible) return { tone: 'accent', label: 'Ready' }

  switch (plugin.eligibility.reason) {
    case 'disabled':
      // No explanation: the toggle beside this pill already reads "Enable".
      return { tone: 'mute', label: 'Off' }
    case 'inactive':
      return {
        tone: 'mute',
        label: 'Unavailable',
        explanation: 'An operator must approve this plugin before it can be enabled here.',
      }
    case 'config_missing':
      return {
        tone: 'warn',
        label: 'Needs setup',
        explanation: `Needs ${joinPhrases(labelsForKeys(plugin, plugin.eligibility.missingKeys))} before it can run.`,
      }
    case 'capability_missing':
      // registry-context-eligibility.ts merges the required task and chat capability
      // lists into one flat array, so the client cannot tell which provider is at
      // fault — name both rather than guess. Ids stay verbatim: a client-side label
      // map would be a second source of truth with nothing testing it against the
      // real capability set.
      return {
        tone: 'warn',
        label: 'Not supported here',
        explanation: `The task or chat provider assigned to this context does not support ${joinPhrases(plugin.eligibility.missingCapabilities)}.`,
      }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test:client -t "eligibilityCopy"`
Expected: PASS — 7 pass, 0 fail.

- [ ] **Step 5: Format and commit**

```bash
bun run format
git add client/settings/lib/plugin-eligibility.ts tests/client/settings/lib/plugin-eligibility.test.ts
git commit -m "feat(settings): add pure plugin eligibility copy module

Maps each eligibility shape to a pill and a sentence naming the consequence
and the next step, resolving missing config keys to their field labels.
Not yet consumed — PluginCard picks it up next."
```

---

## Task 3: Extract PluginCard with no behaviour change

**Files:**
- Create: `client/settings/components/PluginCard.svelte`
- Modify: `client/settings/sections/PluginsSection.svelte`
- Test: `tests/client/settings/sections/PluginsSection.test.ts` (unchanged — that is the point)

**Interfaces:**
- Consumes: `PluginEntry`, `PluginConfigField` (Task 1); nothing from Task 2 yet.
- Produces:
  ```typescript
  // PluginCard props
  interface Props {
    plugin: PluginEntry
    contextId: string
    /** Awaited by the card so its controls stay busy across the parent's re-fetch. */
    onChanged: () => Promise<void>
    onRequestClear: (key: string, required: boolean) => void
    /** Bubbles a toggle/save failure up while the section still owns the error banner. */
    onError: (message: string) => void
  }
  ```
  Task 4 removes `onError` and replaces it with card-local error state. It exists only in this task so the extraction can be behaviour-preserving.

This is the load-bearing checkpoint: a pure move that changes no markup, no class names, no testids and no pixels. Every later task inherits the confidence it buys. **Expected visual result: no shots move.**

- [ ] **Step 1: Run the visual audit to record the pre-state**

Run: `bun run visual:audit`
Expected: all passed, 0 failed. **Write the exact passed count down** — Step 5 compares against it. If the audit is not already green, stop and report; this task's proof depends on a clean starting point.

- [ ] **Step 2: Create the card with the markup moved verbatim**

Create `client/settings/components/PluginCard.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { PluginEntry } from '../fetcher-schemas.js'
  import { patchPluginConfig, togglePlugin } from '../fetchers.js'
  import Btn from '../../shared/ui/Btn.svelte'
  import Field from '../../shared/ui/Field.svelte'
  import Input from '../../shared/ui/Input.svelte'
  import Pill from '../../shared/ui/Pill.svelte'

  interface Props {
    plugin: PluginEntry
    contextId: string
    onChanged: () => Promise<void>
    onRequestClear: (key: string, required: boolean) => void
    onError: (message: string) => void
  }

  let { plugin, contextId, onChanged, onRequestClear, onError }: Props = $props()

  let drafts: Record<string, string> = $state({})

  const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

  const eligibilityLabel = (p: PluginEntry): string => {
    if (p.eligibility.eligible) return 'eligible'
    if (p.eligibility.reason === 'config_missing') return `config_missing: ${p.eligibility.missingKeys.join(', ')}`
    if (p.eligibility.reason === 'capability_missing') {
      return `capability_missing: ${p.eligibility.missingCapabilities.join(', ')}`
    }
    return p.eligibility.reason
  }

  const eligTone = (p: PluginEntry): 'accent' | 'warn' | 'mute' => {
    if (p.eligibility.eligible) return 'accent'
    if (p.eligibility.reason === 'inactive' || p.eligibility.reason === 'disabled') return 'mute'
    return 'warn'
  }

  async function toggle(): Promise<void> {
    try {
      await togglePlugin({ pluginId: plugin.id, enabled: !plugin.enabled, contextId })
      await onChanged()
    } catch (err) {
      onError(message(err))
    }
  }

  async function saveConfig(key: string): Promise<void> {
    const value = drafts[key] ?? ''
    const cfg = plugin.contextConfig.find((c) => c.key === key)
    if (cfg?.required === true && value.trim() === '') {
      onError(`${cfg.label} is required.`)
      return
    }
    try {
      await patchPluginConfig({ pluginId: plugin.id, key, value, contextId })
      drafts[key] = ''
      await onChanged()
    } catch (err) {
      onError(message(err))
    }
  }
</script>

<div class="settings-plugins__card">
  <div class="settings-plugins__head">
    <span class="settings-plugins__name">{plugin.name}</span>
    <span class="settings-plugins__elig">
      <Pill tone={eligTone(plugin)}>{#snippet children()}{eligibilityLabel(plugin)}{/snippet}</Pill>
    </span>
    <Btn
      variant="secondary"
      size="sm"
      testid={`plugin-toggle-${plugin.id}`}
      disabled={!plugin.eligibility.eligible && plugin.eligibility.reason === 'inactive'}
      onClick={() => void toggle()}>
      {#snippet children()}{plugin.enabled ? 'Disable' : 'Enable'}{/snippet}
    </Btn>
  </div>
  {#if plugin.contextConfig.length > 0}
    <div class="settings-plugins__cfg">
      {#each plugin.contextConfig as cfg (cfg.key)}
        <Field label={`${cfg.label}${cfg.required ? ' *' : ''}${cfg.hasValue ? ' (set)' : ''}`}>
          {#snippet children()}
            <div class="settings-plugins__cfg-row">
              <Input
                type={cfg.sensitive ? 'password' : 'text'}
                value={drafts[cfg.key] ?? ''}
                placeholder={cfg.sensitive ? 'enter a new value' : ''}
                onInput={(v) => (drafts[cfg.key] = v)} />
              <Btn
                variant="primary"
                size="sm"
                testid={`plugin-cfg-save-${plugin.id}-${cfg.key}`}
                onClick={() => void saveConfig(cfg.key)}>
                {#snippet children()}Save{/snippet}
              </Btn>
              {#if cfg.hasValue}
                <Btn
                  variant="ghost"
                  size="sm"
                  testid={`plugin-cfg-clear-${plugin.id}-${cfg.key}`}
                  onClick={() => onRequestClear(cfg.key, cfg.required)}>
                  {#snippet children()}Clear{/snippet}
                </Btn>
              {/if}
            </div>
          {/snippet}
        </Field>
      {/each}
    </div>
  {/if}
</div>

<style>
  .settings-plugins__card {
    border: 1px solid var(--border);
    background: var(--surface-1);
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
  .settings-plugins__cfg {
    display: grid;
    gap: 10px;
  }
  .settings-plugins__cfg-row {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  .settings-plugins__cfg-row :global(.ui-input) {
    flex: 1;
    min-width: 0;
  }
</style>
```

- [ ] **Step 3: Slim the section down to fetch, page states and the dialog**

Replace the whole of `client/settings/sections/PluginsSection.svelte` with:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { PluginEntry } from '../fetcher-schemas.js'
  import { fetchPlugins, unsetPluginConfig } from '../fetchers.js'
  import PluginCard from '../components/PluginCard.svelte'
  import EmptyState from '../../shared/ui/EmptyState.svelte'
  import IconButton from '../../shared/ui/IconButton.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'
  import Confirm from '../../shared/Confirm.svelte'

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  let plugins: PluginEntry[] = $state([])
  let error: string | null = $state(null)
  let loading = $state(false)
  let pendingClearKey: { pluginId: string; key: string; required: boolean } | null = $state(null)
  let clearingKey = $state(false)
  let clearError = $state<string | null>(null)

  const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

  async function load(id: string): Promise<void> {
    error = null
    loading = true
    try {
      const result = await fetchPlugins(id)
      // The context can change while this request is in flight; a stale response
      // must not overwrite the newer context's list.
      if (id !== contextId) return
      plugins = result.plugins
    } catch (err) {
      if (id === contextId) error = message(err)
    } finally {
      if (id === contextId) loading = false
    }
  }

  async function confirmClearKey(): Promise<void> {
    const p = pendingClearKey
    if (p === null || clearingKey) return
    clearError = null
    clearingKey = true
    let ok = false
    try {
      await unsetPluginConfig({ pluginId: p.pluginId, key: p.key, contextId })
      ok = true
    } catch (err) {
      clearError = message(err)
    } finally {
      clearingKey = false
    }
    if (ok) {
      pendingClearKey = null
      await load(contextId)
    }
  }

  $effect(() => {
    void load(contextId)
  })
</script>

<section id="plugins" class="settings-section">
  <PageHeader eyebrow="Integrations" title="Plugins">
    {#snippet action()}
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load(contextId)} testid="plugins-refresh" />
    {/snippet}
  </PageHeader>

  {#if error !== null}<p class="status-error">{error}</p>{/if}

  {#if loading && plugins.length === 0}
    <p class="placeholder">Loading…</p>
  {:else if !loading && error === null && plugins.length === 0}
    <EmptyState title="No plugins discovered" />
  {/if}

  {#if plugins.length > 0}
    <div class="settings-plugins">
      {#each plugins as plugin (plugin.id)}
        <PluginCard
          {plugin}
          {contextId}
          onChanged={() => load(contextId)}
          onRequestClear={(key, required) => {
            pendingClearKey = { pluginId: plugin.id, key, required }
            clearError = null
          }}
          onError={(m) => (error = m)} />
      {/each}
    </div>
  {/if}

  <Confirm
    open={pendingClearKey !== null}
    title="Clear plugin config value"
    danger
    busy={clearingKey}
    confirmLabel="Clear"
    onCancel={() => (pendingClearKey = null)}
    onConfirm={() => void confirmClearKey()}>
    {#snippet body()}
      <p>Clear the stored value for this field?{pendingClearKey?.required ? ' This field is required — clearing it will make the plugin ineligible for this context.' : ' The field will revert to its default.'}</p>
      {#if clearError !== null}<p class="status-error">{clearError}</p>{/if}
    {/snippet}
  </Confirm>
</section>

<style>
  .settings-plugins {
    display: grid;
    gap: 12px;
  }
</style>
```

- [ ] **Step 4: Run the untouched component suite**

Run: `bun run test:client -t "PluginsSection"`
Expected: PASS — 13 pass, 0 fail. **No test file was edited in this task.** If a test fails, the extraction changed behaviour: fix the component, not the test.

- [ ] **Step 5: Prove no pixels moved**

Run: `bun run visual:audit`
Expected: the same passed count you recorded in Step 1, 0 failed. Do **not** run `bun shoot`. A moved shot here means the extraction was not pure; find the markup or style difference and fix it.

- [ ] **Step 6: Typecheck, format and commit**

```bash
bun run typecheck
bun run format
git add client/settings/components/PluginCard.svelte client/settings/sections/PluginsSection.svelte
git commit -m "refactor(settings): extract PluginCard from PluginsSection

Pure move: same markup, class names, testids and styles. The section keeps
fetching, the four page states and the clear dialog; the card owns one plugin.
No behaviour change, no baseline movement — this is the boundary the feedback
and config-row fixes need."
```

---

## Task 4: Per-card feedback, in-flight state and field-level validation

**Files:**
- Modify: `client/settings/components/PluginCard.svelte`
- Modify: `client/settings/sections/PluginsSection.svelte`
- Test: `tests/client/settings/components/PluginCard.test.ts` (create)
- Test: `tests/client/settings/sections/PluginsSection.test.ts` (modify)

**Interfaces:**
- Consumes: `PluginCard` props from Task 3, `PluginConfigPatchResult` from Task 1.
- Also adds, in `client/settings/fetcher-schemas.ts` directly beneath `PluginConfigFieldSchema`, the type this task is the first to consume (Task 1 deliberately left it out — `knip --strict` fails an exported type with no consumer):
  ```typescript
  export type PluginConfigField = z.infer<typeof PluginConfigFieldSchema>
  ```
- Produces: `PluginCard`'s `onError` prop is **removed**; `Props` is now `{ plugin, contextId, onChanged, onRequestClear }`. New testids: `plugin-card-error-<pluginId>`, `plugin-cfg-note-<pluginId>-<key>`. The section renders `ErrorState` (testid `error-retry` on its button, from `ErrorState.svelte:35`) instead of `<p class="status-error">` for load failures.

Closes `plugins-load-error-no-recovery`, `plugins-no-inflight-state`, `plugins-validation-far-from-field`, `plugins-save-no-success-feedback`.

The section's `error` now means exactly one thing — the load failed — so it renders as a page state that replaces the list. A failed background refresh therefore hides a stale list rather than showing it under a red line; the retry sits in the same view.

- [ ] **Step 1: Write the failing card tests**

Create `tests/client/settings/components/PluginCard.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import PluginCard from '../../../../client/settings/components/PluginCard.svelte'
import type { PluginEntry } from '../../../../client/settings/fetcher-schemas.js'
import { setCsrfToken } from '../../../../client/settings/fetchers.js'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const entry = (over: Partial<PluginEntry> = {}): PluginEntry => ({
  id: 'my-plugin',
  name: 'My Plugin',
  active: true,
  enabled: false,
  eligibility: { eligible: true },
  contextConfig: [],
  ...over,
})

const render = (
  props: Record<string, unknown>,
): { component: ReturnType<typeof mount>; target: HTMLElement } => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  return {
    component: mount(PluginCard, {
      target,
      props: { contextId: 'user:1', onChanged: () => Promise.resolve(), onRequestClear: () => {}, ...props },
    }),
    target,
  }
}

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

describe('PluginCard', () => {
  test('the toggle stays busy across the request and the reload that follows', async () => {
    setCsrfToken('c')
    let releaseToggle: (() => void) | undefined
    setMockFetch(
      () =>
        new Promise<Response>((resolve) => {
          releaseToggle = () => resolve(json({ ok: true, contextId: 'user:1' }))
        }),
    )
    let releaseReload: (() => void) | undefined
    const { component, target } = render({
      plugin: entry(),
      onChanged: () => new Promise<void>((resolve) => (releaseReload = resolve)),
    })
    flushSync()

    const btn = target.querySelector<HTMLButtonElement>('[data-testid="plugin-toggle-my-plugin"]')!
    btn.click()
    await drain()
    expect(btn.getAttribute('aria-busy')).toBe('true')

    releaseToggle!()
    await drain()
    // The request resolved but the parent is still re-fetching — a second click here
    // would send a contradictory toggle against stale data.
    expect(btn.getAttribute('aria-busy')).toBe('true')

    releaseReload!()
    await drain()
    expect(btn.getAttribute('aria-busy')).toBe('false')
    void unmount(component)
  })

  test('a failed toggle shows the error on the card, not on the section', async () => {
    setCsrfToken('c')
    setMockFetch(() => Promise.resolve(new Response('Server Error', { status: 500 })))
    const { component, target } = render({ plugin: entry() })
    flushSync()

    target.querySelector<HTMLButtonElement>('[data-testid="plugin-toggle-my-plugin"]')!.click()
    await drain()

    expect(target.querySelector('[data-testid="plugin-card-error-my-plugin"]')).not.toBeNull()
    void unmount(component)
  })

  test('saving an empty required field shows the error on that field and does not PATCH', async () => {
    setCsrfToken('c')
    let patched = false
    setMockFetch((url, init) => {
      if (url.includes('/plugins/config') && init.method === 'PATCH') patched = true
      return Promise.resolve(json({ ok: true, contextId: 'user:1' }))
    })
    const { component, target } = render({
      plugin: entry({
        contextConfig: [{ key: 'token', label: 'Token', required: true, sensitive: false, hasValue: false, value: '' }],
      }),
    })
    flushSync()

    target.querySelector<HTMLButtonElement>('[data-testid="plugin-cfg-save-my-plugin-token"]')!.click()
    await drain()

    const row = target.querySelector('[data-testid="plugin-cfg-row-my-plugin-token"]')!
    const alert = row.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
    expect(alert!.textContent).toContain('required')
    expect(patched).toBe(false)
    void unmount(component)
  })

  test('a successful save acknowledges with a Saved marker', async () => {
    setCsrfToken('c')
    setMockFetch(() => Promise.resolve(json({ ok: true, contextId: 'user:1' })))
    const { component, target } = render({
      plugin: entry({
        contextConfig: [{ key: 'note', label: 'Note', required: false, sensitive: false, hasValue: false, value: '' }],
      }),
    })
    flushSync()

    const input = target.querySelector<HTMLInputElement>('[data-testid="plugin-cfg-input-my-plugin-note"]')!
    input.value = 'hello'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="plugin-cfg-save-my-plugin-note"]')!.click()
    await drain()

    const note = target.querySelector('[data-testid="plugin-cfg-note-my-plugin-note"]')
    expect(note).not.toBeNull()
    expect(note!.textContent).toContain('Saved')
    void unmount(component)
  })

  test('an unchanged response says so instead of claiming a save', async () => {
    setCsrfToken('c')
    setMockFetch(() => Promise.resolve(json({ ok: true, contextId: 'user:1', unchanged: true })))
    const { component, target } = render({
      plugin: entry({
        contextConfig: [{ key: 'note', label: 'Note', required: false, sensitive: false, hasValue: false, value: '' }],
      }),
    })
    flushSync()

    const input = target.querySelector<HTMLInputElement>('[data-testid="plugin-cfg-input-my-plugin-note"]')!
    input.value = 'hello'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="plugin-cfg-save-my-plugin-note"]')!.click()
    await drain()

    const note = target.querySelector('[data-testid="plugin-cfg-note-my-plugin-note"]')!
    expect(note.textContent).toContain('No change')
    void unmount(component)
  })
})
```

- [ ] **Step 2: Write the failing section test**

In `tests/client/settings/sections/PluginsSection.test.ts`, **delete** the test `saving an empty required plugin config shows an error and does not POST` at `:201-220` (its behaviour now lives in the PluginCard suite above) along with the now-unused `configPatchRequests`, `isConfigPatch`, `configPayload` and `trackConfigMock` declarations at `:111-130` and the `configPatchRequests.length = 0` line in `afterEach`. Then append inside the `describe`:

```typescript
  test('a load failure renders ErrorState with a working retry', async () => {
    let calls = 0
    setMockFetch(() => {
      calls += 1
      return calls === 1
        ? Promise.resolve(new Response('Server Error', { status: 500 }))
        : Promise.resolve(json(pluginsPayload))
    })
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(PluginsSection, { target, props: { contextId: 'user:1' } })
    await drain()

    expect(target.querySelector('.ui-error')).not.toBeNull()

    target.querySelector<HTMLButtonElement>('[data-testid="error-retry"]')!.click()
    await drain()

    expect(target.querySelector('.ui-error')).toBeNull()
    expect(target.textContent).toContain('Hello World')
    void unmount(component)
  })
```

- [ ] **Step 3: Run both suites to verify they fail**

Run: `bun run test:client -t "PluginCard"`
Expected: FAIL — `Cannot find module .../PluginCard.test.ts` resolves, but every test fails: `aria-busy` is `"false"` (no busy tracking), and the `plugin-card-error-*`, `plugin-cfg-row-*`, `plugin-cfg-input-*`, `plugin-cfg-note-*` queries all return `null`.

Run: `bun run test:client -t "PluginsSection"`
Expected: FAIL — the new retry test fails on `expect(target.querySelector('.ui-error')).not.toBeNull()`; the section still renders `<p class="status-error">`.

- [ ] **Step 4: Rewrite the card's script for per-field state**

In `client/settings/components/PluginCard.svelte`, replace the whole `<script>` block with:

```svelte
<script lang="ts">
  import { untrack } from 'svelte'

  import type { PluginConfigField, PluginEntry } from '../fetcher-schemas.js'
  import { patchPluginConfig, togglePlugin } from '../fetchers.js'
  import Btn from '../../shared/ui/Btn.svelte'
  import Field from '../../shared/ui/Field.svelte'
  import Input from '../../shared/ui/Input.svelte'
  import Pill from '../../shared/ui/Pill.svelte'

  interface Props {
    plugin: PluginEntry
    contextId: string
    /** Awaited, so the card's controls stay busy across the parent's re-fetch. */
    onChanged: () => Promise<void>
    onRequestClear: (key: string, required: boolean) => void
  }

  let { plugin, contextId, onChanged, onRequestClear }: Props = $props()

  // How long a save acknowledgement stays on screen. Long enough to notice, short
  // enough that it never reads as persistent state. Mirrors ConfigFieldRow.
  const NOTE_VISIBLE_MS = 2000
  const SAVED_NOTE = '✓ Saved'
  const UNCHANGED_NOTE = 'No change — the stored value was the same'

  let drafts: Record<string, string> = $state({})
  let fieldErrors: Record<string, string> = $state({})
  let savingKeys: Record<string, boolean> = $state({})
  let notes: Record<string, string> = $state({})
  let toggling = $state(false)
  let cardError: string | null = $state(null)

  const noteTimers = new Map<string, ReturnType<typeof setTimeout>>()

  const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

  // The card writes in place with no submit-and-navigate step, so without an explicit
  // acknowledgement a completed save is indistinguishable from a control never touched.
  function markNote(key: string, text: string): void {
    notes[key] = text
    const existing = noteTimers.get(key)
    if (existing !== undefined) clearTimeout(existing)
    noteTimers.set(
      key,
      setTimeout(() => {
        delete notes[key]
        noteTimers.delete(key)
      }, NOTE_VISIBLE_MS),
    )
  }

  $effect(() => () => {
    for (const timer of noteTimers.values()) clearTimeout(timer)
    noteTimers.clear()
  })

  // Re-sync edit state when the parent re-fetches: a sensitive field's editor baseline
  // is '' (the masked stored value is never a draft), everything else shows what is stored.
  $effect(() => {
    const fields = plugin.contextConfig
    untrack(() => {
      const next: Record<string, string> = {}
      for (const f of fields) next[f.key] = f.sensitive ? '' : f.value
      drafts = next
      fieldErrors = {}
    })
  })

  async function toggle(): Promise<void> {
    if (toggling) return
    cardError = null
    toggling = true
    try {
      await togglePlugin({ pluginId: plugin.id, enabled: !plugin.enabled, contextId })
      await onChanged()
    } catch (err) {
      cardError = message(err)
    } finally {
      toggling = false
    }
  }

  async function saveConfig(cfg: PluginConfigField): Promise<void> {
    if (savingKeys[cfg.key] === true) return
    const value = drafts[cfg.key] ?? ''
    delete fieldErrors[cfg.key]
    if (cfg.required && value.trim() === '') {
      fieldErrors[cfg.key] = `${cfg.label} is required.`
      return
    }
    cardError = null
    savingKeys[cfg.key] = true
    try {
      const result = await patchPluginConfig({ pluginId: plugin.id, key: cfg.key, value, contextId })
      markNote(cfg.key, result.unchanged === true ? UNCHANGED_NOTE : SAVED_NOTE)
      await onChanged()
    } catch (err) {
      fieldErrors[cfg.key] = message(err)
    } finally {
      savingKeys[cfg.key] = false
    }
  }
</script>
```

- [ ] **Step 5: Wire the new state into the card's markup**

Still in `PluginCard.svelte`, replace the markup between `</script>` and `<style>` with:

```svelte
<div class="settings-plugins__card">
  <div class="settings-plugins__head">
    <span class="settings-plugins__name">{plugin.name}</span>
    <span class="settings-plugins__elig">
      <Pill tone={eligTone(plugin)}>{#snippet children()}{eligibilityLabel(plugin)}{/snippet}</Pill>
    </span>
    <Btn
      variant="secondary"
      size="sm"
      testid={`plugin-toggle-${plugin.id}`}
      busy={toggling}
      disabled={!plugin.eligibility.eligible && plugin.eligibility.reason === 'inactive'}
      onClick={() => void toggle()}>
      {#snippet children()}{plugin.enabled ? 'Disable' : 'Enable'}{/snippet}
    </Btn>
  </div>
  {#if cardError !== null}
    <p class="status-error" role="alert" data-testid={`plugin-card-error-${plugin.id}`}>{cardError}</p>
  {/if}
  {#if plugin.contextConfig.length > 0}
    <div class="settings-plugins__cfg">
      {#each plugin.contextConfig as cfg (cfg.key)}
        <div class="settings-plugins__cfg-field" data-testid={`plugin-cfg-row-${plugin.id}-${cfg.key}`}>
          <Field
            label={`${cfg.label}${cfg.required ? ' *' : ''}${cfg.hasValue ? ' (set)' : ''}`}
            error={fieldErrors[cfg.key]}>
            {#snippet children()}
              <div class="settings-plugins__cfg-row">
                <Input
                  type={cfg.sensitive ? 'password' : 'text'}
                  value={drafts[cfg.key] ?? ''}
                  placeholder={cfg.sensitive ? 'enter a new value' : ''}
                  testid={`plugin-cfg-input-${plugin.id}-${cfg.key}`}
                  onInput={(v) => (drafts[cfg.key] = v)} />
                <Btn
                  variant="primary"
                  size="sm"
                  testid={`plugin-cfg-save-${plugin.id}-${cfg.key}`}
                  busy={savingKeys[cfg.key] === true}
                  onClick={() => void saveConfig(cfg)}>
                  {#snippet children()}{savingKeys[cfg.key] === true ? 'Saving…' : 'Save'}{/snippet}
                </Btn>
                {#if cfg.hasValue}
                  <Btn
                    variant="ghost"
                    size="sm"
                    testid={`plugin-cfg-clear-${plugin.id}-${cfg.key}`}
                    onClick={() => onRequestClear(cfg.key, cfg.required)}>
                    {#snippet children()}Clear{/snippet}
                  </Btn>
                {/if}
                {#if notes[cfg.key] !== undefined}
                  <span class="settings-plugins__note" role="status" data-testid={`plugin-cfg-note-${plugin.id}-${cfg.key}`}>{notes[cfg.key]}</span>
                {/if}
              </div>
            {/snippet}
          </Field>
        </div>
      {/each}
    </div>
  {/if}
</div>
```

`Field.svelte:20` already accepts `error` and renders it with `role="alert"` and `aria-invalid` wiring, so no change to the shared primitive is needed — the wrapping `div` only supplies the row testid the test queries.

Add to the card's `<style>` block:

```css
  .settings-plugins__note {
    color: var(--success);
    font-size: 11px;
    white-space: nowrap;
  }
```

- [ ] **Step 6: Give the section an ErrorState and drop `onError`**

In `client/settings/sections/PluginsSection.svelte`:

Add the import beside the other shared-ui imports:

```typescript
  import ErrorState from '../../shared/ui/ErrorState.svelte'
```

Replace the whole block from `{#if error !== null}<p class="status-error">{error}</p>{/if}` down to the closing `{/if}` of the `{#if plugins.length > 0}` block with:

```svelte
  {#if error !== null}
    <ErrorState
      message="Could not load plugins for this context."
      detail={error}
      onRetry={() => void load(contextId)} />
  {:else if loading && plugins.length === 0}
    <p class="placeholder">Loading…</p>
  {:else if plugins.length === 0}
    <EmptyState title="No plugins discovered" />
  {:else}
    <div class="settings-plugins">
      {#each plugins as plugin (plugin.id)}
        <PluginCard
          {plugin}
          {contextId}
          onChanged={() => load(contextId)}
          onRequestClear={(key, required) => {
            pendingClearKey = { pluginId: plugin.id, key, required }
            clearError = null
          }} />
      {/each}
    </div>
  {/if}
```

The raw exception text is demoted into `ErrorState`'s collapsed `detail` disclosure rather than shown as the headline.

- [ ] **Step 7: Run both suites to verify they pass**

Run: `bun run test:client -t "PluginCard"`
Expected: PASS — 5 pass, 0 fail.

Run: `bun run test:client -t "PluginsSection"`
Expected: PASS — 13 pass, 0 fail.

- [ ] **Step 8: Re-shoot the moved baselines**

Run: `bun run visual:audit`
Expected: FAIL on `Error` and `Plugins — error, narrow` — the bare red word became an `ErrorState` block. Record the failing list; anything else in it is unexpected and must be explained before proceeding.

Run: `bun shoot -g PluginsSection`

Read every changed PNG under `.storybook-shots/settings/sections/PluginsSection.spec.ts/` with the Read tool. Confirm the error frames now show the icon, "Something went wrong", the message, a collapsed "Technical details" disclosure and a "Try again" button — and that the populated/empty/loading/hover frames are visually unchanged.

Run: `bun run visual:audit`
Expected: PASS, 0 failed.

- [ ] **Step 9: Typecheck, format and commit**

```bash
bun run typecheck
bun run format
git add client/settings/components/PluginCard.svelte client/settings/sections/PluginsSection.svelte tests/client/settings/components/PluginCard.test.ts tests/client/settings/sections/PluginsSection.test.ts .storybook-shots
git commit -m "feat(settings): give plugins real feedback, in-flight and validation state

Load failures render through ErrorState with a retry and a demoted technical
detail. Toggle and Save stay busy across the request and the reload that
follows, so a second click cannot fire a contradictory request. Validation and
mutation errors surface on the owning field or card instead of one shared
banner at the top of the section. A save is acknowledged, and the route's
silent 'unchanged' no-op now says so."
```

Note: `.storybook-shots/` is gitignored (`.gitignore:56`), so the `git add` above will simply match nothing for that path. That is expected — baselines are not committed.

---

## Task 5: Config rows through SettingsFieldShell, with fixtures that show them

**Files:**
- Modify: `client/settings/components/PluginCard.svelte`
- Create: `client/stories/msw/settings-handlers-plugins.ts`
- Modify: `client/stories/msw/scenarios.ts`
- Modify: `client/settings/sections/PluginsSection.stories.svelte`
- Test: `tests/client/settings/components/PluginCard.test.ts`

**Interfaces:**
- Consumes: `PluginConfigField.value` (Task 1), the card state from Task 4.
- Produces: new testids `plugin-cfg-replace-<pluginId>-<key>`, `plugin-cfg-cancel-<pluginId>-<key>`. New scenario keys `settings-plugins-configurable` and `settings-plugins-ineligible`. New story ids `settings-sections-pluginssection--configurable` and `settings-sections-pluginssection--ineligible`.

Closes `plugins-config-field-not-shell`, `plugins-required-not-passed-to-field`, `plugins-fixture-coverage-gap`.

`settings-plugins-populated` must stay **byte-identical**: `AdminPluginsApprovalSection.svelte:8` fetches the same endpoint and `scenarios.ts:191` reuses `pluginsHandlers.populated`, so editing it would move a second, unreviewed section's baselines.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('PluginCard', ...)` in `tests/client/settings/components/PluginCard.test.ts`:

```typescript
  test('a sensitive field with a stored value rests masked behind Replace', async () => {
    setMockFetch(() => Promise.resolve(json({ ok: true, contextId: 'user:1' })))
    const { component, target } = render({
      plugin: entry({
        contextConfig: [
          { key: 'api_key', label: 'API key', required: true, sensitive: true, hasValue: true, value: '****WvfQ' },
        ],
      }),
    })
    flushSync()

    expect(target.querySelector('.ui-secret')).not.toBeNull()
    expect(target.querySelector('.ui-secret__value')!.textContent).toBe('••••WvfQ')
    expect(target.querySelector('[data-testid="plugin-cfg-input-my-plugin-api_key"]')).toBeNull()

    target.querySelector<HTMLButtonElement>('[data-testid="plugin-cfg-replace-my-plugin-api_key"]')!.click()
    flushSync()
    expect(target.querySelector('[data-testid="plugin-cfg-input-my-plugin-api_key"]')).not.toBeNull()
    void unmount(component)
  })

  test('a non-sensitive stored value is readable in the editor, not hidden behind "(set)"', () => {
    setMockFetch(() => Promise.resolve(json({ ok: true, contextId: 'user:1' })))
    const { component, target } = render({
      plugin: entry({
        contextConfig: [
          { key: 'base_url', label: 'Base URL', required: false, sensitive: false, hasValue: true, value: 'https://example.test' },
        ],
      }),
    })
    flushSync()

    const input = target.querySelector<HTMLInputElement>('[data-testid="plugin-cfg-input-my-plugin-base_url"]')!
    expect(input.value).toBe('https://example.test')
    expect(target.textContent).not.toContain('(set)')
    void unmount(component)
  })

  test('a required field marks its control aria-required instead of appending an asterisk to the label', () => {
    setMockFetch(() => Promise.resolve(json({ ok: true, contextId: 'user:1' })))
    const { component, target } = render({
      plugin: entry({
        contextConfig: [{ key: 'token', label: 'Token', required: true, sensitive: false, hasValue: false, value: '' }],
      }),
    })
    flushSync()

    const input = target.querySelector<HTMLInputElement>('[data-testid="plugin-cfg-input-my-plugin-token"]')!
    expect(input.getAttribute('aria-required')).toBe('true')
    expect(target.querySelector('.settings-field__label')!.textContent).toBe('Token*')
    expect(target.querySelector('.settings-field__req')!.getAttribute('aria-hidden')).toBe('true')
    void unmount(component)
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun run test:client -t "PluginCard"`
Expected: FAIL on the three new tests — `.ui-secret` is null (the card still renders a password `Input`), the non-sensitive input's `value` is `''`, and `aria-required` is absent because the label carries a literal `' *'`.

- [ ] **Step 3: Swap Field for SettingsFieldShell**

In `client/settings/components/PluginCard.svelte`, replace the `Field` and `Input` imports:

```typescript
  import { maskSecret } from '../lib/mask-secret.js'
  import Btn from '../../shared/ui/Btn.svelte'
  import Input from '../../shared/ui/Input.svelte'
  import Pill from '../../shared/ui/Pill.svelte'
  import Secret from '../../shared/ui/Secret.svelte'
  import SettingsFieldShell from './SettingsFieldShell.svelte'
```

(`Field` is no longer used — remove its import.)

Add replace-state next to the other per-key records in the script:

```typescript
  let replacing: Record<string, boolean> = $state({})

  // An unset secret has nothing to mask, so open the editor directly — otherwise
  // there is no Replace button and no way to enter a first value.
  const editorOpen = (cfg: PluginConfigField): boolean =>
    !cfg.sensitive || replacing[cfg.key] === true || !cfg.hasValue
```

and reset it inside the existing re-sync `$effect`, alongside `fieldErrors = {}`:

```typescript
      replacing = {}
```

Replace the `{#each plugin.contextConfig ...}` body with:

```svelte
      {#each plugin.contextConfig as cfg (cfg.key)}
        <SettingsFieldShell
          label={cfg.label}
          required={cfg.required}
          editorOpen={editorOpen(cfg)}
          error={fieldErrors[cfg.key]}
          testid={`plugin-cfg-row-${plugin.id}-${cfg.key}`}>
          {#snippet head()}
            {#if cfg.sensitive && cfg.hasValue && replacing[cfg.key] !== true}
              <Secret value={maskSecret(cfg.value)} />
              <Btn
                variant="secondary"
                size="sm"
                testid={`plugin-cfg-replace-${plugin.id}-${cfg.key}`}
                onClick={() => (replacing[cfg.key] = true)}>
                {#snippet children()}Replace{/snippet}
              </Btn>
            {/if}
            {#if cfg.hasValue}
              <Btn
                variant="ghost"
                size="sm"
                testid={`plugin-cfg-clear-${plugin.id}-${cfg.key}`}
                onClick={() => onRequestClear(cfg.key, cfg.required)}>
                {#snippet children()}Clear{/snippet}
              </Btn>
            {/if}
            {#if notes[cfg.key] !== undefined}
              <span class="settings-plugins__note" role="status" data-testid={`plugin-cfg-note-${plugin.id}-${cfg.key}`}>{notes[cfg.key]}</span>
            {/if}
          {/snippet}
          {#snippet editor()}
            <Input
              type={cfg.sensitive ? 'password' : 'text'}
              value={drafts[cfg.key] ?? ''}
              placeholder={cfg.sensitive ? 'enter a new value' : ''}
              testid={`plugin-cfg-input-${plugin.id}-${cfg.key}`}
              onInput={(v) => (drafts[cfg.key] = v)} />
            <Btn
              variant="primary"
              size="sm"
              testid={`plugin-cfg-save-${plugin.id}-${cfg.key}`}
              busy={savingKeys[cfg.key] === true}
              onClick={() => void saveConfig(cfg)}>
              {#snippet children()}{savingKeys[cfg.key] === true ? 'Saving…' : 'Save'}{/snippet}
            </Btn>
            {#if cfg.sensitive && cfg.hasValue}
              <Btn
                variant="ghost"
                size="sm"
                testid={`plugin-cfg-cancel-${plugin.id}-${cfg.key}`}
                onClick={() => { replacing[cfg.key] = false; drafts[cfg.key] = '' }}>
                {#snippet children()}Cancel{/snippet}
              </Btn>
            {/if}
          {/snippet}
        </SettingsFieldShell>
      {/each}
```

The wrapping `<div class="settings-plugins__cfg-field">` and the `.settings-plugins__cfg-row` div both disappear — `SettingsFieldShell` provides `data-testid`, the head/editor rows and their spacing. Delete `.settings-plugins__cfg-row` and its `:global(.ui-input)` rule from the card's `<style>`; `SettingsFieldShell.svelte:108-111` already sizes the input.

- [ ] **Step 4: Run to verify they pass**

Run: `bun run test:client -t "PluginCard"`
Expected: PASS — 8 pass, 0 fail.

- [ ] **Step 5: Add the new fixtures**

Create `client/stories/msw/settings-handlers-plugins.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// Plugins fixtures beyond the four state families in settings-handlers-personal.ts.
// The `settings-plugins-populated` scenario there is shared with
// AdminPluginsApprovalSection, so representative config/ineligible states live here
// as their own scenarios rather than enriching it in place.

import { HttpResponse, http } from 'msw'
import type { HttpHandler } from 'msw'

const CONTEXT_ID = 'ctx-personal-1'

// `value` for a sensitive field arrives already masked by the server
// (src/config.ts maskSensitiveValue → `****xxxx`); the client normalizes the
// asterisks to bullets via maskSecret().
const pluginsConfigurable = {
  contextId: CONTEXT_ID,
  plugins: [
    {
      id: 'task-provider-kaneo',
      name: 'Kaneo',
      active: true,
      enabled: true,
      eligibility: { eligible: true },
      contextConfig: [
        { key: 'api_key', label: 'API key', required: true, sensitive: true, hasValue: true, value: '****WvfQ' },
        {
          key: 'base_url',
          label: 'Base URL',
          required: false,
          sensitive: false,
          hasValue: true,
          value: 'https://kaneo.example.test',
        },
      ],
    },
    {
      id: 'web-search',
      name: 'Web Search',
      active: true,
      enabled: false,
      eligibility: { eligible: false, reason: 'config_missing', missingKeys: ['api_key'] },
      contextConfig: [
        { key: 'api_key', label: 'API key', required: true, sensitive: true, hasValue: false, value: '' },
      ],
    },
  ],
}

const pluginsIneligible = {
  contextId: CONTEXT_ID,
  plugins: [
    {
      id: 'pending-approval',
      name: 'Pending Approval',
      active: false,
      enabled: false,
      eligibility: { eligible: false, reason: 'inactive' },
      contextConfig: [],
    },
    {
      id: 'turned-off',
      name: 'Turned Off',
      active: true,
      enabled: false,
      eligibility: { eligible: false, reason: 'disabled' },
      contextConfig: [],
    },
    {
      id: 'needs-capability',
      name: 'Needs Capability',
      active: true,
      enabled: false,
      eligibility: { eligible: false, reason: 'capability_missing', missingCapabilities: ['tasks.search'] },
      contextConfig: [],
    },
  ],
}

export const pluginsConfigurableHandlers: HttpHandler[] = [
  http.get('/settings/api/plugins', () => HttpResponse.json(pluginsConfigurable)),
]

export const pluginsIneligibleHandlers: HttpHandler[] = [
  http.get('/settings/api/plugins', () => HttpResponse.json(pluginsIneligible)),
]
```

In `client/stories/msw/scenarios.ts`, add the import beside the other `settings-handlers-*` imports:

```typescript
import { pluginsConfigurableHandlers, pluginsIneligibleHandlers } from './settings-handlers-plugins.js'
```

and register the keys directly after `'settings-plugins-loading'` at `:250`:

```typescript
  'settings-plugins-configurable': [...pluginsConfigurableHandlers],
  'settings-plugins-ineligible': [...pluginsIneligibleHandlers],
```

Leave `'settings-plugins-populated'` and `pluginsHandlers` in `settings-handlers-personal.ts` untouched.

- [ ] **Step 6: Add the stories**

Append to `client/settings/sections/PluginsSection.stories.svelte`:

```svelte
<Story
  name="Configurable"
  args={{ contextId: CONTEXT_ID }}
  parameters={{ fixtures: 'settings-plugins-configurable' }} />

<Story name="Ineligible" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-plugins-ineligible' }} />
```

- [ ] **Step 7: Shoot the new and changed frames**

Run: `bun run visual:audit`
Expected: FAIL on `Populated`, `Plugins — populated, narrow` and `Plugins — toggle hovered` — the `settings-plugins-populated` plugin has an empty `contextConfig`, so those frames should be **unchanged**; if they fail, the card's head or spacing moved, which is not this task's business. Investigate before continuing.

Run: `bun run shoot:gen`
This regenerates the `@generated-begin auto-screenshots` block in `tests/visual/settings/sections/PluginsSection.spec.ts` with `Configurable` and `Ineligible`. The five manual tests below `@generated-end` must survive untouched — check the diff.

Run: `bun shoot -g PluginsSection`

Read every PNG under `.storybook-shots/settings/sections/PluginsSection.spec.ts/` with the Read tool. Confirm: `Configurable` shows one masked `••••WvfQ` secret with Replace + Clear, one readable Base URL, and one empty required API key; `Ineligible` shows three cards; no `(set)` or ` *` appears in any label.

Run: `bun run visual:audit`
Expected: PASS, 0 failed.

- [ ] **Step 8: Typecheck, format and commit**

```bash
bun run typecheck
bun run format
git add client/settings/components/PluginCard.svelte client/stories/msw/settings-handlers-plugins.ts client/stories/msw/scenarios.ts client/settings/sections/PluginsSection.stories.svelte tests/visual/settings/sections/PluginsSection.spec.ts tests/client/settings/components/PluginCard.test.ts
git commit -m "feat(settings): render plugin config through SettingsFieldShell

Sensitive fields rest masked behind Replace instead of showing a permanently
empty password box labelled '(set)'; non-sensitive stored values are readable
for the first time. required now reaches the control as aria-required rather
than a literal asterisk in the label text. Adds Configurable and Ineligible
fixtures so more than half this section is visually reviewable; the shared
settings-plugins-populated scenario is untouched."
```

---

## Task 6: List structure, headings and the accessible on/off state

**Files:**
- Modify: `client/settings/components/PluginCard.svelte`
- Modify: `client/settings/sections/PluginsSection.svelte`
- Test: `tests/client/settings/components/PluginCard.test.ts`
- Test: `tests/client/settings/sections/PluginsSection.test.ts`

**Interfaces:**
- Consumes: `eligibilityCopy` from Task 2 — first use.
- Produces: the pill carries `id="plugin-elig-<pluginId>"`; when an explanation exists it renders as `#plugin-explain-<pluginId>` and both ids appear in the toggle's `aria-describedby`.

Closes `plugins-raw-eligibility-strings`, `plugins-cards-not-a-list`, `plugins-toggle-no-aria-pressed`, `plugins-disabled-toggle-unexplained`.

**`plugins-toggle-no-aria-pressed` is closed by a different mechanism than it asks for.** Its literal fix — `ariaPressed={plugin.enabled}` — is rejected on the precedent SP5 set for `guest-mode-toggle-not-exposed-a11y`: the label already swaps between "Enable" and "Disable", so `aria-pressed` would announce *"Disable, pressed"* — the label naming the action and the state naming its opposite. The intent (on/off exposed to assistive tech) is met by pointing the toggle at the status pill instead, giving "Disable, button, Ready".

- [ ] **Step 1: Write the failing tests**

Append to `describe('PluginCard', ...)`:

```typescript
  test('eligibility reads as human copy, never as a schema enum', () => {
    setMockFetch(() => Promise.resolve(json({ ok: true, contextId: 'user:1' })))
    const { component, target } = render({
      plugin: entry({
        eligibility: { eligible: false, reason: 'config_missing', missingKeys: ['api_key'] },
        contextConfig: [
          { key: 'api_key', label: 'API key', required: true, sensitive: true, hasValue: false, value: '' },
        ],
      }),
    })
    flushSync()

    expect(target.querySelector('.ui-pill')!.textContent!.trim()).toBe('Needs setup')
    expect(target.textContent).toContain('Needs API key before it can run.')
    expect(target.textContent).not.toContain('config_missing')
    void unmount(component)
  })

  test('the toggle is described by the status pill', () => {
    setMockFetch(() => Promise.resolve(json({ ok: true, contextId: 'user:1' })))
    const { component, target } = render({ plugin: entry({ enabled: true }) })
    flushSync()

    const btn = target.querySelector<HTMLButtonElement>('[data-testid="plugin-toggle-my-plugin"]')!
    expect(btn.textContent!.trim()).toBe('Disable')
    const described = btn.getAttribute('aria-describedby')!.split(' ')
    expect(described).toContain('plugin-elig-my-plugin')
    for (const id of described) expect(target.querySelector(`#${id}`)).not.toBeNull()
    // Rejected in favour of the pill: the label already swaps Enable/Disable, so
    // aria-pressed would announce the opposite of what the label says.
    expect(btn.hasAttribute('aria-pressed')).toBe(false)
    void unmount(component)
  })

  test('a disabled toggle points at the explanation of why it cannot be used', () => {
    setMockFetch(() => Promise.resolve(json({ ok: true, contextId: 'user:1' })))
    const { component, target } = render({
      plugin: entry({ active: false, eligibility: { eligible: false, reason: 'inactive' } }),
    })
    flushSync()

    const btn = target.querySelector<HTMLButtonElement>('[data-testid="plugin-toggle-my-plugin"]')!
    expect(btn.disabled).toBe(true)
    expect(btn.getAttribute('aria-describedby')).toContain('plugin-explain-my-plugin')
    expect(target.querySelector('#plugin-explain-my-plugin')!.textContent).toContain('operator must approve')
    void unmount(component)
  })

  test('the plugin name is a heading', () => {
    setMockFetch(() => Promise.resolve(json({ ok: true, contextId: 'user:1' })))
    const { component, target } = render({ plugin: entry() })
    flushSync()
    expect(target.querySelector('h3')!.textContent).toBe('My Plugin')
    void unmount(component)
  })
```

Append to `describe('PluginsSection', ...)` in the section suite:

```typescript
  test('plugin cards are list items so they can be counted and jumped between', async () => {
    setMockFetch(() => Promise.resolve(json(pluginsPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(PluginsSection, { target, props: { contextId: 'user:1' } })
    await drain()
    expect(target.querySelectorAll('ul.settings-plugins > li')).toHaveLength(2)
    void unmount(component)
  })
```

The existing test `renders plugins and eligibility reasons` at `:142` asserts `toContain('config_missing')` — that string is exactly what this task removes. Change that assertion to:

```typescript
    expect(target.textContent).toContain('Needs setup')
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun run test:client -t "PluginCard"`
Expected: FAIL on the four new tests — the pill still reads `config_missing: api_key`, `aria-describedby` is absent, there is no `#plugin-explain-*`, and the name is a `<span>`.

Run: `bun run test:client -t "PluginsSection"`
Expected: FAIL — the list test finds 0 `li` elements.

- [ ] **Step 3: Consume the eligibility module and add the semantics**

In `client/settings/components/PluginCard.svelte`, delete the local `eligibilityLabel` and `eligTone` helpers and import the module instead:

```typescript
  import { eligibilityCopy } from '../lib/plugin-eligibility.js'
```

Add derived ids and copy to the script:

```typescript
  const copy = $derived(eligibilityCopy(plugin))
  const pillId = $derived(`plugin-elig-${plugin.id}`)
  const explainId = $derived(`plugin-explain-${plugin.id}`)
  // The toggle's label already swaps Enable/Disable, so aria-pressed would announce
  // the opposite of the label. Point at the status pill (and the explanation, when
  // the state needs one) instead: "Disable, button, Ready".
  const toggleDescribedBy = $derived(copy.explanation === undefined ? pillId : `${pillId} ${explainId}`)
```

Replace the head block and add the explanation line beneath it:

```svelte
  <div class="settings-plugins__head">
    <h3 class="settings-plugins__name">{plugin.name}</h3>
    <span class="settings-plugins__elig">
      <Pill tone={copy.tone} id={pillId}>{#snippet children()}{copy.label}{/snippet}</Pill>
    </span>
    <Btn
      variant="secondary"
      size="sm"
      testid={`plugin-toggle-${plugin.id}`}
      busy={toggling}
      ariaDescribedBy={toggleDescribedBy}
      disabled={!plugin.eligibility.eligible && plugin.eligibility.reason === 'inactive'}
      onClick={() => void toggle()}>
      {#snippet children()}{plugin.enabled ? 'Disable' : 'Enable'}{/snippet}
    </Btn>
  </div>
  {#if copy.explanation !== undefined}
    <p class="settings-plugins__explain" id={explainId}>{copy.explanation}</p>
  {/if}
```

Add to the card's `<style>`:

```css
  .settings-plugins__explain {
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
  }
```

and give the heading a reset, replacing the existing `.settings-plugins__name` rule:

```css
  .settings-plugins__name {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 500;
  }
```

`h3` is the right level: `PageHeader.svelte:25` renders the section title as `h2`.

- [ ] **Step 4: Make the section a list**

In `client/settings/sections/PluginsSection.svelte`, replace the `<div class="settings-plugins">` / `{#each}` / `</div>` block with:

```svelte
    <ul class="settings-plugins">
      {#each plugins as plugin (plugin.id)}
        <li>
          <PluginCard
            {plugin}
            {contextId}
            onChanged={() => load(contextId)}
            onRequestClear={(key, required) => {
              pendingClearKey = { pluginId: plugin.id, key, required }
              clearError = null
            }} />
        </li>
      {/each}
    </ul>
```

and update the style block:

```css
  .settings-plugins {
    display: grid;
    gap: 12px;
    list-style: none;
    margin: 0;
    padding: 0;
  }
```

- [ ] **Step 5: Run to verify they pass**

Run: `bun run test:client -t "PluginCard"`
Expected: PASS — 12 pass, 0 fail.

Run: `bun run test:client -t "PluginsSection"`
Expected: PASS — 14 pass, 0 fail.

- [ ] **Step 6: Re-shoot**

Run: `bun run visual:audit`
Expected: FAIL on `Populated`, `Configurable`, `Ineligible`, `Plugins — populated, narrow`, `Plugins — toggle hovered` — the pill text changed on every card and the ineligible cards gained an explanation line. `Empty`, `Error`, `Loading` and the two narrow error/empty shots must **not** be in the list.

Run: `bun shoot -g PluginsSection`

Read every changed PNG. Confirm the pills now read Ready / Off / Unavailable / Needs setup / Not supported here, that the explanation sentence sits under the head row, and that no raw enum survives anywhere.

Run: `bun run visual:audit`
Expected: PASS, 0 failed.

- [ ] **Step 7: Typecheck, format and commit**

```bash
bun run typecheck
bun run format
git add client/settings/components/PluginCard.svelte client/settings/sections/PluginsSection.svelte tests/client/settings/components/PluginCard.test.ts tests/client/settings/sections/PluginsSection.test.ts
git commit -m "feat(settings): human eligibility copy and real structure for plugin cards

Schema enums like 'config_missing: apiKey' become a pill plus a sentence naming
the consequence and the next step, with missing keys resolved to field labels.
Cards are list items with a heading. The toggle is described by its status pill
and, when disabled, by the explanation of why — instead of aria-pressed, which
would announce the opposite of a label that already swaps Enable/Disable."
```

---

## Task 7: Spacing tokens, trailing alignment and a usable empty state

**Files:**
- Modify: `client/settings/components/PluginCard.svelte`
- Modify: `client/settings/sections/PluginsSection.svelte`
- Test: `tests/client/settings/sections/PluginsSection.test.ts`

**Interfaces:**
- Consumes: the markup from Task 6.
- Produces: no new API. Visual only, plus the empty-state hint text.

Closes `plugins-hardcoded-spacing`, `plugins-head-no-trailing-alignment`, `plugins-empty-state-dead-end`.

- [ ] **Step 1: Write the failing test**

Replace the existing `shows EmptyState when no plugins are discovered` test in `tests/client/settings/sections/PluginsSection.test.ts` with:

```typescript
  test('the empty state says who installs plugins instead of stopping at the void', async () => {
    setMockFetch(() => Promise.resolve(json({ contextId: 'user:1', plugins: [] })))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(PluginsSection, { target, props: { contextId: 'user:1' } })
    await drain()
    expect(target.querySelector('.ui-empty')).not.toBeNull()
    expect(target.textContent).toContain('No plugins discovered')
    expect(target.querySelector('.ui-empty__hint')!.textContent).toContain('operator')
    // No action: PageHeader already carries a Refresh control two rows up, and a
    // second one inside the empty state would put the same action on screen twice.
    expect(target.querySelector('.ui-empty__action')).toBeNull()
    void unmount(component)
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run test:client -t "PluginsSection"`
Expected: FAIL — `target.querySelector('.ui-empty__hint')` is null; `EmptyState` renders the hint only when the prop is passed (`EmptyState.svelte:22`).

- [ ] **Step 3: Add the hint**

In `client/settings/sections/PluginsSection.svelte`:

```svelte
    <EmptyState
      title="No plugins discovered"
      hint="Plugins are installed on the server by an operator. Once one is installed and approved, it appears here for you to enable." />
```

- [ ] **Step 4: Move every hardcoded gap onto the token scale**

In `client/settings/components/PluginCard.svelte`, replace the `<style>` block with:

```css
<style>
  .settings-plugins__card {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface-1);
    padding: var(--gap-inline);
    display: grid;
    gap: var(--gap-inline);
  }
  .settings-plugins__head {
    display: flex;
    align-items: center;
    gap: var(--gap-inline);
    flex-wrap: wrap;
  }
  .settings-plugins__name {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 500;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  /* Push the toggle to the card's trailing edge, as .settings-mcp__primary-trailing does. */
  .settings-plugins__head :global(.ui-btn) {
    margin-left: auto;
  }
  .settings-plugins__explain {
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
  }
  .settings-plugins__cfg {
    display: grid;
    gap: var(--gap-inline);
  }
  .settings-plugins__note {
    color: var(--success);
    font-size: 11px;
    white-space: nowrap;
  }
</style>
```

The off-scale `10px` rounds **up** to `--gap-inline`, matching `McpSection.svelte`, which uses `--gap-inline` for the same card-internal relationship. `min-width: 0` plus `overflow-wrap: anywhere` on the name and `flex-wrap` on the head mean a long plugin name wraps instead of squeezing the pill and the button.

In `client/settings/sections/PluginsSection.svelte`, update the list gap:

```css
  .settings-plugins {
    display: grid;
    gap: var(--gap-inline);
    list-style: none;
    margin: 0;
    padding: 0;
  }
```

- [ ] **Step 5: Run to verify it passes**

Run: `bun run test:client -t "PluginsSection"`
Expected: PASS — 14 pass, 0 fail.

- [ ] **Step 6: Re-shoot**

Run: `bun run visual:audit`
Expected: FAIL on every PluginsSection shot except `Loading` — the card gained a radius, the toggle moved to the trailing edge, and the empty states gained a hint line. `Loading` renders only the placeholder paragraph, so it must **not** be in the list.

Run: `bun shoot -g PluginsSection`

Read every changed PNG. Confirm the card corners are rounded and match `McpSection` at the same width, the toggle sits flush against the card's right padding edge, and the narrow (640px) frames show the head wrapping cleanly rather than crushing the pill.

Run: `bun run visual:audit`
Expected: PASS, 0 failed.

- [ ] **Step 7: Typecheck, format and commit**

```bash
bun run typecheck
bun run format
git add client/settings/components/PluginCard.svelte client/settings/sections/PluginsSection.svelte tests/client/settings/sections/PluginsSection.test.ts
git commit -m "style(settings): put plugin cards on the shared spacing scale

Literal 12px and off-scale 10px gaps become --gap-inline (the 8px row gap
went with the hand-rolled config row SettingsFieldShell replaced), the card gains
--radius to match the sibling card in McpSection, and the toggle gets a
margin-left:auto trailing edge with a wrapping head so a long plugin name no
longer squeezes the pill and the action. The empty state now names who installs
plugins rather than titling the void and stopping."
```

---

## Task 8: Close the findings

**Files:**
- Modify: `docs/ux-reviews/PluginsSection.md`
- Modify: `docs/ux-reviews/_BACKLOG.md` (generated — never hand-edited)

**Interfaces:**
- Consumes: the commit hashes produced by Tasks 1 and 3-7.
- Produces: nothing code-facing.

This task runs **last and alone**: each `Resolved:` line cites the commit that fixed the finding, and those hashes do not exist until the fixes are committed.

- [ ] **Step 1: Collect the hashes**

```bash
git log --oneline -8
```

Note the short hash of each of the seven implementation commits.

- [ ] **Step 2: Flip all 14 findings to fixed**

In `docs/ux-reviews/PluginsSection.md`, for every finding change `- **Status:** open` to `- **Status:** fixed` and add a `- **Resolved:**` line directly beneath it. Map each finding to the commit that closed it:

| Finding | Resolved by |
| --- | --- |
| `plugins-load-error-no-recovery` | Task 4 commit |
| `plugins-raw-eligibility-strings` | Task 6 commit |
| `plugins-config-field-not-shell` | Task 5 commit (+ Task 1) |
| `plugins-no-inflight-state` | Task 4 commit |
| `plugins-validation-far-from-field` | Task 4 commit |
| `plugins-disabled-toggle-unexplained` | Task 6 commit |
| `plugins-hardcoded-spacing` | Task 7 commit |
| `plugins-head-no-trailing-alignment` | Task 7 commit |
| `plugins-cards-not-a-list` | Task 6 commit |
| `plugins-save-no-success-feedback` | Task 4 commit (+ Task 1) |
| `plugins-required-not-passed-to-field` | Task 5 commit |
| `plugins-empty-state-dead-end` | Task 7 commit |
| `plugins-toggle-no-aria-pressed` | Task 6 commit |
| `plugins-fixture-coverage-gap` | Task 5 commit |

Three lines carry more than a hash. Write them exactly:

```markdown
- **Resolved:** <task-5-hash> — config rows adopt `SettingsFieldShell` + `Secret`/Replace. Also fixed the
  underlying server defect in <task-1-hash>: `plugins-routes.ts` computed `hasValue` but never emitted
  `value`, so a non-sensitive stored value was invisible in the UI regardless of how the field rendered.
```

```markdown
- **Resolved:** <task-4-hash> — a save is acknowledged with a transient `✓ Saved` marker. Also fixed the
  underlying server defect in <task-1-hash>: the route answers an empty or masked-equal submit on a
  sensitive field with `{ unchanged: true }`, and `patchPluginConfig` discarded it, so that Save reported
  nothing at all. The card now says "No change — the stored value was the same" instead.
```

```markdown
- **Resolved:** <task-6-hash> — closed by a different mechanism than suggested. `ariaPressed` was
  rejected on the precedent set for `guest-mode-toggle-not-exposed-a11y`: the button's label already
  swaps between "Enable" and "Disable", so `aria-pressed` would announce "Disable, pressed" — the label
  naming the action and the state naming its opposite. The status `Pill` gained an id and the toggle's
  `ariaDescribedBy` points at it, giving "Disable, button, Ready".
```

Also update the file's header: set `**Date:**` to the date of this work, and rewrite the **Coverage caveat** paragraph to record that the gap is closed — the `settings-plugins-configurable` and `settings-plugins-ineligible` scenarios now render config rows, a masked secret, ineligible pills and a disabled toggle.

Finally, re-score the scorecard from the fixed component. Dimensions 3, 4, 5, 8 and 9 move from `fail` to `pass`; dimensions 1, 2, 6 and 7 move from `warn` to `pass`. Rewrite each rationale line to describe what is there now, not what was wrong.

- [ ] **Step 3: Regenerate the backlog**

```bash
bun run ux:backlog
```

- [ ] **Step 4: Verify the end state**

Run: `bun test tests/scripts/ux-backlog.test.ts`
Expected: PASS — including `is current — regenerating in memory reproduces it exactly` at `:224`, which is what forbids hand-editing `_BACKLOG.md`.

Open `docs/ux-reviews/_BACKLOG.md` and confirm, exactly:
- the count line reads `0 open finding(s) across 19 section(s).`
- the `PluginsSection` row reads `0 | 14 | 0 | 0 | 0`
- the totals row reads `0 | 183 | 3 | 2 | 1`
- all three severity buckets under `## Open findings` read `_None._`
- `## Deferred` contains exactly one entry: `repos-no-edit-capability`

- [ ] **Step 5: Format and commit**

```bash
bun run format
git add docs/ux-reviews/PluginsSection.md docs/ux-reviews/_BACKLOG.md
git commit -m "docs(ux): close all 14 PluginsSection findings

Backlog goes to 0 open across 19 sections. plugins-toggle-no-aria-pressed is
closed by describedby rather than aria-pressed, with the rejection recorded;
two server-side defects found while fixing are named in the Resolved lines of
the findings they sat behind."
```

- [ ] **Step 6: Final whole-branch check**

Run: `bun run typecheck`
Expected: PASS.

Run: `bun run test:client`
Expected: PASS — the full client suite.

Run: `bun test tests/debug/settings/plugins-routes.test.ts`
Expected: PASS — 10 pass.

Run: `bun run visual:audit`
Expected: PASS, 0 failed.

Report the final backlog counts and stop. **Do not merge and do not push** — both are the user's call.
