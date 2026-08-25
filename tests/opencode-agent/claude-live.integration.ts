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
 * - `ANTHROPIC_API_KEY` — the credentialed recording. The full corpus
 *   behaviours run through the adapter's own argv composition, so a flag the
 *   pinned CLI no longer accepts fails here at recording cost.
 * - `CLAUDE_CODE_OAUTH_TOKEN` — the zero-spend negative mode. That spelling
 *   is refused at startup in production (the recorded no-carrier finding),
 *   so it boots nothing here: the value is a mode switch only — a dummy,
 *   never handed to any child — and only the standing negative leg runs.
 *
 * The standing negative leg (both modes, design D3 of
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
 * fails the leg loudly, naming the change: the successor change's
 * green-path precondition arriving as a signal rather than a surprise. The
 * leg's init line is stamped as `oauth-helper-init.ndjson`; the wall time is
 * the retry ladder's (~3 min recorded), not spend.
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
 * fixtures by the credentialed mode; `workflow.test.ts` asserts it equals the
 * workflow's install pin, so fixture and binary cannot silently skew. The
 * `.ndjson` corpus beside it is refreshed by the same run: after this recorder
 * goes green, re-run it with `CLAUDE_LIVE_REFRESH_FIXTURES=1` to overwrite the
 * provisional fixture files with the recorded streams.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { createClaudeAgent } from '../../opencode-agent/src/claude-adapter.js'
import type { ClaudeAgentOptions } from '../../opencode-agent/src/claude-adapter.js'
import { createClaudeConfigDir, liveSpawn } from '../../opencode-agent/src/claude-connect.js'
import type { SpawnClaude } from '../../opencode-agent/src/claude-connect.js'
import { decodeClaudeLine, parseNdjsonStream } from '../../opencode-agent/src/claude-contract.js'
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
 * API key runs the credentialed corpus; the OAuth spelling — refused at
 * startup in production — is the zero-spend negative mode's switch, a dummy.
 */
const readMode = (): { mode: 'api-key'; value: string } | { mode: 'oauth-dummy' } | null => {
  const apiKey = process.env['ANTHROPIC_API_KEY']?.trim()
  const oauth = process.env['CLAUDE_CODE_OAUTH_TOKEN']?.trim()
  if (apiKey !== undefined && apiKey.length > 0 && oauth !== undefined && oauth.length > 0) {
    process.stdout.write('✗ Both ANTHROPIC_API_KEY and CLAUDE_CODE_OAUTH_TOKEN are set; exactly one may be.\n')
    return null
  }
  if (apiKey !== undefined && apiKey.length > 0) return { mode: 'api-key', value: apiKey }
  if (oauth !== undefined && oauth.length > 0) return { mode: 'oauth-dummy' }
  process.stdout.write(
    '✗ No credential: set ANTHROPIC_API_KEY for the credentialed corpus (real model spend, never in CI), or ' +
      'CLAUDE_CODE_OAUTH_TOKEN=<dummy> for the zero-spend negative legs alone.\n',
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
): { code: number; stdout: string; stderr: string } => {
  const child = spawnSync('claude', [...argv], {
    encoding: 'utf8',
    env,
    input,
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
const agentFor = async (
  credential: { name: 'ANTHROPIC_API_KEY'; value: string } | null,
  env: NodeJS.ProcessEnv,
): Promise<AgentEnv> => {
  const options: ClaudeAgentOptions = {
    directory: process.cwd(),
    knobs: {
      model: process.env['LLM_MODEL'] ?? 'sonnet',
      lightModel: null,
      planEffort: null,
      buildEffort: null,
    },
    ...(credential === null ? {} : { credential }),
    env,
    log: silentLog,
    spawn: recordingSpawn,
    timeoutMs: 300_000,
    heartbeatMs: 60_000,
  }
  return { env, agent: await createClaudeAgent(options) }
}

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

  if (mode.mode !== 'api-key') {
    process.stdout.write(
      '  negative mode: the credentialed corpus legs are skipped — the OAuth spelling no longer boots from config.\n' +
        '  for the full recording, re-run with ANTHROPIC_API_KEY (real model spend).\n',
    )
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
      /cannot|refused|not (?:able|allowed|permitted)|can't|unable|won't/u.test(adversarialText),
      `reply was: ${adversarialText.slice(0, 160)} (${why(adversarial)})`,
    ),
    check(
      'token totals accumulate across turns (the adapter sums per-invocation usage)',
      secondSpend > firstSpend,
      `${firstSpend} then ${secondSpend}`,
    ),
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

  writeFileSync(path.join(FIXTURES, 'VERSION'), `${version}\n`)
  writeFileSync(path.join(FIXTURES, 'facts.json'), `${JSON.stringify(facts, null, 2)}\n`)
  process.stdout.write(`  stamped ${path.join(FIXTURES, 'VERSION')} = ${version}\n`)

  if (REFRESH_FIXTURES) {
    rmSync(path.join(FIXTURES, 'success-turn.ndjson'), { force: true })
    rmSync(path.join(FIXTURES, 'resume-turn.ndjson'), { force: true })
    rmSync(path.join(FIXTURES, 'adversarial-plan-bash-refused.ndjson'), {
      force: true,
    })
    rmSync(path.join(FIXTURES, 'auth-error-turn.ndjson'), { force: true })
    process.stdout.write(
      '  NOTE: fixture refresh rewrites the .ndjson corpus from the recorded streams by hand of the\n' +
        'operator next; see the fixture README for what each file must carry.\n',
    )
  }

  return results.every(Boolean) ? 0 : 1
}

process.exit(await run())
