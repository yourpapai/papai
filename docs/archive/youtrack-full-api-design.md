<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Full YouTrack API Coverage in papai Tools

Status: Draft
Owner: platform/providers
Scope: `src/providers/youtrack/`, `src/providers/types.ts`, `src/tools/`

## 1. Goal

Expose as much of YouTrack's REST API as is meaningful for an LLM-driven task
assistant, while keeping the cross-provider `TaskProvider` abstraction honest.
Today the YouTrack adapter implements ~23 of ~28 `TaskProvider` methods and
requests only a small subset of issue fields. This document inventories the
gaps, proposes domain-type extensions, lists new tools and capabilities, and
sketches a phased rollout.

## 2. Current state (baseline)

- Capabilities declared in `src/providers/youtrack/constants.ts`: tasks.delete,
  tasks.relations, projects.read/list/create/update, comments.read/create/
  update/delete, labels.list/create/update/delete/assign.
- Issue fields requested (`ISSUE_FIELDS`): id, idReadable, summary, description,
  created, updated, resolved, project(id, shortName, name), customFields
  (State/Priority/Assignee only mapped), tags, links.
- Mapped custom fields: `State`, `Priority`, `Assignee` only
  (`mappers.ts:55-80`). Everything else (Type, Subsystem, Estimation, Spent
  time, Affected versions, Fix versions, Sprint, etc.) is silently dropped.
- Not implemented: deleteProject, getComment, statuses.\*, attachments,
  work items (time tracking), users, sprints/agile boards, VCS changes,
  saved queries, tags-of-other-users, watchers, voters, project teams,
  permissions, custom field bundles.
- Relations use the command API (`/api/issues/{id}/execute`), which is
  fragile (depends on parser locale) and non-atomic for updates.
- `updateLabel` accepts `color` but never sends it (`labels.ts:60`).

## 3. YouTrack REST surface to cover

YouTrack ≥2024.x exposes the following resource families. Items in **bold**
are not currently used.

### 3.1 Issues

- `GET/POST /api/issues`, `GET/POST/DELETE /api/issues/{id}` — used.
- **`POST /api/issues/{id}/execute`** — command language; today only relations.
  Could power bulk transitions (assign + state + priority in one call).
- **`/api/issues/{id}/attachments`** — list/upload/delete attachments.
- **`/api/issues/{id}/links`** — structured CRUD for links (replace `/execute`).
- **`/api/issues/{id}/timeTracking/workItems`** — work items (time logs).
- **`/api/issues/{id}/voters`** / **`/watchers`** — list/add/remove.
- **`/api/issues/{id}/visibility`** — restrict visibility to groups/users.
- **`/api/issues/{id}/activities`** / **`/activitiesPage`** — change history,
  paginated by cursor; useful for "what changed on X since Y" prompts.
- **`/api/issues/{id}/customFields`** + per-field PUT — direct typed updates,
  avoiding the need to model every field as a top-level param.

### 3.2 Comments

- `GET/POST/DELETE /api/issues/{id}/comments[/{commentId}]` — used.
- **`/api/issues/{id}/comments/{cid}/reactions`** — emoji reactions.
- **`/api/issues/{id}/comments/{cid}/attachments`** — comment attachments.

### 3.3 Projects (admin)

- `GET/POST /api/admin/projects[/{id}]` — used.
- **`DELETE /api/admin/projects/{id}`** — supported by API, missing here.
- **`/api/admin/projects/{id}/team/users`** — project team management.
- **`/api/admin/projects/{id}/customFields`** — list/attach project custom
  fields and their bundle bindings (key for status support, see §4.3).
- **`/api/admin/projects/{id}/issueTags`** — project-scoped tags.
- **`/api/admin/projects/{id}/timeTrackingSettings`**.

### 3.4 Custom field bundles (admin)

- **`/api/admin/customFieldSettings/bundles/state/{id}/values`** — state list,
  add/remove/reorder. The basis for `statuses.*` capability on YouTrack.
- **`/api/admin/customFieldSettings/bundles/enum/{id}/values`** — for
  Priority, Type, Subsystem, etc.
- **`/api/admin/customFieldSettings/bundles/user/{id}`** — user bundles.
- **`/api/admin/customFieldSettings/bundles/version/{id}/values`** —
  Affected/Fix versions.

### 3.5 Tags

- `/api/tags` — used. Add **owner**, **visibleFor**, **updateableBy** fields.

### 3.6 Users / groups

- **`/api/users`**, **`/api/users/me`**, **`/api/groups`** — needed to resolve
  assignees by name and to render reporter/updater info.

### 3.7 Saved queries & search

- **`/api/savedQueries`** — recall named queries; pair with `search_tasks`.
- **`/api/issuesGetter/count`** — fast count of a query (useful for "how many
  bugs are open in PROJ").

### 3.8 Agile / Sprints

- **`/api/agiles`**, **`/api/agiles/{id}/sprints`** — list boards, list/create/
  update sprints, move issues into sprints.

### 3.9 Work items / time tracking

- **`/api/workItems`** + per-issue endpoints — log time, list time,
  durations, types.

### 3.10 Notifications & VCS

- **`/api/issues/{id}/vcsChanges`** — read-only; useful for "what commits
  reference this issue".

## 4. Domain-type extensions

The cross-provider abstraction should grow only where another provider can
plausibly support the concept. YouTrack-only data should be exposed via a
provider-scoped extension, not by polluting `Task`.

### 4.1 `Task`

Add (all optional, present-when-known):

```ts
type:           string          // YouTrack Type custom field, Kaneo type
estimation:     string | null   // ISO-8601 duration, free-form for Kaneo
spentTime:      string | null
sprint:         { id: string; name: string } | null
versions:       { affected?: string[]; fix?: string[] }
subsystem:      string | null
reporter:       { id: string; login: string; name?: string }
updater:        { id: string; login: string; name?: string }
votes:          number
commentsCount:  number
visibility:     { groups?: string[]; users?: string[] } | null
attachments:    Attachment[]    // see 4.5
parent:         { id: string; idReadable: string; title: string } | null
subtasks:       Array<{ id; idReadable; title; status?: string }>
extra:          Record<string, unknown>   // provider-specific escape hatch
```

Rules:

- Mappers only set fields when the corresponding custom field exists.
- `extra` is a typed-anywhere bag for fields no other provider can model
  (e.g. YouTrack `numberInProject`, custom enum cascades). Tools must not
  read from `extra`; it exists for `/get_task` rendering.

### 4.2 `Comment`

Add: `reactions?: Array<{ emoji: string; count: number; users: string[] }>`,
`attachments?: Attachment[]`, `editedBy?`, `usesMarkdown?: boolean`.

### 4.3 Statuses (`Column`)

YouTrack statuses live in **state bundles** attached to a project's State
custom field. To implement `statuses.*`:

1. On first status call for a project, resolve its State field via
   `GET /api/admin/projects/{id}/customFields?fields=field(name),bundle(id,$type)`.
2. Cache `projectId → bundleId` for the session (TTL 5min).
3. CRUD against `/api/admin/customFieldSettings/bundles/state/{bundleId}/values`.
4. Reorder via `POST` with the new ordinal on each value (no atomic reorder
   endpoint — emulate by sequential PUTs, treat as best-effort).
5. Declare capabilities `statuses.list/create/update/delete/reorder`.

Edge cases: a single bundle can be shared by multiple projects; mutating it
affects all. Document this and require an explicit `confirm: true` for
mutations on shared bundles.

### 4.4 Relations

Replace command-API calls with `/api/issues/{id}/links`:

- `GET …?fields=direction,linkType(name,sourceToTarget,targetToSource),issues(id,idReadable)`
- `POST` to create with `{ linkType: { name }, direction, issues: [{id}] }`.
- `DELETE` link by id.
- Add `RelationType` values: `subtask` and `subtask_of` (model parent/child
  symmetrically). Keep current aliases.

### 4.5 Attachments (new domain type)

```ts
type Attachment = {
  id: string
  name: string
  mimeType?: string
  size?: number
  url: string // absolute or signed
  thumbnailUrl?: string
  author?: string
  createdAt?: string
}
```

Capabilities: `attachments.list/upload/delete`.

### 4.6 Work items (new)

```ts
type WorkItem = {
  id: string
  taskId: string
  author: string
  date: string // YYYY-MM-DD
  duration: string // ISO-8601 PnDTnHnM
  description?: string
  type?: string
}
```

Capabilities: `workItems.list/create/update/delete`.

### 4.7 Sprints / agile (new, optional)

```ts
type Sprint = { id; name; agileId; start?: string; finish?: string; archived: boolean }
```

Capabilities: `sprints.list/create/update`, `sprints.assign` (move issue
into sprint).

### 4.8 Activities / history (new)

```ts
type Activity = {
  id: string
  timestamp: string
  author: string
  category: 'CommentsCategory'|'CustomFieldCategory'|'LinksCategory'|...
  field?: string
  added?: unknown
  removed?: unknown
}
```

Read-only. Capability `activities.read`.

### 4.9 Users

```ts
type UserRef = { id: string; login: string; name?: string; email?: string }
```

Add provider methods `resolveUser(query)` and `me()`. Used internally by
mappers and surfaced through a thin `find_user` tool.

## 5. New & changed tools

### 5.1 New tools

| Tool                                                                 | Capability           | Notes                                                     |
| -------------------------------------------------------------------- | -------------------- | --------------------------------------------------------- |
| `list_attachments` / `upload_attachment` / `remove_attachment`       | `attachments.*`      | Upload via multipart; chat-platform file relay.           |
| `log_work` / `list_work` / `update_work` / `remove_work`             | `workItems.*`        | Duration parsing helper (`2h 30m` → ISO).                 |
| `list_sprints` / `assign_to_sprint` / `create_sprint`                | `sprints.*`          | Hidden when no agile board.                               |
| `get_task_history`                                                   | `activities.read`    | Cursor pagination via `activitiesPage`.                   |
| `list_users` / `find_user`                                           | always               | Backed by `/api/users` for YouTrack, in-memory for Kaneo. |
| `add_watcher` / `remove_watcher`                                     | `tasks.watchers`     |                                                           |
| `add_vote` / `remove_vote`                                           | `tasks.votes`        |                                                           |
| `set_visibility`                                                     | `tasks.visibility`   | groups + users restrict list.                             |
| `count_tasks`                                                        | always               | Fast counter, leverages `/api/issuesGetter/count`.        |
| `list_saved_queries` / `run_saved_query`                             | `queries.saved`      |                                                           |
| `add_comment_reaction` / `remove_comment_reaction`                   | `comments.reactions` |                                                           |
| `list_project_team` / `add_project_member` / `remove_project_member` | `projects.team`      | Admin only.                                               |
| `archive_project`                                                    | `projects.delete`    | Implement now via `DELETE /api/admin/projects/{id}`.      |
| `get_comment`                                                        | `comments.read`      | Already gated, never implemented.                         |

### 5.2 Changed tools

- `create_task` / `update_task`: add optional `type`, `subsystem`,
  `estimation`, `affectedVersions`, `fixVersions`, `sprintId`, `parentId`,
  `visibility`. All passed through `buildCustomFields`, which becomes
  bundle-aware (resolves enum names → bundle value ids when needed).
- `get_task`: returns the extended `Task` (4.1) and (when `attachments.*`
  capability set) eagerly returns up to N attachments.
- `update_label`: actually send `color` (bug fix).
- Status tools: become available for YouTrack via §4.3.
- Relation tools: switch to `/api/issues/{id}/links`; `update_task_relation`
  becomes an actual REST update where possible.

### 5.3 Tool description changes

LLM descriptions must mention the new optional params and the YouTrack
interpretation (e.g. "estimation accepts ISO-8601 duration like `PT2H30M`
or natural `2h30m` which the bot will normalize").

## 6. Issue fields requested

Extend `ISSUE_FIELDS`:

```
id,idReadable,numberInProject,summary,description,
created,updated,resolved,
project(id,shortName,name),
reporter(id,login,fullName),updater(id,login,fullName),
votes,commentsCount,
customFields($type,name,
  value($type,id,name,login,fullName,localizedName,minutes,presentation,text)),
tags(id,name,color(id,background,foreground),owner(login)),
links(id,direction,
  linkType(id,name,sourceToTarget,targetToSource,directed,aggregation),
  issues(id,idReadable,summary,resolved)),
attachments(id,name,mimeType,size,url,thumbnailURL,author(login),created),
visibility($type,permittedGroups(name),permittedUsers(login)),
parent(issues(id,idReadable,summary)),
subtasks(issues(id,idReadable,summary,resolved))
```

List/search variants stay lean; add `numberInProject` and `resolved`
(needed to render strikethrough done items).

## 7. Custom field handling

Today `buildCustomFields` only knows three names. New strategy:

1. Maintain a typed registry per field name → `$type` (state, enum, user,
   period, version, simple).
2. On first use per project, fetch project's custom fields once and cache
   `{ name → { $type, bundleId? } }`.
3. `buildCustomFields(params, schema)` produces the correct payload shape:
   - `StateProjectCustomField` → `{ value: { name } }` (id resolved on
     server when name is unique within bundle)
   - `MultiVersionIssueCustomField` → `{ value: [{ name }] }`
   - `PeriodIssueCustomField` → `{ value: { presentation: "2h 30m" } }`
   - `SingleUserIssueCustomField` → `{ value: { login } }`
4. Unknown fields are passed through `extra`-style and rejected with a
   clear error rather than silently dropped.

## 8. Error classification

Add YouTrack-specific cases to `classifyYouTrackError`:

- 400 `customField has empty value` → AppError `invalid_input` with the
  offending field name extracted from `error_description`.
- 400 `Bundle element not found` → AppError `not_found` with "status".
- 403 on admin endpoints → `forbidden` with "requires admin permission".
- 404 `Issue link type not found` → `invalid_input` for relation type.

## 9. Pagination

YouTrack uses `$top` / `$skip`. Wrap list operations with a `paginate()`
helper that:

- defaults `$top=100`,
- streams pages until `result.length < $top`,
- caps at `MAX_PAGES` (configurable per call) to bound LLM context.

## 10. Capability matrix additions

```
attachments.list / upload / delete
workItems.list / create / update / delete
sprints.list / create / update / assign
activities.read
queries.saved
tasks.watchers
tasks.votes
tasks.visibility
comments.reactions
projects.team
projects.delete
statuses.* (already in union, newly supported)
```

## 11. Phased rollout

**Phase 1 — bug fixes & cheap wins** (no new domain types)

- Fix `updateLabel` color.
- Implement `getComment`, `archive_project` (DELETE).
- Add `numberInProject`, `reporter`, `updater`, `commentsCount`, `votes`,
  `resolved` to `ISSUE_FIELDS` and surface them on `Task`/`TaskListItem`.
- Switch relations to `/api/issues/{id}/links` (no API surface change).

**Phase 2 — statuses & richer custom fields**

- Project custom-field discovery + cache.
- Bundle-aware `buildCustomFields`.
- Implement `statuses.*` via state bundles.
- Add `type`, `estimation`, `spentTime` to `Task`.

**Phase 3 — attachments & work items**

- New `Attachment` and `WorkItem` types and tools.
- Multipart upload through chat-platform file relay.
- Time-tracking duration parser.

**Phase 4 — collaboration**

- Watchers, voters, comment reactions, visibility, project team, users
  resolver, `find_user` tool.

**Phase 5 — agile & history**

- Sprints + agile boards, saved queries, activity history, count tool.

Each phase is independently shippable and gated by capabilities so the Kaneo
provider remains unaffected.

## 12. Testing strategy

- Unit: per-operation tests against recorded JSON fixtures
  (`tests/providers/youtrack/fixtures/*.json`). One fixture per endpoint
  variant; validates schemas and mappers.
- Mutation: bundle-resolution and `buildCustomFields` are heuristic-heavy —
  Stryker should retain coverage.
- Contract: a smoke E2E (opt-in via env) hitting a self-hosted YouTrack
  in Docker (`jetbrains/youtrack-standalone`), seeded with one project, one
  state bundle, and a couple of custom fields.
- TDD ordering: every new tool follows the existing red→green pipeline; new
  domain fields require list/search snapshots updated in the same commit as
  the schema change.

## 13. Risks & open questions

- **Shared bundles** (§4.3) — mutating statuses for one project may affect
  others. Need a confirmation gate similar to `delete_task`.
- **Field name collisions** between projects ("Type" can be enum in one
  project, single-value in another). Must key the cache by `(projectId, name)`.
- **Locale** — server may return localized custom-field names. Always send
  English names on writes; on reads prefer `name` over `localizedName`.
- **Rate limits** — bulk pagination could trip YouTrack throttling. Adopt
  exponential backoff in `youtrackFetch` once we add paginated tools.
- **Token scopes** — admin endpoints (projects.team, bundles) require admin
  scope; surface a friendly error when the configured token lacks it.
- **Memory/context** — `Task` is rendered into LLM context. Adding many
  optional fields risks ballooning prompts. Keep `get_task` verbose, keep
  list/search lean.

## 14. Non-goals

- VCS integration writes (we only read `vcsChanges` if at all).
- YouTrack workflow scripts / rules.
- Notifications, mailbox integration, knowledge-base articles.
- Backup/restore admin endpoints.
- Cross-provider abstractions for things only YouTrack has (sprint → Kaneo
  has no equivalent; the tool will simply be hidden by capability gating).
