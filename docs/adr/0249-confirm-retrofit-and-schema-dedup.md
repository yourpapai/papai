<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0249: Confirm-Dialog Retrofit and Schema Dedup

## Status

Implemented (with divergence)

## Date

2026-07-03

## Context

The MembersSection UX review (`docs/superpowers/plans/2026-07-03-memberssection-ux-fixes.md`) deferred two follow-ups, captured in `docs/superpowers/plans/2026-07-03-confirm-retrofit-and-schema-dedup.md`:

1. **Schema duplication.** The private `StoredConfigValueSchema` Zod base object was copied **byte-for-byte** into two modules — `client/settings/fetcher-schemas.ts` (backing `ConfigFieldSchema`/`ByokFieldSchema`/`CodingCredentialFieldSchema`/`PluginConfigFieldSchema`) and `client/settings/fetcher-schemas-admin.ts` (backing `ProviderTypeFieldSchema`). Two copies can silently drift; the settings and admin field schemas must stay in lock-step.
2. **Confirm-dialog inconsistency.** `client/shared/Confirm.svelte` already supported a `busy` prop, but most `Confirm` callers across the settings/admin SPA still used the old **fire-and-close** pattern: `onConfirm` closed the dialog immediately, the action ran in the background, and any failure surfaced only as a section-level error the user had likely navigated away from. `MembersSection.svelte` had just been rewritten to a **keep-open + busy + inline-error** pattern (`pendingRemove`/`removing`/`removeError`, `busy={removing}`, dialog-scoped error, close only on success). The rest of the app did not match.

The goal was a behavior-consistency pass: extract one shared base schema, and retrofit every `Confirm`-dialog caller to the MembersSection pattern so the whole settings/admin app has one confirmation behavior. `MembersSection.svelte` is the reference implementation.

## Decision Drivers

- **One source of truth for the stored-config-value shape.** The settings and admin schema modules must not diverge; a shared base keeps them decoupled (admin does not import main) while preventing drift.
- **Uniform confirmation UX.** A failed destructive/irreversible action should keep the confirm dialog open, show the error inline inside the dialog, and block backdrop/Escape/× dismissal while in flight — matching `MembersSection`, the established reference.
- **Mechanical, low-risk transformation.** `Confirm` already supports `busy`; the retrofit is a single recipe applied per-file, with no change to *which* actions are gated or to dialog copy.
- **Minimal entry guard.** The confirm handler guards on the in-flight flag (plus any pre-existing staleness/context check), not a broad `loading || saving` guard — the trigger button is already disabled during in-flight ops and the modal overlay blocks background interaction.
- **Keep admin↔main decoupled.** The shared schema module is consumed by both layers without creating a settings→admin or admin→settings import edge.

## Considered Options

### Option 1 — Shared base module + retrofit-all (chosen)

Extract `StoredConfigValueSchema` into `client/settings/fetcher-schemas-shared.ts`, consumed by both schema modules. Apply the keep-open + busy + inline-error recipe to all 13 enumerated `Confirm` instances across 12 section files, with dialog-scoped error state per section.

- **Pros:** single source of truth for the schema; one consistent confirmation behavior across the whole SPA; the recipe is mechanical and each file is independent; `Confirm` needs no change.
- **Cons:** touches 12 section files; per-section error state is additive (a new `*Error` per dialog) rather than a single shared error sink.

### Option 2 — Retrofit-on-touch (leave duplication, retrofit only when a section is next edited)

Defer the Confirm retrofit to whenever each section is next opened for other work; leave the duplicated schema in place.

- **Pros:** smallest immediate diff; no cross-cutting pass.
- **Cons:** rejected — the inconsistency is the bug; "on touch" leaves the majority of dialogs with the worse behavior indefinitely and the schema pair free to drift.

### Option 3 — Shared dialog-scoped error store instead of per-section error

Lift the inline error into a shared store/context consumed by every `Confirm`, instead of a per-section `$state`.

- **Pros:** one error sink, less repeated state.
- **Cons:** rejected — a shared dialog error couples unrelated sections, risks stale cross-dialog leakage, and breaks the per-dialog "clear on open" semantics the recipe requires; per-section state is simpler and matches `MembersSection`.

## Decision

The chosen Option 1 shipped in full. Item A is one shared module; Item B retrofitted all 13 enumerated `Confirm` callers. What shipped:

1. **Shared base schema (`client/settings/fetcher-schemas-shared.ts`).** `StoredConfigValueSchema` is exported once and imported by `fetcher-schemas.ts:10` and `fetcher-schemas-admin.ts:10`. The consuming field schemas are unchanged.
2. **Confirm recipe applied per-file.** Each section gained a dialog-scoped error `$state`, clears it on open, runs a keep-open async confirm handler (entry guard = in-flight flag + any existing staleness/context check), sets `busy={...}` on `<Confirm>`, renders `{#if *Error !== null}<p class="status-error">…` inside the dialog body, and closes only on success (`if (ok)` → clear pending → reload).
3. **Settings phase (B1–B4).** `CodeHostSection` (`clearing`/`clearError`), `PluginsSection` (`clearingKey`/`clearError`), `MemorySection` (`clearing`/`clearError`), `CodingCredentialsSection` (`clearing`/`clearError`).
4. **Admin phase (B5–B13).** `AdminInstancesSection` delete + stop (`deleting`/`deleteError`, `stopping`/`stopError`), `AdminAdminsSection` (`removing`/`removeError`), `AdminUsersSection` (`removing`/`removeError`), `AdminGroupsSection` (`removing`/`removeError`), `AdminPluginsConfigSection` (`clearing`/`clearError`), `AdminPluginsApprovalSection` (`rejecting`/`rejectError`), `AdminAnnounceSection` (`sending`/`sendError`), `AdminReleaseNotesSection` (`broadcasting`/`broadcastError`).
5. **Tests.** "A failed `<action>` keeps the confirm dialog open with an inline error" tests were added to every retrofit section that already had a test file (asserting `.modal` stays present and `.modal .status-error` appears). `AdminReleaseNotesSection` has no test file and follows the plan's "skip the test, keep the suite green" allowance.

## Consequences

### Positive

- Every enumerated destructive/irreversible confirmation now keeps the dialog open on failure, shows the error inline next to the action, and blocks dismissal while busy — matching `MembersSection`, so the settings/admin SPA has one consistent confirmation behavior.
- `StoredConfigValueSchema` exists once; settings and admin field schemas can no longer drift, with no new import edge between the layers.
- The retrofit is mechanical and each section is independent, so it was safe to land file-by-file in any order and to stop after any file.
- `Confirm` needed no change — its `busy` prop already no-ops backdrop/Escape/× and disables both buttons (`Confirm.svelte:28-34`).

### Negative

- Per-section dialog-scoped error state is additive (one new `$state` per dialog) rather than a single shared sink — more repetition, though it matches the reference and keeps dialogs isolated.
- The consistency goal is scoped to the 13 enumerated callers; one non-enumerated `Confirm` caller in a `components/` file retains the old pattern (see Divergence).

### Risks

- **The residual `ConfigFieldRow.svelte` caller is a latent inconsistency.** Any future pass that assumes "all Confirms are keep-open + busy" will find this one exception; it is a low-traffic clear-field confirmation but a user can still hit the fire-and-close path there.
- **Per-dialog error naming is by domain, not uniform.** (`clearError`/`deleteError`/`stopError`/`removeError`/`rejectError`/`sendError`/`broadcastError`.) Consistent in spirit, but a grep for a single error name will not find them all.

## Related Decisions

- **MembersSection UX Fixes** (sibling `2026-07-03` plan, `docs/superpowers/plans/2026-07-03-memberssection-ux-fixes.md`) — this plan's source: deferred review items #3 (schema dedup) and #4 (Confirm retrofit); `MembersSection.svelte` is the reference implementation. Being archived as its own ADR.
- **ADR-0187: Settings Page Redesign** — the settings-section conventions and the shared primitives (`Confirm`, `Btn`, `PageHeader`) these retrofits build on.
- **ADR-0233: Release Announcement Subscriptions** — owns `AdminReleaseNotesSection.svelte` / `AdminAnnounceSection.svelte`, whose broadcast confirms were retrofitted here (B12/B13).

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`; the schema-dedup commit message matches the plan verbatim.

| File | Role | Evidence |
| --- | --- | --- |
| `client/settings/fetcher-schemas-shared.ts:9-18` | Shared `StoredConfigValueSchema` base object. | `read` confirms. |
| `client/settings/fetcher-schemas.ts:10` | Imports the shared schema (was a local duplicate). | `grep` confirms. |
| `client/settings/fetcher-schemas-admin.ts:10` | Imports the shared schema (was a local duplicate). | `grep` confirms. |
| `client/settings/sections/MembersSection.svelte:29-31,66-86,168-179` | Reference pattern: `pendingRemove`/`removing`/`removeError`, `busy={removing}`, inline `.status-error`, close only on success. | `read` confirms. |
| `client/settings/sections/CodeHostSection.svelte:141-160,257-269` | B1: `confirmClear` keep-open (`if (clearing \|\| loadedContextId !== contextId) return`, `if (ok)` close), `busy={clearing}`, inline `clearError`. | `read` confirms. |
| `client/settings/sections/PluginsSection.svelte:192-204` | B2: object-pending `pendingClearKey`, `busy={clearingKey}`, inline `clearError`. | `read` confirms. |
| `client/settings/sections/MemorySection.svelte:317-329` | B3: `busy={clearing}`, inline `clearError`. | `read` confirms. |
| `client/settings/sections/CodingCredentialsSection.svelte:368-380` | B4: `busy={clearing}`, inline `clearError`. | `read` confirms. |
| `client/settings/sections/admin/AdminInstancesSection.svelte:196-220,227-251,428-454` | B5/B6: two Confirms — `confirmDelete` (`deleting`/`deleteError`) + `confirmStop` (`stopping`/`stopError`), both `if (ok)` close + reload. | `read` confirms. |
| `client/settings/sections/admin/AdminAdminsSection.svelte:158-170` | B7: `busy={removing}`, inline `removeError`. | `read` confirms. |
| `client/settings/sections/admin/AdminUsersSection.svelte:247-259` | B8: `busy={removing}`, inline `removeError`. | `read` confirms. |
| `client/settings/sections/admin/AdminGroupsSection.svelte:181-193` | B9: `busy={removing}`, inline `removeError`. | `read` confirms. |
| `client/settings/sections/admin/AdminPluginsConfigSection.svelte:152-164` | B10: `busy={clearing}`, inline `clearError`. | `read` confirms. |
| `client/settings/sections/admin/AdminPluginsApprovalSection.svelte:143-155` | B11: `busy={rejecting}`, inline `rejectError`. | `read` confirms. |
| `client/settings/sections/admin/AdminAnnounceSection.svelte:68-80` | B12: `busy={sending}`, inline `sendError`. | `read` confirms. |
| `client/settings/sections/admin/AdminReleaseNotesSection.svelte:147-159` | B13: `busy={broadcasting}`, inline `broadcastError`. | `read` confirms. |
| `client/shared/Confirm.svelte:20-34` | `busy` prop: no-ops `onClose` (`busy ? () => {} : onCancel`), disables both buttons, swaps label to "Working…". | `read` confirms. |
| `tests/client/settings/code-host-section.test.ts:475-490` | B1 failure-keeps-open test: asserts `.modal` stays + `.modal .status-error` after a failed clear. | `grep` confirms. |
| `tests/client/settings/sections/admin/AdminInstancesSection.test.ts:652-680` | B5/B6 failure-keeps-open tests for delete + stop. | `grep` confirms. |
| commit `fc3dc943b` | `refactor(settings): share StoredConfigValueSchema across schema modules` — matches the plan verbatim. | `git log -S` confirms. |
| commit `b9d3643bb` | `fix(settings): keep announce-confirm dialog open with inline error` (B12). | `git log --grep` confirms. |

Plan-vs-implementation notes:

- **13/13 enumerated Confirms retrofitted; all suggested flag names shipped verbatim.** The recipe's `BUSY`/`CONFIRM_ERROR` placeholders became per-file domain names (`clearingKey`, `deleting`/`stopping`, `rejecting`, `broadcasting`, …; `clearError`/`deleteError`/`stopError`/`removeError`/`rejectError`/`sendError`/`broadcastError`). Intent unchanged; naming is consistent within each section.
- **One residual non-retrofitted caller (out of plan scope).** `client/settings/components/ConfigFieldRow.svelte:184-192` still uses the old fire-and-close pattern (`onConfirm` sets `pendingClear = false` then fires `clearField()`, no `busy=`, no dialog-scoped error). It is a `components/` file, not one of the 12 enumerated `sections/` files, so it was outside the plan's explicit task list — but it leaves the plan's stated final-verification aspiration ("every `<Confirm>` under `client/settings/**` … now passes `busy`") one caller short. (`Confirm.stories.svelte` is a Storybook story, not a real caller.)
- **`AdminReleaseNotesSection` has no test file.** Per the plan's allowance ("where a section has no test file, skip the new test"), B13 shipped without a failure-keeps-open test; the retrofit itself (B13) is present.
- **CodeHostSection success-status is reload-guarded.** The plan set the success `status` unconditionally inside the `if (ok)` block; shipped sets it only `if (reloaded)` (`CodeHostSection.svelte:157-158`). Negligible refinement, no behavior change for the dialog contract.
- **Many non-enumerated section Confirms already pass `busy`.** Sections outside this plan's list (e.g. `KaneoAccessSection`, `ToolsSection`, `IdentitySection`) already carry `busy=` on their `<Confirm>` tags, so the broader app is largely consistent beyond the 13 retrofitted here.

The source plan `docs/superpowers/plans/2026-07-03-confirm-retrofit-and-schema-dedup.md` is archived alongside this ADR to `docs/archive/`.
