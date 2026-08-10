<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Code Host Connection Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `CodeHostSection` answer whether a code host is connected, explain what the access token is for, mark and explain the conditionally-required Instance URL, and stop a stale instance URL surviving a switch to a SaaS kind.

**Architecture:** Everything is client-side rendering inside `CodeHostSection.svelte` plus its story fixtures and visual spec — the server already computes `configured` / `complete` / `missing` / `unreadable` for the forge namespace and the client already parses them. The single server-side edit is two field **label** strings. No server behavior changes.

**Tech Stack:** Svelte 5 runes, TypeScript (strict, `.js` import extensions), Bun test runner, MSW story fixtures, Playwright + `@crvy/strybk` for visual baselines.

**Spec:** [`docs/superpowers/specs/2026-08-01-code-host-connection-clarity-design.md`](../specs/2026-08-01-code-host-connection-clarity-design.md)

## Global Constraints

- Runtime is **Bun**. Import paths inside `src/` and `client/` use the **`.js` extension** even for `.ts` sources.
- **Never** add a lint-disable or type-ignore comment. The write hook blocks them; fix the underlying issue.
- Client tests run with: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' <path>`
- **`bun shoot` is `playwright test --update-snapshots`** — it OVERWRITES baselines. `.storybook-shots/**` is gitignored, so an unintended overwrite has NO recovery path. Every shoot step in this plan is preceded by a `cp -r` backup.
- **Never run `bun run shoot:gen`** — it invokes `license:headers`, which has previously stamped ~37 unrelated files.
- Plain `bunx playwright test` (no `--update-snapshots`) is the ONLY way to detect a pixel change.
- Copy strings are exact and must be used verbatim:
  - First-setup helper: `Coding sessions push branches and open pull requests as you. Create a personal access token that can read and write repository contents and pull requests, then paste it below — it is encrypted and never shown again.`
  - Token placeholder: `token with repo read/write access`
  - Instance URL placeholder: `https://gitlab.example.com`
  - Instance URL hint: `Needed because you chose a self-hosted code host. Your operator must also allow this host for coding sessions.`
  - Empty-fields guard: `No code host fields available — try Refresh.`
  - Pill vocabulary: `connected`, `pending`, `error`, `not connected` (lowercase, exactly these four)
  - Field labels after rename: `Host type` (was `Code host`), `Instance URL` (was `Instance URL (enterprise / self-hosted)`)
- The em dash in the copy above is `—` (U+2014). The middot in the header sub is `·` (U+00B7).
- Header status derives from **saved** response data, never from `drafts`.

---

## File Structure

| File | Responsibility | Tasks |
| --- | --- | --- |
| `src/debug/settings/coding-credentials-fields-meta.ts` | forge field labels | 1 |
| `client/stories/msw/settings-handlers-coding.ts` | forge story fixtures (labels; two new records) | 1, 7 |
| `client/stories/msw/scenarios.ts` | scenario-key registration | 7 |
| `client/settings/sections/CodeHostSection.svelte` | all behavior and copy | 2–6, 8 |
| `client/settings/sections/CodeHostSection.stories.svelte` | new stories | 7 |
| `tests/client/settings/code-host-section.test.ts` | unit coverage | 1–6 |
| `tests/client/stories/msw/settings-handlers-coding.test.ts` | fixture shape mirror | 1, 7 |
| `tests/visual/settings/sections/CodeHostSection.spec.ts` | visual states | 7, 8 |

---

### Task 1: Rename the two forge field labels

**Files:**

- Modify: `src/debug/settings/coding-credentials-fields-meta.ts:66`, `:74`
- Modify: `client/stories/msw/settings-handlers-coding.ts:126`, `:134`
- Test: `tests/client/stories/msw/settings-handlers-coding.test.ts:77` and the `kind` label above it
- Test: `tests/client/settings/code-host-section.test.ts:66`, `:78`, `:101`, `:113`, `:140`, `:149`

**Interfaces:**

- Consumes: nothing.
- Produces: the label strings `Host type` and `Instance URL`, which later tasks' fixtures and assertions use.

`Code host` currently names both the section title and the `kind` field. The section title stays `Code host`; only the field label changes. `Provider` was rejected because the sibling section already has a `Model provider` field.

Verified before writing this task: `tests/debug/settings/coding-credentials-fields-meta.test.ts` asserts only the `mcp` `servers` label (`:31`) and needs **no** change.

- [ ] **Step 1: Rename in the server field meta**

In `src/debug/settings/coding-credentials-fields-meta.ts`, inside the `forge:` array:

```ts
    {
      key: 'kind',
      label: 'Host type',
      required: true,
      sensitive: false,
      control: 'select',
      options: FORGE_KINDS,
    },
    {
      key: 'instance_url',
      label: 'Instance URL',
      required: false,
      sensitive: false,
    },
```

- [ ] **Step 2: Rename in the story fixture**

In `client/stories/msw/settings-handlers-coding.ts`, inside `forgeFields`:

```ts
    credentialField('kind', 'Host type', {
      required: true,
      hasValue,
      // A SaaS kind, so instance_url starts hidden and the reveal interaction is observable.
      value: hasValue ? 'github' : '',
      control: 'select',
      options: FORGE_KIND_OPTIONS,
    }),
    credentialField('instance_url', 'Instance URL'),
```

- [ ] **Step 3: Update the fixture mirror test**

In `tests/client/stories/msw/settings-handlers-coding.test.ts`, in the deep-equality body for the forge populated record, change the two label strings:

```ts
        {
          key: 'kind',
          label: 'Host type',
          required: true,
          sensitive: false,
          hasValue: true,
          value: 'github',
          control: 'select',
          options: ['github', 'github-enterprise', 'gitlab', 'gitlab-self-hosted'],
        },
        {
          key: 'instance_url',
          label: 'Instance URL',
          required: false,
          sensitive: false,
          hasValue: false,
          value: '',
        },
```

- [ ] **Step 4: Update the three inline payloads in the section unit test**

In `tests/client/settings/code-host-section.test.ts`, the constants `typedForgePayloadSaas`, `typedForgePayloadSelfHosted`, and `typedForgeUnconfigured` each carry a `kind` field with `label: 'Code host'` and an `instance_url` field with `label: 'Instance URL (enterprise / self-hosted)'`. Change all six strings to `'Host type'` and `'Instance URL'` respectively. Leave every other property untouched.

- [ ] **Step 5: Confirm no other occurrence remains**

Run: `grep -rn "Instance URL (enterprise" src/ client/ tests/`
Expected: no output.

Run: `grep -rn "'Code host'" src/ client/ tests/`
Expected: no output. (The section *title* `"Code host"` uses double quotes in the Svelte markup and in `.ui-page-header__title` assertions; it must survive.)

- [ ] **Step 6: Run the affected suites**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/code-host-section.test.ts tests/client/stories/msw/settings-handlers-coding.test.ts`
Expected: PASS.

Run: `bun test tests/debug/settings/coding-credentials-fields-meta.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/debug/settings/coding-credentials-fields-meta.ts client/stories/msw/settings-handlers-coding.ts tests/client/stories/msw/settings-handlers-coding.test.ts tests/client/settings/code-host-section.test.ts
git commit -m "refactor(settings): rename forge kind and instance-url labels"
```

---

### Task 2: Header connection status

**Files:**

- Modify: `client/settings/sections/CodeHostSection.svelte` — script block after `:58`, markup `:184-188`
- Test: `tests/client/settings/code-host-section.test.ts`

**Interfaces:**

- Consumes: the label strings from Task 1 (fixtures in the test file already renamed).
- Produces: `FORGE_DISPLAY_NAMES`, `FORGE_SAAS_HOSTS`, `forgeHost(kind, instanceUrl)`, and the derived `statusPill: string | null` / `headerSub: string | undefined`. Task 7's stories exercise these; no later task calls them directly.

The response schema already carries everything needed (`client/settings/fetcher-schemas.ts:82-83` for `complete`/`missing`; `unreadable` is already read at `CodeHostSection.svelte:50`). This task is pure rendering.

**Why saved values, not drafts:** the header reports what is *stored*. Deriving from `drafts` would make the pill and sub flicker as the user edits a form they have not submitted.

**Why the sub is suppressed via the saved `kind` value rather than by inspecting `missing`:** when `kind` is missing its stored value is `''`, so `FORGE_DISPLAY_NAMES['']` is `undefined` and the sub is suppressed. This is the same condition the spec's table states, without depending on the ordering or contents of the `missing` array.

- [ ] **Step 1: Write the failing tests**

Add to `tests/client/settings/code-host-section.test.ts`. First, three new payload constants, placed after `typedForgeUnconfigured`:

```ts
// Configured but incomplete, with a known kind: the header can name the host.
const typedForgeIncomplete = {
  namespace: 'forge',
  configured: true,
  complete: false,
  missing: ['forge_token'],
  fields: [
    {
      key: 'kind',
      label: 'Host type',
      required: true,
      sensitive: false,
      hasValue: true,
      value: 'github',
      control: 'select' as const,
      options: ['github', 'github-enterprise', 'gitlab', 'gitlab-self-hosted'],
    },
    { key: 'instance_url', label: 'Instance URL', required: false, sensitive: false, hasValue: false, value: '' },
    { key: 'forge_token', label: 'Access token', required: true, sensitive: true, hasValue: false, value: '' },
  ],
}

// Configured but the kind itself is missing: there is no host to name, so no sub line.
const typedForgeIncompleteNoKind = {
  ...typedForgeIncomplete,
  missing: ['kind', 'forge_token'],
  fields: [
    { ...typedForgeIncomplete.fields[0]!, hasValue: false, value: '' },
    typedForgeIncomplete.fields[1]!,
    typedForgeIncomplete.fields[2]!,
  ],
}

const typedForgeUnreadable = {
  ...typedForgeIncompleteNoKind,
  unreadable: true,
  error: 'stored credentials are unreadable',
}
```

Then a helper and the tests, appended inside the existing `describe('CodeHostSection', ...)` block:

```ts
  const mountWith = async (payload: unknown): Promise<HTMLElement> => {
    setMockFetch(() => Promise.resolve(json(payload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    mount(CodeHostSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })
    await drain()
    return target
  }

  const pillText = (target: HTMLElement): string | null =>
    target.querySelector('.ui-page-header__action .ui-pill')?.textContent?.trim() ?? null

  const subText = (target: HTMLElement): string | null =>
    target.querySelector('.ui-page-header__sub')?.textContent?.trim() ?? null

  test('renders no status pill while the first load is still in flight', async () => {
    setMockFetch(() => new Promise<Response>(() => {}))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    mount(CodeHostSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })
    await drain()

    expect(pillText(target)).toBeNull()
    expect(subText(target)).toBeNull()
  })

  test('shows "not connected" and no sub when the forge vault is unconfigured', async () => {
    const target = await mountWith(typedForgeUnconfigured)

    expect(pillText(target)).toBe('not connected')
    expect(subText(target)).toBeNull()
  })

  test('shows "pending" and no sub when the stored kind itself is missing', async () => {
    const target = await mountWith(typedForgeIncompleteNoKind)

    expect(pillText(target)).toBe('pending')
    expect(subText(target)).toBeNull()
  })

  test('shows "pending" and names the host when only the token is missing', async () => {
    const target = await mountWith(typedForgeIncomplete)

    expect(pillText(target)).toBe('pending')
    expect(subText(target)).toBe('GitHub · needs an access token')
  })

  test('shows "connected" and the SaaS host when the record is complete', async () => {
    const target = await mountWith(typedForgePayloadSaas)

    expect(pillText(target)).toBe('connected')
    expect(subText(target)).toBe('GitHub · github.com')
  })

  test('shows "connected" and the derived host for a self-hosted instance URL', async () => {
    const target = await mountWith(typedForgePayloadSelfHosted)

    expect(pillText(target)).toBe('connected')
    expect(subText(target)).toBe('GitLab (self-hosted) · gitlab.corp.com')
  })

  test('shows "error" and no sub when the stored record is unreadable', async () => {
    const target = await mountWith(typedForgeUnreadable)

    expect(pillText(target)).toBe('error')
    expect(subText(target)).toBeNull()
  })
```

`typedForgePayloadSelfHosted` stores `https://gitlab.corp.com`, so the derived host is `gitlab.corp.com`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/code-host-section.test.ts`
Expected: FAIL — 6 failures reading `expected "not connected", got null` and similar. The "no pill while loading" test passes already (nothing renders a pill yet); that is expected and is the reason it is not the only new test.

- [ ] **Step 3: Add the import and the two mirror maps**

In `client/settings/sections/CodeHostSection.svelte`, add the import beside the other `shared/ui` imports (alphabetical — after `Select`):

```ts
  import StatusPill from '../../shared/ui/StatusPill.svelte'
```

Then, directly below the existing `needsInstanceUrl` mirror at `:23-26`:

```ts
  // Client-side mirror of FORGE_KINDS in src/coding-credentials/types.ts. Display names only —
  // the wire values remain exactly what the server sends.
  const FORGE_DISPLAY_NAMES: Record<string, string> = {
    github: 'GitHub',
    'github-enterprise': 'GitHub Enterprise',
    gitlab: 'GitLab',
    'gitlab-self-hosted': 'GitLab (self-hosted)',
  }

  // Client-side mirror of the fixed SaaS hosts deriveApiBaseUrl uses
  // (src/coding-credentials/types.ts:74-75). Self-hosted kinds derive from the instance URL.
  const FORGE_SAAS_HOSTS: Record<string, string> = {
    github: 'github.com',
    gitlab: 'gitlab.com',
  }

  function forgeHost(kind: string, instanceUrl: string): string | null {
    const saas = FORGE_SAAS_HOSTS[kind]
    if (saas !== undefined) return saas
    if (instanceUrl === '') return null
    try {
      return new URL(instanceUrl).host
    } catch {
      // A malformed stored value degrades to something readable rather than throwing.
      return instanceUrl
    }
  }
```

- [ ] **Step 4: Add the derived header state**

In the same file, after the existing `showInstanceUrl` derived at `:58`:

```ts
  // Header status reports SAVED state, never drafts — otherwise the pill and sub would
  // flicker as the user edits a form they have not submitted.
  const savedKind = $derived(fields.find((f) => f.key === 'kind')?.value ?? '')
  const savedInstanceUrl = $derived(fields.find((f) => f.key === 'instance_url')?.value ?? '')

  const statusPill = $derived.by((): string | null => {
    if (currentData === null) return null
    if (currentData.unreadable === true) return 'error'
    if (!currentData.configured) return 'not connected'
    return currentData.complete ? 'connected' : 'pending'
  })

  const headerSub = $derived.by((): string | undefined => {
    if (currentData === null || currentData.unreadable === true || !currentData.configured) return undefined
    // An unknown or absent stored kind (the `missing` array contains 'kind') leaves nothing
    // to name, so the sub is omitted rather than rendering a bare separator.
    const name = FORGE_DISPLAY_NAMES[savedKind]
    if (name === undefined) return undefined
    if (!currentData.complete) return `${name} · needs an access token`
    const host = forgeHost(savedKind, savedInstanceUrl)
    return host === null ? name : `${name} · ${host}`
  })
```

- [ ] **Step 5: Render the pill and sub**

Replace the `PageHeader` block at `:184-188`:

```svelte
  <PageHeader eyebrow="Coding sessions" title="Code host" sub={headerSub}>
    {#snippet action()}
      {#if statusPill !== null}<StatusPill status={statusPill} />{/if}
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load(contextId)} testid="code-host-refresh" />
    {/snippet}
  </PageHeader>
```

`.ui-page-header__action` is already `display: flex; gap: 8px` (`PageHeader.svelte:55-59`), so the pill and the refresh button lay out without new CSS.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/code-host-section.test.ts`
Expected: PASS, no regressions in the pre-existing tests.

- [ ] **Step 7: Typecheck and lint**

Run: `bun run check`
Expected: all checks pass.

- [ ] **Step 8: Commit**

```bash
git add client/settings/sections/CodeHostSection.svelte tests/client/settings/code-host-section.test.ts
git commit -m "feat(settings): surface code-host connection state in the header"
```

---

### Task 3: First-setup guidance and the token placeholder

**Files:**

- Modify: `client/settings/sections/CodeHostSection.svelte` — new `placeholderFor` helper; markup after the unreadable banner (`:198-200`); the `Input` placeholder at `:231`
- Test: `tests/client/settings/code-host-section.test.ts`

**Interfaces:**

- Consumes: `typedForgeIncomplete` and `mountWith` from Task 2's test additions.
- Produces: `placeholderFor(field: CodingCredentialField): string`, which Task 4 extends with the `instance_url` case.

The copy names no provider scope strings. This is deliberate: nothing in the repo documents what scopes the forge token needs — `docs/architecture/coding-sessions.md:60` says only that it is a GitHub/GitLab PAT used by `finish_session` and `review_pr`. Capability phrasing is accurate against what the code does with the token and cannot rot as GitHub or GitLab rename a scope.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('CodeHostSection', ...)`:

```ts
  test('shows the first-setup helper when the record is incomplete', async () => {
    const target = await mountWith(typedForgeIncomplete)

    const hint = target.querySelector('[data-testid="code-host-setup-hint"]')
    expect(hint).not.toBeNull()
    expect(hint!.textContent).toContain('push branches and open pull requests as you')
    expect(hint!.textContent).toContain('read and write repository contents and pull requests')
  })

  test('hides the first-setup helper once the record is complete', async () => {
    const target = await mountWith(typedForgePayloadSaas)

    expect(target.querySelector('[data-testid="code-host-setup-hint"]')).toBeNull()
  })

  test('gives the access token a scope-describing placeholder', async () => {
    const target = await mountWith(typedForgeIncomplete)

    const input = target.querySelector<HTMLInputElement>('[data-testid="coding-input-forge_token"]')!
    expect(input.placeholder).toBe('token with repo read/write access')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/code-host-section.test.ts`
Expected: FAIL — 3 failures: two `expected not null, got null` and one `expected "token with repo read/write access", got "enter a new value"`.

- [ ] **Step 3: Add the placeholder helper**

In `client/settings/sections/CodeHostSection.svelte`, beside `editorOpen` (`:109-111`):

```ts
  function placeholderFor(field: CodingCredentialField): string {
    if (field.key === 'forge_token') return 'token with repo read/write access'
    return field.sensitive ? 'enter a new value' : ''
  }
```

- [ ] **Step 4: Use it on the Input**

Replace the `placeholder` attribute at `:231`:

```svelte
                  placeholder={placeholderFor(field)}
```

- [ ] **Step 5: Render the first-setup helper**

In the markup, immediately after the unreadable-banner `{#if}` block (`:198-200`) and before `<div class="settings-byok-fields">`:

```svelte
    {#if !currentData.complete}
      <p class="placeholder" data-testid="code-host-setup-hint">
        Coding sessions push branches and open pull requests as you. Create a personal access token that can read and
        write repository contents and pull requests, then paste it below — it is encrypted and never shown again.
      </p>
    {/if}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/code-host-section.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add client/settings/sections/CodeHostSection.svelte tests/client/settings/code-host-section.test.ts
git commit -m "feat(settings): explain the code-host token on first setup"
```

---

### Task 4: Mark and explain the Instance URL

**Files:**

- Modify: `client/settings/sections/CodeHostSection.svelte` — `placeholderFor`; the `SettingsFieldShell` tag at `:205-210`
- Test: `tests/client/settings/code-host-section.test.ts`

**Interfaces:**

- Consumes: `placeholderFor` (Task 3); `SettingsFieldShell`'s `error` / `hint` props and `.settings-field__req` / `.settings-field__hint` markup, built in sub-project B.
- Produces: no new interface.

The server keeps `required: false` for `instance_url` because the requirement is conditional; the client resolves the condition it already computes for visibility (`showInstanceUrl`, `:58`). This mirrors the sibling's `effectiveRequired` at `CodingCredentialsSection.svelte:299`.

The hint's second sentence exists because self-hosted instance hosts must be operator-allowlisted in magi's fail-closed `MAGI_ALLOWED_REPO_HOSTS` (`docs/architecture/coding-sessions.md:60`). Without it, a valid-looking URL saves cleanly and fails much later as an opaque session error.

`SettingsFieldShell` suppresses `hint` while `error` is set (`SettingsFieldShell.svelte:64-65`). That is the intended precedence and must not be worked around.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('CodeHostSection', ...)`:

```ts
  test('marks Instance URL required and hints it while a self-hosted kind is selected', async () => {
    const target = await mountWith(typedForgePayloadSelfHosted)

    const row = target.querySelector('[data-testid="coding-row-instance_url"]')!
    expect(row.querySelector('.settings-field__req')).not.toBeNull()
    expect(row.querySelector('.settings-field__hint')?.textContent).toContain(
      'Needed because you chose a self-hosted code host.',
    )
    expect(row.querySelector('.settings-field__hint')?.textContent).toContain(
      'Your operator must also allow this host for coding sessions.',
    )
    const input = target.querySelector<HTMLInputElement>('[data-testid="coding-input-instance_url"]')!
    expect(input.placeholder).toBe('https://gitlab.example.com')
  })

  test('drops the Instance URL marker and hint when the kind switches back to SaaS', async () => {
    const target = await mountWith(typedForgePayloadSelfHosted)

    const select = target.querySelector<HTMLSelectElement>('[data-testid="coding-select-kind"]')!
    select.value = 'github'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await drain()

    // The whole row goes away with the field, taking the marker and hint with it.
    expect(target.querySelector('[data-testid="coding-row-instance_url"]')).toBeNull()
  })

  test('reveals a required, hinted Instance URL when a self-hosted kind is chosen', async () => {
    const target = await mountWith(typedForgePayloadSaas)

    expect(target.querySelector('[data-testid="coding-row-instance_url"]')).toBeNull()

    const select = target.querySelector<HTMLSelectElement>('[data-testid="coding-select-kind"]')!
    select.value = 'gitlab-self-hosted'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await drain()

    const row = target.querySelector('[data-testid="coding-row-instance_url"]')!
    expect(row.querySelector('.settings-field__req')).not.toBeNull()
    expect(row.querySelector('.settings-field__hint')?.textContent).toContain('self-hosted code host')
  })
```

The third test is the load-bearing one: it drives the change **through the select** rather than remounting with a different payload, so it pins the reactive path and not just the initial render.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/code-host-section.test.ts`
Expected: FAIL — the first and third fail on the missing `.settings-field__req` / `.settings-field__hint`; the second passes already (the row already unmounts with the field) and is kept as a regression guard.

- [ ] **Step 3: Extend the placeholder helper**

In `client/settings/sections/CodeHostSection.svelte`:

```ts
  function placeholderFor(field: CodingCredentialField): string {
    if (field.key === 'forge_token') return 'token with repo read/write access'
    if (field.key === 'instance_url') return 'https://gitlab.example.com'
    return field.sensitive ? 'enter a new value' : ''
  }
```

- [ ] **Step 4: Mark and hint the field**

Replace the `SettingsFieldShell` opening tag inside the `{#if shouldShowField(field)}` block (`:205-210`):

```svelte
          {@const instanceUrlShown = field.key === 'instance_url' && showInstanceUrl}
          <SettingsFieldShell
            label={field.label}
            required={field.required || instanceUrlShown}
            editorOpen={editorOpen(field)}
            error={inlineField === field.key ? (error ?? undefined) : undefined}
            hint={instanceUrlShown
              ? 'Needed because you chose a self-hosted code host. Your operator must also allow this host for coding sessions.'
              : undefined}
            testid={`coding-row-${field.key}`}>
```

The `{@const}` must be the first child of the `{#if shouldShowField(field)}` block — Svelte only allows `{@const}` as an immediate block child.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/code-host-section.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck and lint**

Run: `bun run check`
Expected: all checks pass.

- [ ] **Step 7: Commit**

```bash
git add client/settings/sections/CodeHostSection.svelte tests/client/settings/code-host-section.test.ts
git commit -m "feat(settings): mark and explain the conditional instance URL"
```

---

### Task 5: Clear a stale instance URL at submit time

**Files:**

- Modify: `client/settings/sections/CodeHostSection.svelte:122-131` (`collectValues`)
- Test: `tests/client/settings/code-host-section.test.ts`

**Interfaces:**

- Consumes: `needsInstanceUrl` (`:24-26`), `currentKind` (`:57`), the `capturedPatchBody` mock plumbing already in the test file (`:177`, `:194-215`).
- Produces: no new interface.

`collectValues` currently `continue`s on hidden fields (`:125`), so a hidden `instance_url` is omitted and the route merges the submitted values over the stored record — leaving the old URL in place. The fix is an explicit assignment **after** the loop, not a change to the skip.

**Guard on field presence.** Only set the key when the response actually declares an `instance_url` field. Without that guard, a legacy token-only payload (no `instance_url` field at all) would gain a key the record never had.

**Honest severity, for the reviewer:** `deriveApiBaseUrl` (`src/coding-credentials/types.ts:73-79`) returns a fixed host for `github` and `gitlab` and never reads `instance_url` for them, so a leftover value is inert for request routing. This is a data-hygiene fix — stored state should match the visible form — not a routing-correctness fix. The accepted trade-off is that switching back to a self-hosted kind after a SaaS save means retyping the URL.

- [ ] **Step 1: Write the failing test**

Append inside `describe('CodeHostSection', ...)`:

```ts
  test('clears a stored instance URL when saving under a SaaS kind', async () => {
    setCsrfToken('csrf-t')
    setMockFetch(routeCodeHostMockSelfHosted)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodeHostSection, {
      target,
      props: { contextId: 'pi:telegram:ctx:u1' },
    })

    await drain()

    // Stored record is gitlab-self-hosted + https://gitlab.corp.com. Switch to a SaaS kind,
    // which hides the instance_url field, and save.
    const select = target.querySelector<HTMLSelectElement>('[data-testid="coding-select-kind"]')!
    select.value = 'github'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="code-host-save"]')!.click()
    await drain()

    // toMatchObject, not a cast: `JSON.parse(...) as {...}` trips no-unsafe-type-assertion.
    // It still proves the point — a listed key that is ABSENT from the payload fails the
    // match, so this distinguishes an explicit '' from an omitted key.
    expect(JSON.parse(capturedPatchBody)).toMatchObject({ values: { kind: 'github', instance_url: '' } })
    void unmount(component)
  })

  test('keeps the instance URL in the payload when the kind still needs it', async () => {
    setCsrfToken('csrf-t')
    setMockFetch(routeCodeHostMockSelfHosted)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodeHostSection, {
      target,
      props: { contextId: 'pi:telegram:ctx:u1' },
    })

    await drain()

    const instance = target.querySelector<HTMLInputElement>('[data-testid="coding-input-instance_url"]')!
    instance.value = 'https://gitlab.corp.com/edited'
    instance.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()

    target.querySelector<HTMLButtonElement>('[data-testid="code-host-save"]')!.click()
    await drain()

    expect(JSON.parse(capturedPatchBody)).toMatchObject({ values: { instance_url: 'https://gitlab.corp.com/edited' } })
    void unmount(component)
  })
```

- [ ] **Step 2: Run the tests to verify the first one fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/code-host-section.test.ts`
Expected: FAIL — `clears a stored instance URL when saving under a SaaS kind` fails with `expected "", got undefined`. The second test passes already and is kept as the guard that the invariant does not over-reach.

- [ ] **Step 3: Add the submit-time invariant**

In `collectValues` (`:122-131`), after the `for` loop and before `return values`:

```ts
    // Submit-time invariant: a SaaS kind must not keep a stored self-hosted instance URL.
    // The loop above skips hidden fields, so an omitted key would leave the stale value in
    // place — the route merges submitted values over the stored record. Send '' explicitly.
    // Guarded on the field existing so a legacy token-only record does not gain a new key.
    if (fields.some((f) => f.key === 'instance_url') && !needsInstanceUrl(currentKind)) {
      values['instance_url'] = ''
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/code-host-section.test.ts`
Expected: PASS. The pre-existing PATCH-body tests at `:307`, `:441`, and `:475` all use `toMatchObject`, so an added `instance_url` key does not break them — confirm they still pass rather than assuming.

- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/CodeHostSection.svelte tests/client/settings/code-host-section.test.ts
git commit -m "fix(settings): clear a stale instance URL when saving a SaaS code host"
```

---

### Task 6: Empty-fields guard and the destructive Clear variant

**Files:**

- Modify: `client/settings/sections/CodeHostSection.svelte` — markup around the fields grid; the Clear `Btn` at `:248`
- Test: `tests/client/settings/code-host-section.test.ts`

**Interfaces:**

- Consumes: the `code-host-setup-hint` block from Task 3 (this task wraps it).
- Produces: no new interface.

Two small findings that belong together because both are one-line markup edits in the same region.

The guard nests the setup hint **inside** the non-empty branch, matching `CodingCredentialsSection.svelte:283-292`. Otherwise a zero-field response would show "create a personal access token" directly above "no fields available", which reads as contradictory.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('CodeHostSection', ...)`:

```ts
  test('shows a recoverable message when the response carries no fields', async () => {
    const target = await mountWith({
      namespace: 'forge',
      configured: false,
      complete: false,
      missing: ['kind', 'forge_token'],
      fields: [],
    })

    const empty = target.querySelector('[data-testid="code-host-no-fields"]')
    expect(empty).not.toBeNull()
    expect(empty!.textContent).toContain('No code host fields available — try Refresh.')
    // The setup helper is suppressed: it would contradict "no fields available".
    expect(target.querySelector('[data-testid="code-host-setup-hint"]')).toBeNull()
    expect(target.querySelector('[data-testid="code-host-save"]')).toBeNull()
  })

  test('renders the Clear trigger with the danger variant', async () => {
    const target = await mountWith(typedForgePayloadSaas)

    const clear = target.querySelector('[data-testid="code-host-clear"]')!
    expect(clear.classList.contains('ui-btn--danger')).toBe(true)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/code-host-section.test.ts`
Expected: FAIL — `expected not null, got null` for the guard, and `expected true, got false` for the variant (the button currently carries `ui-btn--ghost`).

- [ ] **Step 3: Add the empty-fields guard**

Wrap the setup hint and the fields grid. The region from the unreadable banner to the closing `</div>` of `settings-byok-fields` becomes:

```svelte
    {#if unreadableError !== null}
      <p class="status-error" role="alert">Stored credentials are unreadable. Re-enter your token to repair this context.</p>
    {/if}

    {#if fields.length === 0}
      <p class="placeholder" data-testid="code-host-no-fields">No code host fields available — try Refresh.</p>
    {:else}
      {#if !currentData.complete}
        <!-- Keep this on ONE source line. Wrapping it injects a newline plus indentation into
             textContent, which breaks the Task 3 substring assertions. -->
        <p class="placeholder" data-testid="code-host-setup-hint">Coding sessions push branches and open pull requests as you. Create a personal access token that can read and write repository contents and pull requests, then paste it below — it is encrypted and never shown again.</p>
      {/if}

      <div class="settings-byok-fields">
        <!-- unchanged: the {#each fields} loop and the .settings-field__actions row -->
      </div>
    {/if}
```

Keep the `{#each}` loop and the actions row exactly as they are; only their indentation changes by one level.

- [ ] **Step 4: Switch the Clear trigger to danger**

At the Clear `Btn` (`:248` before this task's indentation change):

```svelte
          <Btn
            variant="danger"
            size="sm"
            testid="code-host-clear"
```

The confirmation dialog it opens is already `danger` (`:274`), so this makes the entry point's weight match the action's consequence.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/code-host-section.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the whole client suite**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/`
Expected: PASS, no regressions.

- [ ] **Step 7: Typecheck and lint**

Run: `bun run check`
Expected: all checks pass.

- [ ] **Step 8: Commit**

```bash
git add client/settings/sections/CodeHostSection.svelte tests/client/settings/code-host-section.test.ts
git commit -m "feat(settings): guard empty code-host fields and weight the Clear trigger"
```

---

### Task 7: Story fixtures and visual coverage

**Files:**

- Modify: `client/stories/msw/settings-handlers-coding.ts` (after the `forgeEmpty` record)
- Modify: `client/stories/msw/scenarios.ts:215`
- Modify: `client/settings/sections/CodeHostSection.stories.svelte`
- Modify: `tests/visual/settings/sections/CodeHostSection.spec.ts`
- Test: `tests/client/stories/msw/coding-credentials-namespace.test.ts`

**Interfaces:**

- Consumes: everything from Tasks 1–6.
- Produces: scenario keys `settings-code-host-incomplete` and `settings-code-host-self-hosted`, and story ids `settings-sections-codehostsection--incomplete` and `settings-sections-codehostsection--self-hosted`.

The `unreadable` pill state gets unit coverage only (Task 2). No fixture exists for it, and adding one to shoot a single pill is not worth a new baseline.

- [ ] **Step 1: Add the two fixture records**

In `client/stories/msw/settings-handlers-coding.ts`, after the `forgeEmpty` const:

```ts
// Configured but incomplete: the token is absent, so the header reports `pending` and names
// the host, and the first-setup helper renders.
const forgeIncomplete = {
  namespace: 'forge',
  configured: true,
  complete: false,
  missing: ['forge_token'],
  fields: [
    credentialField('kind', 'Host type', {
      required: true,
      hasValue: true,
      value: 'github',
      control: 'select',
      options: FORGE_KIND_OPTIONS,
    }),
    credentialField('instance_url', 'Instance URL'),
    credentialField('forge_token', 'Access token', { required: true, sensitive: true }),
  ],
}

// A complete self-hosted record, so instance_url is visible with its required marker and hint
// on first paint — no interaction needed to reach that state.
const forgeSelfHosted = {
  namespace: 'forge',
  configured: true,
  complete: true,
  missing: [],
  fields: [
    credentialField('kind', 'Host type', {
      required: true,
      hasValue: true,
      value: 'gitlab-self-hosted',
      control: 'select',
      options: FORGE_KIND_OPTIONS,
    }),
    credentialField('instance_url', 'Instance URL', {
      hasValue: true,
      value: 'https://gitlab.internal.example.com',
    }),
    credentialField('forge_token', 'Access token', {
      required: true,
      sensitive: true,
      hasValue: true,
      value: '****cd34',
    }),
  ],
}

export const forgeIncompleteHandlers: HttpHandler[] = [
  http.get('/settings/api/coding-credentials', ({ request }) =>
    isNamespace(request, 'forge') ? HttpResponse.json(forgeIncomplete) : undefined,
  ),
]

export const forgeSelfHostedHandlers: HttpHandler[] = [
  http.get('/settings/api/coding-credentials', ({ request }) =>
    isNamespace(request, 'forge') ? HttpResponse.json(forgeSelfHosted) : undefined,
  ),
]
```

Every GET carries the `isNamespace` guard that sub-project A established — a family must answer only its own namespace and fall through (`undefined`) otherwise.

- [ ] **Step 2: Register the scenarios**

In `client/stories/msw/scenarios.ts`, extend the existing import from `./settings-handlers-coding.js` with `forgeIncompleteHandlers` and `forgeSelfHostedHandlers`, then add two keys after `:215` (`'settings-code-host-save-error'`):

```ts
  'settings-code-host-incomplete': [...forgeIncompleteHandlers],
  'settings-code-host-self-hosted': [...forgeSelfHostedHandlers],
```

- [ ] **Step 3: Extend the namespace guard test**

`tests/client/stories/msw/coding-credentials-namespace.test.ts` is table-driven — do **not** add standalone `test()` blocks. Add the two handler sets to the existing import from `settings-handlers-coding.js`:

```ts
import {
  codingCredentialsHandlers,
  forgeHandlers,
  forgeIncompleteHandlers,
  forgeSaveErrorHandlers,
  forgeSelfHostedHandlers,
} from '../../../../client/stories/msw/settings-handlers-coding.js'
```

Then append two rows to the `RESPONDING` table, after `{ name: 'forge error', ... }`:

```ts
  { name: 'forge incomplete', handlers: forgeIncompleteHandlers, own: 'forge' },
  { name: 'forge self-hosted', handlers: forgeSelfHostedHandlers, own: 'forge' },
```

`RESPONDING` rows go through `answeredNamespaces`, which probes all three namespaces including their own — correct here, because neither new family delays. Do **not** add them to `LOADING`.

- [ ] **Step 4: Run the guard test**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/stories/msw/coding-credentials-namespace.test.ts`
Expected: PASS under the default timeout. If it needs a raised `--timeout`, a `loading` family is being probed on its own namespace — fix the probe, do not raise the timeout.

- [ ] **Step 5: Add the two stories**

In `client/settings/sections/CodeHostSection.stories.svelte`, after the `Save validation error` story:

```svelte
<Story
  name="Incomplete"
  args={{ contextId: CONTEXT_ID }}
  parameters={{ fixtures: 'settings-code-host-incomplete' }}
/>

<Story
  name="Self hosted"
  args={{ contextId: CONTEXT_ID }}
  parameters={{ fixtures: 'settings-code-host-self-hosted' }}
/>
```

- [ ] **Step 6: Regenerate the generated block**

Run: `bunx crvy-strybk generate --config ./strybk.config.ts && bun run format`
Then: `git status --porcelain`

Expected: `tests/visual/settings/sections/CodeHostSection.spec.ts` gains `'Incomplete'` and `'Self hosted'` tests **inside** the `@generated` region. Revert any unrelated file. Do **not** run `bun run shoot:gen`.

- [ ] **Step 7: Back up the baselines before shooting**

```bash
cp -r .storybook-shots/settings/sections/CodeHostSection.spec.ts /tmp/codehost-baseline-backup
ls /tmp/codehost-baseline-backup
```

Expected: 14 PNG files listed. **This backup is the only recovery path** — `.storybook-shots/**` is gitignored, so an unintended `--update-snapshots` is otherwise unrecoverable.

- [ ] **Step 8: Restart Storybook and shoot**

```bash
lsof -ti:6006 | xargs kill 2>/dev/null; bun storybook &
# poll until http://localhost:6006 answers
bun shoot -g CodeHostSection
```

- [ ] **Step 9: Read the new and changed baselines**

Read these PNGs under `.storybook-shots/settings/sections/CodeHostSection.spec.ts/` with the Read tool:

- `settings-sections-CodeHostSection-Incomplete-1.png` — expect a `pending` pill beside Refresh, the sub line `GitHub · needs an access token`, and the first-setup paragraph above the fields.
- `settings-sections-CodeHostSection-Self-hosted-1.png` — expect a `connected` pill, the sub `GitLab (self-hosted) · gitlab.internal.example.com`, and an Instance URL field carrying a required `*` and the two-sentence hint.
- `settings-sections-CodeHostSection-Populated-1.png` — expect a `connected` pill, sub `GitHub · github.com`, and a red-toned Clear button.
- `settings-sections-CodeHostSection-Empty-1.png` — expect a `not connected` pill, **no** sub line, the first-setup paragraph, and no Clear button.

- [ ] **Step 10: Confirm the expected-movement list exactly**

```bash
git status --porcelain
```

`.storybook-shots/` is gitignored, so compare against the backup instead:

```bash
for f in /tmp/codehost-baseline-backup/*.png; do
  n=$(basename "$f")
  cmp -s "$f" ".storybook-shots/settings/sections/CodeHostSection.spec.ts/$n" && echo "SAME $n" || echo "MOVED $n"
done
```

Expected — exactly two `SAME`, and every other pre-existing baseline `MOVED`:

| Baseline | Expected |
| --- | --- |
| `...-Error-1.png` | **SAME** — `currentData` is null, so no pill, no sub, no fields |
| `...-Loading-1.png` | **SAME** — same reason |
| `...-Populated-1.png` | MOVED — pill, sub, danger Clear |
| `...-Empty-1.png` | MOVED — pill, setup helper |
| `...-Save-validation-error-1.png` | MOVED — pill, sub, danger Clear |
| `...—-populated-narrow-1.png` | MOVED |
| `...—-empty-narrow-1.png` | MOVED |
| `...—-save-hover-disabled-primary-1.png` | MOVED |
| `...—-replace-secret-open-1.png` | MOVED |
| `...—-dirty-form-primary-enabled-1.png` | MOVED |
| `...—-clear-confirm-dialog-1.png` | MOVED |
| `...—-long-value-overflow-1.png` | MOVED — plus the Instance URL marker, hint and placeholder |
| `...—-self-hosted-kind-reveals-Instance-URL-1.png` | MOVED — plus marker and hint |
| `...—-inline-error-under-the-offending-field-1.png` | MOVED |

An `Error` or `Loading` baseline reported as MOVED is a real defect — the header must render nothing while `currentData` is null. Stop and investigate rather than accepting it.

- [ ] **Step 11: Confirm no sibling regression**

```bash
bunx playwright test -g CodingCredentialsSection --workers=1
bunx playwright test -g CodingMcpSection --workers=1
```

Plain `playwright test`, **no** `--update-snapshots` — this compares against existing baselines. Expected: PASS. `--workers=1` is required; these specs are flaky in parallel from `sharedPage` viewport bleed.

- [ ] **Step 12: Full check**

Run: `bun run check:full`
Expected: all checks pass.

- [ ] **Step 13: Commit**

```bash
git add client/stories/msw/settings-handlers-coding.ts client/stories/msw/scenarios.ts client/settings/sections/CodeHostSection.stories.svelte tests/visual/settings/sections/CodeHostSection.spec.ts tests/client/stories/msw/coding-credentials-namespace.test.ts
git commit -m "test(visual): cover code-host connection states"
```

---

### Task 8: Align the actions row

**Files:**

- Modify: `client/settings/sections/CodeHostSection.svelte:291-294` (`.settings-field__actions`)
- Test: `tests/visual/settings/sections/CodeHostSection.spec.ts` (baseline re-shoot only)

**Interfaces:**

- Consumes: the baselines produced by Task 7.
- Produces: no interface.

`.settings-field__actions` declares only `display: flex; justify-content: flex-end`. The space between Clear and Save is therefore collapsed markup whitespace rather than a token, and the row does not share the field cards' content edge.

**The padding value must be measured, not calculated.** The source review recorded the inputs ending at x=1256 and Save at x=1280 — a 24px difference — but the field card's `padding: var(--gap-inline)` (12px, `tokens.css:51`) plus its 1px border accounts for only 13px of that. The remaining 11px cannot be explained from source. Do not assume 13px is correct.

- [ ] **Step 1: Measure the real offset from the Task 7 baseline**

Read `.storybook-shots/settings/sections/CodeHostSection.spec.ts/settings-sections-CodeHostSection-Populated-1.png` and determine, in image pixels, the x-coordinate of the right edge of a field card's input and the x-coordinate of the right edge of the Save button. Record both numbers and their difference; that difference is the padding to apply.

If the two edges already coincide, apply only the `gap` in Step 2 and note the finding — the review's measurement would then not reproduce, which is worth reporting rather than silently working around.

- [ ] **Step 2: Apply the gap and the measured padding**

In `client/settings/sections/CodeHostSection.svelte`, replace the `.settings-field__actions` rule. Substitute the measured value from Step 1 for `<MEASURED>`:

```css
  .settings-field__actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--gap-tight);
    /* Land the row's right edge on the field cards' content edge: the cards inset their
       contents by var(--gap-inline) plus their 1px border. Value confirmed against the
       Populated baseline rather than derived, because the two did not agree. */
    padding-inline: <MEASURED>px;
  }
```

If the measured value equals `13`, write `calc(var(--gap-inline) + 1px)` instead of a magic number, and say so in the comment.

- [ ] **Step 3: Back up the baselines again**

```bash
rm -rf /tmp/codehost-baseline-backup-2
cp -r .storybook-shots/settings/sections/CodeHostSection.spec.ts /tmp/codehost-baseline-backup-2
```

- [ ] **Step 4: Re-shoot and verify the alignment**

```bash
bun shoot -g CodeHostSection
```

Then read `settings-sections-CodeHostSection-Populated-1.png` and confirm the Save button's right edge now sits at the same x-coordinate as the field inputs' right edge, and that Clear and Save are separated by visible space rather than touching.

- [ ] **Step 5: Confirm only the actions-row states moved**

```bash
for f in /tmp/codehost-baseline-backup-2/*.png; do
  n=$(basename "$f")
  cmp -s "$f" ".storybook-shots/settings/sections/CodeHostSection.spec.ts/$n" && echo "SAME $n" || echo "MOVED $n"
done
```

Expected SAME: `Error`, `Loading`. Expected MOVED: every state that renders the actions row — all twelve others, including the two added in Task 7.

- [ ] **Step 6: Confirm no sibling regression**

```bash
bunx playwright test -g CodingCredentialsSection --workers=1
bunx playwright test -g CodingMcpSection --workers=1
```

Expected: PASS. The rule is scoped to this component by Svelte's style scoping, so a sibling failure means the change leaked and must be investigated.

- [ ] **Step 7: Full check**

Run: `bun run check:full`
Expected: all checks pass.

- [ ] **Step 8: Commit**

```bash
git add client/settings/sections/CodeHostSection.svelte
git commit -m "fix(settings): align the code-host actions row with the field content edge"
```

---

## Acceptance

1. `bun run check:full` passes.
2. The header reports connection state across all seven resolutions in the spec's table, including the two that render no sub line (Task 2).
3. A first-time user sees what the connection is for and what the token must be able to do, without any provider-specific scope string being asserted (Task 3).
4. Instance URL carries a required marker, an `https://` placeholder, and a hint naming both the reveal reason and the operator allowlist — appearing and disappearing with the field, verified through the select rather than by remount (Task 4).
5. Saving under a SaaS kind sends `instance_url: ''` explicitly; saving under a self-hosted kind sends the real value (Task 5).
6. A zero-field response renders a recoverable message and suppresses both the setup helper and the Save button; Clear carries the `danger` variant (Task 6).
7. The `Error` and `Loading` baselines are byte-identical before and after; every other baseline's movement is accounted for by the Task 7 and Task 8 tables (Tasks 7, 8).
8. `CodingCredentialsSection` and `CodingMcpSection` baselines pass unchanged under plain `playwright test` (Tasks 7, 8).
