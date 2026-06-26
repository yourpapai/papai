<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Backstage Phase 2.2 — Section Headers (B1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-rolled `eyebrow + <h2>` section-header blocks in the four `/admin` sections that still carry them with the Phase 1 `PageHeader` component, eliminating the duplicated/standalone heading pattern (finding B1).

**Architecture:** Consumer-side adoption in `client/admin/`. One small, test-driven enhancement to `PageHeader` (an optional `titleTestId` prop so the existing `data-testid="admin-section-title"` contract survives), then four section header swaps. No change to section data flow or controls — the existing refresh/Seg controls move verbatim into `PageHeader`'s `action` snippet.

**Tech Stack:** Bun, Svelte 5 (runes), TypeScript (strict), `bun:test` + happy-dom.

**Spec:** `docs/superpowers/specs/2026-06-01-backstage-admin-ui-fixes-design.md` (§7 finding B1).

**Depends on:** Phase 1 (`PageHeader`, `Caption` in `client/shared/ui/`).

**Out of scope (handled elsewhere):** The redundant _inner_ headings (`<h3>Platform Instances</h3>` etc. under a Panel title) are part of the InstancesSection rewrite (Phase 2.3) and the forms cleanup (Phase 2.4, B7). Converting the raw `<button>` refresh controls in `SystemSection`/`PluginConfigSection` to `Btn` is the B2 button sweep (Phase 2.4); here they move into the header verbatim.

---

## Conventions (apply to every task)

- **TDD write-hook** enforces test-first on `client/` files. For a refactor: extend the relevant test to assert the NEW output, run it Red, then refactor to Green.
- Run the client suite: `bun test:client` (ignore one unrelated `ECONNREFUSED` in `admin-split-boundaries.test.ts`). Filter to a file by passing its path.
- `.svelte` local TS imports use the `.js` extension. No `lint-disable`/`ts-ignore`. Run `bun format <files>` before committing if `format:check` complains.
- **Commit each task separately and SCOPED** (`git add <files> && git commit -m "..." -- <files>`) to `master`. NEVER stage/touch/revert `.opencode/plugins/tdd-enforcement.ts` or `tests/opencode-tdd-enforcement.test.ts`.

---

## Task 1: Add an optional `titleTestId` prop to `PageHeader`

The four sections each render `<h2 data-testid="admin-section-title">`; tests and scrollspy rely on that test id. `PageHeader` renders its title in a `div` with no test id, so add an opt-in prop.

**Files:**

- Modify: `client/shared/ui/PageHeader.svelte`
- Test: `tests/client/shared/ui/PageHeader.test.ts`

- [ ] **Step 1: Extend the failing test.** Append to `tests/client/shared/ui/PageHeader.test.ts`:

```ts
test('applies titleTestId to the title element when provided', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const c = mount(PageHeader, { target, props: { title: 'Instances', titleTestId: 'admin-section-title' } })
  expect(target.querySelector('[data-testid="admin-section-title"]')?.textContent).toBe('Instances')
  void unmount(c)
})

test('omits the title data-testid attribute when titleTestId is absent', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const c = mount(PageHeader, { target, props: { title: 'System' } })
  expect(target.querySelector('[data-testid]')).toBeNull()
  void unmount(c)
})
```

- [ ] **Step 2: Run** `bun test:client tests/client/shared/ui/PageHeader.test.ts` — expect FAIL (no test-id rendered).

- [ ] **Step 3: Implement.** In `client/shared/ui/PageHeader.svelte`, add `titleTestId` to `Props` and to the destructure, and apply it to the title div:

```svelte
  interface Props {
    title: string
    eyebrow?: string
    sub?: string
    action?: Snippet
    titleTestId?: string
  }

  let { title, eyebrow, sub, action, titleTestId }: Props = $props()
```

```svelte
    <div class="ui-page-header__title" data-testid={titleTestId}>{title}</div>
```

(Svelte omits the attribute entirely when `titleTestId` is `undefined`.)

- [ ] **Step 4: Run** the test file — expect PASS. Run the existing PageHeader tests too — still green.

- [ ] **Step 5: Update the story (optional but keep parity).** No new story required; existing stories still valid.

- [ ] **Step 6: Commit**

```bash
git add client/shared/ui/PageHeader.svelte tests/client/shared/ui/PageHeader.test.ts
git commit -m "feat(client/ui): add optional titleTestId prop to PageHeader" -- client/shared/ui/PageHeader.svelte tests/client/shared/ui/PageHeader.test.ts
```

---

## Task 2: `StatsPanel` header → `PageHeader`

**Files:**

- Modify: `client/admin/components/StatsPanel.svelte` (header block, lines 172-189; import; drop `.stats-panel__header` style if now unused)
- Test: `tests/client/admin/StatsPanel.test.ts`

Current header:

```svelte
<header class="stats-panel__header">
  <div>
    <p class="eyebrow">Anonymous analytics</p>
    <h2 data-testid="admin-section-title">Stats</h2>
  </div>
  <div class="stats-panel__controls">
    <Seg options={[...WINDOWS]} value={dashboard.statsWindow} onChange={onWindowChange} />
    <Btn variant="secondary" size="sm" onClick={() => { void loadStats() }} disabled={loading}>
      {#snippet children()}{loading ? 'Refreshing…' : 'Refresh'}{/snippet}
    </Btn>
    {#if error !== null}
      <span class="status-error" data-testid="stats-error">{error}</span>
    {/if}
  </div>
</header>
```

- [ ] **Step 1: Extend the failing test.** In `tests/client/admin/StatsPanel.test.ts`, add (reuse the file's mount helper):

```ts
test('renders the Stats header via PageHeader (single title, no duplicate <h2> sibling)', () => {
  // mount StatsPanel as the file already does
  const titleEl = target.querySelector('[data-testid="admin-section-title"]')
  expect(titleEl?.textContent).toBe('Stats')
  expect(target.querySelector('.ui-page-header')).not.toBeNull()
  // the old hand-rolled header class is gone
  expect(target.querySelector('.stats-panel__header')).toBeNull()
})
```

- [ ] **Step 2: Run** the file — expect FAIL (`.ui-page-header` absent, `.stats-panel__header` present).

- [ ] **Step 3: Refactor.** Add the import to the script block:

```ts
import PageHeader from '../../shared/ui/PageHeader.svelte'
```

Replace the `<header>…</header>` block with:

```svelte
<PageHeader eyebrow="Anonymous analytics" title="Stats" titleTestId="admin-section-title">
  {#snippet action()}
    <Seg options={[...WINDOWS]} value={dashboard.statsWindow} onChange={onWindowChange} />
    <Btn variant="secondary" size="sm" onClick={() => { void loadStats() }} disabled={loading}>
      {#snippet children()}{loading ? 'Refreshing…' : 'Refresh'}{/snippet}
    </Btn>
    {#if error !== null}
      <span class="status-error" data-testid="stats-error">{error}</span>
    {/if}
  {/snippet}
</PageHeader>
```

Then delete the now-unused `.stats-panel__header` and `.stats-panel__controls` style rules (PageHeader provides the flex layout; verify no other markup references them — grep the file).

- [ ] **Step 4: Run** the file — expect PASS, including the existing `stats-error` and window-change tests.

- [ ] **Step 5: Commit**

```bash
git add client/admin/components/StatsPanel.svelte tests/client/admin/StatsPanel.test.ts
git commit -m "fix(admin): render Stats header via PageHeader (B1)" -- client/admin/components/StatsPanel.svelte tests/client/admin/StatsPanel.test.ts
```

---

## Task 3: `SystemSection` header → `PageHeader`

`SystemSection` is the literal double-title (`eyebrow "System"` + `h2 "System"`). Drop the eyebrow — the title alone matches the sidebar label.

**Files:**

- Modify: `client/admin/sections/SystemSection.svelte` (header block, lines 49-60)
- Test: `tests/client/admin/SystemSection.test.ts` (extend; create if absent following the `StatsPanel.test.ts` mount pattern)

Current header:

```svelte
<header class="system-header">
  <div>
    <p class="eyebrow">System</p>
    <h2 data-testid="admin-section-title">System</h2>
  </div>
  <button type="button" data-testid="system-refresh" onclick={() => { void refreshAll() }}>{fetching ? 'Refreshing...' : 'Refresh'}</button>
</header>
```

- [ ] **Step 1: Write/extend the failing test.** Assert the duplicate is gone and the title survives:

```ts
test('renders a single System title via PageHeader with no duplicate eyebrow', () => {
  // mount SystemSection
  expect(target.querySelector('[data-testid="admin-section-title"]')?.textContent).toBe('System')
  expect(target.querySelector('.ui-page-header')).not.toBeNull()
  // no element renders "System" twice: caption eyebrow removed
  expect(target.querySelector('.ui-caption')).toBeNull()
  // refresh control still present
  expect(target.querySelector('[data-testid="system-refresh"]')).not.toBeNull()
})
```

> If an existing test asserts an eyebrow with text `System`, update it — that test was asserting the B1 bug. Keep the `system-refresh` assertion.

- [ ] **Step 2: Run** — expect FAIL (no `.ui-page-header`).

- [ ] **Step 3: Refactor.** Add `import PageHeader from '../../shared/ui/PageHeader.svelte'`. Replace the `<header>` block with:

```svelte
<PageHeader title="System" titleTestId="admin-section-title">
  {#snippet action()}
    <button type="button" data-testid="system-refresh" onclick={() => { void refreshAll() }}>{fetching ? 'Refreshing...' : 'Refresh'}</button>
  {/snippet}
</PageHeader>
```

(The raw `<button>` is kept verbatim here; its `Btn` conversion is the B2 sweep in Phase 2.4.) Remove the `.system-header` style rule if it existed (none is defined in the current `<style>`, so likely nothing to remove — verify).

- [ ] **Step 4: Run** — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add client/admin/sections/SystemSection.svelte tests/client/admin/SystemSection.test.ts
git commit -m "fix(admin): render System header via PageHeader, drop duplicate eyebrow (B1)" -- client/admin/sections/SystemSection.svelte tests/client/admin/SystemSection.test.ts
```

---

## Task 4: `InstancesSection` header → `PageHeader`

**Files:**

- Modify: `client/admin/sections/InstancesSection.svelte` (header block, lines 274-283)
- Test: `tests/client/admin/InstancesSection.test.ts` (extend; create if absent)

Current header:

```svelte
<header class="admin-section-header">
  <div>
    <p class="eyebrow">Runtime</p>
    <h2 data-testid="admin-section-title">Instances</h2>
  </div>
  <Btn variant="secondary" size="sm" onClick={() => void refreshAll()}>
    {#snippet children()}{loading ? 'Refreshing...' : 'Refresh'}{/snippet}
  </Btn>
</header>
```

- [ ] **Step 1: Extend the failing test:**

```ts
test('renders the Instances header via PageHeader', () => {
  // mount InstancesSection (the file mocks fetchers; reuse its setup)
  expect(target.querySelector('[data-testid="admin-section-title"]')?.textContent).toBe('Instances')
  expect(target.querySelector('.ui-page-header')).not.toBeNull()
  expect(target.querySelector('.admin-section-header')).toBeNull()
})
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Refactor.** Add `import PageHeader from '../../shared/ui/PageHeader.svelte'`. Replace the `<header>` block with:

```svelte
<PageHeader eyebrow="Runtime" title="Instances" titleTestId="admin-section-title">
  {#snippet action()}
    <Btn variant="secondary" size="sm" onClick={() => void refreshAll()}>
      {#snippet children()}{loading ? 'Refreshing...' : 'Refresh'}{/snippet}
    </Btn>
  {/snippet}
</PageHeader>
```

`.admin-section-header` is a shared class in `client/admin/admin.css`; do not delete the CSS rule (other code may use it) — just stop using it here.

- [ ] **Step 4: Run** — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add client/admin/sections/InstancesSection.svelte tests/client/admin/InstancesSection.test.ts
git commit -m "fix(admin): render Instances header via PageHeader (B1)" -- client/admin/sections/InstancesSection.svelte tests/client/admin/InstancesSection.test.ts
```

---

## Task 5: `PluginConfigSection` header → `PageHeader`

**Files:**

- Modify: `client/admin/sections/PluginConfigSection.svelte` (header block, lines 37-48)
- Test: `tests/client/admin/PluginConfigSection.test.ts` (extend; create if absent)

Current header:

```svelte
<header class="plugin-config-header">
  <div>
    <p class="eyebrow">Plugins</p>
    <h2 data-testid="admin-section-title">Plugin Config</h2>
  </div>
  <button type="button" data-testid="plugin-config-refresh" onclick={() => { void load() }}>{fetching ? 'Refreshing...' : 'Refresh'}</button>
</header>
```

- [ ] **Step 1: Extend the failing test:**

```ts
test('renders the Plugin Config header via PageHeader', () => {
  // mount PluginConfigSection
  expect(target.querySelector('[data-testid="admin-section-title"]')?.textContent).toBe('Plugin Config')
  expect(target.querySelector('.ui-page-header')).not.toBeNull()
  expect(target.querySelector('[data-testid="plugin-config-refresh"]')).not.toBeNull()
})
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Refactor.** Add `import PageHeader from '../../shared/ui/PageHeader.svelte'`. Replace the `<header>` block with:

```svelte
<PageHeader eyebrow="Plugins" title="Plugin Config" titleTestId="admin-section-title">
  {#snippet action()}
    <button type="button" data-testid="plugin-config-refresh" onclick={() => { void load() }}>{fetching ? 'Refreshing...' : 'Refresh'}</button>
  {/snippet}
</PageHeader>
```

(Raw `<button>` kept verbatim; `Btn` conversion is the B2 sweep in 2.4. The inner `<h3>Plugin configuration</h3>` in `PluginConfigForm` is removed in Phase 2.4 / B7.) Remove the `.plugin-config-header` style rule if one is defined in this file (none currently — verify).

- [ ] **Step 4: Run** — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add client/admin/sections/PluginConfigSection.svelte tests/client/admin/PluginConfigSection.test.ts
git commit -m "fix(admin): render Plugin Config header via PageHeader (B1)" -- client/admin/sections/PluginConfigSection.svelte tests/client/admin/PluginConfigSection.test.ts
```

---

## Task 6: Phase 2.2 gate

**Files:** none (verification only).

- [ ] **Step 1:** `bun test:client` — all pass (ignore one unrelated `ECONNREFUSED`). Pay attention to `AdminApp.test.ts`/`scrollspy` tests that query `admin-section-title`.
- [ ] **Step 2:** `bun typecheck` — no errors.
- [ ] **Step 3:** `bun check:bundle-isolation` — exit 0.
- [ ] **Step 4:** `bun build:client` — bundles build.
- [ ] **Step 5 (optional):** `bun storybook` / preview — confirm each section shows exactly one title with its eyebrow (System shows just "System"), and refresh controls sit at the header's right edge.

No commit — gate over Tasks 1–5.

---

## Self-Review (completed during authoring)

- **Spec coverage:** B1 across the four still-affected sections (StatsPanel, SystemSection, InstancesSection, PluginConfigSection) → Tasks 2–5; the `data-testid` contract preserved via the Task 1 `PageHeader` enhancement.
- **Placeholder scan:** complete before/after for every header; the only adaptation is reusing each test file's existing mount/fixture setup (grounding against real component wiring, not a placeholder).
- **Type consistency:** `PageHeader` `action` is `Snippet` (Phase 1) — every action snippet uses `{#snippet action()}`; new `titleTestId?: string` prop matches its single consumer call sites; `Btn`/`Seg` props unchanged.
- **Scope boundary recorded:** inner redundant headings and raw-button→`Btn` conversions are explicitly deferred to 2.3/2.4 so this phase stays B1-only.
