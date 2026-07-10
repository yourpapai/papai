# Sentry (coding agent)

> Plugin ID: `mcp-sentry` · Version: 1.0.0 · `defaultEnabled: false`

Agent-facing Sentry issue-diagnosis tools. This plugin does **not** register
chat-visible tools for end users — it declares `mcpServer: true`, so its 7
tools are exposed as an MCP server surface at `/mcp/plugin/mcp-sentry` for an
external coding agent (via papai's sandbox MCP broker) to call directly. It is
the first first-party plugin migrated onto the "MCP server as a papai plugin"
pattern (see `docs/architecture/coding-stack-overview.md` §3.6).

## Tools

| Tool                          | Notes                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| `sentry_get_projects`         | List Sentry projects in the org                                                          |
| `sentry_search_issues`        | Search issues with an optional query/project/environment/sort filter                     |
| `sentry_get_issue`            | Get a single issue by id                                                                 |
| `sentry_get_issue_events`     | List recent events for an issue                                                          |
| `sentry_get_issue_tag_values` | List tag values for a given issue tag key                                                |
| `sentry_get_issue_comments`   | List comments/activity on an issue                                                       |
| `sentry_get_issue_details`    | Composite view: issue + latest events + tag values + comments + suspect releases/commits |

All 7 tools are read-only GETs against the Sentry API (`client.ts`), so they
carry no write-tool policy concerns — see `plugins/mcp-sentry/input-schema.ts`
for the exact JSON-schema input contract per tool.

## Permissions

`http`.

## Allowed hosts

Derived from the admin-scoped `base_url` config via
`providerAllowedHostsFromConfig: ["base_url"]` — no static allowlist entry.

## Configuration

| Key        | Scope | Required | Sensitive | Description      |
| ---------- | ----- | -------- | --------- | ---------------- |
| `base_url` | admin | Yes      | No        | Sentry base URL  |
| `token`    | admin | Yes      | Yes       | Sentry API token |
| `org_slug` | admin | Yes      | No        | Sentry org slug  |

All three are deployment-wide (admin scope only); there is no per-context
override.

## Response redaction

The manifest also declares `mcpResponseRedaction: true`. Because this plugin
is exposed over `/mcp/plugin/mcp-sentry`, every tool response is run through
papai's bridge-level redactor (`src/mcp-server/redaction.ts`,
`callPluginMcpTool` in `src/mcp-server/plugin-bridge.ts`) before it reaches
the external coding agent, on top of Sentry payloads potentially containing
customer data.

This is **fail-closed**: it requires the operator to configure `mcp_redaction`
(`src/coding-credentials/mcp-redaction.ts` — `model_url`/`api_key`/
`model_name`/`timeout_ms`) for the platform instance. Without it configured,
a `tools/call` returns a blocked-result marker instead of data, and the
plugin is excluded entirely from the internal-MCP-server picker
(`listEnabledInternalMcpServers` in
`src/coding-credentials/mcp-plugin-servers.ts`) until it is set.

Independently of the LLM-based redactor, `format.ts`'s `sanitizeObject` is a
static key-name sanitizer applied inside `SentryClient` itself: any response
field whose key matches `/password|token|secret|apikey|api_key|credential|
authorization|cookie|session/i` (and holds a truthy value) is replaced with
`[REDACTED]` before the payload is returned from the tool at all — a
belt-and-suspenders layer that does not depend on `mcp_redaction` being
configured.

## Failure handling

Tool executions return structured errors rather than throwing: `not_configured`
(missing admin creds or no HTTP runtime), `rate_limited` (with
`retryAfterSec`), `validation_error`, `timeout` (on `AbortError`), and
`sentry_error` (carries the upstream error message; includes non-2xx status).

## Enabling

Approve the plugin in the settings UI admin Plugins area (super admin), set
the three admin-scoped Sentry config values, configure `mcp_redaction` for the
platform instance, then select `plugin:mcp-sentry` as a coding MCP server for
the context.
