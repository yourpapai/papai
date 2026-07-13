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

### Token pooling

`token` accepts either a single Figma personal access token or a
comma-separated **pool**: `tok1,tok2,tok3`. `FigmaClient` (`client.ts`)
splits and trims the value into a token list at construction. On an HTTP
429 response it rotates to the next token in the pool and retries the same
request once per remaining token — no blocking sleep/backoff. If every
token in the pool comes back 429, the call surfaces a rate-limited error
(`all N token(s) exhausted`) instead of retrying further.

## Simplification

`figma_get_file` and `figma_get_file_nodes` run the raw Figma API response
through `format.ts`'s `simplifyFigmaResponse`, which keeps per-node id,
name, type (with `VECTOR` renamed to `IMAGE-SVG`), width/height, text
content/style, a compact CSS `layout` string, and children — dropping
invisible nodes and all other Figma styling/paint/effect noise. This now
mirrors the full node-tree shape used by the reference `kiss`-derived
simplifier (`simplify.ts` + `simplify-layout.ts` + `simplify-text.ts`),
including CSS-layout extraction and cross-node text-style dedup — see
"Output shape (full simplify)" below.

### Output shape (full simplify)

`figma_get_file` / `figma_get_file_nodes` return
`{ name, nodes, globalVars }`. Each node in `nodes` (recursively, via
`children`) carries:

- a compact CSS `layout` string derived from Figma auto-layout fields
  (`layoutMode`, alignment, padding, gap, wrap, relative position for
  non-auto-layout children), e.g.
  `display:flex;flex-direction:row;justify-content:center;gap:8px;padding:16px`
  — omitted when the node has no layout-relevant properties;
- `width`/`height` (rounded to 2 decimals) from `absoluteBoundingBox`, plus
  `layoutSizingHorizontal`/`layoutSizingVertical` when Figma reports them
  (`FIXED` sizing along an auto-layout axis also fixes the corresponding
  `width`/`height` to the node's absolute box);
- for `TEXT` nodes, `text` (the raw `characters`) plus a `textStyle`
  **reference id** (e.g. `"s1"`) instead of an inline style object.

`globalVars.styles` is a top-level `Record<string, TextStyle>` populated as
the tree is walked: each distinct text style (`fontFamily`, `fontWeight`,
`fontSize`, and non-default `fontStyle`/`lineHeightPx`/`letterSpacing`/
`textCase`/`textAlign`/`textDecoration`/`maxLines`/`textTruncation`/
`paragraphSpacing`) is de-duplicated by deep-equality across the **whole**
response — repeated text styles across many text nodes resolve to the same
`sN` id and are serialized once, keeping large designs compact.

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

None of note against the reference `kiss`-derived Figma MCP implementation:
output shape (CSS `layout` string + `globalVars.styles` text-style dedup)
and token pooling/429 rotation (see above) both match it. `{ error:
'rate_limited', retryAfterSec }` from papai's own per-actor rate limiter is
still layered on top and is checked before any Figma API call is made.

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
