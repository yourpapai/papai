# GitHub Issues

> Plugin ID: `task-provider-github` · Version: 1.0.0 · `defaultEnabled: false`

First-party task-provider plugin integrating
[GitHub Issues](https://docs.github.com/en/rest/issues). Contributes the
`github` task-provider type used by task instances and the capability-gated
task tools. One task instance is bound to exactly one repository.

## Contributions

| Surface            | Name     | Notes                                     |
| ------------------ | -------- | ----------------------------------------- |
| Task provider type | `github` | Registered via `registerTaskProviderType` |

No auto-provisioning — connect to an existing repository with a personal
access token.

## Permissions

`provider.task`, `identity`.

## Provider capabilities

Projects `list`/`read` (the configured repository is the only project), the
core task operations (create/read/update/list/search), full issue-comment
management (`comments.read`/`create`/`update`/`delete`), label management
(`labels.list`/`create`/`update`/`delete`/`assign`, at both repository and
issue level), task history (`activities.read`, from issue events), task
counting (`tasks.count`, via the search API's `total_count`), and identity
resolution (collaborator-first user search with a `/search/users` fallback).
Single-comment fetch and comment reactions are not offered, and attachments
and issue deletion remain absent: GitHub's REST API cannot delete issues.

## Configuration

### Instance-scoped (`/admin#instances`)

| Key       | Required | Sensitive | Description                                                                                                                           |
| --------- | -------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `repo`    | Yes      | No        | Repository in `owner/repo` form                                                                                                       |
| `baseUrl` | No       | No        | GitHub API URL; empty defaults to `https://api.github.com`. Set for GitHub Enterprise Server (e.g. `https://ghes.example.com/api/v3`) |

### Context-scoped (settings UI, via `/config`)

| Key     | Required | Sensitive | Description                        |
| ------- | -------- | --------- | ---------------------------------- |
| `token` | Yes      | Yes       | GitHub personal access token (PAT) |

Stored encrypted under the namespaced key
`plugin:task-provider-github:provider:token`; never written to logs.

Outbound requests target only `api.github.com` or the configured `baseUrl`
host because the client resolves that base URL once and joins API paths onto
it. Those hosts are _declared_ in the manifest (`providerAllowedHosts` +
`providerAllowedInstanceHostsFromConfig`); request-time host admission is not
enforced yet and arrives when provider clients adopt `ctx.providerRuntime`
(KNOWN GAP #15).

## Traits

None.

## Behavior notes

- **One repository per instance** — the configured repo is the only project;
  creating tasks in any other project id fails with project-not-found.
- **Status model** — issues are `open` or `closed`; closing as not planned
  folds into the status text `closed (not_planned)`. Closing/reopening is a
  status update through `update_task` (GitHub cannot delete issues, so no
  delete is offered).
- **Task ids are issue numbers** (`"42"`), usable interchangeably across
  create/read/update/list/search.
- **Ignored inputs** — `priority`, `dueDate`, and `startDate` are accepted
  but ignored; GitHub Issues has no such fields.
- **Assignees are logins** — `preferredUserIdentifier` is `login`.
- **Search qualifiers** — queries pass through to GitHub search
  (`label:`, `assignee:`, `state:`, …); `repo:{owner}/{repo} is:issue` is
  pinned automatically. Rate-limited responses (429 / rate-limit-shaped 403)
  surface as `rate-limited`.

(See `prompt-addendum.ts` for the full GitHub-specific guidance injected into
the system prompt.)

## GraphQL API support

A GraphQL transport (`graphql-client.ts`) sits beside the REST client with
the same guarantees: resolved-and-confined endpoint, authenticated POST,
metadata-only logging, observation-boundary emission, and classified errors
(a 200 carrying `errors[]` maps by GraphQL type: `FORBIDDEN` /
`INSUFFICIENT_SCOPES` → auth failure, `NOT_FOUND` → task/project not found,
`RATE_LIMITED` → rate-limited, anything else → validation failure). It has no
production caller yet — the `github-provider-projects` follow-up (Projects
V2) is its first consumer — so its exports stay knip-ignored until that lands.

### Endpoint derivation

The GraphQL endpoint is derived per call from the instance's REST `baseUrl`
(empty means the public default; trailing slashes are stripped, and a GHES
`/api/v3` suffix is replaced, not appended to):

| Configured REST base                                   | GraphQL endpoint                                     |
| ------------------------------------------------------ | ---------------------------------------------------- |
| empty or `https://api.github.com` (the public default) | `https://api.github.com/graphql`                     |
| GHES `…/api/v3`, including sub-path prefixes           | same origin + `/api/graphql` (the suffix is swapped) |
| anything else (GHES bare origin)                       | base + `/api/graphql`                                |

The derived endpoint's host is always the configured REST base's host, so the
manifest's declared hosts are unchanged. A reverse-proxied GHES whose REST
path does not end in `/api/v3` derives base + `/api/graphql` — fix via the
existing `baseUrl` config, same as REST misconfiguration today.

### Token scopes

The transport itself needs no scope beyond today's. Later GraphQL surfaces
(Projects V2) require the classic-PAT `project` scope, or the fine-grained
Projects read/write permission.

## Enabling

1. Create a GitHub task instance in `/admin#instances` and set `repo`
   (and `baseUrl` for GitHub Enterprise Server).
2. Approve `task-provider-github` in the settings UI admin Plugins area (super admin).
3. Bind a context to the instance and enter the PAT `token` in the settings UI
   (opened via `/config`).
