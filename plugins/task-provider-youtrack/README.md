# YouTrack

> Plugin ID: `task-provider-youtrack` · Version: 1.0.0 · `defaultEnabled: false`

First-party task-provider plugin integrating
[JetBrains YouTrack](https://www.jetbrains.com/youtrack/). Contributes the
`youtrack` task-provider type used by task instances and the capability-gated
task tools. YouTrack is the most fully-featured provider in papai.

## Contributions

| Surface            | Name       | Notes                                     |
| ------------------ | ---------- | ----------------------------------------- |
| Task provider type | `youtrack` | Registered via `registerTaskProviderType` |

No auto-provisioning — connect to an existing YouTrack instance with a
permanent token.

## Permissions

`provider.task`, `identity`.

## Provider capabilities

Comments (`create/read/update/delete/reactions`), labels (tags) full CRUD +
assign, projects full CRUD + `team`, statuses full CRUD + reorder,
relations, delete, count, command language (`tasks.commands`),
watchers, votes, visibility, attachments (`list/upload/delete`),
work items (`list/create/update/delete`), sprints (`list/create/update/assign`),
agiles, saved queries, and activity history (`activities.read`).

## Configuration

### Instance-scoped (`/admin#instances`)

| Key       | Required | Sensitive | Description                                   |
| --------- | -------- | --------- | --------------------------------------------- |
| `baseUrl` | Yes      | No        | YouTrack URL (validated as an http/https URL) |

### Context-scoped (settings UI, via `/config`)

| Key     | Required | Sensitive | Description              |
| ------- | -------- | --------- | ------------------------ |
| `token` | Yes      | Yes       | YouTrack permanent token |

Stored under the namespaced key
`plugin:task-provider-youtrack:provider:token`.

## Traits

`supports-command-language` (`command-language:youtrack`), `custom-fields`.

## Behavior notes

- **Custom fields** — YouTrack issue creation can require workflow-specific
  custom fields; task creation exposes a `customFields` input for them.
- **State** — issue status is a custom field ("Open", "In Progress", "Fixed",
  …); transitions may be governed by workflows, so a rejected state update means
  trying a different valid state.
- **Readable IDs** — issues use human-readable IDs like `PROJ-123`; always use
  these.
- **Tags as labels** — YouTrack tags map onto the label tools.
- **Command language** — `apply_youtrack_command` is used only for explicit
  command-style operations or field mutations the structured tools cannot
  express safely.

(See `prompt-addendum.ts` for the full YouTrack-specific guidance injected into
the system prompt.)

## Enabling

1. Create a YouTrack task instance in `/admin#instances` and set `baseUrl`.
2. Approve `task-provider-youtrack` in the settings UI admin Plugins area (super admin).
3. Bind a context to the instance and enter the `token` in the settings UI
   (opened via `/config`).
