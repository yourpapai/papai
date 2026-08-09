<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0350: Repositories Section Clarity — Shared Primitives, Confirmed Delete, and Token-Based Spacing in ReposSection

## Status

Accepted

## Date

2026-08-01

## Context

The settings UI's `ReposSection` (`client/settings/sections/ReposSection.svelte`) manages the per-context coding-repository records (name, URL, base branch, permission preset, egress domains) that coding sessions consume. A UX review (`docs/ux-reviews/ReposSection.md`) found the section sat outside the design system its nine sibling sections already used: the permission-preset `<select>` and egress `<textarea>` were raw markup with one-off CSS, so they reached a screen reader unnamed, carried a mismatched fill and control height, and the preset options were listed least-to-most restricted. Deleting a repository was one unconfirmed click on a borderless ghost button. A context with zero repositories rendered nothing between the header and the add form, so a successful empty fetch was indistinguishable from a section that had not loaded. Three of five add-form fields gate the submit button with nothing marking which three, neither the status nor the error paragraph carried `role="status"`/`role="alert"`, errors surfaced the raw server string, and every gap, padding and radius in the scoped styles was a literal px value off the token scale (including `--fg3` text measuring ~3.96:1 contrast, under the AA floor).

All fixes were rendering-only changes to one Svelte component; no server, store, schema or route work. Design: `docs/superpowers/specs/2026-08-01-repositories-section-clarity-design.md`; plan: `docs/superpowers/plans/2026-08-01-repositories-section-clarity.md`.

## Decision Drivers

- **Route through shared primitives rather than patching raw markup.** Wrapping the two raw controls in `Select` and `Input multiline` resolves the accessible-name, one-off-fill and control-height findings in a single edit, because `Field`'s `aria-labelledby` contract and the shared `--raised` fill and control height come with the primitives.
- **The primitive migration lands first.** Every later task (required markers, hints, layout) then applies to a section that already matches the design system, avoiding editing the same `Field` blocks twice.
- **Destructive actions use the shared `Confirm` dialog.** The dialog names the repository and carries the danger variant, matching how nine sibling sections present destructive actions; the row trigger keeps the 24px `sm` size because that is `--control-h-sm`, the target-size floor established by the control-height work (ADR-0344).
- **Copy must not assert what a permission preset grants.** The repo stores `permissionPreset` as an opaque string forwarded to magi; only relative ordering ("readonly is the most restricted, autonomous the least") is claimable, and the option order is arranged most-to-least restricted so the hint is verifiable by scanning.
- **Error copy is framed, not raw.** All three failure paths (load, add, delete) run through `formatFetchError`, which returns the server's own message for 400/409/422 and canned copy otherwise, so a raw 500 body like `{"error":"boom"}` never reaches the DOM.
- **Do not modify shared primitives or global CSS.** Changes to `Field.svelte`, `Input.svelte`, `Select.svelte`, `PageHeader.svelte`, or `settings.css` would put the work outside the sub-project's scope and force a cross-SPA visual re-shoot; the `--fg3` → `--fg-hint` sweep across the remaining settings files stays deferred, scoped to this file only.

## Considered Options

### Option 1 — Migrate the section onto shared primitives and the shared form layout (chosen)

Replace the raw controls with `Select` / `Input multiline` inside `Field` with `hint`, gate delete behind `Confirm`, render `EmptyState` in the `{#each}` `{:else}` branch, mark the three mandatory `Field`s `required`, add `role="alert"`/`role="status"` to the feedback paragraphs, frame errors via `formatFetchError`, swap the hand-rolled add-form flex layout for the shared `.settings-form` class, and rewrite the scoped style block on spacing/radius/color tokens.

- **Pros:** one edit closes multiple accessibility findings; the section can no longer drift from the design system on these axes; `flex: 1 1 180px` lets wrapped fields fill their row instead of truncating beside unused width; existing testids are preserved so component and visual tests keep working.
- **Cons:** known gaps in the shared primitives (the required `*` has no text alternative, no `aria-required` on the control, no hint-describedby wiring) are inherited unchanged — fixing them was explicitly deferred to avoid a cross-SPA re-shoot.

### Option 2 — Patch the raw controls in place

Add `aria-label` attributes, hand-matched fills and heights, and reordered options to the existing raw `<select>`/`<textarea>` and their one-off CSS.

- **Pros:** no dependency on primitive behavior; smaller diff.
- **Cons:** duplicates what the primitives already provide, keeps three one-off style rules alive, and leaves the section able to drift again the next time the primitives change. Rejected.

### Option 3 — Fix the shared primitives first, then migrate

Add `aria-required`, a text alternative for the required marker, and hint-describedby wiring to `Field`/`Input`/`Select` as part of this change.

- **Pros:** closes the accessibility gaps at the root for every section at once.
- **Cons:** changes nine sibling sections' rendered output and forces a cross-SPA visual re-shoot, blowing the sub-project's scope boundary. Rejected — deferred with the other shared-primitive fixes.

## Decision

All behavior is client-side in `ReposSection.svelte`, with test changes in `tests/client/settings/repos-section.test.ts` and `tests/visual/settings/sections/ReposSection.spec.ts` (plus re-shot baselines):

1. **Primitives:** `Select` with a module-level `PRESET_OPTIONS` const ordered `readonly` → `cautious` → `autonomous` (default `cautious` unchanged), and `Input multiline rows={3}` for egress, each inside a `Field` carrying a `hint`. The three obsolete style rules (`__preset-select`, `__egress-input`, `__egress-help`) are deleted.
2. **Confirmed delete:** `pendingDeleteId: string | null` state; the row `Btn` becomes `variant="danger"` and only opens the dialog; `Confirm` renders with `danger`, `busy={deletingId !== null}`, and a body naming the repository. `pendingDeleteId` is cleared in `handleDelete`'s `finally` (not on success) so a failed delete does not strand the dialog open over an unreadable error. The dialog's confirm/cancel buttons are selected via `.modal .ui-btn--danger` / `.ui-btn--secondary` — no testid is added to the shared component.
3. **Empty state:** `EmptyState` in the `{#each}` `{:else}` branch ("No repositories connected"), with a negative test pinning that a populated context renders no `.ui-empty`.
4. **Required markers, announced status, framed errors:** the Name / Repository URL / Base branch `Field`s gain `required`; the feedback paragraphs gain `role="alert"` / `role="status"`; all three catch blocks use `formatFetchError(err)`.
5. **Shared layout and tokens:** the add panel switches from `.settings-repos__add-form` to `.settings-form` (with a scoped `#repos .settings-form { margin-bottom: 0 }` override that Svelte's scoping keeps from leaking), the whole style block moves to `--gap-*` / `--radius-control` / `--fg-hint` tokens, rows and the panel gain `--radius-control`, and a note under the form states that branch, preset and egress are fixed at creation. The visual spec gains a delete-confirm-dialog state and all baselines are re-shot.

## Rationale

The primitives already encode the labelling contract, fill, and control height the raw controls were missing, so routing through them is the smallest change that cannot silently regress those properties later. The `finally`-placement of the `pendingDeleteId` clear is the minimal correct behavior: clearing on success would leave the dialog open with `busy` off on the failure path, with the error rendered behind the modal overlay. Adopting `.settings-form` deletes a hand-rolled layout nine sections already share, and its specificity (two classes plus an id) beats the global rule without `!important`. Two source-review requests were deliberately declined and documented as such: no retry button beside the load error (`PageHeader`'s Refresh is already in the section), and no second status channel or timeout on the success message — it is a confirmation, not a toast, and `role="status"` is the actual fix for the announcement gap.

## Consequences

### Positive

- Both form controls sit inside shared-primitive wrappers with `aria-labelledby`, matching fill, and shared control height.
- No repository row can be deleted without a dialog that names it; the trigger now visually reads as destructive.
- An empty context renders a labelled empty state instead of a blank gap.
- Screen readers hear load/add/delete outcomes via `role="alert"`/`role="status"`, and required fields are marked.
- The section's spacing, radius, and hint color come from tokens; `--fg3` no longer appears in the file and its sub-AA contrast is gone from this section.
- The preset option order itself verifies the most-to-least-restricted hint.
- Visual baselines cover the new dialog state; preserved testids kept all pre-existing selectors valid.

### Negative

- Known shared-primitive gaps (required `*` without text alternative, no `aria-required`, no hint-describedby wiring) remain in this section until the deferred root fix lands.
- The dialog needs more than one `drain()` cycle to close in tests because `finally` runs after `await load(contextId)` resolves — test code must account for this.
- The `--fg3` → `--fg-hint` fix is scoped to this file; the remaining settings files and admin SPAs still carry the sub-AA color until the deferred sweep.

### Risks

- If a future edit re-adds a local class without deleting its style rule, Svelte reports only an unused-CSS-selector warning, not an error. Mitigation: the plan's acceptance greps for dead selectors and the visual baselines pin the rendered result.
- The delete-failure path leaves the dialog open by design; if the modal's overlay ever obscures the feedback paragraph, the error becomes unreadable. Mitigation: `Confirm`'s `busy` state and the `finally` clear keep the dialog consistent with the request lifecycle.

## Implementation Notes

- The `Confirm` body deliberately says nothing about what happens to already-running sessions — magi owns that behavior, not this repo.
- `.settings-repos__info` keeps its 2px intra-element gap: there is no 2px token, and it is leading rather than layout spacing.
- Svelte scopes component styles, so `#repos .settings-form` compiles with this component's scope class and cannot affect the nine sibling sections using `.settings-form`.
- Client tests require the browser conditions and DOM preload: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' ./tests/client/settings/repos-section.test.ts`; visual re-shoots require Storybook running (`bun shoot -g ReposSection`).
- Verification: the component suite (including the split delete open/confirm/cancel tests), re-shot baselines with an explicit expected-difference table, dead-selector and `--fg3` greps returning zero, and `bun run check:full`.
- Post-plan drift to be aware of when reading the current component: later commits added a `statusTimeoutMs` prop, an egress-domain preview, a separate add-form status channel, a load-error retry button (which this decision had declined), and renamed style tokens to `--surface-1` / `--text-dim`. The decisions recorded here remain the base layer those changes built on.

## Related Decisions

- ADR-0344: Control Height Token Scale and WCAG Floor Ratchet — established the `--control-h-sm` target-size floor that justifies keeping the `sm` delete button.
- ADR-0249: Confirm Retrofit and Schema Dedup — established the shared `Confirm` dialog and the danger-variant convention for destructive actions.
- ADR-0345: Settings Field Error Channel — sibling work on the settings feedback channels.
- ADR-0238 / ADR-0239: Storybook Agent Screenshot Pipeline / Settings Full Coverage — provide the visual-baseline workflow this change's re-shoot uses.

## References

- Plan: `docs/superpowers/plans/2026-08-01-repositories-section-clarity.md`
- Design: `docs/superpowers/specs/2026-08-01-repositories-section-clarity-design.md`
- Source review: `docs/ux-reviews/ReposSection.md`
- Implementation: `client/settings/sections/ReposSection.svelte`; tests `tests/client/settings/repos-section.test.ts`, `tests/visual/settings/sections/ReposSection.spec.ts`
- Commits: `15bff0412` (primitive routing), `e5d0fcbac` (confirm delete), `89e1c8c5b` (empty state), `7d3a331b9` (required fields + status channel), `e6e223424` (shared layout and tokens)
