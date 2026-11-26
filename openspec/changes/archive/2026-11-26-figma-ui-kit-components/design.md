# Design — Figma UI kit components

## Context

The `Editable UI` page (file `o8B8JfxhFeOHqIfpv0eSdZ`) hosts 6 registered components, 5 screens, 13 sections; `scripts/figma/registry.json` is the source of truth, projected into Figma descriptions by `bun run figma:connect plan` + push (see proposal). 28 client components have no Figma mirror. All work happens through the Figma MCP (`use_figma` + registry scripts); no `client/` code changes.

## Goals / Non-Goals

- Goals: 28 buildable components matching code `Props`; registry entries with props/values maps; canonical `CODE:` descriptions pushed and read-back clean; existing mirrors untouched.
- Non-goals: re-wiring screens/sections to the new components; variables/tokens; org library publishing (see proposal).

## Decisions

### D1. Naming: `<domain>/<CodeComponentName>`
`shared/Modal`, `ui/DataTable`, `settings/SettingsTable`, `admin/SubjectsTable`. Domain = owning `client/` directory; name = exact Svelte component name. *Alternative*: reuse the base-kit convention of conceptual names (`ui/TopBar` ← `SettingsTopBar.svelte`) — rejected: with 28 entries, name≠file ambiguity becomes unresolvable for agents; the registry `source` field stays authoritative, names become greppable.

### D2. Set vs single component by prop shape
Component sets with variant properties where the code prop is a finite union: `ui/Pill` (tone), `ui/Segmented` (option/state), `settings/SettingsGroupToggle` (on/off), `settings/VerificationPill` (state), `ui/Select` (state: default/open). Everything else is a single COMPONENT with text/boolean instance props for strings/flags (labels, counts, active). Precedent: `ui/Btn` set vs `ui/TopBar` single. Boolean props map through `values: True→true, False→false` like `ui/SidebarLink`.

### D3. Visuals clone the existing kit language
Literal fills/strokes/text matching current `Editable UI` components (Inter, existing grays/radii); auto-layout everywhere, hug sizing; placeholder content mirrors Storybook defaults. Recurring patterns copy structure from the ad-hoc screen frames they generalize (DataTable ← `DataTable — members`, Segmented ← `Segmented — allow/ask/deny`, Pill ← `Pill — allow`, MetricCard ← `MetricCard — subjects`) but become independent components; screens keep their raw frames (non-goal).

### D3a. Pattern sources map to existing regions
*Amended during apply (batch 2):* the original premise — "the 5 pattern components have no dedicated `.svelte` file" — is stale. All five exist under `client/shared/ui/` (`DataTable.svelte`, `Select.svelte`, `SegmentedControl.svelte`, `Pill.svelte`, `MetricCard.svelte`), so their registry entries point at those dedicated files (the registry `source` is what codegen opens for `interface Props`; pointing at a region file would misresolve them). `validate` passes since the sources exist. The region mappings below remain the *visual* clone sources.

The 5 pattern components originally assumed no dedicated `.svelte` file, and `validate` fails on missing sources — their registry entries were to point at the existing source region that renders them, reusing the established one-source-many-entries precedent (`ui/SidebarLink` + `Sidebar` section → `SettingsSidebar.svelte`): `ui/DataTable` → `client/settings/components/SettingsTable.svelte`, `ui/Select` → `client/settings/sections/TaskProviderSection.svelte` (Bind form Select), `ui/Segmented` + `ui/Pill` → `client/settings/sections/ToolsSection.svelte`, `ui/MetricCard` → `client/admin/sections/OverviewSection.svelte` (KPI row). No `client/` changes.

### D4. Build in batches with registry-after-create
Create components in 6 batches (shared 4 → patterns 5 → settings A 6 → settings B 6 → admin A 4 → admin B 3), ≤10 logical ops per `use_figma` call, returning created node ids each call. After each batch: append registry entries with the *created* node ids (never pre-registered — node ids must be observed, not guessed), run `bun run figma:connect plan`, push payloads via the skill's push script (≤10 per call), run the read-back script. File-check guard (`FILE_KEY !== target` throw) on every push call.

### D5. Props dictionaries from live source contracts
Before mapping each component, read its `.svelte` `interface Props`; dictionary maps only Figma-representable props (strings, booleans, unions). Slots/svelte fragments, function props, and `children` map to `children` text or are omitted — never invented. Any code prop with no Figma counterpart, or design detail contradicting code, is reported as drift in the batch summary, not silently resolved.

## Risks / Trade-offs

- [Node id instability after later edits] → registry is written from returned ids immediately per batch; `bun run figma:connect validate` after every batch catches stale ids early.
- [28 components drift from code over time] → value maps + read-back make drift detectable; per-batch `plan`/push keeps descriptions canonical.
- [Variant explosion on wide unions (e.g. Segmented × state)] → cap sets at the combinations the code actually renders (one variant axis per union prop), note combination gaps as drift.
- [Font-load failures on text mutation] → every text edit loads the node's current fonts first (canonical recipe).
- [Batch interrupted mid-way leaves unregistered nodes] → batches are idempotent to resume: audit page for unregistered components, then continue from that batch.

## Migration Plan

Additive only: new Figma nodes + registry entries. Rollback = delete created components and registry entries; existing 6 components/screens/sections are untouched throughout (verified by re-running the audit before/after).

## Open Questions

None.
