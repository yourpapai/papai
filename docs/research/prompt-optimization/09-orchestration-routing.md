<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# 09 — Orchestration, model routing, and workflow patterns

Covers: how `src/llm-orchestrator.ts` drives the Vercel AI SDK loop today, what `stopWhen` / `prepareStep` unlock, when (and how) to split work between `main_model` and `small_model`, and how the orchestrator should pick between "just answer", "answer with tool calls", and "plan then act".

## 1. Current loop (summarised)

Single call to `generateText()` with `tools` (or `streamText()` where streaming). Default `stopWhen` (up to 20 steps in AI SDK v5/v6). No `prepareStep`. Small-model usage is limited to the memory summariser and web-fetch distillation.

`experimental_onToolCallFinish` wraps tool errors into `ToolFailureResult` but does not classify the turn ("did the model converge?"), does not route to different models, and does not short-circuit on simple classifications.

## 2. Principle: simplicity first, routing second

Anthropic's _Building Effective Agents_ ([10](./10-references.md) #1):

> "For many applications, optimizing single LLM calls with retrieval and in-context examples is usually enough. Agents trade latency and cost for better task performance—only adopt when simpler solutions demonstrably fail."

papai already runs as an "agent" (tools + dynamic decisions). That's fine — but not every turn needs the full agent. Two levers:

1. **Routing.** Classify the turn early; skip the agent when the turn is trivial.
2. **`prepareStep` / `stopWhen`.** Inside the agent loop, reshape the context per step rather than running the same 3k-token prompt 20 times.

## 3. Turn classification (optional routing layer)

Not every message needs the main model + 60 tools. Examples:

- "thanks" → no tool, short acknowledgement. Send with small_model or a canned reply.
- "what can you do?" → help text; deterministic.
- "list my tasks" → goes through main model (it requires `list_tasks` and natural-language args). No routing benefit.
- "delete everything" → main model with destructive-action gate. No routing benefit.

A small-model classifier ([10](./10-references.md) #11) that tags the turn with one of `{trivial, query, mutation, destructive, ambiguous, chit-chat}` at the start of processing has a few uses:

- Skip the full agent for `trivial` / `chit-chat`.
- Force a stricter system-prompt variant for `destructive` (the "halt-by-default" rule becomes the first thing the model sees).
- Pre-fetch likely tools (e.g. `list_projects` for `mutation` turns where the user named an entity).

Cost model: 1–3 ms added latency, ~$0.0001 per classification. ([10](./10-references.md) #11) Savings happen on the ~30% of turns that are trivial / chit-chat / purely informational.

This is **optional** — do it last, only if the metrics show a win.

## 4. `prepareStep` — per-step reshaping

Vercel AI SDK v5+ exposes `prepareStep` inside `streamText`. Use cases for papai:

- **Drop tools after a successful mutation.** After `create_task` succeeds, the next step doesn't usually need the full tool set — in many cases the only next step is an assistant text turn. Emitting a subset (`{ tools: [get_task, list_tasks] }` only, or `tools: {}`) for the _reply_ step cuts tokens and discourages unnecessary follow-up calls. ([10](./10-references.md) #35)
- **Force tool choice on the first step.** If the classifier says `mutation` and the message names a project, `toolChoice: { type: 'tool', name: 'list_projects' }` on step 1 avoids the model guessing project IDs.
- **Swap models mid-turn.** If a step's result is very long (e.g. `web_fetch` with a 50k-token excerpt), swap to a bigger context window on the synthesis step. This is rarely needed but `prepareStep` makes it cheap.

Caveat from Vercel issue tracker ([10](./10-references.md) #36): tool execution reliability degrades after ~5 messages in some models. Setting `toolChoice` explicitly on the first step avoids the class of "I analysed it but did not call the tool" failures.

## 5. `stopWhen` — bounding the loop

Today: default step count (20). Recommended:

- **Hard cap at 6 steps** for normal turns. Most legitimate sequences are 1–3 tool calls + reply. A 20-step loop is almost always an error (the model is stuck in a retry loop or hallucinating).
- **Stop early on `recovery.action = 'ask_user'`.** If any tool returns an `ask_user` recovery, the next step must be the assistant reply, not another tool call. Detect and short-circuit.
- **Stop when the assistant produced a non-empty text turn AND the last tool was not `call_tool`-recovered.** This is already the default but worth making explicit so debugging is easy.

Proposed:

```ts
streamText({
  system,
  messages,
  tools,
  stopWhen: stepCountIs(6),
  prepareStep: ({ steps, messages }) => {
    const lastToolResult = lastToolResultFrom(steps)
    if (lastToolResult?.recovery?.action === 'ask_user') {
      return { toolChoice: 'none' } // force text reply
    }
    if (steps.length >= 3 && steps.every((s) => !s.toolCalls?.length)) {
      return { toolChoice: 'none' } // drifting — no tools
    }
    return {} // default
  },
})
```

Simple, reversible, and testable.

## 6. Small-model usage today and where to expand it

Today small_model is used for:

1. **Memory trim summariser** (src/memory.ts).
2. **Web fetch distillation** (src/web/).

Where else it could help:

- **Turn classifier** (§3) — if you adopt it.
- **Tool-call argument pre-fill.** For `create_task` after the user says "add a task to the Auth project for the password reset", a small_model with a narrow schema can extract `{ project_name: "Auth", title: "password reset", dueDate: null }` as a hint. The main model still gets to decide, but with a prefilled template in the `<rule id="context-first">` block: "Pre-extracted candidates: {json}". This improves first-call accuracy on schema adherence — the documented win of 95-99% tool-calling with schema hints ([10](./10-references.md) #6).
- **Memo embedding / search.** Already uses `embedding_model`; no change.
- **Instruction normaliser.** The weekly review from [`07-memory-context.md`](./07-memory-context.md) §6 runs on small_model.
- **Locale detection.** Small_model classifies user language from first message; cached per user.

Trade-off: each small_model hop adds 100–300 ms. Worth it when it prevents a 2-second main-model retry; not worth it when the main model nails it on first try.

## 7. Multi-agent patterns — when (not) to adopt

Anthropic's five agentic patterns ([10](./10-references.md) #1):

1. **Prompt chaining.** Use for tasks with a clean sequence (e.g. "generate then validate"). Not needed in papai; single tool call + reply covers most turns.
2. **Routing.** Useful. See §3.
3. **Parallelisation.** Could help on bulk operations (e.g. delete 14 tasks — issue the deletions in parallel with `p-limit`). Already the project convention (`CLAUDE.md` says use `p-limit`). The orchestrator can simply not wait between tool calls within a turn.
4. **Orchestrator-workers.** Overkill for papai. The task scope is small and bounded.
5. **Evaluator-optimiser.** Interesting for replies that go through a second model critiquing "is this a good reply?" — but the latency cost is significant. Not recommended unless a clear failure mode emerges.

Conclusion: keep it single-agent. Add routing + `prepareStep` + `stopWhen`; do **not** add a supervisor / critic agent.

## 8. Observability

Observability is the precondition for any of this landing well.

- **Trace per turn.** Capture: system prompt length, tool set size, each `prepareStep` decision, each tool call (args + result + duration + recovery), final reply. Today debug dashboard captures tool calls; the other fields are not all surfaced.
- **Metrics.** p50/p95 latency, avg steps per turn, tool-error rate by code, confirmation-round-trip latency, % turns using small_model classifier.
- **Sampling.** Log traces for 100% of turns in debug; keep 10% aggregate stats in production.
- **Anomaly detection.** A turn hitting `stopWhen: stepCountIs(6)` without a text reply is an anomaly; surface in logs. A `confidence=1.0` emitted without a prior `confirmation_required` round-trip is an anomaly; surface.

## 9. Failure modes observed elsewhere (for papai to watch)

From Vercel AI SDK issues ([10](./10-references.md) #36):

- **Tool loop breaks after ~5 turns.** The model starts narrating instead of calling. Mitigation: classifier + explicit `toolChoice` on mutation turns, plus the hard step cap.
- **Double answers / repeated tool calls.** Symptom of the loop not terminating. Mitigation: `stepCountIs(6)` + anomaly detection.
- **Streaming tool input mid-stream.** Not used by papai today but relevant if streaming is added.

## 10. Concrete recommendations

- **R-09-1 (H):** cap the tool loop at 6 steps (`stopWhen: stepCountIs(6)`) and add anomaly logging for turns that hit the cap.
- **R-09-2 (H):** add a `prepareStep` hook that short-circuits to `toolChoice: 'none'` when the last tool emitted `recovery.action = 'ask_user'`.
- **R-09-3 (M):** add a small-model turn classifier; route `trivial` / `chit-chat` turns to a deterministic reply without invoking the main model.
- **R-09-4 (M):** add a small-model argument pre-extractor for common `mutation` turns (`create_task`, `update_task`) to reduce first-call schema errors.
- **R-09-5 (M):** add observability: per-turn trace with `prepareStep` decisions, step count, tool-error breakdown.
- **R-09-6 (L):** bulk destructive operations (delete_task ×N) dispatched in parallel with `p-limit`.
- **R-09-7 (L):** evaluate whether an evaluator-optimiser pattern is justified by metrics; do not adopt preemptively.

External: Anthropic _Building Effective Agents_ ([10](./10-references.md) #1), Vercel AI SDK `streamText` reference ([10](./10-references.md) #35), Vercel issue #10269 ([10](./10-references.md) #36), model-routing guidance ([10](./10-references.md) #11).
