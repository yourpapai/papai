// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import type { CheckRunner } from './check-loop.js'
import { loadConfig } from './config.js'
import type { PipelineConfig } from './config.js'
import { createGit } from './git.js'
import { createOctokitApi } from './github.js'
import { parseTriggerEvent } from './guardrails.js'
import { createLogger } from './logger.js'
import type { Logger, LogLevel } from './logger.js'
import { loadPhaseSkills } from './obra-skills.js'
import type { SkillDocument } from './obra-skills.js'
import { opencodeConfigEnv } from './openai-config.js'
import { createOpenCodeAgent } from './opencode-adapter.js'
import type { OpenCodeAgent } from './opencode-adapter.js'
import { runPipeline } from './orchestrator.js'
import type { RunResult } from './orchestrator.js'
import type { PhaseDeps, RunReview } from './phase-context.js'
import { runReviewLoop } from './review-runner.js'
import { runCommand } from './shell.js'
import type { CommandRunner } from './shell.js'
import { errorMessage } from './types.js'
import type { Phase } from './types.js'

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

export interface AgentHandle {
  get: () => Promise<OpenCodeAgent>
  close: () => Promise<void>
}

/**
 * Boots the OpenCode session at most once per job, and exposes it for closing.
 *
 * Closing matters more than it looks: the session owns a spawned
 * `opencode serve` holding a listening socket, so a run that forgets to close
 * leaves the process alive after its work is done. Takes the factory as an
 * argument so this — the part with the actual logic — is testable without
 * booting a real server.
 */
export const memoizeAgent = (create: () => Promise<OpenCodeAgent>): AgentHandle => {
  let pending: Promise<OpenCodeAgent> | null = null

  return {
    get: () => {
      pending ??= create()
      return pending
    },
    // Never boots a server just to shut one down, and never turns a teardown
    // failure into a pipeline failure.
    close: async () => {
      if (pending === null) return
      await pending.then((agent) => agent.close()).catch(() => undefined)
    },
  }
}

const makeCheckRunner =
  (run: CommandRunner, config: PipelineConfig): CheckRunner =>
  (check) =>
    run(check.argv, { cwd: config.repoRoot, timeoutMs: config.agentTimeoutMs })

const makeReviewRunner =
  (run: CommandRunner, config: PipelineConfig, log: Logger): RunReview =>
  (plan) =>
    runReviewLoop({
      settings: {
        repoRoot: config.repoRoot,
        openai: config.openai,
        checkCommand: config.checkCommand,
        maxRounds: config.reviewMaxRounds,
        poolSize: config.reviewPoolSize,
        agentTimeoutMs: config.agentTimeoutMs,
      },
      plan,
      run,
      env: opencodeConfigEnv(config.openai),
      log,
      timeoutMs: config.agentTimeoutMs,
    })

const makeSkillLoader = (config: PipelineConfig, log: Logger): ((phase: Phase) => Promise<SkillDocument[]>) => {
  const cache = new Map<Phase, Promise<SkillDocument[]>>()

  return (phase) => {
    const cached = cache.get(phase)
    if (cached !== undefined) return cached
    const loading = loadPhaseSkills(phase, { repoRoot: config.repoRoot, roots: config.skillRoots, log })
    cache.set(phase, loading)
    return loading
  }
}

const assembleDeps = (config: PipelineConfig, run: CommandRunner, log: Logger, agent: AgentHandle): PhaseDeps => ({
  github: createOctokitApi({ token: config.githubToken, owner: config.owner, repo: config.repo }),
  git: createGit({
    run,
    cwd: config.repoRoot,
    authorName: config.commitAuthorName,
    authorEmail: config.commitAuthorEmail,
  }),
  runCheck: makeCheckRunner(run, config),
  runReview: makeReviewRunner(run, config, log),
  agent: agent.get,
  skills: makeSkillLoader(config, log),
  config,
  log,
})

export interface MainOptions {
  argv: readonly string[]
  env: NodeJS.ProcessEnv
  logger?: Logger
  run?: CommandRunner
}

/**
 * Entry point shared by the Action and by local `--event-path` runs.
 *
 * Returns a {@link RunResult} rather than exiting so the same call is drivable
 * from a test; `main` below maps the status onto a process exit code.
 */
export const runCli = async (options: MainOptions): Promise<RunResult> => {
  const args = parseArgs(options.argv, options.env)
  const log = options.logger ?? createLogger({ level: args.logLevel })
  const config = loadConfig(options.env, args.repoRoot)

  const payload: unknown = JSON.parse(await readFile(args.eventPath, 'utf8'))
  const event = parseTriggerEvent(args.eventName, payload)
  if (event === null) {
    log.warn({ eventName: args.eventName }, 'Payload carries nothing this pipeline acts on')
    return { status: 'skipped', reason: 'Payload carries nothing to act on', state: null }
  }

  const run = options.run ?? runCommand
  const agent = memoizeAgent(() =>
    createOpenCodeAgent({
      directory: config.repoRoot,
      openai: config.openai,
      sessionTitle: `issue-${event.issueNumber}`,
    }),
  )
  const deps = assembleDeps(config, run, log, agent)

  log.info(
    { event: args.eventName, kind: event.kind, issue: event.issueNumber, model: config.openai.model },
    'Starting agent pipeline',
  )

  try {
    const result = await runPipeline({ event, deps })
    const phase = result.state === null ? null : result.state.phase
    log.info({ status: result.status, reason: result.reason, phase }, 'Pipeline finished')
    return result
  } finally {
    // The OpenCode server holds a listening socket; without this the process
    // stays alive after the work is done and the job dies on its timeout.
    await agent.close()
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
