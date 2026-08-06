// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { parseModelJson } from '../model-json.js'
import { composeSystemPrompt } from '../obra-skills.js'
import type { PhaseHandler, PhaseOutcome } from '../phase-context.js'
import { buildTriagePrompt, TRIAGE_INSTRUCTIONS } from '../prompts.js'
import { SPEC_HEADING } from '../thread.js'

const triageSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('clarify'), questions: z.array(z.string().min(1)).min(1) }),
  z.object({ status: z.literal('spec'), spec: z.string().min(1) }),
])

/**
 * Phase 1. Reads the issue plus every maintainer reply so far and either asks
 * for clarification (staying in this phase) or posts a design spec for approval.
 */
export const handleTriage: PhaseHandler = async (input): Promise<PhaseOutcome> => {
  const { deps, event, state } = input
  deps.log.info({ issue: state.issueId, phase: state.phase }, 'Triaging issue')

  const agent = await deps.agent()
  const reply = await agent.prompt({
    system: composeSystemPrompt({
      phase: 'INIT_OR_CLARIFY',
      skills: await deps.skills('INIT_OR_CLARIFY'),
      repoRoot: deps.config.repoRoot,
      instructions: TRIAGE_INSTRUCTIONS,
    }),
    prompt: buildTriagePrompt({
      issueNumber: state.issueId,
      title: event.issueTitle,
      body: event.issueBody,
      thread: input.thread,
    }),
    agent: 'plan',
  })

  const decision = parseModelJson(reply.text, triageSchema)
  return decision.status === 'clarify'
    ? { signal: 'NEEDS_CLARIFICATION', comment: renderQuestions(decision.questions) }
    : { signal: 'SPEC_POSTED', comment: renderSpec(decision.spec) }
}

const renderQuestions = (questions: readonly string[]): string =>
  [
    '### Clarification needed',
    '',
    'I need a bit more before I can write a design spec:',
    '',
    ...questions.map((question, index) => `${index + 1}. ${question}`),
    '',
    'Reply in this thread and I will pick it up from there.',
  ].join('\n')

const renderSpec = (spec: string): string =>
  [
    SPEC_HEADING,
    '',
    spec.trim(),
    '',
    '---',
    '',
    'Reply **`/approve`** to have me plan and implement this, **`/replan`** to send it back for another pass, or **`/cancel`** to stop.',
  ].join('\n')
