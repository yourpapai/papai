# YouTrack (coding agent)

> Plugin ID: `mcp-youtrack` · Version: 1.0.0 · `defaultEnabled: false`

Agent-facing YouTrack issue/comment/attachment read tools. This plugin does
**not** register chat-visible tools for end users — it declares
`mcpServer: true`, so its 8 tools are exposed as an MCP server surface at
`/mcp/plugin/mcp-youtrack` for an external coding agent (via papai's sandbox
MCP broker) to call directly. It is the eighth first-party plugin migrated
onto the "MCP server as a papai plugin" pattern, after `mcp-sentry`,
`mcp-confluence`, `mcp-figma`, `mcp-teamcity`, `mcp-rag`, `mcp-mattermost`,
and `mcp-gitlab` (see `docs/architecture/coding-stack-overview.md` §3.6).

## Scope: part 1 of 2

This migration covers **read + comment** only. Six write tools are deferred
to a follow-up (Plan 8b) and are **not** part of this plugin yet:

- `youtrack_create_issue`
- `youtrack_update_fields`
- `youtrack_add_issue_tag`
- `youtrack_remove_issue_tag`
- `youtrack_set_tags`
- `youtrack_set_issue_link`

## Tools

| Tool                            | Notes                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------- |
| `youtrack_get_issue`            | Get a YouTrack issue by id (summary, description, fields, tags, links)          |
| `youtrack_get_state_activities` | Get the State-field change history for a YouTrack issue                         |
| `youtrack_get_comments`         | List non-deleted comments on a YouTrack issue                                   |
| `youtrack_get_issue_tags`       | List tags on a YouTrack issue                                                   |
| `youtrack_get_field_options`    | List allowed custom-field values for an issue, optionally filtered to one field |
| `youtrack_get_attachments`      | List attachments on a YouTrack issue                                            |
| `youtrack_read_attachment`      | Read an attachment by id, inlining small text content when available            |
| `youtrack_add_comment`          | **WRITE:** add a comment to a YouTrack issue                                    |

See `plugins/mcp-youtrack/input-schema.ts` for the exact JSON-schema input
contract per tool.

## Permissions

`http`.

## Allowed hosts

Derived from the admin-scoped `base_url` config via
`providerAllowedHostsFromConfig: ["base_url"]` — no static allowlist entry.

## Configuration

| Key        | Scope   | Required | Sensitive | Description                                             |
| ---------- | ------- | -------- | --------- | ------------------------------------------------------- |
| `base_url` | admin   | Yes      | No        | YouTrack base URL (e.g. `https://youtrack.example.com`) |
| `token`    | context | Yes      | Yes       | YouTrack permanent token, per team/config-context       |

This is a **MIXED-scope** plugin: `base_url` is deployment-wide (admin scope,
one value for the whole instance), while `token` is context-scoped — each
config context (typically a team) supplies its own permanent token. Auth is
sent as an HTTP Bearer `Authorization` header (`client.ts`) against
`{base_url}/api` on every request — there is no Basic-auth mode.

## Response redaction

The manifest also declares `mcpResponseRedaction: true`. Because this plugin
is exposed over `/mcp/plugin/mcp-youtrack`, every tool response is run
through papai's bridge-level redactor (`src/mcp-server/redaction.ts`,
`callPluginMcpTool` in `src/mcp-server/plugin-bridge.ts`) before it reaches
the external coding agent, on top of YouTrack payloads potentially
containing issue content the operator wants scrubbed.

This is **fail-closed**: it requires the operator to configure `mcp_redaction`
(`src/coding-credentials/mcp-redaction.ts` — `model_url`/`api_key`/
`model_name`/`timeout_ms`) for the platform instance. Without it configured,
a `tools/call` returns a blocked-result marker instead of data, and the
plugin is excluded entirely from the internal-MCP-server picker
(`listEnabledInternalMcpServers` in
`src/coding-credentials/mcp-plugin-servers.ts`) until it is set.

## Write tool

`youtrack_add_comment` is the one **write** tool in this plugin — it posts a
new comment to a live YouTrack issue. Operators should set its per-tool
policy to `ask` or `deny` (rather than `allow`) at enable time if they want a
confirmation gate or want to keep this plugin read-only in practice.

## Reading attachments

`youtrack_read_attachment` inlines content only for small (`<= 512000` byte)
text (`text/*` MIME type) attachments; it returns the response text directly
in the tool result. Larger attachments return `{ tooLarge: true }` with
metadata only, and binary attachments return `{ isBinary: true }` with
metadata and a note — there is no filesystem handoff in this MCP transport,
so binary content is never written to disk or streamed out of band.

## Failure handling

Tool executions return structured errors rather than throwing: `not_configured`
(missing admin/context creds or no HTTP runtime), `rate_limited` (with
`retryAfterSec`), `validation_error`, `timeout` (on `AbortError`), and
`youtrack_error` (carries the upstream error message; includes non-2xx
status).

## Enabling

Approve the plugin in the settings UI admin Plugins area (super admin), set
the admin-scoped `base_url`, have each config context set its own `token`,
configure `mcp_redaction` for the platform instance, then select
`plugin:mcp-youtrack` as a coding MCP server for the context.
