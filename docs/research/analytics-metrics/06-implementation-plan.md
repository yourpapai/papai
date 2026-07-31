<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Analytics and product-metrics implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship privacy-preserving product analytics in staged, independently reversible increments: C0 daily aggregates by default, governed local pseudonymous analysis for RQ1–RQ8, read-only Metabase snapshots, and separately gated external aggregate/pseudonymous delivery lanes.

**Architecture:** Authorized source boundaries emit only typed facts into a non-throwing, bounded local analytics runtime. `local_aggregate` updates a strict C0 daily contract without durable actor/context/thread/turn/session keys. Every local or external pseudonymous writer carries a generation-bearing operational `CollectionEligibilityRef` and transactionally rechecks it under the withdrawal fence before canonical insert. Derived sessions/outcomes/friction and reviewed BI models read that canonical store. External delivery uses independent per-sink-version rows referencing a separate operational delivery grant and rechecks it at enqueue, lease, and the durable send-start transition; no debug payload is forwarded and no external pseudonymous sink is enabled until deletion and replay gates pass. Durable process epochs and bounded disposition/contribution associations distinguish complete conservation from restart gaps without a raw source journal.

**Tech Stack:** Bun, strict TypeScript, Zod v4, `bun:sqlite`, Drizzle ORM, pino, `p-limit`, Svelte 5 settings UI, Bun tests, Storybook contracts, Semgrep, Metabase OSS over a read-only SQLite snapshot.

## Global constraints

- The binding specifications are
  [`02-metric-catalog.md`](./02-metric-catalog.md),
  [`03-privacy-consent-threat-model.md`](./03-privacy-consent-threat-model.md),
  [`04-intent-labeling-spike.md`](./04-intent-labeling-spike.md),
  [`05-provider-scorecard-and-poc.md`](./05-provider-scorecard-and-poc.md), and
  [`07-validation-and-review-ritual.md`](./07-validation-and-review-ritual.md).
  If implementation reveals an ambiguity, stop that task and amend the
  versioned specification through review; do not silently choose a new
  definition in code.
- The original Phase 5 seed suggested reusing
  `llm_usage_events.forwarded_*` and `tool_call_events.forwarded_*`. The
  completed privacy research supersedes that suggestion. Those columns remain
  inert. Delivery state lives in `analytics_deliveries` (and the parallel
  aggregate-release ledger) because consent changes, leases, payload versions,
  deletion, and multiple sinks require independent rows.
- The debug bus in `src/debug/event-bus.ts` remains a diagnostic source, not an
  analytics contract. Adapters switch on a closed event set and construct new
  objects field-by-field. They never spread `DebugEvent`, `event.data`, tool
  arguments/results, provider bodies, errors, or log records.
- `message:received`, `llm:tool_result`, `log:entry`, `turn:summary`, and
  `llm:full` are never canonicalized. Accepted-message analytics begins only
  after authorization, mention/reply filtering, and eligibility resolution.
- `off` is an immediate kill switch. `local_aggregate` is the shipping default.
  `local_pseudonymous`, `external_aggregate`, and `external_pseudonymous` are
  separate gates. External pseudonymous delivery requires an operator-enabled,
  reviewed sink **and** an actor-level `allow`.
- `local_pseudonymous` adds eligible canonical events without disabling the C0
  aggregate base. Guests and ineligible actors still contribute only to
  permitted aggregate cells.
- Guests are aggregate-only. No configuration may durably store a guest actor,
  context, thread, turn, session, intent, dynamic tool/model, or coding key.
- HMAC keys are supplied outside the SQLite database. Analytics, governance,
  stats, tool, model, and coding purposes remain domain-separated.
  `src/stats/hashing.ts` and `stats_anonymity_salt` are never reused.
- Current migration registration ends at
  `migration071MessageEmbeddings` in `src/db/index.ts` (master added
  `069_alert_matched_task_ids` after this plan was written, then
  `070_message_metadata_history_search` and `071_message_embeddings`;
  verified on rebases 2026-07-24 and 2026-07-26). The steps below reserve
  `072`–`075`. Before editing, verify that baseline; if the branch has
  advanced further, renumber the four new migrations as one consecutive block
  without changing their order.
- All new imports use `.js` extensions. Logging is pino metadata-first and
  never includes keys, raw identifiers, content, endpoints, tokens, request or
  response bodies, or raw errors.
- Red/fail/minimal-green checkboxes below are scoped to roughly two to five
  minutes; exact fixture-enumeration and release-command checkboxes are
  verification gates rather than a time promise. Run the named narrow test
  immediately after each red/green pair and split a step locally if its first
  execution exceeds five minutes. Do not batch several red tests or several
  implementation changes.
- Each task ends in its own commit. Record `git rev-parse HEAD` in the pull
  request after the task so a stage can be reverted without guessing.
- An applied database migration is not rolled back destructively. Runtime
  rollback means set the kill switch, stop subscribers/workers, cancel pending
  delivery, and leave additive tables dormant until a separately reviewed
  cleanup migration is safe.
- An in-memory observer queue cannot quantify crash loss. A window crossing an
  unclean process epoch is `unreconciled_restart_gap`, is suppressed from
  publication/egress/rollout evidence, and is never balanced with an invented
  loss count. Open the durable epoch before producers, close it only after
  ingress stops and all writer/counter queues drain, and on startup mark every
  stale-open epoch plus each intersecting UTC bucket unreconciled, including an
  already-finalized bucket. Do not add a raw durable source-fact journal.
- Phase gates are cumulative. Every applicable privacy contract from
  `03-privacy-consent-threat-model.md` blocks release even when the general
  test suite is green.

## Planned file and responsibility map

### Core contracts and storage

| File                                                  | Responsibility                                                                                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `src/analytics/contracts.ts`                          | Strict `AnalyticsEventV1`, `AnalyticsAggregateV1`, controlled enums, branded keys, and per-event props union                   |
| `src/analytics/registry.ts`                           | One immutable registry tying event name, props schema, privacy class, aggregate mapping, source family, and metric/RQ coverage |
| `src/analytics/normalizer.ts`                         | Fail-closed source-fact normalization; no generic metadata bag                                                                 |
| `src/analytics/aggregate.ts`                          | Closed C0 counter/fixed-histogram increments and daily bucket finalization                                                     |
| `src/analytics/identity/keyring.ts`                   | Parse versioned analytics/governance keyrings from environment without logging secrets                                         |
| `src/analytics/identity/install-id.ts`                | Get/create the non-secret random installation ID used only as deployment-key HMAC input                                        |
| `src/analytics/identity/pseudonym.ts`                 | Raw-domain/NUL/component-length HMAC-SHA-256 encoding with frozen vectors and 192-bit base64url output                         |
| `src/analytics/turn-context.ts`                       | TTL-bounded, in-memory authorized turn facts keyed by raw turn ID; raw facts never persist                                     |
| `src/analytics/rephrase/handoff.ts`                   | Exact capture/complete/withdraw lifecycle; max-three TTL state and one matched prior outside normalized queues                 |
| `src/analytics/process-epoch.ts`                      | Durable open-before-producers/drain-before-close lifecycle and stale-open startup recovery                                     |
| `src/analytics/runtime.ts`                            | Mode gate, bounded queues, non-throwing public observer, fenced writer lifecycle, and per-epoch disposition counters           |
| `src/analytics/subscriber.ts`                         | Closed adapter for approved existing LLM/tool debug signals                                                                    |
| `src/db/analytics-schema.ts`                          | Events/aggregates plus process epochs, bounded source counters, epoch associations, rejects, and backfill maps                 |
| `src/db/analytics-governance-schema.ts`               | Operational policy/preferences, collection fences/event refs, delivery grants, rekey state, and snapshot publication           |
| `src/db/analytics-delivery-schema.ts`                 | Versioned soft-disabled sinks, grant-referenced event delivery, aggregate release, and deletion receipts                       |
| `src/db/migrations/072_analytics_foundation.ts`       | Canonical/aggregate/process-epoch/reconciliation/rejection/backfill tables and indexes                                         |
| `src/db/migrations/073_analytics_governance.ts`       | Policy/preferences, collection fences/event refs, delivery grants, deletion, rekey, and snapshot-publication tables            |
| `src/db/migrations/074_analytics_delivery.ts`         | Per-sink-version event/aggregate ledgers including `ambiguous` and restricted evidence deletion                                |
| `src/db/migrations/075_analytics_materializations.ts` | Versioned session, goal-outcome, friction, and feature-opportunity materializations                                            |

### Governance, jobs, and BI

| File                                                   | Responsibility                                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `src/analytics/governance/policy-store.ts`             | Singleton typed policy/mode state and complete governance-readiness check                                    |
| `src/analytics/governance/preference-store.ts`         | Transactional current-row UPSERT, append-only audit, and all-retained-version deny lookup                    |
| `src/analytics/governance/collection-store.ts`         | Generation-bearing collection refs plus same-transaction writer recheck/event association                    |
| `src/analytics/governance/collection-serialization.ts` | Per-ref pseudonymous writer/withdrawal fence; database-backed replacement required for multi-runtime         |
| `src/analytics/governance/grant-store.ts`              | Separate operational delivery-grant generation and atomic revocation/cancellation serialization              |
| `src/analytics/governance/eligibility.ts`              | Pure mode × basis × preference × role × lane decision matrix                                                 |
| `src/analytics/governance/subject-service.ts`          | Authenticated preference, export, withdrawal, deletion, and all-key-version lookup                           |
| `src/analytics/governance/deletion-target-store.ts`    | Encrypted restart/rekey-safe retained-key bundles, destroyed after verified completion                       |
| `src/analytics/governance/snapshot-consumer.ts`        | Metabase quiesce/close/remount/reopen/new-snapshot verification before old-file deletion                     |
| `src/analytics/jobs/backfill.ts`                       | Recoverability-matrix usage normalization with first-creation provenance and resumable high-water            |
| `src/analytics/jobs/derive.ts`                         | Deterministic sessions/outcomes/features/friction plus missing-intent derivation                             |
| `src/analytics/jobs/retention.ts`                      | Startup expiry barrier, earliest-deadline purge, right-censoring, and aggregate retention                    |
| `src/analytics/jobs/reconcile.ts`                      | Source/canonical/aggregate/reject/loss and delivery-state conservation reports                               |
| `src/analytics/storage/epoch-store.ts`                 | Durable epoch rows, bounded per-source dispositions, event association, and aggregate contribution deltas    |
| `src/analytics/jobs/snapshot.ts`                       | Fresh-empty publisher, byte scan/finally cleanup, immutable versions, and consumer-coordinated replacement   |
| `src/analytics/jobs/rekey.ts`                          | Durable domain-complete FK-safe copy/verify/swap/resume workflow                                             |
| `src/analytics/delivery/worker.ts`                     | Bounded grant-serialized lease/send loop with `ambiguous`, expiry, and controlled errors                     |
| `src/analytics/delivery/sink.ts`                       | Write-only versioned sink lifecycle; deletion, idempotency, and reconciliation capabilities                  |
| `src/analytics/delivery/http-policy.ts`                | Fixed HTTPS destination validation and actual-connection DNS pinning with hostname TLS verification          |
| `analytics/metabase/sql/*.sql`                         | Reviewed models for activation, engagement/retention, intents/features, and reliability/friction/performance |
| `scripts/analytics-snapshot.ts`                        | Operator CLI for snapshot creation and reconciliation output                                                 |
| `scripts/analytics-backfill.ts`                        | `--dry-run`, bounded batch, resume, and reconciliation CLI                                                   |
| `scripts/analytics-rekey.ts`                           | Explicit plan/apply/verify phases; never an automatic rotation                                               |

### Source adapters and settings

| Current file or symbol                                                                                                            | Planned change                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/bot.ts` — `createObservedCommandHandler`, `onIncomingMessage`, `handleMessage`, `processCoalescedMessage`                    | Emit post-auth command/message acceptance and pass explicit observer/transient handoff/source context      |
| `src/message-queue/types.ts`, `queue.ts`, `index.ts`                                                                              | Carry authorized turn facts in memory; emit one canonical start/terminal with monotonic queue/turn clocks  |
| `src/bot-reply-tracking.ts`, `src/llm-orchestrator-send.ts`                                                                       | Observe successful/partial/failed provider reply promises and first-real-reply latency                     |
| `src/llm-orchestrator-events.ts`, `src/llm-orchestrator-logging.ts`, `src/llm-orchestrator-tool-events.ts`                        | Preserve debug events and add one post-classification content-free tool terminal with idempotent source ID |
| `src/tools/permission-gate.ts`, `src/chat/permission-prompt.ts`, `src/chat/interaction-router.ts`                                 | Observe prompt-send, decision, timeout, and prompt failure without args/reason/content                     |
| `src/run-control/steering-prepare-step.ts`, `src/commands/stop.ts`                                                                | Observe steering injection/ack and graceful/forced stop stages                                             |
| `src/live-status/reporter.ts`, `src/ai-progress-reporter.ts`, `src/reply-typing-heartbeat.ts`                                     | Observe capability-aware opportunity, visible-feedback timing, and create/update/dismiss outcomes          |
| `plugins/task-provider-kaneo/client.ts`, `plugins/task-provider-youtrack/client.ts`, `plugins/acp/client.ts`                      | Accept explicit request-scoped authoritative analytics context/callback at each operation boundary         |
| `src/mcp/client-pool.ts` — `connectWithRetry`                                                                                     | Emit controlled MCP outcomes from explicit request-scoped context; never infer identity globally           |
| `src/commands/config.ts`, `src/debug/settings-routes.ts`, `src/instances/context-store.ts`, `src/chat/seed-context-assignment.ts` | Emit configuration-link/open/assignment milestones at the mutation boundary                                |
| `src/tools/index.ts` — `makeTools`, feature-specific stores/clients                                                               | Materialize capability-aware opportunities and controlled successful feature use                           |
| `src/runtime/production-deps.ts`, `src/runtime/production-background.ts`, `src/scheduler-instance.ts`                             | Thread observer through `ProductionState`/bot DI and register deadline/high-water/derive/delivery jobs     |
| `src/debug/settings/analytics-routes.ts`, `src/debug/settings/admin/analytics-routes.ts`, `src/debug/settings-api-router.ts`      | Authenticated actor governance/DSAR and admin policy/sink routes                                           |
| `client/settings/fetcher-schemas-analytics.ts`, `analytics-fetchers.ts`                                                           | Strict settings API schemas and calls                                                                      |
| `client/settings/sections/AnalyticsPreferencesSection.svelte`                                                                     | Actor notice, local/external choices, export, withdrawal, and deletion                                     |
| `client/settings/sections/admin/AdminAnalyticsSection.svelte`                                                                     | Mode, policy readiness, retention, sink gates, health, and kill-switch state                               |
| `client/settings/SettingsApp.svelte`                                                                                              | Mount personal and bot-admin analytics sections                                                            |

## Public interfaces to hold stable

The implementation may split files for line limits, but these public shapes
are the seam source code and tests depend on:

```ts
export type AnalyticsLane =
  'off' | 'local_aggregate' | 'local_pseudonymous' | 'external_aggregate' | 'external_pseudonymous'

export type AnalyticsSourceContext = Readonly<{
  platform: 'telegram' | 'mattermost' | 'discord' | 'kontur-talk'
  platformInstanceId: string
  chatUserId: string | null
  nativeContextId: string
  storageContextId: string
  configContextId: string
  contextType: 'dm' | 'group'
  actorRole: 'admin' | 'member' | 'guest' | 'system'
  taskInstanceId: string | null
  taskProvider: 'kaneo' | 'youtrack' | 'none' | 'other'
  invocationMode: 'normal' | 'command' | 'settings' | 'proactive' | 'scheduler'
  rawTurnId: string | null
}>

export type AnalyticsObserver = Readonly<{
  observe(fact: AnalyticsSourceFact): void
  flush(): Promise<void>
  stop(): Promise<void>
}>

export type AnalyticsRequestContext = Readonly<{
  source: AnalyticsSourceContext
  sourceEventId: string
}>

export type ProviderObservationCallback = (
  context: AnalyticsRequestContext,
  observation: ProviderRequestObservation,
) => void

export type DeliveryGrantRef = Readonly<{
  grantKey: string
  keyVersion: string
  generation: number
}>

export type CollectionEligibilityRef = Readonly<{
  refKey: string
  keyVersion: string
  generation: number
}>

export type EligibilityDecision =
  | {
      allowed: true
      lane: Exclude<AnalyticsLane, 'off'>
      policyVersion: number
      collectionEligibility: CollectionEligibilityRef | null
      deliveryGrant: DeliveryGrantRef | null
    }
  | {
      allowed: false
      reason:
        | 'kill_switch'
        | 'mode_off'
        | 'guest_longitudinal'
        | 'governance_incomplete'
        | 'preference_unknown'
        | 'preference_denied'
        | 'sink_unapproved'
        | 'sink_missing_delete'
    }

export interface AnalyticsSink {
  readonly sinkVersionId: string
  readonly mode: 'aggregate' | 'pseudonymous'
  readonly payloadSchemaVersion: 1
  readonly capabilities: Readonly<{
    callerControlledIdempotency: boolean
    deterministicReconciliation: boolean
    deleteActor: boolean
  }>
  send(batch: readonly StrictDeliveryPayloadV1[]): Promise<readonly DeliveryResult[]>
  deleteActor?(actorKey: string): Promise<DeletionResult>
}
```

`AnalyticsSourceFact` is a discriminated union whose variants contain only the
raw fields required for one approved mapping. It is an in-process input type,
never serialized. Provider/MCP operations receive `AnalyticsRequestContext`
explicitly per call; a long-lived client never reads a mutable global identity.
An allowed local/external pseudonymous decision always has
`collectionEligibility`; aggregate lanes always have `null`. Only an external
pseudonymous decision has `deliveryGrant`. Both refs are operational sidecars
and are excluded from canonical contracts, BI, snapshots, logs, and egress.
The operational delivery grant referenced by an outbox row is not part of any
canonical/aggregate envelope: the collection gate passes it directly to the
operational enqueue boundary, and normalization discards it.
`AnalyticsEventV1` and `AnalyticsAggregateV1` remain exactly the contracts in
`02-metric-catalog.md`.

---

## Task 1: Freeze the architecture, strict contracts, and registry closure

**Files:**

- Create: `docs/adr/0308-analytics-governance-and-delivery-lanes.md`
- Modify: `docs/adr/README.md`
- Create: `src/analytics/contracts.ts`
- Create: `src/analytics/registry.ts`
- Create: `tests/analytics/contracts.test.ts`
- Create: `tests/analytics/registry-closure.test.ts`
- Modify: `knip.config.ts` only if the new generated/type-only exports are
  reported unused after the narrow tests

- [ ] Write `tests/analytics/contracts.test.ts` with one valid
      `chat_message_accepted` envelope and assert Zod rejects an extra envelope
      key.
- [ ] Run `bun test tests/analytics/contracts.test.ts`; expect failure because
      `AnalyticsEventV1Schema` does not exist.
- [ ] Add branded `Pseudonym`, `KeyVersion`, `VersionString`, shared controlled
      enums, and a strict top-level envelope schema to
      `src/analytics/contracts.ts`.
- [ ] Run the same test; expect the valid fixture to pass and the extra-key
      fixture to fail.
- [ ] Add one test each for a negative duration, `NaN`, an unknown enum,
      oversized `goals`, an invalid UTC day, and an unsupported schema/event
      version.
- [ ] Add the corresponding finite/non-negative/bounded refinements and
      `.strict()` at every object level; rerun the narrow test green.
- [ ] Add the full canonical event-name set and exact property schemas from
      `02-metric-catalog.md` as a discriminated `PropsByEventName` union.
- [ ] Add compile-time fixtures using `satisfies AnalyticsEventV1` for
      `llm_completed`, `tool_completed`, `intent_classified`, and
      `first_visible_feedback`; run `bun run typecheck` and expect success.
- [ ] Write `tests/analytics/registry-closure.test.ts` asserting equality of
      event-name keys, property-schema keys, source-map keys, and metric/RQ-map
      keys.
- [ ] Run `bun test tests/analytics/registry-closure.test.ts`; expect failure
      because `ANALYTICS_EVENT_REGISTRY_V1` does not exist.
- [ ] Implement `ANALYTICS_EVENT_REGISTRY_V1` as the single immutable registry
      and derive the four key sets from it; do not maintain parallel hand-written
      arrays.
- [ ] Add a test that `llm:tool_result`, `log:entry`, `message:received`,
      `turn:summary`, and `llm:full` cannot appear as canonical registry names.
- [ ] Add strict `AnalyticsAggregateV1Schema`, counter/histogram enums, and
      fixed bucket definitions; test that identity/correlation keys cannot parse
      as aggregate fields.
- [ ] Write ADR 0308 with the two local lanes, two external gates, event-bus
      adapter boundary, dedicated HMAC keys, separate delivery ledger, Metabase
      snapshot, OpenPanel failed pseudonymous gate, and additive migration
      rollback posture.
- [ ] Add ADR 0308 to the ordered index in `docs/adr/README.md` and run
      `rg -n '0308-analytics-governance-and-delivery-lanes' docs/adr/README.md`;
      expect exactly one row.
- [ ] Run
      `bun test tests/analytics/contracts.test.ts tests/analytics/registry-closure.test.ts`
      and expect all assertions to pass.
- [ ] Run `bun run typecheck`; expect no contract or discriminated-union error.
- [ ] Commit with
      `git add docs/adr/0308-analytics-governance-and-delivery-lanes.md docs/adr/README.md src/analytics/contracts.ts src/analytics/registry.ts tests/analytics/contracts.test.ts tests/analytics/registry-closure.test.ts knip.config.ts && git commit -m "feat(analytics): freeze strict event contracts"`.

## Task 2: Add additive analytics storage and migration registration

**Files:**

- Create: `src/db/analytics-schema.ts`
- Create: `src/db/migrations/072_analytics_foundation.ts`
- Create: `src/analytics/storage/event-store.ts`
- Create: `src/analytics/storage/aggregate-store.ts`
- Create: `src/analytics/storage/rejection-store.ts`
- Create: `src/analytics/storage/backfill-provenance-store.ts`
- Create: `src/analytics/storage/epoch-store.ts`
- Modify: `src/db/schema.ts`
- Modify: `src/db/index.ts`
- Create: `tests/db/migrations/072_analytics_foundation.test.ts`
- Modify: `tests/db/migration-registration.test.ts`
- Create: `tests/analytics/storage.test.ts`

The migration must create:

```sql
analytics_process_epochs(
  epoch_id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK(state IN ('open','closed','stale_open')),
  started_at_ms INTEGER NOT NULL,
  close_requested_at_ms INTEGER,
  closed_at_ms INTEGER,
  stale_marked_at_ms INTEGER
)

analytics_events(
  event_id TEXT PRIMARY KEY,
  storage_generation TEXT NOT NULL,
  process_epoch_id TEXT NOT NULL
    REFERENCES analytics_process_epochs(epoch_id) ON DELETE RESTRICT,
  source_ref_key TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  event_name TEXT NOT NULL,
  event_version INTEGER NOT NULL,
  occurred_at_ms INTEGER NOT NULL,
  ingested_at_ms INTEGER NOT NULL,
  source TEXT NOT NULL,
  attribution_quality TEXT NOT NULL,
  app_version TEXT NOT NULL,
  deployment_key TEXT NOT NULL,
  key_version TEXT NOT NULL,
  platform TEXT NOT NULL,
  platform_instance_key TEXT NOT NULL,
  actor_key TEXT,
  context_key TEXT,
  thread_key TEXT,
  conversation_key TEXT,
  task_instance_key TEXT,
  context_type TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  task_provider TEXT NOT NULL,
  invocation_mode TEXT NOT NULL,
  turn_key TEXT,
  session_key TEXT,
  policy_version INTEGER NOT NULL,
  eligibility TEXT NOT NULL,
  max_class TEXT NOT NULL,
  props_json TEXT NOT NULL CHECK(json_valid(props_json)),
  expires_at_ms INTEGER NOT NULL,
  UNIQUE(storage_generation, source_kind, source_ref_key, event_name)
)

analytics_epoch_source_counters(
  epoch_id TEXT NOT NULL
    REFERENCES analytics_process_epochs(epoch_id) ON DELETE RESTRICT,
  utc_day TEXT NOT NULL,
  source_family TEXT NOT NULL,
  disposition TEXT NOT NULL CHECK(disposition IN (
    'opportunity','canonical','normalization_reject',
    'governance_ineligible','aggregate_only','controlled_overflow'
  )),
  value INTEGER NOT NULL CHECK(value >= 0),
  PRIMARY KEY(epoch_id, utc_day, source_family, disposition)
)

analytics_aggregate_epoch_contributions(
  epoch_id TEXT NOT NULL
    REFERENCES analytics_process_epochs(epoch_id) ON DELETE RESTRICT,
  aggregate_cell_key TEXT NOT NULL,
  measure_kind TEXT NOT NULL CHECK(measure_kind IN ('counter','histogram')),
  counter_delta INTEGER NOT NULL CHECK(counter_delta >= 0),
  sample_count_delta INTEGER NOT NULL CHECK(sample_count_delta >= 0),
  sum_delta REAL NOT NULL CHECK(sum_delta >= 0),
  fixed_bucket_counts_delta_json TEXT NOT NULL
    CHECK(json_valid(fixed_bucket_counts_delta_json)),
  PRIMARY KEY(epoch_id, aggregate_cell_key)
)
```

Generation is storage-only physical metadata and is absent from
`AnalyticsEventV1`, props, aggregates, logs, egress, curated model rows, and
user-facing BI dimensions. It may appear only in operational canonical storage
and internal snapshot/publication control metadata. Each physical generation
has a distinct generation-bearing `event_id`; no stable cross-generation event
identifier is persisted. During rekey, only the encrypted run mapping pairs
active and target-shadow event IDs. Add
active-leading indexes on
`(storage_generation, occurred_at_ms)`,
`(storage_generation, actor_key, occurred_at_ms)`,
`(storage_generation, conversation_key, occurred_at_ms)`,
`(storage_generation, turn_key)`, and
`(storage_generation, event_name, occurred_at_ms)`. Add strict daily
counter/histogram tables with all low-cardinality dimensions as primary-key
components, plus
`analytics_normalization_rejections`, `analytics_backfill_runs`,
`analytics_backfill_event_map`, and
`analytics_backfill_aggregate_contributions`. The epoch contribution vector is
validated against the registry's fixed layout and is not a generic metadata
bag. No table has a generic metadata JSON column.

- [ ] Write the migration test asserting all ten foundation tables and five
      canonical indexes are absent before `migration072AnalyticsFoundation.up`.
- [ ] Run
      `bun test tests/db/migrations/072_analytics_foundation.test.ts`; expect an
      import failure.
- [ ] Create migration 072 with `analytics_process_epochs` followed by
      `analytics_events`; rerun and expect the assertions for the remaining
      tables/indexes to fail.
- [ ] Add the five storage-generation-leading indexes, generation-scoped source
      uniqueness, and strict `CHECK` constraints for versions, privacy class,
      finite non-negative times, and valid JSON; rerun the index assertions.
- [ ] Add `analytics_daily_counters` with primary key
      `(utc_day, definition_version, platform, context_type, actor_role, task_provider, app_version, metric)`.
- [ ] Add `analytics_daily_histograms` with the same dimension key plus
      `metric`, strict `fixed_buckets_json`, `counts_json`, `sum`, and
      `sample_count`.
- [ ] Add quality/disclosure columns to both aggregate tables:
      `finalized`, `partial_day`, `restart_gap_detected`, `late_event_count`,
      `reconciliation_status`, `disclosure_scope`, `contributor_basis`,
      `contributor_count`, and `threshold`; constrain reconciliation to
      `complete_epoch|unreconciled_restart_gap`.
- [ ] Add `analytics_epoch_source_counters` with only registry-bounded source
      families/dispositions and atomic non-negative increments. Add
      `analytics_aggregate_epoch_contributions` with exact counter/histogram
      deltas per `(epoch_id,aggregate_cell_key)` and strict fixed-bucket vector
      validation.
- [ ] Add `analytics_normalization_rejections` keyed by
      `(utc_day, source_event_type, reason)` and containing only a count.
- [ ] Add `analytics_backfill_runs` with source table, high-water row key,
      policy cutoff, status, counts, and timestamps; prohibit payload storage.
- [ ] Add `analytics_backfill_event_map(run_id,event_id,source_ref_key)` and
      `analytics_backfill_aggregate_contributions(run_id,aggregate_cell_key,metric,delta,source_ref_key)`
      with unique source mappings and FKs; neither stores raw row IDs.
- [ ] Create matching Drizzle declarations and inferred row types in
      `src/db/analytics-schema.ts`; export them from `src/db/schema.ts`.
- [ ] Register `migration072AnalyticsFoundation` after migration 071 in both
      the imports and `MIGRATIONS` array in `src/db/index.ts`.
- [ ] Update `tests/db/migration-registration.test.ts` to assert 072 is last,
      unique, and ordered; run that test green.
- [ ] Write a storage test that inserts a strict canonical event twice and
      asserts one row plus an `already_present` result and the same durable
      `process_epoch_id`. Insert the same logical/source event into a distinct
      storage generation and assert one physical row per generation with
      distinct physical event IDs and no persisted stable cross-generation ID.
- [ ] Implement the internal physical insert using a deterministic
      generation-bearing physical event ID and generation-scoped source mapping
      uniqueness; never catch a non-uniqueness database failure as success.
      Task 5 exposes only the fenced pseudonymous insertion API.
- [ ] Write a storage test that increments the same counter twice and asserts
      one row with value `2`.
- [ ] Implement atomic counter upsert and strict histogram merge; reject a
      bucket layout that differs from the registered fixed buckets.
- [ ] Write a red transaction test where an event insert succeeds and map
      insert fails; assert neither survives.
- [ ] Implement `insertCanonicalEventForBackfill` so the run map is written
      only when that transaction first creates the event; an existing event
      returns `already_present` without claiming it.
- [ ] Write the equivalent red/green transaction test for aggregate
      first-increment contribution mapping and exact rollback delta; assert its
      epoch contribution increments in the same transaction.
- [ ] Write epoch-store tests for legal `open → closed`, startup
      `open → stale_open`, monotonic close timestamps, bounded dispositions,
      and rejection of an event or aggregate contribution for a missing/closed
      epoch.
- [ ] Write and implement rejection-counter tests proving the source type and
      bounded reason persist but a supplied canary payload does not.
- [ ] Run
      `bun test tests/db/migrations/072_analytics_foundation.test.ts tests/db/migration-registration.test.ts tests/analytics/storage.test.ts`.
- [ ] Run `bun run typecheck`; expect no Drizzle type error.
- [ ] Commit with
      `git add src/db/analytics-schema.ts src/db/migrations/072_analytics_foundation.ts src/db/schema.ts src/db/index.ts src/analytics/storage/event-store.ts src/analytics/storage/aggregate-store.ts src/analytics/storage/rejection-store.ts src/analytics/storage/backfill-provenance-store.ts src/analytics/storage/epoch-store.ts tests/db/migrations/072_analytics_foundation.test.ts tests/db/migration-registration.test.ts tests/analytics/storage.test.ts && git commit -m "feat(analytics): add canonical and aggregate storage"`.

## Task 3: Implement purpose-separated keys and identity/scope normalization

**Files:**

- Create: `src/analytics/identity/keyring.ts`
- Create: `src/analytics/identity/install-id.ts`
- Create: `src/analytics/identity/pseudonym.ts`
- Create: `src/analytics/identity/scope.ts`
- Create: `src/analytics/config.ts`
- Modify: `.env.example`
- Modify: `docs/architecture/environment.md`
- Create: `tests/analytics/keyring.test.ts`
- Create: `tests/analytics/install-id.test.ts`
- Create: `tests/analytics/pseudonym.test.ts`
- Create: `tests/analytics/scope.test.ts`

Use this exact input encoding:

```ts
function encodeComponents(domain: string, components: readonly string[]): Uint8Array {
  const encoder = new TextEncoder()
  const domainBytes = encoder.encode(domain)
  const componentBytes = components.map((value) => encoder.encode(value))
  const size = domainBytes.byteLength + 1 + componentBytes.reduce((total, part) => total + 4 + part.byteLength, 0)
  const output = new Uint8Array(size)
  const view = new DataView(output.buffer)
  output.set(domainBytes, 0)
  let offset = domainBytes.byteLength
  output[offset] = 0
  offset += 1
  for (const part of componentBytes) {
    view.setUint32(offset, part.byteLength, false)
    offset += 4
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}
```

The final value is
`keyVersion + "." + base64url(HMAC-SHA-256(key, encoded))[0..24 bytes]`.
The domain is raw UTF-8, followed by exactly one NUL; only components have
four-byte big-endian lengths, and there is no trailing NUL.

- [ ] Write keyring tests for a valid active key, multiple retained versions,
      duplicate versions, a missing active version, invalid base64url, and keys
      shorter than 32 bytes.
- [ ] Run `bun test tests/analytics/keyring.test.ts`; expect an import failure.
- [ ] Implement strict parsers for `ANALYTICS_HMAC_KEYRING` and
      `ANALYTICS_GOVERNANCE_HMAC_KEYRING`; return a typed unavailable state instead
      of logging or echoing the environment value.
- [ ] Add `.env.example` and environment documentation using redacted example
      values and state that aggregate-local mode needs no HMAC key.
- [ ] Write installation-ID tests for first creation, restart stability,
      concurrent creation, malformed stored value, and absence of hostname/
      database-path input.
- [ ] Store one random installation UUID under a dedicated operational
      `system_config` key; canonical storage receives only its
      `deployment:v1` HMAC.
- [ ] Write deterministic pseudonym fixtures for every purpose domain in the
      catalog, including actor, context, thread, turn, attempt, tool, model,
      deployment, task instance, coding, and governance actor.
- [ ] Add the catalog's frozen `actor:v1` byte/digest/base64url vector; run
      `bun test tests/analytics/pseudonym.test.ts -t 'actor byte vector'` and
      expect a byte mismatch before implementation.
- [ ] Implement raw-domain/NUL/component encoding exactly as the snippet; rerun
      the actor vector and expect it green.
- [ ] Add the frozen empty/Unicode vector for `['', 'é', '猫']`; assert exact
      input bytes, full digest, and first-24-byte base64url output.
- [ ] Run `bun test tests/analytics/pseudonym.test.ts`; expect an import
      failure.
- [ ] Implement length-prefixed HMAC using `node:crypto`; truncate the raw
      digest to 24 bytes before base64url encoding.
- [ ] Add collision-boundary tests proving `['ab','c']` differs from
      `['a','bc']`, different purpose domains differ, and the same input under two
      key versions differs.
- [ ] Add namespace tests proving the same chat user on two platform instances
      differs and the same actor on one platform instance is stable across
      contexts.
- [ ] Write `scope.test.ts` truth-table fixtures for DM, Telegram group thread,
      Mattermost group thread, Discord group, malformed scoped IDs, group config
      sharing, and sibling thread separation.
- [ ] Implement scope resolution by calling `parseScopedContextId` and
      `getConfigContextIdFromStorageContextId`; never split on `:`.
- [ ] Add an assertion that Discord has `thread_key=null` unless the repository
      scope model supplies a real thread scope.
- [ ] Add two Discord DM/group context fixtures for one actor and assert
      `conversation_key = context_key`, the conversation keys differ, and
      session inputs do not merge; retain `thread_key=null` in both.
- [ ] Add a guest fixture and assert the longitudinal key builder returns no
      actor/context/thread/turn/session keys.
- [ ] Run
      `bun test tests/analytics/keyring.test.ts tests/analytics/install-id.test.ts tests/analytics/pseudonym.test.ts tests/analytics/scope.test.ts`.
- [ ] Run `bun run typecheck` and `bun run lint`.
- [ ] Commit with
      `git add src/analytics/identity/keyring.ts src/analytics/identity/install-id.ts src/analytics/identity/pseudonym.ts src/analytics/identity/scope.ts src/analytics/config.ts .env.example docs/architecture/environment.md tests/analytics/keyring.test.ts tests/analytics/install-id.test.ts tests/analytics/pseudonym.test.ts tests/analytics/scope.test.ts && git commit -m "feat(analytics): add purpose-separated identity keys"`.

## Task 4: Add operational policy, preferences, and the eligibility matrix

**Files:**

- Create: `src/db/analytics-governance-schema.ts`
- Create: `src/db/migrations/073_analytics_governance.ts`
- Modify: `src/db/schema.ts`
- Modify: `src/db/index.ts`
- Create: `src/analytics/governance/policy-store.ts`
- Create: `src/analytics/governance/preference-store.ts`
- Create: `src/analytics/governance/collection-store.ts`
- Create: `src/analytics/governance/grant-store.ts`
- Create: `src/analytics/governance/generation-store.ts`
- Create: `src/analytics/governance/eligibility.ts`
- Create: `tests/db/migrations/073_analytics_governance.test.ts`
- Modify: `tests/db/migration-registration.test.ts`
- Create: `tests/analytics/governance-store.test.ts`
- Create: `tests/analytics/collection-store.test.ts`
- Create: `tests/analytics/grant-store.test.ts`
- Create: `tests/analytics/generation-store.test.ts`
- Create: `tests/analytics/eligibility-matrix.test.ts`

`analytics_policy` is a singleton row with local mode, separate external
booleans, policy/notice/controller/purpose fields, lawful-basis mode,
retention maxima, review date, acknowledgement time, and current configuration
version. `analytics_preferences` and `analytics_policy_audit` match the
privacy specification. Store a governance HMAC, never a native actor ID.
Migration 073 also creates operational collection eligibility/event
associations, delivery grants, encrypted deletion target bundles, durable rekey
run/mapping state, and published-snapshot pointers; none is exported to BI.

```text
analytics_collection_eligibility(
  ref_key PK, key_version, state, generation, policy_version,
  effective_at, revoked_at
)
analytics_event_collection_refs(
  event_id PK/FK analytics_events(event_id), ref_key, key_version,
  generation, created_at
)
analytics_deletion_target_bundles(
  request_id PK/FK analytics_deletion_requests(request_id),
  target_ciphertext, target_hash, created_at, destroyed_at
)
analytics_active_generation(
  singleton_id INTEGER PRIMARY KEY CHECK(singleton_id = 1),
  active_generation TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL
)
analytics_rekey_runs(
  run_id PK, source_generation, target_generation,
  from_versions, to_versions, source_high_water,
  phase, subphase, plan_hash, status, mapped_count, copied_count,
  verified_count, swap_completed_at_ms, retire_not_before_ms,
  created_at, updated_at
)
analytics_rekey_mappings(
  run_id FK, domain, old_key_hash, mapping_ciphertext, mapping_hash,
  state, PRIMARY KEY(run_id, domain, old_key_hash)
)
analytics_snapshot_publications(
  snapshot_id PK, storage_generation, transition_run_id NULL FK,
  path_hash, source_high_water, state, published_at, invalidated_at
)
```

The rekey ciphertext contains the old→new pair; plaintext mappings never enter
logs or BI. `phase/subphase` and counters are updated in the same transaction as
each bounded copy step. Migration 073 inserts exactly one
`analytics_active_generation` row and prevents both a second row and deletion
of the singleton. No reader may persist or infer another “current generation”
pointer. `analytics_policy.subject_rights_lookup_horizon_days` is an auditable
v1 constant with `DEFAULT 90 CHECK(subject_rights_lookup_horizon_days = 90)`;
it is an operational old-generation lookup window, not a statement of a
statutory response deadline. A successful swap transaction sets
`swap_completed_at_ms` and anchors `retire_not_before_ms` to that instant plus
the greater of the configured retained-event horizon and this exact 90-day
lookup horizon.

- [ ] Write the migration test for `analytics_policy`,
      `analytics_preferences`, `analytics_policy_audit`, and
      `analytics_deletion_requests`; run it red.
- [ ] Extend the red migration fixture to require
      `analytics_collection_eligibility`,
      `analytics_event_collection_refs`, `analytics_eligibility_grants`,
      `analytics_deletion_target_bundles`, `analytics_active_generation`,
      `analytics_rekey_runs`, `analytics_rekey_mappings`, and
      `analytics_snapshot_publications`.
- [ ] Implement migration 073 with closed-value `CHECK` constraints, timestamps
      as epoch milliseconds, and no foreign key to canonical analytics except
      the deliberate `analytics_event_collection_refs.event_id` operational
      deletion association.
- [ ] Add the default singleton row with `local_mode='local_aggregate'`,
      both external lanes disabled, and pseudonymous governance incomplete.
- [ ] Insert exactly one initial active-generation pointer. Add migration/store
      tests proving a second singleton row and deletion of the only row fail,
      while an atomic update changes the one row and `updated_at_ms`.
- [ ] Add closed rekey statuses `planned|running|paused|completed|aborted` and
      a partial unique index on a constant for
      `status IN ('planned','running','paused')`. In concurrent migration/store
      tests, a second nonterminal run must fail transactionally; only
      `completed` or a plan-phase `aborted` run with no mapping, target row, or
      dual-write state permits a new plan. From the first `dual_write` mutation
      onward, every failure remains `paused` and must resume the same run.
- [ ] Persist `subject_rights_lookup_horizon_days=90`, reject every other v1
      value, and test the retirement calculation against a shorter and equal
      configured retained-event horizon plus rejection of any value above the
      v1 90-day event-retention cap.
- [ ] Make snapshot publications generation-bearing with closed
      `staged|published|invalidated` state and separate partial unique indexes
      on constants permitting at most one `staged` row and at most one
      `published` row. Migration tests reject a publication without a storage
      generation or a second staged/published pointer. The rekey-only staging
      API requires `transition_run_id` to reference the current nonterminal
      run's target generation; the ordinary staging API requires it to be null.
      Restart reuses that run's one staged row idempotently rather than
      accumulating candidates.
- [ ] Register migration 073 after 072 and update the migration registration
      assertion in `tests/db/migration-registration.test.ts`; run both migration
      tests green.
- [ ] Write a policy-store test that an incomplete policy cannot enable
      `local_pseudonymous`.
- [ ] Implement `assessGovernanceReadiness` requiring policy version, notice
      version, controller contact, purpose, lawful basis, retention, review date,
      operator acknowledgement, and available keyrings.
- [ ] Add tests that the environment kill switch overrides every stored mode
      and that no settings mutation can override it.
- [ ] Write preference-store tests for first `allow`, current-row `deny`
      UPSERT, withdrawal, audit append, and retaining a minimal deny marker.
- [ ] Implement preference writes in one transaction: UPSERT/update the one
      row keyed by `governance_actor_key`, set `effective_at/updated_at`, and
      append the controlled audit result before returning success.
- [ ] Assert a second preference mutation leaves exactly one current row and
      two append-only audit rows; no `supersedes_at` column exists.
- [ ] Write grant-store tests proving `delivery-grant:v1` differs from
      governance/analytics actor keys, generation increases on deny, and all
      retained deny-key versions are returned.
- [ ] Add rekey-schema tests requiring distinct source/target generations,
      nullable-until-swap `swap_completed_at_ms` and
      `retire_not_before_ms`, and the complete mapping-domain registry including
      `thread:v1`; reject an unknown domain or equal source/target generation.
- [ ] Implement `GenerationStore.resolveActive()` as the only ordinary
      generation resolver. It reads the singleton persisted row; any cache is
      advisory and must invalidate on `updated_at_ms`.
- [ ] Write collection-store tests proving `collection-eligibility:v1` differs
      from analytics/governance/delivery domains, returns a generation-bearing
      ref for every eligible local/external pseudonymous writer, advances on
      deny, and finds all retained key versions.
- [ ] Implement collection eligibility without importing its ref fields into
      canonical contracts. Expose an exact-generation transaction recheck plus
      event-association insert for the fenced writer and all-version revocation
      lookup for withdrawal.
- [ ] Implement the grant store without imports from canonical analytics
      schema; expose only current generation checks and transactional
      allow/deny mutation.
- [ ] Generate the full Cartesian eligibility fixture over local mode, lawful
      basis, local preference, external preference, actor role, policy readiness,
      sink approval, and lane.
- [ ] Run `bun test tests/analytics/eligibility-matrix.test.ts`; expect an
      import failure.
- [ ] Implement `decideEligibility` as a pure exhaustive function returning the
      `EligibilityDecision` union.
- [ ] Assert guests can only reach `local_aggregate`/eligible external
      aggregate cells and can never reach either pseudonymous lane.
- [ ] Assert consent-unknown actors cannot enter local pseudonymous; documented
      non-consent mode may admit unknown locally after policy effective time, but
      `deny` always blocks.
- [ ] Assert external pseudonymous always requires actor `allow`, operator
      switch, and an approved sink whose capability assessment passes all of
      caller-controlled destination idempotency, deterministic reconciliation,
      and complete per-actor deletion.
- [ ] Assert every allowed local/external pseudonymous collection decision
      carries the current `CollectionEligibilityRef`, aggregate lanes carry
      `null`, and only external pseudonymous carries `DeliveryGrantRef`. No
      canonical/aggregate serializer accepts either operational ref.
- [ ] Write the deletion-target schema test proving only an encrypted,
      access-restricted retained-key bundle may be stored; no native identity,
      pseudonym, grant/ref key, plaintext mapping, or bundle ciphertext is
      reachable from BI exports.
- [ ] Add a test proving preference/audit rows are unreachable through exports
      from `src/db/analytics-schema.ts`.
- [ ] Run
      `bun test tests/db/migrations/073_analytics_governance.test.ts tests/db/migration-registration.test.ts tests/analytics/governance-store.test.ts tests/analytics/collection-store.test.ts tests/analytics/grant-store.test.ts tests/analytics/generation-store.test.ts tests/analytics/eligibility-matrix.test.ts`.
- [ ] Run `bun run typecheck` and `bun run lint`.
- [ ] Commit with
      `git add src/db/analytics-governance-schema.ts src/db/migrations/073_analytics_governance.ts src/db/schema.ts src/db/index.ts src/analytics/governance/policy-store.ts src/analytics/governance/preference-store.ts src/analytics/governance/collection-store.ts src/analytics/governance/grant-store.ts src/analytics/governance/generation-store.ts src/analytics/governance/eligibility.ts tests/db/migrations/073_analytics_governance.test.ts tests/db/migration-registration.test.ts tests/analytics/governance-store.test.ts tests/analytics/collection-store.test.ts tests/analytics/grant-store.test.ts tests/analytics/generation-store.test.ts tests/analytics/eligibility-matrix.test.ts && git commit -m "feat(analytics): enforce governance eligibility"`.

## Task 5: Build the fail-closed normalizer and non-blocking runtime

**Files:**

- Create: `src/analytics/source-facts.ts`
- Create: `src/analytics/normalizer.ts`
- Create: `src/analytics/aggregate.ts`
- Create: `src/analytics/runtime.ts`
- Create: `src/analytics/runtime.testing.ts`
- Create: `src/analytics/process-epoch.ts`
- Create: `src/analytics/subscriber.ts`
- Create: `src/analytics/turn-context.ts`
- Create: `src/analytics/governance/collection-serialization.ts`
- Modify: `src/runtime/production-deps.ts`
- Create: `tests/analytics/normalizer.test.ts`
- Create: `tests/analytics/aggregate.test.ts`
- Create: `tests/analytics/runtime.test.ts`
- Create: `tests/analytics/process-epoch.test.ts`
- Create: `tests/analytics/collection-writer-race.test.ts`
- Create: `tests/analytics/subscriber.test.ts`

The public observer is synchronous and non-throwing. It performs only a closed
type dispatch, low-cost validation/bucketing, and bounded enqueue. SQLite and
network work happen in workers:

```ts
export function createAnalyticsObserver(deps: AnalyticsRuntimeDeps): AnalyticsObserver {
  return {
    observe(fact) {
      try {
        deps.router.route(fact)
      } catch (error) {
        deps.health.increment('observer_failure')
        deps.log.warn({ factType: fact.type, errorClass: classifyInternalError(error) }, 'analytics fact rejected')
      }
    },
    flush: deps.writer.flush,
    stop: deps.writer.stop,
  }
}
```

Never log `fact`, `error.message`, or a serialized rejected value.

- [ ] Write `normalizer.test.ts` with one accepted source fact and assert the
      expected canonical event contains only catalog fields.
- [ ] Run `bun test tests/analytics/normalizer.test.ts`; expect an import
      failure.
- [ ] Define `AnalyticsSourceFact` as a discriminated union with exact variants
      for the registry; keep source context separate from variant-specific facts.
- [ ] Implement one normalizer branch for `chat_message_accepted` by explicitly
      constructing every envelope field and property.
- [ ] Add exact message/auth/turn/reply fixtures requiring one strict event,
      aggregate increment, or bounded rejection per variant.
- [ ] Run
      `bun test tests/analytics/normalizer.test.ts -t 'message lifecycle family'`;
      expect the unimplemented branches to fail.
- [ ] Implement only message/auth/turn/reply branches by field-by-field
      construction; rerun that named fixture green.
- [ ] Add exact LLM/tool/confirmation/feedback fixtures and run
      `bun test tests/analytics/normalizer.test.ts -t 'execution family'`;
      expect the unimplemented branches to fail.
- [ ] Implement only LLM/tool/confirmation/feedback branches; rerun the named
      fixture green.
- [ ] Add exact configuration/provider/MCP fixtures and run
      `bun test tests/analytics/normalizer.test.ts -t 'boundary family'`;
      expect the unimplemented branches to fail.
- [ ] Implement only configuration/provider/MCP branches; rerun the named
      fixture green.
- [ ] Add exact feature/intent/friction fixtures and run
      `bun test tests/analytics/normalizer.test.ts -t 'derived fact family'`;
      expect the unimplemented branches to fail.
- [ ] Implement only feature/intent/friction branches; rerun the named fixture
      green.
- [ ] Make every unknown event/property/enum/version return
      `normalization_rejected` with a bounded reason.
- [ ] Add C3 canaries to text, username, prompt, args, result, error, URL,
      hostname, filename, project/status/tag name, RRULE, token, and raw IDs; scan
      normalized JSON and assert no canary survives.
- [ ] Add raw identifier canaries for actor, context, task, turn, tool, model,
      and coding IDs; assert only purpose-keyed outputs survive in pseudonymous
      mode.
- [ ] Write aggregate tests for a counter, every fixed histogram boundary,
      midnight UTC, finalization, a late event, and a restart gap.
- [ ] Implement `AggregateIncrement` as a closed union and map only the
      `AggregateCounterV1`/`AggregateHistogramV1` set; no source payload can be
      staged for later mapping.
- [ ] Add a test that aggregate mode emits no event ID, exact timestamp,
      platform-instance/task-instance/model/tool key, actor/context/thread/turn/
      session key, intent, or C2 field.
- [ ] Add an in-memory contributor tracker using a process-ephemeral random
      HMAC key; persist only a distinct contributor count and clear its sets at
      UTC-day finalization.
- [ ] Assert a restart makes contributor count unavailable and marks the cell
      `restart_gap_detected` plus `unreconciled_restart_gap`, so publication,
      external release, and rollout evidence suppress it rather than
      undercounting actors or guest contexts.
- [ ] Write a runtime test with queue capacity `2`, enqueue `3` safe facts, and
      assert two writes plus one controlled `queue_full` loss count.
- [ ] Implement separate bounded in-memory queues for aggregate increments and
      already-normalized pseudonymous events; neither queue may contain
      `AnalyticsSourceFact`.
- [ ] Require every local/external pseudonymous writer item to carry its exact
      `CollectionEligibilityRef`; external items also carry
      `DeliveryGrantRef`. Keep both as operational sidecars, never in the
      event/aggregate/log/snapshot/egress payload.
- [ ] Export exactly one pseudonymous insertion API:
      `insertEligibleCanonicalEvent({ event, processEpochId, collectionRef })`.
      Its input type requires a non-null exact `CollectionEligibilityRef`; expose
      no overload/default and keep the physical-row insert private to the fenced
      transaction. Add an API-surface/type test proving callers cannot reach a
      canonical insert that omits the ref.
- [ ] Implement the per-ref collection fence. While holding it, one SQLite
      transaction rechecks the exact ref key/version/generation and current
      allow state, inserts the canonical event plus
      `analytics_event_collection_refs`, associates the open process epoch, and
      increments the epoch's canonical disposition exactly once for the logical
      source opportunity. It resolves the persisted active storage generation
      internally; the caller never supplies generation. Task 13 may add one
      target-shadow physical parent in this same transaction, but that row
      cannot create a second opportunity or disposition. The external enqueue
      transaction separately rechecks its delivery grant.
- [ ] Write both collection races: deny committed before the writer produces
      no canonical/association/delivery row; writer committed before deny is
      found through the operational association and deleted with downstream
      rows before withdrawal acknowledgement. Repeat across retained key
      versions and assert the collection ref is absent from canonical JSON and
      captured egress.
- [ ] Increment opportunity and exactly one terminal disposition counter per
      accepted bounded source path in the same transaction as its durable
      canonical/reject/aggregate disposition where possible. Assert two
      physical generation parents still increment one canonical disposition;
      keep source families and dispositions registry-bounded.
- [ ] Assert no schema/runtime path creates a durable raw source-fact journal;
      only a clean process epoch may claim exact source reconciliation.
- [ ] Add a fake slow writer and prove `observe()` returns before the write
      promise resolves.
- [ ] Add a throwing writer and prove the chat-side call does not throw and no
      raw error reaches logs.
- [ ] Implement `AuthorizedTurnContextRegistry` with register/resolve/complete,
      a two-minute terminal grace period for late child events, a hard TTL, and
      shutdown clearing.
- [ ] Write subscriber tests that select only approved
      `llm:start|end|error`, `tool:request|analytics_completed`, and
      `disclosure:fallback` events when an authoritative turn context exists.
- [ ] Assert the subscriber ignores all five categorically excluded sources
      and rejects an approved event lacking turn context without using debug
      scope as identity.
- [ ] Implement `initAnalyticsRuntime`/`stopAnalyticsRuntime` idempotently,
      subscribe/unsubscribe in `subscriber.ts`, and preserve
      `initUsageRecorder()` unchanged.
- [ ] Implement `ProcessEpochCoordinator`: create the durable open epoch before
      any analytics subscription/producer, bind every writer/counter to it,
      stop producer ingress, drain all queues and counter transactions, then
      close it. Never close merely because finalization ran.
- [ ] On startup, before a new epoch opens, atomically mark every prior open
      epoch `stale_open` and mark every UTC bucket intersecting its
      start-to-startup interval or recorded contribution
      `unreconciled_restart_gap`, even if that bucket was finalized.
- [ ] Change `startDatabase`/`stopDatabase` in
      `src/runtime/production-deps.ts` to start analytics after migrations and
      flush/stop it before closing Drizzle and migration connections.
- [ ] Add lifecycle tests proving startup failure rolls back the subscriber,
      clean shutdown drains and closes its epoch, clean restart leaves it
      complete, crash after a finalized bucket overturns that bucket to
      unreconciled, and a crash spanning UTC midnight marks both days. A forced
      timeout leaves the epoch open for startup recovery without inventing a
      numeric loss count.
- [ ] Run
      `bun test tests/analytics/normalizer.test.ts tests/analytics/aggregate.test.ts tests/analytics/runtime.test.ts tests/analytics/process-epoch.test.ts tests/analytics/collection-writer-race.test.ts tests/analytics/subscriber.test.ts`.
- [ ] Run `bun run typecheck`, `bun run lint`, and `bun security`.
- [ ] Commit with
      `git add src/analytics/source-facts.ts src/analytics/normalizer.ts src/analytics/aggregate.ts src/analytics/runtime.ts src/analytics/runtime.testing.ts src/analytics/process-epoch.ts src/analytics/subscriber.ts src/analytics/turn-context.ts src/analytics/governance/collection-serialization.ts src/runtime/production-deps.ts tests/analytics/normalizer.test.ts tests/analytics/aggregate.test.ts tests/analytics/runtime.test.ts tests/analytics/process-epoch.test.ts tests/analytics/collection-writer-race.test.ts tests/analytics/subscriber.test.ts && git commit -m "feat(analytics): add fail-closed local runtime"`.

## Task 6: Instrument accepted messages, turns, replies, auth, steering, and stop

**Files:**

- Modify: `src/bot.ts`
- Modify: `src/bot-reply-tracking.ts`
- Modify: `src/message-queue/types.ts`
- Modify: `src/message-queue/queue.ts`
- Modify: `src/message-queue/index.ts`
- Modify: `src/run-control/steering-prepare-step.ts`
- Modify: `src/commands/stop.ts`
- Modify: `src/runtime/production-deps.ts`
- Modify: `tests/bot.test.ts`
- Modify: `tests/bot-reply-tracking.test.ts`
- Modify: `tests/bot-steering.test.ts`
- Modify: `tests/message-queue/queue.test.ts`
- Modify: `tests/message-queue/guest-actor-role.test.ts`
- Modify: `tests/run-control/steering-prepare-step.test.ts`
- Create: `tests/runtime/production-deps-analytics.test.ts`
- Create: `tests/analytics/message-turn-integration.test.ts`

Introduce one immutable in-memory turn seed:

```ts
export type AuthorizedTurnSeed = Readonly<{
  sourceEventId: string
  acceptedAtMs: number
  acceptedAtMonotonicMs: number
  source: AnalyticsSourceContext
  inputCount: number
  inputLength: number
  attachmentCount: number
}>
```

`sourceEventId` is generated once at the authorized boundary and HMACed before
durable storage. It is never written raw.

- [ ] Add a bot test asserting denied, blocked, unauthorized-group, ignored
      group chatter, and pre-auth receipt do not emit
      `chat_message_accepted`.
- [ ] Add command-wrapper tests for an authorized first DM, `/config`, and
      coding-session command that never enters `onIncomingMessage`; require one
      `chat_message_accepted` with `invocation_mode='command'` plus its named
      milestone/session activity.
- [ ] Run `bun test tests/bot.test.ts -t 'observed command analytics'`; expect
      no command analytics before the wrapper is wired.
- [ ] Inject `AnalyticsObserver` into `createObservedCommandHandler`, resolve
      the same post-auth source context used by messages, and emit only after
      existing authorization/filter decisions; rerun the named command test
      green.
- [ ] Add an allowed DM and allowed mentioned-group case and assert one
      accepted fact with authoritative platform instance, storage/config scope,
      actor role, and post-filter invocation mode.
- [ ] Add bot-admin/group-admin cases and map them to analytics role `admin`
      without widening the existing tool-execution `ActorRole` union.
- [ ] Run `bun test tests/bot.test.ts`; expect the new assertions to fail.
- [ ] Add an optional `analyticsObserver` to `BotDeps`, resolve authorization
      first in `onIncomingMessage`, and emit bounded `auth_checked` plus accepted
      message facts after the existing filters.
- [ ] Add
      `tests/runtime/production-deps-analytics.test.ts` with a fake observer;
      assert `ProductionState` owns it and both normal-message and command
      wrapper paths receive that exact instance.
- [ ] Run `bun test tests/runtime/production-deps-analytics.test.ts`; expect
      the observer identity assertions to fail.
- [ ] Thread the runtime-owned observer explicitly through `ProductionState`
      and `setupProductionBot` into `setupBot`/`BotDeps` and the observed command
      wrapper; do not read a hidden global. Rerun the production DI test green.
- [ ] Preserve existing diagnostic `message:received`/`auth:check` events for
      debug clients; do not route them through the canonical normalizer.
- [ ] Add a test that an allowed guest produces only aggregate
      `auth_granted`, `message_accepted`, and `guest_turn` increments and no
      pseudonymous fact.
- [ ] Extend `QueueItem`/`CoalescedItem` with `analyticsTurnSeed`; keep the raw
      source context in memory only.
- [ ] Add queue tests asserting coalescing retains the last actor, sums input
      and attachment counts, and uses monotonic timestamps for queue wait and turn
      duration.
- [ ] Register authoritative turn context before `turn_started`; complete it
      after the one terminal event. Stop parsing group/thread scope inside the
      analytics path even though debug emissions retain their old shape.
- [ ] Add a failure-path test proving `turn_completed.outcome='llm_error'`
      contains duration but no raw exception message.
- [ ] Replace reply “attempted” analytics with a delivery observer wrapped
      around each `ReplyFn` promise; keep `didReply()` for existing behavior.
- [ ] Add reply tests for successful text, failed text, mixed text/file partial
      delivery, part count, bounded length, and first-real-reply latency.
- [ ] Thread the raw turn ID into `emitReplyCompletedIfNeeded` for queued model
      turns; preserve command replies with a null turn key.
- [ ] Add a steering test asserting the active-run branch emits
      `turn_steered` with ordinal, length bucket, and acknowledgement result but
      not steer text.
- [ ] Add an injection test in
      `tests/run-control/steering-prepare-step.test.ts` proving the queued content
      reaches the LLM behavior while analytics retains only the bounded steering
      fact.
- [ ] Add stop-command tests for first graceful request and subsequent forced
      request; emit exactly one `turn_stop_requested` per stage.
- [ ] Add an end-to-end analytics integration test covering two accepted
      messages coalesced into one turn and one successful reply; assert message
      count `2`, turn count `1`, reply count `1`, and no raw IDs in stored
      pseudonymous JSON.
- [ ] Run
      `bun test tests/bot.test.ts tests/bot-reply-tracking.test.ts tests/bot-steering.test.ts tests/message-queue/queue.test.ts tests/message-queue/guest-actor-role.test.ts tests/run-control/steering-prepare-step.test.ts tests/runtime/production-deps-analytics.test.ts tests/analytics/message-turn-integration.test.ts`.
- [ ] Run `bun run typecheck` and `bun run lint`.
- [ ] Commit with
      `git add src/bot.ts src/bot-reply-tracking.ts src/message-queue/types.ts src/message-queue/queue.ts src/message-queue/index.ts src/run-control/steering-prepare-step.ts src/commands/stop.ts src/runtime/production-deps.ts tests/bot.test.ts tests/bot-reply-tracking.test.ts tests/bot-steering.test.ts tests/message-queue/queue.test.ts tests/message-queue/guest-actor-role.test.ts tests/run-control/steering-prepare-step.test.ts tests/runtime/production-deps-analytics.test.ts tests/analytics/message-turn-integration.test.ts && git commit -m "feat(analytics): observe authorized turn lifecycle"`.

## Task 7: Instrument LLM, tool, confirmation, disclosure, and performance clocks

**Files:**

- Modify: `src/analytics/subscriber.ts`
- Modify: `src/llm-orchestrator-events.ts`
- Modify: `src/llm-orchestrator-logging.ts`
- Modify: `src/llm-orchestrator-tool-events.ts`
- Modify: `src/llm-orchestrator-invoke.ts`
- Modify: `src/tools/permission-gate.ts`
- Modify: `src/chat/permission-prompt.ts`
- Modify: `src/chat/interaction-router.ts`
- Modify: `src/live-status/reporter.ts`
- Modify: `src/ai-progress-reporter.ts`
- Modify: `src/llm-orchestrator-send.ts`
- Modify: `src/reply-typing-heartbeat.ts`
- Create: `src/analytics/clarification.ts`
- Create: `src/analytics/generated/tool-slugs.ts`
- Create: `scripts/generate-analytics-tool-slugs.ts`
- Modify: `tests/llm-orchestrator-events.test.ts`
- Modify: `tests/llm-orchestrator-logging.test.ts`
- Modify: `tests/llm-orchestrator-tool-events.test.ts`
- Modify: `tests/tools/permission-gate.test.ts`
- Modify: `tests/chat/permission-prompt.test.ts`
- Modify: `tests/live-status/reporter.test.ts`
- Modify: `tests/reply-typing-heartbeat.test.ts`
- Create: `tests/analytics/llm-tool-integration.test.ts`
- Create: `tests/analytics/performance-clocks.test.ts`
- Create: `tests/analytics/tool-slug-generation.test.ts`
- Create: `tests/analytics/clarification.test.ts`

- [ ] Add an LLM integration test requiring one `llm_started` and exactly one
      terminal `llm_completed` with the same purpose-keyed `attempt_key`.
- [ ] Run `bun test tests/analytics/llm-tool-integration.test.ts`; expect the
      start/terminal assertions to fail.
- [ ] Generate attempt identity from raw turn/source ID, model role, and
      ordinal at the outbound request boundary in `invokeModel`; pass ordinal as a
      controlled field through existing event helpers.
- [ ] Extend the subscriber adapters to map model/provider identifiers only to
      controlled role/phase plus `model_key`; never include `model`,
      `actualModel`, `generatedText`, `stepsDetail`, message content, or response
      ID.
- [ ] Add failure tests for resolution, request, and stream phases; assert one
      `llm_failed` terminal and bounded `ErrorClass` without a raw error.
- [ ] Add an aged-open fixture where start has no terminal after the configured
      observation timeout; assert the derived health query reports `aged_open`
      without rewriting it to provider failure.
- [ ] Add TTFT clock tests for first streamed text delta, no-token tool-only
      call, non-streaming response, negative clock, and implausible clock.
- [ ] Record monotonic TTFT only when a text delta occurs; use `null` for
      not-applicable and reject negative/implausible elapsed values.
- [ ] Add tool-ordering tests for immediate success, thrown failure,
      SDK-successful structured failure, and permission denial; require exactly
      one content-free `tool:analytics_completed` after optional failure
      classification, with the lifecycle's stable `sourceEventId`.
- [ ] Run
      `bun test tests/llm-orchestrator-tool-events.test.ts -t 'analytics terminal ordering'`;
      expect the new terminal to be absent.
- [ ] Emit `tool:analytics_completed` (or invoke the equivalent direct
      observer) only after classification resolves; carry the one source ID
      created at tool-request start and the controlled
      `semantic_success|structured_failure|thrown_failure|permission_denied`
      result.
- [ ] Rerun the named ordering test; assert retry/repeated callbacks remain one
      terminal and `tool_started`/`tool_completed` retain identical
      tool-key/family/risk/origin.
- [ ] Add a generator test that reads core and bundled first-party descriptors
      and produces a sorted, duplicate-free `KnownToolSlug` module.
- [ ] Generate `src/analytics/generated/tool-slugs.ts`; make registry closure
      fail when the checked-in output differs from a fresh generation.
- [ ] Generate core/first-party `KnownToolSlug` from registered descriptors;
      map user MCP/external plugin tools to `external_other` plus a purpose HMAC.
- [ ] Add a subscriber test feeding `tool:execute_end`,
      `tool:failure_classified`, and `llm:tool_result` (with success/failure
      canaries); assert all three create no analytics row or delivery item.
- [ ] Map only `tool:analytics_completed` into the canonical terminal and
      assert SDK success with a structured failure is never semantic success.
- [ ] Add permission tests for prompt sent, allow, deny, five-minute timeout,
      prompt-send failure, stale interaction, and decision latency.
- [ ] Run
      `bun test tests/tools/permission-gate.test.ts tests/chat/permission-prompt.test.ts -t 'analytics confirmation lifecycle'`;
      expect the lifecycle facts to be absent.
- [ ] Add an optional lifecycle observer to `askPermissionViaChat`; emit
      `confirmation_requested` only after the button prompt resolves successfully.
- [ ] Emit `confirmation_resolved` from allow/deny, timeout, and prompt failure
      with controlled decision; never emit reason, args, callback ID, source
      message text, or tool raw name.
- [ ] Rerun the named confirmation lifecycle fixture green.
- [ ] Add disclosure-fallback tests for `no_real_load` and
      `meta_tool_churn`; reject any dynamic reason.
- [ ] Add conservative clarification fixtures for controlled missing-input,
      ambiguous-target, ambiguous-action, permission, and configuration
      signals plus a no-signal case.
- [ ] Run
      `bun test tests/analytics/clarification.test.ts -t 'structured signals only'`;
      expect the classifier import/branches to fail.
- [ ] Implement `structured_clarification_v1` from bounded tool/config outcome
      codes only; emit the catalog reason on positive evidence, inspect no
      assistant/user text, and expose detector coverage so undercounting is
      visible.
- [ ] Rerun the named clarification fixture green.
- [ ] Add live-status tests for unsupported, disabled, too-short, eligible,
      create success/failure, ordered updates, and dismiss success/failure.
- [ ] Run
      `bun test tests/live-status/reporter.test.ts -t 'analytics lifecycle'`;
      expect opportunity/lifecycle facts to be absent.
- [ ] Extend `LiveStatusReporterOptions` with a content-free observer and
      monotonic turn clock; emit one opportunity and one lifecycle fact per
      attempted stage.
- [ ] Rerun the named live-status lifecycle fixture green.
- [ ] Add `first_visible_feedback` tests selecting the earliest successful
      typing/status/steer acknowledgement and closing once at terminal when none
      succeeds.
- [ ] Run
      `bun test tests/analytics/performance-clocks.test.ts -t 'first visible feedback'`;
      expect the observer result to be absent.
- [ ] Inject the content-free feedback observer into
      `withReplyTypingHeartbeat`; record only supported/start success/start
      failure/stop and monotonic latency, never provider response or message
      content.
- [ ] Rerun the named first-visible-feedback fixture green.
- [ ] Run
      `bun test tests/llm-orchestrator-events.test.ts tests/llm-orchestrator-logging.test.ts tests/llm-orchestrator-tool-events.test.ts tests/tools/permission-gate.test.ts tests/chat/permission-prompt.test.ts tests/live-status/reporter.test.ts tests/reply-typing-heartbeat.test.ts tests/analytics/llm-tool-integration.test.ts tests/analytics/performance-clocks.test.ts tests/analytics/tool-slug-generation.test.ts tests/analytics/clarification.test.ts`.
- [ ] Run `bun run typecheck`, `bun run lint`, and `bun security`.
- [ ] Commit with
      `git add src/analytics/subscriber.ts src/analytics/generated/tool-slugs.ts src/analytics/clarification.ts scripts/generate-analytics-tool-slugs.ts src/llm-orchestrator-events.ts src/llm-orchestrator-logging.ts src/llm-orchestrator-tool-events.ts src/llm-orchestrator-invoke.ts src/tools/permission-gate.ts src/chat/permission-prompt.ts src/chat/interaction-router.ts src/live-status/reporter.ts src/ai-progress-reporter.ts src/llm-orchestrator-send.ts src/reply-typing-heartbeat.ts tests/llm-orchestrator-events.test.ts tests/llm-orchestrator-logging.test.ts tests/llm-orchestrator-tool-events.test.ts tests/tools/permission-gate.test.ts tests/chat/permission-prompt.test.ts tests/live-status/reporter.test.ts tests/reply-typing-heartbeat.test.ts tests/analytics/llm-tool-integration.test.ts tests/analytics/performance-clocks.test.ts tests/analytics/tool-slug-generation.test.ts tests/analytics/clarification.test.ts && git commit -m "feat(analytics): observe llm tool and feedback outcomes"`.

## Task 8: Instrument provider, configuration, MCP, and feature boundaries

**Files:**

- Create: `src/analytics/provider-observer.ts`
- Create: `src/analytics/provider-request-scope.ts`
- Create: `src/analytics/feature-observer.ts`
- Modify: `src/llm-orchestrator.ts`
- Modify: `src/llm-orchestrator-tools.ts`
- Modify: `src/llm-orchestrator-invoke.ts`
- Modify: `src/llm-orchestrator-types.ts`
- Modify: `src/llm-orchestrator-support.ts`
- Modify: `src/deferred-prompts/proactive-llm.ts`
- Modify: `src/deferred-prompts/proactive-llm-full.ts`
- Modify: `src/deferred-prompts/proactive-llm-helpers.ts`
- Modify: `src/deferred-prompts/poller.ts`
- Modify: `src/deferred-prompts/fetch-tasks.ts`
- Modify: `src/tools/`
- Modify: `src/tools/types.ts`
- Modify: `src/tools/index.ts`
- Modify: `src/tools/tools-builder.ts`
- Modify: `src/tools/collaboration-tools-builder.ts`
- Modify: `src/tools/wrap-tool-execution.ts`
- Modify: `src/tool-failure.ts`
- Modify: `plugins/task-provider-kaneo/client.ts`
- Modify: `plugins/task-provider-kaneo/identity-resolver.ts`
- Modify: `plugins/task-provider-kaneo/kaneo-client.ts`
- Modify: `plugins/task-provider-kaneo/index.ts`
- Modify: `plugins/task-provider-kaneo/provider.ts`
- Modify: `plugins/task-provider-kaneo/operations/`
- Modify: `plugins/task-provider-kaneo/create-task.ts`
- Modify: `plugins/task-provider-kaneo/get-task.ts`
- Modify: `plugins/task-provider-kaneo/list-tasks.ts`
- Modify: `plugins/task-provider-kaneo/search-tasks.ts`
- Modify: `plugins/task-provider-kaneo/update-task.ts`
- Modify: `plugins/task-provider-kaneo/delete-task.ts`
- Modify: `plugins/task-provider-kaneo/task-resource.ts`
- Modify: `plugins/task-provider-kaneo/column-resource.ts`
- Modify: `plugins/task-provider-kaneo/comment-resource.ts`
- Modify: `plugins/task-provider-kaneo/label-resource.ts`
- Modify: `plugins/task-provider-kaneo/project-resource.ts`
- Modify: `plugins/task-provider-kaneo/task-status.ts`
- Modify: `plugins/task-provider-kaneo/task-update-helpers.ts`
- Modify: `plugins/task-provider-kaneo/task-relations.ts`
- Modify: `plugins/task-provider-kaneo/auto-provision.ts`
- Modify: `plugins/task-provider-kaneo/provision.ts`
- Modify: `plugins/task-provider-youtrack/client.ts`
- Modify: `plugins/task-provider-youtrack/collaboration-provider.ts`
- Modify: `plugins/task-provider-youtrack/phase-five-provider.ts`
- Modify: `plugins/task-provider-youtrack/identity-resolver.ts`
- Modify: `plugins/task-provider-youtrack/provider.ts`
- Modify: `plugins/task-provider-youtrack/operations/`
- Modify: `plugins/task-provider-youtrack/helpers.ts`
- Modify: `plugins/task-provider-youtrack/task-helpers.ts`
- Modify: `plugins/task-provider-youtrack/issue-derived-fields.ts`
- Modify: `plugins/task-provider-youtrack/bundle-cache.ts`
- Modify: `plugins/task-provider-youtrack/bundle-values.ts`
- Modify: `plugins/task-provider-youtrack/labels.ts`
- Modify: `plugins/task-provider-youtrack/relations.ts`
- Modify: `plugins/acp/client.ts`
- Modify: `plugins/acp/tools.ts`
- Modify: `plugins/acp/session-tools.ts`
- Modify: `plugins/acp/continue-tool.ts`
- Modify: `src/plugins/runtime-types.ts`
- Modify: `src/plugins/tool-runtime.ts`
- Modify: `src/plugins/contributions.ts`
- Modify: `src/mcp/client-pool.ts`
- Modify: `src/mcp/types.ts`
- Modify: `src/mcp/tool-adapter.ts`
- Modify: `src/mcp/plugin-pool-adapter.ts`
- Modify: `src/mcp/plugin-endpoints.ts`
- Modify: `src/mcp/user-endpoints.ts`
- Modify: `src/providers/types.ts`
- Modify: `src/providers/public-types.ts`
- Modify: `src/providers/auto-provision.ts`
- Modify: `src/providers/registry.ts`
- Modify: `src/providers/membership/ensure-member.ts`
- Modify: `src/providers/membership/subscriber.ts`
- Modify: `src/providers/membership/backfill.ts`
- Modify: `src/identity/resolver.ts`
- Modify: `src/commands/config.ts`
- Modify: `src/debug/settings-routes.ts`
- Modify: `src/debug/settings/provision-routes.ts`
- Modify: `src/debug/settings/byok-routes.ts`
- Modify: `src/debug/settings/group-routes.ts`
- Modify: `src/debug/transcript-viewer.ts`
- Modify: `src/instances/context-store.ts`
- Modify: `src/chat/seed-context-assignment.ts`
- Modify: `src/runtime/production-deps.ts`
- Modify: `src/attachments/store.ts`
- Modify: `src/long-term-memory/capture.ts`
- Modify: `src/long-term-memory/store.ts`
- Modify: `src/web/rate-limit.ts`
- Modify: `src/web/fetch-extract.ts`
- Create: `tests/analytics/provider-observer.test.ts`
- Create: `tests/analytics/provider-request-scope.test.ts`
- Create: `tests/analytics/provider-request-scope-setup-paths.test.ts`
- Create: `tests/analytics/config-milestones.test.ts`
- Create: `tests/analytics/feature-observer.test.ts`
- Modify: `tests/tools/tools-builder.test.ts`
- Modify: `tests/tools/wrap-tool-execution.test.ts`
- Modify: `tests/tool-failure.test.ts`
- Modify: `tests/plugins/task-provider-kaneo/client.test.ts`
- Modify: `tests/plugins/task-provider-kaneo/operations/tasks.test.ts`
- Modify: `tests/plugins/task-provider-kaneo/task-resource.test.ts`
- Modify: `tests/plugins/task-provider-kaneo/provision.test.ts`
- Create: `tests/plugins/task-provider-youtrack/client.test.ts`
- Modify: `tests/plugins/task-provider-youtrack/operations/tasks.test.ts`
- Modify: `tests/plugins/task-provider-youtrack/collaboration-provider.test.ts`
- Modify: `tests/plugins/task-provider-youtrack/identity-resolver.test.ts`
- Create: `tests/plugins/acp/client.test.ts`
- Modify: `tests/plugins/tool-runtime.test.ts`
- Modify: `tests/mcp/client-pool.test.ts`
- Modify: `tests/mcp/tool-adapter.test.ts`
- Modify: `tests/mcp/plugin-endpoints.test.ts`
- Modify: `tests/mcp/user-endpoints.test.ts`
- Modify: `tests/mcp/types.test.ts`
- Modify: `tests/llm-orchestrator-tools.test.ts`
- Modify: `tests/llm-orchestrator-invoke.test.ts`
- Modify: `tests/llm-orchestrator-types.test.ts`
- Modify: `tests/llm-orchestrator-support.test.ts`
- Modify: `tests/llm-orchestrator-disclosure-wiring.test.ts`
- Modify: `tests/llm-orchestrator-tools-compaction.test.ts`
- Modify: `tests/deferred-prompts/proactive-llm.test.ts`
- Modify: `tests/deferred-prompts/proactive-llm-full.test.ts`
- Modify: `tests/deferred-prompts/proactive-llm-helpers.test.ts`
- Modify: `tests/deferred-prompts/poller.test.ts`
- Modify: `tests/tools/index.test.ts`
- Modify: `tests/tools/disclosure/wire.test.ts`
- Modify: `tests/tools/disclosure/prepare-step.test.ts`
- Modify: `tests/tools/disclosure/load-tool.test.ts`
- Modify: `tests/tools/compaction/wrap-compaction.test.ts`
- Create: `tests/tools/logging-privacy.test.ts`
- Modify: `tests/debug/transcript-viewer.test.ts`
- Modify: `tests/commands/config.test.ts`
- Modify: `tests/debug/settings-routes.test.ts`
- Modify: `tests/debug/settings/byok-routes.test.ts`
- Modify: `tests/debug/settings/group-routes.test.ts`
- Modify: `tests/instances/context-store.test.ts`
- Modify: `tests/chat/seed-context-assignment.test.ts`
- Modify: `tests/llm-orchestrator-config.test.ts`
- Modify: `tests/providers/registry.test.ts`
- Modify: `tests/providers/membership/ensure-member.test.ts`
- Modify: `tests/providers/membership/subscriber.test.ts`
- Modify: `tests/providers/membership/backfill.test.ts`
- Modify: `tests/runtime/production-deps.test.ts`
- Modify: `tests/identity/resolver.test.ts`
- Modify: `tests/debug/settings/provision-routes.test.ts`
- Modify: `tests/plugins/task-provider-kaneo/identity-resolver.test.ts`
- Modify: `tests/plugins/task-provider-kaneo/index.test.ts`
- Reference unchanged: `src/tools/disclosure/wire.ts`
- Reference unchanged: `src/tools/disclosure/prepare-step.ts`
- Reference unchanged: `src/tools/compaction/wrap-compaction.ts`

Provider observation is a metadata-only callback at each actual request
boundary:

```ts
type ProviderRequestObservation = Readonly<{
  provider: 'kaneo' | 'youtrack' | 'magi' | 'mcp' | 'llm' | 'other'
  operation: 'read' | 'search' | 'create' | 'update' | 'delete' | 'connect' | 'stream' | 'other'
  durationMs: number
  outcome: 'success' | 'failure'
  statusClass: StatusClass
  retryable: boolean | null
}>

type ObserveProviderRequest = (requestContext: AnalyticsRequestContext, observation: ProviderRequestObservation) => void

type ProviderRequestScope =
  | Readonly<{
      kind: 'actor'
      requestContext: AnalyticsRequestContext
      observeProviderRequest: ObserveProviderRequest
    }>
  | typeof NO_ANALYTICS_SCOPE
```

- [ ] Write provider-observer tests for 2xx, 4xx, 5xx, timeout, network, auth,
      retryable, and unknown-status outcomes; assert response/request bodies and
      URLs are absent.
- [ ] Run `bun test tests/analytics/provider-observer.test.ts`; expect an
      import failure.
- [ ] Implement the pure status/error classifier and monotonic timing helper;
      return controlled values even when an upstream throws a non-`Error`.
- [ ] Write `provider-request-scope` tests for immutable actor scopes, the
      explicit frozen `NO_ANALYTICS_SCOPE` sentinel, missing/malformed scope,
      nested awaited work, reverse-order overlap, rejected operations, and an
      operation intentionally detached past its root callback.
- [ ] Run
      `bun test tests/analytics/provider-request-scope.test.ts`; expect an
      import failure.
- [ ] Implement `provider-request-scope.ts` with
      `AsyncLocalStorage<InternalProviderRequestFrame>`. Export only a
      validating scope constructor, `NO_ANALYTICS_SCOPE`,
      `runWithProviderRequestScope(scope, callback)`, and a fail-closed
      `requireProviderRequestScope()` boundary accessor. Runtime-copy and
      freeze the approved scope fields; never put raw input, URL, payload,
      token, client, or provider object in the store.
- [ ] Make `runWithProviderRequestScope` await the callback and close an
      internal lifetime lease in `finally`. A missing, malformed, or closed
      frame must raise the controlled `provider_scope_missing` failure before
      fetch/SDK I/O. The public scope remains immutable; the private lease is
      only a detached-work guard. `NO_ANALYTICS_SCOPE` permits the operation
      without observation, while absence never silently degrades to it.
- [ ] Update `wrapToolExecution` to validate
      `ToolExecutionOptions.context` as exactly `ProviderRequestScope` and run
      the complete awaited tool execution inside
      `runWithProviderRequestScope`. Map invalid/absent/closed context through
      `tool-failure.ts` to the controlled failure above and prove the provider
      stub was not called.
- [ ] Keep assembled/cached builtin, plugin, and MCP descriptors scope-free and
      unwrapped. After guest/preferences/capability filters, result compaction,
      and disclosure have produced the invocation's actual `ToolSet`—including
      the real `search_tools` and `load_tool` implementations—apply one
      `finalizeProviderScopedTools` pass. It attaches the same strict
      `ProviderRequestScope` `contextSchema` and outer execution wrapper to
      every executable descriptor. No later step may create or replace an
      executable tool; compaction must forward `ToolExecutionOptions`
      unchanged. Keep `tools-builder.ts` and
      `collaboration-tools-builder.ts` factory signatures scope-free; refactor
      their provider-backed registration through one scope-free registration
      helper.
- [ ] Add builder/index closure tests that exercise providerless,
      minimal-capability, all-capability, plugin, and MCP sets. Every
      executable descriptor must reach the final wrapper, preserve ask/deny,
      guest, compaction, and disclosure behavior, and read execution scope
      only from that call's `ToolExecutionOptions.context`. Cover core plus
      every conditional project, comment, label, relation, status, attachment,
      work-item, sprint, query, identity, watcher, vote, and visibility tool.
- [ ] Construct one immutable actor scope per normal turn before
      `prepareLlmInvocation`, carry it in `LlmInvocationOptions` /
      `InvokeModelArgs`. Build AI SDK 7 `toolsContext` as a record keyed by
      every name in the final full `ToolSet`, with each value referencing that
      same immutable scope; never pass the scope object as the whole record and
      never key only the currently active/disclosed names. Pass an independently
      built, full keyed record for the read-only verifier `generateText` call
      in `llm-orchestrator-support.ts`; a verifier tool call must not run
      without its keyed context.
- [ ] Add compaction/disclosure integration tests proving ordinary compacted
      tools plus the disclosure-created `search_tools` and `load_tool` all have
      the common schema/wrapper. Begin with a descriptor inactive, expose it
      through explicit load and fallback-open paths, then execute it with the
      correct scope. Today `prepareStep` changes only `activeTools`, so the full
      keyed record remains valid; if a future step replaces the actual tool
      set, require that step to re-finalize the replacement and rebuild
      `toolsContext` from its keys in lockstep.
- [ ] Put `runWithProviderRequestScope(scope, () =>
  getOrCreateDescriptors(...))` around the descriptor-cache lookup, not
      inside the cache-miss branch and not inside any cached closure. This lets
      MCP `connectWithRetry`/`listTools` on a miss see the current ephemeral
      scope while cache hits and cached tool descriptors retain no actor,
      context, turn, observer, or internal frame.
- [ ] Add normal-path cache tests with two actors sharing cached descriptors:
      force an MCP miss/list for actor A, then execute cached builtin/plugin/MCP
      tools as actor B, complete operations in reverse order, and require exact
      platform/instance/context/turn attribution with no actor-A retention.
- [ ] Build an independent immutable proactive scope with
      `invocationMode='proactive'` from the prompt owner and delivery target.
      Establish it before proactive descriptor construction and build a full,
      tool-name-keyed `toolsContext` record for both the main and
      proactive-verifier `generateText` calls in `proactive-llm.ts`,
      `proactive-llm-full.ts`, and `proactive-llm-helpers.ts`. Add
      consecutive-owner, cached-descriptor, and disclosure fallback tests; no
      proactive call may reuse a normal-turn or prior-owner scope.
- [ ] In alert polling, construct a proactive scope from the alert owner and
      delivery target before `buildProviderFn`, `fetchAllTasks`, or
      `enrichTasks`. Keep provider construction and every task-list/detail
      request inside that awaited scope lease. Add two-owner overlap and
      operational `NO_ANALYTICS_SCOPE` tests; omitted scope must fail before a
      provider method runs.
- [ ] Thread no actor data through individual task-tool factories,
      `TaskProvider` methods, cached provider objects, plugin activation state,
      `KaneoClient` resource getters, MCP pools, SDK clients, singletons, or
      globals. Those long-lived objects carry configuration only; the final
      outbound boundary obtains the active frame from
      `requireProviderRequestScope()`.
- [ ] At every current YouTrack operation/helper, observe at
      `youtrackFetch`/`youtrackUpload`: task CRUD/list/search, inherited
      collaboration and phase-five provider methods, activities, agiles,
      attachments, commands, comments, count, projects, saved queries,
      statuses, team, users, work items, task-list pagination,
      task/custom-field helpers, issue-derived fields, bundle cache/value
      fetchers, labels, relations, and generic pagination. Include upload
      filename/byte-safe observation and identity-resolver searches.
- [ ] At every current Kaneo operation/resource path, observe in
      `kaneoFetch`: provider task methods; task CRUD/list/search wrappers; task,
      column, comment, label, and project resources; task
      status/update/relation helpers; members, users, identity searches,
      `KaneoClient`, and provisioning traffic. Constructors and resource
      getters must not snapshot the current frame.
- [ ] At every ACP session/continue path, keep only long-lived `httpFetch` in
      activation state and observe at `callMagi`. At MCP, observe actual
      `client.callTool` and `listTools` in tool adapters and user/plugin
      endpoint builders plus `connectWithRetry`; connection observation alone
      is insufficient.
- [ ] Add explicit scope inputs to the non-tool roots:
      `maybeAutoProvisionProvider`, registry
      `TaskProviderAutoProvisionContext`/`TaskProviderProvisionContext`,
      `ensureWorkspaceMember`, `attemptAutoLink`, and the authenticated
      settings provision route. Require membership backfill to receive a scope
      explicitly and make startup pass `NO_ANALYTICS_SCOPE` through every
      bounded `ensureWorkspaceMember` call. Actor-triggered paths create/pass
      an actor scope; intentionally operational/bootstrap paths must pass
      `NO_ANALYTICS_SCOPE` at the call site. Never infer an actor from provider
      config, a registry singleton, a membership row, or identity mapping.
- [ ] Add setup-path tests for auto-provision, contributed registry hooks,
      membership ensure/reuse, host identity auto-link, settings provisioning,
      startup membership backfill, YouTrack inherited
      collaboration/phase-five plus identity resolver, and Kaneo
      identity/KaneoClient/plugin entry. For each path, assert actor attribution
      when explicit, no fact under `NO_ANALYTICS_SCOPE`, and fail-before-fetch
      when omitted.
- [ ] Ban fire-and-forget provider work: every provider/Magi/MCP promise must
      settle inside its `runWithProviderRequestScope` callback. Add a static
      closure test over these boundary call sites plus a runtime detached-work
      fixture proving a late fetch sees a closed lease and is blocked rather
      than inheriting stale actor state.
- [ ] Explicitly exclude the public capability-token transcript proxy from
      actor provider facts by wrapping both upstream fetch functions in
      `NO_ANALYTICS_SCOPE` (or give them a separate reviewed operational
      contract later). Replace upstream exception logging with a controlled
      status/error class so capability tokens, target URLs, and exception text
      cannot persist. The proxy must never reuse an ACP tool actor scope.
- [ ] Invoke the observer in each final YouTrack/Kaneo/Magi/MCP boundary
      `finally` with controlled classifications only. The callback must be
      stable and non-throwing; an observation failure cannot change provider
      behavior. Rerun overlap, setup-path, wrapper, and full provider operation
      suites green.
- [ ] Add focused client and outer-catch tests using fake fetch that inject
      canaries into URL/path/query, request bodies/headers, response/error
      bodies (JSON and non-JSON), auth headers, exception/SDK text, IDs,
      filenames/bytes, MCP text/error/dynamic tool names, host, and base URL.
      Capture pino, serialized analytics, and outbox records and assert none
      survives.
- [ ] Audit every executable factory reachable from the finalized `ToolSet`,
      not just the common wrapper. Replace inner success, blocked, and failure
      logs that contain raw query/title/name/filename, native IDs, provider
      payloads, or uncontrolled `error.message` with counts, closed enums,
      controlled error classes, or a separately reviewed purpose HMAC. Add a
      logging-privacy closure test that exercises all-capability core/plugin/MCP
      tools with canaries and statically fails when a registered factory adds an
      unreviewed dynamic log field.
- [ ] Replace touched YouTrack raw path/error-body/file-name logging and Kaneo
      raw base-URL/path/response-body/validation-detail logging with bounded
      operation/status/error classes. Sanitized provider errors must not embed
      paths that an operation wrapper can re-log through `error.message`.
      `callMagi` may return its product error body but analytics and logs never
      inspect or copy it.
- [ ] Add MCP connection tests around `McpConnectionPool.connectWithRetry` for
      available, connection failure, timeout, and auth failure. (Policy block:
      no connect-time policy gate exists — the HTTPS rule is a config-schema
      parse gate, so `policy_blocked` is intentionally unproduced in v1;
      documented in `src/mcp/connect-observation.ts`.)
- [ ] Add MCP execution tests around `tool-adapter.ts` and both endpoint
      builders for call/list success, failure, and overlap; assert the request
      scope reaches the actual client call and no endpoint/tool payload enters
      analytics or logs. Use cached descriptors plus a shared pool, and replace
      `PoolEntry.lastError`/endpoint re-logging with controlled error classes so
      raw MCP content cannot persist.
- [ ] Emit only origin, purpose-keyed server key, and bounded outcome; never
      server URL, display name, headers, tool list, or exception.
- [ ] Write configuration milestone tests for issued/rate-limited/not-
      configured config links and success/expired/invalid settings exchanges.
- [ ] Observe `config_link_issued` after the command result is known and
      `settings_opened` after authenticated exchange/bootstrap outcome; never
      store the link, auth code, cookie, IP, or user agent.
- [ ] Add task-assignment tests for no change, first assignment, and changed
      assignment across manual settings and cold-context seeding.
- [ ] Emit `task_instance_assigned` in the transactional store mutation path
      so both `maybeSeedContextAssignment` and settings routes share one source of
      truth.
- [ ] Write feature-opportunity tests asserting at most one row per
      `(actor_key, feature, UTC day)` and snapshotting capability, provider, role,
      configuration, and platform support.
- [ ] Add retry, process-restart, and concurrent-first-write fixtures requiring
      the exact source reference
      `HMAC(feature-opportunity:v1, actor_key, feature, utc_day)` and one durable
      event row.
- [ ] Run
      `bun test tests/analytics/feature-observer.test.ts -t 'durable daily uniqueness'`;
      expect duplicate rows before the deterministic reference is implemented.
- [ ] Derive the event ID from that source reference and rely on the canonical
      uniqueness transaction; rerun the named fixture green.
- [ ] Add a content-free opportunity observer after `makeTools` resolves the
      available surface; never infer opportunity from later tool use.
- [ ] Add feature-use fixtures for recurring/deferred and memory write/search;
      run
      `bun test tests/analytics/feature-observer.test.ts -t 'tool and memory features'`
      red, implement only those controlled boundaries, then rerun green.
- [ ] Add feature-use fixtures for attachment/web fetch/live status; run the
      named `surface features` fixture red, implement only those boundaries,
      then rerun green.
- [ ] Add feature-use fixtures for coding/MCP; run the named
      `integration features` fixture red, pass explicit request context through
      those boundaries, then rerun green.
- [ ] Observe successful BYOK enablement and guest-mode enablement after their
      authenticated settings mutations; the latter is a group-setting event,
      never a guest actor event.
- [ ] Run
      `bun test tests/analytics/config-milestones.test.ts -t 'settings mutation milestones'`;
      expect the BYOK/group assertions red, implement only those mutation
      callbacks, then rerun green.
- [ ] Add a feature-boundary closure assertion covering attachment store,
      memory capture/search, coding client, MCP pool, web quota/fetch, settings
      mutations, live status, and post-classification semantic
      `tool_completed`; every registered feature has one named
      success/failure/blocked producer and no inference from use alone.
- [ ] Purpose-key coding project/session IDs and dynamic server/tool IDs before
      persistence; omit filenames, memory text, URLs, project/session names, and
      provider payloads.
- [ ] Add web rate-limit tests requiring one `rate_limit_blocked` fact with
      `limit='web_fetch'` and no URL or actor raw ID.
- [ ] Add unconfigured-path tests for central LLM, task instance, settings base
      URL, provider credentials, coding credentials, and forge credentials.
- [ ] Emit `unconfigured_reply` only after the corresponding controlled
      fallback reply succeeds; map missing configuration keys to the catalog
      enum and never store the key list or reply text.
- [ ] Run
      `bun test tests/analytics/provider-observer.test.ts tests/analytics/provider-request-scope.test.ts tests/analytics/provider-request-scope-setup-paths.test.ts tests/analytics/config-milestones.test.ts tests/analytics/feature-observer.test.ts`.
- [ ] Run the existing provider/client suites affected by the injected
      observer; expect unchanged product results when an actor scope or
      `NO_ANALYTICS_SCOPE` is explicit, and fail-before-I/O only when scope is
      omitted or invalid.
- [ ] Run
      `bun test tests/llm-orchestrator-tools.test.ts tests/llm-orchestrator-invoke.test.ts tests/llm-orchestrator-types.test.ts tests/llm-orchestrator-support.test.ts tests/llm-orchestrator-disclosure-wiring.test.ts tests/llm-orchestrator-tools-compaction.test.ts tests/deferred-prompts/proactive-llm.test.ts tests/deferred-prompts/proactive-llm-full.test.ts tests/deferred-prompts/proactive-llm-helpers.test.ts tests/deferred-prompts/poller.test.ts tests/tools/index.test.ts tests/tools/tools-builder.test.ts tests/tools/wrap-tool-execution.test.ts tests/tools/disclosure/wire.test.ts tests/tools/disclosure/prepare-step.test.ts tests/tools/disclosure/load-tool.test.ts tests/tools/compaction/wrap-compaction.test.ts tests/tools/logging-privacy.test.ts tests/tool-failure.test.ts tests/providers/registry.test.ts tests/providers/membership/ensure-member.test.ts tests/providers/membership/subscriber.test.ts tests/providers/membership/backfill.test.ts tests/identity/resolver.test.ts tests/plugins/task-provider-kaneo tests/plugins/task-provider-youtrack tests/plugins/acp tests/plugins/tool-runtime.test.ts tests/mcp tests/debug/transcript-viewer.test.ts tests/commands/config.test.ts tests/debug/settings-routes.test.ts tests/debug/settings/provision-routes.test.ts tests/debug/settings/byok-routes.test.ts tests/debug/settings/group-routes.test.ts tests/instances/context-store.test.ts tests/chat/seed-context-assignment.test.ts tests/llm-orchestrator-config.test.ts tests/runtime/production-deps.test.ts`.
- [ ] Run `bun run typecheck`, `bun run lint`, and `bun security`.
- [ ] Commit with
      `git add src/analytics/provider-observer.ts src/analytics/provider-request-scope.ts src/analytics/feature-observer.ts src/llm-orchestrator.ts src/llm-orchestrator-tools.ts src/llm-orchestrator-invoke.ts src/llm-orchestrator-types.ts src/llm-orchestrator-support.ts src/deferred-prompts/proactive-llm.ts src/deferred-prompts/proactive-llm-full.ts src/deferred-prompts/proactive-llm-helpers.ts src/deferred-prompts/poller.ts src/deferred-prompts/fetch-tasks.ts src/tools src/tool-failure.ts src/providers/types.ts src/providers/public-types.ts src/providers/auto-provision.ts src/providers/registry.ts src/providers/membership/ensure-member.ts src/providers/membership/subscriber.ts src/providers/membership/backfill.ts src/identity/resolver.ts src/plugins/runtime-types.ts src/plugins/tool-runtime.ts src/plugins/contributions.ts src/mcp plugins/task-provider-kaneo plugins/task-provider-youtrack plugins/acp src/commands/config.ts src/debug/settings-routes.ts src/debug/settings/provision-routes.ts src/debug/settings/byok-routes.ts src/debug/settings/group-routes.ts src/debug/transcript-viewer.ts src/instances/context-store.ts src/chat/seed-context-assignment.ts src/runtime/production-deps.ts src/attachments/store.ts src/long-term-memory/capture.ts src/long-term-memory/store.ts src/web/rate-limit.ts src/web/fetch-extract.ts tests/analytics/provider-observer.test.ts tests/analytics/provider-request-scope.test.ts tests/analytics/provider-request-scope-setup-paths.test.ts tests/analytics/config-milestones.test.ts tests/analytics/feature-observer.test.ts tests/llm-orchestrator-tools.test.ts tests/llm-orchestrator-invoke.test.ts tests/llm-orchestrator-types.test.ts tests/llm-orchestrator-support.test.ts tests/llm-orchestrator-disclosure-wiring.test.ts tests/llm-orchestrator-tools-compaction.test.ts tests/deferred-prompts/proactive-llm.test.ts tests/deferred-prompts/proactive-llm-full.test.ts tests/deferred-prompts/proactive-llm-helpers.test.ts tests/deferred-prompts/poller.test.ts tests/tools/index.test.ts tests/tools/tools-builder.test.ts tests/tools/wrap-tool-execution.test.ts tests/tools/disclosure/wire.test.ts tests/tools/disclosure/prepare-step.test.ts tests/tools/disclosure/load-tool.test.ts tests/tools/compaction/wrap-compaction.test.ts tests/tools/logging-privacy.test.ts tests/tool-failure.test.ts tests/providers/registry.test.ts tests/providers/membership/ensure-member.test.ts tests/providers/membership/subscriber.test.ts tests/providers/membership/backfill.test.ts tests/identity/resolver.test.ts tests/plugins/task-provider-kaneo tests/plugins/task-provider-youtrack tests/plugins/acp tests/plugins/tool-runtime.test.ts tests/mcp tests/debug/transcript-viewer.test.ts tests/commands/config.test.ts tests/debug/settings-routes.test.ts tests/debug/settings/provision-routes.test.ts tests/debug/settings/byok-routes.test.ts tests/debug/settings/group-routes.test.ts tests/instances/context-store.test.ts tests/chat/seed-context-assignment.test.ts tests/llm-orchestrator-config.test.ts tests/runtime/production-deps.test.ts && git commit -m "feat(analytics): observe provider and feature boundaries"`.

## Task 9: Add the independent delivery ledger and sink capability gate

**Files:**

- Create: `src/db/analytics-delivery-schema.ts`
- Create: `src/db/migrations/074_analytics_delivery.ts`
- Modify: `src/db/schema.ts`
- Modify: `src/db/index.ts`
- Create: `src/analytics/delivery/sink.ts`
- Create: `src/analytics/delivery/sink-service.ts`
- Create: `src/analytics/delivery/store.ts`
- Modify: `src/analytics/governance/grant-store.ts`
- Create: `tests/db/migrations/074_analytics_delivery.test.ts`
- Modify: `tests/db/migration-registration.test.ts`
- Create: `tests/analytics/delivery-store.test.ts`
- Create: `tests/analytics/sink-gate.test.ts`
- Create: `tests/analytics/sink-lifecycle.test.ts`

The event ledger follows the reviewed contract:

```sql
analytics_sinks(
  sink_version_id TEXT PRIMARY KEY,
  logical_sink_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  payload_schema_version INTEGER NOT NULL,
  egress_mode TEXT NOT NULL,
  endpoint_ciphertext TEXT NOT NULL,
  secret_ciphertext TEXT NOT NULL,
  config_fingerprint TEXT NOT NULL,
  verified_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  disabled_at_ms INTEGER,
  UNIQUE(logical_sink_id, version)
);

analytics_deliveries(
  event_id TEXT NOT NULL REFERENCES analytics_events(event_id) ON DELETE RESTRICT,
  sink_version_id TEXT NOT NULL
    REFERENCES analytics_sinks(sink_version_id) ON DELETE RESTRICT,
  grant_key TEXT NOT NULL,
  grant_key_version TEXT NOT NULL,
  grant_generation INTEGER NOT NULL,
  state TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at_ms INTEGER NOT NULL,
  lease_until_ms INTEGER,
  send_started_at_ms INTEGER,
  last_error_class TEXT,
  delivered_at_ms INTEGER,
  remote_receipt_hash TEXT,
  delete_requested_at_ms INTEGER,
  deleted_at_ms INTEGER,
  payload_schema_version INTEGER NOT NULL,
  PRIMARY KEY(event_id, sink_version_id)
)

analytics_delivery_deletion_receipts(
  deletion_request_id TEXT NOT NULL
    REFERENCES analytics_deletion_requests(request_id) ON DELETE RESTRICT,
  sink_version_id TEXT NOT NULL
    REFERENCES analytics_sinks(sink_version_id) ON DELETE RESTRICT,
  state TEXT NOT NULL,
  remote_receipt_hash TEXT,
  requested_at_ms INTEGER NOT NULL,
  reconciled_at_ms INTEGER,
  PRIMARY KEY(deletion_request_id, sink_version_id)
)
```

`analytics_aggregate_releases` stores only a strict, thresholded aggregate
payload and its deterministic release hash. `analytics_aggregate_deliveries`
uses `(release_id, sink_version_id)` and the same state machine without an actor
grant. Neither table stores a native actor, request/response body, or raw error.
The independent deletion receipt keeps only request/sink IDs, controlled state,
one-way receipt hash, and times—never event ID, actor key, or deletion target.
`analytics_sinks` is immutable by `(logical_sink_id,version)`, stores endpoint
and credentials encrypted with `encryptSecretPayload`, and transitions only
`pending_verification → enabled → disabled`. Settings responses expose only
logical/version IDs, kind, mode, fingerprint, capability gates, state, and
verification timestamps.

- [ ] Write migration assertions for sink, event-delivery, aggregate-release,
      aggregate-delivery, and deletion-receipt tables; run the test red.
- [ ] Implement migration 074 with delivery states
      `pending|leased|sending|delivered|ambiguous|dead|delete_pending|deleted|cancelled`,
      versioned sink state/mode/kind constraints, grant references, and
      `ON DELETE RESTRICT` sink-version evidence FKs.
- [ ] Require `analytics_deliveries.event_id ON DELETE RESTRICT` and add the
      independent minimal deletion-receipt table. A canonical event cannot
      disappear while pending, `sending`, delivered, or ambiguous delivery
      evidence still references it.
- [ ] Add a unique partial index allowing at most one enabled external sink in
      v1.
- [ ] Register migration 074 after 073 and update the migration order test.
- [ ] Write store tests for one event enqueued independently to two disabled
      sink versions; assert unique `(event_id,sink_version_id)` rows and that a
      referenced version cannot be deleted.
- [ ] Implement event enqueue without reading or changing the legacy
      `forwarded_at`, `forward_attempts`, or `forward_error` columns.
- [ ] Add enqueue race tests where grant generation changes before and during
      the transaction; require either an allowed row referencing the exact
      generation or no row, never a stale grant.
- [ ] Implement enqueue as one transaction that rechecks the separate
      operational grant and stores its key/version/generation only in the
      delivery row; canonical analytics never receives the grant.
- [ ] Add lease tests for ready time, lease expiry, bounded attempt increment,
      renewal rejection by a different worker, and atomic state transition.
- [ ] Implement lease acquisition in one SQLite transaction and return only
      event/sink-version IDs plus already-strict payload data.
- [ ] Add the durable send-start boundary: while the lease owner holds the
      grant mutex, atomically recheck the exact grant generation and transition
      `leased → sending` with `send_started_at_ms` immediately before network
      I/O. Only a never-started expired `leased` row may return to `pending`.
- [ ] On recovery, move every orphaned/expired `sending` row to non-retried
      `ambiguous`; never infer whether bytes reached the destination. The
      current owner may classify a known response into its documented terminal
      or retryable state before its lease expires.
- [ ] Add state-conservation assertions:
      `pending + leased + sending + delivered + ambiguous + dead + delete_pending + deleted + cancelled = total delivery rows`.
- [ ] Add lease/replay tests proving `ambiguous` is never selected for
      automatic retry and only an explicit reconciled operator transition can
      resolve it.
- [ ] Add crash fixtures immediately before the durable `sending` transition
      (expired `leased` may retry), immediately after that transition but
      before the call (becomes `ambiguous`), and immediately after remote
      acceptance but before local classification (becomes `ambiguous`). Assert
      no automatic replay in the latter two cases.
- [ ] Add controlled-error tests proving arbitrary network errors map to a
      finite `last_error_class` and no message/body persists.
- [ ] Write sink-gate tests for aggregate-only capability, missing actor
      deletion, missing deterministic reconciliation, missing
      caller-controlled destination idempotency, disabled sink, and approved
      pseudonymous capability.
- [ ] Implement `assessSink` so pseudonymous approval requires the strict AND
      of `callerControlledIdempotency`, `deterministicReconciliation`, and
      `deleteActor`, plus reviewed processor fields, HTTPS policy approval, and
      a pinned payload schema. No capability substitutes for another.
- [ ] Add an explicit OpenPanel fixture with
      `callerControlledIdempotency=false` and `deleteActor=false`; assert it
      remains ineligible for pseudonymous production even if reconciliation is
      otherwise available.
- [ ] Write sink-lifecycle tests for admin create, verification failure,
      verification success, failed rotation, atomic verified rotation, disable,
      and read/list responses that never contain endpoint/secret/ciphertext.
- [ ] Implement `createSinkVersion`, `verifySinkVersion`,
      `rotateSinkVersion`, and `disableSinkVersion`; decrypt only inside the
      verifier/transport, soft-disable predecessors, and never log or return
      secret material.
- [ ] Run
      `bun test tests/db/migrations/074_analytics_delivery.test.ts tests/db/migration-registration.test.ts tests/analytics/delivery-store.test.ts tests/analytics/sink-gate.test.ts tests/analytics/sink-lifecycle.test.ts`.
- [ ] Run `bun run typecheck`, `bun run lint`, and `bun security`.
- [ ] Commit with
      `git add src/db/analytics-delivery-schema.ts src/db/migrations/074_analytics_delivery.ts src/db/schema.ts src/db/index.ts src/analytics/delivery/sink.ts src/analytics/delivery/sink-service.ts src/analytics/delivery/store.ts src/analytics/governance/grant-store.ts tests/db/migrations/074_analytics_delivery.test.ts tests/db/migration-registration.test.ts tests/analytics/delivery-store.test.ts tests/analytics/sink-gate.test.ts tests/analytics/sink-lifecycle.test.ts && git commit -m "feat(analytics): add independent delivery ledger"`.

## Task 10: Promote deterministic intent and add transient rephrase detection

**Files:**

- Create: `src/analytics/intent/taxonomy.ts`
- Create: `src/analytics/intent/classifier.ts`
- Create: `src/analytics/intent/rephrase.ts`
- Create: `src/analytics/rephrase/handoff.ts`
- Create: `src/analytics/jobs/intent.ts`
- Modify: `src/analytics/subscriber.ts`
- Modify: `src/analytics/turn-context.ts`
- Modify: `src/bot.ts`
- Modify: `src/runtime/production-deps.ts`
- Modify: `tests/bot.test.ts`
- Modify: `tests/runtime/production-deps-analytics.test.ts`
- Modify: `tests/analytics/subscriber.test.ts`
- Create: `tests/analytics/intent-classifier.test.ts`
- Create: `tests/analytics/intent-derivation.test.ts`
- Create: `tests/analytics/rephrase.test.ts`
- Create: `tests/analytics/rephrase-handoff.test.ts`
- Create: `tests/analytics/intent-persistence-audit.test.ts`
- Reference unchanged:
  `docs/research/analytics-metrics/poc/intent/taxonomy.ts`
- Reference unchanged:
  `docs/research/analytics-metrics/poc/intent/classifiers.ts`
- Reference unchanged:
  `docs/research/analytics-metrics/poc/intent/evaluation-results.json`
- Reference unchanged:
  `docs/research/analytics-metrics/poc/intent/small-model-status.json`

- [ ] Copy the frozen 23-label `intent.v1` taxonomy semantics into a runtime
      module while preserving label strings and sort order exactly.
- [ ] Write a parity test comparing runtime taxonomy keys to the frozen PoC
      taxonomy; run it red before adding the export.
- [ ] Promote `classifyToolTrace`, `classifyMetadata`, and `classifyHybrid` as
      pure A+B classifiers over controlled tool traces, feature signals, and
      command family.
- [ ] Run the frozen 3,000-row corpus against the runtime classifier and assert
      the recorded hybrid qualification values: accuracy `0.991667`, macro F1
      `0.995641`, coverage `0.991667`, and unknown precision `0.909091`.
- [ ] Add conflict/abstention tests for unmapped goal tools, more than three
      goals, no evidence, meta-tool-only traces, `no_action`, and `unknown`.
- [ ] Add a derivation fixture with eligible terminal turns missing and already
      containing `(turn_key,taxonomy_version)` outputs; run
      `bun test tests/analytics/intent-derivation.test.ts` and expect the
      missing output to remain absent.
- [ ] Implement a bounded idempotent scan over eligible terminal
      `turn_completed` rows missing `(turn_key,intent.v1)`; derive
      `HMAC(intent-output:v1,turn_key,taxonomy_version)` as source reference and
      insert exactly one `intent_classified`, including abstention. Read the
      source event's operational `analytics_event_collection_refs` association
      and pass that exact `CollectionEligibilityRef` to the only fenced
      canonical insertion API; never mint a fresh ref from the actor key.
- [ ] Add the intent derivation race where the scan observes an eligible source
      event, then deny commits before `intent_classified` insert. The insert
      transaction must recheck the inherited ref generation and create no
      derived event, association, or disposition. The writer-before-deny case is
      found through the inherited association and removed before withdrawal
      acknowledgement.
- [ ] Add a lossy-inline-hint fixture: drop the hint, run the scheduled scan
      twice, and assert the first run fills one output and the second changes
      zero rows. Inline hints may reduce latency but never define coverage.
- [ ] Assert aggregate-local mode never runs or stores intent and guest turns
      never enter the classifier.
- [ ] Do not import or invoke the SMALL_MODEL runner. Add a test asserting the
      runtime module graph contains no dependency on
      `small-model-runner.ts` while its status remains
      `NOT_EXECUTED`/`NOT_QUALIFIED`.
- [ ] Write rephrase fixtures for an unresolved prior turn at 119 seconds,
      120 seconds, 599 seconds, 600 seconds, and just beyond 600 seconds.
- [ ] Add a post-auth handoff test that supplies a unique raw text canary,
      requires immediate lexical feature construction, and proves the handoff
      returns without retaining the raw string.
- [ ] Freeze and implement this lifecycle seam exactly:

      ```ts
                          interface RephraseHandoff {
                            captureText(input: {
                              actorKey: Pseudonym
                              conversationKey: Pseudonym
                              turnKey: Pseudonym
                              capturedAtMs: number
                              text: string
                            }): void
                            completeTurn(input: {
                              turnKey: Pseudonym
                              completedAtMs: number
                              outcome: 'clarification' | 'failure' | 'no_action' | 'success' | 'discard'
                            }): void
                            withdraw(input: { actorKey: Pseudonym }): void
                          }
                          ```

- [ ] Inject `RephraseHandoff` explicitly through `ProductionState`/`BotDeps`
      and call it only after authorization/eligibility for normal analysis
      messages; command-only activity emits bounded command facts but sends no
      raw command text to rephrase. Keep the handoff separate from
      `AnalyticsSourceFact` and normalized queues.
- [ ] Wire `captureText` from the post-auth subscriber/message boundary and
      discard raw text before it returns. Wire `completeTurn` from the
      authorized turn-context terminal coordinator exactly once after
      controlled terminal evidence: structured clarification → `clarification`; unrecovered
      terminal failure → `failure`; deterministic classified `no_action` →
      `no_action`; semantic success → `success`; cancellation, ineligibility,
      configuration-only, or unknown → `discard`. Wire authenticated
      preference withdrawal to `withdraw`.
- [ ] Implement an in-process LRU keyed by eligible
      `(actor_key,conversation_key)`, retaining at most three process-keyed
      lexical feature sets until resolution, withdrawal, or 30-minute expiry.
- [ ] Compare only the newest unresolved prior feature set within 10 minutes;
      store at most one process-local `matchedPriorTurnKey` on the later set,
      and persist only the controlled `detector`, `similarity`,
      `prior_outcome`, and `gap` buckets.
      `prior_outcome` is copied exactly from the matched prior terminal and is
      restricted to `clarification|failure|no_action`; it is never inferred
      from the later turn or widened to `unknown`.
      Clarification/failure/no-action retain the current set as unresolved.
      Success removes current plus only its matched prior, if any; unrelated
      unresolved sets survive. Discard removes current only, and withdrawal
      removes all pending/unresolved state for the actor.
- [ ] Serialize capture/complete per actor/conversation. Preserve a bounded
      terminal marker when completion precedes capture; when a prior terminal
      arrives after a later capture, attach it atomically only to the newest
      qualifying later set without a match. Assert one idempotent pair emission
      in both orders and never resolve an unrelated abandoned goal.
- [ ] Add withdrawal, matched-success, unmatched-success, unrelated-unresolved
      survival, discard, fourth-entry eviction, exact 30-minute expiry,
      terminal-before-capture, capture-before-terminal, and
      one-actor/two-Discord-conversation isolation fixtures. Cover each exact
      `prior_outcome` value and assert the persisted value belongs to the
      matched prior.
- [ ] Add restart/eviction tests and increment a coverage-loss counter instead
      of persisting recovery material.
- [ ] Inject unique message/shingle/hash/vector canaries, run detection, then
      expire/withdraw the entry and scan SQLite, captured logs, normalized
      queues/JSON, and memory state; assert zero matches.
- [ ] Add a latency test proving immediate feature extraction is bounded and
      does not wait on SQLite/network; scheduled intent derivation is outside
      the reply path.
- [ ] Run
      `bun test tests/analytics/intent-classifier.test.ts tests/analytics/intent-derivation.test.ts tests/analytics/rephrase.test.ts tests/analytics/rephrase-handoff.test.ts tests/analytics/intent-persistence-audit.test.ts`.
- [ ] Run `bun run typecheck`, `bun run lint`, and `bun security`.
- [ ] Commit with
      `git add src/analytics/intent/taxonomy.ts src/analytics/intent/classifier.ts src/analytics/intent/rephrase.ts src/analytics/rephrase/handoff.ts src/analytics/jobs/intent.ts src/analytics/subscriber.ts src/analytics/turn-context.ts src/bot.ts src/runtime/production-deps.ts tests/bot.test.ts tests/runtime/production-deps-analytics.test.ts tests/analytics/subscriber.test.ts tests/analytics/intent-classifier.test.ts tests/analytics/intent-derivation.test.ts tests/analytics/rephrase.test.ts tests/analytics/rephrase-handoff.test.ts tests/analytics/intent-persistence-audit.test.ts && git commit -m "feat(analytics): add governed deterministic intent"`.

## Task 11: Materialize sessions, outcomes, feature exposure, and friction

**Files:**

- Create: `src/db/migrations/075_analytics_materializations.ts`
- Modify: `src/db/analytics-schema.ts`
- Modify: `src/db/index.ts`
- Create: `src/analytics/derive/sessionizer.ts`
- Create: `src/analytics/derive/outcomes.ts`
- Create: `src/analytics/derive/features.ts`
- Create: `src/analytics/derive/friction.ts`
- Create: `src/analytics/jobs/derive.ts`
- Create: `tests/db/migrations/075_analytics_materializations.test.ts`
- Modify: `tests/db/migration-registration.test.ts`
- Create: `tests/analytics/sessionizer.test.ts`
- Create: `tests/analytics/outcomes.test.ts`
- Create: `tests/analytics/feature-materialization.test.ts`
- Create: `tests/analytics/friction.test.ts`

Version every row with `sessionization_version=1`, `outcome_version=1`, or
`friction_version=1`. Derived tables reference pseudonymous event IDs/keys only
and cascade on actor-event deletion.

- [ ] Write migration assertions for session, session-event, goal-attempt,
      feature-opportunity/use, friction, and censor-interval tables; run red.
- [ ] Implement migration 075 with unique source/version keys and indexes by
      actor/time, conversation/time, maturity time, and definition version.
- [ ] Register migration 075 after 074 and update the registration test.
- [ ] Write session fixtures for gaps `29:59`, `30:00`, and `30:00.001`; run
      `bun test tests/analytics/sessionizer.test.ts` red.
- [ ] Implement `conversation_key = thread_key ?? context_key`, partition by
      `(actor_key,conversation_key)`, order by `(occurred_at_ms,event_id)`, and
      open a session only when the gap is strictly greater than `1_800_000`;
      derive `session_key` from actor, conversation, start time, and first event.
- [ ] Add fixtures for out-of-order events, midnight UTC, two actors in one
      thread, sibling threads, commands, proactive events, bot-only replies, and
      a zero-duration single-event session.
- [ ] Add one Discord actor across two distinct DMs/groups; assert both events
      retain `thread_key=null`, receive different `conversation_key` values, and
      never share a session.
- [ ] Make accepted activity and permission decisions extend sessions; child
      LLM/tool/reply/status facts inherit a turn session and do not extend it.
- [ ] Write outcome fixtures for immediate success, failure then same-turn
      recovery, next-turn recovery within 30 minutes, unresolved engaged within
      24 hours, each abandonment reason, and censoring.
- [ ] Implement goal attempts from up to three component goals and assign
      exactly one terminal category after the observation window.
- [ ] Assert a structured tool failure is not success, reply-only is not
      success, and permission denial is not an executed tool failure.
- [ ] Add maturity tests proving an attempt younger than 24 hours is censored,
      not abandoned, and withdrawal/deletion right-censors rather than counts as
      churn.
- [ ] Materialize one deterministic `clarification_abandoned` canonical event
      only after a structured clarification reaches 24 hours with no eligible
      same-goal follow-up; keep immature and withdrawn observations censored.
      Inherit the source clarification event's exact
      `analytics_event_collection_refs` association and insert through the
      fenced canonical API. Add deny-after-scan/before-insert and
      writer-before-deny races: the former creates no event/association/
      disposition, while the latter is removed through the inherited ref before
      withdrawal acknowledgement.
- [ ] Write feature materialization fixtures for one opportunity per
      actor/feature/day, changed capability next day, use without opportunity,
      blocked use, and successful adoption.
- [ ] Join use only to same-day `available=true` opportunity and expose
      eligible actor-day denominators; never use all MAU as the denominator.
- [ ] Write seven friction-component fixtures (`R,C,P,S,L,D,F`) and assert
      count `0..7` plus exact `round(100 * count / 7)` display score.
- [ ] Add the two-consecutive-failure-chain fixture with no intervening
      success and a recovery fixture that clears the chain.
- [ ] Implement the derive job as deterministic upsert from a half-open UTC
      window plus a two-minute live watermark; rerunning the same window must not
      duplicate rows.
- [ ] Add deletion/rebuild tests proving affected sessions, outcomes,
      opportunities, and friction rows are removed/recomputed after source-event
      deletion.
- [ ] Run
      `bun test tests/db/migrations/075_analytics_materializations.test.ts tests/db/migration-registration.test.ts tests/analytics/sessionizer.test.ts tests/analytics/outcomes.test.ts tests/analytics/feature-materialization.test.ts tests/analytics/friction.test.ts`.
- [ ] Run `bun run typecheck` and `bun run lint`.
- [ ] Commit with
      `git add src/db/migrations/075_analytics_materializations.ts src/db/analytics-schema.ts src/db/index.ts src/analytics/derive/sessionizer.ts src/analytics/derive/outcomes.ts src/analytics/derive/features.ts src/analytics/derive/friction.ts src/analytics/jobs/derive.ts tests/db/migrations/075_analytics_materializations.test.ts tests/db/migration-registration.test.ts tests/analytics/sessionizer.test.ts tests/analytics/outcomes.test.ts tests/analytics/feature-materialization.test.ts tests/analytics/friction.test.ts && git commit -m "feat(analytics): materialize sessions outcomes and friction"`.

## Task 12: Backfill operational usage with provenance and exact reconciliation

**Files:**

- Create: `src/analytics/jobs/backfill.ts`
- Create: `src/analytics/jobs/reconcile.ts`
- Modify: `src/analytics/storage/epoch-store.ts`
- Create: `scripts/analytics-backfill.ts`
- Create: `tests/analytics/backfill.test.ts`
- Create: `tests/analytics/reconciliation.test.ts`
- Read only: `src/db/llm-usage-events-schema.ts`
- Read only: `src/db/tool-call-events-schema.ts`
- Read only: `src/usage/recorder.ts`
- Read only: `src/usage/tool-call-recorder.ts`
- Read only: `src/embeddings.ts`
- Read only: `src/web/distill.ts`

Backfill/incremental normalization makes exactly one controlled decision per
durable usage row. Current usage schemas lack platform, platform instance,
actor role, invocation mode, and occurrence-time task/provider binding, so they
cannot form a strict pseudonymous envelope. They produce aggregate-only facts
or bounded rejections; a future row may take the canonical branch only when
every required occurrence-time fact is independently present.

```ts
type BackfillDecision =
  | {
      kind: 'canonical'
      event: AnalyticsEventV1
      collectionRef: CollectionEligibilityRef
    }
  | { kind: 'aggregate_only'; increments: readonly AggregateIncrement[] }
  | { kind: 'ineligible'; reason: EligibilityDenialReason }
  | { kind: 'rejected'; reason: NormalizationRejectionReason }
```

| Required envelope fact        | Current persisted evidence          | Required v1 decision                                                     |
| ----------------------------- | ----------------------------------- | ------------------------------------------------------------------------ |
| occurrence/source ID          | present                             | validate; derive HMAC source reference                                   |
| platform                      | absent                              | aggregate-only or `missing_platform`                                     |
| platform instance             | absent                              | aggregate-only or `missing_platform_instance`; never read current config |
| storage context/type          | present                             | validate for aggregate coverage; insufficient for identity               |
| native actor                  | present                             | never hash without authoritative instance                                |
| actor role                    | absent                              | `missing_actor_role`; never read current membership                      |
| task provider/instance        | absent                              | dimension `all` plus coverage/reject; never read current assignment      |
| invocation mode               | absent                              | `missing_invocation_mode`; never guess `normal`                          |
| model/provider                | model/role present; provider absent | controlled role aggregate; no `model_key`                                |
| tool/outcome/timing           | tool row present                    | controlled known-tool/domain/outcome aggregate                           |
| direct embedding/distillation | controlled role present             | aggregate-only unless a future safe request context exists               |

- [ ] Create deterministic fixture rows for main/small/embedding LLM success
      and failure plus tool success, structured failure, thrown failure, retry,
      and recovery classification.
- [ ] Write a dry-run test asserting source counts and decisions without any
      canonical/aggregate writes; run red.
- [ ] Implement ordered, keyset-paginated readers for `llm_usage_events` and
      `tool_call_events`; do not use offset pagination.
- [ ] Add one fixture per matrix row and assert current LLM/tool rows create no
      `AnalyticsEventV1`, actor/context/model/turn pseudonym, or invented
      `unknown` closed-enum field.
- [ ] Implement field-by-field decisions: validated terminal/token/timing and
      known tool outcome facts may increment closed aggregates; missing or
      invalid required facts use the exact controlled coverage/rejection reason.
- [ ] Assert direct embedding and web-distillation `recordUsage` rows are
      observed through persisted `embedding`/`small` roles but remain
      aggregate-only under the current schema.
- [ ] For a future fully-attributed canonical branch only, apply
      `max(preference.effective_at, policy.effective_at)` as the earliest
      consent-mode eligible timestamp; never reconstruct pre-eligibility
      activation steps. Require an exact occurrence-time
      `CollectionEligibilityRef`; if it cannot be recovered independently, the
      decision cannot be canonical.
- [ ] Route every future canonical backfill decision through the same per-ref
      fence and `insertEligibleCanonicalEvent` transaction as live collection.
      Recheck the exact ref generation, insert the event-ref association, and
      record one logical disposition atomically. Add a deny-after-read/
      before-insert race that creates no canonical event or run map.
- [ ] In documented non-consent local mode, require the operator's explicit
      backfill approval time and never include older rows.
- [ ] Add a duplicate/restart test: interrupt after a committed batch, resume
      from `analytics_backfill_runs`, and assert identical decisions and no extra
      rows/contributions.
- [ ] Derive source reference from
      `source_table + source_row.event_id + decision_name`, then HMAC it for
      future canonical IDs or aggregate contribution uniqueness; never persist
      the table row ID raw.
- [ ] Add a concurrent-live-write fixture and prove the backfill high-water
      bound keeps the run finite while the next run observes later rows.
- [ ] Add overlapping-run and live-race fixtures; assert a run→event map is
      inserted only by the transaction that first creates a future-safe
      canonical event, and an aggregate contribution map only by the transaction
      that first applies that run's source delta.
- [ ] Interrupt before/after each batch/map commit, resume, then roll back one
      run; assert exact mapped event IDs and aggregate deltas are removed while
      pre-existing, overlapping-run, and live rows remain.
- [ ] Insert a new direct embedding/distillation usage row after the initial
      high-water; run incremental normalization and assert one aggregate-only
      decision, then rerun with zero changes.
- [ ] Write durable-usage reconciliation fixtures for canonical,
      rejected, ineligible, and aggregate-only decisions; run red.
- [ ] Implement the exact durable-source equation:
      `usage_rows = active_generation_canonical_dispositions + rejected + ineligible + aggregate_only`.
- [ ] Add live observer reconciliation fixtures for a clean process epoch and
      an unclean restart. Compute opportunity and terminal dispositions only
      from `analytics_epoch_source_counters`; count canonical terms through
      canonical source opportunities whose physical parent matches the
      singleton active generation and whose event carries `process_epoch_id`;
      reconcile aggregate terms through exact
      `analytics_aggregate_epoch_contributions` deltas. Target-shadow and
      retired parents never enter ordinary source reconciliation.
- [ ] Require a zero unexplained delta only when the durable epoch is `closed`,
      every source-family/day opportunity has exactly one disposition, and
      event/aggregate associations conserve. An `open` or `stale_open` epoch
      and every intersecting bucket are `unreconciled_restart_gap` with no
      numeric `known_loss` plug.
- [ ] Add clean-restart, crash-after-finalized-bucket, and
      crash-across-UTC-boundary fixtures. The clean prior epoch remains
      publishable; the crash overturns finalized status where necessary; the
      midnight crash suppresses both UTC days.
- [ ] Add per-source, event-name, UTC-day, model-role, tool-domain, and
      attribution-quality breakdowns; assert unexplained delta is exactly zero
      for durable usage and complete live epochs, while gap windows have no
      publishable total.
- [ ] Add delivery reconciliation for unique
      `(event_id,sink_version_id)` rows, including `sending` and `ambiguous`,
      and state conservation without consulting legacy forwarding columns.
      Resolve the active-generation pointer and exclude shadow/retired events
      from ordinary delivery eligibility and totals.
- [ ] Make the CLI support exactly `--dry-run`, `--batch-size`, `--resume`,
      `--source llm|tool|all`, and `--reconcile`; reject unknown flags.
- [ ] Print only bounded counts, run ID, high-water key hash, and status; never
      print source rows, actor keys, content, or raw errors.
- [ ] Run
      `bun test tests/analytics/backfill.test.ts tests/analytics/reconciliation.test.ts`.
- [ ] Run a fixture dry-run and apply:
      `bun run scripts/analytics-backfill.ts --dry-run --source all --batch-size 100`
      followed by
      `bun run scripts/analytics-backfill.ts --source all --batch-size 100 --reconcile`;
      expect zero unexplained delta.
- [ ] Run `bun run typecheck`, `bun run lint`, and `bun security`.
- [ ] Commit with
      `git add src/analytics/jobs/backfill.ts src/analytics/jobs/reconcile.ts src/analytics/storage/epoch-store.ts scripts/analytics-backfill.ts tests/analytics/backfill.test.ts tests/analytics/reconciliation.test.ts && git commit -m "feat(analytics): add governed usage backfill"`.

## Task 13: Implement retention, withdrawal, export, deletion, and planned rekey

**Files:**

- Create: `src/analytics/governance/subject-service.ts`
- Create: `src/analytics/governance/deletion-target-store.ts`
- Create: `src/analytics/governance/grant-serialization.ts`
- Create: `src/analytics/governance/snapshot-invalidator.ts`
- Create: `src/analytics/jobs/retention.ts`
- Create: `src/analytics/jobs/rekey.ts`
- Create: `src/analytics/rekey/cutover-fence.ts`
- Create: `src/analytics/retention/expiry-guard.ts`
- Modify: `src/analytics/normalizer.ts`
- Modify: `src/analytics/runtime.ts`
- Modify: `src/analytics/identity/pseudonym.ts`
- Modify: `src/analytics/governance/preference-store.ts`
- Modify: `src/analytics/governance/collection-store.ts`
- Modify: `src/analytics/governance/collection-serialization.ts`
- Modify: `src/analytics/governance/grant-store.ts`
- Modify: `src/analytics/governance/generation-store.ts`
- Modify: `src/analytics/storage/event-store.ts`
- Modify: `src/analytics/storage/aggregate-store.ts`
- Modify: `src/analytics/storage/backfill-provenance-store.ts`
- Modify: `src/analytics/delivery/store.ts`
- Modify: `src/analytics/jobs/backfill.ts`
- Modify: `src/analytics/jobs/derive.ts`
- Modify: `src/analytics/jobs/intent.ts`
- Modify: `src/analytics/jobs/reconcile.ts`
- Create: `scripts/analytics-rekey.ts`
- Create: `tests/analytics/retention.test.ts`
- Create: `tests/analytics/withdrawal-race.test.ts`
- Create: `tests/analytics/subject-export.test.ts`
- Create: `tests/analytics/deletion.test.ts`
- Create: `tests/analytics/rekey.test.ts`
- Create: `tests/analytics/rekey-cutover.test.ts`

The retention maxima are fixed defaults, configurable only downward:

| Data                         |                                             Maximum |
| ---------------------------- | --------------------------------------------------: |
| Rephrase raw text            |                               discarded immediately |
| Rephrase feature sets        | max three until resolution/withdrawal or 30 minutes |
| Canonical events/sessions    |                                             90 days |
| Pending delivery             |                  earlier of event expiry or 14 days |
| Delivery receipts/errors     |                                             30 days |
| External pseudonymous sink   |                                             90 days |
| Assessed thresholded rollups |                                            400 days |
| Superseded governance audit  |                                            400 days |

- [ ] Write retention boundary fixtures at maximum minus one millisecond,
      maximum, and maximum plus one millisecond for every row class.
- [ ] Run `bun test tests/analytics/retention.test.ts`; expect an import
      failure.
- [ ] Add read-boundary tests for canonical queries, derivation, export,
      snapshot source, lease, and send at `expires_at-1`, `expires_at`, and
      `expires_at+1`; every path must hide the row at the exact deadline even
      before physical deletion.
- [ ] Implement one `isUnexpired(now)` guard used by every read/lease/send
      adapter. Physical expiry first settles/cancels delivery, then removes its
      rows, then deletes derived/canonical rows; `ON DELETE RESTRICT` must catch
      a reversed order. Expire local aggregates at 90 days and retain only
      explicitly assessed rollups up to 400 days.
- [ ] Add downtime/startup tests with overdue rows; require
      `purgeExpiredBeforeStart` to finish before analytics readers, snapshot,
      or delivery workers become available.
- [ ] Add fake-clock tests proving `nextExpiryDeadline` wakes at the earliest
      row deadline and at least once per minute; daily censor materialization
      cannot be the storage-enforcement clock.
- [ ] Add a policy test rejecting retention settings above the maxima and
      accepting lower values.
- [ ] Write grant-generation races at enqueue, lease, durable send-start, and
      while a send holds the per-grant mutex, covering current and retained old
      key versions.
- [ ] Write collection-generation races under the per-ref fence for every
      retained version. Deny-before-writer inserts nothing.
      Writer-before-deny advances the collection generation and deletes the
      newly associated canonical event, materializations, and delivery rows
      before withdrawal acknowledgement.
- [ ] Implement withdrawal while holding the collection-ref and delivery-grant
      serialization domains in deterministic order. One transaction UPSERTs
      preference deny, advances/revokes every retained collection and delivery
      generation, cancels never-started pending/leased delivery, creates a
      durable deletion request/target bundle, and audits. Do not acknowledge
      until the workflow settles every delivery and removes the associated
      local event graph.
- [ ] Recheck the delivery row's exact grant key/version/generation at enqueue,
      lease, and in the same transaction as `leased → sending`; hold the same
      keyed mutex from that final check through acknowledgement classification.
      Assert no send begins or completes after deny commits/acknowledges.
- [ ] Make delivery settlement ordering explicit for withdrawal, expiry, and
      deletion: cancel pending/never-started leased rows; never silently delete
      `sending`; classify or mark it ambiguous, then reconcile/delete it;
      request and confirm remote deletion for delivered/ambiguous targets;
      write the minimal independent deletion receipt; remove delivery rows; and
      only then remove canonical events. The independent receipt contains no
      event/actor/target key.
- [ ] Write authenticated export fixtures with two actors in one group and
      three retained analytics key versions spread across active,
      target-shadow, and retired storage generations, including matching event
      collection refs. Assert every physical generation is searched, one
      source opportunity is exported once after transient normalization through
      the encrypted run mapping, and only the requesting actor's canonical
      metadata, sessions, receipts, current preference, and audit rows are
      returned.
- [ ] Implement all-retained-key lookup from the authenticated
      `(platform_instance_id,platform_user_id)` using analytics and governance
      keyrings independently. Subject denial, export, and deletion must search
      active, target-shadow, and retired generations, retained encrypted
      mappings, and `analytics_event_collection_refs`; they never use the
      active-only ordinary reader.
- [ ] While authenticated identity is still in scope, derive every retained
      analytics actor, governance actor, collection-ref, and delivery-grant key
      version across every retained generation, plus matching event collection
      refs, and seal only that set into an access-restricted encrypted deletion
      target bundle. Never retain native identity merely to resume deletion;
      exclude the ciphertext and its plaintext targets from canonical data, BI,
      logs, snapshots, and egress.
- [ ] Add deletion-target fixtures for restart/resume, three retained key
      versions, and overlap with an active rekey. Resolve both old and new
      targets before work starts, update status transactionally, and destroy
      the ciphertext after local/snapshot/remote completion while retaining
      only the minimal non-identifying audit result.
- [ ] Keep governance and product-analytics results in separate top-level JSON
      objects and state that chat history, memory, and other operational stores are
      outside this analytics-only export.
- [ ] Add export tests proving no other member, secret key, native ID, raw
      error, endpoint, or request/response body appears.
- [ ] Write deletion tests covering every actor key version, source events,
      sessions, outcomes, opportunities, friction rows, pending/delivered sink
      rows, `sending`/ambiguous recovery, restricted event FKs, independent
      minimal receipts, aggregate small-cell recomputation, right-censor
      intervals, event collection refs, every retained storage generation, and
      a currently published snapshot containing the subject's contribution.
- [ ] Implement local deletion plus affected-window rebuild in one durable
      workflow; call the `SnapshotInvalidator` to unpublish/rebuild/switch and do
      not claim completion until no published snapshot contains the
      contribution and every approved sink deletion receipt reconciles.
- [ ] Retain only the operator-policy minimal deletion audit/deny marker and
      describe it explicitly in export results.
- [ ] Write rekey fixtures covering active, target-shadow, and retired
      generations; old/current analytics and governance keys; event/source refs;
      `conversation:v1`, `thread:v1`, turn/attempt/model/tool/coding keys;
      sessions/materializations; intent/abandonment; backfill maps; preferences;
      collection refs/event associations; delivery grants/rows/receipts;
      encrypted deletion targets; deletion/retention state; and generation-
      scoped event/source uniqueness.
- [ ] Implement CLI phases `plan`, `apply`, and `verify`; `apply` must require
      the plan artifact hash produced in the same database state. A separate
      `abort` action is legal only while still in `plan` and only after one
      transaction proves there is no mapping, target row, or installed
      dual-write state; otherwise reject it and keep the run resumable. Start
      or resume the run in the same transaction that acquires the
      database-backed one-nonterminal-run invariant; never use an in-memory
      “current run” lock.
- [ ] Persist this phase order in `analytics_rekey_runs`: `plan`, `dual_write`,
      `copy_parents`, `copy_children`, `verify`, `cutover_fence`, `swap`,
      `snapshot_republish`, `remote_delete`, `remote_resend`, and `retire`.
      Store phase/subphase state, source/target generation, frozen high-water
      marks, counts, verification hashes, `swap_completed_at_ms`, and
      `retire_not_before_ms`.
- [ ] Make the fenced canonical writer the only dual-write parent seam.
      Identity/pseudonym builders produce active and target key versions, but
      the single ref-fenced SQLite transaction creates exactly one active and
      one target-shadow physical event/source parent for one source opportunity
      and increments one opportunity/canonical disposition. Persist only their
      distinct physical IDs in the encrypted rekey mapping. Associate both
      physical parents with the inherited exact collection ref. No caller can
      supply storage generation or invoke a one-sided physical insert.
- [ ] Keep the singleton `GenerationStore` pointer authoritative. Ordinary
      canonical reads, scheduled intent/abandonment, derivation/
      materialization, backfill/reconciliation, delivery eligibility,
      retention reads, and Task 14 snapshot sources resolve and select only the
      active generation. Target-shadow and retired rows are available only to
      rekey verification and the explicit all-generation subject-rights
      lookup. A target-shadow row can never enqueue or send delivery.
- [ ] Dual-write preference, collection-eligibility, and delivery-grant
      mutations atomically across source/target key versions. Keep every
      retained-generation deny binding and make denial, authenticated export,
      and deletion search active, target-shadow, retired, retained mappings,
      and event collection refs.
- [ ] Persist a checkpoint in the same transaction as each bounded subphase:
      `dual_write.identity`, `dual_write.governance`,
      `copy_parents.events_sources`, `copy_children.materializations_backfill`,
      `copy_children.preferences_collection_grants`,
      `copy_children.delivery_deletion`, `verify.local_graph`,
      `cutover.fence_drain_delta`, `cutover.snapshot_quiesced`,
      `swap.active_generation`,
      `snapshot_republish.quiesce_build_switch`, `remote_delete`,
      `remote_resend`, and `retire.waiting_horizon`.
- [ ] Build encrypted domain-complete old→new mappings and reject any
      collision, including the explicit `thread:v1` domain. All retained old-
      version deny/grant rows remain binding during dual-write and verification.
- [ ] Copy in FK order rather than updating in place: events and source refs
      first; then intent/abandonment, sessions/materializations, and backfill
      maps; then deliveries/receipts and deletion/retention state. Verify
      generation-scoped event/source uniqueness before each child points at the
      target-shadow parent.
- [ ] Implement `RekeyCutoverFence` as a global admission/drain boundary.
      Acquiring it durably stops new mutable work and waits for every admitted
      post-high-water writer/job to finish: intent/abandonment, derive/
      materializations, backfill, retention/deletion, and delivery/receipt
      mutation, plus snapshot stage/publish/consumer transitions. While held,
      copy every delta since the last checkpoint to the target and rerun
      parent/child verification. A restart resumes from the persisted
      fence/subphase and cannot skip an admitted writer.
- [ ] Add cutover race fixtures that pause one writer in each mutable class
      after admission. Assert pointer swap remains impossible until all classes
      drain, delta catch-up reaches the target, and a late admission is rejected
      or waits for the committed pointer.
- [ ] Verify the separate, non-balanceable shadow equation:
      active parent count equals target-shadow parent count equals the count of
      encrypted run mappings having exactly one existing parent in each
      generation. Decrypt mappings only inside the verifier, normalize each
      target ID back to its paired active ID in memory, and require SHA-256 of
      the ordered active-ID sequence to equal SHA-256 of that normalized target
      sequence. Persist no normalized or stable cross-generation ID. Separately
      compare mapping-normalized parent/child hashes. No reject, overflow, or
      loss counter may close this equation.
- [ ] In the same transaction that passes the final fenced verification,
      atomically update the one `analytics_active_generation` row and persist
      `swap_completed_at_ms`; invalidate every published snapshot whose
      `storage_generation` is the source generation in that transaction. Set
      `retire_not_before_ms` to the swap instant plus the greater of the
      configured retained-event horizon and the exact v1
      `subject_rights_lookup_horizon_days=90`. Do not derive either time from
      plan start or source high-water.
- [ ] Define this sequence as an injected generation-transition port in
      `snapshot-invalidator.ts` and exercise it with a strict fake in this task;
      Task 14 supplies the production coordinator. Before pointer swap, the
      port quiesces Metabase, closes every old snapshot connection, and
      checkpoints `cutover.snapshot_quiesced`. A restart in that subphase keeps
      BI fail-closed even though source generation/publication still match,
      re-acquires the fence, re-drains/re-verifies, and idempotently closes
      again before swap. Only the swap transaction invalidates the source
      publication and advances to `snapshot_republish`. After swap, keep BI
      unavailable and use only the persisted rekey owner's
      cutover token to build a fresh target-generation snapshot and insert
      exactly one `staged` publication owned by `transition_run_id`.
      Remount/reopen it while queries remain quiesced and verify its
      `snapshot_id` and `storage_generation` against that staged row and the
      active pointer. Atomically transition staged→published, then resume
      queries and unlink the old file. If any step fails or the process
      restarts, remain `paused` in `snapshot_republish`, keep the old
      publication invalidated and retained for recovery, and resume this same
      run—never serve or republish the source-generation file.
- [ ] Pause pseudonymous egress before cutover and keep it paused after the
      pointer swap. Delete every old remote actor version and deterministically
      reconcile those deletions while preserving old versioned delivery rows
      and independent receipts. Only then may still-eligible new-generation
      rows enqueue for resend; the target shadow is never delivered early.
- [ ] After freezing the source high-water mark, create a new actor/context
      source opportunity and mutate preference, collection eligibility, delivery
      grant, intent/abandonment, materialization, backfill, delivery/receipt,
      deletion, and retention state. Assert the one active/one-shadow parent
      and every delta survive interruption/resume, remain bound by any
      generation's deny, and do not duplicate a logical disposition.
- [ ] Add an interruption test immediately before and after each subphase
      commit; prove resume is idempotent, FKs remain valid, no source/event
      duplicates appear, active-only consumers never see a shadow, every
      generation's deny/subject target remains visible, and old-key queries
      become empty only after verified retirement.
- [ ] Attempt abort before and after every subphase boundary. Only a pristine
      plan may become terminal `aborted` and release the unique run slot; every
      later attempt is rejected, leaves one nonterminal run, and cannot admit a
      new target generation.
- [ ] Add snapshot-cutover interruption fixtures before close, after connection
      close but before swap, after pointer swap, during target build, and
      before/after remount verification. The after-close/pre-swap restart must
      retain the source pointer/publication, remain in cutover, fail closed,
      re-drain/reverify/reclose, and only then swap; it must not enter
      `snapshot_republish` early. Assert exactly one target-generation
      publication becomes active after staged promotion and normal snapshot
      scheduling cannot deadlock or bypass the rekey-owned cutover token.
- [ ] Refuse retirement at every millisecond before
      `retire_not_before_ms`, while any retained-generation deny or event
      collection ref cannot be resolved, while an export/deletion target
      depends on the mapping, while a `staged`/`published` artifact, snapshot
      file, or open consumer remains bound to the source generation, or while
      local/snapshot/remote verification is incomplete. Minimal invalidated
      publication metadata may remain as non-serving audit evidence. Destroy
      encrypted old→new mappings and retire old keys only at or after the
      boundary when all checks pass; add a restart and one fixture per missing
      condition.
- [ ] Add a compromise-mode test that activates the kill switch, stops egress,
      rotates without alias rewrite when unsafe, and records a cohort epoch break.
- [ ] Run
      `bun test tests/analytics/retention.test.ts tests/analytics/withdrawal-race.test.ts tests/analytics/subject-export.test.ts tests/analytics/deletion.test.ts tests/analytics/rekey.test.ts tests/analytics/rekey-cutover.test.ts`.
- [ ] Run `bun run typecheck`, `bun run lint`, and `bun security`.
- [ ] Commit with
      `git add src/analytics/governance/subject-service.ts src/analytics/governance/deletion-target-store.ts src/analytics/governance/grant-serialization.ts src/analytics/governance/snapshot-invalidator.ts src/analytics/governance/generation-store.ts src/analytics/jobs/retention.ts src/analytics/jobs/rekey.ts src/analytics/rekey/cutover-fence.ts src/analytics/retention/expiry-guard.ts src/analytics/normalizer.ts src/analytics/runtime.ts src/analytics/identity/pseudonym.ts src/analytics/governance/preference-store.ts src/analytics/governance/collection-store.ts src/analytics/governance/collection-serialization.ts src/analytics/governance/grant-store.ts src/analytics/storage/event-store.ts src/analytics/storage/aggregate-store.ts src/analytics/storage/backfill-provenance-store.ts src/analytics/delivery/store.ts src/analytics/jobs/backfill.ts src/analytics/jobs/derive.ts src/analytics/jobs/intent.ts src/analytics/jobs/reconcile.ts scripts/analytics-rekey.ts tests/analytics/retention.test.ts tests/analytics/withdrawal-race.test.ts tests/analytics/subject-export.test.ts tests/analytics/deletion.test.ts tests/analytics/rekey.test.ts tests/analytics/rekey-cutover.test.ts && git commit -m "feat(analytics): enforce lifecycle and subject rights"`.

## Task 14: Build curated, read-only SQLite snapshots and Metabase models

**Files:**

- Create: `src/analytics/jobs/snapshot.ts`
- Modify: `src/analytics/jobs/rekey.ts`
- Modify: `src/analytics/rekey/cutover-fence.ts`
- Modify: `src/analytics/governance/snapshot-invalidator.ts`
- Create: `src/analytics/governance/snapshot-consumer.ts`
- Create: `src/analytics/jobs/friction-sample.ts`
- Create: `scripts/analytics-snapshot.ts`
- Modify: `scripts/analytics-rekey.ts`
- Create: `scripts/analytics-friction-sample.ts`
- Create: `analytics/metabase/sql/00-data-health.sql`
- Create: `analytics/metabase/sql/01-activation.sql`
- Create: `analytics/metabase/sql/02-retention-engagement.sql`
- Create: `analytics/metabase/sql/03-intents-features.sql`
- Create: `analytics/metabase/sql/04-reliability-friction-performance.sql`
- Create: `analytics/metabase/README.md`
- Create: `tests/analytics/snapshot.test.ts`
- Create: `tests/analytics/metabase-models.test.ts`
- Create: `tests/analytics/friction-sample.test.ts`
- Modify: `tests/analytics/rekey.test.ts`
- Modify: `tests/analytics/rekey-cutover.test.ts`
- Reference unchanged: `src/analytics/governance/generation-store.ts`
- Reference unchanged:
  `docs/research/analytics-metrics/poc/metabase/sql/*.sql`

Every rate/model result must expose:

```text
metric_version, window_start_utc, window_end_utc, numerator, denominator,
unknown_count, censored_count, eligibility_coverage, wilson_low, wilson_high,
suppressed, snapshot_created_at_ms, reconciliation_status
```

No percentage is shown below denominator `30`; no externally releasable segment
is shown below `10` eligible actors. Aggregate-only snapshots label DAU,
sessions, retention, intent, cohorts, and actor adoption as unavailable rather
than approximating them.

- [ ] Write a snapshot test with a writer transaction open during source
      staging; assert curated rows are internally consistent and contain either
      the pre-commit or post-commit state, never a mix.
- [ ] Run `bun test tests/analytics/snapshot.test.ts`; expect an import failure.
- [ ] Create a fresh empty temporary publish database with only explicit
      allowlisted curated/model schemas; never copy the live DB into the
      publish file and never rely on `DROP` to scrub SQLite pages.
- [ ] Acquire a `RekeyCutoverFence` read admission before source staging,
      resolve the singleton active generation once inside that admission, and
      restrict every pseudonymous canonical/materialized input plus its
      high-water and row counts to that generation. The separate unversioned C0
      aggregate store remains eligible under its own contract, but the
      publication still records the resolved generation. Release only after
      publication verification; target-shadow and retired rows are never
      snapshot input.
      The only exception is the persisted rekey owner's post-swap publication
      token, which still resolves and proves the new singleton active
      generation and cannot stage any other generation.
- [ ] Add snapshot fixtures with conflicting active, target-shadow, and retired
      rows plus a concurrent pointer swap. Assert only the admitted active
      generation appears and cutover waits rather than producing a
      cross-generation snapshot.
- [ ] Read from one consistent transaction or a mode-`0600`,
      permission-restricted source staging copy, then `INSERT` only unexpired,
      reconciled, allowlisted curated/materialized rows into the fresh publish
      database.
- [ ] Put staging-copy close/unlink and partial-output close/unlink in `finally`
      cleanup that runs on both success and failure; tests must leave no
      permission-restricted staging file behind after any injected boundary.
- [ ] Add raw-table/page canaries to canonical props, preference/grant,
      delivery secret, usage, conversation, memory, system config, and settings
      auth rows; scan the complete output bytes/schema/freelist and expect zero
      matches.
- [ ] Add an injected failure after staging, after output schema creation, and
      during insert; assert neither staging nor partial publish file/pointer
      survives.
- [ ] Set the final snapshot file read-only and record snapshot ID, created
      time, storage generation, source high-water mark, source row count,
      curated row counts, model versions, and reconciliation result in both the
      file and a `staged` `analytics_snapshot_publications` row.
- [ ] Implement immutable version publication, but do not treat an atomic path
      or pointer switch as proof that Metabase left the old inode. For subject
      deletion, orchestrate: quiesce queries and close pooled/file-bound
      connections; configure/remount the new immutable path; reopen; query the
      new `snapshot_id` and prove the old contribution is zero; then
      acknowledge deletion and unlink the old snapshot file.
- [ ] Define a fail-closed `SnapshotConsumerCoordinator` for that
      quiesce/close/configure/reopen/verify sequence. Any failure keeps deletion
      incomplete, leaves the old file retained but unpublished for recovery,
      and never silently resumes queries against it.
- [ ] For ordinary replacement, remount/reopen the staged file while queries
      are quiesced, verify its embedded ID/generation against that row and the
      active pointer, then atomically invalidate the prior published row and
      promote staged→published before resuming. Normal startup serves only the
      one published row and rejects zero/multiple rows or any file/active
      generation mismatch. It also remains quiesced when the one nonterminal
      rekey run is in `cutover_fence|swap|snapshot_republish`, even if the
      source file and pointer still match before swap.
- [ ] Reconcile an ordinary staged row (`transition_run_id IS NULL`) before
      normal startup publication/serving. Because it was never committed as
      published, close any connection to its path, atomically mark it
      invalidated, unlink its file if present, and then remount the still-valid
      published row; never guess that an orphan was fully verified. Add crash
      fixtures after staged-row insert, before/after file finalization, during
      remount verification, and immediately after atomic promotion. Every
      pre-promotion crash frees the staged slot and preserves the old published
      row; a post-promotion crash serves only the new row.
- [ ] Implement the Task 13 `snapshot_republish` port with that coordinator.
      A rekey remount compares the file's `snapshot_id` and
      `storage_generation` with exactly one staged row owned by the current
      `transition_run_id` and the singleton active generation. Any mismatch
      keeps BI quiesced. Atomically promote that row to published, checkpoint
      success, and release the cutover token without republishing the old file.
- [ ] Add fake-consumer tests proving a pointer-only switch fails, an open old
      inode blocks acknowledgement/removal, and only a successful reopened
      `snapshot_id` plus zero-contribution query permits acknowledgement and
      old-file cleanup.
- [ ] Extend the rekey interruption suite with restart after close/before swap,
      restart after pointer swap, failed target build, open old inode,
      wrong-generation remount, successful target remount, and attempted
      concurrent ordinary publication. Require pre-swap restart to keep the
      source row published but unserved and redo drain/close; require zero
      published rows during the post-swap handoff, then exactly one published
      target-generation row after staged promotion, no served stale query, and
      no source-generation retirement until the old consumer/file is clear.
- [ ] Add a test that Metabase's database user/path cannot open the live papai
      writer file and the configured snapshot path is absolute.
- [ ] Add activation fixture assertions for first authorized DM, command-only
      `/config`, 7-day link/assignment windows, settings windows, 14-day
      mutating success, exact denominators, p50/p90, lookback, and coverage; run
      `bun test tests/analytics/metabase-models.test.ts -t activation` red.
- [ ] Implement only `01-activation.sql`; rerun the activation fixture green.
- [ ] Add engagement fixtures for UTC DAU/WAU/MAU, conversation sessions,
      exact D1/D7/D30 versus returned-by-D30, withdrawal censoring,
      new/returning/tenure-unknown, and cross-platform unavailability; run the
      named `engagement` fixture red.
- [ ] Implement only `02-retention-engagement.sql`; rerun `engagement` green.
- [ ] Add intent/feature fixtures retaining unknown/no-action/multi-goal,
      strategy/coverage, fractional goals, opportunity denominators, 100 actors
      per exposure arm, suppression, and non-causal D30 association; run the
      named `intents features` fixture red.
- [ ] Implement only `03-intents-features.sql`; rerun `intents features`
      green.
- [ ] Add reliability fixtures for semantic tool outcomes, explicit/aged-open
      LLM rates, seven friction bits, capability-aware live status,
      p50/p75/p90/p95/p99, reply-only failure, recovered-not-first-attempt,
      unsupported status, and no-token TTFT; run the named `reliability`
      fixture red.
- [ ] Implement only `04-reliability-friction-performance.sql`; rerun
      `reliability` green.
- [ ] Add a data-health fixture for freshness, rejects,
      `unreconciled_restart_gap`, eligibility/censoring, storage, query timing,
      and publication suppression; run the named `data health` fixture red.
- [ ] Implement only `00-data-health.sql`; rerun `data health` green.
- [ ] Write a friction-sampling test that partitions mature complete sessions
      by turn-count decile, platform, context type, app version, and signature
      band `0_1|2_3|4_7`, then samples a fixed number per stratum.
- [ ] Implement a short-lived sample CLI that outputs only typed timelines and
      random case tokens, writes any engineer-only token map to a
      permission-restricted temporary file, and destroys that map at meeting
      end; product/UX output contains no actor/session key.
- [ ] Scan every SQL file for raw `props_json` projection, governance-table
      names, native IDs, and unrestricted actor keys; expect zero violations.
- [ ] Make the CLI support `--output`, `--verify`, and `--replace`; reject a
      relative output path and never overwrite a previously valid snapshot until
      the fresh allowlisted output verifies.
- [ ] Run
      `bun test tests/analytics/snapshot.test.ts tests/analytics/metabase-models.test.ts tests/analytics/friction-sample.test.ts tests/analytics/rekey.test.ts tests/analytics/rekey-cutover.test.ts`.
- [ ] Run
      `bun run scripts/analytics-snapshot.ts --output /tmp/papai-analytics-snapshot.db --verify`;
      expect reconciliation status `ok` and an absolute snapshot path.
- [ ] Run `bun run typecheck`, `bun run lint`, and `bun security`.
- [ ] Commit with
      `git add src/analytics/jobs/snapshot.ts src/analytics/jobs/rekey.ts src/analytics/rekey/cutover-fence.ts src/analytics/governance/snapshot-invalidator.ts src/analytics/governance/snapshot-consumer.ts src/analytics/jobs/friction-sample.ts scripts/analytics-snapshot.ts scripts/analytics-rekey.ts scripts/analytics-friction-sample.ts analytics/metabase/sql/00-data-health.sql analytics/metabase/sql/01-activation.sql analytics/metabase/sql/02-retention-engagement.sql analytics/metabase/sql/03-intents-features.sql analytics/metabase/sql/04-reliability-friction-performance.sql analytics/metabase/README.md tests/analytics/snapshot.test.ts tests/analytics/metabase-models.test.ts tests/analytics/friction-sample.test.ts tests/analytics/rekey.test.ts tests/analytics/rekey-cutover.test.ts && git commit -m "feat(analytics): publish curated metabase snapshot"`.

## Task 15: Implement external aggregate release and the gated delivery worker

**Files:**

- Create: `src/analytics/delivery/http-policy.ts`
- Create: `src/analytics/delivery/worker.ts`
- Create: `src/analytics/delivery/aggregate-release.ts`
- Create: `src/analytics/delivery/captured-sink.testing.ts`
- Modify: `src/analytics/delivery/sink.ts`
- Modify: `src/analytics/delivery/store.ts`
- Modify: `src/analytics/governance/grant-serialization.ts`
- Modify: `src/analytics/retention/expiry-guard.ts`
- Create: `tests/analytics/http-policy.test.ts`
- Create: `tests/analytics/aggregate-release.test.ts`
- Create: `tests/analytics/delivery-worker.test.ts`
- Create: `tests/analytics/captured-egress.test.ts`
- Reference unchanged: `src/analytics/governance/generation-store.ts`
- Reference unchanged: `src/analytics/rekey/cutover-fence.ts`

This task delivers only assessed aggregate payloads in production. The worker
and capability contract support a future reviewed pseudonymous sink, but the
production pseudonymous registry remains empty because OpenPanel's
caller-controlled destination idempotency, deterministic reconciliation, and
complete per-actor deletion do not all pass.

- [ ] Write external aggregate tests for an actor-sensitive cell with 9 and 10
      eligible actors, guest cells with 9/10 turns and 9/10 contexts, unavailable
      contributor count, unassessed cells, and
      `unreconciled_restart_gap`.
- [ ] Run `bun test tests/analytics/aggregate-release.test.ts`; expect an
      import failure.
- [ ] Implement release eligibility: actor-sensitive threshold `10`; guest
      threshold `10` turns and `10` contexts; unavailable contributor count means
      suppressed; restart-gap cells are never publishable.
- [ ] Freeze release-lattice fixtures for one complete UTC day: all-dimensions
      total or exactly one of platform/context-type/actor-role/task-provider,
      with every other dimension and app version `all`; reject multi-dimension,
      custom-range, rolling-window, app-version, and drill-through requests.
- [ ] Add exhaustive primary-suppression fixtures below threshold, then
      complementary-suppression fixtures where exactly one child is primary
      suppressed; require deterministic suppression of the smallest sibling
      (catalog-order tie break) and any revealing parent total.
- [ ] Attempt recovery through every total, sibling, allowed one-way filter,
      and forbidden cross-filter; only a fully protected immutable partition
      becomes `external_eligible`.
- [ ] Serialize a strict `AnalyticsAggregateV1` release, pin schema version,
      compute deterministic release hash, and insert one aggregate-delivery row.
- [ ] Write HTTP policy tests for HTTPS, loopback, RFC1918, link-local,
      multicast, IPv6 local ranges, DNS resolving public then private, redirects,
      oversized request, timeout, and fixed endpoint mismatch.
- [ ] Implement endpoint approval from one operator-owned sink record; do not
      accept per-context or per-event URLs.
- [ ] Add a DNS-rebinding fixture whose validation answer is public and later
      resolver answer is private; require the connection to use only the
      originally validated public address while TLS SNI/certificate validation
      still uses the configured hostname.
- [ ] Implement a custom lookup/transport that rejects any hostname with a
      non-public answer and pins a selected validated public address in the
      actual connection; ordinary `fetch` re-resolution is forbidden. Refuse
      redirects, cap body size, set a timeout, and use bounded `p-limit`.
- [ ] Keep sink tokens encrypted through the repository's secret-payload
      crypto helper; pass them only to the request header builder and never log
      them.
- [ ] Write worker tests for normal acknowledgement, explicit retryable
      failure, permanent failure, timeout, ambiguous acknowledgement, lease
      expiry, crash immediately before durable send-start, crash immediately
      after send-start, process crash after remote acceptance, and bounded
      exponential backoff.
- [ ] Resolve the singleton active generation for enqueue and each lease/send
      transaction, join event delivery candidates to that generation, and
      refuse target-shadow or retired parents even when their grants remain
      otherwise eligible. Admit enqueue, lease, send-start, and receipt
      mutation through `RekeyCutoverFence`; honor its egress pause across
      cutover and the remote-delete/reconcile transition.
- [ ] Add active/target/retired delivery fixtures plus a cutover race. Prove a
      shadow is never enqueued or sent, an already queued retired parent cannot
      be leased or sent after swap, cutover drains an admitted send, and only
      still-eligible new-generation rows can enqueue after the rekey workflow
      explicitly resumes egress.
- [ ] Immediately before network I/O, atomically recheck the grant and mark the
      owned row `sending`. A never-started expired `leased` row may return to
      `pending`; an orphaned/expired `sending` row becomes non-retried
      `ambiguous`. A live owner may classify a response it actually observed.
- [ ] Implement controlled delivery results; store only state, attempts,
      controlled error class, delivery time, and a one-way remote receipt hash.
- [ ] Persist uncertain acknowledgement as distinct `ambiguous`; suppress every
      automatic lease/retry and require remote reconciliation or explicit
      operator deletion/resolution.
- [ ] Add a daily event/release cap and immediate environment kill switch;
      exhaustion leaves rows pending with a controlled next-attempt time.
- [ ] Add expired-at-lease and expired-immediately-before-send fixtures; both
      cancel without a network call even if physical purge has not run.
- [ ] Recheck the referenced operational grant generation at lease and
      in the durable `leased → sending` transaction. For a pseudonymous test
      sink, hold the per-grant mutex through acknowledgement classification;
      withdrawal after lease must cancel and no send may occur after deny
      commits.
- [ ] Create a captured synthetic sink and inject C3/raw-ID canaries across
      every source fact; assert none appears in URL, headers except the synthetic
      token fixture, body, logs, receipt, or dead-letter state.
- [ ] Add a registry test asserting no production
      `external_pseudonymous` sink is registered and the OpenPanel fixture
      remains rejected until caller-controlled destination idempotency,
      deterministic reconciliation, and complete actor deletion all pass the
      strict AND assessment.
- [ ] Run
      `bun test tests/analytics/http-policy.test.ts tests/analytics/aggregate-release.test.ts tests/analytics/delivery-worker.test.ts tests/analytics/captured-egress.test.ts`.
- [ ] Run `bun run typecheck`, `bun run lint`, `bun security`, and
      `bun security:ci`.
- [ ] Commit with
      `git add src/analytics/delivery/http-policy.ts src/analytics/delivery/worker.ts src/analytics/delivery/aggregate-release.ts src/analytics/delivery/captured-sink.testing.ts src/analytics/delivery/sink.ts src/analytics/delivery/store.ts src/analytics/governance/grant-serialization.ts src/analytics/retention/expiry-guard.ts tests/analytics/http-policy.test.ts tests/analytics/aggregate-release.test.ts tests/analytics/delivery-worker.test.ts tests/analytics/captured-egress.test.ts && git commit -m "feat(analytics): add thresholded aggregate delivery"`.

## Task 16: Add authenticated governance and analytics settings surfaces

**Files:**

- Create: `src/debug/settings/analytics-routes.ts`
- Create: `src/debug/settings/admin/analytics-routes.ts`
- Modify: `src/analytics/delivery/sink-service.ts`
- Modify: `src/debug/settings-api-router.ts`
- Create: `client/settings/fetcher-schemas-analytics.ts`
- Create: `client/settings/analytics-fetchers.ts`
- Create: `client/settings/sections/AnalyticsPreferencesSection.svelte`
- Create: `client/settings/sections/AnalyticsPreferencesSection.stories.svelte`
- Create: `client/settings/sections/admin/AdminAnalyticsSection.svelte`
- Create: `client/settings/sections/admin/AdminAnalyticsSection.stories.svelte`
- Modify: `client/settings/SettingsApp.svelte`
- Modify: `tests/client/stories/msw/settings-handlers-personal-2.test.ts`
- Modify: `tests/client/stories/msw/settings-handlers-admin-2.test.ts`
- Create: `tests/debug/settings/analytics-routes.test.ts`
- Create: `tests/debug/settings/admin/analytics-routes.test.ts`
- Create: `tests/client/settings/analytics-fetchers.test.ts`
- Create: `tests/client/settings/sections/AnalyticsPreferencesSection.test.ts`
- Create: `tests/client/settings/sections/admin/AdminAnalyticsSection.test.ts`
- Modify: `tests/client/settings/SettingsApp.test.ts`
- Modify: `tests/stories/settings/admin-surfaces.story.test.ts`

Actor routes:

```text
GET  /settings/api/analytics/preferences
PUT  /settings/api/analytics/preferences
POST /settings/api/analytics/export
POST /settings/api/analytics/withdraw
POST /settings/api/analytics/delete
```

Admin routes:

```text
GET   /settings/api/admin/analytics
PATCH /settings/api/admin/analytics
POST  /settings/api/admin/analytics/sinks
POST  /settings/api/admin/analytics/sinks/:sinkVersionId/verify
POST  /settings/api/admin/analytics/sinks/:sinkVersionId/rotate
POST  /settings/api/admin/analytics/sinks/:sinkVersionId/disable
POST  /settings/api/admin/analytics/reconcile
```

- [ ] Write route tests proving every endpoint requires an authenticated
      settings session and every mutation requires CSRF.
- [ ] Run
      `bun test tests/debug/settings/analytics-routes.test.ts tests/debug/settings/admin/analytics-routes.test.ts`;
      expect import failures.
- [ ] Add `handleAnalyticsRoutes` using the authenticated principal's platform
      instance/user identity; reject any actor ID supplied in URL, query, or body.
- [ ] Add GET response with notice/policy version, purpose, controller contact,
      current local/external preference, effective time, and plain-language
      aggregate/pseudonymous distinction.
- [ ] Add strict PUT schema accepting only
      `localLongitudinal` and `externalPseudonymous` values
      `allow|deny`; reject unknown keys and `unknown` writes.
- [ ] Assert preference, withdrawal, export, and deletion actions never create
      actor-linked product-analytics events or delivery payloads; only the
      separate governance audit changes.
- [ ] Wire withdrawal to the atomic subject-service workflow and deletion to a
      queued authenticated request whose status is returned without raw actor
      identity.
- [ ] Return analytics-only export as a download response with
      `Cache-Control: no-store`; never claim other papai stores are covered.
- [ ] Add `handleAdminAnalyticsRoutes` guarded by `requireAdmin` with strict
      GET/PATCH schemas for local mode, separate external booleans, policy fields,
      downward-only retention, review acknowledgement, and approved logical
      sink/version ID.
- [ ] Return `subjectRightsLookupHorizonDays: 90` as read-only policy evidence
      in admin GET and render it in the readiness view. Reject it in PATCH; a
      future value change requires a new reviewed schema/policy version rather
      than an ordinary settings mutation.
- [ ] Add admin+CSRF route tests for sink create, verify, rotate, and disable;
      inject endpoint/token canaries and assert no GET/list/error response or log
      contains plaintext, ciphertext, or secret-shaped fields.
- [ ] Wire sink creation as disabled encrypted version, verification as a
      capability/captured-request/delete gate, rotation as verify-successor then
      atomic switch, and disable as soft-disable. Never expose a hard-delete
      route for ledger-referenced versions.
- [ ] Refuse pseudonymous enablement when governance readiness or sink
      capabilities fail and return controlled, user-actionable gate codes.
- [ ] Expose kill-switch state as read-only and show it as authoritative over
      stored settings.
- [ ] Add reconciliation/sink lifecycle endpoints that return only IDs,
      versions, fingerprints, states, counts, gate states, freshness, and
      controlled errors; never endpoint/token/body/key values.
- [ ] Register actor/admin paths in `routeSettingsApi`; add a 404/405 test for
      unowned methods/paths.
- [ ] Write strict client schema tests for valid responses, unknown keys,
      secret-looking fields, invalid enum, and missing coverage/censor fields.
- [ ] Implement fetchers through existing `getJson`/`writeJson`; test URL,
      method, CSRF behavior, and `no-store` export handling.
- [ ] Build `AnalyticsPreferencesSection` as a personal section with notice,
      local choice, separate external choice, current effective state, export,
      withdraw, and delete confirmation.
- [ ] Assert a group context still edits only the signed-in actor's preference
      and contains no control for another member or group-wide consent.
- [ ] Build `AdminAnalyticsSection` with mode, readiness checklist, retention,
      external aggregate, pseudonymous sink gate, health/reconciliation,
      snapshot age, and explicit OpenPanel blocked reason.
- [ ] Add write-only sink forms for create/rotate and explicit verify/disable
      actions; after submission clear secret inputs and render only version,
      fingerprint, verification state, and controlled gate results.
- [ ] Add accessible labels, keyboard operation, pending/disabled states,
      error summary, destructive confirmation, and success announcement tests.
- [ ] Mount `analytics` in the Personal sidebar and `analytics-admin` in the
      bot-admin sidebar in `SettingsApp.svelte`.
- [ ] Add MSW fixtures for aggregate default, incomplete governance, governed
      local pilot, kill switch, failed sink, withdrawal in progress, and
      reconciled healthy state.
- [ ] Add Storybook stories for those states and update the admin surface
      contract manifest.
- [ ] Run
      `bun test tests/debug/settings/analytics-routes.test.ts tests/debug/settings/admin/analytics-routes.test.ts tests/client/settings/analytics-fetchers.test.ts tests/client/settings/sections/AnalyticsPreferencesSection.test.ts tests/client/settings/sections/admin/AdminAnalyticsSection.test.ts tests/client/settings/SettingsApp.test.ts`.
- [ ] Run `bun test:client`, `bun build:client`, and
      `bun test:stories:contracts`.
- [ ] Run `bun run typecheck`, `bun run lint`, and `bun security`.
- [ ] Commit with
      `git add src/debug/settings/analytics-routes.ts src/debug/settings/admin/analytics-routes.ts src/debug/settings-api-router.ts src/analytics/delivery/sink-service.ts client/settings/fetcher-schemas-analytics.ts client/settings/analytics-fetchers.ts client/settings/sections/AnalyticsPreferencesSection.svelte client/settings/sections/AnalyticsPreferencesSection.stories.svelte client/settings/sections/admin/AdminAnalyticsSection.svelte client/settings/sections/admin/AdminAnalyticsSection.stories.svelte client/settings/SettingsApp.svelte tests/client/stories/msw/settings-handlers-personal-2.test.ts tests/client/stories/msw/settings-handlers-admin-2.test.ts tests/debug/settings/analytics-routes.test.ts tests/debug/settings/admin/analytics-routes.test.ts tests/client/settings/analytics-fetchers.test.ts tests/client/settings/sections/AnalyticsPreferencesSection.test.ts tests/client/settings/sections/admin/AdminAnalyticsSection.test.ts tests/client/settings/SettingsApp.test.ts tests/stories/settings/admin-surfaces.story.test.ts && git commit -m "feat(settings): add analytics governance controls"`.

## Task 17: Register bounded jobs and prove lifecycle isolation

**Files:**

- Create: `src/analytics/jobs/register.ts`
- Modify: `src/runtime/production-deps.ts`
- Modify: `src/runtime/production-background.ts`
- Modify: `src/scheduler-instance.ts`
- Modify: `src/analytics/runtime.ts`
- Modify: `src/analytics/process-epoch.ts`
- Modify: `src/analytics/storage/epoch-store.ts`
- Modify: `src/analytics/jobs/backfill.ts`
- Modify: `src/analytics/jobs/derive.ts`
- Modify: `src/analytics/jobs/intent.ts`
- Modify: `src/analytics/jobs/reconcile.ts`
- Modify: `src/analytics/jobs/retention.ts`
- Modify: `src/analytics/jobs/snapshot.ts`
- Modify: `src/analytics/delivery/worker.ts`
- Create: `tests/analytics/job-registration.test.ts`
- Create: `tests/analytics/runtime-lifecycle.test.ts`
- Modify: `tests/debug/event-bus.test.ts`
- Modify: `tests/runtime/production-background.test.ts`

Registered jobs and default cadence:

| Job                        |                                         Cadence | Runs when                           |
| -------------------------- | ----------------------------------------------: | ----------------------------------- |
| aggregate flush/finalize   | every minute; finalize prior UTC day at `00:05` | local aggregate enabled             |
| usage high-water normalize |         every 5 minutes from durable checkpoint | any local lane enabled              |
| intent missing-output scan | every 5 minutes with bounded terminal-turn page | local pseudonymous enabled          |
| derive/materialize         |       every 5 minutes with two-minute watermark | local pseudonymous enabled          |
| delivery                   |                                    every minute | corresponding external lane enabled |
| reconciliation             |                                          hourly | any local lane enabled              |
| snapshot                   |                                          hourly | configured absolute snapshot path   |
| expiry purge               |        earliest deadline; at least every minute | any stored analytics exists         |
| censor maturity            |                            daily at `01:15` UTC | local pseudonymous rows exist       |

- [ ] Write a registration test asserting exact job names, cadences, and no
      duplicates across runtime restarts.
- [ ] Run `bun test tests/analytics/job-registration.test.ts`; expect an import
      failure.
- [ ] Implement `registerAnalyticsJobs`/`unregisterAnalyticsJobs` against the
      shared scheduler with injected clock and job dependencies.
- [ ] Add startup-order assertions that overdue expiry purge completes before
      any analytics query, snapshot, or delivery worker, then schedule the
      dynamic next-expiry wake.
- [ ] Before source subscriptions or any producer start, recover prior
      stale-open process epochs and affected UTC buckets, then durably open the
      new epoch. Bind scheduled and live source counters/contributions to that
      epoch rather than a process-global implicit counter.
- [ ] Add a usage high-water test inserting one direct embedding/distillation
      row after initial normalization; assert the scheduled job decides it
      aggregate-only once and advances the checkpoint transactionally.
- [ ] Add an intent-coverage test dropping an inline hint; assert the scheduled
      missing-output scan fills exactly one `(turn_key,taxonomy_version)` row.
- [ ] Add the registration calls to the existing default scheduler lifecycle;
      keep provider poller/recurring behavior unchanged.
- [ ] Add tests that kill switch/mode checks happen at job entry and that a
      mode change while a job is queued exits before reading actor data or
      sending.
- [ ] Add bounded batch sizes and `p-limit` concurrency to derive, retention,
      snapshot, reconciliation, and delivery remote work.
- [ ] Write a runtime lifecycle test proving analytics starts after migrations,
      opens an epoch before source subscriptions, starts subscriptions before
      chat ingress, and on shutdown stops ingress/producers, drains writers and
      disposition/contribution counters, closes the epoch, unsubscribes, then
      closes the database.
- [ ] Add a forced-timeout fixture and assert shutdown leaves the epoch open.
      On next startup it becomes stale and every
      intersecting bucket becomes `unreconciled_restart_gap` without inventing
      a loss count or delaying beyond the configured bound.
- [ ] Add clean-restart, crash-after-finalized-bucket, and
      crash-across-UTC-midnight lifecycle tests. Assert the clean epoch closes
      only after drain, a finalized day is demoted after a stale-open crash,
      and both days intersected by the midnight crash are unreconciled.
- [ ] Add a listener-exception fixture to `src/debug/event-bus.ts` tests and
      prove analytics callbacks catch internally; do not change the bus's public
      synchronous contract in this task.
- [ ] Add a reply-path benchmark fixture with observer off, aggregate, and
      pseudonymous modes; assert no network work and no awaited analytics write on
      the reply path.
- [ ] Add queue-growth health thresholds and assert a full queue drops only the
      new safe fact, increments an exact controlled overflow count, and never
      blocks chat; distinguish this from unquantifiable crash loss.
- [ ] Run
      `bun test tests/analytics/job-registration.test.ts tests/analytics/runtime-lifecycle.test.ts tests/debug/event-bus.test.ts tests/runtime/production-background.test.ts`.
- [ ] Run `bun run typecheck`, `bun run lint`, and `bun security`.
- [ ] Commit with
      `git add src/analytics/jobs/register.ts src/analytics/jobs/backfill.ts src/analytics/jobs/derive.ts src/analytics/jobs/intent.ts src/analytics/jobs/reconcile.ts src/analytics/jobs/retention.ts src/analytics/jobs/snapshot.ts src/analytics/delivery/worker.ts src/analytics/runtime.ts src/analytics/process-epoch.ts src/analytics/storage/epoch-store.ts src/runtime/production-deps.ts src/runtime/production-background.ts src/scheduler-instance.ts tests/analytics/job-registration.test.ts tests/analytics/runtime-lifecycle.test.ts tests/debug/event-bus.test.ts tests/runtime/production-background.test.ts && git commit -m "feat(analytics): schedule bounded lifecycle jobs"`.

## Task 18: Update architecture/runbooks and execute release gates

**Files:**

- Modify: `docs/architecture/behaviors.md`
- Modify: `docs/architecture/environment.md`
- Modify: `docs/architecture/overview.md`
- Modify: `docs/architecture/commands.md`
- Create: `docs/operations/analytics-runbook.md`
- Create: `docs/operations/analytics-incident-runbook.md`
- Create: `tests/analytics/privacy-contract.test.ts`
- Create: `tests/analytics/rollout-gates.test.ts`
- Modify: `README.md`

- [ ] Document the two local and two external lanes, aggregate limitations,
      source-to-store flow, scope rules, guest policy, key domains, retention,
      settings routes, and Metabase snapshot in the architecture docs.
- [ ] Document exact commands for dry-run/apply/resume/reconcile backfill,
      snapshot build/verify, subject export/delete, rekey plan/apply/verify, and
      kill-switch activation.
- [ ] Write the operations runbook with Stage A–E entry/exit evidence,
      ownership, review cadence, dashboard freshness/query SLO, storage thresholds,
      and daily/weekly reconciliation schedule.
- [ ] Write the incident runbook with immediate kill switch, egress stop,
      affected versions/windows/sinks, exposure classification, local/remote
      delete/rebuild, key-compromise epoch break, and reconciliation proof.
- [ ] Add one table-driven privacy-contract test covering registry closure,
      strict fuzz, C3 canaries, identity matrix, raw-ID absence, semantic outcome,
      consent matrix, withdrawal race, delivery state, session boundaries, cohort
      censoring, rephrase persistence, classifier contract, backfill provenance,
      external thresholding, DSAR/delete/rekey, and performance clocks.
- [ ] Include frozen HMAC bytes/digests, Discord effective conversation,
      post-classification tool terminal, command production DI, request-scoped
      provider overlap/cache isolation and log canaries, feature uniqueness,
      recoverability matrix, first-create rollback maps, collection-writer and
      delivery-grant races, process-epoch associations, send-start crash
      states, sink lifecycle/ambiguous/SSRF pinning, restrictive event FK,
      deadline expiry, encrypted deletion targets, Metabase inode
      close/remount verification, staging cleanup, post-high-water dual-write
      rekey, release lattice, and restart-gap publication blocks in that table.
- [ ] Run `bun test tests/analytics/privacy-contract.test.ts`; expect every
      release-blocking fixture to pass.
- [ ] Add rollout-gate tests that refuse Stage B without Stage A evidence,
      Stage C without governance and two complete Stage B UTC weeks, Stage D
      without aggregate assessment, and Stage E without actor allow plus a
      sink passing the strict AND of caller-controlled destination
      idempotency, deterministic reconciliation, and complete per-actor
      deletion.
- [ ] Mark any UTC day intersecting `unreconciled_restart_gap` ineligible for
      publication or Stage B evidence; require two new consecutive complete
      weeks rather than filling the equation with crash loss.
- [ ] Assert OpenPanel cannot satisfy Stage E with the capabilities documented
      in the research result.
- [ ] Generate one fully synthetic captured request and scan SQLite, snapshot,
      logs, request capture, delivery state, and screenshots for prohibited
      canaries; expect zero matches.
- [ ] Run binding gate 1: `bun build:client`.
- [ ] Run binding gate 2: `bun test tests/analytics tests/settings`.
- [ ] Run binding gate 3: `bun test:client`.
- [ ] Run binding gate 4: `bun run typecheck`.
- [ ] Run binding gate 5: `bun run lint`.
- [ ] Run binding gate 6: `bun security`.
- [ ] Run binding gate 7: `bun run test`.
- [ ] Run binding gate 8: `bun test:stories:contracts`.
- [ ] Run binding gate 9: `bun test:stories`.
- [ ] If provider adapters changed, run provider-real E2E only with test
      credentials and non-production targets per `tests/CLAUDE.md`; otherwise
      record the justified skip.
- [ ] After the binding sequence, run
      `bun run format:check && bun security:ci && bun run knip && bun run duplicates`;
      fix any new analytics-owned finding without ignore comments.
- [ ] Run final reconciliation against the synthetic fixture and require zero
      unexplained source delta for its complete process epoch, zero
      event/aggregate epoch-association delta, zero delivery-state delta
      including `sending`/`ambiguous`, and zero privacy canary.
- [ ] Commit with
      `git add docs/architecture/behaviors.md docs/architecture/environment.md docs/architecture/overview.md docs/architecture/commands.md docs/operations/analytics-runbook.md docs/operations/analytics-incident-runbook.md README.md tests/analytics/privacy-contract.test.ts tests/analytics/rollout-gates.test.ts && git commit -m "docs(analytics): add rollout and incident runbooks"`.

---

## Rollout, rollback, and reconciliation gates

### Stage A — code present, collection off

Set the environment kill switch for the deployment even though the stored
shipping default is `local_aggregate`. Apply migrations, run all synthetic
fixtures, dry-run backfill, build a synthetic snapshot, complete deletion and
rekey drills, and verify captured egress. There are no actor-linked writes and
no network sends.

**Entry:** Tasks 1–18 merged; all release commands green.

**Exit:** privacy contracts 1–17 green; the synthetic complete process epoch
reconciles to zero; fresh allowlisted snapshot bytes verify; deletion/rekey
drills complete; privacy/security owner signs Stage A evidence.

**Rollback:** Keep the kill switch set. Revert runtime/UI commits if necessary;
leave additive 072–075 tables dormant. No down migration or table deletion.

### Stage B — aggregate-local

Remove the deployment kill-switch override and retain
`local_mode=local_aggregate`. Run for two complete UTC weeks. Review
normalization rejects, exact overflow counters, restart-gap status,
operational-usage
reconciliation, storage/expiry, snapshot writer impact, freshness, and query
p95. This stage cannot report actors, sessions, intent, cohorts, retention, or
feature penetration.

**Exit:** two consecutive complete UTC weeks whose contributing process epochs
all closed cleanly have zero unexplained reconciliation delta, zero
C3/raw-ID/guest-continuity findings, exact bounded overflow within the accepted
threshold, verified deadline-aware 90-day expiry behavior, and snapshot/query
SLO compliance. Any `unreconciled_restart_gap` day is suppressed and restarts
the evidence window; its crash loss is not estimated.

**Rollback:** Set the kill switch immediately. Preserve daily rows for the
normal expiry job unless incident response requires deleting/rebuilding them.
Any privacy finding returns to Stage A.

### Stage C — governed local pseudonymous pilot

Complete governance fields and keys, then enable `local_pseudonymous` only for
explicit test actors or one controlled installation. In consent mode, only
post-allow activity is eligible. Run at least two weekly review cycles and one
complete authenticated export/withdraw/delete exercise.

**Exit:** hand-calculated sessions, activation, outcomes, intent coverage, and
censoring match materializations; withdrawal passes collection
deny-before/writer-before races and every delivery race point;
deadline-aware 90-day expiry and all-key-version export/delete/rekey pass;
deletion acknowledgement follows verified published-snapshot replacement;
reply-path latency and queue growth stay within accepted bounds.

**Rollback:** Switch local mode to `local_aggregate`, which immediately stops
new actor events. Cancel pending actor delivery, run the deletion workflow for
pilot actors if required by notice/policy, rebuild affected materializations,
and reconcile before declaring rollback complete.

### Stage D — optional external aggregate

Enable only a reviewed aggregate sink. Release only complete UTC-day cells in
the frozen all/one-way lattice after deterministic primary and complementary
suppression. Repeat exhaustive differencing, captured-request proof, and daily
reconciliation for two weeks; restart-gap cells remain suppressed.

**Rollback:** Disable the sink or set the global kill switch, cancel pending
aggregate releases, retain delivered receipt hashes for 30 days, and reconcile
local release IDs against destination totals.

### Stage E — optional external pseudonymous

This plan leaves Stage E closed. It may open only after a separately reviewed
sink supplies caller-controlled destination idempotency **and** deterministic
reconciliation **and** complete per-actor deletion for every key version,
plus processor/residency/security approval, a pinned integration, and a
successful deletion canary. No one capability is an alternative for another.
Operator enablement and actor `external_pseudonymous=allow` are both
mandatory. Start with one sink and a daily cap.

OpenPanel remains a PoC candidate and does not pass this gate on the evidence
recorded in `05-provider-scorecard-and-poc.md`.

### Reconciliation equations

Only a complete process epoch/window publishes this source equation:

```text
source opportunities
  = active-generation canonical rows associated by process_epoch_id
  + normalization rejects
  + governance-ineligible rows
  + aggregate-only rows
  + exact controlled overflow

delivery rows
  = pending + leased + sending + delivered + ambiguous + dead
  + delete_pending + deleted + cancelled

unique delivery rows
  = unique (event_id, sink_version_id)

aggregate cell delta
  = sum exact analytics_aggregate_epoch_contributions

active physical parent count
  = target-shadow physical parent count
  = encrypted run mappings with exactly one existing parent in each generation

SHA-256(ordered active event IDs)
  = SHA-256(
      ordered target event IDs normalized in memory to active IDs
      through the decrypted run mapping
    )
```

The left side and non-canonical terms come from bounded
`analytics_epoch_source_counters`; ordinary canonical, delivery, derivation,
snapshot, and source-reconciliation terms resolve the singleton pointer and
select only active-generation rows. Canonical and aggregate terms come only
from their durable epoch associations. Target-shadow rows add neither a source
opportunity nor a disposition. The shadow count/hash equation is separate and
cannot be balanced by a reject, overflow, or loss term; decrypted mapping
normalization exists only inside the verifier and no stable cross-generation
event ID is persisted. The unexplained difference must be exactly zero only for
a `closed` epoch and durable usage high-water run. A bounded queue-full
rejection has an exact counter and may appear as controlled overflow. A
stale-open crash can lose work before any counter, so every UTC bucket
intersecting its lifetime or contribution is
`unreconciled_restart_gap` even if finalized; it receives no balancing term and
is blocked from dashboard publication, external release, and rollout evidence.
Delivery, snapshot, and destination reconciliation must also be `ok`;
`ambiguous` remains a visible non-retried state until explicitly reconciled.

### Backfill rollback

Backfill is additive and idempotent. Every run has a policy cutoff, source
high-water mark, schema/event/key versions, a first-created event map, and an
exact first-applied aggregate contribution map.

1. Stop the run without advancing the uncommitted checkpoint.
2. Disable pseudonymous collection if the cause is privacy- or
   identity-related.
3. Select exact event IDs through
   `analytics_backfill_event_map(run_id,event_id,source_ref_key)`, settle
   sending/ambiguous/delivered delivery, persist minimal independent receipts,
   remove delivery rows, and rebuild affected materializations.
4. Reverse only exact deltas in
   `analytics_backfill_aggregate_contributions` and delete only event rows that
   this run first created, in one reviewed transaction.
5. Delete the run's mapping rows only after the rollback transaction verifies
   source/event uniqueness and non-negative aggregate cells.
6. Reconcile the durable source window to zero unexplained delta before
   resuming.

Overlapping runs, concurrent live writes, and pre-existing events/cells are
preserved because a run records provenance only in the transaction that first
creates/increments its mapped target. A restart resumes deterministic source
references/high-water state and cannot steal another run's provenance or apply
the same contribution twice. There is no assumed `run_id` column on
`analytics_events`.

### Change rollback checkpoints

Tasks 1–5 are the aggregate-safe foundation. Tasks 6–8 add source coverage.
Tasks 9 and 15 add dormant delivery machinery. Tasks 10–14 add governed
longitudinal analysis. Task 16 exposes controls; Task 17 activates bounded
jobs. Revert only complete task commits and preserve migrations. After any
revert:

1. set the kill switch;
2. stop/drain analytics jobs;
3. cancel pending delivery;
4. run source and delivery reconciliation;
5. rebuild or remove invalid snapshots;
6. reopen only at the last stage whose exit evidence remains valid.

## Implementation completion evidence

The implementation is complete only when the pull request contains:

- task commit hashes and their narrow red/green command output;
- privacy-contract results for all 17 controls;
- source reconciliation with zero unexplained delta for complete epochs and
  explicit suppression of every restart-gap window; delivery and snapshot
  reconciliation each have zero delta;
- synthetic C3/raw-ID captured-request scan with zero matches;
- migration 072–075 registration and upgrade tests;
- two consecutive clean aggregate UTC weeks with no restart-gap evidence before
  any local pseudonymous pilot;
- governance, key backup/restore, authenticated export, withdrawal, deletion,
  and rekey drill evidence before Stage C;
- Metabase snapshot freshness, row counts, query p95, and reviewed model
  versions;
- an explicit statement that external pseudonymous delivery remains disabled
  until a sink passes its independent gate.
