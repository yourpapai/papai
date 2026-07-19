// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { z } from 'zod'

import { runAgent, type SpawnFn } from '../../review-loop/src/agent-runner.js'
import { ReviewerIssuesSchema } from '../../review-loop/src/issue-schema.js'
import type { ProgressReporter } from '../../review-loop/src/progress-log.js'
import { cleanupTempDirs, makeTempDir } from './test-helpers.js'

afterEach(cleanupTempDirs)

type MockSpawnResult = { exitCode: number; stdout: string; stderr: string; timedOut?: boolean }

function createMockSpawn(results: MockSpawnResult[]): {
  calls: Array<{ command: string; args: readonly string[]; cwd: string }>
  spawn: (command: string, args: readonly string[], opts: { cwd: string }) => Promise<MockSpawnResult>
} {
  const calls: Array<{ command: string; args: readonly string[]; cwd: string }> = []
  let index = 0
  return {
    calls,
    spawn: (command: string, args: readonly string[], opts: { cwd: string }): Promise<MockSpawnResult> => {
      calls.push({ command, args, cwd: opts.cwd })
      const result = results[index] ?? results[results.length - 1]!
      index += 1
      return Promise.resolve(result)
    },
  }
}

describe('agent-runner', () => {
  test('runs opencode and reads validated output file', async () => {
    const dir = makeTempDir('agent-runner-')
    const outputPath = path.join(dir, 'issues.json')
    const issuesData = { issues: [] }
    const mock = createMockSpawn([{ exitCode: 0, stdout: 'done', stderr: '' }])

    mkdirSync(path.join(dir, '.review-loop'), { recursive: true })
    writeFileSync(path.join(dir, '.review-loop', path.basename(outputPath)), JSON.stringify(issuesData))

    const result = await runAgent({
      spawn: mock.spawn,
      model: 'test-model',
      cwd: dir,
      prompt: 'review the code',
      outputPath,
      outputSchema: ReviewerIssuesSchema,
      label: 'reviewer',
      logPath: path.join(dir, 'log.txt'),
      extraArgs: [],
    })

    expect(result.value).toEqual({ issues: [] })
    expect(mock.calls[0]?.command).toBe('opencode')
    expect(mock.calls[0]?.args).toContain('run')
    expect(mock.calls[0]?.args).toContain('--auto')
    expect(mock.calls[0]?.args).toContain('--model')
    expect(mock.calls[0]?.args).toContain('test-model')
    expect(mock.calls[0]?.args).toContain('--dir')
    expect(mock.calls[0]?.args).toContain(dir)
  })

  test('removes scratch output from worktree after copying to outputPath', async () => {
    const dir = makeTempDir('agent-runner-')
    const outputPath = path.join(dir, 'out', 'issues.json')
    mkdirSync(path.join(dir, 'out'), { recursive: true })
    const mock = createMockSpawn([{ exitCode: 0, stdout: 'done', stderr: '' }])

    mkdirSync(path.join(dir, '.review-loop'), { recursive: true })
    const scratchPath = path.join(dir, '.review-loop', 'issues.json')
    writeFileSync(scratchPath, JSON.stringify({ issues: [] }))

    await runAgent({
      spawn: mock.spawn,
      model: 'test-model',
      cwd: dir,
      prompt: 'review the code',
      outputPath,
      outputSchema: ReviewerIssuesSchema,
      label: 'reviewer',
      logPath: path.join(dir, 'log.txt'),
      extraArgs: [],
    })

    expect(existsSync(scratchPath)).toBe(false)
    expect(existsSync(outputPath)).toBe(true)
  })

  test('retries once when output file is missing', async () => {
    const dir = makeTempDir('agent-runner-')
    const outputPath = path.join(dir, 'issues.json')
    const issuesData = { issues: [] }
    const mock = createMockSpawn([
      { exitCode: 0, stdout: 'done', stderr: '' },
      { exitCode: 0, stdout: 'done', stderr: '' },
    ])

    const result = await runAgent({
      spawn: mock.spawn,
      model: 'test-model',
      cwd: dir,
      prompt: 'review the code',
      outputPath,
      outputSchema: ReviewerIssuesSchema,
      label: 'reviewer',
      logPath: path.join(dir, 'log.txt'),
      extraArgs: [],
      onRetry: () => {
        writeFileSync(path.join(dir, '.review-loop', path.basename(outputPath)), JSON.stringify(issuesData))
      },
    })

    expect(result.value).toEqual({ issues: [] })
    expect(mock.calls).toHaveLength(2)
  })

  test('retries once when output file has invalid JSON', async () => {
    const dir = makeTempDir('agent-runner-')
    const outputPath = path.join(dir, 'result.json')
    const validData = { verdict: 'valid', fixability: 'auto', reasoning: 'ok', targetFiles: [], fixed: true }
    const mock = createMockSpawn([
      { exitCode: 0, stdout: 'done', stderr: '' },
      { exitCode: 0, stdout: 'done', stderr: '' },
    ])

    mkdirSync(path.join(dir, '.review-loop'), { recursive: true })
    writeFileSync(path.join(dir, '.review-loop', path.basename(outputPath)), '{ not valid json')

    const { FixerResultSchema } = await import('../../review-loop/src/issue-schema.js')
    const result = await runAgent({
      spawn: mock.spawn,
      model: 'test-model',
      cwd: dir,
      prompt: 'fix the issue',
      outputPath,
      outputSchema: FixerResultSchema,
      label: 'fixer',
      logPath: path.join(dir, 'log.txt'),
      extraArgs: [],
      onRetry: () => {
        writeFileSync(path.join(dir, '.review-loop', path.basename(outputPath)), JSON.stringify(validData))
      },
    })

    expect(result.value.fixed).toBe(true)
    expect(mock.calls).toHaveLength(2)
  })

  test('throws after retry if output still invalid', async () => {
    const dir = makeTempDir('agent-runner-')
    const outputPath = path.join(dir, 'issues.json')
    const mock = createMockSpawn([
      { exitCode: 0, stdout: 'done', stderr: '' },
      { exitCode: 0, stdout: 'done', stderr: '' },
    ])

    await expect(
      runAgent({
        spawn: mock.spawn,
        model: 'test-model',
        cwd: dir,
        prompt: 'review the code',
        outputPath,
        outputSchema: ReviewerIssuesSchema,
        label: 'reviewer',
        logPath: path.join(dir, 'log.txt'),
        extraArgs: [],
      }),
    ).rejects.toThrow()
  })

  test('does not retry when the agent times out', async () => {
    const dir = makeTempDir('agent-runner-')
    const outputPath = path.join(dir, 'issues.json')
    const mock = createMockSpawn([
      { exitCode: 1, stdout: '', stderr: 'Process timed out after 600000ms\n', timedOut: true },
      { exitCode: 0, stdout: 'done', stderr: '' },
    ])

    await expect(
      runAgent({
        spawn: mock.spawn,
        model: 'test-model',
        cwd: dir,
        prompt: 'review the code',
        outputPath,
        outputSchema: ReviewerIssuesSchema,
        label: 'reviewer',
        logPath: path.join(dir, 'log.txt'),
        extraArgs: [],
      }),
    ).rejects.toThrow('timed out')
    expect(mock.calls).toHaveLength(1)
  })

  test('retries once on non-timeout spawn failure', async () => {
    const dir = makeTempDir('agent-runner-')
    const outputPath = path.join(dir, 'issues.json')
    const mock = createMockSpawn([
      { exitCode: 1, stdout: '', stderr: 'opencode crashed' },
      { exitCode: 1, stdout: '', stderr: 'opencode crashed' },
    ])

    await expect(
      runAgent({
        spawn: mock.spawn,
        model: 'test-model',
        cwd: dir,
        prompt: 'review the code',
        outputPath,
        outputSchema: ReviewerIssuesSchema,
        label: 'reviewer',
        logPath: path.join(dir, 'log.txt'),
        extraArgs: [],
      }),
    ).rejects.toThrow('opencode crashed')
    expect(mock.calls).toHaveLength(2)
  })

  test('streams live progress from agent events', async () => {
    const dir = makeTempDir('agent-stream-')
    const outputPath = path.join(dir, 'issues.json')
    const logPath = path.join(dir, 'log.txt')
    const lines = [
      JSON.stringify({ type: 'step_start', timestamp: Date.now(), part: { type: 'step-start' } }),
      JSON.stringify({
        type: 'tool_use',
        part: {
          type: 'tool',
          tool: 'read',
          callID: 'call_1',
          state: { status: 'completed', input: { filePath: '/x/cli.ts' } },
        },
      }),
      JSON.stringify({
        type: 'step_finish',
        part: { type: 'step-finish', reason: 'stop', tokens: { input: 100, output: 5, reasoning: 0 }, cost: 0 },
      }),
    ]
    const live: string[][] = []
    const events: string[] = []
    const reporter: ProgressReporter = {
      dynamic: false,
      event: (m) => {
        events.push(m)
      },
      live: (m) => {
        live.push([...m])
      },
      clearLive() {},
      log: (m) => {
        events.push(m)
      },
    }
    const spawn = (
      _command: string,
      _args: readonly string[],
      opts: { cwd: string },
      onLine?: (line: string) => void,
    ): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
      for (const line of lines) {
        onLine?.(line)
      }
      writeFileSync(path.join(opts.cwd, '.review-loop', path.basename(outputPath)), JSON.stringify({ issues: [] }))
      return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
    }

    await runAgent({
      spawn,
      model: 'test-model',
      cwd: dir,
      prompt: 'review the code',
      outputPath,
      outputSchema: ReviewerIssuesSchema,
      label: 'reviewer',
      logPath,
      extraArgs: [],
      reporter,
    })

    const liveOutput = live.map((batch) => batch.join('\n')).join('\n')
    expect(liveOutput).toContain('reviewer')
    expect(liveOutput).toContain('read')
    expect(events.some((e) => e.includes('in 100 / out 5'))).toBe(true)
    expect(readFileSync(logPath, 'utf8')).toContain('step_start')
  })
})

function mockSpawnWithStepFinish(outputPath: string): SpawnFn {
  return (_cmd, _args, opts, onLine) => {
    // Emit a step_finish event line, then write the result file.
    const stepFinish = JSON.stringify({
      type: 'step_finish',
      part: { reason: 'stop', tokens: { input: 100, output: 50, reasoning: 10 }, cost: 0.01 },
    })
    // Two step_finish events to test accumulation:
    return new Promise((resolve) => {
      setTimeout(() => {
        writeFileSync(path.join(opts.cwd, outputPath), JSON.stringify({ ok: true }))
        onLine?.(stepFinish)
        onLine?.(stepFinish)
        resolve({ exitCode: 0, stdout: `${stepFinish}\n${stepFinish}\n`, stderr: '' })
      }, 10)
    })
  }
}

describe('runAgent return type', () => {
  test('returns AgentRunResult with value and usage', async () => {
    const cwd = makeTempDir('agent-result-')
    const outputPath = path.join(cwd, 'result.json')
    const result = await runAgent({
      spawn: mockSpawnWithStepFinish('.review-loop/result.json'),
      model: 'm',
      cwd,
      prompt: 'p',
      outputPath,
      outputSchema: z.object({ ok: z.boolean() }),
      label: 'test',
      logPath: path.join(cwd, 'agent.log'),
      extraArgs: [],
    })
    expect(result.value.ok).toBe(true)
    expect(result.usage.inputTokens).toBe(200)
    expect(result.usage.outputTokens).toBe(100)
    expect(result.usage.costUsd).toBeCloseTo(0.02)
    expect(result.usage.wallMs).toBeGreaterThanOrEqual(0)
  })
})
