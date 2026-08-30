// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * The credential-free half of the claude corpus: drive the real pinned CLI
 * against a stub Anthropic endpoint and record what its own serializer emits.
 *
 * Run it with:
 *
 *   bun run opencode-agent:test:claude-stub
 *
 * **Why this exists beside `claude-live.integration.ts`.** That lane is a
 * credentialed artifact — it costs real model spend and only a token holder can
 * run it — and for a long time that made the `rate_limit_event` line
 * unrecordable for anyone else. But the line is built by the CLI from response
 * *headers*, and the CLI honours `ANTHROPIC_BASE_URL`, so an endpoint that
 * answers with the `anthropic-ratelimit-unified-*` headers makes the CLI emit
 * the real line at zero cost. The bytes are the CLI's own, which is what the
 * corpus means by *recorded*; the technique is `live-sdk.integration.ts`'s ("a
 * stub OpenAI-compatible endpoint stands in for the provider") carried to this
 * route.
 *
 * **What it proves, and what it must never be read as proving.** It pins the
 * *shape* of what the CLI emits. It cannot prove authentication: the native
 * profile's proof is that a real subscription answered, and a stub answering
 * proves only that a stub answered. `claude-live.integration.ts` remains the
 * authentication artifact and keeps its own provenance.
 *
 * The token below is deliberately invalid and never leaves the loopback socket.
 * It exists because the CLI selects the native profile by the *spelling* of the
 * credential (design D1), so recording that profile needs the variable set —
 * not a working value.
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { z } from 'zod'

import { decodeClaudeLine, parseNdjsonStream } from '../../opencode-agent/src/claude-contract.js'

const FIXTURES = path.join(import.meta.dir, 'fixtures', 'claude-cli')

/** Loopback only, and a port unlikely to collide with a developer's own servers. */
const STUB_PORT = 34_199

/**
 * Never a real credential. The native profile is selected by the credential's
 * spelling, so the recording needs the variable present and does not need it to
 * work — every request goes to the loopback stub.
 */
const STUB_TOKEN = 'sk-ant-oat01-stub-not-a-real-token'

/**
 * The window figures the stub reports, chosen to be unmistakable in a fixture:
 * neither is a round number, and the two differ, so a renderer that crosses them
 * over or prints one twice fails visibly rather than plausibly.
 */
const FIVE_HOUR_UTILIZATION = 0.235
const SEVEN_DAY_UTILIZATION = 0.412

const check = (label: string, ok: boolean, detail: string): boolean => {
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ` — ${detail}`}`)
  return ok
}

/** One Anthropic streaming turn, as the CLI expects to read it back. */
const sseBody = (): string =>
  (
    [
      [
        'message_start',
        {
          type: 'message_start',
          message: {
            id: 'msg_stub',
            type: 'message',
            role: 'assistant',
            model: 'claude-sonnet-5',
            content: [],
            stop_reason: null,
            stop_sequence: null,
            // Every bucket non-zero and distinct: a fixture whose cache counts
            // are 0 cannot tell a decoder that drops them from one that reads
            // them, which is the bug `sdk-contract.ts` carries a note about on
            // the other route.
            usage: {
              input_tokens: 12,
              output_tokens: 1,
              cache_creation_input_tokens: 3400,
              cache_read_input_tokens: 5600,
            },
          },
        },
      ],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
      [
        'content_block_delta',
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'stub reply' } },
      ],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      [
        'message_delta',
        { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 7 } },
      ],
      ['message_stop', { type: 'message_stop' }],
    ] as Array<[string, unknown]>
  )
    .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    .join('')

/**
 * The headers the whole lane exists for.
 *
 * `-5h-` and `-7d-` are what the CLI folds into `unifiedWindows`; the resets are
 * future-dated because the CLI drops a window whose reset has already passed,
 * which would silently record an empty object.
 */
const rateLimitHeaders = (): Record<string, string> => {
  const now = Math.floor(Date.now() / 1000)
  return {
    'anthropic-ratelimit-unified-status': 'allowed',
    'anthropic-ratelimit-unified-reset': String(now + 3 * 3600),
    'anthropic-ratelimit-unified-5h-utilization': String(FIVE_HOUR_UTILIZATION),
    'anthropic-ratelimit-unified-5h-reset': String(now + 3 * 3600),
    'anthropic-ratelimit-unified-7d-utilization': String(SEVEN_DAY_UTILIZATION),
    'anthropic-ratelimit-unified-7d-reset': String(now + 5 * 86_400),
    'anthropic-ratelimit-unified-overage-status': 'allowed',
    'anthropic-ratelimit-unified-overage-reset': String(now + 5 * 86_400),
    'anthropic-ratelimit-unified-overage-utilization': '0.08',
    'anthropic-ratelimit-unified-overage-in-use': 'false',
  }
}

const startStub = (): { stop: () => Promise<void> } => {
  const server = Bun.serve({
    port: STUB_PORT,
    hostname: '127.0.0.1',
    fetch: () => new Response(sseBody(), { headers: { 'content-type': 'text/event-stream', ...rateLimitHeaders() } }),
  })
  return {
    stop: async (): Promise<void> => {
      await server.stop(true)
    },
  }
}

/**
 * One turn, driven on the native profile's own mandatory flags (design D1:
 * `--setting-sources ''` plus `--strict-mcp-config --mcp-config <empty>`), in a
 * throwaway config dir and a throwaway workspace.
 *
 * `env` is built from nothing rather than inherited: a recorder that picked up
 * the operator's own `ANTHROPIC_*` variables could authenticate against the real
 * API by accident, which is the one thing a zero-spend lane must not be able to
 * do.
 *
 * Spawned **asynchronously** and awaited, which is not a style choice: the stub
 * serves from this same process, and a synchronous spawn blocks the event loop
 * that would answer it. The first draft used `spawnSync` and the CLI hung on a
 * request the stub could not reach until its own 90s timeout killed it —
 * recorded here because the failure looks exactly like an unreachable endpoint.
 */
const recordTurn = async (): Promise<{ stdout: string; exitCode: number }> => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-stub-'))
  const configDir = path.join(home, 'cfg')
  const workspace = path.join(home, 'work')
  fs.mkdirSync(configDir)
  fs.mkdirSync(workspace)
  const mcpConfig = path.join(configDir, 'empty-mcp.json')
  fs.writeFileSync(mcpConfig, JSON.stringify({ mcpServers: {} }))

  try {
    const child = Bun.spawn(
      [
        'claude',
        '--setting-sources',
        '',
        '--strict-mcp-config',
        '--mcp-config',
        mcpConfig,
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
        '--model',
        'claude-sonnet-5',
        'say hi',
      ],
      {
        cwd: workspace,
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
          HOME: home,
          PATH: process.env['PATH'] ?? '/usr/bin:/bin',
          CLAUDE_CONFIG_DIR: configDir,
          ANTHROPIC_BASE_URL: `http://127.0.0.1:${STUB_PORT}`,
          CLAUDE_CODE_OAUTH_TOKEN: STUB_TOKEN,
        },
      },
    )
    const timer = setTimeout(() => {
      child.kill()
    }, 90_000)
    const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited])
    clearTimeout(timer)
    return { stdout, exitCode }
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
}

const main = async (): Promise<void> => {
  const stub = startStub()
  let results: boolean[] = []
  let stdout = ''

  try {
    const turn = await recordTurn()
    stdout = turn.stdout
    results.push(check('the CLI completed a turn against the stub', turn.exitCode === 0, `exit ${turn.exitCode}`))
  } finally {
    await stub.stop()
  }

  /**
   * Read back through schemas rather than casts.
   *
   * This lane's whole point is to observe what the CLI *actually* emitted, and a
   * type assertion would describe what it was hoped to emit — the observation
   * would then be made by the assertion instead of by the recording.
   */
  const parsed = parseNdjsonStream(stdout)
  const lines = parsed.map((raw) => ({ raw, decoded: decodeClaudeLine(raw) }))

  const figureSchema = z.object({ utilization: z.number().optional(), resetsAt: z.number().optional() })
  const firstOf = <T>(schema: z.ZodType<T>): T | undefined => {
    for (const raw of parsed) {
      const seen = schema.safeParse(raw)
      if (seen.success) return seen.data
    }
    return undefined
  }

  const rawRate = firstOf(
    z.object({
      type: z.literal('rate_limit_event'),
      rate_limit_info: z.looseObject({ unifiedWindows: z.record(z.string(), figureSchema).optional() }),
    }),
  )
  const windows = rawRate?.rate_limit_info.unifiedWindows
  const rawResult = firstOf(
    z.object({
      type: z.literal('result'),
      total_cost_usd: z.number().optional(),
      usage: z.record(z.string(), z.unknown()).optional(),
    }),
  )
  const init = firstOf(
    z.object({
      subtype: z.literal('init'),
      mcp_servers: z.array(z.unknown()).optional(),
      skills: z.array(z.unknown()).optional(),
      apiKeySource: z.string().optional(),
    }),
  )
  const tokenCount = (name: string): number => {
    const seen = z.number().safeParse(rawResult?.usage?.[name])
    return seen.success ? seen.data : 0
  }

  /**
   * Two groups, and the split is load-bearing rather than tidy.
   *
   * The first is evidence about the **CLI**: what its serializer emitted. The
   * second is an assertion about **papai**: whether our decoder reads it. Only
   * the first gates the write, because the recording is the ground truth a
   * broken decoder is diagnosed *against* — gating it on our own decoder
   * agreeing would mean a decoder regression could no longer be re-recorded,
   * which is exactly backwards. Both gate the exit code.
   */
  const recording: boolean[] = []
  recording.push(
    check('the stream carries a rate_limit_event line', rawRate !== undefined, 'no rate-limit line was emitted'),
    check(
      'the five-hour window reports its utilization and reset',
      windows?.['five_hour']?.utilization === FIVE_HOUR_UTILIZATION && windows['five_hour']?.resetsAt !== undefined,
      `got ${JSON.stringify(windows?.['five_hour'])}`,
    ),
    check(
      'the seven-day window reports its own utilization and reset',
      windows?.['seven_day']?.utilization === SEVEN_DAY_UTILIZATION && windows['seven_day']?.resetsAt !== undefined,
      `got ${JSON.stringify(windows?.['seven_day'])}`,
    ),
    // The finding that turned a decoder widening into a decoder *fix*: the
    // recorded line carries no `rateLimitType` at all, and a schema that
    // requires one skips the whole line rather than losing a field.
    check(
      'the recorded line carries no rateLimitType, so the decoder must not require one',
      rawRate !== undefined && rawRate.rate_limit_info['rateLimitType'] === undefined,
      rawRate === undefined
        ? 'there was no line to check — this claim is only meaningful once one is recorded'
        : 'a rateLimitType appeared; re-record and revisit the decoder',
    ),
    check(
      'the result line prices the turn',
      (rawResult?.total_cost_usd ?? 0) > 0,
      `total_cost_usd was ${String(rawResult?.total_cost_usd)}`,
    ),
    check(
      'the result line carries every cache bucket, so the ladder can reprice it',
      tokenCount('cache_creation_input_tokens') > 0 && tokenCount('cache_read_input_tokens') > 0,
      `usage was ${JSON.stringify(rawResult?.usage)}`,
    ),
  )

  const version = spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout?.trim().split(' ')[0] ?? ''
  recording.push(check('the CLI reports a version to stamp the corpus with', /^\d+\.\d+\.\d+$/u.test(version), version))

  if (recording.every(Boolean)) {
    fs.writeFileSync(path.join(FIXTURES, 'stub-rate-limit-turn.ndjson'), stdout)
    fs.writeFileSync(path.join(FIXTURES, 'VERSION'), `${version}\n`)
    // Its own file, never a merge into `facts.json`. That file is the
    // credentialed lane's record, and a hermetic run has not re-answered the
    // legs it covers — overwriting the ones it happens to share would leave the
    // rest reading as current when nothing re-measured them. The census pins
    // this lane *can* answer at zero spend are the ones the init line carries,
    // which is exactly what `opencode-agent/CLAUDE.md`'s route rule asks for
    // before a credentialed turn.
    fs.writeFileSync(
      path.join(FIXTURES, 'stub-facts.json'),
      `${JSON.stringify(
        {
          cliVersion: version,
          stubCensusMcpServers: JSON.stringify(init?.mcp_servers ?? 'absent'),
          stubCensusSkillCount: String(init?.skills?.length ?? 'absent'),
          stubApiKeySource: init?.apiKeySource ?? 'absent',
          stubProofWindows: (windows === undefined ? [] : Object.keys(windows)).join(',') || 'none',
          stubFiveHourUtilization: String(windows?.['five_hour']?.utilization ?? 'absent'),
          stubSevenDayUtilization: String(windows?.['seven_day']?.utilization ?? 'absent'),
          stubResultCostUsd: String(rawResult?.total_cost_usd ?? 'absent'),
        },
        null,
        2,
      )}\n`,
    )
    console.log(`\nrecorded stub-rate-limit-turn.ndjson, stub-facts.json, and stamped VERSION ${version}`)
  } else {
    console.log('\nnothing recorded — the CLI did not emit what this lane exists to capture')
  }

  const readsIt = check(
    'the pipeline’s own decoder recognizes the recorded line',
    lines.some((line) => line.decoded?.kind === 'rate-limit-event'),
    'decodeClaudeLine skipped it — the recording above is what to fix the decoder against',
  )

  results = [...results, ...recording, readsIt]
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`)
  process.exit(results.every(Boolean) ? 0 : 1)
}

await main()
