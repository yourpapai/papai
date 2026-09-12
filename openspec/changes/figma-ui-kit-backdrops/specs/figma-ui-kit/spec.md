# figma-ui-kit Specification

## ADDED Requirements

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
