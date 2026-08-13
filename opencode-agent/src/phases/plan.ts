// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { renderDigest } from '../artifacts.js'
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
  const feedback = revisionFeedback(input)
  deps.log.info(
    { issue: state.issueId, change: changeName, branch, revising: feedback !== null },
    'Drafting change artifacts',
  )

  // Before the drafter reads anything. The change folder was scaffolded by the
  // job that captured the issue and pushed to `agent/issue-<n>`; this job — the
  // one a maintainer's `/approve` started, minutes or days later — begins on the
  // base branch, because the workflow's `actions/checkout` names no ref and
  // moving onto the branch is this pipeline's own job. Drafting first asked
  // `openspec status` about a change the base branch has never heard of, and the
  // CLI answered by listing the changes it could see, exit 1.
  await deps.git.ensureBranch(branch, await deps.baseBranch())

  await draftUntilComplete(input, feedback)
  await deps.git.commitAll(`docs(openspec): draft artifacts for ${changeName}`)
  await deps.git.push(branch)

  // The plan digest is a render of the folder's tasks.md, read straight back
  // from where the drafter wrote it (design D1) — not a memory of the model
  // reply. The revision token is the machine's plan identity; the branch's
  // commits are the artifact's real history, and the digest says so.
  const tasks = await readTasksArtifact(input, changeName)
  return {
    signal: 'PLAN_POSTED',
    comment: renderPlanComment(changeName, branch, state.planRevision + 1, tasks),
    // The plan's identity token bumps; its content lives on the branch.
    patch: { planRevision: state.planRevision + 1, stepsDone: 0 },
  }
}

/**
 * The maintainer feedback a re-draft is grounded in, or `null` for a fresh plan.
 *
 * Two channels reach PLANNING with feedback: `/changes <argument>` from a
 * waiting phase, and a plain steering comment (design D6) that arrived
 * mid-implementation and routed back here. Both tell the drafter what to revise;
 * a first plan (`/approve` out of `DESIGN_SPEC`) carries neither, and the
 * drafter composes from the instruction alone.
 */
const revisionFeedback = (input: PhaseInput): string | null => {
  const { command, trigger } = input
  if (command !== null && command.command === '/changes' && command.argument.length > 0) {
    return command.argument
  }
  if (command === null && trigger.kind === 'issue') {
    const body = trigger.commentBody
    if (body !== null && body.trim().length > 0) return body.trim()
  }
  return null
}

/**
 * Resolves the change's `tasks.md` path from the folder and reads it back, the
 * same read the implementation and review phases make of the approved plan.
 */
const readTasksArtifact = async (input: PhaseInput, changeName: string): Promise<string> => {
  const tasksPath = (await input.deps.openspec.instructions('tasks', changeName)).resolvedOutputPath
  return input.deps.readFile(tasksPath)
}

/**
 * Loops drafting the next ready artifact until `openspec status` reports
 * planning complete. Re-reads status after each artifact so a dependent one
 * (tasks blocked on design) becomes draftable the moment its dependency lands.
 *
 * `feedback` is the maintainer's revision request when PLANNING was re-entered
 * via `/changes` or a steering comment (D6); it threads into every artifact's
 * draft prompt so a re-draft revises against it rather than composing blind.
 *
 * Tail recursion rather than a loop body: the repo forbids `await` inside a
 * loop, and the drafter is inherently sequential — each artifact's status
 * depends on the previous one landing in the folder.
 */
const draftUntilComplete = async (input: PhaseInput, feedback: string | null): Promise<void> => {
  const changeName = input.state.changeName
  if (changeName === null) throw new Error('PLANNING reached without a changeName on the state')
  const status = await input.deps.openspec.status(changeName)
  return draftNext(input, changeName, status, feedback, 0)
}

const draftNext = async (
  input: PhaseInput,
  changeName: string,
  status: import('../openspec-driver.js').StatusResult,
  feedback: string | null,
  depth: number,
): Promise<void> => {
  if (status.isPlanningComplete) return
  if (depth > MAX_DRAFT_ITERATIONS) throw new Error('drafter loop did not converge')
  const next = readyArtifact(status.artifacts)
  if (next === null) return

  const instruction = await input.deps.openspec.instructions(next, changeName)
  await composeAndValidate(input, instruction, null, feedback)
  const refreshed = await input.deps.openspec.status(changeName)
  return draftNext(input, changeName, refreshed, feedback, depth + 1)
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
  feedback: string | null,
): Promise<void> => {
  const { deps } = input
  const content = await composeArtifact(input, instruction, complaint, feedback)
  await deps.writeFile(instruction.resolvedOutputPath, content)

  const changeName = input.state.changeName
  if (changeName === null) return
  const verdict = await deps.openspec.validateStrict(changeName)
  if (verdict.ok) return

  if (complaint !== null) {
    // Second attempt still invalid: the strict complaint is the failure reason.
    throw new Error(`openspec validate --strict failed after retry: ${verdict.output}`)
  }
  await composeAndValidate(input, instruction, verdict.output, feedback)
}

/**
 * Asks the model for the artifact content. `complaint` is null on the first
 * attempt and the validate-strict output on the repair, so the model sees what
 * it got wrong. `feedback` is the maintainer's revision request when the draft
 * is a re-plan (D6), null on a fresh plan.
 */
const composeArtifact = async (
  input: PhaseInput,
  instruction: InstructionsResult,
  complaint: string | null,
  feedback: string | null,
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
      prompt: draftPrompt(envelope, instruction, complaint, feedback),
      agent: 'propose',
    },
  })
  return reply.content
}

const draftPrompt = (
  envelope: UntrustedEnvelope,
  instruction: InstructionsResult,
  complaint: string | null,
  feedback: string | null,
): string => {
  const sections = [
    `Instruction: ${instruction.instruction}`,
    instruction.template === undefined ? '' : envelope.wrap('template', instruction.template),
    instruction.rules.length === 0 ? '' : `Rules:\n${instruction.rules.map((rule) => `- ${rule}`).join('\n')}`,
    `Write to: ${instruction.resolvedOutputPath}`,
  ].filter((section) => section.length > 0)

  if (feedback !== null) {
    sections.push(
      'A maintainer requested the following changes — revise the artifact to address them (design D6: the folder cannot rot relative to the conversation).',
      envelope.wrap('revision-feedback', feedback),
    )
  }

  if (complaint !== null) {
    sections.push(
      'Your previous draft failed `openspec validate --strict` with the complaint below. Revise the artifact so it validates.',
      envelope.wrap('validate-complaint', complaint),
    )
  }
  return sections.join('\n\n')
}

const renderPlanComment = (changeName: string, branch: string, revision: number, tasks: string): string =>
  [
    `### Plan (revision ${revision})`,
    '',
    `Change \`${changeName}\` is fully drafted in \`openspec/changes/${changeName}/\` on \`${branch}\`.`,
    '',
    renderDigest(tasks, { changeName, branch, revision }),
    '',
    '**What now?** `/approve` to implement the plan, `/changes <what to change>` to revise it,',
    '`/ask <question>` to ask about it, or `/cancel` to stop.',
  ].join('\n')
