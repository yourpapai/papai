<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# MCP Adapter Design

**Date:** 2026-05-27
**Status:** Draft
**Scope:** Connect HTTP/SSE MCP endpoints to extend bot tool capabilities

## Problem

The bot's tool surface is limited to built-in tools and first-party plugins. Users and admins want to connect external MCP (Model Context Protocol) servers — GitHub, Notion, Linear, custom internal tools — to extend the bot's capabilities without writing plugin code.

## Goals

1. Users/groups can configure MCP server endpoints via `/config` (Streamable HTTP only).
2. Admins can package MCP servers as declarative plugin manifests (no runtime code) supporting both Streamable HTTP and stdio transports.
3. MCP tools merge into the existing ToolSet, namespaced and subject to tool preferences.
4. Connections are managed with idle timeout and graceful degradation.
5. Authentication via custom HTTP headers, encrypted at rest.

## Non-Goals

- OAuth 2.1 authentication (documented as future expansion, separate spec).
- MCP server functionality (the bot does not expose its tools via MCP).
- Hot-reload of MCP server configurations (changes take effect on next tool assembly).

## Architecture

Two entry points feed into a shared MCP client module:

```
makeTools(provider, options)
  → buildTools(...)              // existing built-in tools
  → buildMcpToolSet(contextId)   // user-configured MCP endpoints
  → buildPluginToolSet(...)      // existing plugin tools
  → buildPluginMcpToolSet(...)   // declarative MCP plugins
  → merge, apply preferences, return
```

### Entry Point 1: User-Configured Endpoints

Stored in per-context config via `/config`. Streamable HTTP only. Custom headers for auth.

**Config key:** `mcp_endpoints` (JSON array in `user_config` table).

**Entry type:**

```typescript
type McpEndpointConfig = {
  id: string // lowercase kebab-case, unique within context
  url: string // Streamable HTTP URL (https://...)
  label: string // human-readable display name
  headers?: Record<string, string> // custom headers (e.g., Authorization)
  enabled: boolean // toggle without removing
  toolFilter?: string[] // optional: only expose these tool names
}
```

Headers with sensitive key patterns (`*token*`, `*key*`, `*auth*`, `*secret*`, `*password*`) are encrypted at rest via `INSTANCE_CONFIG_KEY` (AES-256-GCM).

**Resolution:** `buildMcpToolSet(contextId)` reads config, filters to enabled entries, calls `mcpPool.getOrCreate(config)`, discovers tools, converts to ToolSet.

### Entry Point 2: Declarative Plugin Endpoints

Plugin manifest (`plugin.json`) declares an `mcp` field. No `index.ts` or `activate()` required — the core reads the config directly. Plugins go through the normal discovery → approval → per-context-enable lifecycle.

**Manifest schema extension:**

```typescript
mcp: z.object({
  transport: z.enum(['streamable-http', 'stdio']),
  url: z.string().url().optional(), // required for streamable-http
  headers: z.record(z.string()).optional(), // HTTP headers
  command: z.string().optional(), // required for stdio
  args: z.array(z.string()).optional(), // stdio arguments
  env: z.record(z.string()).optional(), // stdio environment variables
  toolFilter: z.array(z.string()).optional(),
  idleTimeoutMs: z.number().int().min(1000).optional(),
}).optional()
```

Validation: `url` required when transport is `streamable-http`; `command` required when transport is `stdio`. When `mcp` is declared, `main` becomes optional.

**Declarative-only vs hybrid plugins:** A plugin can be purely declarative (only `mcp`, no `main`) or hybrid (both `mcp` and `main` with `activate()`). In hybrid mode, MCP tools are resolved by the core and `activate()` contributes additional non-MCP tools. Both sets merge into the tool set.

**`toolFilter` vs `contributes.tools`:** For declarative MCP plugins, `toolFilter` controls which MCP-discovered tools are exposed. `contributes.tools` is not required for MCP-only plugins — the tool names are determined at runtime by the MCP server. `toolFilter` is the MCP-specific mechanism; `contributes.tools` applies only to tools registered via `activate()`.

**Permissions:** The `mcp` field itself does not require a specific permission. The plugin's `permissions` depend on what the MCP tools do (e.g., `tasks.read` if the tools access task data). The core does not grant MCP tools any special access — they execute against the MCP server, not the bot's internal APIs.

**Placeholder resolution:** `${VAR}` placeholders in `headers` and `env` are resolved from the context's `user_config` values. Missing required config keys cause the endpoint to be skipped with a warning (matching existing `configRequirements` pattern).

**Resolution:** `buildPluginMcpToolSet(contextId)` iterates active plugins with `mcp` declared, checks eligibility, feeds config to pool, converts tools. Namespaced as `plugin_<plugin-id>__<tool_name>`.

**Example declarative plugin:**

```json
{
  "id": "github-mcp",
  "name": "GitHub MCP Server",
  "description": "Exposes GitHub tools via the official MCP server",
  "apiVersion": 1,
  "mcp": {
    "transport": "streamable-http",
    "url": "https://api.github.com/mcp",
    "headers": { "Authorization": "Bearer ${GITHUB_TOKEN}" },
    "toolFilter": ["search_repositories", "create_issue", "list_issues"]
  },
  "configRequirements": [
    { "key": "github_token", "label": "GitHub Token", "required": true, "sensitive": true, "scope": "user" }
  ]
}
```

## MCP Client Module (`src/mcp/`)

### Files

| File                          | Purpose                                                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `src/mcp/client-pool.ts`      | Connection pool: manages `McpClient` instances keyed by config hash. Handles connect, idle timeout, reconnect, graceful shutdown. |
| `src/mcp/tool-adapter.ts`     | Converts MCP `listTools()` results to Vercel AI SDK `ToolSet` entries. Maps `callTool()` to `tool.execute()`.                     |
| `src/mcp/types.ts`            | `McpEndpointConfig`, `McpTransportType`, `McpServerStatus`, Zod schemas.                                                          |
| `src/mcp/user-endpoints.ts`   | Reads user-configured endpoints from context config, feeds pool, returns ToolSet.                                                 |
| `src/mcp/plugin-endpoints.ts` | Reads declarative MCP plugin manifests, resolves eligibility, feeds pool, returns ToolSet.                                        |

### Connection Pool

- **Keying:** Deterministic hash of `(transport, url, headers)` — same config = same connection, shared across contexts.
- **Idle timeout:** Default 10 minutes, configurable per endpoint. After no tool calls for the duration, connection is gracefully terminated (`transport.terminateSession()` + `client.close()`).
- **Reconnect:** On connection error during `callTool()`, attempt one reconnect and retry. If retry fails, return structured failure, remove connection from pool.
- **Lazy connect:** Connections are NOT established at startup. First tool call triggers connection. This avoids startup delays and tolerates MCP server downtime.
- **Shutdown:** `mcpPool.shutdown()` called during bot teardown, closes all connections gracefully.

### Tool Conversion

- MCP `inputSchema` (JSON Schema) → passed to AI SDK's `jsonSchema()` helper directly (no Zod conversion).
- MCP `description` → tool `description`.
- MCP `annotations` (readOnlyHint, destructiveHint) → preserved as metadata.
- `callTool()` with `isError: true` → wrapped as structured failure via `wrapToolExecution()`.
- Text content from `callTool()` result → extracted and returned as tool result.

## Tool Integration & Naming

**Naming convention:**

- User-configured: `mcp_<server-id>__<tool_name>`
- Plugin-declared: `plugin_<plugin-id>__<tool_name>`

**Tool preferences:** MCP tools are subject to the per-context tool denylist (`tool_prefs`). They appear grouped under an "MCP" domain in the "🧰 Tools" section of `/config`.

**System prompt:** No MCP-specific prompt fragments. Disabled MCP tools get the same treatment as other disabled tools in the "Unavailable tools" line.

## Admin Visibility

**`/admin#instances` (read-only):**

- Lists all MCP endpoints across contexts.
- Shows: server ID, URL (masked), transport type, connection status (connected/idle/disconnected/error), tool count, last successful tool call.
- Sensitive header values masked with `***`.
- Admin cannot add/edit/remove from this view.

**`/config` (user/group):**

- New "🔌 MCP Servers" section in the config editor.
- Add/edit/remove endpoints with fields: ID, URL, label, headers, enabled toggle, optional tool filter.
- Test button: connects and lists discovered tools.

**`/plugin` (existing):**

- `/plugin info <id>` shows MCP-specific details for declarative plugins.
- `/plugin enable/disable` toggles MCP tools per context.

## Error Handling

| Scenario                                 | Behavior                                                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| MCP server unreachable at connect time   | Log warning, skip endpoint for this request, retry next time                 |
| MCP server drops mid-session             | Next tool call triggers reconnect; if retry fails, return structured failure |
| MCP `callTool()` returns `isError: true` | Wrapped as structured failure via `wrapToolExecution()`                      |
| MCP tool timeout                         | Configurable per-server, default 30s. Returns timeout failure                |
| Partial availability (2/3 servers down)  | 3rd server still works, no all-or-nothing dependency                         |
| Missing config for `${VAR}` placeholder  | Skip endpoint with warn log, other endpoints unaffected                      |

## Testing

**Unit tests:**

- `client-pool.ts` — mock MCP SDK Client/transports. Test: connect, idle timeout, reconnect, shutdown, dedup by config hash.
- `tool-adapter.ts` — test conversion of MCP tool definitions to ToolSet. Test: naming, schema passthrough, annotations, error mapping.
- `user-endpoints.ts` — mock config store and pool. Test: reads endpoints, filters enabled, handles missing config.
- `plugin-endpoints.ts` — mock plugin registry and pool. Test: reads manifests, resolves placeholders, filters by eligibility.

**Integration tests:**

- In-process mock MCP server exposing test tools. Full flow: config → makeTools() → tool call → result.
- Idle timeout with mock server connection.
- Tool preferences filtering MCP tools.

**Plugin manifest validation tests:**

- `mcp` field validation (url for streamable-http, command for stdio).
- Plugins with `mcp` don't require `main`.
- `${VAR}` placeholder resolution and graceful failure on missing config.

## Dependencies

- `@modelcontextprotocol/sdk` — MCP TypeScript SDK (client, transports). Runs on Bun.
- No new runtime dependencies beyond the SDK.

## Future Expansion: OAuth 2.1

Out of scope for this spec. The MCP spec defines OAuth 2.1 for server authentication. A separate spec will cover:

- OAuth 2.1 flow integration
- Token storage and refresh
- Per-user vs shared OAuth tokens
- Admin-managed OAuth app registrations
