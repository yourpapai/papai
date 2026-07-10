# Confluence (coding agent)

> Plugin ID: `mcp-confluence` · Version: 1.0.0 · `defaultEnabled: false`

Agent-facing Confluence wiki read/comment tools. This plugin does **not**
register chat-visible tools for end users — it declares `mcpServer: true`, so
its 5 tools are exposed as an MCP server surface at
`/mcp/plugin/mcp-confluence` for an external coding agent (via papai's
sandbox MCP broker) to call directly. It is the second first-party plugin
migrated onto the "MCP server as a papai plugin" pattern, after `mcp-sentry`
(see `docs/architecture/coding-stack-overview.md` §3.6).

## Tools

| Tool                            | Notes                                                                  |
| ------------------------------- | ---------------------------------------------------------------------- |
| `confluence_get_page`           | Get a page by id, with body content in storage (XHTML) format          |
| `confluence_get_page_by_title`  | Get a page by exact space key + title                                  |
| `confluence_get_comments`       | List comments on a page                                                |
| `confluence_add_comment`        | Add a comment to a page                                                |
| `confluence_resolve_short_link` | Resolve a Confluence tiny link (`/x/<key>`) and return the target page |

See `plugins/mcp-confluence/input-schema.ts` for the exact JSON-schema input
contract per tool.

## Permissions

`http`.

## Allowed hosts

Derived from the admin-scoped `base_url` config via
`providerAllowedHostsFromConfig: ["base_url"]` — no static allowlist entry.

## Configuration

| Key        | Scope | Required | Sensitive | Description                                            |
| ---------- | ----- | -------- | --------- | ------------------------------------------------------ |
| `base_url` | admin | Yes      | No        | Confluence base URL (e.g. `https://wiki.skbkontur.ru`) |
| `username` | admin | Yes      | No        | Confluence username                                    |
| `password` | admin | Yes      | Yes       | Confluence password/token                              |

All three are deployment-wide (admin scope only); there is no per-context
override. `username`/`password` are sent as an HTTP Basic `Authorization`
header (`client.ts`) on every request — there is no OAuth/token-bearer mode.

## Response redaction

The manifest also declares `mcpResponseRedaction: true`. Because this plugin
is exposed over `/mcp/plugin/mcp-confluence`, every tool response is run
through papai's bridge-level redactor (`src/mcp-server/redaction.ts`,
`callPluginMcpTool` in `src/mcp-server/plugin-bridge.ts`) before it reaches
the external coding agent, on top of Confluence payloads potentially
containing wiki content the operator wants scrubbed.

This is **fail-closed**: it requires the operator to configure `mcp_redaction`
(`src/coding-credentials/mcp-redaction.ts` — `model_url`/`api_key`/
`model_name`/`timeout_ms`) for the platform instance. Without it configured,
a `tools/call` returns a blocked-result marker instead of data, and the
plugin is excluded entirely from the internal-MCP-server picker
(`listEnabledInternalMcpServers` in
`src/coding-credentials/mcp-plugin-servers.ts`) until it is set.

## Write tool

`confluence_add_comment` is the one **write** tool in this plugin — it posts
a new comment to a live Confluence page. Operators should set its per-tool
policy to `ask` or `deny` (rather than `allow`) at enable time if they want a
confirmation gate or want to keep this plugin read-only in practice.

## Failure handling

Tool executions return structured errors rather than throwing: `not_configured`
(missing admin creds or no HTTP runtime), `rate_limited` (with
`retryAfterSec`), `validation_error`, `timeout` (on `AbortError`), and
`confluence_error` (carries the upstream error message; includes non-2xx
status).

## Enabling

Approve the plugin in the settings UI admin Plugins area (super admin), set
the three admin-scoped Confluence config values, configure `mcp_redaction`
for the platform instance, then select `plugin:mcp-confluence` as a coding
MCP server for the context.
