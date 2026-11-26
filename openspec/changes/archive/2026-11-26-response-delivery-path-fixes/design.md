# Response delivery path fixes — design

## Context

Live-confirmed failures (2026-09-06, issue #417) sit on three seams of the reply path; the proposal locates each precisely and motivates the fixes — this doc covers how. Current shape that constrains the approach:

- `buildVerifiedCompletion` (`src/completion/verified-completion.ts:101`) is the single last-resort seam shared by both reply paths — interactive `resolveFinalText` (`src/llm-orchestrator-send.ts:29`) and proactive `finalizeAndLog` (`src/deferred-prompts/proactive-llm-helpers.ts:121`). On verifier empty (112–115) or verifier throw (118–124) it returns the activity-selected i18n stub (`texts.neutralFallback` / `texts.noopFallback` from the completion catalog) with verdict `unconfirmed`, discarding `turn.finalText`.
- The main turn's trace (`LlmTrace`) is pushed by `emitLlmEnd` (interactive `src/llm-orchestrator-invoke.ts:187`, proactive `src/deferred-prompts/proactive-llm.ts:140`, both carrying a `turnId` and the storage-context user scope) before verification runs; the verifier call emits nothing, so degraded verification is invisible in the debug buffer. `handleLlmTraceEvent` (`src/debug/llm-trace-collector.ts:249`) already has a precedent for a post-start event attaching to the right turn: `pendingForToolResult` matches by user+turnId with a most-recent fallback for turn-less emitters.
- Telegram sends are single-shot: `sendFormattedReply` (`src/chat/telegram/reply-helpers.ts:217`) and deferred `sendMessage` (`src/chat/telegram/index.ts:140`) format once (`formatLlmOutput` → plain text + grammy entities whose offsets index that text) and send one message; anything over `telegramTraits.maxMessageLength` (4096) fails the whole send. Discord already chunk-formats (`src/chat/discord/format-chunking.ts`, fence-balancing) — but its mechanism is Discord-specific (client-side markdown), not reusable for Telegram's entity model.
- `sweepContext` (`src/message-embedding-sweep.ts:51`) catches `embedMany` failure, logs a warn, and leaves rows pending; `nextPendingBatchForContext` hands them back every sweep forever.

Constraints: Bun, strict TypeScript (`.js` import paths), Zod v4, drizzle/SQLite, pino metadata-first logging, DI-first tests (`tests/CLAUDE.md`). The change carries `skip_specs: true` — a fix-class change validating with no spec deltas; no capability, tool-surface, or persisted-state contract change is claimed (see proposal - Capabilities).

## Goals / Non-Goals

**Goals:**

- A degraded verification pass (verifier empty or throwing) never discards the model's own non-empty answer on either reply path; the stub fires only when there is genuinely no model text. Same rule issue #397 bug 1 pins on the proactive path — one shared seam, one rule.
- Verification degradation is observable: `verifierOutcome` (`'ok' | 'empty' | 'error'`) on `VerifiedCompletion`, surfaced by both call sites, attached to the turn's trace, and passed through `shapeLlmTrace` like other metadata.
- Over-limit Telegram answers are delivered as ordered, in-bounds chunks on both the interactive and deferred send paths; a failed chunk never silently drops the rest.
- (Bug 4, only after 1–3) Embedding-sweep failures stop retrying forever: bounded retries, then a dead-letter set that excludes rows from future batches and surfaces in the sweep log.

**Non-Goals:**

- No change to the `isRisky` routing decision (the verifier-succeeds case) — that stays in issue #397's lane; no change to verdict derivation order, the verifier toolset, or `VERIFIER_MAX_STEPS`.
- No provider-side root-cause fix for verifier-empty output (step-cap tool-call endings, provider empty content) — the pipeline becomes robust to any such cause; the root cause goes to the final report.
- No chunking for Mattermost/Kontur Talk, no rework of Discord's chunker, no synthetic fence handling for Telegram.
- No new tool surface, no `tool_prefs`/capability changes, no scope-model or config changes, no settings-UI work, no DB schema change.

## Decisions

### D1 — Fix the fallback rule inside `buildVerifiedCompletion`, once (bugs 1+2 share the seam)

On the verifier-empty and verifier-throw legs: if `turn.finalText` is a non-empty string (empty means `undefined`, `''`, or whitespace-only after `trim()`), deliver it, keep the derived verdict, and log a warn carrying `verifierOutcome` and the chosen source (model text vs last-resort stub). The stub is selected exactly as today (activity-selected `neutralFallback`/`noopFallback`) only when the model produced no text, verdict `unconfirmed` as today.

Why here and not at the call sites: both reply paths route through this one seam; a call-site fix duplicates the rule across `resolveFinalText` and `finalizeAndLog` and invites drift — the proactive path is exactly where #397 had to re-assert a similar rule. Why not retry the verifier: the observed causes (verifier ending on tool calls within `VERIFIER_MAX_STEPS = 4`; provider returning empty content) are not guaranteed recoverable, and a retry doubles verification latency on an already-degraded path. Why not treat verifier-empty as plain success: that would silently skip verification; D2 keeps the degradation visible. Whether verification runs at all (`isRisky`) is untouched — that decision belongs to #397.

### D2 — `verifierOutcome` via a follow-up debug event applied to the turn's most recent trace

`VerifiedCompletion` gains `verifierOutcome: 'ok' | 'empty' | 'error'` ('ok' = verifier produced text; 'empty' = verifier returned `undefined`/`''`/whitespace-only; 'error' = verifier threw). `LlmTrace` (`src/debug/llm-trace-collector.ts`) and `LlmTraceSchema` (`src/debug/schemas.ts`, `z.enum([...]).optional()`) gain the optional field.

Because `llm:end` pushes the trace before verification runs, the outcome reaches the trace through a new `llm:verifier` debug event emitted by the two verification call sites (`resolveFinalText`, `finalizeAndLog`) with the same user scope and `turnId` their `llm:start`/`llm:end` used — the interactive side threads the `turnId` already held by `invokeWithLiveStatus` into `sendLlmResponse`; the proactive call site already holds it. `handleLlmTraceEvent` gains a branch that records, at `llm:end`, the pushed trace in a user+turnId-keyed registry (same key shape as `pendingTraces`, pruned by the same per-user cap pattern so entries for turns that never verify cannot accumulate), resolves the turn's trace on `llm:verifier` (exact turnId match; turn-less emitters fall back to the most recent trace for the user, mirroring `pendingForToolResult`), sets the field in place on the buffered trace object, and re-broadcasts through the existing `broadcastTrace` so an open debug UI shows the outcome without a refresh.

Alternatives considered: a second standalone verifier trace record — rejected (fragments the turn's debugging story and doubles buffer entries); folding the outcome into `emitLlmEnd` — rejected (verification runs after the end event fires; reordering `invokeModel`/`sendLlmResponse` to verify first would delay the end event and touch both paths for a metadata field); emitting inside `buildVerifiedCompletion` — rejected (couples the pure completion module to the debug event layer and still needs scope/turn keys threaded into its API; call-site emission reuses the outcome the call sites already surface for logging).

`verifierOutcome` is metadata: `shapeLlmTrace` strips only identity fields, `generatedText`, `stepsDetail`, and per-tool-call `args`/`result`, so the outcome passes to non-owner viewers verbatim — no anonymity-contract change (`/stats/*` shaping untouched).

### D3 — Telegram chunking: split the formatted text, shift entities, apply at both send seams

New `src/chat/telegram/chunking.ts` with a pure `chunkForTelegram(text, maxLen = telegramTraits.maxMessageLength)`: prefer paragraph boundaries (blank line), then single newlines, then a hard cut at `maxLen`; the splitter must always advance (hard cut is the floor) so oversize single lines cannot loop. No fence-balancing — Telegram receives plain text + entities, not client-rendered markdown, so the correct analog of Discord's fence handling is entity bookkeeping, not fence synthesis.

Application, in `sendFormattedReply` (interactive) and deferred `sendMessage` (proactive): format once with `formatLlmOutput` as today; if the formatted text is within the limit, today's single-send path runs verbatim; otherwise split the formatted text and derive per-chunk entities mechanically — entities fully inside a chunk window shift by the window start (`shiftTelegramEntity` exists), entities spanning a cut are dropped. Chunk-then-reformat-per-chunk was considered and rejected: `formatLlmOutput` runs the marked lexer plus table/list preprocessing, so per-chunk re-lexing can shift entity offsets unpredictably across boundaries and costs a format pass per chunk; post-format splitting is deterministic, single-pass, and unit-testable.

Chunks are sent sequentially in order with the same reply parameters (thread id, reply target, link-preview option). A failed chunk logs a warn with its index and total, and the remaining chunks still send — never a silent drop. `lastReplyTarget` snapshots the last successfully sent message: `sendFormattedReply` returns the last successful send's `{messageId, chatId}`, which is what `buildTelegramReplyFn.formatted` already assigns, so `reply-fn-builder.ts` needs no change. In the deferred path the mention prefix rides the first chunk only (prefix entities as-is on chunk 1; formatted entities shifted into the chunk window as today, offsets relative to chunk 1's text).

Module question: the need is real but `src/chat/discord/format-chunking.ts` does not cover it — its split preference (sentence/word), budget model (fence reservations), and output contract (no entities) are Discord-shaped, and chat adapter conventions keep formatting/chunking helpers next to the adapter that needs them; this is a deliberate adapter-local mirror, not shared code.

### D4 — Embedding sweep: error-class enrichment, bounded retry, capped in-memory dead-letter

Investigation first: enrich the batch-embed warn with the provider error class (AI SDK error name, status when present) so the recurring failure is classifiable from logs before any retry logic lands.

Retry: `sweepContext` retries the `embedMany` call up to 2 times with exponential backoff (short, hundreds of ms to ~1s; a `sleep` dep injected into `SweepDeps` so tests assert retry counts without real waits). Retries stay inside the per-context task, so the existing `pLimit(3)` concurrency bound is preserved — no new concurrency surface.

Dead-letter: a module-level capped failure map in `src/message-embedding-sweep.ts`, keyed by the row identity (`contextId:messageId` — the `message_metadata` row key), incrementing per exhausted batch; rows at ≥ N failures (small constant, e.g. 5) are excluded from the batch the sweep embeds (filter the `nextPendingBatchForContext` result before embedding) and the sweep log reports the dead-lettered count. The map is capped, evicting oldest entries beyond a bound (`Map` insertion order makes this trivial). `vector-store.ts` stays pure persistence — failure policy is a sweep-layer concern.

Persisted-marker alternative (failure columns on `message_embeddings` via a drizzle migration — `ALTER TABLE ... ADD COLUMN failure_count/failed_at`; backfill: none, existing rows default to not-failed) was considered and rejected per the minimality ladder: a restart loses the in-memory set, but rows then merely retry until they re-cap — bounded work per process, which resolves the actual bug (unbounded same-process accumulation). A schema migration for a low-priority reliability fix is the larger design; the persisted marker is the named escalation if restart-retry proves noisy.

### Gating, scope-model, dependency, and TDD-hook impact

- **Tool surface / gating:** none. No tool is added, removed, or reclassified — `selectReadOnlyTools`, the tool registry, `tool_prefs` resolution, and the guest-mode toolset are untouched, so there is nothing new to gate and no capability catalog change.
- **Scope model:** no new persisted state in bugs 1–3. New in-memory state keys: the D2 trace registry keys by the same user scope (storage-context id; proactive uses the emitter's scope) + `turnId` as `pendingTraces` does; the D4 dead-letter map keys by the `message_metadata` row identity (storage-scoped `contextId` + `messageId`) and lives only for the process; `verifierOutcome` rides the existing per-turn `LlmTrace`. No config-context, platform-instance, or per-user durable asset changes; nothing migrates between scopes.
- **DB changes:** none selected (D4) — hence no drizzle migration and no backfill in this change.
- **Dependencies:** none added. Chunking is plain TypeScript; retry/backoff is a hand-rolled loop (`p-limit` already in the stack bounds concurrency); the trace field uses the existing debug event bus and Zod schema. The existing stack (AI SDK, Grammy, discord.js, Zod, drizzle) covers every need; discord.js is simply irrelevant to this Telegram-side change.
- **TDD hook interaction:** every `src/` file listed below is a gateable impl file, so each edit lands test-first (red test failing before the product edit passes it). New file `src/chat/telegram/chunking.ts` — the paired `tests/chat/telegram/chunking.test.ts` must exist and fail before the module is written. Test-first order: (1) bug 1 red in `tests/completion/verified-completion.test.ts` (DI `invokeVerifier` stub returning empty/throwing; assert the model text is delivered with the derived verdict), (2) bug 2 red: same suite for `''`/whitespace verifier output and the `verifierOutcome` return; `tests/debug/llm-trace-collector.test.ts` for the follow-up event applying the outcome to the turn's trace; `tests/debug/schemas.test.ts` (`schemaValidates()`) for the schema field; call-site surfacing in `tests/llm-orchestrator-send.test.ts` and `tests/deferred-prompts/proactive-llm-helpers.test.ts`, (3) bug 3 red: `tests/chat/telegram/chunking.test.ts` mirroring `tests/chat/discord/format-chunking.test.ts`, plus chunked-delivery assertions in the Telegram reply-path tests (`tests/stories/chat/telegram-reply-fn.story.test.ts` if it covers `formatted`), (4) bug 4 red in `tests/message-embedding-sweep.test.ts` (retry counts via the injected sleep, dead-letter exclusion, log surface). Docs edits are ungated.

## Risks / Trade-offs

- [Verifier-empty turns whose model text is garbage now deliver it instead of stubbing] → intended contract (#397-aligned): the derived verdict still marks the turn `truncated`/`partial` honestly, and the stub continues to fire for empty model text; red tests pin both legs.
- [`llm:verifier` mis-attachment under overlapping turns (mid-run steering plus proactive sharing a storage-context user key)] → same accepted risk class as the legacy tool-result fallback; exact turnId match first; the field is metadata, so a rare mis-attach degrades observability only.
- [Chunked replies edit only the last chunk via `editReply`/regeneration] → known limitation, consistent with snapshotting the last successful send; the single-chunk path is unchanged; revisit only if regeneration on chunked answers becomes common (Discord's multi-chunk edit capture is the pattern to copy then).
- [`pre`/`code` entities spanning a chunk cut are dropped, losing code formatting at boundaries] → accepted degradation; newline-preferring splits rarely cut inside short code spans; a synthetic close/reopen (Discord-fence analog) is an open question, not built now.
- [A mid-sequence failure leaves a partially delivered multi-chunk answer] → warn logs the failed index/total and the remaining chunks still send; strictly better than today's all-or-nothing failure.
- [In-memory dead-letter lost on restart re-retries bad rows once per process] → bounded by the same cap; the log surface makes it visible; the persisted marker is the escalation path (D4).
- [Bug 4 may not fit the run budget] → explicitly skippable per the proposal; the final report must say so if skipped.

## Migration Plan

One small MR per bug, in order 1 → 2 → 3 → 4 (4 optional), each TDD red-first and independently revertible (`git revert` of an MR restores the prior behavior; no MR depends on a later one, and bug 2's trace field is additive-optional, so reverting it alone is safe). No DB migration, no env/config keys, no settings-UI or client bundle changes — deployment is code-only and safe on a live host. Docs land in the same MRs: `docs/architecture/behaviors.md` gets the corrected fallback rule, the `verifierOutcome` bullet, and the Telegram chunking note (the verified-completion bullet at behaviors.md:82 currently documents the stub-on-empty behavior this change removes). Per-MR gates: `bun run test:affected` in the edit loop; full `bun run test` + `bun check:full` + `bun run test:mutate:changed` (ratchet baseline update if a touched file regressed) before finish.

## Open Questions

- Whether the verifier-empty root cause (verifier ending on tool calls within the step cap, or provider-side empty content) warrants a provider-side follow-up — deferred to the final report per the proposal; does not change specs, approach, or tasks.
- Whether `pre`/`code` entity degradation at chunk boundaries justifies a synthetic close/reopen (the Discord-fence analog) — deferred until observed in practice; the pure splitter and the entity-shift seam are built so adding it later touches only `chunking.ts` consumers.
