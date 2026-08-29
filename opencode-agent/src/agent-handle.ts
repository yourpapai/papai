// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { RunSpend } from './agent-session.js'
import type { OpenCodeAgent } from './opencode-adapter.js'

/**
 * The OpenCode session's lifetime within one job: booted at most once, asked
 * what it spent, and closed.
 *
 * Split out of `index.ts` when the pull-request resolver pushed that file past
 * its length limit, and split here rather than anywhere else because `deps.ts`
 * was already reaching *back* into `index.ts` for {@link AgentHandle} — a module
 * documented as "split from `index.ts`" importing from it is the seam declaring
 * itself in the wrong place. The CLI entry owns flags, credential containment
 * and process lifetime; a memoized session is none of those.
 */
export interface AgentHandle {
  get: () => Promise<OpenCodeAgent>
  /**
   * Tokens this job has spent, or `0` when no session was ever opened.
   *
   * Zero is the honest answer, not a fallback: most phases never prompt the
   * model, and booting a server to ask what it has not spent would cost more
   * than the guardrail saves.
   */
  tokensUsed: () => Promise<number>
  /**
   * What this job spent and what its provider says about its limits, or nothing
   * at all when no session was ever opened.
   *
   * The empty answer mirrors `tokensUsed`'s zero and differs from it in one
   * telling way: an unopened session is `usd: null`, not `usd: 0`. Zero tokens
   * is the truth for a job that never prompted; zero *dollars* would be a
   * priced claim about work that was never done.
   */
  spend: () => Promise<RunSpend>
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
    tokensUsed: async () => {
      if (pending === null) return 0
      return (await pending).tokensUsed()
    },
    spend: async () => {
      if (pending === null) return { usd: null, source: 'none', windows: [] }
      return (await pending).spend()
    },
    // Never boots a server just to shut one down, and never turns a teardown
    // failure into a pipeline failure.
    close: async () => {
      if (pending === null) return
      await pending.then((agent) => agent.close()).catch(() => undefined)
    },
  }
}
