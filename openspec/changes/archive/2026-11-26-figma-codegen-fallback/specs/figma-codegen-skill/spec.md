# figma-codegen-skill — delta spec

## Purpose

The agent-facing protocol that turns Figma's surfaced hints into papai-idiomatic code: any agent generating code from papai Figma nodes SHALL resolve mapped components and screen sections to their live Svelte sources instead of emitting the generic sketch.

## ADDED Requirements

### Requirement: Mapped components resolve to real code

The skill SHALL instruct agents that a Figma node whose description carries the canonical `CODE:` marker MUST be emitted as usage of the mapped code component, with props translated through the registry dictionary and value maps. The generic design-to-code sketch MUST NOT be the final output for a mapped component.

#### Scenario: Button instance generates Svelte
- **WHEN** an agent encounters a `ui/Btn` instance with `Variant=Danger`, `Label=Remove`
- **THEN** it emits usage of the mapped Svelte component (e.g. `<Btn variant="danger">Remove</Btn>` with the mapped import), not a restyled `<div>`

#### Scenario: Unmapped Figma property
- **WHEN** a Figma component exposes a property with no entry in the registry dictionary
- **THEN** the agent omits it rather than inventing a code prop

### Requirement: Screens compose from registered sections

When generating code for a registered screen, the agent SHALL map each registered section to its source region and compose the output from those sources; unregistered regions SHALL fall back to faithful structure from the design with a note marking them unmapped.

#### Scenario: Screen generation uses sections
- **WHEN** an agent generates code for `screen/TaskProviderSection`
- **THEN** registered sections (header, bind form, provision block) emit from their mapped Svelte sources, and any unregistered region is flagged as unmapped in the output

### Requirement: Drift is surfaced, not silently resolved

When a Figma component's properties disagree with the mapped Svelte source (renamed prop, missing variant), the agent SHALL report the mismatch explicitly instead of silently choosing one side.

#### Scenario: Figma and source disagree
- **WHEN** the Figma component exposes a `Tone` property that the mapped Svelte component does not accept
- **THEN** the agent reports the mismatch and proceeds only with the properties both sides share

### Requirement: Skill is discoverable and scoped

The skill SHALL live at `.claude/skills/figma-codegen/SKILL.md`, be routed from the CLAUDE.md skill table, and declare itself required before any figma design-to-code task on papai files.

#### Scenario: Agent loads skill before codegen
- **WHEN** a design-to-code task targets a papai Figma file
- **THEN** the skill's protocol is loaded and followed before emitting code
