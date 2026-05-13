import { extractedArtifactPathForTestFile } from './artifact-paths.js'
import { getDomain } from './domain-map.js'
import type {
  EvidenceRef,
  ExtractionConfidence,
  ExtractionProvenance,
  ExtractionVerification,
  KeywordEvidence,
  TrustFlag,
} from './extract-trust-types.js'
import type { ExtractedBehaviorRecord } from './extracted-store.js'
import { readExtractedFile, writeExtractedFile } from './extracted-store.js'
import { markFileDone } from './progress.js'
import type { Progress } from './progress.js'
import type { TestCase } from './test-parser.js'

export function getSelectedTests(
  testFilePath: string,
  tests: readonly TestCase[],
  selectedTestKeys: ReadonlySet<string>,
): readonly TestCase[] {
  return tests.filter((testCase) => selectedTestKeys.has(`${testFilePath}::${testCase.fullPath}`))
}

function getCompletedTestsForFile(progress: Progress, testFilePath: string): Readonly<Record<string, 'done'>> {
  const completedTestsForFile = progress.phase1.completedTests[testFilePath]
  if (completedTestsForFile === undefined) {
    return {}
  }
  return completedTestsForFile
}

function getSelectedTestKeySet(testFilePath: string, selectedTests: readonly TestCase[]): ReadonlySet<string> {
  return new Set(selectedTests.map((testCase) => `${testFilePath}::${testCase.fullPath}`))
}

function removeCompletedFile(progress: Progress, testFilePath: string): void {
  const hadCompletedFile = progress.phase1.completedFiles.includes(testFilePath)
  progress.phase1.completedFiles = progress.phase1.completedFiles.filter((filePath) => filePath !== testFilePath)
  if (hadCompletedFile) {
    progress.phase1.stats.filesDone = Math.max(0, progress.phase1.stats.filesDone - 1)
  }
}

async function deleteFileIfPresent(filePath: string): Promise<void> {
  const file = Bun.file(filePath)
  if (await file.exists()) {
    await file.delete()
  }
}

function areSelectedTestsDone(
  testFilePath: string,
  selectedTests: readonly TestCase[],
  completedTests: Readonly<Record<string, 'done'>>,
): boolean {
  return selectedTests.every((testCase) => completedTests[`${testFilePath}::${testCase.fullPath}`] === 'done')
}

export function shouldSkipCompletedFile(input: {
  readonly progress: Progress
  readonly testFilePath: string
  readonly selectedTests: readonly TestCase[]
  readonly selectedTestKeys: ReadonlySet<string>
}): boolean {
  if (input.selectedTestKeys.size > 0 || !input.progress.phase1.completedFiles.includes(input.testFilePath)) {
    return false
  }
  return areSelectedTestsDone(
    input.testFilePath,
    input.selectedTests,
    getCompletedTestsForFile(input.progress, input.testFilePath),
  )
}

export function collectValidBehaviors(
  results: readonly ({ readonly record: ExtractedBehaviorRecord } | null)[],
): readonly ExtractedBehaviorRecord[] {
  return results
    .filter((result): result is { readonly record: ExtractedBehaviorRecord } => result !== null)
    .map((result) => result.record)
}

export async function writeValidBehaviorsForFile(
  testFilePath: string,
  selectedTests: readonly TestCase[],
  results: readonly ({ readonly record: ExtractedBehaviorRecord } | null)[],
): Promise<string | null> {
  const valid = collectValidBehaviors(results)
  const existing = (await readExtractedFile(testFilePath)) ?? []
  const selectedTestKeySet = getSelectedTestKeySet(testFilePath, selectedTests)
  const merged = [
    ...existing.filter(
      (record) => !selectedTestKeySet.has(record.testKey) && !selectedTestKeySet.has(record.behaviorId),
    ),
    ...valid,
  ]
  if (merged.length === 0) {
    await deleteFileIfPresent(extractedArtifactPathForTestFile(testFilePath))
    return null
  }
  await writeExtractedFile(testFilePath, merged)
  return `wrote ${valid.length} behaviors`
}

export function reconcileSelectedTestsAfterPersist(
  progress: Progress,
  testFilePath: string,
  selectedTests: readonly TestCase[],
  persistedTestKeys: ReadonlySet<string>,
): void {
  const selectedTestKeySet = getSelectedTestKeySet(testFilePath, selectedTests)
  const completedTestsForFile = getCompletedTestsForFile(progress, testFilePath)
  const nextCompletedEntries = Object.entries(completedTestsForFile).filter(([testKey]) => {
    const shouldKeep = !selectedTestKeySet.has(testKey) || persistedTestKeys.has(testKey)
    if (!shouldKeep && completedTestsForFile[testKey] === 'done') {
      progress.phase1.stats.testsExtracted = Math.max(0, progress.phase1.stats.testsExtracted - 1)
    }
    return shouldKeep
  })

  progress.phase1.completedTests =
    nextCompletedEntries.length === 0
      ? Object.fromEntries(
          Object.entries(progress.phase1.completedTests).filter(([filePath]) => filePath !== testFilePath),
        )
      : {
          ...progress.phase1.completedTests,
          [testFilePath]: Object.fromEntries(nextCompletedEntries),
        }

  const hasMissingSelectedPersistence = [...selectedTestKeySet].some((testKey) => !persistedTestKeys.has(testKey))
  if (hasMissingSelectedPersistence) {
    removeCompletedFile(progress, testFilePath)
  }
}

export function markFileDoneWhenSelectedTestsPersisted(
  progress: Progress,
  testFilePath: string,
  selectedTests: readonly TestCase[],
): void {
  const selectedTestKeySet = getSelectedTestKeySet(testFilePath, selectedTests)
  const completedTests = getCompletedTestsForFile(progress, testFilePath)
  const allSelectedTestsPersisted = [...selectedTestKeySet].every((testKey) => completedTests[testKey] === 'done')
  if (allSelectedTestsPersisted) {
    markFileDone(progress, testFilePath)
  }
}

export function buildBehaviorRecord(
  testCase: TestCase,
  testFilePath: string,
  testKey: string,
  extractedBehavior: string,
  extractedContext: string,
  keywords: readonly string[],
  behaviorEvidence: readonly EvidenceRef[],
  contextEvidence: readonly EvidenceRef[],
  keywordEvidence: readonly KeywordEvidence[],
  confidence: ExtractionConfidence,
  trustFlags: readonly TrustFlag[],
  provenance: ExtractionProvenance,
  verification: ExtractionVerification,
): ExtractedBehaviorRecord {
  return {
    behaviorId: testKey,
    testKey,
    testFile: testFilePath,
    domain: getDomain(testFilePath),
    testName: testCase.name,
    fullPath: testCase.fullPath,
    behavior: extractedBehavior,
    context: extractedContext,
    keywords,
    extractedAt: new Date().toISOString(),
    behaviorEvidence,
    contextEvidence,
    keywordEvidence,
    confidence,
    trustFlags,
    provenance,
    verification,
  }
}
