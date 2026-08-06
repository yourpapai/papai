// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { loadConfig } from './config.js'
import type { PipelineConfig } from './config.js'
import { createGit } from './git.js'
import { createOctokitApi } from './github.js'
import { parseTriggerEvent } from './guardrails.js'
import { createLogger } from './logger.js'
import type { Logger, LogLevel } from './logger.js'
import { loadPhaseSkills } from './obra-skills.js'
import type { SkillDocument } from './obra-skills.js'
import { createOpenCodeAgent } from './opencode-adapter.js'
import type { OpenCodeAgent } from './opencode-adapter.js'
import { runPipeline } from './orchestrator.js'
import type { RunResult } from './orchestrator.js'
import type { PhaseDeps } from './phase-context.js'
import type { CheckRunner } from './review-loop.js'
import { runCommand } from './shell.js'
import type { CommandRunner } from './shell.js'
import type { Phase } from './types.js'
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
      `${message}\n\nUsage: opencode-agent --event-path <file.json> --event-name <issues|issue_comment> [--repo-root <dir>] [--log-level debug|info|warn|error]`,
    )
    this.name = 'UsageError'
  }
}

const LOG_LEVELS: ReadonlySet<string> = new Set(['debug', 'info', 'warn', 'error'])

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

const isLogLevel = (value: string): value is LogLevel => LOG_LEVELS.has(value)

/** Boots the OpenCode session at most once per job. */
const memoizeAgent = (config: PipelineConfig, issueNumber: number): (() => Promise<OpenCodeAgent>) => {
  let pending: Promise<OpenCodeAgent> | null = null

  return () => {
    pending ??= createOpenCodeAgent({
      directory: config.repoRoot,
      model: config.model,
      sessionTitle: `issue-${issueNumber}`,
    })
    return pending
  }
}

const makeCheckRunner =
  (run: CommandRunner, config: PipelineConfig): CheckRunner =>
  (check) =>
    run(check.argv, { cwd: config.repoRoot })

const makeSkillLoader = (config: PipelineConfig): ((phase: Phase) => Promise<SkillDocument[]>) => {
  const cache = new Map<Phase, Promise<SkillDocument[]>>()

  return (phase) => {
    const cached = cache.get(phase)
    if (cached !== undefined) return cached
    const loading = loadPhaseSkills(phase, { repoRoot: config.repoRoot })
    cache.set(phase, loading)
    return loading
  }
}

export interface MainOptions {
  argv: readonly string[]
  env: NodeJS.ProcessEnv
  logger?: Logger
  run?: CommandRunner
}

/**
 * Entry point shared by the Action and by local `--event-path` dry runs.
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
    log.warn({ eventName: args.eventName }, 'Payload carries no issue; nothing to do')
    return { status: 'skipped', reason: 'Payload carries no issue', state: null }
  }

  const run = options.run ?? runCommand
  const deps: PhaseDeps = {
    github: createOctokitApi({ token: config.githubToken, owner: config.owner, repo: config.repo }),
    git: createGit({
      run,
      cwd: config.repoRoot,
      authorName: config.commitAuthorName,
      authorEmail: config.commitAuthorEmail,
    }),
    runCheck: makeCheckRunner(run, config),
    agent: memoizeAgent(config, event.issueNumber),
    skills: makeSkillLoader(config),
    config,
    log,
  }

  log.info(
    { event: args.eventName, action: event.action, issue: event.issueNumber, dryRun: config.dryRun },
    'Starting agent pipeline',
  )

  const result = await runPipeline({ event, deps })
  const phase = result.state === null ? null : result.state.phase
  log.info({ status: result.status, reason: result.reason, phase }, 'Pipeline finished')
  return result
}

/** Exit codes: 0 for skipped/waiting/completed, 1 only for a genuine failure. */
export const main = async (): Promise<number> => {
  try {
    const result = await runCli({ argv: process.argv.slice(2), env: process.env })
    return result.status === 'failed' ? 1 : 0
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`)
    return 1
  }
}

/** True when this module is the process entry, under both Bun and Node. */
const isEntryPoint = (): boolean => {
  const entry = process.argv[1]
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href
}

if (isEntryPoint()) {
  process.exitCode = await main()
}
