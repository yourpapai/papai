// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { CheckFailure, MutationReport } from './review-loop.js'
import type { IssueComment } from './state-manager.js'

/** Wraps untrusted issue text so the model reads it as data, not instructions. */
export const asUntrusted = (label: string, body: string): string =>
  `<untrusted_input source="${label}">\n${body}\n</untrusted_input>`

/** Renders the issue thread for prompt context, newest last. */
export const renderThread = (thread: readonly IssueComment[], limit = 20): string => {
  const recent = thread.slice(-limit)
  if (recent.length === 0) return '(no comments yet)'
  return recent.map((comment) => `@${comment.authorLogin}:\n${comment.body}`).join('\n\n---\n\n')
}

export interface TriagePromptInput {
  issueNumber: number
  title: string
  body: string
  thread: readonly IssueComment[]
}

export const TRIAGE_INSTRUCTIONS = [
  'Decide whether the request below is specified well enough to implement without further input.',
  'Explore the repository before deciding — do not assume a file layout.',
  'Reply with a single JSON object and nothing else:',
  '{"status":"clarify","questions":["…"]} when you need maintainer input, or',
  '{"status":"spec","spec":"<markdown design spec>"} when the request is actionable.',
  'A spec must state: the goal, the files to touch, the intended behaviour change, and how it will be verified.',
  'Ask questions only when a wrong guess would produce the wrong feature; prefer stating an assumption in the spec.',
].join('\n')

export const buildTriagePrompt = (input: TriagePromptInput): string =>
  [
    `GitHub issue #${input.issueNumber}: ${input.title}`,
    asUntrusted('issue-body', input.body),
    'Conversation so far:',
    asUntrusted('issue-thread', renderThread(input.thread)),
    TRIAGE_INSTRUCTIONS,
  ].join('\n\n')

export interface PlanPromptInput {
  issueNumber: number
  spec: string
  branch: string
}

export const buildPlanPrompt = (input: PlanPromptInput): string =>
  [
    `The design spec below was approved by a maintainer for issue #${input.issueNumber}.`,
    asUntrusted('approved-spec', input.spec),
    `Work happens on branch \`${input.branch}\`.`,
    'Produce a granular execution plan as a single JSON object and nothing else:',
    '{"steps":[{"title":"…","files":["…"],"verification":"…"}],"summary":"…"}',
    'Each step must be independently verifiable and touch a named set of files.',
    'Order steps so tests land before or alongside the implementation they cover.',
  ].join('\n\n')

export interface ImplementPromptInput {
  issueNumber: number
  plan: string
}

export const buildImplementPrompt = (input: ImplementPromptInput): string =>
  [
    `Implement the approved plan for issue #${input.issueNumber} in the current working tree.`,
    asUntrusted('approved-plan', input.plan),
    'Write the tests first, then the implementation, then run the tests yourself.',
    'Edit files directly. Do not commit, push, or open a pull request — the pipeline does that.',
    'When finished, reply with a one-paragraph summary of what changed.',
  ].join('\n\n')

export const buildRepairPrompt = (failures: readonly CheckFailure[], round: number): string =>
  [
    `Repository checks failed (repair round ${round}). Fix the root cause in the working tree.`,
    failures
      .map((failure) => `## ${failure.name} (exit ${failure.exitCode})\n\`\`\`\n${failure.output}\n\`\`\``)
      .join('\n\n'),
    'Do not weaken, skip, or delete tests to make a check pass, and do not add lint-disable or type-ignore comments.',
    'Reply with a one-paragraph summary of the fix.',
  ].join('\n\n')

export const buildMutationPrompt = (report: MutationReport, round: number): string =>
  [
    `Mutation testing round ${round} did not clear the threshold${
      report.score === null ? ' (no score reported)' : ` (score ${(report.score * 100).toFixed(1)}%)`
    }.`,
    `\`\`\`\n${report.output}\n\`\`\``,
    'Add or strengthen tests so the surviving mutants are killed. Do not change production behaviour to game the score.',
    'Reply with a one-paragraph summary of the tests you added.',
  ].join('\n\n')

export interface PrPromptInput {
  issueNumber: number
  summary: string
}

export const buildPrBodyPrompt = (input: PrPromptInput): string =>
  [
    `Write the pull request body for the work you just completed on issue #${input.issueNumber}.`,
    asUntrusted('work-summary', input.summary),
    'Use markdown. Cover what changed, why, and how it was verified. Do not include a title line.',
  ].join('\n\n')
