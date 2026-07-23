<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Agent memory technique taxonomy

Status: evidence map version 2 frozen on 2026-07-23; no external source result
reproduced locally.

This taxonomy separates two orthogonal questions:

1. **What role does a memory serve?** Working, episodic, semantic, procedural,
   and prospective memory describe the information's use.
2. **How is that memory implemented?** Context, summaries, records, retrieval
   indexes, graphs, learned policies, and model parameters are implementation
   families.

A single record can serve several roles, and a single implementation can hold
several record types. The role labels are engineering analogies, not claims
that a language agent has human cognition. CoALA is the primary organizing
reference for working, episodic, semantic, and procedural memory in language
agents [AM01]. Prospective memory is added here as an explicit engineering
category for deferred intentions, because papai schedules and resumes work.

All paper and project claims below are evidence-ledger claims, not papai
benchmark findings. Source details and limitations are in
[the evidence ledger](evidence-ledger.csv) and
[source manifest](source-manifest.json).

The taxonomy uses four claim classes:

- **External finding:** a narrowly paraphrased claim followed by an evidence
  source id. Its tier remains E1-E3 until reproduced here.
- **Engineering invariant:** a deterministic safety or lifecycle requirement
  papai chooses to enforce. It is an acceptance condition, not a published
  performance result.
- **Papai hypothesis:** a design choice to test under the preregistered
  protocol. It is not established by the cited architecture's shape.
- **Local E0 result:** a result backed by a frozen local run manifest and raw
  output. This taxonomy contains none as of this version.

Terms such as "supported," "reported," and "motivates" therefore do not mean
"proven for papai." No external score is transferred into the local evidence
track.

## Lifecycle roles

### Working memory

- **Write policy:** Admit the current turn, active tool trace, retrieved
  evidence, and compact task state under a fixed context budget; evict or
  summarize deliberately.
- **Representation:** Ordered messages, tool calls/results, scratch state, and
  an optional running summary.
- **Retrieval policy:** Usually direct inclusion by recency and task state;
  query-based retrieval is useful when the working set itself becomes large.
- **Update, contradiction, forgetting:** Replace superseded task state, keep
  tool-call/result pairs intact, and expire transient material. A summary must
  not silently become the only evidence.
- **Strengths:** Immediate coherence, low lookup overhead, and exact recent
  wording.
- **Failure modes:** Context overflow, distraction by irrelevant recency,
  lossy summaries, prompt injection persistence, and orphaned tool traces.
- **Operational cost:** Reader tokens grow with the retained set; trimming may
  add model calls and latency.
- **Governance implications:** Scope and trust labels must survive assembly;
  transient caches need deletion and restart semantics.
- **Papai hypothesis:** This is the existing conversation-history plane.
  Preserve its ordering and tool-pair rules while making budget, trust, and
  erasure behavior explicit [AM01, AM02, AM03].

### Episodic memory

- **Write policy:** Append attributable canonical events after an interaction
  or meaningful state transition; preserve actor, scope, event time, ingest
  time, and source evidence. Separately decide whether an event is eligible for
  fact extraction, reflection, or experience replay.
- **Representation:** Immutable or versioned event records, often with derived
  embeddings, summaries, and entity links.
- **Retrieval policy:** Filter authorization and temporal validity first, then
  rank by lexical, semantic, temporal, relational, or task relevance.
- **Update, contradiction, forgetting:** Correct by adding a new event or
  validity boundary rather than overwriting history. Quality-based demotion or
  removal from experience replay must not silently delete canonical evidence.
  Hard governance erasure must remove canonical evidence and rebuildable
  derivatives.
- **Strengths:** Provenance, replay, temporal reasoning, and deterministic
  rebuilds.
- **Failure modes:** Event-boundary errors, duplicates, out-of-order ingest,
  unbounded growth, and retrieval of a historically true but currently stale
  event.
- **Operational cost:** High write volume and derivative-index maintenance.
- **Governance implications:** Events can contain sensitive raw speech; enforce
  purpose, retention, access scope, and complete derived-state deletion.
- **External finding:** Selective addition and deletion can reduce error
  propagation and misaligned experience replay in the agent settings evaluated
  by AM22; this does not justify automatic deletion of user evidence [AM22].
- **Papai hypothesis:** Use a canonical event log beneath summaries, facts,
  embeddings, and graph projections, and gate promotion into replayable
  experience separately [AM05, AM14, AM15, AM22].

### Semantic memory

- **Write policy:** Extract durable facts only when evidence and scope are
  known; record confidence, provenance, validity, and extraction version.
- **Representation:** Atomic facts or typed subject-predicate-object
  assertions, with source-event links and optional lexical/vector indexes.
- **Retrieval policy:** Match the query to facts, then return leaf evidence
  with each fact; filter invalid, contradicted, expired, erased, or unauthorized
  facts before ranking.
- **Update, contradiction, forgetting:** Version facts with valid-from and
  valid-to boundaries. Represent disagreement explicitly; rebuild or delete
  derivatives when evidence changes.
- **Strengths:** Compact context, direct answers, consolidation across events,
  and reusable entity knowledge.
- **Failure modes:** Extraction hallucination, over-generalization, lost
  qualifiers, stale-current conflicts, and false entity merges.
- **Operational cost:** Extraction and consolidation calls plus index/storage
  overhead.
- **Governance implications:** Inferred facts may be more sensitive than their
  source text; expose provenance and provide correction and erasure paths.
- **Papai hypothesis:** A derived fact layer addresses current unstructured
  records only if every fact retains scope, temporal validity, and leaf
  evidence [AM01, AM07, AM13].

### Procedural memory

- **Write policy:** Store a procedure after explicit instruction or validated
  successful experience; distinguish user policy from merely observed action.
- **Representation:** Versioned instructions, plans, tool schemas, policies,
  or executable skill references with preconditions and postconditions.
- **Retrieval policy:** Select by task intent, capability, actor authorization,
  environment, and procedure version; do not rank on semantic similarity alone.
- **Update, contradiction, forgetting:** Supersede old versions, retain an
  auditable change trail when permitted, and revoke unsafe or unauthorized
  procedures immediately.
- **Strengths:** Reuse of workflows, consistent tool use, and reduced repeated
  reasoning.
- **Failure modes:** Automating a one-off behavior, executing stale procedures,
  privilege escalation, and instruction injection stored as policy.
- **Operational cost:** Validation, sandboxing, and version compatibility are
  more expensive than storing plain text.
- **Governance implications:** Procedural memory can authorize actions; require
  provenance, capability checks, approvals, and an administrative revocation
  path.
- **External finding:** Mem2ActBench tests whether retrieved long-term memory is
  actually applied to tool selection and parameter grounding rather than only
  recalled in an answer [AM23].
- **Papai hypothesis:** Map to explicit user/group procedures and
  capability-gated tools, never to an unconstrained executable replay of
  conversation text [AM01, AM06].

### Prospective memory

- **Write policy:** Create a deferred intention only from an explicit request
  or a system-authorized workflow; require trigger, owner, scope, due
  condition, and completion policy.
- **Representation:** Durable intent plus temporal/event trigger, recurrence,
  state, dependencies, and idempotency key.
- **Retrieval policy:** Trigger-driven rather than similarity-first; surface
  relevant pending intentions during planning and status requests.
- **Update, contradiction, forgetting:** Reschedule or cancel explicitly;
  deduplicate triggers and record completion/failure without repeatedly
  executing the intention.
- **Strengths:** Follow-up, reminders, deferred tool use, and continuity across
  restarts.
- **Failure modes:** Missed or duplicate triggers, stale commitments, timezone
  errors, and action after authorization has changed.
- **Operational cost:** Durable scheduling, retries, leasing, and monitoring.
- **Governance implications:** A future action needs current authorization at
  execution time, not only at capture time; cancellation and auditability are
  mandatory.
- **External finding:** PM-Bench evaluates time- and event-triggered deferred
  intentions, updates, cancellations, false executions, and monitoring cost;
  its results have not been run or transferred here [AM26].
- **Papai hypothesis:** Treat scheduled work as a typed durable asset, separate
  from similarity-retrieved facts and process-local timers. Evaluate execution
  timing and authorization in a downstream agent track rather than treating a
  successful retrieval as task completion [AM26].

## Cross-cutting operating contexts

### Multi-party and group memory

- **Write policy:** Preserve author, audience, reply-to/thread, platform
  instance, storage scope, and config scope as first-class fields. A statement
  in a shared channel does not automatically become every participant's
  personal belief or preference.
- **Representation:** Keep simultaneous speaker-grounded assertions and
  audience-specific vocabulary without collapsing them into one anonymous
  group summary.
- **Retrieval policy:** Filter authorization first, then condition extraction
  and ranking on the asker, speaker, thread, audience, and requested point in
  time.
- **Update, contradiction, forgetting:** Apply an update to the attributable
  speaker and scope unless evidence establishes a group decision. Preserve
  concurrent disagreement rather than overwriting by lexical similarity alone.
- **Failure modes:** Flattened threads, lost attribution, one user's preference
  overwriting another's, role-specific term ambiguity, and a generic answer
  when the correct evidence depends on who asks.
- **External finding:** GroupMemBench reports substantial degradation for
  current memory systems on multi-party cases and reports that a simple BM25
  baseline matches or exceeds most evaluated agent-memory systems. This is E2
  preprint evidence on synthetic English data and remains `not_run` [AM24].
- **Papai hypothesis:** Add speaker-conditioned and thread-aware cases in a
  future protocol version, with Unicode lexical retrieval as an explicit
  baseline. The frozen v3 personal/group namespace tests do not establish
  multi-party belief tracking.

## Implementation families

### Raw or long context

- **Write policy:** Append raw turns or chunks until a token/segment budget is
  reached; long-context models may extend but do not remove that budget.
- **Representation:** Original tokens or segmented hidden-state caches.
- **Retrieval policy:** Direct attention over admitted context, sometimes with
  segment recurrence.
- **Update, contradiction, forgetting:** Usually append-only within a session;
  deletion requires reconstructing the admitted context/cache.
- **Strengths:** Maximum fidelity and minimal extraction assumptions.
- **Failure modes:** Cost and latency growth, position effects, irrelevant
  context, and no automatic scope, contradiction, or deletion semantics.
- **Operational cost:** High reader tokens and attention/cache memory.
- **Governance implications:** Raw sensitive text is repeatedly presented to
  the reader; admission and retention require authorization.
- **Papai hypothesis:** Use as a bounded recent window and exact-evidence
  fallback, not as the sole long-term design [AM02, AM03].

### Rolling and hierarchical summaries

- **Write policy:** Summarize at a size/time threshold; hierarchical variants
  recursively cluster and summarize leaves.
- **Representation:** One rolling synopsis or a tree of summaries linked to
  source leaves.
- **Retrieval policy:** Inject the running summary, or retrieve across levels
  of abstraction and then recover leaves.
- **Update, contradiction, forgetting:** Regenerate affected summaries from
  canonical leaves; never edit only a summary after an underlying correction
  or erasure.
- **Strengths:** Predictable context size and topic-spanning abstraction.
- **Failure modes:** Compounding omission, invented synthesis, temporal
  flattening, summary drift, and deletion residue.
- **Operational cost:** Summarizer calls at ingest/rebuild plus multi-level
  storage and retrieval.
- **Governance implications:** Summaries are derived personal data; lineage and
  cascade deletion are required.
- **Papai hypothesis:** Extend the shipped cumulative summary into rebuildable
  session/topic layers with leaf evidence [AM05, AM10].

### Structured event and fact stores

- **Write policy:** Append canonical events; derive normalized facts with
  schema validation, provenance, scope, confidence, and validity metadata.
- **Representation:** Typed rows/documents for events, entities, facts,
  decisions, procedures, and intentions.
- **Retrieval policy:** Apply hard metadata filters before ranking; assemble
  derived facts together with supporting events.
- **Update, contradiction, forgetting:** Version assertions, close validity
  intervals, preserve explicit contradiction, and hard-delete/rebuild all
  affected derivatives.
- **Strengths:** Auditability, deterministic filtering, temporal correction,
  and storage-engine portability.
- **Failure modes:** Schema rigidity, extractor error, entity conflation,
  orphaned evidence, and partial cascades.
- **Operational cost:** Extraction, validation, migrations, and index upkeep.
- **Governance implications:** Scope is part of each record's identity;
  provenance, minimization, correction, retention, and erasure must be tested.
- **Papai hypothesis:** Evaluate structured canonical events and derived facts
  as the shared foundation for the hierarchical and temporal-graph candidates
  [AM07, AM13, AM14].

### Sparse lexical retrieval

- **Write policy:** Tokenize and index authorized canonical/derived text on
  insert or update.
- **Representation:** Inverted index with term statistics; SQLite FTS5 is one
  possible engine, not the architecture.
- **Retrieval policy:** Query matching using BM25-like or engine-specific
  ranking after scope and lifecycle filters.
- **Update, contradiction, forgetting:** Update/delete index entries with the
  source row; verify tombstones and rebuild agreement.
- **Strengths:** Exact names, identifiers, rare terms, deterministic local
  execution, and no embedding dependency.
- **Failure modes:** Tokenizer/language mismatch, morphology and synonym gaps,
  query syntax surprises, and stale external-content indexes.
- **Operational cost:** Moderate index bytes and low local query cost.
- **Governance implications:** An index can leak erased or cross-scope terms
  even when the source table is correct.
- **Papai hypothesis:** Replace the ASCII token-overlap fallback with
  Unicode-aware lexical retrieval, but retain explicit scope and erasure tests
  [AM09, AM19].

### Dense vector retrieval

- **Write policy:** Embed eligible text with recorded model, dimension,
  normalization, content hash, and version; queue repair for missing vectors.
- **Representation:** Dense vectors linked to canonical record IDs.
- **Retrieval policy:** Embed the query, filter scope/lifecycle, run exact or
  approximate nearest-neighbor search, and apply deterministic tie-breaking.
- **Update, contradiction, forgetting:** Re-embed changed content, isolate
  incompatible versions, and remove vectors on hard erasure.
- **Strengths:** Semantic matching across paraphrases and vocabulary mismatch.
- **Failure modes:** Missing or stale embeddings, model drift, approximate
  recall loss, opaque similarity, and weak exact-identifier matching.
- **Operational cost:** Embedding calls, vector storage, index construction,
  and potentially large scans.
- **Governance implications:** Embeddings are derived data and need the same
  authorization, retention, export, and erasure controls as text.
- **Papai hypothesis:** Repair the current unversioned optional-vector path
  before considering a new vector engine [AM18].

### Hybrid retrieval and reranking

- **Write policy:** Maintain lexical and dense representations from one
  canonical record and version both.
- **Representation:** Multiple ranked lists plus metadata and optional
  reranker features.
- **Retrieval policy:** Retrieve both channels, fuse ranks (for example,
  reciprocal rank fusion), then rerank under a fixed candidate and context
  budget.
- **Update, contradiction, forgetting:** Apply the same lifecycle mutation to
  every channel and reject a result not backed by a currently valid canonical
  record.
- **Strengths:** Complements exact lexical and semantic evidence; rank fusion
  avoids comparing incomparable raw scores directly.
- **Failure modes:** One channel dominates through configuration, duplicate
  inflation, reranker nondeterminism, hidden candidate loss, and higher tail
  latency.
- **Operational cost:** Two retrieval paths plus fusion/reranking.
- **Governance implications:** Authorization must happen before result
  material reaches any reranker; log channel provenance without sensitive
  content.
- **Papai hypothesis:** The `corrected-hybrid` candidate should fuse both
  channels instead of the shipped semantic-or-lexical branch [AM09, AM18].

### Trust-aware admission and promotion

This is a cross-cutting control, not a replacement storage representation.

- **Write policy:** Classify origin, author, authorization context, trust,
  content type, and promotion state before deriving facts, summaries,
  reflections, procedures, or graph edges. Treat remembered text as data, not
  as a privileged instruction.
- **Representation:** Preserve immutable provenance and trust labels through
  every derivative. Distinguish user statements, external content, agent
  outputs, verified outcomes, administrator policy, and executable procedure.
- **Retrieval policy:** Separate relevance from authority. Apply authorization
  and trust admission before material reaches an action planner or reranker;
  similarity alone cannot promote a memory into policy.
- **Update, contradiction, forgetting:** Quarantine suspect derivatives,
  invalidate their descendants, and support reversible review without
  weakening hard erasure. A poisoned agent output must not gain trust merely by
  being recaptured.
- **Failure modes:** Persistent prompt injection, malicious demonstrations,
  poisoned retrieval geometry, self-reinforcing recapture, tool-call drift,
  and a trusted summary derived from an untrusted leaf.
- **External finding:** AgentPoison demonstrates that poisoning a small part of
  similarity-retrieved memory can steer later agent behavior while preserving
  benign behavior in its evaluated settings. It establishes a threat, not a
  generally effective defense [AM21].
- **Papai hypothesis:** Add poisoning and trust-propagation tests as a future
  non-scored security track. The frozen v3 scope and erasure gates do not
  establish resistance to malicious but authorized writes.

### Downstream utilization and action grounding

This is an evaluation boundary rather than an implementation family: a memory
hit has value only if the agent uses it correctly.

- **Read contract:** Return attributable evidence, current validity, and trust
  metadata under a bounded context budget.
- **Action contract:** Recheck present authorization and task state before
  selecting a tool or grounding parameters. A past authorization or procedure
  is not authority to act now.
- **Prospective contract:** Execute a deferred intention only at its valid
  time/event cue; suppress early, duplicate, cancelled, completed, or
  unauthorized actions and account for monitoring cost.
- **Failure modes:** Correct retrieval followed by the wrong tool, stale
  parameters, premature or repeated execution, missed cues, false alarms, and
  excessive polling.
- **External finding:** Mem2ActBench isolates memory-dependent tool use, while
  PM-Bench isolates future-cued execution and reports different
  precision/recall trade-offs across scaffolds [AM23, AM26].
- **Papai hypothesis:** Evaluate these outcomes in a separate reader/action
  track. Do not add them retrospectively to the frozen deterministic component
  score.

### Temporal knowledge graphs

- **Write policy:** Derive typed nodes/edges from canonical events with scope,
  provenance, event time, ingest time, and validity intervals.
- **Representation:** Entity/event nodes and typed, validity-bounded edges;
  the graph remains a projection.
- **Retrieval policy:** Seed from lexical/dense retrieval, then perform bounded
  authorized traversal with temporal predicates.
- **Update, contradiction, forgetting:** Close old validity intervals, add new
  assertions, preserve conflicting evidence, and rebuild or erase projected
  paths from canonical events.
- **Strengths:** Explicit relationships, multi-hop evidence, historical/current
  separation, and explainable paths.
- **Failure modes:** Extraction and entity-resolution errors multiply across
  paths; supernodes, stale edges, traversal explosion, and false temporal
  precision.
- **External finding:** AM27 reports that graph extraction quality can
  bottleneck downstream QA and that community granularity materially changes
  results in its tested domains. AM28's vendor-authored v1 evaluation reports
  only a small overall graph-over-base improvement; neither result is
  reproduced here [AM27, AM28].
- **Operational cost:** Adds extraction or normalization, graph-index
  maintenance, traversal, and rebuild cost beyond the canonical store. The
  relative cost must be measured rather than inferred from architecture.
- **Governance implications:** Edges infer relationships not stated in one
  source; enforce scope per node/edge and cascade deletion through projections.
- **Papai hypothesis:** Evaluate only as a bounded SQLite projection after the
  hybrid baseline is corrected. Explicit fixture relations validate projection
  and traversal behavior, not production entity or relation extraction [AM13,
  AM27, AM28].

### GraphRAG

- **Write policy:** Extract entities/relations or link chunks, form
  communities, and optionally generate community summaries.
- **Representation:** Graph index, source chunks, communities, and derived
  summaries.
- **Retrieval policy:** Local entity/path search for specific questions or
  community-summary aggregation for corpus-wide questions; some variants use
  graph diffusion.
- **Update, contradiction, forgetting:** Incrementally rebuild affected graph
  regions and summaries; retain leaf evidence and invalidate paths after
  erasure.
- **Strengths:** Corpus-level themes and relational/multi-hop retrieval that
  flat top-k chunks may miss.
- **Failure modes:** Expensive extraction, entity merge/split errors, community
  instability, unsupported synthesized claims, and evaluation dependence on
  an LLM reader/judge.
- **Operational cost:** Model-heavy indexing and larger derived state; query
  costs vary by local/global mode.
- **Governance implications:** Community summaries and inferred links need
  lineage, access controls, and deletion propagation.
- **External finding:** In AM27's factoid-QA experiments, deterministic
  template reports outperform LLM-generated graph reports in accuracy and
  efficiency. This motivates a simple verbalization baseline but does not
  transfer its score to conversational memory [AM27].
- **Papai hypothesis:** Use only when the pre-registered graph gate shows
  material relational/temporal value over the strongest non-graph candidate
  [AM11, AM12, AM27, AM28].

### Reflection and experience replay

- **Write policy:** After a salient outcome, store feedback, failure cause, or
  higher-level reflection; replay only relevant experiences on later attempts.
- **Representation:** Episodes plus reflective text, lessons, or updated
  strategy records.
- **Retrieval policy:** Rank by current task relevance, recency, importance,
  outcome, and diversity; cap repeated failures.
- **Update, contradiction, forgetting:** Attach reflections to evidence and
  outcome; supersede harmful lessons and allow deletion of both episode and
  derived reflection.
- **Strengths:** Learning from outcomes without changing base-model weights and
  consolidating repeated patterns.
- **Failure modes:** Self-generated false lessons, reward hacking, error
  reinforcement, irrelevant replay, and prompt injection persistence.
- **Operational cost:** Additional evaluation/reflection model calls and
  growing episodic storage.
- **Governance implications:** A reflection is an inference, not user-stated
  fact; label it, preserve provenance, and avoid using it as an authorization.
- **External finding:** AM22 reports that low-quality or misaligned retrieved
  experiences can propagate errors, and that evaluator quality matters when
  selecting additions and deletions in its tested agents [AM22].
- **Papai hypothesis:** Suitable for opt-in procedural suggestions, not
  automatic promotion into trusted fact or executable policy. Promote only
  after attributable outcome evidence, and keep replay eligibility distinct
  from canonical retention [AM05, AM06, AM17, AM22].

### Learned or adaptive memory policies

- **Write policy:** A trained or model-directed controller chooses when and
  what to store, retrieve, update, summarize, or discard.
- **Representation:** Explicit records plus policy state, action traces, and
  possibly learned memory modules.
- **Retrieval policy:** Policy-selected memory operations rather than only a
  fixed top-k query.
- **Update, contradiction, forgetting:** May learn lifecycle actions, but hard
  authorization, validity, retention, and erasure remain deterministic
  constraints outside the policy.
- **Strengths:** Can allocate limited context dynamically and adapt operations
  to task structure.
- **Failure modes:** Non-reproducible choices, opaque omissions, reward/data
  shift, unsafe deletion, and hidden model-call cost.
- **Operational cost:** Training/evaluation cost, extra inference steps, and
  difficult debugging.
- **Governance implications:** Learned policy must never decide access scope or
  override hard deletion; log actions and provide deterministic fallbacks.
- **Papai hypothesis:** Research input only until fixed-policy candidates
  establish a reproducible baseline and policy actions can be audited [AM07,
  AM08].

### Parametric memory

- **Write policy:** Update model weights, adapters, or learned side networks
  through training or model editing.
- **Representation:** Knowledge encoded in parameters rather than a
  user-addressable external record.
- **Retrieval policy:** Implicit activation during inference, sometimes
  combined with an external memory reader.
- **Update, contradiction, forgetting:** Requires retraining or model editing;
  locality, generalization, rollback, and proof of erasure are separate
  problems.
- **Strengths:** No explicit lookup in the simple inference path and potential
  task adaptation.
- **Failure modes:** Catastrophic interference, unintended generalization,
  uncertain provenance, version proliferation, and inability to enumerate or
  reliably delete one user's contribution.
- **Operational cost:** Training hardware, artifact storage, evaluation, and
  deployment/version management.
- **Governance implications:** Per-scope isolation, access inspection,
  correction, and erasure are substantially harder than in an external store.
- **Papai hypothesis:** Not eligible for the deterministic local default; use
  externally addressable, rebuildable records instead [AM04, AM20].

## Scale is multidimensional

Record count, source-token horizon, tenant and thread count, concurrent
operations, derivative fan-out, and reader-context budget are different scale
axes. Passing one does not establish the others.

- The frozen deterministic track measures retrieval and resource behavior at
  1,000, 10,000, and 100,000 records per scope.
- BEAM evaluates model-reader behavior over coherent conversations from 100K
  to 10M source tokens and reports results by memory ability [AM25].
- GroupMemBench adds multi-author, multi-channel, and thread structure [AM24].
- Neither external benchmark has been executed here, and neither changes the
  frozen v3 score. A future public track must report its model, prompts,
  revision, reader budget, and failures separately.

An E0 result at 100,000 records therefore supports only that recorded
record-count configuration. It cannot be described as proof of million-token
utilization, concurrent production load, or unbounded future scale.

## Future-proof operational acceptance matrix

The following are **engineering invariants** for a production recommendation,
not claims established by the cited benchmark papers. The frozen v3 component
track covers only the explicitly noted subset. Uncovered rows require a future
non-scored operational track or a new preregistered protocol version.

| Area                       | Required acceptance evidence                                                                                         | Frozen v3 coverage             |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Atomicity and crash safety | Interrupt between canonical and derivative writes; restart; prove idempotent replay or deterministic repair.         | Rebuild agreement only         |
| Concurrency                | Race duplicate ingest, out-of-order correction, and forget-versus-ingest within and across scopes.                   | Deterministic schedules only   |
| Erasure                    | Verify absence from canonical rows, FTS, vectors, summaries, graphs, caches, logs, WAL, and restored backups.        | Live-hit and non-recapture     |
| Retention and correction   | Exercise expiry, legal hold where applicable, user correction, export, and derivative invalidation.                  | Validity and hard-forget slice |
| Version migration          | Migrate and roll back schema, embedding, tokenizer, extractor, and graph versions without mixing incompatible state. | Version metadata and rebuild   |
| Recovery and integrity     | Restore a backup, replay later erasures, detect corruption, and meet measured rebuild-time and data-loss objectives. | Not covered                    |
| Security and trust         | Poison writes and recaptured outputs; prove trust labels and authorization survive every derivative.                 | Scope isolation only           |
| Load and observability     | Measure cold/warm and concurrent tail latency, saturation, queue bounds, failure counters, and repair backlog.       | Single-process latency/RSS     |

Passing the weighted component score is necessary but not sufficient for a
production-readiness claim. The final recommendation must list each uncovered
row rather than implying that representation choice alone makes the system
future-proof.

## Architecture is not a storage engine

The memory architecture owns capture, canonical representation, provenance,
scope, temporal validity, contradiction, retrieval/fusion, context assembly,
retention, erasure, and rebuild semantics. A storage engine owns persistence
and access primitives such as transactions, full-text indexes, vector search,
or graph traversal.

Therefore:

- adding a vector database does not repair missing embeddings, embedding
  version drift, extraction errors, invalid scope metadata, stale facts, or
  incomplete deletion;
- adding a graph database does not define entities, temporal validity,
  contradiction semantics, bounded traversal, or authorization;
- changing SQLite is justified only by the protocol's measured latency/RSS
  thresholds, independently of which memory representation wins; and
- every derived index must be checked against authorized, live canonical
  evidence at retrieval time and be reproducible after rebuild.

SQLite FTS5 demonstrates that one engine can supply a lexical access method
[AM19]. It does not determine the memory lifecycle above it.

## Benchmark coverage and evidence limits

The seeded benchmarks cover different slices and must not be merged as though
they shared one protocol:

- LongMemEval separates extraction, multi-session reasoning, temporal
  reasoning, knowledge update, and abstention [AM14].
- LoCoMo uses long multi-session conversations for question answering, event
  summarization, and multimodal dialogue generation [AM15].
- MemoryAgentBench uses incremental multi-turn tasks for accurate retrieval,
  test-time learning, long-range understanding, and conflict/forgetting
  behavior [AM16].
- MemBench distinguishes factual and reflective memory, participation and
  observation settings, and effectiveness, efficiency, and capacity [AM17].
- Mem2ActBench asks whether memory is applied to tool selection and parameter
  grounding [AM23].
- GroupMemBench adds speaker-conditioned beliefs, threaded group dynamics, and
  audience-dependent language [AM24].
- BEAM adds coherent 100K-to-10M-token conversations and ten memory abilities
  [AM25].
- PM-Bench evaluates execution of deferred intentions under updates,
  cancellation, distraction, and monitoring cost [AM26].

All eight remain `not_run`. Their reader models, judges, prompts, dataset
revisions, and metrics must be reported separately from papai's deterministic
component track. AM23-AM26 are future evidence inputs, not additions to the
frozen v3 corpus, weighted score, or decision gates.

## Frozen source index

| ID   | Source                                                                                     | Primary use in this taxonomy                    |
| ---- | ------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| AM01 | Cognitive Architectures for Language Agents (CoALA)                                        | Agent memory roles and memory actions           |
| AM02 | Transformer-XL: Attentive Language Models Beyond a Fixed-Length Context                    | Long/raw context and recurrence                 |
| AM03 | MemGPT: Towards LLMs as Operating Systems                                                  | Tiered context management                       |
| AM04 | Augmenting Language Models with Long-Term Memory                                           | Learned external-memory reader                  |
| AM05 | Generative Agents: Interactive Simulacra of Human Behavior                                 | Episodic retrieval and reflection               |
| AM06 | Reflexion: Language Agents with Verbal Reinforcement Learning                              | Reflective memory across attempts               |
| AM07 | A-Mem: Agentic Memory for LLM Agents                                                       | Structured notes, links, and memory evolution   |
| AM08 | Agentic Memory: Learning Unified Long-Term and Short-Term Memory Management for LLM Agents | Learned memory-operation policy                 |
| AM09 | Reciprocal Rank Fusion Outperforms Condorcet and Individual Rank Learning Methods          | Rank fusion                                     |
| AM10 | RAPTOR: Recursive Abstractive Processing for Tree-Organized Retrieval                      | Hierarchical summaries                          |
| AM11 | HippoRAG: Neurobiologically Inspired Long-Term Memory for Large Language Models            | Graph retrieval and multi-hop integration       |
| AM12 | From Local to Global: A Graph RAG Approach to Query-Focused Summarization                  | GraphRAG community summaries                    |
| AM13 | Zep: A Temporal Knowledge Graph Architecture for Agent Memory                              | Temporal graph design                           |
| AM14 | LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory                  | Long-term conversational benchmark              |
| AM15 | Evaluating Very Long-Term Conversational Memory of LLM Agents                              | LoCoMo benchmark                                |
| AM16 | Evaluating Memory in LLM Agents via Incremental Multi-Turn Interactions                    | MemoryAgentBench                                |
| AM17 | MemBench: Towards More Comprehensive Evaluation on the Memory of LLM-based Agents          | Factual/reflective benchmark                    |
| AM18 | Dense Passage Retrieval for Open-Domain Question Answering                                 | Dense dual-encoder retrieval                    |
| AM19 | SQLite FTS5 Extension                                                                      | Local sparse retrieval engine                   |
| AM20 | Locating and Editing Factual Associations in GPT                                           | Parametric factual memory and editing tradeoffs |
| AM21 | AgentPoison: Red-teaming LLM Agents via Poisoning Memory or Knowledge Bases                | Persistent-memory poisoning threat              |
| AM22 | How Memory Management Impacts LLM Agents                                                   | Selective promotion and experience quality      |
| AM23 | Mem2ActBench                                                                               | Memory-dependent tool action                    |
| AM24 | GroupMemBench                                                                              | Multi-party and thread-aware memory             |
| AM25 | Beyond a Million Tokens                                                                    | Token-horizon scale and BEAM                    |
| AM26 | PM-Bench                                                                                   | Deferred-intention execution                    |
| AM27 | Dissecting GraphRAG                                                                        | Graph extraction and reporting ablations        |
| AM28 | Mem0                                                                                       | Vendor graph-versus-base hypothesis             |
