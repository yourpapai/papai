<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Settings Field Error Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route a server validation error to the field that caused it, rendered inline under
that field with the accessibility wiring the primitives already support.

**Architecture:** Nine field-attributable 422s in `coding-credentials-routes.ts` gain an
optional `field` key and lose their column name from the prose. `FetchError` carries `field`
to the client. `SettingsFieldShell` gains `error`/`hint` props and publishes `setFieldError`
exactly as `Field` does, making `Input`'s existing `aria-invalid` support reachable; `Select`
and `Combobox` learn the same. The two whole-record-submit sections route an attributed error
to the offending field's shell and keep the banner for everything else.

**Tech Stack:** Bun, Svelte 5 runes, Zod v4, oxlint/oxfmt, MSW 2.15, Playwright + `@crvy/strybk`.

**Spec:** [`docs/superpowers/specs/2026-07-31-settings-field-error-channel-design.md`](../specs/2026-07-31-settings-field-error-channel-design.md)

## Global Constraints

- Strict TypeScript. **Import paths use the `.js` extension** even for `.ts` sources.
- **Never add a lint-disable or type-ignore comment** — the hook policy blocks them. Fix the cause.
- `max-lines` is 300 for non-test `.ts` files (off for `tests/**`, and oxlint does not parse
  `.svelte`). `src/debug/settings/coding-credentials-routes.ts` is **283 lines** — if oxfmt
  wrapping pushes it past 300, extract the auth-method block of `checkCompatibility` into its
  own helper. Do not compress formatting to fit.
- The formatter is **oxfmt** via `bun run format`, never prettier.
- `vitest(no-conditional-in-test)` is on: **no `if` inside a `test()` body**.
- The TDD write hook requires an exact-name mirror test file to exist before a new source file
  is written (`foo.ts` → `foo.test.ts`). This plan creates no new source modules, only new
  `.svelte` test fixtures under `tests/`, which follow the existing
  `tests/client/shared/ui/FieldSelectFixture.svelte` precedent.
- Client tests are excluded from default discovery by `bunfig.toml`. The working invocation is:
  `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' <path>`
- **Do NOT run `bun run license:headers` or `bun run shoot:gen`.** `shoot:gen` chains
  `license:headers`, which has previously stamped ~37 unrelated files. To regenerate a spec's
  `@generated` block run `bunx crvy-strybk generate --config ./strybk.config.ts` followed by
  `bun run format`, then check `git status` and revert any unrelated file it touched.
- Before any `bun shoot`, **kill and restart Storybook**: `bun storybook:prepare` concatenates
  CSS at startup and `playwright.config.ts` sets `reuseExistingServer: true`, so a warm server
  serves stale assets. `lsof -ti:6006 | xargs kill` then `bun storybook` and poll until it answers.
- Everything under `.storybook-shots/**` is gitignored and always regenerated. Never commit it.
- `bun shoot` is `playwright test --update-snapshots`. To verify baselines are *unchanged*, run
  plain `bunx playwright test` with no `--update-snapshots`.
- The nine server messages are **exact strings**, copied verbatim from the table in Task 1.
  Lowercase, no trailing period, matching the file's existing style.
- Known pre-existing and out of scope: `ByokSection.spec.ts` fails 5 specs on story-name drift;
  `CodingCredentialsSection.spec.ts` is flaky under parallel Playwright workers (`sharedPage`
  viewport bleed) and must be run with `--workers=1`.

---

### Task 1: Server — nine 422s carry `field`, messages drop the column name

**Files:**

- Modify: `src/debug/settings/coding-credentials-routes.ts:104-170`
- Test: `tests/debug/settings/coding-credentials-routes.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: the wire contract `{ error: string, field?: string }` on 422 responses, and these
  nine exact `field` values: `kind`, `instance_url`, `agent`, `provider`, `provider_base_url`,
  `model`, `auth_method`. Task 2 reads `field`; Task 6 matches it against `FIELDS_META` keys.

The full mapping — old message → new message + field:

| Old                                                             | New message                                                         | `field`             |
| --------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------- |
| `unknown forge kind: ${kindRaw}`                                | `unsupported code host`                                             | `kind`              |
| `instance_url must be an https URL for self-hosted forge kinds` | `required for self-hosted code hosts, and must start with https://` | `instance_url`      |
| `unknown agent: ${agentRaw}`                                    | `unsupported coding agent`                                          | `agent`             |
| `unknown provider: ${providerRaw}`                              | `unsupported model provider`                                        | `provider`          |
| `openai-compatible requires a base URL`                         | `required for the openai-compatible provider`                       | `provider_base_url` |
| `model too long (max 200)`                                      | `too long (max 200 characters)`                                     | `model`             |
| `model contains control characters`                             | `contains control characters`                                       | `model`             |
| `unknown auth method: ${methodRaw}`                             | `unsupported auth method`                                           | `auth_method`       |
| `oauth-subscription does not use a base URL`                    | `leave blank when auth method is oauth-subscription`                | `provider_base_url` |

**Leave alone**, with no `field`: `incompatible agent/provider` (`:143`),
`oauth-subscription requires the anthropic provider` (`:162`), all four `mcp` 422s (`:183`,
`:186`, `:198`, `:203`), `invalid request` (`:242`), and the 400/405 responses.

- [ ] **Step 1: Widen the test file's error schema**

`tests/debug/settings/coding-credentials-routes.test.ts:63`:

```ts
const ErrorResponseSchema = z.object({ error: z.string(), field: z.string().optional() })
```

- [ ] **Step 2: Tighten the seven assertions the new copy breaks**

These currently pass on substrings that the new messages no longer contain. Replace each with
an exact message assertion plus a `field` assertion.

`:478` (in `PATCH rejects unknown agent value with 422`):

```ts
    expect(body.error).toBe('unsupported coding agent')
    expect(body.field).toBe('agent')
```

`:492` (in `PATCH rejects unknown provider value with 422`):

```ts
    expect(body.error).toBe('unsupported model provider')
    expect(body.field).toBe('provider')
```

`:549` (in `forge PATCH rejects unknown kind with 422`):

```ts
    expect(body.error).toBe('unsupported code host')
    expect(body.field).toBe('kind')
```

`:575` (in `openai-compatible provider requires a base URL (422 without, 200 with)`):

```ts
    expect(badBody.error).toBe('required for the openai-compatible provider')
    expect(badBody.field).toBe('provider_base_url')
```

`:618` (in `openai-compatible 422 uses MERGED state: …`):

```ts
    expect(body.error).toBe('required for the openai-compatible provider')
    expect(body.field).toBe('provider_base_url')
```

`:711` (in `PATCH rejects over-long model with 422`):

```ts
    expect(body.error).toBe('too long (max 200 characters)')
    expect(body.field).toBe('model')
```

`:725` (in `PATCH rejects model with control characters with 422`):

```ts
    expect(body.error).toBe('contains control characters')
    expect(body.field).toBe('model')
```

- [ ] **Step 3: Add `field` assertions to the two instance_url tests, which assert status only**

In `forge PATCH requires instance_url for self-hosted kinds` (`:517`) and
`forge PATCH instance_url must be https for self-hosted` (`:552`), after the existing
`expect(res.status).toBe(422)`:

```ts
    const body = ErrorResponseSchema.parse(await res.json())
    expect(body.error).toBe('required for self-hosted code hosts, and must start with https://')
    expect(body.field).toBe('instance_url')
```

- [ ] **Step 4: Add the two tests that do not exist yet**

`unsupported auth method` has no test at all, and `oauth-subscription does not use a base URL`
is asserted by status only. Append both inside the existing top-level `describe`, following the
file's `patch(...)` helper style:

```ts
  test('PATCH rejects an unknown auth method with 422 attributed to auth_method', async () => {
    const url = new URL('https://x/settings/api/coding-credentials')
    const res = await handleCodingCredentialsRoutes(
      patch('/settings/api/coding-credentials', session, {
        namespace: 'agent-provider',
        values: { agent: 'claude', provider: 'anthropic', provider_api_key: 'k', auth_method: 'kerberos' },
      }),
      url,
    )
    expect(res.status).toBe(422)
    const body = ErrorResponseSchema.parse(await res.json())
    expect(body.error).toBe('unsupported auth method')
    expect(body.field).toBe('auth_method')
  })

  test('PATCH rejects oauth-subscription with a base URL, attributed to provider_base_url', async () => {
    const url = new URL('https://x/settings/api/coding-credentials')
    const res = await handleCodingCredentialsRoutes(
      patch('/settings/api/coding-credentials', session, {
        namespace: 'agent-provider',
        values: {
          agent: 'claude',
          provider: 'anthropic',
          provider_api_key: 'k',
          auth_method: 'oauth-subscription',
          provider_base_url: 'https://example.com/v1',
        },
      }),
      url,
    )
    expect(res.status).toBe(422)
    const body = ErrorResponseSchema.parse(await res.json())
    expect(body.error).toBe('leave blank when auth method is oauth-subscription')
    expect(body.field).toBe('provider_base_url')
  })
```

- [ ] **Step 5: Assert the cross-field error stays unattributed**

This is what stops a later change from quietly attributing it. Extend the existing
`PATCH rejects incompatible agent/provider pair with 422` test (`:134`) — after `:145`:

```ts
    expect(body.field).toBeUndefined()
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `bun test tests/debug/settings/coding-credentials-routes.test.ts`
Expected: FAIL — roughly a dozen failures, all on the message/field assertions.

- [ ] **Step 7: Apply the nine route changes**

In `src/debug/settings/coding-credentials-routes.ts`, replace each `settingsJson(422, …)` in
`checkForgeKind` and `checkCompatibility` per the table above. In full:

```ts
    return settingsJson(422, { error: 'unsupported code host', field: 'kind' })
```

```ts
      return settingsJson(422, {
        error: 'required for self-hosted code hosts, and must start with https://',
        field: 'instance_url',
      })
```

```ts
    return settingsJson(422, { error: 'unsupported coding agent', field: 'agent' })
```

```ts
    return settingsJson(422, { error: 'unsupported model provider', field: 'provider' })
```

```ts
    return settingsJson(422, { error: 'required for the openai-compatible provider', field: 'provider_base_url' })
```

```ts
    if (modelRaw.length > 200) return settingsJson(422, { error: 'too long (max 200 characters)', field: 'model' })
```

```ts
    if (hasCtrl) return settingsJson(422, { error: 'contains control characters', field: 'model' })
```

```ts
    if (!isAuthMethod(methodRaw)) return settingsJson(422, { error: 'unsupported auth method', field: 'auth_method' })
```

```ts
        return settingsJson(422, {
          error: 'leave blank when auth method is oauth-subscription',
          field: 'provider_base_url',
        })
```

`kindRaw`, `agentRaw`, `providerRaw`, and `methodRaw` are still read by the surrounding
conditions, so dropping them from the messages leaves no unused bindings.

- [ ] **Step 8: Run the tests to verify they pass, and check the line count**

Run: `bun test tests/debug/settings/coding-credentials-routes.test.ts`
Expected: PASS, all tests.

Run: `bun run format && wc -l src/debug/settings/coding-credentials-routes.ts`
Expected: a number ≤ 300. If it exceeds 300, extract the auth-method block of
`checkCompatibility` into a `checkAuthMethod(merged, providerRaw)` helper returning
`Response | null`, and re-run the tests.

- [ ] **Step 9: Commit**

```bash
git add src/debug/settings/coding-credentials-routes.ts tests/debug/settings/coding-credentials-routes.test.ts
git commit -m "feat(settings): attribute coding-credential 422s to the offending field"
```

---

### Task 2: Transport — `FetchError` carries `field`

**Files:**

- Modify: `client/shared/fetcher-helpers.ts:8-35`
- Test: `tests/client/shared/fetcher-helpers.test.ts`

**Interfaces:**

- Consumes: the `{ error, field? }` wire contract from Task 1.
- Produces: `FetchError.field: string | undefined` and an exported
  `errorFieldFrom(body: unknown): string | undefined`. Task 6 reads `err.field`.

This module is shared by the settings, admin, and debug SPAs. The change is additive only;
no existing caller is affected.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('fetcher-helpers', …)` in
`tests/client/shared/fetcher-helpers.test.ts`. Import `errorFieldFrom` alongside the others.

```ts
  test('errorFieldFrom extracts the field key when present', () => {
    expect(errorFieldFrom({ error: 'unsupported code host', field: 'kind' })).toBe('kind')
  })

  test('errorFieldFrom yields undefined when the body carries no field', () => {
    expect(errorFieldFrom({ error: 'incompatible agent/provider' })).toBeUndefined()
    expect(errorFieldFrom(null)).toBeUndefined()
  })

  test('requireOk throws a FetchError carrying the field key', () => {
    const res = new Response(null, { status: 422 })
    try {
      requireOk(res, { error: 'unsupported code host', field: 'kind' })
      throw new Error('expected requireOk to throw')
    } catch (err) {
      assertIsFetchError(err)
      expect(err.status).toBe(422)
      expect(err.message).toBe('unsupported code host')
      expect(err.field).toBe('kind')
    }
  })

  test('requireOk leaves field undefined for an unattributed error', () => {
    const res = new Response(null, { status: 422 })
    try {
      requireOk(res, { error: 'incompatible agent/provider' })
      throw new Error('expected requireOk to throw')
    } catch (err) {
      assertIsFetchError(err)
      expect(err.field).toBeUndefined()
    }
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/fetcher-helpers.test.ts`
Expected: FAIL — `errorFieldFrom` is not exported.

- [ ] **Step 3: Implement**

In `client/shared/fetcher-helpers.ts`:

```ts
export const ErrorBodySchema = z.object({ error: z.string(), field: z.string().optional() })

export const errorMessageFrom = (body: unknown, fallback: string): string => {
  const parsed = ErrorBodySchema.safeParse(body)
  return parsed.success ? parsed.data.error : fallback
}

/** The offending form field, when the server attributed the error to one. */
export const errorFieldFrom = (body: unknown): string | undefined => {
  const parsed = ErrorBodySchema.safeParse(body)
  return parsed.success ? parsed.data.field : undefined
}

export class FetchError extends Error {
  readonly status: number
  readonly field: string | undefined
  constructor(status: number, message: string, field?: string) {
    super(message)
    this.name = 'FetchError'
    this.status = status
    this.field = field
  }
}

export const requireOk = (res: Response, body: unknown): void => {
  if (res.ok) return
  throw new FetchError(
    res.status,
    errorMessageFrom(body, `request failed with status ${res.status}`),
    errorFieldFrom(body),
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/fetcher-helpers.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add client/shared/fetcher-helpers.ts tests/client/shared/fetcher-helpers.test.ts
git commit -m "feat(client): carry the offending field key on FetchError"
```

---

### Task 3: `SettingsFieldShell` gains the error/hint channel

**Files:**

- Modify: `client/settings/components/SettingsFieldShell.svelte`
- Create: `tests/client/settings/components/ShellInputFixture.svelte`
- Test: `tests/client/settings/components/SettingsFieldShell.test.ts`

**Interfaces:**

- Consumes: `setFieldError` / `FieldErrorContext` from
  `client/shared/ui/field-context.ts:23-32` (already exported; `Field.svelte:29` is the model).
- Produces: two new optional props on `SettingsFieldShell` — `error?: string`, `hint?: string`
  — and a published field-error context. Tasks 4–6 depend on both.

- [ ] **Step 1: Write the fixture component**

`tests/client/settings/components/ShellInputFixture.svelte` — this is what proves the context
actually reaches a control rendered inside the `editor` snippet, which is the whole point of
the task. It follows `tests/client/shared/ui/FieldSelectFixture.svelte`.

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import SettingsFieldShell from '../../../../client/settings/components/SettingsFieldShell.svelte'
  import Input from '../../../../client/shared/ui/Input.svelte'

  interface Props {
    error?: string
  }

  let { error }: Props = $props()
</script>

<SettingsFieldShell label="Instance URL" {error}>
  {#snippet editor()}
    <Input value="" testid="fixture-input" />
  {/snippet}
</SettingsFieldShell>
```

- [ ] **Step 2: Write the failing tests**

Append inside the existing `describe('SettingsFieldShell', …)` in
`tests/client/settings/components/SettingsFieldShell.test.ts`, and add the fixture import at
the top of the file:

```ts
import ShellInputFixture from './ShellInputFixture.svelte'
```

```ts
  test('renders the error with role=alert when error is set', () => {
    const { component, target } = render({ label: 'Instance URL', error: 'must start with https://' })
    flushSync()
    const el = target.querySelector<HTMLElement>('.settings-field__error')!
    expect(el.textContent).toContain('must start with https://')
    expect(el.getAttribute('role')).toBe('alert')
    void unmount(component)
  })

  test('renders the hint when there is no error', () => {
    const { component, target } = render({ label: 'Model', hint: 'Leave blank for the agent default.' })
    flushSync()
    expect(target.querySelector('.settings-field__hint')!.textContent).toContain('Leave blank')
    expect(target.querySelector('.settings-field__error')).toBeNull()
    void unmount(component)
  })

  test('error wins over hint when both are supplied', () => {
    const { component, target } = render({ label: 'Model', hint: 'a hint', error: 'too long (max 200 characters)' })
    flushSync()
    expect(target.querySelector('.settings-field__error')!.textContent).toContain('too long')
    expect(target.querySelector('.settings-field__hint')).toBeNull()
    void unmount(component)
  })

  test('publishes the error to an Input in the editor snippet', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ShellInputFixture, { target, props: { error: 'must start with https://' } })
    flushSync()
    const input = target.querySelector<HTMLInputElement>('[data-testid="fixture-input"]')!
    const err = target.querySelector<HTMLElement>('.settings-field__error')!
    expect(err.id).toBeTruthy()
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toBe(err.id)
    void unmount(component)
  })

  test('leaves an Input valid when the shell has no error', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ShellInputFixture, { target, props: {} })
    flushSync()
    const input = target.querySelector<HTMLInputElement>('[data-testid="fixture-input"]')!
    expect(input.getAttribute('aria-invalid')).toBeNull()
    expect(input.getAttribute('aria-describedby')).toBeNull()
    void unmount(component)
  })
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/components/SettingsFieldShell.test.ts`
Expected: FAIL — no `.settings-field__error` element, no `aria-invalid`.

- [ ] **Step 4: Implement the shell**

In `client/settings/components/SettingsFieldShell.svelte`, the instance script becomes what
follows. The `<script module>` block above it — which declares `let seq = 0` — is **unchanged**;
`uid` derives from that existing counter so the label and error ids share one instance number.

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte'

  import { setFieldError, setFieldLabelId } from '../../shared/ui/field-context.js'

  interface Props {
    label: string
    required?: boolean
    testid?: string
    // Whether to render the editor slot. Consumers pass their own open/closed logic
    // (masked-resting secret fields render `head` only). Defaults to true.
    editorOpen?: boolean
    // Inline validation message for this field; suppresses `hint` while set.
    error?: string
    hint?: string
    head?: Snippet
    editor?: Snippet<[string]>
    footer?: Snippet
  }

  let { label, required = false, testid, editorOpen = true, error, hint, head, editor, footer }: Props = $props()

  // Publish the label element id so an Input rendered in the `editor` snippet gets an
  // accessible name (aria-labelledby) — restoring what the old Field wrapper provided,
  // now pointing at the real field name instead of a generic "Value"/"New value".
  const uid = ++seq
  const labelId = `settings-field-${uid}`
  const errorId = `settings-field-err-${uid}`
  setFieldLabelId(labelId)
  // Getter, not a snapshot: this is what makes the descendant control track the live
  // `error` prop rather than its value at init.
  setFieldError({
    errorId,
    get invalid() {
      return error !== undefined && error !== ''
    },
  })
</script>
```

The markup gains one block, immediately before the footer render:

```svelte
  {#if error}<p class="settings-field__error" id={errorId} role="alert">{error}</p>
  {:else if hint}<p class="settings-field__hint">{hint}</p>{/if}
  {@render footer?.()}
```

and two style rules. These follow the **settings** type scale (12px `--text-muted`), not
`Field`'s 10px `--fg-hint` — both settings consumers already use 12px, and `margin: 0` matters
because the shell is a grid with `gap: var(--gap-tight)`:

```css
  .settings-field__error {
    margin: 0;
    color: var(--danger);
    font-size: 12px;
  }
  .settings-field__hint {
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/components/SettingsFieldShell.test.ts`
Expected: PASS, all tests including the three that already existed.

- [ ] **Step 6: Add the story states**

In `client/settings/components/SettingsFieldShell.stories.svelte`, append two stories after the
existing three:

```svelte
<Story name="Inline error" asChild>
  <SettingsFieldShell label="Instance URL" required editorOpen={true} error="required for self-hosted code hosts, and must start with https://">
    {#snippet editor()}
      <Input value="http://ghe.corp.example" />
      <Btn variant="primary" size="sm">{#snippet children()}Save{/snippet}</Btn>
    {/snippet}
  </SettingsFieldShell>
</Story>

<Story name="Hint prop" asChild>
  <SettingsFieldShell label="Model" editorOpen={true} hint="Leave blank for the agent default.">
    {#snippet editor()}
      <Input value="claude-opus-4-5" />
      <Btn variant="primary" size="sm">{#snippet children()}Save{/snippet}</Btn>
    {/snippet}
  </SettingsFieldShell>
</Story>
```

- [ ] **Step 7: Regenerate the visual spec block**

Run: `bunx crvy-strybk generate --config ./strybk.config.ts && bun run format`
Then: `git status --porcelain`
Expected: `tests/visual/settings/components/SettingsFieldShell.spec.ts` gains two tests inside
the `@generated` region — `'Inline error'` and `'Hint prop'`. Revert any other file it touched.
Do **not** run `bun run shoot:gen`.

- [ ] **Step 8: Shoot and read the two new baselines**

```bash
lsof -ti:6006 | xargs kill 2>/dev/null; bun storybook &
# poll until http://localhost:6006 answers
bun shoot -g SettingsFieldShell
```

Then Read the PNGs under `.storybook-shots/**/SettingsFieldShell.spec.ts/` for the two new
states. Expected: the error state shows red message text below the input; the hint state shows
muted text. Confirm the three pre-existing states are visually unchanged.

- [ ] **Step 9: Commit**

```bash
git add client/settings/components/SettingsFieldShell.svelte client/settings/components/SettingsFieldShell.stories.svelte tests/client/settings/components/SettingsFieldShell.test.ts tests/client/settings/components/ShellInputFixture.svelte tests/visual/settings/components/SettingsFieldShell.spec.ts
git commit -m "feat(settings): give SettingsFieldShell an inline error and hint channel"
```

---

### Task 4: `Select` and `Combobox` learn invalid state

**Files:**

- Modify: `client/shared/ui/field-context.ts`, `client/shared/ui/Input.svelte`,
  `client/shared/ui/Select.svelte`, `client/shared/ui/Combobox.svelte`
- Create: `tests/client/shared/ui/FieldErrorFixture.svelte`
- Test: `tests/client/shared/ui/Select.test.ts`, `tests/client/shared/ui/Combobox.test.ts`,
  `tests/client/shared/ui/Input.test.ts`

**Interfaces:**

- Consumes: `getFieldError()` from `client/shared/ui/field-context.ts:35`, published by both
  `Field` (`Field.svelte:29`) and, as of Task 3, `SettingsFieldShell`.
- Produces: `useFieldInvalid(): { readonly invalid: boolean; readonly describedBy: string | undefined }`
  exported from `field-context.ts`, and `aria-invalid` / `aria-describedby` /
  `.ui-select--invalid` / `.ui-combobox--invalid` on both controls. Task 6 relies on the
  attributes for `kind`, `agent`, `provider`, `auth_method` (selects) and `model` (combobox) —
  five of the nine attributed errors.

`Input.svelte:37-40`, `:51`, `:60-61`, `:76-77`, `:97-99` is the pattern being generalized.
Rather than making Select and Combobox a second and third verbatim copy of those four lines,
this task extracts them into `useFieldInvalid()` and moves `Input` onto it too. The helper
returns plain getters — no runes — so it lives in the existing `.ts` module and stays reactive
because each getter reads through the context object's own `invalid` getter on access.

- [ ] **Step 1: Write the fixture component**

`tests/client/shared/ui/FieldErrorFixture.svelte` — uses `Field`, which already publishes the
error context, so this task's tests do not depend on Task 3.

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Combobox from '../../../../client/shared/ui/Combobox.svelte'
  import Field from '../../../../client/shared/ui/Field.svelte'
  import Select from '../../../../client/shared/ui/Select.svelte'

  interface Props {
    error?: string
  }

  let { error }: Props = $props()
</script>

<Field label="Model provider" {error}>
  <Select value="a" options={[{ value: 'a', label: 'A' }]} testid="err-select" />
  <Combobox value="" testid="err-combobox" />
</Field>
```

- [ ] **Step 2: Write the failing tests**

In `tests/client/shared/ui/Select.test.ts`, add the fixture import and append inside the
existing `describe`:

```ts
  test('marks the select invalid and describes it when the Field carries an error', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(FieldErrorFixture, { target, props: { error: 'unsupported model provider' } })
    const select = target.querySelector<HTMLSelectElement>('[data-testid="err-select"]')!
    const err = target.querySelector<HTMLElement>('.ui-field__error')!
    expect(select.getAttribute('aria-invalid')).toBe('true')
    expect(select.getAttribute('aria-describedby')).toBe(err.id)
    expect(target.querySelector('.ui-select--invalid')).not.toBeNull()
    void unmount(c)
  })

  test('leaves the select valid when the Field carries no error', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(FieldErrorFixture, { target, props: {} })
    const select = target.querySelector<HTMLSelectElement>('[data-testid="err-select"]')!
    expect(select.getAttribute('aria-invalid')).toBeNull()
    expect(target.querySelector('.ui-select--invalid')).toBeNull()
    void unmount(c)
  })
```

In `tests/client/shared/ui/Combobox.test.ts`, the same pair against `err-combobox` and
`.ui-combobox--invalid`:

```ts
  test('marks the combobox invalid and describes it when the Field carries an error', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(FieldErrorFixture, { target, props: { error: 'too long (max 200 characters)' } })
    const input = target.querySelector<HTMLInputElement>('[data-testid="err-combobox"]')!
    const err = target.querySelector<HTMLElement>('.ui-field__error')!
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toBe(err.id)
    expect(target.querySelector('.ui-combobox--invalid')).not.toBeNull()
    void unmount(c)
  })

  test('leaves the combobox valid when the Field carries no error', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(FieldErrorFixture, { target, props: {} })
    const input = target.querySelector<HTMLInputElement>('[data-testid="err-combobox"]')!
    expect(input.getAttribute('aria-invalid')).toBeNull()
    expect(target.querySelector('.ui-combobox--invalid')).toBeNull()
    void unmount(c)
  })
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/ui/Select.test.ts tests/client/shared/ui/Combobox.test.ts`
Expected: FAIL — neither control sets `aria-invalid`.

- [ ] **Step 4: Add the shared helper**

Append to `client/shared/ui/field-context.ts`, below `getFieldError`:

```ts
/** What a control needs to render the enclosing Field's error state. */
export interface FieldInvalidState {
  readonly invalid: boolean
  readonly describedBy: string | undefined
}

/**
 * Called by Input/Select/Combobox during init. Getters, not a snapshot: each read goes
 * through the context's own `invalid` getter, so a control tracks the Field's live `error`
 * prop without needing a rune here.
 */
export function useFieldInvalid(): FieldInvalidState {
  const ctx = getFieldError()
  return {
    get invalid() {
      return ctx?.invalid ?? false
    },
    get describedBy() {
      return ctx?.invalid === true ? ctx.errorId : undefined
    },
  }
}
```

This has no direct unit test of its own: `getFieldError` calls `getContext`, which only works
during component init, so the helper is exercised through the three components that call it.
That is what the `FieldErrorFixture` tests in Step 2 and the existing `Input` tests cover.

- [ ] **Step 5: Move `Input` onto the helper**

`Input.svelte` currently holds the four lines being generalized. Replace `:38-40` with:

```ts
  const fieldError = useFieldInvalid()
```

and update the import at `:9` to `import { getFieldLabelId, useFieldInvalid } from './field-context.js'`,
then the three markup references — `:51`, `:60-61`, `:76-77`:

```svelte
  class:ui-input--invalid={fieldError.invalid}
```

```svelte
      aria-invalid={fieldError.invalid ? 'true' : undefined}
      aria-describedby={fieldError.describedBy}
```

(the last pair appears twice — once on the `<textarea>`, once on the `<input>`). `Input`'s
existing tests cover this move; they must keep passing untouched.

- [ ] **Step 6: Implement `Select`**

Import `useFieldInvalid` alongside `getFieldLabelId`, and after `const labelId = getFieldLabelId()`:

```ts
  const fieldError = useFieldInvalid()
```

markup:

```svelte
<div class="ui-select" class:ui-select--disabled={disabled} class:ui-select--invalid={fieldError.invalid}>
  <select
    {value}
    {disabled}
    onchange={handleChange}
    aria-labelledby={labelId}
    aria-invalid={fieldError.invalid ? 'true' : undefined}
    aria-describedby={fieldError.describedBy}
    data-testid={testid}>
```

style:

```css
  .ui-select--invalid {
    border-color: var(--danger);
  }
```

- [ ] **Step 7: Implement `Combobox`**

The same three edits against `Combobox.svelte`: import `useFieldInvalid` alongside
`getFieldLabelId`, add `const fieldError = useFieldInvalid()`, put
`class:ui-combobox--invalid={fieldError.invalid}` on the wrapper and
`aria-invalid={fieldError.invalid ? 'true' : undefined}` /
`aria-describedby={fieldError.describedBy}` on the `<input>`, and add:

```css
  .ui-combobox--invalid {
    border-color: var(--danger);
  }
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/ui/`
Expected: PASS, all tests. The whole `ui/` directory is in scope here rather than the two new
files, because Step 5 touched `Input`, and `field-context.test.ts` mounts a bare `Select`
outside any `Field` — the regression check that a control with no field context still renders.

- [ ] **Step 9: Commit**

```bash
git add client/shared/ui/field-context.ts client/shared/ui/Input.svelte client/shared/ui/Select.svelte client/shared/ui/Combobox.svelte tests/client/shared/ui/Select.test.ts tests/client/shared/ui/Combobox.test.ts tests/client/shared/ui/FieldErrorFixture.svelte
git commit -m "feat(ui): give Select and Combobox the invalid state Input already had"
```

---

### Task 5: Migrate existing consumers off hand-rolled error and hint markup

**Files:**

- Modify: `client/settings/components/ConfigFieldRow.svelte:117-199`
- Modify: `client/settings/sections/CodingCredentialsSection.svelte:332-336`, `:391-395`
- Test: `tests/client/settings/components/ConfigFieldRow.test.ts` (existing, must keep passing)

**Interfaces:**

- Consumes: the `error` and `hint` props from Task 3.
- Produces: no new interface. This is a behavior-preserving migration; Task 6 builds on top.

This is the duplication the sub-project exists to remove: `ConfigFieldRow.svelte:133-140` and
`:173-180` are byte-identical blocks.

- [ ] **Step 1: Migrate `ConfigFieldRow`'s input branch**

At `:143`, add the two props to the shell tag:

```svelte
    <SettingsFieldShell
      label={field.label}
      required={field.required}
      editorOpen={editorOpen}
      error={error ?? undefined}
      {hint}
      testid={`cfg-row-${field.key}`}>
```

and delete its whole `{#snippet footer()} … {/snippet}` block (`:173-180`).

- [ ] **Step 2: Migrate `ConfigFieldRow`'s enum branch, error only**

At `:117`, add just the error prop:

```svelte
  <SettingsFieldShell label={field.label} editorOpen={false} error={error ?? undefined} testid={`cfg-row-${field.key}`}>
```

and reduce its footer to the hint alone (`:133-140`):

```svelte
    {#snippet footer()}
      {#if hint}
        <p class="settings-field__hint" id={hintId}>{hint}</p>
      {/if}
    {/snippet}
```

**Keep this branch's hint in the footer, and keep the local `.settings-field__hint` style at
`:195`.** It is not redundant: this branch passes `ariaDescribedBy={hintId}` to
`SegmentedControl` (`:123`), and the shell cannot hand its own generated id back to a parent's
snippet scope — which is exactly why the shell passes `labelId` as a snippet *argument*. Svelte
styles are component-scoped, so the shell's rule does not reach this `<p>` anyway. Resolving
this properly means making `SegmentedControl` read the field context, which is out of scope.

- [ ] **Step 3: Migrate `CodingCredentialsSection`'s hint**

Replace the footer snippet (`:332-336`) by adding a prop to the shell tag at `:283`:

```svelte
              hint={field.control === 'combobox' && !hasSavedKey
                ? 'Save your API key to load model suggestions.'
                : undefined}
```

Delete the `{#snippet footer()} … {/snippet}` block and the now-unused `.field-hint` style
(`:391-395`).

- [ ] **Step 4: Run the affected unit tests**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/components/ConfigFieldRow.test.ts tests/client/settings/components/SettingsFieldShell.test.ts`
Expected: PASS. If a `ConfigFieldRow` test queries `.status-error`, update it to
`.settings-field__error` — the error is now rendered by the shell, not by the row.

- [ ] **Step 5: Re-shoot and read the affected baselines**

```bash
lsof -ti:6006 | xargs kill 2>/dev/null; bun storybook &
# poll until http://localhost:6006 answers
bun shoot -g ConfigFieldRow
bun shoot -g CodingCredentialsSection
```

Read the regenerated PNGs. Expected, per spec acceptance 5:

- `CodingCredentialsSection` — **unchanged**. The shell's hint rule (12px, `--text-muted`,
  `margin: 0`) reproduces the deleted `.field-hint` exactly.
- `ConfigFieldRow` — two intended differences, both from moving the markup into the shell:
  - **hint**: loses a default `<p>` margin (the local rule set colour and size but no margin),
    so vertical spacing tightens. Size and colour unchanged.
  - **error**: the row's `.status-error` sets `color: var(--danger)` and nothing else
    (`client/settings/settings.css:91`), so today it renders at the inherited body size with a
    default `<p>` margin. Under `.settings-field__error` it becomes **12px with `margin: 0`** —
    same danger colour, smaller text, tighter spacing. That is the parity the sub-project is
    for: the error now matches the hint beside it.

  Those two are the only permitted differences. Any change to colour, to field order, or to a
  control's own geometry is a defect — stop and report it rather than accepting the baseline.

- [ ] **Step 6: Commit**

```bash
git add client/settings/components/ConfigFieldRow.svelte client/settings/sections/CodingCredentialsSection.svelte tests/client/settings/components/ConfigFieldRow.test.ts
git commit -m "refactor(settings): move consumers onto the shell's error and hint props"
```

---

### Task 6: Route attributed errors to the offending field in both sections

**Files:**

- Modify: `client/settings/sections/CodeHostSection.svelte:44-135`, `:177`, `:190-196`
- Modify: `client/settings/sections/CodingCredentialsSection.svelte:44-190`, `:259`, `:280-286`

**Interfaces:**

- Consumes: `FetchError.field` (Task 2), the shell's `error` prop (Task 3), invalid state on
  `Select`/`Combobox` (Task 4).
- Produces: no new interface. This is the last behavioral task; Task 7 only adds coverage.

Both sections do the same three things: record the attributed field, resolve it against the
fields actually on screen, and render either inline or in the banner — never both.

The two blocks stay as parallel copies rather than a shared helper. This was decided
deliberately, not overlooked: they differ in their visibility predicate (`shouldShowField` vs
`!fieldHidden`), and `$state`/`$derived` only stay reactive inside a component or a `.svelte.ts`
rune module — a pattern the settings SPA uses nowhere today. A new module for five lines used
twice costs more than it saves. (Contrast Task 4, where the duplication *was* extracted: there
the helper needed no runes, and the copy count was heading for three.)

- [ ] **Step 1: Add the state and the resolution to `CodeHostSection`**

Import `FetchError` from `../../shared/fetcher-helpers.js`. Beside the existing
`let error: string | null = $state(null)`:

```ts
  // The field the server blamed, when it named one. Resolved against the fields actually on
  // screen so an unknown or hidden key falls back to the banner instead of vanishing.
  let errorField: string | null = $state(null)
  const inlineField = $derived(
    fields.some((f) => f.key === errorField && shouldShowField(f)) ? errorField : null,
  )
```

In `load` (`:68`) and `saveAll` (`:123`), set `errorField = null` on the same line group that
sets `error = null`. In both `catch` blocks, beside the existing assignment:

```ts
      errorField = err instanceof FetchError ? (err.field ?? null) : null
```

For `load`'s catch, keep it inside the existing `if (id === contextId)` guard so a stale
response cannot clobber current state.

- [ ] **Step 2: Gate the banner and feed the shell in `CodeHostSection`**

`:177` becomes:

```svelte
  {#if currentData !== null && error !== null && inlineField === null}<p class="status-error" role="alert">{error}</p>{/if}
```

and the shell tag at `:192` gains:

```svelte
            error={inlineField === field.key ? (error ?? undefined) : undefined}
```

- [ ] **Step 3: Apply the same three edits to `CodingCredentialsSection`**

Identical, with one difference: this section has no `shouldShowField`; its visibility predicate
is `!fieldHidden(field)`.

```ts
  let errorField: string | null = $state(null)
  const inlineField = $derived(
    fields.some((f) => f.key === errorField && !fieldHidden(f)) ? errorField : null,
  )
```

Banner at `:259`:

```svelte
  {#if currentData !== null && error !== null && inlineField === null}<p class="status-error" role="alert">{error}</p>{/if}
```

Shell tag at `:280`:

```svelte
              error={inlineField === field.key ? (error ?? undefined) : undefined}
```

Reset `errorField` alongside `error` at `:109` and `:181`, and set it in the catches at `:121`
and `:189`. Leave the third catch (`:208`) and `clearError` alone — clearing is not a
field-level operation.

- [ ] **Step 4: Verify the whole client suite still passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/`
Expected: PASS, no regressions.

- [ ] **Step 5: Typecheck and lint**

Run: `bun run check`
Expected: all checks pass. `err.field ?? null` uses `??`, not optional chaining on a possibly
undefined callee, so it satisfies the lint config.

- [ ] **Step 6: Commit**

```bash
git add client/settings/sections/CodeHostSection.svelte client/settings/sections/CodingCredentialsSection.svelte
git commit -m "feat(settings): render attributed validation errors under their field"
```

---

### Task 7: Fixture and visual coverage for the inline error

**Files:**

- Modify: `client/stories/msw/settings-handlers-coding.ts`
- Modify: `client/stories/msw/scenarios.ts:211-214`
- Modify: `client/settings/sections/CodeHostSection.stories.svelte`
- Modify: `tests/visual/settings/sections/CodeHostSection.spec.ts`
- Test: `tests/client/stories/msw/coding-credentials-namespace.test.ts`

**Interfaces:**

- Consumes: everything from Tasks 1–6.
- Produces: the scenario key `settings-code-host-save-error` and the story id
  `settings-sections-codehostsection--save-validation-error`.

The fixture layer has **no `http.patch` on `/settings/api/coding-credentials` today** — this
adds the first one.

- [ ] **Step 1: Add the failing-save handler family**

In `client/stories/msw/settings-handlers-coding.ts`, after the existing `forgeHandlers` block:

```ts
// Save-validation family: GET serves the populated forge record, PATCH always rejects with the
// route's real 422 for a self-hosted kind and no instance URL
// (src/debug/settings/coding-credentials-routes.ts:113-120).
//
// The PATCH carries `namespace` in its JSON body, not the query string, so the isNamespace
// guard used on every GET here does not apply to it. That is safe because only one handler
// family registers a PATCH per scenario — the absence of a guard is deliberate, not forgotten.
export const forgeSaveErrorHandlers: HttpHandler[] = [
  http.get('/settings/api/coding-credentials', ({ request }) =>
    isNamespace(request, 'forge') ? HttpResponse.json(forgePopulated) : undefined,
  ),
  http.patch('/settings/api/coding-credentials', () =>
    HttpResponse.json(
      {
        error: 'required for self-hosted code hosts, and must start with https://',
        field: 'instance_url',
      },
      { status: 422 },
    ),
  ),
]
```

- [ ] **Step 2: Register the scenario**

In `client/stories/msw/scenarios.ts`, import `forgeSaveErrorHandlers` alongside `forgeHandlers`
and add one key after `:214`:

```ts
  'settings-code-host-save-error': [...forgeSaveErrorHandlers],
```

- [ ] **Step 3: Extend the namespace guard test**

`tests/client/stories/msw/coding-credentials-namespace.test.ts` asserts each family answers
only its own namespace. Add the new family to that coverage — its GET must behave exactly like
the others:

```ts
  test('forgeSaveErrorHandlers answers only the forge namespace on GET', async () => {
    expect(await getResponse(forgeSaveErrorHandlers, request('forge'))).toBeDefined()
    expect(await foreignNamespaces(forgeSaveErrorHandlers, 'forge')).toEqual([])
  })
```

Match the file's existing helper names and import style rather than introducing new ones.

- [ ] **Step 4: Run the guard test**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/stories/msw/coding-credentials-namespace.test.ts`
Expected: PASS, under the default timeout. If it needs a raised `--timeout`, a `loading` family
is being probed on its own namespace — fix the probe, do not raise the timeout.

- [ ] **Step 5: Add the story**

In `client/settings/sections/CodeHostSection.stories.svelte`, after the `Loading` story:

```svelte
<Story
  name="Save validation error"
  args={{ contextId: CONTEXT_ID }}
  parameters={{ fixtures: 'settings-code-host-save-error' }}
/>
```

- [ ] **Step 6: Regenerate the spec's generated block**

Run: `bunx crvy-strybk generate --config ./strybk.config.ts && bun run format`
Then: `git status --porcelain`
Expected: `tests/visual/settings/sections/CodeHostSection.spec.ts` gains a
`'Save validation error'` test inside the `@generated` region. Revert any unrelated file.
Do **not** run `bun run shoot:gen`.

- [ ] **Step 7: Add the interaction state**

Below `// @generated-end auto-screenshots` in
`tests/visual/settings/sections/CodeHostSection.spec.ts`, append:

```ts
test('CodeHostSection — inline error under the offending field', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codehostsection--save-validation-error')
  await sharedPage.getByTestId('coding-select-kind').selectOption('gitlab-self-hosted')
  await sharedPage.getByTestId('code-host-save').click()
  await expect(sharedPage.getByText('required for self-hosted code hosts')).toBeVisible()
  await expect(sharedPage).toHaveScreenshot()
})
```

The `toBeVisible` assertion before the screenshot is what makes the test fail loudly rather
than silently baselining a form with no error on it.

- [ ] **Step 8: Restart Storybook and shoot**

```bash
lsof -ti:6006 | xargs kill 2>/dev/null; bun storybook &
# poll until http://localhost:6006 answers
bun shoot -g CodeHostSection
```

- [ ] **Step 9: Read the new baselines**

Read the PNGs for `Save validation error` and `inline error under the offending field` under
`.storybook-shots/**/CodeHostSection.spec.ts/`. Expected in the interaction shot:

- the message renders **under the Instance URL field**, not in the top banner;
- the Instance URL input has a red border;
- the top banner is absent;
- no snake_case `instance_url` appears anywhere in the rendered text.

- [ ] **Step 10: Confirm no sibling regression**

```bash
bunx playwright test -g CodingCredentialsSection --workers=1
bunx playwright test -g CodingMcpSection --workers=1
```

Plain `playwright test`, **no** `--update-snapshots` — this compares against existing baselines.
Expected: PASS. `--workers=1` is required; these specs are flaky in parallel from `sharedPage`
viewport bleed.

- [ ] **Step 11: Full check**

Run: `bun run check:full`
Expected: all checks pass, except the known pre-existing `ByokSection.spec.ts` story-name drift.

- [ ] **Step 12: Commit**

```bash
git add client/stories/msw/settings-handlers-coding.ts client/stories/msw/scenarios.ts client/settings/sections/CodeHostSection.stories.svelte tests/visual/settings/sections/CodeHostSection.spec.ts tests/client/stories/msw/coding-credentials-namespace.test.ts
git commit -m "test(visual): cover the inline validation error on CodeHostSection"
```

---

## Acceptance

1. `bun run check` passes.
2. A 422 naming a field renders inline under that field, with `aria-invalid` and
   `aria-describedby` on the control and a danger border — verified for a text input (Task 3),
   a select and a combobox (Task 4), and end-to-end in a screenshot (Task 7).
3. A 422 with no `field`, or one naming a hidden or unknown field, still renders in the top
   banner (Task 6 `inlineField` resolution; Task 1 Step 5 pins the unattributed case).
4. No message rendered under a field label repeats that field's column name (Task 1 copy; Task 7
   Step 9 verifies it in the shot).
5. `CodingCredentialsSection` baselines are unchanged; `ConfigFieldRow`'s change only by the
   `<p>` margin normalization and by its error text adopting the 12px hint scale, confirmed by
   reading the shots (Task 5 Step 5).
