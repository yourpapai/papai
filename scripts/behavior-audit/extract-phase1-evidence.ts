import { collectEvidence, type EvidenceBundle } from './extract-evidence.js'
import { buildEvidenceBackedPrompt } from './extract-prompts.js'
import type { CodeindexQueryProvenance, EvidenceRef, ExtractionProvenance } from './extract-trust-types.js'
import type { IncrementalManifest } from './incremental.js'
import type { TestCase } from './test-parser.js'

function collectEvidenceWithFallback(input: {
  readonly testCase: TestCase
  readonly testFilePath: string
  readonly manifestDependencyPaths: readonly string[]
}): Promise<EvidenceBundle> {
  return collectEvidence({
    testCase: input.testCase,
    testFilePath: input.testFilePath,
    manifestDependencyPaths: input.manifestDependencyPaths,
  }).catch(() => ({
    behaviorEvidence: [] as readonly EvidenceRef[],
    contextEvidence: [] as readonly EvidenceRef[],
    keywordEvidence: [] as readonly EvidenceRef[],
    evidenceFilesRead: [input.testFilePath] as readonly string[],
    dependencyPaths: input.manifestDependencyPaths,
    codeindex: {
      enabled: false,
      mode: 'unavailable' as const,
      indexStatus: 'unknown' as const,
      queries: [] as readonly CodeindexQueryProvenance[],
    },
  }))
}

export function buildProvenance(evidence: EvidenceBundle): ExtractionProvenance {
  return {
    promptVersion: 'evidence-backed-v1',
    verifierVersion: 'v1',
    evidenceFilesRead: evidence.evidenceFilesRead,
    dependencyPaths: evidence.dependencyPaths,
    codeindex: evidence.codeindex,
  }
}

export interface ExtractionContext {
  readonly evidence: EvidenceBundle
  readonly prompt: string
}

export async function prepareExtractionContext(
  testCase: TestCase,
  testFilePath: string,
  testKey: string,
  manifest: IncrementalManifest,
): Promise<ExtractionContext> {
  const manifestDependencyPaths = manifest.tests?.[testKey]?.dependencyPaths ?? []
  const evidence = await collectEvidenceWithFallback({
    testCase,
    testFilePath,
    manifestDependencyPaths,
  })
  const prompt = buildEvidenceBackedPrompt({
    testCase,
    testFilePath,
    behaviorEvidence: evidence.behaviorEvidence,
    contextEvidence: evidence.contextEvidence,
  })
  return { evidence, prompt }
}
