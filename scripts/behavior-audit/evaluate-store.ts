import {
  getFeatureKeys,
  mergeEvaluations,
  type ParsedBehavior,
  type StoredFeatureData,
} from './evaluate-phase3-helpers.js'
import type { Phase3Deps } from './evaluate.ts'
import type { EvaluatedFeatureRecord } from './evaluated-store.js'
import type { ConsolidatedManifest } from './incremental.js'

export async function loadStoredFeatureData(
  manifest: ConsolidatedManifest,
  deps: Phase3Deps,
): Promise<ReadonlyMap<string, StoredFeatureData>> {
  const featureKeys = getFeatureKeys(manifest)
  const loaded = await Promise.all(
    featureKeys.map(async (featureKey) => {
      const loadedConsolidated = await deps.readConsolidatedFile(featureKey)
      let consolidated: StoredFeatureData['consolidated']
      if (loadedConsolidated === null) {
        consolidated = []
      } else {
        consolidated = loadedConsolidated
      }

      const loadedEvaluated = await deps.readEvaluatedFile(featureKey)
      let evaluated: readonly EvaluatedFeatureRecord[]
      if (loadedEvaluated === null) {
        evaluated = []
      } else {
        evaluated = loadedEvaluated
      }

      return [featureKey, { consolidated, evaluated }] as const
    }),
  )
  return new Map(loaded)
}

export function groupCollectedEvaluations(
  collected: readonly { readonly behavior: ParsedBehavior; readonly evaluation: EvaluatedFeatureRecord }[],
): ReadonlyMap<string, readonly EvaluatedFeatureRecord[]> {
  return collected.reduce((grouped, item) => {
    const existing = grouped.get(item.behavior.featureKey)
    const nextRecords = existing === undefined ? [item.evaluation] : [...existing, item.evaluation]
    grouped.set(item.behavior.featureKey, nextRecords)
    return grouped
  }, new Map<string, readonly EvaluatedFeatureRecord[]>())
}

export async function persistEvaluations(
  collected: ReadonlyMap<string, readonly EvaluatedFeatureRecord[]>,
  storedByFeatureKey: ReadonlyMap<string, StoredFeatureData>,
  deps: Phase3Deps,
): Promise<void> {
  await Promise.all(
    [...collected.entries()].map(([featureKey, records]) => {
      const stored = storedByFeatureKey.get(featureKey)
      let existingEvaluations: readonly EvaluatedFeatureRecord[]
      if (stored === undefined) {
        existingEvaluations = []
      } else {
        existingEvaluations = stored.evaluated
      }

      return deps.writeEvaluatedFile(featureKey, mergeEvaluations(existingEvaluations, records))
    }),
  )
}
