// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { missingSpecError } from '../errors.js'
import { branchNameFor } from '../git.js'
import { parseModelJson } from '../model-json.js'
import { composeSystemPrompt } from '../obra-skills.js'
import type { PhaseHandler, PhaseOutcome } from '../phase-context.js'
import { buildPlanPrompt } from '../prompts.js'
import { findAgentSection, PLAN_HEADING, SPEC_HEADING } from '../thread.js'

const planStepSchema = z.object({
  title: z.string().min(1),
  files: z.array(z.string()).default([]),
  verification: z.string().default(''),
})

const planSchema = z.object({
  steps: z.array(planStepSchema).min(1),
  summary: z.string().default(''),
})

export type ExecutionPlan = z.infer<typeof planSchema>

const PLAN_INSTRUCTIONS = [
  'Break the approved spec into a granular, ordered execution plan.',
  'Every step names the files it touches and how it will be verified.',
  'Do not modify any files in this phase — planning only.',
].join('\n')

/**
 * Phase 2. Runs after a maintainer approves the spec: drives the superpowers
 * planning skills to produce a step breakdown and cuts the working branch.
 */
export const handlePlan: PhaseHandler = async (input): Promise<PhaseOutcome> => {
  const { deps, state } = input
  const spec = findAgentSection(input.thread, deps.config.selfLogin, SPEC_HEADING)
  if (spec === null) throw missingSpecError(state.issueId)

  const branch = state.branch ?? branchNameFor(state.issueId)
  deps.log.info({ issue: state.issueId, branch }, 'Building execution plan')

  const agent = await deps.agent()
  const reply = await agent.prompt({
    system: composeSystemPrompt({
      phase: 'EXECUTION_PLAN',
      skills: await deps.skills('EXECUTION_PLAN'),
      repoRoot: deps.config.repoRoot,
      instructions: PLAN_INSTRUCTIONS,
    }),
    prompt: buildPlanPrompt({ issueNumber: state.issueId, spec, branch }),
    agent: 'plan',
  })

  const plan = parseModelJson(reply.text, planSchema)
  await deps.git.ensureBranch(branch, deps.config.baseBranch)

  return {
    signal: 'PLAN_POSTED',
    comment: renderPlan(plan, branch),
    patch: { branch },
  }
}

const renderPlan = (plan: ExecutionPlan, branch: string): string => {
  const steps = plan.steps.map((step, index) => {
    const files = step.files.length === 0 ? '_(no files declared)_' : step.files.map((file) => `\`${file}\``).join(', ')
    const verification = step.verification.trim() === '' ? '_(not stated)_' : step.verification.trim()
    return `${index + 1}. **${step.title}**\n   - Files: ${files}\n   - Verified by: ${verification}`
  })

  const sections = [PLAN_HEADING]
  if (plan.summary.trim() !== '') sections.push(plan.summary.trim())
  sections.push(steps.join('\n'))
  sections.push(`Working branch: \`${branch}\`. Implementing now — I will report back when the review loop settles.`)

  return sections.join('\n\n')
}
