<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Privacy, consent, and threat model

**Status:** research design and implementation gate
**Baseline:** papai's `/stats/*` anonymity contract plus a stricter
longitudinal-analytics boundary
**Legal caveat:** this is a technical privacy-by-design specification, not
jurisdiction-specific legal advice.

## 1. Non-negotiable boundary

The analytics path never stores, logs, forwards, screenshots, or dead-letters:

- user or assistant message text, prompts, summaries, generated text, tool
  step detail, tool arguments/results, memo/observation/instruction bodies;
- usernames, display names, attachment filenames, URLs, paths, hostnames,
  task/project/workspace/status/tag names, RRULEs, repository/PR names;
- raw actor, chat, group, context, thread, platform-instance, task-instance,
  turn, tool, model, coding-project, or coding-session identifiers;
- raw error/response bodies, access tokens, API keys, cookies, session tokens,
  or credentials;
- content hashes, durable n-grams, embeddings, similarity vectors, or other
  content fingerprints that permit dictionary/linkage attacks.

The debug bus cannot satisfy this boundary by itself. Current events include
generated text, raw tool output, errors, memo content/search queries, names,
schedules, IDs, and arbitrary log records. The normalizer is a separate
versioned registry that selects allowed facts. Unknown event/property/version/
enum/string means reject, not forward.

## 2. Privacy classes

| Class | Meaning                                 | Examples                                                                       | Handling                                        |
| ----- | --------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------- |
| C0    | Low-cardinality aggregate-safe metadata | controlled enums, booleans, bucketed counts/lengths, durations, status classes | Eligible for aggregate-local mode               |
| C1    | Linkable pseudonymous data              | actor/context/thread/session/turn/tool/model keys, exact timestamps            | Personal-data posture; governance-gated         |
| C2    | Sensitive derived behavior              | intent, friction, adoption, recovery, error patterns, eligibility              | Personal-data posture; shortest event retention |
| C3    | Prohibited content/secrets/raw IDs      | all boundary items in §1                                                       | Rejected before persistence or egress           |

HMAC data is pseudonymous, not anonymous. Removing the actor column does not
automatically anonymize a small or linkable aggregate.

## 3. Modes and defaults

| Mode                    | Shipping default           | Durable representation                                       | Coverage                                  |
| ----------------------- | -------------------------- | ------------------------------------------------------------ | ----------------------------------------- |
| `off`                   | available kill switch      | none                                                         | none                                      |
| `local_aggregate`       | **on by default**          | daily C0 counters; no actor/context/thread/turn/session keys | broad volume, error, and performance only |
| `local_pseudonymous`    | off until governance setup | eligible C0–C2 canonical events locally                      | RQ1–RQ8                                   |
| `external_aggregate`    | off                        | thresholded aggregates without C1 keys                       | selected aggregate dashboards             |
| `external_pseudonymous` | **always off by default**  | eligible C0–C2 payload at one approved sink                  | external product analytics                |

Governance setup requires:

- policy/notice version, controller contact, purpose, configured retention, and
  lawful-basis mode;
- actor preference UI and authenticated withdrawal/deletion route;
- dedicated key material outside the analytics database;
- sink and processor review where applicable;
- review date and operator acknowledgement that pseudonymous analytics is
  personal-data processing.

The software records the operator's selected mode and enforces eligibility. It
does not declare that one lawful basis is valid for every self-hosted operator.

In `consent` mode, `unknown` actors are ineligible until they allow. In a
documented non-consent local mode, `unknown` may be eligible after notice, but
`deny` always stops product analytics.

External pseudonymous egress requires **both** the operator switch and an
actor-level `allow`, regardless of the local basis. A group admin cannot consent
for every member. Actor preference is scoped to
`(platform_instance_id, platform_user_id)`.

There is no retroactive collection of pre-eligibility activation steps.
Dashboards show eligible-observable coverage instead of silently weakening the
preference.

## 4. Operational preference store

Consent, objection, withdrawal, and policy records are operational governance
state, not product analytics. Store them in a dedicated access-controlled
database area, separate from canonical events and delivery payloads:

```text
analytics_preferences(
  governance_actor_key PRIMARY KEY,
  key_version,
  local_longitudinal ENUM('unknown','allow','deny'),
  external_pseudonymous ENUM('unknown','allow','deny'),
  policy_version,
  source ENUM('settings','authenticated_request','operator_migration'),
  effective_at,
  updated_at
)

analytics_policy_audit(
  audit_id PRIMARY KEY,
  governance_actor_key,
  action ENUM('allow','deny','withdraw','delete_requested','delete_completed'),
  policy_version,
  occurred_at,
  result ENUM('applied','rejected','failed'),
  failure_class ENUM NULL
)
```

`governance_actor_key` uses a governance-specific key and
`governance-actor:v1` purpose domain; it is not `actor_key` and cannot be
joined by an analytics query. Only authenticated settings/DSAR handlers and
the eligibility gate may access this store. Preference rows, audits, and
changes:

- never enter `AnalyticsEventV1`, `AnalyticsAggregateV1`, a BI snapshot, or an
  external sink;
- use metadata-first security audit logging without native identity;
- retain the current `deny`/withdrawal suppression state for as long as needed
  to prevent accidental recollection, while superseded audit rows default to
  400 days and may be shortened by operator policy;
- are returned through authenticated access/export alongside, but physically
  separate from, product analytics;
- follow the operator's documented full-erasure policy without weakening the
  collection suppression gate. If a minimal deny marker must remain, the UI
  and export must describe that fact rather than claiming total erasure.

Aggregate preference-change counts may increment a C0 operational counter, but
the actor-linked preference record is never copied into telemetry.

The preference table contains exactly one current row per
`governance_actor_key`. Mutation uses a transactional UPSERT/update of that
row and an append-only `analytics_policy_audit` insert. History lives only in
the audit table; no implementation may claim to insert a second current row
under the same primary key.

### 4.1 Collection and delivery eligibility grants

Every local or external pseudonymous writer item carries a generation-bearing
operational collection fence:

```text
analytics_collection_eligibility(
  ref_key PRIMARY KEY,
  key_version,
  state ENUM('allow','deny'),
  generation,
  policy_version,
  effective_at,
  revoked_at
)

analytics_event_collection_refs(
  event_id PRIMARY KEY REFERENCES analytics_events(event_id) ON DELETE CASCADE,
  ref_key,
  key_version,
  generation,
  created_at
)
```

`ref_key` is derived from authenticated native identity with the operational
governance keyring and the independent `collection-eligibility:v1` domain. It
is neither `actor_key`, `governance_actor_key`, nor a delivery grant. The
generation-bearing `CollectionEligibilityRef` is an operational writer
sidecar: it is excluded from the canonical event and props, aggregates, BI
snapshots, logs, and egress.

Collection resolution and withdrawal serialize on the ref across every
retained key version. A pseudonymous writer holds that fence while one SQLite
transaction rechecks the exact referenced allow generation, inserts the
canonical event, and inserts its event-to-ref association. A deny that commits
first makes the writer insert nothing. If the writer commits first, withdrawal
advances the generation and deletes the associated canonical event and its
downstream local/delivery contributions before acknowledging withdrawal. A
multi-runtime deployment must replace the in-process fence with an equivalent
database-backed serialization mechanism before pseudonymous collection is
enabled.

Delivery enqueue/lease/send-start rechecks use a different, non-analytics
operational grant:

```text
analytics_eligibility_grants(
  grant_key PRIMARY KEY,
  key_version,
  state ENUM('allow','deny'),
  generation,
  policy_version,
  effective_at,
  revoked_at
)
```

`grant_key` is derived from authenticated native identity with the operational
governance keyring and the independent `delivery-grant:v1` domain. It is
neither `actor_key` nor
`governance_actor_key`, and no analytics query joins those domains. The table
is accessible only to authenticated preference handlers and the delivery
gate, is excluded from canonical BI/snapshots/egress, and retains all
still-relevant deny key versions.

Collect resolves the preference and grant from the same authenticated source
context. Enqueue transactionally verifies `state=allow` and stores the grant
key/version/generation only in the operational delivery row. Lease and the
durable `leased → sending` transaction recheck the exact referenced generation
plus every retained deny version. Withdrawal uses one transaction to UPSERT
`deny`, advance the grant generation, and cancel pending/never-started leased
rows.

The single delivery runtime serializes network send and withdrawal with a
per-grant mutex: send holds it from the final database recheck through remote
ack classification; withdrawal holds it from preference/grant mutation through
delivery cancellation and commits before acknowledgement. Consequently a send
may finish before deny commits, but none begins or completes after a committed,
acknowledged deny. A multi-runtime deployment must replace this with an
equivalent database-backed fence before egress is enabled.

## 5. Pseudonym and key strategy

Use a dedicated analytics HMAC key; never reuse `stats_anonymity_salt`. The
stats and analytics purposes differ in linkage, retention, egress, incident,
and deletion risk.

Each identity has its own purpose domain as specified in
[`02-metric-catalog.md`](./02-metric-catalog.md). Important consequences:

- the same native actor on two platform instances does not collide;
- the same eligible actor across contexts on one instance remains joinable for
  that instance's retention;
- group context and conversation thread are distinct;
- raw turn IDs remain in operational data only; canonical events use
  `turn_key`;
- LLM starts and terminals join only through an analytics-domain
  `attempt_key`; raw request/turn IDs remain operational;
- dynamic external tool/model/coding identifiers become purpose keys rather
  than free-form strings;
- provider identity mappings do not become a cross-platform person graph;
- guests receive no longitudinal pseudonym.

Keys live encrypted outside the analytics database. Canonical values include a
public key version, not the secret. Stable keys last for the configured event
retention horizon; frequent blind rotation would break cohorts without
deleting already exported data.

### Planned rekey

Rekey is a durable, resumable copy/swap workflow, never an in-place rewrite.
`analytics_rekey_runs` records run/domain versions, source high-water marks,
current phase/subphase, counts, verification hashes, terminal status,
`swap_completed_at_ms`, and `retire_not_before_ms`.
Statuses are closed to `planned|running|paused|completed|aborted`; a
database-backed partial unique index permits only one
`planned|running|paused` run. Terminal abort is legal only in a pristine
plan-phase run with no mapping, target row, or installed dual-write state. From
the first dual-write mutation onward, every failure is paused/resumable, never
aborted in favor of another shadow generation. The v1 operational
subject-rights lookup horizon is exactly 90 days after swap
(`subject_rights_lookup_horizon_days=90`); it is not a statement of a
statutory response deadline.
Encrypted mappings cover every retained analytics and governance domain:
event/source reference, deployment/platform-instance, `actor:v1`, `context:v1`,
`conversation:v1`, `thread:v1`, `turn:v1`, attempt, task/model/tool/coding,
session/materialization, `governance_actor_key`, `collection-eligibility`, and
`delivery-grant` keys.

Generation is storage-only metadata on every physical canonical event/source
version and its generated children. It never appears in `AnalyticsEventV1`,
props, logs, egress, curated model rows, or user-facing BI dimensions; only
operational storage and internal snapshot/publication control metadata may
carry it. One singleton persisted pointer is authoritative:

```text
analytics_active_generation(
  singleton_id PRIMARY KEY CHECK(singleton_id = 1),
  active_generation,
  updated_at_ms
)
```

There is exactly one row and no independent per-reader “current” alias.
Ordinary pseudonymous reads, derivation and materialization, delivery, snapshot
sources, and source reconciliation resolve this pointer and select only
`active_generation`. Shadow and retired rows are invisible to those paths; the
unversioned C0 aggregate store remains separate.
Every snapshot file and `analytics_snapshot_publications` row stores that
generation. Separate partial unique indexes permit at most one staged and one
published row; a rekey-staged row is owned by the current nonterminal run.
The consumer refuses to serve when file, publication, and active generations
do not all match. Startup closes, invalidates, and unlinks any null-owned
ordinary staged artifact left by a pre-promotion crash before remounting the
still-published file; it never promotes an orphan by inference.
Subject-rights denial, deletion, and export are the deliberate exception: they
search every retained active, target-shadow, and retired generation, every
retained encrypted mapping, and `analytics_event_collection_refs`, so a pointer
change can neither hide a subject nor bypass a deny.

1. **Plan:** freeze source high-water marks, verify old/new key availability,
   create the complete one-to-one old→new map, and reject collisions. Once any
   mapping or target/dual-write state is installed, this run can only resume or
   complete; it cannot abort and release the unique run slot.
2. **Dual-write parents:** each newly accepted logical opportunity receives
   one logical disposition. Behind that single idempotency/disposition
   boundary, the writer creates one physical parent in the active generation
   and one with a distinct target-generation event ID. The encrypted run
   mapping pairs those IDs; no stable cross-generation logical ID is persisted
   in canonical storage. The shadow parent does not increment source
   opportunities or dispositions, derive, materialize, snapshot, or enqueue
   delivery. Every retained-version deny remains binding.
3. **Copy and catch up:** in bounded FK-ordered transactions, copy parent
   events/source references first, then sessions/materializations, intent and
   abandonment state, backfill maps, delivery rows, receipts, deletion work,
   and retention state. New event/source uniqueness is checked before each
   child points at the target-shadow parent.
4. **Verify:** prove source uniqueness and the exact active↔shadow equation,
   then verify mapping-normalized parent content, foreign keys, delivery state,
   receipts, materializations, denies, exports, deletion work, and retention
   state at the frozen high-water mark and through the post-high-water delta.
5. **Cut over:** acquire one persisted global cutover fence. It stops new
   admissions and drains every post-high-water mutable child writer:
   intent/abandonment, derive/materializations, backfill, delivery/receipts,
   deletion, retention, and snapshot publication/consumer transitions. While
   the fence remains held, delta-copy those writers to the target, rerun every
   verification, quiesce/close Metabase, checkpoint
   `cutover.snapshot_quiesced`, and only then atomically change the singleton
   pointer and invalidate the published source-generation snapshot. A crash
   after close but before swap leaves the source pointer/publication intact but
   unserved; resume re-drains, re-verifies, and re-closes before swapping. Only
   a committed swap enters `snapshot_republish`.
   The same transaction persists both timestamps. It sets
   `retire_not_before_ms` to `swap_completed_at_ms` plus the greater of the
   configured retained-event horizon and the exact 90-day v1 subject-rights
   lookup horizon.
   A process may resume normal local work only after observing the committed
   pointer; an in-memory cache cannot authorize a swap.
6. **Snapshot transition:** BI remains unavailable after swap. Using only the
   persisted rekey owner's cutover token, build an immutable snapshot whose
   embedded generation equals the new active pointer and insert exactly one
   staged publication owned by that run. Remount/reopen it while quiesced and
   query both generation and snapshot ID against the staged row. Only then
   atomically promote staged→published, resume queries, and unlink the old file.
   Failure or restart leaves the old publication invalidated, the old file
   retained for recovery, and the same rekey run paused at
   `snapshot_republish`.
7. **Remote transition:** pseudonymous egress is paused across cutover. A
   target-shadow row can never deliver early. Request deletion for every old
   remote actor version, confirm and deterministically reconcile those
   deletions, preserve the old delivery rows and independent receipts, and
   only then make still-eligible new-generation rows candidates for resend.
8. **Retire:** remove old local graph rows in FK-safe order only after every
   subject-rights and remote condition clears. Refuse retirement before
   `retire_not_before_ms`, while any denial/export/deletion lookup or active
   deletion target still needs an old generation or mapping, while a
   `staged`/`published` artifact, snapshot file, or open consumer remains bound
   to the source generation, or while local/snapshot/remote verification is
   incomplete. Minimal invalidated publication metadata may remain as
   non-serving audit evidence. Destroy encrypted mappings and retire old keys
   only after all conditions clear.

The durable subphase checkpoints are
`dual_write.identity`, `dual_write.governance`,
`copy_parents.events_sources`, `copy_children.materializations_backfill`,
`copy_children.preferences_collection_grants`,
`copy_children.delivery_deletion`, `verify.local_graph`,
`cutover.fence_drain_delta`, `cutover.snapshot_quiesced`,
`swap.active_generation`,
`snapshot_republish.quiesce_build_switch`, `remote_delete`, `remote_resend`, and
`retire.waiting_horizon`. Identity builders, normalizer, fenced event writer,
preference store, collection store, and delivery-grant store are explicit
dual-write seams. A new actor/context event and preference/ref/grant mutation
after the frozen high-water mark must appear in both versions.

Every subphase is idempotent and resumes from durable state after interruption.
Fixtures interrupt before and after each subphase commit and each cutover
writer drain. They require identical event/source uniqueness, foreign-key
integrity, deliveries/receipts, current preference state, all-generation
denies, subject export/deletion discovery, and final reconciliation. The
active/shadow invariant is exact:

```text
active event count
= target-shadow event count
= count of encrypted run mappings having exactly one active physical parent
   and exactly one target-shadow physical parent

SHA-256(ordered active event IDs)
= SHA-256(ordered target event IDs normalized to active IDs in memory
  through the decrypted run mapping)
```

Hash inputs are length-prefixed. Plaintext mapping pairs and normalized
comparison IDs exist only inside the bounded verifier and never enter
canonical storage, BI, logs, snapshots, or egress. The mapping-normalized
parent/child verification hash is checked separately; the equation cannot be
“balanced” with an overflow or loss bucket. Before the pointer swap, source
reconciliation continues to count active physical parents only, so dual-write
never doubles an opportunity. After the swap, the same equation follows the
newly active generation. An exact-boundary fixture proves retirement is
refused at every millisecond before `retire_not_before_ms`; mappings are
destroyed only after the boundary and all subject-rights, deny,
deletion-target, local, and remote checks pass.

### Compromise rotation

Stop egress immediately, rotate, assess exposure, and accept a cohort epoch
break when a safe rewrite is impossible. Never retain raw identities in
analytics merely to simplify a future rekey.

## 6. Guest policy

Guests are aggregate-only:

- no actor, turn, thread, session, intent, dynamic tool/model, or coding event
  is durably stored;
- increment deployment/platform/context-type daily counters;
- local aggregate may retain exact daily counts;
- external aggregate suppresses a cell below 10 guest turns or below 10
  distinct contexts; because guest actors are not tracked, the stricter
  context rule applies;
- guest-mode adoption is a context-setting metric, not guest retention.

No configuration may make guest behavior longitudinally linkable.

## 7. Rephrase and SMALL_MODEL processing

### Rephrase

After post-auth eligibility, pass raw text through a dedicated in-process
handoff, derive process-keyed lexical 3-shingle features immediately, and
discard the text. Keep at most three feature sets per
`(actor_key,conversation_key)` until resolution, withdrawal, or 30-minute
expiry. Compare only with an unresolved prior set within 10 minutes. The
handoff and its state are separate from normalized analytics queues.

The handoff has exactly three lifecycle operations:

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

The post-auth subscriber calls `captureText`; it must derive features and
discard raw text before returning. The turn-context terminal coordinator calls
`completeTurn` exactly once from the structured terminal result.
`clarification`, `failure`, and `no_action` retain the current feature set as
unresolved. Capture retains at most one process-local `matchedPriorTurnKey`,
pointing to the newest qualifying unresolved prior. `success` removes the
current set and that matched prior, if any; unrelated unresolved sets survive
until their own resolution, withdrawal, or expiry. Cancelled, ineligible,
configuration-only, and unknown terminals map to `discard`, which removes only
the current set. Preference withdrawal calls `withdraw` and removes every
pending or unresolved set for that actor.

`captureText` and `completeTurn` serialize per actor/conversation and reconcile
either callback order. A late terminal for a prior turn may atomically attach
itself only to the newest qualifying later set without a matched prior. Each
pair emits at most once, and no match can resolve an unrelated abandoned goal.
The cap of three applies across pending and unresolved feature sets together.

Persist only the closed event:

```text
detector, similarity, prior_outcome, gap
```

Do not persist or remotely cache the message, shingles, content hash, vector,
or similarity representation. Restart/eviction causes documented undercounting
and is preferable to durable content fingerprints.

### SMALL_MODEL

The optional classifier:

- runs asynchronously after the turn and never delays a reply;
- receives transient text only for an eligible actor and approved processor;
- emits strict primary/goals/confidence enums;
- does not log, cache, or persist its input/output content;
- stores only the controlled `intent_classified` event and cost/latency
  aggregates;
- requires contractual no-training/shortest-input-retention posture;
- stays off unless the frozen benchmark and privacy thresholds in
  [`04-intent-labeling-spike.md`](./04-intent-labeling-spike.md) pass.

No text leaves the process for an ineligible actor.

## 8. Retention

Defaults are maxima and may be configured downward:

| Data                                    |                                                                                                     Default maximum |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------: |
| Transient rephrase text/features        | memory only; raw text discarded immediately, max three feature sets until resolution/withdrawal or 30-minute expiry |
| C1/C2 canonical events and sessions     |                                                                                                       90 days local |
| Pending delivery                        |                                                                       event expiry or 14 days, whichever is earlier |
| Delivery receipts and controlled errors |                                                                                                             30 days |
| Pseudonymous external sink data         |                                                                                                             90 days |
| Thresholded, assessed aggregate rollups |                                                                                                            400 days |
| Minimal preference/policy audit         |                                                             400 days after supersession, subject to operator policy |

Expiry settles and removes delivery rows before events, sessions, and
actor-level feature facts. The delivery-to-event FK is restrictive: pending
work is cancelled, `sending`/ambiguous work is reconciled or deleted, delivered
work receives remote deletion where required, and a minimal independent
receipt is recorded before the delivery row and then its event may disappear.
Aggregate rollups remain only after a contextual anonymization assessment and
small-cell controls.

Expiry is a read/send boundary, not merely a cleanup schedule. Every analytics
query, derivation, snapshot source, export, lease, and immediate send filters
`expires_at <= now`. Runtime startup blocks analytics readers/workers behind an
overdue-expiry purge barrier. Thereafter a dynamic wake schedules the earliest
known expiry (at least once per minute), deletes due rows transactionally, and
reschedules; a daily job may still materialize censoring, but cannot enforce
the storage maximum. Downtime, startup, exact-boundary, concurrent lease, and
clock-advance fixtures must prove that an expired row is never read, published,
or sent.

The `AnalyticsAggregateV1` contract in
[`02-metric-catalog.md`](./02-metric-catalog.md) expires local daily
counters/histograms after 90 days by default. It permits up to 400 days only
for contextually assessed, thresholded rollups. Preference suppression state
follows §4 rather than analytics-event retention.

## 9. Withdrawal, deletion, access, and export

### Withdrawal

Atomically store `deny` before acknowledging the preference. Eligibility is
checked at:

1. pseudonymous writer insert, under the collection ref fence and in the same
   transaction as canonical/event-ref insertion;
2. delivery enqueue;
3. delivery lease;
4. the durable `leased → sending` transition immediately before network I/O.

Withdrawal cancels never-started delivery and, by product default, starts
deletion of pseudonymous product analytics. It does not acknowledge while a
writer-before-deny event remains: pending/leased delivery is cancelled,
`sending` is classified or made ambiguous and reconciled/deleted, delivered
copies are remotely deleted, delivery rows are removed, and only then is the
local event graph removed. An operator relying on another basis must document
any narrower historical treatment; the software does not infer it.
Resolution checks all active, target-shadow, and retained generations plus
every matching `analytics_event_collection_refs` association. A shadow or
retired physical row cannot evade a current deny.

### Access/export

After strong platform/settings authentication, calculate every retained actor
key version from the authenticated platform identity. Search active,
target-shadow, and retired generations, encrypted retained mappings, and event
collection refs. Export that actor's canonical metadata, sessions, preferences,
and delivery receipts in JSON, deduplicating physical generation copies to one
logical event while retaining generation-search evidence in the restricted
subject-rights audit. Never include another group member's event.

For resumable deletion, derive all retained actor, governance actor,
collection-ref, and delivery-grant key versions across active, target-shadow,
and retired generations while authenticated identity is still in scope. Include
the matching event collection-ref targets and seal only that derived set into
an access-restricted, encrypted request bundle. The bundle is excluded from
analytics, BI, snapshots, logs, and egress; it is destroyed only after every
local generation, snapshot, and remote target completes. Native identity is
not retained merely to resume the request.

```text
analytics_deletion_target_bundles(
  deletion_request_id PRIMARY KEY,
  target_ciphertext,
  target_hash,
  created_at,
  destroyed_at
)
```

Analytics is only one data store. A broader controller DSAR must separately
cover operational usage, chat history, memory, and other tables; an analytics
deletion endpoint cannot claim those stores were erased.

### Deletion

- delete every matching actor-key version and event collection-ref association
  from active, target-shadow, and retired generations locally;
- invalidate/rebuild affected sessions, cohorts, and feature materializations;
- settle every delivery before its restrictive event FK can be removed:
  cancel pending/never-started leased rows, never silently delete `sending`,
  reconcile/delete ambiguous or delivered remote copies, write a minimal
  independent receipt, then remove delivery rows;
- call each approved sink's deletion API for all key versions and preserve old
  generation receipts after remote reconciliation;
- recompute or suppress small aggregate cells;
- unpublish every BI snapshot that contains the subject, rebuild a fresh
  allowlisted snapshot, quiesce/close Metabase's file-bound and pooled
  connections, configure/remount/reopen the new immutable snapshot, query its
  new snapshot ID and verify zero old contribution, then delete the invalid
  artifact;
- retain only a minimal deletion audit under operator policy.

If a sink cannot delete every actor key version, pseudonymous egress to it
remains disabled.

Deletion is not acknowledged complete while any published snapshot still
contains a deleted contribution. Snapshot generation always creates a fresh
empty output database and inserts only allowlisted curated/materialized rows
from a transactionally consistent source read (or permission-restricted
staging source). It never copies the live database and drops tables: SQLite
freelist pages can retain dropped bytes. Failed builds are unpublished and
deleted; permission-restricted staging and partial output are cleaned in a
`finally` path after success or failure. A pointer switch alone is not
sufficient because an open Metabase connection can retain the old inode.
Byte-level C3/raw-table canary scans gate publication.

Withdrawal/deletion before a retention day is right-censoring, not churn.

## 10. Delivery architecture and egress gate

The existing `forwarded_at`, `forward_attempts`, and `forward_error` columns
describe one unnamed delivery state. They cannot safely encode multiple sinks,
payload modes/versions, consent changes, leases, deletion, or bounded errors.
Leave them inert/deprecated for product analytics.

Use:

```text
analytics_sinks(
  sink_version_id PK,
  logical_sink_id,
  version,
  kind ENUM,
  state ENUM('pending_verification','enabled','disabled'),
  payload_schema_version,
  egress_mode ENUM('aggregate','pseudonymous'),
  endpoint_ciphertext,
  secret_ciphertext,
  config_fingerprint,
  verified_at,
  created_at,
  disabled_at,
  UNIQUE(logical_sink_id, version)
)

analytics_deliveries(
  event_id FK ON DELETE RESTRICT,
  sink_version_id FK ON DELETE RESTRICT,
  grant_key,
  grant_key_version,
  grant_generation,
  state ENUM(
    'pending','leased','sending','delivered','ambiguous','dead',
    'delete_pending','deleted','cancelled'
  ),
  attempts,
  next_attempt_at,
  lease_until,
  send_started_at,
  last_error_class ENUM,
  delivered_at,
  remote_receipt_hash,
  delete_requested_at,
  deleted_at,
  PRIMARY KEY(event_id, sink_version_id)
)

analytics_delivery_deletion_receipts(
  deletion_request_id,
  sink_version_id FK ON DELETE RESTRICT,
  state,
  remote_receipt_hash,
  requested_at,
  reconciled_at,
  PRIMARY KEY(deletion_request_id, sink_version_id)
)
```

The response body never becomes `last_error`. v1 may allow only one enabled
external sink while preserving correct per-sink state. Immediately before
network I/O the lease owner durably transitions `leased → sending`. Only an
expired lease that never entered `sending` may return to `pending`; an
orphaned/expired `sending` row becomes `ambiguous`, even if the crash occurred
before bytes were sent. `ambiguous` is never retried automatically. A current
owner may classify a response it observed; otherwise an operator resolves the
row only through remote reconciliation or deletion. The independent deletion
receipt contains no event ID, actor key, or target bundle.

Sink provisioning is a write-only admin+CSRF lifecycle:

1. **Create** an encrypted, disabled version and return only logical ID,
   version, state, kind, mode, fingerprint, and timestamps.
2. **Verify** endpoint policy, destination capabilities, a synthetic canary,
   and the strict AND of caller-controlled destination idempotency,
   deterministic reconciliation, and complete per-actor deletion before
   pseudonymous enablement.
3. **Rotate** by creating and verifying a successor, then atomically enabling
   it while soft-disabling the predecessor; a failed verification leaves the
   predecessor active.
4. **Disable** immediately blocks new leases/enqueues but retains the version
   and all ledger evidence.

Secrets/endpoints are decrypted only inside the verifier/transport and are
never returned by a read route, rendered in UI, or logged. A sink version
referenced by a delivery/receipt is never hard-deleted; schema FKs use
`ON DELETE RESTRICT`.

Before enabling any destination, require:

- a fixed operator-approved HTTPS endpoint; no per-context arbitrary URL;
- resolve all addresses, reject any non-public answer, then pin one validated
  public address in the actual connection/custom DNS lookup while preserving
  TLS certificate and SNI verification against the original hostname; an
  ordinary `fetch` re-resolution is forbidden because it reopens DNS rebinding
  TOCTOU;
- no redirects, bounded `p-limit` concurrency, timeouts/backoff,
  request-size cap, and a kill switch;
- encrypted token storage and metadata-only structured logs;
- caller-controlled destination idempotency **and** deterministic
  reconciliation **and** complete per-actor deletion for every retained key
  version; no capability substitutes for another;
- processor/subprocessor, residency, deletion, incident, and transfer review
  where applicable;
- no advertising/model-training secondary use;
- captured-request proof that C3/raw IDs cannot leave;
- aggregate egress preference and separate pseudonymous approval.

External aggregate release follows the exact frozen lattice and deterministic
primary/complementary suppression algorithm in
[`02-metric-catalog.md`](./02-metric-catalog.md); arbitrary dashboard filters
cannot define payloads.

## 11. Threat model

| Threat                     | Example                                                  | Required mitigation                                                                                                                                                                         |
| -------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bus content copied         | generated text, raw tool result/error reaches a sink     | typed adapters, strict props union, C3 canaries, reject unknown                                                                                                                             |
| Cross-instance collision   | native user `123` on two bot instances merges            | platform-instance namespace in every actor/context input                                                                                                                                    |
| Cached-context bleed       | cached tool/provider closure attributes actor B to A     | AI SDK per-execution tools context threaded through every operation/helper/final boundary; overlap tests with cached descriptors/shared MCP pool                                            |
| Scope misparse             | split a modern scoped ID at `:`                          | repository parser truth-table tests; source facts authoritative                                                                                                                             |
| Dictionary attack          | guess common IDs/tool/project names                      | secret HMAC, purpose domains, key outside DB, suppress dynamic strings                                                                                                                      |
| Raw turn correlation       | UUID joins analytics to debug/support export             | analytics-only `turn_key`                                                                                                                                                                   |
| Plugin/property injection  | external name/body presented as metadata                 | generated first-party enum, dynamic HMAC, closed error/status types                                                                                                                         |
| Consent race               | writer or delivery proceeds across withdrawal            | collection ref recheck plus writer/withdraw serialization in the insert transaction; separate delivery grant rechecks at enqueue/lease/send-start and per-grant send/withdraw serialization |
| Guest profiling            | stable guest hash across visits                          | aggregate-only guest policy                                                                                                                                                                 |
| Sink SSRF/exfiltration     | endpoint targets internal network, rebinds, or redirects | encrypted fixed endpoint, reject non-public DNS, pin validated address in transport with hostname TLS verification, redirect refusal, caps/timeouts                                         |
| Credential leakage         | token/remote body stored in delivery error               | encrypted secret, bounded error enum, metadata-first logs                                                                                                                                   |
| Boundary log leakage       | provider path/body/filename re-logged by outer catch     | controlled client errors and pino canaries across URL/path/body/file/SDK/MCP content plus serialized analytics/outbox                                                                       |
| Replay/duplication         | crash before/after remote acceptance                     | durable `leased→sending` before I/O; only never-started lease retries; orphaned sending becomes non-retried ambiguous; strict idempotency plus reconciliation                               |
| Insider singling-out       | “worst user” dashboard                                   | no names/raw IDs, minimum cells, RBAC/audit, stratified random sampling                                                                                                                     |
| High-cardinality inference | exact URL/project/model/tool reveals behavior            | omit content, HMAC dynamic values, controlled enums, thresholds                                                                                                                             |
| Classifier secondary use   | prompt retained/trained by provider                      | eligibility, processor gate, transient async input, persistence audit                                                                                                                       |
| Key compromise             | DB and HMAC key exposed together                         | key outside DB, stop egress, rotation/incident runbook                                                                                                                                      |
| Incomplete deletion        | old key, open snapshot inode, or delivery remains        | encrypted all-version target bundle, restrictive delivery FK, independent receipt, consumer quiesce/reopen verification, remote reconciliation                                              |
| Aggregate differencing     | small daily cell identifies one actor                    | frozen release lattice, deterministic primary/complementary suppression, exhaustive cross-filter fixtures                                                                                   |

## 12. Release-blocking privacy contract

1. **Registry closure:** event names equal props-schema, event catalog,
   metric-source map, and documentation keys.
2. **Strict schema fuzz:** reject extra keys, free-form enums, negative/
   non-finite durations, oversized arrays/strings, and unknown versions.
3. **C3 canaries:** inject unique markers into text, prompts, args/results,
   errors, usernames, files, URLs/hosts, project/status/tag names, RRULE, and
   secrets. Assert none appears in canonical rows, delivery payloads, dead
   letters, pino client/outer-catch logs, provider/MCP error state, or
   screenshots.
4. **Identity matrix:** cross-instance actor differs; same-instance actor
   matches; group siblings share context but differ by thread; two actors in
   one thread get different sessions; Discord gains no fake thread, while one
   Discord actor in two DMs/groups gets two effective conversations/sessions.
   Frozen HMAC byte/digest vectors pass exactly.
   Consecutive/overlapping provider calls through cached tool descriptors and a
   shared MCP pool retain their own per-execution request context.
5. **Raw-ID absence:** generated raw actor/context/task/turn/tool/model/coding
   identifiers are absent byte-for-byte from canonical JSON and captured
   egress.
6. **Semantic outcome:** one post-classification, idempotent
   `tool:analytics_completed` terminal exists for success, thrown failure,
   structured failure, and denial. `execute_end`/`llm:tool_result` are never
   inferred as semantic success; same/next-turn recovery fixtures pass.
7. **Consent matrix:** every mode × basis × preference × role × egress
   combination has an expected store/send/delete result. Consent-unknown and
   guest cases never produce prohibited C1/C2 data.
8. **Withdrawal race:** every local/external pseudonymous writer carries a
   generation-bearing `CollectionEligibilityRef`, rechecked under the
   writer/withdrawal fence in the same transaction as canonical insert and its
   operational association. Deny-before-writer inserts nothing;
   writer-before-deny is deleted before withdrawal acknowledgement. Every
   retained delivery-grant version and generation is checked at enqueue,
   lease, and the durable send-start transition; per-grant serialization
   permits no send after the deny commit/acknowledgement. Collection refs never
   enter canonical or egress payloads.
9. **Outbox/sink:** independent sink-version rows, write-only
   create/verify/rotate/disable, encrypted never-returned secrets,
   restrictive sink and event FKs, bounded attempts, and pinned payload/DNS
   address with hostname TLS verification. `leased → sending` commits before
   I/O; only never-started expired leases retry; orphaned sending and a crash
   after remote acceptance become non-retried `ambiguous`. Pseudonymous
   enablement requires caller-controlled destination idempotency,
   deterministic reconciliation, and complete actor deletion together.
   Independent deletion receipts contain no event/actor target.
10. **Session fixtures:** 29:59, 30:00, 30:00.001, out-of-order, midnight UTC,
    multiple actors/threads, commands, and proactive events.
11. **Cohort/censor fixtures:** exact D1/D7/D30, cumulative-return separation,
    withdrawal censoring, insufficient lookback, deletion/rebuild.
12. **Rephrase persistence audit:** `captureText` discards raw text before
    returning; `completeTurn` maps clarification/failure/no-action to
    unresolved, success to removal of the current set and only its optional
    `matchedPriorTurnKey`, and cancelled/ineligible/configuration-only/unknown
    to current-only discard; unrelated unresolved sets survive. `withdraw`
    removes all actor state. Both terminal-before-capture and
    capture-before-terminal races attach at most one newest qualifying prior
    and emit the pair at most once. At most three pending/unresolved feature
    sets exist, and no text, shingles, stable hashes, vectors, or model output
    enters SQLite/log/cache.
13. **Classifier contract:** strict enum JSON, at most three ordered goals,
    abstention threshold, content-free telemetry, no reply-path await, and an
    idempotent derivation fills every eligible terminal turn missing
    `(turn_key,taxonomy_version)`.
14. **Backfill/provenance/reconciliation:** every source field follows the
    recoverability matrix; no mutable attribution is invented. Durable
    `analytics_process_epochs`, bounded per-epoch/source disposition counters,
    event-to-epoch association, and exact aggregate-to-epoch contribution
    association survive overlap, live races, restart, and rollback. An epoch
    opens before producers and closes only after their queues and counters
    drain. Startup marks stale-open epochs and every intersecting UTC bucket
    `unreconciled_restart_gap`, including already-finalized buckets; clean
    restart, crash-after-finalization, and UTC-boundary crash fixtures pass.
15. **External thresholding:** the frozen UTC-day/one-way release lattice and
    deterministic primary/complementary suppression prevent recovery through
    every total, sibling, forbidden cross-filter, or restart-gap cell.
16. **DSAR/delete/rekey/snapshot:** all key versions are found; local,
    materialized, and published-snapshot contributions are removed before
    acknowledgement through an encrypted restart-safe deletion target bundle.
    Denial, export, and deletion search active, target-shadow, and retired
    generations, retained mappings, and event collection refs; export
    deduplicates physical copies by logical event.
    Delivery settles under its restrictive event FK, keeps only an independent
    minimal receipt, then canonical deletion proceeds. Metabase is
    quiesced/closed, remounted/reopened on the new immutable snapshot, and
    queried for its new ID and zero old contribution before the old file is
    removed. Fresh allowlisted snapshot bytes contain no raw pages and staging
    cleanup runs on success/failure. Physical generations are storage-only and
    exactly one persisted active-generation pointer controls reads, derivation,
    delivery, snapshots, and source reconciliation. Durable rekey dual-write
    seams create one active and one target-shadow parent per logical
    disposition. The global cutover fence drains and delta-catches every mutable
    child writer before an atomic swap; shadow egress remains blocked until old
    remote actor versions are deleted/reconciled. Exact logical count/hash,
    FKs, event/source uniqueness, refs, grants/denies, deletion targets, and
    receipts/deliveries pass. Retirement is rejected before the persisted
    swap-anchored horizon or while any mapping is still needed.
17. **Performance/expiry clocks:** monotonic non-negative values; no-token
    turns are not applicable; live-status denominator is capability-aware.
    Expired rows are filtered everywhere, startup purge is a barrier, and the
    earliest-expiry wake passes downtime and exact-boundary fixtures.

Every failure blocks pseudonymous collection or egress. Controls 1–9, 14–17,
and the aggregate-specific portions of 15 also block aggregate publication.

## 13. Security review checklist

- `bun security` and `bun security:ci` pass on the implementation.
- Manual outbound-fetch review proves DNS answers are validated and the chosen
  public address is pinned in the actual connection while TLS verifies the
  configured hostname; it also covers redirect refusal, timeouts, caps,
  retry/backoff, and secret-bearing headers.
- Logs are pino metadata-first and include no token, raw response, URL, raw ID,
  or payload.
- Settings and admin routes authenticate/authorize collection, egress,
  deletion, and key operations separately.
- Sink credentials use the repository's encrypted-secret conventions and are
  never returned to the client after write; rotation is verify-then-atomic
  switch and ledger-referenced sink versions cannot be deleted.
- Dashboard service accounts are least privilege and read a snapshot, not
  papai's live writable database. The published file is created empty and
  populated only from the curated allowlist; byte-level scans prove it has no
  copied live-database pages.
- Provider services bind privately; public exposure requires TLS, RBAC, and an
  operator deployment review outside this research.

## 14. Sign-off gates

No longitudinal collection starts until:

- source events carry trustworthy platform instance, actor, role, config
  context, thread, and turn correlation;
- the strict normalizer and tests above are reviewed;
- governance setup and actor eligibility are implemented;
- grant-serialized withdrawal, deadline-aware expiry, DSAR, published-snapshot
  deletion, and interruption-resumable rekey paths are exercised;
- dashboards display denominator, censoring, coverage, version, and snapshot
  age;
- an approved synthetic captured request proves no prohibited data can leave.

No SMALL_MODEL text processing or pseudonymous sink starts until its independent
benchmark, processor, retention, deletion, and egress gates also pass.

## 15. Primary privacy sources

- [GDPR consolidated text](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng),
  especially Articles 4–7, 12–17, 20, 25, 28, 30, 32, 35, and 44–49.
- [EDPB Guidelines 4/2019 on Article 25 — data protection by design and by default](https://www.edpb.europa.eu/documents/guideline/guidelines-42019-on-article-25-data-protection-by-design-and-by-default_en).
- [EDPB Guidelines 05/2020 on consent](https://www.edpb.europa.eu/documents/guideline/guidelines-052020-on-consent-under-regulation-2016679_en).
