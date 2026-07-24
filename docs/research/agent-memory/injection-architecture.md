<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# How should long-term memory reach the conversation? (thread B)

**Status:** research / design — forward-looking, **not** part of the frozen `00`–`06`
evidence record. No external published score is transferred to papai; cited numbers
identify research inputs only, exactly as the sealed record requires.
**Date:** 2026-07-24
**Related:**
[`01-current-state-audit.md`](01-current-state-audit.md) §"Unconditional turn injection",
[`06-recommendation.md`](06-recommendation.md),
[`../prompt-optimization/07-memory-context.md`](../prompt-optimization/07-memory-context.md),
[`docs/superpowers/specs/2026-07-24-memory-injection-feature-flag-design.md`](../../superpowers/specs/2026-07-24-memory-injection-feature-flag-design.md)
(thread A — the shipped safety valve),
[`docs/superpowers/specs/2026-07-23-memory-hybrid-retrieval-design.md`](../../superpowers/specs/2026-07-23-memory-hybrid-retrieval-design.md)
(defect 6, `deriveInjectionQuery`, deferred).

---

## 1. The question, and why it is open

Thread A shipped a safety valve: record injection (layer C) is now **opt-in, default
off** (`inject_records`, migration 070). The durable profile (layer B) is still injected
every turn; only the volatile record bundle is suppressed by default. That made the
default prompt prefix stable and cache-friendly, but it deliberately **postponed** the real
question:

> Given that long-term memory records exist and are captured, **by what mechanism should a
> relevant record reach the model at the moment it is needed** — pushed into the prompt
> (injection), pulled by the model (a tool), or selected by a separate reasoning step
> (multi-call)?

The originally-proposed answer, `deriveInjectionQuery` (defect 6), was: derive a search
query from the recent conversation, retrieve relevant records, and inject them each turn.
The user's instruction is correct and is the spine of this document:

> *"Before deciding should we use `deriveInjectionQuery` or not, we need to collect real
> data, real queries, some tests."*

This document does two things. **Part I** (§3–§7) is the deep research: what the delivery
mechanisms are, what the external state of the art actually does, and what the evidence says
about each. **Part II** (§8–§9) is the answer to the user's instruction: a recommended
architecture that can ship *now* on existing machinery without betting on an unmeasured
design, plus a concrete measurement/data-collection plan — including an offline reader-eval
harness — that produces the real data needed to decide `deriveInjectionQuery` on evidence
rather than intuition.

---

## 2. What already exists in papai (codebase grounding)

Three facts about the current implementation frame every option below.

1. **The injection site is position 0.** `buildMessagesWithMemory`
   (`src/conversation.ts:61`) prepends a single low-trust `system` message *ahead of the
   entire conversation history*. It carries layer A (compacted summary + facts), layer B
   (profile), and — when `injectRecords` is on — layer C (records via
   `listMemoryRecords({ status:'active', limit:3 })`, ordered `desc(lastSeenAt)`).
   Layer C is **recency-ordered, query-unaware**: it is the *N* most-recently-touched
   records, not the *N* most-relevant.

2. **Query-aware retrieval is already built — and wired only to a tool.** `search_memory`
   (`makeSearchMemoryTool`, `src/tools/memory.ts`) calls `runRecallCascade`
   (`src/long-term-memory/recall-cascade.ts`) → `searchHybrid` — FTS5 lexical + version-gated
   dense channel, RRF fusion, provenance layering (current / group / other-thread), query-time
   validity/expiry predicate, `RECALL_DEFAULT_LIMIT = 8`. This is precisely the machinery
   `deriveInjectionQuery` would reuse; the *only* thing separating "tool-pull" from
   "query-aware injection" today is **who forms the query and where the result is placed**.

3. **papai is provider-agnostic (BYOK, OpenAI-compatible via Vercel AI SDK).** Prompt-cache
   specifics differ per provider, but the load-bearing principle — a cache keys on a **stable
   prefix**; the first byte that changes invalidates everything after it — is universal across
   Anthropic, OpenAI, and the OpenAI-compatible endpoints papai targets. Placement, not any
   single vendor's price sheet, is what makes a design cache-friendly or cache-hostile.

---

# Part I — Research

## 3. The four delivery mechanisms

The design space is not "inject vs. don't." It is a matrix of **who decides what memory is
relevant** × **where the memory lands in the request**. Four archetypes cover it:

| # | Mechanism | Who forms the query / selects | Where memory lands | Cache posture | Latency cost |
|---|-----------|-------------------------------|--------------------|---------------|--------------|
| **A** | **Position-0 injection** (today, incl. `deriveInjectionQuery`) | Harness (recency, or a derived query) | Prompt prefix, position 0 | **Hostile** — volatile block ahead of everything | None extra (write-side) |
| **B** | **Cache-friendly injection** | Harness (recency or derived query) | *Trailing* block or mid-conversation `system` message appended to `messages[]` | Neutral→friendly — stable prefix preserved | None extra (write-side) |
| **C** | **Tool-pull / JIT** (`search_memory`, built) | **Model** (decides if/when/what) | Tool-result message at the tail | **Friendly** — arrives only when invoked, after prefix | +1 round-trip *when used* |
| **D** | **Agentic multi-call selection** | A separate LLM reasoning loop | Tool-results / re-injected context | Variable | +5–15 calls, +4–8 s |

The central tension is between **relevance** (which pushes toward query-aware selection and,
naively, toward injecting whatever the retriever finds) and **cost/cache-friendliness** (which
punishes any volatile content placed before the stable prefix). Thread A already resolved this
tension for the *default* by removing the volatile block; the open question is what to build
back, and in which quadrant.

## 4. What the external state of the art actually does

The research surveyed the production and academic memory systems. The striking finding is that
**the systems most often cited as "auto-inject memory" do something more disciplined than
papai's position-0 recency block**, and the ones that inject aggressively pay for it with heavy
curation.

- **MemGPT / Letta — archival memory is tool-called, not injected.** Letta's own framing:
  archival fragments *"cannot be pinned to the context window, and must be queried on-demand
  via tools"* (`archival_memory_search()`), and *"the LLM decides if, when, and what to
  retrieve using tools, unlike passive retrieval-augmented generation systems."* Only small,
  stable, always-relevant "core memory" is pinned into the prompt — and even that is hard-capped
  (default 2,000 chars/block). This is the clearest precedent for a **tiered** answer: pin the
  small stable thing, tool-pull the large volatile thing. *(MemGPT arXiv:2310.08560; Letta docs.)*

- **mem0 — an explicit `search()` API; auto-injection is a wrapper, not the core.** Core mem0
  exposes `memory.search(query, top_k)` called explicitly by the app; some SDK integrations wrap
  it into automatic injection. Notably, mem0 *simplified* its extraction from a two-phase
  LLM reason-about-updates pipeline toward **single-pass ADD-only** for latency/cost, and its
  retrieval fuses **three parallel signals** (vector + BM25 + entity) — echoing papai's own
  hybrid. Evidence that even a search-first system mostly gets consumed as pipeline injection —
  and that vendors actively trade multi-call salience reasoning *down* for cost. *(mem0
  arXiv:2504.19413; README, 2026.)*

- **Zep / Graphiti — pipeline-injected, but a *curated, graph-compressed* block.** Zep's
  `get_user_context()` builds a formatted context block the app injects every turn — pattern (a).
  But the win is **token reduction and structure**, not retrieval cleverness: average context
  115k → 1.6k tokens (~98.6%), ~11× faster end-to-end, and on LongMemEval +15–18 pp over
  full-context. Its authors call the Deep-Memory-Retrieval gains "marginal" and are explicit
  that the real benefit is compression. Lesson: **if you inject, inject a small curated block,
  not a raw top-k dump.** *(Zep arXiv:2501.13956.)*

- **Generative Agents — the canonical "recency alone is wrong."** Retrieval score =
  `recency + importance + relevance` (each min-max normalized), where importance is an LLM
  poignancy rating elicited at *write* time and relevance is query-embedding cosine. This is the
  citable foundation for the single most important critique of papai's layer C: **recency
  ordering is not retrieval.** Every modern system (Zep, mem0, Letta) reimplements a composite
  of this. *(Park et al., arXiv:2304.03442.)*

- **LangMem — names the exact axis.** *Hot-path* ("conscious") memory tools add *"perceptible
  latency"* but respond to what's needed *now*; *background* ("subconscious") formation avoids
  per-turn cost but only writes — surfacing still needs a separate inject-or-tool step. Its own
  hot-path quickstart defaults to **auto-injection via a `prompt()` that searches the store**,
  with an agentic `create_search_memory_tool` offered as the alternative — i.e., both patterns
  are first-class and the choice is a deliberate latency/responsiveness trade. *(LangMem docs.)*

- **Agentic vs. pipeline RAG — autonomy has new failure modes.** Letting the model drive
  retrieval (pattern D) is adaptive but multiplies calls/latency (illustrative: 5–15 calls,
  4–8 s, vs. 1 call sub-second for naive RAG) and introduces *"retrieval thrash," "tool storms,"
  and "context bloat."* The recommended production pattern is **conditional / self-route**: gate
  the expensive path behind a cheap sufficiency check rather than always paying for it.
  *(Towards Data Science; Li et al. self-route arXiv:2407.16833; LaRA arXiv:2502.09977 —
  "No Silver Bullet for LC or RAG Routing.")*

- **Query derivation should be tiered.** For turning a conversation into a search query: cheap
  deterministic construction (concatenate recent turns) as the default, escalating to
  LLM-based rewriting/HyDE **only when the naive query is weak** (short utterances, pronouns,
  topic shifts). HyDE *"improves semantic alignment, not recall,"* and its cost is paid per
  query — so it belongs behind a low-confidence gate, not on every turn. This is the disciplined
  shape of `deriveInjectionQuery`: **conditional, not universal.** *(HyDE arXiv:2212.10496.)*

## 5. What the evidence says about *injecting* memory

The eval-methodology research surfaced a body of results that bear directly — and adversarially —
on the "just inject relevant records each turn" instinct behind `deriveInjectionQuery`:

- **The reader, not retrieval, is often the bottleneck.** On LongMemEval, holding the retrieved
  context *constant* and varying only the answering model swings accuracy 30+ points on some
  categories (Knowledge-Update 58→90%, Abstention 57→93%). **Better recall is necessary but not
  sufficient** — which is exactly why nDCG-style retrieval scores (all papai has measured so far)
  cannot tell us whether injection helps answers. *(LongMemEval arXiv:2410.10813; Memoria
  replication.)*

- **Irrelevant-but-plausible injected content actively hurts — even with perfect recall.**
  "Lost in the Middle" (U-shaped position curve — the middle of the context is the low-attention
  zone), Chroma's "Context Rot" (accuracy degrades non-uniformly with length *below* the limit;
  a *single* distractor measurably hurts; coherent-but-wrong structure hurts *more* than random
  noise), and "Context Length Alone Hurts … Despite Perfect Retrieval" (arXiv:2510.05381 — padding
  with irrelevant material degrades accuracy even when the correct answer *is* present) converge
  on one implication: **blind top-k injection is structurally closer to the distractor failure
  mode than to precise RAG.** More injected context is not free even when it's on-topic.

- **Abstention is fragile and reader-dependent — and injection is where it breaks.** On the
  out-of-memory slice, models range 57–93% at correctly saying "I don't know," and
  reasoning-tuned models get *worse* at abstaining (AbstentionBench arXiv:2506.09038). Auto-
  injecting the top-k "closest" records when *none* is actually relevant is precisely the input
  that turns a fragile abstainer into a confident fabricator. **This is the highest-value thing to
  measure before shipping any auto-injection.**

- **But sometimes stuffing everything wins.** On LoCoMo (conversations only 16–26k tokens), a
  plain full-context baseline (~73% J-score) beat mem0's best memory pipeline (~68%). The caution
  cuts both ways: don't assume retrieval/injection beats "just include it," *and* don't trust a
  benchmark whose corpus is small enough that everything ties. **Any papai eval corpus must be
  large enough that a stuff-everything baseline is not near-ceiling**, or the result is
  uninformative.

**Synthesis of §4–§5:** the evidence does not crown a universal winner (LaRA/self-route are
explicit on this), but it strongly disfavors papai's *specific* legacy design — a raw,
recency-ordered, position-0 top-k block — on every axis: it is query-unaware (Generative
Agents), un-curated (Zep), placed in the worst position (Lost-in-the-Middle, cache), and most
dangerous exactly where abstention matters. Thread A was right to turn it off. The question is
what to turn *on*.

## 6. The caching economics (why placement is a first-class design variable)

For Anthropic-family models the numbers are concrete (authoritative, via the `claude-api`
skill): cache **write** = 1.25× base input (5-min TTL) / 2× (1-hour TTL); cache **read** ≈ 0.1×;
break-even at 2 requests (5-min) / 3 (1-hour); minimum cacheable prefix is model-dependent
(4096 tokens on Opus 4.8). The **prefix-match invariant** is the universal part: render order is
`tools → system → messages`, and the first changed byte invalidates the cache for everything
after it. Practitioner reports show the effect is large — moving dynamic content from the
system/prefix area to the *end* of the prompt raised cache-hit rates 23%→71% and 7%→84% in
documented cases, cutting cost up to ~59%.

Two consequences for memory placement:

1. **Position-0 injection (A) is the worst possible placement.** A volatile memory block at the
   very front invalidates the cache for the *entire* conversation every turn it changes.
   `deriveInjectionQuery` makes layer C change *every* turn by construction — it maximizes the
   damage. A smaller block that busts the cache each turn can cost more in practice than a larger
   *stable* one.

2. **There are cache-safe places to inject.** A trailing block, or — on Opus 4.8 — a
   mid-conversation `{role:"system"}` message appended to `messages[]`, preserves the cached
   prefix. This is pattern **B**, and it is what makes query-aware injection *considerable* at all
   rather than automatically disqualified. Tool-pull (**C**) is inherently in this camp: the
   tool-result lands at the tail, touching nothing before it.

**Placement is therefore not an implementation detail to defer — it is co-equal with the
inject-vs-pull decision.** Any query-aware injection that ships must be pattern B, never A.

## 7. Reframing `deriveInjectionQuery`

Given §4–§6, `deriveInjectionQuery` is not one decision but three, and its original framing
conflated them:

- **Query formation** — derive a query from the conversation. *Verdict: valuable, and should be
  tiered* (deterministic default, LLM-rewrite only on weak-query signals). This is genuinely
  missing today for the injection path (though `search_memory` already accepts a model-formed
  query).
- **Selection** — rank records by relevance, not recency. *Verdict: clearly correct
  (Generative Agents); `searchHybrid` already does it.*
- **Delivery** — push the result into the prompt each turn. *Verdict: the contested part.* The
  evidence says: only as a small, curated, confidence-gated block (Zep), placed cache-safely
  (§6, pattern B), gated on need (self-route), and **validated against an abstention slice before
  shipping** (AbstentionBench). Otherwise it is a distractor generator.

The first two are improvements to retrieval that the *tool* path already gets for free. Only the
third — automatic per-turn delivery — is the actual bet, and it is the one with mixed evidence and
zero papai data.

---

# Part II — Recommendation and measurement

## 8. Recommended architecture

A **tiered delivery model**, mirroring the MemGPT/Letta core-vs-archival split and consistent
with everything in §4–§6. Two tiers ship now on existing machinery; the third is gated behind the
measurement plan in §9.

### Tier 1 — Profile: pinned, stable, cache-friendly (ship as-is)

Keep layer B (the durable profile) in the prompt prefix. It is small, always-relevant, and —
critically — **stable across turns**, so it caches cleanly. This is papai's "core memory." No
change; thread A already left it in place. Guard only its *size* (a Letta-style soft cap) so it
never grows into a per-turn tax.

### Tier 2 — Records: tool-pull by default (already built; make it the real default)

Records reach the conversation through **`search_memory`** — the model pulls what it judges
relevant, when it judges it relevant. This is:

- **already implemented** (`runRecallCascade` → `searchHybrid`, hybrid + provenance + validity);
- **cache-friendly** (result lands at the tail, prefix untouched — §6);
- **abstention-safe** (nothing irrelevant is forced in when the model doesn't ask — §5);
- **the dominant production pattern** for archival-tier memory (Letta, mem0 core — §4).

This is what thread A's default (records off) already routes to. The work here is not new
machinery but **making the tool reliably fire when it should**: a strong tool description, and —
measured in §9 — checking whether the model *under*-triggers it (the known weakness of tool-pull:
the model doesn't know what it doesn't know).

### Tier 3 — Query-aware injection: opt-in, cache-safe, evidence-gated (do NOT ship blind)

Build the disciplined form of `deriveInjectionQuery` **only if §9 shows tool-pull under-triggers
and injection measurably beats it** — and even then, subject to hard constraints derived from the
research:

1. **Placement:** pattern **B** only — trailing block or Opus-4.8 mid-conversation `system`
   message. **Never** position 0. (§6)
2. **Curation:** small *k*, confidence-gated, deduped — a Zep-style curated block, not a raw
   top-k dump. (§4, §5)
3. **Query derivation:** tiered — deterministic recent-turn query by default, LLM rewrite/HyDE
   only behind a low-confidence gate. (§4)
4. **Need-gating (self-route):** inject only when a cheap signal says memory is likely relevant;
   otherwise inject nothing and let the abstainer abstain. (§4, §5)
5. **Per-scope opt-in**, reusing the thread-A `inject_records` flag as the toggle.

This keeps the safe default (Tier 2) while making Tier 3 an *experiment with a kill switch*, not a
standing bet.

**What is explicitly *not* recommended:** pattern **D** (agentic multi-call selection) as a
default. Its cost/latency and failure modes (tool storms, context bloat) are not justified when
Tier 2 already lets the model call `search_memory` more than once organically for genuine
multi-hop needs. Revisit only if a measured multi-hop slice shows single-shot tool-pull failing.

## 9. Measurement and data-collection plan (the "real data, real queries, some tests")

This is the direct answer to the user's instruction. It has two halves: **collect real data**
(so the eval reflects papai's actual traffic, not synthetic guesses) and **run an offline
reader-eval harness** (so the inject-vs-pull decision is scored on *answers*, not retrieval rank).

### 9.1 Collect real data (production instrumentation)

Build a replay set from real traffic, respecting the `/stats/*` anonymity contract and the
logging rules (never persist tokens, keys, or raw sensitive content). Per turn, log to a
dedicated eval channel:

- the **derived/candidate query** (deterministic recent-turn construction — cheap, always
  computable, even in arms that don't use it);
- **which records exist in scope** at that moment (ids + hashes, not raw content on the hot
  path) and what `runRecallCascade` *would* return for the candidate query (shadow retrieval —
  compute, don't inject);
- whether the model **actually called `search_memory`**, with what query, and the outcome;
- token counts and, where the provider exposes it, **cache-hit / effective-input tokens**.

This yields (a) a **real-query corpus** for the harness and (b) the single most important
production signal for the Tier-2-vs-Tier-3 decision: **how often does the model fail to pull
memory that shadow-retrieval shows was available and relevant?** That under-trigger rate is the
empirical trigger for building Tier 3 at all.

### 9.2 Offline reader-eval harness (the tests)

Structure copied from LongMemEval's stage-separated design: **score final answers, report
retrieval and reading metrics separately, never conflate them.**

**Corpus.** Golden Q/A over a **seeded, controlled** memory corpus with known ground-truth
answers *and* known ground-truth evidence records — seeded large enough that a stuff-everything
baseline is **not** near-ceiling (the LoCoMo lesson, §5). Augment with the real-query replay set
from §9.1 for external validity. Reuse the frozen synthetic suite from
[`03-benchmark-and-corpus.md`](03-benchmark-and-corpus.md) as the deterministic backbone so this
harness composes with the sealed evidence record rather than duplicating it. This is the
"end-to-end reader experiment … separate track" the README already anticipates — it must **not**
be blended with the deterministic retrieval results.

**Ablation arms** — exactly the design question, one arm per mechanism:

| Arm | Mechanism | Purpose |
|-----|-----------|---------|
| 0 | No memory | Sanity floor |
| 1 | Recency inject, position 0 | The *pre-thread-A* behavior (what we turned off) — quantify what was lost/gained |
| 2 | Profile-only (Tier 1) | Thread-A default |
| 3 | Tool-pull (Tier 2) | The recommended default — does the model pull what it needs? |
| 4 | Query-aware inject, cache-safe (Tier 3) | The disciplined `deriveInjectionQuery` |
| 5 | Full-context / stuff-everything | Cost ceiling + the LoCoMo "sometimes wins" check |

**Metrics per arm** (retrieval and reader reported separately):

- **Answer correctness** — LLM-as-judge (fixed, documented, version-pinned judge; validated
  against a human-labeled subset before trust — §4 judge-config caveat) + exact-match/F1 where
  answers are short-form.
- **Abstention accuracy** — a **dedicated out-of-memory slice** (questions with no true answer in
  the seeded corpus), scored separately. This is the load-bearing safety metric (§5): it is where
  injection arms are expected to *lose* to tool-pull by fabricating from topically-adjacent
  records. Specified in full — corpus, adversarial near-miss seeding, metrics, judge, and the
  pre-registered pass/fail gate — in
  [`docs/superpowers/specs/2026-07-24-memory-abstention-measurement-design.md`](../../superpowers/specs/2026-07-24-memory-abstention-measurement-design.md).
- **Hallucination attributable to injected-but-irrelevant content** — not generic wrongness, but
  wrong answers traceable to a record the arm injected and the model used.
- **Cost** — tokens per turn **and cache-adjusted effective input tokens** (raw and cache-adjusted
  can rank the arms differently — §6); Tier 3 and arm 1 are expected to look cheap on raw tokens
  and expensive once cache invalidation is priced in.
- **Latency** — wall-clock; for tool-pull, tool-call count and round-trip overhead.

**Category breakdown** mirroring LongMemEval's five abilities (single-session, multi-session
reasoning, temporal reasoning, knowledge updates, abstention), because aggregate scores hide the
exact per-category variance that decides *which* mechanism wins *which* question type.

### 9.3 Decision rule

Ship **Tier 1 + Tier 2 now** (already built; already the thread-A default). Build **Tier 3 only
if** the harness shows, on both the seeded and real-query corpora:

1. arm 3 (tool-pull) leaves a **material answer-quality gap** vs. arm 4 (query-aware inject) —
   i.e., the model demonstrably under-triggers (§9.1 corroborates); **and**
2. arm 4 **does not regress the abstention slice** vs. arm 3; **and**
3. arm 4's cache-adjusted cost is acceptable at its cache-safe placement.

If arm 4 fails (2) — the most likely failure per §5 — `deriveInjectionQuery` stays shelved and
Tier 2 stands. Either way, the decision is made on papai's own reader-level data, which is exactly
what the frozen record (nDCG only, no live reader) could not provide and what the user asked for.

---

## 10. Sources

Agentic memory systems: MemGPT (arXiv:2310.08560) & Letta docs; mem0 (arXiv:2504.19413, README);
Zep/Graphiti (arXiv:2501.13956); Generative Agents (arXiv:2304.03442); LangMem docs; agentic-RAG
tradeoff write-ups; self-route (arXiv:2407.16833); LaRA (arXiv:2502.09977); HyDE
(arXiv:2212.10496).

Evaluation & context effects: LongMemEval (arXiv:2410.10813) + Memoria reader-separation
replication; LoCoMo (arXiv:2402.17753) + mem0/Zep dispute; Lost in the Middle (arXiv:2307.03172);
Chroma "Context Rot" (2025); "Context Length Alone Hurts … Despite Perfect Retrieval"
(arXiv:2510.05381); AbstentionBench (arXiv:2506.09038); RAGAS; ARES (arXiv:2311.09476).

Caching: `claude-api` skill (authoritative Anthropic prompt-caching economics); prompt-cache
placement case studies.

papai internals: `src/conversation.ts`, `src/tools/memory.ts`,
`src/long-term-memory/recall-cascade.ts`, `src/long-term-memory/store.ts`; thread-A spec and the
frozen `agent-memory/` record.
