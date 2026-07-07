<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design — CodingIdentitySection UX fixes

**Date:** 2026-07-07
**Source review:** [`docs/ux-reviews/CodingIdentitySection.md`](../../ux-reviews/CodingIdentitySection.md)
**Target file:** `client/settings/sections/CodingIdentitySection.svelte`
**Scope:** all 8 findings from the review (2 High · 4 Med · 2 Low)

## Problem

The UX review of `CodingIdentitySection` (the group setting that controls whose coding
credentials run a group's sessions) found 8 issues. The section hand-rolls its form
(raw `<select>`, one-off CSS, ad-hoc error text) instead of following the pattern the
sibling settings sections already use. The most serious consequence: after a failed
initial load the form still renders, interactive, defaulting to "Initiator", so a Save
silently overwrites the group's real (now-unknown) policy.

## Goal

Bring `CodingIdentitySection` in line with the established `TaskProviderSection` pattern.
Every finding is resolved as a side effect of adopting that pattern. Single component file
changes; **no backend, schema, or fetcher changes** — the members API already returns
`user_label` (`GroupMemberSchema.user_label`, `client/settings/fetcher-schemas.ts:182`).

## Approach

**Chosen: in-place rewrite to the sibling template.** Rewrite the component to use the
same structure as `client/settings/sections/TaskProviderSection.svelte`: a top-level
`error / loading / loaded` render gate, shared `Field` + `Select` primitives,
`formatFetchError`, `ErrorState` with retry, a busy Save label, and a `status-success`
line.

**Rejected: extract a shared `SectionState` gating wrapper.** No such wrapper exists today
(siblings inline the pattern); building one is scope creep beyond a per-section fix and
would touch unrelated sections.

## Reference primitives (already in the codebase)

- `client/shared/ui/Field.svelte` — uppercase mono label, wires label id to the inner
  control, renders an `error` prop as a `role="alert"` red message and a `hint` prop as
  neutral helper text.
- `client/shared/ui/Select.svelte` — styled select on `--raised`, 2px radius, mono 12px,
  custom caret, **green** `:focus-within` ring (`rgba(82,224,138,.4)`).
- `client/shared/ui/ErrorState.svelte` — centered `role="alert"` panel with icon, message,
  and an optional retry `Btn` (`onRetry` / `retryLabel`).
- `client/shared/format-error.js` — `formatFetchError(err)` maps thrown fetch errors to
  short plain-language messages (validation statuses keep server text).
- `.status-success`, `.status-error`, `.placeholder` — shared classes in
  `client/settings/settings.css`.

## Target component behavior

### State

Keep `policyKind`, `designatedUserId`, `members`, `loading`, `mutating`. Change/add:

- `error: unknown` — raw load error (replaces the current `string | null` + `messageFrom`);
  rendered through `formatFetchError`.
- `saveError: unknown` and `saveStatus: string | null` — inline feedback for the Save action.
- `loaded: boolean` — set true after the first successful load; distinguishes first-load
  (`loading && !loaded` → `Loading…`) from a post-save reload (form stays visible).
- Widen the `members` element type to include `user_label: string | null`.

### Derived

- `memberOptions = members.map(m => ({ value: m.user_id, label: m.user_label ?? m.user_id }))`
  — human names, raw id as fallback (matches `MembersSection.svelte:152`).
- `designatedEmpty = policyKind === 'designated' && designatedUserId === ''`.
- `POLICY_OPTIONS` — the three policy options as a `{ value, label }[]` constant (the same
  labels as today: Initiator / Shared / Designated with their explanations).

### Render gate (mirrors `TaskProviderSection.svelte:112`)

```
<section id="coding-identity" class="settings-section">
  <PageHeader eyebrow="Group" title="Coding session identity" />

  {#if error !== null}
    <ErrorState message={formatFetchError(error)} onRetry={() => void load(contextId)} />
  {:else if loading && !loaded}
    <p class="placeholder">Loading…</p>
  {:else}
    {#if saveError !== null}<p class="status-error" role="alert">{formatFetchError(saveError)}</p>{/if}
    {#if saveStatus !== null}<p class="status-success">{saveStatus}</p>{/if}

    <form class="settings-form" onsubmit={(e) => { e.preventDefault(); void save() }}>
      <Field label="Policy">
        <Select value={policyKind} options={POLICY_OPTIONS} onChange={onPolicyChange} testid="coding-identity-policy" />
      </Field>

      {#if policyKind === 'designated'}
        <Field label="Member" error={designatedEmpty ? 'Add a group member to use the Designated policy.' : undefined}>
          <Select value={designatedUserId} options={memberOptions} onChange={(v) => (designatedUserId = v)} testid="coding-identity-member" />
        </Field>
      {/if}

      <Btn variant="primary" type="submit" disabled={mutating || designatedEmpty} testid="coding-identity-save">
        {#snippet children()}{mutating ? 'Saving…' : 'Save'}{/snippet}
      </Btn>
    </form>

    <p class="settings-section__caption">…keep the existing Initiator/Shared/Designated explainer…</p>
  {/if}
</section>
```

### Behavioral notes

- **Save moves from the `PageHeader` action into the form** as a submit `Btn`, matching the
  dominant inline-primary pattern (TaskProvider / GroupProvider / Identity / Members). The
  `PageHeader` keeps only eyebrow + title (no action). Because Save now lives inside the
  `{:else}` branch, it cannot render in the error or loading states — this is what
  structurally fixes the High-1 overwrite bug.
- **Header Refresh is intentionally omitted.** `ErrorState`'s retry covers the failure path;
  a header `Refresh ⟳ IconButton` to fully match siblings is an optional future consistency
  add, not part of this change.
- **Member option label** is `user_label ?? user_id`. (Duplicate display names are possible
  but rare; disambiguating with `label (user_id)` was considered and deferred as noise.)
- `load()` keeps the parallel `fetchGroupCodingIdentity` + `fetchGroupMembers`; on success
  sets `loaded = true`. Any rejection sets `error` (either fetch failing puts the section in
  the error/retry state — consistent with `TaskProviderSection`).
- `save()` sets `mutating`, PATCHes via `patchGroupCodingIdentity`, then on success sets
  `saveStatus = 'Saved.'` and reloads; on failure sets `saveError`. `save()` should be a
  no-op guard when `designatedEmpty` (defense in depth beyond the disabled button).
- `onPolicyChange` and the member-change handler clear stale `saveStatus` / `saveError` so a
  prior "Saved." does not linger while the user edits.
- Delete all one-off `<select>` CSS and the `.coding-identity__controls` block; spacing,
  radius, and focus ring now come from `Field` / `Select`. Any remaining wrapper spacing
  uses `--gap-field` / `--gap-inline`.

## Finding-by-finding coverage

| #      | Finding                                  | Resolved by                                                                |
| ------ | ---------------------------------------- | -------------------------------------------------------------------------- |
| High-1 | Load-error form overwrites real policy   | Render gate — error branch shows `ErrorState` + retry, no form/Save        |
| High-2 | Designated dropdown shows raw ids (`u1`) | `memberOptions` label = `user_label ?? user_id`                            |
| Med-1  | Loading looks like a real value          | `loading && !loaded` → `Loading…` placeholder                              |
| Med-2  | Raw `<select>` + blue UA focus ring      | `Field` + `Select` primitives (green focus ring, token spacing)            |
| Med-3  | No success confirmation / no busy state  | `Saving…` button label + `status-success` "Saved."                         |
| Med-4  | "Designated" saveable with no member     | `designatedEmpty` disables Save + inline `Field` error hint                |
| Low-1  | Errors not announced / raw message text  | `ErrorState role="alert"` + `role="alert"` save-error + `formatFetchError` |
| Low-2  | Hardcoded spacing / radius / font        | One-off CSS removed; primitives supply token-based spacing                 |

## Tests, fixtures & stories

- **Populated fixture fix:** `settings-coding-identity-populated` currently uses
  `identity: 'alice'` (`client/stories/msw/settings-handlers-group.ts:116`), which silently
  misparses to "Initiator". Update it to a valid value (e.g. `designated:u1`) so the
  Populated story actually exercises the member dropdown.
- **Stories:** the existing Populated / Empty / Error / Loading stories keep working; the
  Error story now renders `ErrorState`. The 4 manual visual-spec states added during the
  review (designated-expanded, 640px, hover, focus) in
  `tests/visual/settings/sections/CodingIdentitySection.spec.ts` remain valid; re-shoot to
  refresh baselines.
- **Unit tests:** if a `CodingIdentitySection` component/unit test exists, update selectors —
  Save is now a submit `Btn`, and the load-error path renders `ErrorState` (with a
  `error-retry` testid) instead of an inline `<p>`. The implementation plan confirms and
  adjusts. Follow `tests/CLAUDE.md`.

## Out of scope

- Hardening `parseIdentity` against arbitrary unknown identity strings (data concern, not a
  UX finding).
- Any backend / schema / fetcher change.
- The other coding sections that share the raw-`<select>` pattern (`ReposSection`,
  `CodeHostSection`, `CodingCredentialsSection`, `admin/AdminCodingGuardrailsSection`) — a
  separate consistency sweep.
- Adding a header `Refresh` IconButton (optional future consistency add).
