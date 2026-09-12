// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { renderDigest } from '../artifacts.js'
import { branchNameFor } from '../git.js'
import type { InstructionsResult } from '../openspec-driver.js'
import type { PhaseHandler, PhaseInput, PhaseOutcome } from '../phase-context.js'
import { mapSeries } from '../sequence.js'
import { composeArtifact } from './plan-draft.js'
import type { DraftedFile } from './plan-draft.js'

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
 *
 * `plan-draft.ts` owns the model half — which reply shape an artifact takes, and
 * where a **glob** artifact's files are allowed to land.
 */

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

  // Design D3 (opencode-agent-skip-specs-depth): the CLI reports a skipped
  // artifact as `skipped`, and a skipped dependency counts as satisfied (probe
  // 1.1), so the loop needs no special case — the flag only tells the drafter's
  // prompt why the `specs` artifact never arrives.
  const skipSpecs = status.artifacts['specs'] === 'skipped'
  const instruction = await input.deps.openspec.instructions(next, changeName)
  await composeAndValidate(input, instruction, null, feedback, skipSpecs)
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
 * Composes one artifact, writes it, and validates the change. On a rejection
 * re-asks **once** with the complaint attached, exactly the `promptForJson`
 * pattern generalised to the validate-strict verdict.
 *
 * Two things can be wrong with a draft and both take the same retry: the content
 * (`openspec validate --strict` says so) and, for a glob artifact, the paths the
 * model chose for it (`glob-output.ts` says so, before anything is written).
 * They are one complaint channel rather than two because the remedy is
 * identical — ask again, saying what was wrong — and because a second failure
 * mode with its own escape hatch is how the drafter would acquire a path that
 * fails silently.
 */
const composeAndValidate = async (
  input: PhaseInput,
  instruction: InstructionsResult,
  complaint: string | null,
  feedback: string | null,
  skipSpecs: boolean,
): Promise<void> => {
  const composed = await composeArtifact(input, instruction, complaint, feedback, skipSpecs)
  const problem = composed.ok ? await writeAndValidate(input, composed.files) : composed.complaint
  if (problem === null) return

  if (complaint !== null) {
    // Second attempt still rejected: that rejection is the failure reason.
    throw new Error(`the drafter's second attempt was rejected: ${problem}`)
  }
  await composeAndValidate(input, instruction, problem, feedback, skipSpecs)
}

/**
 * Writes what the model composed and asks the CLI what it thinks; `null` when
 * the change validates, and the complaint to re-ask with when it does not.
 *
 * Sequential rather than concurrent: the files share a working tree, which is
 * the reason everything else in this pipeline that iterates does too.
 */
const writeAndValidate = async (input: PhaseInput, files: readonly DraftedFile[]): Promise<string | null> => {
  await mapSeries(files, (file) => input.deps.writeFile(file.path, file.content))

  const changeName = input.state.changeName
  if (changeName === null) return null
  const verdict = await input.deps.openspec.validateStrict(changeName)
  return verdict.ok ? null : `openspec validate --strict failed: ${verdict.output}`
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
