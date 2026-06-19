<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Agent Interruption & Steering Design: Mid-Run Control of a Running LLM Turn

**Date:** 2026-06-19
**Status:** Draft — pending review
**Scope:** A user-facing way to **interrupt, halt, and steer** an in-flight agent turn over chat (Telegram, Mattermost, Discord, Kontur Talk). Covers the full vocabulary — soft steer (redirect mid-run without losing work), graceful hard stop, and a deterministic force-abort — built on papai's existing non-streaming `generateText` tool loop. Out of scope: streaming token output, pause/resume of a suspended run, persisting run-control across process restarts, and any rework of the LLM provider transport.

## Problem Statement

papai has **no explicit way to interrupt, halt, or redirect a running agent turn.** Once a non-command message is dispatched, the entire agentic loop — up to 25 tool steps inside a single `generateText()` call (`src/llm-orchestrator-invoke.ts:240,246`) — runs to completion with no abort plumbing (no `AbortController`/`AbortSignal` is threaded into the LLM path today). A user who sees the agent go off-track mid-run can only wait it out. New messages sent meanwhile simply queue behind the running turn.

This is the anti-pattern the 2026 agent-UX literature names directly: a lone "stop" gesture conflates two unrelated intents — _"redirect, keep the good work"_ vs. _"throw it all away"_ — and kill-and-restart makes the user pay for correct work twice. The mature shape splits control into **queue / steer / interrupt**.

Three questions need answers:

1. In a chat bot where the natural "interrupt" gesture is _just sending another message_, what should a mid-run message do — and how do we make halting reliable without a brittle keyword classifier?
2. How do we inject a redirect into a running `generateText` loop **without discarding in-flight work** or breaking tool-call/tool-result message validity?
3. How does this behave across four chat platforms with different capabilities, and in multi-user group threads?

## Goals

1. A mid-run message **steers** the live run — injected at the next tool-step boundary — without killing it or wasting completed work. The default for any non-command message during an active run.
2. **Stopping is a special case of steering**: one unified injection surface. A typed "stop" winds the agent down via the model; a `/stop` command provides a deterministic guarantee when the model's compliance isn't enough.
3. A three-rung **stop ladder** of increasing force: typed soft-stop → deterministic graceful `/stop` → force-abort on repeat `/stop`.
4. **Instant, code-generated acknowledgements** so the user knows a mid-run message landed (vs. queued) before the model reacts.
5. **Honest partial-state reporting** on any stop — papai's tools have irreversible side effects (a task already closed cannot be un-closed).
6. **Any group member** can steer/stop a thread's run (no "owner" concept), gated by the existing group rule (`@mention` or reply-to-bot). **One active run per thread** so a steer always has one unambiguous target.
7. Works on **all four platforms** via the `/stop` command (commands bypass the queue, so they reach a running turn even on Kontur Talk, which has no buttons).
8. Smallest change that fits the existing architecture: reuse the `prepareStep` and `stopWhen` seams already present in the loop.

## Non-Goals

- **Streaming / token-level interruption.** The bot uses `generateText` (non-streaming); replies are atomic post-completion. "Interrupt" means _stop the loop / inject at a step boundary_, not "stop mid-sentence." Switching to `streamText` is out of scope.
- **Pause/resume of a suspended run.** When the model asks a clarifying question, the run **ends**; the user's answer is a normal new turn that resumes via conversation history. We do not hold a live `generateText` open awaiting input (that is the rejected outer-loop rewrite).
- **A `/stop` button or any interactive-callback UI.** `/stop` command only — by explicit decision. No `messages.buttons` / `interactions.callbacks` dependency.
- **A dedicated `/queue` command.** YAGNI: with one-run-per-thread + injection, "queue" is emergent — an additive mid-run message is handled after current work; a message sent with no active run is just a new turn.
- **NLP halt-classification.** We never keyword-detect "stop" in typed text. Guaranteed halts live on `/stop`; typed intent is the model's to interpret.
- **Persisting run-control across restarts.** The registry is in-memory; a crash mid-run leaves nothing to clean up.
- **Steering/stop for `proactive` runs.** Background, non-user-watched runs (`src/deferred-prompts/proactive-llm.ts`) get no run-control.
- **Rolling back committed tool side effects.** Irreversible effects are reported honestly, not undone.

## Current State

- **Pipeline:** message → `bot.ts` (`onIncomingMessage` → `handleMessage` → `enqueueMessage`) → per-`storageContextId` `MessageQueue` (500 ms debounce coalescing, serial `handlerChain`) → `processCoalescedMessage` → `processMessage` (`src/llm-orchestrator.ts:235`) → `invokeModel` (`src/llm-orchestrator-invoke.ts`) → `deps.generateText(...)`.
- **Non-streaming:** the whole loop runs inside one `await deps.generateText({ stopWhen: stepCountIs(25), … })`; the reply is a single atomic send after completion (`sendLlmResponse`, `src/llm-orchestrator.ts:66`).
- **No abort plumbing** into the LLM path. Only the per-tool `abortSignal` the AI SDK injects (forwarded to `web_fetch`/plugin HTTP) and a fixed 20-min `timeout` (its own internal abort) exist.
- **Step-boundary hooks already wired:** `experimental_onToolCallStart/Finish` (logging/progress) and a conditional `prepareStep` for progressive disclosure (`src/llm-orchestrator-invoke.ts:247-249`; `src/tools/disclosure/prepare-step.ts`). **Only one `prepareStep` may be passed to `generateText`.**
- **Commands bypass the queue** entirely (Grammy `bot.command`, etc.), so a new command is received and runs immediately even mid-turn. No `/stop` exists today.
- **Concurrency:** runs serialize per `storageContextId` via `handlerChain`, except a group edge case where a _different_ user's message can `forceFlush` and dispatch fire-and-forget, allowing two same-thread runs to overlap.
- **AI SDK v6** (`ai@^6.0.184`): `prepareStep` may return `{ messages }` to rewrite the conversation for the next step (verified against the v6 context-compaction cookbook); `stopWhen` accepts an array of conditions including custom `() => boolean`; `abortSignal` on `generateText` is forwarded to tools.

---

## Design

### 1. UX contract

**One unified surface: every mid-run message is injected at the next tool-step boundary; its content decides the effect.** No separate steer/stop/queue mechanism for the user to learn.

**Where a message counts as mid-run input:**

- **DM:** every message sent while a run is active.
- **Group:** a message that `@mentions` the bot _or_ replies to the bot's message (the existing group gate; Telegram/Discord treat reply-to-bot as mention-equivalent). One active run per thread → unambiguous target. Any authorized member may steer; there is **no owner concept**.

**What the agent does with an injected message (model-decided at the boundary):**

- _Correction_ ("only project X") → folds in, continues the same run.
- _Additive_ ("also summarize #2") → finishes current work, then handles it within the same run's budget.
- _Halt_ ("stop", "never mind") → winds down gracefully.

**The stop ladder — three rungs of increasing force:**

| Rung           | Gesture                          | Mechanism                                                     | Guarantee               | Decided by |
| -------------- | -------------------------------- | ------------------------------------------------------------- | ----------------------- | ---------- |
| 1. Soft stop   | type "stop" / "never mind"       | injected at boundary, **model** winds down                    | natural, model-mediated | model      |
| 2. Hard stop   | `/stop`                          | flips `stopWhen` → loop **provably** exits after current tool | deterministic, graceful | code       |
| 3. Force-abort | `/stop` **again** while stopping | `AbortSignal` → cuts in-flight LLM/tool call                  | immediate               | code       |

`/stop` works on all four platforms (commands bypass the queue). No buttons anywhere.

**Acknowledgements — code-generated, instant (not model output):**

- On steer: `✋ folding that into the current run…` — posted synchronously when the message is pushed to the steer queue, before the model sees it.
- On hard stop: `🛑 winding down after this step…`
- On force-abort: `🛑 Stopping immediately…`
- **Partial-state summary** after any stop, **code-generated** from recorded effects: _"Stopped — closed TASK-12, TASK-19; remaining 5 untouched."_ Force-abort variant adds: _"…1 in-flight call cut off (verify TASK-23)."_

Two feedback layers exist: the **deterministic ack** (instant, confirms receipt + routing) and the model's **substantive response** later (the work reflecting the steer).

**Continue vs. clarify:**

- _Obvious steer_ → model folds in and **continues steps in the same run** to completion.
- _Non-obvious steer_ → model may emit a clarifying question as final text (no tool call), which **naturally ends the loop**. The run ends; the user's answer arrives with **no active run** and is a **normal new turn** that resumes via preserved history. There is no suspended-run state. The only reset is the per-run 25-step budget, which is correct for a fresh turn.

A small `src/system-prompt.ts` fragment nudges this: _"A mid-run instruction may arrive between steps. Fold an unambiguous correction in and continue; ask a brief clarifying question only if you genuinely cannot proceed."_

### 2. Architecture & components

Implementation **Approach A** (in-loop via AI SDK hooks): keep the single `generateText` call; reuse `prepareStep` + `stopWhen` + `abortSignal`. Rejected alternatives: a papai-owned outer `maxSteps:1` loop (bigger rewrite, re-hosts disclosure/compaction, no UX gain) and abort-and-restart (the "pay twice" anti-pattern).

**New state, mirroring `QueueRegistry` (`src/message-queue/registry.ts`):**

- **`RunControl`** (per active run):
  - `steerQueue: InjectedMessage[]` — pending mid-run messages to inject
  - `stopRequested: boolean` — deterministic graceful-stop flag
  - `abortController: AbortController` — force-abort
  - `completedEffects: EffectRecord[]` — side effects done so far, populated from the existing `experimental_onToolCallFinish` handler
  - `progressReply` / `turnId` — handle for posting acks
- **`RunRegistry`** — `Map<storageContextId, RunControl>` with `begin()` / `get()` / `end()`, keyed by the same `storageContextId` used everywhere else.

**Integration points (all on existing seams):**

1. **One-run-per-thread serialization** — close the group fire-and-forget gap (`src/message-queue/`) so a thread has ≤1 active run; route the different-user `forceFlush` path through the same active-run guard.
2. **Mid-run routing** (`src/bot.ts` / message-queue) — non-command message + active run + passes gate (DM, or group mention/reply-to-bot) → push to `run.steerQueue`, post `✋` ack, do **not** start a new turn. Otherwise normal enqueue.
3. **`/stop` command** (new in `src/commands/`, registered in `src/bot.ts`) — bypasses queue. Active run, `stopRequested` false → set it, post `🛑 winding down…`. Active run, `stopRequested` already true → `abortController.abort()`, post `🛑 Stopping immediately…`. No active run → "nothing's running." Reuses existing command auth.
4. **Composed `prepareStep`** — new `createSteeringPrepareStep(run)` returns `{ messages: [...messages, ...drain(run.steerQueue)] }` when the queue is non-empty. A composer merges it with the existing disclosure `prepareStep` into the single allowed hook: steering injects `messages`, disclosure layers `activeTools`; steering's `messages` always survive (including when disclosure returns `{}` to open all tools). Disclosure off → steering alone.
5. **Dynamic `stopWhen`** — `stopWhen: [deps.stepCountIs(25), () => run.stopRequested]`; loop exits after the current step when set.
6. **`abortSignal`** — `generateText({ abortSignal: run.abortController.signal })`; already forwarded to tools.
7. **Partial-state summary** — graceful stop: `generateText` returns normally (ended via `stopWhen`) → summarize from `completedEffects`. Force-abort: catch `AbortError` → summarize `completedEffects` + "in-flight cut off, verify X."

**Lifecycle:** `RunControl` created when a run begins (`processMessage`/`invokeModel`), torn down in `finally`. Per-`storageContextId`, so DMs and separate threads stay independent and parallel. **`normal` mode only** — `proactive` runs get no run-control.

### 3. Data flow

**A. Steer (correction), DM**

```
User: "close my stale tasks"
  bot.ts → enqueue → RunRegistry.begin(ctx) → invokeModel
  loop step1 closes TASK-12 (onToolCallFinish → completedEffects += TASK-12)
User: "only project X"                ← arrives mid-run
  bot.ts: get(ctx) active, DM → run.steerQueue.push(...); reply "✋ folding that in…"
  boundary → prepareStep drains queue → {messages:[…, user:"only project X"]}
  step2: model re-scopes to project X → loop ends → final reply
  finally → RunRegistry.end(ctx)
```

**B. Soft stop (typed)** — as A, but injected text is "stop, never mind"; model emits final text, no further tool calls, run ends. No flag, no abort.

**C. Hard stop (`/stop`)**

```
[run active, mid-loop]
User: /stop                            ← command, bypasses queue
  handler: run active, stopRequested=false → set true; reply "🛑 winding down…"
  current tool finishes (recorded)
  stopWhen eval: [stepCountIs(25)=false, ()=>stopRequested=TRUE] → loop EXITS
  → summary from completedEffects → finally → end(ctx)
```

**D. Force-abort (`/stop` twice)**

```
[run active, stopRequested already true — e.g. stuck in a long generation]
User: /stop                            ← second call
  handler: run active, stopRequested already true → abortController.abort(); reply "🛑 Stopping immediately…"
  generateText throws AbortError → invokeModel catch (signal.aborted===true)
  → summary: "2 closures done; 1 in-flight call cut off (verify TASK-23)." → finally → end(ctx)
```

**E. Group, one-run-per-thread**

```
Alice: "@bot close stale tasks"  → begin(thread), run A
Bob:   "@bot only project X"      → get(thread) active, mention → A.steerQueue.push; "✋ folding in…"
Bob:   "@bot also summarize #2"   → injected; model finishes closures, then handles within A's budget
Carol: "what's for lunch"         → no mention/reply-to-bot → ignored
run A ends → end(thread)          ; a message with no active run = a normal new turn
```

### 4. Edge cases & error handling

- **`RunRegistry.end()` in `finally` on every exit path** (success, `stopWhen` exit, `AbortError`, thrown error) — the single most important correctness rule. A lingering dead run would route every later message to an orphaned `steerQueue` and wedge the context.
- **In-memory only:** a crash mid-run leaves nothing to clean up; the registry is empty on restart.
- **Steer not consumed before the run ends** (arrives during final-text step, or run finishes first): leftover `steerQueue` entries are **re-enqueued as a normal new turn** on `end()` — never silently dropped.
- **No locks:** JS is single-threaded; the `stopWhen` closure and `prepareStep` drain read `RunControl` synchronously at boundaries while the `/stop` handler mutates between boundaries. A comment suffices.
- **Stop escalation is state-based, no timer:** `/stop` on an active run with `stopRequested` already true → abort. Run ended between the two `/stop`s → second sees no run → "already stopped." Registry presence is the state.
- **Abort vs. real errors:** catch `AbortError` **only** when `run.abortController.signal.aborted === true`. Other errors and the 20-min `timeout`'s own abort flow through normal handling unchanged.
- **Force-aborted in-flight tool:** rejects on the forwarded signal; state genuinely unknown → report "verify TASK-X." Already-committed effects are irreversible and reported as done.
- **Message-validity invariant:** injection only in `prepareStep` (fires at a boundary, after a complete tool-call/result pair, before the next model call) → an injected user message can never split a call/result pair. The composer merges explicitly so steering `messages` always survive.
- **Scope & auth:** `normal` mode only; proactive ignored. `/stop` reuses existing command auth — any authorized group member may stop the thread's run; unauthorized `/stop` rejected by the same gate.
- **Degradation:** a failed ack send is logged and swallowed — never aborts the run or the steer. Acks are best-effort UX, not control flow.

### 5. Testing strategy

Bun test, DI-first, isolation-clean (poll with `waitFor`, no fixed sleeps). Key enabler: `deps.generateText` is already injectable — a **fake `generateText`** simulating the step loop (invokes `prepareStep` between steps, evaluates `stopWhen` after each, fires `onToolCallFinish`, throws `AbortError` on signal) tests injection, graceful stop, and force-abort deterministically without a real LLM.

**Unit:**

- `RunRegistry` — `begin`/`get`/`end`; one-run-per-context; `end` idempotent; `get` → undefined when none.
- Composed `prepareStep` — steering-only drains queue → `{messages:[…injected]}`; empty queue → pass-through; both merge (steering `messages` + disclosure `activeTools`); disclosure `{}` preserves steering messages; injected message appended after existing.
- Dynamic `stopWhen` — true iff `stopRequested`; composes with `stepCountIs(25)`; loop exits after current step.
- Partial-state summary — honest text from `completedEffects`; force-abort variant adds the "in-flight cut off, verify X" line.

**Integration (fake `generateText`):**

- Steer happy path — acked, queued, injected, run completes.
- Hard stop — flag → loop exits → summary reflects `completedEffects`.
- Force-abort — second `/stop` → `AbortError` caught only when `signal.aborted` → partial summary; non-our error / 20-min timeout passes through.
- Lifecycle cleanup — `end()` on all four exit paths (highest-value test).
- Leftover-steer race — re-enqueued as a fresh turn, never dropped.

**Routing / platform (existing helpers):**

- DM mid-run → steer; no active run → normal turn.
- Group: mention/reply-to-bot during active run → steer; plain chatter → ignored; one-run-per-thread (different user's mention → steer, not parallel run); different thread → independent run allowed.
- `/stop`: no run → "nothing running"; first → flag; second → abort; run-ended-between → "already stopped"; unauthorized → rejected.
- Proactive run → no `RunControl`; `/stop` ignores it.

**System prompt** — assert the mid-run fragment is present/correct.

**TDD/mutation:** every new `src/` module is test-first (Red→Green hook enforces it). Run `bun test:mutate:file` on the control-flow modules (`RunRegistry`, composed `prepareStep`, `stopWhen` closure, summary builder).

---

## Open Questions

None blocking. Confirmed during design: full vocabulary; steer-with-ack default; graceful-at-boundary stop; `/stop`-command-only (no buttons); one-run-per-thread; clarification ends the run (no suspended state); explicit `/queue` dropped (YAGNI).

## Decisions Log

1. **Stopping is a special case of steering** — one injection surface; `/stop` is the deterministic escape hatch, not the everyday stop.
2. **Mid-run default = steer + lightweight ack**, not queue and not auto-steer-silently.
3. **Graceful-at-boundary** hard stop (finish current tool, then exit) over immediate-abort-by-default; force-abort is the second-`/stop` escalation.
4. **One active run per thread** in groups (serialize, close the fire-and-forget gap) so a steer has one unambiguous target; **no owner concept**, any authorized member steers.
5. **`/stop` command only**, no button — universal across platforms, removes the callback/button dependency.
6. **No NLP halt-classifier** — typed intent is the model's to read; guaranteed halts live on `/stop`.
7. **Clarification ends the run** — answer is a fresh turn via history; no suspended-run state.
8. **Approach A (in-loop hooks)** over an outer loop or abort-and-restart.
