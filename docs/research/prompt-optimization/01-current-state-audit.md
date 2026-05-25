<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# 01 — Current-state audit (verbatim)

This file is a reference snapshot of what the bot actually sends to the LLM today. Nothing here is a proposal. All other files in this report cite back to paths and line ranges listed below.

## 1. System-prompt assembly

Built by `buildSystemPrompt(provider, contextId)` in `src/system-prompt.ts:84-87`, called from `src/llm-orchestrator.ts:126`:

```text
[CUSTOM_INSTRUCTIONS_BLOCK] + BASE_PROMPT + [\n\n + PROVIDER_ADDENDUM]
```

### 1.1 `BASE_PROMPT` (src/system-prompt.ts:37-82)

```text
You are papai, a personal assistant that helps the user manage their tasks.

When the user asks you to do something, figure out which tool(s) to call and execute them autonomously — fetch any missing context (projects, columns, task details) with additional tool calls before acting, without asking the user.

TIME — For any date or time queries, use the get_current_time tool to get the current date and time before performing calculations.

DUE DATES — When the user mentions a due date or time:
- Express dates as { date: "YYYY-MM-DD" } and times as { time: "HH:MM" } in 24-hour local time — the tool handles UTC conversion.
- "tomorrow at 5pm" → dueDate: { date: "YYYY-MM-DD", time: "17:00" } (tomorrow's date).
- "end of day" → dueDate: { date: "YYYY-MM-DD", time: "23:59" }.
- "next Monday" → dueDate: { date: "YYYY-MM-DD" } (date only, no time field).

RECURRING TASKS — The user can set up tasks that repeat automatically:
- "cron" trigger: Use create_recurring_task with triggerType "cron" and a schedule object …
- "on_complete" trigger: creates the next task only after the current one is marked done. …
- Use list_recurring_tasks to show all recurring definitions. Use pause/resume/skip/delete tools to manage them.
- When resuming, set createMissed=true to retroactively create tasks for missed cycles during the pause.
- When the user says "stop" or "cancel" a recurring task, use delete_recurring_task.
- When they say "pause", use pause_recurring_task. When "skip the next one", use skip_recurring_task.

DEFERRED PROMPTS — The user can set up automated tasks and alerts: …
- SCHEDULED PROMPTS: Use create_deferred_prompt with a schedule to set up one-time or recurring LLM tasks.
- ALERTS: Use create_deferred_prompt with a condition to monitor task changes.
- Use list_deferred_prompts to show active prompts/alerts. Use cancel_deferred_prompt to cancel one.
- For daily briefings, create a recurring scheduled prompt (e.g., cron "0 9 * * *" at 9am).
- PROMPT CONTENT: When creating a deferred prompt, the prompt field should describe the deliverable action, not the scheduling. …

PROACTIVE MODE — When you receive a [PROACTIVE EXECUTION] system message at the end of the conversation, a deferred prompt has fired. …

WEB FETCH — When the user shares or refers back to a public URL and you need the page contents, call web_fetch. …
```

### 1.2 `STATIC_RULES` (src/system-prompt.ts:4-35) — appended to `BASE_PROMPT`

```text
WORKFLOW:
1. Understand the user's intent from natural language.
2. Gather context if needed (e.g. call list_projects to resolve a project name, call list_columns before setting a task status).
3. Call the appropriate tool(s) to fulfil the request.
4. Reply with a concise confirmation.

AMBIGUITY — When the user's phrasing implies a single target …

DESTRUCTIVE ACTIONS — delete_task, delete_project, delete_column, remove_label:
These tools require a confidence field (0–1) reflecting how explicitly the user requested the action.
- Set 1.0 when the user has already confirmed (e.g. replied "yes").
- Set 0.9 for a direct, unambiguous command ("archive the Auth project").
- Set ≤0.7 when the intent is indirect or inferred.
If the tool returns { status: "confirmation_required", message: "..." }, send the message to the user as a natural question and wait for their reply before retrying the tool call with confidence 1.0.

RELATION TYPES — map user language to the correct type when calling add_task_relation / update_task_relation:
- "depends on" / "blocked by" / "waiting on" → blocked_by
- "blocks" / "is blocking" → blocks
- "duplicate of" / "same as" / "copy of" / "identical to" → duplicate
- "child of" / "subtask of" / "part of" → parent
- "related to" / "linked to" / anything else → related

MEMOS — Personal notes and observations: …

OUTPUT RULES:
- When referencing tasks or projects, format them as Markdown links: [Task title](url). Never output raw IDs.
- Keep replies short and friendly. Don't use tables.
- When the user expresses a persistent preference ("always", "never", "from now on"), call save_instruction. …
```

### 1.3 Custom-instructions block (src/instructions.ts:79-82)

When the user has saved preferences, the following is prepended to the system prompt:

```text
=== Custom instructions ===
- {instruction 1}
- {instruction 2}
...
```

Caps: ≤20 instructions per context, ≤500 characters each, Jaccard duplicate-threshold 0.8 (`src/instructions.ts:8-10`).

### 1.4 Provider addendums

**Kaneo** (`src/providers/kaneo/index.ts`):

```text
IMPORTANT — Task status vs kanban columns:
- Columns define the board layout ("Todo", "In Progress", "Done"); task status is the column the task currently sits in.
- To move a task, update its status to the target column name. To change the board structure, use the column management tools.
- Always call list_columns before updating a task status to make sure the column exists.
```

**YouTrack** (`src/providers/youtrack/prompt-addendum.ts:1-17`):

```text
IMPORTANT — YouTrack-specific behaviors:
- Issues use "State" as a custom field (e.g. "Open", "In Progress", "Fixed", "Verified").
- State transitions may be governed by workflows. If a state update fails, try a different valid state.
- Issue IDs are human-readable like "PROJ-123". Always use these readable IDs.
- Tags are used as labels. To add/remove tags, use the label tools.
- Work items track time spent on issues with duration (e.g., "2h 30m", "90m").
- Sprints are supported via agile boards and can be assigned to issues.
- Watchers can be added to issues to receive notifications.
- Votes indicate user support for an issue.
- Visibility controls who can see issues and comments (public, specific users, or groups).
- Teams can be assigned to projects and sprints.
- Reactions (emoji) can be added to comments.
- Saved queries allow storing and reusing search filters.
- Activity history tracks changes to issues, comments, and custom fields.
- Use `apply_youtrack_command` only when the user explicitly asks for a YouTrack command-style operation or when structured tools cannot express the requested field mutation safely.
```

### 1.5 Memory-context injection (src/memory.ts:262-282, src/conversation.ts:29-34)

Prepended as a **system message** to the `messages` array (not to the system prompt):

```text
=== Memory context ===
Summary: {compacted conversation summary, ≤200 words}

Recently accessed entities:
- {identifier}: "{title}" — last seen YYYY-MM-DD
- …
```

Memory summary is rebuilt by the `small_model` when history exceeds 100 messages using `TRIM_PROMPT` (src/memory.ts:~118-166):

```text
You are a conversation memory manager. The following conversation history has grown too long ({TOTAL} messages).

Your task:
1. Select between 50 and 100 message indices (0-based) to retain verbatim. Choose fewer (~50) when many threads are resolved and the history is repetitive. Choose more (~100) when conversations are active and many topics are still open. Prefer messages about active unresolved tasks and projects, recent decisions, ongoing threads, and stated preferences. Drop messages about completed tasks, resolved clarifications, and abandoned threads.
2. Write an updated summary (max 200 words) for all messages NOT retained. Incorporate the previous summary. Preserve: task IDs and numbers, project names, decisions, priorities, preferences.

Previous summary:
{PREVIOUS_SUMMARY}

Conversation (index: [role] content):
{MESSAGES}

Return ONLY a raw JSON object (no markdown, no code fences) with this exact structure:
{"keep_indices": [<list of integer indices>], "summary": "<summary text>"}
```

### 1.6 Proactive-mode prompt (src/deferred-prompts/proactive-llm.ts:93-102)

Replaces the base prompt entirely when a deferred prompt fires:

```text
[PROACTIVE EXECUTION]
Trigger type: {scheduled|alert}

A deferred prompt has fired. Deliver the result warmly and conversationally.
Do not mention scheduling, triggers, or system events.
Do not create new deferred prompts.
```

The stored user-supplied prompt is injected as a user message wrapped with delimiters:

```text
===DEFERRED_TASK===
{prompt_content}
===END_DEFERRED_TASK===
```

Optional metadata messages injected as system messages before the deferred task:

```text
[DELIVERY BRIEF]
{delivery_brief_text}

[CONTEXT FROM CREATION TIME]
{context_snapshot_text}
```

## 2. Tool layer

### 2.1 Assembly flow (src/tools/index.ts:31-41, src/tools/tools-builder.ts:259-297)

```text
makeTools(provider, { storageContextId, chatUserId, mode, contextType, username })
  → buildTools(...) — capability-gated registration
  → wrapToolSet(...) — each execute() wrapped with buildToolFailureResult on throw
```

Core (always registered): `create_task`, `update_task`, `search_tasks`, `list_tasks`, `get_task`, `get_current_time`.

Capability-gated tools are added only if the active provider declares the matching `TaskCapability` (e.g. `tasks.delete`, `comments.reactions`, `queries.saved`). The same gating applies to context (DM vs group) and mode (normal vs proactive). Identity tools are group-only. `create_deferred_prompt` is normal-mode-only.

### 2.2 Tool descriptions (LLM-facing) — verbatim

From `src/tools/*`:

- `create_task`: "Create a new task. Call list_projects first to get a valid projectId."
- `update_task`: "Update an existing task's status, priority, assignee, due date, title, description, or project."
- `search_tasks`: "Search for tasks by keyword. Use this when the user asks about existing tasks."
- `list_tasks`: "List tasks in a project. Optional filters match the upstream @kaneo/mcp list_tasks tool (status, priority, assignee, pagination, sort, due-date range)."
- `get_task`: "Fetch complete details of a single task including description, status, priority, assignee, due date, and relations. For a full picture including comments, also call get_comments with the same task ID."
- `delete_task`: "Delete a task permanently. This is a destructive action that requires confirmation."
- `save_memo`: "Save a personal note or observation. Use when the user is recording information, a thought, a link, or a fact — not when tracking work to be done."
- `create_deferred_prompt`: "Create a scheduled task or monitoring alert. Provide either a schedule (time-based) or a condition (event-based), not both. Always classify the execution mode based on what the prompt needs at fire time."
- `web_fetch`: "Fetch a public URL and return a bounded summary and excerpt for answering questions or for later memo/task creation when the user explicitly asks."
- `list_work`: "List all work items (time tracking entries) logged on a task."
- `add_comment`: "Add a comment to a task."
- `add_task_relation`: "Create a directed relation between two tasks (e.g. one blocks another, or marks a duplicate)."
- `add_vote`: "Add your vote to a task to signal support or priority."
- `add_watcher`: "Add a watcher to a task so the specified user is notified about future updates."
- `list_projects`: "List all available projects. Call this to get project IDs before creating or searching tasks."
- `get_current_time`: "Get the current date and time. Use this tool to answer questions about the current date, time, or to determine relative dates like \"tomorrow\" or \"next Monday\"."
- `list_memos`: "List personal notes, newest first. Use to show recent notes or browse archived ones."
- `create_recurring_task`: "Set up a recurring task that is automatically created on a schedule (cron) or after completion. Call list_projects first."
- `update_recurring_task`: "Update a recurring task definition (title, description, priority, assignee, labels, schedule, catch-up setting)."
- `set_my_identity`: "Set or correct the user's task tracker identity. Use when user says things like 'I'm jsmith', 'My login is john.smith', or 'Link me to user jsmith'."

### 2.3 Confidence-gated destructive tools (src/tools/confirmation-gate.ts)

Shared field:

```text
confidence: number ∈ [0,1]
  "Your confidence (0–1) that the user explicitly wants this destructive action.
   Set 1.0 when the user has already confirmed.
   Set 0.9 for a direct unambiguous command.
   Set ≤0.7 when intent is indirect or inferred.
   The action will be blocked and a confirmation requested if this is below 0.85."
```

When confidence < 0.85 the tool returns, without executing:

```json
{
  "status": "confirmation_required",
  "message": "<action>? This action is irreversible — please confirm."
}
```

Tools using this pattern: `delete_task`, `delete_recurring_task`, `delete_status`, `delete_project`, `delete_column`, `remove_label`.

### 2.4 Tool-failure envelope (src/tool-failure.ts:64-96)

When a wrapped tool throws, the orchestrator returns to the LLM:

```ts
{
  success: false,
  error: string,           // raw message
  toolName: string,
  toolCallId: string,
  timestamp: string,       // ISO
  errorType: 'provider' | 'llm' | 'validation' | 'system' | 'web-fetch' | 'tool-execution',
  errorCode: string,       // e.g. 'task-not-found', 'rate-limited', 'unknown'
  userMessage: string,     // human-readable
  agentMessage: string,    // LLM-guiding
  retryable: boolean,
  recovered?: boolean,
  details?: Record<string, unknown>
}
```

`agentMessage` examples (from `src/error-analysis.ts`):

- `task-not-found` → "The referenced task does not exist. Search for the task or ask the user for the correct ID before retrying."
- `project-not-found` → "The project ID is invalid. Call list_projects before retrying."
- `workflow-validation-failed` → "The project workflow requires fields: {fields}. Ask the user for the missing project-specific values and only retry with supported inputs."
- `auth-failed` → "Authentication failed. Ask the user to verify provider credentials before retrying."
- `rate-limited` → "The provider rate limited the request. Wait briefly before retrying."
- `token-limit` → "The prompt is too large. Reduce the request size or summarize context before retrying."
- `unknown` → "The provider returned an unclassified error. Inspect logs or the debug trace before retrying."

`userMessage` examples (from `src/errors.ts:72-150`):

- `task-not-found` → `Task "{taskId}" was not found. Please check the task ID and try again.`
- `rate-limited` → `API rate limit reached. Please wait a moment and try again.`
- `workflow-validation-failed` → `The project workflow blocked this request in project "{projectId}": {message}. Required fields: {fields}.`

Interrupted tool result (src/tool-failure.ts:98-112):

```json
{
  "success": false,
  "error": "Tool execution incomplete or interrupted",
  "errorType": "tool-execution",
  "errorCode": "interrupted",
  "userMessage": "That action did not finish cleanly.",
  "agentMessage": "The tool call was interrupted before a result was recorded. Re-check side effects before retrying.",
  "retryable": true,
  "recovered": true
}
```

### 2.5 Output shapes (happy path)

- Task operations return the `Task` domain type (`id`, `title`, `description?`, `status?`, `priority?`, `assignee?`, `dueDate?`, `createdAt?`, `projectId?`, `url`, `labels?`, `relations?`, `number?`, `reporter?`, `updater?`, `votes?`, `watchers?`, `commentsCount?`, `resolved?`, `attachments?`, `customFields?`, `visibility?`, `parent?`, `subtasks?`).
- `search_tasks` / `list_tasks` return raw arrays of normalized items (not wrapped).
- `list_memos` wraps: `{ memos: [...] }`.
- `save_memo` returns `{ id, content, tags, createdAt }`.
- `create_recurring_task` returns `{ id, title, projectId, triggerType, schedule, nextRun, enabled }`.
- `get_current_time` returns `{ datetime, timezone, formatted }`.
- `set_my_identity` returns `{ status: 'success'|'error', message, identity? }`.

### 2.6 Capability flags (summary)

**Kaneo** (`src/providers/kaneo/constants.ts:3-30`): tasks.delete, tasks.relations, projects.{read,list,create,update,delete}, comments.{read,create,update,delete}, labels.{list,create,update,delete,assign}, statuses.{list,create,update,delete,reorder}.

**YouTrack** (`src/providers/youtrack/constants.ts:80-113+`): all of the above plus tasks.{count,watchers,votes,visibility,commands}, projects.team, comments.reactions, attachments.{list,upload,delete}, workItems.{list,create,update,delete}, agiles.list, sprints.{list,create,update,assign}, activities.read, queries.saved.

The tool set the LLM actually sees is the intersection of `Capability` × `contextType` × `mode` plus the always-on core. The system prompt does not reflect this intersection; it describes everything.

## 3. Orchestration (src/llm-orchestrator.ts)

High level (summarised — this file is not the focus of this audit):

```text
processMessage(chatMessage)
  → callLlm()
    → checkRequiredConfig()
    → buildProviderForUser()                  // selects Kaneo | YouTrack
    → getOrCreateTools()                      // wrapped tool set
    → buildMessagesWithMemory()               // [memory-context] + [history]
    → invokeModel()
        generateText({
          system: buildSystemPrompt(provider, contextId),
          messages: [...memory, ...history],
          tools,
          experimental_onToolCallFinish: handleToolCallFinish()  // → buildToolFailureResult on error
        })
```

No `prepareStep`, no `stopWhen` other than the default, no small-model routing, no retry loop on tool validation errors beyond what the model does on its own.

## 4. What the user sees on Telegram/Mattermost/Discord

Reply is whatever the last assistant turn contains, passed to the active chat adapter's `ReplyFn`. The prompt tells the model: "format as Markdown links: [Task title](url). Never output raw IDs. Keep replies short and friendly. Don't use tables." There is no platform-aware post-processor for Telegram MarkdownV2 escape rules, Mattermost MFM, or Discord markdown.

---

This file is reference-only. For flaw analysis, see [`02-system-prompt-flaws.md`](./02-system-prompt-flaws.md) and subsequent files.
