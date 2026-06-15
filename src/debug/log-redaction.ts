// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { LogEntry } from './log-buffer.js'

const REDACTED = '[redacted]'

/** Non-identifying fields safe to surface in the /debug + /logs egress. Default-deny: anything not here is dropped. */
const ALLOWED_FIELDS = new Set<string>([
  'level',
  'time',
  'scope',
  'turnId',
  'durationMs',
  'messageLength',
  'stepCount',
  'toolCount',
  'messageCount',
  'count',
  'size',
  'capacity',
  'tickCount',
  'statusCode',
  'ok',
  'success',
  'finishReason',
  'errorType',
  'errorCode',
  'toolName',
])

/** Known content-free static log messages shown verbatim; every other msg is redacted. Extend as new safe templates appear. */
const SAFE_MSG_TEMPLATES = new Set<string>(['Message received from user', 'Tool execution failed'])

/** Allowlist-redact a log entry for the privacy-constrained /debug + /logs egress. Pure; never mutates the input. */
export function redactLogEntry(entry: LogEntry): LogEntry {
  const out: LogEntry = {
    level: entry.level,
    time: entry.time,
    msg: SAFE_MSG_TEMPLATES.has(entry.msg) ? entry.msg : REDACTED,
  }
  for (const [key, value] of Object.entries(entry)) {
    if (key === 'level' || key === 'time' || key === 'msg') continue
    if (ALLOWED_FIELDS.has(key)) out[key] = value
  }
  return out
}
