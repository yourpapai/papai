// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { memoizeAgent } from './agent-handle.js'
import type { AgentHandle } from './agent-handle.js'
import { loadConfig } from './config.js'
import type { PipelineConfig } from './config.js'
import { assembleDeps } from './deps.js'
import { createOctokitApi } from './github.js'
import type { GitHubApi, OctokitApiOptions } from './github.js'
import { createPipelineLogger } from './logger.js'
import type { Logger, LogLevel } from './logger.js'
import { createOpenCodeAgent } from './opencode-adapter.js'
import type { OpenCodeAgent, OpenCodeAgentOptions } from './opencode-adapter.js'
import { runPipeline } from './orchestrator.js'
import type { PhaseDeps } from './phase-context.js'
import { resolvePullRequestTrigger } from './pr-trigger.js'
import { proxiedSettings, startProviderProxy } from './provider-proxy.js'
import type { ProviderProxy } from './provider-proxy.js'
import type { RunResult } from './run-result.js'
import { pipelineSecrets, scrubSecrets } from './secrets.js'
import { runCommand } from './shell.js'
import type { CommandRunner } from './shell.js'
import { createStatusReporter } from './status-reporter.js'
import { recordReport } from './step-output.js'
import { turnTimeoutMs } from './time-budget.js'
import { parseTriggerEvent } from './trigger-events.js'
import type { TriggerEvent } from './trigger-events.js'
import { errorMessage } from './types.js'

export interface CliArgs {
  eventPath: string
  eventName: string
  repoRoot: string
  logLevel: LogLevel
}

export class UsageError extends Error {
  constructor(message: string) {
    super(
      `${message}\n\nUsage: opencode-agent --event-path <file.json> --event-name <issues|issue_comment|workflow_run> [--repo-root <dir>] [--log-level debug|info|warn|error]`,
    )
    this.name = 'UsageError'
  }
}

const LOG_LEVELS: ReadonlySet<string> = new Set(['debug', 'info', 'warn', 'error'])

const isLogLevel = (value: string): value is LogLevel => LOG_LEVELS.has(value)

/** Parses the CLI flags. Defaults come from the Actions runner environment. */
export const parseArgs = (argv: readonly string[], env: NodeJS.ProcessEnv): CliArgs => {
  const flags = new Map<string, string>()

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === undefined || !token.startsWith('--')) continue
    const inline = token.indexOf('=')
    if (inline !== -1) {
      flags.set(token.slice(2, inline), token.slice(inline + 1))
      continue
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new UsageError(`${token} requires a value`)
    flags.set(token.slice(2), value)
    index += 1
  }

  const eventPath = flags.get('event-path') ?? env['GITHUB_EVENT_PATH']
  const eventName = flags.get('event-name') ?? env['GITHUB_EVENT_NAME']
  if (eventPath === undefined) throw new UsageError('--event-path is required')
  if (eventName === undefined) throw new UsageError('--event-name is required')

  const logLevel = flags.get('log-level') ?? env['AGENT_LOG_LEVEL'] ?? 'info'
  if (!isLogLevel(logLevel)) throw new UsageError('--log-level must be one of debug|info|warn|error')

  return {
    eventPath,
    eventName,
    repoRoot: path.resolve(flags.get('repo-root') ?? env['GITHUB_WORKSPACE'] ?? process.cwd()),
    logLevel,
  }
}

export interface MainOptions {
  argv: readonly string[]
  env: NodeJS.ProcessEnv
  logger?: Logger
  run?: CommandRunner
  /** Seams for tests, forwarded verbatim as the GitHub adapter's own options. */
  octokit?: Pick<OctokitApiOptions, 'fetch' | 'log'>
}

export interface ContainInput {
  config: PipelineConfig
  event: TriggerEvent
  log: Logger
  run: CommandRunner
  options: MainOptions
  /**
   * The GitHub adapter, built by the caller.
   *
   * It used to be built here, and moved out when the pull-request door arrived:
   * a comment typed on a pull request names no issue, so `runCli` has to ask
   * `getPullRequestHead` which issue this run is even about *before* there is a
   * `TriggerEvent` to contain. Passed in rather than built twice, because two
   * construction sites for one credentialled client is how one of them ends up
   * missing the secrets that redact its outbound text.
   */
  github: GitHubApi
  /**
   * Seam for tests, defaulting to the real adapter.
   *
   * Here because the recurring bug in this workspace is not a broken adapter but
   * a correct one that is never handed anything — outbound redaction, the
   * provider proxy and the logger's secret list each shipped that way. What
   * `contain` passes to the session is only observable through a seam.
   */
  createAgent?: (options: OpenCodeAgentOptions) => Promise<OpenCodeAgent>
  /**
   * The run's clock, defaulting to the real one. A seam because three things read
   * it — the status comment's start time, the cascade's job-deadline check and the
   * per-turn bound — and a bound reading `Date.now()` is one no test can stand on
   * either side of.
   */
  now?: () => number
}

export interface Contained {
  proxy: ProviderProxy
  agent: AgentHandle
  deps: PhaseDeps
}

/**
 * Assembles the run with the provider credential held back.
 *
 * Everything downstream — the in-process session and the review loop's
 * `opencode run` subprocesses — is configured with the proxy and a placeholder
 * key, because the SDK puts the config into the spawned server's environment
 * where the model's `bash` can read it. `secrets` is taken from the **real**
 * config, so scrubbing, redaction and the diff guard still know the value they
 * are protecting.
 */
export const contain = ({ config, event, log, run, options, github, createAgent, now }: ContainInput): Contained => {
  const secrets = pipelineSecrets(config)
  const proxy = startProviderProxy(config.openai, log)
  const contained: PipelineConfig = { ...config, openai: proxiedSettings(config.openai, proxy) }
  const create = createAgent ?? createOpenCodeAgent
  const clock = now ?? ((): number => Date.now())

  // In this order because each needs the one before it: the status comment is
  // written through the GitHub adapter, and the session's heartbeat is what
  // keeps the status comment current, so the session is built last and handed
  // the reporter's tick. The adapter now arrives already built — see
  // {@link ContainInput.github} — which changes where the first of the three
  // comes from and nothing about the order of the other two.
  const status = createStatusReporter({ github, log, config: contained, now: clock })

  const agent = memoizeAgent(() =>
    create({
      directory: contained.repoRoot,
      openai: contained.openai,
      sessionTitle: `issue-${event.issueNumber}`,
      // Shrunk to fit what is left of the job, never the bare `AGENT_TIMEOUT_MS`: a
      // per-turn cap outliving the runner is a bound that fires after the process
      // is gone, which posts nothing. A **function**, so it is re-read for every turn
      // rather than once when the session boots: this session is memoized for the
      // whole job and the job now runs a turn per plan step, so a number computed at
      // the first prompt would hand the last step a bound sized for a clock half an
      // hour stale — and a bound that outlives the runner posts nothing at all, which
      // is exactly what it exists to prevent.
      timeoutMs: () => turnTimeoutMs(contained, clock()),
      log,
      // Not awaited, and it never rejects: reporting must not be able to fail
      // the turn it is reporting on, and a heartbeat that waited on an HTTP
      // round trip would no longer be a heartbeat.
      onTick: (snapshot) => void status.tick(snapshot),
    }),
  )

  const env = options.env
  const deps = assembleDeps({ config: contained, secrets, event, env, run, log, agent, github, status, now: clock })

  return { proxy, agent, deps }
}

/**
 * The event this run acts on: the payload normalized, and — for a comment typed
 * on a pull request — resolved back to the issue its branch names.
 *
 * `null` covers both halves of "nothing to do": a payload this pipeline does not
 * act on, and a pull-request comment `resolvePullRequestTrigger` declined to
 * claim. Both log their own reason, so this hands back only the fact.
 */
const readEvent = async (args: CliArgs, github: GitHubApi, log: Logger): Promise<TriggerEvent | null> => {
  const payload: unknown = JSON.parse(await readFile(args.eventPath, 'utf8'))
  const parsed = parseTriggerEvent(args.eventName, payload)
  if (parsed === null) {
    log.warn({ eventName: args.eventName }, 'Payload carries nothing this pipeline acts on')
    return null
  }

  if (parsed.kind !== 'pending-pull-request') return parsed
  return resolvePullRequestTrigger(parsed, github, log)
}

/** The credentialled client, built once and handed to both the resolver and `contain`. */
const githubFor = (config: PipelineConfig, secrets: readonly string[], options: MainOptions): GitHubApi =>
  createOctokitApi({
    token: config.githubToken,
    owner: config.owner,
    repo: config.repo,
    secrets,
    ...options.octokit,
  })

/**
 * Entry point shared by the Action and by local `--event-path` runs.
 *
 * Returns a {@link RunResult} rather than exiting so the same call is drivable
 * from a test; `main` below maps the status onto a process exit code.
 */
export const runCli = async (options: MainOptions): Promise<RunResult> => {
  const args = parseArgs(options.argv, options.env)
  // Config first, so the logger is built knowing which values must never be
  // printed. Nothing logs before this point; a config error propagates to
  // `main` instead, and carries no credential.
  const config = loadConfig(options.env, args.repoRoot)
  const log = options.logger ?? createPipelineLogger(args.logLevel, config)
  const secrets = pipelineSecrets(config)

  // Before anything can spawn a child. The OpenCode server inherits this
  // process's environment wholesale, so a credential left here is one the model
  // can read with `bash`.
  const scrubbed = scrubSecrets(options.env, secrets)
  if (scrubbed.length > 0) log.debug({ variables: scrubbed }, 'Removed credentials from the environment')

  // Before the event is even known, because resolving a pull-request comment to
  // its issue is an API call — see {@link ContainInput.github}.
  const github = githubFor(config, secrets, options)
  const event = await readEvent(args, github, log)
  if (event === null) {
    // No marker: nothing was posted, and nothing needs one — this exits 0, so
    // the fallback step is out of scope either way.
    return { status: 'skipped', reason: 'Payload carries nothing to act on', state: null, reported: false }
  }

  const { proxy, agent, deps } = contain({ config, event, log, run: options.run ?? runCommand, options, github })

  log.info(
    { event: args.eventName, kind: event.kind, issue: event.issueNumber, model: config.openai.model },
    'Starting agent pipeline',
  )

  try {
    const result = await runPipeline({ event, deps })
    const phase = result.state === null ? null : result.state.phase
    log.info({ status: result.status, reason: result.reason, phase }, 'Pipeline finished')
    // Only on the returning path. A `runPipeline` that throws is precisely the
    // crash the fallback comment is for, and marking it here would silence the
    // one comment the issue would otherwise get.
    await recordReport(result, options.env, log)
    return result
  } finally {
    // Both hold listening sockets; without this the process stays alive after
    // the work is done and the job dies on its timeout.
    await agent.close()
    await proxy.close()
  }
}

/** Exit codes: 0 for skipped/waiting/completed, 1 only for a genuine failure. */
export const main = async (): Promise<number> => {
  try {
    const result = await runCli({ argv: process.argv.slice(2), env: process.env })
    return result.status === 'failed' ? 1 : 0
  } catch (error) {
    const stack = error instanceof Error && error.stack !== undefined ? error.stack : errorMessage(error)
    process.stderr.write(`${stack}\n`)
    return 1
  }
}

/** True when this module is the process entry, under both Bun and Node. */
const isEntryPoint = (): boolean => {
  const entry = process.argv[1]
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href
}

if (isEntryPoint()) {
  process.exit(await main())
}
