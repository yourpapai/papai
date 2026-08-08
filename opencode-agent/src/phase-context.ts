// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { IssueComment } from './blocks.js'
import type { CheckRunner } from './check-loop.js'
import type { ParsedCommand } from './commands.js'
import type { PipelineConfig } from './config.js'
import type { Git } from './git.js'
import type { GitHubApi } from './github.js'
import type { Logger } from './logger.js'
import type { SkillDocument } from './obra-skills.js'
import type { OpenCodeAgent } from './opencode-adapter.js'
import type { ReviewRunResult } from './review-runner.js'
import type { StatusReporter } from './status-reporter.js'
import type { TriggerEvent } from './trigger-events.js'
import type { AgentState, Phase } from './types.js'

/** The issue a run is about, however the run was triggered. */
export interface IssueContext {
  number: number
  title: string
  body: string
}

export interface RunReview {
  (plan: string): Promise<ReviewRunResult>
}

/**
 * Everything a phase handler is allowed to touch. Every field is an interface or
 * a function so the whole state machine runs against fakes in tests.
 */
export interface PhaseDeps {
  github: GitHubApi
  git: Git
  runCheck: CheckRunner
  /** Drives the `review-loop/` workspace over the working tree. */
  runReview: RunReview
  /** Memoized: the OpenCode server only boots for phases that prompt the model. */
  agent: () => Promise<OpenCodeAgent>
  /**
   * Tokens this job has spent so far. `0` when no session was opened.
   *
   * On `PhaseDeps` rather than reached for through `agent()`, because asking
   * costs nothing when nothing was spent and booting a server to find that out
   * would cost a great deal.
   */
  tokensUsed: () => Promise<number>
  skills: (phase: Phase) => Promise<SkillDocument[]>
  /**
   * Branch new work forks from and pull requests target. Memoized and lazy:
   * resolving it can cost a round trip to the remote, and a run stopped by a
   * guardrail must never pay that — or fail on it.
   */
  baseBranch: () => Promise<string>
  /**
   * The login the agent posts as. Memoized and lazy for the same reason as
   * `baseBranch`, and load-bearing for more: it is the author filter that state
   * and artefacts are read back through, not just the recursion guard.
   */
  selfLogin: () => Promise<string>
  /**
   * The run's live status comment, as an injected boundary like every other.
   *
   * Required rather than optional so a caller has to decide, and
   * `noopStatusReporter()` is a decision: a local run with no job to link to
   * says nothing, and says so once, in `deps.ts`.
   */
  status: StatusReporter
  /**
   * The clock, as an injected boundary like every other.
   *
   * `time-budget.ts` decides whether the job has time for another phase, and a
   * bound that reads `Date.now()` directly is one no test can put on either side
   * of. One clock per run rather than one per module, so the deadline the cascade
   * checks and the deadline the session is handed cannot disagree.
   */
  now: () => number
  config: PipelineConfig
  log: Logger
}

export interface PhaseInput {
  state: AgentState
  issue: IssueContext
  trigger: TriggerEvent
  command: ParsedCommand | null
  /** Full issue thread, oldest first — the conversation the model reasons over. */
  thread: readonly IssueComment[]
  deps: PhaseDeps
}

/**
 * What the phase cascade carries on top of a handler's input.
 *
 * Here rather than in `orchestrator.ts`, where it began, because the cascade is
 * no longer the only module that reasons over it: `token-budget.ts` decides
 * whether the next phase can be afforded, and a shape shared by two modules in
 * the file one of them owns is how an import cycle starts.
 */
export interface MachineInput extends PhaseInput {
  answer: boolean
  /** Whether this run has already written a state block to the thread. */
  posted: boolean
  /** Tokens this issue had spent before this job started. */
  carriedTokens: number
}

/**
 * What a handler reports. The handler never writes state or decides the next
 * phase; the runner applies `signal` to the state machine and posts `comment`
 * with the resulting state block appended.
 *
 * `blocks` carries hidden artefact blocks (spec, plan, report) to append after
 * the visible body, so a later job can read them back exactly.
 */
export interface PhaseOutcome {
  signal: import('./types.js').TransitionSignal
  comment: string
  blocks?: readonly string[]
  patch?: Partial<AgentState>
}

export type PhaseHandler = (input: PhaseInput) => Promise<PhaseOutcome>
