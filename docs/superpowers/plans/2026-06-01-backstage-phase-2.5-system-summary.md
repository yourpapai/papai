<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Backstage Phase 2.5 — System Summary (B6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stacked `<dl>` system-summary block in `client/admin/sections/SystemSection.svelte` with the kit `SummaryList`, rendering aligned key/value rows (label left, value right, hairline separators) and status-style values as pills (finding B6).

**Architecture:** Single consumer-side swap in one file. The `system` data and refresh flow are unchanged; only the summary body markup changes.

**Tech Stack:** Bun, Svelte 5 (runes), TypeScript (strict), `bun:test` + happy-dom.

**Spec:** `docs/superpowers/specs/2026-06-01-backstage-admin-ui-fixes-design.md` (§7 finding B6).

**Depends on:** Phase 1 (`SummaryList`, which itself uses `StatusPill`), Phase 2.2 (`SystemSection` header already on `PageHeader`).

---

## Conventions

- **TDD write-hook**: test-first, run Red, refactor Green.
- Run client suite: `bun test:client` (ignore one unrelated `ECONNREFUSED`).
- `.svelte` local TS imports use `.js`. No `lint-disable`/`ts-ignore`. `bun format <files>` before commit if needed.
- **Commit SCOPED** to `master`. NEVER touch `.opencode/plugins/tdd-enforcement.ts` or `tests/opencode-tdd-enforcement.test.ts`.

---

## Task 1: `SystemSection` summary → `SummaryList`

**Files:**

- Modify: `client/admin/sections/SystemSection.svelte` (the `system summary` Panel body, lines 66-81; `<style>`)
- Test: `tests/client/admin/SystemSection.test.ts` (extend; created/extended in Phase 2.2)

Current summary body:

```svelte
<Panel title="system summary">
  {#snippet body()}
    <div class="system__summary">
      {#if system === null}
        <span class="placeholder">Loading...</span>
      {:else}
        <dl data-testid="system-summary">
          <div><dt>Chat provider</dt><dd>{system.chatProvider}</dd></div>
          <div><dt>Task provider</dt><dd>{system.taskProvider}</dd></div>
          <div><dt>Debug server</dt><dd>{boolLabel(system.debugServer)}</dd></div>
          <div><dt>Admin user</dt><dd>{system.adminUserSet ? 'Configured' : 'Missing'}</dd></div>
        </dl>
      {/if}
    </div>
  {/snippet}
</Panel>
```

- [ ] **Step 1: Extend the failing test.** In `tests/client/admin/SystemSection.test.ts`, mount `SystemSection` with `fetchAdminSystem` mocked to return `{ chatProvider: 'telegram', taskProvider: 'unknown', debugServer: true, adminUserSet: true }`, and assert the kit summary renders aligned rows with a pill:

```ts
test('renders the system summary via SummaryList with aligned rows and pills (B6)', async () => {
  // mount SystemSection (mock fetchAdminSystem/fetchAdminLlm as the file already does), await load
  expect(target.querySelector('.ui-summary')).not.toBeNull()
  expect(target.querySelectorAll('.ui-summary__row').length).toBe(4)
  // a status-style value renders as a pill (e.g. debug server "Enabled")
  expect(target.querySelector('[data-testid="system-summary"] .ui-pill')).not.toBeNull()
  // the old definition-list is gone
  expect(target.querySelector('dl[data-testid="system-summary"]')).toBeNull()
})
```

> Reuse the Phase 2.2 mock/mount setup in this file. If `fetchAdminSystem`/`fetchAdminLlm` are not yet mocked there, mock them via `mock.module('../../../client/admin/fetchers.js', …)` before importing the component, returning the shapes above plus a minimal `AdminLlmSnapshot` (read `client/shared/api-types.ts`).

- [ ] **Step 2: Run** `bun test:client tests/client/admin/SystemSection.test.ts` — expect FAIL (`.ui-summary` absent).

- [ ] **Step 3: Refactor.** Add the import:

```ts
import SummaryList from '../../shared/ui/SummaryList.svelte'
```

Replace the `system summary` Panel body with:

```svelte
<Panel title="system summary">
  {#snippet body()}
    <div class="system__summary">
      {#if system === null}
        <span class="placeholder">Loading...</span>
      {:else}
        <div data-testid="system-summary">
          <SummaryList
            cols={2}
            items={[
              { k: 'chat provider', v: system.chatProvider },
              { k: 'task provider', v: system.taskProvider, pill: true },
              { k: 'debug server', v: boolLabel(system.debugServer), pill: true },
              { k: 'admin user', v: system.adminUserSet ? 'Configured' : 'Missing', pill: true },
            ]} />
        </div>
      {/if}
    </div>
  {/snippet}
</Panel>
```

The `data-testid="system-summary"` moves to the wrapper `div` (preserving the contract). `boolLabel` is still used and stays in the script. In `<style>`, keep `.system__summary` (still the padded container); `SummaryList` supplies the row layout/separators, so no `<dl>`/`<dt>`/`<dd>` rules are needed (there were none defined locally — verify).

- [ ] **Step 4: Run** — expect PASS. Re-run the Phase 2.2 header test in the same file to confirm no regression.

- [ ] **Step 5: Visual check (preview/Storybook).** Confirm the four rows align (label left in `--fg3`, value right), hairline separators between rows, two-column layout, and `task provider`/`debug server`/`admin user` render as pills (e.g. `unknown` mute, `Enabled`/`Configured` accent).

- [ ] **Step 6: Commit**

```bash
git add client/admin/sections/SystemSection.svelte tests/client/admin/SystemSection.test.ts
git commit -m "fix(admin): render system summary via SummaryList (B6)" -- client/admin/sections/SystemSection.svelte tests/client/admin/SystemSection.test.ts
```

---

## Task 2: Phase 2.5 gate

**Files:** none (verification only).

- [ ] **Step 1:** `bun test:client` — all pass (ignore one unrelated `ECONNREFUSED`).
- [ ] **Step 2:** `bun typecheck` — no errors.
- [ ] **Step 3:** `bun check:bundle-isolation` — exit 0.
- [ ] **Step 4:** `bun build:client` — bundles build.

No commit — gate over Task 1.

---

## Phase 2 completion check (after 2.1–2.5)

With 2.5 done, every `/admin` finding from spec §7 is addressed: A1/A4 (2.1), A2/A3/A5/A6/C1 guards (2.1), B1 (2.2), B2/B3/B4/B5 in Instances (2.3), A7/B2/B3/B4/B7/C2 elsewhere (2.4), B6 (2.5), D1/C3 already-fixed (noted in 2.1). The remaining spec scope is **Phase 3** — sweeping `/debug` and `client/settings/` for the same anti-patterns (raw `<button>`/`<input>`, `JSON.stringify` cells, plain-text status, stacked KV) using the kit components now proven in `/admin`.

---

## Self-Review (completed during authoring)

- **Spec coverage:** B6 → Task 1 (the only remaining `/admin` finding not covered by 2.1–2.4).
- **Placeholder scan:** complete before/after; the only adaptation is reusing the file's mock/mount setup (grounding against real types), not a placeholder.
- **Type consistency:** `SummaryList` `items: {k, v, pill?, vColor?}[]` and `cols` match the Phase 1 component; `pill: true` routes the value through `StatusPill` (`.ui-pill`), consistent with the test assertion. `boolLabel` returns `'Enabled'`/`'Disabled'`, which `statusTone` maps to accent/mute.
