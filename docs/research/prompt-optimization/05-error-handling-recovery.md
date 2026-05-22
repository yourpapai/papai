<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# 05 — Error handling and recovery

The raw envelope is described in [`01-current-state-audit.md`](./01-current-state-audit.md) §2.4. This file evaluates it against external best practice, proposes small changes (the `recovery` discriminated union, a retry policy, and a self-correction loop), and lists every error code with the recommended `userMessage` / `agentMessage` / `recovery` triple.

## 1. What the current envelope gets right

- **Dual-audience messaging.** `userMessage` and `agentMessage` are separate. This is exactly what apxml ([10](./10-references.md) #5) and Anthropic ([10](./10-references.md) #3) recommend — agent error messages should be _different_ from the user-facing wording because their consumers differ.
- **Classification.** `errorType` (provider, llm, validation, system, web-fetch, tool-execution) and `errorCode` (task-not-found, rate-limited, etc.) form a discriminated union that is easy to switch on.
- **`retryable: boolean`.** Signals to the model whether a retry is worth attempting. This is rare to get right; today's wrapper does.
- **Interrupted case.** `errorCode: "interrupted"` with `recovered: true` carries useful state that would otherwise be lost.

These are all worth preserving.

## 2. What to add

### 2.1 `recovery` discriminated union

Free-form `agentMessage` strings are effective but not machine-readable. A small discriminated union moves the model from "read prose and decide" to "dispatch on `recovery.action`", which is more predictable and easier to evaluate.

```ts
type Recovery =
  | { action: 'retry_same_call' }
  | { action: 'retry_with_args'; args_template: Partial<TInput> }
  | { action: 'call_tool'; tool: string; args_template?: Partial<object> }
  | { action: 'ask_user'; question: string }
  | { action: 'abort'; reason: string }
```

Examples (mapped to every existing `agentMessage`):

| Error code                    | `agentMessage` today                                                         | Proposed `recovery`                                                                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `task-not-found`              | "…Search for the task or ask the user for the correct ID before retrying."   | `{ action: 'call_tool', tool: 'search_tasks', args_template: { query: '' } }`                                                             |
| `project-not-found`           | "…Call list_projects before retrying."                                       | `{ action: 'call_tool', tool: 'list_projects' }`                                                                                          |
| `label-not-found`             | "…Call list_labels before retrying."                                         | `{ action: 'call_tool', tool: 'list_labels' }`                                                                                            |
| `status-not-found`            | "…Call list_statuses and retry with one of the available names."             | `{ action: 'call_tool', tool: 'list_statuses' }`                                                                                          |
| `workflow-validation-failed`  | "…Ask the user for the missing project-specific values…"                     | `{ action: 'ask_user', question: <templated from requiredFields> }`                                                                       |
| `auth-failed`                 | "…Ask the user to verify provider credentials."                              | `{ action: 'ask_user', question: 'Your task-tracker key seems invalid. Can you update it via /config?' }`                                 |
| `rate-limited`                | "…Wait briefly before retrying."                                             | `{ action: 'retry_same_call' }` (with server-side backoff; see §4)                                                                        |
| `validation-failed` (generic) | "…The provider rejected the \"{field}\" input. Update that field and retry." | `{ action: 'retry_with_args', args_template: { [field]: null } }`                                                                         |
| `unsupported-operation`       | "…Pick a different tool or explain the limitation."                          | `{ action: 'abort', reason: 'capability_missing' }`                                                                                       |
| `invalid-response`            | "…Do not retry blindly; inspect logs."                                       | `{ action: 'abort', reason: 'upstream_anomaly' }`                                                                                         |
| `token-limit` (llm)           | "…Reduce the request size or summarize context before retrying."             | `{ action: 'abort', reason: 'context_overflow' }` — the harness handles compaction.                                                       |
| `timeout` (llm)               | "…Retrying may work if the upstream service is healthy."                     | `{ action: 'retry_same_call' }` (bounded; see §4)                                                                                         |
| `interrupted`                 | "…Re-check side effects before retrying."                                    | `{ action: 'call_tool', tool: 'get_task', args_template: { taskId } }` when the tool wrote to a task; `{ action: 'ask_user' }` otherwise. |

`recovery` lives **alongside** `agentMessage`, not instead of it. Keep the prose for models that don't dispatch on structure. (Claude does attend to both.)

### 2.2 Self-correction loop on validation errors

Today, a Zod validation failure on inputs returns a tool error; the LLM then decides whether to retry. apxml ([10](./10-references.md) #7) recommends a bounded self-correction pattern: "Your previous response {previous_llm_output} failed parsing with the error: {error_message}. Please provide the response again, strictly adhering to the requested JSON format."

For papai this is a one-liner in `wrapToolExecution`: on Zod failure, don't turn around as a normal tool result; retry the step once with an appended system note in the tool result content:

```text
[VALIDATION_RETRY_1/1] The previous arguments failed schema validation:
{zod error path + message}
Retry the tool call with corrected arguments that match the schema.
```

Cap at one retry. If the second attempt fails, return the normal `ToolFailureResult`. Most models self-correct on attempt two. ([10](./10-references.md) #7)

### 2.3 Retry policy for transient errors

Anthropic and LangChain both recommend server-side backoff rather than asking the model to retry:

- `rate-limited` (HTTP 429) — exponential backoff (1s, 2s, 4s, 8s), max 3 attempts, inside the provider wrapper. If all three fail, the envelope bubbles up as usual.
- `timeout` / `network` — same policy. `retry_same_call` recovery is only emitted if the server-side retries have been exhausted.
- **Never** retry 400/401/403 automatically. Those are user / config errors that need human action.

This matches standard REST retry practice ([10](./10-references.md) #20) and keeps the tool-call budget low.

### 2.4 Preserve `details` safely

`details?: Record<string, unknown>` is already in the envelope. Use it for:

- `field` (for validation errors)
- `taskId`, `projectId`, `commentId`, `labelName` (for not-found variants — already stored in the domain error union)
- `requiredFields: string[]` (for `workflow-validation-failed`)
- `retryAfter: number` (for rate-limited, seconds)
- `httpStatus: number` (for unclassified errors)

All useful signal for the model's decision making. Sanitize — no tokens, emails, or full error stack traces.

## 3. Error catalog — authoritative mapping

This is the canonical table the codebase should converge on. Entries marked `retryable` are automatically retried by the harness; non-retryable entries may still have `recovery.action = 'retry_same_call'` if the model can do something sensible (e.g. after asking the user for the missing field).

| `errorType`    | `errorCode`                | `retryable` | `userMessage` (example)                                                                                     | `agentMessage` (example)                                                                                     | `recovery.action`                                       |
| -------------- | -------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| provider       | task-not-found             | false       | `Task "{taskId}" was not found.`                                                                            | `Search for the task or ask the user before retrying.`                                                       | `call_tool` → `search_tasks`                            |
| provider       | project-not-found          | false       | `Project "{projectId}" was not found.`                                                                      | `Call list_projects before retrying.`                                                                        | `call_tool` → `list_projects`                           |
| provider       | workspace-not-found        | false       | `Workspace configuration error.`                                                                            | `The provider workspace is not configured correctly. Ask the user to verify provider setup before retrying.` | `ask_user`                                              |
| provider       | comment-not-found          | false       | `Comment "{commentId}" was not found.`                                                                      | `Fetch the task comments again before retrying.`                                                             | `call_tool` → `get_comments`                            |
| provider       | label-not-found            | false       | `Label "{labelName}" was not found.`                                                                        | `Call list_labels before retrying.`                                                                          | `call_tool` → `list_labels`                             |
| provider       | relation-not-found         | false       | `Relation between tasks "{taskId}" and "{relatedTaskId}" was not found.`                                    | `Re-fetch the task relations before retrying.`                                                               | `call_tool` → `get_task`                                |
| provider       | status-not-found           | false       | `Status "{statusName}" is not recognised. Available: {available}.`                                          | `Call list_statuses and retry with one of the available names.`                                              | `retry_with_args` (blank status)                        |
| provider       | auth-failed                | false       | `Failed to connect to the task tracker. Please check your API key.`                                         | `Ask the user to verify provider credentials before retrying.`                                               | `ask_user`                                              |
| provider       | rate-limited               | true        | `API rate limit reached. Please wait a moment and try again.`                                               | `Wait briefly before retrying.`                                                                              | `retry_same_call` (after server-side backoff exhausted) |
| provider       | validation-failed          | false       | `Invalid {field}: {reason}`                                                                                 | `The provider rejected the "{field}" input. Update that field and retry.`                                    | `retry_with_args`                                       |
| provider       | workflow-validation-failed | false       | `The project workflow blocked this request in project "{projectId}": {message}. Required fields: {fields}.` | `The project workflow requires fields: {fields}. Ask the user for the missing project-specific values.`      | `ask_user`                                              |
| provider       | unsupported-operation      | false       | `Operation "{operation}" is not supported by this provider.`                                                | `Pick a different tool or explain the limitation.`                                                           | `abort`                                                 |
| provider       | invalid-response           | false       | `The task tracker returned an unexpected response.`                                                         | `Do not retry blindly; inspect logs or the debug trace first.`                                               | `abort`                                                 |
| provider       | unknown                    | false       | `Task tracker API error occurred.`                                                                          | `The provider returned an unclassified error.`                                                               | `abort`                                                 |
| llm            | api-error                  | true        | `AI service error: {message}.`                                                                              | `Retry only after checking the upstream service state.`                                                      | `retry_same_call`                                       |
| llm            | rate-limited               | true        | `AI service rate limit reached.`                                                                            | `Wait briefly before retrying.`                                                                              | `retry_same_call`                                       |
| llm            | timeout                    | true        | `AI service request timed out.`                                                                             | `Retrying may work if the upstream service is healthy.`                                                      | `retry_same_call`                                       |
| llm            | token-limit                | false       | `Message is too long. Please shorten your request.`                                                         | `The prompt is too large. Harness will compact context before any retry.`                                    | `abort` (the harness handles)                           |
| validation     | zod-input                  | false       | `Invalid input: {path} — {message}.`                                                                        | `See validation_retry hint and retry with corrected args.`                                                   | `retry_with_args`                                       |
| system         | network                    | true        | `Network error contacting the provider.`                                                                    | `Server-side retries exhausted. Retrying further is unlikely to help.`                                       | `abort`                                                 |
| system         | internal                   | false       | `Unexpected internal error.`                                                                                | `Abort; this is a harness bug.`                                                                              | `abort`                                                 |
| web-fetch      | not-public                 | false       | `That URL isn't reachable as a public page.`                                                                | `Do not try to bypass — tell the user the URL must be public http(s).`                                       | `abort`                                                 |
| web-fetch      | rate-limited               | true        | `Too many web fetches; please wait a moment.`                                                               | `Wait and retry the same URL; do not switch URLs.`                                                           | `retry_same_call`                                       |
| web-fetch      | too-large                  | false       | `That page is too large to fetch.`                                                                          | `Ask the user what they want from the page; don't fetch again.`                                              | `ask_user`                                              |
| tool-execution | interrupted                | true        | `That action did not finish cleanly.`                                                                       | `Re-check side effects before retrying.`                                                                     | `call_tool` → read-side-effect tool                     |

`userMessage` strings here are the strings the adapter will surface to the end user (Telegram / Mattermost / Discord) — see [`08-ux-reply-formatting.md`](./08-ux-reply-formatting.md) for rendering rules.

## 4. Harness-level retry policy

Pseudocode (in orchestrator / tool-wrap layer):

```ts
// Inside wrapToolExecution
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    return wrapSuccess(await fn(args))
  } catch (e) {
    const classified = classify(e)
    if (!classified.retryable) return wrapFailure(classified)
    await wait(backoff(attempt)) // 1s, 2s, 4s, 8s cap
    if (attempt === 3) return wrapFailure(classified)
  }
}
```

This is independent of any LLM-level retry. Apxml ([10](./10-references.md) #7) and Medium ([10](./10-references.md) #20) are aligned: retry transient server-side, not model-side.

## 5. Anti-patterns to avoid

- **Stack traces in `agentMessage`.** They cost tokens and don't help. ([10](./10-references.md) #3)
- **Same message for both audiences.** One is human, one is agent — different grammars.
- **"Please try again" with no reason.** Always say what will change between attempts.
- **Swallowing an error into an `ok: true, data: null`.** The envelope should be explicit about failure. Silent failures break the model's ability to reason about state.
- **Echoing raw error.message from a third party.** It may contain sensitive data; it certainly contains noise (`"[AxiosError: Request failed with status code 500]"`). Classify + summarise.

## 6. Evaluation hooks

A harness test fixture should:

- For each `errorCode` in the catalog, inject the error into a tool execute and verify:
  - `userMessage` matches the template
  - `agentMessage` matches the template
  - `recovery.action` matches the expected action
  - When `retryable`, server-side retries happen at the expected cadence
- For the self-correction loop, feed a deliberately wrong input and verify the second attempt is generated and that it retries exactly once.

## 7. Concrete recommendations

- **R-05-1 (H):** extend `ToolFailureResult` with a `recovery: Recovery` field; populate for every error code per §3.
- **R-05-2 (H):** implement server-side retry with exponential backoff for `rate-limited`, `timeout`, and `network` errors in the wrapToolExecution layer.
- **R-05-3 (M):** implement the one-shot Zod validation retry loop (§2.2) in `src/tools/wrap-tool-execution.ts`.
- **R-05-4 (M):** sanitise error details — ensure `details` never contains raw tokens, stack traces, or PII.
- **R-05-5 (M):** merge the duplicated error-code tables from `src/errors.ts` and `src/error-analysis.ts` into a single source of truth.
- **R-05-6 (L):** add a harness test per error code asserting the triple (userMessage, agentMessage, recovery).
