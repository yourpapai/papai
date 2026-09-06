# Response delivery path fixes (issue #417): verification → fallback → sendMessage

## Goal

Three live-confirmed bugs let a fully generated answer be replaced by a 94-char stub (bugs 1–2, 2026-09-06 08:09:58 UTC+5) or never delivered at all (bug 3, 07:53:48 / 08:00:08 UTC+5, "message is too long"); a fourth low-priority bug accumulates pending embedding rows (bug 4). Fix each with one small MR, TDD (red reproducing test → fix → green), no refactors outside these bugs. Fixes must stay consistent with issue #397 bug 1 (same seam on the proactive path): a degraded verification pass never discards the model's own answer; a generic stub is allowed only when there is genuinely no model text.

## Where the bugs live (explored)

- `buildVerifiedCompletion` (`src/completion/verified-completion.ts:101`) returns the activity-selected last-resort stub whenever the verifier returns empty (lines 112–115) or throws (118–124), regardless of `turn.finalText`. Both reply paths route through it: interactive `resolveFinalText` (`src/llm-orchestrator-send.ts:29`) and proactive `finalizeAndLog` (`src/deferred-prompts/proactive-llm-helpers.ts:121`).
- The main turn's trace record (`LlmTrace`, `src/debug/llm-trace-collector.ts`) is pushed by `emitLlmEnd` (`src/llm-orchestrator-invoke.ts:187`, `src/deferred-prompts/proactive-llm.ts:140`) before verification runs; the verifier call itself emits no trace, so verifier failure is invisible in the trace buffer.
- Telegram has no chunker: `sendFormattedReply` (`src/chat/telegram/reply-helpers.ts:217`) and deferred `sendMessage` (`src/chat/telegram/index.ts:140`) send one message and fail entirely above `maxMessageLength: 4096` (`src/chat/telegram/metadata.ts`). Discord already has the pattern (`src/chat/discord/format-chunking.ts`).
- `sweepContext` (`src/message-embedding-sweep.ts:51`) catches embed errors, logs, and leaves rows pending forever — no retry budget, no dead-letter.

## Bug 1 — fallback discards the generated answer (critical)

In `buildVerifiedCompletion`, on verifier empty OR verifier throw: if `turn.finalText` is a non-empty string, deliver `turn.finalText` (keep the derived `verdict`; log a warn with `verifierOutcome`). The stub (`neutralFallback`/`noopFallback` from `honest-degraded-turn-messaging`, already truthful per activity) fires only when `turn.finalText` is undefined/empty, verdict `unconfirmed` as today. The live case (1611-char model answer + empty verifier → 94-char stub, `sentTextLength: 94` vs `modelTextLength: 1611`) becomes: model answer delivered. Boundary with #397: this fixes the verifier-empty/error legs at the shared seam; the `isRisky` tool-failure routing decision (verifier-succeeds case) stays in #397's lane — do not change `isRisky` here beyond what this rule requires.

## Bug 2 — verifier returns empty text; verifier outcome in the trace

- Treat empty verifier output as "skip verification", never as "replace the answer": empty = `undefined`, `''`, or whitespace-only (`trim()`), which after bug 1 delivers the model text with a warn — reproduced by a test where the verifier returns `''`/`null` on a well-formed non-empty model answer. (Root-cause note: the verifier's own `generateText` can return empty when it ends on tool calls within `VERIFIER_MAX_STEPS = 4` or the provider returns empty content; the pipeline must be robust to any such cause.)
- `VerifiedCompletion` gains `verifierOutcome: 'ok' | 'empty' | 'error'`; both call sites surface it. Add optional `verifierOutcome` to `LlmTrace` (`src/debug/llm-trace-collector.ts`) and `LlmTraceSchema` (`src/debug/schemas.ts`); since `llm:end` pushes the trace before verification runs, attach the outcome to the turn's trace via the smallest correct seam (e.g. a follow-up debug event the collector applies to the turn's most recent trace, mirroring the existing legacy tool-result fallback pattern). `verifierOutcome` is metadata — safe under `shapeLlmTrace` anonymity shaping.

## Bug 3 — chunk long Telegram messages

- New `src/chat/telegram/chunking.ts` with `chunkForTelegram(text, maxLen = telegramTraits.maxMessageLength)` (≤4096): prefer paragraph boundary (`\n\n`), then line (`\n`), then hard cut; no infinite loop on oversize single lines. Tests in new `tests/chat/telegram/chunking.test.ts` mirroring `tests/chat/discord/format-chunking.test.ts`.
- Apply in `sendFormattedReply`: ≤ limit → today's single-send path unchanged; over limit → send chunks sequentially in order with the same reply params; keep entities valid per chunk (offset-shift/`shiftTelegramEntity` exists; drop entities spanning a cut) or re-format each markdown chunk if that is the smaller correct diff; a failed chunk logs a warn and the remaining chunks still send (never silently drop the rest); `lastReplyTarget` snapshots the last successfully sent message (single-chunk path unchanged).
- Apply the same helper in deferred `sendMessage` (`src/chat/telegram/index.ts:140`) — proactive answers fail identically; mention prefix on the first chunk only.
- Repro tests: >4096-char answer delivered as ordered in-bounds chunks; failure on one chunk does not drop later chunks.

## Bug 4 (low priority — only after 1–3) — embedding sweep retry + dead-letter

Investigate the batch-embed provider error first (enrich the warn with provider error class). Then bounded retry with exponential backoff in `sweepContext` (e.g. 2 retries) and a dead-letter path so permanently failing rows stop being retried forever (persisted failure marker on `message_embeddings` vs capped in-memory failure map — pick the smaller correct design; migration only if persisted). Rows exceeding N failures are excluded from `nextPendingBatchForContext` and surfaced in the sweep log. Tests in `tests/message-embedding-sweep.test.ts`. May be skipped if 1–3 consume the run — say so in the final report.

## Files to touch

- `src/completion/verified-completion.ts` (bugs 1–2); `src/llm-orchestrator-send.ts`, `src/deferred-prompts/proactive-llm-helpers.ts` (outcome surfacing); `src/debug/llm-trace-collector.ts`, `src/debug/schemas.ts` (trace field) — bug 2.
- `src/chat/telegram/chunking.ts` (new), `src/chat/telegram/reply-helpers.ts`, `src/chat/telegram/reply-fn-builder.ts` (only if needed for chunked lastReplyTarget), `src/chat/telegram/index.ts` — bug 3.
- `src/message-embedding-sweep.ts`, `src/message-cache/vector-store.ts` (+ migration only if a persisted marker is chosen) — bug 4.
- Tests: `tests/completion/verified-completion.test.ts`, `tests/llm-orchestrator-send.test.ts`, `tests/deferred-prompts/proactive-llm-helpers.test.ts`, `tests/chat/telegram/chunking.test.ts` (new), `tests/stories/chat/telegram-reply-fn.story.test.ts` (if it covers `formatted`), `tests/message-embedding-sweep.test.ts`.
- Docs: `docs/architecture/behaviors.md` (fallback rule, verifier outcome, Telegram chunking bullet).

## Intended behaviour change

Verifier-empty/error no longer replaces a generated answer with a stub (both reply paths); the trace buffer records why verification degraded (`verifierOutcome`); over-limit Telegram answers are delivered as ordered chunks instead of failing entirely; embedding-sweep failures stop accumulating forever. No persisted-state contract changes unless bug 4 selects a persisted dead-letter marker.

## Verification

Red-first test per bug, one branch/MR per bug. `bun run test:affected` in the edit loop; full `bun run test`, `bun check:full` (lint+typecheck) before finish; `bun run test:mutate:changed` on touched `src/` files with ratchet baseline update if regressed. Finish with a short report: findings, fixes, anything still suspicious (e.g. the verifier-empty root cause if it needs a provider-side follow-up).

## Capabilities

None — skip_specs proposed because this is a fix-class change: bugs 1–2 restore the intended verified-completion contract (deliver the model's answer; stub only when there is none), bug 3 restores delivery of over-limit answers on the existing Telegram send path, and bug 4 is internal sweep reliability tooling — no downstream-observable requirement is added, changed, or removed. If the maintainer disagrees for bug 3, a `telegram-message-chunking` capability can be added at the park.
