import { constants } from 'node:fs'
import { access, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { z } from 'zod'

import { CONSOLIDATED_DIR, STORIES_DIR } from './config.js'
import {
  buildFailedSection,
  buildSummaryHeader,
  buildTopItemsSection,
  type DomainSummary,
  type FailedItem,
} from './report-index-helpers.js'
import {
  buildSummary,
  collectStoryEvaluations,
  loadConsolidatedArtifacts,
  loadEvaluatedArtifacts,
} from './report-rebuild-helpers.js'
export type { DomainSummary, FailedItem } from './report-index-helpers.js'

export interface StoryEvaluation {
  readonly testName: string
  readonly behavior: string
  readonly userStory: string
  readonly maria: { readonly discover: number; readonly use: number; readonly retain: number; readonly notes: string }
  readonly dani: { readonly discover: number; readonly use: number; readonly retain: number; readonly notes: string }
  readonly viktor: { readonly discover: number; readonly use: number; readonly retain: number; readonly notes: string }
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
  readonly supportingInternalRefs: readonly { readonly behaviorId: string; readonly summary: string }[]
}

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

function domainTitle(domain: string): string {
  return domain
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export async function writeStoryFile(domain: string, evaluations: readonly StoryEvaluation[]): Promise<void> {
  const outPath = join(STORIES_DIR, `${domain}.md`)
  await mkdir(dirname(outPath), { recursive: true })

  const lines: string[] = [`# ${domainTitle(domain)} — User Stories & UX Evaluation\n`]

  for (const e of evaluations) {
    lines.push(`## "${e.testName}"\n`)
    lines.push(`**User Story:** ${e.userStory}\n`)
    lines.push('| Persona | Discover | Use | Retain | Notes |')
    lines.push('|---------|----------|-----|--------|-------|')
    lines.push(
      `| Maria   | ${e.maria.discover}        | ${e.maria.use}   | ${e.maria.retain}      | ${e.maria.notes} |`,
    )
    lines.push(`| Dani    | ${e.dani.discover}        | ${e.dani.use}   | ${e.dani.retain}      | ${e.dani.notes} |`)
    lines.push(
      `| Viktor  | ${e.viktor.discover}        | ${e.viktor.use}   | ${e.viktor.retain}      | ${e.viktor.notes} |`,
    )
    lines.push('')
    if (e.flaws.length > 0) {
      lines.push('**Flaws:**\n')
      for (const flaw of e.flaws) lines.push(`- ${flaw}`)
      lines.push('')
    }
    if (e.improvements.length > 0) {
      lines.push('**Improvements:**\n')
      for (const imp of e.improvements) lines.push(`- ${imp}`)
      lines.push('')
    }
  }

  await Bun.write(outPath, lines.join('\n'))
}

async function writeRebuiltStoryFiles(
  evaluationsByDomain: ReadonlyMap<string, readonly StoryEvaluation[]>,
): Promise<void> {
  await Promise.all(
    [...evaluationsByDomain.entries()].map(([domain, evaluations]) =>
      writeStoryFile(
        domain,
        [...evaluations].toSorted((a, b) => a.testName.localeCompare(b.testName)),
      ),
    ),
  )
}

function countStoryEvaluations(evaluationsByDomain: ReadonlyMap<string, readonly StoryEvaluation[]>): number {
  return [...evaluationsByDomain.values()].reduce((sum, evaluations) => sum + evaluations.length, 0)
}

export async function writeIndexFile(
  summaries: readonly DomainSummary[],
  totalProcessed: number,
  totalFailed: number,
  flawFrequency: ReadonlyMap<string, number>,
  improvementFrequency: ReadonlyMap<string, number>,
  failedItems: readonly FailedItem[],
): Promise<void> {
  const outPath = join(STORIES_DIR, 'index.md')
  await mkdir(dirname(outPath), { recursive: true })

  const lines = [
    ...buildSummaryHeader(summaries, totalProcessed, totalFailed),
    ...buildTopItemsSection('Top 10 Flaws (by frequency)', flawFrequency),
    ...buildTopItemsSection('Top 10 Improvements (by frequency)', improvementFrequency),
    ...buildFailedSection(failedItems),
  ]

  await Bun.write(outPath, lines.join('\n'))
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

  await writeRebuiltStoryFiles(evaluationsByDomain)

  const summaries = [...evaluationsByDomain.entries()]
    .map(([domain, evaluations]) => buildSummary(domain, evaluations))
    .toSorted((a, b) => a.domain.localeCompare(b.domain))

  const totalProcessed = countStoryEvaluations(evaluationsByDomain)

  await writeIndexFile(summaries, totalProcessed, 0, flawFreq, improvementFreq, [])
}
