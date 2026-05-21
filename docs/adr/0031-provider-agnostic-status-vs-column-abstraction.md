<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0031: Provider-Agnostic Status vs Column Abstraction

## Status

Accepted

## Date

2026-03-18

## Context

Different task trackers represent workflow states in fundamentally different ways:

| Provider | Concept | Implementation                                             |
| -------- | ------- | ---------------------------------------------------------- |
| Kaneo    | Columns | First-class Kanban board columns (create, reorder, delete) |
| YouTrack | State   | Custom field named "State" with workflow-governed values   |
| Linear   | Status  | Workflow states, managed via `updateTask`                  |
| Jira     | Status  | Workflow transitions, managed via `updateTask`             |

The `statuses.crud` capability was introduced for Kaneo's column management. When adding YouTrack as a second provider, it was unclear how to handle the `statuses.crud` capability — YouTrack has no equivalent column concept to manage.

## Decision Drivers

- `statuses.crud` requires `listStatuses`, `createStatus`, `updateStatus`, `deleteStatus`, `reorderStatuses` operations
- YouTrack's "State" is a custom field, not a separately managed resource
- Linear and Jira similarly don't expose status as a first-class CRUD resource
- The LLM must know which operations are available for the active provider

## Considered Options

### Option 1: YouTrack implements `statuses.crud` as no-ops

- **Pros**: Consistent interface across providers
- **Cons**: LLM could "create a status" and nothing would happen; silent failures are worse than explicit unsupported operations

### Option 2: Capability flag gates entire `statuses.crud` tool family for YouTrack (chosen)

- **Pros**: LLM never sees status management tools for YouTrack; no silent failures; YouTrack uses `updateTask({ status: "value" })` directly
- **Cons**: Kaneo-specific prompt language must explain the difference

### Option 3: Map all providers to a unified "status field" abstraction

- **Pros**: Single interface
- **Cons**: Loses provider-specific features (Kaneo's column ordering, YouTrack's workflow transitions); complex normalization layer

## Decision

YouTrack does NOT implement `statuses.crud`. The `statuses.crud` capability exists **only** for providers with first-class column management:

```typescript
// Kaneo — has first-class column/board management
const KaneoCapabilities = new Set([
  'tasks.archive',
  'tasks.delete',
  'tasks.relations',
  'comments.create',
  'comments.read',
  'comments.update',
  'comments.delete',
  'projects.list',
  'projects.create',
  'projects.update',
  'projects.archive',
  'labels.list',
  'labels.create',
  'labels.update',
  'labels.delete',
  'labels.assign',
  'statuses.list',
  'statuses.create',
  'statuses.update',
  'statuses.delete',
  'statuses.reorder',
] as const)

// YouTrack — status is a custom field, managed via updateTask
const YouTrackCapabilities = new Set([
  'tasks.archive',
  'tasks.delete',
  'tasks.relations',
  'comments.create',
  'comments.read',
  'comments.update', // remove not supported by YouTrack API
  'projects.list',
  'projects.archive', // partial project CRUD
  'labels.list',
  'labels.create',
  'labels.update',
  'labels.delete',
  'labels.assign',
  // NO statuses.crud — status handled via updateTask
] as const)
```

YouTrack uses `updateTask({ status: "new-state" })` with the LLM constructing valid state names from the provider's `getPromptAddendum()` which explains the available State field values.

## Rationale

Silent failures are worse than explicit unsupported operations. If the LLM calls `createStatus("Review")` on YouTrack and nothing happens (or an error occurs), it's confusing. By not declaring `statuses.crud` for YouTrack, the LLM never attempts those operations — it must use `updateTask` to change issue state directly.

## Consequences

### Positive

- LLM only sees tools the active provider actually supports
- No silent failures or confusing error messages
- YouTrack users can still change task state via `update_task` with explicit state names
- Kaneo users get full column management for Kanban workflow control

### Negative

- Different provider requires different LLM prompting strategy for status changes
- Kaneo prompt: "Use `create_status` to add a new column to the board"
- YouTrack prompt: "Use `update_task` with `status: "In Progress"` to change state"

### Implementation

`getPromptAddendum()` in each provider injects appropriate instructions:

```typescript
// Kaneo provider addendum (explains columns)
return `
// Status management: Use list_statuses, create_status, update_status, delete_status, reorder_statuses
// to manage Kanban board columns. Status values are column names on your board.
`.trim()

// YouTrack provider addendum (explains State field)
return `
// Status management: Use update_task with the status parameter to change issue state.
// Available state values are defined per project (e.g., "Open", "In Progress", "Fixed", "Verified").
// You cannot create or delete state values — they are defined by your YouTrack workflow.
// IMPORTANT: Only use state values that are valid for the issue's current workflow transition.
// `.trim()
```

## Related Decisions

- ADR-0009 (Multi-Provider Task Tracker Support) — defines the capability-gated tool system
- ADR-0026 (Proactive Assistance) — uses `statuses.reorder` for kanban-aware suggestions

## References

- YouTrack verification: `docs/youtrack-verification.md` (Section 7)
- Provider interface: `src/providers/types.ts` (`Capability` type)
- Tool assembly: `src/tools/index.ts` (`maybeAddStatusesTools`)
