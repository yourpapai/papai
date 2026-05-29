# Provider Conventions

## Built-In vs Plugin Providers

`createProvider` resolves task providers through two paths:

1. **Plugin-contributed** (preferred): providers registered via `ctx.registration.registerTaskProviderType()` in an approved, active plugin. After Phase 3 of the task-provider migration, Kaneo is exclusively a plugin-contributed provider at `plugins/task-provider-kaneo/`. There is no built-in factory or descriptor for Kaneo in `src/providers/`.
2. **Built-in**: YouTrack remains a built-in provider until Phase 4.

`plugins/task-provider-kaneo/` is the canonical reference implementation for a provider plugin.

## Interface

All providers implement `TaskProvider` from `src/providers/types.ts`. Core methods are required; optional methods are gated by `Capability` strings (e.g. `'tasks.archive'`, `'comments.create'`).

## Operations

- One file per domain in `operations/` subdirectory (tasks, comments, labels, projects, statuses, relations)
- Function naming: `[provider][Entity][Action]` — e.g. `kaneoCreateTask`, `createYouTrackTask`
- Parameters: `config` first, then entity-specific params (often grouped in an object)
- Return normalized domain types from `src/providers/types.ts` (`Task`, `Project`, `Comment`, `Label`, `Status`)
- Map provider-specific API responses to normalized types before returning

## Schemas

- Use **Zod v4** for all API request/response validation
- Place schemas in `schemas/` subdirectory
- Pattern: enums first, main schema object, then `export type X = z.infer<typeof XSchema>`
- Use `.nullable()` for optional API fields, `.optional()` for fields that may be absent
- Compose schemas with `.extend()` for related types at different detail levels

## Error Handling

- Each provider has a `classify-error.ts` that maps HTTP errors to `AppError` (discriminated union from `src/errors.ts`)
- Use provider-specific `ClassifiedError` class wrapping `AppError`
- Classify by HTTP status: 401/403 → `authFailed`, 404 → entity-specific not-found, 429 → `rateLimited`, 400 → `validationFailed`, 500+ → `unexpected`
- Preserve context (taskId, projectId, etc.) in classified errors
- Detect network errors via message pattern matching (`fetch`, `econnrefused`, `enotfound`)

## Client

- Provider-specific fetch wrapper in `client.ts`
- Config type: `{ baseUrl: string, token/apiKey: string, ... }`
- Kaneo: generic `kaneoFetch<T>()` with schema validation built in
- YouTrack: `youtrackFetch()` returns raw data, callers validate with Zod

## Logging (mandatory)

Every function entry must have `logger.debug()` with all input parameters:

```typescript
const log = logger.child({ scope: 'provider:kaneo:tasks' })

export async function kaneoCreateTask(
  config: KaneoConfig,
  workspaceId: string,
  params: CreateTaskParams,
): Promise<Task> {
  log.debug({ workspaceId, title: params.title, projectId: params.projectId }, 'kaneoCreateTask')
  // ...
  log.info({ taskId: result.id, title: params.title }, 'Task created')
  return result
}
```

- `debug`: function entry with parameters
- `info`: successful completion with result identifiers
- `error`: caught exceptions with `error instanceof Error ? error.message : String(error)`
- Use `param !== undefined` (not `!!param`) for boolean checks in log context
