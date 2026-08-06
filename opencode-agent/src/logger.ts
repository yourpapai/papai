// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

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

/** Keys whose values are replaced with `[redacted]` before anything is printed. */
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

  const emit = (level: LogLevel, fields: LogFields, message: string): void => {
    if (LEVEL_RANK[level] < minimum) return
    sink(JSON.stringify({ time: now(), level, message, ...redact(fields) }))
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
