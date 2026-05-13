import { relative } from 'node:path'

import { consolidatedArtifactPathForFeatureKey } from './artifact-paths.js'
import type { ClassifiedBehavior } from './classified-store.js'
import { readClassifiedFile } from './classified-store.js'
import { PROJECT_ROOT } from './config.js'
import type { ConsolidateBehaviorInput, ConsolidationResult } from './consolidate-agent.js'
import type { ExtractedBehaviorRecord } from './extracted-store.js'
import { readExtractedFile } from './extracted-store.js'
import type { ConsolidatedManifest, IncrementalManifest, ManifestTestEntry } from './incremental.js'
import { buildPhase2ConsolidationFingerprint } from './incremental.js'
import type { ConsolidatedBehavior } from './report-writer.js'

interface Phase2bReadDeps {
  readonly readExtractedFile: typeof readExtractedFile
  readonly readClassifiedFile: typeof readClassifiedFile
}

interface JoinedBehaviorInput extends ConsolidateBehaviorInput {
  readonly featureKey: string
}

export type ConsolidateWithRetry = typeof import('./consolidate-agent.js').consolidateWithRetry

type ConsolidationItem = {
  readonly id: string
  readonly item: ConsolidationResult['consolidations'][number]
}

export const getManifestFeatureKey = (entry: ManifestTestEntry): string | null => entry.featureKey ?? null

export const getManifestBehaviorId = (testKey: string, entry: ManifestTestEntry): string => entry.behaviorId ?? testKey

export function getSelectedManifestEntries(
  manifest: IncrementalManifest,
  selectedFeatureKeys: ReadonlySet<string>,
): readonly (readonly [string, ManifestTestEntry])[] {
  return Object.entries(manifest.tests).filter(([, entry]) => {
    const featureKey = getManifestFeatureKey(entry)
    if (featureKey === null || entry.classifiedArtifactPath === null || entry.extractedArtifactPath === null) {
      return false
    }
    return selectedFeatureKeys.size === 0 || selectedFeatureKeys.has(featureKey)
  })
}

const findExtractedRecord = (
  extractedRecords: readonly ExtractedBehaviorRecord[],
  behaviorId: string,
  testKey: string,
): ExtractedBehaviorRecord | null =>
  extractedRecords.find((item) => item.behaviorId === behaviorId || item.testKey === testKey) ?? null

const findClassifiedRecord = (
  classifiedRecords: readonly ClassifiedBehavior[],
  behaviorId: string,
  testKey: string,
): ClassifiedBehavior | null =>
  classifiedRecords.find((item) => item.behaviorId === behaviorId || item.testKey === testKey) ?? null

async function loadJoinedInput(input: {
  readonly testKey: string
  readonly entry: ManifestTestEntry
  readonly deps: Phase2bReadDeps
}): Promise<JoinedBehaviorInput | null> {
  const featureKey = getManifestFeatureKey(input.entry)
  if (featureKey === null) {
    return null
  }

  const [extractedRecords, classifiedRecords] = await Promise.all([
    input.deps.readExtractedFile(input.entry.testFile),
    input.deps.readClassifiedFile(input.entry.testFile),
  ])

  if (extractedRecords === null || classifiedRecords === null) {
    return null
  }

  const behaviorId = getManifestBehaviorId(input.testKey, input.entry)
  const extractedRecord = findExtractedRecord(extractedRecords, behaviorId, input.testKey)
  const classifiedRecord = findClassifiedRecord(classifiedRecords, behaviorId, input.testKey)
  if (extractedRecord === null || classifiedRecord === null) {
    return null
  }

  return {
    behaviorId,
    testKey: input.testKey,
    domain: classifiedRecord.domain,
    visibility: classifiedRecord.visibility,
    featureKey,
    featureLabel: classifiedRecord.featureLabel,
    behavior: extractedRecord.behavior,
    context: extractedRecord.context,
    keywords: extractedRecord.keywords,
    confidence: extractedRecord.confidence,
    trustFlags: extractedRecord.trustFlags,
  }
}

export async function loadGroupedInputs(
  manifest: IncrementalManifest,
  selectedFeatureKeys: ReadonlySet<string>,
  deps: Phase2bReadDeps,
): Promise<ReadonlyMap<string, readonly ConsolidateBehaviorInput[]>> {
  const joinedInputs = await Promise.all(
    getSelectedManifestEntries(manifest, selectedFeatureKeys).map(([testKey, entry]) =>
      loadJoinedInput({ testKey, entry, deps }),
    ),
  )

  return joinedInputs
    .filter((item): item is JoinedBehaviorInput => item !== null)
    .reduce((grouped, item) => {
      grouped.set(item.featureKey, [...(grouped.get(item.featureKey) ?? []), item])
      return grouped
    }, new Map<string, ConsolidateBehaviorInput[]>())
}

const buildConsolidatedDomain = (inputs: readonly ConsolidateBehaviorInput[]): string => {
  const domains = [...new Set(inputs.map((item) => item.domain))].toSorted()
  return domains.length === 1 ? (domains[0] ?? 'unknown') : 'cross-domain'
}

export function toConsolidations(
  result: readonly ConsolidationItem[],
  inputs: readonly ConsolidateBehaviorInput[],
): readonly ConsolidatedBehavior[] {
  const domain = buildConsolidatedDomain(inputs)
  return result.map(({ id, item }) => ({
    id,
    domain,
    featureName: item.featureName,
    isUserFacing: item.isUserFacing,
    behavior: item.behavior,
    userStory: item.userStory,
    context: item.context,
    sourceTestKeys: item.sourceTestKeys,
    sourceBehaviorIds: item.sourceBehaviorIds,
    supportingInternalRefs: item.supportingInternalRefs,
  }))
}

export function updateManifestEntries(input: {
  readonly currentEntries: ConsolidatedManifest['entries']
  readonly featureKey: string
  readonly inputs: readonly ConsolidateBehaviorInput[]
  readonly consolidations: readonly ConsolidatedBehavior[]
  readonly phase2Version: string
}): ConsolidatedManifest['entries'] {
  const baseEntries = Object.fromEntries(
    Object.entries(input.currentEntries).filter(([, entry]) => entry.featureKey !== input.featureKey),
  )
  const keywords = [...new Set(input.inputs.flatMap((item) => item.keywords))].toSorted()
  const sourceDomains = [...new Set(input.inputs.map((item) => item.domain))].toSorted()
  const consolidatedArtifactPath = relative(PROJECT_ROOT, consolidatedArtifactPathForFeatureKey(input.featureKey))
  const lastConsolidatedAt = new Date().toISOString()

  return input.consolidations.reduce((entries, consolidated) => {
    entries[consolidated.id] = {
      consolidatedId: consolidated.id,
      domain: consolidated.domain,
      featureName: consolidated.featureName,
      consolidatedArtifactPath,
      evaluatedArtifactPath: null,
      sourceTestKeys: consolidated.sourceTestKeys,
      sourceBehaviorIds: consolidated.sourceBehaviorIds,
      supportingInternalBehaviorIds: consolidated.supportingInternalRefs.map((item) => item.behaviorId),
      isUserFacing: consolidated.isUserFacing,
      featureKey: input.featureKey,
      keywords,
      sourceDomains,
      phase2Fingerprint: buildPhase2ConsolidationFingerprint({
        featureKey: input.featureKey,
        sourceBehaviorIds: consolidated.sourceBehaviorIds,
        behaviors: input.inputs.map((item) => item.behavior),
        phaseVersion: input.phase2Version,
      }),
      phase3Fingerprint: null,
      lastConsolidatedAt,
      lastEvaluatedAt: null,
    }
    return entries
  }, baseEntries)
}
