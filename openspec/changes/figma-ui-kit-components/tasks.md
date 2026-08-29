## 1. Preparation

- [x] 1.1 Run the baseline audit: registry `plan` output, live read-back of the 6 existing components (`mismatches: 0`), and existence check of all 18 screen/section node ids; record in the change folder for the preservation check
- [x] 1.2 Read `interface Props` of the 4 shared sources (`client/shared/Modal.svelte`, `Confirm.svelte`, `TreeView.svelte`, `PropertiesTable.svelte`) and note Figma-representable props

## 2. Shared components (batch 1)

- [x] 2.1 Build `shared/Modal`, `shared/Confirm`, `shared/TreeView`, `shared/PropertiesTable` on `Editable UI` per design D2/D3, ≤10 ops per `use_figma` call, returning node ids
- [x] 2.2 Append 4 registry entries with created node ids, props/values maps from step 1.2
- [x] 2.3 Run `plan` → push descriptions → read-back (`mismatches: 0`) → `validate`; report drift if any

## 3. Recurring patterns (batch 2)

- [x] 3.1 Read `interface Props` of the source regions the patterns map to (design D3a): `SettingsTable.svelte`, `TaskProviderSection.svelte`, `ToolsSection.svelte`, `OverviewSection.svelte`
- [x] 3.2 Build `ui/DataTable` (set: empty/populated states as needed), `ui/Select` (set: default/open), `ui/Segmented` (set: option × selected), `ui/Pill` (set: tones), `ui/MetricCard` (single, text props)
- [x] 3.3 Register, push, read-back, validate batch 2

## 4. Settings components (batches 3–4)

- [x] 4.1 Read `interface Props` for `SettingsFieldShell`, `SettingsTable`, `SettingsGate`, `SettingsGroupToggle`, `SettingsJumpMenu`, `ConfigFieldRow`
- [x] 4.2 Build batch 3 (`settings/` prefix), register, push, read-back, validate
- [x] 4.3 Read `interface Props` for `ProviderForm`, `ProviderModelsEditor`, `RoleBindingBlock`, `PluginCard`, `IdCell`, `VerificationPill`
- [x] 4.4 Build batch 4, register, push, read-back, validate

## 5. Admin components (batches 5–6)

- [x] 5.1 Read `interface Props` for `AdminTopBar`, `AdminSidebarPanel`, `StatsPanel`, `SubjectDetail`
- [x] 5.2 Build batch 5 (`admin/` prefix), register, push, read-back, validate
- [x] 5.3 Read `interface Props` for `SubjectsTable`, `SubjectStatsPanel`, `AdminJumpMenu`
- [x] 5.4 Build batch 6, register, push, read-back, validate

## 6. Verification

- [x] 6.1 Re-run the step 1.1 audit: all 28 new + 6 existing descriptions match plan output with `mismatches: 0`; all screen/section node ids still resolve; existing nodes unchanged
- [x] 6.2 Confirm every registry entry's source path exists (`validate` passes) and every kit component sits on page `Editable UI`
- [x] 6.3 Spot-check 3 representative components with `get_design_context`: instance props translate through the registry to valid code usage without invented props
