// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { findArtifact, PLAN_MARKER, SPEC_MARKER } from '../artifacts.js'
import { composeSystemPrompt } from '../obra-skills.js'
import type { PhaseHandler, PhaseInput, PhaseOutcome } from '../phase-context.js'
import { ANSWER_INSTRUCTIONS, buildAnswerPrompt } from '../prompts.js'
import { mintEnvelope } from './envelope.js'

/**
 * Answers a maintainer's question without moving the state machine.
 *
 * This is the phase that makes review conversational: a question about the spec
 * or the plan gets a real answer grounded in the repository, and the artefact
 * under review stays exactly where it was. Nothing here writes to the working
 * tree, so an answer can never cost approved work.
 */
export const handleAnswer: PhaseHandler = async (input): Promise<PhaseOutcome> => {
  const { deps, issue, state } = input
  const question = questionText(input)
  deps.log.info({ issue: state.issueId, phase: state.phase }, 'Answering a maintainer question')

  const envelope = mintEnvelope()
  const agent = await deps.agent()
  const reply = await agent.prompt({
    system: composeSystemPrompt({
      phase: state.phase,
      skills: [],
      repoRoot: deps.config.repoRoot,
      nonce: envelope.nonce,
      instructions: ANSWER_INSTRUCTIONS,
    }),
    prompt: buildAnswerPrompt(
      { envelope, issueNumber: issue.number, title: issue.title, body: issue.body, thread: input.thread },
      question,
      await artifactUnderReview(input),
    ),
    agent: 'plan',
  })

  return { signal: 'ANSWERED', comment: renderAnswer(reply.text.trim(), state.phase) }
}

/** The question: an `/ask` argument when given, else the whole comment. */
const questionText = (input: PhaseInput): string => {
  const { command, trigger } = input
  if (command !== null && command.argument.length > 0) return command.argument
  if (trigger.kind === 'issue' && trigger.commentBody !== null) return trigger.commentBody
  return '(the maintainer left no question text)'
}

/** The spec or plan the maintainer is most likely asking about. */
const artifactUnderReview = async (input: PhaseInput): Promise<string | null> => {
  const marker = input.state.phase === 'PLAN_REVIEW' ? PLAN_MARKER : SPEC_MARKER
  const artifact = findArtifact(input.thread, await input.deps.selfLogin(), marker)
  return artifact === null ? null : artifact.text
}

const NEXT_STEPS: Record<string, string> = {
  DESIGN_SPEC: '`/approve` to plan the work, or `/changes <what to change>` to revise the spec.',
  PLAN_REVIEW: '`/approve` to implement the plan, or `/changes <what to change>` to revise it.',
  INIT_OR_CLARIFY: 'Reply with the details I asked for and I will write the spec.',
}

const renderAnswer = (answer: string, phase: string): string => {
  const next = NEXT_STEPS[phase]
  const body = ['### Answer', '', answer.length === 0 ? '_(the model returned an empty answer)_' : answer]
  if (next !== undefined) body.push('', `**Still waiting on you:** ${next}`)
  return body.join('\n')
}
