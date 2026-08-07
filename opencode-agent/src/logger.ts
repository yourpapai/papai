// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { PipelineConfig } from './config.js'
import { pipelineSecrets, redactSecrets } from './secrets.js'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogFields = Record<string, unknown>

/** Metadata-first structured logger, matching the repo's pino call shape. */
export interface Logger {
  debug(fields: LogFields, message: string): void
  info(fields: LogFields, message: string): void
  warn(fields: LogFields, message: string): void
  error(fields: LogFields, message: string): void
}

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

/**
 * Keys whose values are replaced with `[redacted]` before anything is printed.
 *
 * Kept alongside the value-based pass below, because the two cover different
 * things and neither subsumes the other: this catches a credential the pipeline
 * does not know — a third-party token that arrived in a field called `token` —
 * while the value pass catches this pipeline's own credentials wherever they
 * appear, including inside prose it never named.
 */
const REDACT_KEYS: ReadonlySet<string> = new Set([
  'token',
  'githubToken',
  'apiKey',
  'anthropicApiKey',
  'openaiApiKey',
  'authorization',
  'password',
  'secret',
])

export const redact = (fields: LogFields): LogFields => {
  const safe: LogFields = {}
  for (const [key, value] of Object.entries(fields)) {
    safe[key] = REDACT_KEYS.has(key) ? '[redacted]' : value
  }
  return safe
}

export interface LoggerOptions {
  level?: LogLevel
  /** Injection seam for tests; defaults to writing NDJSON to stdout. */
  sink?: (line: string) => void
  /** Injected so logs stay deterministic under test. */
  now?: () => string
  /**
   * Credential values stripped from every line, wherever they appear.
   *
   * Redacting by field name only works when a secret arrives in a field
   * somebody named. A git stderr quoted into a message, a provider error
   * repeated into `error`, a command echoed into an `argv` array — none of
   * those have a key to match on, and all three used to print in full.
   */
  secrets?: readonly string[]
}

/**
 * Emits NDJSON on stdout — the Actions log viewer renders it verbatim and the
 * lines stay greppable when a job is downloaded as a raw log.
 */
export const createLogger = (options: LoggerOptions = {}): Logger => {
  const minimum = LEVEL_RANK[options.level ?? 'info']
  const now = options.now ?? ((): string => new Date().toISOString())
  const sink =
    options.sink ??
    ((line: string): void => {
      process.stdout.write(`${line}\n`)
    })

  const secrets = options.secrets ?? []

  const emit = (level: LogLevel, fields: LogFields, message: string): void => {
    if (LEVEL_RANK[level] < minimum) return
    // Redacted on the serialized line, not per field: that reaches the message,
    // any key the caller invented, and any depth of nesting, without this
    // module having to walk an arbitrary object.
    sink(redactSecrets(JSON.stringify({ time: now(), level, message, ...redact(fields) }), secrets))
  }

  return {
    debug: (fields, message): void => {
      emit('debug', fields, message)
    },
    info: (fields, message): void => {
      emit('info', fields, message)
    },
    warn: (fields, message): void => {
      emit('warn', fields, message)
    },
    error: (fields, message): void => {
      emit('error', fields, message)
    },
  }
}

/**
 * The logger the pipeline runs with: level from the CLI, secrets from config.
 *
 * A named factory rather than an inline `createLogger({ ... })` at the call
 * site, because the interesting property is *that the secrets are wired in* —
 * and a call site is not a thing a test can hold. Dropping the argument from an
 * inline construction killed no test; dropping it from here does.
 */
export const createPipelineLogger = (level: LogLevel, config: PipelineConfig, sink?: (line: string) => void): Logger =>
  createLogger({ level, secrets: pipelineSecrets(config), sink })
