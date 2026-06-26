<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0176: Backstage Phase 3.2 — Settings User Sections

## Status

Implemented

## Date

2026-06-01

## Context

Phase 1 (ADR-0169) shipped the 13 shared kit primitives plus `fmtNum`/`fmtBytes` into `client/shared/ui/`. Phases 2.1–2.5 (ADRs 0170–0174) adopted them across every `/admin` section, closing all 18 audit findings from `docs/superpowers/specs/2026-06-01-backstage-admin-ui-fixes-design.md` §7. Phase 3.1 (ADR-0175) swept `/debug`. The spec's §3 goal scopes the remediation beyond those two operator surfaces: "sweep `/debug` and `client/settings/` for the identical anti-patterns and adopt the new components there too (maximum cross-surface consistency)." Phase 3.2 is the user-facing half of the `/settings` sweep — the nine user-facing sections plus the shared `ConfigFieldRow` they compose.

`client/settings/` carried the same hand-rolled anti-patterns: raw `<button>` instead of `Btn`, raw `<input>`/`<select>` instead of `Input`/`Select`, masked value spans instead of `Secret`, plain-text eligibility/summary instead of `Pill`, a hand-rolled members `<table>` instead of `DataTable`, the Kaneo provision `<dl>` instead of `SummaryList`, and `.placeholder` empty spans instead of `EmptyState`. The settings SPA already concatenated `tokens.css` into its bundle and a few components (`SettingsTopBar`/`SettingsSidebar`/`ToolsSection`) already imported kit primitives, so kit imports resolved without a bundle change. The work is consumer-side adoption; the plan's premise was that no shared primitive needed changing.

The plan deliberately scoped two items out: migrating the section header (eyebrow + `<h2>`) to `PageHeader` was deferred to a Phase 3.3-end cleanup "so it can be done uniformly across user + admin sections at once," and deletion of the now-dead `.settings-form *`/`.settings-table`/`.masked-value`/`.placeholder` rules from `settings.css` was deferred to the same cleanup. The `McpSection` "Enabled" checkbox and the `ToolsSection` `aria-expanded` expand control were explicitly kept native/raw — the kit had no toggle primitive and `Btn` had no aria passthrough.

## Decision Drivers

- **Cross-surface kit consistency** — `/settings` user sections must converge on the same kit `/admin` and `/debug` adopted, ending the third parallel set of hand-rolled controls.
- **Consumer-only scope (planned)** — no shared primitive is rebuilt; the Phase 1 kit is reused as-is. (In practice a new `IconButton` was introduced mid-sweep — see Decision.)
- **Preserve `data-testid`** — every existing testid carries onto the kit element via the `testid` prop (Phase 2.3), so settings unit tests and E2E that drive these controls keep passing.
- **Controlled, not bound** — kit `Input`/`Select` are callback-based; `oninput`/`onchange` + `(e.target as …).value` become `onInput`/`onChange` handlers with explicit value updates.
- **TDD Red→Green, one task per file** — each affected file is its own scoped commit, test-first per the repo's write-hook, gated by `bun test:client`/`bun typecheck`/`bun knip`/`bun check:bundle-isolation`/`bun build:client`.
- **Highest-leverage first** — the shared `ConfigFieldRow` (consumed by `ProfileSection` and `TaskProviderSection`) is migrated before its callers.

## Considered Options

### Option 1: Consumer-side sweep, one task per file (chosen)

Walk the nine user-facing sections plus `ConfigFieldRow`, swapping each anti-pattern for its kit equivalent, each file a separate scoped commit under TDD.

- **Pros:** reuses the Phase 1 kit proven in Phases 2–3.1 with zero primitive churn; each task is independently reviewable and revertable; `data-testid`s are preserved; `/settings` reaches parity with `/admin` and `/debug`.
- **Cons:** touches ten files in one phase; the `bind:value`→controlled conversion is mechanical but pervasive, with a small risk of a missed callback; the per-section Refresh pattern repeats nine times.

### Option 2: Leave `/settings` user sections hand-rolled, accept the divergence

Ship no Phase 3.2; let the user sections keep their bespoke controls and plain-text status.

- **Pros:** no churn; no callback-migration risk.
- **Cons:** leaves the spec §3 goal unmet; `/settings` keeps diverging from `/admin` and `/debug` as new kit primitives land; masked-value spans, plain-text eligibility/summary, and the hand-rolled members table persist.

### Option 3: Rebuild the user sections from scratch on the kit

Rewrite the nine sections wholesale against the kit rather than refactoring in place.

- **Pros:** maximal kit purity; no legacy markup to reason about.
- **Cons:** far larger blast radius than the anti-patterns warrant; re-introduces behavior risk in sections with nontrivial state (`McpSection` row/header drafts, `PluginsSection` config drafts, `ToolsSection` expand map); violates the consumer-only scope and the spec's "no new visual design" non-goal; loses per-file scoped-commit reviewability.

## Decision

Ten file-scoped TDD refactors plus a verification gate, in dependency order. What shipped:

1. **`ConfigFieldRow`** — masked-value span → `Secret`; editor `<input>` → `Input` (`type="password"` for sensitive); Replace/Save/Cancel `<button>` → `Btn`. Imports `Btn`/`Input`/`Secret`.
2. **`ProfileSection`** — Refresh control → `IconButton`; section header → `PageHeader`; empty branch → `EmptyState`.
3. **`TaskProviderSection`** — Refresh → `IconButton`; header → `PageHeader`; provisioned `<dl>` → `SummaryList` with the password via `Secret`; provision `<button>` → `Btn`; task-instance `<select>` → `Field`+`Select`. (Empty branches kept as `.placeholder` spans — see notes.)
4. **`ToolsSection`** — Refresh → `IconButton`; header → `PageHeader`; domain summary → `Pill` with a local `summaryTone` mapper (`allow`→`accent`, `ask`→`warn`, `deny`→`danger`, else `mute`); per-tool Allow/Ask/Deny and domain-toggle → `Btn`; expand control stayed a raw `<button aria-expanded>`; empty branch → `EmptyState`.
5. **`IdentitySection`** — Refresh → `IconButton`; header → `PageHeader`; form fields → `Field`+`Input`; Save/Clear → `Btn` (no `FormRow` — optional path taken).
6. **`MembersSection`** — Refresh → `IconButton`; header → `PageHeader`; add form → `Field`+`Input`+`Btn`; members `<table>` → `DataTable` with derived `memberRows`/`memberColumns` and a `cell` snippet rendering the Remove `Btn`.
7. **`GroupProviderSection`** — Refresh → `IconButton`; header → `PageHeader`; task-instance `<select>` → `Field`+`Select`; Save → `Btn`.
8. **`PluginsSection`** — Refresh → `IconButton`; header → `PageHeader`; eligibility → `Pill` with a local `eligTone` mapper (`eligible`→`accent`, `inactive`/`disabled`→`mute`, else `warn`); toggle/config-save → `Btn`; config `<label>` blocks → `Field`+`Input`+`Btn`; empty branch → `EmptyState`.
9. **`McpSection`** — Refresh → `IconButton`; header → `PageHeader`; endpoint label/url, header name/value, and tool-filter allow/deny → `Field`+`Input`; Remove/Add-header/Add-endpoint/Save → `Btn`; "Enabled" checkbox stayed a native `<input type="checkbox">` inside a `Field` label.
10. **Gate (no commit)** — `bun test:client`, `bun typecheck`, `bun knip`, `bun check:bundle-isolation`, `bun build:client`; optional `/settings` preview for visual parity with `/admin` and `/debug`.

## Consequences

### Positive

- `/settings` user sections, `/admin`, and `/debug` share one kit; buttons, inputs, selects, secrets, pills, tables, summary lists, and empties render consistently across all three surfaces.
- Masked values route through `Secret`; the Kaneo provision password renders via `Secret`+`SummaryList` instead of a hand-rolled `<dl>`.
- The members table routes through `DataTable`; tool-permission summaries and plugin-eligibility status render via `Pill` with local tone mappers.
- All `data-testid`s are preserved through the kit `testid` prop, keeping settings unit tests and E2E green.
- The deferred `PageHeader` migration was absorbed into this phase and applied uniformly across user **and** admin sections, eliminating the eyebrow+`<h2>` duplication (notably the `TaskProviderSection` "Task provider"/"Task provider" double title) in one pass.

### Negative

- A new `IconButton` primitive was introduced mid-sweep, outside the Phase 1 kit inventory (spec §6 lists 13 components; `IconButton` is not among them). Future kit accounting should reconcile it.
- `TaskProviderSection` did not adopt `EmptyState` for its empty branches; it retains `.placeholder` spans, an inconsistency with the other settings sections.
- `FormRow` (Phase 1) remains unused in `/settings`; the `Field`+inline-`Btn` vs `FormRow` overlap is unresolved.
- `.placeholder` "Loading…" spans persist across sections; the plan targeted only the empty branch, not the loading-state pattern, so they remain.
- Dead `settings.css` rules (`.settings-form *`, `.settings-table`, `.masked-value`, `.placeholder`) are still present; their deletion was deferred to the Phase 3.3-end cleanup.

### Risks

- **`IconButton` is a new shared primitive not covered by the Phase 1 stories/tests contract.** A regression in its `busy`/`glyph`/`testid`/`onClick` props breaks every settings refresh control (and, since admin sections also adopted it, every admin refresh control too).
- **`PageHeader` pulled forward enlarges blast radius.** This phase's header change spans user + admin sections, larger than the plan's user-only scope; a header regression affects all three surfaces.
- **Local tone mappers duplicate the `status-tone` pattern** with settings-specific vocabularies (`summaryTone`, `eligTone`); drift between them and the shared map is a coordination point.
- **Native checkbox and `aria-expanded` expand are deliberate non-goals.** A future kit toggle primitive or `Btn` aria passthrough would require another pass.

## Related Decisions

- **ADR-0169: Backstage Kit Additions (Phase 1)** — ships the 13 primitives plus `fmtNum`/`fmtBytes` this sweep adopts.
- **ADR-0170: Backstage Phase 2.1 — Numbers, Tables, and Guards** — first `/admin` consumer adoption; established the sweep pattern.
- **ADR-0171: Backstage Phase 2.2 — Section Headers** — `PageHeader` adoption in `/admin` this phase mirrors (and pulled forward into `/settings`).
- **ADR-0172: Backstage Phase 2.3 — Instances Section** — shipped `Btn`/`Input`/`Select` `testid` and `Input` `password` this phase depends on.
- **ADR-0173: Backstage Phase 2.4 — Forms and Status** — `StatusPill`/form adoption this phase mirrors via local `Pill` tone mappers.
- **ADR-0174: Backstage Phase 2.5 — System Summary** — closes `/admin`.
- **ADR-0175: Backstage Phase 3.1 — Debug Sweep** — `/debug` adoption; this phase continues Phase 3 into `/settings`.
- **ADR-0136..0139: Settings Web UI** (access model, HTTP API, client SPA, command retirement) — the settings SPA this sweep refactors.
- **ADR-0121: Debug/Admin Surface Split and Dashboard Redesign** — the surface split this sweep converges.
- **ADR-0166: Storybook Harness — PR 1** — the `bun check:bundle-isolation` gate the verification relies on.

## Implementation Notes

Verified present in the codebase (light confirmation via `grep`/`glob`, not exhaustive):

| File                                                   | Role                                                                                                                                                  | Evidence         |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `client/settings/components/ConfigFieldRow.svelte`     | Imports `Btn`/`Input`/`Secret` (lines 12–14).                                                                                                         | `grep` confirms. |
| `client/settings/sections/ProfileSection.svelte`       | Imports `EmptyState`/`IconButton`/`PageHeader` (lines 10–12); empty branch → `EmptyState` (line 57).                                                  | `grep` confirms. |
| `client/settings/sections/TaskProviderSection.svelte`  | Imports `Btn`/`Field`/`IconButton`/`PageHeader`/`Secret`/`Select`/`SummaryList` (lines 9–15); empty branches kept as `.placeholder` (lines 120, 145). | `grep` confirms. |
| `client/settings/sections/ToolsSection.svelte`         | Imports `Btn`/`EmptyState`/`IconButton`/`PageHeader`/`Pill` (lines 7–11); expand control stayed raw `<button aria-expanded>` (lines 243–247).         | `grep` confirms. |
| `client/settings/sections/IdentitySection.svelte`      | Imports `Btn`/`Field`/`IconButton`/`Input`/`PageHeader` (lines 9–13); no `FormRow`.                                                                   | `grep` confirms. |
| `client/settings/sections/MembersSection.svelte`       | Imports `Btn`/`DataTable`/`Field`/`IconButton`/`Input`/`PageHeader` (lines 9–14).                                                                     | `grep` confirms. |
| `client/settings/sections/GroupProviderSection.svelte` | Imports `Btn`/`Field`/`IconButton`/`PageHeader`/`Select` (lines 7–11).                                                                                | `grep` confirms. |
| `client/settings/sections/PluginsSection.svelte`       | Imports `Btn`/`EmptyState`/`Field`/`IconButton`/`Input`/`PageHeader`/`Pill` (lines 9–15).                                                             | `grep` confirms. |
| `client/settings/sections/McpSection.svelte`           | Imports `Btn`/`Field`/`IconButton`/`Input`/`PageHeader` (lines 9–13); "Enabled" checkbox stayed native `type="checkbox"` (line 173).                  | `grep` confirms. |
| `client/shared/ui/IconButton.svelte`                   | New primitive introduced this phase; exists.                                                                                                          | `glob` confirms. |

Plan-vs-implementation notes:

- **`PageHeader` pulled forward.** The plan explicitly deferred the eyebrow+`<h2>` → `PageHeader` (B1) migration to a Phase 3.3-end cleanup so it could be done uniformly across user + admin sections. The implementation instead adopted `PageHeader` across all nine user sections (and the admin sections) within this phase, achieving that uniformity now and resolving the `TaskProviderSection` duplicate header.
- **`IconButton` introduced.** The plan specified converting each section's Refresh `<button>` to `Btn variant="ghost" size="sm"`. The implementation instead routes icon-only refresh controls through a new `IconButton` primitive (`label`/`glyph`/`busy`/`testid`/`onClick`) — a better fit for the icon action and adding a `busy` loading affordance `Btn` did not model. `IconButton` is not in the Phase 1 kit inventory (spec §6); it was added during this sweep.
- **`FormRow` not adopted.** `IdentitySection`'s action row uses inline `Btn`s (the plan's explicitly optional alternative), so `FormRow` remains unused in `/settings`.
- **`TaskProviderSection` `EmptyState`.** Plan Task 3 called for `EmptyState` in `TaskProviderSection`; the shipped file retains `.placeholder` spans for its empty/loading branches. The other empty-branch sections (Profile, Tools, Plugins) did adopt `EmptyState`.
- **Native checkbox + `aria-expanded` preserved as planned** — `McpSection` "Enabled" checkbox (line 173) and `ToolsSection` expand control (lines 243–247) stayed raw.
- **Dead `settings.css` rules not yet deleted** — deferred to the Phase 3.3-end cleanup as planned; `.settings-form *`/`.settings-table`/`.masked-value`/`.placeholder` remain.

This is the last backstage plan, so the shared spec `docs/superpowers/specs/2026-06-01-backstage-admin-ui-fixes-design.md` is archived alongside this plan to `docs/archive/`.
