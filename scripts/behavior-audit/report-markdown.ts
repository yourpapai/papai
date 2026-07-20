// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { STORIES_DIR } from './config.js'
import {
  buildFailedSection,
  buildSummaryHeader,
  buildTopItemsSection,
  type DomainSummary,
  type FailedItem,
} from './report-index-helpers.js'
import type { StoryEvaluation } from './report-writer.js'
import type { ScoresFile, StoryEntry } from './scores-types.js'

export function domainTitle(domain: string): string {
  return domain
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function appendEntryMetrics(lines: string[], entry: StoryEntry): void {
  if (entry.trendDelta === null) {
    lines.push(`**Composite:** ${entry.composite.toFixed(1)} (no prior snapshot)\n`)
  } else {
    const arrow = entry.trendDelta >= 0.3 ? '↑' : entry.trendDelta <= -0.3 ? '↓' : '='
    const sign = entry.trendDelta > 0 ? '+' : ''
    lines.push(
      `**Composite:** ${entry.composite.toFixed(1)} (Δ ${arrow} ${sign}${entry.trendDelta.toFixed(1)} vs prior)\n`,
    )
  }
  lines.push(`**Domain rank:** ${entry.percentile}th percentile\n`)
  if (entry.bottomDecile) {
    lines.push(`⚠ Bottom decile (within ${entry.domain})\n`)
  }
  if (entry.closureStatus !== 'resolved') {
    const total = entry.entryPoints.length
    const unresolved = entry.entryPoints.filter((ep) => !ep.resolved).length
    lines.push(`⚠ Closure check: ${total - unresolved} of ${total} entry points resolved (${entry.closureStatus})\n`)
  }
}

function appendEntryPointList(lines: string[], entry: StoryEntry): void {
  lines.push('**Entry points:**\n')
  for (const ep of entry.entryPoints) {
    const mark = ep.resolved ? '✓' : '✗'
    lines.push(`- ${mark} ${ep.kind}: ${ep.identifier}`)
  }
  lines.push('')
}

export async function writeStoryFile(
  domain: string,
  evaluations: readonly StoryEvaluation[],
  scores?: ScoresFile,
): Promise<void> {
  const outPath = join(STORIES_DIR, `${domain}.md`)
  await mkdir(dirname(outPath), { recursive: true })

  const domainEntries = scores?.domains.find((d) => d.domain === domain)?.stories ?? []
  const entryByFeatureName = new Map(domainEntries.map((e) => [e.featureName, e]))

  const lines: string[] = [`# ${domainTitle(domain)} — User Stories & UX Evaluation\n`]

  for (const e of evaluations) {
    lines.push(`## "${e.testName}"\n`)
    lines.push(`**User Story:** ${e.userStory}\n`)
    const entry = entryByFeatureName.get(e.testName)
    if (entry !== undefined) {
      appendEntryMetrics(lines, entry)
    }
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
    if (entry !== undefined && entry.entryPoints.length > 0) {
      appendEntryPointList(lines, entry)
    }
  }

  await Bun.write(outPath, lines.join('\n'))
}

interface ClosureGap {
  readonly domain: string
  readonly featureName: string
  readonly unresolved: number
  readonly status: string
}

function collectClosureGaps(scores: ScoresFile): readonly ClosureGap[] {
  const gaps: ClosureGap[] = []
  for (const domain of scores.domains) {
    for (const story of domain.stories) {
      if (story.closureStatus === 'resolved') continue
      const unresolved = story.entryPoints.filter((ep) => !ep.resolved).length
      if (unresolved === 0) continue
      gaps.push({
        domain: domain.domain,
        featureName: story.featureName,
        unresolved,
        status: story.closureStatus,
      })
    }
  }
  return gaps
}

function buildClosureGapsSection(scores: ScoresFile): readonly string[] {
  const gaps = collectClosureGaps(scores)
  if (gaps.length === 0) return []
  const sorted = [...gaps].toSorted((a, b) => b.unresolved - a.unresolved).slice(0, 10)
  return [
    '## Closure Gaps\n',
    ...sorted.map((g) => `- "${g.featureName}" (${g.domain}): ${g.unresolved} unresolved — ${g.status}`),
    '',
  ]
}

interface TrendMover {
  readonly domain: string
  readonly featureName: string
  readonly trendDelta: number
}

function collectTrendMovers(scores: ScoresFile): readonly TrendMover[] {
  const movers: TrendMover[] = []
  for (const domain of scores.domains) {
    for (const story of domain.stories) {
      if (story.trendDelta === null) continue
      movers.push({
        domain: domain.domain,
        featureName: story.featureName,
        trendDelta: story.trendDelta,
      })
    }
  }
  return movers
}

function buildTopMoversSection(scores: ScoresFile): readonly string[] {
  const withTrend = collectTrendMovers(scores)
  if (withTrend.length === 0) return []
  const positive = [...withTrend]
    .filter((m) => m.trendDelta > 0)
    .toSorted((a, b) => b.trendDelta - a.trendDelta)
    .slice(0, 5)
  const negative = [...withTrend]
    .filter((m) => m.trendDelta < 0)
    .toSorted((a, b) => a.trendDelta - b.trendDelta)
    .slice(0, 5)
  if (positive.length === 0 && negative.length === 0) return []
  const lines: string[] = ['## Top Movers\n']
  if (positive.length > 0) {
    lines.push('### Improving\n')
    for (const m of positive) {
      lines.push(`- "${m.featureName}" (${m.domain}): +${m.trendDelta.toFixed(1)}`)
    }
    lines.push('')
  }
  if (negative.length > 0) {
    lines.push('### Declining\n')
    for (const m of negative) {
      lines.push(`- "${m.featureName}" (${m.domain}): ${m.trendDelta.toFixed(1)}`)
    }
    lines.push('')
  }
  return lines
}

export async function writeIndexFile(
  summaries: readonly DomainSummary[],
  totalProcessed: number,
  totalFailed: number,
  flawFrequency: ReadonlyMap<string, number>,
  improvementFrequency: ReadonlyMap<string, number>,
  failedItems: readonly FailedItem[],
  scores?: ScoresFile,
): Promise<void> {
  const outPath = join(STORIES_DIR, 'index.md')
  await mkdir(dirname(outPath), { recursive: true })

  const lines = [
    ...buildSummaryHeader(summaries, totalProcessed, totalFailed),
    ...buildTopItemsSection('Top 10 Flaws (by frequency)', flawFrequency),
    ...buildTopItemsSection('Top 10 Improvements (by frequency)', improvementFrequency),
  ]
  if (scores !== undefined) {
    lines.push(...buildClosureGapsSection(scores))
    lines.push(...buildTopMoversSection(scores))
  }
  lines.push(...buildFailedSection(failedItems))

  await Bun.write(outPath, lines.join('\n'))
}
