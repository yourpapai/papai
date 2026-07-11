# TeamCity (coding agent)

> Plugin ID: `mcp-teamcity` · Version: 1.0.0 · `defaultEnabled: false`

Agent-facing TeamCity project/pipeline config tools. This plugin does **not**
register chat-visible tools for end users — it declares `mcpServer: true`, so
its 4 tools are exposed as an MCP server surface at
`/mcp/plugin/mcp-teamcity` for an external coding agent (via papai's sandbox
MCP broker) to call directly. It is the fourth first-party plugin migrated
onto the "MCP server as a papai plugin" pattern, after `mcp-sentry`,
`mcp-confluence`, and `mcp-figma` (see
`docs/architecture/coding-stack-overview.md` §3.6).

## Tools

| Tool                             | Notes                                                     |
| -------------------------------- | --------------------------------------------------------- |
| `teamcity_get_projects`          | List all TeamCity projects                                |
| `teamcity_get_project_config`    | Get a TeamCity project configuration by project id        |
| `teamcity_get_project_pipelines` | List the build configurations (pipelines) under a project |
| `teamcity_get_pipeline_config`   | Get a TeamCity build configuration (pipeline) by its id   |

See `plugins/mcp-teamcity/input-schema.ts` for the exact JSON-schema input
contract per tool.

## Permissions

`http`.

## Allowed hosts

Derived from the admin-scoped `base_url` config via
`providerAllowedHostsFromConfig: ["base_url"]` — no static allowlist entry.

## Configuration

| Key        | Scope | Required | Sensitive | Description                                             |
| ---------- | ----- | -------- | --------- | ------------------------------------------------------- |
| `base_url` | admin | Yes      | No        | TeamCity base URL (e.g. `https://teamcity.example.com`) |
| `token`    | admin | Yes      | Yes       | TeamCity API token                                      |

Both are deployment-wide (admin scope only); there is no per-context
override. `token` is sent as an HTTP Bearer `Authorization` header
(`client.ts`) on every request against `{base_url}/app/rest` — there is no
Basic-auth mode.

## Secret handling

**This plugin does NOT use AI-based response redaction** (no
`mcpResponseRedaction` manifest flag). TeamCity build/VCS/step/parameter
configs routinely embed secrets as structured `{ name, value }` properties
(e.g. build step env vars, VCS root credentials, typed parameters), so
instead this plugin ships a **static sanitizer**,
`sanitizeTeamCityConfig` in `format.ts`: it walks the response tree, and for
any object shaped like `{ name, value }` whose `name` matches
`/password|token|secret|key|credential/iu`, it replaces `value` with
`'[REDACTED]'`.

This sanitizer is applied inside `client.ts` to the two config-fetching
tools' raw TeamCity API responses — `teamcity_get_project_config`
(`getProjectConfig`) and `teamcity_get_pipeline_config`
(`getBuildTypeConfig`) — before they are returned to the caller.
`teamcity_get_projects` and `teamcity_get_project_pipelines` return list
summaries only (no steps/VCS roots/parameters), so they are not run through
it.

**This static, name-pattern sanitizer is the ONLY protection against leaking
TeamCity secrets to the coding agent.** There is no AI redaction pass and no
bridge-level `mcpResponseRedaction`. If a secret-bearing property is named
something the regex doesn't match, or a secret is embedded in a value under
a different key shape, it will not be caught. Operators should be aware
build parameters/VCS credentials in TeamCity that don't follow the
`name`/`value` property convention, or whose `name` doesn't contain one of
the matched words, are not scrubbed.

## Failure handling

Tool executions return structured errors rather than throwing:
`not_configured` (missing admin creds or no HTTP runtime), `rate_limited`
(with `retryAfterSec`), `validation_error`, `timeout` (on `AbortError`), and
`teamcity_error` (carries the upstream error message; includes non-2xx
status).

## Enabling

Approve the plugin in the settings UI admin Plugins area (super admin), set
the two admin-scoped TeamCity config values (`base_url`, `token`), then
select `plugin:mcp-teamcity` as a coding MCP server for the context.
