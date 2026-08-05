<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# SP5 — UX open-findings fixes implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all nine remaining open UX findings so `docs/ux-reviews/_BACKLOG.md` reads `0 open finding(s) across 18 section(s)`.

**Architecture:** Layered, shared-first. Four shared components (`ErrorState`, `ConfigFieldRow`, `Btn`, `Pill`) gain small opt-in props in their own tasks; each consumer change lands in a separate task so a shared API and its first use are reviewed independently. The documentation closure runs last and alone, because a `Resolved:` line must cite a commit hash that does not exist until the fix is committed.

**Tech Stack:** Bun, Svelte 5 runes (`$state` / `$derived` / `$effect`), strict TypeScript with `noUncheckedIndexedAccess`, `oxfmt`, Playwright + `@crvy/strybk` for visual baselines, MSW fixtures for Storybook.

**Spec:** `docs/superpowers/specs/2026-08-05-ux-open-findings-fixes-design.md`

## Global Constraints

- Everything stays on branch `ui-ux-review-01`. **No merge into master, no push.** PR #212 is untouched.
- **Never** add a lint-disable or type-ignore comment. **Never** pass `--no-verify`. The pre-commit hook runs lint / typecheck / format:check / license-headers and all four must pass.
- Formatter is `oxfmt`, invoked as `bun run format`. Not prettier.
- Import paths use the `.js` extension even for TypeScript sources.
- Client tests run with **`bun run test:client`**. Never `bun test tests/client/…`: `bunfig.toml:8` lists `tests/client/**` in `pathIgnorePatterns`, so the direct form exits 0 without executing anything. The `test:client` script overrides it with `--path-ignore-patterns ''`.
- **Never run bare `bun shoot`.** It is `playwright test --update-snapshots=all` and rewrites every baseline at once. Only ever `bun shoot -g <Section>`.
- `.storybook-shots/` is **gitignored** (`.gitignore:56`). Baselines are local on-disk state and are never committed — do not `git add` them, and never force-add with `-f`. The audit is the proof that they are correct; git is not.
- `bun run visual:audit` (`VISUAL_AUDIT=1 playwright test`) is the non-mutating check. `playwright.config.ts:34-41` sets `threshold: 0.02` and sets neither `maxDiffPixels` nor `maxDiffPixelRatio`, so both default to 0 — one over-threshold pixel fails.
- The audit floor entering SP5 is **474 passed / 0 failed**. Every task must end at 0 failed.
- `docs/ux-reviews/_BACKLOG.md` is generated. Regenerate with `bun run ux:backlog`; never hand-edit it.
- Backlog status vocabulary, exact strings: `open`, `fixed`, `superseded`, `wont-fix`, `deferred`. Any non-`open` status requires a non-empty `- **Resolved:**` line.

### The visual-baseline loop (every task that touches `client/`)

Run this in order. It is the only sanctioned way to move a baseline:

1. `bun run visual:audit` **first**, after the code change and before any re-shoot. The failure list is the *prediction check*: it enumerates exactly which shots your change moved. Record that list in your report.
2. `bun shoot -g <Section>` to re-shoot only that section. Note that `--update-snapshots=all` rewrites the baseline of **every test the grep matches**, not only the failing ones — so this step touches more files than step 1 predicted, by design.
3. **Read every PNG whose mtime changed** with the Read tool, and confirm each matches the finding's intent. `.storybook-shots/` is gitignored, so `git status` will not name them — list them with:
   `find .storybook-shots -name '*.png' -newermt '-10 minutes'`
   Every file that lists must be looked at, including the ones step 1 did not predict: those are the shots the re-shoot rewrote without needing to, and confirming they are unchanged in content is the only thing standing between a scoped re-shoot and a silent regression.
4. `bun run visual:audit` again — must be 0 failed.

A green audit after a re-shoot is vacuous on its own; it is evidence only in combination with steps 1 and 3. **A shot whose content changes without being predicted is a defect, not a baseline update** — stop and report it.

Storybook must be running for any shoot/audit: `bun storybook` (kept warm).

---

## File Structure

| File | Task | Responsibility |
| --- | --- | --- |
| `client/shared/ui/ErrorState.svelte` | 1 | gains optional `detail` → collapsed `<details>` |
| `client/shared/ui/ErrorState.stories.svelte` | 1 | new "With detail" story |
| `client/settings/sections/ByokSection.svelte` | 2, 8 | consumes `detail`; spacing tokens |
| `client/settings/components/ConfigFieldRow.svelte` | 3 | transient saved acknowledgement |
| `client/shared/ui/Btn.svelte` | 4 | gains optional `ariaDescribedBy` |
| `client/shared/ui/Pill.svelte` | 4 | gains optional `id` |
| `client/settings/sections/GuestModeSection.svelte` | 4 | `aria-describedby` wiring + `role="alert"` |
| `client/settings/sections/KaneoAccessSection.svelte` | 5 | empty-state action; one-way Hide |
| `client/settings/sections/CodingCredentialsSection.svelte` | 6 | `hintFor()` helper for conditional fields |
| `client/stories/msw/settings-handlers-coding.ts` | 6 | `openai-compatible` fixture |
| `client/stories/msw/scenarios.ts` | 6 | scenario registration |
| `client/settings/sections/CodingCredentialsSection.stories.svelte` | 6 | new story |
| `client/settings/sections/MembersSection.svelte` | 7 | empty-table copy |
| `client/settings/components/ProviderForm.svelte` | 8 | spacing tokens |
| `client/settings/components/RoleBindingBlock.svelte` | 8 | spacing tokens |
| `docs/ux-reviews/*.md` | 9 | nine dispositions |
| `docs/ux-reviews/_BACKLOG.md` | 9 | regenerated |

---

### Task 1: `ErrorState` gains an optional `detail` disclosure

**Files:**

- Modify: `client/shared/ui/ErrorState.svelte`
- Modify: `client/shared/ui/ErrorState.stories.svelte`
- Modify: `tests/visual/shared/ui/ErrorState.spec.ts` (regenerated, do not hand-write)
- Test: `tests/client/shared/ui/ErrorState.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `ErrorState` accepts `detail?: string`. When present it renders
  `<details class="ui-error__detail"><summary>Technical details</summary><pre class="ui-error__detail-text">{detail}</pre></details>`,
  closed by default. When absent the rendered output is byte-identical to today's.
  Task 2 is the only consumer.

**Context:** `ErrorState` has 18 consumers. The finding (`byok-load-error-raw-message`) asks that the raw exception string stop being the headline while staying available. `detail` is opt-in, so the other 17 consumers are untouched. There is no `detailLabel` prop — one consumer, one label; add it when a second consumer needs a different word.

- [ ] **Step 1: Write the failing tests**

Append these two tests inside the existing `describe('ErrorState.svelte', …)` block in `tests/client/shared/ui/ErrorState.test.ts`, reusing that file's existing local `render(props)` helper:

```typescript
  test('renders no detail disclosure when detail is absent', () => {
    const { target, component } = render({ message: 'Could not load.' })
    expect(target.querySelector('.ui-error__detail')).toBeNull()
    void unmount(component)
  })

  test('renders detail inside a closed disclosure when detail is passed', () => {
    const { target, component } = render({ message: 'Could not load.', detail: 'TypeError: x is undefined' })
    const details = target.querySelector<HTMLDetailsElement>('.ui-error__detail')
    expect(details).not.toBeNull()
    expect(details!.open).toBe(false)
    expect(details!.textContent).toContain('Technical details')
    expect(details!.textContent).toContain('TypeError: x is undefined')
    void unmount(component)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test:client 2>&1 | tail -20`
Expected: FAIL — `expect(received).not.toBeNull()` on `.ui-error__detail`. (The first test passes already; that is intended — it is the regression guard for the 17 untouched consumers.)

- [ ] **Step 3: Implement the prop**

In `client/shared/ui/ErrorState.svelte`, replace the `interface Props` block and the `$props()` line:

```svelte
  interface Props {
    message: string
    title?: string
    icon?: string
    /** Raw diagnostic text (e.g. an exception message) demoted to a collapsed disclosure. */
    detail?: string
    onRetry?: () => void
    retryLabel?: string
  }

  let { message, title = 'Something went wrong', icon = '⚠', detail, onRetry, retryLabel = 'Try again' }: Props =
    $props()
```

Insert the disclosure immediately after the `.ui-error__message` div and before the `{#if onRetry}` block:

```svelte
  {#if detail}
    <details class="ui-error__detail">
      <summary>Technical details</summary>
      <pre class="ui-error__detail-text">{detail}</pre>
    </details>
  {/if}
```

Append to the `<style>` block:

```css
  .ui-error__detail {
    font-size: 11px;
    color: var(--text-muted);
    max-width: 320px;
    text-align: left;
  }
  .ui-error__detail summary {
    cursor: pointer;
  }
  .ui-error__detail-text {
    margin: var(--gap-tight) 0 0;
    font-family: var(--font-mono);
    white-space: pre-wrap;
    word-break: break-word;
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test:client 2>&1 | tail -20`
Expected: PASS, and no other client test regresses.

- [ ] **Step 5: Add the story**

Append to `client/shared/ui/ErrorState.stories.svelte`:

```svelte
<Story
  name="With detail"
  args={{
    message: 'Could not load BYOK settings for this context.',
    detail: 'TypeError: Failed to fetch',
    onRetry: () => {},
  }}
/>
```

- [ ] **Step 6: Regenerate the visual spec**

Run: `bun run shoot:gen`
Expected: `tests/visual/shared/ui/ErrorState.spec.ts` gains a `test('With detail', …)` inside the `@generated-begin`/`@generated-end` region. Do not edit that region by hand.

- [ ] **Step 7: Run the audit to predict the baseline change**

Run: `bun run visual:audit 2>&1 | tail -20`
Expected: exactly **1 failed** — `shared/ui/ErrorState › With detail`, failing because no baseline snapshot exists yet. The two pre-existing ErrorState shots must still pass: `detail` is absent there, so nothing may move. If either moves, stop — the `{#if detail}` guard is leaking.

- [ ] **Step 8: Shoot and inspect**

Run: `bun shoot -g ErrorState`
Then list the rewritten PNGs with `find .storybook-shots -name '*.png' -newermt '-10 minutes'` and Read every one. Expected: exactly one new file, showing the panel with a closed "Technical details" disclosure below the red message and above "Try again".

- [ ] **Step 9: Re-audit**

Run: `bun run visual:audit 2>&1 | tail -5`
Expected: **475 passed / 0 failed**.

- [ ] **Step 10: Commit**

```bash
git add client/shared/ui/ErrorState.svelte client/shared/ui/ErrorState.stories.svelte \
  tests/visual/shared/ui/ErrorState.spec.ts tests/client/shared/ui/ErrorState.test.ts \
 
git commit -m "feat(ui): let ErrorState demote raw diagnostics to a collapsed detail"
```

---

### Task 2: `ByokSection` shows a written load-error message

**Files:**

- Modify: `client/settings/sections/ByokSection.svelte:246-247`
- Test: `tests/client/settings/byok-section.test.ts`

**Interfaces:**

- Consumes: `ErrorState`'s `detail?: string` prop from Task 1.
- Produces: nothing later tasks depend on.

**Context:** Closes `byok-load-error-raw-message` [Med]. Today a failed initial load renders `<ErrorState message={error} …>` where `error` is the raw exception string. Note the fixture body `boom` is plain text, so `fetcher-helpers.ts`'s `requireOk` discards it and `error` is actually `request failed with status 500` — assert on that, not on `boom`. The `error` variable is **also** used by the inline banner at `:241` for the currentData-present case; that banner is out of scope and must keep showing the raw text. So do not rewrite `error` — pass a written sentence as `message` and the raw string as `detail`.

- [ ] **Step 1: Write the failing test**

Replace the existing test at `tests/client/settings/byok-section.test.ts:297-304` with:

```typescript
  test('a failed initial load renders ErrorState with a retry control', async () => {
    setMockFetch(() => Promise.resolve(new Response('boom', { status: 500 })))
    mountSection()
    await drain()

    expect(target.querySelector('[data-testid="error-retry"]')).not.toBeNull()
    expect(target.querySelector('.ui-error')).not.toBeNull()
  })

  test('the failed-load panel leads with a written sentence and demotes the raw error', async () => {
    setMockFetch(() => Promise.resolve(new Response('boom', { status: 500 })))
    mountSection()
    await drain()

    const message = target.querySelector('.ui-error__message')
    expect(message?.textContent).toBe('Could not load BYOK settings for this context.')
    expect(message?.textContent).not.toContain('boom')
    // The fixture's plain-text 500 body isn't valid JSON, so fetcher-helpers' `requireOk` falls
    // back to its generic "request failed with status ..." message rather than surfacing "boom"
    // verbatim (see client/shared/fetcher-helpers.ts). Assert on that actual raw error text.
    expect(target.querySelector('.ui-error__detail')?.textContent).toContain('request failed with status 500')
  })
```

- [ ] **Step 2: Run the tests to verify the new one fails**

Run: `bun run test:client 2>&1 | tail -20`
Expected: FAIL — the message element still reads the raw `request failed with status 500`.

- [ ] **Step 3: Implement**

In `client/settings/sections/ByokSection.svelte`, add this constant to the `<script>` block, next to the other module-level declarations:

```typescript
  // The load-error panel leads with a sentence a user can act on; the raw exception text stays
  // reachable in ErrorState's disclosure so it is still available for diagnosis.
  const LOAD_ERROR_MESSAGE = 'Could not load BYOK settings for this context.'
```

Then change the `ErrorState` usage at `:246-247` from:

```svelte
    <ErrorState message={error} onRetry={() => void load(contextId)} />
```

to:

```svelte
    <ErrorState message={LOAD_ERROR_MESSAGE} detail={error} onRetry={() => void load(contextId)} />
```

Leave `:241-242` (the inline `status-error` / `status-success` banners) untouched.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test:client 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 5: Audit to predict the baseline change**

Run: `bun run visual:audit 2>&1 | tail -20`
Expected: failures confined to `settings/sections/ByokSection › Error` (and any narrow/manual ByokSection error variant in `tests/visual/settings/sections/ByokSection.spec.ts`). No other section may move — this change is inside one `{:else if}` branch of one component.

- [ ] **Step 6: Shoot and inspect**

Run: `bun shoot -g ByokSection`
Then list the rewritten PNGs with `find .storybook-shots -name '*.png' -newermt '-10 minutes'` and Read every one. Expected: the panel now reads "Something went wrong" / "Could not load BYOK settings for this context." with a closed "Technical details" disclosure where the bare status line used to be.

- [ ] **Step 7: Re-audit**

Run: `bun run visual:audit 2>&1 | tail -5`
Expected: **475 passed / 0 failed**.

- [ ] **Step 8: Commit**

```bash
git add client/settings/sections/ByokSection.svelte tests/client/settings/byok-section.test.ts
git commit -m "fix(settings): give the BYOK load failure a written message"
```

---

### Task 3: `ConfigFieldRow` acknowledges a successful save

**Files:**

- Modify: `client/settings/components/ConfigFieldRow.svelte`
- Test: `tests/client/settings/components/ConfigFieldRow.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: every `ConfigFieldRow` renders `<span class="settings-field__saved" data-testid="cfg-saved-{field.key}" role="status">✓ Saved</span>` for `SAVED_VISIBLE_MS` (2000) after any of `save()`, `clearField()`, `saveEnum()` resolves. No new props.

**Context:** Closes `ai-output-no-save-confirmation`. `ConfigFieldRow` saves in place with no submit-and-navigate step, so a completed write is today indistinguishable from a control that was never touched. The marker goes next to the control (the `head` snippet), which is rendered in both the enum and the input branch — declare it once as a local snippet and `{@render}` it in both, rather than duplicating the markup.

There is deliberately **no** visual baseline for this marker: `toHaveScreenshot()` retries until two consecutive frames match, and a timer-dismissed element either vanishes mid-loop or is captured after dismissal. Unit coverage only.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('ConfigFieldRow', …)` block in `tests/client/settings/components/ConfigFieldRow.test.ts`, using that file's existing `render`, `json` and `drain` helpers:

```typescript
  test('shows a saved acknowledgement after a resolved save, and not before', async () => {
    setCsrfToken('c')
    setMockFetch(() => Promise.resolve(json({ ok: true, contextId: 'user:1' })))
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
      onSaved: () => {},
    })
    flushSync()
    expect(target.querySelector('[data-testid="cfg-saved-timezone"]')).toBeNull()

    const input = target.querySelector<HTMLInputElement>('[data-testid="cfg-input-timezone"]')!
    input.value = 'Europe/Berlin'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="cfg-save-timezone"]')!.click()
    await drain()

    expect(target.querySelector('[data-testid="cfg-saved-timezone"]')?.textContent).toContain('Saved')
    void unmount(component)
  })

  test('does not acknowledge a save that failed', async () => {
    setCsrfToken('c')
    setMockFetch(() => Promise.resolve(json({ error: 'nope' }, 500)))
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
      onSaved: () => {},
    })
    flushSync()
    const input = target.querySelector<HTMLInputElement>('[data-testid="cfg-input-timezone"]')!
    input.value = 'Europe/Berlin'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="cfg-save-timezone"]')!.click()
    await drain()

    expect(target.querySelector('[data-testid="cfg-saved-timezone"]')).toBeNull()
    void unmount(component)
  })

  test('acknowledges an enum save', async () => {
    setCsrfToken('c')
    setMockFetch(() => Promise.resolve(json({ ok: true, contextId: 'user:1' })))
    const { component, target } = render({
      contextId: 'user:1',
      field: {
        key: 'ai_output',
        storageKey: 'ai_output',
        label: 'AI output',
        required: false,
        sensitive: false,
        kind: 'preference',
        hasValue: true,
        value: 'rich',
        control: 'toggle',
        options: [
          { value: 'rich', label: 'Rich' },
          { value: 'raw', label: 'Raw' },
        ],
      },
      onSaved: () => {},
    })
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="cfg-seg-ai_output-raw"]')!.click()
    await drain()

    expect(target.querySelector('[data-testid="cfg-saved-ai_output"]')?.textContent).toContain('Saved')
    void unmount(component)
  })
```

> If `SegmentedControl`'s per-option testid suffix is not `-{option}`, read `client/shared/ui/SegmentedControl.svelte` for the exact `testidPrefix` composition and use that; the assertion on `cfg-saved-ai_output` does not change.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test:client 2>&1 | tail -20`
Expected: FAIL on the first and third tests — `cfg-saved-timezone` / `cfg-saved-ai_output` not found. The second (failure path) passes already; it is the guard.

- [ ] **Step 3: Add the state and the helper**

In `client/settings/components/ConfigFieldRow.svelte`, add after the `hintId` declaration (`:46`):

```typescript
  // How long the save acknowledgement stays on screen. Long enough to notice, short enough
  // that it never reads as persistent state.
  const SAVED_VISIBLE_MS = 2000

  let justSaved = $state(false)
  let savedTimer: ReturnType<typeof setTimeout> | null = null

  // The row writes in place with no submit-and-navigate step, so without an explicit
  // acknowledgement a completed save is indistinguishable from a control never touched.
  function markSaved(): void {
    justSaved = true
    if (savedTimer !== null) clearTimeout(savedTimer)
    savedTimer = setTimeout(() => {
      justSaved = false
      savedTimer = null
    }, SAVED_VISIBLE_MS)
  }

  $effect(() => () => {
    if (savedTimer !== null) clearTimeout(savedTimer)
  })
```

- [ ] **Step 4: Call it from the three success paths**

In `save()` (`:79-91`), after `onSaved()`:

```typescript
      await patchConfig({ key: field.key, value: draft, contextId })
      replacing = false
      onSaved()
      markSaved()
```

In `clearField()` (`:93-105`), after `onSaved()`:

```typescript
      await unsetConfigField({ key: field.key, contextId })
      onSaved()
      markSaved()
```

In `saveEnum()` (`:107-122`), after `onSaved()`:

```typescript
      await patchConfig({ key: field.key, value: next, contextId })
      onSaved()
      markSaved()
```

- [ ] **Step 5: Render the marker in both branches**

Add this snippet at the top of the markup, immediately above the `{#if isEnum}`:

```svelte
{#snippet savedMarker()}
  {#if justSaved}
    <span class="settings-field__saved" role="status" data-testid={`cfg-saved-${field.key}`}>✓ Saved</span>
  {/if}
{/snippet}
```

In the enum branch's `head` snippet, add `{@render savedMarker()}` as the last line, after the `{#if field.hasValue}` Clear block:

```svelte
      {#if field.hasValue}
        <Btn variant="outline" size="sm" disabled={saving} testid={`cfg-clear-${field.key}`} onClick={() => (pendingClear = true)}>
          {#snippet children()}Clear{/snippet}
        </Btn>
      {/if}
      {@render savedMarker()}
```

In the input branch's `head` snippet, likewise as the last line:

```svelte
      {#if field.hasValue}
        <Btn variant="outline" size="sm" disabled={saving} testid={`cfg-clear-${field.key}`} onClick={() => (pendingClear = true)}>
          {#snippet children()}Clear{/snippet}
        </Btn>
      {/if}
      {@render savedMarker()}
```

Append to the `<style>` block:

```css
  .settings-field__saved {
    color: var(--success);
    font-size: 11px;
    white-space: nowrap;
  }
```

> `--success` is defined at `client/shared/tokens.css:36` as `var(--accent)` and every consumer uses it bare — no fallback.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun run test:client 2>&1 | tail -20`
Expected: PASS, including the pre-existing `ConfigFieldRow` and `AiOutputSection` tests.

- [ ] **Step 7: Audit — expect no movement**

Run: `bun run visual:audit 2>&1 | tail -5`
Expected: **475 passed / 0 failed** with no re-shoot. The marker only exists after an interaction that no story performs. If anything fails, `justSaved` is initialising truthy — fix that rather than re-shooting.

- [ ] **Step 8: Commit**

```bash
git add client/settings/components/ConfigFieldRow.svelte tests/client/settings/components/ConfigFieldRow.test.ts
git commit -m "feat(settings): acknowledge a completed config-field save"
```

---

### Task 4: `Btn.ariaDescribedBy` + `Pill.id` + `GuestModeSection` accessibility

**Files:**

- Modify: `client/shared/ui/Btn.svelte`
- Modify: `client/shared/ui/Pill.svelte`
- Modify: `client/settings/sections/GuestModeSection.svelte`
- Test: `tests/client/shared/ui/Btn.test.ts`
- Test: `tests/client/shared/ui/Pill.test.ts`
- Test: `tests/client/settings/sections/GuestModeSection.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `Btn` accepts `ariaDescribedBy?: string` rendered as `aria-describedby`. `Pill` accepts `id?: string` rendered on its existing `<span class="ui-pill">`. Both are attribute-only and visually inert.

**Context:** Closes `guest-mode-toggle-not-exposed-a11y` [Med]. The finding's literal suggested fix is `aria-pressed={enabled}` on the toggle, and that is **wrong here** and is deliberately not implemented: the button's label already swaps between "Enable guest mode" and "Disable guest mode", so `aria-pressed` would announce *"Disable guest mode, pressed"* — the label names the action, the state names its opposite. The intent (expose the on/off value to AT) is met instead by pointing `aria-describedby` at the On/Off `Pill` that already carries the value, plus the help caption. Record that reasoning in the review doc in Task 9 so it is not re-litigated.

`Pill` gets an `id` prop rather than an id-carrying wrapper `<span>`: `Pill` is `display: inline-flex` and sits as a direct flex child of `.ui-page-header__action` (`client/shared/ui/PageHeader.svelte:55-59`), so a wrapper would become the flex item and introduce a line box, risking a height shift on a change that must be invisible.

The third half of the finding is the toggle-mutation error `<p>` at `:87`, which has no `role` unlike the load-error `<p>` at `:96`.

- [ ] **Step 1: Write the failing shared-component tests**

Append inside `describe('Btn.svelte', …)` in `tests/client/shared/ui/Btn.test.ts`:

```typescript
  test('renders aria-describedby when ariaDescribedBy is passed', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Btn, { target, props: { children: textSnippet('x'), ariaDescribedBy: 'a b' } })
    expect(target.querySelector('button')?.getAttribute('aria-describedby')).toBe('a b')
    void unmount(component)
  })

  test('omits aria-describedby when ariaDescribedBy is absent', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Btn, { target, props: { children: textSnippet('x') } })
    expect(target.querySelector('button')?.hasAttribute('aria-describedby')).toBe(false)
    void unmount(component)
  })
```

Append inside `describe('Pill.svelte', …)` in `tests/client/shared/ui/Pill.test.ts`:

```typescript
  test('renders the id on the pill span when id is passed', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Pill, { target, props: { children: textSnippet('On'), id: 'guest-mode-state' } })
    expect(target.querySelector('.ui-pill')?.id).toBe('guest-mode-state')
    void unmount(component)
  })

  test('omits the id attribute when id is absent', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Pill, { target, props: { children: textSnippet('On') } })
    expect(target.querySelector('.ui-pill')?.hasAttribute('id')).toBe(false)
    void unmount(component)
  })
```

- [ ] **Step 2: Write the failing section test**

Append inside `describe('GuestModeSection', …)` in `tests/client/settings/sections/GuestModeSection.test.ts`:

```typescript
  test('the toggle is described by the state pill and the help caption', async () => {
    setMockFetch(() => Promise.resolve(json(enabledPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(GuestModeSection, { target, props: { contextId: 'group:7' } })
    await drain()

    const btn = target.querySelector<HTMLButtonElement>('[data-testid="guest-mode-toggle"]')!
    const ids = (btn.getAttribute('aria-describedby') ?? '').split(' ').filter((id) => id.length > 0)
    expect(ids).toEqual(['guest-mode-state', 'guest-mode-help'])
    for (const id of ids) {
      expect(target.querySelector(`#${id}`)).not.toBeNull()
    }
    expect(target.querySelector('#guest-mode-state')?.textContent).toContain('On')
    void unmount(component)
  })

  test('the toggle-mutation error banner is announced', async () => {
    setMockFetch(patchErrorMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(GuestModeSection, { target, props: { contextId: 'group:7' } })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="guest-mode-toggle"]')!.click()
    await drain()

    const banner = target.querySelector('[data-testid="guest-mode-error"]')
    expect(banner).not.toBeNull()
    expect(banner!.getAttribute('role')).toBe('alert')
    void unmount(component)
  })
```

> `patchErrorMock` already exists at `tests/client/settings/sections/GuestModeSection.test.ts:35`. If the existing mutation-error test uses a different mock, use that one — the assertion is what matters.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun run test:client 2>&1 | tail -25`
Expected: FAIL — `aria-describedby` is null, `Pill` renders no id, banner `role` is null.

- [ ] **Step 4: Add the two shared props**

In `client/shared/ui/Btn.svelte`, add to `interface Props`:

```typescript
    ariaDescribedBy?: string
```

Add `ariaDescribedBy` to the destructured `$props()` list, and add the attribute to the `<button>` next to `aria-label`:

```svelte
  aria-describedby={ariaDescribedBy}
```

In `client/shared/ui/Pill.svelte`, change the props to:

```typescript
  interface Props {
    children: Snippet
    tone?: Tone
    dot?: boolean
    /** Optional id so the pill can be referenced by aria-describedby / aria-labelledby. */
    id?: string
  }

  let { children, tone = 'neutral', dot = false, id }: Props = $props()
```

and render it on the existing span:

```svelte
<span {id} class="ui-pill ui-pill--{tone}">
```

- [ ] **Step 5: Wire up GuestModeSection**

In `client/settings/sections/GuestModeSection.svelte`:

At `:64`, give the pill an id:

```svelte
        <Pill id="guest-mode-state" tone={enabled ? 'warn' : 'mute'} dot={enabled}>{enabled ? 'On' : 'Off'}</Pill>
```

On the toggle `<Btn>` at `:65-81`, add the describedby (keep every other prop as-is):

```svelte
        <Btn
          variant="secondary"
          size="sm"
          busy={mutating}
          disabled={loading || mutating}
          ariaDescribedBy="guest-mode-state guest-mode-help"
          testid="guest-mode-toggle"
          onClick={() => void toggle()}>
```

At `:87`, add `role="alert"` to the mutation-error banner so it matches the load-error banner at `:96`:

```svelte
      <p class="status-error" role="alert" data-testid="guest-mode-error">{formatFetchError(toggleError)}</p>
```

At `:98-100`, give the help caption its id:

```svelte
    <p class="t-help" id="guest-mode-help">
      When on, anyone in this chat can use the bot, read-only. Members and admins are unaffected.
    </p>
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun run test:client 2>&1 | tail -25`
Expected: PASS across `Btn`, `Pill`, `GuestModeSection`, and every other consumer of `Btn`/`Pill`.

- [ ] **Step 7: Audit — expect no movement**

Run: `bun run visual:audit 2>&1 | tail -5`
Expected: **475 passed / 0 failed** with no re-shoot. Every change in this task is an attribute; none affects layout or paint. Any failure means something else moved — investigate, do not re-shoot.

- [ ] **Step 8: Commit**

```bash
git add client/shared/ui/Btn.svelte client/shared/ui/Pill.svelte \
  client/settings/sections/GuestModeSection.svelte \
  tests/client/shared/ui/Btn.test.ts tests/client/shared/ui/Pill.test.ts \
  tests/client/settings/sections/GuestModeSection.test.ts
git commit -m "fix(settings): expose the guest-mode toggle state and error to assistive tech"
```

---

### Task 5: `KaneoAccessSection` — empty-state action and a one-way Hide

**Files:**

- Modify: `client/settings/sections/KaneoAccessSection.svelte`
- Test: `tests/client/settings/sections/KaneoAccessSection.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks. `EmptyState` already supports `action?: Snippet` (`client/shared/ui/EmptyState.svelte:13`, `:23`) — no component change needed.
- Produces: nothing later tasks depend on.

**Context:** Closes two findings.

`kaneo-access-empty-state-dead-end`: the "No Kaneo access yet" `EmptyState` has prose ending in "ask a group admin to add you" and no control. The action is a **"Check again"** button re-running `load(contextId)`, not a link: this is a member's personal view, provisioning happens asynchronously server-side, and there is no members/admin destination reachable from a non-provisioned personal context.

`kaneo-access-password-no-copy-rehide`: after reveal there is no way to clear the secret from screen. **Reveal is destructive server-side** — `src/debug/settings/kaneo-credentials-routes.ts:127` calls `clearStoredPassword` before returning, and a second reveal 409s with "No stored password for this account". So a bare Hide that restores the "Reveal password" button would re-arm a control that cannot work, after the user discarded the only copy of the secret. Hiding is therefore one-way in the UI too: track that a reveal has happened and render a terminal line in place of the reveal button.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('KaneoAccessSection', …)` in `tests/client/settings/sections/KaneoAccessSection.test.ts`:

```typescript
  test('the not-provisioned empty state offers a re-check action', async () => {
    let calls = 0
    setMockFetch(() => {
      calls += 1
      return Promise.resolve(json({ error: 'not found' }, 404))
    })

    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(KaneoAccessSection, { target, props: { contextId: CONTEXT_ID } })
    await drain()

    const recheck = target.querySelector<HTMLButtonElement>('[data-testid="kaneo-empty-recheck"]')
    expect(recheck).not.toBeNull()
    const before = calls
    recheck!.click()
    await drain()
    expect(calls).toBe(before + 1)
    void unmount(component)
  })

  test('Hide clears the revealed password and does not re-arm Reveal', async () => {
    setCsrfToken('c')
    setMockFetch(
      routeCredentialsMock(
        json({ contextId: CONTEXT_ID, login: 'alice@pap.ai', status: 'active', kaneoUrl: 'http://kaneo' }),
        json({ password: 's3cret-pw', warning: 'This password is shown once. Store it securely.' }),
      ),
    )

    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(KaneoAccessSection, { target, props: { contextId: CONTEXT_ID } })
    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="kaneo-reveal"]')!.click()
    await drain()
    expect(target.textContent).toContain('s3cret-pw')

    target.querySelector<HTMLButtonElement>('[data-testid="kaneo-hide"]')!.click()
    await drain()

    expect(target.textContent).not.toContain('s3cret-pw')
    expect(target.querySelector('[data-testid="kaneo-reveal"]')).toBeNull()
    expect(target.querySelector('[data-testid="kaneo-pw-hidden"]')?.textContent).toContain("can't be shown again")
    void unmount(component)
  })
```

> `routeCredentialsMock(getResponse, postResponse)` already exists in this file (declared just below the "not provisioned" test). Reuse it; do not redeclare it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test:client 2>&1 | tail -20`
Expected: FAIL — `kaneo-empty-recheck` and `kaneo-hide` do not exist.

- [ ] **Step 3: Add the reveal-once state**

In `client/settings/sections/KaneoAccessSection.svelte`, add after `let revealing = $state(false)` (`:32`):

```typescript
  // Reveal is destructive server-side (kaneo-credentials-routes.ts:127 clears the stored
  // password before responding), so once it has happened the Reveal button must not come back:
  // a second attempt 409s, and the user would have discarded the only copy to reach it.
  let revealedOnce = $state(false)
```

and set it on success inside `revealPassword()`:

```typescript
      const result = await revealKaneoPassword(contextId)
      revealedPassword = result.password
      revealedOnce = true
```

- [ ] **Step 4: Add the empty-state action**

Replace the `EmptyState` at `:95-97` with:

```svelte
    <EmptyState
      title="No Kaneo access yet"
      hint="Your account isn't provisioned in this group yet. Group members are set up automatically — if this persists, ask a group admin to add you.">
      {#snippet action()}
        <Btn
          variant="secondary"
          size="sm"
          busy={loading}
          testid="kaneo-empty-recheck"
          onClick={() => void load(contextId)}>
          {#snippet children()}Check again{/snippet}
        </Btn>
      {/snippet}
    </EmptyState>
```

- [ ] **Step 5: Add the Hide control and the terminal line**

Replace the block at `:121-141` with:

```svelte
    {#if revealedPassword !== null}
      <div class="kaneo-pw">
        <span class="kaneo-pw__label">Password (shown once)</span>
        <div class="kaneo-pw__row">
          <Code truncate={false}>{revealedPassword}</Code>
          <CopyButton value={revealedPassword} label="Copy password" />
          <Btn variant="ghost" size="sm" testid="kaneo-hide" onClick={() => (revealedPassword = null)}>
            {#snippet children()}Hide{/snippet}
          </Btn>
        </div>
        <p class="placeholder">Store this password securely — hiding it here is permanent, and it won't be shown again.</p>
      </div>
    {:else if revealedOnce}
      <p class="placeholder" data-testid="kaneo-pw-hidden">
        Password hidden. It was shown once and can't be shown again — ask an admin to re-provision your account if you
        no longer have it.
      </p>
    {:else}
      <div class="kaneo-pw__reveal">
        <Btn
          variant="secondary"
          size="sm"
          disabled={revealing}
          testid="kaneo-reveal"
          onClick={() => void revealPassword()}>
          {#snippet children()}{revealing ? 'Revealing…' : 'Reveal password'}{/snippet}
        </Btn>
      </div>
    {/if}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun run test:client 2>&1 | tail -20`
Expected: PASS, including the pre-existing KaneoAccessSection tests.

- [ ] **Step 7: Audit to predict the baseline change**

Run: `bun run visual:audit 2>&1 | tail -20`
Expected: failures confined to `settings/sections/KaneoAccessSection` — the "Not provisioned" shot (now carrying a "Check again" button), any narrow variant of it, **and `Populated — password revealed`**. That last one is not a generated story shot: `tests/visual/settings/sections/KaneoAccessSection.spec.ts:36` is a manual test that clicks Reveal before screenshotting, so it legitimately moves to pick up the new Hide button. When reading it, confirm the only change is the added Hide button beside Copy (plus the updated hint line) and that nothing else shifted.

- [ ] **Step 8: Shoot and inspect**

Run: `bun shoot -g KaneoAccessSection`
Then list the rewritten PNGs with `find .storybook-shots -name '*.png' -newermt '-10 minutes'` and Read every one. Expected: the empty state now ends in a "Check again" button below the hint; nothing else in the section shifts.

- [ ] **Step 9: Re-audit**

Run: `bun run visual:audit 2>&1 | tail -5`
Expected: **475 passed / 0 failed**.

- [ ] **Step 10: Commit**

```bash
git add client/settings/sections/KaneoAccessSection.svelte \
  tests/client/settings/sections/KaneoAccessSection.test.ts
git commit -m "fix(settings): give Kaneo access a re-check action and a one-way password hide"
```

---

### Task 6: `CodingCredentialsSection` explains its conditional fields

**Files:**

- Modify: `client/settings/sections/CodingCredentialsSection.svelte:311-313`
- Modify: `client/stories/msw/settings-handlers-coding.ts`
- Modify: `client/stories/msw/scenarios.ts:217-220`
- Modify: `client/settings/sections/CodingCredentialsSection.stories.svelte`
- Modify: `tests/visual/settings/sections/CodingCredentialsSection.spec.ts` (regenerated)
- Test: `tests/client/settings/coding-credentials-section.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks. `SettingsFieldShell` already renders `hint` with a proper id (`:25`, `:39`, `:73`).
- Produces: nothing later tasks depend on.

**Context:** Closes `coding-credentials-conditional-fields-unexplained`. Two fields appear or change requirement with no explanation: *Auth method* is shown only when `provider === 'anthropic'` (`fieldHidden`, `:90-94` — note the field key is **`auth_method`**, not `provider_auth_method`), and *Base URL* becomes required when `provider === 'openai-compatible'` (`effectiveRequired`, `:305`), signalled today only by an inline placeholder.

The existing `hint` prop is a single inline ternary. Adding two more conditions inline would nest three ternaries in the template — extract a `hintFor(field)` helper next to the existing `labelFor` / `selectOptionsFor` helpers instead.

The story set only exercises `claude`/`anthropic`/`api-key`, so the Base URL hint has no shootable state. This task adds an `openai-compatible` fixture and story.

- [ ] **Step 1: Write the failing tests**

Append inside the top-level `describe` in `tests/client/settings/coding-credentials-section.test.ts`, reusing the file's `json`, `drain` and the existing `withOpenAiCompatiblePayload` / `configuredPayload` fixtures:

```typescript
  test('Auth method carries a hint explaining why it appeared', async () => {
    setMockFetch(() => Promise.resolve(json(configuredPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingCredentialsSection, { target, props: { contextId: 'user:1' } })
    await drain()

    const row = target.querySelector('[data-testid="coding-row-auth_method"]')
    expect(row?.textContent).toContain('Anthropic')
    void unmount(component)
  })

  test('Base URL carries a hint when the provider is openai-compatible', async () => {
    setMockFetch(() => Promise.resolve(json(withOpenAiCompatiblePayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingCredentialsSection, { target, props: { contextId: 'user:1' } })
    await drain()

    const row = target.querySelector('[data-testid="coding-row-provider_base_url"]')
    expect(row?.textContent).toContain('OpenAI-compatible')
    void unmount(component)
  })
```

> Confirm `configuredPayload` has `provider: 'anthropic'` and `withOpenAiCompatiblePayload` has `provider: 'openai-compatible'` before relying on them; adjust which fixture each test uses if not, but keep both assertions.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test:client 2>&1 | tail -20`
Expected: FAIL — neither row contains the hint text.

- [ ] **Step 3: Extract the hint helper**

In `client/settings/sections/CodingCredentialsSection.svelte`, add next to `labelFor` (`:95-98`):

```typescript
  // Fields that appear, vanish, or flip to required as the provider/auth-method changes read as
  // a glitch without a reason attached to the field itself.
  function hintFor(field: CodingCredentialField): string | undefined {
    if (field.control === 'combobox' && !hasSavedKey) return 'Save your API key to load model suggestions.'
    if (field.key === 'auth_method') return 'Shown because the provider is Anthropic — only Anthropic offers an OAuth subscription as an alternative to an API key.'
    if (field.key === 'provider_base_url' && isOpenAiCompatible) {
      return 'Required for OpenAI-compatible providers — the endpoint your requests are sent to.'
    }
    return undefined
  }
```

Replace the inline ternary at `:311-313` with:

```svelte
              hint={hintFor(field)}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test:client 2>&1 | tail -20`
Expected: PASS, including the pre-existing combobox-hint test (the first branch of `hintFor` preserves that behaviour exactly).

- [ ] **Step 5: Add the `openai-compatible` fixture**

In `client/stories/msw/settings-handlers-coding.ts`, add after `codingCredentialsEmpty`:

```typescript
// `openai-compatible` is the only provider that makes Base URL required and hides Auth method.
// Without a fixture for it, that hint has no shootable state.
const codingCredentialsOpenAiCompatible = {
  namespace: 'agent-provider',
  configured: true,
  complete: true,
  missing: [],
  fields: agentProviderFields(true).map((field) =>
    field['key'] === 'provider' ? { ...field, value: 'openai-compatible' } : field,
  ),
  allowedAgents: AGENT_OPTIONS,
}
```

and after the `codingCredentialsHandlers` export:

```typescript
export const codingCredentialsOpenAiCompatibleHandlers: HttpHandler[] = [
  http.get('/settings/api/coding-credentials/models', () => HttpResponse.json(codingModelsPopulated)),
  http.get('/settings/api/coding-credentials', ({ request }) =>
    isNamespace(request, 'agent-provider') ? HttpResponse.json(codingCredentialsOpenAiCompatible) : undefined,
  ),
]
```

- [ ] **Step 6: Register the scenario and the story**

In `client/stories/msw/scenarios.ts`, add `codingCredentialsOpenAiCompatibleHandlers` to the import from `./settings-handlers-coding.js`, and add after line 220:

```typescript
  'settings-coding-credentials-openai-compatible': [...codingCredentialsOpenAiCompatibleHandlers],
```

Append to `client/settings/sections/CodingCredentialsSection.stories.svelte`:

```svelte
<Story
  name="OpenAI-compatible"
  args={{ contextId: CONTEXT_ID }}
  parameters={{ fixtures: 'settings-coding-credentials-openai-compatible' }}
/>
```

- [ ] **Step 7: Regenerate the visual spec**

Run: `bun run shoot:gen`
Expected: `tests/visual/settings/sections/CodingCredentialsSection.spec.ts` gains a `test('OpenAI-compatible', …)` inside the generated region.

- [ ] **Step 8: Audit to predict the baseline changes**

Run: `bun run visual:audit 2>&1 | tail -25`
Expected failures, all within `settings/sections/CodingCredentialsSection`:
- `Populated` and `Empty` (and their narrow/manual variants) — the *Auth method* row gains a hint line, so rows below it shift down.
- `OpenAI-compatible` — no baseline exists yet.
- `Error` and `Loading` must **not** move; they render no fields.

Composed `SettingsApp` shots must not move either — that section is not in them. If they do, stop and report.

- [ ] **Step 9: Shoot and inspect**

Run: `bun shoot -g CodingCredentialsSection`
Then list the rewritten PNGs with `find .storybook-shots -name '*.png' -newermt '-10 minutes'` and Read every one. Confirm: the Auth-method hint reads as a caption under its control, the new OpenAI-compatible shot shows Base URL marked required with its hint and **no** Auth method row, and no text is clipped at the narrow width.

- [ ] **Step 10: Re-audit**

Run: `bun run visual:audit 2>&1 | tail -5`
Expected: **476 passed / 0 failed**.

- [ ] **Step 11: Commit**

```bash
git add client/settings/sections/CodingCredentialsSection.svelte \
  client/settings/sections/CodingCredentialsSection.stories.svelte \
  client/stories/msw/settings-handlers-coding.ts client/stories/msw/scenarios.ts \
  tests/visual/settings/sections/CodingCredentialsSection.spec.ts \
  tests/client/settings/coding-credentials-section.test.ts
git commit -m "fix(settings): explain why the coding-credential conditional fields appear"
```

---

### Task 7: `MembersSection` empty state points at the next step

**Files:**

- Modify: `client/settings/sections/MembersSection.svelte:162`
- Test: `tests/client/settings/sections/MembersSection.test.ts`

**Interfaces:**

- Consumes: nothing. Produces: nothing.

**Context:** Closes `members-empty-state-dead-end`. `{#snippet empty()}No members{/snippet}` inside the `DataTable` is a dead end; the add form sits directly above it, so a one-line pointer converts it to guidance. The finding's own suggested wording is "Add the first member above".

The existing test at `tests/client/settings/sections/MembersSection.test.ts:304,307` asserts `not.toContain('No members')` then `toContain('No members')`, so the new copy **must keep "No members" as a prefix** or that test breaks for the wrong reason.

- [ ] **Step 1: Write the failing test**

Append inside `describe('MembersSection', …)`:

```typescript
  test('the empty table points at the add form above it', async () => {
    setMockFetch(() => Promise.resolve(json({ contextId: 'group:7', members: [] })))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(MembersSection, { target, props: { contextId: 'group:7' } })
    await drain()

    expect(target.textContent).toContain('No members yet — add the first one using the form above.')
    void unmount(component)
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test:client 2>&1 | tail -20`
Expected: FAIL — the table still reads only "No members".

- [ ] **Step 3: Change the copy**

In `client/settings/sections/MembersSection.svelte:162`:

```svelte
      {#snippet empty()}No members yet — add the first one using the form above.{/snippet}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test:client 2>&1 | tail -20`
Expected: PASS, including the pre-existing loading-placeholder test at `:291` (its `toContain('No members')` still matches the new prefix).

- [ ] **Step 5: Audit to predict the baseline change**

Run: `bun run visual:audit 2>&1 | tail -20`
Expected: failures confined to `settings/sections/MembersSection` shots that render the empty table (`Empty`, plus any narrow variant). `Populated` must not move.

- [ ] **Step 6: Shoot and inspect**

Run: `bun shoot -g MembersSection`
Then list the rewritten PNGs with `find .storybook-shots -name '*.png' -newermt '-10 minutes'` and Read every one. Confirm the sentence fits the table body without wrapping oddly or overflowing at the narrow width.

- [ ] **Step 7: Re-audit**

Run: `bun run visual:audit 2>&1 | tail -5`
Expected: **476 passed / 0 failed**.

- [ ] **Step 8: Commit**

```bash
git add client/settings/sections/MembersSection.svelte \
  tests/client/settings/sections/MembersSection.test.ts
git commit -m "fix(settings): turn the empty members table into guidance"
```

---

### Task 8: BYOK spacing literals become tokens

**Files:**

- Modify: `client/settings/sections/ByokSection.svelte` (`<style>` block)
- Modify: `client/settings/components/ProviderForm.svelte:97-101`
- Modify: `client/settings/components/RoleBindingBlock.svelte:95-100`

**Interfaces:**

- Consumes: nothing. Produces: nothing. CSS only — no markup, no props, no tests.

**Context:** Closes `byok-hardcoded-spacing`. The token scale lives in `client/shared/tokens.css:45-76`: `--gap-tight: 8px`, `--s1: 4px`, `--s4: 16px`. The `--s*` scale is labelled legacy; `--gap-*` are the semantic tokens, so prefer `--gap-tight` for 8px and fall back to `--s1`/`--s4` where no semantic token has that value.

**One value changes visually:** `.role-binding { gap: 6px }`. There is no 6px token, and the finding says to add one or round to 8px. Adding a token for a single consumer is worse than rounding, so it becomes `var(--gap-tight)` (8px) — a deliberate 2px increase, and the only pixel movement in this task.

**Exact mapping — apply all of it, change nothing else:**

| File | Declaration | Before | After |
| --- | --- | --- | --- |
| `ByokSection.svelte` | `.provider-create` | `padding: 16px` | `padding: var(--s4)` |
| `ByokSection.svelte` | `.row-actions` | `gap: 4px` | `gap: var(--s1)` |
| `ProviderForm.svelte` | `.provider-form__field` | `gap: 4px` | `gap: var(--s1)` |
| `ProviderForm.svelte` | `.provider-form__actions` | `gap: 8px` | `gap: var(--gap-tight)` |
| `RoleBindingBlock.svelte` | `.role-binding` | `gap: 6px` | `gap: var(--gap-tight)` |
| `RoleBindingBlock.svelte` | `.role-binding` | `padding: 8px 0` | `padding: var(--gap-tight) 0` |
| `RoleBindingBlock.svelte` | `.role-binding__inherit` | `gap: 4px` | `gap: var(--s1)` |
| `RoleBindingBlock.svelte` | `.role-binding__controls` | `gap: 8px` | `gap: var(--gap-tight)` |

- [ ] **Step 1: Verify the token values before substituting**

Run: `grep -n -- '--s1:\|--s4:\|--gap-tight:' client/shared/tokens.css`
Expected: `--gap-tight: 8px;`, `--s1: 4px;`, `--s4: 16px;`. If any differs, stop and report — the mapping above assumes these exact values.

- [ ] **Step 2: Apply the eight substitutions**

Make exactly the eight edits in the table above. Do not touch `.mono`, `.settings-byok__add`, `.settings-byok__roles`, `.settings-byok__roles-head`, `.provider-form`, `.provider-form__label`, `.role-binding__head` or `.role-binding__name`.

- [ ] **Step 3: Confirm no literals remain in those rules**

Run: `grep -n 'gap: [0-9]\|padding: [0-9]' client/settings/sections/ByokSection.svelte client/settings/components/ProviderForm.svelte client/settings/components/RoleBindingBlock.svelte`
Expected: no output.

- [ ] **Step 4: Run the client tests**

Run: `bun run test:client 2>&1 | tail -10`
Expected: PASS. Nothing behavioural changed; this is the guard that no markup was disturbed.

- [ ] **Step 5: Audit to predict the baseline change**

Run: `bun run visual:audit 2>&1 | tail -20`
Expected: failures confined to shots that render `RoleBindingBlock` — the ByokSection states with role overrides (and their narrow variants). Seven of the eight substitutions are value-identical and must move nothing; only the `.role-binding` 6px → 8px gap may. **A moved shot that shows no role bindings is a defect** — it means a substitution was not value-identical. Stop and report.

- [ ] **Step 6: Shoot and inspect**

Run: `bun shoot -g ByokSection`
Then list the rewritten PNGs with `find .storybook-shots -name '*.png' -newermt '-10 minutes'` and Read every one. Confirm the only difference is 2px more breathing room between a role binding's head and its controls, and that nothing overflows or reflows.

- [ ] **Step 7: Re-audit**

Run: `bun run visual:audit 2>&1 | tail -5`
Expected: **476 passed / 0 failed**.

- [ ] **Step 8: Commit**

```bash
git add client/settings/sections/ByokSection.svelte client/settings/components/ProviderForm.svelte \
  client/settings/components/RoleBindingBlock.svelte
git commit -m "style(settings): replace the BYOK spacing literals with scale tokens"
```

---

### Task 9: Documentation closure — nine dispositions, zero open

**Files:**

- Modify: `docs/ux-reviews/ByokSection.md` (2 findings)
- Modify: `docs/ux-reviews/AiOutputSection.md` (1)
- Modify: `docs/ux-reviews/GuestModeSection.md` (1)
- Modify: `docs/ux-reviews/KaneoAccessSection.md` (2)
- Modify: `docs/ux-reviews/CodingCredentialsSection.md` (1)
- Modify: `docs/ux-reviews/MembersSection.md` (1)
- Modify: `docs/ux-reviews/ProfileSection.md` (1 — the `wont-fix`)
- Regenerate: `docs/ux-reviews/_BACKLOG.md`

**Interfaces:**

- Consumes: the eight commit hashes produced by Tasks 1–8.
- Produces: `_BACKLOG.md` reading `0 open finding(s) across 18 section(s)`.

**Context:** This task runs **last and alone** because a `Resolved:` line cites the commit that fixed the finding, and that hash does not exist until the fix is committed. Touch no file under `client/` or `src/` — this task must move zero pixels.

Vocabulary (`scripts/ux-backlog-lib.ts:7`, `:100-102`): any non-`open` status requires a non-empty `- **Resolved:**` line. The parser checks non-emptiness only, never a hash — so per the SP4 convention, `wont-fix` carries a rationale instead of a hash.

- [ ] **Step 1: Collect the eight commit hashes**

Run: `git log --oneline -12`
Map each finding to its task's commit:

| Finding | Document | Task |
| --- | --- | --- |
| `byok-load-error-raw-message` | `ByokSection.md` | 2 |
| `ai-output-no-save-confirmation` | `AiOutputSection.md` | 3 |
| `guest-mode-toggle-not-exposed-a11y` | `GuestModeSection.md` | 4 |
| `kaneo-access-empty-state-dead-end` | `KaneoAccessSection.md` | 5 |
| `kaneo-access-password-no-copy-rehide` | `KaneoAccessSection.md` | 5 |
| `coding-credentials-conditional-fields-unexplained` | `CodingCredentialsSection.md` | 6 |
| `members-empty-state-dead-end` | `MembersSection.md` | 7 |
| `byok-hardcoded-spacing` | `ByokSection.md` | 8 |

Note Task 1 (`ErrorState.detail`) has no finding of its own — it is enabling work for Task 2, and Task 2's hash is what `byok-load-error-raw-message` cites.

- [ ] **Step 2: Close the eight fixed findings**

For each finding above, in its document: change `- **Status:** open` to `- **Status:** fixed` and insert a `- **Resolved:**` line directly beneath it. Use the full 40-char hash from Step 1 in place of `<hash>` and keep the wording below verbatim — these are the sentences a future reader uses to decide whether to reopen.

`ByokSection.md` → `byok-load-error-raw-message`:

```markdown
- **Resolved:** `<hash>` — the failed-load panel now leads with "Could not load BYOK settings for this context." and passes the raw exception string to `ErrorState`'s new optional `detail` prop, which renders it in a closed `<details>` disclosure. The inline banner for the currentData-present path still shows the raw text and was deliberately not changed.
```

`ByokSection.md` → `byok-hardcoded-spacing`:

```markdown
- **Resolved:** `<hash>` — the eight literals across `ByokSection.svelte`, `ProviderForm.svelte` and `RoleBindingBlock.svelte` now use `--s1` / `--s4` / `--gap-tight`. Seven substitutions were value-identical; `.role-binding`'s `gap: 6px` was rounded up to `var(--gap-tight)` (8px) rather than introducing a 6px token for a single consumer.
```

`AiOutputSection.md` → `ai-output-no-save-confirmation`:

```markdown
- **Resolved:** `<hash>` — `ConfigFieldRow` now shows a `✓ Saved` marker beside the control for 2s after `save()`, `clearField()` or `saveEnum()` resolves. Deliberately unit-tested only, with no visual baseline: `toHaveScreenshot()` retries until two consecutive frames match, so a timer-dismissed element cannot produce a stable snapshot.
```

`GuestModeSection.md` → `guest-mode-toggle-not-exposed-a11y`:

```markdown
- **Resolved:** `<hash>` — the toggle now carries `aria-describedby="guest-mode-state guest-mode-help"`, naming the On/Off `Pill` (which gained an optional `id`) and the help caption; the mutation-error banner gained `role="alert"` to match the load-error banner. The suggested `aria-pressed={enabled}` was deliberately **not** implemented: the button's label already swaps between "Enable guest mode" and "Disable guest mode", so `aria-pressed` would announce "Disable guest mode, pressed" — the label naming the action and the state naming its opposite. `Pill` gained an `id` prop rather than an id-carrying wrapper because `Pill` is `display: inline-flex` inside a flex row (`PageHeader.svelte:55-59`), and a wrapper would become the flex item and risk a height shift.
```

`KaneoAccessSection.md` → `kaneo-access-empty-state-dead-end`:

```markdown
- **Resolved:** `<hash>` — the `EmptyState` now passes an `action` snippet with a "Check again" button re-running `load(contextId)`. A link was rejected: this is a non-provisioned member's personal view, provisioning is asynchronous server-side, and the SPA has no members/admin destination reachable from that context.
```

`KaneoAccessSection.md` → `kaneo-access-password-no-copy-rehide`:

```markdown
- **Resolved:** `<hash>` — a "Hide" control beside the copy button clears `revealedPassword`. Hiding is one-way by design: `src/debug/settings/kaneo-credentials-routes.ts:127` clears the stored password before responding, so a second reveal 409s. A bare Hide would have re-armed a Reveal button that cannot work after the user discarded the only copy; the component instead renders a terminal "shown once" line.
```

`CodingCredentialsSection.md` → `coding-credentials-conditional-fields-unexplained`:

```markdown
- **Resolved:** `<hash>` — the inline `hint` ternary became a `hintFor(field)` helper carrying three cases: the pre-existing combobox hint, why *Auth method* appears (provider is Anthropic), and why *Base URL* is required (OpenAI-compatible endpoint). A `settings-coding-credentials-openai-compatible` fixture and story were added so the Base URL hint has a shootable state — the story set previously exercised only `claude`/`anthropic`/`api-key`.
```

`MembersSection.md` → `members-empty-state-dead-end`:

```markdown
- **Resolved:** `<hash>` — the `DataTable` empty snippet now reads "No members yet — add the first one using the form above.", pointing at the add form directly above it.
```

- [ ] **Step 3: Close `profile-sparse-layout-minimal-data` as `wont-fix`**

In `docs/ux-reviews/ProfileSection.md`, change `- **Status:** open` to `- **Status:** wont-fix` and insert beneath it:

```markdown
- **Resolved:** SP5 decision-close, no commit. The suggested fix is a bordered panel/section wrapper around the lone field row. Two facts make that the wrong change: `client/shared/ui/Panel.svelte` has **zero consumers under `client/settings/`**, and `ProfileSection`, `AiOutputSection`, `TaskProviderSection` and `AdminPluginsConfigSection` all render the identical unframed `.settings-field-list`. Framing only this one would buy rubric dimension 7 (responsive/layout) at the cost of dimension 3 (design-system consistency) across four sections, and framing all four is a design-system decision no finding asks for. The sparseness is a consequence of the section genuinely holding one preference, not of its layout.
```

- [ ] **Step 4: Regenerate the backlog**

Run: `bun run ux:backlog`
Then: `head -20 docs/ux-reviews/_BACKLOG.md`
Expected: `0 open finding(s) across 18 section(s).` The section count stays 18 — it is the number of review documents (`sorted.length`), not the number with open findings.

- [ ] **Step 5: Verify the generated end state**

Run: `grep -n -A4 '### High\|### Med\|### Low\|## Deferred' docs/ux-reviews/_BACKLOG.md`
Expected: all three severity buckets read `_None._`, and `## Deferred` contains exactly `repos-no-edit-capability`.

- [ ] **Step 6: Run the backlog tests**

Run: `bun test tests/scripts/ux-backlog.test.ts 2>&1 | tail -10`
Expected: PASS. The "is current" test proves the committed `_BACKLOG.md` matches a fresh regeneration — it fails if the file was hand-edited. The "covers every review document" test still expects 18.

- [ ] **Step 7: Confirm zero client changes**

Run: `git status --porcelain client/ src/`
Expected: no output. If anything appears, this task strayed outside documentation.

- [ ] **Step 8: Final audit**

Run: `bun run visual:audit 2>&1 | tail -5`
Expected: **476 passed / 0 failed**, unchanged from Task 8.

- [ ] **Step 9: Format and commit**

```bash
bun run format
git add docs/ux-reviews
git commit -m "docs(ux-reviews): close the nine remaining open findings

Eight fixed with the commit that fixed them; profile-sparse-layout-minimal-data
closed wont-fix — framing only ProfileSection's field list would trade
design-system consistency across four identical sections for one section's
layout. _BACKLOG.md regenerated: 0 open across 18 sections."
```

---

## Self-Review

**Spec coverage**

| Spec section | Task(s) |
| --- | --- |
| Shared: `ErrorState.detail` | 1 |
| Shared: `Btn.ariaDescribedBy` | 4 |
| Shared: `Pill.id` (spec amendment) | 4 |
| Shared: `ConfigFieldRow` saved signal | 3 |
| `byok-load-error-raw-message` | 2 |
| `guest-mode-toggle-not-exposed-a11y` | 4 |
| `ai-output-no-save-confirmation` | 3 |
| `byok-hardcoded-spacing` | 8 |
| `coding-credentials-conditional-fields-unexplained` | 6 |
| `kaneo-access-empty-state-dead-end` | 5 |
| `kaneo-access-password-no-copy-rehide` (+ reveal-once amendment) | 5 |
| `members-empty-state-dead-end` | 7 |
| `profile-sparse-layout-minimal-data` → `wont-fix` | 9 |
| Audit-first / scoped-reshoot / inspect-every-frame | Global Constraints + every task |
| States not capturable today (`openai-compatible` story; no baseline for the Saved marker) | 6, 3 |
| Documentation closure last and alone | 9 |

No spec requirement is unassigned.

**Type consistency**

`detail?: string` (Task 1) is consumed as `detail={error}` where `error: string | null` — Task 2 reaches that branch only under `error !== null`, so the narrowing holds. `ariaDescribedBy?: string` and `id?: string` (Task 4) are passed string literals. `hintFor(field: CodingCredentialField): string | undefined` (Task 6) matches `SettingsFieldShell`'s `hint?: string`. Testids are consistent across tasks and tests: `cfg-saved-{key}`, `kaneo-empty-recheck`, `kaneo-hide`, `kaneo-pw-hidden`, `guest-mode-state`, `guest-mode-help`.

**Baseline arithmetic**

474 (floor) + 1 (`ErrorState` "With detail", Task 1) + 1 (`CodingCredentialsSection` "OpenAI-compatible", Task 6) = **476** at the end. Tasks 2, 5, 7, 8 move existing baselines without adding any; Tasks 3, 4, 9 move none.
