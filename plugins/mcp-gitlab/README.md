# GitLab (coding agent)

> Plugin ID: `mcp-gitlab` · Version: 1.0.0 · `defaultEnabled: false`

Agent-facing GitLab tools — read and write. This plugin does **not** register
chat-visible tools for end users — it declares `mcpServer: true`, so its 9
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
| `gitlab_post_comment`        | **WRITE:** post a comment on a merge request                            |
| `gitlab_create_discussion`   | **WRITE:** open a new discussion thread on a merge request              |
| `gitlab_update_mr`           | **WRITE:** update a merge request's title/description/target branch     |
| `gitlab_set_mr_state`        | **WRITE:** close or reopen a merge request                              |
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
needs the `api` scope (the four write tools below post/update MR state;
`read_repository` alone is no longer sufficient once writes are enabled).
Project paths are the GitLab `namespace/project` form (URL-encoded
internally), not numeric project ids.

## Response redaction

The manifest does **not** set `mcpResponseRedaction` — responses pass through
to the external coding agent unredacted, matching `mcp-figma`/`mcp-teamcity`/
`mcp-rag`/`mcp-mattermost` rather than `mcp-sentry`/`mcp-confluence`. Merge
request bodies, file contents, and job logs are project-internal, not
customer data.

## Write tools

Four of the nine tools mutate live GitLab state: `gitlab_post_comment`,
`gitlab_create_discussion`, `gitlab_update_mr`, and `gitlab_set_mr_state`.
None of them default to unattended `allow`; operators who want a
confirmation gate should set the per-tool `tool_prefs` policy to `ask` (or
`deny`) at enable time via the settings UI. Set all four to `deny` to keep
this plugin read-only in practice for a given context.

In coding sessions, `ask` enforcement for these tools depends on magi's
MCP-broker gate (papai itself has no code-level default `ask` for plugin MCP
tools) — the operator `tool_prefs` policy is the durable configuration, magi
is what actually pauses the call for confirmation.

**Forge-write boundary.** This plugin's write surface is review-collaboration
only — MR comments, discussions, and MR title/description/target
branch/state — made with this plugin's own GitLab token. Code delivery (push,
opening a PR/MR, merging) stays outside this plugin and remains magi's
domain.

## Deviations / scope

- **Job actions are still read-only.** `gitlab_get_job` reads a job's
  metadata and trace log; retrying/canceling jobs is not implemented by this
  plugin.
- **Pagination.** `gitlab_get_repository_tree` always returns the full tree
  as `{ entries, capped }`. `gitlab_get_mrs` returns a single GitLab API page
  by default (`perPage`/`page` passed through, `total`/`totalPages`/`page`/
  `perPage` echoed back from response headers, `capped: false`), or fetches
  every matching MR when `all: true` is passed (ignoring `page`/`perPage`).
  Both follow GitLab's `x-total-pages` response header, fetching the
  remaining pages in parallel (`Promise.all` — plugin code cannot import
  `p-limit`, matching the `nerv`/`acp` fan-out precedent), hard-capped at 50
  pages (5000 items); `capped: true` in the response flags that the result
  was truncated at that cap.
- **`gitlab_get_job` returns a structured object** (id, name, status, stage,
  `web_url`, ref, timestamps, duration) plus the job's trace log inline as
  `log`/`logTruncated`, rather than two separate tool calls. It accepts
  either `projectPath` + `jobId`, or a full `jobUrl` (e.g.
  `https://gitlab.example.com/group/project/-/jobs/123`) as an alternative —
  the URL is parsed into `projectPath`/`jobId` internally.
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
