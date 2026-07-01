<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Verified Completion Message — Design Spec

**Date:** 2026-07-01
**Status:** Approved (brainstorming), pending implementation plan
**Area:** LLM orchestration — final reply delivery

## Problem

The bot replies with a bare `Done.` whenever an LLM turn ends with no text. This
happens in two places:

- **Interactive path** — `sendLlmResponse` (`src/llm-orchestrator-support.ts:248`)
  falls back to `'Done.'` when `result.text` is `undefined`/`''`.
- **Proactive path** — `finalizeDeliveryText` (`src/deferred-prompts/proactive-llm-helpers.ts:60`)
  returns `'Done.'` on empty text **or** `finishReason === 'tool-calls'`.

Root cause (confirmed against Anthropic tool-use guidance): concise newer models
often **skip the post-tool verbal summary** even though `WORKFLOW` step 4 in
`src/system-prompt.ts:111` already asks for a "concise confirmation." The bare
`Done.` is worst in the **step-cap truncation** case (`finishReason === 'tool-calls'`),
where the turn was cut off mid-action but `Done.` still asserts success — i.e. it
lies to the user.

## Goals

- Replace the bare `Done.` with a truthful, in-language completion message.
- **Never claim success we have not confirmed.** ("Must not lie.")
- On step-cap truncation, state that the tool-step limit was reached and suggest
  continuing.
- Fix both the interactive and proactive paths with one shared implementation.

## Non-goals

- No auto-continue/auto-resume mechanism (the message only _suggests_ "continue").
- No per-tool `humanSummary`/`confirmationLabel` fields on tool results.
- No stored user locale (replies continue to mirror the user's language implicitly).
- No verification on normal, confident text turns (cost control).

## Approach — hybrid

### Pillar A — sharpen the prompt (cheap, common case)

Tighten `WORKFLOW` step 4 in `src/system-prompt.ts` from the soft _"Reply with a
concise confirmation"_ to an explicit instruction: after acting, **name what was
done** (affected entity + key change), in the user's language. This makes most
turns end with a real, in-language confirmation, so the fallback rarely fires.

### Pillar B — verify-and-report fallback (the trust guarantee)

On **risky turns only**, run a second, constrained LLM call that verifies the
request actually happened and reports truthfully.

**Trigger — a turn is "risky" when any of:**

1. Model text is empty/undefined, **or**
2. `finishReason === 'tool-calls'` (step-cap truncation), **or**
3. A tool in the turn returned a `ToolFailureResult`.

Normal turns (confident text, clean finish, no failures) are trusted — no second
call.

**Verification = two-tier (degrades gracefully):**

- **Read-back (primary):** the verify call gets a **read-only tool subset** and
  re-fetches the affected entity from the tracker to confirm the intended state
  (e.g. re-get the task, check `status`).
- **Self-check (fallback):** when read-back is not possible (no task instance
  configured, read tools unavailable, or a read errors), it reasons over the tool
  results already in the turn and reports honestly.

**Verdict taxonomy → user message:**

| Verdict            | Trigger                               | Message intent                                                                                |
| ------------------ | ------------------------------------- | --------------------------------------------------------------------------------------------- |
| `confirmed`        | read-back/self-check confirms request | In-language summary of what was done                                                          |
| `truncated`        | `finishReason === 'tool-calls'`       | "Reached the tool-step limit mid-task; here's what's done — say **continue** to resume."      |
| `partial`/`failed` | a tool failed or state not confirmed  | Honest statement of what succeeded and what did not                                           |
| `unconfirmed`      | verify itself could not determine     | Neutral, honest ("ran the actions but couldn't confirm — please check"); never a false "Done" |

## Architecture

### New module — `src/completion/verified-completion.ts`

DI-first, testable in isolation.

```ts
export type CompletionVerdict = 'confirmed' | 'truncated' | 'partial' | 'failed' | 'unconfirmed'
export type VerifiedCompletion = { text: string; verdict: CompletionVerdict }

export type VerifierDeps = {
  // wraps generateText with a small step budget + the read-only toolset; provider/BYOK-aware
  invokeVerifier: (prompt: VerifierPrompt) => Promise<{ text: string | undefined; finishReason?: string }>
  readOnlyToolset: ToolSet | undefined   // undefined => self-check only (no read-back)
  log: Logger
}

export const buildVerifiedCompletion = (
  turn: { history: ModelMessage[]; finishReason?: string; hadToolFailure: boolean },
  deps: VerifierDeps,
): Promise<VerifiedCompletion>
```

**Internal flow:** build a verification prompt (the user's request + this turn's
tool-calls/results + `finishReason`, instructing: _read current state to confirm,
then reply truthfully in the user's language, never mutate; if the step limit was
hit, say so and suggest continuing_) → `invokeVerifier` → map to a verdict →
return text. Truncation is detected up front (`finishReason === 'tool-calls'`) and
steers the prompt toward the "limit reached, say continue" message.

### Read-only toolset (safety-critical)

`selectReadOnlyTools(toolset)` filters the context's already-assembled tools
through an **explicit read allowlist** (`get_*`, `list_*`, `search_*`) and drops
anything unrecognized — so the verifier structurally **cannot** call a
write/destructive tool or double-execute. The verifier call also runs with a small
`maxSteps` cap, and its output is never itself re-verified (no recursion).

### Integration points (one shared helper)

- **Interactive** — `sendLlmResponse` (`src/llm-orchestrator-support.ts:248`):
  compute `isRisky` (empty text ∨ `tool-calls` ∨ tool failure); if risky,
  `textToFormat = (await buildVerifiedCompletion(...)).text`, else trust
  `result.text`. Gains an injected `verifier` dep, constructed in the orchestrator
  (`invokeWithLiveStatus` / `callLlm` in `src/llm-orchestrator.ts`) where the model
  config + toolset already live.
- **Proactive** — `finalizeDeliveryText` / `finalizeAndLog`
  (`src/deferred-prompts/proactive-llm-helpers.ts`): becomes async, takes the same
  deps (built from the proactive path's `BuildProviderFn`), routes through the
  shared helper. **Known ripple:** its 3 callers in `src/deferred-prompts/proactive-llm.ts`
  (`invokeLightweight`, `invokeWithContext`, `runFullGeneration`) must `await`.

## Error handling, cost guards & safety

**Degradation ladder (never emit a false "Done"):**

1. Read-back verify succeeds → truthful in-language summary.
2. Read-back unavailable → self-check (verifier invoked with no tools).
3. Verifier throws / times out / returns empty → safe neutral honest message
   (verdict `unconfirmed`); logged at `warn`.
4. Empty text **and** no tool calls → short honest re-ask, not a summary.

**Cost guards:**

- Second call fires only on risky turns.
- Verifier runs with a small `maxSteps` cap (a handful of read steps).
- Read-only allowlist keeps read-back cheap and bounded.

**Safety invariants:**

- Verifier toolset is structurally read-only → cannot mutate or double-execute.
- No recursion: verifier output is never re-verified.
- BYOK-aware: verifier uses the same provider/model resolution as the main turn.
- Logging: `debug` on entry (contextId, trigger reason), `info` on verdict, `warn`
  on degradation. Never log tool payloads/tokens.

**Truncation specifics:** verdict `truncated` produces a message that (a) states the
tool-step limit was reached, (b) summarizes what did complete (verified), (c)
suggests saying "continue." The existing `warn` at
`src/llm-orchestrator-support.ts:253` stays.

## Testing

**Unit — `tests/completion/verified-completion.test.ts`** (DI-first, fake
`invokeVerifier`, no network):

- Empty text + successful write + read-back confirms → `confirmed`, message names entity.
- `finishReason === 'tool-calls'` → `truncated`; message mentions step limit **and** suggests "continue."
- Tool failure in turn → `partial`/`failed`; honest about what failed.
- `readOnlyToolset === undefined` → self-check path (verifier invoked with no tools).
- Verifier throws / returns empty → `unconfirmed`, safe neutral message, no false success, `warn` logged.
- Empty text + no tool calls → honest re-ask, not a summary.
- `selectReadOnlyTools()` → keeps `get_*`/`list_*`/`search_*`, drops writes/destructive and unrecognized names.

**Integration:**

- `sendLlmResponse`: risky turn → verifier invoked, text delivered via `reply.formatted`;
  **normal confident turn → verifier NOT invoked**, `result.text` passed through unchanged.
- Proactive path: now-async `finalizeAndLog` routes through the shared helper; 3 callers still deliver correctly.

**Prompt pillar:** lightweight assertion that `WORKFLOW` step 4 carries the sharpened wording (regression guard).

Follow `tests/CLAUDE.md` (DI-first, `mockLogger()`, `setupTestDb()`, no fixed-wall-clock timing).

## Touch points summary

| File                                            | Change                                                     |
| ----------------------------------------------- | ---------------------------------------------------------- |
| `src/completion/verified-completion.ts`         | **New** — `buildVerifiedCompletion`, `selectReadOnlyTools` |
| `src/system-prompt.ts`                          | Sharpen `WORKFLOW` step 4 wording                          |
| `src/llm-orchestrator-support.ts`               | Risky-turn branch in `sendLlmResponse`; inject `verifier`  |
| `src/llm-orchestrator.ts`                       | Construct verifier deps; thread into `sendLlmResponse`     |
| `src/deferred-prompts/proactive-llm-helpers.ts` | `finalizeDeliveryText`/`finalizeAndLog` async + verify     |
| `src/deferred-prompts/proactive-llm.ts`         | `await` the 3 callers                                      |
| `tests/completion/verified-completion.test.ts`  | **New** — unit tests                                       |
| `tests/**` (orchestrator + proactive)           | Integration coverage                                       |
