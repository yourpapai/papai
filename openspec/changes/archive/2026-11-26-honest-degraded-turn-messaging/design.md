# Design: honest-degraded-turn-messaging

## Context

`src/completion/verified-completion.ts` owns verdict derivation (`deriveVerdict`: `truncated`/`partial`/`confirmed`), the verifier prompt, and last-resort handling: verifier empty/throw → one locale-string `neutralFallback` ("I ran the requested actions but could not confirm…") that is false when nothing ran. `selectReadOnlyTools` filters by `READ_ONLY_PREFIXES = ['get_','list_','search_']`, excluding the `read_`-prefixed diagnostics readers. `sendLlmResponse` (`src/llm-orchestrator-send.ts:75`) logs `responseLength = result.text.length`, which reads 0 whenever the verifier's text was actually delivered. Both reply paths (interactive `sendLlmResponse`, proactive `finalizeAndLog`) route through the one `buildVerifiedCompletion`. `CompletionVerdict` has no consumers outside the module and `tests/completion/`. See `proposal.md` — Why.

## Goals / Non-Goals

**Goals:** fact-based last-resort messages and verdicts; verifier able to read diagnostics readers; send log that matches what the user received.

**Non-Goals:** retry of main or verifier calls (owned by `disclosure-tool-call-repair`); verifier prompt rewording; locales beyond en/ru; analytics events for verdicts.

## Decisions

### D1: Activity predicate, not new plumbing

Add `turnHasToolActivity(messages)` next to `detectToolFailure` (same file, same scan shape: any `role: 'tool'` message with a tool-result part). It is derived from the same turn messages `sendLlmResponse` already collects via `collectTurnMessages` — no new data flow. `CompletionTurn` gains `hadToolActivity: boolean`; both call sites (`sendLlmResponse`, `finalizeAndLog`) already hold the collected messages when they compute `hadToolFailure`, so the flag is filled at the same spot.

Alternative rejected: inferring activity from `toolCalls.length > 0` — calls that were dropped/invalid leave call parts but no results; "executed" is the honest signal.

### D2: `no-op` verdict precedes `confirmed` in derivation

`deriveVerdict` order becomes `truncated` → `partial` → `no-op` (empty text ∧ `!hadToolActivity`) → `confirmed`. `truncated` keeps priority: a step-capped turn with no executed results is still "cut off mid-work", the more actionable fact. The `no-op` turn with verifier-produced text returns verdict `no-op` with that text (verdict describes turn shape, not verification outcome — same as `partial` today).

### D3: Split dictionary strings, exact wording

- Keep `neutralFallback` for the activity case, wording unchanged ("ran … could not confirm") — it is honest there and its locale tests stay valid.
- Add `noopFallback` per locale: ru — «Похоже, в этот раз я ничего не выполнил — ход прервался. Пожалуйста, повтори запрос.»; en — "It looks like nothing was actually executed this turn — it cut off. Please repeat your request."
- Selection lives in `buildVerifiedCompletion` at the two existing fallback returns (empty text, throw): `hadToolActivity ? neutralFallback : noopFallback`. Both carry verdict `unconfirmed` as today.
- Dictionary type (`src/i18n/types.ts`) gains the key; `tests/completion/verified-completion-locale.test.ts` gains a no-op-locale case.

### D4: One-prefix extension of the read-only set

`READ_ONLY_PREFIXES` becomes `['get_','list_','search_','read_']`. The four diagnostics readers are read-only by construction and reach the set only when already assembled for the turn (fail-closed admin/DM/normal gate upstream), so no new gating is needed; `toolsContext` for the verifier is already built from the filtered set in `invokeWithLiveStatus`. `expand_result` (no matching prefix) stays excluded — the verifier must not page through compacted payloads; recorded as declined.

### D5: Send log gains `sentTextLength`

In `sendLlmResponse`, keep the model-side field but rename for clarity — `modelTextLength` (was `responseLength`) — and add `sentTextLength: textToFormat.length`. Both in the same `meta` object on "Response sent successfully" and the step-cap warn. No other log sites duplicate this signal.

## Risks / Trade-offs

- [Wording churn breaks string-exact tests] → `verified-completion-locale.test.ts` and the empty-text/throw cases in `verified-completion.test.ts` are updated in the same task as the dictionary change; TDD order below writes the new expectations first.
- [`no-op` enum value surprises an unknown consumer] → Verified: no consumers outside the module and its tests; the type is not exported into analytics or client code.
- [Honest "nothing was executed" message reads like a bot failure to users] → Accepted; a truthful failure report is the contract. The message asks for a repeat, which is the cheapest recovery.
- [`read_` prefix broadens verifier surface] → Only for names already in the turn's gated toolset; read-only by construction; `ask` wrappers survive into the verifier set exactly as on the main path.

## Scope / Gating / Persistence

No persisted state, no DB migration, no scope-model change — the locale resolves per config context exactly as today (`getContextLanguage` on the config-context id; group-shared language config unchanged). No `tool_prefs` semantics change: the verifier set is a name-prefix subset of the already-resolved permissive set.

## TDD / Hook Interactions

Hook-gated files: `src/completion/verified-completion.ts`, `src/llm-orchestrator-send.ts`, `src/i18n/types.ts`, `src/i18n/locales/{en,ru}.ts`, plus tests under `tests/completion/` and `tests/llm-orchestrator-send.test.ts`. Order: (1) failing unit tests — `turnHasToolActivity`, `deriveVerdict` no-op matrix (including truncated-beats-no-op), fallback selection empty/throw × activity, `selectReadOnlyTools` `read_` inclusion/exclusion; (2) failing locale tests for `noopFallback` strings; (3) failing send-log test asserting `sentTextLength`/`modelTextLength`; then implementation, then the full-suite/typecheck/lint task.
