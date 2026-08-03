<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design — MembersSection UX fixes

**Date:** 2026-07-03
**Source review:** [`docs/ux-reviews/MembersSection.md`](../../ux-reviews/MembersSection.md)
**Component:** `client/settings/sections/MembersSection.svelte` (+ shared primitives + group-members backend)

## Goal

Resolve the findings from the MembersSection UX review across all three layers they touch:
the section's own behavior, the shared UI primitives it leans on, and the backend that feeds
it. The work is decomposed into three isolated, independently-shippable units so the
user-visible client fixes land immediately and the riskier backend change is quarantined.

## Findings → units map

| Review finding                                         | Severity | Unit |
| ------------------------------------------------------ | -------- | ---- |
| Remove revokes access with no confirmation             | High     | 1    |
| Loading state indistinguishable from Empty             | Med      | 1    |
| Add gives no in-flight feedback / allows double-submit | Med      | 1    |
| Error detached from the action that caused it          | Med      | 1    |
| `added_at` raw ISO timestamp                           | Med      | 1    |
| Add-form `align-items: end` inert; button undersized   | Low      | 1    |
| Ghost "Remove" / faint refresh read as non-interactive | Low      | 2    |
| Raw ids (`u1`, `admin`) with no human context          | Low      | 3    |

## Decisions (locked during brainstorming)

- **Scope:** all three layers — client behavior, shared primitives, backend name resolution.
- **Error placement:** split by action. Add/load errors stay near the add form (top of
  section) with proper spacing; Remove errors surface **inside the confirmation dialog**.
- **Name resolution:** hybrid — read the `group_user_observations` cache first, fall back to
  a live `resolveUserLabel` call for cache misses, fall back to the raw id if both fail.
- **Structure:** three isolated units, layered by risk (Approach A). Units 1 and 2 are
  client-only and ship first; Unit 3 (backend) follows independently.

---

## Unit 1 — `MembersSection.svelte` client behavior

Self-contained; no backend dependency. Everything below is inside
`client/settings/sections/MembersSection.svelte` unless noted.

### New reactive state

- `adding: boolean` — in-flight flag for the add request.
- `removing: boolean` — in-flight flag for the delete request.
- `pendingRemove: { userId: string; label: string } | null` — the member awaiting
  confirmation; non-null drives the `Confirm` dialog open.
- `removeError: string | null` — error channel scoped to the remove dialog, kept separate
  from the existing top-level `error` (which continues to serve load + add).

### Remove flow (High)

Row "Remove" stops calling `remove()` directly. It sets
`pendingRemove = { userId, label }`, which opens a shared `Confirm` dialog — mirroring the
pattern at `client/settings/sections/CodeHostSection.svelte:250-261`:

- `danger`, `confirmLabel="Remove"`.
- Body: _"Remove {label} from this group? They'll lose access to the bot here."_
- On confirm the dialog **stays open** through the async call so the outcome is shown in
  context: `removing = true` → `removeGroupMember(...)` → on success clear `pendingRemove`
  and reload; on failure set `removeError` (rendered inside the dialog body) and leave the
  dialog open for retry.

`label` is `user_label ?? user_id` once Unit 3 lands; until then it is `user_id`.

### Shared `Confirm.svelte` enhancement

`Confirm` currently fires `onConfirm` and lets the parent toggle `open`; it has no busy
state. Add an optional `busy?: boolean` prop (default `false`) that disables both footer
buttons and shows the confirm button as pending while the parent's async op runs. Backwards
compatible — existing callers are unaffected. Needed so the persistent remove dialog can
signal in-flight work and block a double-confirm.

### Add flow (Med)

`add()` guards with `if (adding) return`, wraps the request in `adding = true` /
`finally adding = false`. The submit button binds `disabled={adding}` and renders
`{adding ? 'Adding…' : 'Add member'}` (the `Btn` `disabled` prop already exists).

### Loading state (Med)

Replace the always-rendered table with the guard used by `CodeHostSection`:

```svelte
{#if loading && members.length === 0}
  <p class="placeholder">Loading…</p>
{:else}
  <!-- add form + DataTable -->
{/if}
```

First load shows a real "Loading…" line instead of "No members"; a refresh with existing
rows keeps the table visible (no flicker), and the header `⟳` still spins via its `busy`
binding.

### Error split (Med)

- Load/add errors keep the top-of-section `status-error` line (the add form is right there),
  but gain vertical rhythm from a `--gap-*` token so they stop crowding the field label.
  This matches the app-wide convention (`CodeHostSection.svelte:164` also renders errors at
  the section top).
- Remove errors render from `removeError` **inside** the `Confirm` dialog body.

### Date format (Med)

Import `formatDateTime` from `client/shared/helpers.js` (`:41`) and map `added_at` through it
when building `memberRows`, so the column shows a readable timestamp instead of raw ISO.

### Form alignment (Low)

Give the add row a **section-local** layout rather than relying on the shared
`.settings-form { align-items: end }` (`settings.css:38-44`), which is inert here because the
full-width field drops the button to its own line. The input and "Add member" button should
share one clean alignment edge with the hint below, without modifying the shared
`.settings-form` class that other sections depend on.

---

## Unit 2 — Shared affordance

Split by blast radius.

### Remove button → `danger` variant (local to MembersSection)

Swap the row Remove `Btn` from `variant="ghost"` to `variant="danger"`. The `danger` variant
already exists (`Btn.svelte:82-86`: transparent background, `--danger` text, subtle
`rgba(232,92,92,0.3)` resting border), giving the control a visible resting border and
destructive coloring at zero new CSS.

### Refresh glyph contrast (shared primitive — ripples)

`IconButton.svelte:38` uses `color: var(--text-muted)` at rest, flagged as low-contrast on
the dark theme. Bump the resting color one step (e.g. to `--fg2`). Because `IconButton`
renders in many section headers, this change **requires a cross-section Storybook re-check**
to confirm it reads well elsewhere and does not make other headers noisy. That verification
is part of this unit.

---

## Unit 3 — Backend name enrichment (hybrid)

The heavyweight. Structured to keep the DB layer (`src/groups.ts`) pure and isolate the
resolution logic behind a testable interface.

### New resolver unit

`src/debug/settings/member-labels.ts`, exporting:

```ts
resolveMemberLabels(contextId: string, userIds: string[], deps: MemberLabelDeps):
  Promise<Map<string, string | null>>
```

1. **Cache pass** — look up `group_user_observations` (`displayLabel` / `username`, keyed
   `(provider, contextId, userId)`) via a small new query helper. Zero API cost.
2. **Live pass** — for cache misses, call
   `chatProvider.resolveUserLabel(userId, { contextId, contextType: 'group', platformInstanceId })`,
   bounded with `p-limit` (repo concurrency rule) since each is a chat-platform API call.
3. **Fallback** — unresolved → `null`, so the client shows the raw id (never worse than
   today).

The resolver needs `(provider, platformInstanceId)` derived from the group `contextId`. The
exact helper that performs `contextId → (provider, platformInstanceId)` is the main open
implementation detail to confirm during planning (`group_user_observations` already stores
`provider`; the live call needs `platformInstanceId`).

### Route change

`handleMembersGet` (`src/debug/settings/group-routes.ts:57-61`) becomes `async` and receives
an injected `MemberLabelResolver` threaded from the settings-server composition root through
`handleGroupRoutes`. It enriches each member's `user_id` **and** resolves `added_by`. This
dependency wiring is the bulk of the backend work; `src/groups.ts` stays a pure DB module.

Enrichment is **best-effort**: if resolution throws, the endpoint still returns members with
raw ids. Name resolution can never fail the members GET.

### Schema

`GroupMemberSchema` (`client/settings/fetcher-schemas.ts:186`, and its server-side
counterpart) gains:

- `user_label: string | null`
- `added_by_label: string | null`

Nullable = fallback to raw id. Frontend and backend schemas updated in lockstep.

### Client render

- Column "User ID" → "Member": show `user_label ?? user_id` as primary, with the raw id as a
  secondary muted line **when a label exists**.
- "Added by" shows `added_by_label ?? added_by`.

Additive over Unit 1 — because the label fields are nullable, Unit 1 ships and behaves
correctly without this unit.

---

## Testing

All three test surfaces already exist and are extended, not created:
`tests/client/settings/sections/MembersSection.test.ts`,
`tests/debug/settings/group-routes.test.ts`,
`tests/visual/settings/sections/MembersSection.spec.ts`.

### Unit 1

- Extend `MembersSection.test.ts` (follow the existing section-test pattern): Remove is gated
  behind the dialog (no delete call until confirm); `adding` disables the button and blocks
  double-submit; loading is distinct from empty; remove-error surfaces in the dialog, not at
  the top; `added_at` renders formatted.
- Add visual states to `MembersSection.spec.ts`: confirm-open, "Adding…",
  loading-distinct-from-empty, remove-error-in-dialog.
- One small `Confirm.svelte` `busy`-prop test.

### Unit 2

- Re-shoot `MembersSection` (Remove now `danger`).
- Cross-section pass over other section headers that use `IconButton` to confirm the contrast
  bump reads well everywhere.

### Unit 3

- New unit tests for `resolveMemberLabels` via DI mocks: cache hit, cache-miss → live,
  live-fail → `null` fallback, and resolver-throws → endpoint still returns raw ids
  (best-effort isolation).
- Extend `group-routes.test.ts` for the enriched GET shape and the raw-id fallback.
- Schema acceptance/rejection tests for the nullable label fields.

## Sequencing

1. **Unit 1** — client behavior (immediate user value).
2. **Unit 2** — affordance (client-only; cross-section visual check).
3. **Unit 3** — backend enrichment (independent; the only unit that touches server + schema).

Units 1 and 2 are client-only and do not block on the backend. Each unit is verifiable on its
own.

## Out of scope

- **No new persisted global display-name table.** Name resolution is delivered by Unit 3's
  hybrid resolver reading existing stores (`group_user_observations` + live `resolveUserLabel`);
  none exists today and the design deliberately avoids adding one.
- **No unrelated refactoring** of `DataTable`, `Field`, `Input`, or the shared `.settings-form`
  class beyond the scoped changes above.
- **No inline per-row error rendering** (considered and rejected during brainstorming in favor
  of the split add-form / dialog error placement).
