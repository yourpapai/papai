<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# YouTrack Tools — Branch `youtrack-parity-clean`

> Branch comparison against `master`, covering 24 commits (+5,634 / -620 lines across 71 files).

## End-User Report

### New capabilities for YouTrack users

| Category                      | What changed                                                                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Agile & Sprint management** | New tools: `list_agiles`, `list_sprints`, `create_sprint`, `update_sprint`, `assign_task_to_sprint`. YouTrack users can now manage agile boards and sprints directly through the bot. |
| **YouTrack commands**         | New `apply_youtrack_command` tool lets the bot execute native YouTrack commands (e.g. `for me`, `vote`). Destructive or ambiguous commands require explicit confirmation.             |
| **Saved queries**             | New `list_saved_queries` and `run_saved_query` tools expose YouTrack saved searches.                                                                                                  |
| **Task history**              | New `get_task_history` tool shows full activity timeline for a task (field changes, comments, links, visibility).                                                                     |
| **Single project lookup**     | New `get_project` tool fetches full project details by ID.                                                                                                                            |
| **Current user**              | New `get_current_user` tool resolves the authenticated YouTrack user.                                                                                                                 |

### Improvements to existing tools

- **`create_task` / `update_task`**: Priority is no longer a fixed enum — it now accepts any value matching the provider's configured priorities. Custom fields are gated: only YouTrack supports them; other providers get a clear error. YouTrack due dates are now correctly date-only (time portion is ignored).
- **`list_tasks`**: Due-date filters accept either `YYYY-MM-DD` or full ISO datetime. YouTrack dates are normalized to date-only automatically.
- **`add_task_label` / `remove_task_label`**: You can now specify a label by **name** (`labelName`) instead of requiring the label ID. The tool resolves the name automatically.
- **`get_task`**: YouTrack date-only due dates are preserved as-is instead of being incorrectly converted through UTC.
- **`promote_memo`**: Updated to work with the expanded provider interface.

### Safety / reliability

- YouTrack command tool uses a confirmation gate — only safe commands like `for me`, `vote`, `star` bypass confirmation; everything else requires the user to confirm intent.
- Extensive provider-layer validation for sprints, saved queries, custom fields, and due dates.
- ~4,300 lines of new/updated tests covering all the above.

---

## Detailed Breakdown of Changed Tools

### `create_task` (+63/-7)

| Aspect                | Before                                                                   | After                                                                                          |
| --------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| **Priority**          | Fixed enum: `z.enum(['no-priority', 'low', 'medium', 'high', 'urgent'])` | Free-form `z.string()` — accepts any value matching the provider's configured priorities       |
| **Due date (input)**  | Always converted via `localDatetimeToUtc(date, time, tz)`                | YouTrack: returns `date` only, time is ignored. Other providers: unchanged.                    |
| **Due date (output)** | Always formatted via `utcToLocal()`                                      | YouTrack: preserved as `YYYY-MM-DD` if date-only. Others: `utcToLocal()` as before.            |
| **Custom fields**     | Passed through unconditionally                                           | YouTrack: allowed. Non-YouTrack: throws `ProviderClassifiedError` with clear message           |
| **Descriptions**      | Generic                                                                  | YouTrack-specific guidance added to `dueDate.time`, `dueDate`, and `customFields` descriptions |

### `update_task` (+72/-11)

| Aspect                      | Before                                                     | After                                                                                           |
| --------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Priority**                | Fixed enum                                                 | Free-form `z.string()` (same as `create_task`)                                                  |
| **Due date (input/output)** | Always UTC-converted                                       | YouTrack date-only passthrough (same pattern as `create_task`)                                  |
| **Custom fields**           | Not available                                              | New `customFields` param — gated to YouTrack only, limited to simple string/text project fields |
| **Config lookup**           | Inline `getConfig(storageContextId ?? userId, 'timezone')` | Extracted to `getTimezone()` helper                                                             |

### `list_tasks` (+49/-5)

| Aspect                                         | Before                                                                      | After                                                                                    |
| ---------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Priority filter**                            | Fixed enum                                                                  | Free-form `z.string()`                                                                   |
| **Due date filters** (`dueBefore`, `dueAfter`) | Required full ISO datetime with offset (`z.iso.datetime({ offset: true })`) | Accepts either `YYYY-MM-DD` or ISO datetime with offset via custom `dueDateFilterSchema` |
| **YouTrack normalization**                     | N/A                                                                         | New `normalizeListTaskParams()` strips time from ISO datetimes when provider is YouTrack |
| **Due date output**                            | Always `utcToLocal()`                                                       | Provider-aware formatting (same pattern as other tools)                                  |

### `get_task` (+22/-2)

| Aspect                  | Before                | After                                                           |
| ----------------------- | --------------------- | --------------------------------------------------------------- |
| **Due date output**     | Always `utcToLocal()` | YouTrack: preserves `YYYY-MM-DD` as-is. Others: `utcToLocal()`. |
| **Provider param type** | `TaskProvider`        | `Readonly<TaskProvider>`                                        |

### `add_task_label` (+55/-9)

| Aspect              | Before                  | After                                                                                                                  |
| ------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Input**           | Required `labelId` only | Accepts either `labelId` **or** `labelName` (exactly one required, enforced by `.refine()`)                            |
| **Name resolution** | Not supported           | New `resolveLabelId()` — uses `provider.getLabelByName()` if available, falls back to filtering `listLabels()` results |
| **Error handling**  | Basic                   | Returns clear error if label name not found or multiple matches exist                                                  |

### `remove_task_label` (+49/-8)

Same changes as `add_task_label` — accepts `labelName` as alternative to `labelId`, with the same `resolveLabelId()` resolution logic.

### `promote_memo` (+36/-6)

| Aspect                  | Before                        | After                                                            |
| ----------------------- | ----------------------------- | ---------------------------------------------------------------- |
| **Due date (input)**    | Always `localDatetimeToUtc()` | YouTrack: date-only passthrough. Others: `localDatetimeToUtc()`. |
| **Due date (output)**   | Always `utcToLocal()`         | Provider-aware formatting (same pattern)                         |
| **Provider param type** | `TaskProvider`                | `Readonly<TaskProvider>`                                         |

### `tools-builder.ts` (+70/-73)

The central tool assembly file. Key changes:

- **11 new tools registered**: `get_project`, `get_current_user`, `get_task_history`, `list_agiles`, `list_sprints`, `create_sprint`, `update_sprint`, `assign_task_to_sprint`, `list_saved_queries`, `run_saved_query`, `apply_youtrack_command`
- **New registration functions**: `maybeAddPhaseFiveSprintTools()` and `maybeAddPhaseFiveQueryTools()` — both check capabilities and provider method existence
- **`get_project`** gated by `projects.read` capability + `provider.getProject` existence
- **Attachment tools** now receive `contextId` instead of `chatUserId`
- **Formatting cleanup**: multi-line `if` blocks collapsed to single lines throughout

### Cross-cutting pattern

All due-date-handling tools (`create_task`, `update_task`, `get_task`, `list_tasks`, `promote_memo`) now share the same provider-aware logic:

- **Input**: `resolveToolDueDate()` — YouTrack returns date-only, others convert local→UTC
- **Output**: `formatToolDueDate()` — YouTrack preserves `YYYY-MM-DD`, others convert UTC→local

---

## Compliance Report: papai vs MCP YouTrack Reference (`reports/mcp-youtrack/*.py`)

### Methodology

The reference (`reports/mcp-youtrack/main.py`) defines **22 MCP tools** across 7 domains. Each reference tool is mapped to papai's provider methods, tool wrappers, and capability gating.

### 1. Issues API

| #   | MCP Reference Tool                                     | papai Tool                                   | papai Provider Method           | Status                                                                                                                                                                               |
| --- | ------------------------------------------------------ | -------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `get_issue_summary(issue_id)`                          | `get_task` (returns full task incl. summary) | `getTask()`                     | **Covered** — papai returns the full task; the LLM can extract the summary. No dedicated summary-only tool, but the reference's `get_issue_summary` is just a subset of `get_issue`. |
| 2   | `get_issue(issue_id)`                                  | `get_task`                                   | `getTask()`                     | **Covered**                                                                                                                                                                          |
| 3   | `search_issues(query, offset, count)`                  | `search_tasks` + `list_tasks`                | `searchTasks()` + `listTasks()` | **Covered** — papai has both free-form search and project-scoped list with pagination. Reference's `search_issues_by_query` maps to `searchTasks`.                                   |
| 4   | `create_issue(project_id, summary, description, tags)` | `create_task`                                | `createTask()`                  | **Covered** — papai supports customFields, priority, status, dueDate, assignee beyond what the reference offers. Tags/labels are added via separate `add_task_label` tool.           |
| 5   | `update_issue(issue_id, fields, mute_notifications)`   | `update_task`                                | `updateTask()`                  | **Covered** — papai supports title, description, status, priority, dueDate, assignee, projectId, customFields. **Gap**: no `mute_notifications` param.                               |
| 6   | `delete_issue(issue_id)`                               | `delete_task`                                | `deleteTask()`                  | **Covered**                                                                                                                                                                          |

**Issues compliance: 6/6 functional, 1 minor gap** (`mute_notifications` not exposed).

### 2. Comments API

| #   | MCP Reference Tool                                                     | papai Tool       | papai Provider Method | Status                                                                 |
| --- | ---------------------------------------------------------------------- | ---------------- | --------------------- | ---------------------------------------------------------------------- |
| 7   | `get_issue_comments(issue_id, offset, count)`                          | `get_comments`   | `getComments()`       | **Covered** — papai fetches all; pagination not exposed at tool level. |
| 8   | `create_issue_comment(issue_id, text, mute_notifications)`             | `add_comment`    | `addComment()`        | **Covered** — **Gap**: no `mute_notifications`.                        |
| 9   | `update_issue_comment(issue_id, comment_id, text, mute_notifications)` | `update_comment` | `updateComment()`     | **Covered** — **Gap**: no `mute_notifications`.                        |
| 10  | `delete_issue_comment(issue_id, comment_id)`                           | `remove_comment` | `removeComment()`     | **Covered**                                                            |

**Comments compliance: 4/4 functional, `mute_notifications` gap on 2 tools.**

### 3. Tags/Labels API

| #   | MCP Reference Tool                     | papai Tool                    | papai Provider Method    | Status                                                                                                                       |
| --- | -------------------------------------- | ----------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| 11  | `get_issue_tags(issue_id)`             | `get_task` (tags in response) | `getTask()` returns tags | **Covered** — tags are included in the task response. No dedicated tag-listing tool, but the data is there.                  |
| 12  | `add_issue_tag(issue_id, tag_name)`    | `add_task_label`              | `addTaskLabel()`         | **Covered** — papai now supports `labelName` resolution (added in this branch). Reference passes name; papai resolves to ID. |
| 13  | `remove_issue_tag(issue_id, tag_name)` | `remove_task_label`           | `removeTaskLabel()`      | **Covered** — same `labelName` resolution as add.                                                                            |

**Tags compliance: 3/3.**

### 4. Attachments API

| #   | MCP Reference Tool                                 | papai Tool          | papai Provider Method | Status      |
| --- | -------------------------------------------------- | ------------------- | --------------------- | ----------- |
| 14  | `get_issue_attachments(issue_id)`                  | `list_attachments`  | `listAttachments()`   | **Covered** |
| 15  | `delete_issue_attachment(issue_id, attachment_id)` | `remove_attachment` | `deleteAttachment()`  | **Covered** |

**Note**: papai also has `upload_attachment` which the reference doesn't. **Attachments compliance: 2/2.**

### 5. Work Items API

| #   | MCP Reference Tool                                               | papai Tool    | papai Provider Method | Status      |
| --- | ---------------------------------------------------------------- | ------------- | --------------------- | ----------- |
| 16  | `get_issue_work_items(issue_id, offset, count)`                  | `list_work`   | `listWorkItems()`     | **Covered** |
| 17  | `create_issue_work_item(issue_id, duration_minutes, text, date)` | `log_work`    | `createWorkItem()`    | **Covered** |
| 18  | `delete_issue_work_item(issue_id, work_item_id)`                 | `remove_work` | `deleteWorkItem()`    | **Covered** |

**Note**: papai also has `update_work` which the reference doesn't. **Work items compliance: 3/3.**

### 6. Links/Relations API

| #   | MCP Reference Tool          | papai Tool                     | papai Provider Method     | Status                                                 |
| --- | --------------------------- | ------------------------------ | ------------------------- | ------------------------------------------------------ |
| 19  | `get_issue_links(issue_id)` | `get_task` (links in response) | `getTask()` returns links | **Covered** — links are included in the task response. |

**Note**: papai also has `add_task_relation`, `update_task_relation`, `remove_task_relation` which the reference doesn't. **Links compliance: 1/1.**

### 7. Projects API

| #   | MCP Reference Tool            | papai Tool      | papai Provider Method | Status                           |
| --- | ----------------------------- | --------------- | --------------------- | -------------------------------- |
| 20  | `get_projects(offset, count)` | `list_projects` | `listProjects()`      | **Covered**                      |
| 21  | `get_project(project_id)`     | `get_project`   | `getProject()`        | **Covered** (new in this branch) |

**Note**: papai also has `create_project`, `update_project`, `delete_project`, team management — all beyond the reference. **Projects compliance: 2/2.**

### 8. Users API

| #   | MCP Reference Tool   | papai Tool         | papai Provider Method | Status                           |
| --- | -------------------- | ------------------ | --------------------- | -------------------------------- |
| 22  | `get_current_user()` | `get_current_user` | `getCurrentUser()`    | **Covered** (new in this branch) |

**Users compliance: 1/1.**

### Beyond the Reference (papai extras not in MCP)

These are papai capabilities the reference MCP server doesn't have:

| Domain                 | papai Extras                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| **Sprints/Agiles**     | `list_agiles`, `list_sprints`, `create_sprint`, `update_sprint`, `assign_task_to_sprint` |
| **Activities/History** | `get_task_history` with category filters, date range, author filter                      |
| **Saved Queries**      | `list_saved_queries`, `run_saved_query`                                                  |
| **YouTrack Commands**  | `apply_youtrack_command` with safety confirmation gate                                   |
| **Labels CRUD**        | `list_labels`, `create_label`, `update_label`, `remove_label`                            |
| **Statuses**           | `list_statuses`, `create_status`, `update_status`, `delete_status`, `reorder_statuses`   |
| **Collaboration**      | `list_watchers`, `add/remove_watcher`, `add/remove_vote`, `set_visibility`, `find_user`  |
| **Comment Reactions**  | `add_comment_reaction`, `remove_comment_reaction`                                        |
| **Project Team**       | `list_project_team`, `add/remove_project_member`                                         |
| **Work Items**         | `update_work`                                                                            |
| **Recurring Tasks**    | Full CRUD + pause/resume/skip                                                            |
| **Memos**              | Save, search, list, archive, promote-to-task                                             |
| **Deferred Prompts**   | Full CRUD + cancel                                                                       |
| **Identity**           | `set_my_identity`, `clear_my_identity`                                                   |
| **Web Fetch**          | `web_fetch` with extraction/distillation                                                 |
| **Instructions**       | Save, list, delete per-context instructions                                              |
| **Task Count**         | `count_tasks`                                                                            |

### Summary

| Metric                            | Value                                                                                                                                     |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **MCP reference tools**           | 22                                                                                                                                        |
| **papai functional coverage**     | **22/22 (100%)**                                                                                                                          |
| **Parameter-level gaps**          | `mute_notifications` missing on `update_task`, `add_comment`, `update_comment` (cosmetic — YouTrack supports it, papai doesn't expose it) |
| **papai extras beyond reference** | ~40+ additional tools/capabilities                                                                                                        |

**Overall compliance: 100% functional parity.** The only gap is the `mute_notifications` parameter (3 tools), which is a minor omission — the underlying YouTrack API supports it but papai's tool schemas don't expose it.
