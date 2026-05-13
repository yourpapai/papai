// scripts/behavior-audit/index.ts
import { runPhase2a } from './classify.js'
import { PROGRESS_RENDERER } from './config.js'
import { runPhase1b } from './consolidate-keywords.js'
import {
  createRunReporter,
  isTestEnvironment,
  loadOrCreateProgress,
  prepareIncrementalRun,
  requireOpenAiApiKey,
  runPhase2bIfNeeded,
  selectIncrementalRunWork as selectIncrementalRunWorkWithLog,
} from './entrypoint-helpers.js'
import { runPhase3 } from './evaluate.js'
import { runPhase1 } from './extract.js'
import type { IncrementalManifest } from './incremental.js'
import { saveConsolidatedManifest } from './incremental.js'
import {
  createProgressReporter,
  type BehaviorAuditProgressReporter,
  type CreateProgressReporterInput,
} from './progress-reporter.js'
import type { Progress } from './progress.js'
import { rebuildReportsFromStoredResults } from './report-writer.js'
import type { ParsedTestFile } from './test-parser.js'

function defaultRunPhase2bIfNeeded(
  progress: Progress,
  phase2Version: string,
  selectedFeatureKeys: ReadonlySet<string>,
  reporter: BehaviorAuditProgressReporter,
): Promise<import('./incremental.js').ConsolidatedManifest> {
  return runPhase2bIfNeeded({
    progress,
    phase2Version,
    selectedFeatureKeys,
    reporter,
  })
}

async function runPhase1IfNeeded(
  parsedFiles: readonly ParsedTestFile[],
  progress: Progress,
  selectedTestKeys: ReadonlySet<string>,
  manifest: IncrementalManifest,
  reporter: BehaviorAuditProgressReporter,
): Promise<void> {
  if (progress.phase1.status === 'done' && selectedTestKeys.size === 0) {
    console.log('[Phase 1] Already complete, skipping.\n')
    return
  }
  await runPhase1({ testFiles: parsedFiles, progress, selectedTestKeys, manifest }, { reporter })
}

function runPhase1bIfNeeded(progress: Progress): Promise<void> {
  return runPhase1b(progress)
}

function runPhase2aIfNeeded(
  progress: Progress,
  manifest: IncrementalManifest,
  selectedTestKeys: ReadonlySet<string>,
  reporter: BehaviorAuditProgressReporter,
): Promise<ReadonlySet<string>> {
  if (progress.phase2a.status === 'done' && selectedTestKeys.size === 0) {
    return Promise.resolve(new Set())
  }
  return runPhase2a({ progress, selectedTestKeys, manifest }, { reporter })
}

async function runPhase3IfNeeded(
  progress: Progress,
  selectedConsolidatedIds: ReadonlySet<string>,
  selectedFeatureKeys: ReadonlySet<string>,
  consolidatedManifest: import('./incremental.js').ConsolidatedManifest | null,
  reporter: BehaviorAuditProgressReporter,
): Promise<void> {
  if (progress.phase3.status === 'done' && selectedConsolidatedIds.size === 0) {
    console.log('[Phase 3] Already complete.\n')
    return
  }
  await runPhase3({ progress, selectedConsolidatedIds, selectedFeatureKeys, consolidatedManifest }, { reporter })
}

function defaultSelectIncrementalRunWork(input: {
  readonly previousManifest: IncrementalManifest
  readonly updatedManifest: IncrementalManifest
  readonly previousLastStartCommit: string | null
}): Promise<{
  readonly parsedFiles: readonly ParsedTestFile[]
  readonly previousConsolidatedManifest: import('./incremental.js').ConsolidatedManifest | null
  readonly selection: import('./incremental.js').IncrementalSelection
}> {
  return selectIncrementalRunWorkWithLog({
    ...input,
    log: console,
  })
}

export interface BehaviorAuditDeps {
  readonly requireOpenAiApiKey: () => void
  readonly prepareIncrementalRun: typeof prepareIncrementalRun
  readonly selectIncrementalRunWork: typeof defaultSelectIncrementalRunWork
  readonly loadOrCreateProgress: typeof loadOrCreateProgress
  readonly createProgressReporter: (input: CreateProgressReporterInput) => BehaviorAuditProgressReporter
  readonly rebuildReportsFromStoredResults: typeof rebuildReportsFromStoredResults
  readonly runPhase1IfNeeded: (
    parsedFiles: readonly ParsedTestFile[],
    progress: Progress,
    selectedTestKeys: ReadonlySet<string>,
    manifest: IncrementalManifest,
    reporter: BehaviorAuditProgressReporter,
  ) => Promise<void>
  readonly runPhase1bIfNeeded: typeof runPhase1bIfNeeded
  readonly runPhase2aIfNeeded: (
    progress: Progress,
    manifest: IncrementalManifest,
    selectedTestKeys: ReadonlySet<string>,
    reporter: BehaviorAuditProgressReporter,
  ) => Promise<ReadonlySet<string>>
  readonly runPhase2bIfNeeded: (
    progress: Progress,
    phase2Version: string,
    selectedFeatureKeys: ReadonlySet<string>,
    reporter: BehaviorAuditProgressReporter,
  ) => Promise<import('./incremental.js').ConsolidatedManifest>
  readonly saveConsolidatedManifest: typeof saveConsolidatedManifest
  readonly runPhase3IfNeeded: (
    progress: Progress,
    selectedConsolidatedIds: ReadonlySet<string>,
    selectedFeatureKeys: ReadonlySet<string>,
    consolidatedManifest: import('./incremental.js').ConsolidatedManifest | null,
    reporter: BehaviorAuditProgressReporter,
  ) => Promise<void>
  readonly stdout: Pick<NodeJS.WriteStream, 'isTTY'>
  readonly isTestEnvironment: boolean
  readonly log: Pick<typeof console, 'log'>
}

const defaultBehaviorAuditDeps: BehaviorAuditDeps = {
  requireOpenAiApiKey,
  prepareIncrementalRun,
  selectIncrementalRunWork: defaultSelectIncrementalRunWork,
  loadOrCreateProgress,
  createProgressReporter,
  rebuildReportsFromStoredResults,
  runPhase1IfNeeded,
  runPhase1bIfNeeded,
  runPhase2aIfNeeded,
  runPhase2bIfNeeded: defaultRunPhase2bIfNeeded,
  saveConsolidatedManifest,
  runPhase3IfNeeded,
  stdout: process.stdout,
  isTestEnvironment: isTestEnvironment(),
  log: console,
}

async function executeSelectedBehaviorAuditWork(input: {
  readonly deps: BehaviorAuditDeps
  readonly parsedFiles: readonly ParsedTestFile[]
  readonly updatedManifest: IncrementalManifest
  readonly previousConsolidatedManifest: import('./incremental.js').ConsolidatedManifest | null
  readonly selection: import('./incremental.js').IncrementalSelection
  readonly progress: Progress
  readonly reporter: BehaviorAuditProgressReporter
}): Promise<void> {
  if (input.selection.reportRebuildOnly) {
    await input.deps.rebuildReportsFromStoredResults({
      consolidatedManifest: input.previousConsolidatedManifest,
    })
    input.deps.log.log('\nBehavior audit complete.')
    return
  }

  await input.deps.runPhase1IfNeeded(
    input.parsedFiles,
    input.progress,
    new Set(input.selection.phase1SelectedTestKeys),
    input.updatedManifest,
    input.reporter,
  )
  await input.deps.runPhase1bIfNeeded(input.progress)
  const dirtyFromPhase2a = await input.deps.runPhase2aIfNeeded(
    input.progress,
    input.updatedManifest,
    new Set(input.selection.phase2aSelectedTestKeys),
    input.reporter,
  )
  const phase2bSelectedKeys = new Set([...input.selection.phase2bSelectedFeatureKeys, ...dirtyFromPhase2a])
  const consolidatedManifest = await input.deps.runPhase2bIfNeeded(
    input.progress,
    input.updatedManifest.phaseVersions.phase2,
    phase2bSelectedKeys,
    input.reporter,
  )
  await input.deps.saveConsolidatedManifest(consolidatedManifest)

  await input.deps.runPhase3IfNeeded(
    input.progress,
    new Set(input.selection.phase3SelectedConsolidatedIds),
    phase2bSelectedKeys,
    consolidatedManifest,
    input.reporter,
  )

  input.deps.log.log('\nBehavior audit complete.')
}

export async function runBehaviorAudit(): Promise<void>
export async function runBehaviorAudit(deps: BehaviorAuditDeps): Promise<void>
export async function runBehaviorAudit(...args: readonly [] | readonly [BehaviorAuditDeps]): Promise<void> {
  const deps = args[0]
  let resolvedDeps: BehaviorAuditDeps
  if (deps === undefined) {
    resolvedDeps = defaultBehaviorAuditDeps
  } else {
    resolvedDeps = deps
  }
  resolvedDeps.requireOpenAiApiKey()
  resolvedDeps.log.log('Behavior Audit — discovering test files...\n')

  const { previousManifest, previousLastStartCommit, updatedManifest } = await resolvedDeps.prepareIncrementalRun()
  const { parsedFiles, previousConsolidatedManifest, selection } = await resolvedDeps.selectIncrementalRunWork({
    previousManifest,
    updatedManifest,
    previousLastStartCommit,
  })

  const progress = await resolvedDeps.loadOrCreateProgress(parsedFiles.length)
  const reporter = createRunReporter({
    createProgressReporter: resolvedDeps.createProgressReporter,
    configuredRenderer: PROGRESS_RENDERER,
    isTTY: resolvedDeps.stdout.isTTY,
    isTestEnvironment: resolvedDeps.isTestEnvironment,
    log: resolvedDeps.log,
  })

  try {
    await executeSelectedBehaviorAuditWork({
      deps: resolvedDeps,
      parsedFiles,
      updatedManifest,
      previousConsolidatedManifest,
      selection,
      progress,
      reporter,
    })
  } finally {
    reporter.end()
  }
}

if (import.meta.main) {
  await runBehaviorAudit().catch((error: unknown) => {
    console.error('Fatal error:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
