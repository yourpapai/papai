// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { renderArtifact, SPEC_MARKER } from '../artifacts.js'
import { promptForJson } from '../ask-json.js'
import { composeSystemPrompt } from '../obra-skills.js'
import type { PhaseHandler, PhaseInput, PhaseOutcome } from '../phase-context.js'
import { buildTriagePrompt, TRIAGE_INSTRUCTIONS } from '../prompts.js'
import { mintEnvelope } from './envelope.js'

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

  const envelope = mintEnvelope()
  const agent = await deps.agent()
  const decision = await promptForJson({
    agent,
    schema: triageSchema,
    envelope,
    log: deps.log,
    request: {
      system: composeSystemPrompt({
        phase: 'INIT_OR_CLARIFY',
        skills: await deps.skills('INIT_OR_CLARIFY'),
        repoRoot: deps.config.repoRoot,
        nonce: envelope.nonce,
        instructions: TRIAGE_INSTRUCTIONS,
      }),
      prompt: buildTriagePrompt(
        { envelope, issueNumber: issue.number, title: issue.title, body: issue.body, thread: input.thread },
        feedback,
      ),
      agent: 'plan',
    },
  })

  if (decision.status === 'clarify') {
    return { signal: 'NEEDS_CLARIFICATION', comment: renderQuestions(decision.questions) }
  }

  // One local feeds both the visible heading and the hidden block, so the number
  // a maintainer reads and the number the next job reads back cannot drift
  // apart. `SPEC_POSTED` bumps `specRevision` to exactly this value, and counts
  // only specs — the shared counter it replaced had the first plan on a fresh
  // issue call itself revision 2.
  const revision = state.specRevision + 1
  return {
    signal: 'SPEC_POSTED',
    comment: renderSpec(decision.spec, revision),
    blocks: [renderArtifact(SPEC_MARKER, decision.spec, revision)],
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
