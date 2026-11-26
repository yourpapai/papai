# figma-ui-kit Specification

## Purpose

Defines the Figma kit that mirrors `client/` components: legible backdrop plates for transparent-background sources, no stray default fills, coverage and variant parity with code props, and registered pushes that preserve existing mirrors.

## Requirements

### Requirement: Kit components are legible on backdrop plates

Every kit component on the `Editable UI` page SHALL sit on a labeled backdrop plate — a sibling frame placed behind the component set — whose fill approximates the backdrop the component renders against in the app (the page background `--bg` for transparent components; a surface tone where the mapped source composes onto one). Plates SHALL be presentation-only: they SHALL NOT be fills or children of any kit component, SHALL NOT appear in the registry, and SHALL NOT carry `CODE:` descriptions. Adding or adjusting plates SHALL NOT change any kit component's node id, name, variant or property definitions, fills, or `CODE:` description, and SHALL NOT change the 5 registered screens, 13 sections, or their node ids.

#### Scenario: Transparent component is readable

- **WHEN** a kit component whose source renders transparent fills (e.g. `ui/Select`, `ui/Segmented`, `settings/SettingsTable`) is viewed on the `Editable UI` page
- **THEN** it sits on a dark plate matching the app page background and its dim text is readable against the plate

#### Scenario: Plates stay out of codegen

- **WHEN** an agent reads a kit component from the page
- **THEN** no backdrop-plate content is part of the component subtree, and the registry and `plan` output contain no entries for plates

#### Scenario: Mirror preserved after plating

- **WHEN** the read-back audit runs after backdrop plates are added
- **THEN** all kit component descriptions match `plan` output with `mismatches: 0`, and component fills, variant definitions, and node ids are unchanged from the pre-plating audit

### Requirement: Kit mirror carries no stray default fills

The 5 registered screens, 13 sections, and all kit components on the `Editable UI` page SHALL NOT carry Figma's default opaque white fill on any container node. Every container fill SHALL match what its mapped `client/` source renders: purely structural containers SHALL be transparent; containers representing a visible app surface SHALL carry the literal surface color that source renders (per the kit's literal-color convention from `client/shared/tokens.css`); white SHALL remain only where the source itself renders white as an element color (text, iconography, badges). Fill corrections under this requirement SHALL NOT change any node's id, name, hierarchy, variant or property definitions, or `CODE:` description.

#### Scenario: Fill scan finds no default whites

- **WHEN** a fill scan enumerates every container node (excluding text and vector nodes) inside the 5 registered screens and the kit components on the `Editable UI` page
- **THEN** no node carries an opaque solid `#FFFFFF` fill unless its mapped source renders that white as an element color, and every other fill matches the transparent-or-surface rule above

#### Scenario: Component fix propagates to instances

- **WHEN** the `ui/PageHeader` and `ui/TopBar` components are corrected at their definitions
- **THEN** their instances inside the registered screens render the fix without any per-instance overrides

#### Scenario: Surface container mirrors its source

- **WHEN** a previously white container represents a visible app surface (panel, form field) rather than pure structure
- **THEN** its fill is the literal surface tone the mapped source renders, not white and not an invented color

#### Scenario: Mirror metadata preserved after fill fixes

- **WHEN** the read-back audit re-runs after fill corrections
- **THEN** all kit component descriptions match `plan` output with `mismatches: 0`, all screen/section/component node ids still resolve, and fills differ from the pre-fix audit only on the enumerated defect set

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
