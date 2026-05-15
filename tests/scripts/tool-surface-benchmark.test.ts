// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, it } from 'bun:test'

import type { ToolSet } from 'ai'

import { getToolExecutor } from '../utils/test-helpers.js'

type BenchmarkModule = typeof import('../../scripts/tool-surface-benchmark.js')
type GenerateTextResult = Readonly<{ steps: readonly Readonly<Record<string, unknown>>[] }>
type GenerateScenarioText = NonNullable<Parameters<BenchmarkModule['runScenario']>[5]>['generateScenarioText']
type CreateTaskInput = Readonly<{ title: string; priority: string }>

const loadModule = (): Promise<BenchmarkModule> => import('../../scripts/tool-surface-benchmark.js')

const failUntilThirdAttempt = (attemptNumber: number): void => {
  if (attemptNumber < 3) {
    throw new Error(`temporary failure ${attemptNumber}`)
  }
}

const getCreateTaskTool = (tools: ToolSet): unknown => tools['create_task']

const executeCreateTask = async (tools: ToolSet, input: CreateTaskInput): Promise<void> => {
  await getToolExecutor(getCreateTaskTool(tools))(input)
}

const successfulGenerateText =
  (getAttemptNumber: () => number): GenerateScenarioText =>
  async (input: Parameters<GenerateScenarioText>[0]): Promise<GenerateTextResult> => {
    const attemptNumber = getAttemptNumber()
    failUntilThirdAttempt(attemptNumber)
    await executeCreateTask(input.tools, { title: 'Draft tool benchmark summary', priority: 'high' })

    return {
      steps: [{ toolCalls: [{ toolName: 'create_task' }] }, {}],
    }
  }

const failingGenerateText = (message: string): GenerateScenarioText => {
  return (_input: Parameters<GenerateScenarioText>[0]): Promise<GenerateTextResult> =>
    Promise.reject(new Error(message))
}

const defaultGenerateText: GenerateScenarioText = (
  _input: Parameters<GenerateScenarioText>[0],
): Promise<GenerateTextResult> => Promise.resolve({ steps: [] })

describe('tool-surface benchmark runner', () => {
  let generateScenarioTextImpl: GenerateScenarioText
  let attempts: number

  beforeEach(() => {
    attempts = 0
    generateScenarioTextImpl = defaultGenerateText
  })

  it('parses explicit benchmark flags', () => {
    return loadModule().then(({ parseBenchmarkArgs }) => {
      const args = parseBenchmarkArgs([
        '--base-url',
        'https://llm.example/v1',
        '--api-key-env',
        'TEST_KEY',
        '--models',
        'model-a,model-b',
        '--output',
        'docs/superpowers/plans/tool-surface-benchmark-results.md',
        '--repetitions',
        '3',
      ])

      expect(args).toEqual({
        baseUrl: 'https://llm.example/v1',
        apiKeyEnv: 'TEST_KEY',
        models: ['model-a', 'model-b'],
        outputPath: 'docs/superpowers/plans/tool-surface-benchmark-results.md',
        repetitions: 3,
      })
    })
  })

  it('retries transient generateText failures up to three total attempts', async () => {
    generateScenarioTextImpl = successfulGenerateText(() => {
      attempts += 1
      return attempts
    })

    const { parseBenchmarkArgs, runScenario } = await loadModule()

    const result = await runScenario(
      'model-a',
      'direct_full',
      { id: 'create_basic_task', prompt: 'Create a high priority task named Draft tool benchmark summary.' },
      parseBenchmarkArgs([]),
      'test-key',
      { generateScenarioText: generateScenarioTextImpl },
    )

    expect(attempts).toBe(3)
    expect(result.success).toBe(true)
    expect(result.failureCategory).toBeNull()
    expect(result.failureMessage).toBeNull()
  })

  it('returns detailed failure messages for runner errors after retries are exhausted', async () => {
    generateScenarioTextImpl = failingGenerateText('provider overloaded during tool benchmark')

    const { parseBenchmarkArgs, runScenario } = await loadModule()

    const result = await runScenario(
      'model-a',
      'direct_full',
      { id: 'create_basic_task', prompt: 'Create a high priority task named Draft tool benchmark summary.' },
      parseBenchmarkArgs([]),
      'test-key',
      { generateScenarioText: generateScenarioTextImpl },
    )

    expect(result.success).toBe(false)
    expect(result.failureCategory).toBe('model_error')
    expect(result.failureMessage).toContain('provider overloaded during tool benchmark')
    expect(result.failureMessage).toContain('3 attempts')
  })

  it('renders failure messages only in the scenario detail table', async () => {
    const { summarizeBenchmarkResults } = await loadModule()

    const markdown = summarizeBenchmarkResults([
      {
        model: 'model-a',
        mode: 'direct_full',
        scenario: 'create_basic_task',
        success: true,
        failureCategory: null,
        toolCallCount: 1,
        stepCount: 1,
        fullToolCount: 11,
        exposedToolCount: 11,
        failureMessage: null,
      },
      {
        model: 'model-a',
        mode: 'direct_routed',
        scenario: 'deferred_prompt_creation',
        success: true,
        failureCategory: null,
        toolCallCount: 1,
        stepCount: 1,
        fullToolCount: 11,
        exposedToolCount: 4,
        failureMessage: null,
      },
    ])

    expect(markdown).toContain('## Summary')
    expect(markdown).toContain('| model-a | direct_full | 1 | 100.0% | 1.0 | 1.0 | none |')
    expect(markdown).toContain('## Scenario Detail')
    expect(markdown).toContain(
      '| model-a | direct_routed | deferred_prompt_creation | 1 | 100.0% | 1.0 | 1.0 | none | none |',
    )
  })
})
