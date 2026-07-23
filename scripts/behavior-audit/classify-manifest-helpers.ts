// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { relative } from 'node:path'

import { classifiedArtifactPathForTestFile } from './artifact-paths.js'
import type { ClassifiedBehavior } from './classified-store.js'
import type { SelectedBehaviorEntry } from './classify-phase2a-helpers.js'
import { PROJECT_ROOT } from './config.js'
import type { ExtractedBehaviorRecord } from './extracted-store.js'
import { buildPhase2Fingerprint, type IncrementalManifest, type ManifestTestEntry } from './incremental.js'

export interface ManifestDelta {
  readonly testKey: string
  readonly entry: ManifestTestEntry
}

export function toManifestEntry(input: {
  readonly previousEntry: IncrementalManifest['tests'][string] | undefined
  readonly classified: ClassifiedBehavior
  readonly behavior: SelectedBehaviorEntry['behavior']
  readonly phase2Version: string
}): IncrementalManifest['tests'][string] {
  const [firstSegment] = input.classified.testKey.split('::')
  let testFile = ''
  if (firstSegment !== undefined) {
    testFile = firstSegment
  }
  const completedAt = new Date().toISOString()
  const previousEntry = input.previousEntry
  return {
    testFile: previousEntry === undefined ? testFile : previousEntry.testFile,
    testName: previousEntry === undefined ? input.behavior.fullPath : previousEntry.testName,
    dependencyPaths: previousEntry === undefined ? [testFile] : previousEntry.dependencyPaths,
    phase1Fingerprint: previousEntry === undefined ? null : previousEntry.phase1Fingerprint,
    phase2aFingerprint: buildPhase2Fingerprint({
      testKey: input.classified.testKey,
      behavior: input.behavior.behavior,
      context: input.behavior.context,
      keywords: input.behavior.keywords,
      phaseVersion: input.phase2Version,
    }),
    phase2Fingerprint: previousEntry === undefined ? null : previousEntry.phase2Fingerprint,
    behaviorId: input.classified.behaviorId,
    featureKey: input.classified.featureKey,
    extractedArtifactPath: previousEntry === undefined ? null : previousEntry.extractedArtifactPath,
    classifiedArtifactPath: relative(PROJECT_ROOT, classifiedArtifactPathForTestFile(testFile)),
    domain: previousEntry === undefined ? input.classified.domain : previousEntry.domain,
    lastPhase1CompletedAt: previousEntry === undefined ? null : previousEntry.lastPhase1CompletedAt,
    lastPhase2aCompletedAt: completedAt,
    lastPhase2CompletedAt: previousEntry === undefined ? null : previousEntry.lastPhase2CompletedAt,
  }
}

export function buildManifestEntry(
  manifest: IncrementalManifest,
  classified: ClassifiedBehavior,
  behavior: ExtractedBehaviorRecord,
): ManifestDelta {
  const previousEntry = manifest.tests[classified.testKey]
  const entry = toManifestEntry({
    previousEntry,
    classified,
    behavior,
    phase2Version: manifest.phaseVersions.phase2,
  })
  return { testKey: classified.testKey, entry }
}

export function mergeManifestDeltas(
  manifest: IncrementalManifest,
  deltas: readonly ManifestDelta[],
): IncrementalManifest {
  if (deltas.length === 0) {
    return manifest
  }
  const mergedTests: Record<string, ManifestTestEntry> = { ...manifest.tests }
  for (const delta of deltas) {
    mergedTests[delta.testKey] = delta.entry
  }
  return { ...manifest, tests: mergedTests }
}
