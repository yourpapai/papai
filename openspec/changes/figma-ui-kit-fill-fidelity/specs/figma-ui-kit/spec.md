# figma-ui-kit Specification

## ADDED Requirements

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
