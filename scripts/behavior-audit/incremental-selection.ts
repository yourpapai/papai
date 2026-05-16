// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ConsolidatedManifest, IncrementalManifest, IncrementalSelection } from './incremental.js'

export interface SelectIncrementalWorkInput {
  readonly changedFiles: readonly string[]
  readonly previousManifest: IncrementalManifest
  readonly currentPhaseVersions: IncrementalManifest['phaseVersions']
  readonly discoveredTestKeys: readonly string[]
  readonly previousConsolidatedManifest: ConsolidatedManifest | null
}

function toSortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].toSorted()
}

function computePhase1And2aKeys(
  input: SelectIncrementalWorkInput,
  discoveredSet: ReadonlySet<string>,
  changedFilesSet: ReadonlySet<string>,
  previousPhaseVersions: IncrementalManifest['phaseVersions'],
): {
  readonly phase1Keys: readonly string[]
  readonly phase2aKeys: readonly string[]
  readonly phase2VersionChanged: boolean
} {
  const entries = Object.entries(input.previousManifest.tests).filter(([k]) => discoveredSet.has(k))
  const depKeys = entries.filter(([, e]) => e.dependencyPaths.some((p) => changedFilesSet.has(p))).map(([k]) => k)
  const newKeys = input.discoveredTestKeys.filter((k) => input.previousManifest.tests[k] === undefined)
  const phase1Keys = toSortedUnique([...depKeys, ...newKeys])
  const phase2VersionChanged = previousPhaseVersions.phase2 !== input.currentPhaseVersions.phase2
  const phase2aVersionKeys = phase2VersionChanged
    ? entries.filter(([, e]) => e.extractedArtifactPath !== null).map(([k]) => k)
    : []
  return { phase1Keys, phase2aKeys: toSortedUnique([...phase1Keys, ...phase2aVersionKeys]), phase2VersionChanged }
}

function computePhase2bKeys(phase2aKeys: readonly string[], manifest: IncrementalManifest): readonly string[] {
  return toSortedUnique(
    phase2aKeys
      .map((testKey) => manifest.tests[testKey]?.featureKey ?? null)
      .filter((value): value is string => value !== null),
  )
}

function computePhase3IdsFromFeatureKeys(
  featureKeys: readonly string[],
  manifest: ConsolidatedManifest | null,
): readonly string[] {
  if (manifest === null) return []
  const selected = new Set(featureKeys)
  return Object.values(manifest.entries)
    .filter((entry) => entry.featureKey !== null && entry.featureKey !== undefined && selected.has(entry.featureKey))
    .map((entry) => entry.consolidatedId)
    .toSorted()
}

function computePhase3IdsFromSourceTests(
  selectedTestKeys: readonly string[],
  manifest: ConsolidatedManifest | null,
): readonly string[] {
  if (manifest === null) return []
  const selected = new Set(selectedTestKeys)
  return Object.values(manifest.entries)
    .filter((entry) => entry.sourceTestKeys.some((testKey) => selected.has(testKey)))
    .map((entry) => entry.consolidatedId)
    .toSorted()
}

function computePhase3SelectedConsolidatedIds(input: {
  readonly phase2aKeys: readonly string[]
  readonly phase2bKeys: readonly string[]
  readonly manifest: ConsolidatedManifest | null
}): readonly string[] {
  const idsFromFeatureKeys = computePhase3IdsFromFeatureKeys(input.phase2bKeys, input.manifest)
  if (idsFromFeatureKeys.length > 0 || input.phase2aKeys.length === 0) {
    return idsFromFeatureKeys
  }
  return computePhase3IdsFromSourceTests(input.phase2aKeys, input.manifest)
}

export function selectIncrementalWork(input: SelectIncrementalWorkInput): IncrementalSelection {
  const discoveredSet = new Set(input.discoveredTestKeys)
  const changedFilesSet = new Set(input.changedFiles)
  const previousPhaseVersions = input.previousManifest.phaseVersions
  const phase1VersionChanged = previousPhaseVersions.phase1 !== input.currentPhaseVersions.phase1
  if (phase1VersionChanged) {
    const all = toSortedUnique(input.discoveredTestKeys)
    const phase2bKeys = computePhase2bKeys(all, input.previousManifest)
    return {
      phase1SelectedTestKeys: all,
      phase2aSelectedTestKeys: all,
      phase2bSelectedFeatureKeys: phase2bKeys,
      phase3SelectedConsolidatedIds: computePhase3SelectedConsolidatedIds({
        phase2aKeys: all,
        phase2bKeys,
        manifest: input.previousConsolidatedManifest,
      }),
      reportRebuildOnly: false,
    }
  }
  const { phase1Keys, phase2aKeys } = computePhase1And2aKeys(
    input,
    discoveredSet,
    changedFilesSet,
    previousPhaseVersions,
  )
  const phase2bKeys = computePhase2bKeys(phase2aKeys, input.previousManifest)
  const phase3SelectedConsolidatedIds = computePhase3SelectedConsolidatedIds({
    phase2aKeys,
    phase2bKeys,
    manifest: input.previousConsolidatedManifest,
  })
  const reportVersionChanged = previousPhaseVersions.reports !== input.currentPhaseVersions.reports
  return {
    phase1SelectedTestKeys: phase1Keys,
    phase2aSelectedTestKeys: phase2aKeys,
    phase2bSelectedFeatureKeys: phase2bKeys,
    phase3SelectedConsolidatedIds,
    reportRebuildOnly:
      reportVersionChanged &&
      phase1Keys.length === 0 &&
      phase2aKeys.length === 0 &&
      phase2bKeys.length === 0 &&
      phase3SelectedConsolidatedIds.length === 0,
  }
}
