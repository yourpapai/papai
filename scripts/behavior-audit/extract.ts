import pLimit from 'p-limit'

import { extractWithRetry } from './extract-agent.js'
import { updateManifestForExtractedTest } from './extract-incremental.js'
import { getSelectedTests, shouldSkipCompletedFile, writeValidBehaviorsForFile } from './extract-phase1-helpers.js'
import { processSelectedTestFile } from './extract-phase1-runner.js'
import type { Phase1RunnerDeps } from './extract-phase1-types.js'
import { saveManifest, type IncrementalManifest } from './incremental.js'
import { createPhaseStats, formatPhaseSummary, type PhaseStats } from './phase-stats.js'
import { saveProgress } from './progress-io.js'
import type { BehaviorAuditProgressReporter } from './progress-reporter.js'
import { resetPhase1bAndBelow } from './progress-resets.js'
import { getFailedTestAttempts, markTestDone, markTestFailed, type Progress } from './progress.js'
import type { ParsedTestFile } from './test-parser.js'

interface Phase1RunInput {
  readonly testFiles: readonly ParsedTestFile[]
  readonly progress: Progress
  readonly selectedTestKeys: ReadonlySet<string>
  readonly manifest: IncrementalManifest
}

export interface Phase1Deps extends Phase1RunnerDeps {
  readonly resetPhase1bAndBelow: typeof resetPhase1bAndBelow
  readonly stats: PhaseStats
}

const defaultPhase1Deps: Omit<Phase1Deps, 'stats'> = {
  extractWithRetry,
  updateManifestForExtractedTest,
  saveManifest,
  saveProgress,
  getFailedTestAttempts,
  markTestDone,
  markTestFailed,
  resetPhase1bAndBelow,
  getSelectedTests,
  shouldSkipCompletedFile,
  writeValidBehaviorsForFile,
  log: console,
  reporter: undefined,
}

function hasSelectedPhase1Work(
  testFiles: readonly ParsedTestFile[],
  selectedTestKeys: ReadonlySet<string>,
  deps: Phase1Deps,
): boolean {
  return testFiles.some(
    (testFile) => deps.getSelectedTests(testFile.filePath, testFile.tests, selectedTestKeys).length > 0,
  )
}

function resolvePhase1Deps(depsInput: Partial<Phase1Deps> | undefined): Phase1Deps {
  let deps: Partial<Phase1Deps>
  if (depsInput === undefined) {
    deps = {}
  } else {
    deps = depsInput
  }

  let stats: PhaseStats
  if (deps.stats === undefined) {
    stats = createPhaseStats()
  } else {
    stats = deps.stats
  }

  return { ...defaultPhase1Deps, ...deps, stats }
}

function logSkippedFile(
  testFilePath: string,
  fileIndex: number,
  totalFiles: number,
  reason: 'no selected tests' | 'already done',
  deps: Phase1Deps,
): void {
  deps.log.log(`[Phase 1] ${fileIndex}/${totalFiles} — ${testFilePath} (skipped, ${reason})`)
}

function processTestFile(input: {
  readonly testFile: ParsedTestFile
  readonly progress: Progress
  readonly fileIndex: number
  readonly totalFiles: number
  readonly selectedTestKeys: ReadonlySet<string>
  readonly manifest: IncrementalManifest
  readonly deps: Phase1Deps
}): Promise<{ readonly manifest: IncrementalManifest; readonly anyPhase1Changed: boolean }> {
  const selectedTests = input.deps.getSelectedTests(
    input.testFile.filePath,
    input.testFile.tests,
    input.selectedTestKeys,
  )
  if (selectedTests.length === 0) {
    logSkippedFile(input.testFile.filePath, input.fileIndex, input.totalFiles, 'no selected tests', input.deps)
    return Promise.resolve({ manifest: input.manifest, anyPhase1Changed: false })
  }

  if (
    input.deps.shouldSkipCompletedFile({
      progress: input.progress,
      testFilePath: input.testFile.filePath,
      selectedTests,
      selectedTestKeys: input.selectedTestKeys,
    })
  ) {
    logSkippedFile(input.testFile.filePath, input.fileIndex, input.totalFiles, 'already done', input.deps)
    return Promise.resolve({ manifest: input.manifest, anyPhase1Changed: false })
  }

  input.deps.log.log(`[Phase 1] ${input.fileIndex}/${input.totalFiles} — ${input.testFile.filePath}`)
  return processSelectedTestFile({
    testFile: input.testFile,
    progress: input.progress,
    selectedTests,
    manifest: input.manifest,
    deps: input.deps,
  })
}

function runAllTestFiles(input: {
  readonly testFiles: readonly ParsedTestFile[]
  readonly progress: Progress
  readonly selectedTestKeys: ReadonlySet<string>
  readonly manifest: IncrementalManifest
  readonly deps: Phase1Deps
}): Promise<readonly { readonly manifest: IncrementalManifest; readonly anyPhase1Changed: boolean }[]> {
  const limit = pLimit(4)
  return Promise.all(
    input.testFiles.map((testFile, index) =>
      limit(() =>
        processTestFile({
          testFile,
          progress: input.progress,
          fileIndex: index + 1,
          totalFiles: input.testFiles.length,
          selectedTestKeys: input.selectedTestKeys,
          manifest: input.manifest,
          deps: input.deps,
        }),
      ),
    ),
  )
}

function mergeFileResults(
  manifest: IncrementalManifest,
  fileResults: readonly { readonly manifest: IncrementalManifest; readonly anyPhase1Changed: boolean }[],
): { readonly mergedManifest: IncrementalManifest; readonly anyPhase1Changed: boolean } {
  const anyPhase1Changed = fileResults.some((result) => result.anyPhase1Changed)
  const mergedTests: IncrementalManifest['tests'] = { ...manifest.tests }
  for (const result of fileResults) {
    Object.assign(mergedTests, result.manifest.tests)
  }
  const mergedManifest: IncrementalManifest = {
    ...manifest,
    tests: mergedTests,
  }
  return { mergedManifest, anyPhase1Changed }
}

function finalizePhase1(input: {
  readonly progress: Progress
  readonly hasSelectedWork: boolean
  readonly anyPhase1Changed: boolean
  readonly stats: PhaseStats
  readonly deps: Phase1Deps
}): void {
  if (input.anyPhase1Changed && !input.hasSelectedWork) {
    input.deps.resetPhase1bAndBelow(input.progress)
  }
  input.progress.phase1.status = 'done'
  const wallMs = performance.now() - input.stats.wallStartMs
  const label = `[Phase 1 complete] ${input.progress.phase1.stats.filesDone} files, ${input.progress.phase1.stats.testsExtracted} behaviors extracted, ${input.progress.phase1.stats.testsFailed} failed`
  input.deps.log.log(`\n${formatPhaseSummary(input.stats, wallMs, label)}`)
}

export async function runPhase1(
  { testFiles, progress, selectedTestKeys, manifest }: Phase1RunInput,
  depsInput: Partial<Phase1Deps> | undefined,
): Promise<void> {
  const resolvedDeps = resolvePhase1Deps(depsInput)
  const stats = resolvedDeps.stats
  const selectedWork = hasSelectedPhase1Work(testFiles, selectedTestKeys, resolvedDeps)
  if (selectedWork) {
    resolvedDeps.resetPhase1bAndBelow(progress)
  }

  progress.phase1.status = 'in-progress'
  await resolvedDeps.saveProgress(progress)
  const fileResults = await runAllTestFiles({
    testFiles,
    progress,
    selectedTestKeys,
    manifest,
    deps: resolvedDeps,
  })
  const { mergedManifest, anyPhase1Changed } = mergeFileResults(manifest, fileResults)
  await resolvedDeps.saveManifest(mergedManifest)
  finalizePhase1({
    progress,
    hasSelectedWork: selectedWork,
    anyPhase1Changed,
    stats,
    deps: resolvedDeps,
  })
  await resolvedDeps.saveProgress(progress)
}

export type { BehaviorAuditProgressReporter }
