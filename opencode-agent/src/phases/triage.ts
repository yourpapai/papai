// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { renderArtifact, SPEC_MARKER } from '../artifacts.js'
import { parseModelJson } from '../model-json.js'
import { composeSystemPrompt } from '../obra-skills.js'
import type { PhaseHandler, PhaseInput, PhaseOutcome } from '../phase-context.js'
import { buildTriagePrompt, TRIAGE_INSTRUCTIONS } from '../prompts.js'
import { envelopeFor } from './envelope.js'

const triageSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('clarify'), questions: z.array(z.string().min(1)).min(1) }),
  z.object({ status: z.literal('spec'), spec: z.string().min(1) }),
])

/**
 * Phase 1. Reads the issue plus every maintainer reply so far and either asks
 * for clarification (staying in this phase) or posts a design spec for review.
 *
 * Re-entered whenever a maintainer requests changes to a spec, in which case
 * their feedback is threaded into the prompt and the spec is rewritten rather
 * than regenerated from scratch.
 */
export const handleTriage: PhaseHandler = async (input): Promise<PhaseOutcome> => {
  const { deps, issue, state } = input
  const feedback = changeRequest(input)
  deps.log.info({ issue: state.issueId, revising: feedback !== null }, 'Triaging issue')

  const envelope = envelopeFor(state)
  const agent = await deps.agent()
  const reply = await agent.prompt({
    system: composeSystemPrompt({
      phase: 'INIT_OR_CLARIFY',
      skills: await deps.skills('INIT_OR_CLARIFY'),
      repoRoot: deps.config.repoRoot,
      instructions: TRIAGE_INSTRUCTIONS,
    }),
    prompt: buildTriagePrompt(
      { envelope, issueNumber: issue.number, title: issue.title, body: issue.body, thread: input.thread },
      feedback,
    ),
    agent: 'plan',
  })

  const decision = parseModelJson(reply.text, triageSchema)
  if (decision.status === 'clarify') {
    return { signal: 'NEEDS_CLARIFICATION', comment: renderQuestions(decision.questions) }
  }

  return {
    signal: 'SPEC_POSTED',
    comment: renderSpec(decision.spec, state.revision + 1),
    blocks: [renderArtifact(SPEC_MARKER, decision.spec, state.revision + 1)],
  }
}

/** The maintainer's `/changes` argument, when this run was triggered by one. */
const changeRequest = (input: PhaseInput): string | null => {
  const { command } = input
  if (command === null || command.command !== '/changes') return null
  return command.argument.length > 0 ? command.argument : null
}

const renderQuestions = (questions: readonly string[]): string =>
  [
    '### Clarification needed',
    '',
    'I need a bit more before I can write a design spec:',
    '',
    ...questions.map((question, index) => `${index + 1}. ${question}`),
    '',
    'Reply in this thread with the answers and I will pick it up from there.',
  ].join('\n')

const renderSpec = (spec: string, revision: number): string =>
  [
    `### Design spec (revision ${revision})`,
    '',
    spec.trim(),
    '',
    '**What now?** `/approve` to plan the work, `/changes <what to change>` to revise this spec,',
    '`/ask <question>` to ask about it, or `/cancel` to stop. A plain reply works too — I will',
    'read it as a question unless it clearly asks for changes.',
  ].join('\n')
