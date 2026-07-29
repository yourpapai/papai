<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Memory Production Roadmap

**Status:** the sole active forward-looking memory roadmap as of 2026-07-26.

**Decision basis:** [`docs/research/agent-memory/06-recommendation.md`](../../research/agent-memory/06-recommendation.md)
selects a canonical-event architecture with rebuildable hierarchical projections. It explicitly
rejects temporal-graph retrieval for the default path. The sealed retrieval result is a synthetic
component result, not proof of reader answer quality or production operations.

## Already delivered — do not re-plan or re-implement

- Corrected hybrid retrieval: Unicode FTS5 lexical recall, embedding-version-gated dense recall,
  deterministic RRF fusion, query-time validity/expiry, and embedding backfill.
- Live-store erasure safeguards: tombstones, physical record purge, non-recapture, profile/summary
  invalidation, content-twin sweep, and five-channel regression coverage.
- Automatic record injection is opt-in and defaults off.
- P1 shadow logging is content-free, sampled, off-hot-path, and disabled by default. It measures
  whether a reader model calls `search_memory`; it does not measure answer quality.

The completed plans retain their execution history and reconciliation logs. They are not active
work queues.

## Explicitly deferred

- **Temporal vector graph:** do not implement. The registered graph gate failed on unique
  relational/temporal quality and ingest cost.
- **Automatic query-aware injection / Tier 3:** do not implement or enable by default. It requires
  an approved P1 collection, the pre-registered screen, then P2 reader/abstention evidence.
- **Storage migration or ANN:** do not choose an engine or add an index merely because the current
  dense channel scans in scope. First profile the production-shaped SQLite path and compare
  candidates under the research’s migration gates.
- **Hierarchy before evidence:** do not add facts, summaries, or graph projections as authoritative
  state before canonical events, provenance, erasure, and replay contracts exist.

## Remaining sequence

### Gate 0: Freeze production acceptance contract

Create a privacy-reviewed, production-shaped acceptance harness before changing the memory
representation. It must include multilingual, multi-party, tool-result, contradiction,
long-horizon, missing-embedding, duplicate/out-of-order, adversarial-erasure, and abstention
cases. Define both retrieval and answer-level success criteria, scope-isolation checks, and the
retention/erasure boundary for legacy conversation history and `memory_facts`.

**Exit:** the scenarios, expected outcomes, and pass/fail gates are versioned before canonical
capture code is written.

**Status (2026-07-29):** the contract is versioned and executable —
`docs/superpowers/specs/2026-07-29-memory-gate0-acceptance-harness-design.md`,
`tests/long-term-memory/acceptance/`, `bun run memory:acceptance`. Four criteria and five
scenario shapes are implemented; seven criteria and four shapes are declared with named blockers.
Each unmet criterion's pass predicate must be authored in its own follow-on spec before its
implementation begins. Gate 1 may begin.

### Gate 1: Canonical capture in dark mode

Introduce exactly scoped canonical events, durable tombstones, provenance, version identities, and
an atomic projection outbox. Dual-capture without changing reader answers. Projection work must be
idempotent, checkpointed, observable, and repairable; failed work may not silently lose the
canonical evidence.

**Exit:** capture counts, scopes, payload identities, lag, failures, and erasure state reconcile
with the current path; forget-versus-ingest and crash/replay tests fail closed.

### Gate 2: Rebuildable hybrid projections

Rebuild lexical and dense projections from canonical events, retaining the delivered hybrid logic
as the baseline. Run clean rebuilds and shadow comparisons; preserve source provenance and a
bounded evidence context. Profile SQLite’s real query, memory, cache, and rebuild behavior before
opening a storage-engine implementation plan.

**Exit:** stable ordered results, no scope leakage or post-erasure recall, explainable projection
drift, and measured production-shaped resource behavior.

### Gate 3: Hierarchical projection experiment

Only after Gates 0–2 pass, add versioned atomic facts and session/topic summaries as rebuildable
projections. Every injected derivative must resolve to authorized canonical leaf evidence. Compare
hierarchical retrieval with hybrid-only in shadow mode and retain an immediate hybrid-only switch.

**Exit:** hierarchy adds a pre-registered, reproducible benefit without safety, provenance,
latency, or repair regressions.

### Gate 4: Reader quality and delivery decision

If an approved deployment enables P1 collection, evaluate the per-reader-model funnel at its
pre-registered N/M threshold. The corrected P1 metric is a screening signal only. Build P2 only
when that screen says to; P2 compares tool-pull, no-pull, and any cache-safe automatic-delivery
candidate on answer faithfulness, abstention, contradiction handling, citations, latency, and
cache impact.

**Exit:** automatic delivery remains off unless P2 demonstrates a benefit and no abstention or
cache regression. If the P1 screen fails, shelve Tier 3 rather than tuning toward a desired result.

### Gate 5: Canary and controlled expansion

Canary any accepted hierarchy/delivery change per context or tenant with immediate rollback to the
current answer path. Expand only while safety, correctness, operational SLOs, repair backlog,
erasure completion, and rollback readiness remain within declared bounds.

## Execution rule

Each gate needs its own approved design and implementation plan. Do not start a later gate from
this roadmap alone, and do not reactivate a completed historical plan. Update this roadmap and
`docs/research/agent-memory/implementation-status.md` after each gate’s evidence is reviewed.
