<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0226: Backstage Phase 3.3 — Settings Admin Sections + Cleanup

## Status

Implemented (with divergence)

## Date

2026-06-01

## Context

Phase 3.2 (ADR-0176) swept the nine user-facing `/settings` sections onto the Phase 1 kit and — as a divergence pulled forward from this plan — migrated every user **and** admin section header to `PageHeader`. Two cross-cutting Phase 3 cleanups were nonetheless left open by ADR-0176 and assigned to this phase (3.3): the **admin** section bodies still carried the hand-rolled anti-patterns (raw `<button>`/`<input>`/`<select>`, masked-value spans, plain-text status, hand-rolled `<table>`s), and the now-dead `settings.css` shadow-styling layer (`.settings-form *`, `.settings-table`, `.masked-value`, `.placeholder`) was still present and explicitly deferred to "the Phase 3.3-end cleanup."

The plan therefore had three jobs: (1) finish the kit sweep across the eight bot-admin/super-admin sections, (2) absorb the `PageHeader` header migration the plan still scoped as its own task (Task 10) even though ADR-0176 had already landed it, and (3) delete the dead `settings.css` rules now that no consumer remains. A small kit enhancement — an opt-in `multiline` (textarea) mode on `Input` for the announce message — was the only shared-primitive change.

The shared spec `docs/superpowers/specs/2026-06-01-backstage-admin-ui-fixes-design.md` (§3 goal: sweep `client/settings/`; §6 kit) was already archived with ADR-0176; this plan is its last consumer and is archived alongside this ADR.

## Decision Drivers

- **Finish the `/settings` sweep** — the admin section bodies are the last holdouts of hand-rolled controls across the three surfaces (`/admin` done in Phase 2, `/debug` in Phase 3.1, `/settings` user half in Phase 3.2).
- **Cross-cutting, not per-file, cleanup** — `PageHeader` and the `settings.css` dead-rule deletion are uniform transforms best done once across all sections rather than piecemeal.
- **Consumer-side, one small kit addition** — only `Input` gains a mode; everything else reuses the Phase 1 + 2.3 kit. (In practice a new `SettingsTable` wrapper was introduced — see Decision.)
- **Preserve `data-testid`** — every existing testid carries onto the kit element via the `testid` prop, keeping the new per-section unit tests and E2E green.
- **TDD Red→Green, one task per file** — each admin section is its own scoped commit under the write-hook, gated by `bun test:client`/`bun typecheck`/`bun knip`/`bun check:bundle-isolation`/`bun build:client`.

## Considered Options

### Option 1: Per-file kit adoption + uniform cleanup (chosen)

Walk each admin section swapping each anti-pattern for its kit equivalent, then do the `PageHeader` migration and the `settings.css` deletion as final cross-cutting passes.

- **Pros:** reuses the proven Phase 1 kit with one tiny addition (`Input` multiline); each task is independently reviewable; testids preserved; reaches full three-surface parity.
- **Cons:** touches eight admin files plus the CSS; the `bind:value`→controlled conversion is mechanical but pervasive; the `PageHeader` task is redundant with ADR-0176's pull-forward.

### Option 2: Leave admin section bodies hand-rolled

Ship no 3.3; let the admin sections keep bespoke controls and the dead CSS.

- **Pros:** no churn.
- **Cons:** leaves the spec §3 `/settings` goal half-met (user sections on kit, admin sections not); `/settings` keeps diverging from `/admin` and `/debug`; dead `settings.css` rules drift further from reality.

### Option 3: Direct `DataTable` in every tabular section (the plan's literal spec)

Adopt `DataTable` inline in each of the five tabular admin sections exactly as written.

- **Pros:** minimal primitive surface; matches the plan verbatim.
- **Cons:** foregoes the search/pagination affordance the rosters actually need; the plan's per-section tests would not cover filtering. (The implementation instead chose a shared wrapper — see Decision.)

## Decision

Eight file-scoped TDD refactors plus a kit enhancement, a header pass, and a CSS cleanup. What shipped, verified against the current tree:

1. **`Input` multiline mode** — `client/shared/ui/Input.svelte:20-21,33-34` add `multiline`/`rows` props; the template branches to a `<textarea>` at `Input.svelte:53-65` with `ui-input--multiline` styling at `Input.svelte:116-119`. Consumed by `AdminAnnounceSection`.
2. **`AdminAnnounceSection`** — message field → multiline `Input` (`AdminAnnounceSection.svelte:54`, `testid="announce-message"`), Send → `Btn` (`:56`); `PageHeader` imported (`:10`); local textarea `<style>` removed.
3. **`AdminAdminsSection`** — add form → `Field`+`Input`+`Btn` (`AdminAdminsSection.svelte:121-133`); roster table → `SettingsTable` (see note) at `:148-155`; `Btn`/`Field`/`Input`/`IconButton`/`PageHeader` imported (`:10-14`).
4. **`AdminGroupsSection`** — add form → kit; table → `SettingsTable` (`AdminGroupsSection.svelte:171-178`); kit imports (`:10-15`).
5. **`AdminUsersSection`** — add form → kit; table → `SettingsTable` (`AdminUsersSection.svelte:236-244`); kit imports (`:17-23`).
6. **`AdminPluginsApprovalSection`** — table → `SettingsTable` (`AdminPluginsApprovalSection.svelte:133-140`) with status cell → `StatusPill` (`:116`); Approve/Reject → `Btn`; `StatusPill` imported (`:14`).
7. **`AdminPluginsConfigSection`** — masked value → `Secret` (`AdminPluginsConfigSection.svelte:108`); editor → `Field`+`Input`+`Btn`; empty branch → `EmptyState` (`:149`); `Secret`/`EmptyState` imported (`:10,14`).
8. **`AdminInstancesSection`** — both forms → `Field`+`Input`+`Select`+`Btn` (`AdminInstancesSection.svelte:314-376`); both tables → `DataTable` directly (`:360-362`, `:418-420`); status cells → `StatusPill` (`:348`, `:406`); full kit import block (`:22-29`).
9. **`PageHeader` migration (Task 10)** — already landed by ADR-0176; confirmed present across **all 34** settings section files (`grep -l PageHeader client/settings/sections/`), including every admin section.
10. **`settings.css` dead-rule deletion (Task 11)** — the table, masked-value, header, eyebrow, and form-control rules are gone; only `.settings-table-wrap` (`settings.css:45`) and `.placeholder` (`:97`) remain of the candidate set (see notes).

## Consequences

### Positive

- All three surfaces (`/admin`, `/debug`, `/settings` user **and** admin) render through one kit; the `/settings` sweep is complete.
- Masked plugin/system values route through `Secret`; plugin-approval and instance status render via `StatusPill`; rosters and instance lists render via `DataTable` (directly or through `SettingsTable`).
- The legacy `settings.css` shadow layer is largely retired: `.settings-table`, `.settings-table th/td`, `.masked-value`, `.settings-section-header`, the settings `.eyebrow` rule, and the `.settings-form input|select|button|label` descendant rules are all gone.
- All `data-testid`s are preserved through the kit `testid` prop.

### Negative

- **`AdminSystemSection` no longer exists.** The plan's Task 8 targeted it (`llm_apikey`, `SENSITIVE_SYSTEM_KEYS`, `fetchAdminSystem`); none of these have any match in `client/settings/`. The single-LLM system-config section was restructured out (superseded by the multi-LLM `AdminModelsSection`/`AdminProvidersSection`/BYOK sections), so Task 8 is moot — there was nothing to migrate.
- **Tables route through a new `SettingsTable` wrapper, not direct `DataTable`.** `client/settings/components/SettingsTable.svelte` wraps `DataTable` (`:9`) with a search input + result count + pager (`:45-57`) and is used by AdminAdmins/Groups/Users/PluginsApproval (and non-admin Byok/Members). This is a superset of the plan's literal "direct DataTable" but adds a primitive the plan did not inventory, and `SettingsTable` itself still uses raw `<button>`s for its pager (`SettingsTable.svelte:55-57`).
- **`.settings-table-wrap` was retained**, not deleted as the plan's Task 11 specified — it is still consumed as a layout wrapper by 9 files (e.g. `AdminAdminsSection.svelte:136`, `MembersSection.svelte:144`). The plan's grep-guard would have caught this; the rule stays load-bearing.
- Two residual raw `<table>` elements remain out of this plan's scope: `ByokSection.svelte:280` and `AdminProvidersSection.svelte:175` — neither was a 3.3 deliverable, so they were not converted.

### Risks

- **`SettingsTable` is an un-inventoried shared component** (analogous to the `IconButton` gap ADR-0176 flagged). A regression in its search/pager/cell-slot contract breaks every tabular admin + user roster at once.
- **`Input` multiline expands the kit contract.** A regression in the `multiline`/`rows` branch or the textarea styling affects every future multiline consumer (currently only `AdminAnnounceSection`).
- **`.settings-table-wrap` retention is a silent scope deviation** — the plan asserted the rule was dead; it is not. Future cleanup that re-runs the same grep will trip on it unless the wrapper is migrated first.

## Related Decisions

- **ADR-0169: Backstage Kit Additions (Phase 1)** — the 13 primitives this sweep adopts.
- **ADR-0170..0174: Backstage Phases 2.1–2.5** — `/admin` adoption that established the sweep pattern and shipped `Btn`/`Input`/`Select` `testid`, `Input` `password`, and `StatusPill`.
- **ADR-0175: Backstage Phase 3.1 — Debug Sweep** — `/debug` adoption.
- **ADR-0176: Backstage Phase 3.2 — Settings User Sections** — the closest sibling; pulled the `PageHeader` migration forward and archived the shared spec. This phase finishes the `/settings` sweep that ADR-0176 began.
- **ADR-0171: Backstage Phase 2.2 — Section Headers** — the original `PageHeader` adoption this phase mirrors.
- **ADR-0121: Debug/Admin Surface Split and Dashboard Redesign** — the surface split this sweep converges.

## Implementation Notes

Verified present in the codebase via `grep`/`glob`/`read`:

| File                                                    | Role                                                                                                | Evidence                                          |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `client/shared/ui/Input.svelte`                         | `multiline`/`rows` props + textarea branch + `ui-input--multiline` style (Task 1).                  | `:20-21,33-34,53-65,116-119`.                     |
| `client/settings/sections/admin/AdminAnnounceSection.svelte` | multiline `Input` + `Btn` + `PageHeader` (Task 5).                                             | `:7-10,54,56`.                                    |
| `client/settings/sections/admin/AdminAdminsSection.svelte` | `Field`/`Input`/`Btn` form + roster via `SettingsTable`; kit imports.                             | `:10-15,121-141,148-155`.                         |
| `client/settings/sections/admin/AdminGroupsSection.svelte` | `Field`/`Input`/`Btn` form + `SettingsTable`; kit imports.                                       | `:10-15,171-178`.                                 |
| `client/settings/sections/admin/AdminUsersSection.svelte` | `Field`/`Input`/`Btn` form + `SettingsTable`; kit imports.                                        | `:17-23,236-244`.                                 |
| `client/settings/sections/admin/AdminPluginsApprovalSection.svelte` | `SettingsTable` + `StatusPill` (`:116`) + Approve/Reject `Btn`; kit imports.            | `:11-15,116,133-140`.                             |
| `client/settings/sections/admin/AdminPluginsConfigSection.svelte` | `Secret` (`:108`) + `Field`/`Input`/`Btn` editor + `EmptyState` (`:149`); kit imports. | `:9-14,108,149`.                                   |
| `client/settings/sections/admin/AdminInstancesSection.svelte` | Two `Field`/`Input`/`Select`/`Btn` forms + two direct `DataTable`s + `StatusPill` (`:348,406`). | `:22-29,314-376,360-362,418-420`.                 |
| `client/settings/components/SettingsTable.svelte`       | New wrapper: `DataTable` + search + pager (divergence from direct-`DataTable` plan).                | `:9,45-57`.                                       |
| `client/settings/sections/admin/AdminSystemSection.svelte` | **Does not exist** — Task 8 target gone; `llm_apikey`/`fetchAdminSystem` absent from `client/settings/`. | `ls`/`grep` confirm.                              |
| `client/settings/sections/*` + `sections/admin/*`       | `PageHeader` adopted across all 34 settings section files (Task 10, landed with ADR-0176).          | `grep -l PageHeader` confirms.                    |
| `client/settings/settings.css`                          | `.settings-table`, `.masked-value`, `.settings-section-header`, `.eyebrow`, `.settings-form *` removed; `.settings-table-wrap` (`:45`) and `.placeholder` (`:97`) retained. | `grep` confirms. |

Plan-vs-implementation notes:

- **`PageHeader` was already done.** The plan's Task 10 (migrate all 16 settings headers to `PageHeader`) was landed by ADR-0176's pull-forward; this phase found it complete across the (now larger) 34-file set and added no header work.
- **`SettingsTable` instead of direct `DataTable`.** The plan specified inline `DataTable` in AdminAdmins/Groups/Users/PluginsApproval. The implementation routes those four through a new shared `SettingsTable` component that adds search + pagination the plan did not call for; only `AdminInstancesSection` uses `DataTable` directly (its two tables need no search).
- **`AdminSystemSection` removed.** Task 8 is moot — the section and its `llm_apikey`/`SENSITIVE_SYSTEM_KEYS` machinery are absent, restructured into the multi-LLM admin sections.
- **`IconButton` for refresh controls** — carried over from ADR-0176; admin refresh buttons use `IconButton`, not the `Btn variant="ghost"` the plan text specifies.
- **`.settings-table-wrap` retained** — the plan's Task 11 listed it for deletion, but 9 consumers still use the wrapper div, so the CSS rule stays (the plan's own grep-guard would have caught this).
- **`.placeholder` retained as planned** — still used across user sections (Profile, Tools, Plugins, …) and admin "unset" spans (`AdminPluginsConfigSection.svelte:110`).
- **Out-of-scope raw tables remain** — `ByokSection.svelte:280` and `AdminProvidersSection.svelte:175` still render a raw `<table>`; neither was a 3.3 deliverable.

The shared spec `docs/superpowers/specs/2026-06-01-backstage-admin-ui-fixes-design.md` was already archived with ADR-0176; no distinct spec exists for Phase 3.3, so only this plan is archived to `docs/archive/`.
