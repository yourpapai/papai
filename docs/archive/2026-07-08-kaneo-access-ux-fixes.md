<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# KaneoAccessSection UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recompose `client/settings/sections/KaneoAccessSection.svelte` onto the shared design-system primitives so it resolves all 9 findings in [`docs/ux-reviews/KaneoAccessSection.md`](../../ux-reviews/KaneoAccessSection.md), with no backend/route/fetcher changes and no behavior change.

**Architecture:** Pure Svelte 5 presentation refactor of one `.svelte` file. The `<script>` logic (load / `revealPassword` / state) is unchanged; only the template markup and `<style>` block are replaced — raw `<h2>`/`<button>`/`<dl>`/`<a>`/`.error` become `PageHeader` + `KV` + `StatusPill` + `Btn` + `Code` + `CopyButton` + `ErrorState` + `EmptyState`. Two existing unit tests that couple to the old markup are updated to the new contract.

**Tech Stack:** Bun test runner (`bun:test`), Svelte 5 runes, `@crvy/strybk` visual screenshots via Playwright, oxfmt formatter. All UI primitives already exist under `client/shared/ui/`.

**Spec:** [`docs/superpowers/specs/2026-07-08-kaneo-access-ux-fixes-design.md`](../specs/2026-07-08-kaneo-access-ux-fixes-design.md)

---

## Background the engineer needs

- **This is a Svelte 5 component.** Props via `$props()`, state via `$state()`, snippets via `{#snippet name()}`. A component prop that is a snippet is passed by writing `{#snippet propName()}…{/snippet}` as a direct child of the component tag (see `client/shared/ui/KV.stories.svelte:27`).
- **`.js` import extensions are mandatory** even for `.ts`/`.svelte` source (project convention). Component imports use the real filename: `import KV from '../../shared/ui/KV.svelte'`.
- **Never add lint-disable / type-ignore comments** — the write hook blocks them.
- **Do not touch the `<script>` block logic or any file under `src/`.** Only the template + styles of one `.svelte` file and one test file change.
- **The section `id="kaneo-access"` MUST be preserved** — `SettingsApp.svelte:113` uses it as a nav scroll-target.
- **Primitive APIs (already read from source):**
  - `PageHeader` — props `title`, `eyebrow?`, `sub?`, `action?` (snippet), `titleTestId?`. Title renders as a styled `<div>`, not `<h2>` (matches every sibling).
  - `IconButton` — props `label`, `glyph`, `onClick?`, `busy?`, `testid?`.
  - `KV` — props `k` (string), `v` (`string | number | Snippet`), `sub?`, `vColor?`, `dim?`. Its `.ui-kv__v` value is `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` by default.
  - `StatusPill` — prop `status` (string); derives tone automatically (`active` → accent).
  - `Btn` — props `children` (snippet, required), `variant?` (`primary|secondary|outline|ghost|danger`), `size?` (`sm|md|lg`), `onClick?` (`() => void`), `disabled?`, `busy?`, `testid?`. Renders `<button data-testid={testid}>`; accessible name = children text.
  - `Code` — props `children` (snippet), `truncate?` (default `true`), `max?` (default `320`). Bordered mono box; `truncate={false}` lets it wrap.
  - `CopyButton` — props `value` (string), `label?` (default `'Copy'`). Copies to clipboard, shows ✓ for 2s.
  - `ErrorState` — props `message`, `title?` (default `'Something went wrong'`), `icon?`, `onRetry?` (`() => void`), `retryLabel?`. Renders `role="alert"`, danger-colored message.
  - `EmptyState` — props `title`, `icon?` (default `'∅'`), `hint?`, `action?` (snippet).
- **Tokens available (from `client/shared/tokens.css`):** `--accent: #52e08a`, `--bg: #0a0c0a`, `--fg3` (dim text), `--gap-field: 20px`, `--gap-inline: 12px`, `--font-mono`.

## File Structure

- **Modify:** `client/settings/sections/KaneoAccessSection.svelte` — replace template (lines 71–100 in current source) and `<style>` (there is currently no `<style>` block; add one). The `<script>` block (lines 6–69) is left byte-for-byte unchanged **except** its import list, which gains the new component imports.
- **Modify:** `tests/client/settings/sections/KaneoAccessSection.test.ts` — update the reveal-button selector (line 80) and the not-provisioned assertion (line 54).
- **No new files.** All primitives already exist.

## Reference: current relevant source

Current template to be replaced (`KaneoAccessSection.svelte:71–100`):

```svelte
<section id="kaneo-access">
  <h2>My Kaneo access</h2>
  {#if loading}
    <p>Loading…</p>
  {:else if notProvisioned}
    <p>Your Kaneo account is not provisioned in this group. Contact your group admin.</p>
  {:else if error !== null}
    <p class="error">{error}</p>
  {:else if credentials !== null}
    <dl>
      <dt>Login email</dt>
      <dd>{credentials.login}</dd>
      {#if credentials.kaneoUrl !== null}
        <dt>Workspace URL</dt>
        <dd><a href={credentials.kaneoUrl} target="_blank" rel="noopener noreferrer">{credentials.kaneoUrl}</a></dd>
      {/if}
      <dt>Status</dt>
      <dd>{credentials.status}</dd>
    </dl>

    {#if revealedPassword !== null}
      <p><strong>Password (shown once):</strong> <code>{revealedPassword}</code></p>
      <p>Store this password securely — it will not be shown again.</p>
    {:else}
      <button data-action="reveal-password" disabled={revealing} onclick={revealPassword}>
        {revealing ? 'Revealing…' : 'Reveal password'}
      </button>
    {/if}
  {/if}
</section>
```

Existing `<script>` state/functions that the new template consumes (unchanged): `contextId`, `credentials`, `notProvisioned`, `loading`, `error`, `revealedPassword`, `revealing`, `load(id)`, `revealPassword()`.

---

## Task 1: Recompose the component and update coupled tests

**Files:**

- Modify: `client/settings/sections/KaneoAccessSection.svelte:6-16` (imports), `:71-100` (template), add `<style>` at end
- Test: `tests/client/settings/sections/KaneoAccessSection.test.ts:54,80`

- [ ] **Step 1: Update the two markup-coupled unit tests to the new contract**

In `tests/client/settings/sections/KaneoAccessSection.test.ts`, change the not-provisioned assertion (line 54) from:

```ts
expect(target.textContent?.toLowerCase()).toContain('not provisioned')
```

to:

```ts
expect(target.textContent).toContain('No Kaneo access yet')
```

And change the reveal-button selector (line 80) from:

```ts
const btn = target.querySelector<HTMLButtonElement>('button[data-action="reveal-password"]')
```

to:

```ts
const btn = target.querySelector<HTMLButtonElement>('button[data-testid="kaneo-reveal"]')
```

- [ ] **Step 2: Run the suite to verify the two tests now FAIL against the current component**

Run: `bun test tests/client/settings/sections/KaneoAccessSection.test.ts`
Expected: FAIL — the "not provisioned" test fails (old copy lacks "No Kaneo access yet"); the reveal test fails (`btn` is `null`, so `expect(btn).not.toBeNull()` throws). This proves the tests exercise the new contract.

- [ ] **Step 3: Replace the component's import list**

In `client/settings/sections/KaneoAccessSection.svelte`, replace the imports at the top of `<script lang="ts">` (currently lines 7–10) so the block reads exactly:

```svelte
  import type { KaneoCredentials } from '../fetcher-schemas-kaneo.js'
  import { KaneoCredentialsSchema } from '../fetcher-schemas-kaneo.js'
  import { revealKaneoPassword, settingsFetch } from '../fetchers.js'
  import { readBody } from '../../shared/fetcher-helpers.js'
  import Btn from '../../shared/ui/Btn.svelte'
  import Code from '../../shared/ui/Code.svelte'
  import CopyButton from '../../shared/ui/CopyButton.svelte'
  import EmptyState from '../../shared/ui/EmptyState.svelte'
  import ErrorState from '../../shared/ui/ErrorState.svelte'
  import IconButton from '../../shared/ui/IconButton.svelte'
  import KV from '../../shared/ui/KV.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'
  import StatusPill from '../../shared/ui/StatusPill.svelte'
```

Leave everything else in `<script>` (the `Props` interface, all `$state`, `load`, `revealPassword`, `$effect`) unchanged.

- [ ] **Step 4: Replace the template (`<section>…</section>`) with the recomposed markup**

Replace the entire `<section id="kaneo-access"> … </section>` block with:

```svelte
<section id="kaneo-access" class="settings-section">
  <PageHeader eyebrow="Personal" title="My Kaneo access">
    {#snippet action()}
      <IconButton
        label="Refresh"
        glyph="⟳"
        busy={loading}
        onClick={() => void load(contextId)}
        testid="kaneo-refresh" />
    {/snippet}
  </PageHeader>

  {#if loading}
    <p class="placeholder">Loading…</p>
  {:else if notProvisioned}
    <EmptyState
      title="No Kaneo access yet"
      hint="Your account isn't provisioned in this group yet. Group members are set up automatically — if this persists, ask a group admin to add you." />
  {:else if error !== null}
    <ErrorState message={error} onRetry={() => void load(contextId)} />
  {:else if credentials !== null}
    <div class="kaneo-rows">
      <KV k="Login email" v={credentials.login} />
      {#if credentials.kaneoUrl !== null}
        <div class="kaneo-url">
          <KV k="Workspace URL">
            {#snippet v()}
              <a
                class="kaneo-url__link"
                href={credentials.kaneoUrl}
                target="_blank"
                rel="noopener noreferrer">{credentials.kaneoUrl}</a>
            {/snippet}
          </KV>
        </div>
      {/if}
      <KV k="Status">
        {#snippet v()}<StatusPill status={credentials.status} />{/snippet}
      </KV>
    </div>

    {#if revealedPassword !== null}
      <div class="kaneo-pw">
        <span class="kaneo-pw__label">Password (shown once)</span>
        <div class="kaneo-pw__row">
          <Code truncate={false}>{revealedPassword}</Code>
          <CopyButton value={revealedPassword} label="Copy password" />
        </div>
        <p class="placeholder">Store this password securely — it won't be shown again.</p>
      </div>
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
  {/if}
</section>
```

- [ ] **Step 5: Add the `<style>` block at the end of the file**

Append (the file currently has no `<style>` block):

```svelte
<style>
  .kaneo-rows {
    display: flex;
    flex-direction: column;
    gap: var(--gap-inline);
    margin-top: var(--gap-field);
  }
  /* URL row: let a long workspace host wrap instead of KV's default nowrap+ellipsis */
  .kaneo-url :global(.ui-kv__v) {
    white-space: normal;
    overflow: visible;
    text-overflow: clip;
  }
  .kaneo-url__link {
    color: var(--accent);
    overflow-wrap: anywhere;
  }
  .kaneo-pw {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: var(--gap-field);
  }
  .kaneo-pw__label {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg3);
  }
  .kaneo-pw__row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .kaneo-pw__reveal {
    margin-top: var(--gap-field);
  }
</style>
```

- [ ] **Step 6: Run the unit suite to verify it PASSES**

Run: `bun test tests/client/settings/sections/KaneoAccessSection.test.ts`
Expected: PASS — all 4 tests green (login email, not-provisioned copy, reveal-by-testid reveals `Secret1!Aa`, workspace URL present).

- [ ] **Step 7: Typecheck, lint, and format**

Run each and expect no errors (formatter may reflow the file):

```bash
bun run typecheck   # tsgo --noEmit
bun run lint        # oxlint
bun run format      # oxfmt --write
```

The pre-commit hook (`./scripts/check.sh --staged`, invoked automatically on `git commit`) additionally runs `format:check`, `lint`, `typecheck`, and `license-headers` on the staged files, so a clean commit confirms these pass.

- [ ] **Step 8: Commit**

```bash
git add client/settings/sections/KaneoAccessSection.svelte tests/client/settings/sections/KaneoAccessSection.test.ts
git commit -m "feat(settings): recompose KaneoAccessSection onto design-system primitives

Resolves the 9 UX-review findings: PageHeader header, KV/StatusPill rows,
accent-colored wrapping workspace URL, ErrorState for errors, EmptyState
for not-provisioned, and a Code + CopyButton one-time password reveal.
No backend/behavior change; updates two markup-coupled unit selectors."
```

---

## Task 2: Refresh and verify visual baselines

**Files:**

- Baselines under `.storybook-shots/settings/sections/KaneoAccessSection.spec.ts/` (git-ignored — not committed)
- Spec already present: `tests/visual/settings/sections/KaneoAccessSection.spec.ts` (Populated, Not provisioned, Error, Loading, password-revealed, hover, narrow)

- [ ] **Step 1: Ensure Storybook is running**

Run (in a separate terminal if not already up): `bun storybook`
Expected: serves on `http://localhost:6006` (verify with `curl -s -o /dev/null -w "%{http_code}" http://localhost:6006` → `200`).

- [ ] **Step 2: Re-shoot the Kaneo states**

Run: `bun shoot -g KaneoAccessSection`
Expected: 8 tests pass; PNGs rewritten under `.storybook-shots/settings/sections/KaneoAccessSection.spec.ts/`.

- [ ] **Step 3: Eyeball the key states against the design**

Use the Read tool on these PNGs and confirm each matches the spec:

- `settings-sections-KaneoAccessSection-Populated-1.png` — PageHeader "My Kaneo access" with "Personal" eyebrow + Refresh icon; KV rows with distinct label/value tiers; workspace URL in accent green (not default blue); status as a pill.
- `Populated-—-password-revealed-1.png` — password in a bordered mono `Code` box with a copy (⧉) button and the "shown once" line.
- `Error-1.png` — centered `ErrorState` with a ⚠ icon, danger-red message, and a "Try again" button (not tiny grey text).
- `Not-provisioned-1.png` — centered `EmptyState` "No Kaneo access yet" + hint.
- `Populated-—-narrow-1.png` (640px) — rows and URL reflow without horizontal overflow.

Expected: all match. If a state looks wrong, fix the component and re-run Steps 2–3 (this is verification, not a fix loop for the review itself).

- [ ] **Step 4: No commit**

Baselines are git-ignored; nothing to commit for this task. Confirm with `git status --short` that only ignored `.storybook-shots` paths (if any) show, and no tracked file is dirty.

---

## Self-review notes (author)

- **Spec coverage:** all 9 findings map to Task 1 steps — §1 shell (findings 1, 5) → Step 4 PageHeader; §2 states (findings 2, 7, 8) → Step 4 ErrorState/EmptyState/`.placeholder`; §3 rows (findings 4, 5, 6, 9) → Steps 4–5 KV/StatusPill/accent link/wrap; §4 reveal (finding 3) → Step 4 Code+CopyButton; §5 interaction (dims 2, 9) → Btn/IconButton usage. Verified visually in Task 2.
- **Behavior preserved:** `<script>` logic untouched; the `404 → notProvisioned`, error, and reveal paths keep the same state machine. The two test edits are selector/copy only, not behavior.
- **Type/name consistency:** component/prop names (`KV.v` snippet, `Btn.children` snippet, `Code.truncate`, `CopyButton.value`, `ErrorState.message/onRetry`, `EmptyState.title/hint`, `StatusPill.status`) match the source signatures listed in Background. The reveal button's `data-testid` is `kaneo-reveal` in both the component (Step 4) and the test (Step 1).
