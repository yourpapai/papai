// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { renderPlanArtifact, requireArtifact, SPEC_MARKER } from '../artifacts.js'
import { promptForJson } from '../ask-json.js'
import { missingSpecError } from '../errors.js'
import { branchNameFor } from '../git.js'
import { composeSystemPrompt } from '../obra-skills.js'
import type { PhaseHandler, PhaseInput, PhaseOutcome } from '../phase-context.js'
import { executionPlanSchema, renderPlanMarkdown } from '../plan-steps.js'
import type { ExecutionPlan } from '../plan-steps.js'
import { buildPlanPrompt } from '../prompts.js'
import { mintEnvelope } from './envelope.js'

const PLAN_INSTRUCTIONS = [
  'Break the approved spec into a granular, ordered implementation plan.',
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
  deps.log.info({ issue: state.issueId, branch, revising: feedback !== null }, 'Building the plan')

  const plan = await askForPlan(input, { spec, branch, feedback })

  await deps.git.ensureBranch(branch, await deps.baseBranch())

  const markdown = renderPlanMarkdown(plan)
  // Counted over plans alone, and one local feeds both the heading and the
  // block so the two cannot disagree. `PLAN_POSTED` bumps `planRevision` to
  // exactly this value; revising the spec never moves it.
  const revision = state.planRevision + 1
  return {
    signal: 'PLAN_POSTED',
    comment: renderPlanComment(markdown, branch, revision),
    // The steps ride in the block beside the text they were rendered into, so the
    // implementation walks the very list this comment shows rather than a reading of
    // it. Never recovered by parsing the markdown back: that is the workspace's
    // oldest rule, and it exists because heading-scraping truncated specs.
    blocks: [renderPlanArtifact(markdown, revision, plan.steps)],
    // A new plan is a new list of steps, so the cursor into the old one means
    // nothing. Reset here rather than in `transitions.ts` because it is a fact about
    // what this handler *wrote*, not about the move `PLAN_POSTED` makes — and a
    // cursor carried across a `/changes` would skip work nobody has done, the same
    // argument that retires the handoff note on a plan revision.
    patch: { stepsDone: 0 },
  }
}

/**
 * The one model turn of this phase, asked for as **JSON**.
 *
 * Through `promptForJson`, which re-asks once with the validation complaint attached —
 * which is also what enforces `MAX_PLAN_STEPS`: an over-long plan comes back coarser
 * from the same turn rather than failing the phase. Never `agent.prompt` plus a parse.
 */
const askForPlan = async (
  input: PhaseInput,
  about: { spec: string; branch: string; feedback: string | null },
): Promise<ExecutionPlan> => {
  const { deps, state } = input
  const envelope = mintEnvelope()

  return promptForJson({
    agent: await deps.agent(),
    schema: executionPlanSchema,
    envelope,
    log: deps.log,
    request: {
      system: composeSystemPrompt({
        phase: 'PLANNING',
        skills: await deps.skills('PLANNING'),
        repoRoot: deps.config.repoRoot,
        nonce: envelope.nonce,
        instructions: PLAN_INSTRUCTIONS,
      }),
      prompt: buildPlanPrompt({ envelope, issueNumber: state.issueId, ...about }),
      agent: 'plan',
    },
  })
}

const changeRequest = (input: PhaseInput): string | null => {
  const { command } = input
  if (command === null || command.command !== '/changes') return null
  return command.argument.length > 0 ? command.argument : null
}

const renderPlanComment = (markdown: string, branch: string, revision: number): string =>
  [
    `### Plan (revision ${revision})`,
    '',
    markdown,
    '',
    `Working branch: \`${branch}\`.`,
    '',
    '**What now?** `/approve` to implement this plan, `/changes <what to change>` to revise it,',
    '`/ask <question>` to ask about it, or `/cancel` to stop.',
  ].join('\n')
