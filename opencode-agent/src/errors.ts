// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Failures a phase handler can raise. They all end the same way — the
 * orchestrator parks the run in FAILED and posts the message on the issue — so
 * the message text is the whole contract.
 */
export class PipelineError extends Error {
  /** Machine-readable tag, useful when scanning job logs. */
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'PipelineError'
    this.code = code
  }
}

export const missingSpecError = (issueNumber: number): PipelineError =>
  new PipelineError(
    'MISSING_SPEC',
    `No approved design spec found on issue #${issueNumber}. Was the spec comment deleted?`,
  )

export const missingPlanError = (issueNumber: number): PipelineError =>
  new PipelineError('MISSING_PLAN', `No execution plan found on issue #${issueNumber}. Was the plan comment deleted?`)

export const noChangesError = (issueNumber: number): PipelineError =>
  new PipelineError(
    'NO_CHANGES',
    `The agent finished the plan for issue #${issueNumber} without touching a single file. Nothing to commit.`,
  )

export const openCodeError = (message: string): PipelineError => new PipelineError('OPENCODE', message)

export const modelResponseError = (message: string, raw: string): PipelineError =>
  new PipelineError('MODEL_RESPONSE', `${message}\n\nRaw reply:\n${raw.slice(0, 2000)}`)

export const missingSkillError = (phase: string, names: readonly string[]): PipelineError =>
  new PipelineError(
    'MISSING_SKILL',
    `Phase ${phase} requires skills that are not installed: ${names.join(', ')}. ` +
      'Check that the superpowers checkout step ran and populated .superpowers/skills.',
  )
