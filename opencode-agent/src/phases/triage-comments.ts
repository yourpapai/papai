// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { renderDigest } from '../artifacts.js'

/**
 * What triage says on the issue, for each of the four ways a triage turn ends.
 *
 * Split from `triage.ts` when the adoption branch pushed that file past
 * `max-lines`, along the seam it already had: everything left there decides —
 * which outcome the model chose, whether the author may capture, whether a
 * folder is created or adopted — while this is what a maintainer reads. The two
 * change for different reasons, and only this half is prose.
 */

export const renderQuestions = (questions: readonly string[]): string =>
  [
    '### Clarification needed',
    '',
    'I need a bit more before I can capture this as a change:',
    '',
    ...questions.map((question, index) => `${index + 1}. ${question}`),
    '',
    'Reply in this thread with the answers and I will pick it up from there.',
  ].join('\n')

export const renderAnswer = (reply: string): string =>
  [
    '### Answer',
    '',
    reply.trim(),
    '',
    '_This looks like a question rather than work — reply with the details if you want me to capture it as a change._',
  ].join('\n')

export const renderConsent = (changeName: string): string =>
  [
    '### Ready to capture',
    '',
    `I would scaffold this as \`openspec/changes/${changeName}/\` and plan the work — but I want a maintainer to confirm first.`,
    '',
    'Reply to confirm (or describe what should change), and I will pick it up from there.',
  ].join('\n')

interface CaptureRender {
  readonly changeName: string
  readonly proposal: string
  readonly branch: string
  /**
   * The artifacts still to draft when this capture adopted an existing change,
   * or `null` when it scaffolded a new one.
   *
   * One field rather than a boolean and a list, because there is no fourth
   * state: a new folder has nothing to report but its proposal, and an adopted
   * one is worth reporting even when the answer is "nothing" — that is the
   * difference between `/approve` drafting three artifacts and planning
   * immediately.
   */
  readonly pending: readonly string[] | null
}

export const renderCapture = (render: CaptureRender): string => {
  const { changeName, proposal, branch, pending } = render
  const heading =
    pending === null
      ? [
          `### Captured: ${changeName}`,
          '',
          `Captured into \`openspec/changes/${changeName}/\`. The proposal drafted from the issue:`,
        ]
      : [
          `### Adopted: ${changeName}`,
          '',
          `\`openspec/changes/${changeName}/\` already exists, so I picked that change up rather than starting a new one. Its proposal:`,
        ]
  return [
    ...heading,
    '',
    renderDigest(proposal, { changeName, branch, revision: null }),
    ...(pending === null ? [] : ['', renderPending(pending)]),
    '',
    '**What now?** `/approve` to plan the work, `/changes <what to change>` to revise the proposal,',
    '`/ask <question>` to ask about it, or `/cancel` to stop. A plain reply works too — I will',
    'read it as a question unless it clearly asks for changes.',
  ].join('\n')
}

const renderPending = (pending: readonly string[]): string =>
  pending.length === 0
    ? 'Every planning artifact is already drafted — `/approve` re-reads the folder and posts its plan for review.'
    : `Still to draft: ${pending.map((id) => `\`${id}\``).join(', ')} — \`/approve\` composes them through the ` +
      'OpenSpec artifact workflow before the plan is posted.'
