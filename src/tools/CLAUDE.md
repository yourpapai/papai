# Tool Conventions

## Definition Pattern

Tools use the Vercel AI SDK `tool()` factory from `ai`, but the exported tool is not the final execution surface. All tool sets are wrapped by `wrapToolExecution()` in `src/tools/index.ts`, which converts thrown failures into structured tool-failure payloads.

```typescript
export function makeExampleTool(provider: Readonly<TaskProvider>): ToolSet[string] {
  return tool({
    description: 'Clear, precise tool description',
    inputSchema: z.object({
      field: z.string().describe('What this field means'),
    }),
    execute: async ({ field }) => {
      const result = await provider.someMethod?.(field)
      log.info({ field }, 'Tool completed')
      return result
    },
  })
}
```

## Assembly

- Core tool construction starts in `src/tools/core-tools.ts`.
- Context-aware assembly happens in `src/tools/tools-builder.ts`.
- Public entry point is `makeTools(provider, options)` in `src/tools/index.ts`.
- After capability + context gating and plugin merge, `makeTools()` applies the
  per-context tool denylist from `src/tools/tool-preferences.ts` (default all-on).
  Disabled tools are physically removed from the returned `ToolSet`, so they cannot be
  invoked. Preferences are keyed by the same `storageContextId` used elsewhere.

`MakeToolsOptions` controls tool exposure:

- `storageContextId`: user or conversation storage key
- `chatUserId`: real chat actor ID
- `mode`: `normal` or `proactive`
- `contextType`: `dm` or `group`

Those options matter. For example:

- deferred prompt tools are excluded in `proactive` mode
- identity tools only appear in group context and only when the provider exposes `identityResolver`
- attachment upload consumes incoming files from the in-memory file relay, so relay storage and tool assembly must stay aligned on the context key they use
- group-history lookup only appears for thread-scoped group storage contexts

## Naming

- One tool per file in `src/tools/`
- Factory name: `make[Action]Tool`
- Tool key: `snake_case`

## Input Schema

- Use `.describe()` on every field; descriptions are part of the LLM-facing contract.
- Prefer explicit optionality over implicit defaults.
- Encode user-facing confirmation or selection semantics directly in the schema when the tool depends on them.

## Capability Gating

- Never assume provider support from method existence alone; check `provider.capabilities` and any additional contract conditions used by the builder.
- The actual exposed tool surface is defined by `buildTools()` plus the current context, not just by a provider class.

## Execution and Failures

- Tool code may throw; the wrapper converts thrown failures into structured outputs via `buildToolFailureResult()`.
- Do not depend on uncaught tool exceptions bubbling directly back into the orchestrator.
- Log failures before rethrowing inside the tool, and let the wrapper normalize the outward result.

## Destructive Actions

- Use the shared confirmation helpers from `src/tools/confirmation-gate.ts` for destructive actions.
- Reuse `confidenceField` in the schema and `checkConfidence()` in execution.
- If the confidence check fails, return the shared `{ status: 'confirmation_required', message }` shape instead of executing.
- Use human-readable labels in confirmation text when available.

This pattern applies to destructive removals such as task deletion, project deletion, label removal, attachment removal, and work-log removal.

## Shared-State Status Mutations

- Status tools use a different confirmation pattern from destructive confidence gating.
- `create_status`, `update_status`, `delete_status`, and `reorder_statuses` may accept `confirm: true` and return `confirmation_required` when a provider needs explicit confirmation for shared state-bundle mutations.
- Keep that distinction clear in docs and code.

## Current Context-Sensitive Tool Areas

- attachments: `upload_attachment` consumes incoming files from the per-context attachment workspace in `src/attachments/`
- web fetch: `web_fetch` is user/context scoped, rate-limited, cached, and restricted to public HTTP(S) content
- identity: `set_my_identity` and `clear_my_identity` are group-only and provider-dependent
- history lookup: `lookup_group_history` searches the main group history when the current context is a thread-scoped group conversation
- plugin tools: when `storageContextId` and `chatUserId` are set, `makeTools()` merges tools from plugins that are active **and** eligible for the current context. Plugin tool names are namespaced (`plugin_<plugin_id>__<tool_name>`) and execute against a `PluginToolRuntimeContext` with a permission-gated task-provider facade — plugins never receive the raw provider. See the Plugin System section in `CLAUDE.md` and `docs/plugins/developer-guide.md`.

## Logging

- `debug` for tool entry and key parameters
- `info` for successful operations with result identifiers
- `warn` for blocked confirmations or degraded non-fatal behavior
- `error` for caught failures with `tool` name and normalized message
