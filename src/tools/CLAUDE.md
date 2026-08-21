# Tool Conventions

## Definition Pattern

Tools use the Vercel AI SDK `tool()` factory from `ai`, but the exported tool is not the final execution surface. Descriptors are assembled **scope-free**; a single `finalizeProviderScopedTools()` pass (from `src/tools/wrap-tool-execution.ts`) runs at the per-invocation boundary (orchestrator + proactive paths), after compaction/disclosure. The attached outer wrapper validates the per-call provider request scope from `ToolExecutionOptions.context` (strict `providerRequestScopeContextSchema`, failing closed with `provider_scope_missing` before the tool body runs) and converts thrown failures into structured tool-failure payloads.

A single-tool factory returns `Tool` (not `ToolSet[string]`): under AI SDK v7 the `ToolSet` value type is a union whose `.execute` is not directly callable, so factories declare the single-tool `Tool` type instead.

```typescript
export function makeExampleTool(provider: Readonly<TaskProvider>): Tool {
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
- Public entry point is `makeTools(provider, options)` in `src/tools/index.ts`. It is
  **async** and returns `Promise<ToolSet>` (both overloads) — callers must `await` it —
  because it may connect to external MCP servers.
- The merge order inside `makeTools()` is: builtin tools (registered scope-free via
  `registerProviderBackedTool` in `tools-builder.ts`) → MCP tools (user endpoints
  from `buildMcpToolSet`, plus plugin-declared servers from `buildPluginMcpToolSet`) →
  plugin tools. MCP tool building is wrapped in `try/catch` and never breaks the pipeline;
  see `src/mcp/CLAUDE.md`.
- After capability + context gating and the plugin/MCP merge, `makeTools()` applies the
  per-context tool permissions from `src/tools/tool-preferences.ts` as the final step. Each
  tool resolves to a three-state `Permission` (`allow` | `ask` | `deny`, default `allow`)
  via `resolveToolPermission`, most-specific-wins: `toolOverrides[name]` →
  `toolOverrides[RENAMED_TOOL_ALIASES[name]]` (legacy name for renamed reminder/alert tools) →
  `domainDefaults[meta.domain]` → `riskDefaults[meta.risk]` → implicit `allow`. `deny` removes
  the tool from the returned `ToolSet` (cannot be invoked); `allow` exposes it unchanged; `ask`
  exposes it wrapped so each call requires user permission (the input schema gains
  `_permission_reason` and execution is gated). Preferences are keyed by the same
  `storageContextId` used elsewhere. The `riskDefaults` tier is the sticky layer set by the
  settings-UI presets (`applyPreset`/`detectActivePreset`, keyed by `ToolRisk` from
  `tool-metadata.ts`); pruning of redundant overrides is computed against the same
  override→domain→risk→allow baseline so it stays symmetric with resolution.
  An `ask` denial returns the structured `{ status: 'permission_denied', message }` shape
  (`isPermissionDeniedResult` in `permission-gate.ts`), which the analytics terminal
  classifies as its own `permission_denied` outcome rather than a failure. The analytics
  layer maps `tool-metadata.ts` domains/risks onto its bounded fact enums in
  `src/analytics/tool-classification.ts` (`open-world` → `open_world`, richer domains
  collapse onto `task|memo|schedule|attachment|web|identity|coding|config|meta|diagnostics|other`).
- **Result compaction is not part of `makeTools()`.** It is a per-turn wrap applied
  unconditionally in `prepareLlmInvocation` (`src/llm-orchestrator-tools.ts`) after
  `applyToolPreferences`. `applyResultCompaction` (`src/tools/compaction/wrap-compaction.ts`)
  wraps each executable tool: successful results over `COMPACTION_THRESHOLD_BYTES` are stored in
  the per-context TTL/LRU result store and replaced by a `CompactedEnvelope` (SMALL_MODEL summary
  or truncation preview + handle). The companion `expand_result` tool (registered in
  `provider-independent-tools-builder.ts` whenever `mode` is `normal` — proactive runs skip
  compaction, so the pager is not offered there) pages the stored raw result and is itself never
  wrapped.
- **Progressive disclosure is also not part of `makeTools()`.** `maybeApplyDisclosure`
  (`src/tools/disclosure/wire.ts`) runs unconditionally in `buildFullToolSet` after
  `applyResultCompaction`. It copies the toolset, injects `search_tools` (ranked schema-less
  briefs via an embedding `ToolRetriever` from `getToolRetriever`, which falls back to lexical
  ranking internally when embeddings are unavailable or no LLM config resolves) and `load_tool`
  (batch activation), both bound to one turn-scoped `DisclosureSession` (`registry.ts`, never
  cached). `invokeModel` attaches `createDisclosurePrepareStep` (`prepare-step.ts`) so per-step
  `activeTools` = core ∪ meta ∪ loaded, intersected with registered names; after
  `DISCLOSURE_STALL_STEPS` (2) with no real loads, or when the trailing 2 completed steps contain only `search_tools`/`load_tool` calls, it latches open (`{}`, all tools) and emits
  `disclosure:fallback` once — loading always-on names does not count. Meta tools are added
  on top of the compacted set so they are never compaction-wrapped; ask/deny preferences were
  already applied, so a loaded tool keeps its `ask` wrapper. Debug events
  (`disclosure:search`/`disclosure:load`/`disclosure:fallback`) carry counts/lengths only —
  never query text or tool schemas.
- **The deferred/proactive path wires disclosure independently.** It has its own
  `buildFullToolSet` (`src/deferred-prompts/proactive-llm-full.ts`), which calls
  `maybeApplyDisclosure` directly, and its own direct `generateText` call
  (`runFullGeneration` in `src/deferred-prompts/proactive-llm.ts`) attaches a standalone
  `createDisclosurePrepareStep` — the normal chat path composes that prepareStep with
  steering via `invokeModel`, but the proactive path has no steering, so it attaches the
  prepareStep alone. The three deferred-prompt execution modes (`lightweight`/`context`/`full`)
  that used to select how much context a fire-time run loaded have been removed: every
  deferred prompt now runs the same unified full-generation path on the main model.

`MakeToolsOptions` controls tool exposure:

- `storageContextId`: user or conversation storage key
- `chatUserId`: real chat actor ID
- `mode`: `normal` or `proactive`
- `contextType`: `dm` or `group`
- `isBotAdmin`: whether the actor is a bot admin (absent/false = not an admin)
- `platformInstanceId`: the platform instance the turn originated from

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

- Tool code may throw; the finalize-pass wrapper converts thrown failures into structured outputs via `buildToolFailureResult()`.
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
- task suggestions: `suggest_next_task` ranks open tasks on demand (deterministic scoring in `src/tools/suggest-next-task-ranking.ts`); read-risk (`allow` default), available to guests, present in DM/group and normal/proactive modes whenever a task instance is configured; degrades to `project_required` guidance when the provider cannot list projects
- web fetch: `web_fetch` is user/context scoped, rate-limited, cached, and restricted to public HTTP(S) content
- identity: `set_my_identity` and `clear_my_identity` are group-only and provider-dependent
- history lookup: `lookup_group_history` searches the main group history when the current context is a thread-scoped group conversation
- chat-history search: `search_chat_history` FTS5 keyword-searches observed messages in `message_metadata` (group-wide in groups, DM-scoped in DMs); available in both DM and group contexts whenever `storageContextId` + `chatUserId` are set. It also supports `semantic`/`auto` mode (embedding-based via the BYOK `embedding` role, falling back to keyword when no embedding model resolves). `get_message` fetches a single message by id and `get_message_context` returns a temporal/thread/reply_chain window around a message; both share the same scope enforcement and return `not_found` for out-of-scope ids (no existence leak)
- plugin tools: when `storageContextId` and `chatUserId` are set, `makeTools()` merges tools from plugins that are active **and** eligible for the current context. Plugin _eligibility_ and plugin-declared MCP descriptors resolve against the **group config-context id**, but each plugin tool's `PluginToolRuntimeContext` receives the **raw thread-scoped `storageContextId`** — so plugins that route async work (e.g. `acp` milestone notifications) target the originating thread. `plugin_kv`/`contextConfig` re-derive the config-context id internally where they need group scope. Plugin tool names are namespaced (`plugin_<plugin_id>__<tool_name>`) and execute against a permission-gated task-provider facade — plugins never receive the raw provider. See the Plugin System section in `CLAUDE.md` and `docs/plugins/developer-guide.md`.
- diagnostics: `run_diagnostics` (`src/tools/diagnostics.ts`, `maybeAddDiagnosticsTools` called from both descriptor builders) is gated on `isBotAdmin === true && contextType === 'dm' && mode === 'normal'` — fail-closed, so proactive runs and the live `/context` tool resolution never assemble it. The degraded `/context` fallback (live build failed) replays the context's latest cached descriptors — including admin-scoped cache variants — so it may list the tool in a bot admin's own DM; that listing is display-only, the tool is never invocable from `/context`. It returns a whitelisted, secret-free runtime health snapshot (per-probe try/catch degrading to a `probe_error` marker); registered `read('diagnostics')` in `tool-metadata.ts` so prefs/presets treat it as a read tool.

## Logging

- `debug` for tool entry and key parameters
- `info` for successful operations with result identifiers
- `warn` for blocked confirmations or degraded non-fatal behavior
- `error` for caught failures with `tool` name and normalized message
