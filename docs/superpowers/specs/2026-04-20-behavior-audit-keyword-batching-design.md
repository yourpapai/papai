<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Behavior Audit Keyword Batching Design

- Date: 2026-04-20
- Status: Approved
- Scope: redesign the behavior-audit 3-phase pipeline so Phase 1 emits canonical open-vocabulary keyword slugs and Phase 2 consolidates by deterministic keyword batches instead of one prompt per domain

## Background

The current Phase 2 design groups all extracted behaviors in a domain into a single consolidation prompt.

Current implementation confirms that:

- `scripts/behavior-audit/consolidate.ts` groups `progress.phase1.extractedBehaviors` by domain
- `scripts/behavior-audit/consolidate-agent.ts` builds one prompt containing every behavior in that domain
- large or dense domains can therefore create oversized prompts, increased token cost, and degraded consolidation quality

The problem is architectural, not prompt-wording-only. If Phase 2 continues to batch at the domain level, the system will eventually hit context-size and quality limits again as more behaviors accumulate.

## Goals

- Phase 1 emits canonical keyword slugs for every extracted behavior.
- Keyword generation uses open vocabulary rather than a fixed taxonomy.
- A persistent vocabulary file is reused across runs so the model can reuse existing slugs and append new ones when needed.
- Phase 2 batches behaviors by deterministic keyword ownership instead of one prompt per domain.
- Phase 2 batches may span domains.
- Phase 3 continues to score only consolidated user-facing outputs with stable provenance.
- Incremental invalidation remains bounded to affected tests and affected consolidation batches.
- The design avoids simply moving the long-context problem from Phase 2 into every Phase 1 request.

## Non-goals

- Building a full unsupervised clustering system.
- Backfilling old extracted behaviors with keywords without rerunning Phase 1.
- Introducing human approval gates for every new vocabulary entry in the initial implementation.
- Replacing open vocabulary with a fixed taxonomy.
- Guaranteeing the vocabulary can grow unboundedly without later pruning or narrowing logic.

## User stories

1. As an audit pipeline, I want Phase 1 to emit normalized keyword slugs for each extracted behavior so that downstream grouping does not depend on one oversized per-domain prompt.
2. As a consolidation phase, I want Phase 2 to batch behaviors into smaller groups derived from shared keywords so that each LLM call stays within a safer context budget.
3. As a scoring phase, I want Phase 3 to evaluate only consolidated user-facing outputs with stable provenance so that rescoring and incremental invalidation still work.
4. As a maintainer, I want grouping to be deterministic and inspectable so that I can understand why two behaviors were merged or kept separate.

## Approved design choices

- Keyword model: open-vocabulary canonical slugs.
- Target keyword count per behavior: 8-16 slugs.
- Vocabulary persistence: automatically append new slugs to a canonical vocabulary file.
- Slug reuse policy: the LLM decides semantic reuse versus creation, not exact-match-only code.
- Phase 2 batch membership: each behavior belongs to exactly one primary batch.
- Cross-domain grouping: allowed.
- Recommended architecture: two-step Phase 1 with a dedicated vocabulary resolver, not one monolithic extraction call.

## Recommended approach

Use a two-step Phase 1 plus deterministic keyword-primary batching.

### Why this is the recommended approach

- It preserves the requested open-vocabulary model.
- It allows semantic reuse of existing vocabulary while still appending new slugs automatically.
- It avoids loading all same-domain behaviors into a single Phase 2 prompt.
- It avoids making every Phase 1 extraction prompt grow forever with the entire vocabulary as the vocabulary file expands.
- It keeps incremental invalidation tractable because canonical keywords remain attached to each extracted behavior.

## Architecture overview

### Phase 1 becomes a two-step pipeline

Phase 1 is split into:

1. extraction
2. vocabulary resolution

Extraction produces the raw behavior summary, technical context, and candidate keyword slugs.

Vocabulary resolution loads the persisted vocabulary, semantically reuses existing slugs when appropriate, appends truly new slugs with descriptions, and returns the final canonical keyword set for the behavior.

The final `ExtractedBehavior` stored in progress contains the canonical keywords, not the raw candidate list.

### Phase 2 batches by primary keyword, not by domain

Phase 2 no longer groups first by domain. Instead it:

1. reads all extracted behaviors with canonical keywords
2. builds behavior-to-keyword memberships
3. counts keyword cardinality across the current extracted corpus
4. assigns each behavior exactly one `primaryKeyword`
5. creates one consolidation batch per `primaryKeyword`
6. consolidates each batch independently

Domains become metadata on behaviors and consolidated outputs instead of the top-level batching partition.

Important semantic rule: a keyword batch is a candidate pool for consolidation, not a guarantee that all items in the batch belong to one feature.

Phase 2 must be allowed to split a single keyword-owned batch into multiple consolidated feature entries when the behaviors are not describing the same user-facing capability.

### Phase 3 remains user-facing scoring only

Phase 3 continues to read consolidated outputs, filter to user-facing entries, and run persona scoring.

No redesign is needed in the scoring objective itself. The key change is that consolidated entries now originate from keyword-owned batches rather than domain-owned prompts.

For this redesign to work, Phase 2 must generate user stories at the feature level rather than the keyword level or test level. Smaller keyword-owned batches are a means to improve the quality of feature-level story generation, not the final abstraction level presented to Phase 3.

## Data model

### Extracted behavior

`ExtractedBehavior` is extended to include canonical keywords:

```ts
interface ExtractedBehavior {
  readonly testName: string
  readonly fullPath: string
  readonly behavior: string
  readonly context: string
  readonly keywords: readonly string[]
}
```

### Vocabulary entry

The persistent vocabulary file stores entries in this shape:

```ts
interface KeywordVocabularyEntry {
  readonly slug: string
  readonly description: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly timesUsed: number
}
```

### Resolver result

The vocabulary resolver returns canonical keywords plus any entries that must be appended:

```ts
interface ResolvedKeywords {
  readonly keywords: readonly string[]
  readonly appendedEntries: readonly KeywordVocabularyEntry[]
}
```

### Persistent artifact

Add a new persistent artifact:

- `reports/keyword-vocabulary.json`

This file is separate from `progress.json` so it can be reused across runs and inspected independently.

## Vocabulary behavior

### Slug format

Keywords are canonical slugs, not free-form phrases.

Examples:

- `group-targeting`
- `identity-resolution`
- `thread-context-routing`
- `attachment-relay`

### Vocabulary append policy

When the resolver determines that no existing slug adequately matches a candidate concept, it appends a new vocabulary entry automatically.

No manual review gate is required in the initial implementation.

### Semantic reuse

The resolver is allowed to semantically reuse an existing slug even when the candidate slug text is different.

This reuse decision is model-driven, not exact-slug-match-only.

### Growth guardrail

The vocabulary file itself must not become the next long-context failure mode.

The design therefore includes a guardrail from the beginning:

- exact slug hits can be resolved in code first
- non-exact semantic resolution should eventually receive a narrowed subset of vocabulary candidates, not an unbounded full-file prompt

The first implementation may still use the full vocabulary while the file is small, but the architecture must preserve a seam for later narrowing.

## Phase 1 pipeline behavior

### Extraction step

The extraction step receives the test case, source context, and codebase tools.

It returns:

- `behavior`
- `context`
- `candidateKeywords`

`candidateKeywords` should contain 8-16 open-vocabulary canonical slugs.

### Vocabulary resolution step

The vocabulary resolution step receives:

- `candidateKeywords`
- the current vocabulary or a narrowed candidate subset

It returns:

- final canonical `keywords`
- any new vocabulary entries that should be appended automatically

### Atomic persistence rule

Per-test Phase 1 persistence must be atomic.

That means a test is marked done only if all of the following succeed:

- extraction
- vocabulary resolution
- vocabulary persistence
- extracted behavior persistence

If any of these fail, the test remains incomplete and no partial keyword state is stored for that test.

## Phase 2 batching design

### Primary keyword partition

Each behavior is assigned to exactly one `primaryKeyword`.

This is a deliberate clean partition. A behavior must not appear in multiple consolidation batches in the initial design.

### Primary keyword selection rule

The correct batching rule is not “most common keyword”.

The most common keyword usually creates the largest batch, which works against the prompt-size goal.

Instead, select the primary keyword using this rule:

1. consider the canonical keywords on the behavior
2. choose the lowest-cardinality relevant keyword
3. break ties with stable lexical ordering

This yields smaller and more deterministic batches.

### Cross-domain grouping

Keyword batches may contain behaviors from multiple domains.

Each behavior still carries its original domain, and consolidated outputs must retain participating source domains as provenance metadata.

Cross-domain grouping is acceptable only when the grouped behaviors still support a coherent user-facing feature narrative. Shared keywords alone are not enough justification for one consolidated story.

### Oversized batch guardrail

If a primary-keyword batch exceeds a configured size threshold, Phase 2 must split it before prompt generation.

Preferred split order:

1. secondary keyword partition
2. deterministic chunking fallback

An oversized batch must never be sent unchanged as one prompt.

## Phase 2 consolidation input contract

Each behavior passed into a Phase 2 consolidation prompt should include enough information for the model to separate same-keyword-but-different-feature items.

At minimum, each input item should include:

- `testKey`
- `behavior`
- `context`
- canonical `keywords`
- `primaryKeyword`
- source `domain`

This ensures the LLM sees both the batching reason and the broader semantic context when deciding which inputs belong to the same feature-level story.

## User story quality requirements

Phase 2 user stories are not incidental text. They are the main abstraction consumed by Phase 3 persona evaluation, so they need explicit quality constraints.

Every user-facing consolidated entry must produce a user story that is:

- feature-level rather than test-level
- understandable without reading code
- centered on user-observable behavior
- complete in actor, action, and benefit
- free of implementation jargon, function names, and test names

Required story form:

- `As a [user type], I want [action] so that [benefit].`

Story quality rules:

1. The story must describe a user goal, not an internal routing path or implementation detail.
2. The story must represent a coherent feature, not a grab-bag of behaviors connected only by a shared keyword.
3. The story must be broad enough to cover the consolidated feature, but not so broad that unrelated scenarios are merged.
4. If a batch contains multiple distinct user-facing capabilities, Phase 2 must emit multiple consolidated outputs.
5. If a batch contains only internal behaviors, Phase 2 must classify them as non-user-facing and emit `userStory: null`.

Examples of bad stories:

- a story that just rewrites one test case
- a story that mentions internal function names or parsing logic
- a story that merges unrelated behaviors because they share one keyword
- a story that describes a domain area rather than a concrete user goal

Examples of good stories:

- one story for a discoverable user capability with a clear actor and outcome
- separate stories for separate user capabilities even when they share a keyword batch

## Phase 2 prompt requirements

The Phase 2 consolidation prompt should explicitly instruct the model that:

1. the batch was formed for context-size control and candidate similarity
2. the batch may contain more than one feature
3. the model must not force one output per batch or one output per keyword
4. the model should merge only behaviors that describe the same user-facing capability
5. the model should generate user stories only for consolidated user-facing features
6. the model should keep internal-only consolidations separate and story-less

This rule is necessary to prevent the keyword partition from becoming an accidental semantic partition.

## Consolidated outputs and provenance

Consolidated outputs must continue to include:

- stable output id
- `featureName`
- `isUserFacing`
- `behavior`
- `userStory`
- `context`
- `sourceTestKeys`

Additionally, the keyword-batching design should preserve enough provenance to recover:

- primary keyword batch identity
- participating source domains
- the canonical keywords used to justify the batch

This enables later reporting and bounded invalidation.

## Incremental invalidation

### Phase 1 fingerprint changes

Phase 1 fingerprints must include canonical keywords.

If a test's extracted behavior or canonical keyword set changes, that test's Phase 1 fingerprint changes.

### Downstream invalidation behavior

When a test changes, the system should invalidate only:

- the old primary-keyword batch containing that behavior
- the new primary-keyword batch containing that behavior
- downstream Phase 3 entries derived from those consolidated outputs

### Vocabulary changes alone

Vocabulary growth alone must not force a full rerun of all tests.

Only tests reprocessed in the current run should adopt new vocabulary mappings unless a future explicit vocabulary-reindex mode is added.

This keeps rerun scope bounded and predictable.

## File responsibilities

### New files

1. `scripts/behavior-audit/extract-agent.ts`
   - owns the structured extraction LLM call
   - returns `behavior`, `context`, and `candidateKeywords`

2. `scripts/behavior-audit/keyword-resolver-agent.ts`
   - owns semantic vocabulary reuse and new-entry generation
   - returns canonical keywords and appended vocabulary entries

3. `scripts/behavior-audit/keyword-vocabulary.ts`
   - loads and saves the vocabulary file
   - supports exact lookup and narrowed candidate selection
   - owns append and metadata updates

### Modified files

1. `scripts/behavior-audit/extract.ts`
   - becomes the Phase 1 orchestrator over extractor plus resolver
   - persists vocabulary updates and final extracted behaviors with canonical keywords

2. `scripts/behavior-audit/consolidate.ts`
   - replaces domain-first grouping with primary-keyword grouping
   - applies deterministic oversized-batch splitting

3. `scripts/behavior-audit/report-writer.ts`
   - extends extracted behavior reporting to include keywords
   - may print keywords in markdown reports for inspectability

4. `scripts/behavior-audit/incremental.ts`
   - includes canonical keywords in Phase 1 fingerprints
   - records primary-keyword batch identity in the consolidated manifest

5. `scripts/behavior-audit/progress.ts`
   - stores extracted behaviors with keywords
   - requires schema version bump and migration updates

6. `scripts/behavior-audit/progress-migrate.ts`
   - handles migration or reset strategy for the changed Phase 1 output contract

## Migration strategy

The current stored Phase 1 extracted behaviors do not include keywords.

Because keyword batching depends on canonical Phase 1 keywords, old extracted entries should be treated as stale.

Recommended migration behavior:

- preserve the existing file structure where practical
- bump progress schema/version appropriately
- reset Phase 1, Phase 2, and Phase 3 progress because the Phase 1 output contract changed materially

This is safer than trying to backfill keywords onto historic extracted behaviors without rerunning extraction.

## Error handling

### Phase 1 extraction failure

- mark the test failed
- do not update vocabulary
- do not persist extracted behavior

### Vocabulary resolver failure

- treat the test extraction as failed
- do not persist partial keywords
- do not mark the test done

### Vocabulary write failure

- fail the test extraction even if resolver output succeeded
- do not mark the test done unless vocabulary and extracted behavior are both persisted

### Phase 2 batch failure

- mark only the affected primary-keyword batch failed
- allow other batches to continue

### Oversized batch handling

- log the batch key, size, and split strategy used
- never process an oversized batch unchanged

## Reporting and observability

The redesign should emit explicit run-time visibility for:

- vocabulary size before and after the run
- reused slug count
- appended slug count
- total keyword batches
- largest batch size
- split strategy usage for oversized batches

This is necessary because open vocabulary plus semantic reuse introduces drift risk that must remain inspectable.

## Testing strategy

### Unit tests

Add or update focused tests for:

- extraction output includes candidate keywords
- resolver reuses existing slugs semantically
- resolver appends new slugs with descriptions
- extracted behaviors persist canonical keywords
- primary-keyword selection is deterministic
- oversized batches split deterministically
- Phase 1 fingerprints change when canonical keywords change

### Integration tests

Add or update integration coverage for:

- cross-domain behaviors landing in the same keyword batch
- a single test change invalidating only the affected batches
- Phase 3 still scoring only consolidated user-facing outputs
- reruns with a populated vocabulary reusing existing slugs
- a keyword batch producing multiple consolidated feature entries when needed
- user stories remaining feature-level and user-observable even when a batch contains mixed implementation scenarios

### Smoke tests

Smoke testing should cover:

1. fresh run with empty vocabulary
2. rerun with populated vocabulary and expected slug reuse
3. a forced hot-keyword scenario that triggers batch splitting
4. a mixed keyword batch scenario that verifies Phase 2 emits multiple feature-level stories instead of one over-merged story

## Alternatives considered

### Inline vocabulary-aware Phase 1

Rejected as the recommended design.

Loading the full vocabulary into every extraction request would eventually move the context-size problem from Phase 2 into Phase 1.

### Overlap graph clustering

Rejected as the recommended design.

It offers better semantic flexibility, but one common keyword can create large connected components again and reduce determinism.

### Two-stage summarize then merge

Rejected for now.

It may scale further, but it introduces another orchestration layer beyond the approved scope.

## Open implementation notes

- The first implementation may still use the full vocabulary during resolution while the vocabulary file is small, but the code structure must allow narrowed candidate selection later.
- Reporting may continue to organize final stories by domain, but Phase 2 ownership should be by primary keyword.
- “Committed into vocabulary file” is interpreted as automatic append to the persistent vocabulary artifact during the run, not as an automatic git commit.
