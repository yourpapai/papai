<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0009: Multi-Provider Task Tracker Support

## Status

Accepted

## Date

2026-03-13

## Context

The original papai codebase was tightly coupled to Kaneo across six layers:

| Layer               | Coupling                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| HTTP client         | `KaneoConfig`, `kaneoFetch()`, Kaneo-specific auth (Bearer token + session cookie)              |
| Resource classes    | Kaneo REST endpoints, Kaneo-specific request/response Zod schemas                               |
| Domain functions    | 28 files each instantiating `KaneoClient`                                                       |
| Error system        | `KaneoError` discriminated union; `classifyKaneoError()` mapping HTTP codes                     |
| Tools               | 28 tool files importing from `src/kaneo/index.js`, passing `KaneoConfig`                        |
| Bot / system prompt | `buildKaneoConfig()`, Kaneo-specific prompt language, `makeTools({ kaneoConfig, workspaceId })` |

Several Kaneo-specific concepts had no equivalents in other trackers: workspaces, kanban column management, frontmatter-based task relations (a papai workaround for Kaneo's lack of native relations), and session-cookie authentication. Meanwhile, elements like the LLM pipeline, config system, user system, conversation history, and memory were already provider-agnostic.

The goal was to enable any user to configure a different task tracker backend (YouTrack initially, with a clear path to Linear, Jira, and others) while retaining full Kaneo compatibility.

## Decision Drivers

- A second supported tracker (YouTrack) was being actively developed and required a stable abstraction.
- Tools should not need to be rewritten for each new provider — the LLM-facing tool API (`create_task`, `search_tasks`, etc.) is the same regardless of backend.
- Not all providers support all operations (e.g., YouTrack has native statuses as first-class objects; Kaneo exposes them as kanban columns). The tool set exposed to the LLM must reflect what the active provider actually supports.
- Error classification should produce provider-neutral user-facing messages.

## Considered Options

### Option 1: Copy-paste per-provider tool sets

- **Pros**: Each provider fully controls its tool definitions.
- **Cons**: Duplicates Zod schemas and tool descriptions; each new provider requires writing 28+ tool files.

### Option 2: Provider interface + capability-based shared tools (chosen)

- **Pros**: Single set of tool definitions; capability flags gate which tools are exposed; providers only implement what they support.
- **Cons**: Requires a normalization layer mapping provider-native types to common domain types (`Task`, `Project`, `Comment`, etc.).

### Option 3: Plugin system with dynamic loading

- **Pros**: Providers could be distributed as npm packages; hot-swappable.
- **Cons**: Premature complexity for the current use case; static registration is simpler and sufficient.

## Decision

A `TaskProvider` interface was defined in `src/providers/types.ts` with:

- **Core operations** (always required): `createTask`, `getTask`, `updateTask`, `listTasks`, `searchTasks`
- **Optional operations** gated by capability flags: `archiveTask`, `deleteTask`, project CRUD, comment CRUD, label CRUD, relation management, status (column) management
- **Capability type**: a union string literal type (`'tasks.archive'`, `'comments.create'`, `'statuses.reorder'`, etc.) stored in `provider.capabilities: ReadonlySet<Capability>`
- **URL builders**: `buildTaskUrl`, `buildProjectUrl`
- **Error classification**: `classifyError(error): AppError`
- **Dynamic system prompt**: `getPromptAddendum(): string` for provider-specific LLM instructions

A provider registry (`src/providers/registry.ts`) maps provider names to factory functions. `createProvider(name, config)` instantiates the named provider.

The existing Kaneo code was reorganized into `src/providers/kaneo/`, implementing `TaskProvider` via a `KaneoProvider` class. YouTrack was added as `src/providers/youtrack/` implementing the same interface.

`makeTools(provider: TaskProvider)` in `src/tools/index.ts` replaced the old `makeTools({ kaneoConfig, workspaceId })`. Each tool receives the provider instance and calls `provider.createTask()`, `provider.listProjects()`, etc. Capability checks gate optional tools: if `provider.capabilities.has('comments.create')` is false, `add_comment` is not added to the tool set.

A provider-agnostic error type `ProviderError` was introduced in `src/providers/errors.ts` with a `type: 'provider'` discriminant, replacing the Kaneo-specific `KaneoError`. Each provider's `classifyError` method maps native errors to `ProviderError` codes. User-facing messages are now provider-neutral ("Task not found" instead of "Kaneo task not found").

The `TASK_PROVIDER` environment variable (set at deployment time) selects the provider for all users. Per-user provider selection via a `provider` config key was considered but the final implementation uses a global `TASK_PROVIDER` env var, simplifying the model.

## Rationale

The interface approach keeps tool definitions stable across all providers — the LLM-facing API does not change when the backend changes. Capability flags allow partial implementations (e.g., a provider that supports task CRUD but not label management) without null-checking or silent no-ops. Moving Kaneo code into `src/providers/kaneo/` makes the boundary explicit and enables the schema relocation described in ADR-0007.

## Consequences

### Positive

- Adding a new provider requires only implementing `TaskProvider` and registering a factory — no changes to tools, bot orchestration, or LLM prompting.
- YouTrack is a fully working second provider, validating the abstraction.
- The LLM only sees tools the active provider actually supports, preventing hallucinated calls to unsupported operations.
- Error messages are provider-neutral, giving a consistent user experience regardless of backend.
- The system prompt is dynamically extended by `provider.getPromptAddendum()`, allowing providers to inject provider-specific instructions (e.g., Kaneo explains kanban columns; YouTrack explains issue IDs).

### Negative

- Normalization to common types (`Task`, `Project`, etc.) may lose provider-specific fields that could be useful to the LLM (e.g., YouTrack's subsystems, Kaneo's workspace structure).
- `TASK_PROVIDER` is a global deployment-level setting. All users share the same provider; per-user multi-provider configuration is not supported.
- `KaneoProvider` retains Kaneo-specific concepts (workspace ID, frontmatter relations) that do not map cleanly to the common interface. Workspace is passed as a constructor argument rather than being part of the `TaskProvider` interface.
- The frontmatter-based relation system in `src/providers/kaneo/frontmatter.ts` is Kaneo-specific and remains an implementation detail hidden behind the `addRelation`/`removeRelation` interface methods.

## Implementation Status

**Status**: Implemented

Evidence:

- `src/providers/types.ts` defines `TaskProvider`, `Capability`, and common domain types (`Task`, `TaskListItem`, `TaskSearchResult`, `Project`, `Comment`, `Label`, `Column`, `TaskRelation`, `RelationType`).
- `src/providers/registry.ts` exports `createProvider(name, config)` with `kaneo` and `youtrack` registered.
- `src/providers/kaneo/` contains `KaneoProvider` in `index.ts`, with `schemas/`, `operations/` (tasks, comments, labels, projects, statuses, relations), `client.ts`, `classify-error.ts`, and `frontmatter.ts`.
- `src/providers/youtrack/` contains `YouTrackProvider` in `index.ts`, with `schemas/`, `operations/` (tasks, comments, projects), `client.ts`, `classify-error.ts`.
- `src/providers/errors.ts` defines `ProviderError`, `providerError` constructors, `getProviderMessage`, and `ProviderClassifiedError`.
- `src/tools/index.ts` exports `makeTools(provider: TaskProvider, userId?: string)` with full capability-gated tool assembly across 8 `maybeAdd*` helpers.
- `src/llm-orchestrator.ts` reads `TASK_PROVIDER` env var and calls `createProvider` to build the active provider per request.
- Both Kaneo and YouTrack providers implement `getPromptAddendum()` with provider-specific LLM instructions.

## Related Plans

- `/docs/plans/done/multi-provider-support.md`
- ADR-0007 (layered architecture enforcement, which relocated provider code and extracted the orchestration layer)
