// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { z } from 'zod'

import {
  AgentRunError,
  agentWritePath,
  createLineHandler,
  runAgent,
  type ClaudeRunContext,
  type SpawnFn,
} from '../../review-loop/src/agent-runner.js'
import { ReviewerIssuesSchema } from '../../review-loop/src/issue-schema.js'
import type { ProgressReporter } from '../../review-loop/src/progress-log.js'
import { cleanupTempDirs, makeTempDir } from './test-helpers.js'

afterEach(cleanupTempDirs)

type MockSpawnResult = { exitCode: number; stdout: string; stderr: string; timedOut?: boolean; stalled?: boolean }

type RecordedSpawnCall = {
  command: string
  args: readonly string[]
  cwd: string
  inactivityTimeoutMs?: number
  stdin?: string
  env?: Record<string, string>
  onLine?: (line: string) => void
}

function createMockSpawn(results: MockSpawnResult[]): {
  calls: RecordedSpawnCall[]
  spawn: SpawnFn
} {
  const calls: RecordedSpawnCall[] = []
  let index = 0
  const spawn: SpawnFn = (
    command: string,
    args: readonly string[],
    opts: { cwd: string; inactivityTimeoutMs?: number; stdin?: string; env?: Record<string, string> },
    onLine?: (line: string) => void,
  ): Promise<MockSpawnResult> => {
    calls.push({
      command,
      args,
      cwd: opts.cwd,
      inactivityTimeoutMs: opts.inactivityTimeoutMs,
      stdin: opts.stdin,
      env: opts.env,
      onLine,
    })
    const result = results[index] ?? results[results.length - 1]!
    index += 1
    return Promise.resolve(result)
  }
  return { calls, spawn }
}

/** A spawn fake that drives `onLine` itself, then resolves a scripted result per call. */
function scriptedSpawn(
  scripts: ReadonlyArray<(onLine: (line: string) => void, opts: { cwd: string }) => MockSpawnResult>,
): {
  calls: RecordedSpawnCall[]
  spawn: SpawnFn
} {
  const calls: RecordedSpawnCall[] = []
  const spawn: SpawnFn = (command, args, opts, onLine): Promise<MockSpawnResult> => {
    calls.push({ command, args, cwd: opts.cwd, stdin: opts.stdin, env: opts.env, onLine })
    const script = scripts[Math.min(calls.length - 1, scripts.length - 1)]!
    return Promise.resolve(script(onLine ?? (() => {}), opts))
  }
  return { calls, spawn }
}

function claudeContext(dir: string, overrides: Partial<ClaudeRunContext> = {}): ClaudeRunContext {
  return {
    profile: 'bare',
    credentialName: 'ANTHROPIC_API_KEY',
    credentialValue: 'sk-ant-secret-0123456789',
    configDirRoot: path.join(dir, 'claude-root'),
    envSource: { PATH: '/usr/bin' },
    ...overrides,
  }
}

const CLAUDE_RESULT_LINE = JSON.stringify({
  type: 'result',
  is_error: false,
  stop_reason: 'end_turn',
  session_id: 'sess-1',
  total_cost_usd: 0.01,
  usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
})

/** The first recorded spawn call argv, empty when nothing was recorded. */
function firstArgs(mock: { calls: { args: readonly string[] }[] }): string[] {
  return [...(mock.calls[0]?.args ?? [])]
}

/** The first recorded spawn call env, empty when it carried none. */
function firstEnv(mock: { calls: { env?: Record<string, string> }[] }): Record<string, string> {
  return mock.calls[0]?.env ?? {}
}

/** The value following a flag in a composed argv; '' when the flag is absent. */
function argvOfTool(argv: readonly string[], flag: string): string {
  return argv[argv.indexOf(flag) + 1] ?? ''
}

/** The first call's CLAUDE_CONFIG_DIR, '' when absent. */
function configDirOf(mock: { calls: { env?: Record<string, string> }[] }): string {
  return firstEnv(mock)['CLAUDE_CONFIG_DIR'] ?? ''
}

function writeScratch(dir: string, outputPath: string, data: unknown): void {
  mkdirSync(path.join(dir, '.review-loop'), { recursive: true })
  writeFileSync(path.join(dir, '.review-loop', path.basename(outputPath)), JSON.stringify(data))
}

describe('agentWritePath', () => {
  test('returns an absolute path resolved against the provided cwd', () => {
    const result = agentWritePath('/repo/.review-loop/worktrees/123', '/repo/.review-loop/runs/123/matches.json')
    expect(path.isAbsolute(result)).toBe(true)
    expect(result).toBe(path.join('/repo/.review-loop/worktrees/123', '.review-loop', 'matches.json'))
  })

  test('produces different paths for different cwds (no implicit process.cwd resolution)', () => {
    const a = agentWritePath('/wt-a', '/x/runs/1/issues.json')
    const b = agentWritePath('/wt-b', '/x/runs/1/issues.json')
    expect(a).toBe(path.join('/wt-a', '.review-loop', 'issues.json'))
    expect(b).toBe(path.join('/wt-b', '.review-loop', 'issues.json'))
    expect(a).not.toBe(b)
  })
})

describe('agent-runner', () => {
  test('agentWritePath returns absolute path under <cwd>/.review-loop/<basename>', () => {
    // Regression: agentWritePath previously returned a relative `.review-loop/<basename>`,
    // which the agent sometimes resolved against the project root instead of the
    // worktree cwd. The worktree cwd itself lives at
    // <repoRoot>/.review-loop/worktrees/<runId>/, so a "project-root-relative"
    // interpretation landed at <repoRoot>/.review-loop/<basename> — and the
    // runner's copyFile failed with ENOENT.
    const cwd = '/tmp/worktree-x'
    const result = agentWritePath(cwd, '/run/dir/matches.json')
    expect(path.isAbsolute(result)).toBe(true)
    expect(result).toBe(path.resolve(cwd, '.review-loop', 'matches.json'))
  })

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

  test('retries once when the agent stalls (hung stream killed by inactivity watchdog)', async () => {
    // A stalled agent produced no stdout for the inactivity window — almost
    // always a transient provider hang, so unlike a wall-clock timeout it is
    // worth one retry instead of discarding the iteration.
    const dir = makeTempDir('agent-runner-')
    const outputPath = path.join(dir, 'issues.json')
    const mock = createMockSpawn([
      { exitCode: 1, stdout: '', stderr: 'Process stalled: no output for 600000ms\n', timedOut: true, stalled: true },
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
        writeFileSync(path.join(dir, '.review-loop', path.basename(outputPath)), JSON.stringify({ issues: [] }))
      },
    })

    expect(result.value).toEqual({ issues: [] })
    expect(mock.calls).toHaveLength(2)
  })

  test('throws after retry when the agent stalls again', async () => {
    const dir = makeTempDir('agent-runner-')
    const outputPath = path.join(dir, 'issues.json')
    const mock = createMockSpawn([
      { exitCode: 1, stdout: '', stderr: 'Process stalled: no output for 600000ms\n', timedOut: true, stalled: true },
      { exitCode: 1, stdout: '', stderr: 'Process stalled: no output for 600000ms\n', timedOut: true, stalled: true },
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
    ).rejects.toThrow('stalled')
    expect(mock.calls).toHaveLength(2)
  })

  test('forwards inactivityTimeoutMs to the spawn options', async () => {
    const dir = makeTempDir('agent-runner-')
    const outputPath = path.join(dir, 'issues.json')
    const mock = createMockSpawn([{ exitCode: 0, stdout: 'done', stderr: '' }])

    mkdirSync(path.join(dir, '.review-loop'), { recursive: true })
    writeFileSync(path.join(dir, '.review-loop', path.basename(outputPath)), JSON.stringify({ issues: [] }))

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
      inactivityTimeoutMs: 123_000,
    })

    expect(mock.calls[0]?.inactivityTimeoutMs).toBe(123_000)
  })

  test('child stderr is scrubbed once before it is embedded anywhere (claude route)', async () => {
    const secret = 'sk-ant-secret-0123456789'
    const dir = makeTempDir('agent-runner-scrub-')
    const outputPath = path.join(dir, 'issues.json')
    const logPath = path.join(dir, 'log.txt')
    const mock = createMockSpawn([
      { exitCode: 1, stdout: '', stderr: `env: ANTHROPIC_API_KEY=${secret}` },
      { exitCode: 1, stdout: '', stderr: `env: ANTHROPIC_API_KEY=${secret}` },
    ])

    const run = runAgent({
      spawn: mock.spawn,
      model: 'test-model',
      cwd: dir,
      prompt: 'review the code',
      outputPath,
      outputSchema: ReviewerIssuesSchema,
      label: 'reviewer',
      logPath,
      extraArgs: [],
      backend: 'claude',
      claude: {
        profile: 'bare',
        credentialName: 'ANTHROPIC_API_KEY',
        credentialValue: secret,
        configDirRoot: path.join(dir, 'claude-root'),
        envSource: {},
      },
      createClaudeSpawnDir: (context) =>
        Promise.resolve({
          configDir: path.join(context.configDirRoot, 'spawn-1'),
          mcpConfigPath: null,
        }),
    })
    // The AttemptError message flows from the one scrubbed copy...
    await expect(run).rejects.toBeInstanceOf(AgentRunError)
    await expect(run).rejects.toThrow(/\[redacted\]/u)
    await expect(run).rejects.not.toThrow(new RegExp(secret, 'u'))
    // ...and so does the enqueued stderr line.
    const logged = readFileSync(logPath, 'utf8')
    expect(logged).toContain('[redacted]')
    expect(logged).not.toContain(secret)
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

  test('error names a misplaced scratch file when agent writes outside the expected path', async () => {
    const tmpRoot = makeTempDir('agent-misplace-')
    const worktree = path.join(tmpRoot, 'worktree')
    mkdirSync(worktree, { recursive: true })
    mkdirSync(path.join(worktree, '.review-loop'), { recursive: true })
    const misplacedDir = path.join(tmpRoot, '.review-loop')
    mkdirSync(misplacedDir, { recursive: true })
    const misplacedPath = path.join(misplacedDir, 'issues.json')
    writeFileSync(misplacedPath, JSON.stringify({ issues: [] }))
    const outputPath = path.join(tmpRoot, 'runs', '123', 'issues.json')
    mkdirSync(path.dirname(outputPath), { recursive: true })

    const mock = createMockSpawn([
      { exitCode: 0, stdout: '', stderr: '' },
      { exitCode: 0, stdout: '', stderr: '' },
    ])

    await expect(
      runAgent({
        spawn: mock.spawn,
        model: 'test-model',
        cwd: worktree,
        prompt: 'review the code',
        outputPath,
        outputSchema: ReviewerIssuesSchema,
        label: 'reviewer',
        logPath: path.join(tmpRoot, 'log.txt'),
        extraArgs: [],
      }),
    ).rejects.toThrow(new RegExp(misplacedPath.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'))
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
    const reporter: ProgressReporter = {
      dynamic: false,
      event() {},
      live: (m) => {
        live.push([...m])
      },
      clearLive() {},
      log() {},
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
    expect(liveOutput).toContain('in 100 / out 5')
    expect(readFileSync(logPath, 'utf8')).toContain('step_start')
  })
})

function mockSpawnWithStepFinish(outputPath: string): SpawnFn {
  return (_cmd, _args, opts, onLine) => {
    // Emit a step_finish event line, then write the result file.
    const stepFinish = JSON.stringify({
      type: 'step_finish',
      part: {
        reason: 'stop',
        tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 700, write: 50 } },
        cost: 0.01,
      },
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

function asAgentRunError(value: unknown): AgentRunError {
  if (!(value instanceof AgentRunError)) {
    throw new Error(`expected AgentRunError, got ${value === null ? 'null' : typeof value}`)
  }
  return value
}

describe('runAgent backend integration', () => {
  test('both backend fields absent is the opencode default: argv byte-identical to today, no stdin, no env', async () => {
    const dir = makeTempDir('agent-bare-')
    const outputPath = path.join(dir, 'issues.json')
    const mock = createMockSpawn([{ exitCode: 0, stdout: 'done', stderr: '' }])
    writeScratch(dir, outputPath, { issues: [] })

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

    expect(mock.calls[0]?.command).toBe('opencode')
    expect(mock.calls[0]?.args).toEqual([
      'run',
      '--auto',
      '--format',
      'json',
      '--model',
      'test-model',
      '--dir',
      dir,
      'review the code',
    ])
    expect(mock.calls[0]?.stdin).toBeUndefined()
    expect(mock.calls[0]?.env).toBeUndefined()
  })

  test('the claude route spawns claude with the prompt on stdin and the composed env', async () => {
    const dir = makeTempDir('agent-claude-')
    const outputPath = path.join(dir, 'issues.json')
    const mock = scriptedSpawn([
      (onLine: (line: string) => void): MockSpawnResult => {
        onLine(CLAUDE_RESULT_LINE)
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    ])
    writeScratch(dir, outputPath, { issues: [] })

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
      backend: 'claude',
      claude: claudeContext(dir),
      createClaudeSpawnDir: (context) =>
        Promise.resolve({
          configDir: path.join(context.configDirRoot, 'spawn-1'),
          mcpConfigPath: null,
        }),
    })

    expect(mock.calls[0]?.command).toBe('claude')
    expect(mock.calls[0]?.stdin).toBe('review the code')
    expect(mock.calls[0]?.env?.['CLAUDE_CONFIG_DIR']).toBe(path.join(dir, 'claude-root', 'spawn-1'))
    expect(mock.calls[0]?.env?.['ANTHROPIC_API_KEY']).toBe('sk-ant-secret-0123456789')
  })

  test('backend claude without the claude context is refused with a named composition error', async () => {
    const dir = makeTempDir('agent-claude-missing-ctx-')
    await expect(
      runAgent({
        spawn: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
        model: 'm',
        cwd: dir,
        prompt: 'p',
        outputPath: path.join(dir, 'out.json'),
        outputSchema: ReviewerIssuesSchema,
        label: 'reviewer',
        logPath: path.join(dir, 'log.txt'),
        extraArgs: [],
        backend: 'claude',
      }),
    ).rejects.toThrow(/claude context/u)
  })

  test('the decoder is re-armed per attempt: a retry never reads the stalled attempt result line', async () => {
    const dir = makeTempDir('agent-rearm-')
    const outputPath = path.join(dir, 'issues.json')
    // Attempt 1: a *successful* result line arrives, then the spawn stalls
    // (soft failure → retried). Attempt 2: exit 0, valid output file, but no
    // result line of its own. A stale decoder would pass the gate as an empty
    // success; a re-armed one fails the attempt.
    const mock = scriptedSpawn([
      (onLine: (line: string) => void): MockSpawnResult => {
        onLine(CLAUDE_RESULT_LINE)
        return { exitCode: 1, stdout: '', stderr: 'Process stalled', timedOut: true, stalled: true }
      },
      (_onLine: (line: string) => void): MockSpawnResult => {
        writeScratch(dir, outputPath, { issues: [] })
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    ])

    await expect(
      runAgent({
        spawn: mock.spawn,
        model: 'm',
        cwd: dir,
        prompt: 'p',
        outputPath,
        outputSchema: ReviewerIssuesSchema,
        label: 'reviewer',
        logPath: path.join(dir, 'log.txt'),
        extraArgs: [],
        backend: 'claude',
        claude: claudeContext(dir),
        createClaudeSpawnDir: (context) =>
          Promise.resolve({
            configDir: path.join(context.configDirRoot, 'spawn-1'),
            mcpConfigPath: null,
          }),
      }),
    ).rejects.toThrow(/result/u)
    expect(mock.calls).toHaveLength(2)
  })

  test('an exit-0 turn with a missing result line never resolves as an empty success', async () => {
    const dir = makeTempDir('agent-no-result-')
    const outputPath = path.join(dir, 'issues.json')
    const mock = scriptedSpawn([
      (): MockSpawnResult => {
        writeScratch(dir, outputPath, { issues: [] })
        return { exitCode: 0, stdout: '', stderr: '' }
      },
      (): MockSpawnResult => {
        writeScratch(dir, outputPath, { issues: [] })
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    ])

    await expect(
      runAgent({
        spawn: mock.spawn,
        model: 'm',
        cwd: dir,
        prompt: 'p',
        outputPath,
        outputSchema: ReviewerIssuesSchema,
        label: 'reviewer',
        logPath: path.join(dir, 'log.txt'),
        extraArgs: [],
        backend: 'claude',
        claude: claudeContext(dir),
        createClaudeSpawnDir: (context) =>
          Promise.resolve({
            configDir: path.join(context.configDirRoot, 'spawn-1'),
            mcpConfigPath: null,
          }),
      }),
    ).rejects.toThrow(/result/u)
  })

  test('an exit-0 turn whose result line signals an error fails before the output is accepted', async () => {
    const dir = makeTempDir('agent-error-result-')
    const outputPath = path.join(dir, 'issues.json')
    const errorResult = JSON.stringify({
      type: 'result',
      is_error: true,
      stop_reason: 'stop_sequence',
      session_id: 'sess-1',
      total_cost_usd: 0,
      usage: { input_tokens: 0, output_tokens: 0 },
    })
    const mock = scriptedSpawn([
      (onLine: (line: string) => void): MockSpawnResult => {
        onLine(errorResult)
        writeScratch(dir, outputPath, { issues: [] })
        return { exitCode: 0, stdout: '', stderr: '' }
      },
      (onLine: (line: string) => void): MockSpawnResult => {
        onLine(errorResult)
        writeScratch(dir, outputPath, { issues: [] })
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    ])

    await expect(
      runAgent({
        spawn: mock.spawn,
        model: 'm',
        cwd: dir,
        prompt: 'p',
        outputPath,
        outputSchema: ReviewerIssuesSchema,
        label: 'reviewer',
        logPath: path.join(dir, 'log.txt'),
        extraArgs: [],
        backend: 'claude',
        claude: claudeContext(dir),
        createClaudeSpawnDir: (context) =>
          Promise.resolve({
            configDir: path.join(context.configDirRoot, 'spawn-1'),
            mcpConfigPath: null,
          }),
      }),
    ).rejects.toThrow(/result/u)
  })

  test('an exit-0 turn with a healthy result line accepts the output', async () => {
    const dir = makeTempDir('agent-good-result-')
    const outputPath = path.join(dir, 'issues.json')
    const mock = scriptedSpawn([
      (onLine: (line: string) => void): MockSpawnResult => {
        onLine(CLAUDE_RESULT_LINE)
        writeScratch(dir, outputPath, { issues: [] })
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    ])

    const result = await runAgent({
      spawn: mock.spawn,
      model: 'm',
      cwd: dir,
      prompt: 'p',
      outputPath,
      outputSchema: ReviewerIssuesSchema,
      label: 'reviewer',
      logPath: path.join(dir, 'log.txt'),
      extraArgs: [],
      backend: 'claude',
      claude: claudeContext(dir),
      createClaudeSpawnDir: (context) =>
        Promise.resolve({
          configDir: path.join(context.configDirRoot, 'spawn-1'),
          mcpConfigPath: null,
        }),
    })
    expect(result.value).toEqual({ issues: [] })
    expect(result.usage.inputTokens).toBe(10)
  })

  test('the claude route appends the worktree conventions via the system-prompt seam (12.3 remedy)', async () => {
    // The pinned CLI loads no memory files under either profile (recorded
    // census), so the reviewer prompt's "already in your context" premise is
    // false on this route — the conventions ride --append-system-prompt instead.
    const dir = makeTempDir('agent-conventions-')
    const outputPath = path.join(dir, 'issues.json')
    mkdirSync(path.join(dir, '.review-loop'), { recursive: true })
    writeFileSync(path.join(dir, 'AGENTS.md'), 'RULE: never add lint-disable comments.')
    const mock = scriptedSpawn([
      (onLine: (line: string) => void): MockSpawnResult => {
        onLine(CLAUDE_RESULT_LINE)
        writeScratch(dir, outputPath, { issues: [] })
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    ])

    await runAgent({
      spawn: mock.spawn,
      model: 'm',
      cwd: dir,
      prompt: 'p',
      outputPath,
      outputSchema: ReviewerIssuesSchema,
      label: 'reviewer',
      logPath: path.join(dir, 'log.txt'),
      extraArgs: [],
      backend: 'claude',
      claude: claudeContext(dir),
      createClaudeSpawnDir: (context) =>
        Promise.resolve({
          configDir: path.join(context.configDirRoot, 'spawn-1'),
          mcpConfigPath: null,
        }),
    })

    const argv = firstArgs(mock)
    const index = argv.indexOf('--append-system-prompt')
    expect(index).toBeGreaterThan(-1)
    expect(argv[index + 1]).toBe('RULE: never add lint-disable comments.')
    // The prompt itself still rides stdin, never argv.
    expect(mock.calls[0]?.stdin).toBe('p')
  })

  test('CLAUDE.md is the fallback when AGENTS.md is absent', async () => {
    const dir = makeTempDir('agent-conventions-claude-md-')
    const outputPath = path.join(dir, 'issues.json')
    mkdirSync(path.join(dir, '.review-loop'), { recursive: true })
    writeFileSync(path.join(dir, 'CLAUDE.md'), 'CLAUDE-MD-CONVENTIONS')
    const mock = scriptedSpawn([
      (onLine: (line: string) => void): MockSpawnResult => {
        onLine(CLAUDE_RESULT_LINE)
        writeScratch(dir, outputPath, { issues: [] })
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    ])

    await runAgent({
      spawn: mock.spawn,
      model: 'm',
      cwd: dir,
      prompt: 'p',
      outputPath,
      outputSchema: ReviewerIssuesSchema,
      label: 'reviewer',
      logPath: path.join(dir, 'log.txt'),
      extraArgs: [],
      backend: 'claude',
      claude: claudeContext(dir),
      createClaudeSpawnDir: (context) =>
        Promise.resolve({
          configDir: path.join(context.configDirRoot, 'spawn-1'),
          mcpConfigPath: null,
        }),
    })

    expect(firstArgs(mock)[firstArgs(mock).indexOf('--append-system-prompt') + 1]).toBe('CLAUDE-MD-CONVENTIONS')
  })

  test('no conventions file means no system-prompt argv entries', async () => {
    const dir = makeTempDir('agent-no-conventions-')
    const outputPath = path.join(dir, 'issues.json')
    mkdirSync(path.join(dir, '.review-loop'), { recursive: true })
    const mock = scriptedSpawn([
      (onLine: (line: string) => void): MockSpawnResult => {
        onLine(CLAUDE_RESULT_LINE)
        writeScratch(dir, outputPath, { issues: [] })
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    ])

    await runAgent({
      spawn: mock.spawn,
      model: 'm',
      cwd: dir,
      prompt: 'p',
      outputPath,
      outputSchema: ReviewerIssuesSchema,
      label: 'reviewer',
      logPath: path.join(dir, 'log.txt'),
      extraArgs: [],
      backend: 'claude',
      claude: claudeContext(dir),
      createClaudeSpawnDir: (context) =>
        Promise.resolve({
          configDir: path.join(context.configDirRoot, 'spawn-1'),
          mcpConfigPath: null,
        }),
    })

    expect(firstArgs(mock).includes('--append-system-prompt')).toBe(false)
  })

  test('the opencode route never reads or appends conventions', async () => {
    const dir = makeTempDir('agent-no-conventions-oc-')
    const outputPath = path.join(dir, 'issues.json')
    mkdirSync(path.join(dir, '.review-loop'), { recursive: true })
    writeFileSync(path.join(dir, 'AGENTS.md'), 'RULE: opencode loads me itself.')
    const mock = createMockSpawn([{ exitCode: 0, stdout: '', stderr: '' }])
    writeScratch(dir, outputPath, { issues: [] })

    await runAgent({
      spawn: mock.spawn,
      model: 'm',
      cwd: dir,
      prompt: 'p',
      outputPath,
      outputSchema: ReviewerIssuesSchema,
      label: 'reviewer',
      logPath: path.join(dir, 'log.txt'),
      extraArgs: [],
    })

    expect(firstArgs(mock).includes('--append-system-prompt')).toBe(false)
  })

  test('each spawn gets its own config-dir child under the run parent (injectable seam)', async () => {
    const dir = makeTempDir('agent-spawndir-')
    const outputPath = path.join(dir, 'issues.json')
    const createdRoots: string[] = []
    let counter = 0
    const mock = scriptedSpawn([
      (onLine: (line: string) => void): MockSpawnResult => {
        onLine(CLAUDE_RESULT_LINE)
        writeScratch(dir, outputPath, { issues: [] })
        return { exitCode: 0, stdout: '', stderr: '' }
      },
      (onLine: (line: string) => void): MockSpawnResult => {
        onLine(CLAUDE_RESULT_LINE)
        writeScratch(dir, outputPath, { issues: [] })
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    ])

    await runAgent({
      spawn: mock.spawn,
      model: 'm',
      cwd: dir,
      prompt: 'p',
      outputPath,
      outputSchema: ReviewerIssuesSchema,
      label: 'reviewer',
      logPath: path.join(dir, 'log.txt'),
      extraArgs: [],
      backend: 'claude',
      claude: claudeContext(dir),
      createClaudeSpawnDir: (context) => {
        createdRoots.push(context.configDirRoot)
        counter += 1
        return Promise.resolve({ configDir: path.join(context.configDirRoot, `child-${counter}`), mcpConfigPath: null })
      },
    })
    expect(createdRoots).toEqual([path.join(dir, 'claude-root')])

    // A stall retry creates a second child of the same parent.
    const mockRetry = scriptedSpawn([
      (onLine: (line: string) => void): MockSpawnResult => {
        onLine(CLAUDE_RESULT_LINE)
        return { exitCode: 1, stdout: '', stderr: 'stalled', timedOut: true, stalled: true }
      },
      (onLine: (line: string) => void): MockSpawnResult => {
        onLine(CLAUDE_RESULT_LINE)
        writeScratch(dir, outputPath, { issues: [] })
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    ])
    const seenDirs: string[] = []
    await runAgent({
      spawn: mockRetry.spawn,
      model: 'm',
      cwd: dir,
      prompt: 'p',
      outputPath,
      outputSchema: ReviewerIssuesSchema,
      label: 'reviewer',
      logPath: path.join(dir, 'log.txt'),
      extraArgs: [],
      backend: 'claude',
      claude: claudeContext(dir),
      createClaudeSpawnDir: (context) => {
        counter += 1
        const child = path.join(context.configDirRoot, `child-${counter}`)
        seenDirs.push(child)
        return Promise.resolve({ configDir: child, mcpConfigPath: null })
      },
    })
    expect(seenDirs).toHaveLength(2)
    expect(seenDirs[0]).not.toBe(seenDirs[1])
  })

  test('the default seam creates a real mkdtemp child, stamped as CLAUDE_CONFIG_DIR, with the empty-MCP doc on native', async () => {
    const dir = makeTempDir('agent-default-spawndir-')
    const outputPath = path.join(dir, 'issues.json')
    const mock = scriptedSpawn([
      (onLine: (line: string) => void): MockSpawnResult => {
        onLine(CLAUDE_RESULT_LINE)
        writeScratch(dir, outputPath, { issues: [] })
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    ])
    const root = makeTempDir('agent-claude-root-')

    await runAgent({
      spawn: mock.spawn,
      model: 'm',
      cwd: dir,
      prompt: 'p',
      outputPath,
      outputSchema: ReviewerIssuesSchema,
      label: 'reviewer',
      logPath: path.join(dir, 'log.txt'),
      extraArgs: [],
      backend: 'claude',
      claude: claudeContext(dir, {
        profile: 'native',
        credentialName: 'CLAUDE_CODE_OAUTH_TOKEN',
        credentialValue: 'oauth-token-0123456789',
        configDirRoot: root,
      }),
    })

    const configDir = configDirOf(mock)
    expect(configDir.startsWith(root)).toBe(true)
    expect(existsSync(configDir)).toBe(true)
    const argv = firstArgs(mock)
    const mcpPath = argvOfTool(argv, '--mcp-config')
    expect(mcpPath).toBe(path.join(configDir, 'empty-mcp.json'))
    expect(existsSync(mcpPath)).toBe(true)
    expect(readFileSync(mcpPath, 'utf8')).toBe(`${JSON.stringify({ mcpServers: {} })}\n`)
    // The bare profile creates the child but no document.
    const mockBare = scriptedSpawn([
      (onLine: (line: string) => void): MockSpawnResult => {
        onLine(CLAUDE_RESULT_LINE)
        writeScratch(dir, outputPath, { issues: [] })
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    ])
    const bareRoot = makeTempDir('agent-claude-bare-root-')
    await runAgent({
      spawn: mockBare.spawn,
      model: 'm',
      cwd: dir,
      prompt: 'p',
      outputPath,
      outputSchema: ReviewerIssuesSchema,
      label: 'reviewer',
      logPath: path.join(dir, 'log.txt'),
      extraArgs: [],
      backend: 'claude',
      claude: claudeContext(dir, { configDirRoot: bareRoot }),
    })
    const bareDir = configDirOf(mockBare)
    expect(bareDir.startsWith(bareRoot)).toBe(true)
    expect(existsSync(bareDir)).toBe(true)
    expect(existsSync(path.join(bareDir, 'empty-mcp.json'))).toBe(false)
  })
})

describe('runAgent stall-retry continuation (escalation-retry-session-continuation D4)', () => {
  const OPENCODE_SESSION_LINE = JSON.stringify({ sessionID: 'ses-1' })
  const STALL = {
    exitCode: 1,
    stdout: '',
    stderr: 'Process stalled: no output for 600000ms',
    timedOut: true,
    stalled: true,
  }

  test('a stall retry re-spawns continuing the captured session id (--session on opencode)', async () => {
    const dir = makeTempDir('agent-stall-continue-')
    const outputPath = path.join(dir, 'issues.json')
    const mock = scriptedSpawn([
      (onLine: (line: string) => void): MockSpawnResult => {
        onLine(OPENCODE_SESSION_LINE)
        return { ...STALL }
      },
      (): MockSpawnResult => {
        writeScratch(dir, outputPath, { issues: [] })
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    ])

    const result = await runAgent({
      spawn: mock.spawn,
      model: 'm',
      cwd: dir,
      prompt: 'p',
      outputPath,
      outputSchema: ReviewerIssuesSchema,
      label: 'reviewer',
      logPath: path.join(dir, 'log.txt'),
      extraArgs: [],
    })

    expect(result.value).toEqual({ issues: [] })
    expect(mock.calls).toHaveLength(2)
    expect(mock.calls[0]!.args.includes('--session')).toBe(false)
    const sessionIndex = mock.calls[1]!.args.indexOf('--session')
    expect(sessionIndex).toBeGreaterThan(-1)
    expect(mock.calls[1]!.args[sessionIndex + 1]).toBe('ses-1')
  })

  test('with no captured id the retry argv is byte-identical to the first attempt', async () => {
    const dir = makeTempDir('agent-stall-fresh-')
    const outputPath = path.join(dir, 'issues.json')
    const mock = scriptedSpawn([
      (): MockSpawnResult => ({ ...STALL }),
      (): MockSpawnResult => {
        writeScratch(dir, outputPath, { issues: [] })
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    ])

    const result = await runAgent({
      spawn: mock.spawn,
      model: 'm',
      cwd: dir,
      prompt: 'p',
      outputPath,
      outputSchema: ReviewerIssuesSchema,
      label: 'reviewer',
      logPath: path.join(dir, 'log.txt'),
      extraArgs: [],
    })

    expect(result.value).toEqual({ issues: [] })
    expect(mock.calls[1]!.args).toEqual(mock.calls[0]!.args)
  })

  test('the claude route maps the captured id to --resume', async () => {
    const dir = makeTempDir('agent-stall-resume-')
    const outputPath = path.join(dir, 'issues.json')
    const mock = scriptedSpawn([
      (onLine: (line: string) => void): MockSpawnResult => {
        onLine(CLAUDE_RESULT_LINE)
        return { ...STALL }
      },
      (onLine: (line: string) => void): MockSpawnResult => {
        onLine(CLAUDE_RESULT_LINE)
        writeScratch(dir, outputPath, { issues: [] })
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    ])

    const result = await runAgent({
      spawn: mock.spawn,
      model: 'm',
      cwd: dir,
      prompt: 'p',
      outputPath,
      outputSchema: ReviewerIssuesSchema,
      label: 'reviewer',
      logPath: path.join(dir, 'log.txt'),
      extraArgs: [],
      backend: 'claude',
      claude: claudeContext(dir),
      createClaudeSpawnDir: (context) =>
        Promise.resolve({
          configDir: path.join(context.configDirRoot, 'spawn-1'),
          mcpConfigPath: null,
        }),
    })

    expect(result.value).toEqual({ issues: [] })
    expect(mock.calls[0]!.args.includes('--resume')).toBe(false)
    const resumeIndex = mock.calls[1]!.args.indexOf('--resume')
    expect(resumeIndex).toBeGreaterThan(-1)
    expect(mock.calls[1]!.args[resumeIndex + 1]).toBe('sess-1')
  })
})

describe('createLineHandler log draining', () => {
  test('dispose resolves only after every queued log write has hit disk', async () => {
    // Regression: onLine used to fire `void appendFile(...)` and forget it. The floating write
    // could still be queued when the suite's afterEach cleanup removed the temp dir, rejecting
    // with ENOENT and failing an unrelated test (CI flake: "concurrent runAgent calls ... do not
    // race" / "timeout throw carries accumulated usage"). dispose must drain the queue so no
    // write outlives runAgent's finally.
    const cwd = makeTempDir('agent-log-drain-')
    const logPath = path.join(cwd, 'agent.log')
    const handler = createLineHandler({
      spawn: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
      model: 'm',
      cwd,
      prompt: 'p',
      outputPath: path.join(cwd, 'result.json'),
      outputSchema: z.object({ ok: z.boolean() }),
      label: 'drain',
      logPath,
      extraArgs: [],
    })
    handler.onLine('first')
    handler.onLine('second')
    await handler.dispose()
    expect(readFileSync(logPath, 'utf8')).toBe('first\nsecond\n')
  })
})

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
    expect(result.usage.cachedReadTokens).toBe(1400)
    expect(result.usage.cachedWriteTokens).toBe(100)
    expect(result.usage.costUsd).toBeCloseTo(0.02)
    expect(result.usage.wallMs).toBeGreaterThanOrEqual(0)
  })

  test('concurrent runAgent calls with distinct output paths do not race', async () => {
    // Regression: when output paths are per-worker (e.g. <runDir>/workers/w1/result.json),
    // concurrent runAgent calls must each read their own scratch file, not each other's.
    // The pre-fix bug: shared outputPath meant worker A could copyFile→readFile while worker B
    // interleaved a copyFile, causing A to parse B's result.
    const root = makeTempDir('agent-race-')
    const schema = z.object({ marker: z.string() })

    function spawnFor(marker: string): SpawnFn {
      return (_cmd, _args, opts, _onLine) =>
        new Promise((resolve) => {
          // Write the agent's scratch file in the worker's cwd. The path is
          // `.review-loop/result.json` (the agentWritePath basename), NOT the
          // outputPath — the agent never sees the destination directly.
          const scratch = path.join(opts.cwd, '.review-loop', 'result.json')
          mkdirSync(path.dirname(scratch), { recursive: true })
          writeFileSync(scratch, JSON.stringify({ marker }))
          // Small jitter to maximize the chance of overlapping copyFile windows.
          setTimeout(() => resolve({ exitCode: 0, stdout: '', stderr: '' }), 5)
        })
    }

    const workerRoots = ['w1', 'w2', 'w3'].map((id) => {
      const dir = path.join(root, id)
      mkdirSync(dir, { recursive: true })
      return { id, dir, marker: id.toUpperCase() }
    })

    const results = await Promise.all(
      workerRoots.map(({ id, dir, marker }) =>
        runAgent({
          spawn: spawnFor(marker),
          model: 'm',
          cwd: dir,
          prompt: 'p',
          // Per-worker destination under the run dir, mirroring workerOutputPath().
          outputPath: path.join(root, 'workers', `w${id}`, 'result.json'),
          outputSchema: schema,
          label: `fixer-w${id}`,
          logPath: path.join(dir, 'agent.log'),
          extraArgs: [],
        }),
      ),
    )

    expect(results[0]!.value.marker).toBe('W1')
    expect(results[1]!.value.marker).toBe('W2')
    expect(results[2]!.value.marker).toBe('W3')
  })

  test('retry-exhausted throw carries accumulated usage on an AgentRunError', async () => {
    const cwd = makeTempDir('agent-throw-usage-')
    const outputPath = path.join(cwd, 'result.json')
    const stepFinish = JSON.stringify({
      type: 'step_finish',
      part: {
        reason: 'stop',
        tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 700, write: 50 } },
        cost: 0.01,
      },
    })
    function spawnFailing(
      _cmd: string,
      _args: readonly string[],
      opts: { cwd: string },
      onLine?: (line: string) => void,
    ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
      mkdirSync(path.join(opts.cwd, '.review-loop'), { recursive: true })
      onLine?.(stepFinish)
      onLine?.(stepFinish)
      return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
    }

    let thrown: unknown
    try {
      await runAgent({
        spawn: spawnFailing,
        model: 'm',
        cwd,
        prompt: 'p',
        outputPath,
        outputSchema: z.object({ ok: z.boolean() }),
        label: 'failing',
        logPath: path.join(cwd, 'agent.log'),
        extraArgs: [],
      })
      throw new Error('expected runAgent to throw')
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(AgentRunError)
    const error = asAgentRunError(thrown)
    expect(error.usage.inputTokens).toBe(400)
    expect(error.usage.outputTokens).toBe(200)
    expect(error.usage.reasoningTokens).toBe(40)
    expect(error.usage.cachedReadTokens).toBe(2800)
    expect(error.usage.cachedWriteTokens).toBe(200)
    expect(error.usage.costUsd).toBeCloseTo(0.04)
  })

  test('timeout throw carries accumulated usage on an AgentRunError', async () => {
    const cwd = makeTempDir('agent-timeout-usage-')
    const outputPath = path.join(cwd, 'result.json')
    const stepFinish = JSON.stringify({
      type: 'step_finish',
      part: { reason: 'stop', tokens: { input: 70, output: 30, reasoning: 5 }, cost: 0.005 },
    })
    function spawnTimeout(
      _cmd: string,
      _args: readonly string[],
      _opts: { cwd: string },
      onLine?: (line: string) => void,
    ): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut?: boolean }> {
      onLine?.(stepFinish)
      return Promise.resolve({ exitCode: 1, stdout: '', stderr: 'Process timed out', timedOut: true })
    }

    let thrown: unknown
    try {
      await runAgent({
        spawn: spawnTimeout,
        model: 'm',
        cwd,
        prompt: 'p',
        outputPath,
        outputSchema: z.object({ ok: z.boolean() }),
        label: 'timing-out',
        logPath: path.join(cwd, 'agent.log'),
        extraArgs: [],
      })
      throw new Error('expected runAgent to throw')
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(AgentRunError)
    const error = asAgentRunError(thrown)
    expect(error.message).toContain('timed out')
    expect(error.usage.inputTokens).toBe(70)
    expect(error.usage.outputTokens).toBe(30)
    expect(error.usage.costUsd).toBeCloseTo(0.005)
  })
})
