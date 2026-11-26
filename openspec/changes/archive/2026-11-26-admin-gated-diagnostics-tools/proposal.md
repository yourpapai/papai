# Admin-gated diagnostics tools (issue #305)

## Goal

`MakeToolsOptions` (`src/tools/types.ts:16`) carries no actor-identity fields, so tool assembly cannot gate admin-only tools. Thread `isBotAdmin` (+ `platformInstanceId`, per the issue) from the per-message `AuthorizationResult` through `bot-message-handler` → message queue → orchestrator → `makeTools`/`buildToolDescriptors`, and introduce a diagnostics tool family gated on **bot admin AND DM context AND normal mode** (mirrors the command convention "Admin-only commands must stay DM-only", `src/commands/CLAUDE.md:25`). Gate is fail-closed: flag absent/false → no diagnostics tools.

## Assumptions

- "Diagnostics tool family" = a new provider-independent family whose first member is one read-only tool `run_diagnostics`, registered via a `maybeAddDiagnosticsTools` helper so later family members reuse the same gate.
- `run_diagnostics` returns a bounded, secret-free runtime snapshot: platform instance active, task instance configured (id/type only, never decrypted config), LLM config resolution status (central/BYOK/unconfigured — never keys/URLs with credentials), MCP pool health, active queue count, tool-descriptor cache presence, uptime. Counts and booleans only, in the spirit of the `/stats/*` anonymity contract.
- Diagnostics are excluded from proactive runs (`mode === 'proactive'` builds no admin identity) and from the `/context` tool-resolution path (`src/commands/context-tool-resolution.ts` passes no `isBotAdmin`).
- `platformInstanceId` is threaded explicitly per the issue text even though derivable from the scoped storage context id.

## Files to touch

**Plumbing (identity thread):**
- `src/message-queue/types.ts` — `QueueItem` + `CoalescedItem` gain `isBotAdmin?: boolean`, `platformInstanceId?: string` (next to `actorRole`).
- `src/message-queue/queue.ts` (~line 213) — coalescing carries both from the last message.
- `src/bot-message-handler.ts` — `enqueueTurn` passes `isBotAdmin: auth.isBotAdmin`, `platformInstanceId: msg.platformInstanceId`; `runTurnProcess` forwards `coalescedItem.isBotAdmin`/`platformInstanceId` to `processMessage`.
- `src/llm-orchestrator-process-args.ts` — append `isBotAdmin?: boolean`, `platformInstanceId?: string` to the `ProcessMessageRest` tuple (appended at the end so existing positional callers stay valid) and to `resolveProcessMessageInputs` (defaults: `false`/`undefined`).
- `src/llm-orchestrator.ts` — `invocationSource` includes both fields.
- `src/llm-orchestrator-leftover-replay.ts` — forward the new fields in its positional `processMessage` call.
- `src/llm-orchestrator-tools.ts` — `InvocationSource` and `LlmInvocationOptions` gain `isBotAdmin?: boolean`/`platformInstanceId?: string`; `buildLlmInvocationOpts` threads them; `getOrCreateDescriptors` passes them into `descriptorOptions` **and appends an admin segment to the descriptor cache key** (`…:${username}:${isBotAdmin ? 'admin' : 'user'}` — appended last so `toolCachePrefixesForContext` prefix invalidation in `src/cache.ts` keeps matching) so an admin-status change can never serve stale descriptors.

**Tool assembly + new tool:**
- `src/tools/types.ts` — `MakeToolsOptions` gains `isBotAdmin?: boolean`, `platformInstanceId?: string`.
- `src/tools/index.ts` — in `buildToolDescriptors` and `buildProviderlessToolDescriptors`, call `maybeAddDiagnosticsTools(tools, options)` gated on `options.isBotAdmin === true && options.contextType === 'dm' && mode === 'normal'` (gating at this level avoids extending the positional `BuilderArgs` in `tools-builder.ts`).
- `src/tools/diagnostics.ts` (new) — `makeRunDiagnosticsTool(platformInstanceId)` returning `Tool` per the factory conventions (`src/tools/CLAUDE.md`); one tool per file, `snake_case` key `run_diagnostics`, `.describe()` on every schema field, structured failure results, pino logging with no sensitive data.
- `src/tools/tool-metadata.ts` — add `diagnostics` to `TOOL_DOMAINS` and register `run_diagnostics: read('diagnostics')`; confirm `src/analytics/tool-classification.ts` maps the new domain onto its bounded enum (expect `other`/`meta`) and update its tests if the mapping table is exhaustive.

**Docs:**
- `src/tools/CLAUDE.md` — extend the `MakeToolsOptions` exposure list (`isBotAdmin`, `platformInstanceId`) and add a diagnostics bullet under "Current Context-Sensitive Tool Areas".
- `docs/architecture/tools.md` — document the admin+DM gate and the identity thread.

## Behaviour change

Admin users in DM gain one read-only `run_diagnostics` tool; every other context (groups, guests, non-admins, proactive runs) sees an unchanged toolset. No existing tool surface changes. Descriptor cache keys gain an admin segment; existing invalidation helpers keep working unchanged.

## Verification

- TDD per repo hooks (`tests/CLAUDE.md`):
  - `tests/tools/types.test.ts` — `MakeToolsOptions` accepts the new fields.
  - `tests/llm-orchestrator-tools.test.ts` (uses `buildToolDescriptorsSpy`) — `prepareLlmInvocation` forwards `isBotAdmin`/`platformInstanceId` into descriptor options; distinct cache keys for admin vs non-admin (no cross-hit).
  - `tests/bot-message-handler.test.ts` — authorized admin message enqueues `isBotAdmin: true` + `platformInstanceId`; non-admin enqueues `false`.
  - Queue coalescing test — fields survive `flush()` (follow existing `actorRole` coverage).
  - New `tests/tools/diagnostics.test.ts` — `makeTools` with `{isBotAdmin: true, contextType: 'dm', mode: 'normal'}` exposes `run_diagnostics`; `{isBotAdmin: false}`, `undefined`, `contextType: 'group'`, and `mode: 'proactive'` exclude it; result payload contains only whitelisted bounded fields (no tokens/config bodies).
  - Metadata/classification tests updated for the new domain/tool.
- `bun run test:affected` during the loop; full `bun run test` + `bun check:full` (lint, typecheck, knip, format) before finish.
