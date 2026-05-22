<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# 03 — Tool design, descriptions, and input schemas

Focus: every string that the model sees for each tool — the `description:` passed to `tool()`, the top-level `.describe()` on each input field, and the Zod shape itself. The raw audit of today's tool layer is in [`01-current-state-audit.md`](./01-current-state-audit.md) §2.

## 1. Principles (sourced)

1. **Tools are an interface, designed for an LLM colleague** — "Consider the context that you might implicitly bring—specialized query formats, definitions of niche terminology, relationships between underlying resources—and make it explicit." Anthropic, _Writing effective tools for agents_. ([10](./10-references.md) #3)
2. **Use unambiguous parameter names.** "Instead of a parameter named `user`, try a parameter named `user_id`." ([10](./10-references.md) #3)
3. **Action-oriented verb-first descriptions** — "Fetches…", "Calculates…", "Creates…". ([10](./10-references.md) #4)
4. **Each description should say: what the tool does, when to use it, what it returns.** ([10](./10-references.md) #5)
5. **Consolidate.** Build tools that cover a whole sub-task (e.g. `schedule_event`) rather than exposing a grab-bag of API endpoints that the agent must chain. ([10](./10-references.md) #3)
6. **Metadata at the end of the Zod chain.** "Due to Zod's immutability, metadata is only included in the JSON schema output if `.meta()` or `.describe()` is the last method in the chain." ([10](./10-references.md) #5)
7. **Keep schemas flat (2-3 levels max); flat schemas reduce structural ambiguity for the model.** ([10](./10-references.md) #6, #17)
8. **Put reasoning / hint fields before answer fields** when the tool asks the model to supply them — LLMs generate left-to-right. ([10](./10-references.md) #6)
9. **Prefer natural-language identifiers over uuids in both inputs and outputs.** ([10](./10-references.md) #3)

## 2. Audit findings (papai-specific)

### T-01 (H) Descriptions vary wildly in informativeness

Compare these extracted descriptions (verbatim):

- `add_comment`: "Add a comment to a task." — too terse; says nothing about when to use it versus e.g. `add_task_reaction`, nothing about output shape, nothing about markdown support.
- `create_task`: "Create a new task. Call list_projects first to get a valid projectId." — actionable. Good model.
- `get_task`: "Fetch complete details of a single task including description, status, priority, assignee, due date, and relations. For a full picture including comments, also call get_comments with the same task ID." — explicitly cross-references another tool, which is exactly the pattern Anthropic recommends (workflow steering inside the description). Best in class.
- `save_memo`: "Save a personal note or observation. Use when the user is recording information, a thought, a link, or a fact — not when tracking work to be done." — includes a negative disambiguator against `create_task`. Good.
- `list_tasks`: "List tasks in a project. Optional filters match the upstream @kaneo/mcp list_tasks tool …" — leaks implementation detail. The LLM doesn't need to know about `@kaneo/mcp`; the filter set should be described in its own terms.

**Recommendation:** establish a description template and enforce it in a lint plugin.

### T-02 (H) `create_deferred_prompt` description is way under-specified

The current description:

> "Create a scheduled task or monitoring alert. Provide either a schedule (time-based) or a condition (event-based), not both. Always classify the execution mode based on what the prompt needs at fire time."

…makes the model reach for the system prompt's large RECURRING/DEFERRED prose blocks to figure out how to populate `schedule.cron`, `schedule.fire_at`, `condition.{field,op,value}`, etc. That prose should live here in the description (or better, in the fields' `.describe()` strings). Then the system prompt can drop its huge DEFERRED section.

**Target description** (illustrative):

```text
Schedule a future action for papai to run on its own. Provide either:
  • a `schedule` (one-time fire_at or recurring cron), OR
  • a `condition` (fires when a tracked task field changes), but not both.

Use this for: daily briefings, deadline reminders, "nag me if X isn't done by Friday",
or anything the user asks to happen later. Put WHAT-TO-DO in `prompt`; the
scheduler handles WHEN.

Returns { id, humanSchedule, nextRunLocal } on success and steers with
next_actions.hint. If the user describes both a schedule and a condition,
ask them to pick one.
```

### T-03 (M) Field-level `.describe()` is often missing "for … provider"

The field `customFields` on `create_task` / `update_task` has this description:

> "For YouTrack, use this only for simple string/text project fields required by YouTrack workflows, not arbitrary field types. Use dedicated fields for status, priority, assignee, and due date."

This is correct and useful, but it is unconditional — shown to the model even when the active provider is Kaneo, where `customFields` does not apply. Recommendation: strip provider-specific notes from `.describe()` and move them to a runtime-conditional `.describe()` (or omit the field entirely when the provider doesn't support it).

### T-04 (M) Enum values leak UI slugs instead of natural language

`status: z.string().optional().describe("Status column slug (e.g. 'to-do', 'in-progress', 'done')")` — the LLM is told to supply a slug. Anthropic explicitly prefers natural-language over cryptic identifiers: "Agents also tend to grapple with natural language names … significantly more successfully than they do with cryptic identifiers." ([10](./10-references.md) #3)

**Recommendation:** let `status` accept either a slug or a human name; resolve to slug inside the tool using the provider's status list. The existing list_columns/list_statuses tools already produce the mapping.

### T-05 (M) Confidence field description reveals the threshold

```text
"… The action will be blocked and a confirmation requested if this is below 0.85."
```

Advertising the threshold inside the prompt is an injection/exploit surface (a model that has been jailbroken will be told exactly where to set the dial). The threshold is a server-side policy. The description should be:

```text
"Your confidence (0–1) that the user explicitly wants this destructive
action. Set 1.0 after the user has confirmed; 0.9 for a direct command;
≤0.7 when the intent is indirect. Low values will be refused by the tool."
```

### T-06 (M) Recurring-task fields duplicate the cron narrative

`create_recurring_task` has detailed `.describe()` on `schedule.frequency`, `days_of_week`, `day_of_month`, `time` — which is good — but the system prompt **also** describes the same semantics in RECURRING TASKS. Move the narrative fully into the field descriptions, keep a one-line pointer in the prompt: "To set up repeating tasks, use `create_recurring_task`."

### T-07 (M) Some outputs aren't wrapped in an envelope; others are

- `list_memos` returns `{ memos: [...] }`.
- `search_tasks` returns raw `TaskSearchResult[]`.
- `list_tasks` returns raw `TaskListItem[]`.
- `create_task` returns a raw `Task`.

Arrays returned without an envelope mean the model cannot easily add metadata (truncation flags, pagination hints, next_actions) without breaking consumers. Section 5 below and [`04-tool-output-steering.md`](./04-tool-output-steering.md) specify a unified envelope.

### T-08 (L) Missing MCP-style annotations

Vercel AI SDK tools don't carry MCP's `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`, but the concepts still apply inside the harness. Annotating each tool and using the annotations to (a) gate UI affordances on the dashboard, (b) refuse destructive tools during proactive mode, (c) allow-list "read-only" tools for unauthenticated contexts is a small-cost, high-value investment. ([10](./10-references.md) #18)

### T-09 (L) Too many small tools for recurring lifecycle

Today: `create_recurring_task`, `list_recurring_tasks`, `update_recurring_task`, `pause_recurring_task`, `resume_recurring_task`, `skip_recurring_task`, `delete_recurring_task` — seven tools for one concept. That is within Anthropic's ceiling for agent tool sets but at the cost of prompt real estate. A consolidation: one `manage_recurring_task({ id, action, …args })` tool where `action ∈ {pause, resume, skip, delete}` plus separate `create_` and `update_`. Seven rows in the function list become three.

### T-10 (L) No `response_format` escape hatch for verbose outputs

Anthropic specifically recommends a `response_format: "concise" | "detailed"` parameter on tools that can produce large outputs, so the agent can pull more detail only when needed. `get_task`, `list_tasks`, and `web_fetch` would all benefit. ([10](./10-references.md) #3)

## 3. Description template

Every tool description should have this shape, separated by newlines:

```text
<what>. <when-to-use>. <when-not-to-use>. <returns>. <next-actions-hint>.
```

Maximum ~90 words. Examples:

```text
create_task
Create a new task in the connected tracker. Use when the user asks to add,
log, or make a new to-do item. Do NOT use for personal notes (use
save_memo). On success returns the created task plus next_actions.
If projectId is unknown, call list_projects first.
```

```text
delete_task
Permanently delete a task. Destructive — call only with the user's clear
consent. Pass the user-visible title in `label` so confirmation prompts
can name it. Returns { ok: true, id } on success, or
{ ok: false, confirmation_required, message } when consent is unclear.
After a confirmation round-trip, re-call with confidence = 1.0.
```

```text
web_fetch
Fetch a public http(s) URL and return an extracted summary plus a bounded
excerpt. Use when the user shares or points back to a URL and you need
the content to answer. Do NOT use for internal intranet URLs or for
content the user wants you to store — they must explicitly ask to save.
Returns { ok, title, summary, excerpt, truncated, next_actions }.
```

## 4. Input-schema checklist

For each input field, verify:

- [ ] `.describe()` is the **last** call in the chain.
- [ ] Name ends with the entity type when useful (`taskId`, `projectId`, not `task`, `project`).
- [ ] If the field accepts an enum, it is a Zod `z.enum(...)` not `z.string()`.
- [ ] If the field accepts natural language, the description gives two concrete examples separated by `/` (e.g. `"priority label — 'high' / 'critical'"`).
- [ ] No mention of internal architecture (`@kaneo/mcp`, `youtrackFetch`), HTTP codes, or internal table names.
- [ ] If the field is destructive or low-trust, it is documented as such.
- [ ] Provider-specific descriptions are stripped when the active provider doesn't support the field (runtime-gated).

Run a lint rule (as a custom oxlint plugin) that scans `src/tools/*.ts` and fails if a `.describe()` call is followed by any other Zod method on the same chain.

## 5. Output envelope — aligned with the error envelope

Today a tool returns _either_ a raw domain object _or_ a `ToolFailureResult`. That asymmetry is fine when the consumer is a model that already knows about tool errors, but it leaves the happy-path with no room for steering metadata. Proposed unified envelope (same on success and failure):

```ts
// Success
{
  ok: true,
  data: TData,
  next_actions?: {
    hint?: string                     // ≤30 words, LLM-facing
    suggested_tools?: ReadonlyArray<{
      tool: string
      why: string
    }>
    suggested_reply?: string          // starter phrasing for the assistant turn
  },
  meta?: {
    truncated?: boolean
    total?: number
    pagination?: { page, limit, hasMore }
  }
}

// Failure — existing ToolFailureResult, wrapped
{
  ok: false,
  error: { code, type, retryable, userMessage, agentMessage, details },
  recovery?: {
    action: 'call_tool' | 'ask_user' | 'abort'
    tool?: string
    args_template?: Partial<TInput>
    question?: string
  }
}
```

Why both `next_actions.hint` and `recovery`:

- `next_actions` is the **success-path** steering (Anthropic: "you can directly encourage agents to pursue more token-efficient strategies"). ([10](./10-references.md) #3)
- `recovery` is the **error-path** steering — discriminated union that names the remediation (call another tool, ask the user, or give up). See [`05-error-handling-recovery.md`](./05-error-handling-recovery.md) §3.

The envelope change is non-breaking if introduced behind a feature flag on the wrapper — existing code that returns raw objects is wrapped into `{ ok: true, data }` at the `wrapToolExecution` layer.

## 6. Concrete recommendations

- **R-03-1 (H):** introduce a standard description template and rewrite all 60+ tool descriptions to match.
- **R-03-2 (H):** introduce the `{ ok, data, next_actions?, meta? } | { ok, error, recovery? }` envelope in `src/tools/wrap-tool-execution.ts`; keep a shim mode for the first release.
- **R-03-3 (M):** accept natural-language status/priority in `create_task` / `update_task` / `list_tasks`, resolve inside the tool using existing list\_\* data.
- **R-03-4 (M):** move per-provider bullet points out of field `.describe()` and into a runtime-gated description builder.
- **R-03-5 (M):** drop the threshold number from the `confidence` description.
- **R-03-6 (M):** move RECURRING / DEFERRED narrative from the system prompt into the tools' own descriptions.
- **R-03-7 (L):** consolidate the 4 recurring-lifecycle tools into one `manage_recurring_task` action-based tool.
- **R-03-8 (L):** add `response_format: "concise" | "detailed"` to `get_task`, `list_tasks`, `web_fetch`.
- **R-03-9 (L):** tag each tool with MCP-style annotations (readOnly, destructive, idempotent, openWorld) as TypeScript metadata, and use them both in docs and in runtime gating.

See [`04-tool-output-steering.md`](./04-tool-output-steering.md) for the detailed design of `next_actions`, and [`05-error-handling-recovery.md`](./05-error-handling-recovery.md) for `recovery`.
