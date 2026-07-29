<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Agent memory failure catalog

Status: local E0 observations from protocol v4 over the frozen
`memory-scenario-manifest-v3` component and storage artifacts, plus explicitly
unexecuted risks from the registered protocol.

## How to read this catalog

An **observed failure** below is directly present in a frozen artifact. A
**blocked** decision means the required evidence was invalid or incomplete; it
is not a latency or RSS pass. An **unexecuted risk** is a production-relevant
question that this study did not test and must not be presented as a failure
that was reproduced locally.

The 10,000-record sealed run is the primary representation-decision scale.
The 1,000-record sealed run is sensitivity evidence. The 100,000-record run is
an independent performance/storage analysis over four fixed graph cells.
Counts repeated at multiple scales are repeated measurements of the same
frozen scenarios, not additional unique failures.

| Evidence role             | Artifact                                                                     | Principal fields used here                                                      |
| ------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Development check         | [`dev-1000/component.json`](raw/v4-20260723/dev-1000/component.json)         | `candidates[].aggregate`, `failures`, `workers`                                 |
| Sealed sensitivity        | [`sealed-1000/component.json`](raw/v4-20260723/sealed-1000/component.json)   | `candidates[].aggregate`, `failures`, `workers`                                 |
| Sealed primary            | [`sealed-10000/component.json`](raw/v4-20260723/sealed-10000/component.json) | `candidates[].aggregate`, `gates`, `scenarios`, `failures`, `workers`           |
| Frozen storage            | [`storage-100000/storage.json`](raw/v4-20260723/storage-100000/storage.json) | `candidates[].jobs`, `candidates[].decision`                                    |
| Cross-scale decision      | [`decision-analysis.json`](raw/v4-20260723/decision-analysis.json)           | `candidates`, `pairedComparisons`, `graphGate`, `limitations`, `publicDatasets` |
| Registered interpretation | [`00-protocol.md`](00-protocol.md)                                           | safety gates, graph gate, storage decision, future acceptance checks            |

Selector notation such as `candidates[as-shipped]` below means the array member
whose candidate identifier is `as-shipped`; it is not a numeric JSON index.

Protocol-v3 artifacts remain preserved but are superseded: a post-execution
review found evaluator labels crossing the candidate boundary, a repairable
raw-hit envelope, and an overstated baseline label. Protocol v4 kept the
corpus, algorithms, weights, and gates fixed, closed those validity defects,
and re-executed every track. V3 and v4 results are not pooled.

## Observed failures

| ID   | Observed failure                                                                                              | Decision effect                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| F-01 | The `as-shipped` active-record proxy returned six erased evidence items in the primary sealed run.            | Erasure-safety gate failed; the proxy was ineligible for a weighted score.                     |
| F-02 | `as-shipped` and `corrected-hybrid` failed correctness/status validation in all four frozen 100k graph cells. | Their storage decisions were blocked; no keep/migrate inference is valid for either candidate. |
| F-03 | Successful `hierarchical` and `temporal-graph` 100k runs exceeded the 1 GiB incremental-RSS threshold.        | Both opened a separate storage-migration evaluation.                                           |
| F-04 | `temporal-graph` failed three registered graph-gate criteria against `hierarchical`.                          | The representation decision remained `adopt-hierarchy`; adding the graph was not justified.    |

### F-01 — active-record proxy erasure safety failed

The primary sealed 10k artifact records
`candidates[as-shipped].aggregate.erasedHitCount = 6`,
`gates.erasure.state = "fail"`, and no query execution failures or timeouts.
The decision sidecar consequently records
`candidates[as-shipped].gates.erasureSafety = "fail"` and
`weightedScore.status = "ineligible"`.

Each affected query returned exactly one evidence id that its
`query.erasedEvidenceIds` declared erased:

| Scenario                   | Query                      | Erased hits |
| -------------------------- | -------------------------- | ----------: |
| `scenario-group-en-025`    | `query-group-en-025-01`    |           1 |
| `scenario-group-en-039`    | `query-group-en-039-01`    |           1 |
| `scenario-group-en-053`    | `query-group-en-053-01`    |           1 |
| `scenario-personal-en-025` | `query-personal-en-025-01` |           1 |
| `scenario-personal-en-039` | `query-personal-en-039-01` |           1 |
| `scenario-personal-en-053` | `query-personal-en-053-01` |           1 |

The sealed 1k sensitivity artifact records the same six affected queries and
the same aggregate count. The development 1k artifact records two erased hits.
These are repeated-scale observations, not fourteen distinct erased records.

This is a semantic safety failure in the active-record proxy, not a worker
exception or a measured production incident. The proxy does not execute
capture, promotion, production SQLite, maintenance, or the full deployed
authorization path. The primary
artifact also records 180 successful query results, `failureCount = 0`,
`timeoutCount = 0`, an empty `failures` array, and 180 completed workers for
`as-shipped`.

**Trace:** primary
[`component.json`](raw/v4-20260723/sealed-10000/component.json) at
`candidates[registration.id=as-shipped].aggregate.erasedHitCount`,
`.gates.erasure`, and
`.scenarios[].queries[].diagnostics.erasedHitCount`; sensitivity
[`component.json`](raw/v4-20260723/sealed-1000/component.json) at the same
fields; development
[`component.json`](raw/v4-20260723/dev-1000/component.json) at
`.aggregate.erasedHitCount`; decision
[`decision-analysis.json`](raw/v4-20260723/decision-analysis.json) at
`candidates[candidateId=as-shipped].gates` and `.weightedScore`.

### F-02 — two candidates were validation-blocked at 100k

All four `as-shipped` jobs and all four `corrected-hybrid` jobs have
`run.status = "failure"` with the exact reason:

> Warmup or measured retrieval failed correctness/status validation

The failures cover the complete frozen storage selection:

- `scenario-personal-en-022`
- `scenario-personal-ru-022`
- `scenario-group-en-022`
- `scenario-group-ru-022`

This was not a failure to create the workload or collect samples. Each of the
eight jobs records 100,000 primary-scope rows, zero rows outside that scope,
one warmup, 25 measured latencies, 26 candidate retrievals, and a distinct
fresh-worker pid. The frozen artifact does not retain raw hit IDs or per-query
statuses for these jobs, so it cannot distinguish a correctness mismatch from
a non-success retrieval status within the combined validation failure.

Both candidate-level decisions are therefore `status = "blocked"` with all
four cells listed under `errors`. Their measured latency and RSS values must
not be used to label SQLite as keep or migrate for those candidates because
the protocol says a failed 100k cell blocks that decision.

**Trace:** frozen
[`storage.json`](raw/v4-20260723/storage-100000/storage.json) at
`candidates[candidateId=as-shipped|corrected-hybrid].jobs[].run`,
`.jobs[].resources`, `.jobs[].failure`, and `.decision`; protocol
[`00-protocol.md`](00-protocol.md), “Storage decision.”

### F-03 — successful 100k representations crossed the RSS threshold

The registered threshold is 1,073,741,824 bytes of maximum current
incremental RSS across the four cells. Both candidates with four successful
storage cells crossed it while remaining below the 250 ms pooled-p95 latency
threshold:

| Candidate        | Successful cells |    Pooled p95 | Maximum incremental RSS | Approx. GiB | Trigger |
| ---------------- | ---------------: | ------------: | ----------------------: | ----------: | ------- |
| `hierarchical`   |              4/4 | 184.925625 ms |     1,509,146,624 bytes |       1.406 | RSS     |
| `temporal-graph` |              4/4 | 105.618916 ms |     1,165,803,520 bytes |       1.086 | RSS     |

The selected representation is `hierarchical`, so its independent storage
outcome is `open-migration-evaluation`. This does not establish that SQLite
must be replaced: no alternative storage engine was evaluated in this study.
It establishes that the registered threshold was crossed and a separate
comparison is required.

The storage artifact also records absolute process-peak RSS as a diagnostic.
The decision correctly uses `run.incrementalRssBytes`, not that absolute peak.

**Trace:** frozen
[`storage.json`](raw/v4-20260723/storage-100000/storage.json) at
`candidates[candidateId=hierarchical|temporal-graph].jobs[].run`,
`.decision.pooledP95Ms`, and `.decision.maxIncrementalRssBytes`; decision
[`decision-analysis.json`](raw/v4-20260723/decision-analysis.json) at
`selectedStorageDecision`; protocol [`00-protocol.md`](00-protocol.md),
“Storage decision.”

### F-04 — the temporal graph did not pass its adoption gate

The graph was compared with the strongest eligible non-graph candidate,
`hierarchical`. The decision artifact records exactly three failed criteria:

| Failed criterion                 |           Observed |                     Required |
| -------------------------------- | -----------------: | ---------------------------: |
| Relational/temporal delta        |             0.0000 |             At least +0.0500 |
| Paired 95% interval              |   [0.0000, 0.0000] | Lower bound strictly above 0 |
| Ingest cost per attempted record | 1.7277× comparator |                 At most 1.5× |

Both candidates had a primary relational/temporal composite of
`0.8154648767857289`; the paired
`temporal-graph − hierarchical` interval was exactly `[0, 0]`. The graph's
retrieval-p95 ratio (`0.6069`), call-cost ratio (`1.0000`), and stored-byte
ratio (`1.5189`) remained inside their registered limits. Its weighted score
was `79.3567`, versus `80.2443` for hierarchy, a loss of about `0.8877`
points. Those passing criteria do not override the three mandatory failures.

**Trace:** decision
[`decision-analysis.json`](raw/v4-20260723/decision-analysis.json) at
`graphGate`, `pairedComparisons[statistic=relational-temporal-ndcg]`, and
`candidates[candidateId=hierarchical|temporal-graph]`; protocol
[`00-protocol.md`](00-protocol.md), “Additional graph gate.”

## Execution health: no worker failures or timeouts

The observed failures above should not be attributed to runner instability.
Across the three component artifacts, every candidate-scenario worker
completed and every resource record was measured:

| Component run   | Worker records | Non-completed workers | Missing resource records | Failure rows | Query failures | Query timeouts |
| --------------- | -------------: | --------------------: | -----------------------: | -----------: | -------------: | -------------: |
| Development, 1k |            240 |                     0 |                        0 |            0 |              0 |              0 |
| Sealed, 1k      |            720 |                     0 |                        0 |            0 |              0 |              0 |
| Sealed, 10k     |            720 |                     0 |                        0 |            0 |              0 |              0 |
| **Total**       |      **1,680** |                 **0** |                    **0** |        **0** |          **0** |          **0** |

The storage artifact contains 16 fresh jobs with 16 distinct worker pids.
Eight jobs succeeded. The other eight are the F-02 validation failures; all
have the same combined correctness/status message, and none reports a query
timeout, worker deadline, malformed output, or process-exit failure.

This clean execution record supports interpreting F-01 through F-04 as
component semantics or registered decision-threshold failures. It does not
substitute for the unexecuted concurrency, crash, and sustained-load tests
below.

**Trace:** the three component artifacts at
`candidates[].workers[].status`, `.workers[].resourceStatus`,
`.failures`, `.aggregate.failureCount`, and `.aggregate.timeoutCount`; frozen
[`storage.json`](raw/v4-20260723/storage-100000/storage.json) at
`candidates[].jobs[].workerPid`, `.run.status`, and `.failure`.

## Unexecuted and remaining risks

The items in this section are **not locally reproduced failures**. They remain
acceptance work or external evidence gaps and must not be blended into the
frozen component score.

### Security, trust, and durable erasure

- Memory poisoning, malicious-but-authorized writes, stored instructions,
  trust-label propagation, and recapture amplification were not tested.
- The erasure slice checks live retrieval and non-recapture. It does not prove
  deletion from canonical rows, FTS indexes, vectors, summaries, graph
  projections, caches, logs, SQLite WAL files, restored backups, or external
  replicas.
- Concurrent forget-versus-ingest and cross-scope races were not executed.
  Sequential duplicate/out-of-order fixtures do not establish race safety.
- Promotion or replay of remembered content into later actions, evaluator
  error, quarantine, and authorization-aware tool use were not evaluated.

**Trace:** [`00-protocol.md`](00-protocol.md), “Evidence-v2 future
extensions” and “Future security and operational acceptance”; decision
[`decision-analysis.json`](raw/v4-20260723/decision-analysis.json) at
`limitations`.

### Crash, migration, backup, and load behavior

- No interruption was injected between canonical and derivative writes, so
  crash atomicity, idempotent replay, and deterministic repair remain
  unproven.
- Schema, embedding, tokenizer, extractor, and graph-version migration and
  rollback were not run.
- Backup restore, replay of later erasures, corruption detection, rebuild
  duration, tolerated data loss, and recovery-point behavior were not tested.
- Cold/warm concurrent tail latency, saturation, bounded queues, failure
  counters, and repair backlog were not measured. The 100k evidence is a
  serial, fresh-worker workload.
- The RSS crossing opens a storage-engine evaluation; it is not a comparison
  of SQLite with a vector database, graph database, or another relational
  engine.

**Trace:** [`00-protocol.md`](00-protocol.md), “Future security and
operational acceptance” and “Storage decision”; decision
[`decision-analysis.json`](raw/v4-20260723/decision-analysis.json) at
`selectedStorageDecision` and `limitations`.

### Representation and end-to-end validity

- Deterministic bilingual embeddings are not learned production embeddings,
  and the synthetic corpus is not production conversation traffic.
- Artifact id `as-shipped` is an active-record proxy, not the deployed memory
  subsystem; capture/extraction, provisional promotion, working memory,
  production SQLite/FTS, and exact deployed authorization were not executed.
- Retrieval-component metrics do not establish final answer quality. No live
  LLM reader or judge ran.
- Context assembly completed within its bound, but assembled-context relevance
  was not scored.
- Explicit fixture relations test graph projection and traversal, not entity
  extraction, link prediction, path faithfulness, or graph verbalization on
  natural conversations.
- Group namespaces test scope isolation, not speaker-conditioned beliefs,
  concurrent beliefs, reply/thread preservation, or asker-relative meaning.
- Record-count scaling does not establish million-token reader utilization.
  Deferred intentions, external cue monitoring, and prospective execution
  were also outside the frozen track.

**Trace:** [`00-protocol.md`](00-protocol.md), “Evidence-v2 future
extensions” and “Run validity and reporting”; decision
[`decision-analysis.json`](raw/v4-20260723/decision-analysis.json) at
`limitations`.

### Public benchmarks were not run

| Dataset          | Import status  | Official protocol | Consequence                                     |
| ---------------- | -------------- | ----------------- | ----------------------------------------------- |
| LoCoMo           | `not_supplied` | `not_run`         | No local result or transferred published score. |
| LongMemEval      | `not_supplied` | `not_run`         | No local result or transferred published score. |
| MemBench         | `not_supplied` | `not_run`         | No local result or transferred published score. |
| MemoryAgentBench | `not_supplied` | `not_run`         | No local result or transferred published score. |

No claim in this catalog transfers a score from a paper, repository, or
vendor report. Running one of these later requires its pinned local artifact,
official reader/judge protocol, prompts, model configuration, retrieval depth,
raw outputs, and a separately labeled result.

**Trace:** primary
[`component.json`](raw/v4-20260723/sealed-10000/component.json) at
`publicDatasets`; decision
[`decision-analysis.json`](raw/v4-20260723/decision-analysis.json) at
`publicDatasets`; protocol [`00-protocol.md`](00-protocol.md), “Evidence
policy.”

### Analysis-artifact closure

The standalone decision sidecar validates its own internal closure but does
not independently recompute bootstrap intervals from the hashed component
artifacts. The component artifacts, their hashes, the sidecar, and the
documented reproduction path must therefore remain together for audit.

**Trace:** decision
[`decision-analysis.json`](raw/v4-20260723/decision-analysis.json) at
`artifacts` and `limitations`.
