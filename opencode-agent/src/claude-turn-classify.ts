// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ClaudeStreamLine } from './claude-contract.js'
import { claudeExitError, claudeResultError } from './errors.js'
import { redactSecrets } from './secrets.js'

/**
 * How one finished claude turn is judged — split from `claude-adapter.ts`
 * when that file reached `max-lines`, along the seam the module doctrine
 * already drew: the adapter holds the *session*, this holds one turn's
 * verdict. The stream-json family owns error-shaped and empty results
 * whatever the exit status; exit discipline owns the rest.
 */

/** How much of a stderr tail a `CLAUDE_EXIT` failure quotes, after redaction. */
export const STDERR_TAIL_CHARS = 2_000

/** One turn's captured outcome. */
export interface TurnOutcome {
  text: string
  sessionId: string
}

/** The facts one finished turn was captured with. */
export interface CapturedTurn {
  result: Extract<ClaudeStreamLine, { kind: 'result' }> | null
  initSeen: boolean
  stderr: string
  exitCode: number | null
}

/** Classifies one finished turn, raising its own `PipelineError` family on every bad shape. */
export const classifyTurn = (
  captured: CapturedTurn,
  session: { cliSessionId: string | null; credentialValues: readonly string[] },
): TurnOutcome => {
  const { result, initSeen, stderr, exitCode } = captured

  if (result !== null && result.isError) {
    throw claudeResultError('the result line signalled an error (is_error)')
  }
  if (result !== null && result.text.trim() === '') {
    throw claudeResultError('the result line carried empty final text')
  }
  if (exitCode !== 0) {
    throw claudeExitError(exitCode ?? -1, redactSecrets(stderr.slice(-STDERR_TAIL_CHARS), session.credentialValues))
  }
  if (result === null) {
    throw claudeResultError('no decodable result line arrived before the stream ended')
  }
  if (!initSeen && session.cliSessionId === null) {
    // Resolving under a synthetic id would either hand `--resume` an id the
    // CLI refuses or silently fork the session's context mid-job.
    throw claudeResultError('no session id exists — no init line this turn and none memoized from an earlier one')
  }

  return { text: result.text, sessionId: session.cliSessionId ?? result.sessionId }
}
