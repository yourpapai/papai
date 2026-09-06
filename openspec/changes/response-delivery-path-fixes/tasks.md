# Tasks: Response delivery path fixes (issue #417)

One group per MR, ordered by dependency (bug 1 → 2 → 3 → 4). Every bug lands test-first: the failing test is written before the implementation that passes it. Design decisions: see design.md (D1–D4). Bug 4 is optional — only after bugs 1–3, and may be skipped if the run is consumed (say so in the final report).

## 1. Bug 1 — verifier empty/error must not discard the model answer (critical)

- [x] 1.1 Red test in `tests/completion/verified-completion.test.ts` (DI `invokeVerifier` stub): a verifier returning `''` or whitespace-only text — and a verifier that throws — on a turn with non-empty `turn.finalText` must deliver `turn.finalText` with the derived verdict; a turn with empty/undefined `finalText` still gets the activity-selected stub with verdict `unconfirmed`. Verify: `bun test tests/completion/verified-completion.test.ts` (new cases fail red)
- [x] 1.2 Implement the rule in `buildVerifiedCompletion` (`src/completion/verified-completion.ts`): on the verifier-empty and verifier-throw legs return `turn.finalText` when non-empty (derived verdict kept; warn names the delivered source); the stub fires only when the model produced no text. Do not touch `isRisky`, `deriveVerdict`, or the verifier prompt/toolset. Verify: `bun test tests/completion/verified-completion.test.ts`
- [x] 1.3 Call-path assertions in `tests/llm-orchestrator-send.test.ts` and `tests/deferred-prompts/proactive-llm-helpers.test.ts`: a failing verifier on a risky turn that has model text delivers the model text on both the interactive (`resolveFinalText`) and proactive (`finalizeAndLog`) paths. Verify: `bun test tests/llm-orchestrator-send.test.ts tests/deferred-prompts/proactive-llm-helpers.test.ts`
- [x] 1.4 Bug 1 MR gate: `bun run test:affected`, then `bun run test:mutate:changed` (ratchet baseline update only on a true regression)

## 2. Bug 2 — verifierOutcome surfacing and trace visibility

- [x] 2.1 Red test in `tests/completion/verified-completion.test.ts`: `VerifiedCompletion` carries `verifierOutcome` — `'ok'` when the verifier produced text, `'empty'` for `undefined`/`''`/whitespace-only, `'error'` when it threw. Verify: `bun test tests/completion/verified-completion.test.ts`
- [x] 2.2 Red test in `tests/debug/schemas.test.ts` (`schemaValidates()`): `LlmTraceSchema` accepts an optional `verifierOutcome` enum (`'ok' | 'empty' | 'error'`) and rejects unknown values. Verify: `bun test tests/debug/schemas.test.ts`
- [x] 2.3 Red test in `tests/debug/llm-trace-collector.test.ts`: a follow-up `llm:verifier` debug event applies `verifierOutcome` to the turn's most recent trace — exact user+turnId match, most-recent fallback for turn-less emitters, per-user cap pruning of the trace registry, re-broadcast through `broadcastTrace`. Verify: `bun test tests/debug/llm-trace-collector.test.ts`
- [x] 2.4 Implement: `verifierOutcome` on `VerifiedCompletion` (`src/completion/verified-completion.ts`); optional field in `LlmTrace` (`src/debug/llm-trace-collector.ts`) and `LlmTraceSchema` (`src/debug/schemas.ts`); the `llm:verifier` branch in `handleLlmTraceEvent` with the user+turnId-keyed trace registry and re-broadcast. Verify: `bun test tests/completion/verified-completion.test.ts tests/debug/llm-trace-collector.test.ts tests/debug/schemas.test.ts`
- [x] 2.5 Wire the call sites: thread `turnId` from `src/llm-orchestrator-support.ts` into `sendLlmResponse` (`src/llm-orchestrator-send.ts`) and through `finalizeAndLog` (`src/deferred-prompts/proactive-llm-helpers.ts`, caller `src/deferred-prompts/proactive-llm.ts`); emit `llm:verifier` via `emitUser` with the path's own scope and `turnId`; surface `verifierOutcome` in the call-site logs. Verify: `bun test tests/llm-orchestrator-send.test.ts tests/deferred-prompts/proactive-llm-helpers.test.ts`
- [x] 2.6 Bug 2 MR gate: `bun run test:affected`, then `bun run test:mutate:changed`

## 3. Bug 3 — Telegram chunked delivery

- [x] 3.1 Red test in new `tests/chat/telegram/chunking.test.ts` (mirroring `tests/chat/discord/format-chunking.test.ts`): default limit is `telegramTraits.maxMessageLength` (4096); paragraph boundary preferred, then line, then hard cut; every chunk within the limit; an oversize single line terminates (no infinite loop); joined chunks preserve text and order; custom `maxLen` honored. Verify: `bun test tests/chat/telegram/chunking.test.ts` (fails red — module missing)
- [ ] 3.2 Implement `chunkForTelegram(text, maxLen)` in new `src/chat/telegram/chunking.ts`: pure splitter with guaranteed progress (hard cut is the floor). Verify: `bun test tests/chat/telegram/chunking.test.ts`
- [ ] 3.3 Red tests in `tests/chat/telegram/reply-helpers.test.ts` and `tests/chat/telegram/index.test.ts`: over-limit `sendFormattedReply` sends ordered in-bounds chunks with the same reply params and per-chunk entities (entities spanning a cut dropped, `shiftTelegramEntity` shifts the rest) and returns the last successful `{messageId, chatId}`; a failing chunk logs a warn and later chunks still send; the at-or-under-limit path is unchanged; deferred `sendMessage` chunks with the mention prefix on the first chunk only. Verify: `bun test tests/chat/telegram/reply-helpers.test.ts tests/chat/telegram/index.test.ts` (new cases fail red)
- [ ] 3.4 Implement chunked sends: entity-windowing helper alongside the splitter; apply in `sendFormattedReply` (`src/chat/telegram/reply-helpers.ts`) and deferred `sendMessage` (`src/chat/telegram/index.ts`); `src/chat/telegram/reply-fn-builder.ts` needs no change (`lastReplyTarget` flows from the return). Verify: `bun test tests/chat/telegram/chunking.test.ts tests/chat/telegram/reply-helpers.test.ts tests/chat/telegram/index.test.ts tests/chat/telegram/reply-fn-builder.test.ts`
- [ ] 3.5 If `tests/stories/chat/telegram-reply-fn.story.test.ts` pins single-send `formatted` behavior, extend it for ordered chunked delivery. Verify: `bun test:stories`
- [ ] 3.6 Bug 3 MR gate: `bun run test:affected`, then `bun run test:mutate:changed`

## 4. Bug 4 (optional — only after bugs 1–3) — embedding sweep retry and dead-letter

- [ ] 4.1 Red tests in `tests/message-embedding-sweep.test.ts`: `SweepDeps` gains an injectable `sleep`; a transient `embedMany` failure retries (2 retries with backoff) and then stores; a permanent failure leaves rows pending after retries with the warn enriched by the provider error class; rows exhausted N times are excluded from the next batch; the sweep log reports the dead-lettered count; the failure map is capped. Verify: `bun test tests/message-embedding-sweep.test.ts` (new cases fail red)
- [ ] 4.2 Implement in `src/message-embedding-sweep.ts`: provider error-class enrichment, bounded retry with the injected sleep, capped in-memory failure map keyed by (`contextId`, `messageId`) with batch filtering; `src/message-cache/vector-store.ts` stays unchanged. Verify: `bun test tests/message-embedding-sweep.test.ts`
- [ ] 4.3 Bug 4 MR gate: `bun run test:affected`, then `bun run test:mutate:changed`

## 5. Docs and full verification

- [ ] 5.1 Update `docs/architecture/behaviors.md`: the verified-completion bullet (fallback rule now delivers the model's answer on verifier empty/error, plus `verifierOutcome`), a Telegram chunked-delivery bullet, and — if bug 4 landed — the sweep retry/dead-letter note. Verify: `bun run lint`
- [ ] 5.2 Final gate over the whole change: `bun run test` && `bun run typecheck` && `bun run lint` (or the combined `bun check:full`), then `bun run test:mutate:changed` with a ratchet baseline update if a touched file regressed; finish the report noting anything skipped (bug 4) or still suspicious (verifier-empty root cause)
