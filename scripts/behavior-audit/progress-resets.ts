import { emptyPhase1b, emptyPhase2a, emptyPhase2b, emptyPhase3, type FailedEntry, type Progress } from './progress.js'

export function resetPhase1bAndBelow(progress: Progress): void {
  progress.phase1b = emptyPhase1b()
  progress.phase2a = emptyPhase2a()
  progress.phase2b = emptyPhase2b()
  progress.phase3 = emptyPhase3()
}

export function resetPhase2AndPhase3(progress: Progress): void {
  progress.phase2a = emptyPhase2a()
  progress.phase2b = emptyPhase2b()
  progress.phase3 = emptyPhase3()
}

function filterFailedEntries(
  entries: Readonly<Record<string, FailedEntry>>,
  validConsolidatedIds: ReadonlySet<string> | undefined,
): Record<string, FailedEntry> {
  if (validConsolidatedIds === undefined) {
    return { ...entries }
  }

  return Object.fromEntries(
    Object.entries(entries).filter(([consolidatedId]) => validConsolidatedIds.has(consolidatedId)),
  )
}

export function invalidatePhase3ForReevaluation(progress: Progress, validConsolidatedIds?: ReadonlySet<string>): void {
  const preservedFailures = filterFailedEntries(progress.phase3.failedConsolidatedIds, validConsolidatedIds)
  progress.phase3 = {
    status: 'not-started',
    completedConsolidatedIds: {},
    failedConsolidatedIds: preservedFailures,
    stats: {
      consolidatedIdsTotal: 0,
      consolidatedIdsDone: 0,
      consolidatedIdsFailed: Object.keys(preservedFailures).length,
    },
  }
}

export function resetPhase3(progress: Progress): void {
  progress.phase3 = emptyPhase3()
}
