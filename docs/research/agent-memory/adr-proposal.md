<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR: Canonical events with rebuildable hierarchical memory

## Status

Accepted — reviewed 2026-07-23.

Acceptance covers the research decision only: hierarchy is the selected target
representation, the temporal graph stays off the default retrieval path, and
storage engine choice is evaluated separately from representation quality.

Acceptance does **not** authorize production rollout. Implementation remains
gated by the acceptance criteria in this record and must proceed through the
staged, shadow-mode phases in the [recommendation](06-recommendation.md).

Date: 2026-07-23

## Context

Papai needs durable memory that remains useful across long-running
conversations without weakening exact scope isolation, erasure, auditability,
or recovery. The shipped long-term path has useful SQLite/FTS foundations, but
the source audit found competing capture paths, incomplete embeddings,
semantic-or-lexical fallback, ASCII-only lexical fallback, recency-based
injection, an O(N) vector scan, missing embedding-version identity, incomplete
erasure, and process-local scheduling.

Protocol v4's frozen local experiment compared four representations on the
same 180 sealed scenarios at 1,000 and 10,000 records per scope, followed by a
separate four-cell 100,000-record storage track. The primary result was:

- active-record proxy (artifact id `as-shipped`): ineligible because the
  erasure safety gate failed;
- corrected hybrid: 71.48 weighted points;
- hierarchical: 80.24 weighted points;
- temporal graph: 79.36 weighted points.

Hierarchy improved primary nDCG over corrected hybrid by `0.07897`, with a
paired scenario-bootstrap 95% interval `[0.05324, 0.10615]`. The graph produced
no relational/temporal improvement over hierarchy and failed its graph gate on
relational delta, interval, and ingest cost. Hierarchy's 100,000-record pooled
p95 was `184.93 ms`, but its maximum incremental RSS was `1,509,146,624` bytes,
above the registered 1 GiB threshold.

These are deterministic retrieval-component results. They do not establish
live answer quality, real extraction quality, concurrent durability, or
official public-benchmark performance. The active-record proxy did not execute
working memory, capture/extraction, provisional promotion, production
SQLite/FTS, maintenance, or exact deployed authorization, so its failures and
resource values are not measurements of the whole production subsystem.
Context assembly was checked only for bounded completion; its relevance and
the reader's use of the assembled context were not scored.

## Decision drivers

- Exact personal/group/thread authorization must precede retrieval.
- Completed erasure must remove canonical and derived retrieval paths and block
  stale recapture.
- Evidence, provenance, validity, and model/index versions must be auditable.
- Derived state must be reproducible from a canonical source.
- Missing or incompatible embeddings must not make records invisible.
- Short-term context must stay bounded and must not silently become the durable
  source of truth.
- Representation and storage-engine choices must remain separable.
- Additional graph complexity requires measured benefit, not architectural
  fashion.

## Considered options

### Retain the active-record behavior represented by the proxy

Rejected as the component target. It was the simplest and fastest adapter, but
failed the sealed erasure gate, missed unembedded evidence, and scored `0.5233`
nDCG at the primary scale. This narrow result cannot adjudicate every shipped
production behavior; the broader source audit remains the evidence for those
paths.

### Repair hybrid retrieval only

Viable fallback and first implementation layer. Unicode lexical+dense fusion,
validity windows, version metadata, exact scopes, tombstones, and hard erasure
fixed the proxy-observed erasure and missing-embedding failures and reached
`0.7595` nDCG. Its four
100,000-record cells failed the registered combined correctness/status
validation, so its storage decision was blocked.

### Add rebuildable hierarchy over canonical events

Selected as the benchmark-winning representation and staged architecture
hypothesis. Session/topic summaries and derived facts improved overall evidence
ranking while retaining canonical leaf citations, deterministic rebuild, exact
scope isolation, and hard erasure. It passed every universal gate and the
registered superiority rule. Production adoption still requires the acceptance
criteria in this proposal.

### Add a temporal graph by default

Rejected for now. The graph tied hierarchy on the relational/temporal
composite, lost `0.89` weighted points overall, and used `1.728×` hierarchy's
ingest cost per attempted record. Its graph gate therefore failed even though
retrieval p95 and stored-byte ratios were within their limits.

## Decision

Advance this layered memory architecture through shadow-mode validation:

1. Keep bounded conversation history and cumulative summaries as working
   memory, with explicit token budgets and low-trust prompt boundaries.
2. Make append-oriented, immutable, exactly scoped events the durable
   long-term evidence source. Record subject, actor/provenance, event and ingest
   time, half-open validity, content hash, extraction version, and embedding
   version.
3. Build Unicode lexical and version-compatible dense indexes as replaceable
   projections. Fuse their results deterministically; never make vector
   availability a prerequisite for recall.
4. Build scoped facts plus session/topic hierarchy as rebuildable projections.
   Every returned derivative must cite canonical leaf evidence.
5. Apply erasure as a durable scope/evidence/subject tombstone followed by
   synchronous canonical and index removal, recapture prevention, and
   asynchronous verified cleanup of summaries, caches, logs, WAL/backups, and
   other derivatives according to policy.
6. Do not add temporal graph traversal to the default path. Reconsider only
   after real extraction and end-to-end evaluation passes the registered graph
   gate.
7. Open a separate storage-engine evaluation. Do not infer a database choice
   from representation quality and do not migrate solely from this component
   benchmark.

## Consequences

### Positive

- Canonical evidence, facts, summaries, lexical indexes, vectors, and future
  graphs have explicit ownership and rebuild boundaries.
- Scope, validity, erasure, and provenance become data-model invariants instead
  of prompt conventions.
- The hierarchy candidate improved overall synthetic retrieval without making
  summaries the only evidence copy; this suite did not show a special
  long-horizon gain.
- Embedding, tokenizer, extractor, and schema migrations can rebuild new
  projections beside old ones and switch atomically.
- Graph and storage decisions remain reversible and evidence-gated.

### Negative

- The hierarchical research adapter stored more bytes than the active-record
  proxy; production storage amplification remains unmeasured.
- Capture, compaction, erasure, and rebuild need durable queues and
  idempotency, replacing process-local timers.
- Hierarchy raises implementation and operational complexity relative to
  corrected hybrid alone.
- The selected representation exceeded the registered 100,000-record RSS
  threshold in the research implementation.

### Risks and mitigations

- **Synthetic overfitting:** keep corpus logic isolated from production and
  require shadow traffic plus public/end-to-end evaluations before promotion.
- **Incorrect extraction:** preserve canonical evidence, version every
  derivative, expose citations, and support deterministic reprocessing.
- **Erasure races:** serialize per-scope mutations, persist tombstones before
  derivative work, and test forget-versus-ingest interleavings.
- **Projection drift:** store checkpoints and content/version identities,
  compare live results with clean rebuilds, and fail closed on mixed versions.
- **Storage pressure:** evaluate indexed SQLite improvements and alternative
  engines with identical correctness, migration, rollback, and cost tests.

## Implementation constraints

Production work should proceed in independently reviewable stages:

1. unify capture behind one canonical event and tombstone pipeline;
2. add versioned Unicode hybrid indexes and exact validity filtering;
3. add hierarchical derived facts/summaries with leaf provenance;
4. add deterministic rebuild, shadow comparison, and observability;
5. validate crash atomicity, race behavior, backup restore, and comprehensive
   erasure;
6. run a separate storage bake-off using the selected representation.

No stage may weaken current task/tool authorization or expose group memory to a
guest merely because data exists in a shared namespace.

## Acceptance criteria

- zero unauthorized-scope and post-erasure hits under deterministic and
  concurrent fault suites;
- stable ordered retrieval before restart and after clean rebuild;
- successful migration and rollback across schema/index/model versions;
- canonical-to-derivative provenance for every injected memory item;
- bounded context assembly and explicit abstention;
- tested crash recovery, replay, backup restore, later-erasure replay, and
  repair backlog;
- live reader/answer evaluation and official public protocols reported
  separately from component retrieval;
- storage selection based on the same winning representation and production
  concurrency envelope.

## Evidence and related records

- [Protocol](00-protocol.md)
- [Current-state audit](01-current-state-audit.md)
- [Technique taxonomy](02-technique-taxonomy.md)
- [Validated results](04-results.md)
- [Failure catalog](05-failure-catalog.md)
- [Recommendation](06-recommendation.md)
- [Reproduction guide](REPRODUCING.md)
- Decision sidecar:
  `raw/v4-20260723/decision-analysis.json` (`ff6d19eef4e617fed9880a1d5ecaa6643d4634ce6fc5ca4752f8fd61d964de7d`)
