# Provider Conventions

## Built-In vs Plugin Providers

`createProvider` resolves task providers exclusively through the plugin-contributed registry. There are no built-in task provider factories; **`builtinDescriptorSeeds`** is empty.

Both first-party providers are plugin-contributed:

- **Kaneo**: `plugins/task-provider-kaneo/` — canonical reference implementation.
- **YouTrack**: `plugins/task-provider-youtrack/` — second provider-plugin example with a simpler config schema (instance **`baseUrl`**, context **`token`**).

Providers are registered via `ctx.registration.registerTaskProviderType()` in an approved, active plugin. `createProvider` resolves only through the contributed registry.

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
