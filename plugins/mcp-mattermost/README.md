# Mattermost (coding agent)

> Plugin ID: `mcp-mattermost` · Version: 1.0.0 · `defaultEnabled: false`

Agent-facing Mattermost read/post tools. This plugin does **not** register
chat-visible tools for end users — it declares `mcpServer: true`, so its 5
tools are exposed as an MCP server surface at `/mcp/plugin/mcp-mattermost`
for an external coding agent (via papai's sandbox MCP broker) to call
directly. It is the sixth first-party plugin migrated onto the "MCP server
as a papai plugin" pattern, after `mcp-sentry`, `mcp-confluence`,
`mcp-figma`, `mcp-teamcity`, and `mcp-rag` (see
`docs/architecture/coding-stack-overview.md` §3.6).

## Tools

| Tool                             | Notes                                                                     |
| -------------------------------- | ------------------------------------------------------------------------- |
| `mattermost_get_post`            | Get a single post by permalink or id                                      |
| `mattermost_get_thread`          | Get the whole thread for a root permalink or id, ordered oldest to newest |
| `mattermost_get_channel_posts`   | List channel posts; supports `since`, `page`, `perPage`                   |
| `mattermost_create_post`         | Post a message to a channel, optionally as a thread reply                 |
| `mattermost_download_attachment` | Download a file attachment; small text attachments are returned inline    |

See `plugins/mcp-mattermost/input-schema.ts` for the exact JSON-schema input
contract per tool.

## Permissions

`http`.

## Allowed hosts

Derived from the admin-scoped `base_url` config via
`providerAllowedHostsFromConfig: ["base_url"]` — no static allowlist entry.

## Configuration

| Key            | Scope | Required | Sensitive | Description                      |
| -------------- | ----- | -------- | --------- | -------------------------------- |
| `base_url`     | admin | Yes      | No        | Mattermost base URL              |
| `access_token` | admin | Yes      | Yes       | Mattermost personal access token |

Both are deployment-wide (admin scope only); there is no per-context
override. `access_token` is sent as an HTTP Bearer `Authorization` header
(`client.ts`) against `{base_url}/api/v4` on every request.

## Enrichment

`mattermost_get_post`, `mattermost_get_thread`, and
`mattermost_get_channel_posts` all return posts enriched with the author's
username/name and attachment metadata: `client.ts`'s `enrichPosts` collects
the unique `user_id`s and `file_ids` across the returned posts and resolves
each with a deduped extra fetch (one `/users/:id` and one
`/files/:id/info` per unique id, not per post), then merges `user` and
`attachments` fields onto each shaped post.

## Response redaction

The manifest also declares `mcpResponseRedaction: true`. Because this
plugin is exposed over `/mcp/plugin/mcp-mattermost`, every tool response is
run through papai's bridge-level redactor (`src/mcp-server/redaction.ts`,
`callPluginMcpTool` in `src/mcp-server/plugin-bridge.ts`) before it reaches
the external coding agent, on top of Mattermost payloads potentially
containing message content the operator wants scrubbed.

This is **fail-closed**: it requires the operator to configure `mcp_redaction`
(`src/coding-credentials/mcp-redaction.ts` — `model_url`/`api_key`/
`model_name`/`timeout_ms`) for the platform instance. Without it configured,
a `tools/call` returns a blocked-result marker instead of data, and the
plugin is excluded entirely from the internal-MCP-server picker
(`listEnabledInternalMcpServers` in
`src/coding-credentials/mcp-plugin-servers.ts`) until it is set.

## Write tool

`mattermost_create_post` is the one **write** tool in this plugin — it
posts a new message to a live Mattermost channel or thread. Operators
should set its per-tool policy to `ask` or `deny` (rather than `allow`) at
enable time if they want a confirmation gate or want to keep this plugin
read-only in practice.

## `mattermost_download_attachment`

Text attachments (≤512KB, `text/*` mime type) are fetched and inlined as
`text` in the result (subject to the same response redaction as every
other tool response). Binary or oversized files return metadata only
(`attachment` fields such as `id`/`name`/`size`/`mime_type`) with
`isBinary`/`tooLarge` flags and no file content — this MCP transport has no
filesystem handoff to the calling coding agent.

## Failure handling

Tool executions return structured errors rather than throwing:
`not_configured` (missing admin creds or no HTTP runtime), `rate_limited`
(with `retryAfterSec`), `validation_error`, `timeout` (on `AbortError`), and
`mattermost_error` (carries the upstream error message; includes non-2xx
status).

## Enabling

Approve the plugin in the settings UI admin Plugins area (super admin), set
the two admin-scoped Mattermost config values, configure `mcp_redaction`
for the platform instance, then select `plugin:mcp-mattermost` as a coding
MCP server for the context.
