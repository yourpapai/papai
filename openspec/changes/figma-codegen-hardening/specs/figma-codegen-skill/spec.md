# figma-codegen-skill — delta spec

## ADDED Requirements

### Requirement: Push and verification steps are codified

The skill SHALL include the canonical Figma-MCP scripts for the two agent-run steps of the refresh workflow: (a) pushing component descriptions from plan payloads, batched with a small per-call limit and reporting the mutated node ids, and (b) reading descriptions back and comparing them against plan output, reporting zero mismatches when the push is idempotent. Agents SHALL use these scripts rather than improvised equivalents.

#### Scenario: Agent performs the push

- **WHEN** an agent applies plan payloads to Figma component descriptions
- **THEN** it runs the skill's push script (batched, returning mutated node ids) instead of writing its own

#### Scenario: Agent verifies idempotence

- **WHEN** an agent checks that a push is a no-op
- **THEN** it runs the skill's read-back script, which compares descriptions against plan output and reports the mismatch count (zero when idempotent)
