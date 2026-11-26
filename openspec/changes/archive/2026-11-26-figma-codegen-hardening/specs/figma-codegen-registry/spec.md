# figma-codegen-registry — delta spec

## ADDED Requirements

### Requirement: Registry is scoped to a Figma file

The registry SHALL declare the Figma file it maps into as a required top-level `fileKey`. Validation SHALL fail when the field is missing or empty. The plan step SHALL include the file key in every emitted payload, and the push workflow SHALL verify the target file's key matches before writing any description.

#### Scenario: Missing file key

- **WHEN** the registry has no `fileKey` (or it is empty)
- **THEN** `figma:connect validate` fails and names the missing field

#### Scenario: Plan surfaces the file key

- **WHEN** an agent runs the plan step
- **THEN** every emitted payload carries the registry's `fileKey`, and the agent confirms it matches the Figma file about to be edited before pushing anything
