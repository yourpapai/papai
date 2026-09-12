# Tasks: honest-degraded-turn-messaging

## 1. Activity predicate and `no-op` verdict

- [x] 1.1 Write failing tests in `tests/completion/verified-completion.test.ts`: `turnHasToolActivity` (tool-result message → true; assistant-only history → false); `deriveVerdict` matrix — empty text + no activity → `no-op`; empty text + activity → `confirmed` path unchanged; `finishReason: 'tool-calls'` beats `no-op` (truncated); tool failure beats `no-op` (partial); non-empty text + no activity stays `confirmed`. Verify: `bun test tests/completion/verified-completion.test.ts` (expect fail)
- [x] 1.2 Implement: add `turnHasToolActivity` beside `detectToolFailure`, add `hadToolActivity` to `CompletionTurn`, extend `CompletionVerdict` with `'no-op'`, apply the derivation order from design D2. Verify: `bun test tests/completion/verified-completion.test.ts`

## 2. Honest last-resort fallbacks

- [x] 2.1 Write failing tests: in `tests/completion/verified-completion.test.ts` — verifier-empty with `hadToolActivity: true` → existing `neutralFallback` text; verifier-empty with `hadToolActivity: false` → the new no-op message; verifier-throw matrix likewise; both return verdict `unconfirmed`. In `tests/completion/verified-completion-locale.test.ts` — ru and en no-op strings match the dictionary exactly. Verify: `bun test tests/completion/` (expect fail)
- [x] 2.2 Implement: add `noopFallback` to the completion dictionary type (`src/i18n/types.ts`) and both locales (wording per design D3), select the fallback by `hadToolActivity` at the two fallback returns in `buildVerifiedCompletion`. Verify: `bun test tests/completion/`
- [x] 2.3 Fill `hadToolActivity` at both call sites — `sendLlmResponse` (`src/llm-orchestrator-send.ts`) and `finalizeAndLog` (`src/deferred-prompts/proactive-llm-helpers.ts`) — from the messages they already collect; extend `tests/deferred-prompts/proactive-llm-helpers.test.ts` with a no-op-verification case. Verify: `bun test tests/deferred-prompts/proactive-llm-helpers.test.ts tests/llm-orchestrator-send.test.ts`

## 3. Verifier read-only set includes `read_`

- [x] 3.1 Write failing test in `tests/completion/verified-completion.test.ts` (`selectReadOnlyTools`): keeps `read_recent_logs`-style names, still drops create/update/delete names, still returns `undefined` when nothing matches. Verify: `bun test tests/completion/verified-completion.test.ts` (expect fail)
- [x] 3.2 Add `'read_'` to `READ_ONLY_PREFIXES` in `src/completion/verified-completion.ts` (design D4; `expand_result` stays excluded). Verify: `bun test tests/completion/verified-completion.test.ts`

## 4. Truthful send logging

- [x] 4.1 Write failing test in `tests/llm-orchestrator-send.test.ts`: the "Response sent successfully" meta carries `sentTextLength` equal to the delivered text length and `modelTextLength` (renamed from `responseLength`) equal to the model's own final text length; a verifier-delivered ~1200-char reply with empty model text logs `sentTextLength ≈ 1200, modelTextLength: 0`; the step-cap warn carries the same fields. Verify: `bun test tests/llm-orchestrator-send.test.ts` (expect fail)
- [x] 4.2 Implement the rename + `sentTextLength: textToFormat.length` in `src/llm-orchestrator-send.ts`; sweep for other readers of the old field name. Verify: `bun test tests/llm-orchestrator-send.test.ts`

## 5. Full verification and docs

- [x] 5.1 Update the verified-completion behavior in `docs/architecture/behaviors.md`: `no-op` verdict, activity-based fallbacks, `read_` verifier tools, send-log fields. Verify: `bun run lint`
- [x] 5.2 Run the full gate: `bun run test`, `bun run typecheck`, `bun run lint`; fix fallout, then `bun run test:mutate:changed` for the touched `src/` files and ratchet the mutation baseline if scores regressed. Verify: `bun run test && bun run typecheck && bun run lint`
