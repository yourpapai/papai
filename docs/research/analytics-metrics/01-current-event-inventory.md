<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Current event and durable-usage inventory

**Audit date:** 2026-07-23  
**Method:** rebuild the structural code index, resolve the three public bus
emitters, inspect their incoming references and wrappers, then read every
literal and dependency-injected production emit branch. An independent
spot-check found one event hidden behind an injected generic emitter and four
direct durable writers that bypass the bus.

## Baseline

- **At least 55 distinct production bus event names at 77 static production
  emission sites.** Fifty-four names/75 sites are direct literal calls; the
  additional `llm:tool_result` name is emitted at two indirect sites through an
  injected emitter whose production default is `emitUser`.
- Generic emitter callbacks still accept runtime strings. The minimum count is
  the known static set, not a compile-time proof. A typed registry is required
  before analytics can claim exhaustive source coverage.
- Only a subset becomes durable usage:
  `llm:end`, `llm:error`, `tool:execute_end`, and
  `tool:failure_classified` are consumed by `initUsageRecorder`.
  Embedding and web-distillation paths call `recordUsage` directly and never
  touch the bus.
- Direct forwarding is unsafe. Payloads include generated text, detailed tool
  steps, arbitrary raw tool output and failure objects, raw errors, memo
  content/search queries, names, schedules, IDs, and complete Pino records.
- `turn:summary` and `llm:full` are derived debug-SSE records, not reusable bus
  events. The plan's claimed `memory:*` event family does not currently exist.

Legend:

- **CF** — controlled/content-free after schema validation;
- **H** — high-cardinality/raw identifier; HMAC, coarse-map, or drop;
- **C** — free-form content; drop;
- **E** — raw error; map to a bounded class and drop the raw value;
- **D** — dynamic operator/plugin/provider name; allowlist, coarse-map, or
  purpose-HMAC.

Every bus event also has a timestamp, raw debug scope, and optional envelope
`turnId`. Those are not automatically safe or trustworthy analytics
dimensions.

## Bus mechanics and source correctness

| Mechanism | Source | Finding |
|---|---|---|
| Generic bus | `src/debug/event-bus.ts` | `emitUser`, `emitGroup`, and `emitGlobal` dispatch synchronously. Listener exceptions are not isolated. Analytics listeners must be non-throwing and keep storage/network work off the reply path. |
| Queue wrapper | `src/message-queue/index.ts` | Chooses user/group from event data and splits a storage ID at the first `:`. |
| Queue wrapper | `src/message-queue/queue.ts` | Repeats that split for queued events. Modern `pi:<instance>:ctx:<context>[:thread:...]` IDs become malformed `groupId='pi'`; debug scope is not a usable analytics subject. |
| Injected emitter | `src/llm-orchestrator-support.ts` | Two `llm:tool_result` sites call a generic dependency whose production implementation is `emitUser`; impact-only literal enumeration missed them. |
| Arbitrary emitter | `src/debug/log-buffer.ts` | Casts a complete Pino record into `log:entry`; categorically exclude it. |

The bus's zero-listener shortcut does not make current emission “free”:
`initUsageRecorder` installs a listener at startup, and expensive payload
objects such as `stepsDetail` are constructed before the emitter can return.

## Complete known bus-event inventory

### Message, queue, turn, LLM, and tool lifecycle

| Event | Production source | Payload and risk | Analytics disposition / missing facts |
|---|---|---|---|
| `message:received` | `onIncomingMessage`, `src/bot.ts` | `contextId H`, `contextType CF`, `threadId H?`, `textLength CF`, `isCommand CF` | Emitted **before auth** and lacks platform instance, storage/config scope, role, guest/consent, and correlation. Do not persist directly; add a post-auth/eligibility `chat_message_accepted`. |
| `message:replied` | `emitReplyCompleted`, `src/bot-reply-tracking.ts` | `contextId H`, `duration CF` | Always duplicated with `reply:sent`; callers omit turn ID and tracking occurs before the send resolves. At most “reply attempted,” never delivery success. |
| `reply:sent` | same | same | Same limitation. RQ8 requires a new adapter-bound delivery outcome, turn key, and latency. |
| `typing:start` | `withReplyTypingHeartbeat`, `src/reply-typing-heartbeat.ts` | no data | Optional feedback fact; lacks platform capability/outcome/context. |
| `typing:stop` | heartbeat stop | no data | Optional feedback fact; same gap. |
| `queue:enqueue` | `MessageQueue.enqueue`, `src/message-queue/queue.ts` (2 branches) | `storageContextId H`, `userId H`, `bufferedCount CF` | Diagnostic/queue fact; no platform or trustworthy parsed scope. |
| `queue:coalesce` | `MessageQueue.emitFlushEvents` | `storageContextId H`, `itemCount CF`, `attachmentCount CF` | Partial attachment opportunity only; no turn ID, excludes voice-staged files, no ingestion outcome. |
| `queue:dequeue` | shutdown `flushQueueWithEvents`, `src/message-queue/index.ts` | `storageContextId H`, `contextType CF`, `userId H` | **Shutdown-only**, not normal dequeue/queue latency. |
| `turn:start` | `MessageQueue.emitFlushEvents` | `turnId H`, `contextType CF`, `incomingMessageCount CF`, `startedAt CF` | Maps only after emitters supply authoritative actor/platform/scoped dimensions. Current group scope can be malformed. |
| `turn:end` | `MessageQueue.runCoalesced`, success | `{turnId H,status:ok,duration CF}` | Normal success shape. Envelope turn ID duplication and malformed group scope need correction. |
| `turn:end` | `MessageQueue.runCoalesced`, failure | `{turnId H,status:error,error E}` | Normal failure has **no duration**. Scrub raw error. |
| `turn:end` | shutdown `emitTurnEnd`, `src/message-queue/index.ts` | `{turnId H,status,duration CF,contextType CF,userId H}` | Separate shutdown shape; do not merge semantics with normal completion. |
| `llm:start` | `emitLlmStart`, `src/llm-orchestrator-events.ts` | `model D`, `messageCount CF`, `toolCount CF`, `toolSchemaBytes CF` | `llm_started`; needs model key/role, actor/context/platform, and TTFT clock. |
| `llm:end` | `emitLlmEnd`, same module | model/actualModel `D`; counts/tokens/duration/finish reason `CF`; response/user IDs `H`; `generatedText C`; `stepsDetail C`; context type | Usage subscriber selects a subset. Analytics must never copy text/steps. Missing platform/role/provider/BYOK/app version/TTFT. |
| `llm:error` | `emitLlmError`, `src/llm-orchestrator-logging.ts` | `error E`, model `D`, user ID `H`, context type/counts/duration `CF` | Durable usage failure; bounded class/phase only. |
| `tool:request` | `handleToolCallStart`, `src/llm-orchestrator-tool-events.ts` | tool name `CF or D`, call/user IDs `H`, byte/count/context/model/role metadata | `tool_started`; dynamic plugin/MCP names cannot be exported verbatim. Missing platform/actor role/risk/provider/confirmation. |
| `tool:execute_end` | `handleToolCallFinishEvent`, same | tool name `CF or D`, IDs `H`, execution boolean/duration/bytes/context/model/role `CF/D` | Durable tool row. `success=true` only means executor returned; it can still be a structured semantic failure. |
| `tool:failure_classified` | `emitFailureClassified`, same (2 branches) | name `CF or D`, IDs `H`, bounded-looking error/code/retry/recovery fields plus context/model/role | Updates the durable tool row. Explicitly map codes; missing recovery point/provider status/platform. |
| `llm:tool_result` | `emitToolFailure`, `src/llm-orchestrator-support.ts` | complete `ToolFailureResult C/E/H` plus raw `error E` | **Categorically reject.** Safer tool execute/classification events already carry required metadata. No envelope turn ID. |
| `llm:tool_result` | `emitToolSuccess`, same | arbitrary raw tool `result C/E/H` | **Categorically reject.** This is the principal hidden content-leak source. |

### Authorization and disclosure

| Event | Production source | Payload and risk | Analytics disposition / missing facts |
|---|---|---|---|
| `auth:check` | `onIncomingMessage`, `src/bot.ts` | `allowed`, admin flags `CF`; `storageContextId H` | Can derive bounded authorization outcome/reason only when joined at source. Needs role/guest/platform/context. |
| `auth:group_authorized` | `addAuthorizedGroup`, `src/authorized-groups.ts` | `groupId H` | Optional context lifecycle; missing initiating actor/platform. |
| `auth:group_revoked` | `removeAuthorizedGroup`, same | `groupId H` | Same gap. |
| `disclosure:search` | `makeSearchToolsTool.execute` | query length/result count `CF` | Diagnostic only; missing turn/outcome. Never persist query text (not present today). |
| `disclosure:load` | `makeLoadToolTool.execute` | loaded/unknown/active counts `CF` | Diagnostic; missing requested tool family and outcome. |
| `disclosure:fallback` | `createDisclosurePrepareStep` | step number `CF` | Canonical fallback needs bounded reason and turn correlation. |

### Cache, trim, memo, identity, schedule, and infrastructure

| Event | Production source | Payload and risk | Analytics disposition / missing facts |
|---|---|---|---|
| `cache:load` | `src/cache.ts` (4 sites), `src/cache-instructions.ts` | bounded field name `CF` | Aggregate diagnostic only; implicit raw scope. |
| `cache:sync` | `src/cache.ts` (6 sites), `src/cache-instructions.ts` (2) | field/operation `CF` | Aggregate diagnostic only. |
| `cache:expire` | `cleanupExpiredCaches`, `evictUser` | no data | Aggregate diagnostic; implicit raw subject. |
| `trim:start` | `performTrim`, `src/conversation.ts` | history length `CF`, reason `C/D` | Optional performance/feature fact after bounded reason mapping. |
| `trim:end` | `performTrim` success/failure | kept/dropped/success `CF`; raw error `E` on failure | Scrub error; missing duration/model. |
| `memo:created` | `saveMemo`, `src/memos.ts` | memo ID `H`, memo content `C` | Keep only feature outcome; drop both raw values. |
| `memo:searched` | `keywordSearchMemos` | query `C`, result count `CF` | Keep result-count bucket only. |
| `memo:archived` | `archiveMemos` (3 branches) | memo IDs `H[]`, empty for tag/date branches | Map method/count at source; never forward IDs/tag/date content. |
| `identity:set` | `setIdentityMapping` | provider user ID `H`, provider enum/name `CF/D` | Feature adoption only; never provider raw ID. |
| `identity:cleared` | `clearIdentityMapping` | no data | Feature lifecycle; missing provider/context. |
| `recurring:created` | `createRecurringTask` | task ID `H`, name `C`, schedule/RRULE `C/H` | Keep feature outcome and safe trigger kind/timezone bucket supplied at source. |
| `recurring:updated` | `updateRecurringTask` | task ID `H` | Feature lifecycle; needs changed-field categories. |
| `recurring:paused` | `pauseRecurringTask` | task ID `H` | Feature lifecycle. |
| `recurring:resumed` | `resumeRecurringTask` | task ID `H` | Feature lifecycle. |
| `recurring:skipped` | `skipNextOccurrence` | task ID `H` | Feature lifecycle. |
| `recurring:deleted` | `deleteRecurringTask` | task ID `H` | Feature lifecycle; optional age bucket. |
| `recurring:fired` | `finalizeCreatedRecurringTask` | recurring/created task IDs `H` | Proactive provider success; needs provider/delivery outcome. |
| `scheduler:tick` | `tick`, `src/scheduler.ts` | tick/due counts `CF` | Operations aggregate; missing duration/failures. |
| `scheduler:task_executed` | `finalizeCreatedRecurringTask` | IDs `H` | Provider action success; missing status/duration. |
| `notify:scheduler_fired` | same | recurring ID `H` | Notification attempt candidate, not delivery outcome. |
| `deferred:created` | `executeCreate`, `src/deferred-prompts/tool-handlers.ts` (2 branches) | prompt ID `H` | Feature outcome; missing scheduled/alert type. |
| `deferred:updated` | `executeUpdate` (2) | prompt ID `H` | Feature lifecycle/changed fields. |
| `deferred:cancelled` | `executeCancel` (2) | prompt ID `H` | Feature lifecycle/reason. |
| `deferred:fired` | `executeScheduledPromptsForGroup` | prompt ID `H` | Proactive execution; missing model/provider/delivery. |
| `deferred:alerted` | `markAlertDelivered` | prompt ID `H` | Emitted after delivery path; still needs channel/result semantics. |
| `notify:deferred_alert` | same | prompt ID `H` | Notification fact; missing channel/result. |
| `poller:scheduled` | `pollScheduledOnce` | due count `CF` | Operations aggregate. |
| `poller:alerts` | `pollAlertsOnce` | eligible count `CF` | Operations aggregate. |
| `group_member:added` | `addGroupMember`, `src/groups.ts` | group/user IDs `H` | Optional onboarding; missing actor/platform. |
| `group_member:removed` | `removeGroupMember` | group/user IDs `H` | Optional lifecycle; same gap. |
| `msgcache:sweep` | `sweepExpiredMessages` | swept/remaining counts `CF` | Operations aggregate. |
| `log:entry` | `LogRingBuffer.push`, `src/debug/log-buffer.ts` | arbitrary Pino record containing `msg C` and arbitrary `unknown C/E/H` | **Categorically exclude.** |

## Debug-only derived records are not sources

| Record | Source | Why it is excluded |
|---|---|---|
| `turn:summary` | `src/debug/turn-assembly.ts` | Synthesized only for debug state/SSE clients; can carry raw scope/error and its failure assembler expects fields that do not match actual `turn:end`. |
| `llm:full` | `src/debug/state-collector.ts` | Synthesized from LLM debug detail and contains generated text/steps. |

Neither goes through the production event bus or exists when the debug
collector has no client. Analytics must derive its own typed facts.

## Durable usage inventory

### Bus-subscriber writes

`initUsageRecorder` subscribes at startup:

- `llm:end` and `llm:error` insert `llm_usage_events`;
- `tool:execute_end` inserts `tool_call_events`;
- `tool:failure_classified` updates the matching tool row.

`llm_usage_events` answers token/cost volume, model/role, coarse duration,
message/step/tool counts, finish reason, and raw error presence. It lacks
platform instance/provider/task assignment/actor role/guest/intent/session/
reply/confirmation/steering/feature and safe error taxonomy.

`tool_call_events` answers tool volume, executor success, duration/byte sizes,
and later failure class/retry/recovery. A returned structured failure can still
have executor `success=true`; consumers must use classification. The recorder
expects `responseId`, but the emitter does not supply it, so that column is
null.

### Direct writes that bypass the bus

| Path | Direct writer | Role | Important nulls/consequence |
|---|---|---|---|
| `src/embeddings.ts` success/failure | `recordUsage` at the two outcome branches | `embedding` | `turnId`/`responseId` are null. An analytics subscriber alone cannot see embedding usage. |
| `src/web/distill.ts` success/failure | `recordUsage` at the two outcome branches | `small` | `turnId`/`responseId` are null. An analytics subscriber alone cannot see web-distillation usage. |

Historical normalization must read durable usage rows. A later live design can
either retain that canonical backfill path or add explicit safe events at
these source boundaries.

### Idempotency and current outbox limits

Usage event IDs and tool-call event IDs are deterministic SHA-256 values.
Insert recorders swallow duplicate primary keys; classification is a normal
update and silently changes zero rows if the execution row never arrived.

Both tables expose `forwarded_at`, `forward_attempts`, and `forward_error`.
There is no pending-row query, lease, destination/schema identity, batcher,
retry/backoff, bounded concurrency, consent recheck, deletion state, or
mutation of those fields. `forwarded_at IS NULL` currently means “no
forwarder,” not a delivery guarantee. The columns cannot model independent
sinks or payload variants.

## Stats anonymity and hashing

The `/stats/*` contract permits counts, sizes, timestamps, enum distributions,
and keyed-hashed high-cardinality identifiers while forbidding content and
dynamic names. `src/stats/hashing.ts` currently computes salted
`SHA-256(salt + "|" + input)` with a stored, non-rotating
`stats_anonymity_salt`; it is not HMAC.

Analytics uses a dedicated, versioned, domain-separated HMAC key. Actor inputs
include platform and platform instance. Platform/task instances are themselves
pseudonymized. A stats hash is not permission to forward the underlying
dimension or payload.

## Coverage gaps

| Canonical family | Current coverage | Required source work |
|---|---|---|
| Message/turn/reply | partial, but receipt is pre-auth; queue scope malformed; turn shapes differ; reply is uncorrelated attempt | post-auth/eligibility accepted-message signal; explicit canonical dimensions; one completion semantic; adapter-bound delivery outcome; TTFT/live-status clocks |
| Intent | none | controlled taxonomy, strategy provenance, abstention/confidence |
| Tool | strong operational metadata; unsafe raw `llm:tool_result` also exists | strict safe adapter; semantic outcome; tool family/origin/risk; platform/role/provider |
| Confirmation | none | request/resolution/timeout, risk/tool, decision latency |
| Steering/stop | behavior exists, no events | injected/acknowledged steering and graceful/forced stop signals |
| Friction | disclosure fallback only | transient rephrase, clarification and mature abandonment, failure-chain derivation |
| Provider | none | provider/operation/status-class/retry/duration at call boundary |
| Config/onboarding | none | config link, settings open, first/change assignment, preset/configuration outcomes |
| Feature use | recurring/deferred/memo/identity partial; attachment opportunity partial | attachment ingestion outcome, long-term memory capture/promotion, coding, MCP, BYOK, web fetch, live status |
| Auth | coarse check/group lifecycle | explicit denial reason, actor role/guest, post-auth accepted event |
| Errors/infra | LLM/tool partial | bounded MCP/rate-limit/unconfigured/provider classes |
| Durable non-turn usage | embeddings/distillation rows only | canonical backfill or explicit safe live events |

Cross-cutting gaps: no canonical table, typed registry, allowlist test,
governance/eligibility, purpose HMAC, retention/deletion, session/outcome/
friction derivation, per-sink delivery ledger, captured-payload test, or
dashboard reconciliation.

## Phase 1 boundary

Before any analytics subscriber persists a live event:

1. fix/provide authoritative platform instance, actor, role, config context,
   storage/thread context, and turn correlation at the source;
2. move accepted-message analytics after authorization and eligibility;
3. make reply delivery outcome observable after the provider send resolves;
4. keep `llm:tool_result`, `log:entry`, and debug-derived records outside the
   registry;
5. make the subscriber non-throwing and enqueue only local bounded work;
6. normalize every string/ID under the closed schema in
   [`02-metric-catalog.md`](./02-metric-catalog.md);
7. prove raw/prohibited values cannot reach canonical storage or egress.

