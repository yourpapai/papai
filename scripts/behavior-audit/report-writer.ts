// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { constants } from 'node:fs'
import { access, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { z } from 'zod'

import { CONSOLIDATED_DIR } from './config.js'
import { writeIndexFile, writeStoryFile } from './report-markdown.js'
import {
  buildSummary,
  collectStoryEvaluations,
  loadConsolidatedArtifacts,
  loadEvaluatedArtifacts,
  loadPriorSnapshot,
} from './report-rebuild-helpers.js'
import type { ClosureResult, EntryPointHint, ScoresFile } from './scores-types.js'
import { groupConsolidatedByDomain, writeScoresJson } from './scores-writer.js'

export type { DomainSummary, FailedItem } from './report-index-helpers.js'
export { writeIndexFile, writeStoryFile } from './report-markdown.js'

export interface StoryEvaluation {
  readonly testName: string
  readonly behavior: string
  readonly userStory: string
  readonly maria: {
    readonly discover: number
    readonly use: number
    readonly retain: number
    readonly notes: string
  }
  readonly dani: {
    readonly discover: number
    readonly use: number
    readonly retain: number
    readonly notes: string
  }
  readonly viktor: {
    readonly discover: number
    readonly use: number
    readonly retain: number
    readonly notes: string
  }
  readonly flaws: readonly string[]
  readonly improvements: readonly string[]
}

export interface ConsolidatedBehavior {
  readonly id: string
  readonly domain: string
  readonly featureName: string
  readonly isUserFacing: boolean
  readonly behavior: string
  readonly userStory: string | null
  readonly context: string
  readonly sourceTestKeys: readonly string[]
  readonly sourceBehaviorIds: readonly string[]
  readonly supportingInternalRefs: readonly {
    readonly behaviorId: string
    readonly summary: string
  }[]
  readonly entryPointHints: readonly EntryPointHint[]
  readonly closure: ClosureResult | null
}

const EntryPointHintSchema = z.object({
  kind: z.enum(['command', 'tool', 'handler', 'route']),
  identifier: z.string(),
})

const EntryPointEntrySchema = z.object({
  kind: z.enum(['command', 'tool', 'handler', 'route']),
  identifier: z.string(),
  resolved: z.boolean(),
  evidence: z
    .object({
      filePath: z.string(),
      symbol: z.string().optional(),
    })
    .nullable(),
})

const ClosureResultSchema = z.object({
  closureStatus: z.enum(['resolved', 'partial', 'unresolved', 'unverified']),
  entryPoints: z.array(EntryPointEntrySchema).readonly(),
})

const ConsolidatedBehaviorSchema = z.object({
  id: z.string(),
  domain: z.string(),
  featureName: z.string(),
  isUserFacing: z.boolean(),
  behavior: z.string(),
  userStory: z.string().nullable(),
  context: z.string(),
  sourceTestKeys: z.array(z.string()),
  sourceBehaviorIds: z.array(z.string()).default([]).readonly(),
  supportingInternalRefs: z
    .array(z.object({ behaviorId: z.string(), summary: z.string() }).readonly())
    .default([])
    .readonly(),
  entryPointHints: z.array(EntryPointHintSchema).default([]).readonly(),
  closure: ClosureResultSchema.nullable().default(null).readonly(),
})

const ConsolidatedBehaviorArraySchema = z.array(ConsolidatedBehaviorSchema).readonly()

interface RebuildReportsInput {
  readonly consolidatedManifest: import('./incremental.js').ConsolidatedManifest | null
}

export async function writeConsolidatedFile(
  domain: string,
  consolidations: readonly ConsolidatedBehavior[],
): Promise<void> {
  const outPath = join(CONSOLIDATED_DIR, `${domain}.json`)
  await mkdir(dirname(outPath), { recursive: true })
  const sorted = [...consolidations].toSorted((a, b) => a.id.localeCompare(b.id))
  await Bun.write(outPath, JSON.stringify(sorted, null, 2) + '\n')
}

export async function readConsolidatedFile(domain: string): Promise<readonly ConsolidatedBehavior[] | null> {
  const filePath = join(CONSOLIDATED_DIR, `${domain}.json`)
  try {
    await access(filePath, constants.F_OK)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null
    }
    throw error
  }

  const text = await Bun.file(filePath).text()
  const raw: unknown = JSON.parse(text)
  return ConsolidatedBehaviorArraySchema.parse(raw)
}

async function writeRebuiltStoryFiles(
  evaluationsByDomain: ReadonlyMap<string, readonly StoryEvaluation[]>,
  scores: ScoresFile,
): Promise<void> {
  await Promise.all(
    [...evaluationsByDomain.entries()].map(([domain, evaluations]) =>
      writeStoryFile(
        domain,
        [...evaluations].toSorted((a, b) => a.testName.localeCompare(b.testName)),
        scores,
      ),
    ),
  )
}

function countStoryEvaluations(evaluationsByDomain: ReadonlyMap<string, readonly StoryEvaluation[]>): number {
  return [...evaluationsByDomain.values()].reduce((sum, evaluations) => sum + evaluations.length, 0)
}

export async function rebuildReportsFromStoredResults({ consolidatedManifest }: RebuildReportsInput): Promise<void> {
  if (consolidatedManifest === null) {
    await writeIndexFile([], 0, 0, new Map(), new Map(), [])
    return
  }

  const consolidatedByFeatureKey = await loadConsolidatedArtifacts(
    consolidatedManifest,
    ConsolidatedBehaviorArraySchema,
  )
  const evaluatedByFeatureKey = await loadEvaluatedArtifacts(consolidatedManifest)
  const { evaluationsByDomain, flawFreq, improvementFreq } = collectStoryEvaluations({
    consolidatedByFeatureKey,
    evaluatedByFeatureKey,
  })

  const consolidatedByDomain = groupConsolidatedByDomain(consolidatedByFeatureKey)
  const prior = await loadPriorSnapshot()
  const scores = await writeScoresJson(consolidatedByDomain, evaluationsByDomain, prior)

  await writeRebuiltStoryFiles(evaluationsByDomain, scores)

  const summaries = [...evaluationsByDomain.entries()]
    .map(([domain, evaluations]) => buildSummary(domain, evaluations))
    .toSorted((a, b) => a.domain.localeCompare(b.domain))

  const totalProcessed = countStoryEvaluations(evaluationsByDomain)

  await writeIndexFile(summaries, totalProcessed, 0, flawFreq, improvementFreq, [], scores)
}
