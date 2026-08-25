// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * The contract check the unit tests cannot make: drive the real pinned `claude`
 * CLI, through the finished adapter, and record the fixture corpus.
 *
 * Not named `*.test.ts` on purpose — it needs credentials and the `claude`
 * binary, costs real model spend, and never runs in CI. Run it with:
 *
 *   bun run opencode-agent:test:claude-live
 *
 * It requires **exactly one** of `ANTHROPIC_API_KEY` or
 * `CLAUDE_CODE_OAUTH_TOKEN` in the environment — the same exclusivity the
 * config guard enforces — and refuses to run otherwise.
 *
 * What one invocation produces and asserts, whole (the scenarios share the run
 * and cannot be recorded or verified apart — design D12 step 1):
 *
 *  1. the determinism facts: `--output-format stream-json` requires
 *     `--verbose` with `-p`, `CLAUDE_CONFIG_DIR` is honored,
 *     `DISABLE_AUTOUPDATER=1` keeps `--version` unchanged after the run, a
 *     non-zero exit produces a stderr tail, and the token total accumulates
 *     across turns the way the adapter's sum fold expects;
 *  2. the corpus behaviours, driven through the adapter's own argv composition
 *     so a flag the pinned CLI no longer accepts fails here at recording cost
 *     (design D12 step 7): the successful turn, the resume flow, the
 *     adversarial plan-profile turn whose prompt attempts a `Bash` call and
 *     must come back refused under `--permission-mode default` — the
 *     permission-effect pin, not assumed from docs — and the error-signalling
 *     result line, taken from a deliberately un-credentialed turn (the real
 *     auth-failure shape, costing nothing);
 *  3. the stop semantics a fixture cannot state: a live turn running a long
 *     `Bash` child is `abort()`ed and no member of its process group survives,
 *     and a follow-up prompt `--resume`s the memoized session after the killed
 *     turn and answers.
 *
 * The OAuth spelling (`CLAUDE_CODE_OAUTH_TOKEN`) runs the same corpus through
 * its own carrier: the adapter materializes the CLI's `apiKeyHelper` files
 * into the job-scoped config dir at boot and names the settings file on every
 * argv via `--settings` (`--bare` skips config-dir auto-discovery), the
 * recording seam asserts no spawned env ever carries an Anthropic credential
 * and that each credentialed boot's config dir held the two files (0700/0600)
 * before its first spawn, and the raw proof legs run **before any corpus
 * turn** so the ship decision's facts land in `facts.json` whatever the
 * corpus does: one raw turn against the materialized dir with the env
 * credential deleted — the init line's `apiKeySource` is the recorded proof
 * the helper authenticates under `--bare --settings` — plus, only when that
 * leg fails, one non-bare turn on the same dir separating "--bare refuses
 * the helper" from "the helper or token is refused outright". The corpus is
 * stamped as `oauth-helper-init.ndjson`. The auth-error leg boots with no
 * credential at all, so nothing it spawns carries one anywhere.
 *
 * The recorded CLI's exact version is stamped into `VERSION` beside the
 * fixtures; `workflow.test.ts` asserts it equals the workflow's install pin,
 * so fixture and binary cannot silently skew. The `.ndjson` corpus beside it
 * is refreshed by the same run: after this recorder goes green, re-run it with
 * `CLAUDE_LIVE_REFRESH_FIXTURES=1` to overwrite the provisional fixture files
 * with the recorded streams.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
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

const check = (label: string, condition: boolean, detail: string): boolean => {
  process.stdout.write(`${condition ? '✓' : '✗'} ${label}${condition ? '' : ` — ${detail}`}\n`)
  return condition
}

/** The one credential this run holds, read under the guard's own exclusivity rule. */
const readCredential = (): { name: 'ANTHROPIC_API_KEY' | 'CLAUDE_CODE_OAUTH_TOKEN'; value: string } | null => {
  const apiKey = process.env['ANTHROPIC_API_KEY']?.trim()
  const oauth = process.env['CLAUDE_CODE_OAUTH_TOKEN']?.trim()
  if (apiKey !== undefined && apiKey.length > 0 && oauth !== undefined && oauth.length > 0) {
    process.stdout.write('✗ Both ANTHROPIC_API_KEY and CLAUDE_CODE_OAUTH_TOKEN are set; exactly one may be.\n')
    return null
  }
  if (apiKey !== undefined && apiKey.length > 0) return { name: 'ANTHROPIC_API_KEY', value: apiKey }
  if (oauth !== undefined && oauth.length > 0) return { name: 'CLAUDE_CODE_OAUTH_TOKEN', value: oauth }
  process.stdout.write(
    '✗ No credential: set exactly one of ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN. ' +
      'This recorder spends real model budget and never runs in CI.\n',
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

/** Every child env the adapter spawned with — read back for the OAuth carrier checks, never printed. */
const envCalls: Array<Record<string, string>> = []

/** What one config dir held at its first spawn — boot-time materialization, not turn-time. */
interface ConfigDirProbe {
  configDir: string
  helper: boolean
  settings: boolean
  helperMode: number
  settingsMode: number
}

const configDirProbes: ConfigDirProbe[] = []
const probedDirs = new Set<string>()

const recordingSpawn: SpawnClaude = (binary, argv, options) => {
  argvCalls.push([binary, ...argv])
  envCalls.push(options.env)
  const dir = options.env['CLAUDE_CONFIG_DIR'] ?? ''
  if (!probedDirs.has(dir)) {
    probedDirs.add(dir)
    const helper = path.join(dir, 'credential.sh')
    const settings = path.join(dir, 'settings.json')
    configDirProbes.push({
      configDir: dir,
      helper: existsSync(helper),
      settings: existsSync(settings),
      helperMode: existsSync(helper) ? statSync(helper).mode & 0o777 : 0,
      settingsMode: existsSync(settings) ? statSync(settings).mode & 0o777 : 0,
    })
  }
  return liveSpawn(binary, argv, options)
}

/** The CLI's version, as the recorder stamps it into the fixture directory. */
const cliVersion = (): string => spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout.trim()

/** Runs one raw CLI invocation and hands back exit code and both streams. */
const rawRun = (
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  input = '',
): { code: number; stdout: string; stderr: string } => {
  const child = spawnSync('claude', [...argv], { encoding: 'utf8', env, input })
  return { code: child.status ?? -1, stdout: child.stdout ?? '', stderr: child.stderr ?? '' }
}

interface AgentEnv {
  /** The environment the adapter spawned under — the recorder reads it back for facts. */
  readonly env: NodeJS.ProcessEnv
  readonly agent: OpenCodeAgent
}

/** Boots one adapter over the given environment, capturing every argv. A null credential is the un-credentialed leg. */
const agentFor = async (
  credential: { name: 'ANTHROPIC_API_KEY' | 'CLAUDE_CODE_OAUTH_TOKEN'; value: string } | null,
  env: NodeJS.ProcessEnv,
): Promise<AgentEnv> => {
  const options: ClaudeAgentOptions = {
    directory: process.cwd(),
    knobs: { model: process.env['LLM_MODEL'] ?? 'sonnet', lightModel: null, planEffort: null, buildEffort: null },
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
      return { pid: Number.parseInt(pid ?? '0', 10), pgid: Number.parseInt(pgid ?? '0', 10) }
    })
    .filter((entry) => entry.pid > 0)

/** The pids in one process group. */
const groupMembers = (pgid: number): number[] =>
  spawnSync('ps', ['-o', 'pid=', '-g', String(pgid)], { encoding: 'utf8' })
    .stdout.split('\n')
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((pid) => Number.isSafeInteger(pid) && pid > 0)

const run = async (): Promise<number> => {
  const credential = readCredential()
  if (credential === null) return 1

  const version = cliVersion()
  const results: boolean[] = [check('the claude CLI is installed', version.length > 0, 'no version string')]
  process.stdout.write(`  version: ${version}\n`)

  // A scoped env carrying only this run's credential: the recorder is a
  // credentialed artifact, but it still drives the CLI the way the pipeline
  // does — a post-scrub environment plus exactly the chosen credential.
  const notChosen = credential.name === 'ANTHROPIC_API_KEY' ? 'CLAUDE_CODE_OAUTH_TOKEN' : 'ANTHROPIC_API_KEY'
  const env: NodeJS.ProcessEnv = { ...process.env, [credential.name]: credential.value }
  Reflect.deleteProperty(env, notChosen)

  const facts: Record<string, string> = { cliVersion: version }
  mkdirSync(FIXTURES, { recursive: true })

  // ---- Determinism facts ---------------------------------------------------

  const bare = rawRun(['-p', '--output-format', 'stream-json'], env)
  results.push(
    check(
      'stream-json requires --verbose with -p on this CLI',
      /verbose/u.test(bare.stderr),
      `stderr said: ${bare.stderr.trim().slice(0, 120)}`,
    ),
  )

  const scoped = await agentFor(credential, { ...env, CLAUDE_CONFIG_DIR: createClaudeConfigDir(tmpdir()) })

  // ---- The OAuth carrier's proof legs (design D4/D5) --------------------------
  //
  // Before any corpus turn: these are the ship decision's facts, and they must
  // land in facts.json whatever the corpus does (the first 5.1 run crashed at
  // the opening turn and recorded nothing). One raw CLI turn against the
  // config dir the scoped adapter just materialized — helper pair present,
  // both env spellings deleted, `--settings` naming the file the way the
  // adapter's argv now does — so the helper is the only carrier that exists,
  // and the init line's `apiKeySource` is the recorded answer to whether
  // `--bare` consults it. A second, non-bare leg runs only if the first
  // fails, separating "--bare refuses the helper" from "the helper or token
  // is refused outright".

  if (credential.name === 'CLAUDE_CODE_OAUTH_TOKEN') {
    const helperDir = configDirProbes[0]?.configDir ?? ''
    const helperEnv: NodeJS.ProcessEnv = { ...env, CLAUDE_CONFIG_DIR: helperDir }
    Reflect.deleteProperty(helperEnv, credential.name)
    const helperArgv = (withBare: boolean): readonly string[] => [
      ...(withBare ? ['--bare'] : []),
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
      '--settings',
      path.join(helperDir, 'settings.json'),
    ]
    const factsOf = (outcome: {
      code: number
      stdout: string
    }): { source: string | null; text: string; initRaw: unknown } => {
      const parsed = parseNdjsonStream(outcome.stdout)
      const initAt = parsed.findIndex((raw) => decodeClaudeLine(raw)?.kind === 'init')
      const resultAt = parsed.findIndex((raw) => decodeClaudeLine(raw)?.kind === 'result')
      const initLine = initAt === -1 ? null : decodeClaudeLine(parsed[initAt] ?? null)
      const resultLine = resultAt === -1 ? null : decodeClaudeLine(parsed[resultAt] ?? null)
      return {
        source: initLine !== null && initLine.kind === 'init' ? initLine.apiKeySource : null,
        text: resultLine !== null && resultLine.kind === 'result' ? resultLine.text : '',
        initRaw: initAt === -1 ? null : (parsed[initAt] ?? null),
      }
    }
    const bareRun = rawRun(helperArgv(true), helperEnv, 'Reply with the single word ready.')
    const bareFacts = factsOf(bareRun)
    facts['oauthApiKeySource'] = bareFacts.source ?? 'no-init-line'
    facts['oauthHelperStdout'] = "printf '%s' single-quoted, no trailing newline"
    results.push(
      check(
        'the helper authenticates under --bare --settings — raw leg, no env credential, non-none apiKeySource',
        bareFacts.source !== null && bareFacts.source !== 'none',
        `apiKeySource: ${String(bareFacts.source)}, exit ${bareRun.code}, result: ${bareFacts.text.slice(0, 120)}`,
      ),
    )
    if (bareFacts.initRaw !== null) {
      writeFileSync(path.join(FIXTURES, 'oauth-helper-init.ndjson'), `${JSON.stringify(bareFacts.initRaw)}\n`)
      process.stdout.write('  stamped the OAuth init-line fixture\n')
    }
    if (bareFacts.source === null || bareFacts.source === 'none') {
      const noBareFacts = factsOf(rawRun(helperArgv(false), helperEnv, 'Reply with the single word ready.'))
      facts['oauthHelperNoBareApiKeySource'] = noBareFacts.source ?? 'no-init-line'
      process.stdout.write(
        `  diagnostic: the same helper dir without --bare reports apiKeySource ${String(noBareFacts.source)} ` +
          `(result: ${noBareFacts.text.slice(0, 80)})\n`,
      )
    }
  }

  // ---- The corpus behaviours, through the adapter's own argv ---------------
  //
  // A corpus turn that rejects records its ✗ row instead of crashing the run:
  // the decision facts above must land either way.

  const safePrompt = (
    agent: OpenCodeAgent,
    request: Parameters<OpenCodeAgent['prompt']>[0],
  ): Promise<Awaited<ReturnType<OpenCodeAgent['prompt']>> | null> =>
    agent.prompt(request).then(
      (reply) => reply,
      () => null,
    )

  const success = await safePrompt(scoped.agent, {
    prompt: 'Read the README.md at the repository root and reply with one sentence about what this project is.',
    agent: 'plan',
  })
  const successArgv = argvCalls.at(-1) ?? []
  results.push(
    check(
      'a successful plan turn resolves with result-line text',
      success !== null && success.text.length > 0,
      `got "${success?.text ?? 'the turn rejected'}"`,
    ),
    check('the adapter composed the determinism and permission flags', successArgv.includes('--bare'), 'no --bare'),
    check('the turn memoized a session id', (success?.sessionId.length ?? 0) > 0, 'no session id'),
  )

  const resumed = await safePrompt(scoped.agent, { prompt: 'In one sentence: what did you just read?', agent: 'plan' })
  results.push(
    check(
      'the follow-up turn resumes the memoized session',
      (argvCalls.at(-1) ?? []).includes('--resume'),
      'no --resume',
    ),
    check('the resumed turn answers', resumed !== null && resumed.text.length > 0, 'empty or rejected'),
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
  const adversarialText = adversarial?.text ?? ''
  results.push(
    check(
      'the plan allowlist pinned on the adversarial turn',
      allowedTools === 'Read,Glob,Grep',
      `got "${allowedTools}"`,
    ),
    check(
      'the adversarial Bash attempt does not run — refused under --permission-mode default',
      /cannot|refused|not (?:able|allowed|permitted)|can't|unable|won't/u.test(adversarialText),
      `reply was: ${adversarialText.slice(0, 160)}`,
    ),
    check(
      'token totals accumulate across turns (the adapter sums per-invocation usage)',
      secondSpend > firstSpend,
      `${firstSpend} then ${secondSpend}`,
    ),
  )

  // The error-signalling result: a deliberately un-credentialed turn — the
  // real auth-failure shape, exit 0 with `is_error: true`, costing nothing.
  // The adapter boots with **no** credential: on the OAuth spelling no helper
  // exists for the CLI to consult, so the failure is the genuine shape.
  const noCredential = { ...env }
  Reflect.deleteProperty(noCredential, credential.name)
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

  const build = await agentFor(credential, { ...env, CLAUDE_CONFIG_DIR: createClaudeConfigDir(tmpdir()) })
  const longTurn = build.agent
    .prompt({ prompt: 'Use the Bash tool to run `sleep 300`. Do not do anything else.', agent: 'build' })
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
      (argvCalls.at(-1) ?? []).includes('--resume') && (afterKill?.text.length ?? 0) > 0,
      'no --resume or empty reply',
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

  // ---- The OAuth carrier's aggregate seam checks ------------------------------
  //
  // Every spawn the run made, judged together: on the OAuth spelling no env
  // ever carries an Anthropic credential, each credentialed boot's config dir
  // held the helper pair (0700/0600) before its first spawn, and the one
  // un-credentialed boot held none.

  if (credential.name === 'CLAUDE_CODE_OAUTH_TOKEN') {
    const spellingsLeaked = envCalls.filter(
      (spawnEnv) => spawnEnv['ANTHROPIC_API_KEY'] !== undefined || spawnEnv['CLAUDE_CODE_OAUTH_TOKEN'] !== undefined,
    )
    results.push(
      check(
        'no spawned env carries any Anthropic credential — the helper files are the only carrier',
        spellingsLeaked.length === 0,
        `${spellingsLeaked.length} of ${envCalls.length} spawns carried a spelling`,
      ),
    )
    const materialized = configDirProbes.filter(
      (probe) => probe.helper && probe.settings && probe.helperMode === 0o700 && probe.settingsMode === 0o600,
    )
    results.push(
      check(
        'each credentialed adapter boot materialized the helper pair before its first spawn',
        materialized.length === 2,
        `${materialized.length} of ${configDirProbes.length} config dirs held the files`,
      ),
    )
    results.push(
      check(
        'the un-credentialed boot materialized no helper',
        configDirProbes.length === 3 && materialized.length === 2,
        `${configDirProbes.length - materialized.length} bare config dirs (expected 1)`,
      ),
    )
  }

  // ---- Stamp and optional fixture refresh -----------------------------------

  writeFileSync(path.join(FIXTURES, 'VERSION'), `${version}\n`)
  writeFileSync(path.join(FIXTURES, 'facts.json'), `${JSON.stringify(facts, null, 2)}\n`)
  process.stdout.write(`  stamped ${path.join(FIXTURES, 'VERSION')} = ${version}\n`)

  if (REFRESH_FIXTURES) {
    rmSync(path.join(FIXTURES, 'success-turn.ndjson'), { force: true })
    rmSync(path.join(FIXTURES, 'resume-turn.ndjson'), { force: true })
    rmSync(path.join(FIXTURES, 'adversarial-plan-bash-refused.ndjson'), { force: true })
    rmSync(path.join(FIXTURES, 'auth-error-turn.ndjson'), { force: true })
    rmSync(path.join(FIXTURES, 'oauth-helper-init.ndjson'), { force: true })
    process.stdout.write(
      '  NOTE: fixture refresh rewrites the .ndjson corpus from the recorded streams by hand of the\n' +
        'operator next; see the fixture README for what each file must carry.\n',
    )
  }

  return results.every(Boolean) ? 0 : 1
}

process.exit(await run())
