// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { z } from 'zod'

import type { RunAgentOptions, SpawnResult } from '../../review-loop/src/agent-runner.js'
import { MIN_SECRET_LENGTH } from '../../review-loop/src/backend-select.js'
import { createClaudeStreamDecoder } from '../../review-loop/src/claude-stream.js'
import { createLineHandler, enqueueLog } from '../../review-loop/src/line-handler.js'
import type { ProgressReporter, UsageDelta } from '../../review-loop/src/progress-log.js'
import { RunStats } from '../../review-loop/src/run-stats.js'
import { cleanupTempDirs, makeTempDir } from './test-helpers.js'

afterEach(cleanupTempDirs)

const makeOptions = (cwd: string, logPath: string): RunAgentOptions<{ ok: boolean }> => ({
  spawn: (): Promise<SpawnResult> => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
  model: 'm',
  cwd,
  prompt: 'p',
  outputPath: path.join(cwd, 'result.json'),
  outputSchema: z.object({ ok: z.boolean() }),
  label: 'drain',
  logPath,
  extraArgs: [],
})

describe('createLineHandler log draining', () => {
  test('dispose resolves only after every queued log write has hit disk', async () => {
    const cwd = makeTempDir('line-handler-drain-')
    const logPath = path.join(cwd, 'agent.log')
    const handler = createLineHandler(makeOptions(cwd, logPath))
    handler.onLine('first')
    handler.onLine('second')
    await handler.dispose()
    expect(readFileSync(logPath, 'utf8')).toBe('first\nsecond\n')
  })

  test('enqueueLog never rejects when the destination disappears (best-effort logging)', async () => {
    const cwd = makeTempDir('line-handler-best-effort-')
    const logPath = path.join(cwd, 'missing-dir', 'agent.log')
    const handler = createLineHandler(makeOptions(cwd, logPath))
    enqueueLog(handler.ctx, 'dropped\n')
    await handler.dispose()
  })
})

describe('createLineHandler reporter wiring', () => {
  function makeReporter(overrides: Partial<ProgressReporter>): ProgressReporter {
    return {
      dynamic: false,
      event: () => {},
      live: () => {},
      clearLive: () => {},
      log: () => {},
      ...overrides,
    }
  }

  function matchesDrainRead(entry: readonly [string, string | null]): boolean {
    const [key, line] = entry
    return key === 'drain' && line !== null && line.includes('read')
  }

  test('step_finish forwards usage to the reporter', () => {
    const cwd = makeTempDir('line-handler-usage-')
    const deltas: UsageDelta[] = []
    const reporter = makeReporter({
      usage: (d) => {
        deltas.push(d)
      },
    })
    const handler = createLineHandler({ ...makeOptions(cwd, path.join(cwd, 'agent.log')), reporter })
    handler.onLine(
      JSON.stringify({
        type: 'step_finish',
        part: { reason: 'stop', tokens: { input: 5, output: 2, reasoning: 1 }, cost: 0.5 },
      }),
    )
    expect(deltas).toEqual([
      { input: 5, output: 2, reasoning: 1, cacheRead: 0, cacheWrite: 0, cost: 0.5, label: 'drain', model: 'm' },
    ])
  })

  test('step_finish forwards cached tokens to the reporter as separate delta fields', () => {
    const cwd = makeTempDir('line-handler-cache-usage-')
    const deltas: UsageDelta[] = []
    const reporter = makeReporter({
      usage: (d) => {
        deltas.push(d)
      },
    })
    const handler = createLineHandler({ ...makeOptions(cwd, path.join(cwd, 'agent.log')), reporter })
    handler.onLine(
      JSON.stringify({
        type: 'step_finish',
        part: {
          reason: 'stop',
          tokens: { input: 1757, output: 3, reasoning: 0, cache: { read: 8320, write: 4096 } },
          cost: 0,
        },
      }),
    )
    expect(deltas).toEqual([
      { input: 1757, output: 3, reasoning: 0, cacheRead: 8320, cacheWrite: 4096, cost: 0, label: 'drain', model: 'm' },
    ])
  })

  test('step_finish accumulates cached token counters separately from input on ctx.usage', () => {
    const cwd = makeTempDir('line-handler-cache-accum-')
    const handler = createLineHandler(makeOptions(cwd, path.join(cwd, 'agent.log')))
    handler.onLine(
      JSON.stringify({
        type: 'step_finish',
        part: {
          reason: 'stop',
          tokens: { input: 100, output: 4, reasoning: 1, cache: { read: 800, write: 60 } },
          cost: 0,
        },
      }),
    )
    handler.onLine(
      JSON.stringify({
        type: 'step_finish',
        part: {
          reason: 'stop',
          tokens: { input: 50, output: 2, reasoning: 0, cache: { read: 400, write: 30 } },
          cost: 0,
        },
      }),
    )
    expect(handler.ctx.usage.inputTokens).toBe(150)
    expect(handler.ctx.usage.cachedReadTokens).toBe(1200)
    expect(handler.ctx.usage.cachedWriteTokens).toBe(90)
    expect(handler.ctx.usage.outputTokens).toBe(6)
  })

  test('step_finish delta carries label/model and tool calls accumulate per step', () => {
    const cwd = makeTempDir('line-handler-stats-')
    const stats = new RunStats()
    const deltas: UsageDelta[] = []
    const reporter = makeReporter({
      stats,
      usage: (d) => {
        deltas.push(d)
        stats.addUsage('drain', d)
      },
    })
    const handler = createLineHandler({ ...makeOptions(cwd, path.join(cwd, 'agent.log')), reporter })
    const stepStart = JSON.stringify({ type: 'step_start', timestamp: 1, part: {} })
    const stepFinish = JSON.stringify({
      type: 'step_finish',
      part: { reason: 'stop', tokens: { input: 5, output: 2, reasoning: 1 }, cost: 0 },
    })
    const tool = (id: string): string =>
      JSON.stringify({
        type: 'tool_use',
        part: { tool: 'read', callID: id, state: { status: 'running', input: { filePath: '/a/cli.ts' } } },
      })
    handler.onLine(stepStart)
    handler.onLine(tool('c1'))
    handler.onLine(stepFinish)
    handler.onLine(stepStart)
    handler.onLine(tool('c2'))
    // duplicate callID from a later step must not double-count
    handler.onLine(tool('c1'))
    handler.onLine(stepFinish)
    expect(deltas).toEqual([
      { input: 5, output: 2, reasoning: 1, cacheRead: 0, cacheWrite: 0, cost: 0, label: 'drain', model: 'm' },
      { input: 5, output: 2, reasoning: 1, cacheRead: 0, cacheWrite: 0, cost: 0, label: 'drain', model: 'm' },
    ])
    expect(stats.snapshot().totals.toolCalls).toBe(2)
    expect(stats.snapshot().perLabel['drain']?.input).toBe(10)
  })

  test('tool progress goes to reporter.slot and dispose commits it with a done marker', async () => {
    const cwd = makeTempDir('line-handler-slot-')
    const slots: Array<readonly [string, string | null]> = []
    const commits: Array<readonly [string, string | undefined]> = []
    const reporter = makeReporter({
      slot: (key, line) => {
        slots.push([key, line] as const)
      },
      commit: (key, line) => {
        commits.push([key, line] as const)
      },
    })
    const handler = createLineHandler({ ...makeOptions(cwd, path.join(cwd, 'agent.log')), reporter })
    handler.onLine(JSON.stringify({ type: 'step_start', timestamp: 1, part: {} }))
    handler.onLine(
      JSON.stringify({
        type: 'tool_use',
        part: { tool: 'read', callID: 'c1', state: { status: 'running', input: { filePath: '/a/cli.ts' } } },
      }),
    )
    expect(slots.some(matchesDrainRead)).toBe(true)
    await handler.dispose()
    expect(commits).toHaveLength(1)
    expect(commits[0]![0]).toBe('drain')
    expect(commits[0]![1]).toContain('\u2713')
    expect(commits[0]![1]).toContain('read')
    expect(slots.every(([, line]) => line !== null)).toBe(true)
  })

  test('commitOnDispose:false leaves the slot live (no commit, no clear)', async () => {
    const cwd = makeTempDir('line-handler-keep-')
    const slots: Array<readonly [string, string | null]> = []
    const commits: Array<readonly [string, string | undefined]> = []
    const reporter = makeReporter({
      slot: (key, line) => {
        slots.push([key, line] as const)
      },
      commit: (key, line) => {
        commits.push([key, line] as const)
      },
    })
    const handler = createLineHandler({
      ...makeOptions(cwd, path.join(cwd, 'agent.log')),
      reporter,
      slotKey: 'iter',
      commitOnDispose: false,
    })
    handler.onLine(JSON.stringify({ type: 'step_start', timestamp: 1, part: {} }))
    handler.onLine(
      JSON.stringify({
        type: 'tool_use',
        part: { tool: 'read', callID: 'c1', state: { status: 'running', input: { filePath: '/a/cli.ts' } } },
      }),
    )
    await handler.dispose()
    expect(commits).toEqual([])
    expect(slots).toHaveLength(1)
    expect(slots.every(([, line]) => line !== null)).toBe(true)
  })

  test('slotKey overrides the slot identity', async () => {
    const cwd = makeTempDir('line-handler-key-')
    const slots: Array<readonly [string, string | null]> = []
    const reporter = makeReporter({
      slot: (key, line) => {
        slots.push([key, line] as const)
      },
    })
    const handler = createLineHandler({
      ...makeOptions(cwd, path.join(cwd, 'agent.log')),
      reporter,
      slotKey: 'iter',
      commitOnDispose: false,
    })
    handler.onLine(JSON.stringify({ type: 'step_start', timestamp: 1, part: {} }))
    handler.onLine(
      JSON.stringify({
        type: 'tool_use',
        part: { tool: 'read', callID: 'c1', state: { status: 'running', input: { filePath: '/a/cli.ts' } } },
      }),
    )
    expect(slots).toHaveLength(1)
    expect(slots.every(([key]) => key === 'iter')).toBe(true)
    await handler.dispose()
  })

  test('step_finish emits no permanent event, but re-renders the live line with cumulative tokens', async () => {
    const cwd = makeTempDir('line-handler-tokens-')
    const events: string[] = []
    const slots: Array<readonly [string, string | null]> = []
    const reporter = makeReporter({
      event: (msg) => {
        events.push(msg)
      },
      slot: (key, line) => {
        slots.push([key, line] as const)
      },
    })
    const handler = createLineHandler({ ...makeOptions(cwd, path.join(cwd, 'agent.log')), reporter })
    handler.onLine(JSON.stringify({ type: 'step_start', timestamp: 1, part: {} }))
    handler.onLine(
      JSON.stringify({
        type: 'step_finish',
        part: { reason: 'stop', tokens: { input: 5, output: 2, reasoning: 1 }, cost: 0 },
      }),
    )
    expect(events).toEqual([])
    const last = slots[slots.length - 1]![1]!
    expect(last).toContain('in 5 / out 2')
    await handler.dispose()
  })

  test('an agent that died before its first step clears the slot instead of committing', async () => {
    const cwd = makeTempDir('line-handler-unstarted-')
    const slots: Array<readonly [string, string | null]> = []
    const commits: Array<readonly [string, string | undefined]> = []
    const reporter = makeReporter({
      slot: (key, line) => {
        slots.push([key, line] as const)
      },
      commit: (key, line) => {
        commits.push([key, line] as const)
      },
    })
    const handler = createLineHandler({ ...makeOptions(cwd, path.join(cwd, 'agent.log')), reporter })
    await handler.dispose()
    expect(commits).toEqual([])
    expect(slots).toEqual([['drain', null]])
  })

  test('a reporter without commit falls back to clearing the slot on dispose', async () => {
    const cwd = makeTempDir('line-handler-nocommit-')
    const slots: Array<readonly [string, string | null]> = []
    const reporter = makeReporter({
      slot: (key, line) => {
        slots.push([key, line] as const)
      },
    })
    const handler = createLineHandler({ ...makeOptions(cwd, path.join(cwd, 'agent.log')), reporter })
    handler.onLine(JSON.stringify({ type: 'step_start', timestamp: 1, part: {} }))
    await handler.dispose()
    expect(slots[slots.length - 1]).toEqual(['drain', null])
  })
})

describe('createLineHandler decoder injection', () => {
  test('defaults to the opencode adapter when no decoder is passed', () => {
    const cwd = makeTempDir('line-handler-default-decoder-')
    const handler = createLineHandler(makeOptions(cwd, path.join(cwd, 'agent.log')))
    handler.onLine(
      JSON.stringify({
        type: 'tool_use',
        part: { tool: 'read', callID: 'c1', state: { status: 'running', input: { filePath: '/a' } } },
      }),
    )
    expect(handler.ctx.toolCount).toBe(1)
    // An opencode line carries its session id top-level; the default adapter reads it.
    handler.onLine(JSON.stringify({ type: 'step_start', sessionID: 'ses_oc', timestamp: 1, part: {} }))
    expect(handler.ctx.sessionId).toBe('ses_oc')
  })

  test('an injected claude decoder processes claude NDJSON lines', () => {
    const cwd = makeTempDir('line-handler-claude-decoder-')
    const handler = createLineHandler(makeOptions(cwd, path.join(cwd, 'agent.log')), createClaudeStreamDecoder())

    handler.onLine(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'claude-sess-1', cwd, tools: [] }))
    expect(handler.ctx.sessionId).toBe('claude-sess-1')

    handler.onLine(
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: 'README.md' } }],
          stop_reason: 'tool_use',
        },
        session_id: 'claude-sess-1',
      }),
    )
    expect(handler.ctx.toolCount).toBe(1)
    expect(handler.ctx.tool).toBe('Read')

    handler.onLine(
      JSON.stringify({
        type: 'result',
        is_error: false,
        stop_reason: 'end_turn',
        session_id: 'claude-sess-1',
        total_cost_usd: 0.02,
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      }),
    )
    expect(handler.ctx.usage.inputTokens).toBe(10)
    expect(handler.ctx.usage.costUsd).toBeCloseTo(0.02)
  })

  test('the decoder is re-armable per attempt', () => {
    // runAttempt re-arms the decoder beside handler.ctx.sessionId so a retry
    // never reads the stalled attempt's result line as its own.
    const cwd = makeTempDir('line-handler-rearm-decoder-')
    const handler = createLineHandler(makeOptions(cwd, path.join(cwd, 'agent.log')), createClaudeStreamDecoder())
    handler.onLine(
      JSON.stringify({ type: 'result', is_error: true, stop_reason: 'stop_sequence', total_cost_usd: 0, usage: {} }),
    )
    expect(handler.decoder.resultOutcome()).toEqual({ seen: true, isError: true })

    handler.decoder = createClaudeStreamDecoder()
    handler.ctx.sessionId = null
    expect(handler.decoder.resultOutcome()).toEqual({ seen: false, isError: false })
  })
})

describe('createLineHandler credential scrub (enqueueLog sink)', () => {
  const SECRET = 'sk-ant-secret-0123456789'

  function claudeOptions(cwd: string, logPath: string, credentialValue: string): RunAgentOptions<{ ok: boolean }> {
    return {
      ...makeOptions(cwd, logPath),
      backend: 'claude',
      claude: {
        profile: 'bare',
        credentialName: 'ANTHROPIC_API_KEY',
        credentialValue,
        configDirRoot: path.join(cwd, 'claude-root'),
        envSource: {},
      },
    }
  }

  test('MIN_SECRET_LENGTH mirrors the parent route 12-char floor', () => {
    expect(MIN_SECRET_LENGTH).toBe(12)
  })

  test('a raw NDJSON line embedding the credential comes out of the sink scrubbed', async () => {
    const cwd = makeTempDir('line-handler-scrub-raw-')
    const logPath = path.join(cwd, 'agent.log')
    const handler = createLineHandler(claudeOptions(cwd, logPath, SECRET))
    handler.onLine(
      JSON.stringify({
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 't1', content: `printenv said ${SECRET}`, is_error: false }],
        },
      }),
    )
    await handler.dispose()
    const logged = readFileSync(logPath, 'utf8')
    expect(logged).toContain('[redacted]')
    expect(logged).not.toContain(SECRET)
  })

  test('the stderr caller path (enqueueLog directly) is scrubbed by construction', async () => {
    const cwd = makeTempDir('line-handler-scrub-stderr-')
    const logPath = path.join(cwd, 'agent.log')
    const handler = createLineHandler(claudeOptions(cwd, logPath, SECRET))
    enqueueLog(handler.ctx, `[fixer-w1] stderr: env: ANTHROPIC_API_KEY=${SECRET}\n`)
    await handler.dispose()
    const logged = readFileSync(logPath, 'utf8')
    expect(logged).toContain('[redacted]')
    expect(logged).not.toContain(SECRET)
  })

  test('a sub-floor credential value survives the scrub unscrubbed', async () => {
    const cwd = makeTempDir('line-handler-scrub-subfloor-')
    const logPath = path.join(cwd, 'agent.log')
    const shortValue = 'short-token'
    expect(shortValue.length).toBeLessThan(MIN_SECRET_LENGTH)
    const handler = createLineHandler(claudeOptions(cwd, logPath, shortValue))
    handler.onLine(`echo ${shortValue}`)
    await handler.dispose()
    const logged = readFileSync(logPath, 'utf8')
    expect(logged).toContain(shortValue)
  })

  test('the opencode route (no claude context) logs verbatim', async () => {
    const cwd = makeTempDir('line-handler-noscrub-')
    const logPath = path.join(cwd, 'agent.log')
    const handler = createLineHandler(makeOptions(cwd, logPath))
    handler.onLine(`harmless ${SECRET}`)
    await handler.dispose()
    const logged = readFileSync(logPath, 'utf8')
    expect(logged).toContain(SECRET)
  })
})

describe('createLineHandler session capture seam', () => {
  test('reports the session id once, on the first session-bearing line', () => {
    const cwd = makeTempDir('line-handler-session-')
    const reported: Array<{ id: string; attempt: number }> = []
    const handler = createLineHandler({
      ...makeOptions(cwd, path.join(cwd, 'agent.log')),
      sessionLedger: {
        recordSessionId: (id, attempt) => {
          reported.push({ id, attempt })
        },
      },
    })
    handler.onLine(
      JSON.stringify({ type: 'step_start', sessionID: 'ses_abc', timestamp: 1, part: { type: 'step-start' } }),
    )
    handler.onLine(
      JSON.stringify({ type: 'step_start', sessionID: 'ses_abc', timestamp: 2, part: { type: 'step-start' } }),
    )
    handler.onLine(
      JSON.stringify({ type: 'tool_use', sessionID: 'ses_abc', part: { tool: 'read', callID: 'c1', state: {} } }),
    )
    expect(reported).toEqual([{ id: 'ses_abc', attempt: 1 }])
  })

  test('never reports when no session-bearing line arrives', () => {
    const cwd = makeTempDir('line-handler-nosession-')
    const reported: string[] = []
    const handler = createLineHandler({
      ...makeOptions(cwd, path.join(cwd, 'agent.log')),
      sessionLedger: {
        recordSessionId: (id) => {
          reported.push(id)
        },
      },
    })
    handler.onLine(JSON.stringify({ type: 'step_start', timestamp: 1, part: {} }))
    handler.onLine('{ not json')
    expect(reported).toEqual([])
  })

  test('a ledger error never fails the line handler (best-effort capture)', () => {
    const cwd = makeTempDir('line-handler-ledger-throw-')
    const handler = createLineHandler({
      ...makeOptions(cwd, path.join(cwd, 'agent.log')),
      sessionLedger: {
        recordSessionId: () => {
          throw new Error('disk on fire')
        },
      },
    })
    handler.onLine(
      JSON.stringify({ type: 'step_start', sessionID: 'ses_x', timestamp: 1, part: { type: 'step-start' } }),
    )
  })

  test('re-arming the seam records the next session under a fresh attempt', () => {
    const cwd = makeTempDir('line-handler-rearm-')
    const attempts: number[] = []
    const ledger = {
      recordSessionId: (_id: string, attempt: number): void => {
        attempts.push(attempt)
      },
    }
    const handler = createLineHandler({
      ...makeOptions(cwd, path.join(cwd, 'agent.log')),
      sessionLedger: ledger,
    })
    handler.onLine(
      JSON.stringify({ type: 'step_start', sessionID: 'ses_a', timestamp: 1, part: { type: 'step-start' } }),
    )
    // runAgent's stall retry re-arms the seam before the second attempt
    const rearmed = createLineHandler({
      ...makeOptions(cwd, path.join(cwd, 'agent.log')),
      sessionLedger: ledger,
    })
    rearmed.onLine(
      JSON.stringify({ type: 'step_start', sessionID: 'ses_b', timestamp: 2, part: { type: 'step-start' } }),
    )
    expect(attempts).toEqual([1, 1])
  })
})
