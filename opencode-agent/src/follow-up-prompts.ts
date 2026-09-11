// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { fence } from './markdown.js'
import { composeSystemPrompt } from './obra-skills.js'
import type { AgentPromptRequest } from './opencode-adapter.js'
import type { MachineInput } from './phase-context.js'
import type { UntrustedEnvelope } from './prompts.js'
import { MINIMALITY_RULE } from './prompts.js'
import { PROTECTED_PATHS_RULE } from './protected-paths.js'
import type { Phase } from './types.js'

/**
 * What the `/follow-up` handler says to the model, in both its turns.
 *
 * Split from `phases/follow-up.ts` along the `implement-prompts.ts` seam: the
 * handler decides *whether and what* the pipeline does next, this module owns
 * *what is said* — the two prompts that arrive in sequence within one handler,
 * one session, one envelope, plus the pinned instructions both ride.
 *
 * The envelope rule is the workspace's own: the maintainer's request is
 * untrusted text and reaches a prompt only through `mintEnvelope`'s framing,
 * with the handler's one nonce shared by the system prompt and the body. The
 * apply instructions carry `PROTECTED_PATHS_RULE` and `MINIMALITY_RULE`
 * **verbatim** — pinned by test against the constants, so a softened copy
 * cannot pass — and a forbidden-git rule in the `SYNC_FORBIDDEN_GIT_RULE`
 * shape, because the apply turn holds `bash` over a tree the pipeline alone
 * may commit, reconcile and push.
 */

/** The forbidden-git rule of the apply prompt, pinned by `instructions.test.ts`. */
export const FOLLOW_UP_FORBIDDEN_GIT_RULE =
  'Do not run git yourself: do not commit, do not stage, do not push, do not merge. The pipeline runs the checks, ' +
  'commits, reconciles and pushes the moment you finish; a git command from you could break the tree the pipeline relies on.'

/** Carried verbatim by the apply prompt and asserted against the constants. */
export const FOLLOW_UP_APPLY_INSTRUCTIONS = [
  'A maintainer has asked for a small follow-up change on this delivered pull request, and the size gate has judged it small.',
  'Make exactly the change asked for, and nothing more — edit the working tree only.',
  'Write or adjust a test first when the repository\u2019s practice asks for one, and run the tests you name in your reply.',
  PROTECTED_PATHS_RULE,
  MINIMALITY_RULE,
  FOLLOW_UP_FORBIDDEN_GIT_RULE,
].join('\n')

export const FOLLOW_UP_ASSESS_INSTRUCTIONS =
  'You are the size gate for a maintainer\u2019s follow-up request on a delivered pull request. ' +
  'Read-only: judge the request, change nothing, run nothing.'

/** The gate's verdict: a size decision whose reason is mandatory, on both paths. */
export const verdictSchema = z.object({
  size: z.enum(['small', 'too-big']),
  reason: z.string().min(1),
})

/** What the apply turn reports back, from which the pipeline runs its checks. */
export const appliedSchema = z.object({
  summary: z.string(),
  files: z.array(z.string()),
  testCommands: z.array(z.string()),
})

export interface Applied {
  summary: string
  files: readonly string[]
  testCommands: readonly string[]
}

/** What the gate reads: the folder this branch carries, and what it changed. */
export interface AssessmentContext {
  base: string
  changeDigest: string
  diffStat: string
}

/** The gate reads the folder's truth and the branch's own diff — facts, not memory. */
export const assessmentContext = async (input: MachineInput, base: string): Promise<AssessmentContext> => {
  const { state, deps } = input
  let changeDigest = 'no change folder is attached to this state'
  if (state.changeName !== null) {
    const instructions = await deps.openspec.instructions('proposal', state.changeName)
    const proposal = await deps.readFile(instructions.resolvedOutputPath)
    changeDigest = `Change \`${state.changeName}\`${proposal.length > 0 ? `:\n\n${fence(proposal)}` : ' (its proposal is empty on this branch).'}`
  }

  const paths = await deps.git.changedSince(base)
  const diffStat = await deps.git.diffSince(base, paths)
  return { base, changeDigest, diffStat: diffStat.length > 0 ? diffStat : '(no changes on the branch yet)' }
}

const systemPrompt = (phase: Phase, repoRoot: string, envelope: UntrustedEnvelope, instructions: string): string =>
  composeSystemPrompt({ phase, skills: [], repoRoot, nonce: envelope.nonce, instructions })

/** The size gate's request: read-only profile, enveloped request, facts beside it. */
export const assessmentRequest = (
  phase: Phase,
  repoRoot: string,
  envelope: UntrustedEnvelope,
  request: string,
  context: AssessmentContext,
): AgentPromptRequest => ({
  system: systemPrompt(phase, repoRoot, envelope, FOLLOW_UP_ASSESS_INSTRUCTIONS),
  prompt: buildAssessmentPrompt(envelope, request, context),
  agent: 'plan',
})

/** The apply turn's request: build profile, pinned instructions, structured reply. */
export const applyRequest = (
  phase: Phase,
  repoRoot: string,
  envelope: UntrustedEnvelope,
  request: string,
  context: AssessmentContext,
  verdictReason: string,
): AgentPromptRequest => ({
  system: systemPrompt(phase, repoRoot, envelope, FOLLOW_UP_APPLY_INSTRUCTIONS),
  prompt: buildApplyPrompt(envelope, request, context, verdictReason),
  agent: 'build',
})

const buildAssessmentPrompt = (envelope: UntrustedEnvelope, request: string, context: AssessmentContext): string =>
  [
    'A maintainer has asked for a follow-up change on this delivered pull request. Judge whether it is small enough to ' +
      'apply directly as follow-up commits on the branch, or too big and better as its own issue.',
    `## The request\n${envelope.wrap('follow-up-request', request)}`,
    `## The change folder this branch carries\n${context.changeDigest}`,
    `## The branch's diff against \`${context.base}\`\n${fence(context.diffStat)}`,
    'Small means: a bounded diff of the order of tens of lines, in files this change already touched or trivially ' +
      'adjacent, with no new capability or scope and no schema, migration or API-surface change. Anything else is too big.',
    'Reply with a single JSON object and nothing else: {"size": "small" | "too-big", "reason": "<why, in one or two ' +
      'sentences>"} — the reason is mandatory and is restated to the maintainer on both paths.',
  ].join('\n\n')

const buildApplyPrompt = (
  envelope: UntrustedEnvelope,
  request: string,
  context: AssessmentContext,
  verdictReason: string,
): string =>
  [
    'The size gate judged this follow-up small. Apply it in the working tree.',
    `The gate's verdict: ${verdictReason}`,
    `## The request\n${envelope.wrap('follow-up-request', request)}`,
    `## The change folder this branch carries\n${context.changeDigest}`,
    `## The branch's diff against \`${context.base}\`\n${fence(context.diffStat)}`,
    'Reply with a single JSON object and nothing else: {"summary": "<what you changed>", "files": ["<paths you ' +
      'edited>"], "testCommands": ["<the test commands you ran>"]} — the pipeline re-runs every named command plus the ' +
      'repository\u2019s own check command, and nothing is committed until they are green.',
    FOLLOW_UP_FORBIDDEN_GIT_RULE,
  ].join('\n\n')
