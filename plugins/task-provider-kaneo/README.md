# Kaneo

> Plugin ID: `task-provider-kaneo` · Version: 1.0.0 · `defaultEnabled: false`

First-party task-provider plugin integrating the
[Kaneo](https://kaneo.app) task tracker. Contributes the `kaneo` task-provider
type used by task instances and the capability-gated task tools.

## Contributions

| Surface            | Name    | Notes                                                                                          |
| ------------------ | ------- | ---------------------------------------------------------------------------------------------- |
| Task provider type | `kaneo` | Registered via `registerTaskProviderType` with factory, `autoProvision`, and `provision` hooks |

Kaneo supports **auto-provisioning**: the bot can register a Kaneo user account
for a chat user as part of the onboarding workflow.

## Permissions

`provider.task`, `identity`.

## Provider capabilities

`comments.{create,read,update,delete}`, `labels.{list,create,update,assign}`,
`projects.{list,read,create,update,delete}`,
`statuses.{list,create,update,delete,reorder}`, `tasks.delete`,
`tasks.relations`.

Not supported: reactions, attachments, work items, task count, watchers/votes/
visibility, project team.

## Configuration

### Instance-scoped (`/admin#instances`)

| Key           | Required | Sensitive | Description                                       |
| ------------- | -------- | --------- | ------------------------------------------------- |
| `baseUrl`     | Yes      | No        | Public Kaneo URL (validated as an http/https URL) |
| `internalUrl` | No       | No        | Internal Kaneo URL for bot-to-Kaneo traffic       |

`validateConfig` checks that `baseUrl` is a well-formed http/https URL. It does
**not** perform an authenticated healthcheck — credentials are validated later
during context setup.

### Context-scoped (settings UI, via `/config`)

| Key           | Required | Sensitive | Description           |
| ------------- | -------- | --------- | --------------------- |
| `credential`  | Yes      | Yes       | Kaneo API key / token |
| `workspaceId` | Yes      | No        | Kaneo workspace ID    |

Stored under the namespaced keys
`plugin:task-provider-kaneo:provider:credential` and
`plugin:task-provider-kaneo:provider:workspaceId`.

## Traits

`workspace-scoped`, `task-label-read-requires-provider-specific-api`.

## Enabling

1. Create a Kaneo task instance in `/admin#instances` and set `baseUrl`.
2. Approve `task-provider-kaneo` in the settings UI admin Plugins area (super admin).
3. Bind a context to the instance and enter `credential` + `workspaceId` in the
   settings UI (opened via `/config`).
