// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { SlashCommand } from './commands.js'
import type { PipelineConfig } from './config.js'
import type { Git } from './git.js'
import type { GitHubApi } from './github.js'
import type { TriggerEvent } from './guardrails.js'
import type { Logger } from './logger.js'
import type { SkillDocument } from './obra-skills.js'
import type { OpenCodeAgent } from './opencode-adapter.js'
import type { CheckRunner } from './review-loop.js'
import type { IssueComment } from './state-manager.js'
import type { AgentState, Phase, TransitionSignal } from './types.js'

/**
 * Everything a phase handler is allowed to touch. Every field is an interface or
 * a function so the whole state machine runs against fakes in tests.
 */
export interface PhaseDeps {
  github: GitHubApi
  git: Git
  runCheck: CheckRunner
  /** Memoized: the OpenCode server only boots for phases that prompt the model. */
  agent: () => Promise<OpenCodeAgent>
  skills: (phase: Phase) => Promise<SkillDocument[]>
  config: PipelineConfig
  log: Logger
}

export interface PhaseInput {
  state: AgentState
  event: TriggerEvent
  command: SlashCommand | null
  /** Full issue thread, oldest first — the conversation the model reasons over. */
  thread: readonly IssueComment[]
  deps: PhaseDeps
}

/**
 * What a handler reports. The handler never writes state or decides the next
 * phase; the runner applies `signal` to the state machine and posts `comment`
 * with the resulting state block appended.
 */
export interface PhaseOutcome {
  signal: TransitionSignal
  comment: string
  patch?: Partial<AgentState>
}

export type PhaseHandler = (input: PhaseInput) => Promise<PhaseOutcome>
