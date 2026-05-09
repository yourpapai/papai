import { describe, expect, it } from 'bun:test'

import type { ToolExecutionOptions, ToolSet } from 'ai'

import { createBenchmarkStore, toolsForMode } from '../../scripts/tool-proxy-benchmark-scenarios.js'
import {
  evaluateBenchmarkScenario,
  parseBenchmarkArgs,
  summarizeBenchmarkResults,
} from '../../scripts/tool-proxy-benchmark.js'
import { getToolExecutor } from '../utils/test-helpers.js'

type ProxyTextResult = {
  readonly content: readonly { readonly type: 'text'; readonly text: string }[]
  readonly details: Readonly<Record<string, unknown>>
}

const toolOptions: ToolExecutionOptions = { toolCallId: 'benchmark-proxy-call-1', messages: [] }

const isProxyTextResult = (value: unknown): value is ProxyTextResult => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return 'content' in value && 'details' in value
}

const proxyTool = (tools: ToolSet): ToolSet[string] => {
  const proxy = tools['papai_tool']
  expect(proxy).toBeDefined()
  if (proxy === undefined) throw new Error('Expected papai_tool to be available')
  return proxy
}

const expectProxyTextResult = (value: unknown): ProxyTextResult => {
  expect(value).toBeObject()
  expect(value).toHaveProperty('content')
  expect(value).toHaveProperty('details')
  if (!isProxyTextResult(value)) throw new Error('Expected proxy text result')
  return value
}

const firstProxyText = (value: ProxyTextResult): string => {
  const first = value.content[0]
  if (first === undefined) throw new Error('Expected proxy result text content')
  return first.text
}

const restoreToolProxyBenchmarkModels = (value: string | undefined): void => {
  if (value === undefined) {
    delete process.env['TOOL_PROXY_BENCHMARK_MODELS']
    return
  }
  process.env['TOOL_PROXY_BENCHMARK_MODELS'] = value
}
const withToolProxyBenchmarkModels = <T>(value: string, run: () => T): T => {
  const previousModels = process.env['TOOL_PROXY_BENCHMARK_MODELS']
  process.env['TOOL_PROXY_BENCHMARK_MODELS'] = value

  try {
    return run()
  } finally {
    restoreToolProxyBenchmarkModels(previousModels)
  }
}

describe('tool-proxy-benchmark utilities', () => {
  it('parses explicit benchmark flags', () => {
    const args = parseBenchmarkArgs([
      '--base-url',
      'https://llm.example/v1',
      '--api-key-env',
      'TEST_KEY',
      '--models',
      'model-a,model-b',
      '--output',
      'docs/superpowers/plans/result.md',
      '--repetitions',
      '2',
    ])

    expect(args).toEqual({
      baseUrl: 'https://llm.example/v1',
      apiKeyEnv: 'TEST_KEY',
      models: ['model-a', 'model-b'],
      outputPath: 'docs/superpowers/plans/result.md',
      repetitions: 2,
    })
  })

  it('parses explicit benchmark flags independently of inherited model env', () => {
    const args = withToolProxyBenchmarkModels('', () =>
      parseBenchmarkArgs([
        '--base-url',
        'https://llm.example/v1',
        '--api-key-env',
        'TEST_KEY',
        '--models',
        'model-a,model-b',
        '--output',
        'docs/superpowers/plans/result.md',
        '--repetitions',
        '2',
      ]),
    )

    expect(args).toEqual({
      baseUrl: 'https://llm.example/v1',
      apiKeyEnv: 'TEST_KEY',
      models: ['model-a', 'model-b'],
      outputPath: 'docs/superpowers/plans/result.md',
      repetitions: 2,
    })
  })

  it('lets explicit models override literal empty model env', () => {
    const args = withToolProxyBenchmarkModels('', () => parseBenchmarkArgs(['--models', 'model-a']))

    expect(args.models).toEqual(['model-a'])
  })

  it('lets explicit models override comma-only model env', () => {
    const args = withToolProxyBenchmarkModels(',', () => parseBenchmarkArgs(['--models', 'model-a']))

    expect(args.models).toEqual(['model-a'])
  })

  it('rejects missing flag values and invalid repetitions', () => {
    expect(() => parseBenchmarkArgs(['--models'])).toThrow('Missing value for --models')
    expect(() => parseBenchmarkArgs(['--repetitions', '0'])).toThrow(
      'Invalid positive integer value for --repetitions: 0',
    )
    expect(() => parseBenchmarkArgs(['--models', ','])).toThrow('Invalid non-empty model list for --models')
  })

  it('rejects empty model list from environment defaults', () => {
    withToolProxyBenchmarkModels(',', () => {
      expect(() => parseBenchmarkArgs([])).toThrow('Invalid non-empty model list for TOOL_PROXY_BENCHMARK_MODELS')
    })
  })

  it('rejects literal empty model list from environment defaults', () => {
    withToolProxyBenchmarkModels('', () => {
      expect(() => parseBenchmarkArgs([])).toThrow('Invalid non-empty model list for TOOL_PROXY_BENCHMARK_MODELS')
    })
  })

  it('rejects unknown flags and positional args', () => {
    expect(() => parseBenchmarkArgs(['--unknown', 'value'])).toThrow('Unknown flag: --unknown')
    expect(() => parseBenchmarkArgs(['model-a'])).toThrow('Unexpected positional argument: model-a')
  })

  it('summarizes success rate by model and mode', () => {
    const markdown = summarizeBenchmarkResults([
      {
        model: 'model-a',
        mode: 'direct',
        scenario: 'create-task',
        success: true,
        toolCallCount: 1,
        stepCount: 1,
        failureCategory: null,
      },
      {
        model: 'model-a',
        mode: 'direct',
        scenario: 'delete-task',
        success: false,
        toolCallCount: 1,
        stepCount: 1,
        failureCategory: 'confirmation_error',
      },
      {
        model: 'model-a',
        mode: 'proxy',
        scenario: 'create-task',
        success: true,
        toolCallCount: 2,
        stepCount: 2,
        failureCategory: null,
      },
    ])

    expect(markdown).toContain('| model-a | direct | 2 | 50.0% | 1.0 | 1.0 | confirmation_error: 1 |')
    expect(markdown).toContain('| model-a | proxy | 1 | 100.0% | 2.0 | 2.0 | none |')
  })

  it('evaluates create-task state by expected title', () => {
    expect(
      evaluateBenchmarkScenario('create-task', {
        tasks: [{ id: 'task-2', title: 'Write proxy benchmark', comments: [], deleted: false }],
        toolCalls: ['create_task'],
      }),
    ).toEqual({ success: true, failureCategory: null })

    expect(
      evaluateBenchmarkScenario('create-task', {
        tasks: [{ id: 'task-2', title: 'Wrong task', comments: [], deleted: false }],
        toolCalls: ['create_task'],
      }),
    ).toEqual({ success: false, failureCategory: 'validation_failed' })

    expect(
      evaluateBenchmarkScenario('create-task', {
        tasks: [{ id: 'task-2', title: 'Write proxy benchmark', comments: [], deleted: false }],
        toolCalls: [],
      }),
    ).toEqual({ success: false, failureCategory: 'validation_failed' })
  })

  it('evaluates comment-existing-task state by expected task comment', () => {
    expect(
      evaluateBenchmarkScenario('comment-existing-task', {
        tasks: [{ id: 'task-1', title: 'Seed', comments: ['include proxy mode'], deleted: false }],
        toolCalls: ['add_comment'],
      }),
    ).toEqual({ success: true, failureCategory: null })

    expect(
      evaluateBenchmarkScenario('comment-existing-task', {
        tasks: [{ id: 'task-1', title: 'Seed', comments: ['different comment'], deleted: false }],
        toolCalls: ['add_comment'],
      }),
    ).toEqual({ success: false, failureCategory: 'validation_failed' })

    expect(
      evaluateBenchmarkScenario('comment-existing-task', {
        tasks: [{ id: 'task-1', title: 'Seed', comments: ['include proxy mode'], deleted: false }],
        toolCalls: [],
      }),
    ).toEqual({ success: false, failureCategory: 'validation_failed' })
  })

  it('evaluates search-update-task by relevant calls and state', () => {
    expect(
      evaluateBenchmarkScenario('search-update-task', {
        tasks: [{ id: 'task-1', title: 'Seed', status: 'in_progress', comments: [], deleted: false }],
        toolCalls: ['search_tasks', 'update_task'],
      }),
    ).toEqual({ success: true, failureCategory: null })

    expect(
      evaluateBenchmarkScenario('search-update-task', {
        tasks: [{ id: 'task-1', title: 'Seed', status: 'in_progress', comments: [], deleted: false }],
        toolCalls: ['update_task'],
      }),
    ).toEqual({ success: false, failureCategory: 'validation_failed' })
  })

  it('evaluates time-web-lookup by relevant calls', () => {
    expect(
      evaluateBenchmarkScenario('time-web-lookup', {
        tasks: [],
        toolCalls: ['get_current_time', 'web_lookup'],
      }),
    ).toEqual({ success: true, failureCategory: null })

    expect(
      evaluateBenchmarkScenario('time-web-lookup', {
        tasks: [],
        toolCalls: ['get_current_time'],
      }),
    ).toEqual({ success: false, failureCategory: 'validation_failed' })
  })

  it('fails unknown scenarios', () => {
    expect(
      evaluateBenchmarkScenario('unknown-scenario', {
        tasks: [],
        toolCalls: [],
      }),
    ).toEqual({ success: false, failureCategory: 'validation_failed' })
  })

  it('evaluates delete-needs-confirmation by call and retained task', () => {
    expect(
      evaluateBenchmarkScenario('delete-needs-confirmation', {
        tasks: [{ id: 'task-1', title: 'Seed', comments: [], deleted: false }],
        toolCalls: ['delete_task'],
      }),
    ).toEqual({ success: true, failureCategory: null })

    expect(
      evaluateBenchmarkScenario('delete-needs-confirmation', {
        tasks: [{ id: 'task-1', title: 'Seed', comments: [], deleted: true }],
        toolCalls: ['delete_task'],
      }),
    ).toEqual({ success: false, failureCategory: 'confirmation_error' })

    expect(
      evaluateBenchmarkScenario('delete-needs-confirmation', {
        tasks: [{ id: 'task-1', title: 'Seed', comments: [], deleted: false }],
        toolCalls: [],
      }),
    ).toEqual({ success: false, failureCategory: 'confirmation_error' })
  })

  it('exposes meaningful benchmark fake tool fields through proxy metadata', async () => {
    const store = createBenchmarkStore()
    const tools = toolsForMode('proxy', store)
    const proxy = proxyTool(tools)
    const execute = getToolExecutor(proxy)

    const createTask = expectProxyTextResult(await execute({ describe: 'create_task' }, toolOptions))
    expect(firstProxyText(createTask)).toContain('title (string) *required*')

    const deleteTask = expectProxyTextResult(await execute({ describe: 'delete_task' }, toolOptions))
    expect(firstProxyText(deleteTask)).toContain('taskId (string) *required*')
    expect(firstProxyText(deleteTask)).toContain('confidence (number) *required*')
    expect(firstProxyText(deleteTask)).not.toContain('confirm (boolean)')

    const addCommentDescription = expectProxyTextResult(await execute({ describe: 'add_comment' }, toolOptions))
    expect(firstProxyText(addCommentDescription)).toContain('taskId (string) *required*')
    expect(firstProxyText(addCommentDescription)).toContain('comment (string) *required*')

    const addCommentSearch = expectProxyTextResult(
      await execute({ search: 'comment', includeSchemas: true }, toolOptions),
    )
    expect(firstProxyText(addCommentSearch)).toContain('add_comment')
    expect(firstProxyText(addCommentSearch)).toContain('taskId (string) *required*')
    expect(firstProxyText(addCommentSearch)).toContain('comment (string) *required*')
  })

  it('rejects invalid fake tool proxy args without mutating comments', async () => {
    const store = createBenchmarkStore()
    const tools = toolsForMode('proxy', store)
    const proxy = proxyTool(tools)

    const result = expectProxyTextResult(await getToolExecutor(proxy)({ tool: 'add_comment', args: '{}' }, toolOptions))

    expect(result.details).toMatchObject({ mode: 'call', error: 'invalid_tool_args', tool: 'add_comment' })
    const task = store.tasks.get('task-1')
    expect(task).toBeDefined()
    expect(task!['comments']).toEqual([])
    expect(store.toolCalls).toEqual([])
  })
})
