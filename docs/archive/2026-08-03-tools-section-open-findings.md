<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ToolsSection Open-Findings Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 8 open findings in `docs/ux-reviews/ToolsSection.md`, taking the section from 8 open / 1 fixed to 0 open / 9 fixed and the backlog from 32 open to 24.

**Architecture:** Every code change lands in `client/settings/sections/ToolsSection.svelte`, plus one additive optional prop on the shared `Btn` primitive and one new Storybook fixture. Work proceeds in three batches — C (state & content), B (geometry), A (affordance & hierarchy) — each ending in a single `bun shoot -g ToolsSection` / read-every-PNG / `visual:audit` cycle, so the shared baselines are re-shot three times rather than eight.

**Tech Stack:** Svelte 5 (runes: `$state`, `$props`, `$effect`), TypeScript (strict, `noUncheckedIndexedAccess`), Bun test runner, Storybook (`@storybook/addon-svelte-csf`), Playwright via `@crvy/strybk`, `oxfmt` formatter.

**Spec:** [`docs/superpowers/specs/2026-08-03-tools-section-open-findings-design.md`](../specs/2026-08-03-tools-section-open-findings-design.md)

## Global Constraints

- **Branch:** work stays on `ui-ux-review-01`. Do not merge to `master`. Do not push.
- **Import paths use the `.js` extension**, even for `.ts` sources (`../lib/group-tools.js`).
- **Never add a lint-disable or type-ignore comment.** A hook policy blocks them; fix the underlying issue.
- **Formatter is `oxfmt`**, invoked as `bun run format`. Never prettier.
- **Shell is fish.** Multi-command lines use `; and` or separate invocations, not `&&` chains that assume bash.
- **No preset button is ever filled.** All three render `variant="outline"`. The active one carries an accent border, a `✓` marker, and `aria-pressed="true"`. Fill (`primary`/`danger`) is reserved exclusively for CTAs (`Apply`, `Clear`).
- **Three finding statuses only:** `open`, `fixed`, `superseded`. There is no `partial`. A partially-fixed finding stays `open` with its text narrowed to the residue.
- **A non-`open` status requires a `- **Resolved:**` line citing a real commit hash.** The parser fails loud otherwise. Statuses may only be flipped after the fix commits exist.
- **Visual audit floor rises 460 → 461.** The floor is the audit's *test count*, not the number of tracked baselines — `.storybook-shots/` is git-ignored.
- **Reading the changed PNGs is mandatory, not optional.** Re-shooting makes the audit pass by construction, so a green audit proves nothing on its own. A batch whose shots were not individually read and described is not done.
- **A defect this plan did not anticipate is recorded as a new `open` finding**, never absorbed silently into scope. Landing above zero open is still success; a `0 open` obtained by declaring a residual defect fixed is a failure.

## Deviation from the spec — read before Task 4

The spec's scope boundary says "**No shared-primitive changes**" and lists "Any change to `Btn`" as out of scope. **Task 4 changes `Btn`.** This is deliberate and must be surfaced, not hidden.

The spec requires `aria-pressed="true"` on the active preset button. `Btn.svelte`'s `Props` interface exposes only `children, icon, variant, size, onClick, type, disabled, busy, testid, ariaLabel` — there is no `ariaPressed` prop and no `class` passthrough, so the attribute cannot be set from `ToolsSection`. The spec asserted the scope boundary before this was checked.

Three resolutions were available:

1. **Add an optional `ariaPressed` prop to `Btn`** (chosen). Purely additive; when omitted the attribute is `undefined` and is not rendered, so every existing consumer is byte-identical and **zero visual baselines churn**.
2. Hand-roll the three preset options as raw `<button>` elements styled locally. Honors the spec's literal wording but duplicates the design system inside the component — regressing the very dimension (3. Consistency) this project is scored on.
3. Drop `aria-pressed`. Discards the accessibility half of the `High` finding's fix.

The spec's stated *reason* for the no-shared-primitive rule is baseline churn: "a shared-primitive change would churn visual baselines across all 18 sections." An optional ARIA attribute churns no pixels, so option 1 honors the constraint's purpose while violating its wording. Option 1 is taken on that basis. **If the reviewer or the human disagrees, option 2 is the fallback** — the fix is confined to Task 4 and Task 5 and can be swapped without touching Tasks 1–3.

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `client/settings/sections/ToolsSection.svelte` | Modify | All seven in-component fixes (Tasks 1, 3, 5) |
| `client/shared/ui/Btn.svelte` | Modify | Additive optional `ariaPressed` prop (Task 4) |
| `client/settings/sections/ToolsSection.stories.svelte` | Modify | New `Long domain names` fixture (Task 3) |
| `tests/visual/settings/sections/ToolsSection.spec.ts` | Modify (generated region) | Regenerated to include the new story (Task 3) |
| `tests/client/settings/sections/ToolsSection.test.ts` | Modify | New busy-state and count tests; `:215` updated (Tasks 1, 5) |
| `tests/client/shared/ui/Btn.test.ts` | Modify | `ariaPressed` render tests (Task 4) |
| `docs/ux-reviews/ToolsSection.md` | Modify | Status flips + scorecard re-score (Task 7) |
| `docs/ux-reviews/_BACKLOG.md` | Regenerate | `bun run ux:backlog` output (Task 7) |

---

### Task 1: Batch C — confirm-bar busy state and actionable empty state

Closes `tools-confirm-no-busy-state` (Med) and `tools-empty-state-no-next-step` (Low).

**Files:**
- Modify: `client/settings/sections/ToolsSection.svelte:159-186` (handlers), `:221-251` (confirm bars), `:318` (empty state)
- Test: `tests/client/settings/sections/ToolsSection.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks — this is the first task.
- Produces: two new module-level `$state` flags in `ToolsSection.svelte`, `applying: boolean` and `clearing: boolean`. Later tasks must not rename or remove them. No exported signatures change.

**Background:** `confirmPreset` and `confirmClear` currently clear `pendingPreset` / `pendingClear` *synchronously, before* awaiting the request. That unmounts the confirm bar (`{#if pendingPreset !== null}` at `:221`) on the same tick as the click, so Apply/Clear/Cancel vanish and nothing replaces them until the response resolves. The fix moves the clear to *after* the await and marks the buttons busy in between. End-state behavior is deliberately unchanged: on both success and error the bar unmounts and errors continue to surface in the existing top-of-section `status-error` line. This adds only the missing in-flight frame; it does not redesign error recovery.

- [ ] **Step 1: Write the failing tests**

Add these two imports at the top of `tests/client/settings/sections/ToolsSection.test.ts`, alongside the existing imports:

```ts
import type { ToolsResponse } from '../../../../client/settings/fetcher-schemas-tools.js'
```

Add this helper next to the existing `drain` helper (after the `drain` definition, around line 21):

```ts
type Deferred = { promise: Promise<ToolsResponse>; resolve: (value: ToolsResponse) => void }

const deferred = (): Deferred => {
  let resolve: (value: ToolsResponse) => void = () => {}
  const promise = new Promise<ToolsResponse>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const busyPayload: ToolsResponse = {
  contextId: 'user:1',
  activePreset: 'allow-all',
  hasStoredDefaults: true,
  domains: [
    {
      domain: 'task',
      summary: 'allow',
      tools: [{ name: 'create_task', permission: 'allow', risk: 'write' }],
    },
  ],
}
```

Add these three tests inside the existing top-level `describe` block, after the `'cancelling the confirm does not post'` test:

```ts
test('the preset confirm bar stays mounted and Apply is busy while the request is in flight', async () => {
  const gate = deferred()
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(ToolsSection, {
    target,
    props: {
      contextId: 'user:1',
      fetchToolsFn: () => Promise.resolve(busyPayload),
      applyToolPresetFn: () => gate.promise,
    },
  })
  await drain()
  target.querySelector<HTMLButtonElement>('[data-testid="preset-read-only"]')!.click()
  flushSync()
  target.querySelector<HTMLButtonElement>('[data-testid="preset-confirm-apply"]')!.click()
  flushSync()
  const apply = target.querySelector<HTMLButtonElement>('[data-testid="preset-confirm-apply"]')
  expect(target.querySelector('[data-testid="preset-confirm"]')).not.toBeNull()
  expect(apply).not.toBeNull()
  expect(apply!.getAttribute('aria-busy')).toBe('true')
  expect(apply!.disabled).toBe(true)
  expect(target.querySelector<HTMLButtonElement>('[data-testid="preset-confirm-cancel"]')!.disabled).toBe(true)
  gate.resolve(busyPayload)
  await drain()
  expect(target.querySelector('[data-testid="preset-confirm"]')).toBeNull()
  void unmount(component)
})

test('the clear confirm bar stays mounted and Clear is busy while the request is in flight', async () => {
  const gate = deferred()
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(ToolsSection, {
    target,
    props: {
      contextId: 'user:1',
      fetchToolsFn: () => Promise.resolve(busyPayload),
      clearPresetFn: () => gate.promise,
    },
  })
  await drain()
  target.querySelector<HTMLButtonElement>('[data-testid="tool-defaults-clear"]')!.click()
  flushSync()
  target.querySelector<HTMLButtonElement>('[data-testid="tool-defaults-clear-confirm-apply"]')!.click()
  flushSync()
  const clear = target.querySelector<HTMLButtonElement>('[data-testid="tool-defaults-clear-confirm-apply"]')
  expect(target.querySelector('[data-testid="tool-defaults-clear-confirm"]')).not.toBeNull()
  expect(clear).not.toBeNull()
  expect(clear!.getAttribute('aria-busy')).toBe('true')
  expect(clear!.disabled).toBe(true)
  gate.resolve({ ...busyPayload, hasStoredDefaults: false })
  await drain()
  expect(target.querySelector('[data-testid="tool-defaults-clear-confirm"]')).toBeNull()
  void unmount(component)
})

test('the empty state offers a next step', async () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(ToolsSection, {
    target,
    props: {
      contextId: 'user:1',
      fetchToolsFn: () =>
        Promise.resolve({ contextId: 'user:1', activePreset: null, hasStoredDefaults: false, domains: [] }),
    },
  })
  await drain()
  const action = target.querySelector<HTMLButtonElement>('[data-testid="tools-empty-refresh"]')
  expect(action).not.toBeNull()
  expect(action!.textContent).toContain('Refresh')
  void unmount(component)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/client/settings/sections/ToolsSection.test.ts`

Expected: 3 failures. The two busy tests fail because the confirm bar is already gone by the time `flushSync()` returns (`expect(received).not.toBeNull()` receives `null`). The empty-state test fails because `[data-testid="tools-empty-refresh"]` does not exist.

- [ ] **Step 3: Add the in-flight flags**

In `client/settings/sections/ToolsSection.svelte`, add two declarations after `let pendingClear = $state(false)` (`:73`):

```ts
  let applying = $state(false)
  let clearing = $state(false)
```

Replace `confirmPreset` (`:159-172`) and `confirmClear` (`:174-186`) in full:

```ts
  async function confirmPreset(): Promise<void> {
    const preset = pendingPreset
    if (preset === null || applying) return
    error = null
    applying = true
    try {
      const res = await applyToolPresetFn({ preset, contextId })
      domains = res.domains
      activePreset = res.activePreset
      storedDefaults = res.hasStoredDefaults
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      applying = false
      pendingPreset = null
    }
  }

  async function confirmClear(): Promise<void> {
    if (clearPresetFn === undefined || clearing) return
    error = null
    clearing = true
    try {
      const res = await clearPresetFn()
      domains = res.domains
      activePreset = res.activePreset
      storedDefaults = res.hasStoredDefaults
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      clearing = false
      pendingClear = false
    }
  }
```

Also clear the new flags in `load` (`:96-101`), so a context switch mid-request cannot leave a stuck busy button. Replace the two existing lines:

```ts
    pendingPreset = null
    pendingClear = false
```

with:

```ts
    pendingPreset = null
    pendingClear = false
    applying = false
    clearing = false
```

- [ ] **Step 4: Wire the flags into the confirm bars**

Replace the preset confirm bar (`:221-231`) in full:

```svelte
  {#if pendingPreset !== null}
    <div class="settings-tools__confirm" data-testid="preset-confirm">
      <span>Apply "{presetLabel(pendingPreset)}"? This replaces your per-tool and per-domain settings.</span>
      <Btn
        variant="primary"
        size="sm"
        busy={applying}
        disabled={applying}
        testid="preset-confirm-apply"
        onClick={() => void confirmPreset()}>
        {#snippet children()}{applying ? 'Applying…' : 'Apply'}{/snippet}
      </Btn>
      <Btn
        variant="ghost"
        size="sm"
        disabled={applying}
        testid="preset-confirm-cancel"
        onClick={() => (pendingPreset = null)}>
        {#snippet children()}Cancel{/snippet}
      </Btn>
    </div>
  {/if}
```

Replace the clear confirm bar (`:241-251`) in full:

```svelte
  {#if pendingClear}
    <div class="settings-tools__confirm" data-testid="tool-defaults-clear-confirm">
      <span>Clear all admin default tool permissions? Contexts will revert to the allow-all baseline.</span>
      <Btn
        variant="danger"
        size="sm"
        busy={clearing}
        disabled={clearing}
        testid="tool-defaults-clear-confirm-apply"
        onClick={() => void confirmClear()}>
        {#snippet children()}{clearing ? 'Clearing…' : 'Clear'}{/snippet}
      </Btn>
      <Btn
        variant="ghost"
        size="sm"
        disabled={clearing}
        testid="tool-defaults-clear-confirm-cancel"
        onClick={() => (pendingClear = false)}>
        {#snippet children()}Cancel{/snippet}
      </Btn>
    </div>
  {/if}
```

- [ ] **Step 5: Give the empty state an action**

`EmptyState` already accepts an `action` snippet (`client/shared/ui/EmptyState.svelte:13,23`) — no change to the primitive. Replace `:318`:

```svelte
    <EmptyState title="No togglable tools" hint="No tools are available for this context yet. Tools appear here once a task provider or plugin is configured.">
      {#snippet action()}
        <Btn variant="outline" size="sm" testid="tools-empty-refresh" onClick={() => void load(contextId)}>
          {#snippet children()}Refresh{/snippet}
        </Btn>
      {/snippet}
    </EmptyState>
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test tests/client/settings/sections/ToolsSection.test.ts`

Expected: PASS, 16 tests (the 13 existing plus 3 new). If any of the original 13 now fail, stop and report — this task must not change existing behavior.

- [ ] **Step 7: Re-shoot and read every changed baseline**

```bash
bun shoot -g ToolsSection
```

Then use the Read tool on **every** PNG under `.storybook-shots/settings/sections/ToolsSection.spec.ts/` whose bytes changed, and write one sentence per shot describing what actually changed versus what the two findings predicted. Expected changes: the `Empty` shot gains a "Refresh" button and longer hint copy. The other shots should be unchanged — if a shot you did not expect to change did change, that is a finding, not a rounding error; investigate before continuing.

**This step is not optional.** Re-shooting makes the audit pass by construction; the read is the only thing that proves the UI improved.

- [ ] **Step 8: Verify the audit**

Run: `bun run visual:audit -g ToolsSection`
Expected: 8 passed, 0 failed.

- [ ] **Step 9: Format and commit**

```bash
bun run format
git add client/settings/sections/ToolsSection.svelte tests/client/settings/sections/ToolsSection.test.ts
git commit -m "fix(settings): keep the Tools confirm bar mounted while in flight and give the empty state a next step"
```

---

### Task 2: Batch B, part 1 — spacing tokens and the expand-toggle click target

Closes `tools-spacing-off-scale` (Low) and `tools-domain-expand-small-target` (Low).

**Files:**
- Modify: `client/settings/sections/ToolsSection.svelte:322-418` (`<style>` block only)

**Interfaces:**
- Consumes: nothing. This task touches only CSS.
- Produces: nothing consumed by later tasks. Task 5 adds a new class to the same `<style>` block and must not disturb these values.

**Background:** The hardcoded 6/10/14px values map onto no token. The scale is `--s1: 4px`, `--s2: 8px`, `--s3: 12px`, `--s4: 16px`, `--gap-tight: 8px` (`client/shared/tokens.css:52,68-71`). Round 6→8 (`--s2`), 10→12 (`--s3`), 14→16 (`--s4`). Separately, `.settings-tools__expand` is a raw `<button>` with no height or padding, while every sibling in its row sits on `--control-h-sm: 24px` (`client/shared/tokens.css:63`) — below the WCAG 2.5.8 target-size floor.

- [ ] **Step 1: Apply the token rounding and the target-size floor**

There is no unit test for CSS values; the visual baselines are the test. Replace these five rules in `client/settings/sections/ToolsSection.svelte`'s `<style>` block.

`.settings-tools__domain-head` (`:331-336`):

```css
  .settings-tools__domain-head {
    display: flex;
    align-items: center;
    gap: var(--s3);
    padding: var(--s2) var(--s3);
  }
```

`.settings-tools__expand` (`:337-344`) — gains the control-height floor and horizontal padding so the hit area matches the row's other controls:

```css
  .settings-tools__expand {
    display: inline-flex;
    align-items: center;
    gap: var(--s1);
    min-height: var(--control-h-sm);
    padding: 0 var(--s1);
    background: none;
    border: none;
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 12px;
    cursor: pointer;
  }
```

`.settings-tools__list` (`:345-351`):

```css
  .settings-tools__list {
    list-style: none;
    margin: 0;
    padding: 0 var(--s3) var(--s3);
    display: grid;
    gap: var(--s2);
  }
```

`.settings-tools__tool` (`:352-356`):

```css
  .settings-tools__tool {
    display: flex;
    align-items: center;
    gap: var(--s3);
  }
```

`.settings-tools__group-head` (`:364-370`):

```css
  .settings-tools__group-head {
    display: flex;
    align-items: center;
    gap: var(--s3);
    padding-top: var(--s2);
    border-top: 1px solid var(--border);
  }
```

`.settings-tools__tool--grouped` (`:379-381`):

```css
  .settings-tools__tool--grouped {
    padding-left: var(--s4);
  }
```

`.settings-tools__presets` (`:383-389`) — the `margin-bottom: 6px` is the last off-scale value:

```css
  .settings-tools__presets {
    display: flex;
    align-items: center;
    gap: var(--s2);
    flex-wrap: wrap;
    margin-bottom: var(--s2);
  }
```

`.settings-tools__confirm` (`:403-413`):

```css
  .settings-tools__confirm {
    display: flex;
    align-items: center;
    gap: var(--s2);
    flex-wrap: wrap;
    padding: var(--s2) var(--s3);
    margin-bottom: var(--s3);
    border: 1px solid var(--border);
    background: var(--surface-1);
    font-size: 12px;
  }
```

Leave `.settings-tools { gap: 8px }` (`:323-326`), `.settings-tools__presets-hint { margin: 0 0 12px }` (`:398-402`), `.settings-tools__clear-row { margin-bottom: 12px }` (`:414-417`) and `.ui-empty`'s own spacing alone — 8px and 12px are already on-scale values; converting them to `var(--s2)` / `var(--s3)` is a readability improvement, not a fix, and does not belong in a finding-closing commit. If you convert them anyway, say so in your report so the reviewer can judge it.

- [ ] **Step 2: Confirm the unit tests still pass**

Run: `bun test tests/client/settings/sections/ToolsSection.test.ts`
Expected: PASS, 16 tests. CSS changes should not affect them; a failure here means something structural was edited by mistake.

- [ ] **Step 3: Re-shoot and read every changed baseline**

```bash
bun shoot -g ToolsSection
```

Read **every** changed PNG under `.storybook-shots/settings/sections/ToolsSection.spec.ts/`. Expect every shot to shift slightly: rows grow ~2-4px taller and wider, the expand caret gains breathing room, and the `▸`/`▾` glyph now sits on the same 24px baseline as the Pill and toggle beside it.

**Read the ~640px narrow shot (`Tools — grouped, expanded, narrow`) specifically for new clipping or overflow.** Growing every gap from 10px to 12px and every indent from 14px to 16px is exactly the change that pushes a narrow row past its container. If it clips, that is a real regression from this task — fix it here, do not defer it.

- [ ] **Step 4: Verify the audit**

Run: `bun run visual:audit -g ToolsSection`
Expected: 8 passed, 0 failed.

- [ ] **Step 5: Format and commit**

```bash
bun run format
git add client/settings/sections/ToolsSection.svelte
git commit -m "style(settings): round ToolsSection spacing onto the scale and raise the expand target to 24px"
```

---

### Task 3: Batch B, part 2 — domain-head wrapping, proven by a long-name fixture

Closes `tools-domain-head-no-wrap` (Low).

**Files:**
- Modify: `client/settings/sections/ToolsSection.svelte` (`.settings-tools__domain-head` rule)
- Modify: `client/settings/sections/ToolsSection.stories.svelte`
- Modify: `tests/visual/settings/sections/ToolsSection.spec.ts` (generated region, via `bun shoot:gen`)

**Interfaces:**
- Consumes: `.settings-tools__domain-head` as rewritten in Task 2 — start from that version, not the original.
- Produces: a new Storybook story `Long domain names`, story id `settings-sections-toolssection--long-domain-names`. Task 6's audit count depends on it existing.

**Background:** `.settings-tools__domain-head` has no `flex-wrap`, unlike `.settings-tools__presets` which does. The existing narrow shot only passes because every fixture domain name is short (`plugin`, `acp`, `mcp`, `time`). Adding `flex-wrap: wrap` without a fixture that exercises it would be an unverified claim, so the fixture is part of the fix, not a nice-to-have.

- [ ] **Step 1: Add the long-domain fixture story**

In `client/settings/sections/ToolsSection.stories.svelte`, add this fixture inside the `<script module>` block, after the `grouped` constant and before `const fetchGrouped`:

```ts
  const longDomainNames: ToolsResponse = {
    contextId: CONTEXT_ID,
    activePreset: null,
    hasStoredDefaults: false,
    domains: [
      {
        domain: 'plugin_enterprise_document_management_connector',
        summary: 'partial',
        tools: [
          {
            name: 'plugin_enterprise_document_management_connector__search_documents',
            permission: 'ask',
            risk: 'open-world',
            group: 'enterprise-document-management',
          },
          {
            name: 'plugin_enterprise_document_management_connector__archive_document',
            permission: 'deny',
            risk: 'destructive',
            group: 'enterprise-document-management',
          },
        ],
      },
      {
        domain: 'mcp_internal_knowledge_base_search_service',
        summary: 'ask',
        tools: [
          {
            name: 'mcp_internal_knowledge_base_search_service__query',
            permission: 'ask',
            risk: 'open-world',
          },
        ],
      },
    ],
  }
  const fetchLongDomainNames = (): Promise<ToolsResponse> => Promise.resolve(longDomainNames)
```

Add the story at the end of the file, after the `Error` story:

```svelte
<Story name="Long domain names" args={{ contextId: CONTEXT_ID, fetchToolsFn: fetchLongDomainNames }} />
```

- [ ] **Step 2: Add `flex-wrap` to the domain head**

In `client/settings/sections/ToolsSection.svelte`, replace `.settings-tools__domain-head` (as written in Task 2) with:

```css
  .settings-tools__domain-head {
    display: flex;
    align-items: center;
    gap: var(--s3);
    padding: var(--s2) var(--s3);
    flex-wrap: wrap;
  }
```

Note the row's third child uses `margin-left: auto` (`.settings-tools__domain-toggle`, `:361-363`). That still behaves correctly when the row wraps: on a wrapped line the `auto` margin pushes the toggle to the right of its own line rather than the row's. Confirm this in the screenshot rather than assuming it.

- [ ] **Step 3: Regenerate the visual spec**

```bash
bun shoot:gen
```

Expected: `tests/visual/settings/sections/ToolsSection.spec.ts` gains a seventh block inside the `@generated-begin auto-screenshots` region:

```ts
  test('Long domain names', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-toolssection--long-domain-names')
    await expect(sharedPage).toHaveScreenshot()
  })
```

The two manual tests below `@generated-end auto-screenshots` must be untouched. If the generator rewrote or dropped them, stop and report — do not hand-restore them silently.

- [ ] **Step 4: Add a narrow-viewport case that actually forces the wrap**

The generated case shoots at the default desktop width, where a long name may still fit on one line. Append this to the manual region of `tests/visual/settings/sections/ToolsSection.spec.ts`, after the existing `'Tools — populated, expanded, per-tool segmented control'` test:

```ts
test('Tools — long domain names, narrow', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-toolssection--long-domain-names')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})
```

This takes the spec from 8 cases to 10, so the **audit floor becomes 462, not 461**. The spec projected 461 on the assumption of a single new case; a desktop-only shot cannot demonstrate wrapping, which is the whole point of the finding. Record the corrected floor in your report.

- [ ] **Step 5: Shoot and read the new baselines**

```bash
bun shoot -g ToolsSection
```

Read the two new PNGs (`Long domain names` and `Tools — long domain names, narrow`) plus any pre-existing shot whose bytes changed. In the narrow shot, confirm the long domain name wraps onto its own line rather than overflowing the card or squashing the Pill. **If the name still overflows** — because `flex-wrap` wraps between flex items but does not break inside a single unbreakable token — that is a residue: this finding stays `open` in Task 7, narrowed to "long single-token domain names still overflow; the row wraps between items but the name itself does not break." Do not add `overflow-wrap` to chase it in this task; record it and let the human decide.

- [ ] **Step 6: Verify the audit**

Run: `bun run visual:audit -g ToolsSection`
Expected: 10 passed, 0 failed.

- [ ] **Step 7: Format and commit**

```bash
bun run format
git add client/settings/sections/ToolsSection.svelte client/settings/sections/ToolsSection.stories.svelte tests/visual/settings/sections/ToolsSection.spec.ts
git commit -m "fix(settings): wrap the ToolsSection domain head and prove it with a long-name fixture"
```

---

### Task 4: Add an optional `ariaPressed` prop to `Btn`

Enabling change for Task 5. Closes no finding on its own.

**Read the "Deviation from the spec" section above before starting.** This task changes a shared primitive the spec listed as out of scope; the justification and the fallback are recorded there.

**Files:**
- Modify: `client/shared/ui/Btn.svelte:11-33` (props), `:41-52` (button element)
- Test: `tests/client/shared/ui/Btn.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Btn` accepts `ariaPressed?: boolean`. When `undefined` (the default), no `aria-pressed` attribute is rendered and every existing consumer is unchanged. Task 5 passes it as `ariaPressed={active}`.

- [ ] **Step 1: Write the failing tests**

Add these three tests to `tests/client/shared/ui/Btn.test.ts`, inside the existing `describe('Btn.svelte', …)` block. They follow the file's local style: `createRawSnippet` via the existing `textSnippet` helper, plain `mount`/`unmount`, no `flushSync`.

```ts
  test('omits aria-pressed when ariaPressed is not passed', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Btn, { target, props: { children: textSnippet('x') } })
    expect(target.querySelector<HTMLButtonElement>('.ui-btn')!.hasAttribute('aria-pressed')).toBe(false)
    void unmount(component)
  })

  test('renders aria-pressed="true" when ariaPressed is true', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Btn, { target, props: { children: textSnippet('x'), ariaPressed: true } })
    expect(target.querySelector<HTMLButtonElement>('.ui-btn')!.getAttribute('aria-pressed')).toBe('true')
    void unmount(component)
  })

  test('renders aria-pressed="false" when ariaPressed is false', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Btn, { target, props: { children: textSnippet('x'), ariaPressed: false } })
    expect(target.querySelector<HTMLButtonElement>('.ui-btn')!.getAttribute('aria-pressed')).toBe('false')
    void unmount(component)
  })
```

The first test is the one that matters most: it is what guarantees this change is invisible to the other 17 sections.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/client/shared/ui/Btn.test.ts`

Expected: the two positive tests FAIL (`getAttribute('aria-pressed')` returns `null`). TypeScript will also reject `ariaPressed` as an unknown prop — that is the same failure, surfaced earlier.

The `omits aria-pressed` test PASSES already. That is correct and intentional: it is a characterization test pinning behavior that must survive the change, not a red-first test.

- [ ] **Step 3: Add the prop**

In `client/shared/ui/Btn.svelte`, add one line to the `Props` interface, after `ariaLabel?: string`:

```ts
    ariaLabel?: string
    ariaPressed?: boolean
```

Add it to the destructuring, after `ariaLabel,`:

```ts
    ariaLabel,
    ariaPressed,
  }: Props = $props()
```

Add the attribute to the `<button>` element, after `aria-label={ariaLabel}`:

```svelte
  aria-label={ariaLabel}
  aria-pressed={ariaPressed}
```

Svelte omits an attribute whose value is `undefined`, so the default path renders exactly the markup it renders today.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/client/shared/ui/Btn.test.ts`
Expected: PASS, all tests including the three new ones.

- [ ] **Step 5: Verify no other consumer changed**

Run: `bun run typecheck`
Expected: clean. An optional prop cannot break a caller, but this catches a typo in the interface.

Do **not** re-shoot baselines for this task. The change renders no pixels; if a baseline did change, something is wrong and you should report it rather than accept the new shot.

- [ ] **Step 6: Format and commit**

```bash
bun run format
git add client/shared/ui/Btn.svelte tests/client/shared/ui/Btn.test.ts
git commit -m "feat(ui): add an optional ariaPressed prop to Btn"
```

---

### Task 5: Batch A — preset row redesign, real row-action affordance, per-group counts

Closes `tools-preset-active-state-invisible` (**High**), `tools-bulk-actions-look-like-text` (Med) and `tools-no-per-group-count` (Med).

**Files:**
- Modify: `client/settings/sections/ToolsSection.svelte:204-218` (preset row), `:258-273` (domain head), `:281-293` (group head), `<style>` block
- Test: `tests/client/settings/sections/ToolsSection.test.ts:215` (updated) plus new tests

**Interfaces:**
- Consumes: `Btn`'s `ariaPressed` prop from Task 4; the `--s*` spacing tokens applied in Task 2; `groupToolEntries` / `groupSummary` from `client/settings/lib/group-tools.ts:11-35`.
- Produces: nothing consumed by later tasks. Task 7 cites this task's commit hash.

**Background — the design decision.** The `High` finding and scorecard dimension 3 describe one root cause: the `primary` filled style means both "this is currently selected" and "click this to submit". The preset row and the confirm bar use identical green fills, so a selected preset reads as a call to action. **No preset button is ever filled.** All three render `outline`; the active one gets an accent border, a `✓`, and `aria-pressed="true"`. The current-state indicator moves out of its `margin-left: auto` far-edge position and becomes part of the label: `Preset: Custom`.

**`SegmentedControl` was considered and rejected**, on two grounds recorded in the spec: (1) it cannot represent `activePreset === null` ("Custom"), which is the common case whenever the user has per-tool overrides; (2) it sets `aria-checked` on click (`SegmentedControl.svelte:35`), which would announce a preset as selected before the user confirmed it — an accessibility regression, given that applying a preset goes through a confirm bar. Do not "improve" this task by switching to `SegmentedControl`.

`aria-pressed` on independent toggle buttons is a different control pattern from the `radiogroup` used for per-tool permissions in the same component. **That inconsistency is intentional**, because the confirm bar makes a preset click a request rather than a state change.

- [ ] **Step 1: Write the failing tests**

In `tests/client/settings/sections/ToolsSection.test.ts`, **replace** the existing test at `:215` in full. It currently asserts the `primary`-fill highlight, which this task removes. It is updated to assert the replacement mechanism — not deleted, and not loosened to a weaker assertion. A test that stops proving the active state is distinguishable would silently discard the `High` finding's entire guarantee.

```ts
  test('renders the preset bar with the active preset marked via aria-pressed', async () => {
    setMockFetch(() => Promise.resolve(json(toolsPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ToolsSection, { target, props: { contextId: 'user:1' } })
    await drain()
    expect(target.querySelector('[data-testid="tools-presets"]')).not.toBeNull()
    const active = target.querySelector<HTMLButtonElement>('[data-testid="preset-allow-all"]')
    const inactive = target.querySelector<HTMLButtonElement>('[data-testid="preset-read-only"]')
    expect(active).not.toBeNull()
    expect(inactive).not.toBeNull()
    expect(active!.getAttribute('aria-pressed')).toBe('true')
    expect(inactive!.getAttribute('aria-pressed')).toBe('false')
    expect(active!.textContent).toContain('✓')
    expect(inactive!.textContent).not.toContain('✓')
    expect(active!.className).not.toContain('ui-btn--primary')
    expect(target.querySelector('[data-testid="preset-active"]')!.textContent).toContain('Allow all')
    void unmount(component)
  })
```

`toolsPayload` sets `activePreset: 'allow-all'`, so `preset-allow-all` is the active one and `preset-read-only` is not.

Add these two tests after it:

```ts
  test('domain and group heads render their tool counts', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ToolsSection, {
      target,
      props: {
        contextId: 'user:1',
        fetchToolsFn: () =>
          Promise.resolve({
            contextId: 'user:1',
            activePreset: null,
            hasStoredDefaults: false,
            domains: [
              {
                domain: 'plugin',
                summary: 'partial',
                tools: [
                  { name: 'plugin_acp__start', permission: 'ask', risk: 'open-world', group: 'acp' },
                  { name: 'plugin_acp__list', permission: 'allow', risk: 'read', group: 'acp' },
                  { name: 'plugin_time__now', permission: 'allow', risk: 'read', group: 'time' },
                ],
              },
            ],
          } satisfies ToolsResponse),
      },
    })
    await drain()
    expect(target.querySelector('[data-testid="domain-expand-plugin"]')!.textContent).toContain('(3)')
    target.querySelector<HTMLButtonElement>('[data-testid="domain-expand-plugin"]')!.click()
    flushSync()
    expect(target.querySelector('[data-testid="group-head-acp"]')!.textContent).toContain('(2)')
    expect(target.querySelector('[data-testid="group-head-time"]')!.textContent).toContain('(1)')
    void unmount(component)
  })

  test('row bulk actions are outline buttons, not bare text', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ToolsSection, {
      target,
      props: { contextId: 'user:1', fetchToolsFn: () => Promise.resolve(busyPayload) },
    })
    await drain()
    const toggle = target.querySelector<HTMLButtonElement>('[data-testid="domain-toggle-task"]')
    expect(toggle).not.toBeNull()
    expect(toggle!.className).toContain('ui-btn--outline')
    expect(toggle!.className).not.toContain('ui-btn--ghost')
    void unmount(component)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/client/settings/sections/ToolsSection.test.ts`

Expected: 3 failures. The updated preset test fails on `aria-pressed` being `null`; the count test fails because `(3)` is absent; the outline test fails because the class is `ui-btn--ghost`.

- [ ] **Step 3: Rebuild the preset row**

Replace `client/settings/sections/ToolsSection.svelte:204-218` in full:

```svelte
  <div class="settings-tools__presets" data-testid="tools-presets">
    <span class="settings-tools__presets-label">
      Preset: <span data-testid="preset-active">{activePreset === null ? 'Custom' : presetLabel(activePreset)}</span>
    </span>
    {#each PRESET_OPTIONS as preset (preset.value)}
      {@const active = activePreset === preset.value}
      <span class="settings-tools__preset" class:settings-tools__preset--active={active}>
        <Btn
          variant="outline"
          size="sm"
          ariaPressed={active}
          testid={`preset-${preset.value}`}
          onClick={() => requestPreset(preset.value)}>
          {#snippet children()}{active ? '✓ ' : ''}{preset.label}{/snippet}
        </Btn>
      </span>
    {/each}
  </div>
```

`Btn` has no `class` passthrough, so the accent border is applied through a wrapper element and a `:global()` descendant selector — the same pattern `MembersSection.svelte:189-192` uses for `.members-add :global(.ui-field)`.

Add to the `<style>` block, after `.settings-tools__presets-label`:

```css
  .settings-tools__preset--active :global(.ui-btn) {
    border-color: var(--accent);
    color: var(--accent);
  }
```

Delete the now-unused `.settings-tools__presets-active` rule (`:395-397`) — the `margin-left: auto` far-edge indicator it styled no longer exists.

- [ ] **Step 4: Add the domain count and switch the domain toggle to outline**

Replace `:258-273`:

```svelte
            <button
              type="button"
              class="settings-tools__expand"
              data-testid={`domain-expand-${domain.domain}`}
              aria-expanded={expanded[domain.domain] === true}
              onclick={() => (expanded[domain.domain] = !expanded[domain.domain])}>
              {expanded[domain.domain] ? '▾' : '▸'} {domain.domain} ({domain.tools.length})
            </button>
            <span data-testid={`domain-summary-${domain.domain}`}>
              <Pill tone={summaryTone(domain.summary)}>{#snippet children()}{domain.summary}{/snippet}</Pill>
            </span>
            <span class="settings-tools__domain-toggle">
              <Btn variant="outline" size="sm" testid={`domain-toggle-${domain.domain}`} onClick={() => void onSetDomainPermission(domain.domain, domain.summary)}>
                {#snippet children()}{domain.summary === 'deny' ? 'Allow all' : domain.summary === 'ask' ? 'Deny all' : domain.summary === 'allow' ? 'Ask all' : 'Allow all'}{/snippet}
              </Btn>
            </span>
```

- [ ] **Step 5: Add the group count and switch the group toggle to outline**

Replace `:281-293`:

```svelte
                  <li class="settings-tools__group-head" data-testid={`group-head-${groupName}`}>
                    <span class="settings-tools__group-name">{groupName} ({toolGroup.tools.length})</span>
                    <Pill tone={summaryTone(summary)}>{#snippet children()}{summary}{/snippet}</Pill>
                    <span class="settings-tools__group-toggle">
                      <Btn
                        variant="outline"
                        size="sm"
                        testid={`group-toggle-${groupName}`}
                        onClick={() => void onSetGroupPermission(domain.domain, groupName, summary)}>
                        {#snippet children()}{summary === 'deny' ? 'Allow all' : summary === 'ask' ? 'Deny all' : summary === 'allow' ? 'Ask all' : 'Allow all'}{/snippet}
                      </Btn>
                    </span>
                  </li>
```

Leave the `Cancel` buttons in both confirm bars as `variant="ghost"`. They sit inside a bordered confirm panel next to a filled CTA, so their affordance comes from context; the finding is about bare actions floating in a plain row.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test tests/client/settings/sections/ToolsSection.test.ts`
Expected: PASS, 18 tests (16 after Task 1, plus the 2 new tests added here; the `:215` test was replaced in place, so it adds no net count).

- [ ] **Step 7: Re-shoot and read every changed baseline**

```bash
bun shoot -g ToolsSection
```

Read **every** changed PNG. This is the batch where the reading matters most — it carries the `High` finding. For each shot, state explicitly:

- Is the active preset distinguishable from the inactive ones **at rest**, without hovering? (The `Preset applied` shot is the decisive one.)
- Does any preset button still read as a call to action competing with `Apply`?
- Do the `Ask all` / `Deny all` / `Allow all` row actions now read as buttons rather than text?
- Do the counts render as `name (n)` without pushing the row into an unintended wrap?

If the accent border is too subtle to be visible at rest in the actual pixels, the `High` finding is **not** fixed, whatever the tests say. Report that rather than flipping the status in Task 7.

- [ ] **Step 8: Verify the audit**

Run: `bun run visual:audit -g ToolsSection`
Expected: 10 passed, 0 failed.

- [ ] **Step 9: Format and commit**

```bash
bun run format
git add client/settings/sections/ToolsSection.svelte tests/client/settings/sections/ToolsSection.test.ts
git commit -m "fix(settings): make the ToolsSection preset state visible and row actions look interactive"
```

---

### Task 6: Full-suite verification and adversarial re-derivation

**Files:** none modified unless a regression is found.

**Interfaces:**
- Consumes: the commits from Tasks 1-5.
- Produces: a written verdict per finding that Task 7 transcribes. Task 7 must not run without it.

- [ ] **Step 1: Run the full unit suite**

Run: `bun test`

Expected: the ToolsSection and Btn suites pass. Note that this repo currently has ~20 known-failing tests under `review-loop/` plus a `WorkerPool` timeout, unrelated to this project and **not verified against `master`**. If those are the only failures, record them as pre-existing-but-unverified and continue. Any failure in `tests/client/` is this project's and blocks the task.

- [ ] **Step 2: Run the full visual audit**

Run: `bun run visual:audit`

Expected: **462 passed, 0 failed.** The floor was 460; Task 3 added two cases (see its Step 4 — the spec projected 461 on a one-case assumption).

If a non-ToolsSection section fails, that is a shared-primitive leak from Task 4 and must be investigated, not re-shot.

- [ ] **Step 3: Run lint, typecheck, and security**

```bash
bun run lint
bun run typecheck
bun run format:check
bun security
```

Expected: all clean.

- [ ] **Step 4: Dispatch a fresh adversarial reviewer**

Whoever wrote the fixes does not certify them. Dispatch a subagent with **no prior context from this project**, and give it:

- `docs/ux-reviews/ToolsSection.md` (the current, still-`open` version)
- the current `client/settings/sections/ToolsSection.svelte`
- the current baseline PNGs under `.storybook-shots/settings/sections/ToolsSection.spec.ts/`

Ask it, for each of the 8 findings, to answer from source and pixels alone: *is this defect still present?* Instruct it explicitly that "the tests pass" and "the audit is green" are **not** evidence — the audit was re-shot, so it passes by construction.

Record its verdicts verbatim. The predecessor project ran this step and it refuted a claim that had already passed its own author's review; that is the entire justification for the step.

- [ ] **Step 5: Reconcile**

For each finding the reviewer says is still present, either fix it (returning to the relevant task's shoot-and-read loop) or keep it `open` in Task 7 with its text narrowed to the residue. **Do not argue a reviewer's refutation away.** There is no `partial` status.

---

### Task 7: Close the loop — statuses, scorecard, backlog

**Files:**
- Modify: `docs/ux-reviews/ToolsSection.md`
- Regenerate: `docs/ux-reviews/_BACKLOG.md`

**Interfaces:**
- Consumes: the commit hashes from Tasks 1, 2, 3 and 5, and Task 6's verdicts.
- Produces: the final counts reported to the human.

**This task runs only after Task 6.** Statuses may only be flipped after the fix commits exist, because each `Resolved:` line must cite a real hash.

- [ ] **Step 1: Collect the commit hashes**

```bash
git log --oneline -8
```

Record which hash closes which finding:

| Finding | Task | Commit |
| --- | --- | --- |
| `tools-confirm-no-busy-state` | 1 | *(hash)* |
| `tools-empty-state-no-next-step` | 1 | *(hash)* |
| `tools-spacing-off-scale` | 2 | *(hash)* |
| `tools-domain-expand-small-target` | 2 | *(hash)* |
| `tools-domain-head-no-wrap` | 3 | *(hash)* |
| `tools-preset-active-state-invisible` | 5 | *(hash)* |
| `tools-bulk-actions-look-like-text` | 5 | *(hash)* |
| `tools-no-per-group-count` | 5 | *(hash)* |

- [ ] **Step 2: Flip the statuses the adversarial pass confirmed**

For each finding Task 6 confirmed as fixed, change its `- **Status:** open` line to `- **Status:** fixed` and insert a `- **Resolved:**` line directly beneath it, following the file's existing format. Example, matching the style already used in this corpus:

```markdown
- **Id:** tools-confirm-no-busy-state
- **Status:** fixed
- **Resolved:** `abc1234` — "fix(settings): keep the Tools confirm bar mounted while in flight and give the empty state a next step" (2026-08-03). `ToolsSection.svelte:159-172` now sets `applying = true` before awaiting and clears `pendingPreset` in a `finally` block, so the bar stays mounted with `Apply` in its `busy`/`disabled` state for the duration of the request.
```

Also set `- **Suggested fix:** N/A — resolved.` on each flipped finding, matching the corpus convention.

**Leave `open` any finding the adversarial pass did not confirm**, with its text narrowed to the residue. The parser rejects a non-`open` status lacking `Resolved:`, but it cannot detect a false `Resolved:` — that check is yours.

- [ ] **Step 3: Re-score the scorecard**

Update the ToolsSection scorecard table (today: 1 `fail`, 7 `warn`, 1 `pass`). Move a dimension to `pass` **only where the batches actually earned it**. A dimension whose rationale still describes a real residue keeps its `warn` and keeps a finding open. Rewrite each changed rationale line to describe what the code does now, citing the new source lines — do not leave a stale rationale beside an upgraded score.

- [ ] **Step 4: Regenerate the backlog**

```bash
bun run format
bun run ux:backlog
```

Expected if all 8 closed: ToolsSection `0 open / 9 fixed`, total **24 open**, `High` bucket empty. If the adversarial pass kept findings open, the numbers land higher — **report the actual numbers**. A `0 open` result obtained by declaring a residual defect fixed is a failure, however green the audit is.

- [ ] **Step 5: Run the currency gate**

Run: `bun test tests/scripts/ux-backlog.test.ts`
Expected: PASS. This gate compares `_BACKLOG.md` against the section files, so it fails if Step 4 was skipped or run before Step 2.

- [ ] **Step 6: Commit**

```bash
git add docs/ux-reviews/ToolsSection.md docs/ux-reviews/_BACKLOG.md
git commit -m "docs(ux): close the ToolsSection findings fixed by this branch"
```

- [ ] **Step 7: Report**

Report to the human: the final open/fixed counts, the visual audit count, any finding that stayed `open` and why, any new finding recorded, and the Task 4 spec deviation for sign-off.

**Do not merge and do not push.** The branch stays as-is on `ui-ux-review-01` (PR #212 is already open against `master`) unless the human says otherwise.
