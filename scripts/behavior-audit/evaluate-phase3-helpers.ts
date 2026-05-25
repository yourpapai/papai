// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { relative } from 'node:path'

import { consolidatedArtifactPathForFeatureKey, evaluatedArtifactPathForFeatureKey } from './artifact-paths.js'
import { MAX_RETRIES, PROJECT_ROOT } from './config.js'
import type { EvaluatedFeatureRecord } from './evaluated-store.js'
import type { ConsolidatedManifest, ConsolidatedManifestEntry } from './incremental.js'
import { buildPhase3EvaluationFingerprint } from './incremental.js'
import type { Progress } from './progress.js'
import type { ConsolidatedBehavior } from './report-writer.js'

export interface ParsedBehavior {
  readonly consolidatedId: string
  readonly featureKey: string
  readonly phase2Fingerprint: string | null
  readonly domain: string
  readonly featureName: string
  readonly behavior: string
  readonly userStory: string
  readonly context: string
}

export interface StoredFeatureData {
  readonly consolidated: readonly ConsolidatedBehavior[]
  readonly evaluated: readonly EvaluatedFeatureRecord[]
}

export interface Phase3Selection {
  readonly ids: ReadonlySet<string>
  readonly evaluateAll: boolean
}

function getAvailableIdsForFeatureKeys(
  selectedFeatureKeys: ReadonlySet<string>,
  behaviors: readonly ParsedBehavior[],
): ReadonlySet<string> {
  return new Set(
    behaviors
      .filter((behavior) => selectedFeatureKeys.has(behavior.featureKey))
      .map((behavior) => behavior.consolidatedId),
  )
}

function getFeatureKey(entry: ConsolidatedManifestEntry): string {
  return entry.featureKey
}

export function getFeatureKeys(manifest: ConsolidatedManifest): readonly string[] {
  return [
    ...new Set(
      Object.values(manifest.entries)
        .map(getFeatureKey)
        .filter((key): key is string => key !== null),
    ),
  ]
}

export function parseBehaviors(
  manifest: ConsolidatedManifest,
  storedByFeatureKey: ReadonlyMap<string, StoredFeatureData>,
): readonly ParsedBehavior[] {
  return Object.values(manifest.entries)
    .map((entry) => {
      const featureKey = getFeatureKey(entry)
      const consolidated =
        featureKey === null
          ? undefined
          : storedByFeatureKey.get(featureKey)?.consolidated.find((item) => item.id === entry.consolidatedId)
      if (
        featureKey === null ||
        consolidated === undefined ||
        !consolidated.isUserFacing ||
        consolidated.userStory === null
      ) {
        return null
      }
      return {
        consolidatedId: consolidated.id,
        featureKey,
        phase2Fingerprint: entry.phase2Fingerprint,
        domain: consolidated.domain,
        featureName: consolidated.featureName,
        behavior: consolidated.behavior,
        userStory: consolidated.userStory,
        context: consolidated.context,
      }
    })
    .filter((item): item is ParsedBehavior => item !== null)
}

export function resolveSelection(
  selectedIds: ReadonlySet<string>,
  selectedFeatureKeys: ReadonlySet<string>,
  behaviors: readonly ParsedBehavior[],
): Phase3Selection {
  if (selectedIds.size === 0) {
    if (selectedFeatureKeys.size === 0) return { ids: selectedIds, evaluateAll: true }
    return {
      ids: getAvailableIdsForFeatureKeys(selectedFeatureKeys, behaviors),
      evaluateAll: false,
    }
  }
  const availableIds = new Set(behaviors.map((behavior) => behavior.consolidatedId))
  return [...selectedIds].some((id) => availableIds.has(id))
    ? { ids: selectedIds, evaluateAll: false }
    : selectedFeatureKeys.size > 0
      ? { ids: getAvailableIdsForFeatureKeys(selectedFeatureKeys, behaviors), evaluateAll: false }
      : { ids: availableIds, evaluateAll: true }
}

export function shouldSkip(
  behavior: ParsedBehavior,
  selection: Phase3Selection,
  progress: Progress,
  deps: {
    readonly isBehaviorCompleted: (progress: Progress, key: string) => boolean
    readonly getFailedBehaviorAttempts: (progress: Progress, key: string) => number
  },
): boolean {
  if (!selection.evaluateAll && !selection.ids.has(behavior.consolidatedId)) return true
  if (deps.isBehaviorCompleted(progress, behavior.consolidatedId) && !selection.ids.has(behavior.consolidatedId))
    return true
  return deps.getFailedBehaviorAttempts(progress, behavior.consolidatedId) >= MAX_RETRIES
}

export function mergeEvaluations(
  existing: readonly EvaluatedFeatureRecord[],
  next: readonly EvaluatedFeatureRecord[],
): readonly EvaluatedFeatureRecord[] {
  const merged = new Map(existing.map((record) => [record.consolidatedId, record]))
  for (const record of next) merged.set(record.consolidatedId, record)
  return [...merged.values()].toSorted((a, b) => a.consolidatedId.localeCompare(b.consolidatedId))
}

export function updateManifest(
  manifest: ConsolidatedManifest,
  storedByFeatureKey: ReadonlyMap<string, StoredFeatureData>,
): ConsolidatedManifest {
  const entries = Object.entries(manifest.entries).reduce(
    (next, [id, entry]) => {
      const featureKey = getFeatureKey(entry)
      const evaluated =
        featureKey === null
          ? undefined
          : storedByFeatureKey.get(featureKey)?.evaluated.find((item) => item.consolidatedId === entry.consolidatedId)
      next[id] =
        evaluated === undefined || featureKey === null
          ? entry
          : {
              ...entry,
              consolidatedArtifactPath:
                entry.consolidatedArtifactPath ??
                relative(PROJECT_ROOT, consolidatedArtifactPathForFeatureKey(featureKey)),
              evaluatedArtifactPath: relative(PROJECT_ROOT, evaluatedArtifactPathForFeatureKey(featureKey)),
              phase3Fingerprint: buildPhase3EvaluationFingerprint({
                consolidatedId: entry.consolidatedId,
                phase2Fingerprint: entry.phase2Fingerprint,
                evaluation: {
                  maria: evaluated.maria,
                  dani: evaluated.dani,
                  viktor: evaluated.viktor,
                  flaws: evaluated.flaws,
                  improvements: evaluated.improvements,
                },
              }),
              lastEvaluatedAt: evaluated.evaluatedAt,
            }
      return next
    },
    {} as ConsolidatedManifest['entries'],
  )
  return { ...manifest, entries }
}

export function toReportMaps(storedByFeatureKey: ReadonlyMap<string, StoredFeatureData>): {
  readonly consolidatedByFeatureKey: ReadonlyMap<string, readonly ConsolidatedBehavior[]>
  readonly evaluatedByFeatureKey: ReadonlyMap<string, readonly EvaluatedFeatureRecord[]>
} {
  return {
    consolidatedByFeatureKey: new Map(
      [...storedByFeatureKey.entries()].map(([featureKey, stored]) => [featureKey, stored.consolidated] as const),
    ),
    evaluatedByFeatureKey: new Map(
      [...storedByFeatureKey.entries()].map(([featureKey, stored]) => [featureKey, stored.evaluated] as const),
    ),
  }
}
