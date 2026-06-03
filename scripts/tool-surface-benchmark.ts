// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, stepCountIs } from 'ai'
import pLimit from 'p-limit'

import { summarizeBenchmarkResults, type BenchmarkResult } from './tool-surface-benchmark-report.js'
import { failedBenchmarkResult, successBenchmarkResult } from './tool-surface-benchmark-runner-support.js'
import {
  createBenchmarkStore,
  evaluateBenchmarkScenario,
  scenarios,
  snapshotFromStore,
  toolsForMode,
  type BenchmarkMode,
} from './tool-surface-benchmark-scenarios.js'

export { summarizeBenchmarkResults }

export type BenchmarkArgs = Readonly<
  Record<'baseUrl' | 'apiKeyEnv' | 'outputPath', string> & {
    models: readonly string[]
    repetitions: number
  }
>

type RawBenchmarkArgs = Omit<BenchmarkArgs, 'models'> & { models: string | readonly string[] }
type StepRecord = Readonly<Record<string, unknown>>
type GenerateScenarioTextResult = Readonly<{ steps: readonly StepRecord[] }>
type ScenarioFailure = Readonly<Record<'failureCategory', string | null> & { failureMessage: string | null }>
type BenchmarkProvider = ReturnType<ReturnType<typeof createOpenAICompatible>>
type GenerateScenarioTextInput = Readonly<{
  model: BenchmarkProvider
  mode: BenchmarkMode
  prompt: string
  tools: ReturnType<typeof toolsForMode>['tools']
}>
type GenerateScenarioText = (input: GenerateScenarioTextInput) => Promise<GenerateScenarioTextResult>
type RunScenarioDeps = Readonly<{ generateScenarioText: GenerateScenarioText }>
type AttemptSetup = Readonly<{
  store: ReturnType<typeof createBenchmarkStore>
  setup: ReturnType<typeof toolsForMode>
}>
type ScenarioContext = Readonly<{
  model: string
  mode: BenchmarkMode
  scenario: (typeof scenarios)[number]
  provider: BenchmarkProvider
  deps: RunScenarioDeps
}>

const DEFAULT_BASE_URL = 'https://api.synthetic.new/openai/v1'
const DEFAULT_API_KEY_ENV = 'TOOL_SURFACE_BENCHMARK_API_KEY'
const DEFAULT_MODEL = 'hf:moonshotai/Kimi-K2.6'
const DEFAULT_OUTPUT_PATH = 'docs/superpowers/plans/tool-surface-benchmark-results.md'
const MAX_ATTEMPTS = 3

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
    baseUrl: firstEnv(['TOOL_SURFACE_BENCHMARK_BASE_URL', 'LLM_BASE_URL'], DEFAULT_BASE_URL),
    apiKeyEnv: firstEnv(['TOOL_SURFACE_BENCHMARK_API_KEY_ENV'], DEFAULT_API_KEY_ENV),
    models: firstEnv(['TOOL_SURFACE_BENCHMARK_MODELS'], DEFAULT_MODEL),
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
      typeof parsed.models === 'string'
        ? parseModelFlag('TOOL_SURFACE_BENCHMARK_MODELS', parsed.models)
        : parsed.models,
  }
}

const systemForMode = (_mode: BenchmarkMode): string =>
  'Use the available direct tools. Search before updating when the task is ambiguous.'

const stepToolCalls = (step: StepRecord): readonly unknown[] => {
  const toolCalls = step['toolCalls']
  if (!Array.isArray(toolCalls)) return []
  return toolCalls
}

const countToolCalls = (steps: readonly StepRecord[]): number =>
  steps.reduce((total, step) => {
    return total + stepToolCalls(step).length
  }, 0)

const failureCategoryForError = (error: unknown): string => {
  const message = String(error instanceof Error ? error.message : error).toLowerCase()
  return message.includes('confirmation') ? 'confirmation_error' : 'model_error'
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const truncate = (value: string, limit: number): string =>
  value.length <= limit ? value : `${value.slice(0, limit - 3)}...`

const failureForEvaluation = (
  scenarioId: string,
  evaluation: Readonly<{ success: boolean; failureCategory: string | null }>,
): ScenarioFailure => {
  if (evaluation.success) {
    return { failureCategory: null, failureMessage: null }
  }

  return {
    failureCategory: evaluation.failureCategory,
    failureMessage: `Scenario ${scenarioId} remained in an unexpected final state after ${MAX_ATTEMPTS} attempts.`,
  }
}

const failureForError = (error: unknown, attempts: number): ScenarioFailure => ({
  failureCategory: failureCategoryForError(error),
  failureMessage: `Run failed after ${attempts} attempts: ${truncate(errorMessage(error), 240)}`,
})

const generateScenarioText = (input: GenerateScenarioTextInput): Promise<GenerateScenarioTextResult> =>
  generateText({
    model: input.model,
    system: systemForMode(input.mode),
    prompt: input.prompt,
    tools: input.tools,
    stopWhen: stepCountIs(8),
    maxOutputTokens: 1024,
    maxRetries: 0,
  })

const defaultRunScenarioDeps: RunScenarioDeps = { generateScenarioText }

const createAttemptSetup = (mode: BenchmarkMode, prompt: string): AttemptSetup => {
  const store = createBenchmarkStore()
  return { store, setup: toolsForMode(mode, prompt, store) }
}

const attemptScenarioRun = async (context: ScenarioContext, attemptNumber: number): Promise<BenchmarkResult> => {
  const { store, setup } = createAttemptSetup(context.mode, context.scenario.prompt)

  try {
    const result = await context.deps.generateScenarioText({
      model: context.provider,
      mode: context.mode,
      prompt: context.scenario.prompt,
      tools: setup.tools,
    })
    const evaluation = evaluateBenchmarkScenario(context.scenario.id, snapshotFromStore(store))

    if (!evaluation.success && attemptNumber < MAX_ATTEMPTS) {
      return await attemptScenarioRun(context, attemptNumber + 1)
    }

    return successBenchmarkResult(
      { model: context.model, mode: context.mode, scenario: context.scenario.id },
      { fullToolCount: setup.fullToolCount, exposedToolCount: setup.exposedToolCount },
      { toolCallCount: countToolCalls(result.steps), stepCount: result.steps.length },
      failureForEvaluation(context.scenario.id, evaluation),
      evaluation.success,
    )
  } catch (error) {
    if (attemptNumber < MAX_ATTEMPTS) {
      return attemptScenarioRun(context, attemptNumber + 1)
    }

    return failedBenchmarkResult(
      { model: context.model, mode: context.mode, scenario: context.scenario.id },
      { fullToolCount: setup.fullToolCount, exposedToolCount: setup.exposedToolCount },
      failureForError(error, attemptNumber),
    )
  }
}

export const runScenario = (
  model: string,
  mode: BenchmarkMode,
  scenario: (typeof scenarios)[number],
  args: BenchmarkArgs,
  apiKey: string,
  deps: RunScenarioDeps = defaultRunScenarioDeps,
): Promise<BenchmarkResult> => {
  return attemptScenarioRun(
    {
      model,
      mode,
      scenario,
      provider: createOpenAICompatible({
        name: 'tool-surface-benchmark',
        apiKey,
        baseURL: args.baseUrl,
      })(model),
      deps,
    },
    1,
  )
}

const runBenchmark = (args: BenchmarkArgs, apiKey: string): Promise<readonly BenchmarkResult[]> => {
  const limit = pLimit(3)
  const repetitions = Array.from({ length: args.repetitions }, (_, index) => index)
  const runs = args.models.flatMap((model) =>
    repetitions.flatMap(() =>
      scenarios.flatMap((scenario) => (['direct_full'] as const).map((mode) => ({ model, mode, scenario }))),
    ),
  )

  return Promise.all(
    runs.map(({ model, mode, scenario }) => limit(() => runScenario(model, mode, scenario, args, apiKey))),
  )
}

const main = async (): Promise<void> => {
  const args = parseBenchmarkArgs(Bun.argv.slice(2))
  const apiKey = process.env[args.apiKeyEnv]
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error(`Missing API key environment variable: ${args.apiKeyEnv}`)
  }

  const results = await runBenchmark(args, apiKey)
  const markdown = summarizeBenchmarkResults(results)

  await mkdir(dirname(args.outputPath), { recursive: true })
  await writeFile(args.outputPath, markdown, 'utf-8')
  console.log(markdown)
}

if (process.argv[1] === import.meta.filename) {
  try {
    await main()
  } catch {
    console.error('Benchmark run failed.')
    process.exitCode = 1
  }
}
