# Silent completion for deferred prompts (no chat message when there is nothing to report)

## Goal

A scheduled/deferred prompt run must be able to finish with **NO delivery**: when the executing turn's final output is empty / whitespace-only / an explicit no-delivery marker, the pipeline sends nothing to the chat — no `Done.` stub, no verifier-manufactured service line (today `finalizeDeliveryText` maps empty output to `t('completion.doneFallback')` and `finalizeAndLog` routes empty text into the verifier, so a quiet check-style reminder still pings the user). This is the dual of #417's verified-completion contract: real model text is always delivered verbatim; nothing is delivered ONLY when the model intentionally produces no text. Silence is distinguishable from failure — an errored run still surfaces exactly as today, silence logs at debug level and never counts as an error.

## No-delivery contract (deliberate design decisions — assumptions stated so a maintainer can veto)

- Sentinel flows through the existing `Promise<string>` seam of `dispatchExecution` (no signature changes): a documented marker `[NO_DELIVERY]` returned as the delivery text; the two poller call sites are the only consumers of `dispatchExecution` (verified: poller.ts:65, poller-alerts.ts:83).
- `isNoDeliveryText(text)`: true when `text.trim()` is empty **or** equals `[NO_DELIVERY]` exactly (strict trimmed equality — prose around the marker means the model had something to say and is delivered verbatim).
- Silence applies in `finalizeAndLog` only when the turn is otherwise complete: `finishReason !== 'tool-calls'` AND no tool failure (`detectToolFailure`). Truncated turns (pending tool call, step cap) and tool-failure turns keep today's warn + verify-then-deliver path — silence never masks failure. No-tool-activity is NOT required: a silent check that ran read tools and found nothing is exactly the target case.
- Silence wins **before** the verifier: empty output must not trigger `buildVerifiedCompletion` (that verifier pass is what manufactures the parenthetical service line today). This intentionally removes the legacy empty→`Done.`/verified fallback for the proactive path; the interactive chat path (`src/llm-orchestrator-send.ts`) is untouched.
- Reachability by the executing LLM: `buildProactiveTrigger` (`src/deferred-prompts/proactive-trigger.ts`) gains one rule in its `[PROACTIVE EXECUTION]` rules block: if the prompt's result is “nothing to report” (prompt says to stay silent when there is nothing new), reply with exactly `[NO_DELIVERY]` and nothing else — no message will be sent. Marker text stays verbatim ASCII, not localized.
- Scheduled (`executeScheduledPromptsForGroup`, src/deferred-prompts/poller.ts): on sentinel — skip `sendProactiveMessage` and `recordProofGroupDelivery` (no delivered response exists to record), log debug (`promptIds` included, so the owner can audit the check ran and chose silence), still call `finalizeAllPrompts` (one-shots complete, recurring advance to the next occurrence) and still emit `deferred:fired` per prompt. A merged multi-prompt group finalizes wholly silent (one run, one verdict).
- Alerts (`fireAlertBatch`, src/deferred-prompts/poller-alerts.ts): on sentinel — skip send, log debug, still `markAlertsDelivered(fieldEvaluations, now, true)` + `markActivityDelivered(activityEvaluations, now, true)` so match state, activity cursor and cooldown advance (a silent alert must not re-fire every poll), and return `true` so `updateSnapshots` still consumes the change. Internal lifecycle events (`deferred:alerted`, `notify:deferred_alert`) still fire — they are event-bus observability, not chat delivery. Error path unchanged (pure-activity batches still send no error chatter and retry; field-alert batches still send the error notice).

## Files to touch

- **New** `src/deferred-prompts/no-delivery.ts` — `NO_DELIVERY_MARKER` + `isNoDeliveryText` (tiny shared module; imported by proactive-llm-helpers, proactive-trigger, poller, poller-alerts; avoids import cycles).
- `src/deferred-prompts/proactive-llm-helpers.ts` — `finalizeAndLog`: compute turn messages/tool-failure unconditionally, add the silence branch (debug log, return sentinel) before the verifier block; `finalizeDeliveryText` unchanged.
- `src/deferred-prompts/proactive-trigger.ts` — the marker rule in the trigger rules block.
- `src/deferred-prompts/poller.ts`, `src/deferred-prompts/poller-alerts.ts` — sentinel early-exit branches as above; no refactors outside these seams.
- Tests: `tests/deferred-prompts/proactive-llm-helpers.test.ts` (silence contract: empty/whitespace/marker → sentinel with no verifier invocation; truncated + empty still verifies; tool failure still verifies; real text still verbatim; update the three existing tests that pin empty→verified/`Done.` on the no-verification legacy path), `tests/deferred-prompts/poller.test.ts` (repro: reminder whose output is the marker sends nothing yet completes/advances its schedule; empty output sends nothing; errored run still delivers the error notice; real text still delivered verbatim; alert silent run advances `lastTriggeredAt`/cursor without a message).
- Docs: `docs/architecture/behaviors.md` — amend the verified-completion entry and the deferred-prompts bullets with the silence contract.

## Verification

Repro tests first (red): poller test asserting `sentMessages` stays empty for a marker/empty-output run while the prompt completes/advances. Then implement; `bun run test tests/deferred-prompts/`, then full `bun run test` + `bun check:full` green before finish. End with a short report: seam findings, what changed, anything suspicious (e.g. proof-check recording interplay, merged-group silence semantics).

## Non-goals (route declined scope here)

- Interactive chat turns keep the empty→verifier/`Done.` behavior (`llm-orchestrator-send.ts` untouched).
- No delivery_brief schema change, no new DB state or migrations, no localization of the marker, no retry/backoff on empty output, no changes to verifier prompts or verdict taxonomy beyond the proactive silence carve-out.

## Capability

- New: `deferred-prompt-silent-completion` — the delivery contract for deferred-prompt runs (marker reachability, silence-vs-failure boundary, schedule/cursor advancement on silence, debug-level auditability). Nothing in `openspec/specs/` covers deferred-prompt delivery today, so this is a new capability only.
