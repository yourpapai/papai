# Behavior Audit Phase 1 Trustworthiness Design

Date: 2026-04-27
Status: Proposed (not yet implemented)

## Problem

Phase 1 currently produces structurally valid extracted behavior artifacts, but the artifact does not distinguish grounded facts from plausible model inference. The extractor receives the individual test source plus a guessed implementation path and returns prose fields that only need to satisfy a JSON schema. This allows unsupported implementation claims to become canonical phase 1 data and then flow into classification, consolidation, and reports.

The repository already includes `codeindex`, a local symbol-first index and MCP server for TypeScript/JavaScript code search. Phase 1 should use it as the primary source for deterministic symbol resolution, dependency discovery, and implementation evidence instead of relying on guessed file paths or model-directed grep exploration.

The highest-leverage improvement is to make phase 1 artifacts evidence-bearing and confidence-aware. The pipeline should still be fully automated and best-effort, but every downstream phase should be able to tell which parts of an artifact are strongly grounded, weakly grounded, inferred, or unsupported.

## Current State (as of 2026-04-28)

The behavior-audit pipeline is functional with a four-phase architecture (extract → classify → consolidate → evaluate). Phase 1 works but has no trust infrastructure:

### Current `ExtractedBehaviorRecord` (10 fields)

Defined in `scripts/behavior-audit/extracted-store.ts`:

```ts
interface ExtractedBehaviorRecord {
  readonly behaviorId: string
  readonly testKey: string
  readonly testFile: string
  readonly domain: string
  readonly testName: string
  readonly fullPath: string
  readonly behavior: string
  readonly context: string
  readonly keywords: readonly string[]
  readonly extractedAt: string
}
```

No evidence, confidence, trust flags, provenance, or verification fields exist.

### Current Phase 1 Flow (single-pass)

1. `extract-prompts.ts:buildExtractionPrompt` builds a prompt with test source and a guessed implementation path (`tests/` → `src/` via `deriveImplPath`).
2. `extract-agent.ts:extractWithRetry` calls an OpenAI-compatible LLM with `readFile`, `grep`, `findFiles`, `listDir` tools.
3. The LLM returns `{ behavior, context, keywords }` prose.
4. `extract-phase1-helpers.ts:buildBehaviorRecord` wraps the output into an `ExtractedBehaviorRecord`.
5. `extract-incremental.ts:updateManifestForExtractedTest` computes fingerprints and dependency paths using the `deriveImplPath` heuristic.

No evidence collection, no verifier pass, no confidence scoring.

### Current Tools

Defined in `scripts/behavior-audit/tools.ts`:

- `readFile` — read file by project-relative path
- `grep` — regex search in `src/` and `tests/`
- `findFiles` — glob-style file discovery
- `listDir` — directory listing

No codeindex integration.

### Current Downstream Behavior

- Phase 2a (`classify.ts`) consumes all extracted records equally — no confidence filtering.
- Phase 2b (`consolidate.ts`) passes all classified behaviors into consolidation prompts without trust awareness.
- Phase 3 (`evaluate.ts`) evaluates consolidated features without trust quality context.

### Current Reporting

`report-rebuild-helpers.ts` builds domain summaries and story evaluations. No trust quality metrics exist.

## Goals

1. Maximize trustworthiness of phase 1 artifacts.
2. Change `ExtractedBehaviorRecord` directly rather than adding sidecar artifacts.
3. Keep phase 1 best-effort: emit artifacts when possible, with flags and confidence instead of mandatory human review.
4. Make evidence, confidence, trust flags, and verification verdicts first-class artifact fields.
5. Prevent unsupported context from being amplified by phase 2 and phase 3.
6. Preserve resumable, atomic phase 1 persistence.
7. Make trust quality visible in generated reports.
8. Use codeindex-backed symbol and reference data as the default source for implementation evidence.

## Non-Goals

1. Adding a mandatory human review gate.
2. Building a full claim-graph extraction system in the first implementation.
3. Preserving backward compatibility with old extracted artifact schemas.
4. Replacing the existing keyword-batching architecture.
5. Changing the user-facing purpose of the behavior audit pipeline.
6. Making behavior-audit depend on codeindex for non-TypeScript assets, Markdown, JSON, or generated report files.

## Chosen Approach

Use a two-pass grounded extraction design:

1. Phase 1 collects a deterministic codeindex-backed evidence bundle for each test.
2. An extractor produces behavior, context, keywords, and explicit evidence references.
3. A verifier checks the extractor output against the same evidence bundle.
4. The final `ExtractedBehaviorRecord` stores prose, evidence, confidence, trust flags, provenance, and verification results.
5. Downstream phases consume the artifact with confidence-aware filtering instead of assuming all phase 1 prose is equally reliable.

This is stronger than prompt hardening alone, but avoids the cost and complexity of decomposing every artifact into a full independently verified claim graph.

## Artifact Model

`ExtractedBehaviorRecord` should remain the canonical durable phase 1 object, but it should become evidence-bearing.

### Proposed Schema (replaces current 10-field schema)

```ts
interface ExtractedBehaviorRecord {
  readonly behaviorId: string
  readonly testKey: string
  readonly testFile: string
  readonly domain: string
  readonly testName: string
  readonly fullPath: string
  readonly behavior: string
  readonly context: string
  readonly keywords: readonly string[]
  readonly behaviorEvidence: readonly EvidenceRef[]
  readonly contextEvidence: readonly EvidenceRef[]
  readonly keywordEvidence: readonly KeywordEvidence[]
  readonly confidence: ExtractionConfidence
  readonly trustFlags: readonly TrustFlag[]
  readonly provenance: ExtractionProvenance
  readonly verification: ExtractionVerification
  readonly extractedAt: string
}
```

Supporting types:

```ts
type EvidenceKind =
  | 'test-source'
  | 'implementation-source'
  | 'helper-source'
  | 'manifest-dependency'
  | 'codeindex-symbol'
  | 'codeindex-reference'

interface EvidenceRef {
  readonly kind: EvidenceKind
  readonly filePath: string
  readonly startLine: number
  readonly endLine: number
  readonly snippet: string
  readonly supports: 'behavior' | 'context' | 'keyword'
  readonly symbolKey?: string
  readonly qualifiedName?: string
}

interface KeywordEvidence {
  readonly keyword: string
  readonly evidence: readonly EvidenceRef[]
  readonly novelty: 'existing' | 'new' | 'uncertain'
}

interface ExtractionConfidence {
  readonly behavior: 'high' | 'medium' | 'low'
  readonly context: 'high' | 'medium' | 'low'
  readonly keywords: 'high' | 'medium' | 'low'
  readonly overall: 'high' | 'medium' | 'low'
}

type TrustFlag =
  | 'evidence-collection-failed'
  | 'extractor-used-inference'
  | 'unsupported-behavior-claim'
  | 'unsupported-context-claim'
  | 'weak-behavior-evidence'
  | 'weak-context-evidence'
  | 'guessed-implementation-path'
  | 'novel-keyword'
  | 'weak-keyword-evidence'
  | 'verification-failed'
  | 'verifier-disagreed'

interface ExtractionProvenance {
  readonly promptVersion: string
  readonly verifierVersion: string
  readonly evidenceFilesRead: readonly string[]
  readonly dependencyPaths: readonly string[]
  readonly codeindex: CodeindexProvenance
}

interface CodeindexProvenance {
  readonly enabled: boolean
  readonly mode: 'direct' | 'mcp' | 'unavailable'
  readonly indexStatus: 'fresh' | 'stale' | 'missing' | 'unknown'
  readonly queries: readonly CodeindexQueryProvenance[]
}

interface CodeindexQueryProvenance {
  readonly tool: 'code_search' | 'code_symbol' | 'code_impact' | 'code_index'
  readonly query: string
  readonly resultCount: number
}

interface ExtractionVerification {
  readonly behaviorVerdict: 'supported' | 'partially-supported' | 'unsupported' | 'not-verified'
  readonly contextVerdict: 'supported' | 'partially-supported' | 'unsupported' | 'not-verified'
  readonly keywordVerdict: 'supported' | 'partially-supported' | 'unsupported' | 'not-verified'
  readonly notes: readonly string[]
}
```

Design rules:

1. Every nontrivial behavior claim should be supported by `behaviorEvidence`.
2. Every implementation-context claim should be supported by `contextEvidence` or flagged as inferred.
3. Unsupported material may remain in the artifact only when it is clearly flagged and confidence is lowered.
4. The final artifact must be machine-filterable without requiring manual review.
5. Implementation evidence should come from codeindex-resolved symbols or references whenever codeindex can resolve them.

## Codeindex Integration

Phase 1 should use codeindex as deterministic infrastructure, not merely as another free-form tool the extractor may or may not call.

The preferred integration path is a local evidence collector that calls codeindex functionality before the LLM prompt is built. This can be implemented through a direct wrapper around codeindex search/index modules or through the existing codeindex MCP server. Direct integration is preferred for the first implementation because it is easier to unit test and avoids spawning an MCP server inside each extraction call. MCP remains acceptable when behavior-audit is run in an environment where the codeindex MCP server is already managed externally.

The evidence collector should use codeindex capabilities this way:

1. `code_index` or an equivalent direct index call ensures the index exists and records whether it is fresh, stale, missing, or unknown.
2. `code_symbol` resolves functions, classes, constants, and exported helpers referenced by the test.
3. `code_search` finds candidate symbols when direct resolution is ambiguous.
4. `code_impact` finds references and import/call edges relevant to implementation context.
5. Plain file reads remain responsible for exact snippets because extracted artifacts should cite concrete line ranges and text.

Behavior-audit should still keep the existing read-only file tools as fallbacks for non-indexed files, JSON fixtures, Markdown docs, generated reports, and any codeindex miss. A codeindex miss should lower confidence only when the final artifact depends on an unverified implementation claim.

## Phase 1 Flow

### Current Flow (single-pass, no trust)

```text
test source + guessed impl path
  → LLM extractor (with readFile/grep/findFiles/listDir tools)
  → { behavior, context, keywords }
  → buildBehaviorRecord
  → ExtractedBehaviorRecord (10 fields)
```

### Proposed Flow (two-pass, trust-aware)

#### 1. Evidence Collection

Before calling the extractor, phase 1 should build an evidence bundle for the test case.

The bundle should include:

1. Test file path, test name, full path, and exact test line range.
2. The individual test block.
3. Relevant imports and setup from the test file.
4. Codeindex-resolved symbols directly referenced by the test.
5. Codeindex-resolved implementation files and line ranges for imported functions, helpers, and classes.
6. Codeindex reference or impact results that explain relevant calls and import edges.
7. Real dependency paths from incremental dependency discovery.
8. Short source snippets around directly referenced functions, helpers, and assertions.
9. Any known dependency files from the manifest entry.

The current guessed `tests/` to `src/` implementation-path heuristic (in `extract-prompts.ts:deriveImplPath` and `extract-incremental.ts:deriveImplPath`) should not be used as factual context. If it is retained temporarily as a fallback hint, any artifact depending on it must receive `guessed-implementation-path` and lowered context confidence.

If codeindex is unavailable, missing, or stale, phase 1 may fall back to test-source-only extraction plus existing file tools. The artifact must record this in `provenance.codeindex` and lower implementation-context confidence when implementation evidence could not be resolved.

#### 2. Evidence-Backed Extraction

The extractor prompt should ask for structured claims rather than prose-only output.

Extractor output should include:

1. Observable behavior summary.
2. Implementation-context summary.
3. Candidate keywords.
4. Evidence references for behavior, context, and keywords.
5. Explicit uncertainty markers when a claim is inferred beyond direct evidence.

The extractor may still produce best-effort output when evidence is incomplete, but it must represent uncertainty in the structured output.

#### 3. Verification and Scoring

A verifier pass should receive the extractor output and the evidence bundle.

The verifier should return:

1. Supported, partially supported, unsupported, or not verified verdicts for behavior, context, and keywords.
2. Confidence values for behavior, context, keywords, and overall artifact quality.
3. Trust flags.
4. Notes explaining important downgrades.

The verifier should be stricter than the extractor. Its job is not to improve prose quality; its job is to prevent unsupported text from being treated as equally trustworthy canonical data. When verifying implementation-context claims, it should prefer codeindex-backed `codeindex-symbol` and `codeindex-reference` evidence over model-inferred file relationships.

#### 4. Canonical Record Construction

Phase 1 should construct the final `ExtractedBehaviorRecord` from extractor output plus verifier output.

If extraction succeeds but verification fails, phase 1 should persist the artifact with `verification-failed`, `not-verified` verdicts, and low confidence. If the artifact cannot satisfy the schema, the test remains failed and should not be marked complete.

## Downstream Behavior

### Current Behavior (no confidence filtering)

Phase 2a (`classify.ts`) reads all extracted records via `readExtractedFile` and passes them directly to the classify agent. Phase 2b (`consolidate.ts`) passes all classified behaviors into consolidation prompts. No trust or confidence filtering occurs at any stage.

### Proposed Behavior (confidence-aware)

Phase 2 should apply a default machine policy when reading extracted artifacts:

1. High-confidence behavior and context are used normally.
2. Medium-confidence behavior can be used, but trust flags should be preserved in classification notes and consolidation provenance.
3. Low-confidence context should be excluded from consolidation prompts by default unless the behavior is strongly grounded.
4. Unsupported implementation claims should not be passed into consolidation prompts as facts.
5. Novel or weakly supported keywords may remain on the artifact, but they should be lower priority for primary keyword batching.
6. Codeindex-resolved dependency paths should feed downstream provenance and incremental invalidation when they are more accurate than mirrored test-to-source heuristics.

This keeps the system fully automated while preventing phase 1 noise from being amplified downstream.

## Reporting

### Current Reporting (no trust metrics)

`report-rebuild-helpers.ts` builds domain summaries with persona scores, flaw frequencies, and improvement frequencies. No trust quality metrics exist.

### Proposed Reporting (trust-aware)

Generated reports should expose trust quality metrics.

At minimum, report rebuild should include counts for:

1. Total extracted behaviors.
2. Fully grounded behaviors.
3. Records with unsupported context.
4. Records with inferred context.
5. Records with novel keywords.
6. Records below downstream confidence threshold.
7. Records with verification failure.
8. Records extracted without fresh codeindex evidence.
9. Records whose implementation context depends on fallback file search rather than resolved symbols.

These metrics make extraction quality visible without introducing a required review queue.

## Error Handling

1. If evidence collection fails, phase 1 may still extract from test source only, but the artifact gets `evidence-collection-failed` and lower confidence.
2. If extraction fails, the test remains failed and is not marked complete.
3. If extraction succeeds but verification fails, persist a low-confidence artifact with `verification-failed` and `not-verified` verdicts.
4. If keyword resolution produces novel or unstable keywords, keep them but flag them with `novel-keyword` or `weak-keyword-evidence`.
5. If the final record fails schema validation, do not persist it and do not mark the test complete.
6. If codeindex is unavailable, stale, or cannot resolve a symbol, continue with fallback evidence but record the condition in `provenance.codeindex`.
7. If codeindex returns ambiguous symbol candidates, include only high-confidence evidence by default and flag any implementation claim that depends on ambiguous resolution.

## Testing Strategy

### Unit Tests

Add focused tests for:

1. Evidence bundle construction.
2. Line reference preservation.
3. Confidence policy derivation.
4. Trust flag derivation.
5. Existing and novel keyword evidence handling.
6. Downstream filtering helpers.
7. Codeindex symbol resolution result mapping into evidence refs.
8. Codeindex unavailable, stale, and ambiguous-result fallback behavior.

### Integration Tests

Add `runPhase1()` tests proving:

1. The expanded schema is written.
2. Verifier failures produce low-confidence persisted artifacts.
3. Extraction failures still preserve atomic persistence behavior.
4. Weak context is flagged and excluded from downstream prompt input.
5. Selected reruns replace old artifacts with the new schema.
6. Codeindex-resolved dependency paths are stored in provenance and used in manifest updates.
7. Codeindex fallback still writes a flagged best-effort artifact when extraction and schema validation succeed.

### Golden Fixtures

Add small golden cases for known failure modes:

1. Unsupported implementation claim in context.
2. Guessed implementation path.
3. Evidence collection fallback.
4. Novel keyword with weak support.
5. High-confidence behavior with low-confidence context.
6. Ambiguous symbol resolution from codeindex.
7. Missing or stale codeindex database.

The announcement/userConfig-style hallucination should be included as an explicit regression case.

## Rollout Plan

This design intentionally breaks the extracted artifact schema.

### Completed

- [x] Phase 1 extraction pipeline (`extract-phase1-single-test.ts`, `extract-phase1-runner.ts`, `extract-phase1-persist.ts`)
- [x] Phase 1 types and deps (`extract-phase1-types.ts`)
- [x] Extracted behavior store with Zod schema (`extracted-store.ts`)
- [x] Extraction agent with retry (`extract-agent.ts`)
- [x] Extraction prompts (`extract-prompts.ts`)
- [x] Incremental manifest and dependency tracking (`incremental.ts`, `extract-incremental.ts`)
- [x] Phase 2a classification (`classify.ts`, `classify-agent.ts`)
- [x] Phase 2b consolidation (`consolidate.ts`, `consolidate-agent.ts`)
- [x] Phase 3 evaluation (`evaluate.ts`, `evaluate-agent.ts`)
- [x] Report rebuild (`report-rebuild-helpers.ts`)
- [x] Basic audit tools (`tools.ts`: readFile, grep, findFiles, listDir)

### Not Yet Implemented

- [ ] Evidence bundle construction (pre-extraction codeindex-backed evidence collection)
- [ ] Codeindex integration in behavior-audit (no codeindex references exist in `scripts/behavior-audit/`)
- [ ] Evidence-bearing `ExtractedBehaviorRecord` schema (9 new fields)
- [ ] Supporting types (`EvidenceRef`, `KeywordEvidence`, `ExtractionConfidence`, `TrustFlag`, `ExtractionProvenance`, `CodeindexProvenance`, `ExtractionVerification`)
- [ ] Evidence-backed extractor prompt (structured claims with evidence references)
- [ ] Verifier agent and confidence policy
- [ ] Trust flags and provenance tracking
- [ ] Confidence-aware downstream filtering in phase 2a/2b
- [ ] Trust quality metrics in reports
- [ ] Migration/clearing of old extracted artifacts

### Remaining Rollout Order

1. Update phase 1 schemas and tests — add the 9 new fields and supporting types to `ExtractedBehaviorRecord`.
2. Add codeindex-backed evidence bundle construction with file-tool fallback — new module (e.g., `extract-evidence.ts`) that calls codeindex before extraction.
3. Add codeindex provenance and trust flags — wire `CodeindexProvenance` into `ExtractionProvenance`.
4. Add evidence-backed extractor output — update `extract-prompts.ts` and `extract-agent.ts` to request structured claims with evidence references.
5. Add verifier agent and confidence policy — new module (e.g., `extract-verifier.ts`) that checks extractor output against evidence bundle.
6. Update phase 2a and phase 2b readers and prompts to be confidence-aware — modify `classify-phase2a-helpers.ts` and `consolidate-helpers.ts`.
7. Update incremental manifest dependency tracking to prefer codeindex-resolved dependencies where available — update `extract-incremental.ts:loadFileDependencies`.
8. Update report rebuild with trust metrics — update `report-rebuild-helpers.ts`.
9. Clear or regenerate old extracted artifacts because old and new schemas should not mix.
10. Run a small selected audit and inspect trust flags, especially codeindex freshness and ambiguity flags.
11. Run the full audit after selected-run quality is acceptable.

## Open Decisions for Implementation Planning

1. Whether verifier output should be produced by a separate model call or a deterministic plus model hybrid.
2. The exact confidence threshold for excluding context from phase 2 prompts.
3. The first prompt and verifier version identifiers.
4. Whether evidence snippets should store full snippets or only line references plus hashes.
5. Whether behavior-audit should call codeindex through direct module imports first or through MCP from the beginning.
6. How strict the freshness check should be before a codeindex result is considered trustworthy.

These decisions can be resolved during implementation planning without changing the approved design direction.
