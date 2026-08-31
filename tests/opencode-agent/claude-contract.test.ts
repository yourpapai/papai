// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { buildClaudeArgv, MAX_ARG_STRLEN } from '../../opencode-agent/src/claude-argv.js'
import type { ClaudeModelKnobs } from '../../opencode-agent/src/claude-argv.js'
import { decodeClaudeLine, parseNdjsonStream } from '../../opencode-agent/src/claude-contract.js'
import type { ClaudeStreamLine } from '../../opencode-agent/src/claude-contract.js'
import { PipelineError } from '../../opencode-agent/src/errors.js'
import type { Logger } from '../../opencode-agent/src/logger.js'

/**
 * The contract with the `claude` CLI, as recorded rather than assumed — the
 * `sdk-contract.ts` doctrine carried to the second backend. The `.ndjson`
 * corpus under `fixtures/claude-cli/` carries its own provenance note: the
 * auth-failure turn is a genuine recording from 2.1.239, the success corpus is
 * documented-provisional until the credentialed recorder run (change task 1.2)
 * replaces it and stamps `VERSION`.
 */

const FIXTURES = path.join(import.meta.dir, 'fixtures', 'claude-cli')

const fixtureLines = (name: string): unknown[] => parseNdjsonStream(readFileSync(path.join(FIXTURES, name), 'utf8'))

type ResultLine = Extract<ClaudeStreamLine, { kind: 'result' }>

/** The decoded lines of one fixture, null for each unrecognized shape. */
const decoded = (name: string): Array<ClaudeStreamLine | null> =>
  fixtureLines(name).map((line) => decodeClaudeLine(line))

/** The one result line a fixture's stream ends on; the tests read no other shape this way. */
const resultOf = (name: string): ResultLine => {
  const found = decoded(name).find((line): line is ResultLine => line !== null && line.kind === 'result')
  if (found === undefined) throw new Error(`fixture ${name} carries no result line`)
  return found
}

/** The session id the fixture's init line named. */
const initSessionIdOf = (name: string): string => {
  const found = decoded(name).find(
    (line): line is Extract<ClaudeStreamLine, { kind: 'init' }> => line !== null && line.kind === 'init',
  )
  if (found === undefined) throw new Error(`fixture ${name} carries no init line`)
  return found.sessionId
}

type InitLine = Extract<ClaudeStreamLine, { kind: 'init' }>

/** The init line of a fixture's stream. */
const initLineOf = (name: string): InitLine => {
  const found = decoded(name).find((line): line is InitLine => line !== null && line.kind === 'init')
  if (found === undefined) throw new Error(`fixture ${name} carries no init line`)
  return found
}

/** The value a flag takes in an argv vector, or null when the flag is absent. */
const flagValue = (argv: readonly string[], flag: string): string | null => {
  const at = argv.indexOf(flag)
  if (at === -1) return null
  return argv[at + 1] ?? null
}

/** A logger that captures what was warned, so the default-weak doctrine is asserted, not assumed. */
const captureWarn = (): { log: Logger; warnings: string[] } => {
  const warnings: string[] = []
  return {
    warnings,
    log: {
      debug: (): void => {},
      info: (): void => {},
      warn: (_fields, message): void => void warnings.push(message),
      error: (): void => {},
    },
  }
}

const silent = captureWarn().log

const KNOBS: ClaudeModelKnobs = {
  model: 'claude-sonnet-5',
  lightModel: null,
  planEffort: null,
  proposeEffort: null,
  buildEffort: null,
}

/** Narrows a raised error to the pipeline failure the assertions read, outside the test bodies. */
const asPipelineError = (raised: unknown): PipelineError => {
  if (raised instanceof PipelineError) return raised
  throw new Error(`expected a PipelineError, got ${JSON.stringify(raised)}`)
}

describe('parseNdjsonStream', () => {
  test('splits a recorded stream into parsed lines, skipping blanks and non-JSON', () => {
    const lines = parseNdjsonStream('{"type":"system"}\n\nnot json\n{"type":"result"}\n')

    expect(lines).toHaveLength(2)
  })
})

describe('decodeClaudeLine (recorded and documented shapes)', () => {
  test('decodes the recorded auth-failure turn: init line, assistant line, error-signalling result line', () => {
    // The init line's session id is a UUID; nothing else about the init line
    // is load-bearing, so nothing else is named.
    expect(initSessionIdOf('auth-error-turn.ndjson')).toMatch(/^[0-9a-f-]{36}$/u)

    // The load-bearing recorded fact: exit code 0 with `is_error: true` — the
    // error-to-non-zero-exit correlation is relied on for nothing.
    const result = resultOf('auth-error-turn.ndjson')
    expect(result.isError).toBe(true)
    expect(result.text).toContain('Not logged in')
    expect(result.usage).toEqual({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0 })
    expect(result.costUsd).toBe(0)
    expect(result.sessionId).toBe(initSessionIdOf('auth-error-turn.ndjson'))
  })

  test('decodes the success corpus: init, stream event, tool activity, result facts', () => {
    expect(decoded('success-turn.ndjson').map((line) => line?.kind)).toEqual([
      'init',
      'stream-event',
      'assistant',
      'tool-results',
      'assistant',
      'result',
    ])

    // Tool names only: the schema has nowhere for text content to land.
    expect(decoded('success-turn.ndjson')[1]).toEqual({ kind: 'stream-event', tool: 'Read' })
    expect(decoded('success-turn.ndjson')[2]).toEqual({ kind: 'assistant', tools: ['Read'] })
    expect(decoded('success-turn.ndjson')[3]).toEqual({ kind: 'tool-results', succeeded: 1, failed: 0 })

    const result = resultOf('success-turn.ndjson')
    expect(result.isError).toBe(false)
    expect(result.text).toContain('papai')
    expect(result.sessionId).toBe('0d9f2a55-7b3a-4c1e-9f0a-2f7c8d11ab02')
    // The four buckets the CLI reported and nothing derived: what the ceiling
    // counts is decided on the seam, not by a `total` field here whose name
    // promises every bucket and would go on inviting cache reads back in.
    expect(result.usage).toEqual({ input: 1052, output: 60, cacheWrite: 0, cacheRead: 0 })
    // Decoded, and never read as a budget — asserted by the adapter's tests.
    expect(result.costUsd).toBe(0.0123)
  })

  test('decodes the adversarial plan fixture: the Bash call comes back refused, not run', () => {
    // The permission-effect pin: a `Bash` call under the `plan` allowlist is
    // refused — `is_error: true` on the tool result — so the effective toolset
    // is the allowlist.
    expect(decoded('adversarial-plan-bash-refused.ndjson')).toContainEqual({
      kind: 'tool-results',
      succeeded: 0,
      failed: 1,
    })
  })

  test('decodes the resume fixture and reports the session it continued', () => {
    const result = resultOf('resume-turn.ndjson')

    expect(result.sessionId).toBe('5e1c7d33-2a44-4b5e-8c6a-7d3e9f20bc31')
    // A resumed turn re-reads the whole prior conversation out of cache; the
    // decoder reports that read, and the ceiling declines to charge for it.
    expect(result.usage).toEqual({ input: 1210, output: 28, cacheWrite: 0, cacheRead: 1052 })
  })

  test('the init line carries the credential source as an optional fact — recorded as "none" on the env-less route', () => {
    // The recorded corpus's init lines carry `"apiKeySource":"none"` — the
    // fact that proved the env OAuth token is never consulted under --bare.
    expect(initLineOf('auth-error-turn.ndjson').apiKeySource).toBe('none')

    // Absent stays a valid init line, decoding to null — an older CLI shape.
    const absent = decodeClaudeLine({
      type: 'system',
      subtype: 'init',
      session_id: 'b609b8c-2791-462d-83d1-47ae29c783ca',
    })
    expect(absent).toEqual({ kind: 'init', sessionId: 'b609b8c-2791-462d-83d1-47ae29c783ca', apiKeySource: null })

    // A helper-carried run reports its own source — the shape the OAuth
    // recording (change task 4.1) pins for real.
    const helper = decodeClaudeLine({
      type: 'system',
      subtype: 'init',
      session_id: 'c1f0e2a3-1111-2222-3333-444455556666',
      apiKeySource: 'apiKeyHelper',
    })
    expect(helper).toEqual({
      kind: 'init',
      sessionId: 'c1f0e2a3-1111-2222-3333-444455556666',
      apiKeySource: 'apiKeyHelper',
    })
  })

  test('skips unrecognized non-result lines without failing', () => {
    const strangers = [
      { type: 'system', subtype: 'compact_boundary' },
      { type: 'system' },
      { type: 'assistant', message: 'a string, not an object' },
      { type: 'totally-unknown' },
      { type: 'result', is_error: 'not a boolean' },
      'not even an object',
      null,
    ]

    for (const stranger of strangers) expect(decodeClaudeLine(stranger)).toBeNull()
  })
})

/**
 * Whether a decoded line's first window actually carries a utilization key.
 *
 * A helper rather than an inline check because the decoder *omits* what it does
 * not know, so "absent" and "present but undefined" are different outcomes and
 * only `in` tells them apart — and because a conditional belongs outside a test
 * body.
 */
const statesUtilization = (line: ReturnType<typeof decodeClaudeLine>): boolean =>
  line?.kind === 'rate-limit-event' && line.windows[0] !== undefined && 'utilization' in line.windows[0]

/** Every window named across a decoded stream, flattened — one line may name several. */
const windowNames = (lines: ReturnType<typeof decodeClaudeLine>[]): string[] =>
  lines.flatMap((line) => (line?.kind === 'rate-limit-event' ? line.windows.map((entry) => entry.window) : []))

describe('the rate-limit signature (design D4 of the native-OAuth change)', () => {
  // The native profile's proof of authentication is the subscription-shaped
  // rate-limit fact, because `apiKeySource` reads `none` on that path. The
  // decoder names it; the adapter ignores it — recorder evidence, never a
  // budget input (the total_cost_usd doctrine).

  /** The recorded line, quoted from native-success-turn.ndjson (2.1.239). */
  const RATE_LIMIT_LINE = {
    type: 'rate_limit_event',
    rate_limit_info: {
      status: 'allowed',
      resetsAt: 1_787_644_800,
      rateLimitType: 'five_hour',
      overageStatus: 'allowed',
      overageResetsAt: 1_788_220_800,
      isUsingOverage: false,
    },
    session_id: '02f52ec0-3fb5-4f3f-a702-66661e2a502c',
  }

  test('a rate_limit_event line decodes to the subscription fact: the window inside rate_limit_info', () => {
    // The recorded shape is a TOP-LEVEL `rate_limit_event` line — not a
    // system/subtype envelope — with the window nested in `rate_limit_info`.
    expect(decodeClaudeLine(RATE_LIMIT_LINE)).toMatchObject({
      kind: 'rate-limit-event',
      windows: [{ window: 'five_hour' }],
    })
  })

  test('the recorded native success turn carries the five-hour signature — the corpus pin', () => {
    // The genuine credentialed recording: an answered native turn whose
    // stream carries the subscription fact the recorder's proof leg reads.
    expect(windowNames(decoded('native-success-turn.ndjson'))).toContain('five_hour')
    const result = resultOf('native-success-turn.ndjson')
    expect(result.isError).toBe(false)
    expect(result.text.length).toBeGreaterThan(0)
  })

  /**
   * The 2.1.251 line, quoted from `stub-rate-limit-turn.ndjson` — recorded
   * hermetically against a stub Anthropic endpoint, so the bytes are the CLI's
   * own serializer's at zero cost (`claude-stub.integration.ts`).
   *
   * Two differences from the 2.1.239 line above, and the first is a *break*
   * rather than an addition: there is **no `rateLimitType` at all**. A schema
   * that requires one does not lose a field here — it fails the line and skips
   * the whole fact, which is how a rate-limit render would report nothing while
   * looking correctly implemented.
   */
  const UNIFIED_LINE = {
    type: 'rate_limit_event',
    rate_limit_info: {
      status: 'allowed',
      resetsAt: 1_788_005_782,
      overageStatus: 'allowed',
      overageResetsAt: 1_788_426_982,
      isUsingOverage: false,
      unifiedWindows: {
        five_hour: { utilization: 0.235, resetsAt: 1_788_005_782 },
        seven_day: { utilization: 0.412, resetsAt: 1_788_426_982 },
      },
    },
    session_id: '2737467a-46c1-49d4-8807-3e224677dcc4',
  }

  test('a line carrying no rateLimitType still decodes — the 2.1.251 shape', () => {
    expect(decodeClaudeLine(UNIFIED_LINE)).not.toBeNull()
  })

  test('every window the line carries is decoded, each with its own utilization and reset', () => {
    const decodedLine = decodeClaudeLine(UNIFIED_LINE)

    expect(decodedLine).toMatchObject({
      kind: 'rate-limit-event',
      windows: [
        { window: 'five_hour', utilization: 0.235, resetsAt: 1_788_005_782 },
        { window: 'seven_day', utilization: 0.412, resetsAt: 1_788_426_982 },
      ],
    })
  })

  test('the account-level status and overage ride on the line, not on a window', () => {
    expect(decodeClaudeLine(UNIFIED_LINE)).toMatchObject({
      status: 'allowed',
      overageStatus: 'allowed',
      overageResetsAt: 1_788_426_982,
      isUsingOverage: false,
    })
  })

  test('the recorded 2.1.251 turn decodes its windows — the corpus pin', () => {
    const lines = decoded('stub-rate-limit-turn.ndjson')
    const rate = lines.find((line) => line?.kind === 'rate-limit-event')

    expect(rate).toBeDefined()
    expect(rate).toMatchObject({
      windows: [
        { window: 'five_hour', utilization: 0.235 },
        { window: 'seven_day', utilization: 0.412 },
      ],
    })
  })

  test('the older shape still decodes, with its window and no utilization', () => {
    // 2.1.239 named one window at the top level and published no figure for it.
    // The decoder reads both shapes because the corpus carries both. The absent
    // key is asserted as absent rather than as `undefined`: the decoder omits
    // what it does not know, which is this workspace's idiom everywhere an
    // optional field is emitted.
    const line = decodeClaudeLine(RATE_LIMIT_LINE)

    expect(line?.kind).toBe('rate-limit-event')
    expect(line).toMatchObject({ windows: [{ window: 'five_hour', resetsAt: 1_787_644_800 }] })
    expect(statesUtilization(line)).toBe(false)
  })

  test('a malformed field degrades to unknown rather than failing its line', () => {
    // `unifiedWindows` describes itself `@internal` in the CLI's own schema, so
    // leniency here is load-bearing rather than defensive: a moved field must
    // cost that field, never the account-level fact beside it.
    const bent = decodeClaudeLine({
      type: 'rate_limit_event',
      rate_limit_info: {
        status: 'allowed',
        rateLimitType: 'five_hour',
        resetsAt: 'tuesday',
        unifiedWindows: { seven_day: { utilization: 'most of it', resetsAt: 1_788_426_982 } },
      },
    })

    expect(bent).toMatchObject({ kind: 'rate-limit-event', status: 'allowed' })
    expect(bent).toMatchObject({ windows: [{ window: 'seven_day', resetsAt: 1_788_426_982 }] })
    // The bent field, and only it, is gone: the window survives with its reset.
    expect(statesUtilization(bent)).toBe(false)
  })

  test('the window passes through as a string, never enumerated — other plans carry other windows', () => {
    const weekly = decodeClaudeLine({
      type: 'rate_limit_event',
      rate_limit_info: { status: 'allowed', rateLimitType: 'weekly' },
    })

    expect(weekly).toMatchObject({ kind: 'rate-limit-event', windows: [{ window: 'weekly' }] })
  })

  test('a stream without one stays valid — the fact is optional evidence, never a gate', () => {
    expect(decoded('success-turn.ndjson').some((line) => line?.kind === 'rate-limit-event')).toBe(false)
    expect(decoded('auth-error-turn.ndjson').some((line) => line?.kind === 'rate-limit-event')).toBe(false)
  })

  test('neighbouring shapes the decoder does not name still skip', () => {
    // The CLI's own system family is wider than this contract (`api_retry`),
    // a system-subtype spelling of the info name is not the line, and a
    // rate_limit_event whose info object is absent carries no fact to read.
    expect(decodeClaudeLine({ type: 'system', subtype: 'api_retry', attempt: 1, error_status: 401 })).toBeNull()
    expect(decodeClaudeLine({ type: 'system', subtype: 'rate_limit_info' })).toBeNull()
    expect(decodeClaudeLine({ type: 'rate_limit_event' })).toBeNull()
  })

  test('the <synthetic> model id in assistant lines lands nowhere — the names-only rule holds', () => {
    // Recorded on the native path: an auth-failure turn's assistant line
    // carries `model: "<synthetic>"` beside its text content. The assistant
    // schema has nowhere for a model id to land, so nothing of it survives.
    const line = decodeClaudeLine({
      type: 'assistant',
      message: { model: '<synthetic>', content: [{ type: 'text', text: 'Not logged in · Please run /login' }] },
    })

    expect(line).toEqual({ kind: 'assistant', tools: [] })
    expect(JSON.stringify(line)).not.toContain('<synthetic>')
  })
})

describe('buildClaudeArgv', () => {
  test('every invocation carries the determinism, output and permission flags', () => {
    const { argv } = buildClaudeArgv({ prompt: 'do the work' }, KNOBS, silent)

    expect(argv).toEqual([
      '--bare',
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'default',
      '--allowedTools',
      'Read,Glob,Grep',
      '--model',
      'claude-sonnet-5',
    ])
  })

  test('no invocation composes --settings — the credential-file carrier is retired', () => {
    // The retirement's own pin: the request field and its argv slot are gone,
    // so a merge mishap that reintroduces the composition fails here. A caller
    // smuggling the retired field past the type (the runtime cannot see it)
    // is ignored, not honoured — and bare argv stays byte-identical to the
    // shape above, the parent change's.
    const smuggled = { prompt: 'x', credentialSettingsFile: '/tmp/gone/settings.json' } as Parameters<
      typeof buildClaudeArgv
    >[0]

    expect(buildClaudeArgv(smuggled, KNOBS, silent).argv.includes('--settings')).toBe(false)
    expect(buildClaudeArgv({ prompt: 'x' }, KNOBS, silent).argv.includes('--settings')).toBe(false)
  })

  test('the prompt rides stdin, never argv', () => {
    const enveloped = 'ENVELOPE(nonce) do the work ENVELOPE(nonce)'
    const { argv, stdinPrompt } = buildClaudeArgv({ prompt: enveloped }, KNOBS, silent)

    expect(stdinPrompt).toBe(enveloped)
    expect(argv).not.toContain(enveloped)
  })

  test.each([
    ['plan', 'Read,Glob,Grep'],
    ['propose', 'Read,Edit,Write,Glob,Grep'],
    ['build', 'Read,Edit,Write,Bash,Glob,Grep'],
  ])('the %s profile gets its pinned allowlist', (agent, allowlist) => {
    const { argv } = buildClaudeArgv({ prompt: 'x', agent }, KNOBS, silent)

    expect(argv).toContain(allowlist)
    expect(flagValue(argv, '--allowedTools')).toBe(allowlist)
  })

  test('an unknown or absent profile gets the plan allowlist plus a warning', () => {
    const unknown = captureWarn()
    const absent = captureWarn()

    const unknownArgv = buildClaudeArgv({ prompt: 'x', agent: 'stranger' }, KNOBS, unknown.log).argv
    const absentArgv = buildClaudeArgv({ prompt: 'x' }, KNOBS, absent.log).argv

    expect(flagValue(unknownArgv, '--allowedTools')).toBe('Read,Glob,Grep')
    expect(flagValue(absentArgv, '--allowedTools')).toBe('Read,Glob,Grep')
    expect(unknown.warnings.join(' ')).toContain('stranger')
    expect(absent.warnings).toHaveLength(1)
  })

  test('the light model reaches plan turns only; build and propose keep the main model', () => {
    const knobs: ClaudeModelKnobs = { ...KNOBS, lightModel: 'claude-haiku-5' }

    const plan = buildClaudeArgv({ prompt: 'x', agent: 'plan' }, knobs, silent).argv
    const build = buildClaudeArgv({ prompt: 'x', agent: 'build' }, knobs, silent).argv
    const propose = buildClaudeArgv({ prompt: 'x', agent: 'propose' }, knobs, silent).argv

    expect(flagValue(plan, '--model')).toBe('claude-haiku-5')
    expect(flagValue(build, '--model')).toBe('claude-sonnet-5')
    expect(flagValue(propose, '--model')).toBe('claude-sonnet-5')
  })

  test('strips a provider/ prefix the way parseModelRef splits it; a slash-free id passes verbatim', () => {
    const gateway: ClaudeModelKnobs = { ...KNOBS, model: 'anthropic/claude-sonnet-5' }
    const hosted: ClaudeModelKnobs = { ...KNOBS, model: 'claude-sonnet-5' }
    const nested: ClaudeModelKnobs = { ...KNOBS, model: 'openrouter/anthropic/claude-sonnet-5' }

    expect(flagValue(buildClaudeArgv({ prompt: 'x' }, gateway, silent).argv, '--model')).toBe('claude-sonnet-5')
    expect(flagValue(buildClaudeArgv({ prompt: 'x' }, hosted, silent).argv, '--model')).toBe('claude-sonnet-5')
    // `parseModelRef` splits at the FIRST slash and keeps the whole remainder
    // as the model id, so a gateway-nested spelling keeps its own second slash.
    expect(flagValue(buildClaudeArgv({ prompt: 'x' }, nested, silent).argv, '--model')).toBe(
      'anthropic/claude-sonnet-5',
    )
  })

  test('effort is passed when the profile has one and omitted when it does not', () => {
    const knobs: ClaudeModelKnobs = { ...KNOBS, planEffort: 'low', proposeEffort: 'medium', buildEffort: 'high' }

    const plan = buildClaudeArgv({ prompt: 'x', agent: 'plan' }, knobs, silent).argv
    const build = buildClaudeArgv({ prompt: 'x', agent: 'build' }, knobs, silent).argv
    const propose = buildClaudeArgv({ prompt: 'x', agent: 'propose' }, knobs, silent).argv

    expect(flagValue(plan, '--effort')).toBe('low')
    expect(flagValue(propose, '--effort')).toBe('medium')
    expect(flagValue(build, '--effort')).toBe('high')
    // An unset tier is omitted, never invented — on every profile.
    expect(flagValue(buildClaudeArgv({ prompt: 'x', agent: 'plan' }, KNOBS, silent).argv, '--effort')).toBeNull()
    expect(flagValue(buildClaudeArgv({ prompt: 'x', agent: 'propose' }, KNOBS, silent).argv, '--effort')).toBeNull()
  })
})

describe('buildClaudeArgv (invocation profiles)', () => {
  // The credential spelling selects the profile (design D1): the API key
  // keeps the bare route byte-identical, the OAuth token runs the
  // neutralized native one. What differs is exactly the profile block at
  // the head of the argv — everything after it is shared, flag for flag.

  const MCP_PATH = '/tmp/job/empty-mcp.json'
  const NATIVE_BLOCK = ['--setting-sources', '', '--strict-mcp-config', '--mcp-config', MCP_PATH]

  test('the bare profile keeps today’s argv byte-identical, including --bare and no neutralization', () => {
    const defaulted = buildClaudeArgv({ prompt: 'x' }, KNOBS, silent).argv
    const explicit = buildClaudeArgv({ prompt: 'x', profile: 'bare' }, KNOBS, silent).argv

    expect(explicit).toEqual(defaulted)
    expect(explicit).toEqual([
      '--bare',
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'default',
      '--allowedTools',
      'Read,Glob,Grep',
      '--model',
      'claude-sonnet-5',
    ])
    for (const flag of ['--setting-sources', '--strict-mcp-config', '--mcp-config']) {
      expect(explicit.includes(flag)).toBe(false)
    }
  })

  test('the native profile omits --bare and carries the three neutralization flags', () => {
    const { argv } = buildClaudeArgv({ prompt: 'x', profile: 'native', mcpConfigPath: MCP_PATH }, KNOBS, silent)

    expect(argv).toEqual([
      ...NATIVE_BLOCK,
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'default',
      '--allowedTools',
      'Read,Glob,Grep',
      '--model',
      'claude-sonnet-5',
    ])
    expect(argv.includes('--bare')).toBe(false)
    // `--setting-sources ''` — the empty string is the argv element itself.
    expect(flagValue(argv, '--setting-sources')).toBe('')
    // A valueless flag: what follows it is the next flag, never its value.
    expect(argv.includes('--strict-mcp-config')).toBe(true)
    expect(flagValue(argv, '--mcp-config')).toBe(MCP_PATH)
  })

  test('every shared flag is identical on both profiles — the tail after the profile block', () => {
    const knobs: ClaudeModelKnobs = { ...KNOBS, lightModel: 'claude-haiku-5', planEffort: 'low' }
    const request = {
      prompt: 'do the work',
      system: 'You are the papai agent.',
      agent: 'plan',
      resumeSessionId: 'abc-123',
    } as const

    const bare = buildClaudeArgv({ ...request, profile: 'bare' }, knobs, silent)
    const native = buildClaudeArgv({ ...request, profile: 'native', mcpConfigPath: MCP_PATH }, knobs, silent)

    // One block of five replaces one block of one; everything after is shared.
    expect(native.argv.slice(NATIVE_BLOCK.length)).toEqual(bare.argv.slice(1))
    expect(native.stdinPrompt).toBe(bare.stdinPrompt)
    for (const flag of ['-p', '--verbose', '--resume']) {
      expect(native.argv.includes(flag)).toBe(true)
    }
    expect(flagValue(native.argv, '--output-format')).toBe('stream-json')
    expect(flagValue(native.argv, '--permission-mode')).toBe('default')
    expect(flagValue(native.argv, '--allowedTools')).toBe('Read,Glob,Grep')
    expect(flagValue(native.argv, '--model')).toBe('claude-haiku-5')
    expect(flagValue(native.argv, '--effort')).toBe('low')
    expect(flagValue(native.argv, '--resume')).toBe('abc-123')
    expect(flagValue(native.argv, '--append-system-prompt')).toBe('You are the papai agent.')
  })

  test('the native profile without an MCP document path refuses before anything spawns', () => {
    let raised: unknown
    try {
      buildClaudeArgv({ prompt: 'x', profile: 'native' }, KNOBS, silent)
    } catch (error) {
      raised = error
    }

    const error = asPipelineError(raised)
    expect(error.code).toBe('CLAUDE_PROFILE')
    expect(error.message).toContain('--mcp-config')
  })

  test('no argv on either profile ever carries a credential value or name', () => {
    const values = ['sk-ant-api03-a-real-shaped-key', 'sk-ant-oat01-a-real-shaped-token']

    for (const profile of ['bare', 'native'] as const) {
      const { argv, stdinPrompt } = buildClaudeArgv(
        { prompt: 'ENVELOPE(nonce) do the work ENVELOPE(nonce)', profile, mcpConfigPath: MCP_PATH },
        KNOBS,
        silent,
      )
      const joined = argv.join(' ')

      for (const value of values) {
        expect(joined.includes(value)).toBe(false)
        expect(stdinPrompt.includes(value)).toBe(false)
      }
      expect(joined.includes('ANTHROPIC_API_KEY')).toBe(false)
      expect(joined.includes('CLAUDE_CODE_OAUTH_TOKEN')).toBe(false)
    }
  })

  test('chains the memoized session id as --resume, and spawns fresh when none is memoized', () => {
    const resumed = buildClaudeArgv({ prompt: 'x', resumeSessionId: 'abc-123' }, KNOBS, silent).argv
    const fresh = buildClaudeArgv({ prompt: 'x', resumeSessionId: null }, KNOBS, silent).argv

    expect(flagValue(resumed, '--resume')).toBe('abc-123')
    expect(fresh).not.toContain('--resume')
    expect(buildClaudeArgv({ prompt: 'x' }, KNOBS, silent).argv).not.toContain('--resume')
  })

  test('the system prompt rides --append-system-prompt, verbatim', () => {
    const system = 'You are the papai agent. Envelope rule applies.'
    const { argv } = buildClaudeArgv({ prompt: 'x', system }, KNOBS, silent)

    expect(flagValue(argv, '--append-system-prompt')).toBe(system)
  })

  test('never composes --dangerously-skip-permissions, under any profile', () => {
    const profiles: ReadonlyArray<string | undefined> = ['plan', 'propose', 'build', 'stranger', undefined]

    for (const agent of profiles) {
      const { argv } = buildClaudeArgv({ prompt: 'x', agent }, KNOBS, silent)

      expect(argv).not.toContain('--dangerously-skip-permissions')
    }
  })
})

describe('the retired credential-file writer', () => {
  test('claude-credential.ts is deleted and no src module names it', () => {
    // The writer was the helper route's file-side mechanism, and that route
    // does not ship (design D2): the module is gone outright, and no src
    // module — comment included — may name it back into existence. The
    // recorder's dummy-helper leg writes its own files; production never
    // materializes a credential file.
    const src = path.join(import.meta.dir, '..', '..', 'opencode-agent', 'src')

    expect(existsSync(path.join(src, 'claude-credential.ts'))).toBe(false)
    const modules = readdirSync(src, { recursive: true })
      .map((entry) => String(entry))
      .filter((name) => name.endsWith('.ts'))
    for (const file of modules) {
      expect(readFileSync(path.join(src, file), 'utf8')).not.toContain('claude-credential')
    }
  })
})

describe('the MAX_ARG_STRLEN refusal', () => {
  test('refuses an appended system prompt over the cap, naming the size, the cap and the remedy', () => {
    const oversized = `x`.repeat(MAX_ARG_STRLEN + 1)

    let raised: unknown
    try {
      buildClaudeArgv({ prompt: 'x', system: oversized }, KNOBS, silent)
    } catch (error) {
      raised = error
    }

    const error = asPipelineError(raised)
    expect(error.code).toBe('CLAUDE_ARG_LIMIT')
    expect(error.message).toContain((MAX_ARG_STRLEN + 1).toLocaleString('en-US'))
    expect(error.message).toContain(MAX_ARG_STRLEN.toLocaleString('en-US'))
    expect(error.message).toContain('skill')
  })

  test('composes at exactly the cap — the refusal is for exceeding it', () => {
    const atCap = `x`.repeat(MAX_ARG_STRLEN)

    expect(() => buildClaudeArgv({ prompt: 'x', system: atCap }, KNOBS, silent)).not.toThrow()
  })
})
