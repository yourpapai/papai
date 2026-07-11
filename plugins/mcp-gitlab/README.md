# GitLab (coding agent)

> Plugin ID: `mcp-gitlab` · Version: 1.0.0 · `defaultEnabled: false`

Agent-facing read-only GitLab tools. This plugin does **not** register
chat-visible tools for end users — it declares `mcpServer: true`, so its 5
tools are exposed as an MCP server surface at `/mcp/plugin/mcp-gitlab` for an
external coding agent (via papai's sandbox MCP broker) to call directly. It is
the seventh first-party plugin migrated onto the "MCP server as a papai
plugin" pattern, after `mcp-sentry`, `mcp-confluence`, `mcp-figma`,
`mcp-teamcity`, `mcp-rag`, and `mcp-mattermost` (see
`docs/architecture/coding-stack-overview.md` §3.6).

## Tools

| Tool                         | Notes                                                                   |
| ---------------------------- | ----------------------------------------------------------------------- |
| `gitlab_get_repository_tree` | List files/directories in a repo at a given path/ref, for repo browsing |
| `gitlab_get_file_content`    | Get the raw content of a file at a given ref, for repo browsing         |
| `gitlab_get_mr_info`         | Get details of a single merge request by iid                            |
| `gitlab_get_mrs`             | List/search merge requests in a project with optional filters           |
| `gitlab_get_job`             | Get a CI job's metadata and trace log                                   |

See `plugins/mcp-gitlab/input-schema.ts` for the exact JSON-schema input
contract per tool.

## Permissions

`http`.

## Allowed hosts

Derived from the admin-scoped `base_url` config via
`providerAllowedHostsFromConfig: ["base_url"]` — no static allowlist entry.

## Configuration

| Key        | Scope | Required | Sensitive | Description                                 |
| ---------- | ----- | -------- | --------- | ------------------------------------------- |
| `base_url` | admin | Yes      | No        | GitLab base URL (e.g. `https://gitlab.com`) |
| `token`    | admin | Yes      | Yes       | GitLab personal/project access token        |

Both are deployment-wide (admin scope only); there is no per-context
override. `token` is sent as the `PRIVATE-TOKEN` header (`client.ts`) on every
request against `{base_url}/api/v4` — there is no OAuth/Bearer mode. The token
needs the `api` or `read_repository` scope (read-only usage is sufficient;
papai does not exercise any write scope). Project paths are the GitLab
`namespace/project` form (URL-encoded internally), not numeric project ids.

## Response redaction

The manifest does **not** set `mcpResponseRedaction` — responses pass through
to the external coding agent unredacted, matching `mcp-figma`/`mcp-teamcity`/
`mcp-rag`/`mcp-mattermost` rather than `mcp-sentry`/`mcp-confluence`. Merge
request bodies, file contents, and job logs are project-internal, not
customer data.

## Deviations / scope

- **Read-only.** All 5 tools are read-only GitLab API calls. Write tools
  (posting MR comments/discussions, changing MR state, retrying/canceling
  jobs) are deferred — that surface belongs to magi's forge-write domain, not
  this plugin.
- **Single-page pagination.** `gitlab_get_mrs` does not auto-paginate; it
  returns one GitLab API page (`perPage`/`page` passed through, `total`/
  `totalPages`/`page`/`perPage` echoed back from response headers) and leaves
  it to the calling agent to request further pages.
- **`gitlab_get_job` returns a structured object** (id, name, status, stage,
  `web_url`, ref, timestamps, duration) plus the job's trace log inline as
  `log`/`logTruncated`, rather than two separate tool calls.
- **Truncation.** File content (`gitlab_get_file_content`) and job trace logs
  (`gitlab_get_job`) are truncated at ~1MB (`truncateText` in `format.ts`);
  truncated file content is prefixed with a `[WARNING: file truncated to
~1MB]` marker, and job responses set `logTruncated: true`.

## Failure handling

Tool executions return structured errors rather than throwing: `not_configured`
(missing admin creds or no HTTP runtime), `rate_limited` (with
`retryAfterSec`), `validation_error`, `timeout` (on `AbortError`), and
`gitlab_error` (carries the upstream error message; includes non-2xx status).

## Enabling

Approve the plugin in the settings UI admin Plugins area (super admin), set
the two admin-scoped GitLab config values, then select `plugin:mcp-gitlab` as
a coding MCP server for the context.
