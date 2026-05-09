export interface AgentUsage {
  inputTokens: number
  outputTokens: number
  toolCalls: number
  toolNames: string[]
}

export interface AgentResult<T> {
  result: T
  usage: AgentUsage
}

export interface PhaseStats {
  itemsDone: number
  itemsFailed: number
  itemsSkipped: number
  totalInputTokens: number
  totalOutputTokens: number
  totalToolCalls: number
  toolBreakdown: Record<string, number>
  wallStartMs: number
}

export const emptyAgentUsage: AgentUsage = {
  inputTokens: 0,
  outputTokens: 0,
  toolCalls: 0,
  toolNames: [],
}

export function addAgentUsage(a: AgentUsage, b: AgentUsage): AgentUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    toolCalls: a.toolCalls + b.toolCalls,
    toolNames: [...a.toolNames, ...b.toolNames],
  }
}

export function createPhaseStats(): PhaseStats {
  return {
    itemsDone: 0,
    itemsFailed: 0,
    itemsSkipped: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalToolCalls: 0,
    toolBreakdown: {},
    wallStartMs: performance.now(),
  }
}

export function recordItemDone(stats: PhaseStats, usage: AgentUsage): void {
  stats.itemsDone += 1
  stats.totalInputTokens += usage.inputTokens
  stats.totalOutputTokens += usage.outputTokens
  stats.totalToolCalls += usage.toolCalls
  for (const name of usage.toolNames) {
    stats.toolBreakdown[name] = (stats.toolBreakdown[name] ?? 0) + 1
  }
}

export function recordItemFailed(stats: PhaseStats, usage?: AgentUsage): void {
  stats.itemsFailed += 1
  if (usage !== undefined) {
    stats.totalInputTokens += usage.inputTokens
    stats.totalOutputTokens += usage.outputTokens
    stats.totalToolCalls += usage.toolCalls
    for (const name of usage.toolNames) {
      stats.toolBreakdown[name] = (stats.toolBreakdown[name] ?? 0) + 1
    }
  }
}

export function recordItemSkipped(stats: PhaseStats): void {
  stats.itemsSkipped += 1
}

function formatTokenCount(n: number): string {
  return n.toLocaleString('en-US')
}

function formatWallTime(ms: number): string {
  const totalSeconds = ms / 1000
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.round(totalSeconds % 60)
  return `${minutes}m ${seconds}s`
}

function computeTps(outputTokens: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return 0
  return Math.round(outputTokens / (elapsedMs / 1000))
}

export function formatPerItemSuffix(usage: AgentUsage, elapsedMs: number): string {
  const totalTokens = usage.inputTokens + usage.outputTokens
  const tps = computeTps(usage.outputTokens, elapsedMs)
  const elapsed = elapsedMs < 1000 ? `${Math.round(elapsedMs)}ms` : `${(elapsedMs / 1000).toFixed(1)}s`
  const toolLabel = usage.toolCalls === 1 ? '1 tool' : `${usage.toolCalls} tools`
  return ` — ${toolLabel}, ${formatTokenCount(totalTokens)} tok in ${elapsed} (${tps} tok/s) ✓`
}

export function formatPhaseSummary(stats: PhaseStats, wallMs: number, label: string): string {
  const lines: string[] = [label]
  const avgTps = computeTps(stats.totalOutputTokens, wallMs)
  lines.push(`  Wall: ${formatWallTime(wallMs)} | Avg: ${avgTps} tok/s`)
  lines.push(
    `  Tokens: ${formatTokenCount(stats.totalInputTokens)} in / ${formatTokenCount(stats.totalOutputTokens)} out`,
  )
  if (stats.totalToolCalls > 0) {
    const sorted = Object.entries(stats.toolBreakdown).sort((a, b) => b[1] - a[1])
    const breakdown = sorted.map(([name, count]) => `${name}: ${count}`).join(', ')
    lines.push(`  Tools: ${stats.totalToolCalls} calls (${breakdown})`)
  }
  return lines.join('\n')
}
