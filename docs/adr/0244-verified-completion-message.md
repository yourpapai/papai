<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0244: Verified Completion Message

## Status

Implemented (with divergence)

## Date

2026-07-01

## Context

The bot replied with a bare `Done.` whenever an LLM turn ended with no text. This happened in two places: the **interactive path** (`sendLlmResponse`, then in `src/llm-orchestrator-support.ts`) fell back to `'Done.'` when `result.text` was `undefined`/`''`, and the **proactive path** (`finalizeDeliveryText`/`finalizeAndLog` in `src/deferred-prompts/proactive-llm-helpers.ts`) returned `'Done.'` on empty text **or** a `finishReason === 'tool-calls'` step-cap truncation. Root cause: concise newer models often skip the post-tool verbal summary even though `WORKFLOW` step 4 in `src/system-prompt.ts` already asked for a "concise confirmation." The bare `Done.` is worst in the **step-cap truncation** case, where the turn was cut off mid-action but `Done.` still asserts success — i.e. it lies to the user.

The design (`docs/superpowers/specs/2026-07-01-verified-completion-message-design.md`) and plan (`docs/superpowers/plans/2026-07-01-verified-completion-message.md`) wanted to change this with a two-pillar approach:

1. **Pillar A — sharpen the prompt** so most turns end with a real, in-language confirmation (cheap common case).
2. **Pillar B — verify-and-report fallback** (the trust guarantee): on **risky turns only** (empty text ∨ `tool-calls` truncation ∨ a tool failure in the turn), run a second constrained LLM call that verifies the request actually happened and reports truthfully. Verification degrades gracefully: read-back via a read-only tool subset is primary, self-check over the turn's tool results is the fallback, and a neutral honest message is the last resort. Normal turns (confident text, clean finish, no failures) are trusted — no second call (cost control).

## Decision Drivers

- **Never claim success we have not confirmed.** ("Must not lie.") The bare `Done.` after a truncated or partially-failed turn is provably false.
- **Risky-only, cost-bounded second call.** The verifier fires only on the three risky triggers; it runs with a small `maxSteps` cap (4) and a structurally read-only toolset, so it cannot mutate or double-execute.
- **Read-only allowlist is safety-critical.** `selectReadOnlyTools` filters the context's assembled tools through `get_`/`list_`/`search_` prefixes and drops anything unrecognized — the verifier structurally cannot call a write/destructive tool.
- **Degradation ladder, never a false "Done."** Read-back → self-check → neutral honest message (`unconfirmed`); verifier output is never itself re-verified (no recursion).
- **One shared helper for both paths.** `buildVerifiedCompletion` is DI-first and testable in isolation; both the interactive orchestrator and the proactive deferred-delivery path route through it.
- **Prompt sharpening handles the common case.** Tightening `WORKFLOW` step 4 so the model names what it did keeps the fallback from firing on normal turns.
- **Truncation must say what is done and offer "continue."** A truncated turn must not assert completion; it summarizes what finished and suggests the user say "continue."

## Considered Options

### Option 1 — Hybrid: prompt sharpening + verify-and-report fallback on risky turns (chosen)

Sharpen `WORKFLOW` step 4 (Pillar A), and add a new `src/completion/verified-completion.ts` module whose `buildVerifiedCompletion` runs a constrained second LLM call only on risky turns (Pillar B). Both the interactive and proactive paths inject the same verifier deps.

- **Pros:** the prompt handles the common case cheaply; the verifier is the trust guarantee for the rare risky turn; read-only allowlist makes the second call structurally safe; the degradation ladder never emits a false "Done"; DI-first module is unit-testable without network.
- **Cons:** a second LLM call on every risky turn is extra latency + cost; requires threading a `verifier` dep through both the interactive and proactive call chains; the verifier depends on the same provider/BYOK resolution as the main turn.

### Option 2 — Prompt sharpening only

Rely solely on tightening `WORKFLOW` step 4 to make the model always produce a real confirmation; drop the verify-and-report fallback.

- **Pros:** no extra LLM call, no new module, no dep threading; minimal surface.
- **Cons:** rejects the headline "must not lie" driver — a truncated or partially-failed turn can still end with no text or a false assertion, and the prompt cannot structurally guarantee honesty; offers no recovery when the model omits the summary.

### Option 3 — Always run the verifier

Run the verification second call on every turn, not just risky ones.

- **Pros:** uniform path; every reply is verified.
- **Cons:** rejected on cost grounds — doubles the LLM call count for every normal turn that already ended with a confident, correct confirmation; violates the cost-guard driver.

## Decision

The chosen Option 1 shipped in full across the new completion module, the prompt sharpening, and both the interactive and proactive wiring paths. All five plan-task commit messages landed verbatim. What shipped:

1. **New module `src/completion/verified-completion.ts`.** `selectReadOnlyTools` (read-only prefix filter, returns `undefined` when none match), `detectToolFailure` (defensive recursive scan of tool-result messages for a `ToolFailureResult`), and `buildVerifiedCompletion` (builds a verifier prompt, runs `invokeVerifier`, maps to a verdict, degrades to a neutral honest message on throw/empty). Declares the `CompletionVerdict` taxonomy (`confirmed`/`truncated`/`partial`/`failed`/`unconfirmed`) and `VERIFIER_MAX_STEPS = 4`.
2. **Prompt sharpening (Pillar A).** `src/system-prompt.ts` `WORKFLOW` step 4 changed from "Reply with a concise confirmation" to "...a concise confirmation that names what you did — the affected item(s) and the change — in the user's language."
3. **Interactive wiring.** `sendLlmResponse` computes `isRisky` (empty text ∨ `tool-calls` ∨ tool failure) and routes risky turns through `buildVerifiedCompletion`; the verifier deps are built in `invokeWithLiveStatus` from the main turn's model + read-only toolset.
4. **Proactive wiring.** `finalizeAndLog` is async and verification-aware; a `buildProactiveVerification` helper constructs the verifier from the proactive path's deps; the full-delivery path routes risky turns through it.
5. **Tests.** Unit tests for the completion module, a regression guard for the sharpened prompt, an interactive-path wiring test (risky → verifier invoked; normal → not invoked), and a proactive-path verification test.

## Consequences

### Positive

- A risky turn (truncated, partially failed, or empty text) now produces a truthful, in-language completion message instead of a bare `Done.` — the bot no longer asserts success it has not confirmed.
- The verifier's read-only toolset is structurally incapable of mutating state or double-executing a write, so the second call cannot cause harm.
- Normal confident turns are trusted and incur no second call, so cost stays flat for the common case.
- The degradation ladder guarantees a safe honest message even when the verifier itself throws, times out, or returns empty — never a false "Done."
- The prompt sharpening makes most turns self-confirming, so the fallback rarely fires.
- The shared DI-first helper keeps the interactive and proactive paths on one codepath, unit-testable without network.

### Negative

- **A risky turn now pays a second LLM round-trip** (latency + tokens), bounded by the 4-step cap.
- **The proactive path wires only the full-delivery mode.** The plan named three proactive call sites; the shipped tree consolidated them, so the lightweight/context modes that the plan referenced no longer exist as separate verifiable paths (see Implementation Notes).
- **The `failed` verdict is declared but unreachable.** `deriveVerdict` only ever returns `confirmed`/`truncated`/`partial`; the `failed` member of the union is dead unless a future caller sets it.
- **The behavior doc does not yet describe this feature** (`docs/architecture/behaviors.md` has no verified-completion entry), unlike the release-announcements precedent.

### Risks

- **Verifier depends on the same provider/BYOK resolution as the main turn.** If the provider is down, the verifier degrades to the neutral fallback (recoverable, logged `warn`), but the user gets a generic message rather than a confirmed summary.
- **The read-only allowlist is name-prefix-based.** A tool whose name starts with `get_`/`list_`/`search_` but is actually mutating would slip through; this relies on the tool-naming convention being upheld across task providers and plugins.
- **Verifier prompt wording is a tuning surface.** The truncation wording was already softened post-plan; further rewording could drift from the "say continue" intent.

## Related Decisions

- **ADR-0242: Follow-up Coding Sessions** — same `2026-07-01` batch; the "continue" affordance in the truncated verdict complements the follow-up-coding-session resume flow.
- **ADR-0218: papai ACP Plugin** — ACP coding-session completion messages share the same "never assert unconfirmed success" trust concern, though this ADR's scope is the task-tracker orchestrator, not the ACP plugin.
- **ADR-0210: Agent Interruption and Steering** — the live-status placeholder dismissal (`beforeFirstMessage`) bridges the gap between the last tool status and the verified reply, related to the live-status surfaces introduced there.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`; the core commit messages match the plan verbatim.

| File | Role | Evidence |
| --- | --- | --- |
| `src/completion/verified-completion.ts:16-36` | `selectReadOnlyTools` (`get_`/`list_`/`search_` prefix filter, `undefined` when none) + `detectToolFailure` (recursive `ToolFailureResult` scan). | `read` confirms. |
| `src/completion/verified-completion.ts:58-79` | `buildVerifierPrompt` — verifier system prompt incl. truthfulness, same-language, read-back-may rules; truncation branch offers "continue". | `read` confirms. |
| `src/completion/verified-completion.ts:91-113` | `buildVerifiedCompletion` — runs `invokeVerifier`, maps verdict, degrades to `NEUTRAL_FALLBACK` on throw/empty (`unconfirmed`). | `read` confirms. |
| `src/llm-orchestrator-send.ts:26-41` | `resolveFinalText` — `isRisky` gate (empty ∨ `tool-calls` ∨ failure) routes to `buildVerifiedCompletion`, else trusts model text / `Done.`. | `read` confirms. |
| `src/llm-orchestrator-send.ts:58-81` | `sendLlmResponse` (extracted module) — risky-turn branch, `beforeFirstMessage` live-status dismissal, reply-target capture. | `read` confirms. |
| `src/llm-orchestrator-support.ts:232-249` | `invokeWithLiveStatus` builds the verifier inline (`selectReadOnlyTools`, `generateText`, `VERIFIER_MAX_STEPS`) and threads `{ verifier, history }` into `sendLlmResponse`. | `read` confirms. |
| `src/deferred-prompts/proactive-llm-helpers.ts:27-48` | `buildProactiveVerification` (lives here, not in `proactive-llm.ts`) constructs the proactive verifier. | `read` confirms. |
| `src/deferred-prompts/proactive-llm-helpers.ts:110-136` | `finalizeAndLog` is async + verification-aware; `isRisky` gate routes to `buildVerifiedCompletion`. | `read` confirms. |
| `src/deferred-prompts/proactive-llm.ts:122-126` | `runFullGeneration` wires `buildProactiveVerification` into `finalizeAndLog` — the only remaining call site. | `read` confirms. |
| `src/system-prompt.ts:111` | `WORKFLOW` step 4 sharpened to "names what you did — the affected item(s) and the change — in the user's language." | `grep` confirms. |
| `tests/completion/verified-completion.test.ts:44-155` | Unit tests: `selectReadOnlyTools`, `detectToolFailure`, `buildVerifiedCompletion` (confirmed/truncated/partial/unconfirmed×2). | `read` confirms. |
| `tests/llm-orchestrator-send.test.ts:22-58` | `sendLlmResponse` wiring: risky → verifier invoked + text delivered; normal → verifier NOT invoked. | `read` confirms. |
| `tests/system-prompt-workflow.test.ts:18-21` | Regression guard: prompt contains "names what you did". | `read` confirms. |
| `tests/deferred-prompts/proactive-llm-helpers.test.ts:78-99` | `finalizeAndLog` verification: empty text + verification → verified text; no verification → legacy `Done.`. | `read` confirms. |
| commit `e45548c23` | `feat(completion): read-only tool filter + tool-failure detection` (Task 1). | `git log -S` confirms. |
| commit `6f2f37f7d` | `feat(completion): buildVerifiedCompletion verify-and-report core` (Task 2). | `git log -S` confirms. |
| commit `ad19fa39d` | `feat(orchestrator): route risky interactive turns through verify-and-report` (Task 3). | `git log -S` confirms. |
| commit `fd6ca5ac6` | `feat(system-prompt): make the post-action confirmation name what was done` (Task 4). | `git log -S` confirms. |
| commit `afd7f0fc3` | `feat(proactive): route risky deferred deliveries through verify-and-report` (Task 5). | `git log -S` confirms. |
| commit `02c2caedd` | `fix(live-status): bridge gap between tool status and reply with a placeholder` (post-plan enhancement). | `git log -S` confirms. |

Plan-vs-implementation notes:

- **`sendLlmResponse` was extracted to its own module.** The plan modified `sendLlmResponse` inside `src/llm-orchestrator-support.ts`; the shipped tree moves it to a new `src/llm-orchestrator-send.ts` (imported back at `llm-orchestrator-support.ts:21`). The risky-turn logic lives in a `resolveFinalText` helper in that new module. Intent unchanged.
- **`sendLlmResponse` gained a 6th parameter `beforeFirstMessage`.** The plan's signature took 5 args; shipped (`llm-orchestrator-send.ts:58-66`) adds an optional `() => Promise<void>` that dismisses the live-status placeholder right before the first reply posts, added by the post-plan commit `02c2caedd`. `invokeWithLiveStatus` passes `() => liveStatus.dismiss()` as that 6th arg.
- **The interactive verifier is built inline, not via a shared builder.** The plan built the verifier in `invokeWithLiveStatus` (Task 3) and a separate `buildProactiveVerification` for the proactive path (Task 5). Shipped keeps the interactive verifier inline in `invokeWithLiveStatus` (`llm-orchestrator-support.ts:232-245`) and uses `hoistSystemMessages(system, messages)` + `collectTurnMessages(result)` instead of the plan's separate `system`/`messages` and `result.response.messages`. Behavior is equivalent.
- **`buildProactiveVerification` lives in the helpers module, not `proactive-llm.ts`.** The plan added it to `src/deferred-prompts/proactive-llm.ts`; shipped defines and exports it from `src/deferred-prompts/proactive-llm-helpers.ts:27-48` (imported into `proactive-llm.ts:18-27`). It takes a typed `{ generateText, stepCountIs }` deps view rather than the plan's `Pick<ProactiveLlmDeps, ...>`.
- **`finalizeAndLog` dropped the `mode` argument.** The plan signature was `(result, userId, mode, verification?)` with `mode: ExecutionMetadata['mode']`; shipped (`proactive-llm-helpers.ts:110-114`) is `(result, userId, verification?)` — `mode` is gone and the `ExecutionMetadata` import for it was removed. The single caller no longer passes a mode.
- **Only one of the three planned proactive call sites exists.** The plan referenced `invokeLightweight` (~line 133), `invokeWithContext` (~line 180), and `runFullGeneration` (~line 249) in `proactive-llm.ts`. The shipped `proactive-llm.ts` contains only `runFullGeneration` (line 122); `invokeLightweight`/`invokeWithContext` do not exist (`grep` for both returns nothing under `src/deferred-prompts/`). The lightweight/context delivery modes were consolidated out, so verification covers only the full-delivery path.
- **The truncation prompt wording was softened post-plan.** The plan's branch said "The turn stopped because it reached the tool-step limit before finishing...say continue to resume." Shipped (`verified-completion.ts:70`) reads "This turn did a lot of work but ran out of room before fully finishing...you may offer that the user can say 'continue'..." — less limit-focused, "continue" framed as optional. The unit test was updated to assert `what remains` + `continue` and to assert the old phrasing is **absent**.
- **The `failed` verdict is declared but unreachable.** `deriveVerdict` (`verified-completion.ts:81-85`) returns only `truncated`/`partial`/`confirmed`; `failed` remains in the `CompletionVerdict` union but no code path produces it. `unconfirmed` covers the verifier-failure case instead.
- **The unit test uses real `tool()` fixtures instead of the plan's `Object.fromEntries` fake,** and the `detectToolFailure` test wraps the failure in `{ type: 'json', value: failure }` to match the SDK's current tool-result shape. The interactive wiring test file is named `tests/llm-orchestrator-send.test.ts` (renamed to track the extracted module), not the plan's `tests/llm-orchestrator-support-completion.test.ts`, and gains extra `beforeFirstMessage` + reply-target-capture blocks. It asserts on `reply.textCalls` rather than the plan's `reply.formattedCalls`.
- **The prompt regression test seeds a migrated DB.** The plan's `system-prompt-workflow.test.ts` called `buildProviderlessSystemPrompt` directly; shipped adds `beforeEach(() => setupTestDb())` because `assembleSystemPrompt` now reads tool prefs from the DB.

The source plan `docs/superpowers/plans/2026-07-01-verified-completion-message.md` and design `docs/superpowers/specs/2026-07-01-verified-completion-message-design.md` are archived alongside this ADR to `docs/archive/`.
