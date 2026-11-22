# Design

## Context

See `proposal.md` — Why. The current path:

- `runTurn` (`src/llm-orchestrator.ts`) begins a `RunControl` keyed by `storageContextId` and creates one SDK steering handle per run (`createSdkSteering`, `src/run-control/steering.ts:11`).
- `callGenerateText` passes that handle as `experimental_steering` and sets `steeringStarted` immediately before the SDK call (`src/llm-orchestrator-invoke.ts:116,127`).
- `requestSteer` (`src/run-control/steering.ts:18`) calls `run.steering.steer(text)` with no options. Every non-`delivered` outcome becomes a leftover; `settleSteering` awaits the outcomes and `replayLeftoverSteerAsFreshTurn` replays them as one fresh turn.
- Both mid-run call sites — the plain message path (`steerActiveRun`, `src/bot-message-handler.ts:202`) and the W1 edit path (`src/message-edit/handle.ts:183`) — already go through `requestSteer`.

Constraints from the pinned SDK (`ai` 7.0.179):

- `steer(text, { interrupt: true })` cancels the in-flight model call when it has not produced output yet, then makes the same step again with the message. Running tools are never interrupted. The step is not counted again, so stop conditions do not limit redos. A cancelled call may still be billed and is excluded from usage.
- For papai's non-streaming `generateText`, the SDK's "no output yet" window is effectively the whole in-flight call: an interrupt during a model call cancels it unconditionally.
- A pending steer already forces another step after a final answer, so a wrong *final answer* is usually not posted. The real loss is the current step's tool calls running before the boundary steer is seen.

## Goals / Non-Goals

**Goals:**

- Deliver mid-run text before the current step's tools act whenever the SDK can cancel that step.
- Keep the interaction grammar-free: one message, no mode to select, no command to discover.
- Bound the number of cancelled model calls per run so billing stays predictable.
- Preserve routing, acknowledgement, analytics, leftover replay, and thread isolation unchanged.

**Non-Goals:**

- `/interrupt`, `/after`, message prefixes, or any new command.
- SDK `queue()`, a separate after-task queue/turn, or intermediate task-answer replies.
- Time-window heuristics ("interrupt only if the call is young"); they need a call-start signal and make the behavior inconsistent to the user.
- Persisting delivered steering text in history, or a new analytics delivery property. Both are follow-ups.
- Per-user, per-group, or configurable budgets; the cap is a fixed constant like `AGENT_MAX_STEPS`.

## Decisions

### D1: Interrupt is the default for every qualifying mid-run message

`requestSteer` passes `{ interrupt: true }` whenever the run's interrupt budget allows and no graceful stop is requested. It does not need to know whether a model call is currently in flight: the SDK degrades an interrupt requested while tools run, while the handle is unstarted, or after the handle has ended into ordinary boundary delivery or a not-delivered outcome. That keeps the rule in one place and avoids new phase state.

Why: the human sends one thing and the bot does the sensible thing with it. A command would make the timing guarantee explicit but add a grammar; edits-only interrupt would leave typed corrections able to miss the current step's tool calls.

Alternatives considered: `/interrupt` command (rejected: grammar and discovery cost); W1 edits only (rejected: typed corrections are the common case); all messages without a cap (rejected: unbounded cancelled-call billing); time-window heuristic (rejected: inconsistent, and `generateText` exposes no output-progress signal).

### D2: A fixed per-run budget, counted at request time

`RunControl` gains `interruptsRequested: number`, initialized to 0 by `RunRegistry.begin`. `MAX_INTERRUPTS_PER_RUN = 3` is exported from `src/run-control/steering.ts`. Once the count reaches the maximum, `requestSteer` calls plain `steer(text)`; the run continues at the next boundary.

Counting requests rather than observed cancellations is deliberately conservative: an interrupt that lands during tool execution consumes budget even though it costs nothing. Papai has no reliable phase signal without adding step-start tracking, and undercounting would defeat the billing guard.

Why three: it bounds the worst case to three extra model calls per run while leaving room for ordinary conversational corrections. The constant is fixed, not configurable, matching the `AGENT_MAX_STEPS` precedent.

Alternatives considered: charging each interrupt against `AGENT_MAX_STEPS` (rejected: redone steps are not steps, and the turn-limit tracker would need an offset that muddies `stopReason: 'turn_limit'`); a per-step cap (rejected: more state and it would block legitimate rapid corrections); an env/config knob (rejected: no runtime override precedent for loop budgets).

### D3: A graceful stop suppresses the interrupt request

When `run.stopRequested` is true, `requestSteer` uses plain `steer(text)`. The stop condition ends the loop at the next boundary; the SDK resolves the pending message as not delivered (`stop-condition`), and the existing replay turns it into one fresh turn after the stop summary.

Why: an interrupt would redo the current step and consume the message into a run the user already asked to end. The stopping run should end; the message should become the next turn.

Race accepted: a `/stop` that arrives after an interrupt request is already in flight can still cancel and redo one step before the boundary. The stop condition then ends the run. No extra state is worth narrowing that window.

### D4: After-task text is steering text, not a queue

A message that reads as "after this, do X" is delivered through the same steering path. The system starts no separate turn, queue entry, or reply. The system prompt tells the model to finish the current task first and never drop the request; the model sequences it within the same run and produces the normal single final reply.

Why: SDK `queue()` would deliver the message only after a final answer, but `result.text` is the final step only, so the completed task's answer would never be shown; the queue message would also share the 125-step budget and would not be persisted by `collectTurnMessages`. A turn-queue command would add the grammar this change exists to avoid. The existing `MessageQueue` still handles messages with no active run.

### D5: State, observability, and scope

- The interrupt count lives in memory on `RunControl`, keyed by `storageContextId`; it resets on every `RunRegistry.begin` and is never persisted or shared across threads. No config-context, per-user, group-shared, platform-instance, or task-instance state changes.
- No new tool surface, so `tool_prefs`, capability gating, guest mode, and the approval flow are untouched. Guest steering keeps its existing authorization and shares the run's budget.
- The acknowledgement text and the `turn_steered` analytics fact are unchanged. A fallback logs one debug record with `contextId`, `turnId`, and the count only — never the message content.
- No new module: the change extends `src/run-control/steering.ts`, `types.ts`, and `registry.ts`. No DB migration, no dependency, no environment variable.

### D6: System-prompt guidance is part of the contract

The steering section in `src/i18n/locales/{en,ru}-system-prompt.ts` gains the after-task sentence: a mid-run message may be a correction, an addition, or a request to do something after the current task; finish the current task first for the latter and never drop it. The existing stop guidance and clarifying-question guidance stay.

## Risks / Trade-offs

- **Cancelled calls may still be billed while recorded usage excludes them** → the per-run cap is the bound; document the usage gap in `docs/architecture/behaviors.md`.
- **A late addition can cancel a nearly finished call** → accepted for responsiveness; typical calls are short and the cap limits repeats.
- **The live-status message may briefly show the cancelled step until the redo emits its next event** → verify during implementation; the immediate ack still tells the user the message landed. A status reset is a follow-up if it reads badly.
- **An after-task request is model-sequenced, not guaranteed** → prompt guidance plus tests of the prompt; a hard guarantee would need the command design this change rejects.
- **A group run's budget is shared across members** → same interference surface as `/stop`; documented, not newly introduced.
- **Delivered steering text still is not persisted in history** → pre-existing (`collectTurnMessages` ignores `experimental_steeringMessages`); separate follow-up, not caused by this change.
- **Experimental SDK drift** → the option is passed in one function (`requestSteer`); typecheck and the steering tests fail loudly on a shape change.

## Migration Plan

Code-only; no data migration. Deploy with the normal application build. Rollback is a revert of the implementation commit; the prior `steer(text)` call returns with it. The behavior change needs no feature flag because routing, acks, analytics, and replay are unchanged.

## Open Questions

None that change the specs or the task breakdown. The cap value (3), live-status polish, and steering-history persistence are tuning or follow-up items.
