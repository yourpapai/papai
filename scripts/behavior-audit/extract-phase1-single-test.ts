import { buildProvenance, prepareExtractionContext, type ExtractionContext } from './extract-phase1-evidence.js'
import { buildBehaviorRecord } from './extract-phase1-helpers.js'
import type { Phase1RunnerDeps, SingleTestResult } from './extract-phase1-types.js'
import { verifyExtraction, type VerificationResult } from './extract-verifier.js'
import type { ExtractedBehaviorRecord } from './extracted-store.js'
import type { IncrementalManifest } from './incremental.js'
import { normalizeKeywordSlug } from './keyword-vocabulary.js'
import type { AgentUsage } from './phase-stats.js'
import type { Progress } from './progress.js'
import type { ParsedTestFile, TestCase } from './test-parser.js'

type ExtractionClaims = {
  readonly behavior: string
  readonly context: string
  readonly keywords: readonly string[]
  readonly behaviorClaimRefs: readonly { readonly evidenceIndex: number; readonly claim: string }[]
  readonly contextClaimRefs: readonly { readonly evidenceIndex: number; readonly claim: string }[]
  readonly uncertaintyNotes: readonly string[]
}

type ExtractedWithUsage = {
  readonly result: ExtractionClaims
  readonly usage: AgentUsage
}

export type ExtractionAttemptResult =
  | {
      readonly kind: 'failed'
      readonly detail: string
    }
  | {
      readonly kind: 'succeeded'
      readonly result: NonNullable<SingleTestResult>
    }

export function toTestKey(testFilePath: string, testCase: TestCase): string {
  return `${testFilePath}::${testCase.fullPath}`
}

function normalizeKeywords(keywords: readonly string[]): readonly string[] {
  return [...new Set(keywords.map((keyword) => normalizeKeywordSlug(keyword)).filter(Boolean))]
}

function buildRecord(input: {
  readonly testCase: TestCase
  readonly testFile: ParsedTestFile
  readonly testKey: string
  readonly extracted: ExtractedWithUsage
  readonly evidence: ExtractionContext['evidence']
  readonly verification: VerificationResult
  readonly normalizedKeywords: readonly string[]
}): ExtractedBehaviorRecord {
  return buildBehaviorRecord(
    input.testCase,
    input.testFile.filePath,
    input.testKey,
    input.extracted.result.behavior,
    input.extracted.result.context,
    input.normalizedKeywords,
    input.evidence.behaviorEvidence,
    input.evidence.contextEvidence,
    [],
    input.verification.confidence,
    input.verification.trustFlags,
    buildProvenance(input.evidence),
    input.verification.verification,
  )
}

function buildSuccessfulTestResult(input: {
  readonly testCase: TestCase
  readonly testFile: ParsedTestFile
  readonly testKey: string
  readonly extracted: ExtractedWithUsage
  readonly evidence: ExtractionContext['evidence']
  readonly verification: VerificationResult
  readonly manifest: IncrementalManifest
  readonly deps: Phase1RunnerDeps
  readonly startedAtMs: number
}): Promise<ExtractionAttemptResult> {
  const normalizedKeywords = normalizeKeywords(input.extracted.result.keywords)
  if (normalizedKeywords.length === 0) {
    throw new Error('Expected normalized keywords before building successful result')
  }

  const record = buildRecord({ ...input, normalizedKeywords })
  return input.deps
    .updateManifestForExtractedTest({
      manifest: input.manifest,
      testFile: input.testFile,
      testCase: input.testCase,
      extractedBehavior: record,
    })
    .then(({ manifest, phase1Changed }) => ({
      kind: 'succeeded' as const,
      result: {
        record,
        manifest,
        phase1Changed,
        usage: input.extracted.usage,
        elapsedMs: performance.now() - input.startedAtMs,
      },
    }))
}
function runExtractionFailure(input: {
  readonly deps: Phase1RunnerDeps
  readonly progress: Progress
  readonly testKey: string
  readonly detail: string
}): ExtractionAttemptResult {
  input.deps.markTestFailed(input.progress, input.testKey, input.detail)
  return {
    kind: 'failed',
    detail: input.detail,
  }
}

function toFailureOrKeywords(input: {
  readonly deps: Phase1RunnerDeps
  readonly progress: Progress
  readonly testKey: string
  readonly keywords: readonly string[]
}):
  | { readonly kind: 'failed'; readonly failure: ExtractionAttemptResult }
  | { readonly kind: 'succeeded'; readonly keywords: readonly string[] } {
  const normalizedKeywords = normalizeKeywords(input.keywords)
  if (normalizedKeywords.length === 0) {
    return {
      kind: 'failed' as const,
      failure: runExtractionFailure({
        deps: input.deps,
        progress: input.progress,
        testKey: input.testKey,
        detail: 'extraction produced no valid canonical keywords',
      }),
    }
  }

  return {
    kind: 'succeeded',
    keywords: normalizedKeywords,
  }
}

function verifyAndBuildResult(input: {
  readonly testCase: TestCase
  readonly testFile: ParsedTestFile
  readonly testKey: string
  readonly extracted: ExtractedWithUsage
  readonly evidence: ExtractionContext['evidence']
  readonly manifest: IncrementalManifest
  readonly deps: Phase1RunnerDeps
  readonly startedAtMs: number
}): Promise<ExtractionAttemptResult> {
  const verification = verifyExtraction({
    behavior: input.extracted.result.behavior,
    context: input.extracted.result.context,
    keywords: input.extracted.result.keywords,
    behaviorClaimRefs: input.extracted.result.behaviorClaimRefs,
    contextClaimRefs: input.extracted.result.contextClaimRefs,
    uncertaintyNotes: input.extracted.result.uncertaintyNotes,
    behaviorEvidence: input.evidence.behaviorEvidence,
    contextEvidence: input.evidence.contextEvidence,
    codeindexEnabled: input.evidence.codeindex.enabled,
  })

  return buildSuccessfulTestResult({
    ...input,
    evidence: input.evidence,
    verification,
  })
}

function buildExtractionOutput(
  extracted: NonNullable<Awaited<ReturnType<Phase1RunnerDeps['extractWithRetry']>>>,
  keywords: readonly string[],
): ExtractedWithUsage {
  return {
    result: {
      behavior: extracted.result.behavior,
      context: extracted.result.context,
      keywords,
      behaviorClaimRefs: extracted.result.behaviorClaimRefs,
      contextClaimRefs: extracted.result.contextClaimRefs,
      uncertaintyNotes: extracted.result.uncertaintyNotes,
    },
    usage: extracted.usage,
  }
}

export async function tryExtractTest(input: {
  readonly testCase: TestCase
  readonly testFile: ParsedTestFile
  readonly testKey: string
  readonly progress: Progress
  readonly manifest: IncrementalManifest
  readonly deps: Phase1RunnerDeps
}): Promise<ExtractionAttemptResult> {
  const startedAtMs = performance.now()
  const { evidence, prompt } = await prepareExtractionContext(
    input.testCase,
    input.testFile.filePath,
    input.testKey,
    input.manifest,
  )

  const extracted = await input.deps.extractWithRetry(prompt, 0)
  if (extracted === null) {
    return runExtractionFailure({
      deps: input.deps,
      progress: input.progress,
      testKey: input.testKey,
      detail: 'extraction failed',
    })
  }

  const normalized = toFailureOrKeywords({
    deps: input.deps,
    progress: input.progress,
    testKey: input.testKey,
    keywords: extracted.result.keywords,
  })
  if (normalized.kind === 'failed') {
    return normalized.failure
  }

  return verifyAndBuildResult({
    testCase: input.testCase,
    testFile: input.testFile,
    testKey: input.testKey,
    extracted: buildExtractionOutput(extracted, normalized.keywords),
    evidence,
    manifest: input.manifest,
    deps: input.deps,
    startedAtMs,
  })
}
