# YouTrack (coding agent)

> Plugin ID: `mcp-youtrack` · Version: 1.0.0 · `defaultEnabled: false`

Agent-facing YouTrack issue/comment/attachment/tag/link tools — read and
write. This plugin does **not** register chat-visible tools for end users —
it declares `mcpServer: true`, so its 14 tools are exposed as an MCP server
surface at `/mcp/plugin/mcp-youtrack` for an external coding agent (via
papai's sandbox MCP broker) to call directly. It is the eighth first-party
plugin migrated onto the "MCP server as a papai plugin" pattern, after
`mcp-sentry`, `mcp-confluence`, `mcp-figma`, `mcp-teamcity`, `mcp-rag`,
`mcp-mattermost`, and `mcp-gitlab` (see
`docs/architecture/coding-stack-overview.md` §3.6). The plugin is now
**complete**: 14/14 tools (7 reads, 1 comment write, 6 further write tools).

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
| `youtrack_create_issue`         | **WRITE:** create a new YouTrack issue (project, summary, description, fields)  |
| `youtrack_update_fields`        | **WRITE:** update one or more custom fields on a YouTrack issue                 |
| `youtrack_add_issue_tag`        | **WRITE:** add a tag to a YouTrack issue                                        |
| `youtrack_remove_issue_tag`     | **WRITE:** remove a tag from a YouTrack issue                                   |
| `youtrack_set_tags`             | **WRITE:** set the exact tag set on a YouTrack issue, adding/removing as needed |
| `youtrack_set_issue_link`       | **WRITE:** link two YouTrack issues with a given link type and direction        |

All six writes marked above mutate live YouTrack state.

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

## Write tools

Seven of the fourteen tools mutate live YouTrack state: `youtrack_add_comment`,
`youtrack_create_issue`, `youtrack_update_fields`, `youtrack_add_issue_tag`,
`youtrack_remove_issue_tag`, `youtrack_set_tags`, and `youtrack_set_issue_link`.
None of them default to unattended `allow`; operators configure per-tool
`tool_prefs` policy at enable time via the settings UI:

- `youtrack_add_comment`, `youtrack_create_issue`, `youtrack_update_fields`,
  `youtrack_add_issue_tag`, `youtrack_remove_issue_tag`, `youtrack_set_tags` —
  default to `ask` (confirmation gate before the mutation runs).
- `youtrack_set_issue_link` — cross-issue relationships are harder to review
  and revert than a field/tag change on a single issue, so operators should
  consider `deny` unless the coding agent has a specific, trusted need to
  create issue links.

Set any of these to `deny` to keep this plugin read-only in practice for a
given context.

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
