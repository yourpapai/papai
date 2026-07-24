<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Memory abstention / hallucination measurement (thread B gate)

**Status:** design
**Date:** 2026-07-24
**Related:**
[`docs/research/agent-memory/injection-architecture.md`](../../research/agent-memory/injection-architecture.md)
§9 (the gate this spec operationalizes),
[`docs/superpowers/specs/2026-07-24-memory-injection-feature-flag-design.md`](2026-07-24-memory-injection-feature-flag-design.md)
(thread A — the shipped opt-in flag),
[`docs/research/agent-memory/03-benchmark-and-corpus.md`](../../research/agent-memory/03-benchmark-and-corpus.md)
(the frozen deterministic corpus this composes with),
[`docs/research/agent-memory/06-recommendation.md`](../../research/agent-memory/06-recommendation.md)
(nDCG-only, no live reader — the gap this fills).

## Problem

Any mechanism that **auto-injects** long-term memory records into a turn — query-aware
injection (`deriveInjectionQuery`, defect 6) included — risks converting an honest
*"I don't know"* into a **confident fabrication** whenever scope memory holds only
topically-adjacent near-misses rather than a real answer. Force-feeding the top-*k* "closest"
records means that on a question memory *cannot* answer, the model is handed plausible-looking
but wrong context and tends to use it.

Thread B established that this **hallucination cost is orthogonal to placement**: tail
injection and cache-friendly placement remove the *cache* cost but do nothing about this one.
It is the failure mode most likely to produce *silently* wrong answers in production (a
fabricated answer looks fine until it is wrong), and it is **currently unmeasured** — the frozen
`00`–`06` record scored retrieval rank (nDCG) only, with no live reader. We must not ship any
auto-injection until this specific cost is quantified against the alternative (tool-pull) on
papai's own reader-level data.

This spec defines that measurement: an offline **abstention test** that any auto-injection
proposal must pass before shipping.

## Research findings (why this test, and why it must be adversarial)

Recorded as the evidence basis; these identify research inputs only — no external score is
transferred to papai.

- **The reader, not retrieval, is the bottleneck — and abstention is its most volatile axis.**
  On LongMemEval, holding retrieved context *constant* and varying only the answering model
  swings abstention accuracy **56.67%–93.33%** — the largest reader-dependent spread of any
  category (one model said "I don't know" 3 times where another said it 79 times on the *same*
  evidence). Retrieval quality ≠ answer quality; a system can retrieve perfectly and still
  fabricate. *(LongMemEval arXiv:2410.10813; Memoria reader-separation replication.)*

- **Abstention is unsolved and fragile.** AbstentionBench (20 datasets, 35k+ queries, six
  scenario types) finds bigger/more capable models are **not** reliably better at knowing when
  not to answer, and that reasoning/RL fine-tuning tends to **degrade** abstention — a live risk
  if papai's configured reader is reasoning-tuned. *(arXiv:2506.09038.)*

- **Irrelevant-but-plausible context actively causes fabrication.** A **single** distractor
  measurably lowers accuracy, and *coherent-but-wrong* content hurts **more** than random noise;
  abstention behavior is strongly reader-model-dependent (Claude-family abstained more, GPT-family
  hallucinated more under distractors). *(Chroma "Context Rot", 2025.)* Padding with irrelevant
  material degrades answers **even when the correct answer is also present** — decoupling
  "retrieval succeeded" from "answer is correct." *(arXiv:2510.05381.)*

- **Why injection surfaces near-misses at all.** Recency ordering (today's layer C) is not
  relevance, and even relevance-ranked top-*k* returns *salient-but-wrong* items when no true
  answer exists — the composite recency+importance+relevance scoring exists precisely because
  single-signal ranking misfires. *(Generative Agents arXiv:2304.03442.)*

- **Scoring model.** LongMemEval scores answers with an LLM-as-judge (binary auto-eval label)
  and reports retrieval and reader metrics **separately** — the structure this spec copies.

**Load-bearing consequence:** a test that seeds unanswerable questions with *empty* scope memory
is a softball — retrieval returns nothing and every arm trivially abstains (the LoCoMo
"everything ties" trap). The test must be **adversarial**: seed near-miss distractors that
hybrid retrieval *will* surface, so the injection arm is actually stressed.

## Goal

A reproducible offline harness that quantifies, **per delivery mechanism and per reader model**,
the rate at which the system fabricates an answer to a question memory cannot answer — plus an
over-abstention control — yielding a pre-registered pass/fail bar that gates thread-B Tier 3
(auto-injection). Placement is held constant (tail) so this isolates the hallucination axis from
the cache axis.

## Non-goals

- The full multi-arm reader-eval harness and production shadow-logging (broader; thread B §9.1–§9.2).
- Answer-quality measurement on answerable questions, except as the over-abstention control.
- The placement decision (orthogonal — this test fixes placement at the tail).
- Choosing or tuning the reader model (the reader is a *reported variable*, not a target here).
- Any change to capture, extraction, promotion, retrieval, or `search_memory`.

## Design

### Corpus: the adversarial abstention slice

An **unanswerable set** of *N* questions, each with **no** true answer in the seeded scope
memory, spanning four categories (AbstentionBench scenarios mapped to papai's model):

1. **Absent** — nothing about the topic exists in scope memory.
2. **False-premise** — the question presupposes a fact memory never recorded or contradicts.
3. **Stale / superseded** — a fact existed but is past `validUntil`/`expiresAt` or was
   invalidated (exercises papai's existing query-time validity predicate).
4. **Underspecified** — an ambiguous referent memory cannot disambiguate.

**Near-miss distractor seeding (the crux).** For each unanswerable question, seed one or more
records that are embedding-close *and* lexically overlapping but factually wrong or irrelevant,
so `runRecallCascade` → `searchHybrid` **will** surface them and the injection arm **will**
inject them. Record each distractor's measured embedding distance / FTS overlap to the question
so the adversarial property is checkable and reproducible.

A matched **answerable control set** (questions memory *can* answer, with ground-truth evidence
records) runs alongside to measure over-abstention — a mechanism that "wins" abstention by
refusing everything is useless.

The corpus is deterministic (fixed seeds) and composes with the frozen synthetic suite in
`03-benchmark-and-corpus.md` as its backbone. It runs on a **separate reader track** and is
**never blended** into the sealed retrieval results (per the README reproducibility boundary).

### Arms (delivery mechanisms; placement fixed at tail)

| Arm | Mechanism | Purpose |
|-----|-----------|---------|
| A0 | No memory | Reader's baseline abstention behavior (floor) |
| A1 | Tool-pull (`search_memory`) | The recommended default — model chooses to look, may hit the near-miss |
| A2 | Tail query-aware injection | The mechanism on trial (`deriveInjectionQuery`, tail-placed) |
| A3 *(optional)* | Position-0 injection | Contrast confirming placement moves the *cache* axis, not this one |

### Metrics (per arm, per reader model)

- **Abstention accuracy** — correctly declined / total unanswerable.
- **Fabrication rate** — confidently answered an unanswerable question. *Primary safety metric.*
- **Attributable fabrication** — fabrication whose answer demonstrably used a specific
  injected/retrieved **near-miss** record. Isolates the harm the *mechanism* causes from the
  reader's baseline hallucination (the delta that matters).
- **Over-abstention rate** — incorrectly declined on the answerable control. Guardrail.
- Retrieval and reader logged **separately**: what each arm surfaced vs. what the model did with it.

### Judge

- LLM-as-judge, **version-pinned**, four labels: `correct` / `fabricated` /
  `correctly-abstained` / `over-abstained` (the last only on the control).
- **Validate against a human-labeled subset** before trusting; report judge–human agreement.
- **Reader model is a variable, not a constant.** Abstention is reader-dependent (57–93%
  swing), so fix and report **per papai-configured reader model**; re-run when the default model
  changes. Do not average across models — that hides the exact variance that decides the call.

### Decision gate (pre-registered)

Fix thresholds **before** running (mirrors the frozen-protocol discipline of the `00`–`06`
record; avoids post-hoc goalpost-moving). Arm A2 (tail auto-injection) **passes** only if, versus
A1 (tool-pull) on the same corpus and reader:

1. it does **not** increase **fabrication rate** beyond the pre-registered threshold; **and**
2. **attributable fabrication** from injected near-misses stays below its threshold; **and**
3. **over-abstention** on the control does not regress (it did not buy safety by refusing more).

If A2 fails (1) or (2) — the predicted outcome given the research — `deriveInjectionQuery` stays
shelved and tool-pull (Tier 2) stands. The decision is thereby made on papai's own reader-level
data, which the frozen record could not provide.

## Harness validation (TDD)

1. **Deterministic corpus** — fixed seeds; near-miss records carry recorded embedding-distance /
   FTS-overlap to their question, so the adversarial property is asserted, not assumed.
2. **Retrieval sanity** — assert that on the unanswerable set, `runRecallCascade` actually
   surfaces the seeded near-miss for the injection arm (otherwise the arm is untested).
3. **Judge agreement** — judge labels validated against a human-labeled subset; agreement
   reported and pinned.
4. **Track isolation** — outputs written to the separate reader track; a test asserts they are
   not merged into the sealed `agent-memory/` retrieval artifacts.
5. **Reader-model reporting** — results keyed by reader model id; no cross-model averaging.

## Relationship to thread B

This spec fully specifies clause 2 of the thread-B decision rule
(`injection-architecture.md` §9.3): *"arm 4 does not regress the abstention slice."* Tier 1
(pinned profile) and Tier 2 (tool-pull) ship without it; **Tier 3 (auto-injection) cannot ship
until A2 clears this gate.**
