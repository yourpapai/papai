import { resolve } from 'node:path'

import { z } from 'zod'

import { consolidatedArtifactPathForFeatureKey, evaluatedArtifactPathForFeatureKey } from './artifact-paths.js'
import { PROJECT_ROOT } from './config.js'
import type { EvaluatedFeatureRecord } from './evaluated-store.js'
import type { ExtractedBehaviorRecord } from './extracted-store.js'
import type { ConsolidatedManifest } from './incremental.js'
import type { DomainSummary } from './report-index-helpers.js'
import type { ConsolidatedBehavior, StoryEvaluation } from './report-writer.js'

export interface TrustMetrics {
  readonly totalExtracted: number
  readonly fullyGrounded: number
  readonly unsupportedContext: number
  readonly inferredContext: number
  readonly novelKeywords: number
  readonly belowConfidenceThreshold: number
  readonly verificationFailed: number
  readonly withoutFreshCodeindex: number
  readonly fallbackFileSearch: number
}

export function collectTrustMetrics(extractedRecords: readonly ExtractedBehaviorRecord[]): TrustMetrics {
  return {
    totalExtracted: extractedRecords.length,
    fullyGrounded: extractedRecords.filter((r) => r.confidence.overall === 'high' && r.trustFlags.length === 0).length,
    unsupportedContext: extractedRecords.filter((r) => r.trustFlags.includes('unsupported-context-claim')).length,
    inferredContext: extractedRecords.filter((r) => r.trustFlags.includes('extractor-used-inference')).length,
    novelKeywords: extractedRecords.filter((r) => r.trustFlags.includes('novel-keyword')).length,
    belowConfidenceThreshold: extractedRecords.filter((r) => r.confidence.overall === 'low').length,
    verificationFailed: extractedRecords.filter((r) => r.trustFlags.includes('verification-failed')).length,
    withoutFreshCodeindex: extractedRecords.filter((r) => r.provenance.codeindex.indexStatus !== 'fresh').length,
    fallbackFileSearch: extractedRecords.filter((r) => !r.provenance.codeindex.enabled).length,
  }
}

const PersonaScoreSchema = z
  .object({
    discover: z.number(),
    use: z.number(),
    retain: z.number(),
    notes: z.string(),
  })
  .strict()
  .readonly()

const EvaluatedFeatureRecordSchema = z
  .object({
    consolidatedId: z.string(),
    maria: PersonaScoreSchema,
    dani: PersonaScoreSchema,
    viktor: PersonaScoreSchema,
    flaws: z.array(z.string()).readonly(),
    improvements: z.array(z.string()).readonly(),
    evaluatedAt: z.string(),
  })
  .strict()
  .readonly()

const EvaluatedFeatureRecordArraySchema = z.array(EvaluatedFeatureRecordSchema).readonly()

async function readArtifactFile<T>(artifactPath: string, schema: z.ZodType<T>): Promise<T | null> {
  const file = Bun.file(resolve(PROJECT_ROOT, artifactPath))
  if (!(await file.exists())) {
    return null
  }

  return schema.parse(JSON.parse(await file.text()))
}

function toStoryEvaluation(input: {
  readonly consolidated: ConsolidatedBehavior
  readonly evaluation: EvaluatedFeatureRecord
}): StoryEvaluation {
  return {
    testName: input.consolidated.featureName,
    behavior: input.consolidated.behavior,
    userStory: input.consolidated.userStory ?? '',
    maria: input.evaluation.maria,
    dani: input.evaluation.dani,
    viktor: input.evaluation.viktor,
    flaws: input.evaluation.flaws,
    improvements: input.evaluation.improvements,
  }
}

function incrementCount(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1)
}

function collectFeatureArtifactPaths(
  consolidatedManifest: ConsolidatedManifest,
): ReadonlyMap<
  string,
  { readonly consolidatedArtifactPath: string | null; readonly evaluatedArtifactPath: string | null }
> {
  const artifactPaths = new Map<
    string,
    { readonly consolidatedArtifactPath: string | null; readonly evaluatedArtifactPath: string | null }
  >()

  for (const entry of Object.values(consolidatedManifest.entries)) {
    const featureKey = entry.featureKey

    const current = artifactPaths.get(featureKey)
    artifactPaths.set(featureKey, {
      consolidatedArtifactPath:
        entry.consolidatedArtifactPath ??
        current?.consolidatedArtifactPath ??
        consolidatedArtifactPathForFeatureKey(featureKey),
      evaluatedArtifactPath:
        entry.evaluatedArtifactPath ?? current?.evaluatedArtifactPath ?? evaluatedArtifactPathForFeatureKey(featureKey),
    })
  }

  return artifactPaths
}

export function buildSummary(
  domain: string,
  evals: readonly StoryEvaluation[],
  extractedRecords?: readonly ExtractedBehaviorRecord[],
): DomainSummary {
  const avg = (fn: (e: StoryEvaluation) => number): number => evals.reduce((s, e) => s + fn(e), 0) / evals.length
  const pAvg = (p: 'maria' | 'dani' | 'viktor'): number => avg((e) => (e[p].discover + e[p].use + e[p].retain) / 3)
  const personaScores: ReadonlyArray<readonly [string, number]> = [
    ['Maria', pAvg('maria')],
    ['Dani', pAvg('dani')],
    ['Viktor', pAvg('viktor')],
  ]
  const worst = personaScores.reduce((min, cur) => (cur[1] < min[1] ? cur : min))
  return {
    domain,
    count: evals.length,
    avgDiscover: avg((e) => (e.maria.discover + e.dani.discover + e.viktor.discover) / 3),
    avgUse: avg((e) => (e.maria.use + e.dani.use + e.viktor.use) / 3),
    avgRetain: avg((e) => (e.maria.retain + e.dani.retain + e.viktor.retain) / 3),
    worstPersona: `${worst[0]} (${worst[1].toFixed(1)})`,
    ...(extractedRecords !== undefined && { trustMetrics: collectTrustMetrics(extractedRecords) }),
  }
}

export function collectStoryEvaluations(input: {
  readonly consolidatedByFeatureKey: ReadonlyMap<string, readonly ConsolidatedBehavior[]>
  readonly evaluatedByFeatureKey: ReadonlyMap<string, readonly EvaluatedFeatureRecord[]>
}): {
  readonly evaluationsByDomain: ReadonlyMap<string, readonly StoryEvaluation[]>
  readonly flawFreq: ReadonlyMap<string, number>
  readonly improvementFreq: ReadonlyMap<string, number>
} {
  const evaluationsByDomain = new Map<string, StoryEvaluation[]>()
  const flawFreq = new Map<string, number>()
  const improvementFreq = new Map<string, number>()

  for (const [featureKey, evaluations] of input.evaluatedByFeatureKey.entries()) {
    const consolidatedById = new Map(
      (input.consolidatedByFeatureKey.get(featureKey) ?? []).map((record) => [record.id, record]),
    )

    for (const evaluation of evaluations) {
      const consolidated = consolidatedById.get(evaluation.consolidatedId)
      if (consolidated === undefined || consolidated.userStory === null || !consolidated.isUserFacing) {
        continue
      }

      const storyEvaluation = toStoryEvaluation({ consolidated, evaluation })
      evaluationsByDomain.set(consolidated.domain, [
        ...(evaluationsByDomain.get(consolidated.domain) ?? []),
        storyEvaluation,
      ])
      for (const flaw of storyEvaluation.flaws) incrementCount(flawFreq, flaw)
      for (const improvement of storyEvaluation.improvements) incrementCount(improvementFreq, improvement)
    }
  }

  return { evaluationsByDomain, flawFreq, improvementFreq }
}

export async function loadConsolidatedArtifacts(
  consolidatedManifest: ConsolidatedManifest,
  schema: z.ZodType<readonly ConsolidatedBehavior[]>,
): Promise<ReadonlyMap<string, readonly ConsolidatedBehavior[]>> {
  const loaded = await Promise.all(
    [...collectFeatureArtifactPaths(consolidatedManifest).entries()].map(
      async ([featureKey, artifactPaths]) =>
        [
          featureKey,
          artifactPaths.consolidatedArtifactPath === null
            ? []
            : ((await readArtifactFile(artifactPaths.consolidatedArtifactPath, schema)) ?? []),
        ] as const,
    ),
  )

  return new Map(loaded)
}

export async function loadEvaluatedArtifacts(
  consolidatedManifest: ConsolidatedManifest,
): Promise<ReadonlyMap<string, readonly EvaluatedFeatureRecord[]>> {
  const loaded = await Promise.all(
    [...collectFeatureArtifactPaths(consolidatedManifest).entries()].map(
      async ([featureKey, artifactPaths]) =>
        [
          featureKey,
          artifactPaths.evaluatedArtifactPath === null
            ? []
            : ((await readArtifactFile(artifactPaths.evaluatedArtifactPath, EvaluatedFeatureRecordArraySchema)) ?? []),
        ] as const,
    ),
  )

  return new Map(loaded)
}
