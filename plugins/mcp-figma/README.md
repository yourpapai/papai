# Figma (coding agent)

> Plugin ID: `mcp-figma` · Version: 1.0.0 · `defaultEnabled: false`

Agent-facing Figma file/node/style/component/comment tools. This plugin does
**not** register chat-visible tools for end users — it declares
`mcpServer: true`, so its 7 tools are exposed as an MCP server surface at
`/mcp/plugin/mcp-figma` for an external coding agent (via papai's sandbox
MCP broker) to call directly. It is the third first-party plugin migrated
onto the "MCP server as a papai plugin" pattern, after `mcp-sentry` and
`mcp-confluence` (see `docs/architecture/coding-stack-overview.md` §3.6).

## Tools

| Tool                    | Notes                                                                    |
| ----------------------- | ------------------------------------------------------------------------ |
| `figma_get_file`        | Get a simplified Figma file document tree                                |
| `figma_get_file_nodes`  | Get simplified Figma nodes by id from a file                             |
| `figma_get_images`      | Render Figma nodes to image URLs (png/svg/pdf)                           |
| `figma_get_file_styles` | List the styles (color/text/effect/grid) defined in a file, pass-through |
| `figma_get_style`       | Get a single style by key, pass-through                                  |
| `figma_get_components`  | List the components defined in a file, pass-through                      |
| `figma_get_comments`    | List comments on a file, pass-through                                    |

`figma_get_file` and `figma_get_file_nodes` return a **simplified** node
tree (see "Simplification" below); the other five tools pass through the
Figma API's data more or less as-is (styles/components/comments arrays
unwrapped from their response envelope, images returned as the raw
url-by-node-id map). See `plugins/mcp-figma/input-schema.ts` for the exact
JSON-schema input contract per tool.

## Permissions

`http`.

## Allowed hosts

Static allowlist: `api.figma.com`.

## Configuration

| Key     | Scope   | Required | Sensitive | Description                 |
| ------- | ------- | -------- | --------- | --------------------------- |
| `token` | context | Yes      | Yes       | Figma personal access token |

`token` is **context-scoped**, not admin-scoped: it is a per-team Figma
personal access token, set per config-context (Tools/plugin config in the
settings UI) rather than once for the whole deployment. `mcp-figma` is the
first internal MCP plugin with a context-scoped credential — `mcp-sentry`
and `mcp-confluence` both use admin-scoped config only. The tool executor
reads it via `runtimeContext.contextConfig.get('token')` (`index.ts`) and
sends it as the `X-Figma-Token` header (`client.ts`) on every request to
`https://api.figma.com`.

## Simplification

`figma_get_file` and `figma_get_file_nodes` run the raw Figma API response
through `format.ts`'s `simplifyFigmaResponse`, which keeps per-node id,
name, type (with `VECTOR` renamed to `IMAGE-SVG`), width/height, text
content and a basic text style (`fontFamily`/`fontSize`/`fontWeight`),
`layoutMode` (`HORIZONTAL`/`VERTICAL`), and children — dropping invisible
nodes and all other Figma styling/paint/effect noise. This mirrors the
node-tree shape used by the reference `kiss`-derived simplifier, but is a
narrower slice of it: full CSS-layout extraction (padding, gaps, positioning,
constraints) and cross-node style dedup/registry are **not** implemented
here and are a deferred follow-up.

## No redaction

The manifest does **not** set `mcpResponseRedaction`, so `mcp-figma` tool
responses are returned to the calling coding agent as-is — they are not run
through papai's bridge-level redactor
(`src/mcp-server/redaction.ts`/`callPluginMcpTool` in
`src/mcp-server/plugin-bridge.ts`). This is by design: Figma file/node/style/
component/comment data is design metadata (layout, dimensions, text
content, comments), not the kind of customer/secret data `mcp-sentry`/
`mcp-confluence` redact. Operators who route sensitive product copy through
Figma comments should account for this when granting access to the plugin.

## Deviations

Single Figma token per context — no comma-separated token pool or 429-driven
rotation across multiple tokens (unlike some reference Figma MCP
implementations). If the configured token gets rate-limited by Figma, tool
calls surface `{ error: 'rate_limited', retryAfterSec }` from papai's own
per-actor rate limiter, or a `figma_error` carrying the upstream 4xx/5xx —
there is no automatic failover to a second token.

## Failure handling

Tool executions return structured errors rather than throwing:
`not_configured` (missing context token or no HTTP runtime), `rate_limited`
(with `retryAfterSec`), `validation_error`, `timeout` (on `AbortError`), and
`figma_error` (carries the upstream error message; includes non-2xx status).

## Enabling

Approve the plugin in the settings UI admin Plugins area (super admin), set
the context-scoped `token` config value for each team/config-context that
needs it, then select `plugin:mcp-figma` as a coding MCP server for the
context.
