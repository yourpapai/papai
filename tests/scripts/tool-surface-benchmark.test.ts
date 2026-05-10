import { describe, expect, it } from 'bun:test'

import {
  jsonOutputPathFor,
  parseBenchmarkArgs,
  summarizeBenchmarkResults,
} from '../../scripts/tool-surface-benchmark.js'

describe('tool-surface benchmark runner', () => {
  it('parses explicit benchmark flags', () => {
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

  it('derives a json output path from the markdown output path', () => {
    expect(jsonOutputPathFor('docs/superpowers/plans/tool-surface-benchmark-results.md')).toBe(
      'docs/superpowers/plans/tool-surface-benchmark-results.json',
    )
  })

  it('renders both summary and scenario detail tables', () => {
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
      },
      {
        model: 'model-a',
        mode: 'proxy',
        scenario: 'create_basic_task',
        success: false,
        failureCategory: 'validation_failed',
        toolCallCount: 2,
        stepCount: 2,
        fullToolCount: 11,
        exposedToolCount: 1,
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
      },
    ])

    expect(markdown).toContain('## Summary')
    expect(markdown).toContain('| model-a | direct_full | 1 | 100.0% | 1.0 | 1.0 | none |')
    expect(markdown).toContain('| model-a | proxy | 1 | 0.0% | 2.0 | 2.0 | validation_failed: 1 |')
    expect(markdown).toContain('## Scenario Detail')
    expect(markdown).toContain('| model-a | direct_routed | deferred_prompt_creation | 1 | 100.0% | 1.0 | 1.0 | none |')
  })
})
