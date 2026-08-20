<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## 1. Tool options surface

- [ ] 1.1 Add failing test: `MakeToolsOptions` accepts optional `isBotAdmin?: boolean` and `platformInstanceId?: string` (accepts `{isBotAdmin: true, platformInstanceId: 'pi-1'}`, `{isBotAdmin: false}`, and omitting both) — `bun test tests/tools/types.test.ts`
- [ ] 1.2 Add the two optional fields to `MakeToolsOptions` in `src/tools/types.ts` with doc comments mirroring the existing field style — `bun test tests/tools/types.test.ts`

## 2. Identity thread through queue and handler

- [ ] 2.1 Add failing tests in `tests/bot-message-handler.test.ts`: authorized admin message enqueues `isBotAdmin: true` + `platformInstanceId: <msg.platformInstanceId>`; non-admin enqueues `isBotAdmin: false`; `platformInstanceId` absent when the message carries none — `bun test tests/bot-message-handler.test.ts`
- [ ] 2.2 Add failing queue-coalescing test (follow existing `actorRole` coverage): `isBotAdmin`/`platformInstanceId` survive `flush()` taking the last message's values when messages coalesce — `bun test tests/message-queue.test.ts`
- [ ] 2.3 Add `isBotAdmin?: boolean` / `platformInstanceId?: string` to `QueueItem` + `CoalescedItem` (`src/message-queue/types.ts`), carry both from the last message in coalescing (`src/message-queue/queue.ts`), pass `auth.isBotAdmin`/`msg.platformInstanceId` from `enqueueTurn` and forward `coalescedItem.isBotAdmin`/`platformInstanceId` in `runTurnProcess` (`src/bot-message-handler.ts`) — `bun test tests/bot-message-handler.test.ts tests/message-queue.test.ts`

## 3. Orchestrator plumbing and descriptor cache key

- [ ] 3.1 Add failing tests in `tests/llm-orchestrator-process-args.test.ts` (or the suite covering `resolveProcessMessageInputs`): new tuple entries default to `isBotAdmin: false` / `platformInstanceId: undefined` when absent; appended positions keep existing positional calls valid — `bun test tests/llm-orchestrator-process-args.test.ts`
- [ ] 3.2 Append `isBotAdmin?: boolean`, `platformInstanceId?: string` to `ProcessMessageRest` and to `resolveProcessMessageInputs` with fail-closed defaults (`src/llm-orchestrator-process-args.ts`); forward both in the positional `processMessage` call in `src/llm-orchestrator-leftover-replay.ts` — `bun test tests/llm-orchestrator-process-args.test.ts`
- [ ] 3.3 Add failing tests in `tests/llm-orchestrator-tools.test.ts` (uses `buildToolDescriptorsSpy`): `prepareLlmInvocation` forwards `isBotAdmin`/`platformInstanceId` into descriptor options; admin vs non-admin turns for the same context produce distinct descriptor cache keys (no cross-hit); `clearCachedToolsByPrefix(contextId)` still clears both variants — `bun test tests/llm-orchestrator-tools.test.ts`
- [ ] 3.4 Add `isBotAdmin?: boolean` / `platformInstanceId?: string` to `InvocationSource` and `LlmInvocationOptions`, thread them through `buildLlmInvocationOpts` and `invocationSource` construction (`src/llm-orchestrator.ts`, `src/llm-orchestrator-tools.ts`); in `getOrCreateDescriptors` pass both into `descriptorOptions` and append `:${isBotAdmin ? 'admin' : 'user'}` as the **last** cache-key segment — `bun test tests/llm-orchestrator-tools.test.ts`

## 4. Diagnostics tool and admin gate

- [ ] 4.1 Create failing `tests/tools/diagnostics.test.ts` gate matrix: `makeTools` with `{isBotAdmin: true, contextType: 'dm', mode: 'normal'}` exposes `run_diagnostics`; `{isBotAdmin: false}`, `undefined`, `{contextType: 'group'}`, and `{mode: 'proactive'}` exclude it; guest-filtered toolset never contains it — `bun test tests/tools/diagnostics.test.ts`
- [ ] 4.2 Add failing payload tests to `tests/tools/diagnostics.test.ts`: result contains only whitelisted fields (platform instance active, task instance id/type or `not_configured` when null, llm config `central|byok|unconfigured`, mcp pool health, queue count, descriptor cache presence, uptime); no token/key/credential-bearing value appears in result or log output; a throwing probe degrades to a per-field error marker instead of an uncaught failure — `bun test tests/tools/diagnostics.test.ts`
- [ ] 4.3 Create `src/tools/diagnostics.ts`: `makeRunDiagnosticsTool(platformInstanceId)` returning `Tool` per factory conventions (`snake_case` key `run_diagnostics`, `.describe()` on schema fields, whitelisted bounded snapshot, per-probe try/catch, pino logging with no sensitive data); add `maybeAddDiagnosticsTools(tools, options)` gated on `options.isBotAdmin === true && options.contextType === 'dm' && options.mode === 'normal'` and call it from `buildToolDescriptors` and `buildProviderlessToolDescriptors` in `src/tools/index.ts` — `bun test tests/tools/diagnostics.test.ts`
- [ ] 4.4 Add failing test in `tests/tools/diagnostics.test.ts` (or the prefs suite): `tool_prefs` `deny` for `run_diagnostics` removes it from an otherwise-qualifying admin DM toolset; `ask` wraps it so an ungranted call returns the structured `permission_denied` result — `bun test tests/tools/diagnostics.test.ts`

## 5. Metadata and analytics classification

- [ ] 5.1 Add failing tests: `getToolMetadata('run_diagnostics')` returns `read('diagnostics')`; `isToolDomain('diagnostics')` is true; `classifyAnalyticsTool('run_diagnostics')` yields `toolDomain: 'meta'`, `risk: 'read'` — `bun test tests/tools/tool-metadata.test.ts tests/analytics/tool-classification.test.ts`
- [ ] 5.2 Add `diagnostics` to `TOOL_DOMAINS` and register `run_diagnostics: read('diagnostics')` in `src/tools/tool-metadata.ts`; add `diagnostics: 'meta'` to `DOMAIN_MAP` in `src/analytics/tool-classification.ts` (exhaustive `Record` — typecheck enforces) — `bun test tests/tools/tool-metadata.test.ts tests/analytics/tool-classification.test.ts`

## 6. Full verification and docs

- [ ] 6.1 Update `src/tools/CLAUDE.md` (extend the `MakeToolsOptions` exposure list with `isBotAdmin`/`platformInstanceId`; add a diagnostics bullet under "Current Context-Sensitive Tool Areas") and `docs/architecture/tools.md` (document the admin+DM+normal-mode gate, fail-closed identity thread, and the admin cache-key segment) — `bun run lint && bun run typecheck`
- [ ] 6.2 Run the full suite and all checks: `bun run test`, then `bun check:full` (lint, typecheck, knip, format); fix anything surfaced only at whole-repo scope
