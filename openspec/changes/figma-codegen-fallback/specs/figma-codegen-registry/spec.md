# figma-codegen-registry — delta spec

## Purpose

A versioned registry mapping papai's Figma components and screen sections to their Svelte sources, with validation and a push step that keeps Figma-side descriptions canonical — so agents never guess the component↔code mapping.

## ADDED Requirements

### Requirement: Registry maps Figma components to code sources

The registry (`scripts/figma/registry.json`) SHALL contain, for every mapped Figma component and screen section: the Figma node id, the Figma component name, the repo source path, a property dictionary (Figma property name → code prop), and value maps (Figma value → code value). Entries for the base kit (`ui/Btn`, `ui/Input`, `ui/Field`, `ui/PageHeader`, `ui/SidebarLink`, `ui/TopBar`) MUST exist before any screen-section entries.

#### Scenario: Component entry resolves
- **WHEN** an agent or script looks up `ui/Btn` in the registry
- **THEN** it obtains the node id (`19:35`), the source path `client/shared/ui/Btn.svelte`, a property dictionary mapping `Variant` → `variant` and `Label` → children, and the value map (`Primary` → `primary`, `Secondary` → `secondary`, `Outline` → `outline`, `Ghost` → `ghost`, `Danger` → `danger`)

#### Scenario: Screen section entry resolves
- **WHEN** an agent looks up the `Bind form` section of the `screen/TaskProviderSection` screen
- **THEN** the registry resolves it to the corresponding region in `client/settings/sections/TaskProviderSection.svelte`

### Requirement: Registry validation detects drift

The `bun figma:connect` validation step SHALL fail, naming the offending entries, when: a mapped source file does not exist in the repo; or a Figma node id no longer resolves; or a Figma component's property definitions no longer match the registry's property dictionary.

#### Scenario: Deleted source file
- **WHEN** a registry entry's source path no longer exists
- **THEN** validation fails and reports the entry name and missing path

#### Scenario: Stale node id
- **WHEN** a registry node id does not resolve in the Figma file
- **THEN** validation fails and reports the entry name and node id

#### Scenario: Property drift
- **WHEN** a Figma component's property definitions no longer contain a property named in the registry dictionary
- **THEN** validation fails and reports both the missing Figma property and the registry entry

### Requirement: Description push is canonical and idempotent

The push step SHALL write each mapped node's Figma description in a canonical `CODE:` format containing the source path, the property dictionary, and the value map. Pushing the same registry twice SHALL produce identical descriptions (idempotent).

#### Scenario: Push writes contract
- **WHEN** `bun figma:connect` pushes a registry entry
- **THEN** the Figma node's description starts with `CODE:` and contains the source path, property dictionary, and value map

#### Scenario: Re-push is a no-op
- **WHEN** push runs twice with an unchanged registry
- **THEN** the second push reports no changed descriptions
