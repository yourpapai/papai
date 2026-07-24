<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Agent memory research

This directory is the evidence and experiment record for comparing an
active-record retrieval/injection proxy, a corrected hybrid, hierarchical
event/fact memory, and a temporal vector-graph projection. The production audit
is broader than the proxy and must be read separately.

The foundation is deliberately separated from benchmark results:

- [Research protocol](00-protocol.md) freezes questions, evidence rules,
  metrics, weights, safety gates, and decision thresholds before experiments.
- [Current-state audit](01-current-state-audit.md) describes behavior verified
  from source at commit `eab9ed2b4e2dac0279d338436b59c3a89d87bc8a`.
- [Technique taxonomy](02-technique-taxonomy.md) separates memory roles,
  implementation families, lifecycle obligations, and storage engines.
- [Benchmark and corpus](03-benchmark-and-corpus.md) describes the frozen
  synthetic suite, candidates, scale tracks, and artifact identities.
- [Validated results](04-results.md) presents the registered component,
  bootstrap, graph-gate, and storage outcomes.
- [Failure catalog](05-failure-catalog.md) separates observed failures from
  risks that remain untested.
- [Recommendation](06-recommendation.md) turns the evidence into a finite
  architecture and rollout recipe.
- [Reproduction guide](REPRODUCING.md) documents validation and rerunnable
  development commands without overwriting sealed evidence.
- [ADR](adr-proposal.md) records the accepted architecture decision and the
  consequences and acceptance criteria gating production rollout.
- [Evidence ledger](evidence-ledger.csv) records conservative source claims,
  evidence tiers, limitations, and replication status.
- [Source manifest](source-manifest.json) freezes canonical source identifiers,
  versions or access dates, licenses, and code/data availability.

Living companions (**not** part of the sealed `00`–`06` evidence record):

- [Implementation status since sealing](implementation-status.md) records, from HEAD
  source only, which audit gaps have been closed in code since the record was frozen
  (fusion, Unicode lexical, embedding-version gating, query-time validity, record-injection
  opt-in) and what remains open. Read this before taking the audit as current.
- [Injection architecture (thread B)](injection-architecture.md) compares how
  long-term memory should reach the conversation — position-0 injection vs.
  cache-friendly placement vs. tool-pull vs. agentic multi-call — recommends a
  tiered delivery model, and specifies a reader-level eval harness and
  production data-collection plan to decide `deriveInjectionQuery` on evidence.
  It cites external systems and benchmarks as research inputs only; no published
  score is transferred to papai.

Protocol v4's deterministic papai component and storage tracks were reproduced
locally on 2026-07-23. Protocol-v3 artifacts are preserved as a superseded
historical validity run and are not pooled with v4. They are retained
deliberately: they are the audit trail that makes the v3-to-v4 validity
correction independently checkable, and the failure catalog, benchmark
description, and reproduction guide all cite them by path. LongMemEval, LoCoMo,
MemoryAgentBench, and MemBench were not supplied or run; their status remains
`not_run`. Names of papers, projects, and benchmarks identify research inputs
only, and published scores are never transferred to papai.

## Reading order

1. Read the protocol before changing a candidate or metric.
2. Use the audit as the definition of the deployed subsystem and its explicit
   proxy-boundary section as the definition of artifact id `as-shipped`;
   archived plans and comments are not normative when they disagree with
   executable code.
3. Use the taxonomy and evidence ledger to trace design claims; a cited
   external score remains `not_run` until reproduced under this protocol.
4. Verify result documents against the raw artifacts and hashes in the
   reproduction guide before using the recommendation.

## Reproducibility boundary

The deterministic comparison runs locally with Bun, deterministic embeddings,
synthetic fixtures, and local storage. Optional public data must be supplied
locally. It requires no network, API key, hosted model, or managed database.
End-to-end reader experiments may be added as a separate track, but they must
not be blended with deterministic retrieval results.

The graph, if evaluated, is a rebuildable projection of canonical events. It is
never the only copy of evidence.
