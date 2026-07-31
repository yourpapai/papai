<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0256: BYOK Settings Field Shell

## Status

Implemented (with divergence)

## Date

2026-07-06

## Context

`ByokSection` (`client/settings/sections/ByokSection.svelte`) carried seven UX-review findings (`docs/ux-reviews/ByokSection.md`): one High — BYOK's active state was inferable only from an inverse-labeled toggle, with no explicit on/active indicator; three Medium — a load error dropped the primary toggle and showed the raw server string, every field stacked a redundant double label (the field name plus `Field`'s `VALUE`/`NEW VALUE` eyebrow), and the section-level status/error `<p>` sat in no `aria-live`/`role` region; and three Low — the card spacing/radius were hardcoded off the shared scale, the required `*` was a hand-rolled muted-text marker instead of `Field`'s accent cue, and Save was always active with no dirty-state. Four of the seven (double label, required marker, `aria-live`, hand-rolled load error) were duplicated verbatim in `CodingCredentialsSection` — ByokSection's near-identical twin — and the presentational subset also existed in `ConfigFieldRow`.

The design (`docs/superpowers/specs/2026-07-06-byok-section-field-shell-design.md`) and plan (`docs/superpowers/plans/2026-07-06-byok-settings-field-shell.md`) resolved all seven by extracting the genuinely-identical row structure into one presentational `SettingsFieldShell.svelte` (single accent-required label + `head`/`editor`/`footer` snippets + tokenized CSS), routing `ConfigFieldRow`, `ByokSection`, and `CodingCredentialsSection` through it, then applying the section-level fixes (a state `Pill`, `ErrorState`+retry, `role="alert"`/`role="status"`, dirty-state Save) inside each consumer. The shell was deliberately presentational-only — the two sections diverge in save model (Byok per field, Coding whole-record plus `select`/`combobox`), so save/endpoint/dirty logic stays in each consumer. No change to any HTTP route or Zod schema was in scope.

## Decision Drivers

- **Make BYOK's active state explicit.** A `Pill` beside the toggle must read the current state (central vs own, unreadable, incomplete, active), independent of the toggle's inverse action label (Finding: High active-state indicator).
- **Recoverable load errors, not dead-ends.** A failed GET must render the shared `ErrorState` with a working body Retry instead of dropping the toggle and showing a raw string (Finding: Med load-error recovery).
- **One label, enforced by construction.** The shell renders exactly one label; the editor snippet takes a bare control with no wrapping `Field label=…`, eliminating the `VALUE`/`NEW VALUE` eyebrow (Finding: Med double label).
- **Announce state changes.** Section-level status/error `<p>` carry `role="alert"` / `role="status"` (the codebase convention — no literal `aria-live` exists), matching `IdentitySection` (Finding: Med aria-live).
- **Tokenized, system-consistent cards.** The shell owns `.settings-field*` on `--gap-tight`/`--gap-inline`/`--surface-1` with `border-radius: var(--radius-control)`, and renders the required marker via `.settings-field__req` in `var(--accent)` (Findings: Low spacing/radius, Low required marker).
- **Dirty-state Save.** Disable Save until the draft differs from the stored value — the one net-new convention, expressed via a shared `dirty`/`isDirty`/`formDirty` shape per consumer (Finding: Low dirty-state).
- **Deduplicate at the right seam.** Fix the primitives/structure once so the twin and `ConfigFieldRow` stop drifting; keep each consumer's own save model.

## Considered Options

### Option 1 — Presentational `SettingsFieldShell` + per-consumer section-level fixes (chosen)

Extract a structure-only `SettingsFieldShell` (label + `head`/`editor`/`footer` snippets + tokenized CSS); route the three consumers through it; keep save/dirty/endpoint logic in each consumer; add `Pill`/`ErrorState`/`role`s/dirty-state at the section level.

- **Pros:** resolves all seven findings at their actual home; the twin and `ConfigFieldRow` dedupe the thing that drifted; additive shell keeps the blast radius minimal; each consumer keeps its own save model (no leaky save-strategy prop).
- **Cons:** a new shared component whose scoped-style migration must be re-baselined across every consumer; ByokSection and CodingCredentialsSection diverge in save model, so the shell cannot own "Save".

### Option 2 — Per-section stateful rows (`ByokFieldRow` + `CodingFieldRow`)

Extract one stateful row per section rather than a presentational shell.

- **Pros:** each row owns its save model naturally.
- **Cons:** leaves two copies of the head markup that actually drifted (double label, required marker, spacing), so it does not dedupe the findings' root cause.

### Option 3 — One do-everything row with a save-strategy prop

A single row component parameterized over per-field vs whole-record saving.

- **Pros:** one component to maintain.
- **Cons:** over-parameterized; a reader must study its internals to understand any call site; the section-level findings (Pill, ErrorState) still live outside the row.

## Decision

The chosen Option 1 shipped across the new shared component, the migrated consumers, their tests, and the visual baseline — with ByokSection's portion superseded by a concurrent data-model rewrite (see Divergence). What shipped:

1. **`SettingsFieldShell.svelte` (`client/settings/components/SettingsFieldShell.svelte`).** Presentational card: `label`/`required`/`testid`/`editorOpen` props + `head`/`editor`/`footer` snippets; renders one `.settings-field__label` with an accent `.settings-field__req` marker, the editor gated on `editor && editorOpen`, and the tokenized `.settings-field*` CSS (`--surface-1`, `--radius-control`, `--gap-tight`/`--gap-inline`).
2. **Per-instance label id for accessible naming.** The shell publishes a `labelId` via `setFieldLabelId` (the shared `field-context`) and passes it into the `editor` snippet, so the bare `Input`/`Select`/`Combobox` rendered there get a real `aria-labelledby` (the field name) instead of a generic "Value".
3. **`ConfigFieldRow` migration.** Both the enum and non-enum branches wrap their row in the shell; the non-enum Save is gated on a `dirty` derived (`draft !== (field.sensitive ? '' : field.value)`); the `.settings-field*` rules moved out, leaving only `.settings-field__hint` in this file.
4. **`CodingCredentialsSection` migration.** Each field row renders through the shell; the whole-record Save is gated on `formDirty = fields.filter(!fieldHidden).some(isDirty)`; load failure renders `ErrorState`+retry; the inline status lines carry `role="alert"`/`role="status"`; `select`/`combobox` controls render via the shared `Select`/`Combobox` primitives.
5. **`ByokSection` section-level fixes (in adapted form).** A state `Pill` renders beside the toggle in `PageHeader`; load failure renders `ErrorState`+retry; the inline status lines carry `role="alert"`/`role="status"`. The field-row shell migration and per-field dirty-state Save did **not** ship — the section was rewritten to a multi-provider table model (see Divergence).
6. **Unit tests.** `SettingsFieldShell` (7 tests), `ConfigFieldRow` dirty-state + accent-marker tests, and `CodingCredentialsSection` whole-record-dirty + `ErrorState`-retry + `aria-labelledby` tests.
7. **Stories + visual baseline.** `SettingsFieldShell.stories.svelte` (Editor-open-required / Masked-resting / Optional-with-footer-hint) and its auto-screenshot spec.

## Consequences

### Positive

- The seven ByokSection findings are resolved: the offending field-row UI (double label, hand-rolled `*`, hardcoded spacing, always-active Save) is gone, and the active state, load-error recovery, and state announcements now ship as a `Pill`, `ErrorState`+retry, and `role`s.
- One `SettingsFieldShell` renders every settings-field row in `ConfigFieldRow` and `CodingCredentialsSection` — neither carries its own `.settings-field*` CSS or a double label — and the shell was adopted by two further, unplanned consumers (`CodeHostSection`, `AdminPluginsConfigSection`), confirming the abstraction.
- Dirty-state Save is now the shared convention across all three planned consumers (`dirty`/`isDirty`/`formDirty`), preventing no-op PATCHes.
- The shell's `labelId`/`setFieldLabelId` wiring restores accessible naming for bare editor controls, pointing at the real field name rather than a generic label.
- The shell's CSS is tokenized (`--surface-1`, `--radius-control`, `--gap-*`), so cards match sibling inputs/buttons and stay consistent as tokens evolve.

### Negative

- ByokSection no longer renders settings-field rows at all — it is a providers table with role bindings — so the "one shell renders every ByokSection row" definition-of-done item is mooted by the rewrite rather than satisfied by the plan's mechanism.
- The shell's `editor` snippet signature is `Snippet<[string]>` (carries `labelId`), not the plain `Snippet` the plan specified, so every consumer's editor snippet must declare the parameter.
- Scoped-style ownership for `.settings-field*` moved from each consumer into the shell, so a future shell-CSS edit ripples to every consumer and demands a baseline re-shoot.

### Risks

- **Concurrent ByokSection rewrite drift.** The provider-model rewrite adopted the plan's Pill/ErrorState/role fixes but with different `pillState` semantics (`providers.length === 0` → "No providers" instead of `!complete` → "Incomplete"); future edits must remember the Pill is now provider-count-driven.
- **`patchByok` is dead client code.** The per-field BYOK save fetcher the plan relied on is still exported (`client/settings/fetchers.ts:124`) but unused in the shipped client (only referenced from `fetchers.testing.ts`); it is a maintenance trap for anyone reviving the field model.
- **Stale ByokSection visual baseline.** `tests/visual/settings/sections/ByokSection.spec.ts` still references the pre-rewrite story ids (`secret-set`, `missing-required`) and a `byok-input-ANTHROPIC_API_KEY` testid that the rewritten component no longer renders — the visual layer was not regenerated for the provider model.
- **Inline pass-through of raw errors.** The data-present status line surfaces the raw backend message verbatim (acceptable because the user triggered the action).

## Related Decisions

- **ADR-0255: AI Output UX Fixes** — established the `--focus-ring` token and the `ConfigFieldRow` `hint` prop + label-brightening that this ADR's `SettingsFieldShell` extraction carries forward; 0255 noted the `.settings-field`/`.settings-field__label` CSS relocation into the shell that this ADR formalizes.
- **ADR-0253: ReleaseSubscriptionSection UX Fixes** — established the `ErrorState` / `Loading…` / content render-state convention and the `Btn` affordances these consumers reuse.
- The `Field`/`field-context` accessible-naming pattern (`setFieldLabelId`/`getFieldLabelId`) the shell's `labelId` wiring mirrors.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `client/settings/components/SettingsFieldShell.svelte:16-26` | `Props`: `label`/`required`/`testid`/`editorOpen` + `head`/`editor: Snippet<[string]>`/`footer` snippets. | `read` confirms. |
| `client/settings/components/SettingsFieldShell.svelte:33-34` | Per-instance `labelId` published via `setFieldLabelId` (additive a11y, beyond the plan). | `read` confirms. |
| `client/settings/components/SettingsFieldShell.svelte:37-46` | Card markup: labeled `span` with accent `.settings-field__req`; editor gated on `editor && editorOpen` and rendered with `{@render editor(labelId)}`. | `read` confirms. |
| `client/settings/components/SettingsFieldShell.svelte:54-55` | `.settings-field` `border-radius: var(--radius-control)`; `background: var(--surface-1)`. | `read` confirms. |
| `client/settings/components/SettingsFieldShell.svelte:63-71` | `.settings-field__label { color: var(--text) }`; `.settings-field__req { color: var(--accent) }`. | `read` confirms. |
| `client/shared/ui/field-context.ts:11-18` | `setFieldLabelId`/`getFieldLabelId` context the shell publishes and `Input`/`Select`/`Combobox` consume. | `read` confirms. |
| `tests/client/settings/components/SettingsFieldShell.test.ts:22-83` | 7 tests: label/testid, required marker present/omitted, no-editor wrapper, editor renders, `editorOpen=false` suppresses editor, head/footer slots. | `read` confirms. |
| `client/settings/components/SettingsFieldShell.stories.svelte:20,29,38` | Three stories: Editor-open-required, Masked-resting, Optional-with-footer-hint. | `read` confirms. |
| `tests/visual/settings/components/SettingsFieldShell.spec.ts:10-23` | Auto-screenshot spec for the three shell stories. | `read` confirms. |
| `client/settings/components/ConfigFieldRow.svelte:17` | `SettingsFieldShell` import. | `read` confirms. |
| `client/settings/components/ConfigFieldRow.svelte:44` | `dirty = $derived(draft !== (field.sensitive ? '' : field.value))`. | `read` confirms. |
| `client/settings/components/ConfigFieldRow.svelte:116-141` | Enum branch wrapped in the shell (`editorOpen={false}`). | `read` confirms. |
| `client/settings/components/ConfigFieldRow.svelte:143,164` | Non-enum branch: shell with `required`, Save `disabled={!dirty || saving}`. | `read` confirms. |
| `client/settings/components/ConfigFieldRow.svelte:194-198` | `<style>` trimmed to `.settings-field__hint` only. | `read` confirms. |
| `tests/client/settings/components/ConfigFieldRow.test.ts:73-98` | Non-sensitive Save disabled until the value changes. | `read` confirms. |
| `tests/client/settings/components/ConfigFieldRow.test.ts:100-119` | Required marker is an accent `.settings-field__req` span. | `read` confirms. |
| `client/settings/sections/CodingCredentialsSection.svelte:12,18` | `ErrorState` + `SettingsFieldShell` imports. | `read` confirms. |
| `client/settings/sections/CodingCredentialsSection.svelte:58` | `formDirty = $derived(fields.filter(!fieldHidden).some(isDirty))`. | `read` confirms. |
| `client/settings/sections/CodingCredentialsSection.svelte:259-260,268` | `role="alert"` (action error + unreadable), `role="status"` (success). | `read` confirms. |
| `client/settings/sections/CodingCredentialsSection.svelte:265` | `ErrorState`+retry on initial load failure. | `read` confirms. |
| `client/settings/sections/CodingCredentialsSection.svelte:283-337` | Field rows wrapped in the shell; `editor(labelId)` snippet. | `read` confirms. |
| `client/settings/sections/CodingCredentialsSection.svelte:298,305` | `select`/`combobox` rendered via shared `Select`/`Combobox` primitives (divergence: plan wrote raw `<select>`/`<datalist>`). | `read` confirms. |
| `client/settings/sections/CodingCredentialsSection.svelte:359` | Whole-record Save `disabled={!formDirty || saving || loading || clearing}`. | `read` confirms. |
| `tests/client/settings/coding-credentials-section.test.ts:763-787` | Whole-record dirty-Save test + `ErrorState`-retry test. | `read` confirms. |
| `tests/client/settings/coding-credentials-section.test.ts:840-869` | Provider `Select` and model `Combobox` get an accessible name via `aria-labelledby` (the field label). | `read` confirms. |
| `client/settings/sections/ByokSection.svelte:14` | `Pill` import. | `read` confirms. |
| `client/settings/sections/ByokSection.svelte:50-62` | `pillState` derived (mute `Central credentials` / danger `Unreadable` / warn `No providers` / accent `Active`). | `read` confirms. |
| `client/settings/sections/ByokSection.svelte:220-226` | State `Pill` rendered beside the toggle in `PageHeader` (`data-testid="byok-state"`). | `read` confirms. |
| `client/settings/sections/ByokSection.svelte:241-242` | `role="alert"` (action error) / `role="status"` (success). | `read` confirms. |
| `client/settings/sections/ByokSection.svelte:247` | `ErrorState`+retry on initial load failure. | `read` confirms. |
| `client/settings/sections/ByokSection.svelte:279-321` | **Divergence:** enabled body is a providers table (not shell field rows); no `SettingsFieldShell` use. | `read` confirms. |
| `tests/client/settings/byok-section.test.ts:126-160,265-266` | Pill assertions: `Central credentials` / `Active` / `No providers` / `Unreadable`. | `read` confirms. |
| `tests/client/settings/byok-section.test.ts:297-304` | Initial-load `ErrorState`+retry test. | `read` confirms. |
| `client/settings/fetcher-schemas.ts:45-61` | `ByokResponseSchema` carries the v2 multi-provider extension (`providers`/`roles`, optional with defaults). | `read` confirms. |
| `client/settings/fetchers.ts:124` | `patchByok` (per-field save the plan relied on) still exported but unused in the shipped client. | `read` + `grep` confirm. |
| `client/settings/sections/CodeHostSection.svelte:17` / `client/settings/sections/admin/AdminPluginsConfigSection.svelte:16` | Unplanned extra consumers adopted the shell (positive blast radius). | `grep` confirms. |

Plan-vs-implementation notes:

- **ByokSection was rewritten to a multi-provider model instead of being migrated field-by-field through the shell.** The plan's Task 3 wrapped each BYOK field in `SettingsFieldShell` with a per-field `isDirty` Save against `patchByok`. In the shipped tree `ByokResponseSchema` gained a "v2 multi-provider extension" (`fetcher-schemas.ts:54-59` — `providers`/`roles`, optional with defaults) and `ByokSection` renders a providers table (`ProviderForm`, `VerificationPill`, `RoleBindingBlock`, `upsertByokProviderAction`) instead of field rows. It does **not** use `SettingsFieldShell`, has no per-field `drafts`/`isDirty`, and never calls `patchByok`. The plan's four section-level ByokSection fixes did ship in adapted form: the `Pill`, `ErrorState`+retry, and `role`s are present. The four findings that were specific to the field-row UI (double label, hand-rolled `*`, hardcoded spacing, always-active Save) are resolved by the rewrite removing that UI; the High active-state, Med load-error, and Med aria-live findings are resolved by the shipped section-level fixes.
- **The ByokSection `pillState` semantics changed.** The plan's table derived the warn state from `!complete` and read "Incomplete"; shipped derives it from `providers.length === 0` and reads "No providers" (`ByokSection.svelte:60`), because completeness is now a function of bound providers/roles rather than a server `complete` flag. The mute/danger/accent branches match the plan.
- **The shell's `editor` snippet carries a `labelId`, and the shell publishes a per-instance label id via context.** The plan's `editor?: Snippet` took no parameter and the shell only rendered `{@render editor()}`. Shipped is `editor?: Snippet<[string]>` rendered as `{@render editor(labelId)}`, plus `setFieldLabelId(labelId)` so a bare `Input`/`Select`/`Combobox` in the editor gets `aria-labelledby` pointing at the real field name. This is an additive a11y improvement riding the extraction; it is why every consumer's editor snippet declares the `labelId` parameter (e.g. `CodingCredentialsSection.svelte:296`).
- **CodingCredentialsSection renders `select`/`combobox` via shared primitives, not raw elements.** The plan's Task 4 wrote a raw `<select>` and an `<input list>`/`<datalist>` combobox. Shipped uses the shared `Select` (`CodingCredentialsSection.svelte:298`) and `Combobox` (`:305`) primitives — cleaner and consistent with the label-context wiring; the `coding-select-*` / `coding-combobox-*` testids are preserved on the primitives.
- **The `SettingsFieldShell` test suite grew to seven tests.** The plan's four tests shipped verbatim in intent, plus three covering editor-gating (`editorOpen` default vs `false`) and head/footer slot rendering.
- **The shell reached two unplanned consumers.** `CodeHostSection.svelte:17` and `AdminPluginsConfigSection.svelte:16` also route rows through `SettingsFieldShell`, confirming the abstraction generalized beyond the three planned call sites.
- **The ByokSection visual baseline is stale relative to the rewrite (verification gap).** `tests/visual/settings/sections/ByokSection.spec.ts` still switches to the pre-rewrite story ids (`secret-set`, `missing-required`) and focuses a `byok-input-ANTHROPIC_API_KEY` testid that the rewritten providers-table component no longer renders, while `ByokSection.stories.svelte` exposes the new provider-model stories (`Enabled with provider`, `Enabled no providers`, …). The MSW-driven component tests (`byok-section.test.ts`) cover the shipped provider UI; the visual spec was not regenerated to match the rewrite.
- **`patchByok` is retained but dead.** The per-field BYOK save the plan depended on remains exported at `fetchers.ts:124` (and re-exported from `fetchers.testing.ts`) but has no shipped client caller after the provider-model rewrite.

The source plan `docs/superpowers/plans/2026-07-06-byok-settings-field-shell.md` and design `docs/superpowers/specs/2026-07-06-byok-section-field-shell-design.md` are archived alongside this ADR to `docs/archive/`.
