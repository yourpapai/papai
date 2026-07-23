<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Recommendation: canonical events with rebuildable hierarchical memory

## Decision

The registered component outcome is `adopt-hierarchy`. Operationally, select a
**hierarchical canonical-event/derived-fact design** as the benchmark-winning
representation and advance it as a staged, shadow-mode production architecture
hypothesis. Broad production adoption remains gated by the acceptance work
below.

- Keep short-term working memory bounded and transient.
- Make exactly scoped canonical events the durable evidence source.
- Build facts, summaries, lexical indexes, vectors, and hierarchy as versioned,
  rebuildable projections with leaf-level provenance.
- Use corrected hybrid lexical/dense retrieval inside the hierarchy.
- Do **not** add a temporal graph to the default retrieval path now.
- Independently open a **storage-engine migration evaluation**, while retaining
  the current storage engine until that evaluation justifies a migration.

This is an architecture recommendation, not a claim that the in-memory research
adapter should be shipped as production code. It is based on local E0 results
from the frozen v3 scenario corpus executed under protocol v4 on 2026-07-23.

## Why this is the finite recommendation

The primary decision scale was the sealed 10,000-record-per-scope track. The
1,000-record track was descriptive sensitivity evidence only; its observations
were not pooled into the decision. The 100,000-record track answered the
independent storage/performance question, not the representation question.

| Candidate        | Primary nDCG | Recall |    MRR | Relational/temporal | Weighted score | Universal gates |
| ---------------- | -----------: | -----: | -----: | ------------------: | -------------: | --------------- |
| as-shipped proxy |       0.5233 | 0.5889 | 0.4000 |              0.3155 |     ineligible | erasure failed  |
| corrected hybrid |       0.7595 | 0.8333 | 0.6333 |              0.5000 |          71.48 | all passed      |
| hierarchical     |       0.8385 | 0.9000 | 0.7167 |              0.8155 |          80.24 | all passed      |
| temporal graph   |       0.8016 | 0.9000 | 0.6667 |              0.8155 |          79.36 | all passed      |

The hierarchical candidate passed all registered universal gates: zero
cross-scope hits, zero post-erasure hits, offline/self-hosted operation, and
reproducibility. Its clean-rebuild checks passed in all 12 cases.

Hierarchy also passed the registered **general practical-superiority** path
over corrected hybrid:

- overall nDCG delta: `0.078969`;
- paired scenario-bootstrap 95% interval: `[0.053242, 0.106151]`;
- weighted-score delta: `8.760859` points.

The paired bootstrap used the scenario as its resampling unit, with seed
`20260723` and 10,000 resamples.

The interval excludes zero and the score gain exceeds the registered
two-point threshold. The recommendation does not rely on the separate
hierarchy-special long-horizon path: long-horizon nDCG delta was `0.000000`,
with interval `[0.000000, 0.000000]`. The evidence supports hierarchy because
of its broad retrieval improvement, not because this experiment proved a
special long-horizon advantage.

The active-record proxy is not an acceptable component target despite its
lower retrieval latency. It returned six erased records and was therefore
ineligible under the safety-first protocol. Because it does not execute the
whole deployed memory subsystem, this result is not evidence that production
papai returned those records or that every shipped behavior should be replaced.

## Why a temporal graph is not justified now

The graph was evaluated as a derived projection against the strongest eligible
non-graph candidate, hierarchy. It failed three required graph-gate criteria:

| Graph-gate criterion           | Observed graph versus hierarchy | Registered requirement | Result           |
| ------------------------------ | ------------------------------: | ---------------------: | ---------------- |
| Relational/temporal nDCG delta |                      `0.000000` |        at least `0.05` | fail             |
| Delta 95% interval             |          `[0.000000, 0.000000]` |  lower bound above `0` | fail             |
| Ingest cost per attempt        |                       `1.7277×` |         at most `1.5×` | fail             |
| Retrieval p95                  |                       `0.6069×` |           at most `2×` | pass             |
| Calls per attempt              |                       `1.0000×` |         at most `1.5×` | pass with caveat |
| Stored bytes                   |                       `1.5189×` |           at most `3×` | pass             |
| Weighted-score loss            |                `-0.8877` points |     no worse than `-2` | pass             |
| Rebuildable projection         |                    12/12 checks |               required | pass             |

The graph was faster on retrieval in this adapter, stayed within the registered
storage ratio, and was rebuildable. Those facts do not offset the missing
relation-quality gain and excessive ingest cost because the protocol required
every graph criterion to pass.

The call-cost ratio needs a strong caveat: both candidates made zero model or
extractor calls because the synthetic graph relations were explicit fixtures.
The `1.0000×` ratio therefore says nothing about the cost or accuracy of
extracting a graph from real conversations.

A graph may be reconsidered later only as a feature-gated, rebuildable
projection for demonstrably relation-heavy workloads. Re-entry requires real
relation extraction, end-to-end answer evaluation, a graph-only quality gain
that passes the same gate, and measured ingestion and operating costs. A graph
must never become the only copy of evidence.

## Proposed production architecture

The stable center is a canonical, scoped evidence log. Everything optimized for
recall or context compression is replaceable:

```text
bounded working context
          |
          v
canonical scoped events + durable erasure state
          |
          +--> atomic facts --------+
          +--> session/topic summary |--> filtered hybrid ranking
          +--> lexical index --------+         |
          +--> vector index ---------+         v
          +--> optional graph (off)       bounded evidence context
```

### 1. Bounded working memory

Keep the recent exact turns and tool request/result pairs needed for the active
task, plus a token-budgeted rolling summary. Treat this context as transient
and potentially untrusted. It must not silently become the durable evidence
source, and compaction must not grant information a wider scope.

### 2. Canonical durable events

Write a canonical event before deriving memory from it. The production schema
should carry, at minimum:

- stable event and idempotency identities;
- storage/config/thread scope and authorization audience;
- subject, actor, source platform, and provenance;
- event time and ingest time;
- half-open validity and supersession information;
- trust, retention, and erasure state;
- content identity plus schema and capture versions.

Canonical writes and a durable projection outbox should commit atomically.
Projection workers may be at-least-once, but must be idempotent, checkpointed,
observable, and repairable. A failed extractor or embedder must leave canonical
evidence intact and a visible retry/repair item; it must not make the event
silently disappear.

### 3. Derived facts and hierarchy

Extract atomic facts and construct session/topic summaries as versioned
projections. Preserve contradictions and temporal changes instead of
destructively replacing history. Close validity intervals or add a newer fact
when knowledge changes.

Every fact and summary must link to its canonical source events. Retrieval may
rank a summary, but context assembly should return supporting leaf evidence so
the model and operator can inspect provenance. A summary or embedding must
never be the sole surviving evidence copy.

### 4. Hybrid retrieval with hard pre-filters

Apply authorization, exact scope, validity, trust, retention, and erasure
filters before ranking. Then:

1. gather lexical and compatible dense candidates;
2. preserve lexical recall when embeddings are absent, stale, or incompatible;
3. fuse results with deterministic tie-breaking and temporal rules;
4. retrieve across facts, sessions, and topics;
5. deduplicate while retaining the best canonical evidence;
6. assemble a bounded context with provenance;
7. abstain or ask for clarification when evidence is insufficient.

This keeps vector search useful without making vectors authoritative. Embedding
availability is an optimization, not a precondition for recalling valid
evidence.

### 5. Typed prospective and procedural memory

Reminders, deferred actions, user preferences, and learned procedures should
remain typed records with explicit lifecycle and authorization rules. Similarity
retrieval may help find them, but it must not authorize or execute an action.
Current tool and task permissions remain the authority.

### 6. Erasure as a cross-projection invariant

Persist a scope/evidence/subject tombstone before cleanup so a delayed worker
cannot recapture forgotten content. Then remove canonical content and every
retrieval path required by policy, including facts, summaries, lexical/vector
indexes, graphs, caches, queues, and replicas. Verify completion and replay
erasure state after restore or rebuild.

Logs, WAL, backups, and disaster-recovery copies require explicit retention and
later-erasure policies; deleting a live row alone is not proof of completed
erasure.

### 7. Replaceable, versioned projections

Record schema, tokenizer, embedding, extractor, summarizer, and index versions.
Support two versions side by side, deterministic clean rebuilds, shadow
comparison, atomic cutover, and rollback. Keep storage-adapter contracts
separate from the event/fact model so a future engine change does not redefine
memory semantics.

## Storage decision: evaluate, do not migrate yet

For hierarchy at 100,000 records per scope:

- pooled nearest-rank retrieval p95 was `184.9256 ms`, below the registered
  `250 ms` threshold;
- maximum incremental RSS was `1,509,146,624` bytes (`1.406 GiB`), exceeding
  the registered `1 GiB` threshold by `435,404,800` bytes, or about `40.6%`;
- all four locale/scope cells completed with 100,000 records, one warmup, and
  25 measured retrievals in fresh workers.

The RSS crossing triggers `open-migration-evaluation` under the protocol. It
does **not** establish that SQLite is inadequate or that another database will
fix the problem. The research candidates materialized Maps and arrays in one
process; they were not production SQLite layouts. Full-scope materialization,
projection duplication, and adapter structure may account for substantial
memory use.

The separate evaluation should first profile and reduce avoidable memory:

- stream or batch ingestion and projection rebuilds;
- avoid full-scope in-memory materialization;
- compact projection state and bound caches;
- use disk-backed indexes and prepared queries;
- measure allocation and retained-heap sources.

Then compare optimized SQLite with plausible alternative engines using the
same hierarchical semantics and frozen correctness workload. Do not preselect
a vendor. Require:

- cold, warm, concurrent, and saturated p95/p99 latency;
- ingest throughput, backpressure, RSS, disk amplification, and cost;
- transaction, crash, corruption, repair, and idempotent replay behavior;
- hard erasure across indexes, WAL, replicas, and restored backups;
- backfill, dual-write, cutover, rollback, and version-migration procedures;
- operational burden, observability, backup/restore, RPO, and RTO.

Keep the current engine until one candidate passes these gates and demonstrates
a reversible migration. Storage choice remains independent of representation
quality.

## Rollout recipe

### Phase 0: production acceptance harness

Freeze production-shaped, privacy-reviewed scenarios before implementation.
Add multilingual, multi-party, tool-result, contradiction, long-horizon,
missing-embedding, duplicate, out-of-order, and adversarial-erasure cases.
Define answer-level as well as retrieval-level success criteria.

### Phase 1: canonical capture in shadow mode

Introduce the canonical event, tombstone, outbox, and version contracts. Dual
capture without changing answers. Compare event counts, scopes, payload hashes,
lag, failures, and erasure state against the current path.

### Phase 2: rebuildable hybrid foundation

Backfill Unicode lexical and compatible dense projections, run clean rebuilds,
and shadow corrected-hybrid retrieval. Require stable ordered results, source
provenance, bounded context, no scope leakage, no post-erasure recall, and no
unexplained projection drift.

### Phase 3: hierarchical projection

Add versioned facts and session/topic summaries only after real extraction,
leaf-provenance resolution, and context-usefulness checks pass. Shadow-compare
hierarchical retrieval with the corrected-hybrid foundation and retain an
immediate switch back to hybrid-only retrieval.

### Phase 4: reader evaluation and canary

Evaluate real extraction and reader answer quality separately from the
deterministic component score. Canary the hierarchy per context or tenant with
a fast switch back to the existing answer path. Keep canonical capture and
repair tooling reversible throughout.

### Phase 5: controlled expansion

Expand only after safety, correctness, latency, resource, rebuild, and
operational SLOs hold under production concurrency. Track retrieval usefulness,
unsupported-answer rate, evidence citations, projection lag, queue saturation,
repair backlog, erasure completion, and rollback readiness.

Temporal graph retrieval remains off through these phases. Run the storage
evaluation in parallel, but migrate only through its own reviewed decision and
rollback plan.

## Acceptance gates before broad production use

The architecture is not production-proven until it passes all of the following:

- **Scope:** zero unauthorized personal, group, thread, tenant, or guest hits.
- **Erasure:** zero hits after completed erasure across canonical and every
  derivative path, including after restore and rebuild.
- **Provenance:** every injected derivative resolves to authorized canonical
  leaf evidence.
- **Capture:** duplicate and out-of-order delivery is idempotent and
  deterministic.
- **Races:** forget-versus-ingest and update-versus-rebuild interleavings fail
  closed.
- **Crash recovery:** crashes between canonical commit and projection work
  recover through durable replay without silent loss or duplicate meaning.
- **Reproducibility:** clean rebuilds produce stable, version-identified
  retrieval behavior.
- **Migration:** schema, tokenizer, embedding, and extractor upgrades support
  shadow comparison, atomic cutover, and rollback.
- **Backup/restore:** restored data replays later erasures and meets declared
  RPO/RTO.
- **Load:** cold/warm concurrent p95 and p99, saturation, bounded queues,
  resource ceilings, and repair backlog meet production SLOs.
- **Reader quality:** answer-level evaluation checks faithful use of retrieved
  evidence, abstention, contradiction handling, and citation quality.

## Future-proofing rules

- Stabilize canonical event, scope, provenance, and erasure contracts; allow
  storage and indexes to change behind them.
- Treat facts, lexical/vector indexes, summaries, hierarchy, and graph state as
  disposable, versioned projections with explicit schemas.
- Preserve raw authorized evidence long enough for audit and rebuild, subject
  to retention and erasure policy.
- Make mixed-version behavior explicit; never silently compare incompatible
  embeddings or extraction schemas.
- Prefer outcome gates over database, vector-store, or graph-vendor claims.
- Keep graph optional and off by default until it adds verified unique value.
- Re-run the frozen component suite after semantic changes, but keep public,
  reader, production-traffic, and operations tracks separately reported.

## Evidence boundaries and limitations

These limitations are decision-relevant, not footnotes:

- Embeddings were deterministic synthetic functions, not learned production
  embeddings.
- The frozen corpus was synthetic and is not production conversation traffic.
- Component retrieval scores do not establish final answer quality.
- No live LLM extractor, reader, or judge was run.
- Explicit graph fixtures do not validate real relation extraction quality or
  cost.
- Group namespaces did not test speaker-conditioned multi-party belief
  tracking.
- The single-process scale track did not test poisoning, concurrent
  durability, deferred-action correctness, or million-token reader use.
- Crash recovery, migration, backup/restore, and sustained production load
  were not run.
- The 100,000-record adapters used in-memory collections, so their RSS result
  cannot identify a production database as the cause.
- Artifact id `as-shipped` was an active-record retrieval/injection proxy; it
  did not execute working memory, capture/extraction, provisional promotion,
  production SQLite/FTS, maintenance, or exact production authorization.
- Context assembly relevance was not scored; only retrieval hits were scored.
- The as-shipped and corrected-hybrid 100,000-record storage decisions were
  blocked by retrieval correctness/status validation in all four cells; their
  measured resource values are not valid storage-selection outcomes.
- Standalone decision-sidecar validation checks internal closure but does not
  independently recompute bootstrap intervals from the hashed component
  artifacts.

LongMemEval, LoCoMo, MemoryAgentBench, and MemBench were not supplied locally,
and their official protocols remain `not_run`. No public benchmark score may be
claimed from this work:

| Dataset          | Import status | Official protocol |
| ---------------- | ------------- | ----------------- |
| LongMemEval      | not supplied  | `not_run`         |
| LoCoMo           | not supplied  | `not_run`         |
| MemoryAgentBench | not supplied  | `not_run`         |
| MemBench         | not supplied  | `not_run`         |

## Evidence record

- [Frozen protocol](00-protocol.md)
- [Current-state audit](01-current-state-audit.md)
- [Technique taxonomy](02-technique-taxonomy.md)
- [Validated results](04-results.md)
- [ADR](adr-proposal.md)
- [Reproduction guide](REPRODUCING.md)
- [Raw decision analysis](raw/v4-20260723/decision-analysis.json)

The frozen evidence identities are:

- scenario manifest SHA-256:
  `283044dbd97c119b5b76a639f4f28792e4ff12cc0bdc73e6a81761b083bb12f7`;
- selection SHA-256:
  `f33c032f5fba2a870e9261041204bd4713860c25bdc738c5bfeff3e04d6623a2`;
- primary sealed artifact SHA-256:
  `dfd3fc615612403ae01c841a97677042bc454ebdd6d4a9a19021d40c015fcad3`;
- sensitivity sealed artifact SHA-256:
  `d27da0668b078303f8a4d4b577bc5a69344eea27e8d161b98b48ead8e898e7ce`;
- 100,000-record storage artifact SHA-256:
  `9f92a8ff5eced928575535efa3a208c4c00f2fef964a0196fcd364d9731da555`;
- decision-analysis artifact SHA-256:
  `ff6d19eef4e617fed9880a1d5ecaa6643d4634ce6fc5ca4752f8fd61d964de7d`;
- executed implementation SHA-256:
  `540ebcdd75ca9cb77fae3b18d52033cc5af32f04eabe8dd7a5515e2d6d6891cf`.
