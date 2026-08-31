# figma-ui-kit Specification

## Purpose

A file-local Figma component kit mirroring papai's `client/` UI components, so design-to-code resolves every kit component to its live source and edits made in Figma translate back into real code — instead of agents sketching generic substitutes.

## ADDED Requirements

### Requirement: Kit coverage mirrors client components

The kit SHALL contain a Figma component or component set for every component named in the registry's component entries, covering the shared components (`Modal`, `Confirm`, `TreeView`, `PropertiesTable`), the recurring patterns (`DataTable`, `Select`, `Segmented`, `Pill`, `MetricCard`), the settings components (`SettingsFieldShell`, `SettingsTable`, `SettingsGate`, `SettingsGroupToggle`, `SettingsJumpMenu`, `ConfigFieldRow`, `ProviderForm`, `ProviderModelsEditor`, `RoleBindingBlock`, `PluginCard`, `IdCell`, `VerificationPill`), and the admin components (`AdminTopBar`, `AdminSidebarPanel`, `StatsPanel`, `SubjectDetail`, `SubjectsTable`, `SubjectStatsPanel`, `AdminJumpMenu`), each sourced from its corresponding file under `client/`. All kit components SHALL live on the `Editable UI` page of file `o8B8JfxhFeOHqIfpv0eSdZ`, alongside the existing base kit.

#### Scenario: Shared component resolves

- **WHEN** an agent looks up `shared/Confirm` in the registry
- **THEN** it obtains a Figma node id on the `Editable UI` page whose description names `client/shared/Confirm.svelte`

#### Scenario: Settings component resolves

- **WHEN** an agent looks up `settings/SettingsTable` in the registry
- **THEN** it obtains a Figma node id whose component set or component renders the table structure matching `client/settings/components/SettingsTable.svelte`

#### Scenario: Admin component resolves

- **WHEN** an agent looks up `admin/SubjectsTable` in the registry
- **THEN** it obtains a Figma node id whose description names `client/admin/components/SubjectsTable.svelte`

### Requirement: Component variants match code props

For each kit component, the Figma property definitions (variant properties and component properties) SHALL cover every Figma-side property named in the registry's props dictionary for that entry, with variant values drawn from the corresponding code union types (e.g. `ui/Pill` exposes one variant per code tone; `ui/Segmented` exposes one option per code permission value). Properties absent from the dictionary SHALL NOT appear as code-mapped props.

#### Scenario: Value map resolves

- **WHEN** an agent translates a kit instance's property values through the registry value maps
- **THEN** every variant value used by instances resolves to a code value, and unmapped values are reported as drift rather than silently guessed

#### Scenario: Property drift is detectable

- **WHEN** a kit component's Figma property definitions no longer contain a property named in its registry dictionary
- **THEN** registry validation fails naming the entry and the missing property

### Requirement: Kit entries are registered and pushed

Every kit component SHALL have a registry entry (Figma node id, source path, props dictionary, value maps) in `scripts/figma/registry.json` and a canonical `CODE:` description pushed to its Figma node, and re-pushing an unchanged registry SHALL leave all kit descriptions byte-identical.

#### Scenario: Read-back is clean

- **WHEN** the read-back comparison runs against plan output after a push
- **THEN** all kit component descriptions match with `mismatches: 0`

### Requirement: Existing mirrors are preserved

Adding kit components SHALL NOT change the Figma node ids, names, variant definitions, or `CODE:` descriptions of the 6 existing base-kit components, the 5 registered screens, or the 13 registered sections on any page of the file.

#### Scenario: Base kit unchanged

- **WHEN** the registry audit re-runs after the kit expansion
- **THEN** all pre-existing component descriptions match plan output with no mismatches and all screen/section node ids still resolve
