import type { ClassifiedBehavior } from './classified-store.js'
import { getDomain } from './domain-map.js'
import { readExtractedFile, type ExtractedBehaviorRecord } from './extracted-store.js'
import { buildPhase2Fingerprint, type IncrementalManifest } from './incremental.js'
import type { Progress } from './progress.js'

export interface SelectedBehaviorEntry {
  readonly testKey: string
  readonly behavior: ExtractedBehaviorRecord
}

export function buildBehaviorId(testKey: string): string {
  return testKey
}

export function buildPrompt(testKey: string, behavior: ExtractedBehaviorRecord): string {
  const testFile = testKey.split('::')[0] ?? ''
  const hasUnsupportedContext = behavior.trustFlags.includes('unsupported-context-claim')
  const hasGuessedImplementation = behavior.trustFlags.includes('guessed-implementation-path')
  const contextLine = hasUnsupportedContext
    ? 'Context: (omitted — unsupported claim)'
    : behavior.confidence.context === 'low'
      ? 'Context: (low confidence — treat as approximate)'
      : `Context: ${behavior.context}`
  const trustNote = hasGuessedImplementation ? '\nNote: implementation path was guessed, not verified' : ''
  return (
    [
      `Test key: ${testKey}`,
      `Domain: ${getDomain(testFile)}`,
      `Behavior: ${behavior.behavior}`,
      contextLine,
      `Keywords: ${behavior.keywords.join(', ')}`,
    ].join('\n') + trustNote
  )
}

function getBehaviorIdForManifestEntry(manifestEntry: IncrementalManifest['tests'][string], testKey: string): string {
  return manifestEntry.behaviorId ?? testKey
}

async function loadSelectedBehaviorFromArtifact(input: {
  readonly manifestEntry: IncrementalManifest['tests'][string]
  readonly testKey: string
  readonly readExtractedFile: typeof readExtractedFile
}): Promise<SelectedBehaviorEntry | null> {
  if (input.manifestEntry.extractedArtifactPath === null) {
    return null
  }

  const extractedRecords = await input.readExtractedFile(input.manifestEntry.testFile)
  if (extractedRecords === null) {
    return null
  }

  const behaviorId = getBehaviorIdForManifestEntry(input.manifestEntry, input.testKey)
  const record = extractedRecords.find((item) => item.behaviorId === behaviorId || item.testKey === input.testKey)
  if (record === undefined) {
    return null
  }

  return { testKey: input.testKey, behavior: record }
}

export async function loadSelectedBehaviors(
  manifest: IncrementalManifest,
  selectedTestKeys: ReadonlySet<string>,
  readExtractedFileImpl: typeof readExtractedFile,
): Promise<readonly SelectedBehaviorEntry[]> {
  const manifestKeys = selectedTestKeys.size === 0 ? Object.keys(manifest.tests) : [...selectedTestKeys]
  const loadedEntries = await Promise.all(
    manifestKeys.map((testKey) => {
      const manifestEntry = manifest.tests[testKey]
      if (manifestEntry === undefined) {
        return Promise.resolve<SelectedBehaviorEntry | null>(null)
      }

      return loadSelectedBehaviorFromArtifact({
        manifestEntry,
        testKey,
        readExtractedFile: readExtractedFileImpl,
      })
    }),
  )

  const artifactEntries = loadedEntries.filter((entry): entry is SelectedBehaviorEntry => entry !== null)
  return artifactEntries
}

export function shouldReuseCompletedClassification(
  progress: Progress,
  manifest: IncrementalManifest,
  entry: SelectedBehaviorEntry,
): boolean {
  if (progress.phase2a.completedBehaviors[entry.testKey] !== 'done') {
    return false
  }

  if (!entry.testKey.startsWith('tests/')) {
    return true
  }

  const manifestEntry = manifest.tests[entry.testKey]
  if (manifestEntry === undefined) {
    return true
  }

  const nextFingerprint = buildPhase2Fingerprint({
    testKey: entry.testKey,
    behavior: entry.behavior.behavior,
    context: entry.behavior.context,
    keywords: entry.behavior.keywords,
    phaseVersion: manifest.phaseVersions.phase2,
  })
  return manifestEntry.phase2aFingerprint === nextFingerprint
}

export function addDirtyFeatureKey(dirtyFeatureKeys: Set<string>, featureKey: string | null): void {
  if (featureKey !== null) {
    dirtyFeatureKeys.add(featureKey)
  }
}

export function toClassifiedBehavior(
  testKey: string,
  result: NonNullable<Awaited<ReturnType<typeof import('./classify-agent.js').classifyBehaviorWithRetry>>>['result'],
): ClassifiedBehavior {
  const domain = getDomain(testKey.split('::')[0] ?? '')

  return {
    behaviorId: buildBehaviorId(testKey),
    testKey,
    domain,
    visibility: result.visibility,
    featureKey: result.featureKey,
    featureLabel: result.featureLabel,
    supportingBehaviorRefs: result.supportingBehaviorRefs,
    relatedBehaviorHints: result.relatedBehaviorHints,
    classificationNotes: result.classificationNotes,
    classifiedAt: new Date().toISOString(),
  }
}
