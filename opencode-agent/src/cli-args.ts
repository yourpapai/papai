// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'
import process from 'node:process'

import type { FetchLike } from './github.js'
import type { Logger, LogLevel } from './logger.js'
import type { CommandRunner } from './shell.js'

/**
 * The CLI flags, split from `index.ts` when the transcript lifecycle pushed
 * that file past `max-lines`. `index.ts` owns the run; this owns what the run
 * was asked to do. Re-exported from `index.ts`, so callers keep naming one
 * module for the entry point.
 */

export interface CliArgs {
  eventPath: string
  eventName: string
  repoRoot: string
  logLevel: LogLevel
}

export interface MainOptions {
  argv: readonly string[]
  env: NodeJS.ProcessEnv
  logger?: Logger
  run?: CommandRunner
  /** Transport seam for tests; the GitHub adapter's own `fetch` option. */
  fetch?: FetchLike
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
