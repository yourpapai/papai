import { evaluateWithRetry } from './evaluate-agent.js'
import {
  parseBehaviors,
  resolveSelection,
  toReportMaps,
  updateManifest,
  type ParsedBehavior,
} from './evaluate-phase3-helpers.js'
import type { Phase3ReportingDeps } from './evaluate-progress.js'
import { writeReports } from './evaluate-reporting.js'
import { collectNewEvaluations, finalizeCollectedEvaluations } from './evaluate-runner.js'
import { loadStoredFeatureData, groupCollectedEvaluations, persistEvaluations } from './evaluate-store.js'
import { readEvaluatedFile, writeEvaluatedFile } from './evaluated-store.js'
import type { ConsolidatedManifest } from './incremental.js'
import { saveConsolidatedManifest } from './incremental.js'
import { ALL_PERSONAS } from './personas.js'
import { createPhaseStats, formatPhaseSummary } from './phase-stats.js'
import { saveProgress } from './progress-io.js'
import type { Progress } from './progress.js'
import { getFailedBehaviorAttempts, isBehaviorCompleted, markBehaviorDone, markBehaviorFailed } from './progress.js'
import { readConsolidatedFile } from './report-writer.js'

interface Phase3RunInput {
  readonly progress: Progress
  readonly selectedConsolidatedIds: ReadonlySet<string>
  readonly selectedFeatureKeys: ReadonlySet<string> | undefined
  readonly consolidatedManifest: ConsolidatedManifest | null
}

export interface Phase3Deps extends Phase3ReportingDeps {
  readonly evaluateWithRetry: typeof evaluateWithRetry
  readonly readConsolidatedFile: typeof readConsolidatedFile
  readonly readEvaluatedFile: typeof readEvaluatedFile
  readonly writeEvaluatedFile: typeof writeEvaluatedFile
  readonly getFailedBehaviorAttempts: typeof getFailedBehaviorAttempts
  readonly isBehaviorCompleted: typeof isBehaviorCompleted
  readonly markBehaviorDone: typeof markBehaviorDone
  readonly markBehaviorFailed: typeof markBehaviorFailed
  readonly saveProgress: typeof saveProgress
  readonly saveConsolidatedManifest: typeof saveConsolidatedManifest
  readonly writeReports: typeof writeReports
  readonly stats: ReturnType<typeof createPhaseStats>
}

const defaultPhase3Deps: Omit<Phase3Deps, 'stats'> = {
  evaluateWithRetry,
  readConsolidatedFile,
  readEvaluatedFile,
  writeEvaluatedFile,
  getFailedBehaviorAttempts,
  isBehaviorCompleted,
  markBehaviorDone,
  markBehaviorFailed,
  saveProgress,
  saveConsolidatedManifest,
  writeReports,
  log: console,
  reporter: undefined,
}

function buildPrompt(behavior: ParsedBehavior): string {
  return `${ALL_PERSONAS}\n\n---\n\n**Domain:** ${behavior.domain}\n**Feature:** ${behavior.featureName}\n**User Story:** ${behavior.userStory}\n\n**Behavior:** ${behavior.behavior}\n\n**Context:** ${behavior.context}`
}

function toEmptySelectedFeatureKeys(selectedFeatureKeys: ReadonlySet<string> | undefined): ReadonlySet<string> {
  if (selectedFeatureKeys === undefined) {
    return new Set()
  }

  return selectedFeatureKeys
}

function resolvePhase3Deps(depsInput: Partial<Phase3Deps> | undefined): Phase3Deps {
  let deps: Partial<Phase3Deps>
  if (depsInput === undefined) {
    deps = {}
  } else {
    deps = depsInput
  }

  let stats: ReturnType<typeof createPhaseStats>
  if (deps.stats === undefined) {
    stats = createPhaseStats()
  } else {
    stats = deps.stats
  }

  return { ...defaultPhase3Deps, ...deps, stats }
}

async function persistPhase3Outputs(input: {
  readonly consolidatedManifest: ConsolidatedManifest
  readonly groupedCollected: ReadonlyMap<string, readonly import('./evaluated-store.js').EvaluatedFeatureRecord[]>
  readonly storedByFeatureKey: ReadonlyMap<string, import('./evaluate-phase3-helpers.js').StoredFeatureData>
  readonly progress: Progress
  readonly deps: Phase3Deps
}): Promise<ConsolidatedManifest> {
  await persistEvaluations(input.groupedCollected, input.storedByFeatureKey, input.deps)
  const reloadedStoredByFeatureKey = await loadStoredFeatureData(input.consolidatedManifest, input.deps)
  const updatedManifest = updateManifest(input.consolidatedManifest, reloadedStoredByFeatureKey)
  await input.deps.saveConsolidatedManifest(updatedManifest)
  await input.deps.writeReports({
    ...toReportMaps(reloadedStoredByFeatureKey),
    progress: input.progress,
  })
  return updatedManifest
}

export async function runPhase3(
  input: Omit<Phase3RunInput, 'selectedFeatureKeys'> & { readonly selectedFeatureKeys?: ReadonlySet<string> },
  depsInput: Partial<Phase3Deps> | undefined,
): Promise<ConsolidatedManifest | null>
export async function runPhase3(
  {
    progress,
    selectedConsolidatedIds,
    selectedFeatureKeys,
    consolidatedManifest,
  }: Omit<Phase3RunInput, 'selectedFeatureKeys'> & { readonly selectedFeatureKeys?: ReadonlySet<string> },
  depsInput: Partial<Phase3Deps> | undefined,
): Promise<ConsolidatedManifest | null> {
  if (consolidatedManifest === null) {
    return null
  }

  const resolvedDeps = resolvePhase3Deps(depsInput)
  const storedByFeatureKey = await loadStoredFeatureData(consolidatedManifest, resolvedDeps)
  const behaviors = parseBehaviors(consolidatedManifest, storedByFeatureKey)
  progress.phase3.status = 'in-progress'
  progress.phase3.stats.consolidatedIdsTotal = behaviors.length
  await resolvedDeps.saveProgress(progress)

  const collected = await collectNewEvaluations({
    behaviors,
    selection: resolveSelection(selectedConsolidatedIds, toEmptySelectedFeatureKeys(selectedFeatureKeys), behaviors),
    progress,
    deps: resolvedDeps,
    buildPrompt,
  })
  const groupedCollected = groupCollectedEvaluations(collected)
  const updatedManifest = await persistPhase3Outputs({
    consolidatedManifest,
    groupedCollected,
    storedByFeatureKey,
    progress,
    deps: resolvedDeps,
  })

  finalizeCollectedEvaluations({
    collected,
    progress,
    deps: resolvedDeps,
  })
  progress.phase3.status = 'done'
  await resolvedDeps.saveProgress(progress)
  const wallMs = performance.now() - resolvedDeps.stats.wallStartMs
  const label = `[Phase 3 complete] ${progress.phase3.stats.consolidatedIdsDone} evaluated, ${progress.phase3.stats.consolidatedIdsFailed} failed`
  resolvedDeps.log.log(`\n${formatPhaseSummary(resolvedDeps.stats, wallMs, label)}`)
  return updatedManifest
}
