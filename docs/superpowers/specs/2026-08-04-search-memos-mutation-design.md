<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation coverage: `src/tools/search-memos.ts`

Date: 2026-08-04
Status: approved

## Goal

Raise the mutation score of `src/tools/search-memos.ts` — paired score
**0.18** (17 killed / 28 survived / 51 no-coverage, 96 mutants), the largest
pool of bad mutants in `scripts/mutation/baseline.json` — to **≥ 0.90** with
pure unit tests. No source changes.

## Background and findings

### Target selection (baseline triage, 2026-08-04)

`baseline.json` joined with cached per-file Stryker reports in
`reports/paired/`; value = survived + no-coverage mutants, weighted by code
centrality and tractability.

| File | Baseline | Bad / Total | Verdict |
| --- | --- | --- | --- |
| **`src/tools/search-memos.ts`** | 0.18 | **79** / 96 | **Largest absolute gain; 99-line self-contained tool — selected target.** |
| `src/message-queue/queue.ts` | 0.58 | 61 / 146 | Core infra; pure assertion strengthening (0 no-coverage). Strong next-cycle candidate. |
| `src/tools/memory.ts` | 0.47 | 62 / 117 | Weak payload assertions. Deferred. |
| `src/tools/tools-builder.ts` | 0.75 | 73 / 302 | Already decent; large and complex. Deferred. |

Zero-score kaneo/youtrack plugin files exist but are mostly thin wrappers —
low value per effort.

### Why this file

- **Worst score-to-size ratio in the baseline:** 96 mutants, 79 bad, half the
  file (the entire semantic-search path) never executed by any test.
- **Proven mirror:** `src/tools/search-chat-history.ts` implements the same
  keyword/semantic/auto pattern and has an established companion test
  (`tests/tools/search-chat-history.test.ts`, baseline 0.56 but with the full
  harness: hoisted embeddings module mock, real-DB vector seeding) whose shape
  transfers directly.
- **Real behavior at stake:** mode routing (keyword / semantic / auto
  fallback), similarity-threshold filtering, score ordering, and limit slicing
  are all currently unverified — surviving mutants silently change result sets
  the LLM sees.

### Mutant inventory (cached paired report)

79 bad mutants:

- **NoCoverage (51):** the whole `trySemanticSearch` body (L22–38: threshold
  filter, score sort, limit slice, `getMemo` join); the semantic-available
  routing branch (L61–65); the semantic-unavailable branch (L68–71); the
  `trySemanticMode` return shape (L97–98).
- **Survived (28):** tool + schema description strings and validators
  (L43–50); log-payload objects (L15, 53, 80); the `queryVec === null` guard
  (L89–94 — survives today because with zero stored embeddings the mutant's
  null-vector crash path is never reached); auto/semantic conditional edges
  (L61, 62, 68).

### Existing coverage

`tests/tools/memo-tools.test.ts` holds 3 weak `search_memos` tests (keyword
hit, auto→`keyword_fallback` with no embedding model, keyword no-match) —
property-presence assertions only, no semantic path, no schema/log assertions.

## Design

Approach A (user-approved): new dedicated companion test file. Alternatives
considered: extend `memo-tools.test.ts` in place (mixes a hoisted module mock
into suites running the real embeddings module; max-lines pressure); DI-refactor
the source (rejected — touches production purely for tests, diverges from the
accepted module-mock precedent for this exact dependency).

### File changes

- **Create `tests/tools/search-memos.test.ts`** — the exact companion path the
  paired mutation runner and TDD hook expect for `src/tools/search-memos.ts`.
  Move the 3 existing `search_memos` tests in from `memo-tools.test.ts`
  (strengthened) and add ~11 new tests.
- **Edit `tests/tools/memo-tools.test.ts`** — remove the moved `search_memos`
  describe block and its now-unused `makeSearchMemosTool` import. The
  save/list/archive/promote suites are otherwise untouched.
- **No production code changes.**

### Mocking strategy

Mirrors `tests/tools/search-chat-history.test.ts:15-27`:

- **Embeddings:** hoisted `mock.module('../../src/embeddings.js')` exposing a
  controllable `let nextQueryVec: number[] | null` and a spy capturing call
  arguments; re-applied in `beforeEach` after the preload reset
  (`tests/mock-reset.ts`). Documented as the legacy module-mock pattern —
  `getEmbeddingForContext` has no per-call DI.
- **Memo store:** real in-memory DB via `setupTestDb()`; memos seeded with
  `saveMemo()`, embeddings attached with
  `updateMemoEmbedding(userId, id, new Float32Array([...]))` so
  `loadEmbeddingsForUser` / `getMemo` / `keywordSearchMemos` run for real.
- **Logger:** `createTrackedLoggerMock()` (`tests/utils/logger-mock.ts:101`)
  instead of plain `mockLogger()`, enabling log-payload assertions. Hoisted
  above the tool import because `search-memos.ts:15` binds `logger.child()` at
  module load.
- **Invocation:** `getToolExecutor()`; schema checks via `schemaValidates()`
  plus `z.toJSONSchema()` for descriptions/defaults.
- **Vector fixtures:** 2D embeddings with known cosines vs query `[1, 0]`:
  `[0.9, 0.1]` ≈ 0.994, `[0.7, 0.7]` ≈ 0.707, `[0.5, 0.87]` ≈ 0.5 — all safely
  off the 0.65 threshold boundary.

### Test matrix

| # | Test | Mutants killed |
| --- | --- | --- |
| 1 | Schema: accepts `keyword`/`semantic`/`auto`, rejects bogus mode, empty query, missing query | L45 `min(1)`, L47 enum |
| 2 | Schema: non-empty tool + field descriptions; limit default 5, min 1, max 20 (via `z.toJSONSchema`) | L43–50 StringLiteral / MethodExpression |
| 3 | Keyword mode returns matching memo ids, `mode: 'keyword'` | strengthens existing |
| 4 | Keyword no-match → `results: []` | existing, kept |
| 5 | Auto + null queryVec → `keyword_fallback` with results | existing, kept |
| 6 | Auto + null queryVec **with embeddings stored** → `keyword_fallback` | L94 `queryVec === null` guard (mutant proceeds with null vec, crashes in `cosineSimilarity`) |
| 7 | Auto + semantic hits → `mode: 'semantic'`, ids sorted by score desc, `score` present | L22–38 map / sort (`b.score - a.score`) / filter chain |
| 8 | Auto + semantic available but zero above threshold → `keyword_fallback` | L62 `results.length > 0` mutants (`>=`, `<=`, `&&`→`||`) |
| 9 | Semantic mode + available + zero hits → `semantic` empty (not fallback) | L62 `mode !== 'semantic'`, `&&` mutants |
| 10 | Semantic mode + null queryVec → `{ results: [], mode: 'semantic' }` + warn logged | L68–71 |
| 11 | Threshold: 0.5-similarity memo excluded, 0.9-similarity included | L28 directional mutants (`<`, `==`, `!=`) |
| 12 | Limit: 3 above-threshold memos, `limit: 2` → top 2 only | L30 slice |
| 13 | `getEmbeddingForContext` called with `(query, userId, { storageContextId: userId, contextType: 'dm', chatUserId: userId })` | L89–93 ObjectLiteral / StringLiteral |
| 14 | Logs: `child({ scope: 'tool:memo' })`; debug entry `{ mode, limit }`; info `{ mode, resultCount }` | L15, 53, 80, 97 |

### Accepted residual mutants

- **`>=` vs `>` at exactly 0.65** (L28): the threshold is not float-representable,
  so an exact-boundary cosine cannot be constructed reliably. The other
  directional mutants die to test 11.
- **`getMemo`-null filter branch** (L33–37): defensive code unreachable via the
  public API — `loadEmbeddingsForUser` and `getMemo` apply consistent
  user/status scoping, so a loaded embedding row always resolves.

Projected ceiling with these residuals: ~0.92–0.95; the ≥ 0.90 gate has
headroom.

## Error handling

Not applicable — no production changes. The tests assert the tool's existing
degraded-mode contract (semantic unavailable → `keyword_fallback` or empty
`semantic` result, never a throw).

## Verification

1. `bun test tests/tools/search-memos.test.ts tests/tools/memo-tools.test.ts` — green.
2. `bun test:mutate:file src/tools/search-memos.ts` — score ≥ 0.90.
3. Repo lint / typecheck per `package.json` scripts.
4. No manual `scripts/mutation/baseline.json` edit — the master CI
   `mutation-baseline` job ratchets the floor via `seedMerge` after merge.
