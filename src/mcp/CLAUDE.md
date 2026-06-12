# MCP Adapter Conventions

`src/mcp/` connects papai to external [Model Context Protocol](https://modelcontextprotocol.io) servers and exposes their tools to the LLM as ordinary Vercel AI SDK tools. There are two sources of MCP servers:

- **User endpoints** — per-context servers configured through the `mcp_endpoints` config key (see `src/config-keys.ts`).
- **Plugin endpoints** — servers declared by a plugin manifest's `mcp` field (`src/plugins/types.ts`).

## Files

- `types.ts` — Zod schemas + types: `mcpEndpointConfigSchema`/`McpEndpointConfig` (user), `mcpPluginConfigSchema`/`McpPluginConfig` (plugin), `McpToolFilter`, `McpServerStatus`, `McpServerInfo`, and `sanitizeServerId()`.
- `user-endpoints.ts` — `parseMcpEndpoints()` reads the `mcp_endpoints` config value; `buildMcpToolSet(contextId, deps?)` connects each enabled endpoint, lists tools, and merges them.
- `plugin-endpoints.ts` — `buildPluginMcpToolSet()` plus `${VAR}` placeholder resolution that pulls values from plugin config requirements; re-namespaces tool keys (see Naming).
- `client-pool.ts` — `McpConnectionPool` class and the `mcpPool` singleton: connection caching, retry, idle eviction, and status tracking.
- `tool-adapter.ts` — `convertMcpToolsToToolSet()`: wraps remote MCP tools as `tool()`s, applies the allow/deny filter, and extracts text content.
- `index.ts` — barrel re-export.

## Wiring

`makeTools()` in `src/tools/index.ts` is **async** and merges MCP tools after the wrapped builtins:

- User MCP tools (`buildMcpToolSet`) are added whenever `storageContextId` is set.
- Plugin MCP tools (`buildPluginMcpToolSet`, via `buildPluginAndMcpTools`) are added when both `storageContextId` and `chatUserId` are set, for active plugins whose manifest declares `mcp`.
- Final merge order is `{ ...builtins, ...mcpTools, ...pluginTools }`, then the per-context three-state tool permissions (`allow`/`ask`/`deny`) from `tool-preferences.ts` are applied last.

## Rules

- **Failures must never break the tool pipeline.** Both `buildMcpToolSet` and `buildPluginMcpToolSet` catch per-server errors, log a `warn`, and skip that server (returning `null`); the callsites in `makeTools()` also wrap the whole step in a `try/catch`. A dead or slow MCP server degrades to "no extra tools", never an orchestrator error.
- **HTTPS only for user endpoints.** `mcpEndpointConfigSchema` rejects any `url` that does not start with `https://`. Do not relax this.
- **Only `streamable-http` is runtime-supported.** `mcpPluginConfigSchema` accepts `transport: 'stdio'`, but `McpConnectionPool` throws `Unsupported MCP transport` for anything other than `streamable-http`. `stdio` is a schema-reserved future extension, not a working path.
- **Tool naming is namespaced and must stay distinct from builtins/plugins.** `convertMcpToolsToToolSet` emits `mcp_<sanitizedServerId>__<toolName>` for user endpoints. `buildPluginMcpToolSet` rewrites that prefix to `plugin_<...>` so plugin-sourced MCP tools share the `plugin_` namespace with native plugin tools. Use `sanitizeServerId()` for any new server-id-derived key.
- **Tool output is text-only today.** `tool-adapter.ts` extracts `type: 'text'` content parts and joins them; errors surface as `{ error: string }`. Non-text content (images, resources) is dropped.
- **Connections are pooled and idle-evicted.** Entries are keyed by a SHA-256 hash of transport/url/headers (plus command/args/pluginId for plugins). Connecting is eager with a single retry; on idle timeout (`DEFAULT_IDLE_TIMEOUT_MS` = 10 min, overridable per plugin via `idleTimeoutMs`) the client closes and the entry goes `idle`, then reconnects on next use. Use `mcpPool`, do not construct ad-hoc clients.
- **No secrets in logs.** Header values may carry tokens; never log resolved headers or `${VAR}` substitutions. The `/mcp/status` debug route (`src/debug/mcp-routes.ts`) masks each `url` to protocol+host+path and never returns headers.

## Plugin placeholder resolution

`plugin-endpoints.ts` resolves `${VAR}` placeholders inside a plugin's `mcp.headers` and `mcp.env` against the plugin's context config values (uppercased config keys). If any required placeholder is unresolved, the server is skipped for that context (logged at `debug`). This keeps plugin MCP credentials in per-context config rather than the manifest.

## Tests

Coverage lives in `tests/mcp/` (`client-pool`, `index`, `plugin-endpoints`, `tool-adapter`, `types`, `user-endpoints`), `tests/debug/mcp-routes.test.ts`, `tests/plugins/manifest-mcp.test.ts`, and `tests/tools/mcp-integration.test.ts`.
