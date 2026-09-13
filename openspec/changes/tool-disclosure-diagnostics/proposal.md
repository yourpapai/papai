# Change: tool-disclosure-diagnostics

## Goal

Make the progressive-disclosure mechanism observable end-to-end so the hypothesis "loaded-tool state lost between turns causes silent turn deaths (announced intent, no execution)" can be confirmed or refuted with numbers. Instrument the existing seams only — no new metrics stack, no behavior change to tool calling.

## Explored mechanism (ground truth)

- **Assembly**: `maybeApplyDisclosure` (`src/tools/disclosure/wire.ts:20`) runs per turn in `buildFullToolSet` (`src/llm-orchestrator-tools.ts:223`) after compaction; it creates a **turn-scoped** `DisclosureSession` (`src/tools/disclosure/registry.ts`) — the `loaded` set always starts empty and dies with the turn. `createDisclosurePrepareStep` (`prepare-step.ts`) narrows each step's `activeTools` to core ∪ always-on ∪ loaded, with a stall fallback that latches open and emits `disclosure:fallback` (currently **without** its `reason` — the log.warn has it, the event data does not, so analytics defaults every fallback to `no_real_load`).
- **What happens on a not-loaded call**: the AI SDK raises `NoSuchToolError`; `createRepairToolCall` (`repair-tool-call.ts:13`) silently redirects registered-but-inactive names into `load_tool` (debug log, name only — **never aborts the turn**). Unregistered names keep the error → turn fails. So "rejection as not loaded" == repair redirect; the current instrumentation cannot distinguish "repaired and recovered" from "dropped".
- **`load_tool`** (`load-tool.ts`) emits `disclosure:load` with counts only (no names, no turnId, no already-loaded detection — `markLoaded` silently dedupes re-loads, `registry.ts:39`).
- **Existing lifecycle seams**: `turn:start`/`turn:end` (`src/message-queue/queue.ts`), `llm:start`/`llm:end` (`src/llm-orchestrator-events.ts` — `llm:end` already carries `finishReason`, `steps`, `stepsDetail` with per-step tool names/args in-process), `llm:error` (`llm-orchestrator-logging.ts`), `llm:verifier` (`llm-orchestrator-send.ts:100`), the empty-turn anomaly warn (`llm-orchestrator-support.ts`, pino only), and `deriveVerdict` (`src/completion/verified-completion.ts:95`: `no-op` = empty text + no tool executed, `truncated` = `tool-calls` cap).
- **Persistence**: debug events → `src/analytics/subscriber.ts` (`APPROVED_EVENT_TYPES`; `disclosure:fallback` approved, `disclosure:load` not) → facts → canonical rows in `analytics_events` (SQLite, same DB as the bot; plaintext `props_json`; pseudonymous `turnKey`/`conversationKey`/`actorKey`; indexed by turn/conversation/name; 90-day `expiresAtMs` — `governance/collection-serialization.ts:211`, runbook §Storage). The `turn_completed` fact already has `finishReason`/`stepCount`/`toolCallCount` fields but `buildTurnCompletedFact` (`turn-observer.ts:62`) hardcodes `'unknown'/0/0`.

## Intended behaviour change (instrumentation contract)

Secrets rule: **never raw tool arguments or message text** — names, counts, bounded enums, reasons only.

1. **Turn start** — extend `llm:start` event + `llm_started` fact with `disclosedToolCount`, `activeToolCount` (core ∪ always-on at step 0), `loadedToolCountAtStart` (always 0 — this is the hypothesis made visible), and `conversationTurnIndex` (bounded in-memory per-storage-context counter; best-effort, resets on restart; queries order by `occurredAtMs` regardless). Emitted from `invokeModel`, which already holds `disclosure`.
2. **Load attempts** — thread `turnId` through `maybeApplyDisclosure`/`makeLoadToolTool` (and `LlmInvocationOptions`/`InvocationSource`; `callLlm` has it). Extend `disclosure:load` data with `requested`/`loaded`/`unknown`/`alreadyLoaded` name arrays (cap 16 + `truncated` flag). `markLoaded` returns `alreadyLoaded` instead of silently deduping. Add `disclosure:load` → new `disclosure_load` fact: counts + `toolSlug`/`toolNameKey` (via `classifyAnalyticsTool`) for unknown and already-loaded names.
3. **Not-loaded rejections** — new `disclosure:repair` event from `createRepairToolCall`: `toolName`, `reason: 'not_loaded' | 'unregistered'`, `turnId`. New `disclosure_repair` fact (slug + nameKey + reason). This is the direct cross-turn state-loss symptom.
4. **Turn end markers** — `runTurn` (`src/llm-orchestrator.ts:184`) emits a compact `turn:outcome` event (turnId, finishReason, toolCallCount, emptyText flag, hadToolFailure) derived from the resolved result; error path stays covered by `llm:error`. `buildTurnCompletedFact` fills the real `finishReason`/`stepCount`/`toolCallCount` and adds a bounded `end_marker` prop: `clean | empty_generation | step_cap_truncated | partial_tool_failure` (outcome `llm_error` already marks transport failures). "Announced intent, then silence" becomes: outcome `ok` + `end_marker='empty_generation'` + zero `tool_completed` rows for the turnKey + billed tokens on `llm_completed`. Also pass `reason` (`pre_load_stall | meta_tool_churn`) into the `disclosure:fallback` event so its existing fact stops defaulting.
5. **Retention** — canonical events auto-expire at 90 days (≥ the required ~2 weeks); nothing new to operate.

## Files to touch

`src/tools/disclosure/{registry,load-tool,repair-tool-call,prepare-step,wire}.ts`; `src/llm-orchestrator-tools.ts`, `src/llm-orchestrator.ts`, `src/llm-orchestrator-invoke.ts`, `src/llm-orchestrator-events.ts`; analytics contract chain (`subscriber-schemas.ts`, `subscriber.ts`, `source-facts.ts`/`source-facts-message.ts`, `controlled-types.ts`, `registry-events.ts`, `governance/collection-serialization.ts`, `event-props-common.ts`, `normalizer*.ts`, `turn-observer.ts`, `bot-message-handler.ts`); new `src/analytics/jobs/disclosure-diagnostics.ts` + `scripts/analytics-disclosure-diagnostics.ts` (pattern of `analytics-stage-b-report.ts`/`analytics-friction-sample.ts`); tests under `tests/tools/disclosure/`, `tests/analytics/` (per local patterns); `docs/architecture/tools.md` + `docs/operations/analytics-runbook.md`.

## Ready-made queries (shipped as code, TDD'd)

Over `analytics_events` (DB_PATH SQLite): **Q1** announced-intent-then-silence turns (`turn_completed` `end_marker='empty_generation'`, zero tool executions, with `llm_completed` outputTokens) and their co-occurrence with `disclosure_repair`/`disclosure_load`/`disclosure_fallback` rows sharing `turnKey` (plus the N preceding turns of the same `conversationKey`); **Q2** rejections-as-not-loaded grouped by `tool_slug`/day; **Q3** re-loads of already-loaded tools (`disclosure_load` where already-loaded > 0) grouped by slug/day.

## First verdict — stated assumption

Production rows for the new events exist only after this ships, and this job has no production-DB access. This change delivers the instrumentation + queries + a documented run procedure (script `--help` + runbook section) with the confirmed / refuted — dominant-pattern-X / insufficient-data verdict template; the verdict itself is produced by running the script over the production DB once ≥2 weeks of data has accumulated, and posted to the issue.

## Capabilities

### New Capabilities

- `tool-disclosure-diagnostics` — durable, queryable per-turn disclosure diagnostics (turn-start state, load attempts, not-loaded repairs, re-loads, turn-end markers) in the existing analytics event store, with operator queries over retained data.

### Modified Capabilities

None — `openspec/specs/` has no disclosure/analytics-fact corpus entry to modify.

## Non-goals

No changes to tool-calling/disclosure semantics (no cross-turn activation memory, no repair-behavior change); no fixes for empty-generation/transport bugs (follow-up once data is in); no alerting, no UI/dashboard, no new metrics stack, no OTel (that is `telemetry-metrics`' separate lane).

## Verification

TDD per unit: registry `alreadyLoaded` semantics; `disclosure:load` names/turnId; `disclosure:repair` event + reasons; fallback `reason` passthrough; subscriber mapping + fail-closed schemas for the new/extended events; `turn_completed` real fill-in + `end_marker` derivation (including the announced-intent-then-silence shape); query job against an in-memory test DB (`setupTestDb` pattern) covering all three queries including co-occurrence and empty-result behavior. Full gates green: `bun run test`, `bun run typecheck`, `bun run lint`, `bun check:full`; final report states where the instrumentation lives, a sample canonical row, and the verdict procedure.
