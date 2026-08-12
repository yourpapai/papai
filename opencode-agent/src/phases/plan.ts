// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { promptForJson } from '../ask-json.js'
import { branchNameFor } from '../git.js'
import { composeSystemPrompt } from '../obra-skills.js'
import type { InstructionsResult } from '../openspec-driver.js'
import type { PhaseHandler, PhaseInput, PhaseOutcome } from '../phase-context.js'
import type { UntrustedEnvelope } from '../prompts.js'
import { mintEnvelope } from './envelope.js'

/**
 * Phase 2 — the PLANNING drafter loop (design D3).
 *
 * Reads the change's status from the folder, drafts each pending artifact
 * (typed instruction → model composes per template → write → `validate --strict`
 * → retry once with the complaint attached), commits the lot confined to the
 * folder, and signals `PLAN_POSTED`. The plan is `tasks.md` on the branch now,
 * not an `AGENT_PLAN` block on the issue; the folder is truth (D1).
 *
 * `propose` agent profile: the drafter composes content as a JSON reply and TS
 * writes it, so the model's edit capability is not exercised — but the profile
 * is the one a future model-writes-files drafter would take, and the diff
 * guard's `outsidePrefix` confines whatever lands in the index to the folder.
 */

const draftReplySchema = z.object({ content: z.string().min(1) })

const PROPOSE_INSTRUCTIONS = [
  'You are drafting one artifact of an OpenSpec change folder.',
  'Use the instruction, template and rules below; the artifact must satisfy `openspec validate --strict`.',
  'Reply with a single JSON object and nothing else: {"content":"<markdown>"}',
  'Write only the artifact asked for. Do not invent capabilities or deltas the change does not claim.',
].join('\n')

export const handlePlan: PhaseHandler = async (input): Promise<PhaseOutcome> => {
  const { deps, state } = input
  if (state.changeName === null) throw new Error('PLANNING reached without a changeName on the state')
  const changeName = state.changeName
  const branch = branchNameFor(state.issueId)
  deps.log.info({ issue: state.issueId, change: changeName, branch }, 'Drafting change artifacts')

  await draftUntilComplete(input)
  await deps.git.ensureBranch(branch, await deps.baseBranch())
  await deps.git.commitAll(`docs(openspec): draft artifacts for ${changeName}`)
  await deps.git.push(branch)

  return {
    signal: 'PLAN_POSTED',
    comment: renderPlanComment(changeName, branch, state.planRevision + 1),
    // The plan's identity token bumps; its content lives on the branch.
    patch: { planRevision: state.planRevision + 1, stepsDone: 0 },
  }
}

/**
 * Loops drafting the next ready artifact until `openspec status` reports
 * planning complete. Re-reads status after each artifact so a dependent one
 * (tasks blocked on design) becomes draftable the moment its dependency lands.
 *
 * Tail recursion rather than a loop body: the repo forbids `await` inside a
 * loop, and the drafter is inherently sequential — each artifact's status
 * depends on the previous one landing in the folder.
 */
const draftUntilComplete = async (input: PhaseInput): Promise<void> => {
  const changeName = input.state.changeName
  if (changeName === null) throw new Error('PLANNING reached without a changeName on the state')
  const status = await input.deps.openspec.status(changeName)
  return draftNext(input, changeName, status, 0)
}

const draftNext = async (
  input: PhaseInput,
  changeName: string,
  status: import('../openspec-driver.js').StatusResult,
  depth: number,
): Promise<void> => {
  if (status.isPlanningComplete) return
  if (depth > MAX_DRAFT_ITERATIONS) throw new Error('drafter loop did not converge')
  const next = readyArtifact(status.artifacts)
  if (next === null) return

  const instruction = await input.deps.openspec.instructions(next, changeName)
  await composeAndValidate(input, instruction, null)
  const refreshed = await input.deps.openspec.status(changeName)
  return draftNext(input, changeName, refreshed, depth + 1)
}

/** The first artifact whose status is `ready` (draftable now), or null. */
const readyArtifact = (artifacts: Record<string, string>): string | null => {
  for (const [id, artifactStatus] of Object.entries(artifacts)) {
    if (artifactStatus === 'ready') return id
  }
  return null
}

/** A guard against a driver whose status never converges (a fake loop bug). */
const MAX_DRAFT_ITERATIONS = 16

/**
 * Composes one artifact, writes it, and validates the change. On a validation
 * failure re-asks **once** with the complaint attached, exactly the
 * `promptForJson` pattern generalised to the validate-strict verdict.
 */
const composeAndValidate = async (
  input: PhaseInput,
  instruction: InstructionsResult,
  complaint: string | null,
): Promise<void> => {
  const { deps } = input
  const content = await composeArtifact(input, instruction, complaint)
  await deps.writeFile(instruction.resolvedOutputPath, content)

  const changeName = input.state.changeName
  if (changeName === null) return
  const verdict = await deps.openspec.validateStrict(changeName)
  if (verdict.ok) return

  if (complaint !== null) {
    // Second attempt still invalid: the strict complaint is the failure reason.
    throw new Error(`openspec validate --strict failed after retry: ${verdict.output}`)
  }
  await composeAndValidate(input, instruction, verdict.output)
}

/**
 * Asks the model for the artifact content. `complaint` is null on the first
 * attempt and the validate-strict output on the repair, so the model sees what
 * it got wrong.
 */
const composeArtifact = async (
  input: PhaseInput,
  instruction: InstructionsResult,
  complaint: string | null,
): Promise<string> => {
  const { deps } = input
  const envelope = mintEnvelope()
  const reply = await promptForJson({
    agent: await deps.agent(),
    schema: draftReplySchema,
    envelope,
    log: deps.log,
    request: {
      system: composeSystemPrompt({
        phase: 'PLANNING',
        skills: await deps.skills('PLANNING'),
        repoRoot: deps.config.repoRoot,
        nonce: envelope.nonce,
        instructions: PROPOSE_INSTRUCTIONS,
      }),
      prompt: draftPrompt(envelope, instruction, complaint),
      agent: 'propose',
    },
  })
  return reply.content
}

const draftPrompt = (
  envelope: UntrustedEnvelope,
  instruction: InstructionsResult,
  complaint: string | null,
): string => {
  const sections = [
    `Instruction: ${instruction.instruction}`,
    instruction.template === undefined ? '' : envelope.wrap('template', instruction.template),
    instruction.rules.length === 0 ? '' : `Rules:\n${instruction.rules.map((rule) => `- ${rule}`).join('\n')}`,
    `Write to: ${instruction.resolvedOutputPath}`,
  ].filter((section) => section.length > 0)

  if (complaint !== null) {
    sections.push(
      'Your previous draft failed `openspec validate --strict` with the complaint below. Revise the artifact so it validates.',
      envelope.wrap('validate-complaint', complaint),
    )
  }
  return sections.join('\n\n')
}

const renderPlanComment = (changeName: string, branch: string, revision: number): string =>
  [
    `### Plan (revision ${revision})`,
    '',
    `Change \`${changeName}\` is fully drafted in \`openspec/changes/${changeName}/\` on \`${branch}\`.`,
    '',
    '**What now?** `/approve` to implement the plan, `/changes <what to change>` to revise it,',
    '`/ask <question>` to ask about it, or `/cancel` to stop.',
  ].join('\n')
