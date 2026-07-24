<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Memory recall shadow-logging (thread B, P1 — the data-collection keystone)

**Status:** design
**Date:** 2026-07-24
**Related:**
[`docs/research/agent-memory/injection-architecture.md`](../../research/agent-memory/injection-architecture.md)
§9.1 (production data-collection — the plan this operationalizes),
[`docs/superpowers/specs/2026-07-24-memory-abstention-measurement-design.md`](2026-07-24-memory-abstention-measurement-design.md)
(P2 — the harness this spec gates on-demand),
[`docs/superpowers/specs/2026-07-24-memory-injection-feature-flag-design.md`](2026-07-24-memory-injection-feature-flag-design.md)
(thread A — the shipped opt-in flag Tier 3 would reuse),
[`docs/architecture/overview.md`](../../architecture/overview.md) §"Anonymity contract for `/stats/*`"
(the content constraint this spec inherits).

## Problem

Thread B recommends a tiered delivery model: pinned profile (Tier 1) + tool-pull `search_memory`
(Tier 2, already built) as the default, with query-aware auto-injection (`deriveInjectionQuery`,
Tier 3) shipped **only** on evidence. The open question that gates Tier 3 is:

> **How often does the model fail to pull a memory record that a query-aware retrieval would
> have surfaced — and would surfacing it have helped?**

If the model reliably calls `search_memory` when scope memory holds a relevant record, tool-pull
is sufficient and `deriveInjectionQuery` earns nothing but cache and hallucination cost. If there
is a real **under-trigger gap** — relevant records sitting unretrieved because the model never
looked — that is the evidence that justifies building the abstention harness (P2) and, if it
passes, Tier 3.

We cannot answer this by intuition, and the frozen `00`–`06` record cannot answer it: it scored
retrieval rank (nDCG) on a synthetic corpus with **no live reader** and **no production traffic**.
The gap is a property of real conversations and the configured reader's pull behavior. This spec
defines the smallest, safest instrument that measures it: **shadow-logging** — running the
retrieval Tier 3 *would* run, discarding the result, and logging only anonymized counts and
scores about what it *would* have surfaced versus what the model actually did.

## Research findings (why this instrument, and why it must come first)

Recorded as the evidence basis; these identify research inputs only — no external score is
transferred to papai.

- **Tool-pull recall depends on the model choosing to look, and that choice is unreliable.**
  Retrieval quality and answer quality decouple: a system can hold the right record and still
  never surface it because the reader did not query for it. Pull-propensity is strongly
  reader-model-dependent — the same axis that swings abstention 57–93% on LongMemEval
  (arXiv:2410.10813). This is exactly the gap auto-injection is *supposed* to close, so it must
  be measured on the configured reader, not assumed. *(LongMemEval; Memoria reader-separation.)*

- **Auto-injection's cost is real and orthogonal to its benefit.** Thread B established that
  query-aware injection pays a cache cost (position-0 invalidation) *and* a hallucination cost
  (near-miss fabrication, P2's subject), independent of placement. Paying those blind — before
  confirming the benefit exists — is the failure mode thread B exists to prevent.
  *(injection-architecture.md §6–§9; Chroma "Context Rot" 2025; arXiv:2510.05381.)*

- **Measure the cheap, safe signal before the expensive, content-bearing one.** Whether a gap
  *exists* is a content-free rate (did the model pull? did retrieval have something?). Whether
  closing it is *safe* needs a reader reading records (P2). Building P2 before knowing the gap is
  real risks a large harness for a gap that tool-pull already covers. P1 is the go/no-go for P2.

**Load-bearing consequence:** the shadow must be a **conservative floor**. If it uses the raw
user turn as its query (no derived query, no extra LLM call), a smarter `deriveInjectionQuery`
could only surface *more*. So a gap measured by the floor is a lower bound on the real gap — if
even the floor is small, Tier 3 is not worth building.

## Goal

An always-off-capable, sampled, **off-hot-path**, **content-free** production instrument that,
per configured reader model, measures the under-trigger funnel — how often a query-aware shadow
retrieval surfaces a plausibly-relevant record the model did **not** pull via `search_memory` —
and emits a pre-registered go/no-go signal deciding whether P2 (abstention harness) and Tier 3
(auto-injection) proceed at all.

## Non-goals

- **Injecting anything.** The shadow result is logged and discarded; prompt, cache, and answers
  are byte-for-byte unchanged. This spec adds zero tokens to any turn.
- **Judging relevance in production.** Whether a surfaced record was *actually needed* requires
  reading content; that judgment is deferred to the offline/synthetic harness (P2 corpus). P1
  measures the *rate at which a gap is possible*, not the answered-relevance rate.
- **`deriveInjectionQuery` itself.** The shadow query is the raw user turn (the floor), not a
  derived query — deriving the query is part of what Tier 3 would add and is out of scope here.
- **Changing capture, extraction, promotion, retrieval ranking, or `search_memory`.**
- **The reader-model choice.** Reader is a *reported variable* (results keyed per model id),
  never a target — mirroring the abstention spec.
- **Any `/stats/*` schema change.** P1 telemetry is a separate operator-only table; it inherits
  the anonymity contract but is not required to surface through `/stats/*`.

## Design

### The shadow retrieval

At a sampled memory-bearing turn, **after the turn has resolved** (the orchestrator already holds
`result.steps`; see `src/llm-orchestrator-events.ts`), run:

1. Embed the **raw last user message** (the floor query — no `deriveInjectionQuery`, no extra
   generation call; embedding only).
2. Run the same recall Tier 3 would run — `runRecallCascade` → `searchHybrid`
   (`src/long-term-memory/hybrid-search.ts`) against the resolved memory scope.
3. **Discard the records.** Compute and log only the anonymized fields below.

A **memory-bearing turn** is one where the scope has ≥1 active record (there is something a
shadow could surface). Scopes with zero active records are skipped *before* the embedding call —
a cheap `count` precondition that avoids paying the embedding + O(N) scan when the shadow is
guaranteed empty. This also contains the still-open unindexed vector-scan cost
(`rankRecordsBySimilarity`, `implementation-status.md` §"Still open").

### Sampling and placement

- **Off the hot path.** Shadow retrieval and logging run after the user-facing turn completes and
  never block or delay it. A test asserts the turn resolves independently of the shadow insert.
- **Deterministic sampling.** Sample a configurable fraction (default ~10%) by keyed-hashing
  `(storage-context-id, turn-ordinal)` and thresholding — reproducible, evenly spread, and free of
  time-of-day bias. (Production code, so `Math.random` is permitted, but deterministic sampling is
  preferred for reproducibility and even scope coverage.)
- **Kill switch.** A single config/env flag, **default OFF**. This is instrumentation; a
  deployment opts in to run the study, and it is removable once the go/no-go is recorded.
- **Bounded cost.** Sampling × the zero-record precondition keeps added load a small fraction of
  memory-bearing turns; the shadow reuses the existing embedding + hybrid path (no new index).

### What is logged (content-free — inherits the `/stats/*` anonymity contract)

A dedicated append-only table (e.g. `memory_recall_shadow_log`), async insert, with a retention
policy (telemetry — prune after the study). **All** high-cardinality strings are keyed-hashed with
the existing `stats_anonymity_salt`; **no** free-form content is stored. Fields:

| Field | Type | Purpose |
|-------|------|---------|
| `scope_hash` | keyed hash | which memory scope (personal/group), un-reversible |
| `context_hash` | keyed hash | distinct-conversation counting / dedupe |
| `turn_ref` | opaque turn id / ordinal | join key, already opaque |
| `reader_model_id` | enum-ish | pull-propensity is model-dependent — **key results by this** |
| `active_record_count` | int | scope size (bounded signal) |
| `shadow_query_hash` | keyed hash | distinct-query counting; compare vs the model's pull query |
| `shadow_query_len_bucket` | enum bucket | coarse length, never the text |
| `shadow_hit_count` | int | records above the relevance threshold |
| `shadow_top_score` | float | top fused RRF score |
| `shadow_top_provenance` | enum | current-thread / group / other-thread (recall-cascade layer) |
| `shadow_top_record_hash` | keyed hash | detect the *same* record repeatedly missed across turns |
| `model_pulled` | bool | did `search_memory` fire this turn |
| `pull_count` | int | how many times it fired |
| `pull_query_hash` | keyed hash | did the model search for something different than the turn? |
| `pull_result_count` | int | how many records the model's pull returned |
| `shadow_pull_overlap` | int | record-id overlap between shadow top-k and the model's pull |

**Never stored:** user message text, record bodies/snippets, `search_memory` query text,
usernames, workspace/project/task/status names, URLs, filenames — any free-form content. A leak of
any of these is a **release-blocking defect**, identically to `/stats/*`.

### The under-trigger funnel (the metric)

P1's output is a funnel over sampled memory-bearing turns, keyed **per reader model** (never
averaged across models — that hides the exact variance that decides the call):

1. **Sampled memory-bearing turns** — denominator.
2. **`shadow_hit`** — `shadow_hit_count ≥ 1` above the pre-registered score/rank threshold: the
   shadow surfaced a plausibly-relevant record.
3. **Under-trigger candidates** = **`shadow_hit && !model_pulled`** — the shadow had something and
   the model never looked. **This bucket's rate is the P1 headline.**
4. *(deferred to P2 / offline judging — not computed in production)* of bucket 3, the fraction
   where the record was *actually needed to answer well* = the **real** under-trigger rate.

Companion signals from the same rows:

- **Overlap when the model does pull** (`model_pulled && shadow_pull_overlap > 0`): the records are
  *valuable* — the model finds the same ones the shadow does when it bothers to look. High overlap
  + high bucket-3 rate is the strongest case for Tier 3 (valuable records, inconsistently pulled).
- **Over-pull** (`model_pulled` with low `pull_result_count` / low overlap): the model looks and
  finds little — a secondary signal that auto-injection could *reduce* wasted pulls.
- **Repeated-miss** (same `shadow_top_record_hash` across many `!model_pulled` turns): a specific
  record the model persistently ignores — a sharp, content-free case for surfacing it.

### Decision gate (pre-registered)

Fix these **before** collection (frozen-protocol discipline; no post-hoc goalpost-moving). Collect
until **N** sampled memory-bearing turns across **≥ M distinct scopes** (so no single chatty user
decides it) — e.g. N = 1000, M = 50 — per reader model.

- **Stop (tool-pull suffices).** If bucket 3 (`shadow_hit && !model_pulled`) is **below** the
  pre-registered rate (e.g. < 5% of memory-bearing turns): the model's own pulling covers the
  ground. Shelve `deriveInjectionQuery`, **do not build P2 or Tier 3.** Tier 2 stands.
- **Proceed to P2.** If bucket 3 is **at/above** the rate **and** the overlap signal shows those
  records are the same ones the model values when it looks: a real gap of valuable records exists.
  Build the abstention harness (P2) to test whether **auto-injecting** them is *safe* before any
  Tier 3 ship. P1 proves the gap; P2 proves closing it does not fabricate.

Because the shadow query is the raw-turn floor, a below-threshold bucket 3 is a strong stop signal
(the real gap is ≤ the measured floor); an at/above bucket 3 is a *lower bound* worth escalating.

### Threats to validity (recorded)

- **Floor underestimate.** Raw-turn shadow < derived-query shadow. Conservative by design; noted so
  an at-threshold result is read as a lower bound.
- **Profile already covers it.** The model may skip `search_memory` because layer A/B (summary /
  profile) already answered — a *non*-gap that inflates bucket 3. Cannot be separated from
  content-free logs; the offline judged stage (P2 corpus) removes it. Reported as a known
  over-count on bucket 3.
- **Selection bias.** Deterministic hash sampling avoids time-of-day skew; the ≥ M-distinct-scopes
  floor avoids single-user domination.
- **Cost on large scopes.** The shadow reuses the unindexed O(N) scan; sampling + zero-record
  precondition bound it, but large-scope deployments should watch added load.
- **Reader dependence.** Pull propensity varies by model; results are keyed per `reader_model_id`
  and never averaged, mirroring the abstention spec.

## Testing (TDD)

1. **Off-hot-path** — the user-facing turn resolves without awaiting the shadow retrieval/insert
   (injected clock/spy; assert ordering/independence).
2. **Sampling determinism** — the same `(context, ordinal)` is always sampled-or-not across runs;
   the fraction is honored over many synthetic turns.
3. **Zero-record precondition** — a scope with no active records performs **no** embedding call and
   writes no row (or a row flagged skipped with `shadow_hit_count = 0`), asserted via spied deps.
4. **Anonymity guard** — a schema test asserts the log row contains **only** hash / count / enum /
   score / bool columns; it **fails** if any free-text column is added (guards the release-blocking
   content constraint, mirroring `/stats/*`).
5. **Overlap computation** — `shadow_pull_overlap` correctly counts record-id intersection between
   the shadow top-k and the model's `search_memory` results on a fixture turn.
6. **Kill switch** — flag OFF ⇒ no shadow retrieval, no rows, no added latency.
7. **Reader-model keying** — rows carry `reader_model_id`; the funnel aggregation refuses to
   average across model ids.

## Relationship to thread B

This spec operationalizes **§9.1** of `injection-architecture.md` (production data-collection) and
is the **precondition for P2**: the abstention harness
([`2026-07-24-memory-abstention-measurement-design.md`](2026-07-24-memory-abstention-measurement-design.md))
is built **only if** P1's decision gate says the under-trigger gap is real. In the thread-B tier
model: Tier 1 (profile) and Tier 2 (tool-pull) ship regardless; **P1 decides whether Tier 3
(auto-injection) is even worth measuring**, and P2 decides whether it is *safe*. P1 is the cheap,
content-free, always-off-capable instrument that replaces "we're guessing about injection" with
"we have the data to decide."
