// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { MODEL, STORIES_DIR } from './config.js'
import { computePercentiles, isBottomDecile } from './report-index-helpers.js'
import { computeTrendDeltas, type TrendEntry } from './report-rebuild-helpers.js'
import type { ConsolidatedBehavior, StoryEvaluation } from './report-writer.js'
import type { DomainEntry, ScoresFile, StoryEntry } from './scores-types.js'

export interface PriorSnapshot {
  readonly domains: readonly {
    readonly stories: readonly { readonly consolidatedId: string; readonly composite: number }[]
  }[]
}

export interface DomainGroupedBehaviors {
  readonly featureKey: string
  readonly behaviors: readonly ConsolidatedBehavior[]
}

export function groupConsolidatedByDomain(
  consolidatedByFeatureKey: ReadonlyMap<string, readonly ConsolidatedBehavior[]>,
): ReadonlyMap<string, readonly DomainGroupedBehaviors[]> {
  const byDomain = new Map<string, Map<string, ConsolidatedBehavior[]>>()
  for (const [featureKey, behaviors] of consolidatedByFeatureKey.entries()) {
    for (const behavior of behaviors) {
      const featureMap = byDomain.get(behavior.domain) ?? new Map<string, ConsolidatedBehavior[]>()
      const bucket = featureMap.get(featureKey) ?? []
      bucket.push(behavior)
      featureMap.set(featureKey, bucket)
      byDomain.set(behavior.domain, featureMap)
    }
  }
  const result = new Map<string, DomainGroupedBehaviors[]>()
  for (const [domain, featureMap] of byDomain.entries()) {
    result.set(
      domain,
      [...featureMap.entries()].map(([featureKey, behaviors]) => ({ featureKey, behaviors })),
    )
  }
  return result
}

function flattenPriorStories(prior: PriorSnapshot | null): readonly TrendEntry[] {
  if (prior === null) return []
  return prior.domains.flatMap((d) => d.stories)
}

interface PersonaTriple {
  readonly maria: { readonly discover: number; readonly use: number; readonly retain: number }
  readonly dani: { readonly discover: number; readonly use: number; readonly retain: number }
  readonly viktor: { readonly discover: number; readonly use: number; readonly retain: number }
}

function computeComposite(personas: PersonaTriple): number {
  return (
    (personas.maria.discover +
      personas.maria.use +
      personas.maria.retain +
      personas.dani.discover +
      personas.dani.use +
      personas.dani.retain +
      personas.viktor.discover +
      personas.viktor.use +
      personas.viktor.retain) /
    9
  )
}

function buildStoryEntry(
  behavior: ConsolidatedBehavior,
  domain: string,
  featureKey: string,
  evaluation: StoryEvaluation | null,
): StoryEntry {
  const maria = evaluation?.maria ?? { discover: 0, use: 0, retain: 0, notes: '' }
  const dani = evaluation?.dani ?? { discover: 0, use: 0, retain: 0, notes: '' }
  const viktor = evaluation?.viktor ?? { discover: 0, use: 0, retain: 0, notes: '' }
  const composite = computeComposite({ maria, dani, viktor })
  return {
    featureKey,
    consolidatedId: behavior.id,
    domain,
    featureName: behavior.featureName,
    userStory: behavior.userStory ?? '',
    composite,
    percentile: 0,
    bottomDecile: false,
    maria: { discover: maria.discover, use: maria.use, retain: maria.retain },
    dani: { discover: dani.discover, use: dani.use, retain: dani.retain },
    viktor: { discover: viktor.discover, use: viktor.use, retain: viktor.retain },
    flaws: evaluation?.flaws ?? [],
    improvements: evaluation?.improvements ?? [],
    trendDelta: null,
    closureStatus: behavior.closure?.closureStatus ?? 'unverified',
    entryPoints: behavior.closure?.entryPoints ?? [],
  }
}

function assignPercentiles(entries: readonly StoryEntry[]): readonly StoryEntry[] {
  if (entries.length === 0) return entries
  const scores = entries.map((e) => e.composite)
  const percentiles = computePercentiles(scores)
  return entries.map((entry, i) => {
    const percentile = percentiles[i] ?? 0
    return { ...entry, percentile, bottomDecile: isBottomDecile(percentile) }
  })
}

function assignTrendDeltas(entries: readonly StoryEntry[], priorStories: readonly TrendEntry[]): readonly StoryEntry[] {
  if (entries.length === 0) return entries
  const trendInput: readonly TrendEntry[] = entries.map((e) => ({
    consolidatedId: e.consolidatedId,
    composite: e.composite,
  }))
  const deltas = computeTrendDeltas(trendInput, priorStories.length > 0 ? priorStories : null)
  return entries.map((entry, i) => ({ ...entry, trendDelta: deltas[i] ?? null }))
}

export async function writeScoresJson(
  consolidatedByDomain: ReadonlyMap<string, readonly DomainGroupedBehaviors[]>,
  evaluatedByDomain: ReadonlyMap<string, readonly StoryEvaluation[]>,
  prior: PriorSnapshot | null,
): Promise<ScoresFile> {
  const priorStories = flattenPriorStories(prior)
  const domains: DomainEntry[] = []

  for (const [domain, groups] of consolidatedByDomain) {
    const evaluations = evaluatedByDomain.get(domain) ?? []
    const evalByFeatureName = new Map(evaluations.map((e) => [e.testName, e]))

    const baseEntries = groups.flatMap((group) => {
      const userFacing = group.behaviors.filter((b) => b.isUserFacing && b.userStory !== null)
      return userFacing.map((b) => {
        const evaluation = evalByFeatureName.get(b.featureName) ?? null
        return buildStoryEntry(b, domain, group.featureKey, evaluation)
      })
    })

    const withPercentiles = assignPercentiles(baseEntries)
    const withTrend = assignTrendDeltas(withPercentiles, priorStories)

    domains.push({ domain, stories: withTrend })
  }

  const scoresFile: ScoresFile = {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    domains,
  }

  const outPath = join(STORIES_DIR, 'scores.json')
  await mkdir(dirname(outPath), { recursive: true })
  await Bun.write(outPath, JSON.stringify(scoresFile, null, 2) + '\n')
  return scoresFile
}
