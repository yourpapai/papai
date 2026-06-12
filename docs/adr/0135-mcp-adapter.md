<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0135: MCP (Model Context Protocol) Adapter

## Status

Implemented

## Date

2026-05-27 – 2026-06-02

## Context

papai's tool surface was limited to built-in tools and first-party plugins.
Users and admins wanted to connect external MCP servers — GitHub, Notion, Linear,
custom internal tools — to extend the bot's capabilities without writing plugin
code. The MCP protocol provides a standardized way for LLM clients to discover
and invoke tools exposed by external servers.

The existing plugin system (ADR-0123) covers code-contributed tools that run
in-process, but it cannot represent tools that live on an external HTTP server.
Two distinct entry points exist for MCP tool exposure: user-configured endpoints
(managed per-context via `/config`) and admin-packaged declarative plugin
manifests (no runtime code, no `activate()`).

Design spec: `docs/archive/2026-05-27-mcp-adapter-design.md`.
Implementation plan: `docs/archive/2026-05-27-mcp-adapter.md`.

## Decision Drivers

- **Graceful degradation**: A dead MCP server must never break the tool
  assembly pipeline. Partial availability (2/3 servers up) must work.
- **Security**: User-configured headers may contain secrets. URLs must be
  HTTPS. Sensitive header values must be encrypted at rest.
- **Minimal runtime surface**: Only `streamable-http` transport is supported
  at runtime for user-configured endpoints. Plugin manifests may declare
  `stdio` but stdio is not runtime-supported yet.
- **Integration with existing systems**: MCP tools must be subject to the same
  per-context tool preferences (`tool_prefs`) as built-in and plugin tools.
- **Two distinct sources**: User-configured endpoints and plugin-declared MCP
  blocks have different trust levels, config resolution, and namespacing.

## Considered Options

### Option A: MCP tools as first-class built-in tools

Parse MCP tool definitions at startup and register them identically to
built-in tools with no namespacing.

- **Pros**: Simpler naming; no namespace collision handling.
- **Cons**: Tool names from different MCP servers could collide; no way to
  distinguish MCP tools from built-in tools in preferences or logging;
  breaks the existing tool metadata model.

### Option B: Namespaced MCP tools with shared pool (chosen)

MCP tools are namespaced (`mcp_<id>__<tool>` for user endpoints,
`plugin_<id>__<tool>` for plugin-declared). A shared connection pool manages
client instances keyed by config hash.

- **Pros**: Clean namespace separation; shared connections across contexts;
  tool preferences work naturally; pool-level idle timeout and reconnect.
- **Cons**: Namespaced names are longer; two naming conventions require
  documentation.

### Option C: Per-request MCP connections (no pooling)

Each `makeTools()` call creates and destroys MCP connections.

- **Pros**: No pool complexity; no idle timeout logic.
- **Cons**: Latency on every tool assembly; servers may rate-limit repeated
  connects; no reuse across contexts sharing the same endpoint.

### Option D: Eager startup connection

All configured MCP endpoints are connected at bot startup.

- **Pros**: Tools available immediately on first request; connection errors
  surface early.
- **Cons**: Slows startup; tolerates MCP server downtime poorly; idle
  connections consume resources when no tool calls happen.

## Decision

**Option B** for namespaced tools with shared pool, with the following
subsidiary decisions:

| Topic                | Decision                                                                                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transport (runtime)  | Only `streamable-http` is runtime-supported. Plugin manifests may declare `stdio` in schema but stdio has no runtime adapter yet.                                                   |
| Connection pool      | `McpConnectionPool` keyed by deterministic hash of `(transport, url, headers)`. Same config = same connection, shared across contexts.                                              |
| Lazy connect         | Connections are NOT established at startup. First `makeTools()` call triggers connection. Avoids startup delays and tolerates server downtime.                                      |
| Idle timeout         | Default 10 minutes. After no tool calls for the duration, connection gracefully terminates. Reconnects on next use.                                                                 |
| User endpoint config | Stored as JSON array under `mcp_endpoints` config key in `user_config`. HTTPS-only URLs. Custom headers for authentication.                                                         |
| Plugin manifest      | `mcp` field in `plugin.json`. No `main`/`activate()` required when `mcp` is declared (declarative-only plugins). `${VAR}` placeholders in headers/env resolved from context config. |
| Tool naming          | User-configured: `mcp_<sanitized-id>__<tool_name>`. Plugin-declared: `plugin_<plugin-id>__<tool_name>`.                                                                             |
| Tool preferences     | MCP tools subject to per-context `tool_prefs` (`allow`/`deny`/`ask`). Classified under `'mcp'` domain in tool metadata.                                                             |
| Schema conversion    | MCP `inputSchema` (JSON Schema) passed directly to AI SDK `jsonSchema()`. No Zod conversion.                                                                                        |
| Error handling       | Failed connections: skip endpoint, warn log, retry next `makeTools()`. `callTool()` with `isError: true`: structured failure result.                                                |
| Admin visibility     | `/mcp/status` read-only route showing server IDs, transport, status, tool count, last activity. URL masking. No admin CRUD for endpoints.                                           |
| OAuth 2.1            | Out of scope. Future spec will cover OAuth flow integration, token storage, and refresh.                                                                                            |

## Consequences

### Positive

- External MCP servers extend the tool surface without any plugin code.
- Shared connection pool avoids redundant connections for endpoints used
  across multiple contexts.
- Graceful degradation: partial server availability does not block tool
  assembly; each endpoint is independently connected and independently skipped
  on failure.
- Declarative MCP plugins allow admins to package external servers with no
  runtime code, going through the existing approval/enable lifecycle.
- Tool preferences and `ask` gating apply uniformly to MCP tools.

### Negative

- Only `streamable-http` transport is runtime-supported; `stdio` is schema-only.
  Users wanting local MCP servers must proxy them through an HTTP wrapper.
- Lazy connect means the first `makeTools()` call for a new endpoint incurs
  connection latency.
- MCP tool schemas are opaque JSON Schema — no Zod validation on inputs; schema
  quality depends on the MCP server.
- No hot-reload: config changes take effect on next tool assembly, not
  immediately.

### Risks

- A malicious or misbehaving MCP server could return unexpected tool schemas
  or exfiltrate data through tool arguments. Mitigation: HTTPS-only for
  user-configured endpoints; admin-approved manifests for plugin endpoints;
  tool preferences can deny specific tools.
- Connection pool state could grow unbounded if many unique endpoints are
  configured across contexts. Mitigation: idle timeout closes inactive
  connections; pool entries are keyed by config hash, not by context.
- The `@modelcontextprotocol/sdk` dependency introduces a transitive supply
  chain. Mitigation: single well-maintained SDK; Bun's lockfile pins versions.

## Implementation Notes

Key modules (`src/mcp/`):

| File                  | Role                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| `types.ts`            | `McpEndpointConfig`, `McpPluginConfig`, `McpServerStatus`, Zod schemas, `sanitizeServerId`     |
| `client-pool.ts`      | `McpConnectionPool`: connect, idle timeout, reconnect, shutdown, status reporting              |
| `tool-adapter.ts`     | `convertMcpToolsToToolSet()`: MCP tool defs → AI SDK ToolSet with namespaced names             |
| `user-endpoints.ts`   | `buildMcpToolSet(contextId)`: reads `mcp_endpoints` config, feeds pool, returns ToolSet        |
| `plugin-endpoints.ts` | `buildPluginMcpToolSet(pluginIds, descriptors)`: reads plugin manifests, resolves placeholders |
| `index.ts`            | Public re-exports                                                                              |

Integration points: `src/tools/index.ts` (tool assembly), `src/plugins/types.ts`
(`mcp` manifest field), `src/plugins/discovery.ts` (skip entry-point validation
for MCP-only plugins), `src/tools/tool-metadata.ts` (`'mcp'` domain),
`src/config-keys.ts` (`'mcp_endpoints'` key), `src/debug/mcp-routes.ts`
(`/mcp/status` admin route).

Dependency: `@modelcontextprotocol/sdk` (MCP TypeScript SDK, client +
streamable-http transport).

## Related Decisions

- ADR-0123: Trusted-Local Plugin System — plugin manifest schema and
  approval/enable lifecycle that MCP declarative plugins reuse.
- ADR-0009: Multi-Provider Task Tracker Support — capability-gated tool
  assembly pattern that MCP tools follow.
- ADR-0014: Multi-Chat Provider Abstraction — context-dependent tool
  exposure pattern that MCP endpoints mirror.
