import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, stepCountIs } from 'ai'
import pLimit from 'p-limit'

import {
  createBenchmarkStore,
  evaluateBenchmarkScenario,
  resultForRun,
  scenarios,
  toolsForMode,
  type BenchmarkScenario,
  type BenchmarkScenarioSnapshot,
} from './tool-proxy-benchmark-scenarios.js'

export { evaluateBenchmarkScenario, type BenchmarkScenarioSnapshot }

export type BenchmarkMode = 'direct' | 'proxy'
type BenchmarkCounts = Record<'toolCallCount' | 'stepCount', number>
export type BenchmarkResult = Readonly<
  Record<'model' | 'scenario', string> &
    BenchmarkCounts & { mode: BenchmarkMode; success: boolean; failureCategory: string | null }
>
export type BenchmarkArgs = Readonly<
  Record<'baseUrl' | 'apiKeyEnv' | 'outputPath', string> & { models: readonly string[]; repetitions: number }
>
type SummaryGroup = Record<'model' | 'mode', string> &
  Record<'runs' | 'successes' | 'toolCalls' | 'steps', number> & { failures: Record<string, number> }
type RawBenchmarkArgs = Omit<BenchmarkArgs, 'models'> & { models: string | readonly string[] }

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_API_KEY_ENV = 'TOOL_PROXY_BENCHMARK_API_KEY'
const DEFAULT_MODEL = 'gpt-4.1-mini'
const DEFAULT_OUTPUT_PATH = 'docs/superpowers/plans/tool-proxy-benchmark-results.md'
const SUMMARY_HEADER = '| Model | Mode | Runs | Success Rate | Avg Tool Calls | Avg Steps | Failures |'

const present = (value: string | undefined): value is string => value !== undefined && value.length > 0
const configured = (value: string | undefined): value is string => value !== undefined
const firstEnv = (names: readonly string[], fallback: string): string => {
  const value = names.map((name) => process.env[name]).find((candidate) => configured(candidate))
  if (value === undefined) return fallback
  return value
}
const parseModels = (value: string): readonly string[] =>
  value
    .split(',')
    .map((model) => model.trim())
    .filter((model) => present(model))
const parseModelFlag = (flag: string, value: string): readonly string[] => {
  const models = parseModels(value)
  if (models.length === 0) throw new Error(`Invalid non-empty model list for ${flag}`)
  return models
}
const positiveInt = (flag: string, value: string): number => {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Invalid positive integer value for ${flag}: ${value}`)
  return parsed
}
const flagValue = (args: readonly string[], index: number, flag: string): string => {
  const value = args[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${flag}`)
  return value
}
const isFlagValue = (args: readonly string[], index: number): boolean => {
  const previous = args[index - 1]
  return index > 0 && previous !== undefined && previous.startsWith('--')
}

export function parseBenchmarkArgs(args: readonly string[]): BenchmarkArgs {
  const defaults: RawBenchmarkArgs = {
    baseUrl: firstEnv(['TOOL_PROXY_BENCHMARK_BASE_URL', 'LLM_BASE_URL'], DEFAULT_BASE_URL),
    apiKeyEnv: firstEnv(['TOOL_PROXY_BENCHMARK_API_KEY_ENV'], DEFAULT_API_KEY_ENV),
    models: firstEnv(['TOOL_PROXY_BENCHMARK_MODELS'], DEFAULT_MODEL),
    outputPath: DEFAULT_OUTPUT_PATH,
    repetitions: 1,
  }
  const parsed = args.reduce<RawBenchmarkArgs>((current, arg, index) => {
    if (isFlagValue(args, index)) return current
    if (!arg.startsWith('--')) throw new Error(`Unexpected positional argument: ${arg}`)
    const value = flagValue(args, index, arg)
    if (arg === '--base-url') return { ...current, baseUrl: value }
    if (arg === '--api-key-env') return { ...current, apiKeyEnv: value }
    if (arg === '--models') return { ...current, models: parseModelFlag(arg, value) }
    if (arg === '--output') return { ...current, outputPath: value }
    if (arg === '--repetitions') return { ...current, repetitions: positiveInt(arg, value) }
    throw new Error(`Unknown flag: ${arg}`)
  }, defaults)
  return {
    ...parsed,
    models:
      typeof parsed.models === 'string' ? parseModelFlag('TOOL_PROXY_BENCHMARK_MODELS', parsed.models) : parsed.models,
  }
}

const average = (total: number, runs: number): string => (runs === 0 ? '0.0' : (total / runs).toFixed(1))
const failureText = (counts: Readonly<Record<string, number>>): string => {
  const entries = Object.entries(counts).filter(([, count]) => count > 0)
  if (entries.length === 0) return 'none'
  return entries.map(([category, count]) => `${category}: ${count}`).join(', ')
}
const row = (group: SummaryGroup): string => {
  const rate = group.runs === 0 ? '0.0%' : `${((group.successes / group.runs) * 100).toFixed(1)}%`
  return `| ${group.model} | ${group.mode} | ${group.runs} | ${rate} | ${average(group.toolCalls, group.runs)} | ${average(group.steps, group.runs)} | ${failureText(group.failures)} |`
}
export function summarizeBenchmarkResults(results: readonly BenchmarkResult[]): string {
  const groups: Record<string, SummaryGroup> = {}
  for (const result of results) {
    const key = `${result.model}\u0000${result.mode}`
    let group = groups[key]
    if (group === undefined) {
      group = { model: result.model, mode: result.mode, runs: 0, successes: 0, toolCalls: 0, steps: 0, failures: {} }
      groups[key] = group
    }
    group.runs += 1
    group.successes += result.success ? 1 : 0
    group.toolCalls += result.toolCallCount
    group.steps += result.stepCount
    if (result.failureCategory !== null) {
      const count = group.failures[result.failureCategory]
      group.failures[result.failureCategory] = count === undefined ? 1 : count + 1
    }
  }
  const rows = Object.values(groups)
    .toSorted((a, b) => {
      const byModel = a.model.localeCompare(b.model)
      if (byModel !== 0) return byModel
      return a.mode.localeCompare(b.mode)
    })
    .map((group) => row(group))
  return [
    '# Tool Proxy Benchmark Results',
    '',
    SUMMARY_HEADER,
    '| --- | --- | ---: | ---: | ---: | ---: | --- |',
    ...rows,
    '',
  ].join('\n')
}

const systemForMode = (mode: BenchmarkMode): string =>
  mode === 'direct'
    ? 'Use the direct tools.'
    : 'Use papai_tool to search, describe, and call internal tools with JSON args.'
const countToolCalls = (steps: readonly { readonly toolCalls: readonly unknown[] }[]): number =>
  steps.reduce((total, step) => total + step.toolCalls.length, 0)
const failure = (error: unknown): string =>
  String(error instanceof Error ? error.message : error)
    .toLowerCase()
    .includes('confirmation')
    ? 'confirmation_error'
    : 'model_error'
const runScenario = async (
  model: string,
  mode: BenchmarkMode,
  scenario: BenchmarkScenario,
  args: BenchmarkArgs,
  apiKey: string,
): Promise<BenchmarkResult> => {
  const store = createBenchmarkStore()
  const provider = createOpenAICompatible({ name: 'tool-proxy-benchmark', apiKey, baseURL: args.baseUrl })(model)
  try {
    const result = await generateText({
      model: provider,
      system: systemForMode(mode),
      prompt: scenario.prompt,
      tools: toolsForMode(mode, store),
      stopWhen: stepCountIs(8),
      maxOutputTokens: 1024,
    })
    const evaluated = evaluateBenchmarkScenario(scenario.id, {
      tasks: [...store.tasks.values()],
      toolCalls: store.toolCalls,
    })
    return resultForRun(model, mode, scenario, evaluated, {
      toolCallCount: countToolCalls(result.steps),
      stepCount: result.steps.length,
    })
  } catch (error) {
    return resultForRun(
      model,
      mode,
      scenario,
      { success: false, failureCategory: failure(error) },
      { toolCallCount: 0, stepCount: 0 },
    )
  }
}
const runBenchmark = (args: BenchmarkArgs, apiKey: string): Promise<readonly BenchmarkResult[]> => {
  const limit = pLimit(3)
  const reps = Array.from({ length: args.repetitions }, (_, index) => index)
  const runs = args.models.flatMap((model) =>
    reps.flatMap(() =>
      scenarios.flatMap((scenario) => (['direct', 'proxy'] as const).map((mode) => ({ model, scenario, mode }))),
    ),
  )
  return Promise.all(
    runs.map(({ model, scenario, mode }) => limit(() => runScenario(model, mode, scenario, args, apiKey))),
  )
}
const main = async (): Promise<void> => {
  const args = parseBenchmarkArgs(Bun.argv.slice(2))
  const apiKey = process.env[args.apiKeyEnv]
  if (apiKey === undefined || apiKey.length === 0)
    throw new Error(`Missing API key environment variable: ${args.apiKeyEnv}`)
  const summary = summarizeBenchmarkResults(await runBenchmark(args, apiKey))
  await mkdir(dirname(args.outputPath), { recursive: true })
  await writeFile(args.outputPath, summary, 'utf-8')
  console.log(summary)
}
if (process.argv[1] === import.meta.filename) {
  try {
    await main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
