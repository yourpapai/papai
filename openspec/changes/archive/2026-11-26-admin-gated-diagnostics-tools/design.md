<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Context

`AuthorizationResult.isBotAdmin` (`src/chat/authorization-types.ts:19`) is resolved per message in `bot-message-handler` but never reaches tool assembly: `MakeToolsOptions` (`src/tools/types.ts:16`) carries no actor-identity fields, and the plumbing from enqueue → queue → `processMessage` → descriptor options (`src/llm-orchestrator-tools.ts:84` `getOrCreateDescriptors`) passes only `actorRole`. The descriptor cache key is built positionally as
`${providerScope}:${stagedScope}:${resolverScope}:${contextId}:${chatUserId}:${username}` and invalidated by prefix matching in `toolCachePrefixesForContext` (`src/cache.ts:191`), which enumerates only the three leading scopes — any new key segment must therefore be appended **after** `${contextId}` for `clearCachedToolsByPrefix` / `getLatestCachedToolsForContext` to keep matching. Command-layer convention (`src/commands/CLAUDE.md`) already treats admin-only surfaces as DM-only; this change mirrors that for tools. No DB, provider, or dependency changes are involved.

## Goals / Non-Goals

**Goals:**

- Thread per-message admin identity (+ `platformInstanceId`) to tool assembly without changing any existing tool's exposure.
- Fail closed everywhere identity is absent (proactive runs, `/context` tool resolution, providerless defaults).
- Keep descriptor-cache correctness under admin-status changes with zero changes to existing invalidation helpers.

**Non-Goals:**

- No group-accessible diagnostics, no write/diagnostic-action tools, no new settings-UI surface (the tool_prefs UI list picks it up automatically once registered in `tool-metadata.ts`).
- No restructuring of the positional `ProcessMessageRest` tuple into an options object; no changes to the settings/admin default tool-permission seeding.

## Decisions

### D1 — Gate at `buildToolDescriptors`/`buildProviderlessToolDescriptors` level, not in `tools-builder`

A `maybeAddDiagnosticsTools(tools, options)` helper is called from both descriptor builders in `src/tools/index.ts`, gated on `options.isBotAdmin === true && options.contextType === 'dm' && options.mode === 'normal'`.
*Alternative rejected:* extending the positional `BuilderArgs` in `tools-builder.ts` — churns every call site and mixes an actor-identity concern into the provider-capability builder. Gating at the options-object level reuses the same `MakeToolsOptions` surface that already carries `contextType`/`mode`, and the identical helper covers the providerless path (admin DMs often have no task instance — `provider === null`). The guest-mode read-only filter (`src/tools/index.ts:69`) drops non-read-risk tools anyway, and diagnostics never qualifies for guests because guests are never bot admins; the gate ordering (identity gate at assembly, prefs applied as final step) keeps both independent.

### D2 — Identity threading via optional fields appended to existing tuples, defaulting fail-closed

`QueueItem`/`CoalescedItem` gain `isBotAdmin?: boolean` and `platformInstanceId?: string` next to `actorRole`; coalescing takes both from the **last** message (same semantics as `actorRole` today). `ProcessMessageRest` (`src/llm-orchestrator-process-args.ts:10`) gets both fields **appended at the end** so existing positional callers stay valid; `resolveProcessMessageInputs` defaults `isBotAdmin` to `false` and `platformInstanceId` to `undefined`.
*Alternative rejected:* converting the tuple to an options object — a cross-cutting refactor of every `processMessage` caller with no behavioral gain for this change. The fail-closed default is the security property: proactive runs (`src/deferred-prompts/`, which builds its own toolset without admin identity) and `/context` tool resolution (`src/commands/context-tool-resolution.ts`) need no explicit blocklist — they simply never pass a true flag, so no diagnostics tools are assembled there.

### D3 — Descriptor cache key gains an admin segment appended last

`getOrCreateDescriptors` passes `isBotAdmin`/`platformInstanceId` into `descriptorOptions` and appends `:${isBotAdmin ? 'admin' : 'user'}` **after** the existing `${usernameSuffix}` tail. Because `toolCachePrefixesForContext` matches with `key.startsWith(`${prefix}:`)` where the prefix ends at `${contextId}`, any suffix order after the context id still matches; appending last guarantees `clearCachedToolsByPrefix` and `getLatestCachedToolsForContext` keep working byte-for-byte unchanged, while an admin-status flip for the same context can never serve stale descriptors (distinct keys).
*Alternative rejected:* inserting the segment before `${contextId}` or versioning the key format — both would require touching every prefix enumerator in `src/cache.ts` and temporarily allow stale cross-status hits during rollout.

### D4 — One new module `src/tools/diagnostics.ts`, factory per convention

No existing `src/tools/` module covers runtime-health snapshotting (`get_current_time` is the only self-referential builtin and is a clock, not a health probe). Per the one-tool-per-file convention: `makeRunDiagnosticsTool(platformInstanceId)` returns a `Tool` with a `z.object({})`-style `.describe()`d schema, `snake_case` key `run_diagnostics`. The snapshot reads **existing** runtime state only — queue length, MCP pool health accessor, descriptor-cache presence probe, uptime, platform-instance active lookup by id, task-instance configured check (id/type only, from metadata, never decrypted config), LLM config resolution status enum (`central|byok|unconfigured`) — assembled through a whitelisted field builder so no config body, key, or credential-bearing URL can reach the result or the pino logs (anonymity in the spirit of the `/stats/*` contract). Each probe is individually try/caught and degrades to a per-field error marker; the tool itself never throws (the finalize-pass wrapper stays the outer safety net).

### D5 — Metadata: new `diagnostics` domain, mapped onto the existing `meta` analytics enum

`TOOL_DOMAINS` gains `diagnostics`; `run_diagnostics: read('diagnostics')` in `src/tools/tool-metadata.ts`. `DOMAIN_MAP` in `src/analytics/tool-classification.ts:56` is `Record<ToolDomain, AnalyticsToolDomain>` (exhaustive — typecheck forces the update); `diagnostics → 'meta'` fits the bounded fact enum without widening it, so no analytics schema/rekey impact.

### Scope-model, prefs, and persistence impact

- **No new persisted state.** Nothing is written to SQLite; the only new state is the in-memory descriptor-cache key segment. No drizzle migration, no backfill. Rollback = revert; caches clear on restart.
- **tool_prefs:** the tool resolves through the standard three-state chain (`toolOverrides['run_diagnostics']` → `domainDefaults['diagnostics']` → `riskDefaults['read']` → implicit `allow`) *after* the identity gate — `deny` removes it even for a qualifying admin, `ask` wraps it with `_permission_reason` per-call confirmation, sticky presets pick it up as read-risk automatically.
- **Ids:** `platformInstanceId` keys nothing new — it parameterizes the snapshot (which instance's health to report) and rides the same per-turn identity as `isBotAdmin`. Diagnostics exposure itself is keyed by the turn's `storageContextId` via the existing cache, i.e. DM contexts only by construction of the gate.

## Risks / Trade-offs

- [Descriptor-cache cardinality doubles per context (admin/user variants)] → Bounded: one boolean split per already-cached key; contexts are per-user/per-thread as today. Acceptable; no LRU change needed.
- [Coalescing an admin message with a later non-admin message (or vice versa) flips the run's admin status] → Same last-message-wins semantics as `actorRole`; the run executes as the last speaker, which is the identity that authored the merged prompt text.
- [Future diagnostics family members could leak richer state] → The gate helper is the single choke point; each new member must go through `maybeAddDiagnosticsTools` and the whitelisted-field builder pattern, reviewable in one file.
- [Snapshot probes touch live subsystems (MCP pool, queue) and could add latency] → All probes are local reads of in-process state (no network calls); a downed MCP pool reports a health enum rather than attempting a reconnect.

## Migration Plan

Code-only; deploy and rollback are a plain revert of the branch. In-memory descriptor caches rebuild on first turn after restart; the appended cache-key segment means pre-deploy cached descriptors (old-format keys) simply stop being hit — no stale-window risk. No config, DB, or settings migration.

## Hook/TDD Interactions

The Write/Edit hook pipeline gates every new/edited `src/` + `tests/` file test-first. Order of work (failing test before each implementation edit):

1. `tests/tools/types.test.ts` — `MakeToolsOptions` accepts `isBotAdmin`/`platformInstanceId` → then `src/tools/types.ts`.
2. `tests/bot-message-handler.test.ts` — enqueue carries `isBotAdmin: true` + `platformInstanceId` for admins, `false` for non-admins; queue coalescing test asserting both survive `flush()` (follow existing `actorRole` coverage) → then `src/message-queue/types.ts`, `src/message-queue/queue.ts`, `src/bot-message-handler.ts`.
3. `tests/llm-orchestrator-tools.test.ts` — `prepareLlmInvocation` forwards both fields into descriptor options; admin vs non-admin produce distinct cache keys (no cross-hit); prefix invalidation still clears both variants → then `src/llm-orchestrator-process-args.ts`, `src/llm-orchestrator.ts`, `src/llm-orchestrator-leftover-replay.ts`, `src/llm-orchestrator-tools.ts`.
4. `tests/tools/diagnostics.test.ts` — gate matrix (`{isBotAdmin:true, contextType:'dm', mode:'normal'}` exposes the tool; `false`/`undefined`/`group`/`proactive` exclude it) and payload whitelist (no tokens/config bodies; task instance null → `not configured`; probe failure → structured result) → then `src/tools/diagnostics.ts`, `src/tools/index.ts`.
5. Metadata/classification tests for the `diagnostics` domain and `meta` mapping → then `src/tools/tool-metadata.ts`, `src/analytics/tool-classification.ts`.

`bun run test:affected` inside the loop; full `bun run test` + `bun check:full` at the end. Docs updates (`src/tools/CLAUDE.md`, `docs/architecture/tools.md`) land with the final task, not via hooks.
