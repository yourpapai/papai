<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Implementation status since sealing (living companion)

**Status:** living — **not** part of the frozen `00`–`06` evidence record.
**Last verified:** 2026-07-24 against branch `memory-vector-graph-research` HEAD.

## Why this file exists

The audit ([`01-current-state-audit.md`](01-current-state-audit.md)) is frozen at
commit `eab9ed2b4e2dac0279d338436b59c3a89d87bc8a` (2026-07-23) and must stay frozen — it
is the sealed baseline the `04`/`06` decision was computed against. But production code has
advanced since that commit, and several gaps the audit catalogues are now closed in source.
A reader who takes the audit as HEAD will believe retrieval is still ASCII-only,
non-fused, and validity-blind. It is not.

This companion records, **from HEAD source only**, what changed since sealing. It transfers
**no** benchmark score and does not amend any sealed claim; it maps audit gaps to the current
files that close them, so each entry is independently checkable. When it disagrees with the
sealed audit, the disagreement is the point — the audit describes `eab9ed2b`, this describes HEAD.

## Audit gaps closed since sealing

Verified at HEAD on the date above.

| Audit gap (01 / §"Verified production gaps") | Status | Source evidence at HEAD |
| --- | --- | --- |
| Semantic-**or**-lexical, no score fusion | **Closed** | `hybrid-search.ts` runs both channels and fuses with `fuseByRank` (`fusion.ts`); neither channel is a precondition for the other. |
| ASCII-only lexical fallback (`[a-z0-9]+`, `recall-ranking.ts`) | **Closed** | `recall-ranking.ts` deleted; replaced by `lexical-search.ts` + `lexical-query.ts` (FTS5 `bm25` channel). |
| Missing embedding-version metadata | **Closed** | `embedding-identity.ts`; dense channel filters `eq(embeddingVersion, version)` and returns no hits when identity is absent (`semantic-search.ts` `denseConditions`). Schema carries `embeddingModel`/`embeddingDimension`/`embeddingVersion`/`embeddedAt`. |
| No `expiresAt`/validity predicate at query time | **Closed** | `recordValidityCondition` applied in **both** recall channels (`lexical-search.ts`, `semantic-search.ts`) and in `listMemoryRecords` (`store.ts`). |
| No re-embedding / repair sweep for null embeddings | **Closed** | `embedding-backfill.ts`. |
| Recency injection (unconditional per-turn record injection) | **Closed / redesigned** | Gated behind `inject_records` (migration 070), default **off** — thread A (`2026-07-24-memory-injection-feature-flag-design.md`). Principled replacement designed in [`injection-architecture.md`](injection-architecture.md) (thread B). |
| Incomplete erasure (forget only archives; proxy failed erasure gate) | **In progress** | `tombstone.ts`, `scope-clear.ts`, `tombstone.testing.ts`, + the `2026-07-24-memory-durable-erasure-design.md` spec. Cross-projection/backup erasure per `06` §6 is not yet fully realized. |

## Still open at HEAD

- **O(N) in-process vector scan** — `rankRecordsBySimilarity` (`semantic-search.ts`) still
  `SELECT`s the whole scope/version/validity set and scans/cosines in process. It is now
  **bounded** by the `embeddingVersion` + validity predicates (smaller N than the audit's
  description), but there is still no ANN index. Cost grows with in-scope embedded rows.
- **Canonical event log + hierarchical projections** — the `06` headline decision
  (`adopt-hierarchy`: canonical scoped events, rebuildable facts/summaries/indexes with
  leaf provenance, Phases 1–5) is **unbuilt**. What shipped corresponds to the *corrected-hybrid
  foundation* (technique level: fused lexical+dense with preserved lexical recall), **not** the
  hierarchical winner. No score is transferred by saying so.
- **Reader-level evaluation** — `06` still has no live extractor/reader/judge. The abstention
  gate ([`../../superpowers/specs/2026-07-24-memory-abstention-measurement-design.md`](../../superpowers/specs/2026-07-24-memory-abstention-measurement-design.md))
  and the reader-eval harness (`injection-architecture.md` §9) are the down-payment on `06`
  Phase 4, and remain to be built.

## Maintenance

Re-verify against HEAD and update the date when memory-subsystem code changes. Do **not** edit
the sealed `00`–`06` documents to reflect these — that is precisely what this companion is for.
