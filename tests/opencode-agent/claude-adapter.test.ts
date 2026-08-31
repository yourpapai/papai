// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import type { TranscriptRow } from '../../opencode-agent/src/activity-detail.js'
import { createClaudeAgent } from '../../opencode-agent/src/claude-adapter.js'
import type { ClaudeAgentOptions } from '../../opencode-agent/src/claude-adapter.js'
import type { SpawnClaude } from '../../opencode-agent/src/claude-connect.js'
import { isClaudeExit, isClaudeResult, PipelineError } from '../../opencode-agent/src/errors.js'
import type { Logger } from '../../opencode-agent/src/logger.js'

/**
 * The session the pipeline holds over the spawned CLI: resolution, failure
 * classification, resume chaining, stop/teardown, token accounting and the
 * names-only progress rule. Everything drives an injected spawn seam — the
 * fixture corpus under `fixtures/claude-cli/` supplies the stream shapes.
 */

const FIXTURES = path.join(import.meta.dir, 'fixtures', 'claude-cli')
const fixture = (name: string): string => readFileSync(path.join(FIXTURES, name), 'utf8')

const CREDENTIAL = { name: 'ANTHROPIC_API_KEY' as const, value: 'sk-ant-api03-the-chosen-credential' }

const OAUTH_CREDENTIAL = { name: 'CLAUDE_CODE_OAUTH_TOKEN' as const, value: 'sk-ant-oat01-the-subscription-token' }

/** One scripted turn: what the fake CLI printed and how it exited. */
interface ScriptedTurn {
  stdout?: string
  stderr?: string
  exitCode?: number | null
}

interface RecordedCall {
  argv: readonly string[]
  /** The child env the spawn was asked to run with — never logged, only asserted. */
  env: Record<string, string>
}

/** A spawn seam that answers each turn from a script, recording every call. */
const scriptedSpawn = (turns: readonly ScriptedTurn[]): { spawn: SpawnClaude; calls: RecordedCall[] } => {
  const calls: RecordedCall[] = []
  let at = 0
  return {
    calls,
    spawn: (binary, argv, options) => {
      const turn = turns[Math.min(at, turns.length - 1)] ?? {}
      at += 1
      const stdin = {
        written: '',
        write(chunk: string): void {
          this.written += chunk
        },
        end(): void {},
      }
      calls.push({ argv: [binary, ...argv], env: options.env })
      const encoder = new TextEncoder()
      const stream = (text: string): AsyncIterable<Uint8Array> => {
        const chunks: Uint8Array[] = [encoder.encode(text)]
        return {
          [Symbol.asyncIterator]: (): AsyncIterator<Uint8Array> => {
            let served = 0
            return {
              next: (): Promise<IteratorResult<Uint8Array>> =>
                served < chunks.length
                  ? Promise.resolve({ done: false, value: chunks[served++] ?? new Uint8Array() })
                  : Promise.resolve({ done: true, value: undefined }),
            }
          },
        }
      }
      return {
        pid: 4200 + at,
        stdin,
        stdout: stream(turn.stdout ?? ''),
        stderr: stream(turn.stderr ?? ''),
        exited: Promise.resolve(turn.exitCode ?? 0),
      }
    },
  }
}

/** The config dir a recorded call spawned under, or '' when the call did not happen. */
const configDirOfCall = (calls: readonly RecordedCall[], at: number): string =>
  calls[at]?.env['CLAUDE_CONFIG_DIR'] ?? ''

/** Records what the run said in public — the one channel the names-only rule governs. */
interface PublicLog {
  rows: Array<{ meta: unknown; message: string }>
}

const publicLog = (): PublicLog & { log: Logger } => {
  const rows: Array<{ meta: unknown; message: string }> = []
  return {
    rows,
    log: {
      debug: (): void => {},
      info: (meta, message): void => void rows.push({ meta, message }),
      warn: (meta, message): void => void rows.push({ meta, message }),
      error: (meta, message): void => void rows.push({ meta, message }),
    },
  }
}

interface TranscriptCapture {
  rows: TranscriptRow[]
  sink: { write(row: TranscriptRow): void }
}

const transcriptCapture = (): TranscriptCapture => {
  const rows: TranscriptRow[] = []
  return { rows, sink: { write: (row) => void rows.push(row) } }
}

const baseOptions = (spawn: SpawnClaude, log: Logger, extra: Partial<ClaudeAgentOptions> = {}): ClaudeAgentOptions => ({
  directory: '/repo',
  knobs: { model: 'claude-sonnet-5', lightModel: null, planEffort: null, proposeEffort: null, buildEffort: null },
  pricing: {
    apiKey: 'placeholder',
    baseUrl: 'https://unused.test/v1',
    model: 'claude-sonnet-5',
    provider: 'anthropic',
  },
  credential: CREDENTIAL,
  env: {},
  log,
  spawn,
  ...extra,
})

/** The argv of a recorded call, or an empty vector when it did not happen. */
const argvOf = (calls: readonly RecordedCall[], at: number): readonly string[] => calls[at]?.argv ?? []

/** The value --resume takes in a recorded argv, or null when the flag is absent. */
const resumeOf = (argv: readonly string[]): string | null => {
  const at = argv.indexOf('--resume')
  return at === -1 ? null : (argv[at + 1] ?? null)
}

/** The failure a prompt rejected with, narrowed outside the test bodies. */
const asPipelineError = (raised: unknown): PipelineError => {
  if (raised instanceof PipelineError) return raised
  throw new Error(`expected a PipelineError, got ${JSON.stringify(raised)}`)
}

/** The recorded success stream with its init line dropped — the no-session-id shape. */
const withoutInit = (text: string): string =>
  text
    .split('\n')
    .filter((line) => !line.includes('"subtype":"init"'))
    .join('\n')

describe('the turn outcome contract', () => {
  test('a successful turn resolves with the result line text and the init session id', async () => {
    const spawn = scriptedSpawn([{ stdout: fixture('success-turn.ndjson') }])
    const agent = await createClaudeAgent(baseOptions(spawn.spawn, publicLog().log))

    const reply = await agent.prompt({ prompt: 'read the README' })

    expect(reply.text).toContain('papai')
    expect(reply.sessionId).toBe('0d9f2a55-7b3a-4c1e-9f0a-2f7c8d11ab02')
  })

  test('an exit-0 run with no decodable result line fails CLAUDE_RESULT, never an empty success', async () => {
    const spawn = scriptedSpawn([{ stdout: '{"type":"assistant"}\nnot json\n' }])
    const agent = await createClaudeAgent(baseOptions(spawn.spawn, publicLog().log))

    const raised = await agent.prompt({ prompt: 'x' }).then(
      () => null,
      (error: unknown) => error,
    )

    expect(isClaudeResult(asPipelineError(raised))).toBe(true)
  })

  test('the recorded auth-failure shape — exit 0, is_error true — fails CLAUDE_RESULT', async () => {
    const spawn = scriptedSpawn([{ stdout: fixture('auth-error-turn.ndjson'), exitCode: 0 }])
    const agent = await createClaudeAgent(baseOptions(spawn.spawn, publicLog().log))

    const raised = await agent.prompt({ prompt: 'x' }).then(
      () => null,
      (error: unknown) => error,
    )

    // The exit code was 0 and the turn still failed: the stream-json family
    // owns error-signalling results whatever the exit status.
    const error = asPipelineError(raised)
    expect(isClaudeResult(error)).toBe(true)
    expect(error.message).not.toContain('exited with code')
  })

  test('an error-signalling result line owns the failure even on a non-zero exit', async () => {
    const spawn = scriptedSpawn([{ stdout: fixture('auth-error-turn.ndjson'), exitCode: 1 }])
    const agent = await createClaudeAgent(baseOptions(spawn.spawn, publicLog().log))

    const raised = await agent.prompt({ prompt: 'x' }).then(
      () => null,
      (error: unknown) => error,
    )

    expect(isClaudeResult(asPipelineError(raised))).toBe(true)
    expect(isClaudeExit(asPipelineError(raised))).toBe(false)
  })

  test('empty final text fails CLAUDE_RESULT regardless of exit code', async () => {
    const emptied = fixture('success-turn.ndjson').replace(
      '"result":"The README describes papai, a chat bot that manages tasks via LLM tool-calling."',
      '"result":""',
    )
    const spawn = scriptedSpawn([{ stdout: emptied, exitCode: 0 }])
    const agent = await createClaudeAgent(baseOptions(spawn.spawn, publicLog().log))

    const raised = await agent.prompt({ prompt: 'x' }).then(
      () => null,
      (error: unknown) => error,
    )

    expect(isClaudeResult(asPipelineError(raised))).toBe(true)
  })

  test('a decodable result line with no session id anywhere fails CLAUDE_RESULT', async () => {
    const spawn = scriptedSpawn([{ stdout: withoutInit(fixture('success-turn.ndjson')), exitCode: 0 }])
    const agent = await createClaudeAgent(baseOptions(spawn.spawn, publicLog().log))

    const raised = await agent.prompt({ prompt: 'x' }).then(
      () => null,
      (error: unknown) => error,
    )

    const error = asPipelineError(raised)
    expect(isClaudeResult(error)).toBe(true)
    expect(error.message).toContain('session')
  })

  test('a non-zero exit with no error-signalling result fails CLAUDE_EXIT, carrying the code and a redacted tail', async () => {
    const spawn = scriptedSpawn([{ stdout: '', stderr: `bad flag --nope (${CREDENTIAL.value})\n`, exitCode: 2 }])
    const agent = await createClaudeAgent(baseOptions(spawn.spawn, publicLog().log))

    const raised = await agent.prompt({ prompt: 'x' }).then(
      () => null,
      (error: unknown) => error,
    )

    const error = asPipelineError(raised)
    expect(isClaudeExit(error)).toBe(true)
    expect(error.message).toContain('2')
    expect(error.message).toContain('--nope')
    // The tail is redacted by credential value before it is quoted.
    expect(error.message).not.toContain(CREDENTIAL.value)
  })

  test('the per-call tools field is accepted and ignored', async () => {
    const spawn = scriptedSpawn([{ stdout: fixture('success-turn.ndjson') }])
    const agent = await createClaudeAgent(baseOptions(spawn.spawn, publicLog().log))

    const reply = await agent.prompt({ prompt: 'x', tools: { bash: false } })

    expect(reply.text).toContain('papai')
  })
})

/**
 * The model knobs on the spawned argv, wired through the real adapter.
 *
 * The builder's composition is pinned flag-for-flag in `claude-contract.test.ts`;
 * these two assert what the pipeline actually spawns when the run resolved a
 * tier: the propose turn carries its tier too (design D7), positioned exactly
 * where the doctrine pin looks for it — immediately after `--model` (D6) — and
 * an unresolved tier composes no flag at all.
 */
describe('the model knobs on the spawned argv', () => {
  test('a propose turn carries --effort immediately after --model when a tier resolves (D6, D7)', async () => {
    const spawn = scriptedSpawn([{ stdout: fixture('success-turn.ndjson') }])
    // `proposeEffort` is not on `ClaudeModelKnobs` yet: the knobs are built
    // unannotated — a structural superset — so this red test states the
    // contract first and the interface grows to carry it in the next step.
    const knobs = {
      model: 'claude-sonnet-5',
      lightModel: null,
      planEffort: null,
      buildEffort: null,
      proposeEffort: 'high',
    }
    const agent = await createClaudeAgent(baseOptions(spawn.spawn, publicLog().log, { knobs }))

    await agent.prompt({ prompt: 'x', agent: 'propose' })

    const argv = argvOf(spawn.calls, 0)
    const model = argv.indexOf('--model')
    expect(argv[model + 1]).toBe('claude-sonnet-5')
    expect(argv[model + 2]).toBe('--effort')
    expect(argv[model + 3]).toBe('high')
  })

  test('no propose tier, no --effort — and plan and build are unchanged', async () => {
    const spawn = scriptedSpawn([{ stdout: fixture('success-turn.ndjson') }])
    const agent = await createClaudeAgent(
      baseOptions(spawn.spawn, publicLog().log, {
        knobs: {
          model: 'claude-sonnet-5',
          lightModel: null,
          planEffort: 'low',
          proposeEffort: null,
          buildEffort: 'high',
        },
      }),
    )

    await agent.prompt({ prompt: 'x', agent: 'propose' })
    await agent.prompt({ prompt: 'x', agent: 'plan' })
    await agent.prompt({ prompt: 'x', agent: 'build' })

    expect(argvOf(spawn.calls, 0).includes('--effort')).toBe(false)
    const plan = argvOf(spawn.calls, 1)
    const build = argvOf(spawn.calls, 2)
    const planModel = plan.indexOf('--model')
    const buildModel = build.indexOf('--model')
    expect(plan.slice(planModel + 2, planModel + 4)).toEqual(['--effort', 'low'])
    expect(build.slice(buildModel + 2, buildModel + 4)).toEqual(['--effort', 'high'])
  })
})

describe('session continuity', () => {
  test('the second turn resumes the memoized init id', async () => {
    const spawn = scriptedSpawn([{ stdout: fixture('success-turn.ndjson') }, { stdout: fixture('resume-turn.ndjson') }])
    const agent = await createClaudeAgent(baseOptions(spawn.spawn, publicLog().log))

    await agent.prompt({ prompt: 'first' })
    const reply = await agent.prompt({ prompt: 'second' })

    expect(argvOf(spawn.calls, 1).includes('--resume')).toBe(true)
    expect(resumeOf(argvOf(spawn.calls, 1))).toBe('0d9f2a55-7b3a-4c1e-9f0a-2f7c8d11ab02')
    expect(reply.sessionId).toBe('5e1c7d33-2a44-4b5e-8c6a-7d3e9f20bc31')
  })

  test('a turn that failed still memoized its init id, so the next turn resumes it', async () => {
    const spawn = scriptedSpawn([
      // The init line arrives, then the process dies non-zero with no result.
      { stdout: fixture('success-turn.ndjson').split('\n')[0], stderr: 'crashed', exitCode: 1 },
      { stdout: fixture('resume-turn.ndjson') },
    ])
    const agent = await createClaudeAgent(baseOptions(spawn.spawn, publicLog().log))

    await agent.prompt({ prompt: 'first' }).catch(() => 'expected failure')
    await agent.prompt({ prompt: 'second' })

    expect(resumeOf(argvOf(spawn.calls, 1))).toBe('0d9f2a55-7b3a-4c1e-9f0a-2f7c8d11ab02')
  })

  test('a turn that produced no init line anywhere leaves nothing memoized, so the next spawns fresh', async () => {
    const spawn = scriptedSpawn([
      { stdout: withoutInit(fixture('success-turn.ndjson')), exitCode: 0 },
      { stdout: fixture('success-turn.ndjson') },
    ])
    const agent = await createClaudeAgent(baseOptions(spawn.spawn, publicLog().log))

    await agent.prompt({ prompt: 'first' }).catch(() => 'expected failure')
    await agent.prompt({ prompt: 'second' })

    expect(resumeOf(argvOf(spawn.calls, 1))).toBeNull()
  })

  test('the boot-time sessionId is synthetic and job-local; the reply carries the CLI’s', async () => {
    const spawn = scriptedSpawn([{ stdout: fixture('success-turn.ndjson') }])
    const agent = await createClaudeAgent(baseOptions(spawn.spawn, publicLog().log))

    expect(agent.sessionId).toStartWith('claude-job-')
    expect(agent.sessionId).not.toBe('0d9f2a55-7b3a-4c1e-9f0a-2f7c8d11ab02')

    const reply = await agent.prompt({ prompt: 'x' })
    expect(reply.sessionId).toBe('0d9f2a55-7b3a-4c1e-9f0a-2f7c8d11ab02')
  })
})

describe('credential carrier by spelling — the profile derivation', () => {
  /** What the config dir held at the moment of the first spawn. */
  interface FirstSpawnProbe {
    helper: boolean
    settings: boolean
    emptyMcp: boolean
    /** The `--mcp-config` value the first spawn's argv named, or ''. */
    mcpConfigArgv: string
  }

  const probeAtFirstSpawn = (
    turns: readonly ScriptedTurn[],
  ): { spawn: SpawnClaude; probe: FirstSpawnProbe | null; calls: RecordedCall[] } => {
    const inner = scriptedSpawn(turns)
    let probe: FirstSpawnProbe | null = null
    return {
      calls: inner.calls,
      get probe(): FirstSpawnProbe | null {
        return probe
      },
      spawn: (binary, argv, options) => {
        if (probe === null) {
          const dir = options.env['CLAUDE_CONFIG_DIR'] ?? ''
          const at = argv.indexOf('--mcp-config')
          probe = {
            helper: existsSync(path.join(dir, 'credential.sh')),
            settings: existsSync(path.join(dir, 'settings.json')),
            emptyMcp: existsSync(path.join(dir, 'empty-mcp.json')),
            mcpConfigArgv: at === -1 ? '' : (argv[at + 1] ?? ''),
          }
        }
        return inner.spawn(binary, argv, options)
      },
    }
  }

  /** The `--mcp-config` value the first spawn's argv named, or '' when it named none. */
  const probedMcpPath = (probe: FirstSpawnProbe | null): string => probe?.mcpConfigArgv ?? ''

  test('the OAuth spelling derives the native profile: no --bare, neutralization flags, the empty-MCP doc written before the first spawn, env carrying the token', async () => {
    const probed = probeAtFirstSpawn([{ stdout: fixture('success-turn.ndjson') }])
    const agent = await createClaudeAgent(baseOptions(probed.spawn, publicLog().log, { credential: OAUTH_CREDENTIAL }))

    await agent.prompt({ prompt: 'x' })

    const argv = argvOf(probed.calls, 0)
    expect(argv.includes('--bare')).toBe(false)
    expect(argv.includes('--setting-sources')).toBe(true)
    expect(argv.includes('--strict-mcp-config')).toBe(true)
    // The document existed before the first spawn, and the argv names it.
    const named = probedMcpPath(probed.probe)
    expect(named).not.toBe('')
    expect(existsSync(named)).toBe(true)
    // No credential file either: env injection is this spelling's mechanism.
    expect(probed.probe?.helper).toBe(false)
    expect(probed.probe?.settings).toBe(false)
    for (const call of probed.calls) {
      expect(call.env['CLAUDE_CODE_OAUTH_TOKEN']).toBe(OAUTH_CREDENTIAL.value)
      expect(call.env['ANTHROPIC_API_KEY']).toBeUndefined()
    }
    // The one file the boot wrote is the inert document.
    const dir = configDirOfCall(probed.calls, 0)
    expect(dir).not.toBe('')
    expect(readdirSync(dir)).toEqual(['empty-mcp.json'])
  })

  test('the API-key spelling derives bare: byte-identical to the pre-split route, nothing materialized', async () => {
    const probed = probeAtFirstSpawn([{ stdout: fixture('success-turn.ndjson') }])
    const agent = await createClaudeAgent(baseOptions(probed.spawn, publicLog().log))

    await agent.prompt({ prompt: 'x' })

    const argv = argvOf(probed.calls, 0)
    expect(argv[1]).toBe('--bare')
    expect(argv.includes('--setting-sources')).toBe(false)
    expect(argv.includes('--strict-mcp-config')).toBe(false)
    expect(argv.includes('--mcp-config')).toBe(false)
    expect(probed.probe?.helper).toBe(false)
    expect(probed.probe?.settings).toBe(false)
    expect(probed.probe?.emptyMcp).toBe(false)
    expect(probed.calls[0]?.env['ANTHROPIC_API_KEY']).toBe(CREDENTIAL.value)
    expect(probed.calls[0]?.env['CLAUDE_CODE_OAUTH_TOKEN']).toBeUndefined()
    const dir = configDirOfCall(probed.calls, 0)
    expect(dir).not.toBe('')
    expect(readdirSync(dir)).toEqual([])
  })

  test('an absent credential derives bare too, with neither spelling in env — the recorder’s census and negative legs', async () => {
    const probed = probeAtFirstSpawn([{ stdout: fixture('success-turn.ndjson') }])
    const agent = await createClaudeAgent(baseOptions(probed.spawn, publicLog().log, { credential: undefined }))

    await agent.prompt({ prompt: 'x' })

    // Bare composition: the weaker default, materializing nothing, injecting
    // nothing — what the un-credentialed census legs compose from.
    expect(argvOf(probed.calls, 0)[1]).toBe('--bare')
    expect(probed.probe?.emptyMcp).toBe(false)
    for (const call of probed.calls) {
      expect(call.env['CLAUDE_CODE_OAUTH_TOKEN']).toBeUndefined()
      expect(call.env['ANTHROPIC_API_KEY']).toBeUndefined()
    }
    const dir = configDirOfCall(probed.calls, 0)
    expect(dir).not.toBe('')
    expect(readdirSync(dir)).toEqual([])
  })
})

describe('stop and teardown', () => {
  test('abort() escalates to the live group and reports that the kill landed', async () => {
    const signals: Array<[number, string]> = []
    const spawn = scriptedSpawn([{ stdout: '', exitCode: 0 }])
    const agent = await createClaudeAgent(
      baseOptions(spawn.spawn, publicLog().log, {
        killSignal: (target, signal) => void signals.push([target, signal]),
        killSleep: () => Promise.resolve(),
      }),
    )
    await agent.prompt({ prompt: 'x' }).catch(() => 'expected failure')

    const landed = await agent.abort()

    // The fake child's pid is 4201; the group target is its negation.
    expect(landed).toBe(true)
    expect(signals[0]).toEqual([-4201, 'SIGTERM'])
    expect(signals.at(-1)).toEqual([-4201, 'SIGKILL'])
  })

  test('abort() reports false when the group is already gone', async () => {
    const spawn = scriptedSpawn([{ stdout: '', exitCode: 0 }])
    const gone = (): never => {
      throw new Error('ESRCH')
    }
    const agent = await createClaudeAgent(
      baseOptions(spawn.spawn, publicLog().log, { killSignal: gone, killSleep: () => Promise.resolve() }),
    )
    await agent.prompt({ prompt: 'x' }).catch(() => 'expected failure')

    expect(await agent.abort()).toBe(false)
  })

  test('abort() with no live child reports false', async () => {
    const spawn = scriptedSpawn([{ stdout: fixture('success-turn.ndjson') }])
    const agent = await createClaudeAgent(baseOptions(spawn.spawn, publicLog().log))

    // No prompt: nothing was ever spawned, and the stop says so.
    expect(await agent.abort()).toBe(false)
  })

  test('close() never blocks on a grace timer that is still waiting', async () => {
    const removed: string[] = []
    const signals: Array<[number, string]> = []
    const spawn = scriptedSpawn([{ stdout: '', exitCode: 0 }])
    const agent = await createClaudeAgent(
      baseOptions(spawn.spawn, publicLog().log, {
        // A live group (every signal lands) whose grace timer never settles:
        // teardown must return before the escalation does.
        teardownSignal: (target, signal) => void signals.push([target, signal]),
        teardownSleep: () => new Promise<void>(() => {}),
        teardownRemove: (dir) => void removed.push(dir),
      }),
    )
    await agent.prompt({ prompt: 'x' }).catch(() => 'expected failure')

    await agent.close()

    expect(signals).toEqual([[-4201, 'SIGTERM']])
    expect(removed).toEqual([])
  })

  test('close() on a settled turn removes the job-scoped config dir', async () => {
    const removed: string[] = []
    const signals: Array<[number, string]> = []
    const spawn = scriptedSpawn([{ stdout: fixture('success-turn.ndjson') }])
    const agent = await createClaudeAgent(
      baseOptions(spawn.spawn, publicLog().log, {
        teardownSignal: (target, signal) => {
          signals.push([target, signal])
          throw new Error('ESRCH')
        },
        teardownSleep: () => Promise.resolve(),
        teardownRemove: (dir) => void removed.push(dir),
      }),
    )
    await agent.prompt({ prompt: 'x' })

    await agent.close()
    await Bun.sleep(0)

    expect(removed).toHaveLength(1)
    expect(removed[0]).toContain('opencode-agent-claude-')
  })
})

describe('token accounting', () => {
  test('sums every result line as it arrives', async () => {
    const spawn = scriptedSpawn([{ stdout: fixture('success-turn.ndjson') }, { stdout: fixture('resume-turn.ndjson') }])
    const agent = await createClaudeAgent(baseOptions(spawn.spawn, publicLog().log))

    await agent.prompt({ prompt: 'first' })
    // Read straight after the turn, before anything closes: the budget checks
    // the total at exactly this moment.
    const afterFirst = await agent.tokensUsed()
    await agent.prompt({ prompt: 'second' })
    const afterSecond = await agent.tokensUsed()

    expect(afterFirst).toBe(1112)
    expect(afterSecond).toBe(1112 + 2290)
  })

  test('the cost figure never enters the total', async () => {
    const spawn = scriptedSpawn([{ stdout: fixture('success-turn.ndjson') }])
    const agent = await createClaudeAgent(baseOptions(spawn.spawn, publicLog().log))

    await agent.prompt({ prompt: 'x' })

    // The recorded result line carries total_cost_usd 0.0123 and 1112 tokens.
    expect(await agent.tokensUsed()).toBe(1112)
  })

  test('degrades to 0 with a warn when no recognizable usage was seen', async () => {
    const log = publicLog()
    const spawn = scriptedSpawn([{ stdout: fixture('success-turn.ndjson') }])
    const agent = await createClaudeAgent(baseOptions(spawn.spawn, log.log))

    const beforeAnyTurn = await agent.tokensUsed()

    expect(beforeAnyTurn).toBe(0)
    expect(log.rows.some((row) => row.message.includes('token'))).toBe(true)
  })
})

describe('progress translation', () => {
  test('public log rows carry names, statuses and counts only — never content', async () => {
    const log = publicLog()
    const spawn = scriptedSpawn([{ stdout: fixture('success-turn.ndjson') }])
    const agent = await createClaudeAgent(baseOptions(spawn.spawn, log.log))

    await agent.prompt({ prompt: 'x' })
    const said = JSON.stringify(log.rows)

    // The assistant text and the tool content from the fixture never land.
    expect(said).not.toContain('Reading the README first.')
    expect(said).not.toContain('chat bot that manages tasks')
    // Tool names and line types do.
    expect(said).toContain('Read')
  })

  test('content-bearing lines reach the transcript unabridged, redacted by credential value first', async () => {
    const transcript = transcriptCapture()
    const leaking = fixture('success-turn.ndjson').replace(
      '"result":"The README describes papai, a chat bot that manages tasks via LLM tool-calling."',
      `"result":"the credential is ${CREDENTIAL.value} and here is the answer"`,
    )
    const spawn = scriptedSpawn([{ stdout: leaking }])
    const agent = await createClaudeAgent(baseOptions(spawn.spawn, publicLog().log, { transcript: transcript.sink }))

    await agent.prompt({ prompt: 'x' })
    const detail = JSON.stringify(transcript.rows.map((row) => row.detail))

    expect(detail).not.toContain(CREDENTIAL.value)
    expect(detail).toContain('[redacted]')
    // Unabridged beside the redaction: the rest of the line survives.
    expect(detail).toContain('the credential is')
  })
})

/**
 * `spend()` beside `tokensUsed()`: the same stream read for a different
 * question. The ceiling wants a count it can always trust; this wants money and
 * provider standing, either of which may be unknown.
 */
describe('createClaudeAgent · what the run spent', () => {
  test('reports the CLI’s own cost figure for the turns it ran', async () => {
    const spawn = scriptedSpawn([{ stdout: fixture('stub-rate-limit-turn.ndjson') }])
    const agent = await createClaudeAgent(baseOptions(spawn.spawn, publicLog().log))

    await agent.prompt({ prompt: 'first' })
    const spent = await agent.spend()

    // The recorded turn's own `total_cost_usd`, taken as-is: the backend rung.
    expect(spent.source).toBe('backend')
    expect(spent.usd).toBeCloseTo(0.009714, 6)
  })

  test('sums the cost across a run’s turns, as it sums the tokens', async () => {
    const spawn = scriptedSpawn([
      { stdout: fixture('stub-rate-limit-turn.ndjson') },
      { stdout: fixture('stub-rate-limit-turn.ndjson') },
    ])
    const agent = await createClaudeAgent(baseOptions(spawn.spawn, publicLog().log))

    await agent.prompt({ prompt: 'first' })
    await agent.prompt({ prompt: 'second' })

    expect((await agent.spend()).usd).toBeCloseTo(0.009714 * 2, 6)
  })

  test('reports the provider’s standing for every window the run saw', async () => {
    const spawn = scriptedSpawn([{ stdout: fixture('stub-rate-limit-turn.ndjson') }])
    const agent = await createClaudeAgent(baseOptions(spawn.spawn, publicLog().log))

    await agent.prompt({ prompt: 'first' })

    expect((await agent.spend()).windows).toMatchObject([
      { window: 'five_hour', utilization: 0.235 },
      { window: 'seven_day', utilization: 0.412 },
    ])
  })

  test('a session that never prompted is unpriced, not free', async () => {
    // The distinction `tokensUsed` cannot make — it answers 0 and warns — and
    // this one can say outright.
    const spawn = scriptedSpawn([{ stdout: fixture('success-turn.ndjson') }])
    const agent = await createClaudeAgent(baseOptions(spawn.spawn, publicLog().log))

    expect(await agent.spend()).toEqual({ usd: null, source: 'none', windows: [] })
  })

  test('a stream carrying no rate-limit line reports no windows', async () => {
    const spawn = scriptedSpawn([{ stdout: fixture('success-turn.ndjson') }])
    const agent = await createClaudeAgent(baseOptions(spawn.spawn, publicLog().log))

    await agent.prompt({ prompt: 'first' })

    expect((await agent.spend()).windows).toEqual([])
  })

  test('the rate-limit line still never reaches the progress log', async () => {
    // `claude-progress.ts` skips it deliberately: that channel is a live log and
    // this is a run's final account. The fold reads the line; progress does not.
    const log = publicLog()
    const spawn = scriptedSpawn([{ stdout: fixture('stub-rate-limit-turn.ndjson') }])
    const agent = await createClaudeAgent(baseOptions(spawn.spawn, log.log))

    await agent.prompt({ prompt: 'first' })

    expect(log.rows.some((row) => JSON.stringify(row).includes('rate'))).toBe(false)
    expect((await agent.spend()).windows.length).toBe(2)
  })
})
