<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Agent memory component results

Primary decision scale: 10,000 records per scope; sensitivity scale: 1,000. Representation outcome: **adopt-hierarchy**.

`as-shipped` is an active-record retrieval/injection proxy, not the deployed papai memory subsystem. Comparisons against it are adapter-to-adapter retrieval comparisons.

| Candidate | 10k nDCG | 1k nDCG | Rel./temporal | Weighted score | Scope | Erasure | Offline | 100k storage |
| --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- |
| as-shipped | 0.5233 | 0.5233 | 0.3155 | ineligible | pass | fail | pass | blocked |
| corrected-hybrid | 0.7595 | 0.7595 | 0.5000 | 71.48 | pass | pass | pass | blocked |
| hierarchical | 0.8385 | 0.8385 | 0.8155 | 80.24 | pass | pass | pass | open-migration-evaluation |
| temporal-graph | 0.8016 | 0.8016 | 0.8155 | 79.36 | pass | pass | pass | open-migration-evaluation |

## Paired 95% confidence intervals

| Comparison | Statistic | Delta | 95% interval |
| --- | --- | ---: | --- |
| corrected-hybrid − as-shipped | overall-ndcg | 0.2362 | [0.1743, 0.3000] |
| hierarchical − as-shipped | overall-ndcg | 0.3152 | [0.2459, 0.3851] |
| hierarchical − corrected-hybrid | overall-ndcg | 0.0790 | [0.0532, 0.1062] |
| hierarchical − corrected-hybrid | long-horizon-ndcg | 0.0000 | [0.0000, 0.0000] |
| temporal-graph − hierarchical | relational-temporal-ndcg | 0.0000 | [0.0000, 0.0000] |

## Graph gate

Result: **fail** against `hierarchical`.

Ratios — retrieval p95: 0.6069; ingest/attempt: 1.7277; calls/attempt: 1.0000; stored bytes: 1.5189.

Failed criteria: relational-temporal-delta, relational-temporal-interval, ingest-cost.

## Independent storage decision

For `hierarchical`: open-migration-evaluation; pooled p95 184.9256 ms; maximum incremental RSS 1509146624 bytes.

## Public benchmark status

| Dataset | Import | Official protocol | Reason |
| --- | --- | --- | --- |
| locomo | not_supplied | not_run | Dataset was not supplied locally; no official reader/judge protocol ran. |
| longmemeval | not_supplied | not_run | Dataset was not supplied locally; no official reader/judge protocol ran. |
| membench | not_supplied | not_run | Dataset was not supplied locally; no official reader/judge protocol ran. |
| memoryagentbench | not_supplied | not_run | Dataset was not supplied locally; no official reader/judge protocol ran. |

## Limitations

- Deterministic synthetic embeddings are not learned production embeddings.
- The frozen synthetic corpus is not production conversation traffic.
- Component retrieval scores do not establish final answer quality.
- No live LLM reader or judge was executed.
- LongMemEval, LoCoMo, MemoryAgentBench, and MemBench official protocols were not run.
- Explicit graph fixtures do not validate real graph extraction quality.
- Group namespaces are not speaker-conditioned belief tracking.
- Single-process scale tests do not exercise poisoning, concurrent durability, deferred actions, or million-token reader utilization.
- Operational crash recovery, migration, backup/restore, and sustained-load tests were not run.
- Standalone decision-sidecar validation checks internal closure but does not recompute bootstrap intervals from hashed component artifacts.
- The as-shipped artifact is an active-record retrieval/injection proxy, not the deployed papai subsystem.
- Capture, extraction, provisional promotion, and production SQLite behavior were not executed by the proxy.
- Context assembly relevance was not scored; only retrieval hits were scored.
- Proxy safety and resource observations do not establish deployed-system incidents or production SQLite performance.

The JSON result remains the validated 10k retrieval-component report. Cross-scale decisions are stored in the hashed decision-analysis sidecar.
