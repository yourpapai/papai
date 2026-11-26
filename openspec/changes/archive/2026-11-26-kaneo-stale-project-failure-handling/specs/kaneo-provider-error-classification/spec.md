## Purpose

Makes Kaneo's project-missing signal actionable: a 400 whose body indicates the workspace could not be determined classifies as `project-not-found` with the failing request's project id, surfaced through the provider `classifyError` contract to every consumer.

## ADDED Requirements

### Requirement: Kaneo project-missing 400s classify as project-not-found

When a Kaneo project-scoped request fails with HTTP 400 and a body indicating the workspace could not be determined (Kaneo's signal that the referenced project does not exist or is not visible to the caller's credentials), the provider SHALL classify the error as `project-not-found` carrying the failing request's project id, and SHALL surface that classification through the provider `classifyError` contract to every consumer (chat tool failures, scheduler, alerts). All other error semantics SHALL be unchanged: 404s keep resource-specific not-found classification, other 400s stay validation failures, 401/403 stay auth failures, 429 stays rate-limited.

#### Scenario: Column listing for a missing project

- **WHEN** a task creation flow lists columns for a project id that does not exist in (or is not visible to) the caller's Kaneo workspace and Kaneo answers 400 with the workspace-marker body
- **THEN** the error classifies as `project-not-found` with that project id

#### Scenario: Genuine validation failures stay validation failures

- **WHEN** a Kaneo request fails with 400 for a different reason (e.g. a missing required field or invalid payload shape)
- **THEN** the error classifies as a validation failure, not `project-not-found`

#### Scenario: Existing classes unchanged

- **WHEN** Kaneo answers 404, 401, 403, or 429
- **THEN** classification is exactly as before this capability (resource-specific not-found, auth failure, rate-limited)

#### Scenario: Chat guidance

- **WHEN** a chat tool call fails through the above path
- **THEN** the user-facing failure guidance names the missing project rather than a raw status code
