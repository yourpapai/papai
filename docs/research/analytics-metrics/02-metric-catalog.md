<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Canonical analytics metric catalog

**Catalog version:** 1
**Status:** research specification; not implemented
**Purpose:** make RQ1–RQ8 answerable from content-free, versioned facts with
explicit populations, denominators, censoring, and derivation rules.

## 1. Invariants

1. The debug event bus is a source signal, not an analytics schema. A typed
   adapter selects and transforms facts; it never spreads `event.data`.
2. Every string is either a closed enum, a bounded public version string, or a
   purpose-separated HMAC pseudonym. Unknown strings fail normalization.
3. Raw actor/context/task/turn/tool/model/coding identifiers and all free-form
   content are prohibited.
4. Mutable dimensions—actor role, task assignment/provider, platform
   instance—are snapshotted at occurrence time. A dashboard never joins an old
   event to today's settings and calls that historical truth.
5. The canonical event store is the only source of truth for the
   **pseudonymous longitudinal lane**. A separate daily aggregate contract
   serves the C0-only shipping default. `llm_usage_events` and
   `tool_call_events` remain operational sources and are normalized from a
   bounded high-water scan with provenance. Only a future row carrying every
   strict attribution fact could become canonical; current rows are
   aggregate-only or rejected under §16. Dashboards do not union three event
   stores.
6. Schema, event, taxonomy, session, outcome, and friction versions are
   immutable definitions. A definition change creates a successor series.
7. Analytics rejects a source event it cannot prove safe. Rejection increments
   only a bounded reason counter; the rejected payload is not quarantined.

The privacy classes, governance modes, retention, and threat controls are
specified in
[`03-privacy-consent-threat-model.md`](./03-privacy-consent-threat-model.md).

## 2. Canonical event envelope

The logical JSON contract has `additionalProperties: false` at every object
level. Counts and durations are non-negative safe integers; timestamps are UTC
epoch milliseconds.

```ts
type AnalyticsEventV1 = Readonly<{
  schema: {
    name: 'papai.analytics.event'
    version: 1
  }
  event: {
    id: Pseudonym
    name: EventNameV1
    version: 1
    occurred_at_ms: number
    ingested_at_ms: number
    source: 'live' | 'backfill'
    attribution_quality: 'native' | 'backfill_snapshot' | 'unknown'
  }
  app: {
    version: VersionString
    deployment_key: Pseudonym
  }
  identity: {
    key_version: KeyVersion
    platform: 'telegram' | 'mattermost' | 'discord' | 'kontur-talk'
    platform_instance_key: Pseudonym
    actor_key: Pseudonym | null
    context_key: Pseudonym | null
    thread_key: Pseudonym | null
    task_instance_key: Pseudonym | null
  }
  context: {
    context_type: 'dm' | 'group' | 'none'
    actor_role: 'admin' | 'member' | 'guest' | 'system'
    task_provider: 'kaneo' | 'youtrack' | 'none' | 'other'
    invocation_mode: 'normal' | 'command' | 'settings' | 'proactive' | 'scheduler'
  }
  correlation: {
    conversation_key: Pseudonym | null
    turn_key: Pseudonym | null
    session_key: Pseudonym | null
  }
  governance: {
    purpose: 'product_analytics'
    collection_tier: 'aggregate' | 'pseudonymous'
    policy_version: number
    eligibility: 'allowed' | 'operator_basis' | 'not_applicable'
  }
  privacy: {
    max_class: 'C0' | 'C1' | 'C2'
  }
  props: PropsByEventName[EventNameV1]
}>
```

`Pseudonym` is:

```text
key_version + "." +
base64url(HMAC-SHA-256(
  key,
  purpose_domain || 0x00 || length_prefixed_utf8_components
))[0:24 bytes]
```

The 192-bit truncation is opaque and not reversible. Delimiter-joined inputs
are forbidden. The byte encoding is normative:

1. append the raw UTF-8 bytes of `purpose_domain`;
2. append exactly one `0x00`;
3. for each component in order, append its UTF-8 byte length as an unsigned
   four-byte big-endian integer, then append those UTF-8 bytes.

The purpose domain has no length prefix. There is no trailing NUL. Empty
components are encoded as four zero bytes and remain distinct from a missing
component. Implementations freeze these vectors for the 32-byte key
`000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f`:

| Domain and components               | HMAC input bytes, hexadecimal                                          | SHA-256 HMAC, hexadecimal                                          | First 24 bytes, base64url          |
| ----------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------- |
| `actor:v1`; `platform-1`, `user-42` | `6163746f723a7631000000000a706c6174666f726d2d3100000007757365722d3432` | `f8fa7db3b6fecb403c560e4d1e1bfef724604ff54bcdc73b61b6b6e8ffda8011` | `-Pp9s7b-y0A8Vg5NHhv-9yRgT_VLzcc7` |
| `test:v1`; empty, `é`, `猫`         | `746573743a7631000000000000000002c3a900000003e78cab`                   | `0b6d7b188e3a2d3b7e01205c4adfc4b9b140ec3a56e29c369fb9b1dcf91e1cd0` | `C217GI46LTt-ASBcSt_EubFA7DpW4pw2` |

Every analytics-capable logical emit site supplies a `source_event_id` once
and carries it through retries. A live event HMACs that source ID into
`event.id`. Backfill uses
`source_table + source_row.event_id + canonical_event_name`, then the same
event-domain HMAC. A source-row-to-canonical uniqueness constraint makes
backfill idempotent.

### 2.1 Aggregate-local contract

`AnalyticsEventV1` is not written in `local_aggregate` mode. The default lane
uses a separate strict daily/bucket contract with no event, actor, context,
thread, turn, session, platform-instance, task-instance, model, or tool
pseudonym and no exact event timestamp:

```ts
type AnalyticsAggregateV1 = Readonly<{
  schema: {
    name: 'papai.analytics.aggregate'
    version: 1
  }
  bucket: {
    utc_day: string // YYYY-MM-DD
    definition_version: 1
    finalized: boolean
  }
  dimensions: {
    platform: 'telegram' | 'mattermost' | 'discord' | 'kontur-talk' | 'all'
    context_type: 'dm' | 'group' | 'none' | 'all'
    actor_role: 'admin' | 'member' | 'guest' | 'system' | 'all'
    task_provider: 'kaneo' | 'youtrack' | 'none' | 'other' | 'all'
    app_version: VersionString | 'all'
  }
  measure:
    | {
        kind: 'counter'
        metric: AggregateCounterV1
        value: number
      }
    | {
        kind: 'histogram'
        metric: AggregateHistogramV1
        fixed_buckets: readonly number[]
        counts: readonly number[]
        sum: number
        sample_count: number
      }
  quality: {
    source: 'live'
    partial_day: boolean
    restart_gap_detected: boolean
    reconciliation: 'complete_epoch' | 'unreconciled_restart_gap'
    late_event_count: number
  }
  disclosure: {
    scope: 'local_only' | 'external_eligible' | 'suppressed'
    contributor_basis: 'not_required' | 'eligible_actor' | 'context'
    contributor_count: number | null
    threshold: number | null
  }
}>
```

The aggregate primary key is the tuple
`(utc_day, definition_version, dimensions, metric, histogram_bucket)`, not a
pseudonymous event ID. Producers update only closed counters and fixed
histograms at the authorized source boundary. They never stage raw payloads.

The default aggregate lane cannot compute DAU, sessions, cohorts, retention,
intent-by-actor, or feature-adopter penetration, and must not approximate them.
Those require the governed longitudinal lane.

Local daily counters/histograms expire after 90 days by default. Only
contextually assessed, thresholded rollups may be retained up to 400 days.
For external aggregate release:

- actor-sensitive cells are derived only when the governed longitudinal lane
  can count eligible contributors and the cell has at least 10 actors;
- guest cells use at least 10 turns and 10 distinct contexts;
- if contributor count cannot be computed safely, the cell is suppressed;
- any `unreconciled_restart_gap` cell is suppressed from publication, external
  release, and rollout evidence because an in-memory queue cannot quantify
  crash loss;
- local counters are called aggregate, not anonymous, until that assessment
  succeeds.

External aggregate definition version 1 has a frozen release lattice:

- the only time grain is one complete UTC day;
- a released cell is either the all-dimensions total or a one-way child by
  exactly one of `platform`, `context_type`, `actor_role`, or `task_provider`;
- every other dimension is `all`; `app_version` is always `all`;
- multi-dimension filters, custom ranges, rolling windows, and drill-through
  are not releaseable.

Primary suppression removes every child below its contributor threshold.
Complementary suppression then operates independently within each
`(UTC day, metric, one-way dimension)` partition: if exactly one child is
suppressed, also suppress the releasable sibling with the smallest measure
(ties use the enum's catalog order). Repeat until the partition has either no
suppressed child or at least two. Parent totals whose children could reveal a
suppressed value are suppressed too. The algorithm is deterministic over one
immutable finalized input and must pass exhaustive attempts to recover a cell
through totals, every allowed sibling, and every forbidden cross-filter before
any row becomes `external_eligible`.

## 3. Identity and scope

| Key                        | Purpose-domain input                                                        | Stability/use                                                                    |
| -------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `deployment_key`           | `deployment:v1, install_id`                                                 | Separates installations; never a hostname                                        |
| `platform_instance_key`    | `platform-instance:v1, platform_instance_id`                                | Prevents native-ID collision between two bot instances                           |
| `actor_key`                | `actor:v1, platform_instance_id, chat_user_id`                              | Stable member/admin actor across contexts on one platform instance               |
| `context_key`              | `context:v1, platform_instance_id, native_context_id`                       | DM or group config scope; group-shared across threads                            |
| `thread_key`               | `thread:v1, canonical_storage_context_id`                                   | Thread-isolated scope when the platform model supplies one; null for Discord     |
| `conversation_key`         | `thread_key ?? context_key`                                                 | Effective session partition; not a separately HMACed identity                    |
| `task_instance_key`        | `task-instance:v1, task_instance_id`                                        | Occurrence-time assignment snapshot                                              |
| `turn_key`                 | `turn:v1, raw_turn_id`                                                      | Canonical correlation; raw UUID stays operational/local                          |
| `attempt_key`              | `llm-attempt:v1, raw_turn_id_or_source_id, model_role, ordinal`             | Joins one LLM start to exactly one terminal event and exposes aged-open attempts |
| `session_key`              | `session:v1, actor_key, conversation_key, session_start_ms, first_event_id` | Sessionization v1                                                                |
| `tool_key`                 | `tool:v1, origin, registered_name`                                          | Dynamic external tool analysis without exporting the name                        |
| `model_key`                | `model:v1, provider_binding, model_id`                                      | Model comparison without a free-form model identifier                            |
| coding keys                | `coding-project/session:v1, platform_instance_id, raw_id`                   | Funnel lineage without project/session names                                     |
| collection eligibility ref | `collection-eligibility:v1, platform_instance_id, chat_user_id`             | Generation-bearing operational writer fence; never canonical/BI/egress           |

There is no cross-platform or cross-instance human link. Existing provider
identity mappings are not repurposed into an analytics identity graph. A future
explicit account-link `person_key` would require a new purpose, notice, UI,
policy review, and migration.

Scope facts come from the authorized source boundary:

- parse scoped IDs with `parseScopedContextId`;
- use `getConfigContextIdFromStorageContextId` for group-shared durable config;
- never split a scoped ID on `:`;
- actor-plus-conversation—not subject-plus-context—defines a human session;
- Discord keeps `thread_key=null`; its effective `conversation_key` is the
  actual `context_key`, so one actor's separate DMs/groups never merge;
- guests have no actor, turn, thread, or session key in durable analytics.

Every local or external pseudonymous writer work item carries this operational
sidecar:

```ts
type CollectionEligibilityRef = Readonly<{
  refKey: string
  keyVersion: string
  generation: number
}>
```

It is derived from authenticated native identity with the operational
governance keyring. The canonical writer rechecks the exact generation and
current preference under the per-ref withdrawal fence inside the same SQLite
transaction that inserts the event and its operational event→ref association.
The ref is not an `AnalyticsEventV1` field and never enters props, aggregates,
BI, snapshots, logs, or egress.

## 4. Versioning

- `schema.version` changes for an incompatible envelope change.
- `event.version` changes for any event property addition/removal/semantic
  change because consumers are strict.
- `intent.v1` labels and multi-goal rules never mutate. Renames, merges, and
  splits produce `intent.v2`.
- Derived tables carry `sessionization.v1`, `outcome.v1`, and `friction.v1`.
- Dashboards pin the versions they query and show the definition version.
- CI reconciles event-name, props-schema, metric-source, taxonomy, and
  documentation registries. Runtime configuration cannot add event names or
  properties.

## 5. Shared controlled types

- `CountBucket`: `0 | 1 | 2 | 3_5 | 6_10 | 11_20 | 21_plus`
- `ByteBucket`: `0 | 1_256 | 257_1024 | 1025_8192 | 8193_65536 | 65537_plus`
- `LengthBucket`: `0 | 1_32 | 33_128 | 129_512 | 513_2048 | 2049_plus`
- `ConfidenceBucket`: `lt_050 | 050_069 | 070_084 | 085_094 | ge_095`
- `StatusClass`: `none | 2xx | 3xx | 4xx | 5xx | timeout | network | auth | other`
- `ErrorClass`: `configuration | validation | authorization | permission |
rate_limit | not_found | conflict | provider_4xx | provider_5xx | timeout |
network | mcp_unavailable | llm_provider | cancelled | internal | other`
- `KnownToolSlug`: a generated closed enum for core and enabled first-party
  descriptors. A user MCP/plugin name is `external_other` plus `tool_key`.
- `AggregateCounterV1`: a closed subset such as
  `message_accepted | auth_granted | auth_denied | turn_started |
turn_completed | turn_failed | llm_started | llm_completed | llm_failed |
tool_started | tool_semantic_success | tool_failed | provider_failed |
rate_limit_blocked | mcp_unavailable | unconfigured_reply |
guest_turn | normalization_rejected`.
- `AggregateHistogramV1`: `queue_delay_ms | first_feedback_ms |
time_to_first_token_ms | time_to_first_reply_ms | turn_duration_ms |
tool_duration_ms | confirmation_latency_ms`.

Raw provider codes/bodies, errors, arguments, results, URLs, hostnames,
filenames, and dynamic names never enter these values.

## 6. Event registry and property allowlists

Every event permits exactly the listed properties.

| Event                        | Allowed properties                                                                                                                                                                                                                                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat_message_accepted`      | `input_count: CountBucket`; `length_bucket: LengthBucket`; `attachment_count: CountBucket`; `is_command: boolean`; `command: start\|config\|help\|context\|dashboard\|clear\|stop\|acp\|other\|none`                                                                                                                   |
| `auth_checked`               | `outcome: granted\|denied`; `reason: admin\|member\|open_dm\|guest_mode\|blocked\|group_unauthorized\|unknown_user\|other`                                                                                                                                                                                             |
| `turn_started`               | `incoming_message_count: CountBucket`; `attachment_count: CountBucket`; `queue_wait_ms: number`                                                                                                                                                                                                                        |
| `turn_completed`             | `outcome: ok\|llm_error\|forced_stop\|graceful_stop\|configuration_block`; `duration_ms`; `step_count`; `tool_call_count`; `reply_count: CountBucket`; `finish_reason: stop\|length\|tool_calls\|content_filter\|error\|other\|unknown`; `clarification`; `live_status_used`                                           |
| `reply_sent`                 | `latency_ms`; `part_count: CountBucket`; `length_bucket: LengthBucket`; `delivery: success\|partial\|failed`                                                                                                                                                                                                           |
| `llm_started`                | `attempt_key: Pseudonym`; `model_key`; `model_role: main\|small\|embedding\|verifier`; `phase: generation\|embedding\|distillation\|verification\|classification`; `message_count: CountBucket`; `available_tool_count: CountBucket`                                                                                   |
| `llm_completed`              | `attempt_key`; `model_key`; `model_role`; `duration_ms`; `time_to_first_token_ms: number \| null`; `input_tokens: number \| null`; `output_tokens: number \| null`; `step_count`; `finish_reason: stop\|length\|tool_calls\|content_filter\|other\|unknown`                                                            |
| `llm_failed`                 | `attempt_key`; `model_key`; `model_role`; `phase: resolution\|request\|stream\|embedding\|distillation\|verification\|classification`; `error_class`; `retryable: boolean \| null`; `duration_ms`                                                                                                                      |
| `tool_started`               | `tool_slug`; `tool_key`; `origin: core\|first_party_plugin\|external_plugin\|user_mcp`; `domain: task\|memo\|schedule\|attachment\|web\|identity\|coding\|config\|meta\|other`; `risk: read\|write\|destructive\|open_world`; `model_role: main\|small`; `args_bytes: ByteBucket`                                      |
| `tool_completed`             | all `tool_started` fields plus `duration_ms`; `execution_outcome: semantic_success\|structured_failure\|thrown_failure\|permission_denied`; `result_bytes: ByteBucket`; `error_class: ErrorClass \| null`; `status_class`; `retryable: boolean \| null`; `recovered_same_turn`                                         |
| `confirmation_requested`     | `tool_slug`; `tool_key`; `risk`; `timeout_ms: 300000`                                                                                                                                                                                                                                                                  |
| `confirmation_resolved`      | `tool_slug`; `tool_key`; `decision: granted\|denied\|ignored\|prompt_failed`; `decision_latency_ms`                                                                                                                                                                                                                    |
| `turn_steered`               | `ordinal`; `length_bucket`; `ack_sent`                                                                                                                                                                                                                                                                                 |
| `turn_stop_requested`        | `stage: graceful\|forced`                                                                                                                                                                                                                                                                                              |
| `clarification_requested`    | `reason: missing_required_input\|ambiguous_target\|ambiguous_action\|permission\|configuration\|other`                                                                                                                                                                                                                 |
| `rephrase_detected`          | `detector: lexical_v1\|small_model_v1`; `similarity: 080_089\|090_094\|ge_095`; `prior_outcome: clarification\|failure\|no_action`; `gap: le_2m\|2m_10m`                                                                                                                                                               |
| `edit_classified`              | `window: w1\|w2\|w3`                                                                                                                                                                                                                                                                                                               |
| `edit_regen`                   | `phase: prompt_shown\|prompt_adjust\|prompt_note\|regen_started\|regen_completed\|regen_failed\|history_only`; `duration_ms` (optional, regen completed/failed only)                                                                                                                                                                  |
| `clarification_abandoned`    | `observation_hours: 24`                                                                                                                                                                                                                                                                                                |
| `disclosure_fallback`        | `reason: no_real_load\|meta_tool_churn`; `step_bucket: 1_2\|3_5\|6_plus`                                                                                                                                                                                                                                               |
| `config_link_issued`         | `result: issued\|not_configured\|rate_limited`                                                                                                                                                                                                                                                                         |
| `settings_opened`            | `entry: config_link\|existing_session`; `result: success\|expired\|invalid`                                                                                                                                                                                                                                            |
| `task_instance_assigned`     | `change: first_assignment\|changed`; `from_provider: kaneo\|youtrack\|none\|other`; `to_provider: kaneo\|youtrack\|other`                                                                                                                                                                                              |
| `intent_classified`          | `taxonomy: intent.v1`; `primary: IntentV1`; `goals: IntentGoalV1[]` (deduplicated, sorted, max 3); `confidence`; `strategy: tool_trace_v1\|metadata_v1\|small_model_v1\|hybrid_v1`; `abstained`                                                                                                                        |
| `feature_opportunity`        | `feature: recurring\|deferred\|memory_write\|memory_search\|attachment\|coding\|mcp\|byok\|guest_mode\|web_fetch\|live_status`; `available: boolean`; `reason: available\|capability_missing\|provider_missing\|role_denied\|configuration_missing\|platform_unsupported\|other`; `sampling: first_eligible_actor_day` |
| `feature_used`               | `feature: recurring\|deferred\|memory_write\|memory_search\|attachment\|coding\|mcp\|byok\|guest_mode\|web_fetch\|live_status`; `operation: create\|read\|search\|update\|delete\|start\|continue\|monitor\|review\|finish\|enable`; `outcome: success\|failure\|blocked`; `coding_project_key`; `coding_session_key`  |
| `first_visible_feedback`     | `kind: typing\|live_status\|steer_ack\|none`; `outcome: success\|failed\|missing\|not_applicable`; `capability_supported: boolean`; `setting_enabled: boolean`; `latency_ms: number \| null`                                                                                                                           |
| `live_status_opportunity`    | `eligible: boolean`; `reason: eligible\|platform_unsupported\|disabled\|turn_too_short\|no_status_surface`                                                                                                                                                                                                             |
| `live_status_lifecycle`      | `stage: create\|update\|dismiss`; `outcome: success\|failed`; `latency_from_turn_start_ms: number`; `ordinal: number`                                                                                                                                                                                                  |
| `provider_request_completed` | `provider: kaneo\|youtrack\|magi\|mcp\|llm\|other`; `operation: read\|search\|create\|update\|delete\|connect\|stream\|other`; `duration_ms`; `outcome: success\|failure`; `status_class`; `retryable: boolean \| null`                                                                                                |
| `rate_limit_blocked`         | `limit: web_fetch\|settings_link\|provider\|other`                                                                                                                                                                                                                                                                     |
| `unconfigured_reply`         | `missing: central_llm\|task_instance\|settings_base_url\|provider_credentials\|coding_credentials\|forge_credentials\|other`; `surface: chat\|settings\|coding`                                                                                                                                                        |
| `mcp_availability`           | `origin: user_endpoint\|plugin_endpoint\|coding_broker`; `server_key`; `outcome: available\|connection_failed\|timeout\|auth_failed\|policy_blocked`                                                                                                                                                                   |
| `guest_turn_aggregate`       | `utc_day: YYYY-MM-DD`; `turns`; `successful_turns`; `failed_turns`; `contexts: CountBucket`                                                                                                                                                                                                                            |

Session, funnel, cohort, and feature-association rows have their own typed
derived schemas; they are not smuggled into `props`.

## 7. Enrichment and persistence

1. **At-source facts win.** The authorized message/turn boundary supplies raw
   platform instance, native context, storage/config context, actor, role,
   invocation mode, and turn ID to the normalizer. Debug scope is not
   authoritative.
2. **Snapshot dimensions now.** A failed optional/provider lookup may yield its
   defined `other`/`none` value and `attribution_quality=unknown`; a missing
   required platform or platform-instance fact rejects the pseudonymous
   envelope. Neither case is repaired later with mutable state.
3. **Backfill is explicit.** Historical usage follows the field-by-field
   recoverability matrix in §16. Missing required platform,
   platform-instance, or provider facts make a strict pseudonymous envelope
   impossible; such a row is aggregate-only or rejected with controlled
   attribution/coverage. Current mutable settings never fill the gap.
4. **Use monotonic elapsed clocks.** UTC is for ordering/windows. Reject
   negative/implausible elapsed values and count the controlled rejection.
5. **Sessionize before external delivery.** Live actor activity receives an
   online session; backfill sorts by actor/conversation/time/event ID. Child
   LLM/tool/reply events inherit the initiating turn's session and do not open
   or extend one. A two-minute watermark permits minor live reordering.
6. **Intent is additive and recoverable.** `intent_classified` never mutates
   `turn_completed`; taxonomy, classifier, confidence, and abstention
   provenance remain observable. A scheduled idempotent derivation scans every
   eligible terminal turn missing `(turn_key,taxonomy_version)`. Inline hints
   may reduce latency, but the lossy observer queue is not the coverage
   guarantee.
7. **Close LLM attempts explicitly.** Every main-model request emits one
   `llm_started` before the outbound request and exactly one
   `llm_completed` or `llm_failed` terminal event with the same
   `attempt_key`. A start older than the configured terminal-observation
   timeout is an `aged_open` attempt; it remains in the denominator and is
   reported separately from an explicit failure.
8. **Materialize feature opportunity once.** On the first eligible activity
   for each `(actor_key, feature, UTC day)`, snapshot capability, provider,
   role, configuration, and platform support into one `feature_opportunity`.
   Its source reference is
   `HMAC(feature-opportunity:v1, actor_key, feature, utc_day)` and its event ID
   derives from that reference, so durable uniqueness survives retries,
   restarts, and concurrent producers. Later setting changes affect the next
   daily snapshot, not the old one. `feature_used` is joined only to a same-day
   `available=true` opportunity.
9. **Close feedback observation once per turn.** Emit one
   `first_visible_feedback` after the earliest successful feedback or when the
   turn reaches a terminal state without it. Emit `live_status_opportunity`
   once at turn eligibility resolution and one `live_status_lifecycle` per
   attempted create/update/dismiss. Failed platform calls remain failures;
   unsupported or disabled surfaces are not silently treated as zero latency.
10. **Close tools after semantic classification.** The executor emits one
    content-free `tool:analytics_completed` fact only after optional
    `ToolFailureResult` classification. It carries an idempotent source ID and
    exactly one of semantic success, structured failure, thrown failure, or
    permission denied. Analytics never infers a terminal from
    `tool:execute_end` or `llm:tool_result`.
11. **Keep rephrase state transient and separate.** After authorization, raw
    message text passes through a dedicated in-process handoff that immediately
    derives in-memory lexical features and discards the text. Per
    `(actor_key,conversation_key)`, retain at most three feature sets until
    resolution, withdrawal, or 30-minute expiry; compare only an unresolved
    prior set within 10 minutes. These features never enter the normalizer or
    its queue, and crash/overflow undercount is reported as detector coverage.

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

    `captureText` discards `text` before returning and stores one pending,
    process-keyed feature set plus, at most, a process-local
    `matchedPriorTurnKey` for the newest qualifying unresolved prior.
    `completeTurn` maps controlled structured clarification, terminal failure
    without recovery, and classified `no_action` to unresolved prior outcomes
    of the same names. `success` removes the current set and its matched prior,
    if any; unrelated unresolved sets survive until their own resolution,
    withdrawal, or expiry. Cancelled/ineligible/configuration-only/unknown
    terminals use `discard`, which removes only the current set. `withdraw`
    removes every pending/unresolved set for the actor. `captureText` and
    `completeTurn` serialize per actor/conversation and reconcile both callback
    orders. A late prior terminal may atomically attach itself only to the
    newest qualifying later set that has no matched prior; the pair has one
    idempotent emission and cannot resolve unrelated abandoned goals.

12. **Keep governance operational.** Preference and policy changes live in
    the separate operational governance store defined in
    [`03-privacy-consent-threat-model.md`](./03-privacy-consent-threat-model.md);
    they are not actor-linked canonical analytics events and never egress as
    product telemetry.
13. **Fail closed.** Unknown event/property/enum/version or prohibited string
    produces only
    `analytics_normalization_rejected{source_event_type, reason_enum}` in a
    bounded operator counter.

The canonical append-only table stores indexed envelope columns, strict
serialized props, `expires_at`, and no generic metadata JSON. Required indexes:
occurred time, actor/time, conversation/time, turn, event-name/time. Canonical
event IDs and source-row mapping are unique within a storage generation.
`storage_generation` is a storage-only rekey field, not part of
`AnalyticsEventV1`. Exactly one operational generation is active: ordinary
readers, derivation, delivery, reconciliation, and snapshots must use only
that generation. A planned rekey may hold one target shadow version per active
logical event, but shadow rows have separate copy/count/hash conservation and
never create a second source disposition or become visible/deliverable before
an atomic verified generation swap.

### 7.1 Process epochs and reconciliation association

Before any analytics producer starts, create one durable open process epoch.
Every bounded source disposition counter is keyed by
`(epoch_id, source_family, UTC day, disposition)`. Every physical canonical
version has a storage-only epoch association, but source reconciliation counts
only the exactly-one active storage generation. A rekey shadow is reconciled
separately against its active logical event. Every aggregate mutation records
its exact closed-dimension delta against the epoch. These associations and
storage generations never enter the logical event/aggregate payload.

Clean shutdown stops ingress, drains normalized writers/counters, finalizes
eligible buckets, then closes the epoch. Startup marks every prior still-open
epoch stale and every UTC bucket intersected by its start→startup interval or
recorded contribution `unreconciled_restart_gap`, including an already
finalized bucket. A clean restart leaves the prior epoch closed. A crash across
UTC midnight marks both days. No raw source-fact journal is introduced.

## 8. Measurement conventions

- A **raw incoming message** is one accepted platform message after mention/
  reply filtering. A **turn** is one coalesced invocation and may contain
  several raw messages.
- An authorized command observed through `createObservedCommandHandler` is an
  accepted command activity even when it never enters the normal message
  queue. Command-only first-DM, `/config`, and coding-session milestones remain
  eligible for their named session/activation formulas.
- An **eligible analysis turn** is an authorized, non-guest, actor-keyed,
  normal invocation. Proactive/scheduler turns, ignored group chatter, settings
  loads, and non-model commands are excluded unless named.
- A **mature 24-hour attempt** has 24 hours of observation after its end.
  Immature attempts are censored, never abandoned.
- Calendar metrics use UTC half-open windows. WAU on day `d` covers days
  `d-6..d`; MAU covers `d-29..d`.
- Every rate displays numerator, denominator, unknown/censored count,
  eligibility coverage, and a 95% Wilson interval.
- Do not show a percentage for denominator below 30. Do not expose an external
  segment below 10 actors.
- “New actor” requires sufficient prior observable history. Until 30 days of
  telemetry/backfill exist, insufficient-lookback actors are
  `tenure_unknown`.

## 9. Sessionization v1

Compute `conversation_key = thread_key ?? context_key`. Partition activity by
`(actor_key, conversation_key)`, order by
`occurred_at_ms,event.id`, and start a session when:

- there is no prior eligible actor activity; or
- the gap is **strictly greater than 1,800,000 ms**.

Exactly 30 minutes remains in the current session. Eligible activity includes
accepted normal chat activity, commands, and permission decisions. Bot-only
replies, proactive deliveries, and background status edits do not keep a
session alive.

Start is the first activity. End is the later of the last activity and its
associated reply/turn completion. A single-event session has zero duration.
Report sessions/actor, duration p50/p75/p90/p95, turns/messages/tools per
session, intent set, terminal outcome, and Friction Signature.

Guests have no sessions. Different people in one group thread are not merged;
sibling Telegram/Mattermost threads are not merged. Discord keeps
`thread_key=null`, but one actor in two distinct Discord DMs/groups has two
different `conversation_key` partitions and therefore two sessions.

## 10. Outcome v1

A goal attempt is a classified component goal other than `unknown`,
`no_action`, or `multi_goal`. A multi-goal turn creates up to three goal
attempts but remains one turn.

Goal-satisfying semantic success is:

- relevant `tool_completed.execution_outcome=semantic_success` for action
  intents;
- that tool success plus a successful reply for retrieval/status;
- the named structured event plus a successful reply for help/config.

SDK execution success alone is insufficient: a structured `ToolFailureResult`
can occur after the tool executor returned successfully.

Assign exactly one terminal category:

1. `immediate_success` — success in the initiating turn with no earlier
   relevant semantic failure;
2. `recovered_same_turn` — relevant failure then success in that turn;
3. `recovered_next_turn` — no initiating success, then the same actor/
   conversation/
   goal succeeds within 30 minutes;
4. `unresolved_engaged` — no success in 30 minutes but a same-goal follow-up
   occurs within 24 hours;
5. `abandoned_after_failure`, `abandoned_after_clarification`, or
   `abandoned_after_no_action` — no same-goal follow-up during the mature
   24-hour window;
6. `censored` — observation or analytics eligibility ends before the result is
   knowable.

Formulas:

```text
success rate =
  (immediate + recovered_same_turn + recovered_next_turn) / mature attempts

recovery rate =
  (recovered_same_turn + recovered_next_turn) /
  mature attempts with initial relevant failure

abandonment rate =
  all abandoned / mature unresolved attempts

semantic tool success =
  semantic-success calls / executed calls
```

“Reply sent” alone is never task success. Permission denial is neither an
executed tool call nor a tool failure.

## 11. RQ1–RQ8 definitions

### RQ1 — scenarios

- primary intent share = turns with primary `L` / all classified eligible
  turns; retain `unknown`, `no_action`, and `multi_goal` in the chart;
- classification coverage = non-unknown classified turns / all eligible
  turns, segmented by strategy;
- component-goal prevalence assigns `1 / goal_count` credit to each goal so
  multi-goal volume does not exceed 100%;
- segment only by approved platform, context, provider, cohort, and
  new/returning dimensions.

### RQ2 — onboarding and activation

The new-DM cohort is non-guest actors whose first observed authorized DM falls
in the cohort week and has sufficient lookback. Actors already assigned a task
instance are `preconfigured`, not silently counted through configuration.

For actors requiring configuration:

1. first authorized DM;
2. issued config link within 7 days;
3. successful settings open through that link within 24 hours of step 2 and 7
   days of step 1;
4. first task-instance assignment within 7 days of step 1;
5. first task-provider mutating semantic success within 14 days of step 1.

Show step-1 denominators, conditional previous-step conversion, and median/p90
time-to-step. In consent mode, do not reconstruct pre-eligibility steps; show
observable coverage.

### RQ3 — success

Show first-attempt success, same-turn recovery, next-turn recovery, unresolved
engagement, abandonment, and censoring separately. Per-tool rates use executed
calls and semantic outcomes. Never label recovered attempts “worked first
time.”

### RQ4 — friction and confusion

| Metric               | Numerator / denominator                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Rephrase incidence   | rephrase signals / eligible turns                                                                                |
| Conditional rephrase | rephrase signals / turns preceded by an unresolved same-session turn within 10 minutes                           |
| Clarify abandonment  | mature abandoned clarifications / mature clarification requests                                                  |
| Stop rate            | turns with any stop / active normal turns                                                                        |
| Forced-stop rate     | forced stops / turns with any stop                                                                               |
| Steering rate        | turns with steering / active normal turns; also messages per 100 turns                                           |
| Confirmation denial  | denied / `(granted + denied)`                                                                                    |
| Confirmation ignored | ignored / matured five-minute confirmation requests                                                              |
| Long-turn rate       | duration `>30,000 ms` / completed turns; also show percentiles                                                   |
| Disclosure fallback  | turns with fallback / turns with disclosure enabled                                                              |
| Failure-chain rate   | turns with two consecutive semantic failures and no intervening success / turns with at least two executed tools |

### RQ5 — errors

- explicit LLM error =
  distinct main-model `attempt_key` values with `llm_failed` /
  distinct main-model `attempt_key` values with `llm_started`;
- aged-open LLM rate =
  starts without a terminal event after the configured observation timeout /
  mature main-model starts; aged-open attempts stay visible and are not
  relabeled as explicit provider failures;
- provider error = failed requests / all requests, separated by provider and
  bounded status class;
- structured/thrown tool failure = corresponding calls / executed calls;
- unconfigured = affected eligible turns / eligible turns;
- rate-limit uses the requests at risk for that limiter;
- MCP availability failure = failed connection attempts / all connection
  attempts, not tool calls.

### RQ6 — engagement and retention

- DAU/WAU/MAU are distinct eligible `actor_key` values with eligible activity
  in exact UTC 1/7/30-day windows;
- stickiness is DAU/rolling-MAU and always shows both counts;
- an active context is a distinct thread key and is never called a user;
- exact D1/D7/D30 retention requires activity on exactly cohort day + N and
  excludes actors not observable through N;
- withdrawal/deletion before N is censoring, not churn;
- “returned by D30” is a separate cumulative measure;
- cross-platform retention is intentionally unavailable.

### RQ7 — feature adoption

An adopter has a successful `feature_used` in the window. The denominator is
distinct active actors with at least one `feature_opportunity.available=true`
snapshot for that feature in the window—not all MAU. The opportunity producer
evaluates capability, provider, role, configuration, and platform at the
actor's first eligible activity for that feature and UTC day.

For D30 association, exposure is adoption during cohort days 0–7. Report risk
difference and ratio between exposed/unexposed, stratified by cohort week,
platform, context, and provider. Require 100 observable actors per arm and
label the result association, not causation.

### RQ8 — performance as UX

| Metric                 | Start → end                                                                                                     | Denominator                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Queue delay            | accepted/coalesced message → turn start                                                                         | normal turns                                |
| First visible feedback | accepted message → earliest successful typing/status/steer acknowledgement recorded by `first_visible_feedback` | turns with a supported feedback surface     |
| Time to first token    | LLM start → first streamed text delta                                                                           | streamed text-emitting calls                |
| Time to first reply    | turn start → first successful real reply                                                                        | replied turns                               |
| Total turn duration    | turn start → turn completion                                                                                    | completed turns                             |
| Tool latency           | tool execution start → end                                                                                      | executed tools                              |
| Confirmation latency   | successful prompt send → decision/timeout                                                                       | confirmation requests                       |
| Live-status coverage   | `live_status_lifecycle(stage=create,outcome=success)` turns / `live_status_opportunity(eligible=true)` turns    | capability supported, setting on, turn ≥1 s |

Report p50/p75/p90/p95/p99, count, timeout/failure count, and app version.
No-token tool-only turns are not applicable to TTFT. A platform without live
status is not a zero or a failure.

## 12. Source-to-formula closure

This table is the minimum fact closure for each research question. A metric is
not implementation-ready until its listed producer and terminal observation
exist; dashboard SQL may not infer a missing fact from debug text or current
settings.

| RQ              | Required canonical or derived facts                                                                                                                                     | Formula closure                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| RQ1 scenarios   | `turn_started`, `turn_completed`, `intent_classified`                                                                                                                   | one strict intent row per eligible terminal turn, including abstention                               |
| RQ2 onboarding  | `chat_message_accepted`, `config_link_issued`, `settings_opened`, `task_instance_assigned`, task-domain `tool_completed`                                                | ordered actor milestones; activation is first mutating semantic task-provider success within 14 days |
| RQ3 success     | `intent_classified`, `tool_started`, `tool_completed`, `reply_sent`, derived `outcome.v1`                                                                               | every mature goal attempt has exactly one terminal/censored outcome                                  |
| RQ4 friction    | `rephrase_detected`, `clarification_requested`, `clarification_abandoned`, confirmation, stop, steering, disclosure, tool outcomes, turn timing                         | every component has an explicit eligible denominator and observation window                          |
| RQ5 errors      | `llm_started`, `llm_completed`, `llm_failed`, provider/tool terminal events, `rate_limit_blocked`, `mcp_availability`, `unconfigured_reply`                             | starts and terminals join by `attempt_key`; aged-open is visible                                     |
| RQ6 engagement  | actor/conversation activity plus `sessionization.v1` and eligibility/censor intervals                                                                                   | exact UTC windows and exact-day retention; withdrawal/deletion right-censors                         |
| RQ7 adoption    | daily `feature_opportunity`, `feature_used`                                                                                                                             | available actor-days provide the denominator; successful use provides exposure                       |
| RQ8 performance | `turn_started`, `llm_started`, `llm_completed`, `reply_sent`, `first_visible_feedback`, `live_status_opportunity`, `live_status_lifecycle`, tool/confirmation terminals | each clock has a named start, terminal observation, failure count, and not-applicable rule           |

## 13. Funnels

### Task creation

Unit: one eligible `task.create` turn; window: same turn.

1. intent classified;
2. mapped create tool starts;
3. mapped tool achieves semantic success;
4. a real reply is delivered and the turn does not terminate in error.

Multiple create calls do not multiply the denominator. Show both step-1 and
conditional conversions, classification coverage, and multi-goal share.

### Coding discovery

1. first successful `list_projects` in a chat session;
2. successful `start_session` for the same actor within 30 minutes;
3. hashed coding session reaches `active|waiting_input|done` within 10 minutes;
4. successful `review_pr` on the same project/session lineage within 7 days.

Right-censor episodes without seven days of observation. Because direct start
is valid, also publish:

```text
start_success → active_observed → terminal_observed →
PR_published_or_reviewed
```

Never treat absence of `list_projects` as direct-start failure.

## 14. Friction Signature v1

For a mature session, each component is binary:

- `R` rephrase;
- `C` clarification abandoned;
- `P` permission denied, ignored, or prompt failed;
- `S` graceful or forced stop;
- `L` at least one turn above 30 seconds;
- `D` disclosure fallback;
- `F` at least one two-failure chain.

`count = R+C+P+S+L+D+F`, range 0–7. If a UI needs 0–100:
`round(100 × count / 7)`. There are no hidden weights.

Always show components, session turn count, detector coverage, and 24-hour
maturity. Compare within turn-count deciles; use random sampling within
high-signature strata. This is not an employee/model ranking, SLO, or direct
cross-platform score.

## 14.1. Edit handling metrics (standalone friction companions)

**`edit_classified`** — one per authorized, content-changed edit, after
window classification. Props: `window` (`w1` active-run steer, `w2` last-turn
regen, `w3` baseline-only). Silent paths (unauthorized, group-ignored,
command, empty, same-text) emit nothing.

**`edit_regen`** — one per executed W2 funnel step. Props: `phase`
(`prompt_shown`, `prompt_adjust`, `prompt_note`, `regen_started`,
`regen_completed`, `regen_failed`, `history_only`) and optional `durationMs`
(regen start→settle, completed/failed only). `history_only` covers
no-buttons platforms and unwired `processMessage`; distinguish via the
platform dimension.

Both events are RQ4 friction companions. They carry no message or edit
content. They do not create turn, session, or outcome semantics: regen turns
are invisible to turn/session/outcome materializations, the original turn is
never retracted or marked superseded, and Friction Signature v1 is unchanged.
Guests contribute aggregate-only counters. Events are live-only; no backfill
source exists.

Metrics: edit rate per eligible actor-day, window distribution, regen funnel
conversion (prompt_shown → adjust → completed), regen failure rate, regen
duration percentiles. All with the standard honesty block.

## 15. Intent taxonomy

The binding taxonomy and labeling experiment are in
[`04-intent-labeling-spike.md`](./04-intent-labeling-spike.md). Its 23 labels
describe user goals rather than tools, preserve `no_action` and `unknown`, and
represent up to three component goals under `multi_goal`.

## 16. RQ coverage and known limits

| Area                             | Native/live                                | Backfill                                     | Aggregate-local              |
| -------------------------------- | ------------------------------------------ | -------------------------------------------- | ---------------------------- |
| LLM/tool volume, tokens, latency | full after adapters                        | aggregate-only under current schema          | aggregate counts/percentiles |
| Platform/thread/actor role       | requires new trustworthy source dimensions | incomplete/unknown                           | low-cardinality aggregates   |
| Task provider/instance           | occurrence snapshot required               | historical assignment unavailable            | provider aggregate only      |
| Intent/outcome/friction          | new canonical events/derivations           | unavailable except coarse tool outcomes      | thresholded totals only      |
| Sessions/retention               | pseudonymous eligible actors only          | unavailable under current attribution schema | unavailable                  |
| Guest behavior                   | aggregate daily counters only              | no longitudinal backfill                     | supported aggregate          |
| Rephrase                         | transient detector; restarts undercount    | unavailable                                  | component aggregate only     |

The binding backfill/incremental-normalization recoverability matrix is:

| Required fact                             | Evidence in current usage rows | Strict pseudonymous decision                                                          | Aggregate/reject decision                                                                           |
| ----------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| occurrence time and durable source row ID | both tables: yes               | usable after range/type validation                                                    | controlled terminal counter/time bucket                                                             |
| platform                                  | absent                         | **cannot construct envelope**                                                         | aggregate only when a safe closed producer family supplies it; otherwise `missing_platform`         |
| platform instance                         | absent                         | **cannot construct deployment-scoped identity**                                       | never infer from current instance/config; `missing_platform_instance` coverage                      |
| storage context and context type          | both tables: present           | insufficient without authoritative platform and instance                              | validate `dm\|group`; invalid value is `invalid_context_type`                                       |
| native actor ID                           | both tables: present           | insufficient without authoritative platform instance                                  | never persist/hash alone; count only the row decision                                               |
| actor role                                | absent                         | **cannot construct envelope**                                                         | no current-role lookup; `missing_actor_role` coverage                                               |
| task provider/instance                    | absent                         | **cannot construct envelope**                                                         | no current assignment lookup; provider dimension is `all`, with `missing_task_attribution` coverage |
| invocation mode                           | absent                         | **cannot construct envelope**                                                         | no guessed `normal`; `missing_invocation_mode` coverage                                             |
| raw turn ID                               | tool: required; LLM: nullable  | usable only if every envelope fact is independently present                           | never create actor continuity from it                                                               |
| model ID and role                         | both tables: present           | model key also needs an occurrence-time provider binding, which is absent             | controlled role aggregates; invalid roles rejected                                                  |
| tool name/outcome/timing                  | tool table: present            | terminal semantics are recoverable, but the envelope still fails required attribution | controlled known-tool/domain/outcome aggregates; unknown dynamic name is not emitted                |
| direct embedding/distillation usage       | role identifies these writers  | no safe request context in the current schema                                         | aggregate-only by controlled role, or rejected when another required controlled fact fails          |

Coverage loss is shown, not imputed. Current legacy usage rows therefore do
not produce `AnalyticsEventV1`. Missing platform, instance, role, provider, or
invocation mode is never backfilled from mutable settings. A bounded scheduled
high-water normalization job processes newly inserted rows using this same
matrix; direct embedding/distillation writes remain aggregate-only until a
future occurrence-time request context supplies every required fact.

Each normalization run has a durable high-water mark and a strict
first-creation map. A run inserts
`(run_id,event_id,source_ref_key)` transactionally only when that run first
creates a canonical event. If aggregate backfill first increments a cell, it
likewise records the exact
`(run_id,aggregate_cell_key,metric,delta,source_ref_key)` contribution in the
same transaction. Duplicate, overlapping, resumed, and concurrent live runs
never claim a pre-existing event or contribution. Rollback selects only these
maps; there is no assumed event `run_id`.
