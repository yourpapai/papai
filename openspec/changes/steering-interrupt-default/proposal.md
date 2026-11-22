# Proposal

## Why

A mid-run correction currently waits for the current step's tool calls before the model sees it, so a task can be closed or a comment posted even though the user corrected the instruction while the model was still thinking. The AI SDK can cancel that in-flight call and redo the step with the message, but papai never asks it to. Commands would fix the timing at the cost of a grammar; making interrupt the default fixes it without a new interaction.

## What Changes

- Every qualifying mid-run message requests an interrupt while a model call is in flight: the SDK cancels the call and redoes the step with the text, so the message is considered before the step's tools act.
- The interrupt request is bounded to a fixed three per run (counted at request time). At the cap, while the run is stopping, or when tools are already running, the message falls back to today's next-boundary delivery. Nothing becomes an error.
- `RunControl` gains an in-memory per-run interrupt count; no persistence, config key, or settings-UI surface.
- The system prompt tells the model that mid-run text may be a correction, an addition, or a request to do something after the current task; an after-task request finishes the current task first and is never dropped.
- No new commands. The command surface, acks, analytics facts, routing, and undelivered-text replay stay unchanged.
- This replaces the two deferred command designs (`/interrupt`, `/after`) and the SDK `queue()` option with one ambient rule.

## Capabilities

### New Capabilities

None. `mid-run-steering` already owns this behavior; the change extends it.

### Modified Capabilities

- `mid-run-steering`: the delivery requirement changes from "at the next tool-step boundary" to "as early as the run can act on it" — interrupt the in-flight model call when the budget allows, otherwise the next boundary. Adds a per-run interrupt bound and the rule that after-task text is steering text, not a separate queue or turn. Base spec: `openspec/specs/mid-run-steering/spec.md`; implementing module: `src/run-control/`.

## Impact

- Code: `src/run-control/{types,registry,steering}.ts`, `src/i18n/locales/{en,ru}-system-prompt.ts`; call sites in `src/bot-message-handler.ts` and `src/message-edit/handle.ts` are unchanged.
- Platforms: Telegram, Mattermost, Discord, and Kontur Talk share the run registry, so behavior is uniform; commands still bypass steering.
- Scope model: steering state and the interrupt count stay **thread-isolated** by `storageContextId`. No config-context, group-shared, per-user, task-instance, or platform-instance state changes. Guests follow the existing steering authorization.
- Docs: `docs/architecture/behaviors.md` (`behavior:mid-run-control`) and `docs/architecture/overview.md`.
- No DB migration, new dependency, environment variable, or settings-UI change.

## Non-goals

- `/interrupt`, `/after`, and any other new command or message prefix.
- SDK `queue()` and same-run task chaining; no separate after-task queue, turn, or reply.
- Posting intermediate task answers mid-run.
- Persisting delivered steering text in conversation history (a pre-existing gap; separate change).
- A `delivery` property on `turn_steered` or any new analytics fact.
- Changing `/stop`, force-abort, W1 edit routing, tool approvals, proactive runs, or thread isolation.
