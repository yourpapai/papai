<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0252: MembersSection UX Fixes

## Status

Implemented (with divergence)

## Date

2026-07-03

## Context

The Members settings section (`client/settings/sections/MembersSection.svelte`) had a cluster of UX findings surfaced by the review in `docs/ux-reviews/MembersSection.md`: Remove revoked group access with no confirmation and no in-flight feedback, the loading state was indistinguishable from empty, Add gave no pending signal and allowed double-submit, errors were detached from the action that caused them, `added_at` rendered as raw ISO, the add-form layout was inert, the Remove/refresh affordances read as non-interactive, and members were shown as raw platform ids with no human context.

The design (`docs/superpowers/specs/2026-07-03-memberssection-ux-fixes-design.md`) and plan (`docs/superpowers/plans/2026-07-03-memberssection-ux-fixes.md`) decomposed the fix into three risk-layered, independently-shippable units: (1) the section's own client behavior plus a small shared `Confirm` enhancement, (2) two affordance fixes (destructive Remove variant, shared `IconButton` resting contrast), and (3) a backend name-enrichment path for the members GET. This ADR is the reference implementation for the **keep-open + busy + inline-error** Confirm-dialog pattern that ADR-0249 later retrofitted onto the other settings sections.

## Decision Drivers

- **Confirmation before destructive Remove.** Row "Remove" must open a shared `Confirm` dialog and stay open through the async delete, surfacing the outcome in context rather than revoking access immediately.
- **Split errors by action.** Add/load errors stay near the add form; Remove errors render **inside** the confirmation dialog, on a separate channel from the top-level `error`.
- **Distinct loading vs. empty.** The first fetch must show a real "Loading…" placeholder, not the empty "No members" state; a refresh with existing rows must not flicker.
- **In-flight feedback + double-submit guard.** Add (and the remove confirm) must disable their buttons and swap to a pending label while the request is in flight.
- **Shared `Confirm` gains a `busy` prop.** Needed so the persistent remove dialog can signal in-flight work and block a double-confirm; backwards compatible (default `false`).
- **Human-readable member labels, best-effort.** Members GET is enriched via a hybrid cache→live resolver reached through the existing runtime chat-router singleton — no router dependency threaded through `handleGroupRoutes`. Name resolution can never fail the members GET.
- **DI-first tests, `p-limit` bounded concurrency.** The resolver is pure and dependency-injected; live calls are bounded per the repo concurrency rule.

## Considered Options

### Option 1 — Three risk-layered units; keep-open Confirm with `busy`; hybrid cache→live enrichment (chosen)

Unit 1 rewrites `MembersSection.svelte` behavior and adds an optional `busy` prop to the shared `Confirm`; Unit 2 swaps Remove to the `danger` variant and bumps `IconButton` resting contrast; Unit 3 enriches the members GET with display labels via a new pure `resolveMemberLabels` resolver (cache hits win, misses fall back to bounded live calls, failures yield `null`). Enrichment is reached through the existing `getRuntimeChatRouter()` singleton, mirroring the `resolveSettingsUserId` pattern already in `group-routes.ts`.

- **Pros:** client fixes land immediately and independently of the backend; the keep-open dialog shows outcomes in context; the `busy` prop is reusable and backwards compatible; best-effort enrichment degrades gracefully to raw ids; pure resolver is trivially testable via DI; no new persisted global display-name table.
- **Cons:** three units across client + shared primitives + backend; the live `resolveUserLabel` path is operator-cost (chat-platform API calls per cache miss); enrichment adds latency to the members GET even when only cached labels are available.

### Option 2 — Inline per-row error rendering; auto-confirm Remove

Render errors per-row instead of inside a dialog, and remove members immediately on row click (no confirmation).

- **Pros:** smaller surface; one fewer shared-primitive change; lower click count for a confident admin.
- **Cons:** rejected in the design — a destructive, irreversible access revocation with no confirmation is the headline High finding; per-row error rendering was considered and rejected in favor of split add-form/dialog placement.

### Option 3 — A new persisted global display-name table

Resolve labels by writing/reading a dedicated display-name store rather than reusing `group_user_observations` + live `resolveUserLabel`.

- **Pros:** single source of truth; no live API cost.
- **Cons:** rejected in the design — a new persisted global display-name table does not exist today and the design deliberately avoids adding one; the hybrid resolver reuses existing stores and a live fallback that is never worse than the raw id.

## Decision

All three units shipped. What shipped:

1. **Shared `Confirm` `busy` prop (Unit 1).** `client/shared/Confirm.svelte` gains an optional `busy` (default `false`) that disables both footer buttons, blocks Modal close, and swaps the confirm button to "Working…".
2. **MembersSection client behavior (Unit 1).** Remove is gated behind a `Confirm` dialog that stays open through the async delete and surfaces `removeError` in its body; `add()` gains an `adding` flag (disables the button, "Adding…" label, double-submit guard); a loading guard renders "Loading…" before the first fetch resolves; `added_at` is formatted via the shared `formatDateTime`; the top error gains spacing and the add row gains a section-local layout.
3. **Affordances (Unit 2).** Row Remove swaps to the `danger` `Btn` variant; the shared `IconButton` resting contrast is raised.
4. **Backend name enrichment (Unit 3).** `getGroupUserObservationLabels` batch-reads cached display labels from `group_user_observations`; a pure `resolveMemberLabels` resolver does cache→(bounded) live→`null`; `handleMembersGet` becomes async and enriches both `user_label` and `added_by_label`; the client `GroupMemberSchema` gains nullable label fields; `MembersSection` renders the label as primary with the raw id as a secondary muted line.

## Consequences

### Positive

- A destructive group-member removal now requires explicit confirmation and reports its outcome in context — the keep-open + busy + inline-error pattern this ADR establishes became the reference for the ADR-0249 cross-section Confirm retrofit.
- Loading is visually distinct from empty; Add and Remove both signal in-flight work and block double-submit.
- Members are shown with human-readable labels when resolvable, and never worse than the raw id otherwise; enrichment is best-effort and cannot fail the members GET.
- The pure `resolveMemberLabels` resolver is fully DI-testable; the shared `Confirm` `busy` prop is reusable by every other section at zero cost.

### Negative

- **Enrichment adds GET latency.** Every members GET now resolves labels (cache + any live misses) before responding, even when the caller only needs ids.
- **Live resolution is operator-cost.** Each cache miss is a chat-platform API call, bounded by `p-limit(5)` but with no rate limiting beyond concurrency.
- **The implementation diverges from the plan** in module layout, the `IconButton` color target, and the provider-name resolution path — see Implementation Notes.

### Risks

- **Live `resolveUserLabel` availability depends on the runtime chat-router singleton.** When the router is absent the endpoint returns members with `null` labels (best-effort), so the UX degrades to raw ids rather than failing.
- **`IconButton` contrast ripples across every section header.** The shared change required a cross-section visual re-check; the shipped target is brighter than the plan specified.

## Related Decisions

- **ADR-0249: Confirm-Dialog Retrofit and Schema Dedup** — retrofitted the keep-open + busy + inline-error Confirm-dialog pattern (established here) onto the other settings sections; MembersSection was its reference implementation.
- **ADR-0248: ProfileSection UX Fixes**, **ADR-0250: Group Provider Section UX Fixes**, **ADR-0251: GuestModeSection UX Fixes** — sibling `2026-07-02`/`2026-07-03` settings-section UX-fixes ADRs that share the loading-guard, in-flight-feedback, and confirm-before-destructive conventions.
- The `CodeHostSection.svelte` confirm/loading-guard pattern that this section's Remove flow and loading guard mirror.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `client/shared/Confirm.svelte:20,22,28-35` | Optional `busy` prop (default `false`); disables both footer `Btn`s, blocks Modal close (`onClose={busy ? () => {} : onCancel}`), swaps confirm label to "Working…". | `read` confirms. |
| `client/settings/sections/MembersSection.svelte:28-31` | `adding`/`pendingRemove`/`removing`/`removeError` reactive state. | `read` confirms. |
| `client/settings/sections/MembersSection.svelte:47-63` | `add()` guards with `if (adding) return`, sets `adding`, captures `ctx`, double-submit-safe. | `read` confirms. |
| `client/settings/sections/MembersSection.svelte:65-89` | `requestRemove` opens the dialog; `confirmRemove` stays open through the async delete, sets `removeError` on failure, closes only on success. | `read` confirms. |
| `client/settings/sections/MembersSection.svelte:141-165` | `{#if loading && members.length === 0}` "Loading…" guard wrapping the table; refresh-with-rows keeps the table visible. | `read` confirms. |
| `client/settings/sections/MembersSection.svelte:147` | Row Remove `Btn variant="danger"`. | `read` confirms. |
| `client/settings/sections/MembersSection.svelte:150-159` | `member-cell` renders `user_label ?? user_id` primary with raw id secondary when a label exists; `added_by_label ?? added_by`. | `read` confirms. |
| `client/settings/sections/MembersSection.svelte:107` | `added_at: formatDateTime(m.added_at)` via `client/shared/helpers.js`. | `read` confirms. |
| `client/settings/sections/MembersSection.svelte:167-181` | `Confirm` with `busy={removing}`, `danger`, `removeError` rendered inside the body (`data-testid="member-remove-error"`). | `read` confirms. |
| `client/settings/sections/MembersSection.svelte:184-201` | Scoped `.members-error` / `.members-add` / `.member-cell` / `.member-cell__raw` styles. | `read` confirms. |
| `client/shared/ui/IconButton.svelte:38,43` | Resting color bumped to `var(--text)`; hover rule also keyed to `var(--text)`. | `read` confirms. |
| `src/group-settings/registry.ts:200-219` | `getGroupUserObservationLabels(provider, contextId, userIds)` batch query via `inArray`; empty-input fast path. | `read` confirms. |
| `src/debug/settings/member-labels.ts:17-42` | `resolveMemberLabels` — cache hits win, misses fall back to `p-limit(5)` live calls, rejections yield `null`; never throws. | `read` confirms. |
| `src/debug/settings/member-enrichment.ts:24-51` | `enrichMembers` best-effort enrichment; `BareMember`/`EnrichedMember` types; bare-id fallback; structured `log.warn` on catch. | `read` confirms. |
| `src/debug/settings/group-routes.ts:25,58-64,237` | Imports `enrichMembers`; `handleMembersGet` is async and enriches; GET dispatch returns the promise directly. | `read`/`grep` confirm. |
| `client/settings/fetcher-schemas.ts:195-201` | `GroupMemberSchema` gains `user_label`/`added_by_label` (`z.string().nullish()`); `GroupMembersResponseSchema` wraps them. | `read` confirms. |
| `tests/client/shared/Confirm.test.ts` | `busy`-prop test (created) — disables both footer buttons; not-busy leaves them enabled. | `glob` confirms. |
| `tests/client/settings/sections/MembersSection.test.ts:196,221,255,266,291` | Adding/double-submit, failed-remove-in-dialog, danger variant, display-label-primary, loading-placeholder cases. | `grep` confirms. |
| `tests/client/settings/member-schema.test.ts` | Nullable label-field schema acceptance/back-compat test (created). | `glob` confirms. |
| `tests/group-settings/member-observation-labels.test.ts` | Batch label-read test (created). | `glob` confirms. |
| `tests/debug/settings/member-labels.test.ts` | `resolveMemberLabels` DI tests — cache hit, cache-miss→live, live-reject→`null`, live-null (created). | `glob` confirms. |
| `tests/visual/settings/sections/MembersSection.spec.ts:53,60` | "remove confirmation open" + "loading is distinct from empty" visual states. | `grep` confirms. |

Plan-vs-implementation notes:

- **`enrichMembers` was extracted to its own module.** The plan placed `enrichMembers`, `resolveProviderName`, and the `BareMember`/`EnrichedMember` types inline in `src/debug/settings/group-routes.ts`; the shipped tree moves them to a new `src/debug/settings/member-enrichment.ts` imported at `group-routes.ts:25`. Intent unchanged; `handleMembersGet` (`group-routes.ts:58-64`) is a thin async wrapper.
- **`resolveProviderName` was simplified.** The plan resolved the provider name router-first via `resolveSourceProviderName(router, platformInstanceId)` with a `getPlatformInstance(...)?.type` fallback; shipped (`member-enrichment.ts:19-21`) reads only `getPlatformInstance(platformInstanceId)?.type` and drops the router-first `resolveSourceProviderName` path. The enrichment catch also gained a structured `log.warn` not in the plan.
- **`IconButton` resting color was bumped higher than planned.** The plan specified `var(--text-muted)` → `var(--fg2)`; shipped (`IconButton.svelte:38`) uses `var(--text)` (the brightest foreground token) for both resting and hover. A more aggressive contrast bump than designed.
- **`confirmRemove` was restructured with an `ok` flag.** The plan cleared `pendingRemove = null` inside the `try` on success; shipped (`MembersSection.svelte:70-89`) sets `ok = true` in the `try`, resets `removing` in `finally`, then clears `pendingRemove` and reloads only when `ok` — so the in-flight flag is reset before the reload and the dialog closes only on success. Functionally equivalent to the plan.
- **`add()` captures the context id.** The plan referenced `contextId` directly; shipped captures `const ctx = contextId` for the add + reload (`MembersSection.svelte:52-57`), a small race-safety improvement.

The source plan `docs/superpowers/plans/2026-07-03-memberssection-ux-fixes.md` and design `docs/superpowers/specs/2026-07-03-memberssection-ux-fixes-design.md` are archived alongside this ADR to `docs/archive/`.
