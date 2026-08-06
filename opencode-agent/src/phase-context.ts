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
import type { TriggerEvent } from './guardrails.js'
import type { Logger } from './logger.js'
import type { SkillDocument } from './obra-skills.js'
import type { OpenCodeAgent } from './opencode-adapter.js'
import type { ReviewRunResult } from './review-runner.js'
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
  skills: (phase: Phase) => Promise<SkillDocument[]>
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
