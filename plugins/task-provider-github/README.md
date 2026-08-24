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
management (`comments.read`/`create`/`update`/`delete`), and label management
(`labels.list`/`create`/`update`/`delete`/`assign`, at both repository and
issue level). Single-comment fetch and comment reactions are not offered, and
attachments, deletion, and history are not offered: GitHub's REST API cannot
delete issues, and the remaining surfaces arrive in later sessions.

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

## Enabling

1. Create a GitHub task instance in `/admin#instances` and set `repo`
   (and `baseUrl` for GitHub Enterprise Server).
2. Approve `task-provider-github` in the settings UI admin Plugins area (super admin).
3. Bind a context to the instance and enter the PAT `token` in the settings UI
   (opened via `/config`).
