<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Analytics validation and product/UX review ritual

**Status:** proposed operating contract; begins only after implementation
**Purpose:** keep collection, models, dashboards, privacy controls, and product
decisions auditable after the initial build

Analytics is accepted only when source facts, canonical rows, derived models,
and displayed numbers reconcile. A visually plausible dashboard is not
evidence of correctness.

## 1. Evidence layers

Every release and review period records five distinct counts:

```text
eligible source opportunities
  → adapter accepted / rejected
    → canonical unique events or aggregate updates
      → derived model rows
        → dashboard result
          → per-sink delivered/reconciled rows, when egress is enabled
```

Each arrow has a named inclusion rule. No reviewer closes a discrepancy by
changing a filter until the source population and definition version are
written down.

## 2. Release qualification

### 2.1 Static contract

- event names, property schemas, metric-source map, intent taxonomy, and
  documentation registries have identical versioned keys;
- strict decoders reject unknown event/property/version/enum values, nested
  data, non-finite/negative durations, oversized arrays, and free-form strings;
- every RQ1–RQ8 formula in
  [`02-metric-catalog.md`](./02-metric-catalog.md) has an explicit producer,
  denominator, terminal observation, not-applicable rule, and censoring rule;
- aggregate-local and pseudonymous event contracts are distinct types and
  stores; no conversion silently invents actor continuity;
- published SQLite snapshots start as fresh empty files and receive only
  allowlisted curated/materialized rows from a consistent source read; binary
  scans find no raw-table schema, freelist page, C3 canary, grant, preference,
  secret, or canonical props bytes; permission-restricted staging and partial
  output are cleaned in `finally` after success and failure;
- snapshot deletion tests quiesce/close Metabase connections, remount/reopen
  the new immutable file, query its new snapshot ID and zero old contribution,
  and only then remove the old file; pointer-only replacement fails;
- every read/snapshot/lease/send enforces `expires_at > now`, startup purge is
  a barrier, and the dynamic earliest-expiry wake passes downtime/boundary
  fixtures;
- the implementation diff contains no runtime collection path outside the
  registered adapters and closed aggregate producers.

### 2.2 Privacy and identity

Run the complete blocking contract from
[`03-privacy-consent-threat-model.md`](./03-privacy-consent-threat-model.md),
including:

- C3 canaries through source, canonical store, aggregate store, logs,
  delivery capture, failure paths, exports, and rendered artifacts;
- same/different platform-instance actor matrix, group sibling threads,
  two actors in one thread, Discord no-fake-thread plus one Discord actor
  separated across two DMs/groups, explicit `thread:v1` old→new mapping,
  frozen HMAC byte/digest vectors, and aggregate-only guest cases;
- raw native actor/context/task/turn/tool/model/coding identifiers absent
  byte-for-byte from all analytics surfaces;
- mode × basis × preference × role × sink eligibility matrix;
- generation-bearing collection refs on every local/external pseudonymous
  writer, with exact-generation recheck and event association in the insert
  transaction; deny-before-writer inserts nothing and writer-before-deny is
  deleted before withdrawal acknowledgement;
- enqueue/lease/durable-send-start delivery-grant races, pending cancellation,
  remote deletion, all retained key versions, restrictive event FKs, minimal
  independent receipts, and interruption-resumable verified rekey;
- write-only sink create/verify/rotate/disable, address-pinned SSRF transport,
  durable `leased → sending`, non-retried ambiguous acknowledgement, and
  preserved ledger evidence;
- encrypted restart/rekey-safe deletion target bundles; storage-only physical
  generations; one persisted active-generation pointer; active-only reads,
  derivation, delivery, snapshots, and source reconciliation; a database
  partial-unique invariant allowing only one nonterminal rekey run;
  post-high-water active+target-shadow parent dual writes under one logical
  disposition; generation-bearing snapshot files/publications with at most one
  staged and one published pointer and rekey-run ownership on the staged row;
  explicit cutover drain/delta/snapshot-republish checkpoints; and refusal of
  early mapping retirement;
- external frozen-lattice primary/complementary suppression plus exhaustive
  total/sibling/cross-filter differencing attempts;
- exact rephrase `captureText`/`completeTurn`/`withdraw` lifecycle, one
  newest qualifying `matchedPriorTurnKey`, both callback orders, unrelated-goal
  survival, and no message, shingles, hashes, embeddings, cached model response,
  or raw provider error;
- full per-execution provider context propagation through cached tool
  descriptors, operation/resource helpers, and final HTTP/MCP boundaries, with
  captured pino canaries for paths, bodies, filenames, and outer errors;
- strict external-pseudonymous sink AND gate: caller-controlled destination
  idempotency, deterministic reconciliation, and complete per-actor deletion.

Any failure blocks pseudonymous collection or egress. Aggregate-only release is
also blocked by a C3, schema-closure, raw-ID, or guest-continuity failure.

### 2.3 Behavioral fixtures

The golden fixture includes, at minimum:

- duplicate source IDs and a crash/retry boundary;
- durable closed and stale-open process epochs with bounded source
  dispositions, event associations, and aggregate contribution deltas; include
  clean restart, crash after an already-finalized bucket, and crash across UTC
  midnight;
- 5–10% intentionally out-of-order source rows;
- session gaps of 29:59.999, exactly 30:00.000, and 30:00.001;
- two actors in one group thread, one actor in sibling threads, and one Discord
  actor in two distinct DMs/groups;
- first-DM activation with preconfigured, never-opened, failed, successful,
  ineligible, and right-censored paths;
- exact D1, D7, and D30 return plus a separate “returned by D30” case;
- SDK-successful structured tool failure, thrown failure, immediate success,
  same-turn recovery, next-turn recovery, engaged unresolved, abandonment,
  and censoring;
- one post-classification tool terminal per idempotent source ID, with
  `execute_end` and `llm:tool_result` explicitly ignored by analytics;
- LLM start/completed/failed/aged-open attempts joined by `attempt_key`;
- supported, disabled, failed, missing, and unsupported first-feedback/live-
  status paths;
- feature available/unavailable actor-days followed by success, failure, and
  no use;
- every I01–I23 label, abstention, conflicting evidence, and three-goal limit;
- an eligible terminal turn whose inline intent hint is dropped, then recovered
  once by the scheduled missing-output derivation;
- authorized command-only first-DM, `/config`, and coding-session activity
  through the production command wrapper;
- overlapping provider/MCP operations with distinct authoritative request
  contexts through cached descriptors/shared pools, plus captured-log canaries
  at nested client/resource/outer-catch boundaries;
- collection deny-before-writer and writer-before-deny races for every retained
  key version, proving respectively no insert and deletion before
  acknowledgement;
- delivery crashes before durable send-start, after `sending` but before the
  call, and after remote acceptance, proving only the never-started lease
  retries and both uncertain cases become non-retried `ambiguous`;
- rephrase terminal-before-capture and capture-before-terminal ordering,
  clarification/failure/no-action retention, matched and unmatched success,
  unrelated unresolved-goal survival, discard, withdrawal, and the combined
  three-set cap;
- deletion restart/rekey overlap across multiple key versions, including
  destruction of the encrypted target bundle only after local/snapshot/remote
  completion;
- a post-high-water logical event that creates exactly one active and one
  target-shadow physical parent without double-counting its source disposition;
  before swap, every ordinary read, derivation, delivery candidate, snapshot,
  and source reconciliation sees only the active parent;
- concurrent post-high-water intent/abandonment, derive/materialization,
  backfill, delivery/receipt, deletion, and retention mutations at the cutover
  boundary; the global fence blocks the pointer swap until all writers drain,
  their deltas reach the target, and count/hash plus child-state verification
  pass;
- denial, authenticated export, and deletion during dual-write and after swap,
  proving discovery through active, target-shadow, retired generations,
  retained mappings, and event collection refs, with one logical export row;
- target-shadow delivery remains impossible and egress stays paused through
  swap; old remote actor versions delete and reconcile before an eligible
  new-generation resend, while old receipts remain;
- concurrent rekey plan/apply attempts fail while one run is
  `planned|running|paused`; only a pristine plan-phase abort with no
  mapping/target/dual-write state or a completed run permits the next. From the
  first dual-write mutation onward, every failure resumes the same nonterminal
  run;
- `swap_completed_at_ms` and `retire_not_before_ms` survive restart; attempts
  one millisecond before the boundary fail, and mapping/key retirement succeeds
  only at or after the greater of the configured retained-event horizon and
  the exact 90-day v1 subject-rights lookup horizon, when every
  subject-rights/local/snapshot/remote dependency is clear;
- snapshot staging cleanup on success/failure; generation-bearing publication;
  and Metabase quiesce/close/remount/reopen verification against both the new
  snapshot ID and active generation. A restart after close/before swap retains
  the matching source pointer/publication but keeps it unserved, re-drains and
  re-closes, and never enters `snapshot_republish` early. After swap, the rekey
  owner verifies against exactly one staged target row, atomically promotes
  staged→published, and only then resumes BI. Restart there keeps BI unavailable
  during the intentional zero-published interval, and an old open inode blocks
  source-generation retirement;
- ordinary snapshot crashes after staged-row/file creation or during remount
  close, invalidate, and unlink the null-owned orphan on startup without
  promoting it; the old published row remains authoritative until an atomic
  staged→published transition succeeds;
- feature-opportunity retry, restart, and concurrent first-write uniqueness;
- historical usage rows covering every recoverability-matrix branch and a new
  direct embedding/distillation row after the initial high-water;
- each of the seven Friction Signature bits independently and all seven
  together.

The committed PoC fixture under [`poc/fixture/`](./poc/fixture/) proves the SQL
semantics only. Production tests regenerate equivalent boundary fixtures
through public adapter interfaces; they never copy PoC generator internals
into runtime code.

### 2.4 Runtime verification commands

The implementation pull request runs, in order:

```bash
bun build:client
bun test tests/analytics tests/settings
bun test:client
bun run typecheck
bun run lint
bun security
bun run test
bun test:stories:contracts
bun test:stories
```

Run provider-real suites only when the implementation touches their adapters:

```bash
bun test:e2e
```

The exact targeted paths may be split as the implementation plan lands, but
the full commands above are the release evidence. No flaky-test retry converts
a failure into a pass.

## 3. Count reconciliation

### 3.1 Source to canonical

For every durable `analytics_process_epochs.state='closed'` epoch, source
family, intersected UTC day, and the singleton persisted active generation:

```text
eligible source opportunities
= active-generation canonical unique rows associated by process_epoch_id
  + normalization rejected
  + ineligible/not-collected
  + aggregate-lane only
  + exact controlled overflow

aggregate cell delta
= sum exact analytics_aggregate_epoch_contributions
```

The left side and non-canonical terms come from bounded
`analytics_epoch_source_counters(epoch_id,utc_day,source_family,disposition)`;
canonical events carry storage-only epoch and physical-generation associations,
and aggregate mutations carry exact closed-dimension contribution deltas.
Target-shadow and retired physical parents are excluded: creating a shadow does
not create a second opportunity or disposition. All terms are controlled
counts. A difference other than zero is unexplained.

The epoch opens before every producer and closes only after producer ingress,
writers, and disposition/contribution counters drain. On startup, each prior
open epoch becomes stale and every UTC bucket intersecting its
start-to-startup lifetime or recorded contribution is marked
`unreconciled_restart_gap`, including an already-finalized bucket. An in-memory
queue crash can lose work before a durable counter, so stale-open windows
receive no balancing loss count and cannot satisfy the equation. No raw
durable source-fact journal is added merely to close the arithmetic. Clean
restart, crash-after-finalization, and UTC-boundary crash are required fixtures.

The reconciliation report includes:

- source adapter/version and app version;
- process epoch IDs, state/start/close/stale markers, and
  `complete_epoch|unreconciled_restart_gap` status;
- per-epoch/source/day opportunity and disposition counters, canonical event
  associations, and aggregate contribution deltas;
- live versus backfill provenance;
- unique source IDs and duplicate attempts;
- accepted, rejected-by-reason, ineligible, expired, and late rows;
- coverage for platform, role, context, task-provider, and turn correlation;
- maximum and p95 ingest lag;
- oldest/newest source and canonical occurrence times.

`llm_usage_events` and `tool_call_events` provide independent checks:

- main `llm_started` terminal counts reconcile to usage rows after accounting
  for aged-open attempts and direct embedding/distillation writers;
- executed `tool_started`/`tool_completed` pairs reconcile to usage tool rows
  after structured failure semantics and explicit exclusions;
- backfill source mapping is one-to-one and rerunning it changes zero rows.

The acceptable unexplained difference is exactly zero for closed epochs.
Quantified exclusions may be non-zero only when named, versioned, and backed by
a controlled counter. Open/stale-open and restart-gap windows remain visibly
unreconciled until they expire; they never become zero-delta evidence.

### 3.2 Rekey physical-generation conservation

For a planned rekey, let `A` be the ordered active event IDs and let `S` be the
target-shadow event IDs normalized to their active counterparts in memory
through the decrypted run mapping, over the frozen high-water plus the fully
drained post-high-water delta:

```text
count(A)
= count(S)
= count(
     encrypted run mappings with exactly one active physical parent
     and exactly one target-shadow physical parent
   )

SHA-256(encode(A))
= SHA-256(encode(S))
```

Hash inputs are length-prefixed, and no stable cross-generation logical ID is
persisted in canonical storage. No rejection, overflow, or loss bucket may
balance this equation. A separate mapping-normalized hash covers parent
payloads and every mutable child class: intent/abandonment,
derive/materializations, backfill, delivery/receipts, deletion, and retention.
The database must reject a second `planned|running|paused` rekey run. The global
cutover fence must quiesce and drain those writers plus snapshot
publication/consumer transitions, delta-catch the target, and pass both hashes,
FK/source uniqueness, all-generation deny/subject-rights discovery, and
delivery conservation before one transaction may update the singleton
active-generation pointer, invalidate the source-generation publication, and
persist `swap_completed_at_ms` plus `retire_not_before_ms`.

Before that transaction, all ordinary readers and producers use `A`; after it,
they use the former `S`. Target-shadow egress is always zero. Pseudonymous
egress remains paused until every old remote actor version is deleted and
reconciled; only then may eligible new-generation rows resend, and old receipts
remain immutable evidence. BI stays quiesced until a newly built snapshot's
embedded generation, published row, and active pointer all equal `S`; restart
cannot republish `A`. Retirement verification refuses every time before the
greater of the retained-event horizon and exact 90-day v1 subject-rights
lookup horizon, or while an export, deny, deletion target, retained generation,
event collection ref, source-generation `staged`/`published` artifact,
snapshot file/open consumer, or local/snapshot/remote check still depends on
the mapping. Minimal invalidated publication metadata may remain as
non-serving audit evidence.

### 3.3 Canonical to models

Each saved model ships a small executable assertion query. Required invariants:

- one `outcome.v1` terminal/censored row per mature goal attempt;
- one `sessionization.v1` assignment per eligible actor activity event;
- no guest actor/session/intent/feature row;
- no activation milestone outside its 7/14-day window or before its
  predecessor;
- exact-day retention excludes actors unobservable through day N;
- one feature-opportunity row per actor/feature/UTC day;
- a feature adopter denominator contains only `available=true` actors;
- Friction Signature count is the sum of seven binary bits and stays 0–7;
- LLM terminal rows never exceed starts and aged-open is reported separately;
- percentile inputs exclude failure/not-applicable cases but report their
  counts.

For a new or changed model, two reviewers hand-calculate at least five golden
actors/sessions and every rare terminal category from raw **synthetic
canonical metadata**, not transcripts.

### 3.4 Models to dashboards

For every card:

- card title names the population and definition when ambiguity is possible;
- numerator, denominator, unknown/censored count, coverage, definition
  version, UTC window, and snapshot timestamp are visible;
- totals match the saved model with the same filters;
- zero, null, censored, and not-applicable have different display states;
- percentages hide below denominator 30; external actor segments suppress
  below 10;
- dashboard filters cannot recover a suppressed adjacent cell;
- sampled exports contain no raw `props_json`, C1 keys, or C3 strings;
- an empty/late snapshot shows a freshness warning instead of stale certainty.
- deletion never acknowledges completion on a pointer change alone. Metabase
  queries are quiesced, file-bound/pooled connections close, the new immutable
  path is configured/remounted/reopened, and a query proves the new snapshot ID
  plus zero deleted-subject contribution before the old file is removed.

Metabase product users query curated saved models, not raw JSON. OpenPanel or
another event product never becomes authoritative for papai sessions,
percentiles, deletion state, or a definition it cannot express exactly.

## 4. Delivery and remote reconciliation

For each enabled sink version and payload version:

```text
eligible canonical rows
= pending + leased + sending + delivered + ambiguous + dead
  + delete_pending + deleted + cancelled
```

Verify:

- one delivery row per `(event_id, sink_version_id)`;
- no send after acknowledgement or withdrawal;
- `leased → sending` commits immediately before network I/O; only an expired
  never-started lease returns to retry;
- orphaned/expired `sending` and a crash after remote acceptance become
  distinct `ambiguous`, never retry automatically, and require remote
  reconciliation/operator resolution; the current owner may classify a known
  response;
- crash fixtures immediately before send-start, immediately after send-start,
  and immediately after remote acceptance conserve rows without replay;
- attempts and backoff are bounded; error values are controlled enums;
- captured request has only the mapped allowlist and contains the canonical
  diagnostic ID where supported;
- source, captured-request, remote-export, and delivered-ledger counts agree
  under the destination's documented deduplication semantics;
- event and sink FKs are `ON DELETE RESTRICT`; `sending` is never silently
  removed, and delivery settles before canonical deletion;
- actor deletion removes every key version and produces an independent minimal
  receipt containing only deletion-request/sink IDs, controlled state, receipt
  hash, and time—no event, actor, target, or remote body;
- sink disable/rotation retains every historical sink version and ledger row;
  no FK cascade can erase evidence.

The pseudonymous gate is a strict AND: supported complete per-actor deletion,
caller-controlled destination idempotency, and deterministic reconciliation
must all pass. A successful PoC ingestion or one strong capability does not
override a failed peer gate.

## 5. Rollout monitoring

### Stage A — code present, collection off

Run fixtures, schema fuzzing, C3 canaries, backfill dry-run, dashboard model
tests, and deletion/rekey drills. No actor event is written.

### Stage B — aggregate-local

Enable C0 daily counters/histograms only. For two complete UTC weeks, review:

- normalization rejection and restart-gap status;
- volume/latency reconciliation with operational usage;
- storage growth and expiry;
- snapshot duration and papai writer impact;
- dashboard freshness and query p95.

Any C3/raw-ID/guest-continuity finding returns to Stage A.
An `unreconciled_restart_gap` day is suppressed and does not count toward the
two-week requirement; Stage B exit requires two consecutive complete UTC weeks
whose contributing process epochs all close cleanly with zero unexplained
delta.

### Stage C — local pseudonymous pilot

After governance sign-off, enable for explicit test actors or one controlled
installation. For at least two review cycles validate:

- eligibility coverage and withdrawal latency;
- sessions, activation, outcome, intent coverage, and censoring by hand;
- 90-day expiry and one complete access/export/delete exercise;
- collection writer/withdrawal races, encrypted resumable deletion targets,
  restrictive delivery settlement, startup purge barrier, earliest-expiry
  wake, and Metabase close/remount/reopen verification before deletion
  acknowledgement;
- HMAC key backup, compromise stop, and planned-rekey drill;
- no material reply-path latency or unbounded queue growth.

### Stage D — optional external aggregate

Release only assessed cells from the frozen UTC-day/one-way lattice after
deterministic primary and complementary suppression. Repeat exhaustive
differencing and destination capture tests; no restart-gap cell is eligible.

### Stage E — optional external pseudonymous

Requires actor allow plus a sink passing caller-controlled destination
idempotency **and** deterministic reconciliation **and** complete per-actor
deletion. Start with one sink, a daily cap, an immediate kill switch, and a
verified deletion canary. Reconcile every day for the first two weeks, then
weekly.

## 6. Recurring product/UX ritual

### Weekly, 45 minutes

Participants: product/UX owner, engineering owner, and privacy/security owner
when a gate or new segment is discussed.

1. **Data health, 5 minutes:** freshness, reconciliation, rejects, eligibility
   coverage, censored share, denominator suppression, and open incidents.
2. **Activation/outcomes, 10 minutes:** largest funnel drop, success/recovery/
   abandonment shifts with counts and intervals, split by approved dimensions.
3. **Friction/performance, 10 minutes:** seven separate friction components,
   long-turn and feedback distributions, error clusters, app-version changes.
4. **Scenarios/adoption, 10 minutes:** intent coverage/abstention, goal mix,
   feature opportunity versus use, and retention association labeled
   non-causal.
5. **Decision log, 10 minutes:** choose at most two questions to investigate;
   record owner, hypothesis, success signal, guardrail, and review date.

The meeting does not browse or request transcripts. When qualitative research
is needed, recruit separately with an appropriate notice/consent process.

### Metadata-only friction sampling

Friction Signature is a triage tool, not a user or employee ranking. To avoid
selecting only long or unusually active sessions:

1. restrict to mature, eligible sessions with complete detector coverage;
2. partition by turn-count decile, platform, context type, and app version;
3. within each stratum, randomly sample a fixed number from signatures 0–1,
   2–3, and 4–7;
4. inspect only typed event timelines: durations, controlled intents/outcomes,
   seven friction bits, tool/domain enums, error classes, and censoring;
5. write a product hypothesis, never an identity label or claim about user
   sentiment;
6. delete the temporary sample at meeting end and retain only aggregate
   decisions.

No actor key is displayed to the product/UX role. An engineer may receive a
short-lived opaque case token only when investigating a reproducible product
defect under audited access.

### Monthly, 60 minutes

- review metric/model version changes and dashboard inventory;
- retire cards with no decision owner;
- verify retention/expiry jobs and storage trend;
- exercise one withdrawal/delete canary and one dashboard C3 export canary;
- review SMALL_MODEL status—default answer remains off unless new frozen
  evidence and processor approval exist;
- review sink support/version changes and re-run any affected hard gate;
- document whether SQLite snapshot/query p95 still meets the defined SLO
  before considering another warehouse.

### Quarterly

- privacy/security review of purposes, modes, keys, RBAC, processor/residency,
  and aggregate anonymization assessment;
- restore HMAC-key backup in an isolated environment and perform a planned
  rekey rehearsal;
- full DSAR/access/export/delete test across local and every approved sink;
- two-reviewer audit of a stratified sample of source adapters and dashboard
  formulas;
- review intent taxonomy only through a new-version proposal—never mutate v1.

## 7. Decision and incident records

Each review produces a content-free record:

```text
period, data_snapshot_id, model_versions, coverage,
question, hypothesis, metric_and_guardrail, owner, due_date,
decision, follow_up, privacy_or_quality_gate
```

An incident record includes affected definition versions, dates, modes,
sinks, exposure class, containment, deletion/rebuild actions, and
reconciliation proof. It never copies an unsafe payload.

Pause pseudonymous collection/egress immediately for:

- any C3 or raw-ID persistence/egress;
- cross-instance identity collision or guest continuity;
- writer-after-deny, send-after-withdrawal, orphaned `sending` replay, or
  incomplete sink deletion;
- deletion acknowledgement while a target bundle, restricted delivery row, or
  old open snapshot inode remains;
- a second nonterminal rekey run or any served snapshot whose embedded,
  published, and active storage generations differ;
- unexplained reconciliation difference;
- key compromise or unaudited sink/endpoint change;
- a schema version accepted without registry closure.

Resume only after affected rows/materializations are deleted or rebuilt, the
blocking test is added, and the same evidence chain passes end to end.

Separately, an `unreconciled_restart_gap` pauses publication and every external
release for its affected windows and prevents them from counting as rollout
evidence. It does not become an invented numeric loss term.
