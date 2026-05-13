import pLimit from 'p-limit'

import { MAX_RETRIES } from './config.js'
import { emitPersistedResults, persistExtractedResults } from './extract-phase1-persist.js'
import { toTestKey, tryExtractTest } from './extract-phase1-single-test.js'
import type { Phase1RunnerDeps, SingleTestResult } from './extract-phase1-types.js'
import { emitPhase1ItemStart, reportPhase1Failure, reportPhase1Skipped } from './extract-reporting.js'
import type { IncrementalManifest } from './incremental.js'
import type { Progress } from './progress.js'
import type { ParsedTestFile, TestCase } from './test-parser.js'

function beginSingleTest(input: {
  readonly deps: Phase1RunnerDeps
  readonly progress: Progress
  readonly testCase: TestCase
  readonly testFilePath: string
  readonly displayIndex: number
  readonly totalTests: number
}): { readonly testKey: string } | null {
  const testKey = toTestKey(input.testFilePath, input.testCase)
  emitPhase1ItemStart({
    deps: input.deps,
    itemId: testKey,
    context: input.testFilePath,
    title: input.testCase.name,
    index: input.displayIndex,
    total: input.totalTests,
  })

  if (input.deps.getFailedTestAttempts(input.progress, testKey) < MAX_RETRIES) {
    return { testKey }
  }

  reportPhase1Skipped({
    deps: input.deps,
    itemId: testKey,
    context: input.testFilePath,
    title: input.testCase.name,
    index: input.displayIndex,
    total: input.totalTests,
  })
  return null
}

function emitSingleTestFailure(input: {
  readonly deps: Phase1RunnerDeps
  readonly testKey: string
  readonly testFilePath: string
  readonly title: string
  readonly displayIndex: number
  readonly totalTests: number
  readonly detail: string
}): null {
  reportPhase1Failure({
    deps: input.deps,
    itemId: input.testKey,
    context: input.testFilePath,
    title: input.title,
    index: input.displayIndex,
    total: input.totalTests,
    detail: input.detail,
    usage: undefined,
  })
  return null
}

function buildSkippedSingleTestResult(currentManifest: IncrementalManifest): {
  readonly result: SingleTestResult
  readonly manifest: IncrementalManifest
  readonly phase1Changed: boolean
} {
  return { result: null, manifest: currentManifest, phase1Changed: false }
}

function extractStartedTestCase(input: {
  readonly testCase: TestCase
  readonly testFile: ParsedTestFile
  readonly testKey: string
  readonly progress: Progress
  readonly currentManifest: IncrementalManifest
  readonly deps: Phase1RunnerDeps
}): ReturnType<typeof tryExtractTest> {
  return tryExtractTest({
    testCase: input.testCase,
    testFile: input.testFile,
    testKey: input.testKey,
    progress: input.progress,
    manifest: input.currentManifest,
    deps: input.deps,
  })
}

function buildSuccessfulSingleTestResult(input: {
  readonly result: NonNullable<SingleTestResult>
  readonly currentManifest: IncrementalManifest
}): {
  readonly result: SingleTestResult
  readonly manifest: IncrementalManifest
  readonly phase1Changed: boolean
} {
  return {
    result: input.result,
    manifest: input.result.manifest,
    phase1Changed: input.result.phase1Changed,
  }
}

async function extractSingleTestCase(input: {
  readonly testCase: TestCase
  readonly index: number
  readonly totalTests: number
  readonly testFile: ParsedTestFile
  readonly progress: Progress
  readonly currentManifest: IncrementalManifest
  readonly deps: Phase1RunnerDeps
}): Promise<{
  readonly result: SingleTestResult
  readonly manifest: IncrementalManifest
  readonly phase1Changed: boolean
}> {
  const started = beginSingleTest({
    deps: input.deps,
    progress: input.progress,
    testCase: input.testCase,
    testFilePath: input.testFile.filePath,
    displayIndex: input.index + 1,
    totalTests: input.totalTests,
  })
  if (started === null) {
    return buildSkippedSingleTestResult(input.currentManifest)
  }

  const extraction = await extractStartedTestCase({
    testCase: input.testCase,
    testFile: input.testFile,
    testKey: started.testKey,
    progress: input.progress,
    currentManifest: input.currentManifest,
    deps: input.deps,
  })
  if (extraction.kind === 'failed') {
    emitSingleTestFailure({
      deps: input.deps,
      testKey: started.testKey,
      testFilePath: input.testFile.filePath,
      title: input.testCase.name,
      displayIndex: input.index + 1,
      totalTests: input.totalTests,
      detail: extraction.detail,
    })
    return buildSkippedSingleTestResult(input.currentManifest)
  }

  return buildSuccessfulSingleTestResult({ result: extraction.result, currentManifest: input.currentManifest })
}

async function runSelectedExtractions(input: {
  readonly selectedTests: readonly TestCase[]
  readonly testFile: ParsedTestFile
  readonly progress: Progress
  readonly manifest: IncrementalManifest
  readonly deps: Phase1RunnerDeps
}): Promise<{
  readonly results: readonly SingleTestResult[]
  readonly manifest: IncrementalManifest
  readonly anyPhase1Changed: boolean
}> {
  let currentManifest = input.manifest
  let anyPhase1Changed = false
  const limit = pLimit(1)
  const results = await Promise.all(
    input.selectedTests.map((testCase, index) =>
      limit(async () => {
        const { result, manifest, phase1Changed } = await extractSingleTestCase({
          testCase,
          index,
          totalTests: input.selectedTests.length,
          testFile: input.testFile,
          progress: input.progress,
          currentManifest,
          deps: input.deps,
        })
        currentManifest = manifest
        if (phase1Changed) {
          anyPhase1Changed = true
        }
        return result
      }),
    ),
  )

  return { results, manifest: currentManifest, anyPhase1Changed }
}

export async function processSelectedTestFile(input: {
  readonly testFile: ParsedTestFile
  readonly progress: Progress
  readonly selectedTests: readonly TestCase[]
  readonly manifest: IncrementalManifest
  readonly deps: Phase1RunnerDeps
}): Promise<{ readonly manifest: IncrementalManifest; readonly anyPhase1Changed: boolean }> {
  const extractionResult = await runSelectedExtractions({
    selectedTests: input.selectedTests,
    testFile: input.testFile,
    progress: input.progress,
    manifest: input.manifest,
    deps: input.deps,
  })

  await persistExtractedResults({
    extractionResult,
    testFilePath: input.testFile.filePath,
    selectedTests: input.selectedTests,
    progress: input.progress,
    deps: input.deps,
  })
  emitPersistedResults({
    results: extractionResult.results,
    selectedTests: input.selectedTests,
    testFilePath: input.testFile.filePath,
    deps: input.deps,
  })

  return {
    manifest: extractionResult.manifest,
    anyPhase1Changed: extractionResult.anyPhase1Changed,
  }
}
