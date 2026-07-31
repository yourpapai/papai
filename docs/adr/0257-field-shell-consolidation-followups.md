<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0257: Field Shell Consolidation Followups

## Status

Implemented (with divergence)

## Date

2026-07-06

## Context

ADR-0256 shipped `SettingsFieldShell` and routed `ConfigFieldRow`, `CodingCredentialsSection`, and (in adapted form) `ByokSection` through it. Its final review surfaced three leftovers, captured in the design (`docs/superpowers/specs/2026-07-06-field-shell-consolidation-followups-design.md`) and plan (`docs/superpowers/plans/2026-07-06-field-shell-consolidation-followups.md`):

- **A. Consolidation.** Two sections still carried their own hand-rolled `.settings-field*` markup/CSS outside the shell: `CodeHostSection` (`CodingCredentialsSection`'s near-exact twin — same `fetchCodingCredentials`/`patchCodingCredentials` with `namespace: 'forge'`, whole-record Save, Secret+Replace, Clear+Confirm) and `AdminPluginsConfigSection` (admin-only, per-field save, nested `plugin-block → keys`). Neither should own field-row markup.
- **B. Save-feedback bug.** A save whose PATCH succeeded but whose immediate reload failed rendered **both** a success line and an error line. Each section's `load()` returned `Promise<void>` and swallowed fetch errors, and the save handlers set the success `status` unconditionally after `await load()`.
- **C. Test gaps.** The `role`/dirty/double-label assertions the predecessor deferred, plus reload-failure coverage.

The fix for B was uniform: change `load()` to `Promise<boolean>` (`true` on success, `false` on the catch and the `id !== contextId` bail), and gate every success-status write on the boolean. The fix for A was the same shell migration already applied to the twin, plus section-level roles and dirty-state. The `SettingsFieldShell` component itself, and every HTTP route / Zod schema, were explicitly out of scope.

## Decision Drivers

- **No field-row markup outside the shell.** `CodeHostSection` and `AdminPluginsConfigSection` must stop carrying their own `.settings-field*` rules and `Field` wrappers; one `SettingsFieldShell` renders every settings-field row (Consolidation goal).
- **One label, by construction.** The shell renders exactly one label; the editor snippet takes a bare control with no wrapping `Field label=…`, eliminating the `VALUE`/`NEW VALUE` eyebrow (double-label finding).
- **Suppress the false success signal.** A successful PATCH whose reload fails must surface the reload error and **no** success line — the UI could not refresh to a confirmed state, so a success status would be dishonest (Part B root cause).
- **CodeHost matches its twin.** `CodeHostSection` gets the identical treatment `CodingCredentialsSection` already has: shell rows, `ErrorState`+retry, `role="alert"`/`role="status"`, whole-record dirty-state Save (Consolidation §2.1).
- **AdminPlugins keeps its badge, gains dirty-state.** The admin `required` badge is preserved (admin UX + existing test) rather than swapped for the shell's accent asterisk; per-field Save is disabled while the draft is blank, making the silent `if (value.trim() === '') return` guard visible (Consolidation §2.2).
- **Reload-safe by construction, end-to-end.** The `load()`→boolean change is verified by reload-failure tests per section, not just by the type checker.
- **Reuse, don't over-abstract.** A shared section component was rejected (CodeHost and CodingCredentials diverge in cross-field logic); the shell remains the correct dedup boundary.

## Considered Options

### Option 1 — Shell migration for both remaining sections + uniform `load()`→boolean status gating (chosen)

Migrate `CodeHostSection` and `AdminPluginsConfigSection` onto `SettingsFieldShell` with section-level roles/dirty-state; change every status-showing section's `load()` to `Promise<boolean>` and gate each success-status write on the boolean (reordering `confirmClear()` to reload before setting status).

- **Pros:** finishes the consolidation so no row markup drifts; kills the false-success bug at its root (the unconditional status write); reuses the twin's established pattern; the boolean return type surfaces any caller that ignores it.
- **Cons:** four sections' `load()` signatures change in lockstep; adding dirty-gating can disable a Save an existing test clicks without a prior change (mitigated by auditing each suite); ByokSection's planned per-field save path was already being rewritten away (see Divergence).

### Option 2 — Keep `load()` returning `void`; suppress the success line by clearing `status` on load error

Leave `load()` as `Promise<void>` and, in each save handler, clear `status` if `error` is set after the reload.

- **Pros:** no signature change; smaller diff.
- **Cons:** couples the save handler to `load()`'s internal `error` bookkeeping rather than to an explicit success/failure signal; fragile (a future `load()` edit that resets `error` differently silently reopens the bug); harder to assert end-to-end than a boolean return.

### Option 3 — Only migrate CodeHost; defer AdminPlugins and the save-fix

Ship just the CodeHost shell migration; leave AdminPlugins and the reload-fail bug for a later pass.

- **Pros:** smallest blast radius.
- **Cons:** leaves a known false-success bug in production and a second hand-rolled `.settings-field*` copy that will keep drifting from the shell; the test gaps the predecessor deferred remain.

## Decision

The chosen Option 1 shipped across both migrations, three of the four reload-safe saves, and the test coverage — with ByokSection's planned portion superseded by the concurrent provider-model rewrite (see Divergence). What shipped:

1. **`CodeHostSection` shell migration (`client/settings/sections/CodeHostSection.svelte`).** Imports `ErrorState`, `Select`, and `SettingsFieldShell`; the `Field` import is gone. Rows render through `<SettingsFieldShell label required editorOpen testid>` with `head` = masked Secret + Replace and `editor(labelId)` = a `{#if field.control === 'select'}` branch else a plain `Input` + Cancel-when-sensitive. Load failure renders `ErrorState`+retry; the unreadable and action-error lines carry `role="alert"`; the success line carries `role="status"`. The `instance_url` `shouldShowField` gate and `select`-defaulting `initialDrafts` are preserved.
2. **`CodeHostSection` whole-record dirty-state + reload-safe save.** `formDirty = $derived(fields.filter(shouldShowField).some(…))` gates the bottom Save (`disabled={!formDirty || saving || loading || clearing}`); `load()` is `Promise<boolean>`; `saveAll()` sets `'Code host saved.'` only when the reload returned `true`; `confirmClear()` was reordered to reload before setting `'Code host credentials cleared.'`.
3. **`AdminPluginsConfigSection` shell migration (`client/settings/sections/admin/AdminPluginsConfigSection.svelte`).** Imports `SettingsFieldShell`; the `Field` import is gone. Each key row renders through the shell with `testid="plugin-config-key-…"`; the `head` snippet keeps the masked `Secret` (or an `unset` placeholder) **plus the existing `<span class="badge-required">required</span>`** (the shell's accent-asterisk `required` prop is deliberately not used); the `editor` snippet drops the wrapping `<Field label="New value">`. `role="alert"`/`role="status"` added to the section status lines.
4. **`AdminPluginsConfigSection` per-field dirty-state + reload-safe save.** Per-field Save `disabled` while the draft is blank; `load()` is `Promise<boolean>`; `save()` sets the `updated.` status only on a successful reload; `confirmClear()` reloads before setting the `cleared.` status. CSS trimmed to `.plugin-block*`, `.settings-field-list`, `.badge-required`.
5. **`CodingCredentialsSection` reload-safe save (Task 1).** `load()` is `Promise<boolean>`; `saveAll()` gates `'AI provider saved.'` on the boolean; `confirmClear()` reordered to reload before `'AI provider credentials cleared.'`.
6. **`ByokSection` `load()`→boolean.** `load()` returns `Promise<boolean>` (the planned signature change). The planned per-field `save()` status-gating targeted a `patchByok` field-row model that the provider-model rewrite removed; see Divergence for the residual gap.
7. **Test coverage (Task 1–3).** CodeHost: dirty-gated Save, `ErrorState`+retry, `role="status"` success, double-label-gone, reload-fail (PATCH 200 then GET 500 → no success line + inline `role="alert"`), the conflicting "omits untouched token" test updated to edit first, plus an `aria-labelledby` bonus. AdminPlugins: blank-disabled Save, badge-present + double-label-gone, `role="alert"` on save error, reload-fail. CodingCredentials: `role="alert"` on failed save, reload-fail, plus an `aria-labelledby` bonus.

## Consequences

### Positive

- No settings-field row markup or `.settings-field*` CSS remains outside `SettingsFieldShell` in `CodeHostSection` or `AdminPluginsConfigSection` — verified by `grep` (no `settings-field__label`/`settings-field__head`/`import Field` in either file). The shell is now the single home for field-row structure across every consumer named in ADR-0256 and this ADR.
- `CodeHostSection` now matches its `CodingCredentialsSection` twin: shell rows, `ErrorState`+retry, aria roles, and whole-record dirty-state — so the two stop drifting.
- Three of the four status-showing sections (`CodingCredentialsSection`, `CodeHostSection`, `AdminPluginsConfigSection`) can no longer render a success line when their post-save reload fails; the honest reload error surfaces instead.
- AdminPlugins' silent blank-input guard became a visible disabled Save; the admin `required` badge is preserved.
- The double-label finding is gone from both migrations, asserted by the absence of `.ui-field__label`.

### Negative

- **The Part B fix did not reach `ByokSection`'s roles-save path.** The rewrite replaced the per-field `patchByok` save the plan targeted with `onSaveRoles()`, which still sets `'Role overrides saved.'` unconditionally after `await load(contextId)` (`ByokSection.svelte:192-193`). A successful role-bindings PATCH whose reload fails will therefore show both a success line and an error line — the exact bug Part B set out to kill. The planned Byok reload-fail test (which referenced the now-deleted `byok-input-main_model`/`byok-save-main_model` testids) did not ship.
- **Two save-flow idioms now coexist.** `CodingCredentialsSection`/`CodeHostSection`/`AdminPluginsConfigSection` use the gated `if (ok) status = …` convention; `ByokSection`'s `onSaveRoles()` uses the older unconditional form. Future edits must remember which sections are reload-safe.
- **Scoped-style ownership for `.settings-field*` is centralized.** A future shell-CSS edit ripples to every consumer and demands a baseline re-shoot.

### Risks

- **ByokSection reload-fail regression is unguarded by a test.** Because the planned Byok reload-fail test did not ship, nothing in the suite fails if `onSaveRoles()` keeps the unconditional status write; the bug is latent.
- **`patchByok` remains dead client code.** The per-field BYOK save the plan depended on is still exported (`client/settings/fetchers.ts:124`, re-exported from `fetchers.testing.ts:6-8`) but has no shipped client caller — a trap for anyone reviving the field model (carried over from ADR-0256).
- **CodeHost dirty-state on an unconfigured host.** `initialDrafts` defaults an empty `select` to its first option while the stored value is `''`, so an unconfigured host loads with `formDirty === true`. This is correct (the visible default genuinely differs from the unset stored value) and documented, but a future reader may misread it as "Save enabled for no reason."
- **Inline pass-through of raw backend errors.** The action-error line surfaces the raw backend message verbatim (acceptable because the user triggered the action).

## Related Decisions

- **ADR-0256: BYOK Settings Field Shell** — direct predecessor. It introduced `SettingsFieldShell`, migrated `ConfigFieldRow`/`CodingCredentialsSection`/`ByokSection`, and recorded the ByokSection provider-model rewrite that moots this ADR's Byok portion. This ADR finishes the consolidation 0256 started.
- **ADR-0255: AI Output UX Fixes** — established the `--focus-ring` token and `ConfigFieldRow` conventions the shell carries forward.
- **ADR-0253: ReleaseSubscriptionSection UX Fixes** — established the `ErrorState` / `Loading…` / content render-state convention these consumers reuse.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `client/settings/sections/CodeHostSection.svelte:11,16-17` | `ErrorState`, `Select`, `SettingsFieldShell` imported; no `Field` import. | `read` + `grep` confirm. |
| `client/settings/sections/CodeHostSection.svelte:67` | `load(id): Promise<boolean>`. | `read` confirms. |
| `client/settings/sections/CodeHostSection.svelte:46` | `formDirty = $derived(fields.filter(shouldShowField).some(…))`. | `read` confirms. |
| `client/settings/sections/CodeHostSection.svelte:128-129` | `saveAll()` gates `'Code host saved.'` on the reload boolean. | `read` confirms. |
| `client/settings/sections/CodeHostSection.svelte:157-158` | `confirmClear()` reordered: reload, then gate `'Code host credentials cleared.'`. | `read` confirms. |
| `client/settings/sections/CodeHostSection.svelte:183` | `ErrorState`+retry on initial load failure. | `read` confirms. |
| `client/settings/sections/CodeHostSection.svelte:177,186` / `:178` | `role="alert"` (action + unreadable) / `role="status"` (success). | `read` confirms. |
| `client/settings/sections/CodeHostSection.svelte:192-227` | Rows via `SettingsFieldShell`; `editor(labelId)` snippet. | `read` confirms. |
| `client/settings/sections/CodeHostSection.svelte:207` | `select` branch renders the shared `Select` primitive (divergence: plan wrote a raw `<select class="coding-select">`). | `read` confirms. |
| `client/settings/sections/CodeHostSection.svelte:249` | Save `disabled={!formDirty || saving || loading || clearing}`. | `read` confirms. |
| `client/settings/sections/CodeHostSection.svelte:272-280` | `<style>` trimmed to `.settings-byok-fields` + `.settings-field__actions` (no `.coding-select`). | `read` confirms. |
| `client/settings/sections/admin/AdminPluginsConfigSection.svelte:16` | `SettingsFieldShell` imported; no `Field` import. | `read` + `grep` confirm. |
| `client/settings/sections/admin/AdminPluginsConfigSection.svelte:31-44` | `load(): Promise<boolean>`. | `read` confirms. |
| `client/settings/sections/admin/AdminPluginsConfigSection.svelte:55-56` | `save()` gates the `updated.` status on the reload boolean. | `read` confirms. |
| `client/settings/sections/admin/AdminPluginsConfigSection.svelte:78-79` | `confirmClear()` gates the `cleared.` status on the reload boolean. | `read` confirms. |
| `client/settings/sections/admin/AdminPluginsConfigSection.svelte:95-96` | `role="alert"` / `role="status"` on status lines. | `read` confirms. |
| `client/settings/sections/admin/AdminPluginsConfigSection.svelte:103-142` | Key rows via `SettingsFieldShell`; `head` keeps the `Secret`/`unset` + `.badge-required`; `editor` is a bare `Input` + Save + Clear (no `Field` wrapper). | `read` confirms. |
| `client/settings/sections/admin/AdminPluginsConfigSection.svelte:125` | Per-field Save `disabled` while the draft is blank. | `read` confirms. |
| `client/settings/sections/admin/AdminPluginsConfigSection.svelte:167-187` | `<style>` trimmed to `.plugin-block*` / `.settings-field-list` / `.badge-required`. | `read` confirms. |
| `client/settings/sections/CodingCredentialsSection.svelte:108` | `load(id): Promise<boolean>`. | `read` confirms. |
| `client/settings/sections/CodingCredentialsSection.svelte:186-187` | `saveAll()` gates `'AI provider saved.'` on the reload boolean. | `read` confirms. |
| `client/settings/sections/CodingCredentialsSection.svelte:215-216` | `confirmClear()` reordered: reload, then gate `'AI provider credentials cleared.'`. | `read` confirms. |
| `client/settings/sections/ByokSection.svelte:79-98` | `load(id): Promise<boolean>` (the planned signature change shipped). | `read` confirms. |
| `client/settings/sections/ByokSection.svelte:192-193` | **Gap:** `onSaveRoles()` sets `'Role overrides saved.'` unconditionally after `await load(contextId)` — the Part B fix did not reach this path. | `read` confirms. |
| `tests/client/settings/code-host-section.test.ts:442-473` | "omits the untouched masked token" test updated to edit a field first (dirty-gating). | `read` confirms. |
| `tests/client/settings/code-host-section.test.ts:494-511` | Whole-record Save disabled→enabled (configured fixture). | `read` confirms. |
| `tests/client/settings/code-host-section.test.ts:513-524` | `ErrorState`+retry on load failure. | `read` confirms. |
| `tests/client/settings/code-host-section.test.ts:526-546` | Success line announced via `role="status"`. | `read` confirms. |
| `tests/client/settings/code-host-section.test.ts:548-559` | No `.ui-field__label` sub-label after migration. | `read` confirms. |
| `tests/client/settings/code-host-section.test.ts:561-582` | Reload-fail: PATCH 200 then GET 500 → no `p[role="status"]`, inline `p.status-error[role="alert"]`. | `read` confirms. |
| `tests/client/settings/code-host-section.test.ts:584-597` | Bonus: kind `select` gets an accessible name via `aria-labelledby`. | `read` confirms. |
| `tests/client/settings/sections/admin/AdminPluginsConfigSection.test.ts:261-275` | Save disabled until the key input is non-empty. | `read` confirms. |
| `tests/client/settings/sections/admin/AdminPluginsConfigSection.test.ts:277-286` | `required` badge present + no `.ui-field__label`. | `read` confirms. |
| `tests/client/settings/sections/admin/AdminPluginsConfigSection.test.ts:288-303` | Save error announced via `role="alert"`. | `read` confirms. |
| `tests/client/settings/sections/admin/AdminPluginsConfigSection.test.ts:305-322` | Reload-fail: no `p[role="status"]`. | `read` confirms. |
| `tests/client/settings/coding-credentials-section.test.ts:805-820` | Failed save shows an inline error with `role="alert"`. | `read` confirms. |
| `tests/client/settings/coding-credentials-section.test.ts:822-838` | Reload-fail: no `p[role="status"]`. | `read` confirms. |
| `tests/client/settings/coding-credentials-section.test.ts:840-853` | Bonus: provider `select` gets an accessible name via `aria-labelledby`. | `read` confirms. |
| `tests/client/settings/byok-section.test.ts` | **Gap:** no reload-fail test for `onSaveRoles()` (planned test referenced deleted field-row testids). | `read` confirms (absent). |
| `client/settings/fetchers.ts:124` / `fetchers.testing.ts:6-8` | `patchByok` (per-field save the plan's Byok Task relied on) still exported but unused in the shipped client. | `read` + `grep` confirm. |

Plan-vs-implementation notes:

- **ByokSection's planned portion was superseded by the provider-model rewrite (carried over from ADR-0256).** The plan's Task 1 Step 3 rewrote a per-field `save()` that called `patchByok` and gated `'${field.label} saved.'` on the reload — against the `byok-input-main_model`/`byok-save-main_model` field-row UI. That UI no longer exists: `ByokSection` is a providers table (`upsertByokProviderAction`, `onDelete`, `onSaveRoles`). The `load()`→`Promise<boolean>` signature change did ship (`ByokSection.svelte:79`), but the only save path that writes a success status — `onSaveRoles()` — was **not** gated: it still runs `await load(contextId); status = 'Role overrides saved.'` unconditionally (`:192-193`). The planned Byok reload-fail test therefore could not ship (its testids are gone) and no replacement covers the new roles-save path. Net: three of four sections are reload-safe; ByokSection's roles-save flow still exhibits the Part B bug, unguarded by a test.
- **CodeHost renders the `select` branch via the shared `Select` primitive, not a raw `<select>`.** The plan's Task 2 Step 4 wrote `<select class="coding-select" …>` and Task 2 Step 5 kept a `.coding-select` CSS rule. Shipped uses the shared `Select` primitive (`CodeHostSection.svelte:207`) — cleaner, consistent with the twin and with the shell's label-context wiring — so the `.coding-select` rule was dropped. This is the same shared-primitive divergence ADR-0256 recorded for `CodingCredentialsSection`.
- **CodeHost's `editor` snippet carries a `labelId`, mirroring the twin.** The plan's editor snippet took no parameter; shipped is `{#snippet editor(labelId)}` so the `Select`/`Input` get `aria-labelledby` pointing at the real field name (the additive a11y improvement ADR-0256 introduced). AdminPlugins' editor snippet stays parameterless (`{#snippet editor()}`) — assignable to `Snippet<[string]>` because a snippet with fewer parameters is compatible — and its `Input` still receives `aria-labelledby` via field-context.
- **Two bonus `aria-labelledby` tests shipped.** Beyond the plan's Part C list, CodeHost (`code-host-section.test.ts:584`) and CodingCredentials (`coding-credentials-section.test.ts:840`) each gained an accessible-name assertion, verifying the shell's `labelId` wiring end-to-end.
- **AdminPlugins has no `ErrorState`/whole-record concerns, as the spec predicted.** It is per-field, list-of-plugins shaped, so the migration was structural + roles + dirty-state only; no `ErrorState` was added (matching §2.2 of the design, not a gap).
- **The CodeHost dirty-state nuance is preserved.** `initialDrafts` defaults an empty `select` to its first option (`CodeHostSection.svelte:59`), so an unconfigured host loads `formDirty === true`; the dirty test uses a configured fixture to assert the disabled→enabled transition, exactly as the design §2.1 note specified.

The source plan `docs/superpowers/plans/2026-07-06-field-shell-consolidation-followups.md` and design `docs/superpowers/specs/2026-07-06-field-shell-consolidation-followups-design.md` are archived alongside this ADR to `docs/archive/`.
