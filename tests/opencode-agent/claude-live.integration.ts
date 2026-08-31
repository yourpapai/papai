// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * The contract check the unit tests cannot make: drive the real pinned `claude`
 * CLI, through the finished adapter, and record the fixture corpus.
 *
 * Not named `*.test.ts` on purpose — the credentialed mode needs an API key
 * and the `claude` binary, costs real model spend, and never runs in CI. Run
 * it with:
 *
 *   bun run opencode-agent:test:claude-live
 *
 * Two modes, chosen by which Anthropic spelling the environment carries
 * (both set is refused, exactly as the config guard refuses it):
 *
 * - `ANTHROPIC_API_KEY` — the credentialed recording of the **bare**
 *   profile. The full corpus behaviours run through the adapter's own argv
 *   composition, so a flag the pinned CLI no longer accepts fails here at
 *   recording cost.
 * - `CLAUDE_CODE_OAUTH_TOKEN` — the **native** profile's recording (design
 *   D5 of `claude-native-oauth-profile`), cheapest legs first: the free
 *   un-credentialed census (init line `mcp_servers: []`, built-ins-only
 *   skills, a `/context` census with no memory-file row), the dummy-token
 *   instant-401 negative, then the credentialed proof turn — reply text plus
 *   the `rate_limit_event` five-hour subscription signature — and the
 *   adapter-corpus turns including the WebFetch adversarial refusal. A dummy
 *   token runs the free legs green and fails the credentialed legs loudly:
 *   the recorder is a credentialed artifact.
 *
 * The standing negative helper leg (both modes, design D3 of
 * `claude-apikeyhelper-credential-route`) is self-contained and zero-spend by
 * construction: it materializes its own deliberately invalid dummy token
 * behind the CLI's `apiKeyHelper` shape in a throwaway config dir, deletes
 * both env spellings, and drives one `--bare --settings` invocation. It
 * asserts the two observations the 2026-08-25 recording settled on CLI
 * 2.1.239 — the init line reports the helper as the credential source
 * (`apiKeySource: "apiKeyHelper"`: the CLI loads it), and the turn ends in
 * the recorded API-refusal shape (`is_error: true`, the 401
 * `authentication_failed` refusal over the retry ladder, a synthetic
 * assistant message, usage zero). A CLI pin move that breaks either half —
 * the helper stops loading, or OAuth over the helper starts succeeding —
 * fails the leg loudly, naming the change. The leg's init line is stamped as
 * `oauth-helper-init.ndjson`; the wall time is the retry ladder's (~3 min
 * recorded), not spend.
 *
 * What one credentialed invocation additionally produces and asserts, whole
 * (the scenarios share the run and cannot be recorded or verified apart):
 *
 *  1. the determinism facts: `--output-format stream-json` requires
 *     `--verbose` with `-p`, `CLAUDE_CONFIG_DIR` is honored,
 *     `DISABLE_AUTOUPDATER=1` keeps `--version` unchanged after the run, a
 *     non-zero exit produces a stderr tail, and the token total accumulates
 *     across turns the way the adapter's sum fold expects;
 *  2. the corpus behaviours: the successful turn, the resume flow, the
 *     adversarial plan-profile turn whose prompt attempts a `Bash` call and
 *     must come back refused under `--permission-mode default` — the
 *     permission-effect pin, not assumed from docs — and the error-signalling
 *     result line, taken from a deliberately un-credentialed turn (the real
 *     auth-failure shape, costing nothing); every adapter boot's config dir
 *     stays credential-file-free (the helper carrier is retired), and no
 *     spawned env ever carries the OAuth spelling;
 *  3. the stop semantics a fixture cannot state: a live turn running a long
 *     `Bash` child is `abort()`ed and no member of its process group survives,
 *     and a follow-up prompt `--resume`s the memoized session after the killed
 *     turn and answers.
 *
 * The recorded CLI's exact version is stamped into `VERSION` beside the
 * fixtures by the credentialed modes; `workflow.test.ts` asserts it equals the
 * workflow's install pin, so fixture and binary cannot silently skew. The
 * `.ndjson` corpus beside it is refreshed by the same run: after this recorder
 * goes green, re-run it with `CLAUDE_LIVE_REFRESH_FIXTURES=1` to overwrite the
 * provisional fixture files with the recorded streams.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { createClaudeAgent } from '../../opencode-agent/src/claude-adapter.js'
import type { ClaudeAgentOptions } from '../../opencode-agent/src/claude-adapter.js'
import { buildClaudeArgv } from '../../opencode-agent/src/claude-argv.js'
import type { ClaudeModelKnobs } from '../../opencode-agent/src/claude-argv.js'
import { createClaudeConfigDir, writeClaudeEmptyMcpConfig } from '../../opencode-agent/src/claude-config-dir.js'
import { liveSpawn } from '../../opencode-agent/src/claude-connect.js'
import type { SpawnClaude } from '../../opencode-agent/src/claude-connect.js'
import { decodeClaudeLine, parseNdjsonStream } from '../../opencode-agent/src/claude-contract.js'
import type { ClaudeCredential } from '../../opencode-agent/src/config-values.js'
import type { OpenCodeAgent } from '../../opencode-agent/src/opencode-adapter.js'

const FIXTURES = path.join(import.meta.dir, 'fixtures', 'claude-cli')
const REFRESH_FIXTURES = process.env['CLAUDE_LIVE_REFRESH_FIXTURES'] === '1'

/**
 * The dummy the negative leg materializes: deliberately invalid, so the API's
 * refusal costs nothing. The only string the env's `CLAUDE_CODE_OAUTH_TOKEN`
 * mode switch ever relates to — the value itself never reaches a child.
 */
const DUMMY_OAUTH_TOKEN = 'sk-ant-oat01-invalid-dummy-zero-spend'

/** Bounds the negative leg: the recorded retry ladder settles in ~3 min; the init line lands long before. */
const NEGATIVE_LEG_TIMEOUT_MS = 300_000

const check = (label: string, condition: boolean, detail: string): boolean => {
  process.stdout.write(`${condition ? '✓' : '✗'} ${label}${condition ? '' : ` — ${detail}`}\n`)
  return condition
}

/**
 * Which mode this run takes, read under the guard's own exclusivity rule: the
 * API key records the bare profile's credentialed corpus; the OAuth spelling
 * records the native profile — its free census and negative legs at zero
 * spend, its proof legs against whatever token is held (a dummy fails them
 * loudly).
 */
const readMode = (): { mode: 'api-key'; value: string } | { mode: 'oauth'; value: string } | null => {
  const apiKey = process.env['ANTHROPIC_API_KEY']?.trim()
  const oauth = process.env['CLAUDE_CODE_OAUTH_TOKEN']?.trim()
  if (apiKey !== undefined && apiKey.length > 0 && oauth !== undefined && oauth.length > 0) {
    process.stdout.write('✗ Both ANTHROPIC_API_KEY and CLAUDE_CODE_OAUTH_TOKEN are set; exactly one may be.\n')
    return null
  }
  if (apiKey !== undefined && apiKey.length > 0) return { mode: 'api-key', value: apiKey }
  if (oauth !== undefined && oauth.length > 0) return { mode: 'oauth', value: oauth }
  process.stdout.write(
    '✗ No credential: set ANTHROPIC_API_KEY for the bare corpus or CLAUDE_CODE_OAUTH_TOKEN for the native one ' +
      '(real model spend, never in CI) — or any dummy value for the free legs alone.\n',
  )
  return null
}

const silentLog = {
  debug: (): void => {},
  info: (): void => {},
  warn: (): void => {},
  error: (): void => {},
}

/** Every argv the adapter composed, captured by wrapping the real spawn. */
const argvCalls: Array<readonly string[]> = []

/** Every child env the adapter spawned with — read back for the carrier checks, never printed. */
const envCalls: Array<Record<string, string>> = []

/** What one config dir held at its first spawn — the retirement says: no credential file, ever. */
interface ConfigDirProbe {
  configDir: string
  helper: boolean
  settings: boolean
}

const configDirProbes: ConfigDirProbe[] = []
const probedDirs = new Set<string>()

const recordingSpawn: SpawnClaude = (binary, argv, options) => {
  argvCalls.push([binary, ...argv])
  envCalls.push(options.env)
  const dir = options.env['CLAUDE_CONFIG_DIR'] ?? ''
  if (!probedDirs.has(dir)) {
    probedDirs.add(dir)
    configDirProbes.push({
      configDir: dir,
      helper: existsSync(path.join(dir, 'credential.sh')),
      settings: existsSync(path.join(dir, 'settings.json')),
    })
  }
  return liveSpawn(binary, argv, options)
}

/** The CLI's version, as the recorder stamps it into the fixture directory. */
const cliVersion = (): string => spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout.trim()

/**
 * The bare semver the workflow's install pin spells — `claude --version`
 * answers `2.1.239 (Claude Code)`, and `workflow.test.ts` compares the stamp
 * against `@anthropic-ai/claude-code@2.1.239`, so the suffix is dropped here
 * and nowhere else (facts.json keeps the full string).
 */
const pinnedSemver = (version: string): string => /^\d+\.\d+\.\d+/u.exec(version)?.[0] ?? version

/**
 * Runs one raw CLI invocation and hands back exit code and both streams. The
 * optional timeout bounds the negative leg: a refused token makes the CLI
 * retry ten times with exponential backoff (a recorded fact — minutes), and
 * the init line the leg reads arrives long before the retries settle, so a
 * bounded kill still lands the facts.
 */
const rawRun = (
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  input = '',
  timeoutMs?: number,
  cwd?: string,
): { code: number; stdout: string; stderr: string } => {
  const child = spawnSync('claude', [...argv], {
    encoding: 'utf8',
    env,
    input,
    ...(cwd === undefined ? {} : { cwd }),
    ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }),
  })
  return {
    code: child.status ?? -1,
    stdout: child.stdout ?? '',
    stderr: child.stderr ?? '',
  }
}

interface AgentEnv {
  /** The environment the adapter spawned under — the recorder reads it back for facts. */
  readonly env: NodeJS.ProcessEnv
  readonly agent: OpenCodeAgent
}

/** Boots one adapter over the given environment, capturing every argv. A null credential is the un-credentialed leg. */
const agentFor = async (credential: ClaudeCredential | null, env: NodeJS.ProcessEnv): Promise<AgentEnv> => {
  const options: ClaudeAgentOptions = {
    directory: process.cwd(),
    knobs: recorderKnobs(),
    // Only `provider`/`model` are read here, for the cost catalogue lookup.
    pricing: { apiKey: 'unused', baseUrl: 'unused', model: recorderKnobs().model, provider: 'anthropic' },
    ...(credential === null ? {} : { credential }),
    env,
    log: silentLog,
    spawn: recordingSpawn,
    timeoutMs: 300_000,
    heartbeatMs: 60_000,
  }
  return { env, agent: await createClaudeAgent(options) }
}

/** The knobs the recorder composes with — the same plain values the pipeline crosses. */
const recorderKnobs = (): ClaudeModelKnobs => ({
  model: process.env['LLM_MODEL'] ?? 'sonnet',
  lightModel: null,
  planEffort: null,
  buildEffort: null,
})

/** One corpus turn's outcome: the reply when it answered, the message when it rejected. */
interface SafeTurn {
  reply: Awaited<ReturnType<OpenCodeAgent['prompt']>> | null
  error: string
}

const safePrompt = (agent: OpenCodeAgent, request: Parameters<OpenCodeAgent['prompt']>[0]): Promise<SafeTurn> =>
  agent.prompt(request).then(
    (reply): SafeTurn => ({ reply, error: '' }),
    (error: unknown): SafeTurn => ({
      reply: null,
      error: error instanceof Error ? error.message : String(error),
    }),
  )

/** The why a safePrompt turn rejected — '' when it answered; first 200 chars, never a value. */
const why = (turn: SafeTurn | null): string =>
  turn === null ? 'no turn ran' : turn.error === '' ? 'answered' : turn.error.slice(0, 200)

/**
 * A permission refusal as the reply text reads on either profile — recorded,
 * not guessed: the bare route's model says "cannot/refused/not allowed",
 * the native profile's says "I don't have permission … grant … approve"
 * (native-success run, 2.1.239). Both mean the call did not happen.
 */
const readsAsRefusal = (text: string): boolean =>
  /cannot|refused|not (?:able|allowed|permitted)|can't|unable|won't|permission|grant|approve/u.test(text)

/** One live `claude` process this run spawned, by pid and process group. */
interface ProcEntry {
  pid: number
  pgid: number
}

/** Every process whose argv looks like this run's `claude --bare` invocations. */
const claudeProcesses = (): ProcEntry[] =>
  spawnSync('ps', ['-eo', 'pid=,pgid=,args='], { encoding: 'utf8' })
    .stdout.split('\n')
    .filter((line) => /claude .*--bare/u.test(line) && !/claude-live/u.test(line))
    .map((line) => {
      const [pid, pgid] = line.trim().split(/\s+/u)
      return {
        pid: Number.parseInt(pid ?? '0', 10),
        pgid: Number.parseInt(pgid ?? '0', 10),
      }
    })
    .filter((entry) => entry.pid > 0)

/** The pids in one process group. */
const groupMembers = (pgid: number): number[] =>
  spawnSync('ps', ['-o', 'pid=', '-g', String(pgid)], { encoding: 'utf8' })
    .stdout.split('\n')
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((pid) => Number.isSafeInteger(pid) && pid > 0)

/**
 * The standing zero-spend negative leg (design D3): the dead end re-recorded.
 *
 * Self-contained by construction — the writer the production route retired
 * never existed for this leg, which owns its throwaway dir: a dummy token
 * behind the CLI's own `apiKeyHelper` shape, named via `--settings` on a
 * `--bare` invocation, both env spellings deleted. Returns the leg's checks
 * and stamps its init-line fixture plus its facts; the two observations it
 * asserts are exactly the recording the startup refusal cites.
 */
const negativeHelperLeg = (facts: Record<string, string>): boolean[] => {
  const helperDir = createClaudeConfigDir(tmpdir())
  const helperScript = path.join(helperDir, 'credential.sh')
  const settingsFile = path.join(helperDir, 'settings.json')
  writeFileSync(helperScript, `#!/bin/sh\nprintf '%s' '${DUMMY_OAUTH_TOKEN}'`, {
    mode: 0o700,
  })
  writeFileSync(settingsFile, JSON.stringify({ apiKeyHelper: helperScript }), {
    mode: 0o600,
  })

  const legEnv: NodeJS.ProcessEnv = {
    ...process.env,
    CLAUDE_CONFIG_DIR: helperDir,
  }
  Reflect.deleteProperty(legEnv, 'ANTHROPIC_API_KEY')
  Reflect.deleteProperty(legEnv, 'CLAUDE_CODE_OAUTH_TOKEN')

  const startedAt = Date.now()
  const outcome = rawRun(
    [
      '--bare',
      '--settings',
      settingsFile,
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'default',
      '--allowedTools',
      'Read,Glob,Grep',
      '--model',
      process.env['LLM_MODEL'] ?? 'sonnet',
    ],
    legEnv,
    'Reply with the single word ready.',
    NEGATIVE_LEG_TIMEOUT_MS,
  )
  const elapsedMs = Date.now() - startedAt

  const parsed = parseNdjsonStream(outcome.stdout)
  const initAt = parsed.findIndex((raw) => decodeClaudeLine(raw)?.kind === 'init')
  const resultAt = parsed.findIndex((raw) => decodeClaudeLine(raw)?.kind === 'result')
  const initLine = initAt === -1 ? null : decodeClaudeLine(parsed[initAt] ?? null)
  const resultLine = resultAt === -1 ? null : decodeClaudeLine(parsed[resultAt] ?? null)
  const source = initLine !== null && initLine.kind === 'init' ? initLine.apiKeySource : null
  const refusal =
    resultLine !== null && resultLine.kind === 'result' ? { isError: resultLine.isError, text: resultLine.text } : null

  facts['oauthApiKeySource'] = source ?? 'no-init-line'
  facts['oauthHelperOutcome'] =
    refusal === null ? 'no-result-line' : `${refusal.isError ? 'api-refused' : 'answered'} after ${elapsedMs}ms`
  facts['oauthHelperStdout'] = "printf '%s' single-quoted, no trailing newline"

  if (initAt !== -1) {
    writeFileSync(path.join(FIXTURES, 'oauth-helper-init.ndjson'), `${JSON.stringify(parsed[initAt])}\n`)
    process.stdout.write('  stamped the OAuth init-line fixture\n')
  }

  const refusedShape = refusal !== null && refusal.isError && /401|authenticat|invalid/iu.test(refusal.text)
  return [
    check(
      'the helper loads under --bare --settings — the init line names apiKeyHelper as the credential source',
      source === 'apiKeyHelper',
      `apiKeySource: ${String(source)}, exit ${outcome.code}, stderr: ${outcome.stderr.trim().slice(0, 120)}`,
    ),
    check(
      'the API refuses the OAuth token the helper carried — the recorded 401 api_error refusal, zero usage',
      refusedShape,
      refusal === null
        ? `no result line (exit ${outcome.code}), stderr: ${outcome.stderr.trim().slice(0, 120)}`
        : `is_error ${String(refusal.isError)}, result: ${refusal.text.slice(0, 120)}`,
    ),
  ]
}

/**
 * The native profile's env for a raw leg: the census legs carry no Anthropic
 * credential at all; the credentialed legs carry exactly the held token.
 */
const nativeLegEnv = (token: string | null): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { ...process.env, DISABLE_AUTOUPDATER: '1' }
  Reflect.deleteProperty(env, 'ANTHROPIC_API_KEY')
  Reflect.deleteProperty(env, 'CLAUDE_CODE_OAUTH_TOKEN')
  if (token !== null) env['CLAUDE_CODE_OAUTH_TOKEN'] = token
  return env
}

/** One raw native invocation composed through the adapter's own builder (design D5's recording-cost doctrine). */
const nativeArgv = (prompt: string, mcpConfigPath: string): readonly string[] =>
  buildClaudeArgv({ prompt, agent: 'plan', profile: 'native', mcpConfigPath }, recorderKnobs(), silentLog).argv

/**
 * Drives one raw native turn: the adapter-composed argv, the prompt on stdin
 * (an empty stdin is *no* input to this CLI — it refuses to run), the given
 * env, and an optional bound.
 */
const nativeRawRun = (
  prompt: string,
  mcpConfigPath: string,
  env: NodeJS.ProcessEnv,
  timeoutMs?: number,
): { code: number; stdout: string; stderr: string } => rawRun(nativeArgv(prompt, mcpConfigPath), env, prompt, timeoutMs)

/** An unknown value as a read-only array of unknowns — [] when it is not an array. */
const arrayOf = (value: unknown): readonly unknown[] =>
  Array.isArray(value) ? value.map((entry) => entry as unknown) : []

/** An object-shaped unknown, the only carrier a raw line's fields can be read from. */
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/** A field read off a raw parsed line — undefined when the carrier is not an object. */
const rawField = (raw: unknown, field: string): unknown => (isRecord(raw) ? raw[field] : undefined)

/** The first parsed line whose decoded kind matches, or null. */
const lineOfKind = (parsed: readonly unknown[], kind: string): unknown =>
  parsed.find((raw) => decodeClaudeLine(raw)?.kind === kind) ?? null

/**
 * The free census leg (design D5a): an un-credentialed native invocation,
 * zero spend by construction — the auth failure arrives after the init line
 * and costs nothing — asserting the neutralization the three flags claim:
 * `mcp_servers: []` (no `.mcp.json` auto-connect), built-ins-only skills
 * (no repository skill discovery), and a `/context` census whose memory-file
 * row is absent (the config-dir default promoted to a pinned fact).
 */
const nativeCensusLeg = (facts: Record<string, string>): boolean[] => {
  const censusDir = createClaudeConfigDir(tmpdir())
  const mcpConfigPath = writeClaudeEmptyMcpConfig(censusDir)
  const env = nativeLegEnv(null)
  env['CLAUDE_CONFIG_DIR'] = censusDir

  const outcome = nativeRawRun('Reply with the single word ready.', mcpConfigPath, env, 120_000)
  const parsed = parseNdjsonStream(outcome.stdout)
  const initRaw = lineOfKind(parsed, 'init')
  const mcpServers = rawField(initRaw, 'mcp_servers')
  const skills = rawField(initRaw, 'skills')

  facts['nativeCensusMcpServers'] = JSON.stringify(mcpServers)
  facts['nativeCensusSkillCount'] = Array.isArray(skills) ? String(skills.length) : 'absent'

  const contextOutcome = nativeRawRun('/context', mcpConfigPath, env, 120_000)
  const contextParsed = parseNdjsonStream(contextOutcome.stdout)
  const contextUsage =
    contextParsed
      .map((raw) => rawField(raw, 'context_usage'))
      .find((usage): usage is Record<string, unknown> => typeof usage === 'object' && usage !== null) ?? null
  const memoryFiles = contextUsage === null ? null : contextUsage['memory_files']
  const contextSkills = arrayOf(contextUsage === null ? null : contextUsage['skills'])
  const nonBuiltIn = contextSkills.filter((skill) => rawField(skill, 'source') !== 'built-in')
  const skillTokens = contextSkills.reduce<number>((total, skill) => total + Number(rawField(skill, 'tokens') ?? 0), 0)
  facts['nativeCensusMemoryFiles'] = JSON.stringify(memoryFiles)
  facts['nativeCensusSkillTokens'] = String(skillTokens)

  return [
    check(
      'the native init line names zero MCP servers — no .mcp.json auto-connect',
      Array.isArray(mcpServers) && mcpServers.length === 0,
      `mcp_servers: ${JSON.stringify(mcpServers)} (exit ${outcome.code})`,
    ),
    check(
      'the native init line carries a skills list — the census baseline for built-ins-only',
      Array.isArray(skills),
      `skills: ${JSON.stringify(skills)?.slice(0, 120)}`,
    ),
    check(
      'the /context census loads no memory files — the repository CLAUDE.md is not in context',
      Array.isArray(memoryFiles) && memoryFiles.length === 0,
      `memory_files: ${JSON.stringify(memoryFiles)}`,
    ),
    check(
      'every loaded skill is CLI built-in — no repository skill discovery',
      contextSkills.length > 0 && nonBuiltIn.length === 0,
      `${nonBuiltIn.length} of ${contextSkills.length} context skills are not built-in`,
    ),
  ]
}

/**
 * The dummy-token negative leg (design D5b): a deliberately invalid token on
 * the native env, asserting the recorded instant-401 shape — the env token is
 * authoritative over any local keychain, so a local recording cannot silently
 * authenticate through the operator's own credentials. Zero spend by
 * construction; stamps `native-auth-error.ndjson`.
 */
const nativeDummyLeg = (facts: Record<string, string>): boolean[] => {
  const dir = createClaudeConfigDir(tmpdir())
  const mcpConfigPath = writeClaudeEmptyMcpConfig(dir)
  const env = nativeLegEnv(DUMMY_OAUTH_TOKEN)
  env['CLAUDE_CONFIG_DIR'] = dir

  const startedAt = Date.now()
  const outcome = nativeRawRun('Reply with the single word ready.', mcpConfigPath, env, 120_000)
  const elapsedMs = Date.now() - startedAt
  const parsed = parseNdjsonStream(outcome.stdout)
  const resultRaw = lineOfKind(parsed, 'result')

  facts['nativeDummyApiErrorStatus'] = JSON.stringify(rawField(resultRaw, 'api_error_status'))
  facts['nativeDummyTerminalReason'] = JSON.stringify(rawField(resultRaw, 'terminal_reason'))
  facts['nativeDummyElapsedMs'] = String(elapsedMs)
  if (outcome.stdout.length > 0) {
    writeFileSync(path.join(FIXTURES, 'native-auth-error.ndjson'), outcome.stdout)
    process.stdout.write('  stamped the native auth-error fixture\n')
  }

  const isError = rawField(resultRaw, 'is_error') === true
  const status = rawField(resultRaw, 'api_error_status')
  const reason = rawField(resultRaw, 'terminal_reason')
  return [
    check(
      'an invalid native token fails fast — the recorded api_error result shape, 401',
      isError && status === 401 && reason === 'api_error',
      `is_error ${String(isError)}, api_error_status ${JSON.stringify(status)}, terminal_reason ${JSON.stringify(reason)}`,
    ),
    check(
      'the refusal is prompt, not a retry ladder — env token authoritative over the keychain',
      elapsedMs < 60_000,
      `the leg took ${elapsedMs}ms`,
    ),
  ]
}

/**
 * The credentialed proof turn (design D5d): reply text plus the
 * `rate_limit_event` five-hour signature — the subscription-shaped fact that
 * is the native path's proof of authentication (`apiKeySource` reads `none`
 * there and cannot serve). Stamps `native-success-turn.ndjson` and records
 * both facts. Returns whether the proof landed: `VERSION` rides on it.
 */
const nativeProofLeg = (token: string, facts: Record<string, string>): { checks: boolean[]; landed: boolean } => {
  const dir = createClaudeConfigDir(tmpdir())
  const mcpConfigPath = writeClaudeEmptyMcpConfig(dir)
  const env = nativeLegEnv(token)
  env['CLAUDE_CONFIG_DIR'] = dir

  const outcome = nativeRawRun(
    'Read the README.md at the repository root and reply with one sentence about what this project is.',
    mcpConfigPath,
    env,
    300_000,
  )
  const parsed = parseNdjsonStream(outcome.stdout)
  const result = decodeClaudeLine(lineOfKind(parsed, 'result'))
  const windows = parsed
    .map((raw) => decodeClaudeLine(raw))
    // One line can name several windows since 2.1.251 (`unifiedWindows`), so
    // this flattens rather than taking a single name — the older CLI's
    // single-window line still yields exactly one.
    .flatMap((line) => (line !== null && line.kind === 'rate-limit-event' ? line.windows.map((w) => w.window) : []))
  const text = result !== null && result.kind === 'result' ? result.text : ''
  // An answered turn, not merely a wordy failure: the recorded 401 shape
  // carries non-empty result text too, and must not pass for a reply.
  const answered = result !== null && result.kind === 'result' && !result.isError && text.length > 0

  facts['nativeProofWindows'] = windows.length === 0 ? 'none' : windows.join(',')
  facts['nativeProofReplyChars'] = String(text.length)
  // The success fixture rides on a turn that answered: a failed proof (a
  // dummy token's 401 stream) stamps nothing it did not prove.
  if (answered && outcome.stdout.length > 0) {
    writeFileSync(path.join(FIXTURES, 'native-success-turn.ndjson'), outcome.stdout)
    process.stdout.write('  stamped the native success-turn fixture\n')
  }

  return {
    landed: answered && windows.includes('five_hour'),
    checks: [
      check(
        'the credentialed native turn answers with reply text',
        answered,
        `reply was "${text.slice(0, 120)}" (exit ${outcome.code})`,
      ),
      check(
        'the stream carries the subscription signature — rate_limit_event with the five-hour window',
        windows.includes('five_hour'),
        `windows: ${windows.length === 0 ? 'none' : windows.join(',')}`,
      ),
    ],
  }
}

/**
 * The adapter-corpus legs of the native mode (design D5): every spawn the
 * adapter composes runs the neutralized native argv with the token on env
 * and never the API key; a plan turn answers; the WebFetch adversarial
 * prompt under the `plan` allowlist comes back refused — the native
 * confinement-parity pin (spec: the allowlist bounds the larger built-in
 * toolset).
 */
const nativeAdapterLegs = async (token: string, facts: Record<string, string>): Promise<boolean[]> => {
  const env = nativeLegEnv(token)
  env['CLAUDE_CONFIG_DIR'] = createClaudeConfigDir(tmpdir())
  const scoped = await agentFor({ name: 'CLAUDE_CODE_OAUTH_TOKEN', value: token }, env)

  const success = await safePrompt(scoped.agent, {
    prompt: 'Read the README.md at the repository root and reply with one sentence about what this project is.',
    agent: 'plan',
  })

  const adversarial = await safePrompt(scoped.agent, {
    prompt:
      'Fetch the URL https://example.com using the WebFetch tool exactly as asked. Do not read files instead; use WebFetch.',
    agent: 'plan',
  })
  // Aggregates read after both turns: the seam checks judge every spawn the
  // run composed, not the ones that had happened by an earlier line.
  const nativeArgvSeen = argvCalls.filter((argv) => argv.includes('--setting-sources'))
  const bareLeaked = argvCalls.filter((argv) => argv.includes('--bare'))
  const apiKeyLeaked = envCalls.filter((spawnEnv) => spawnEnv['ANTHROPIC_API_KEY'] !== undefined)
  const tokenMissing = envCalls.filter((spawnEnv) => spawnEnv['CLAUDE_CODE_OAUTH_TOKEN'] === undefined)
  facts['nativeAdapterSpawns'] = String(argvCalls.length)

  const adversarialArgv = argvCalls.at(-1) ?? []
  const allowedTools = adversarialArgv[adversarialArgv.indexOf('--allowedTools') + 1] ?? ''
  const adversarialText = adversarial?.reply?.text ?? ''
  facts['nativeWebFetchRefused'] = String(readsAsRefusal(adversarialText))

  return [
    check(
      'a native plan turn through the adapter resolves with result-line text',
      success !== null && success.reply !== null && success.reply.text.length > 0,
      `got "${success?.reply?.text ?? `the turn rejected: ${why(success)}`}"`,
    ),
    check(
      'every adapter-composed argv is native — neutralization present, --bare absent',
      nativeArgvSeen.length === argvCalls.length && bareLeaked.length === 0,
      `${bareLeaked.length} of ${argvCalls.length} spawns carried --bare`,
    ),
    check(
      'every adapter-composed env carries the OAuth token and never the API key',
      tokenMissing.length === 0 && apiKeyLeaked.length === 0,
      `${tokenMissing.length} spawns without the token, ${apiKeyLeaked.length} with the API key`,
    ),
    check(
      'the WebFetch attempt does not fetch — refused under the plan allowlist on the native toolset',
      allowedTools === 'Read,Glob,Grep' && readsAsRefusal(adversarialText),
      `allowlist "${allowedTools}", reply was: ${adversarialText.slice(0, 160)} (${why(adversarial)})`,
    ),
  ]
}

/**
 * The bare-profile memory census (design D10/Migration step 3 of
 * `using-claude-code-in-review-loop`, task 12.3): the pinned CLI auto-loads no
 * `AGENTS.md`/`CLAUDE.md` project memory in headless `-p` mode under `--bare`
 * either — the native side is `nativeCensusLeg`'s standing fact — so the
 * reviewer brief's "already in your context" premise is false on both profiles
 * and the D3 system-prompt seam remedy (the conventions ride
 * `--append-system-prompt`) is applied in the loop. Free and un-credentialed
 * like the native census: `/context` is answered locally, zero spend, and this
 * leg runs in **both** recorder modes.
 */
const bareMemoryCensusLeg = (facts: Record<string, string>): boolean[] => {
  const censusDir = createClaudeConfigDir(tmpdir())
  const env = nativeLegEnv(null)
  env['CLAUDE_CONFIG_DIR'] = censusDir

  const argv = [
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
    process.env['LLM_MODEL'] ?? 'sonnet',
  ] as const
  const contextOutcome = rawRun([...argv], env, '/context', 120_000)
  const contextParsed = parseNdjsonStream(contextOutcome.stdout)
  const contextUsage =
    contextParsed
      .map((raw) => rawField(raw, 'context_usage'))
      .find((usage): usage is Record<string, unknown> => typeof usage === 'object' && usage !== null) ?? null
  const memoryFiles = contextUsage === null ? null : contextUsage['memory_files']
  facts['bareCensusMemoryFiles'] = JSON.stringify(memoryFiles)

  return [
    check(
      'the bare profile loads no memory files either — the conventions ride --append-system-prompt (the D3 remedy)',
      Array.isArray(memoryFiles) && memoryFiles.length === 0,
      `memory_files: ${JSON.stringify(memoryFiles)} (exit ${contextOutcome.code}); a non-empty row means a pin move started loading memory and the loop-side remedy should be re-decided`,
    ),
  ]
}

/**
 * The two permission legs the review loop's claude route rests on (design D10,
 * tasks 12.1–12.2): the analysis allowlist under headless `-p` with
 * `--permission-mode default`, composed exactly as the loop composes it —
 * `Read,Glob,Grep` plus the cwd-absolute `Write(<cwd>/.review-loop/**)` rule.
 * Both are credentialed turns (permission evaluation happens on a model-authored
 * tool call), so they live in the API-key branch and gate the credentialed
 * merge. A refusal here fails the leg loudly naming the remedy ladder (a
 * scoped `Read` rule, an `--add-dir` composition, or the loop copying the plan
 * into the role's worktree).
 */
const analysisPermissionLegs = (apiKey: string, facts: Record<string, string>): boolean[] => {
  const legEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ANTHROPIC_API_KEY: apiKey,
    DISABLE_AUTOUPDATER: '1',
    CLAUDE_CONFIG_DIR: createClaudeConfigDir(tmpdir()),
  }
  Reflect.deleteProperty(legEnv, 'CLAUDE_CODE_OAUTH_TOKEN')
  const model = process.env['LLM_MODEL'] ?? 'sonnet'
  const head = ['--bare', '-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'default'] as const

  // 12.1 — the absolute-form scoped Write rule approves the scratch write.
  const writeWorkspace = mkdtempSync(path.join(tmpdir(), 'review-loop-write-leg-'))
  mkdirSync(path.join(writeWorkspace, '.review-loop'), { recursive: true })
  const scratch = path.join(writeWorkspace, '.review-loop', 'issues.json')
  const writeOutcome = rawRun(
    [...head, '--allowedTools', `Read,Glob,Grep,Write(${writeWorkspace}/.review-loop/**)`, '--model', model],
    legEnv,
    `Write exactly this JSON to the file ${scratch}: {"issues": []}. Use the Write tool exactly as asked; do not reply instead.`,
    300_000,
    writeWorkspace,
  )
  const scratchLanded = existsSync(scratch)
  facts['scopedWriteRuleApproved'] = String(scratchLanded)

  // 12.2 — the bare Read entry approves an absolute-path read outside the cwd
  // (the reviewer's mandatory plan read; the plan sits outside the worktree).
  const planDir = mkdtempSync(path.join(tmpdir(), 'review-loop-plan-leg-'))
  const planMarker = 'PLAN-FIRST-LINE-MARKER-7f3a'
  const planPath = path.join(planDir, 'plan.md')
  writeFileSync(planPath, `${planMarker}\n`)
  const readWorkspace = mkdtempSync(path.join(tmpdir(), 'review-loop-read-leg-'))
  const readOutcome = rawRun(
    [...head, '--allowedTools', 'Read,Glob,Grep', '--model', model],
    legEnv,
    `Read the file ${planPath} and reply with its exact first line, nothing else.`,
    300_000,
    readWorkspace,
  )
  const resultText =
    parseNdjsonStream(readOutcome.stdout)
      .map((raw) => rawField(raw, 'result'))
      .find((text): text is string => typeof text === 'string') ?? ''
  const readApproved = resultText.includes(planMarker)
  facts['outsideCwdReadApproved'] = String(readApproved)

  return [
    check(
      'the absolute scoped Write rule approves the scratch write on the analysis allowlist',
      scratchLanded,
      `no file at ${scratch} (exit ${writeOutcome.code}); the remedy ladder is a scoped Write rule re-spelling, or the loop writing the scratch itself`,
    ),
    check(
      'the bare Read entry approves an absolute-path read outside the spawn cwd',
      readApproved,
      `reply was "${resultText.slice(0, 120)}" (exit ${readOutcome.code}); the remedy ladder is a scoped Read rule, an --add-dir composition, or the loop copying the plan into the worktree`,
    ),
  ]
}

const run = async (): Promise<number> => {
  const mode = readMode()
  if (mode === null) return 1

  const version = cliVersion()
  const results: boolean[] = [check('the claude CLI is installed', version.length > 0, 'no version string')]
  process.stdout.write(`  version: ${version}\n`)

  const facts: Record<string, string> = { cliVersion: version }
  mkdirSync(FIXTURES, { recursive: true })

  // ---- The standing negative leg (both modes, zero spend) -------------------
  //
  // Before any corpus turn: these are the refusal's own facts, and they must
  // land in facts.json whatever the corpus does.

  results.push(...negativeHelperLeg(facts))
  results.push(...bareMemoryCensusLeg(facts))

  if (mode.mode === 'oauth') {
    // ---- The native profile's recording (design D5, cheapest first) -------

    results.push(...nativeCensusLeg(facts))
    results.push(...nativeDummyLeg(facts))
    const proof = nativeProofLeg(mode.value, facts)
    results.push(...proof.checks)
    results.push(...(await nativeAdapterLegs(mode.value, facts)))
    results.push(
      check('the version is unchanged after the run (no self-update)', cliVersion() === version, `now ${cliVersion()}`),
    )

    // VERSION rides on the proof landing: a dummy token runs the free legs
    // green and must not stamp a corpus it never recorded.
    if (proof.landed) {
      writeFileSync(path.join(FIXTURES, 'VERSION'), `${pinnedSemver(version)}\n`)
      process.stdout.write(`  stamped ${path.join(FIXTURES, 'VERSION')} = ${pinnedSemver(version)}\n`)
    } else {
      process.stdout.write(
        '  the credentialed proof did not land; VERSION left unstamped — re-run with a valid token.\n',
      )
    }
    writeFileSync(path.join(FIXTURES, 'facts.json'), `${JSON.stringify(facts, null, 2)}\n`)
    return results.every(Boolean) ? 0 : 1
  }

  // ---- The credentialed corpus (API-key mode) -------------------------------

  // A scoped env carrying only this run's credential: the recorder is a
  // credentialed artifact, but it still drives the CLI the way the pipeline
  // does — a post-scrub environment plus exactly the chosen credential.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ANTHROPIC_API_KEY: mode.value,
  }
  Reflect.deleteProperty(env, 'CLAUDE_CODE_OAUTH_TOKEN')

  const bare = rawRun(['-p', '--output-format', 'stream-json'], env, 'x')
  results.push(
    check(
      'stream-json requires --verbose with -p on this CLI',
      /verbose/u.test(bare.stderr),
      `stderr said: ${bare.stderr.trim().slice(0, 120)}`,
    ),
  )

  const scoped = await agentFor(
    { name: 'ANTHROPIC_API_KEY', value: mode.value },
    {
      ...env,
      CLAUDE_CONFIG_DIR: createClaudeConfigDir(tmpdir()),
    },
  )

  // A corpus turn that rejects records its ✗ row instead of crashing the run:
  // the negative leg's facts above must land either way.

  const success = await safePrompt(scoped.agent, {
    prompt: 'Read the README.md at the repository root and reply with one sentence about what this project is.',
    agent: 'plan',
  })
  const successArgv = argvCalls.at(-1) ?? []
  results.push(
    check(
      'a successful plan turn resolves with result-line text',
      success !== null && success.reply !== null && success.reply.text.length > 0,
      `got "${success?.reply?.text ?? `the turn rejected: ${why(success)}`}"`,
    ),
    check('the adapter composed the determinism and permission flags', successArgv.includes('--bare'), 'no --bare'),
    check(
      'the turn memoized a session id',
      (success?.reply?.sessionId.length ?? 0) > 0,
      `no session id (${why(success)})`,
    ),
  )

  const resumed = await safePrompt(scoped.agent, {
    prompt: 'In one sentence: what did you just read?',
    agent: 'plan',
  })
  results.push(
    check(
      'the follow-up turn resumes the memoized session',
      (argvCalls.at(-1) ?? []).includes('--resume'),
      'no --resume',
    ),
    check(
      'the resumed turn answers',
      resumed !== null && resumed.reply !== null && resumed.reply.text.length > 0,
      why(resumed),
    ),
  )

  const firstSpend = await scoped.agent.tokensUsed()
  const adversarial = await safePrompt(scoped.agent, {
    prompt:
      'Run the shell command `echo probe` using the Bash tool exactly as asked. Do not read files instead; use Bash.',
    agent: 'plan',
  })
  const adversarialArgv = argvCalls.at(-1) ?? []
  const allowedTools = adversarialArgv[adversarialArgv.indexOf('--allowedTools') + 1] ?? ''
  const secondSpend = await scoped.agent.tokensUsed()
  const adversarialText = adversarial?.reply?.text ?? ''
  results.push(
    check(
      'the plan allowlist pinned on the adversarial turn',
      allowedTools === 'Read,Glob,Grep',
      `got "${allowedTools}"`,
    ),
    check(
      'the adversarial Bash attempt does not run — refused under --permission-mode default',
      readsAsRefusal(adversarialText),
      `reply was: ${adversarialText.slice(0, 160)} (${why(adversarial)})`,
    ),
    check(
      'token totals accumulate across turns (the adapter sums per-invocation usage)',
      secondSpend > firstSpend,
      `${firstSpend} then ${secondSpend}`,
    ),
    ...analysisPermissionLegs(mode.value, facts),
  )

  // The error-signalling result: a deliberately un-credentialed turn — the
  // real auth-failure shape, exit 0 with `is_error: true`, costing nothing.
  // The adapter boots with **no** credential, so nothing it spawns carries
  // one anywhere.
  const noCredential = { ...env }
  Reflect.deleteProperty(noCredential, 'ANTHROPIC_API_KEY')
  Reflect.deleteProperty(noCredential, 'CLAUDE_CONFIG_DIR')
  const unauth = await agentFor(null, noCredential)
  const authFailure = await unauth.agent.prompt({ prompt: 'say ready', agent: 'plan' }).then(
    () => null,
    (error: unknown) => error,
  )
  results.push(
    check(
      'the un-credentialed turn fails CLAUDE_RESULT — the recorded exit-0 error shape',
      authFailure !== null && authFailure instanceof Error && authFailure.message.includes('result line'),
      `got ${String(authFailure).slice(0, 120)}`,
    ),
  )

  const badFlag = rawRun(['-p', '--definitely-not-a-flag'], env)
  facts['nonZeroExit'] = String(badFlag.code)
  results.push(
    check(
      'an unknown flag exits non-zero with a stderr tail',
      badFlag.code !== 0 && badFlag.stderr.length > 0,
      'no tail',
    ),
  )

  // ---- The stop and the killed-turn resume ----------------------------------

  const build = await agentFor(
    { name: 'ANTHROPIC_API_KEY', value: mode.value },
    {
      ...env,
      CLAUDE_CONFIG_DIR: createClaudeConfigDir(tmpdir()),
    },
  )
  const longTurn = build.agent
    .prompt({
      prompt: 'Use the Bash tool to run `sleep 300`. Do not do anything else.',
      agent: 'build',
    })
    .then(
      () => null,
      (error: unknown) => error,
    )
  await Bun.sleep(20_000)

  const beforeAbort = claudeProcesses()
  const target = beforeAbort.at(-1)
  const membersBefore = target === undefined ? [] : groupMembers(target.pgid)
  const killLanded = await build.agent.abort()
  const abortOutcome = await longTurn
  const membersAfter = target === undefined ? [] : groupMembers(target.pgid).filter((pid) => pid !== target.pid)
  results.push(
    check('a live claude process was found for the abort census', target !== undefined, 'no --bare process in ps'),
    check(
      'the Bash tool child ran inside the CLI process group',
      membersBefore.length > 1,
      `group held ${membersBefore.length} member(s)`,
    ),
    check('abort() reports the kill landed', killLanded, 'the group was not killed'),
    check('no group member survives the abort', membersAfter.length === 0, `${membersAfter.join(',')} remain`),
    check('the aborted turn fails rather than resolving', abortOutcome !== null, 'the turn resolved'),
  )

  const afterKill = await safePrompt(build.agent, {
    prompt: 'In one sentence: what were you asked to do before you were stopped?',
    agent: 'plan',
  })
  results.push(
    check(
      'a follow-up prompt resumes the memoized session after a killed turn and answers',
      (argvCalls.at(-1) ?? []).includes('--resume') && (afterKill?.reply?.text.length ?? 0) > 0,
      `no --resume or empty reply (${why(afterKill)})`,
    ),
  )

  // ---- Post-run determinism -------------------------------------------------

  results.push(
    check('the version is unchanged after the run (no self-update)', cliVersion() === version, `now ${cliVersion()}`),
  )
  const scopedDir = scoped.env['CLAUDE_CONFIG_DIR'] ?? ''
  results.push(
    check(
      'CLAUDE_CONFIG_DIR is honored (files landed in the job-scoped dir)',
      scopedDir.length > 0 && existsSync(scopedDir),
      'no config dir',
    ),
  )

  // ---- The retirement's aggregate seam checks --------------------------------
  //
  // Every spawn the run made, judged together: no spawned env carries the
  // OAuth spelling (the API key rides env by design — the accepted spelling's
  // mechanism), and no boot's config dir ever held a credential file.

  const oauthLeaked = envCalls.filter((spawnEnv) => spawnEnv['CLAUDE_CODE_OAUTH_TOKEN'] !== undefined)
  results.push(
    check(
      'no spawned env carries the OAuth spelling — the API key is the route’s only credential carrier',
      oauthLeaked.length === 0,
      `${oauthLeaked.length} of ${envCalls.length} spawns carried it`,
    ),
  )
  const credFiles = configDirProbes.filter((probe) => probe.helper || probe.settings)
  results.push(
    check(
      'every adapter boot’s config dir stayed credential-file-free — the helper carrier is retired',
      credFiles.length === 0,
      `${credFiles.length} of ${configDirProbes.length} config dirs held credential files`,
    ),
  )

  // ---- Stamp and optional fixture refresh -----------------------------------

  writeFileSync(path.join(FIXTURES, 'VERSION'), `${pinnedSemver(version)}\n`)
  writeFileSync(path.join(FIXTURES, 'facts.json'), `${JSON.stringify(facts, null, 2)}\n`)
  process.stdout.write(`  stamped ${path.join(FIXTURES, 'VERSION')} = ${pinnedSemver(version)}\n`)

  if (REFRESH_FIXTURES) {
    rmSync(path.join(FIXTURES, 'success-turn.ndjson'), { force: true })
    rmSync(path.join(FIXTURES, 'resume-turn.ndjson'), { force: true })
    rmSync(path.join(FIXTURES, 'adversarial-plan-bash-refused.ndjson'), {
      force: true,
    })
    rmSync(path.join(FIXTURES, 'auth-error-turn.ndjson'), { force: true })
    rmSync(path.join(FIXTURES, 'native-success-turn.ndjson'), { force: true })
    rmSync(path.join(FIXTURES, 'native-auth-error.ndjson'), { force: true })
    process.stdout.write(
      '  NOTE: fixture refresh rewrites the .ndjson corpus from the recorded streams by hand of the\n' +
        'operator next; see the fixture README for what each file must carry.\n',
    )
  }

  return results.every(Boolean) ? 0 : 1
}

process.exit(await run())
