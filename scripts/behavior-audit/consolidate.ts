import pLimit from 'p-limit'

import { readClassifiedFile } from './classified-store.js'
import { MAX_RETRIES } from './config.js'
import type { ConsolidateBehaviorInput } from './consolidate-agent.js'
import {
  loadGroupedInputs,
  toConsolidations,
  updateManifestEntries,
  type ConsolidateWithRetry,
} from './consolidate-helpers.js'
import { reportConsolidationResult } from './consolidate-reporting.js'
import { readExtractedFile } from './extracted-store.js'
import type { ConsolidatedManifest, IncrementalManifest } from './incremental.js'
import {
  type PhaseStats,
  createPhaseStats,
  formatPhaseSummary,
  recordItemDone,
  recordItemFailed,
  recordItemSkipped,
} from './phase-stats.js'
import type { AgentUsage } from './phase-stats.js'
import { saveProgress } from './progress-io.js'
import type { BehaviorAuditProgressReporter } from './progress-reporter.js'
import { invalidatePhase3ForReevaluation } from './progress-resets.js'
import { getFailedFeatureKeyAttempts, markFeatureKeyDone, markFeatureKeyFailed } from './progress.js'
import type { Progress } from './progress.js'
import { writeConsolidatedFile } from './report-writer.js'

type ConsolidationProcessResult =
  | { readonly kind: 'consolidated'; readonly manifest: ConsolidatedManifest; readonly usage: AgentUsage }
  | { readonly kind: 'failed'; readonly manifest: ConsolidatedManifest }
  | { readonly kind: 'skipped'; readonly manifest: ConsolidatedManifest }

export interface Phase2bDeps {
  readonly consolidateWithRetry: ConsolidateWithRetry
  readonly writeConsolidatedFile: typeof writeConsolidatedFile
  readonly readExtractedFile: typeof readExtractedFile
  readonly readClassifiedFile: typeof readClassifiedFile
  readonly saveProgress: typeof saveProgress
  readonly log: Pick<typeof console, 'log'>
  readonly reporter: BehaviorAuditProgressReporter | undefined
  readonly stats: PhaseStats
}

const defaultConsolidateWithRetry: ConsolidateWithRetry = async (...args) => {
  const { consolidateWithRetry } = await import('./consolidate-agent.js')
  return consolidateWithRetry(...args)
}

const defaultPhase2bDeps: Omit<Phase2bDeps, 'stats'> = {
  consolidateWithRetry: defaultConsolidateWithRetry,
  writeConsolidatedFile,
  readExtractedFile,
  readClassifiedFile,
  saveProgress,
  log: console,
  reporter: undefined,
}

async function consolidateFeatureKey(input: {
  readonly progress: Progress
  readonly consolidatedManifest: ConsolidatedManifest
  readonly phase2Version: string
  readonly featureKey: string
  readonly inputs: readonly ConsolidateBehaviorInput[]
  readonly deps: Phase2bDeps
}): Promise<ConsolidationProcessResult> {
  const failedAttempts = getFailedFeatureKeyAttempts(input.progress, input.featureKey)
  if (failedAttempts >= MAX_RETRIES) {
    return { kind: 'skipped', manifest: input.consolidatedManifest }
  }

  const agentResult = await input.deps.consolidateWithRetry(input.featureKey, input.inputs, failedAttempts)
  if (agentResult === null) {
    markFeatureKeyFailed(input.progress, input.featureKey, 'consolidation failed after retries', failedAttempts + 1)
    await input.deps.saveProgress(input.progress)
    return { kind: 'failed', manifest: input.consolidatedManifest }
  }

  const consolidations = toConsolidations(agentResult.result, input.inputs)
  const updatedManifest: ConsolidatedManifest = {
    ...input.consolidatedManifest,
    entries: updateManifestEntries({
      currentEntries: input.consolidatedManifest.entries,
      featureKey: input.featureKey,
      inputs: input.inputs,
      consolidations,
      phase2Version: input.phase2Version,
    }),
  }
  await input.deps.writeConsolidatedFile(input.featureKey, consolidations)
  markFeatureKeyDone(input.progress, input.featureKey, consolidations)
  await input.deps.saveProgress(input.progress)

  return {
    kind: 'consolidated',
    manifest: updatedManifest,
    usage: agentResult.usage,
  }
}

async function processFeatureKeyGroup(
  featureKey: string,
  inputs: readonly ConsolidateBehaviorInput[],
  displayIndex: number,
  displayTotal: number,
  progress: Progress,
  currentManifest: ConsolidatedManifest,
  phase2Version: string,
  deps: Phase2bDeps,
): Promise<ConsolidationProcessResult> {
  if (deps.reporter !== undefined) {
    deps.reporter.emit({
      kind: 'item-start',
      phase: 'phase2b',
      itemId: featureKey,
      context: featureKey,
      title: featureKey,
      index: displayIndex,
      total: displayTotal,
    })
  }
  const startMs = performance.now()
  const result = await consolidateFeatureKey({
    progress,
    consolidatedManifest: currentManifest,
    phase2Version,
    featureKey,
    inputs,
    deps,
  })
  const elapsedMs = performance.now() - startMs
  reportConsolidationResult({
    reporter: deps.reporter,
    log: deps.log,
    featureKey,
    result,
    elapsedMs,
  })
  if (result.kind === 'consolidated') {
    recordItemDone(deps.stats, result.usage)
  } else if (result.kind === 'failed') {
    recordItemFailed(deps.stats)
  } else {
    recordItemSkipped(deps.stats)
  }
  return result
}

function resolvePhase2bDeps(depsInput: Partial<Phase2bDeps> | undefined): Phase2bDeps {
  let deps: Partial<Phase2bDeps>
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

  return { ...defaultPhase2bDeps, ...deps, stats }
}

async function initializePhase2b(
  progress: Progress,
  manifest: IncrementalManifest,
  selectedFeatureKeys: ReadonlySet<string>,
  resolvedDeps: Phase2bDeps,
): Promise<readonly (readonly [string, readonly ConsolidateBehaviorInput[]])[]> {
  const groups = [...(await loadGroupedInputs(manifest, selectedFeatureKeys, resolvedDeps)).entries()]
  progress.phase2b.status = 'in-progress'
  progress.phase2b.stats.featureKeysTotal = groups.length
  invalidatePhase3ForReevaluation(progress)
  await resolvedDeps.saveProgress(progress)
  return groups
}

async function finalizePhase2b(
  progress: Progress,
  currentManifest: ConsolidatedManifest,
  stats: PhaseStats,
  resolvedDeps: Phase2bDeps,
): Promise<void> {
  invalidatePhase3ForReevaluation(progress, new Set(Object.keys(currentManifest.entries)))
  progress.phase2b.status = 'done'
  await resolvedDeps.saveProgress(progress)
  const wallMs = performance.now() - stats.wallStartMs
  const label = `[Phase 2b complete] ${progress.phase2b.stats.featureKeysDone} feature keys consolidated, ${progress.phase2b.stats.featureKeysFailed} failed`
  resolvedDeps.log.log(`\n${formatPhaseSummary(stats, wallMs, label)}`)
}

export async function runPhase2b(
  progress: Progress,
  consolidatedManifest: ConsolidatedManifest,
  phase2Version: string,
  selectedFeatureKeys: ReadonlySet<string>,
  manifest: IncrementalManifest,
  depsInput: Partial<Phase2bDeps> | undefined,
): Promise<ConsolidatedManifest> {
  const resolvedDeps = resolvePhase2bDeps(depsInput)
  const stats = resolvedDeps.stats
  const groups = await initializePhase2b(progress, manifest, selectedFeatureKeys, resolvedDeps)

  const limit = pLimit(1)
  let currentManifest = consolidatedManifest
  await Promise.all(
    groups.map(([featureKey, inputs], index) =>
      limit(async () => {
        const result = await processFeatureKeyGroup(
          featureKey,
          inputs,
          index + 1,
          groups.length,
          progress,
          currentManifest,
          phase2Version,
          resolvedDeps,
        )
        currentManifest = result.manifest
      }),
    ),
  )

  await finalizePhase2b(progress, currentManifest, stats, resolvedDeps)
  return currentManifest
}
