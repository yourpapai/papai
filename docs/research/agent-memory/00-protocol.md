<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Research protocol

Protocol version: `memory-research-protocol-v4`.

Status: the deterministic v3 corpus, hypotheses, score, and gates were
pre-registered before candidate implementation or benchmark execution. A
post-execution validity review found that evaluator labels crossed the
candidate boundary, raw-hit safety could be normalized after top-k truncation,
and the `as-shipped` label overstated the baseline adapter's scope. Protocol v4
keeps the frozen corpus, queries, weights, gates, and candidate algorithms, but
redacts evaluator-only fields, closes the raw-hit contract, and constrains the
baseline claim before a new sealed execution. V3 artifacts remain immutable
and are not pooled with v4. Evidence-manifest v2 still adds only explicitly
non-scored future tracks.

Baseline revision:
`eab9ed2b4e2dac0279d338436b59c3a89d87bc8a` (2026-07-23 audit).

## Scope and research questions

This study compares four implementations behind one normalized adapter:

1. `as-shipped`, the historical artifact id for a deterministic approximation
   of selected active-record retrieval and three-record injection branches,
   including missing-embedding and retrieval blind spots;
2. `corrected-hybrid`, adding dense/lexical fusion, temporal validity,
   embedding-version metadata, deterministic reranking, and hard erasure;
3. `hierarchical`, retaining canonical events and deriving session/topic
   summaries and facts with leaf evidence;
4. `temporal-graph`, adding explicitly scoped, typed, validity-bounded
   nodes/edges as a rebuildable projection of the same canonical evidence.

`as-shipped` is an active-record retrieval/injection proxy, not the deployed
papai memory subsystem. The runner supplies preconstructed events. The proxy
does not execute working memory, profiles, capture/extraction, provisional
recall and promotion, SQLite/FTS persistence, maintenance or scheduler paths,
or exact tool and guest authorization. Reported relevance metrics evaluate
retrieval hits; context assembly is checked for successful bounded completion
but its relevance is not scored.

The questions are:

- RQ1: Which candidate retrieves the right evidence under a fixed context
  budget without crossing personal/group scopes or returning erased evidence?
- RQ2: Which representation best handles long-range, multilingual, temporal
  update, relational multi-hop, and abstention cases?
- RQ3: Which gains survive missing embeddings, duplicates, out-of-order events,
  restart/rebuild, and non-recapture after erasure?
- RQ4: What are the latency, ingest, storage, memory, and model-call costs at
  1,000, 10,000, and 100,000 records per scope?
- RQ5: Does a graph add enough relational/temporal value over the strongest
  non-graph candidate to justify its complexity?
- RQ6: Does SQLite remain within the pre-registered deployment envelope, or is
  a storage migration justified independently of the memory representation?

This protocol evaluates the memory component. Retrieval scoring remains
separate from reader/answer scoring. The deterministic default track makes no
claim about final answer quality.

## Evidence policy

### Evidence tiers

Evidence is labeled, never silently blended:

| Tier | Label                                | Admissible use                                                                                                                      |
| ---- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| E0   | Locally reproduced                   | A command, frozen input, raw output, environment manifest, and result produced in this repository.                                  |
| E1   | Peer-reviewed or code-backed primary | Published paper, official benchmark, or official implementation that directly supports the stated method/protocol claim.            |
| E2   | Author primary                       | Preprint, author project page, or official repository without local reproduction; useful for design claims, not transferred scores. |
| E3   | Vendor primary                       | Vendor-authored documentation or evaluation; hypothesis-generating and subject to disclosed incentives.                             |
| E4   | Anecdotal/secondary                  | Blogs, discussions, surveys, and third-party summaries; discovery only, never decision evidence by themselves.                      |

`E0` means reproduced here, not merely executable elsewhere. A peer-reviewed
result remains `E1` until this repository actually runs its stated artifact and
protocol.

The evidence-source manifest is version 2. Its AM21-AM28 additions expand the
bibliography and document future evaluation gaps only. They do not change
`memory-scenario-manifest-v3`, candidate behavior, the weighted score, or any
decision gate. Claims are labeled as external findings, engineering
invariants, papai hypotheses, or local E0 results so an external citation is
not mistaken for a reproduced papai result.

### Inclusion rules

A source is included only when it is primary, directly relevant to a candidate,
metric, benchmark, or failure mode, and has a stable URL. Method claims must be
traceable to a paper or official repository. Benchmark claims require the
official dataset/protocol. Local claims require raw results and a run manifest.

Public data must permit local use and must be supplied to the importer
explicitly; the research CLI does not download it. Synthetic papai data must be
deterministic, contain no production conversation content, and preserve the
same scope, language, event, query, and budget distribution for every
candidate.

### Exclusion rules

Exclude:

- unsourced performance claims, leaderboard screenshots, and vendor comparison
  tables without a runnable protocol;
- benchmark scores produced with a different dataset revision, query set,
  reader, judge, retrieval depth, or denominator unless reported separately;
- private user data, production logs, or generated fixtures that resemble real
  identities;
- papers or repositories cited only because they use the word "memory";
- secondary summaries when the primary source is available;
- results inferred from implementation shape, unit tests, or another system's
  published score.

### Source-version policy

Every source manifest entry must record a canonical URL, artifact type,
accessed date, and an immutable version locator when available. Papers use a
conference version, DOI, OpenReview id, or arXiv id/version. Code and datasets
used in a run must be pinned to a release tag or full commit/content hash.

A default-branch repository may seed the evidence search, but it is not
replication-ready. Pin it before execution. If a benchmark changes, preserve
the old artifact hash, import the new version as a distinct source id, and do
not compare their scores as one series.

## Benchmark and corpus controls

The synthetic papai corpus has exactly 240 scenarios: 60 development and 180
sealed test. It is balanced across `personal`/`group` scope and
English/Russian. The sealed test split must not influence candidate logic,
thresholds, weights, or prompt design.

Task 2 must generate and freeze a versioned scenario manifest before any sealed
execution. Its identity consists of:

- `scenarioManifestVersion`, an explicit corpus-manifest version;
- `scenarioManifestSha256`, the lowercase hexadecimal SHA-256 digest of the
  canonical serialized manifest.

Canonical serialization sorts scenarios by stable scenario id, recursively
sorts object keys lexicographically, preserves the semantic order of arrays
inside each scenario (including event and query order), emits compact JSON with
no insignificant whitespace, and hashes its UTF-8 bytes. The manifest includes
the split assignment and every field that can affect expected behavior or
scoring: events, queries, expected evidence, scopes, languages, budgets,
faults, seeds, and generator/version metadata.

Task 2 produced and validated the final pre-sealed corpus identity:

- scenario manifest: `memory-scenario-manifest-v3`;
- corpus generator: `memory-corpus-v3`;
- SHA-256:
  `283044dbd97c119b5b76a639f4f28792e4ff12cc0bdc73e6a81761b083bb12f7`.

Version 3 closes preflight gaps before unsealing: the version-change fault is
materialized, the duplicate schedule is genuinely out of order, both language
variants of the graph fixture expose a flat seed without exposing the answer
leaf, and relation validity starts with its containing evidence event. The
digest is a source literal checked against the recomputed canonical payload at
module initialization. Sealed execution is prohibited if either identity field
differs. Every run record must contain both exact identity fields.

After freeze, any corpus change—including scenario content, ids, ordering with
semantic meaning, split assignment, labels, scopes, languages, budgets, faults,
or generation inputs—requires a new scenario-manifest version and digest plus
a new protocol/corpus version. It must not overwrite or be aggregated with the
previous corpus version.

All candidates receive identical immutable events, queries, expected evidence,
scope identifiers, token/context budgets, deterministic embedding vectors, and
fault schedule. Scale distractors are generated from a recorded seed rather
than stored as a 100,000-row fixture. Required scale profiles are 1,000, 10,000,
and 100,000 records per scope.

### Protocol-v4 execution envelope

The evaluator retains the complete labeled query, including expected evidence,
expected absence, slices, and fault metadata. Candidate code receives only an
operational projection with these fields:

- `queryId`;
- `authorizedScope`;
- `actorRole`;
- `language`;
- `queryTime`;
- `k`;
- `contextTokenBudget`; and
- `text`.

The runner must construct that projection explicitly before both retrieval and
context assembly. A candidate must not receive evaluator-only fields through a
wider object, nested metadata, or adapter-specific escape hatch.

A successful retrieval result may emit at most the requested `k` hits. Evidence
ids must be unique, and emitted ranks must be exactly the one-based hit order.
Any violation invalidates that candidate/query result; the runner must not
truncate, deduplicate, reorder, or otherwise repair it into a successful
result. Each hit is limited to 16,384 content characters and 64 canonical
provenance evidence ids; the runner rejects oversized envelopes before deep
schema parsing. An exception raised while inspecting or schema-validating an
untrusted result is retained as a validation failure rather than escaping the
query denominator. Leakage and erased-hit metrics are computed over every raw
emitted hit before any quality normalization. The report validator
independently rechecks the same hit envelope so persisted malformed results
cannot enter aggregation.

The legacy leakage metric counts a hit whose declared scope differs from the
authorized scope. Safety gates do not trust that candidate-supplied label:
within a designated cross-scope probe, the scope gate also fails when the
top-level hit id or any `derivedFromEvidenceIds` member intersects the
evaluator's forbidden evidence. Within a designated erasure probe, the erasure
gate applies the same evidence-closure rule to erased evidence ids. This
designated-probe rule avoids treating ordinary same-scope distractors as scope
violations while preventing a candidate from laundering foreign or erased
evidence through a relabeled or derived hit.

Planned public importers accept locally supplied LongMemEval, LoCoMo,
MemoryAgentBench, and MemBench JSON. A public dataset is reported as
`not_run` until its official data and protocol were actually executed. No score
may be copied from a paper, README, or vendor report.

Public benchmarks may mix retrieval and answer generation, use LLM judges, or
change over time. Their results therefore remain separate from the
deterministic component track, with reader, judge, prompts, dataset revision,
and retrieval depth recorded.

## Evidence-v2 future extensions

The following tracks are registered as future research gaps. They are
non-scored, absent from the frozen 240-scenario v3 corpus, and `not_run`.
Nothing in this section changes the hypotheses, metric definitions, weights,
universal gates, graph gate, or storage threshold below.

| Future track               | Primary evidence | Proposed outcomes                                                                                                       | Current limitation                                                                                   |
| -------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Trust and memory poisoning | AM21             | Poisoned-write retrieval, trust-label propagation, recapture amplification, unauthorized control influence.             | V3 tests scope and erasure, not malicious but authorized writes or stored instructions.              |
| Selective promotion/replay | AM22             | Replay eligibility, later task utility, error propagation, evaluator errors, and quarantine/restore behavior.           | V3 does not run a downstream task environment; canonical retention must remain separate from replay. |
| Action utilization         | AM23             | Correct tool selection, parameter grounding, current authorization, task success, and action errors.                    | A correct evidence hit does not establish correct tool execution.                                    |
| Multi-party group memory   | AM24             | Speaker-conditioned answers, concurrent beliefs, reply/thread preservation, asker-relative terms, and lexical baseline. | V3 group scope is namespace isolation, not multi-party belief tracking.                              |
| Token-horizon scale        | AM25             | Ability-level quality and cost at 100K, 1M, and optionally 10M coherent source tokens.                                  | V3 record-count scaling cannot establish reader utilization across a million-token history.          |
| Prospective execution      | AM26             | Due-task precision/recall, early/late/duplicate actions, cancellation/reschedule violations, and monitoring cost.       | V3 retrieval does not execute deferred intentions or monitor external cues.                          |
| Graph extraction quality   | AM27, AM28       | Entity/link precision, relation coverage, path faithfulness, verbalization accuracy, and extraction/model cost.         | V3 explicit fixture relations validate projection and traversal, not real extraction.                |
| Operational readiness      | engineering      | Crash atomicity, concurrent races, storage-level erasure, migration/rollback, backup restore, and load saturation.      | V3 covers deterministic rebuild, live-hit erasure, single-process latency, and RSS only.             |

These tracks must remain separate from the deterministic component result.
Before execution, each needs frozen inputs, exact repository or dataset
commits/content hashes, its own reader and judge configuration where
applicable, raw outputs, failure accounting, and an environment manifest.
AM24's currently linked dataset and every AM21-AM28 code repository remain
unpinned discovery artifacts in source-manifest v2.

If any future slice is promoted into the scored synthetic track, that is a new
protocol and corpus revision: create a new scenario-manifest version and
digest, rerun every candidate under identical inputs, and do not aggregate it
with v3. External benchmark scores and future-track results must never be
retroactively inserted into the frozen 100-point score.

### Future security and operational acceptance

The production recommendation should additionally report these deterministic
acceptance checks even when they remain unexecuted:

- interrupt between canonical and derivative writes, restart, and prove
  idempotent replay or deterministic repair;
- race duplicate/out-of-order ingest and forget-versus-ingest across scopes;
- verify erasure in canonical rows, FTS, vectors, summaries, graphs, caches,
  logs, SQLite WAL, and restored backups rather than only hiding retrieval;
- migrate and roll back schema, embedding, tokenizer, extractor, and graph
  versions without mixing incompatible state;
- restore backups, replay later erasures, detect corruption, and measure
  rebuild time and tolerated data loss; and
- measure cold/warm and concurrent tail latency, saturation, bounded queues,
  failure counters, and repair backlog.

These are engineering acceptance requirements, not E0 results or claims that
the current research implementation is production-ready.

## Hypotheses

- H1: Corrected hybrid retrieval improves recall on missing-embedding,
  multilingual, and lexical-mismatch slices over the `as-shipped` active-record
  proxy without exceeding 2x its retrieval p95.
- H2: Hierarchical event/fact memory improves long-range and topic-spanning
  retrieval while retaining leaf-level evidence and deterministic rebuilds.
- H3: A temporal graph improves the relational/temporal composite by at least
  five absolute points over the strongest non-graph candidate, without a
  material overall-quality regression or unacceptable resource cost.
- H4: Explicit validity and erasure semantics eliminate stale-current conflicts
  and erased hits without cross-scope leakage.
- H5: SQLite remains adequate at 100,000 records per scope unless it crosses the
  pre-registered latency or incremental-RSS threshold.

These are directional hypotheses, not findings.

## Metrics

The default retrieval depth is `k = 8`, matching the shipped recall limit.
Metrics are calculated per query before aggregation:

- Precision@8: relevant returned evidence divided by returned evidence, with an
  empty result scored `0` when relevant evidence exists and `1` for a correct
  abstention.
- Recall@8: relevant returned evidence divided by all labeled relevant
  evidence.
- Reciprocal rank: reciprocal of the first relevant rank, or `0` if absent.
- nDCG@8: discounted cumulative gain using binary evidence relevance, normalized
  by the ideal ordering.
- Leakage count: hits whose effective scope is not authorized by the query.
- Erased-hit count: hits referring to an event/evidence id after its completed
  forget operation.
- Rebuild agreement: exact equality of ordered hit ids before restart and after
  rebuilding all derived state from canonical events.
- Latency: wall-clock ingest and retrieval p50/p95/p99, with warmup policy,
  hardware, runtime, and sample counts in the run manifest.
- Resources: ingest throughput, model/extractor call count, stored bytes, and
  incremental resident set size (RSS) from the pre-run baseline.

Failures and timeouts remain in the denominator and are also reported
separately. Candidate exceptions may not be converted into empty successful
retrievals.

The relational/temporal composite is the arithmetic mean, in percentage
points, of nDCG@8 on the `graph-multi-hop` and `temporal-conflict` slices.
The long-horizon composite is the arithmetic mean of nDCG@8 on
`long-range`, `knowledge-update`, and `abstention` slices.

Candidate deltas use paired bootstrap resampling at the scenario level with
10,000 resamples, seed `20260723`, and a two-sided percentile 95% interval.
Intervals are always reported alongside point deltas; no unpaired resampling is
allowed for candidate comparisons.

### Execution freeze for aggregation and uncertainty

The sealed 10,000-record-per-scope run is the sole primary decision scale. The
1,000-record run is sensitivity analysis and is never pooled into a weighted
score or gate. The 100,000-record run is performance/storage analysis only.

Overall quality metrics are query-level means. A sampled scenario carries all
of its queries together. Slice means include each query once for every matching
slice, and composites are equal-weight means of their registered slice means,
not pooled-query means. Failures and timeouts contribute zero and remain in
the denominator. An empty required slice is an invalid run rather than a zero.
Correct abstention retains the registered metric semantics: precision, recall,
and nDCG are one, while reciprocal rank is zero.

One xorshift32 stream, initialized to unsigned seed `20260723`, generates the
same 10,000 arrays of scenario indexes for every paired candidate comparison
and statistic. Each replicate is candidate minus comparator. The 2.5th and
97.5th percentiles use the type-7 interpolated quantile. Point deltas use the
complete unsampled selection. A positive interval excludes zero only when its
unrounded lower bound is strictly greater than zero; JSON retains full
precision and presentation rounding never controls a gate.

## Weighted decision score

Only candidates that pass both safety gates and the self-hosting gate receive a
weighted score. The score is pre-registered on a 100-point scale:

| Component                             |  Weight |
| ------------------------------------- | ------: |
| Recall@8, all sealed queries          |      20 |
| nDCG@8, all sealed queries            |      15 |
| Reciprocal rank, all sealed queries   |      10 |
| Precision@8, all sealed queries       |      10 |
| Relational/temporal composite         |      20 |
| Missing-embedding fault Recall@8      |       5 |
| Duplicate/out-of-order fault Recall@8 |       5 |
| Restart/rebuild agreement             |       5 |
| Retrieval p95 efficiency              |       4 |
| Ingest-throughput efficiency          |       2 |
| Stored-bytes efficiency               |       2 |
| Incremental-RSS efficiency            |       2 |
| **Total**                             | **100** |

Quality values in `[0, 1]` contribute `weight * value`. Efficiency is normalized
against the `as-shipped` active-record proxy: lower-is-better measures
contribute `weight * clamp(baseline / candidate, 0, 1)` and ingest throughput
contributes `weight * clamp(candidate / baseline, 0, 1)`. These ratios compare
research adapters, not the full production subsystem. A zero denominator is a
run failure, not an infinite score. Model/extractor calls are reported and
enforced by the graph cost gate but are not double-counted in the weighted
score.

No reader or LLM-judge score contributes to this component score.

Every efficiency input at the primary scale must be finite and strictly
positive. A zero latency, throughput, stored-byte, or incremental-RSS
denominator invalidates the weighted score rather than yielding an infinite or
perfect contribution. Rebuild agreement is exact ordered-hit-ID agreement
divided by all scheduled rebuild probes; a missing, failed, or timed-out probe
contributes zero, and no scheduled probes makes the score invalid.

## Gates and decision thresholds

### Universal gates

- Safety: exactly zero cross-scope retrievals and exactly zero live retrievals
  after erasure. Any nonzero count disqualifies the candidate.
- Self-hosting: the deterministic path completes without a network, API key,
  hosted model, proprietary service, or managed database. A mandatory external
  dependency disqualifies the candidate from the default recommendation.
- Reproducibility: a candidate must emit the manifest, raw per-query records,
  aggregate metrics, and failures. Missing artifacts make the run invalid.

### Practical superiority

A candidate is practically superior to a comparator only if its weighted score
improves by at least 2.0 absolute points and the paired 95% interval for the
sealed-query nDCG@8 delta excludes zero. Otherwise prefer the simpler eligible
candidate.

Hierarchy may be selected over corrected hybrid when it meets practical
superiority, or when its long-horizon composite improves by at least 5.0
absolute points with the paired 95% interval excluding zero and its weighted
score loses no more than 2.0 points.

### Additional graph gate

A temporal graph is justified only when, relative to the strongest eligible
non-graph candidate, all of these hold:

- relational/temporal composite improves by at least 5.0 absolute points;
- the paired 95% interval for that improvement excludes zero;
- weighted score loses no more than 2.0 points;
- retrieval p95 is no more than 2x;
- ingest/model cost is no more than 1.5x;
- stored bytes are no more than 3x;
- the graph remains a rebuildable projection of canonical events.

Failing this gate means the recommendation stays with the strongest eligible
non-graph representation even if the graph wins isolated examples.

For the graph cost gate, aggregate totals before forming ratios. Ingest cost is
total ingest milliseconds per attempted record at the 10,000-record scale.
Model cost is total model plus extractor calls per attempted record. Both must
be no more than 1.5 times the strongest eligible non-graph comparator. A call
ratio of `0/0` is parity (`1`); a positive graph numerator over a zero
comparator is infinite and fails; a zero graph numerator over a positive
comparator is zero. Exact weighted-score ties choose the simpler eligible
candidate in this order: `as-shipped`, `corrected-hybrid`, `hierarchical`.

### Storage decision

Keep SQLite unless the winning representation exceeds either 250 ms retrieval
p95 or 1 GiB incremental RSS at 100,000 records per scope. Crossing a threshold
opens a separate storage-engine decision; it does not retroactively change the
winning memory representation.

The frozen 100,000-record workload consists only of
`scenario-personal-en-022`, `scenario-personal-ru-022`,
`scenario-group-en-022`, and `scenario-group-ru-022`: one graph-multi-hop
scenario per scope/language cell. Each candidate/scenario runs in a fresh
worker with exactly 100,000 total stored records in its primary scope,
canonical rows included. Input fixtures are materialized before candidate
reset and the RSS baseline. After one unscored warmup, the worker records 25
identical retrievals, producing 100 pooled latency samples per candidate.

The threshold statistic is pooled nearest-rank p95; per-cell p95 is diagnostic.
The RSS statistic is the maximum of the four current incremental-RSS samples
captured before report-only serialization; absolute process peak is diagnostic.
`p95 <= 250 ms` and `RSS <= 1,073,741,824` bytes keeps SQLite. Exceeding either
opens a separate migration evaluation. A missing or failed 100,000-record run
blocks the storage decision and cannot default to keep or migrate.

### Gate evidence and finite recommendation

Gate states are `pass`, `fail`, or `not_evaluable`. An observed scope or
erasure violation fails its gate. If no violation is observed but any
designated safety probe is missing, fails, or times out, the gate is
`not_evaluable`; failed queries cannot inherit a synthetic zero-violation
count. Scope and erasure probe evaluation uses the full evidence closure
defined in the protocol-v4 execution envelope rather than trusting only the
hit's scope or top-level id. Self-hosting requires an explicit offline
registration plus successful execution. Reproducibility requires validated
manifests, implementation/source hashes, raw rows, failure rows, aggregates,
and required artifacts.

Among eligible non-graph candidates, move to a more complex representation
only through the registered general or hierarchy-special superiority rule. Add
the graph only if every graph gate passes. The finite representation outcomes
are therefore: retain the active-record proxy for this component only, repair
hybrid, adopt hierarchy, add a derived temporal graph, or block adoption
because no candidate is safely evaluable. Because the proxy does not cover the
whole deployed memory subsystem, this experiment cannot authorize retaining
all shipped behavior unchanged. The storage outcome is decided independently.

## Run validity and reporting

Each run records repository revision, dirty state, Bun/OS/hardware metadata,
candidate and dataset versions, `scenarioManifestVersion`,
`scenarioManifestSha256`, seeds, split, scale, embedding version and dimension,
exact configuration, start/end times, failures, raw hits, timings, and
aggregate metrics.

Research reports also identify evidence-source manifest version 2, but that
bibliography version is not part of the frozen scenario identity and does not
alter scoring.

The 60-scenario development split may be rerun during implementation. The
180-scenario sealed split is executed once per frozen candidate configuration,
apart from a fully documented invalid-run restart. A change to candidate logic,
weights, labels, or queries after unsealing creates a new protocol version and
must not overwrite the original result. A post-freeze corpus change additionally
requires the new scenario-manifest identity and corpus version defined above.

Protocol v3's completed outputs are retained as a historical validity run. The
label boundary, raw-hit envelope, and baseline-claim corrections above define
protocol v4 even though the scenario manifest and candidate algorithms are
unchanged. V4 uses a new output root and a new source identity; its results are
not pooled with, substituted into, or written over v3 artifacts.

Limitations remain prominent: deterministic embeddings are not learned
embeddings; synthetic data is not production traffic; component retrieval is
not final answer quality; absent live-reader experiments and unexecuted public
datasets remain `not_run`; explicit graph fixtures do not validate extraction;
group namespaces do not validate speaker-conditioned belief tracking; and
single-process record scaling does not validate poisoning resistance,
concurrent durability, deferred action execution, or million-token reader
utilization. AM21-AM28 remain external E1-E3 inputs until separately
reproduced.
