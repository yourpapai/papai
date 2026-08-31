// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { rm } from 'node:fs/promises'

import { openClaudeContext, resolveAgentBackend } from '../../review-loop/src/backend-select.js'
import type { OrchestratorDeps } from './gate-digest.js'

/**
 * The claude route's run-entry gate (design D3): the credential guard and the
 * run-scoped config-dir parent, opened once on the first run-driving verb and
 * removed when the process finishes its work.
 *
 * Lazy rather than eager in `buildHarness`, because the read-only verbs
 * (`stop`, `analyze`, a report) must keep working on a claude-route config
 * with no credential in the environment — they never spend, so they never
 * need one. Lazy rather than at first spawn, because a refusal must precede
 * the run directory: an operator who mis-set their environment should learn
 * it before a run id exists to resume.
 */

/**
 * The runner's own config-dir parent prefix. Distinct from review-loop's so a
 * leaked parent names the workspace that opened it.
 */
export const CLAUDE_TMP_PREFIX = 'sdd-runner-claude-'

export interface ClaudeGate {
  /** Guard the environment and open the context; a no-op off the claude route. */
  ensure(): Promise<void>
  /** Remove whatever `ensure` opened. Best-effort: never the reason a verb fails. */
  close(): Promise<void>
}

export function claudeGateOf(deps: OrchestratorDeps): ClaudeGate {
  // Memoized on the promise, not a boolean: two run-driving members in one
  // process (the session loop's list-then-act) share the one parent, and a
  // second `mkdtemp` would leak the first.
  let opened: Promise<string> | null = null
  return {
    ensure: async (): Promise<void> => {
      if (deps.config.backend !== 'claude') return
      // Throws before the assignment on a refused environment, so a later
      // member re-runs the guard rather than inheriting a rejected promise.
      opened ??= openClaudeContext(deps, resolveAgentBackend('claude', process.env), CLAUDE_TMP_PREFIX)
      await opened
    },
    close: async (): Promise<void> => {
      if (opened === null) return
      const parent = await opened.catch(() => null)
      if (parent === null) return
      // Swallowed here rather than at the call site: a tmp dir that outlives
      // the process is not worth turning a settled verb into a failure.
      await rm(parent, { recursive: true, force: true }).catch(() => undefined)
    },
  }
}

/**
 * Wraps one run-driving harness member so the gate runs before it. The
 * wrapper is what makes the guard uniform: a member added later without it
 * would spend on the claude route with no context assembled.
 */
export function withClaude<A extends readonly unknown[], R>(
  gate: ClaudeGate,
  member: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return async (...args: A): Promise<R> => {
    await gate.ensure()
    return member(...args)
  }
}
