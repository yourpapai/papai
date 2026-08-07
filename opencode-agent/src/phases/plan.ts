// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { PLAN_MARKER, renderArtifact, requireArtifact, SPEC_MARKER } from '../artifacts.js'
import { missingSpecError } from '../errors.js'
import { branchNameFor } from '../git.js'
import { parseModelJson } from '../model-json.js'
import { composeSystemPrompt } from '../obra-skills.js'
import type { PhaseHandler, PhaseInput, PhaseOutcome } from '../phase-context.js'
import { buildPlanPrompt } from '../prompts.js'
import { mintEnvelope } from './envelope.js'

const planStepSchema = z.object({
  title: z.string().min(1),
  files: z.array(z.string()).default([]),
  verification: z.string().default(''),
})

const planSchema = z.object({ steps: z.array(planStepSchema).min(1), summary: z.string().default('') })

export type ExecutionPlan = z.infer<typeof planSchema>

const PLAN_INSTRUCTIONS = [
  'Break the approved spec into a granular, ordered execution plan.',
  'Every step names the files it touches and how it will be verified.',
  'Do not modify any files in this phase — planning only.',
].join('\n')

/**
 * Phase 2. Runs after a maintainer approves the spec: drives the superpowers
 * planning skills to produce a step breakdown and cuts the working branch.
 *
 * Re-entered when a maintainer requests changes to a plan, with their feedback
 * threaded into the prompt.
 */
export const handlePlan: PhaseHandler = async (input): Promise<PhaseOutcome> => {
  const { deps, state } = input
  const spec = requireArtifact(input.thread, await deps.selfLogin(), SPEC_MARKER, () => missingSpecError(state.issueId))

  const branch = branchNameFor(state.issueId)
  const feedback = changeRequest(input)
  deps.log.info({ issue: state.issueId, branch, revising: feedback !== null }, 'Building execution plan')

  const envelope = mintEnvelope()
  const agent = await deps.agent()
  const reply = await agent.prompt({
    system: composeSystemPrompt({
      phase: 'EXECUTION_PLAN',
      skills: await deps.skills('EXECUTION_PLAN'),
      repoRoot: deps.config.repoRoot,
      nonce: envelope.nonce,
      instructions: PLAN_INSTRUCTIONS,
    }),
    prompt: buildPlanPrompt({
      envelope,
      issueNumber: state.issueId,
      spec,
      branch,
      feedback,
    }),
    agent: 'plan',
  })

  const plan = parseModelJson(reply.text, planSchema)
  await deps.git.ensureBranch(branch, await deps.baseBranch())

  const markdown = renderPlanMarkdown(plan)
  return {
    signal: 'PLAN_POSTED',
    comment: renderPlanComment(markdown, branch, state.revision + 1),
    blocks: [renderArtifact(PLAN_MARKER, markdown, state.revision + 1)],
  }
}

const changeRequest = (input: PhaseInput): string | null => {
  const { command } = input
  if (command === null || command.command !== '/changes') return null
  return command.argument.length > 0 ? command.argument : null
}

/** The plan as markdown — this exact text is what the implement phase acts on. */
export const renderPlanMarkdown = (plan: ExecutionPlan): string => {
  const steps = plan.steps.map((step, index) => {
    const files = step.files.length === 0 ? '_(no files declared)_' : step.files.map((file) => `\`${file}\``).join(', ')
    const verification = step.verification.trim() === '' ? '_(not stated)_' : step.verification.trim()
    return `${index + 1}. **${step.title}**\n   - Files: ${files}\n   - Verified by: ${verification}`
  })

  const sections: string[] = []
  if (plan.summary.trim() !== '') sections.push(plan.summary.trim())
  sections.push(steps.join('\n'))
  return sections.join('\n\n')
}

const renderPlanComment = (markdown: string, branch: string, revision: number): string =>
  [
    `### Execution plan (revision ${revision})`,
    '',
    markdown,
    '',
    `Working branch: \`${branch}\`.`,
    '',
    '**What now?** `/approve` to implement this plan, `/changes <what to change>` to revise it,',
    '`/ask <question>` to ask about it, or `/cancel` to stop.',
  ].join('\n')
