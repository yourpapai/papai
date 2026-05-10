import type { BenchmarkMode } from './tool-surface-benchmark-scenarios.js'

type BenchmarkCounts = Record<'toolCallCount' | 'stepCount' | 'fullToolCount' | 'exposedToolCount', number>

export type BenchmarkResult = Readonly<
  Record<'model' | 'scenario', string> &
    BenchmarkCounts & { mode: BenchmarkMode; success: boolean; failureCategory: string | null }
>

type SummaryGroup = Record<'model' | 'mode', string> &
  Record<'runs' | 'successes' | 'toolCalls' | 'steps', number> & { failures: Record<string, number> }

type ScenarioGroup = Record<'model' | 'mode' | 'scenario', string> &
  Record<'runs' | 'successes' | 'toolCalls' | 'steps', number> & { failures: Record<string, number> }

type GroupedResults = Readonly<{
  summaryGroups: Record<string, SummaryGroup>
  scenarioGroups: Record<string, ScenarioGroup>
}>

const average = (total: number, runs: number): string => (runs === 0 ? '0.0' : (total / runs).toFixed(1))

const rate = (successes: number, runs: number): string =>
  runs === 0 ? '0.0%' : `${((successes / runs) * 100).toFixed(1)}%`

const failureText = (counts: Readonly<Record<string, number>>): string => {
  const entries = Object.entries(counts).filter(([, count]) => count > 0)
  if (entries.length === 0) return 'none'
  return entries.map(([name, count]) => `${name}: ${count}`).join(', ')
}

const topFailure = (counts: Readonly<Record<string, number>>): string => {
  const entries = Object.entries(counts).filter(([, count]) => count > 0)
  if (entries.length === 0) return 'none'

  const sorted = entries.toSorted((a, b) => {
    const countDiff = b[1] - a[1]
    if (countDiff === 0) return a[0].localeCompare(b[0])
    return countDiff
  })
  const first = sorted[0]
  if (first === undefined) return 'none'
  return first[0]
}

const createSummaryGroup = (result: BenchmarkResult): SummaryGroup => ({
  model: result.model,
  mode: result.mode,
  runs: 0,
  successes: 0,
  toolCalls: 0,
  steps: 0,
  failures: {},
})

const createScenarioGroup = (result: BenchmarkResult): ScenarioGroup => ({
  model: result.model,
  mode: result.mode,
  scenario: result.scenario,
  runs: 0,
  successes: 0,
  toolCalls: 0,
  steps: 0,
  failures: {},
})

const incrementFailure = (counts: Record<string, number>, failureCategory: string): void => {
  const current = counts[failureCategory]
  counts[failureCategory] = current === undefined ? 1 : current + 1
}

const updateRunCounts = (
  group: Pick<SummaryGroup, 'runs' | 'successes' | 'toolCalls' | 'steps'>,
  result: BenchmarkResult,
): void => {
  group.runs += 1
  group.successes += result.success ? 1 : 0
  group.toolCalls += result.toolCallCount
  group.steps += result.stepCount
}

const addResultToGroups = (grouped: GroupedResults, result: BenchmarkResult): void => {
  const summaryKey = `${result.model}\u0000${result.mode}`
  const scenarioKey = `${result.model}\u0000${result.mode}\u0000${result.scenario}`

  let summary = grouped.summaryGroups[summaryKey]
  if (summary === undefined) {
    summary = createSummaryGroup(result)
    grouped.summaryGroups[summaryKey] = summary
  }

  let detail = grouped.scenarioGroups[scenarioKey]
  if (detail === undefined) {
    detail = createScenarioGroup(result)
    grouped.scenarioGroups[scenarioKey] = detail
  }

  updateRunCounts(summary, result)
  updateRunCounts(detail, result)

  if (result.failureCategory === null) return
  incrementFailure(summary.failures, result.failureCategory)
  incrementFailure(detail.failures, result.failureCategory)
}

const groupResults = (results: readonly BenchmarkResult[]): GroupedResults => {
  const grouped: GroupedResults = { summaryGroups: {}, scenarioGroups: {} }
  results.forEach((result) => {
    addResultToGroups(grouped, result)
  })
  return grouped
}

const summaryRow = (group: SummaryGroup): string =>
  `| ${group.model} | ${group.mode} | ${group.runs} | ${rate(group.successes, group.runs)} | ${average(group.toolCalls, group.runs)} | ${average(group.steps, group.runs)} | ${failureText(group.failures)} |`

const detailRow = (group: ScenarioGroup): string =>
  `| ${group.model} | ${group.mode} | ${group.scenario} | ${group.runs} | ${rate(group.successes, group.runs)} | ${average(group.toolCalls, group.runs)} | ${average(group.steps, group.runs)} | ${topFailure(group.failures)} |`

const sortedSummaryRows = (summaryGroups: Record<string, SummaryGroup>): readonly string[] =>
  Object.values(summaryGroups)
    .toSorted((a, b) => {
      const byModel = a.model.localeCompare(b.model)
      if (byModel === 0) return a.mode.localeCompare(b.mode)
      return byModel
    })
    .map((group) => summaryRow(group))

const sortedDetailRows = (scenarioGroups: Record<string, ScenarioGroup>): readonly string[] =>
  Object.values(scenarioGroups)
    .toSorted((a, b) => {
      const byModel = a.model.localeCompare(b.model)
      if (byModel !== 0) return byModel

      const byMode = a.mode.localeCompare(b.mode)
      if (byMode !== 0) return byMode

      return a.scenario.localeCompare(b.scenario)
    })
    .map((group) => detailRow(group))

export function summarizeBenchmarkResults(results: readonly BenchmarkResult[]): string {
  const grouped = groupResults(results)
  const summaryRows = sortedSummaryRows(grouped.summaryGroups)
  const detailRows = sortedDetailRows(grouped.scenarioGroups)

  return [
    '# Tool Surface Benchmark Results',
    '',
    '## Summary',
    '',
    '| Model | Mode | Runs | Success Rate | Avg Tool Calls | Avg Steps | Failures |',
    '| --- | --- | ---: | ---: | ---: | ---: | --- |',
    ...summaryRows,
    '',
    '## Scenario Detail',
    '',
    '| Model | Mode | Scenario | Runs | Success Rate | Avg Tool Calls | Avg Steps | Top Failure |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | --- |',
    ...detailRows,
    '',
  ].join('\n')
}
