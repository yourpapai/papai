import { markFileDoneWhenSelectedTestsPersisted, reconcileSelectedTestsAfterPersist } from './extract-phase1-helpers.js'
import type { Phase1RunnerDeps, SingleTestResult } from './extract-phase1-types.js'
import { reportPhase1ArtifactWrite, reportPhase1Failure, reportPhase1Success } from './extract-reporting.js'
import type { IncrementalManifest } from './incremental.js'
import type { Progress } from './progress.js'
import type { TestCase } from './test-parser.js'

function collectPersistedTestKeys(results: readonly SingleTestResult[]): ReadonlySet<string> {
  return new Set(results.flatMap((result) => (result === null ? [] : [result.record.testKey])))
}

function emitPersistenceFailureForResults(input: {
  readonly results: readonly SingleTestResult[]
  readonly selectedTests: readonly TestCase[]
  readonly testFilePath: string
  readonly deps: Phase1RunnerDeps
  readonly detail: string
}): void {
  for (const [index, result] of input.results.entries()) {
    if (result === null) {
      continue
    }

    const testCase = input.selectedTests[index]
    if (testCase === undefined) {
      continue
    }

    reportPhase1Failure({
      deps: input.deps,
      itemId: result.record.testKey,
      context: input.testFilePath,
      title: testCase.name,
      index: index + 1,
      total: input.selectedTests.length,
      detail: input.detail,
      usage: undefined,
    })
  }
}

export async function persistExtractedResults(input: {
  readonly extractionResult: {
    readonly results: readonly SingleTestResult[]
    readonly manifest: IncrementalManifest
  }
  readonly testFilePath: string
  readonly selectedTests: readonly TestCase[]
  readonly progress: Progress
  readonly deps: Phase1RunnerDeps
}): Promise<void> {
  let artifactWriteDetail: string | null
  try {
    artifactWriteDetail = await input.deps.writeValidBehaviorsForFile(
      input.testFilePath,
      input.selectedTests,
      input.extractionResult.results,
    )
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    emitPersistenceFailureForResults({
      results: input.extractionResult.results,
      selectedTests: input.selectedTests,
      testFilePath: input.testFilePath,
      deps: input.deps,
      detail,
    })
    throw error
  }

  if (artifactWriteDetail !== null) {
    reportPhase1ArtifactWrite({
      deps: input.deps,
      context: input.testFilePath,
      detail: artifactWriteDetail,
    })
  }

  const persistedTestKeys = collectPersistedTestKeys(input.extractionResult.results)
  reconcileSelectedTestsAfterPersist(input.progress, input.testFilePath, input.selectedTests, persistedTestKeys)
  for (const testKey of persistedTestKeys) {
    input.deps.markTestDone(input.progress, input.testFilePath, testKey)
  }
  await input.deps.saveManifest(input.extractionResult.manifest)
  markFileDoneWhenSelectedTestsPersisted(input.progress, input.testFilePath, input.selectedTests)
  await input.deps.saveProgress(input.progress)
}

export function emitPersistedResults(input: {
  readonly results: readonly SingleTestResult[]
  readonly selectedTests: readonly TestCase[]
  readonly testFilePath: string
  readonly deps: Phase1RunnerDeps
}): void {
  for (const [index, result] of input.results.entries()) {
    if (result === null) {
      continue
    }

    const testCase = input.selectedTests[index]
    if (testCase === undefined) {
      continue
    }

    reportPhase1Success({
      deps: input.deps,
      itemId: result.record.testKey,
      context: input.testFilePath,
      title: testCase.name,
      index: index + 1,
      total: input.selectedTests.length,
      usage: result.usage,
      elapsedMs: result.elapsedMs,
    })
  }
}
