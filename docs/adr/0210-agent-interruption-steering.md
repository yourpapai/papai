<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0210: Agent Interruption and Steering

## Status

Implemented

## Date

2026-06-19

## Context

Before this work, papai had **no explicit way to interrupt, halt, or redirect a running agent turn.** A non-command message dispatched to the LLM ran the entire agentic loop — up to 25 tool steps inside a single `generateText()` call (`src/llm-orchestrator-invoke.ts`) — to completion with no abort plumbing threaded into the LLM path. A user who saw the agent go off-track mid-run could only wait it out; new messages queued behind the running turn. The 2026-06-19 design (`docs/archive/2026-06-19-agent-interruption-steering-design.md`) framed this as the 2026 agent-UX anti-pattern: a lone "stop" gesture conflates "redirect, keep the good work" with "throw it all away," and kill-and-restart makes the user pay for correct work twice.

The design specified a unified control surface — every mid-run message is injected at the next tool-step boundary and its content decides the effect — built on three seams already present in the AI SDK v6 loop: `prepareStep` (rewrite the next step's conversation), `stopWhen` (array of conditions incl. custom `() => boolean`), and `abortSignal` (forwarded to tools, rejects with `AbortError`). The corresponding plan (`docs/archive/2026-06-19-agent-interruption-steering.md`) implemented this in-loop ("Approach A") rather than rewriting the loop, on a strict test-first cadence.

Two architectural constraints shaped the result: (1) only one `prepareStep` may be passed to `generateText`, and progressive disclosure already occupies it conditionally, so the two must be **composed**, not stacked; and (2) a group edge case let a _different_ user's message `forceFlush` and dispatch fire-and-forget, so two same-thread runs could overlap — making a steer's target ambiguous. One-run-per-thread serialization closes that gap.

## Decision Drivers

- **No discarded work.** A redirect must fold in without losing completed (often irreversible) tool side effects; a stop reports partial state honestly rather than rolling it back.
- **Smallest change fitting the existing architecture.** Reuse the `prepareStep` / `stopWhen` / `abortSignal` seams inside the single `generateText` call; never rewrite the agent loop.
- **Deterministic guarantee when model compliance isn't enough.** A typed "stop" relies on the model winding down; a command must provably exit the loop, with force-abort as the last rung.
- **Universal across platforms.** Kontur Talk has no interactive buttons; a command-based stop reaches a running turn on every platform because commands bypass the queue.
- **One unambiguous steer target.** A group thread runs at most one active run so a mid-run message always has exactly one recipient; no owner concept — any authorized member steers.
- **In-memory only.** Run-control is process-local and torn down in `finally`; a crash mid-run leaves nothing to clean up and no state to persist across restarts.

## Considered Options

### Option A: In-loop hooks (chosen)

Keep the single `generateText` call; add a `RunRegistry` and wire steering injection, a dynamic `stopWhen`, and `abortSignal` through the existing hooks.

- **Pros:** Smallest diff; reuses verified AI SDK v6 seams; progressive disclosure composes rather than re-hosts; no UX regression for `proactive` runs (no `begin` → reference-identical pass-through).
- **Cons:** Couples run-control lifetime to `processMessage`/`invokeModel`; requires disciplined `finally` cleanup on every exit path; one `prepareStep` forces a composer.

### Option B: Papai-owned outer `maxSteps: 1` loop

Replace the SDK loop with an outer step loop the bot owns, re-hosting disclosure/compaction per step.

- **Pros:** Full control over step boundaries; trivial injection point.
- **Cons:** Large rewrite; re-implements SDK step semantics (tool-call/result pairing, compaction); high regression surface; no UX gain over Option A.

### Option C: Abort-and-restart

Abort the current run on any mid-run message and start fresh.

- **Pros:** Simple to reason about; no injection logic.
- **Cons:** The "pay twice" anti-pattern — discards correct in-flight work; user re-issues intent; irreversible side effects left orphaned with no honest summary.

## Decision

Implement **Approach A** — in-loop hooks over the single `generateText` call, with an in-memory `RunRegistry` mirroring `QueueRegistry`'s shape. Seven coordinated pieces:

### 1. `RunControl` + `RunRegistry` (in-memory, keyed by `storageContextId`)

A per-run `RunControl` holds `steerQueue: InjectedMessage[]`, `stopRequested: boolean`, `abortController: AbortController`, and `completedEffects: EffectRecord[]`. `RunRegistry` exposes `begin` / `get` / `end` / `clear`; `end` returns leftover steer messages. A `RunAbortedError` (carrying the effects) is thrown by `invokeModel` on force-abort. Defined in `src/run-control/types.ts` and `src/run-control/registry.ts`.

### 2. Composed `prepareStep` (the single allowed hook)

`createSteeringPrepareStep(run)` returns `{ messages: [...messages, ...drain(run.steerQueue)] }` when the queue is non-empty, else `undefined`. `composePrepareSteps(steering, disclosure)` merges steering's `messages` with disclosure's `activeTools` into the one hook the SDK accepts — steering owns `messages`, disclosure owns `activeTools`; both survive, including when disclosure returns `{}` to open all tools. `src/run-control/steering-prepare-step.ts`.

### 3. Dynamic `stopWhen`

`stopWhen: [deps.stepCountIs(25), createStopRequestedCondition(run)]` — the second condition is `() => run.stopRequested`, so the loop provably exits after the current step when set. `src/run-control/stop-condition.ts`.

### 4. `abortSignal` + `RunAbortedError`

`generateText({ abortSignal: run.abortController.signal })` (already forwarded to tools). The catch wraps an `AbortError` in `RunAbortedError` **only** when `run.abortController.signal.aborted === true`; the 20-min `timeout`'s own abort and any other error flow through normal handling unchanged. Wired in `src/llm-orchestrator-invoke.ts` (`callGenerateText`).

### 5. Effect recording + partial-state summary

`experimental_onToolCallFinish` pushes `{ toolName: event.toolCall.toolName }` to `run.completedEffects` (and forwards to the existing finish handler). `buildStopSummary(effects, { forced })` is a deterministic, code-generated summary — graceful variant lists completed actions with counts; force-abort variant appends an "in-flight call may have been cut off — verify recent changes" warning. `src/run-control/summary.ts`.

### 6. Mid-run routing + ack in `bot.ts`

In `handleMessage`, after the group gate, if `runRegistry.get(auth.storageContextId)` is active, the message is pushed to `run.steerQueue` with an instant code-generated `✋ folding that into the current run…` ack, and **no turn is enqueued**. Otherwise normal enqueue. Acks are best-effort UX, not control flow.

### 7. `/stop` command + one-run-per-thread serialization

`/stop` bypasses the queue (Grammy `bot.command`), so it reaches a running turn on every platform: no active run → "Nothing is running right now."; first `/stop` sets `stopRequested` and acks "winding down…"; a second `/stop` while still stopping calls `abortController.abort()` and acks "Stopping immediately…". Any authorized member may `/stop` a group thread's run. `src/commands/stop.ts`, registered in `src/bot.ts`.

The message queue's different-user `forceFlush` path is routed through `handlerChain.then(() => runCoalesced(flushed))` instead of fire-and-forget, so a thread runs one turn at a time. Combined with the routing check, this gives one-run-per-thread. `src/message-queue/queue.ts`.

### Lifecycle and leftovers

`runTurn` (`src/llm-orchestrator.ts`) calls `runRegistry.begin`, runs the turn, and on graceful stop posts `buildStopSummary(effects, { forced: false })`; on `RunAbortedError` posts the forced variant; on other errors delegates to `handleLlmTurnError`. **`runRegistry.end` runs in `finally` on every exit path** — the single most important correctness rule. Leftover `steerQueue` entries (never injected before the run ended) are re-enqueued as a fresh turn, never dropped. A static `STEERING_FRAGMENT` in `src/system-prompt.ts` nudges the model to fold corrections in and ask clarifying questions only when genuinely stuck.

## Consequences

### Positive

- A user steers a live run without losing completed work; a redirect lands at the next tool-step boundary.
- `/stop` provides a deterministic graceful-then-force escalation that works on all four platforms with no button/callback dependency.
- Partial-state summaries report committed effects honestly; irreversible actions are never silently undone.
- One-run-per-thread closes the prior fire-and-forget gap, giving every steer one unambiguous target.
- `proactive` runs are unaffected — they never call `runRegistry.begin`, so `invokeModel` is a reference-identical pass-through.
- The composer keeps progressive disclosure and steering independently extensible; neither re-hosts the other.

### Negative

- **In-memory only.** A crash mid-run leaves no run-control to recover; the registry is empty on restart. Intentional, since there is no durable run state worth persisting.
- **Mid-run attachments are not forwarded into the steer turn** in v1 — only the steer text is injected. New attachments sent mid-run are ignored until the next fresh turn. Tracked as a v1 limitation.
- **`EffectRecord` captures `toolName` only.** Richer per-entity detail (e.g. specific task IDs closed) is not surfaced in the summary yet; the interface allows layering it later without breaking callers.
- **Acks are best-effort.** A failed ack send is logged and swallowed; it never aborts the run or the steer.
- **The `index.ts` fire-and-forget branch is now dead but harmless** for the different-user path (the chained run already emits `turn:end`); left as-is to avoid churning the dispatch surface.

### Risks

- **A lingering dead run would route every later message to an orphaned `steerQueue` and wedge the context.** Mitigated by `runRegistry.end` in `finally` on all four exit paths (success, `stopWhen` exit, `AbortError`, thrown error), verified by a lifecycle-cleanup test.
- **Mis-classifying a real error as a force-abort.** Guarded by checking `run.abortController.signal.aborted === true` before wrapping in `RunAbortedError`; the 20-min timeout's abort and other errors pass through unchanged.
- **`stopWhen`/`prepareStep` racing the `/stop` handler.** JS is single-threaded; the closures read `RunControl` synchronously at boundaries while `/stop` mutates between boundaries. A comment documents the invariant; no locks needed.

## Related Decisions

- ADR-0062: Message Queue — the per-`storageContextId` queue and `handlerChain` this work serializes the different-user flush through.
- ADR-0211: Ephemeral Permission Prompts — the ask-gated tool surface whose `prepareStep`-independent gating runs alongside this composed `prepareStep`.
- ADR-0214: Live Task Status — the ephemeral status-message lifecycle that runs concurrently with a steerable turn and dismisses on the real reply.

## Implementation Notes

Key files, confirming presence:

- `src/run-control/types.ts` — `RunControl`, `InjectedMessage`, `EffectRecord`, `RunAbortedError`.
- `src/run-control/registry.ts` — `RunRegistry` class + `runRegistry` singleton (`begin`/`get`/`end`/`clear`).
- `src/run-control/summary.ts` — `buildStopSummary(effects, { forced })`.
- `src/run-control/steering-prepare-step.ts` — `createSteeringPrepareStep`, `composePrepareSteps`.
- `src/run-control/stop-condition.ts` — `createStopRequestedCondition`.
- `src/commands/stop.ts` — `registerStopCommand` (graceful → force-abort escalation).
- `src/llm-orchestrator-invoke.ts` — `callGenerateText` wires `stopWhen` (array form), `abortSignal`, the composed `prepareStep`, effect recording, and the `RunAbortedError` catch.
- `src/llm-orchestrator.ts` — `runTurn` begins/ends the run (`end` in `finally`), posts the stop summary, and re-enqueues leftover steers; `processMessage` drives it.
- `src/bot.ts` — `handleMessage` mid-run routing + `✋ folding that into the current run…` ack; `/stop` registration.
- `src/message-queue/queue.ts` — `runCoalesced` + `handlerChain.then(...)` serialization of the different-user flush.
- `src/system-prompt.ts` — `STEERING_FRAGMENT` pushed in `assembleSystemPrompt`.

Minor adaptations from the plan (intent preserved): the generateText call was extracted into a `callGenerateText` helper and the turn body into a `runTurn` helper returning `InjectedMessage[]` (the plan inlined both); effect recording reads `event.toolCall.toolName` because AI SDK v6 wraps `toolName` under `toolCall`; and `composePrepareSteps` assigns merged properties explicitly rather than via object spread to satisfy strictness. `normal` mode only — `proactive` runs get no `RunControl`.
