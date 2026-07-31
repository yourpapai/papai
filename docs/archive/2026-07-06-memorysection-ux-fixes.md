<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# MemorySection UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 10 findings from the MemorySection UX review — contrast, explanatory copy, error/empty states, destructive-action placement, per-record affordance and busy state — as a client-only change.

**Architecture:** Everything lives in the Svelte settings section `client/settings/sections/MemorySection.svelte` plus its Storybook stories and MSW fixtures. No backend/route/fetcher changes — memory promotion is automatic server-side, so there is no promote endpoint. Verification is the repo's visual loop: add/adjust MSW fixture → Storybook story → `bun shoot` → Read the PNG, backed by the commit-time lint/typecheck/format hook.

**Tech Stack:** Svelte 5 (runes: `$state`/`$derived`/`$effect`, snippets), TypeScript (strict, `.js` import paths), Zod v4 schemas, Storybook + MSW fixtures, Playwright screenshots via `@crvy/strybk` (`bun shoot`), oxlint + oxfmt.

**Source spec:** [`docs/superpowers/specs/2026-07-06-memorysection-ux-fixes-design.md`](../specs/2026-07-06-memorysection-ux-fixes-design.md)
**Source review:** [`docs/ux-reviews/MemorySection.md`](../../ux-reviews/MemorySection.md)

---

## Conventions used by every task

- **Format before commit.** The pre-commit hook runs `lint`, `typecheck`, `format:check`, `license-headers`. Run `bun run format` (oxfmt) before `git commit` or `format:check` will fail. Never add lint-disable/type-ignore comments — fix the underlying issue.
- **Shoot + read to verify visuals.** `bun shoot -g MemorySection` re-captures all MemorySection stories (baseline is auto-updated). Then Read the specific PNG under `.storybook-shots/settings/sections/MemorySection.spec.ts/` and confirm the described change. (`.storybook-shots/` is git-ignored — screenshots are not committed.)
- **Storybook must be running** (`bun storybook`, warm on `http://localhost:6006`) for `bun shoot` to work.
- **`.js` extension in imports** even for `.ts` files (repo rule).

## File map

- **Modify:** `client/settings/sections/MemorySection.svelte` — all component/markup/style/copy changes.
- **Modify:** `client/settings/sections/MemorySection.stories.svelte` — add `Empty (capture on)` and `Provisional` stories.
- **Modify:** `client/stories/msw/settings-handlers-personal.ts` — add two fixtures + two exported handler arrays.
- **Modify:** `client/stories/msw/scenarios.ts` — import + register the two new scenario keys.
- **No test files** — these sections have no Svelte unit-test harness; the story/shoot loop is the regression surface.

---

## Task 1: Add Provisional + capture-on-empty fixtures, scenarios, and stories

Makes the currently-uncovered pending block and the capture-on empty branch observable in Storybook, and establishes the baseline PNGs later tasks verify against. (Resolves the coverage half of finding #10.)

**Files:**

- Modify: `client/stories/msw/settings-handlers-personal.ts` (after `memoryHandlers`, ~line 102)
- Modify: `client/stories/msw/scenarios.ts` (import block ~line 35-41; registration ~line 175-178)
- Modify: `client/settings/sections/MemorySection.stories.svelte`

- [ ] **Step 1: Add the two fixtures + handler exports**

In `client/stories/msw/settings-handlers-personal.ts`, immediately after the `export const memoryHandlers: HandlerFamily = { … }` block (ends ~line 102), add:

```ts
const memoryEmptyCaptureOn = {
  contextId: 'ctx-personal-1',
  scopeType: 'personal',
  enabled: true,
  profile: '',
  records: [],
}

const memoryProvisional = {
  contextId: 'ctx-group-1',
  scopeType: 'group',
  enabled: true,
  profile: 'Team prefers async standups.',
  records: [
    {
      id: 'm1',
      kind: 'fact',
      content: 'Uses TypeScript across services',
      summary: null,
      tags: ['lang'],
      confidence: 0.9,
      status: 'active',
      source: 'chat',
      createdAt: '2026-05-01T00:00:00Z',
      updatedAt: '2026-05-01T00:00:00Z',
      lastSeenAt: '2026-06-01T00:00:00Z',
    },
    {
      id: 'm2',
      kind: 'preference',
      content: 'Wants deploy notifications posted in the #ops thread',
      summary: null,
      tags: ['ops', 'notifications'],
      confidence: 0.7,
      status: 'provisional',
      source: 'chat',
      createdAt: '2026-06-10T00:00:00Z',
      updatedAt: '2026-06-10T00:00:00Z',
      lastSeenAt: '2026-06-20T00:00:00Z',
    },
  ],
}

export const memoryEmptyCaptureOnHandlers: HttpHandler[] = [
  http.get('/settings/api/memory', () => HttpResponse.json(memoryEmptyCaptureOn)),
]

export const memoryProvisionalHandlers: HttpHandler[] = [
  http.get('/settings/api/memory', () => HttpResponse.json(memoryProvisional)),
]
```

(`HttpHandler` and `http`/`HttpResponse` are already imported at the top of this file. The client `MemoryRecordSchema` types `kind`/`status`/`source` as `z.string()`, so `source: 'chat'` — matching the existing `memoryPopulated` fixture — validates fine.)

- [ ] **Step 2: Import + register the scenarios**

In `client/stories/msw/scenarios.ts`, find the existing import from `./settings-handlers-personal.js` (the block starting ~line 35 with `codingCredentialsHandlers,`). Add the two new names to that import list:

```ts
  memoryEmptyCaptureOnHandlers,
  memoryProvisionalHandlers,
```

Then, in the scenario map, find the memory block:

```ts
  'settings-memory-populated': [...memoryHandlers.populated],
  'settings-memory-empty': [...memoryHandlers.empty],
  'settings-memory-error': [...memoryHandlers.error],
  'settings-memory-loading': [...memoryHandlers.loading],
```

Add directly beneath it:

```ts
  'settings-memory-empty-capture-on': [...memoryEmptyCaptureOnHandlers],
  'settings-memory-provisional': [...memoryProvisionalHandlers],
```

- [ ] **Step 3: Add the two stories**

In `client/settings/sections/MemorySection.stories.svelte`, after the existing `Loading` story (line 26), add:

```svelte
<Story name="Empty (capture on)" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-memory-empty-capture-on' }} />

<Story name="Provisional" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-memory-provisional' }} />
```

- [ ] **Step 4: Shoot and verify the new states render**

Run: `bun shoot -g MemorySection`
Expected: passes; new snapshots written for `…Empty-(capture-on)-1.png` and `…Provisional-1.png`.

Read `.storybook-shots/settings/sections/MemorySection.spec.ts/settings-sections-MemorySection-Provisional-1.png` and confirm: a "Group" eyebrow, one active record, and a "Pending (provisional)" block with the second record. (It still shows the OLD hint/ghost-Archive/dim-meta — that's expected; later tasks fix those and re-verify here.)

- [ ] **Step 5: Commit**

```bash
bun run format
git add client/stories/msw/settings-handlers-personal.ts client/stories/msw/scenarios.ts client/settings/sections/MemorySection.stories.svelte
git commit -m "test(visual): add MemorySection provisional + capture-on-empty stories"
```

---

## Task 2: Fix record meta contrast (findings: High `--fg4`, Low `--fg3`)

Move the record date, tag-chip text, and source label off the near-invisible `--fg4`/borderline `--fg3` onto `--fg2` (`--text-muted`, ~7:1).

**Files:**

- Modify: `client/settings/sections/MemorySection.svelte` (styles, ~lines 368-396)

- [ ] **Step 1: Raise the shared meta color to `--fg2`**

Find:

```css
.settings-memory__source,
.settings-memory__seen,
.settings-memory__tag {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg3);
}

.settings-memory__seen {
  color: var(--fg4);
}
```

Replace with (drop the `--fg4` override entirely):

```css
.settings-memory__source,
.settings-memory__seen,
.settings-memory__tag {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg2);
}
```

- [ ] **Step 2: Raise the tag-chip color to `--fg2`**

Find:

```css
.settings-memory__tag {
  padding: 1px 6px;
  border: 1px solid var(--hair);
  color: var(--fg4);
}
```

Replace with:

```css
.settings-memory__tag {
  padding: 1px 6px;
  border: 1px solid var(--hair);
  color: var(--fg2);
}
```

- [ ] **Step 3: Shoot and verify**

Run: `bun shoot -g MemorySection`
Read `…settings-sections-MemorySection-Populated-1.png` and confirm the "last 2026-06-01" date, the "chat" source, and the "lang" tag chip are now clearly legible (no longer dissolving into the card).

- [ ] **Step 4: Commit**

```bash
bun run format
git add client/settings/sections/MemorySection.svelte
git commit -m "fix(settings): raise MemorySection record meta contrast off --fg4/--fg3"
```

---

## Task 3: Give the Archive action a resting affordance (finding: Med ghost button)

**Files:**

- Modify: `client/settings/sections/MemorySection.svelte` (recordItem snippet, ~lines 241-248)

- [ ] **Step 1: Switch Archive from `ghost` to `outline`**

Find (inside the `recordItem` snippet):

```svelte
          <Btn
            variant="ghost"
            size="sm"
            disabled={mutating}
            testid={`memory-archive-${record.id}`}
            onClick={() => void archiveRecord(record.id)}>
            {#snippet children()}Archive{/snippet}
          </Btn>
```

Replace with (only `variant` changes here; the `disabled`/`busy` refactor happens in Task 4):

```svelte
          <Btn
            variant="outline"
            size="sm"
            disabled={mutating}
            testid={`memory-archive-${record.id}`}
            onClick={() => void archiveRecord(record.id)}>
            {#snippet children()}Archive{/snippet}
          </Btn>
```

- [ ] **Step 2: Shoot and verify**

Run: `bun shoot -g MemorySection`
Read `…MemorySection-Populated-1.png` and confirm the "Archive" control now has a visible resting border (reads as a button, not plain text).

- [ ] **Step 3: Commit**

```bash
bun run format
git add client/settings/sections/MemorySection.svelte
git commit -m "fix(settings): make MemorySection Archive an outline button"
```

---

## Task 4: Split the `mutating` flag into per-row + toggle state (finding: Low)

Replace the single `mutating` flag (which disables every Archive button and the capture toggle at once) with `archivingId` (per-record) and `togglingCapture` (toggle only), and give the archived row a `busy` state.

**Files:**

- Modify: `client/settings/sections/MemorySection.svelte` (state decl ~line 39; `toggleCapture` ~98-111; `archiveRecord` ~147-159; toggle button ~176; recordItem Archive ~241-248)

- [ ] **Step 1: Replace the state declaration**

Find:

```ts
let mutating = $state(false)
```

Replace with:

```ts
let togglingCapture = $state(false)
let archivingId: string | null = $state(null)
```

- [ ] **Step 2: Update `toggleCapture` to use `togglingCapture`**

Find:

```ts
async function toggleCapture(): Promise<void> {
  if (currentMemory === null) return
  error = null
  status = null
  mutating = true
  try {
    await setMemoryCapture({ contextId, enabled: !currentMemory.enabled })
    await load(contextId)
  } catch (err) {
    error = messageFrom(err)
  } finally {
    mutating = false
  }
}
```

Replace with:

```ts
async function toggleCapture(): Promise<void> {
  if (currentMemory === null) return
  error = null
  status = null
  togglingCapture = true
  try {
    await setMemoryCapture({ contextId, enabled: !currentMemory.enabled })
    await load(contextId)
  } catch (err) {
    error = messageFrom(err)
  } finally {
    togglingCapture = false
  }
}
```

- [ ] **Step 3: Update `archiveRecord` to use `archivingId`**

Find:

```ts
async function archiveRecord(id: string): Promise<void> {
  error = null
  status = null
  mutating = true
  try {
    await archiveMemoryRecord(contextId, id)
    await load(contextId)
  } catch (err) {
    error = messageFrom(err)
  } finally {
    mutating = false
  }
}
```

Replace with:

```ts
async function archiveRecord(id: string): Promise<void> {
  error = null
  status = null
  archivingId = id
  try {
    await archiveMemoryRecord(contextId, id)
    await load(contextId)
  } catch (err) {
    error = messageFrom(err)
  } finally {
    archivingId = null
  }
}
```

- [ ] **Step 4: Update the capture-toggle button's `disabled`**

Find (inside the `PageHeader` `action` snippet):

```svelte
      <Btn
        variant={currentMemory?.enabled ? 'outline' : 'primary'}
        size="sm"
        disabled={currentMemory === null || loading || mutating}
        testid="memory-capture-toggle"
        onClick={() => void toggleCapture()}>
        {#snippet children()}{currentMemory?.enabled ? 'Disable capture' : 'Enable capture'}{/snippet}
      </Btn>
```

Replace with:

```svelte
      <Btn
        variant={currentMemory?.enabled ? 'outline' : 'primary'}
        size="sm"
        disabled={currentMemory === null || loading || togglingCapture}
        testid="memory-capture-toggle"
        onClick={() => void toggleCapture()}>
        {#snippet children()}{currentMemory?.enabled ? 'Disable capture' : 'Enable capture'}{/snippet}
      </Btn>
```

- [ ] **Step 5: Update the Archive button to `busy`/per-row `disabled`**

Find (the Archive `Btn` from Task 3):

```svelte
          <Btn
            variant="outline"
            size="sm"
            disabled={mutating}
            testid={`memory-archive-${record.id}`}
            onClick={() => void archiveRecord(record.id)}>
            {#snippet children()}Archive{/snippet}
          </Btn>
```

Replace with:

```svelte
          <Btn
            variant="outline"
            size="sm"
            busy={archivingId === record.id}
            disabled={archivingId !== null}
            testid={`memory-archive-${record.id}`}
            onClick={() => void archiveRecord(record.id)}>
            {#snippet children()}Archive{/snippet}
          </Btn>
```

- [ ] **Step 6: Update the "Clear memory" button's `disabled`**

The Clear button currently reads `disabled={mutating || clearing}` (~line 212, still inside the profile card at this point — Task 5 relocates it). Find:

```svelte
            disabled={mutating || clearing}
            testid="memory-clear"
```

Replace with:

```svelte
            disabled={togglingCapture || clearing || archivingId !== null}
            testid="memory-clear"
```

- [ ] **Step 7: Verify no remaining `mutating` references + no visual regression**

Run: `grep -n mutating client/settings/sections/MemorySection.svelte`
Expected: no matches.

Run: `bun shoot -g MemorySection`
Expected: passes, Populated/Provisional visually unchanged from Task 3 (this is a state refactor).

- [ ] **Step 8: Commit**

```bash
bun run format
git add client/settings/sections/MemorySection.svelte
git commit -m "refactor(settings): scope MemorySection busy state per-row and per-toggle"
```

---

## Task 5: Move "Clear memory" to the header + add explanatory copy (findings: Med placement, High copy)

Relocate the section-wide destructive action to the `PageHeader` action slot beside the capture toggle, add a scope-aware description, and add the disable-vs-clear helper line.

**Files:**

- Modify: `client/settings/sections/MemorySection.svelte` (derived block ~line 46; PageHeader ~171-182; profile actions ~200-220; body top ~189-190; styles)

- [ ] **Step 1: Add the scope-aware description derived value**

Find:

```ts
const currentMemory = $derived(loadedContextId === contextId ? memory : null)
```

Add directly beneath it:

```ts
const scopeSub = $derived(
  currentMemory?.scopeType === 'group'
    ? "Durable facts learned from this group's chats, shared across all threads."
    : 'Durable facts the assistant learns from your chats to personalize replies.',
)
```

- [ ] **Step 2: Rebuild the PageHeader with `sub` and both actions**

Find:

```svelte
  <PageHeader eyebrow={currentMemory?.scopeType === 'group' ? 'Group' : 'Personal'} title="Memory">
    {#snippet action()}
      <Btn
        variant={currentMemory?.enabled ? 'outline' : 'primary'}
        size="sm"
        disabled={currentMemory === null || loading || togglingCapture}
        testid="memory-capture-toggle"
        onClick={() => void toggleCapture()}>
        {#snippet children()}{currentMemory?.enabled ? 'Disable capture' : 'Enable capture'}{/snippet}
      </Btn>
    {/snippet}
  </PageHeader>
```

Replace with:

```svelte
  <PageHeader
    eyebrow={currentMemory?.scopeType === 'group' ? 'Group' : 'Personal'}
    title="Memory"
    sub={scopeSub}>
    {#snippet action()}
      <div class="settings-memory__header-actions">
        <Btn
          variant="danger"
          size="sm"
          disabled={currentMemory === null || togglingCapture || clearing || archivingId !== null}
          testid="memory-clear"
          onClick={() => {
            pendingClear = true
            clearError = null
          }}>
          {#snippet children()}Clear memory{/snippet}
        </Btn>
        <Btn
          variant={currentMemory?.enabled ? 'outline' : 'primary'}
          size="sm"
          disabled={currentMemory === null || loading || togglingCapture}
          testid="memory-capture-toggle"
          onClick={() => void toggleCapture()}>
          {#snippet children()}{currentMemory?.enabled ? 'Disable capture' : 'Enable capture'}{/snippet}
        </Btn>
      </div>
    {/snippet}
  </PageHeader>
```

- [ ] **Step 3: Remove the old "Clear memory" button from the profile card**

Find:

```svelte
        <div class="settings-memory__profile-actions">
          <Btn
            variant="primary"
            size="sm"
            disabled={savingProfile}
            testid="memory-profile-save"
            onClick={() => void saveProfile()}>
            {#snippet children()}{savingProfile ? 'Saving…' : 'Save profile'}{/snippet}
          </Btn>
          <Btn
            variant="danger"
            size="sm"
            disabled={togglingCapture || clearing || archivingId !== null}
            testid="memory-clear"
            onClick={() => {
              pendingClear = true
              clearError = null
            }}>
            {#snippet children()}Clear memory{/snippet}
          </Btn>
        </div>
```

Replace with (only Save remains):

```svelte
        <div class="settings-memory__profile-actions">
          <Btn
            variant="primary"
            size="sm"
            disabled={savingProfile}
            testid="memory-profile-save"
            onClick={() => void saveProfile()}>
            {#snippet children()}{savingProfile ? 'Saving…' : 'Save profile'}{/snippet}
          </Btn>
        </div>
```

- [ ] **Step 4: Add the disable-vs-clear helper line at the top of the body**

Find the opening of the loaded body:

```svelte
    <div class="settings-memory">
      <div class="settings-memory__profile">
```

Replace with:

```svelte
    <div class="settings-memory">
      <p class="settings-memory__note">
        Disabling stops new capture. Existing memory is kept and still used — use Clear memory
        to remove it.
      </p>
      <div class="settings-memory__profile">
```

- [ ] **Step 5: Add styles for the header-actions row and the note**

In the `<style>` block, find:

```css
.settings-memory {
  display: grid;
  gap: 14px;
}
```

Replace with (also fixes the finding #9 gap token in the same edit):

```css
.settings-memory {
  display: grid;
  gap: var(--gap-inline);
}

.settings-memory__header-actions {
  display: flex;
  gap: var(--gap-tight);
}

.settings-memory__note {
  margin: 0;
  font-size: 11px;
  color: var(--fg2);
}
```

- [ ] **Step 6: Shoot and verify**

Run: `bun shoot -g MemorySection`
Read `…MemorySection-Populated-1.png` and confirm: the header shows `[Clear memory] [Disable capture]` side by side, a description line under the "Memory" title, the disable/clear note above the profile card, and the profile card now shows only "Save profile".
Read `…MemorySection-Provisional-1.png` and confirm the description reads the group variant ("…from this group's chats, shared across all threads.").

- [ ] **Step 7: Commit**

```bash
bun run format
git add client/settings/sections/MemorySection.svelte
git commit -m "fix(settings): move MemorySection Clear to header, add capture copy"
```

---

## Task 6: State-aware empty state with an Enable-capture CTA (finding: High dead-end empty)

**Files:**

- Modify: `client/settings/sections/MemorySection.svelte` (empty branch ~lines 252-255)

- [ ] **Step 1: Replace the single empty state with the two-branch version**

Find:

```svelte
      {#if activeRecords.length === 0}
        <div data-testid="memory-empty">
          <EmptyState title="No active memory records" hint="Captured memory records for this context will appear here." />
        </div>
      {:else}
```

Replace with:

```svelte
      {#if activeRecords.length === 0}
        <div data-testid="memory-empty">
          {#if currentMemory.enabled}
            <EmptyState
              title="No memory records yet"
              hint="Facts the assistant learns from your chats will appear here." />
          {:else}
            <EmptyState
              title="Capture is off"
              hint="Enable capture to start recording facts from your conversations.">
              {#snippet action()}
                <Btn
                  variant="primary"
                  size="sm"
                  disabled={currentMemory === null || loading || togglingCapture}
                  testid="memory-empty-enable"
                  onClick={() => void toggleCapture()}>
                  {#snippet children()}Enable capture{/snippet}
                </Btn>
              {/snippet}
            </EmptyState>
          {/if}
        </div>
      {:else}
```

(`Btn` and `EmptyState` are already imported. `EmptyState` renders the `action` snippet — see `client/shared/ui/EmptyState.svelte:23`.)

- [ ] **Step 2: Shoot and verify both branches**

Run: `bun shoot -g MemorySection`
Read `…MemorySection-Empty-1.png` (fixture has `enabled: false`) and confirm it shows "Capture is off" with an "Enable capture" button in the empty state.
Read `…MemorySection-Empty-(capture-on)-1.png` and confirm it shows "No memory records yet" with no button.

- [ ] **Step 3: Commit**

```bash
bun run format
git add client/settings/sections/MemorySection.svelte
git commit -m "fix(settings): make MemorySection empty state capture-aware with CTA"
```

---

## Task 7: Replace the raw error string with `ErrorState` + retry (finding: Med)

On load failure, render the shared `ErrorState` with a retry in place of the body; keep the inline status line only for transient mutation errors (body still present).

**Files:**

- Modify: `client/settings/sections/MemorySection.svelte` (import block ~lines 9-16; error/status lines ~184-185; body branch ~187-189 and its closing `{/if}` ~278)

- [ ] **Step 1: Import `ErrorState`**

Find:

```ts
import EmptyState from '../../shared/ui/EmptyState.svelte'
```

Add directly beneath it:

```ts
import ErrorState from '../../shared/ui/ErrorState.svelte'
```

- [ ] **Step 2: Remove the always-on top status lines**

Find:

```svelte
  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

  {#if initialLoad && loading}
    <p class="placeholder">Loading…</p>
  {:else if currentMemory !== null}
    <div class="settings-memory">
```

Replace with (status lines move inside the loaded branch; add a load-error branch):

```svelte
  {#if initialLoad && loading}
    <p class="placeholder">Loading…</p>
  {:else if currentMemory !== null}
    {#if error !== null}<p class="status-error">{error}</p>{/if}
    {#if status !== null}<p class="status-success">{status}</p>{/if}
    <div class="settings-memory">
```

- [ ] **Step 3: Add the load-error branch before the closing `{/if}`**

Find (the end of the loaded body — the closing `</div>` of `.settings-memory` followed by `{/if}`, just above the `<Confirm` element):

```svelte
    </div>
  {/if}

  <Confirm
```

Replace with:

```svelte
    </div>
  {:else if error !== null}
    <ErrorState message={error} onRetry={() => void load(contextId)} />
  {/if}

  <Confirm
```

- [ ] **Step 4: Shoot and verify**

Run: `bun shoot -g MemorySection`
Read `…MemorySection-Error-1.png` and confirm the raw "boom" line is replaced by a framed `ErrorState` card (icon + "Something went wrong" + the message) with a "Try again" button.

- [ ] **Step 5: Commit**

```bash
bun run format
git add client/settings/sections/MemorySection.svelte
git commit -m "fix(settings): render MemorySection load failure via ErrorState + retry"
```

---

## Task 8: Add an "Active records" heading (finding: Low asymmetric hierarchy)

**Files:**

- Modify: `client/settings/sections/MemorySection.svelte` (active `{:else}` branch ~lines 256-262; styles)

- [ ] **Step 1: Wrap the active list with a heading**

Find:

```svelte
      {:else}
        <ul class="settings-memory__records">
          {#each activeRecords as record (record.id)}
            {@render recordItem(record)}
          {/each}
        </ul>
      {/if}
```

Replace with:

```svelte
      {:else}
        <div class="settings-memory__active">
          <h3 class="settings-memory__records-title">Active records</h3>
          <ul class="settings-memory__records">
            {#each activeRecords as record (record.id)}
              {@render recordItem(record)}
            {/each}
          </ul>
        </div>
      {/if}
```

- [ ] **Step 2: Add styles mirroring the pending group**

In the `<style>` block, find:

```css
.settings-memory__pending-title {
  margin: 0;
  font-size: 13px;
  color: var(--fg);
}
```

Add directly beneath it:

```css
.settings-memory__records-title {
  margin: 0;
  font-size: 13px;
  color: var(--fg);
}

.settings-memory__active {
  display: grid;
  gap: var(--gap-tight);
}
```

- [ ] **Step 3: Shoot and verify**

Run: `bun shoot -g MemorySection`
Read `…MemorySection-Populated-1.png` and confirm an "Active records" heading sits above the record list, matching the "Pending (provisional)" heading style seen in the Provisional shot.

- [ ] **Step 4: Commit**

```bash
bun run format
git add client/settings/sections/MemorySection.svelte
git commit -m "fix(settings): label MemorySection active records list"
```

---

## Task 9: Rewrite the provisional hint to reflect automatic promotion (finding: Low)

**Files:**

- Modify: `client/settings/sections/MemorySection.svelte` (pending block ~lines 266-269)

- [ ] **Step 1: Replace the hint copy**

Find:

```svelte
          <h3 class="settings-memory__pending-title">Pending (provisional)</h3>
          <p class="settings-memory__pending-hint">
            Captured from conversation threads and awaiting promotion to shared memory.
          </p>
```

Replace with:

```svelte
          <h3 class="settings-memory__pending-title">Pending (provisional)</h3>
          <p class="settings-memory__pending-hint">
            Captured from individual threads. Facts seen across several threads are promoted to
            shared group memory automatically — no action needed. Archive to discard.
          </p>
```

- [ ] **Step 2: Shoot and verify**

Run: `bun shoot -g MemorySection`
Read `…MemorySection-Provisional-1.png` and confirm the pending block shows the new automatic-promotion hint copy.

- [ ] **Step 3: Commit**

```bash
bun run format
git add client/settings/sections/MemorySection.svelte
git commit -m "docs(settings): clarify MemorySection provisional promotion is automatic"
```

---

## Task 10: Align remaining spacing to tokens (finding: Low)

The `.settings-memory` `gap` was already tokenized in Task 5. This task handles the record padding and the two remaining `8px` gaps.

**Files:**

- Modify: `client/settings/sections/MemorySection.svelte` (styles: `.settings-memory__profile-actions`, `.settings-memory__records`, `.settings-memory__record`)

- [ ] **Step 1: Tokenize the profile-actions gap**

Find:

```css
.settings-memory__profile-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
```

Replace with:

```css
.settings-memory__profile-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap-tight);
}
```

- [ ] **Step 2: Tokenize the records list gap**

Find:

```css
.settings-memory__records {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}
```

Replace with:

```css
.settings-memory__records {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--gap-tight);
}
```

- [ ] **Step 3: Normalize the record padding to match siblings (12px)**

Find:

```css
.settings-memory__record {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: start;
  min-height: 76px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  background: var(--surface);
}
```

Replace with:

```css
.settings-memory__record {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--gap-inline);
  align-items: start;
  min-height: 76px;
  padding: 12px;
  border: 1px solid var(--border);
  background: var(--surface);
}
```

- [ ] **Step 4: Shoot and verify no regression**

Run: `bun shoot -g MemorySection`
Expected: passes. Read `…MemorySection-Populated-1.png` and confirm the record card spacing looks even and consistent with sibling settings cards (no cramped/gappy areas, no overflow).

- [ ] **Step 5: Commit**

```bash
bun run format
git add client/settings/sections/MemorySection.svelte
git commit -m "style(settings): align MemorySection spacing to shared tokens"
```

---

## Final verification (after all tasks)

- [ ] **Re-shoot the full depth-B set including the manual interaction states** (narrow-640, clear-confirm, clear-hover, profile-focus already exist in `tests/visual/settings/sections/MemorySection.spec.ts`):

Run: `bun shoot -g MemorySection`
Expected: all stories + manual states pass.

- [ ] **Read the key PNGs one more time** and confirm against the review's findings:
  - Populated: legible meta, outline Archive, "Active records" heading, header `[Clear memory] [Disable capture]`, description + note lines.
  - Empty / Empty (capture on): capture-aware copy + CTA on the off variant.
  - Error: `ErrorState` + retry.
  - Provisional: group description, automatic-promotion hint.
  - narrow-640: everything still reflows cleanly.

- [ ] **Cross-check the source review** [`docs/ux-reviews/MemorySection.md`](../../ux-reviews/MemorySection.md): every finding (High ×2, Med ×3, Low ×5) has a corresponding task above.

- [ ] **Optional:** run a broader visual sweep to confirm no shared-primitive regressions leaked (`bun shoot -g Memory` covers only this section; the change is section-local so no wider shoot is required).

---

## Task → finding traceability

| Finding (review)                                | Severity | Task                    |
| ----------------------------------------------- | -------- | ----------------------- |
| Record meta text (`--fg4`) invisible            | High     | 2                       |
| No explanatory copy for capture feature         | High     | 5                       |
| Error state raw string, no retry                | Med      | 7                       |
| "Clear memory" mis-scoped in profile card       | Med      | 5                       |
| "Archive" low-affordance ghost                  | Med      | 3                       |
| Source label (`--fg3`) borderline contrast      | Low      | 2                       |
| Active records list has no heading              | Low      | 8                       |
| Shared `mutating` disables unrelated controls   | Low      | 4                       |
| One-off spacing drift                           | Low      | 5 (gap) + 10            |
| Provisional block uncovered + unclear promotion | Low      | 1 (coverage) + 9 (copy) |
