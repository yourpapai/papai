import type { TrustMetrics } from './report-rebuild-helpers.js'

export interface DomainSummary {
  readonly domain: string
  readonly count: number
  readonly avgDiscover: number
  readonly avgUse: number
  readonly avgRetain: number
  readonly worstPersona: string
  readonly trustMetrics?: TrustMetrics
}

export interface FailedItem {
  readonly testFile: string
  readonly testName: string
  readonly error: string
  readonly attempts: number
}

export function buildSummaryHeader(
  summaries: readonly DomainSummary[],
  totalProcessed: number,
  totalFailed: number,
): readonly string[] {
  const lines: string[] = [
    '# Behavior Audit Summary\n',
    `**Generated:** ${new Date().toISOString()}`,
    `**Tests processed:** ${totalProcessed}`,
    `**Behaviors failed:** ${totalFailed}\n`,
    '| Domain | Behaviors | Avg Discover | Avg Use | Avg Retain | Worst Persona |',
    '|--------|-----------|-------------|---------|------------|---------------|',
  ]
  for (const s of summaries) {
    lines.push(
      `| ${s.domain} | ${s.count} | ${s.avgDiscover.toFixed(1)} | ${s.avgUse.toFixed(1)} | ${s.avgRetain.toFixed(1)} | ${s.worstPersona} |`,
    )
  }
  lines.push('')
  return lines
}

export function buildTopItemsSection(title: string, items: ReadonlyMap<string, number>): readonly string[] {
  const sorted = [...items.entries()].toSorted((a, b) => b[1] - a[1]).slice(0, 10)
  if (sorted.length === 0) return []
  return [`## ${title}\n`, ...sorted.map(([item, count], i) => `${i + 1}. "${item}" (${count})`), '']
}

export function buildFailedSection(failedItems: readonly FailedItem[]): readonly string[] {
  if (failedItems.length === 0) return []
  return [
    '## Failed Extractions\n',
    '| Test File | Test Name | Error | Attempts |',
    '|-----------|-----------|-------|----------|',
    ...failedItems.map((f) => `| ${f.testFile} | ${f.testName} | ${f.error} | ${f.attempts} |`),
    '',
  ]
}
