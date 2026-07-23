<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Agent Memory Deep Research Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` or `executing-plans` task-by-task. All implementation code follows test-driven development.

**Goal:** Build and execute a reproducible, evidence-backed comparison of papai's shipped memory, a corrected hybrid, hierarchical event/fact memory, and temporal vector-graph memory.

**Architecture:** Research code stays isolated under `scripts/memory-research/` and is exercised from `tests/memory-research/`. Every candidate implements one normalized adapter and consumes the same deterministic event/query corpus. Research documentation and machine-readable results live under `docs/research/agent-memory/`; production memory behavior is unchanged.

**Tech Stack:** Bun 1.3, strict TypeScript, `bun:test`, Zod v4, `bun:sqlite`, JSON/JSONL/CSV/Markdown.

## Global Constraints

- Do not modify production files under `src/` or `client/`.
- Use `.js` extensions in TypeScript import paths.
- Add the repository SPDX/BUSL header to every new TypeScript file.
- Write each behavior test first, run it, and record the expected failing result before implementation.
- The default research path is deterministic and requires no network, API key, hosted model, or managed database.
- Only public benchmark data and deterministic synthetic papai data are admissible.
- All candidates use identical scopes, events, queries, token budgets, deterministic embeddings, and scoring.
- Keep retrieval scoring separate from any reader/answer scoring.
- The papai corpus has exactly 240 scenarios: 60 development and 180 sealed test; it is balanced across `personal`/`group` scope and English/Russian.
- Include scale profiles at 1,000, 10,000, and 100,000 records per scope.
- Safety gates are zero cross-scope retrieval and zero live retrieval after erasure.
- Graph data is a rebuildable projection of canonical events, never the only copy of evidence.
- Research conclusions must distinguish locally reproduced evidence, peer-reviewed/code-backed evidence, author/vendor evidence, and anecdote.
- Do not claim public benchmark scores unless the official dataset and protocol were actually executed.

---

### Task 1: Research protocol, baseline audit, taxonomy, and evidence ledger

**Files:**

- Create: `docs/research/agent-memory/README.md`
- Create: `docs/research/agent-memory/00-protocol.md`
- Create: `docs/research/agent-memory/01-current-state-audit.md`
- Create: `docs/research/agent-memory/02-technique-taxonomy.md`
- Create: `docs/research/agent-memory/evidence-ledger.csv`
- Create: `docs/research/agent-memory/source-manifest.json`

**Requirements:**

- Document the research questions, evidence tiers, inclusion/exclusion rules, source-version policy, benchmark caveats, hypotheses, metrics, weights, and pre-registered decision thresholds.
- Audit working memory, long-term memory, capture, retrieval, injection, promotion, maintenance, deletion, scoping, guest behavior, compaction, concurrency, storage, and deployment from current code rather than archived plans.
- Include the verified current gaps: competing capture paths, incomplete embeddings, semantic-or-lexical fallback, ASCII lexical fallback, recency injection, O(N) vector scan, missing embedding version metadata, incomplete erasure/retention, guest visibility, and process-local scheduling.
- Build a lifecycle taxonomy covering working, episodic, semantic, procedural, and prospective memory plus raw context, summaries, event/fact stores, vector/hybrid retrieval, graphs, GraphRAG, reflection, adaptive policies, and parametric memory.
- Seed the evidence ledger from primary papers and official repositories. Record claims conservatively; blank replication fields must be `not_run`, not inferred.
- Validate JSON and CSV parseability with one-off read-only commands and run Markdown formatting checks if available.

### Task 2: Candidate contract, corpus, metrics, and run manifests

**Files:**

- Create: `scripts/memory-research/types.ts`
- Create: `scripts/memory-research/deterministic-embedding.ts`
- Create: `scripts/memory-research/corpus.ts`
- Create: `scripts/memory-research/metrics.ts`
- Create: `scripts/memory-research/manifest.ts`
- Create: `tests/memory-research/types.test.ts`
- Create: `tests/memory-research/corpus.test.ts`
- Create: `tests/memory-research/metrics.test.ts`
- Create: `tests/memory-research/manifest.test.ts`

**Interfaces:**

- Produce `MemoryCandidateAdapter` with `reset`, `ingest`, `retrieve`, `assembleContext`, `forget`, `rebuild`, and `resourceMetrics`.
- Produce immutable `MemoryEvent`, `MemoryQuery`, `MemoryHit`, `MemoryScenario`, `RunManifest`, and report types.
- Produce a deterministic multilingual embedding function whose version and dimension are included in every manifest.
- Produce exactly 240 deterministic scenarios and configurable scale distractors without storing a 100,000-row fixture in Git.
- Produce retrieval metrics: precision/recall at k, reciprocal rank, nDCG, leakage count, erased-hit count, and latency summaries.

**Verification:**

- Run `bun test tests/memory-research/types.test.ts tests/memory-research/corpus.test.ts tests/memory-research/metrics.test.ts tests/memory-research/manifest.test.ts`.
- Run `bun typecheck`.

### Task 3: Four comparable memory candidates

**Files:**

- Create: `scripts/memory-research/candidates/shared.ts`
- Create: `scripts/memory-research/candidates/as-shipped.ts`
- Create: `scripts/memory-research/candidates/corrected-hybrid.ts`
- Create: `scripts/memory-research/candidates/hierarchical.ts`
- Create: `scripts/memory-research/candidates/temporal-graph.ts`
- Create: `tests/memory-research/as-shipped.test.ts`
- Create: `tests/memory-research/corrected-hybrid.test.ts`
- Create: `tests/memory-research/hierarchical.test.ts`
- Create: `tests/memory-research/temporal-graph.test.ts`
- Create: `tests/memory-research/candidate-contract.test.ts`

**Behavior:**

- `as-shipped` characterizes current recency/semantic-or-keyword behavior, including the known unembedded-record blind spot.
- `corrected-hybrid` uses lexical+dense fusion, temporal validity, scope metadata, deterministic reranking, embedding-version metadata, and hard erasure.
- `hierarchical` stores canonical events and builds deterministic session/topic summaries plus derived facts; retrieval can return both leaf evidence and hierarchy context.
- `temporal-graph` stores the same canonical events and facts plus explicitly scoped, typed, validity-bounded nodes/edges in SQLite; retrieval starts from hybrid seeds and performs bounded traversal.
- Every candidate passes the same contract tests for reset, scope isolation, deterministic ordering, forgetting, rebuild, and resource metrics.
- Candidate-specific improvements must be isolated by tests; do not copy scoring logic between candidates.

**Verification:**

- Run `bun test tests/memory-research`.
- Run `bun typecheck`.

### Task 4: Public importers, experiment runner, scale/fault suites, and CLI

**Files:**

- Create: `scripts/memory-research/importers.ts`
- Create: `scripts/memory-research/runner.ts`
- Create: `scripts/memory-research/report.ts`
- Create: `scripts/memory-research/index.ts`
- Create: `tests/memory-research/importers.test.ts`
- Create: `tests/memory-research/runner.test.ts`
- Create: `tests/memory-research/report.test.ts`
- Modify: `package.json`

**Behavior:**

- Import locally supplied LongMemEval, LoCoMo, MemoryAgentBench, and MemBench JSON without downloading data.
- Validate every imported record and fail with actionable dataset/version errors.
- Run component-track comparisons with frozen events and hits; leave an explicit extension seam for configured end-to-end model readers.
- Support `--split`, `--candidate`, `--scale`, `--seed`, `--output`, and `--public-dataset` arguments.
- Default to the sealed synthetic test split and all four candidates.
- Record exact configuration, source revision, hardware/runtime metadata, timings, raw per-query results, aggregate metrics, and failures.
- Inject missing embeddings, version changes, duplicates, out-of-order events, restarts/rebuilds, erasure, and cross-scope probes.
- Generate stable JSON plus a Markdown comparison table without claiming unsupported answer-quality or public-benchmark scores.
- Add `research:memory` and `test:memory-research` package scripts.

**Verification:**

- Run `bun test tests/memory-research`.
- Run `bun research:memory --split dev --scale 1000 --output /tmp/papai-memory-dev-results.json`.
- Run `bun typecheck`.

### Task 5: Execute experiments and publish the decision record

**Files:**

- Create: `docs/research/agent-memory/03-benchmark-and-corpus.md`
- Create: `docs/research/agent-memory/04-results.json`
- Create: `docs/research/agent-memory/04-results.md`
- Create: `docs/research/agent-memory/05-failure-catalog.md`
- Create: `docs/research/agent-memory/06-recommendation.md`
- Create: `docs/research/agent-memory/REPRODUCING.md`
- Create: `docs/research/agent-memory/adr-proposal.md`

**Requirements:**

- Execute the 180-scenario sealed test split for every candidate at 1,000 and 10,000 records, plus a 100,000-record performance run.
- Run fault, multilingual, scope, guest, temporal-conflict, graph-multi-hop, and erase/non-recapture slices.
- Preserve raw results and identify which planned public benchmarks were not run because datasets or model access were unavailable.
- Use paired bootstrap confidence intervals for candidate deltas.
- Score only candidates that pass the safety and self-hosting gates.
- Apply the pre-registered weighted score and the extra graph gate: at least five absolute points on the relational/temporal composite, 95% paired interval excluding zero, no more than two points overall loss, within 2x retrieval p95, 1.5x ingest/model cost, and 3x storage.
- Keep SQLite unless the winning candidate exceeds 250 ms retrieval p95 or 1 GB incremental RSS at 100,000 records.
- Produce one finite recommendation: repair hybrid, adopt hierarchy, add a derived temporal graph, and independently keep or migrate storage.
- Describe limitations without weakening them into footnotes, especially deterministic embeddings, synthetic data, absent live LLM judging, and unexecuted public datasets.

**Verification:**

- Re-run the documented reproduction command from a clean output directory.
- Validate `04-results.json` against the report schema.
- Run `bun test:memory-research`, `bun typecheck`, `bun lint`, and `bun format:check`.
- Re-run the focused existing memory baseline.

### Task 5C: Correct post-execution validity findings and publish protocol v4

**Files:**

- Modify: `scripts/memory-research/types-run.ts`
- Modify: `scripts/memory-research/types.ts`
- Modify: `scripts/memory-research/runner-query.ts`
- Modify: `scripts/memory-research/metrics.ts`
- Modify: `scripts/memory-research/report-validation.ts`
- Modify: `scripts/memory-research/report-render.ts`
- Modify: `scripts/memory-research/decision-analysis-build.ts`
- Modify: `scripts/memory-research/decision-analysis-render.ts`
- Modify: focused tests under `tests/memory-research/`
- Modify: `docs/research/agent-memory/00-protocol.md`
- Modify: `docs/research/agent-memory/01-current-state-audit.md`
- Preserve: `docs/research/agent-memory/raw/v3-20260723/`
- Create: `docs/research/agent-memory/raw/v4-20260723/`

**Reason:**

An independent post-execution review found three protocol-validity defects in
v3: evaluator-only labels crossed the candidate API boundary, malformed raw
hits could be normalized before safety accounting, and the `as-shipped` name
overstated the baseline adapter's implemented scope. V3 remains immutable and
is not decision evidence for v4.

**Requirements:**

- Project each labeled evaluator query into an explicit operational query
  containing only id, authorization, role, language, time, depth, context
  budget, and text before candidate retrieval or context assembly.
- Prove with a spy adapter that expected evidence, absence labels, slices,
  faults, and scenario metadata never cross that boundary.
- Reject successful outputs with more than `k` hits, duplicate evidence ids, or
  ranks that differ from one-based emitted order.
- Reject hit content over 16,384 characters and provenance over 64 evidence ids
  with an envelope preflight before deep schema validation.
- Convert exceptions raised during untrusted result inspection or schema
  validation into retained validation failures.
- Count scope leakage and erased hits over every raw emitted hit before quality
  normalization, and independently recheck the envelope when validating a
  persisted report.
- On designated safety probes, evaluate forbidden and erased evidence across
  the top-level hit plus all `derivedFromEvidenceIds`, so a candidate cannot
  launder evidence through a relabeled scope or derived summary.
- Retain the artifact id `as-shipped` for v3 schema compatibility, but label it
  in protocol and reports as an active-record retrieval/injection proxy. List
  production behaviors that the adapter does not execute.
- Add the canonical BUSL header to generated Markdown so artifacts are valid at
  creation time rather than through post-run mutation.
- Keep the v3 corpus, algorithms, weights, gates, scale profiles, and bootstrap
  procedure unchanged; finalize a protocol-v4 source identity before running.
- Execute fresh development, sealed 1,000-record, sealed 10,000-record, and
  100,000-record storage runs under the v4 output root. Never overwrite or pool
  v3 outputs.
- Publish canonical v4 JSON and Markdown only after schema, hash, source
  identity, and decision-closure validation succeeds.

**Verification:**

- Run focused RED/GREEN tests for query redaction, hit-envelope rejection,
  pre-normalization safety accounting, persisted-report revalidation, baseline
  labeling, limitations, and generated license headers.
- Validate every v3 component JSON with the stricter report validator without
  changing those JSON artifacts.
- Obtain an independent pre-sealed review with no Critical or Important
  findings.
- Run `bun test:memory-research`, `bun typecheck`, `bun lint`, and
  `bun format:check` before freezing the v4 source identity.
- Execute the entire v4 matrix and storage harness, publish the decision
  analysis, and repeat schema/hash/decision validation.
- Re-run the documented development reproduction from a clean output
  directory and the focused existing-memory baseline before completion.
