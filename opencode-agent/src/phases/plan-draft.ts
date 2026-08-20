// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { promptForJson } from '../ask-json.js'
import { globOutputBase, isGlobOutputPath, resolveGlobOutput } from '../glob-output.js'
import { composeSystemPrompt } from '../obra-skills.js'
import type { InstructionsResult } from '../openspec-driver.js'
import type { PhaseInput } from '../phase-context.js'
import type { UntrustedEnvelope } from '../prompts.js'
import { PROTECTED_PATHS_RULE } from '../protected-paths.js'
import { mintEnvelope } from './envelope.js'

/**
 * One artifact, composed — the model half of the PLANNING drafter loop (design
 * D3), split from `plan.ts`, which keeps the loop, the commit and the digest.
 *
 * The split is what the **glob** artifact costs. Every artifact of the
 * `spec-driven` schema resolves to a file the drafter can write, except `specs`:
 * a change carries one delta spec per capability, so its output path is a
 * pattern and the paths are part of what the model has to decide. That makes two
 * reply shapes, two prompts and a path-judging step where there used to be one
 * `{"content": …}` and a `writeFile`, which is a phase's worth of prose in a file
 * that already had one.
 */

/** A flat artifact: one file, at the path the driver already resolved. */
const draftReplySchema = z.object({ content: z.string().min(1) })

/**
 * A glob artifact: the model names each file as well as writing it.
 *
 * The path is asked for **relative to the change folder**, because that is how
 * the artifact instruction the model is reading spells it
 * (`specs/<capability-path>/spec.md`) — an answer anchored anywhere else would be
 * the model reconciling two different rules. `glob-output.ts` judges each one.
 */
const draftFilesReplySchema = z.object({
  files: z.array(z.object({ path: z.string().min(1), content: z.string().min(1) })).min(1),
})

export interface DraftedFile {
  readonly path: string
  readonly content: string
}

/**
 * What the model produced, or why it cannot be used.
 *
 * A refused path is a **complaint**, not a throw: the drafter already re-asks
 * once with the `openspec validate --strict` verdict attached, and "you wrote
 * outside `specs/`" is exactly the kind of mistake a second ask fixes. Failing
 * outright would throw away a paid-for turn over a filename.
 */
export type ComposedArtifact =
  | { readonly ok: true; readonly files: readonly DraftedFile[] }
  | { readonly ok: false; readonly complaint: string }

/**
 * Exported for `instructions.test.ts`. A drafting phase writes only into the
 * change folder, so it cannot commit a workflow itself — but it can *plan* one,
 * and a plan whose step edits `.github/workflows/` is a step the implement phase
 * will write and the commit will drop. The rule is cheaper stated here.
 */
export const PROPOSE_INSTRUCTIONS = [
  'You are drafting one artifact of an OpenSpec change folder.',
  'Use the instruction, template and rules below; the artifact must satisfy `openspec validate --strict`.',
  'Reply with a single JSON object and nothing else: {"content":"<markdown>"}',
  'Write only the artifact asked for. Do not invent capabilities or deltas the change does not claim.',
  PROTECTED_PATHS_RULE,
].join('\n')

/**
 * The same standing instructions for an artifact whose output path is a pattern:
 * the reply carries the files, each with the path it belongs at.
 */
export const PROPOSE_FILES_INSTRUCTIONS = [
  'You are drafting one artifact of an OpenSpec change folder.',
  'This artifact is a set of files, not a single document: the instruction below says how many and where.',
  'Use the instruction, template and rules below; the artifact must satisfy `openspec validate --strict`.',
  'Reply with a single JSON object and nothing else: {"files":[{"path":"<path>","content":"<markdown>"}]}',
  'Each path is relative to the change folder named in the prompt. Do not use absolute paths or `..`.',
  'Write only the artifact asked for. Do not invent capabilities or deltas the change does not claim.',
  PROTECTED_PATHS_RULE,
].join('\n')

export const composeArtifact = async (
  input: PhaseInput,
  instruction: InstructionsResult,
  complaint: string | null,
  feedback: string | null,
): Promise<ComposedArtifact> => {
  if (!isGlobOutputPath(instruction.resolvedOutputPath)) {
    const reply = await ask(input, draftReplySchema, PROPOSE_INSTRUCTIONS, (envelope) =>
      draftPrompt(envelope, instruction, complaint, feedback),
    )
    return { ok: true, files: [{ path: instruction.resolvedOutputPath, content: reply.content }] }
  }

  const base = globOutputBase(instruction.resolvedOutputPath, instruction.changeDir)
  const reply = await ask(input, draftFilesReplySchema, PROPOSE_FILES_INSTRUCTIONS, (envelope) =>
    globDraftPrompt(envelope, instruction, base, complaint, feedback),
  )
  return placeFiles(instruction.resolvedOutputPath, base, reply.files)
}

/** Judges every drafted path before a single one is written. */
const placeFiles = (pattern: string, base: string, drafted: readonly DraftedFile[]): ComposedArtifact => {
  const placed: DraftedFile[] = []
  const refused: string[] = []
  for (const file of drafted) {
    const resolution = resolveGlobOutput(pattern, base, file.path)
    if (resolution.ok) placed.push({ path: resolution.path, content: file.content })
    else refused.push(resolution.reason)
  }
  // All or nothing: a half-written artifact would be validated as if it were
  // whole, and the complaint the retry carries would be about files that landed.
  if (refused.length > 0) {
    return { ok: false, complaint: `These file paths cannot be used:\n${refused.map((r) => `- ${r}`).join('\n')}` }
  }
  return { ok: true, files: placed }
}

const ask = async <T>(
  input: PhaseInput,
  schema: z.ZodType<T>,
  instructions: string,
  prompt: (envelope: UntrustedEnvelope) => string,
): Promise<T> => {
  const { deps } = input
  const envelope = mintEnvelope()
  return promptForJson({
    agent: await deps.agent(),
    schema,
    envelope,
    log: deps.log,
    request: {
      system: composeSystemPrompt({
        phase: 'PLANNING',
        skills: await deps.skills('PLANNING'),
        repoRoot: deps.config.repoRoot,
        nonce: envelope.nonce,
        instructions,
      }),
      prompt: prompt(envelope),
      agent: 'propose',
    },
  })
}

/** What the artifact is, before where it goes: instruction, template, rules. */
const headSections = (envelope: UntrustedEnvelope, instruction: InstructionsResult): string[] =>
  [
    `Instruction: ${instruction.instruction}`,
    instruction.template === undefined ? '' : envelope.wrap('template', instruction.template),
    instruction.rules.length === 0 ? '' : `Rules:\n${instruction.rules.map((rule) => `- ${rule}`).join('\n')}`,
  ].filter((section) => section.length > 0)

/** What a re-draft is grounded in, after the destination: feedback, complaint. */
const tailSections = (envelope: UntrustedEnvelope, complaint: string | null, feedback: string | null): string[] => {
  const sections: string[] = []
  if (feedback !== null) {
    sections.push(
      'A maintainer requested the following changes — revise the artifact to address them (design D6: the folder cannot rot relative to the conversation).',
      envelope.wrap('revision-feedback', feedback),
    )
  }
  if (complaint !== null) {
    sections.push(
      'Your previous draft was rejected with the complaint below. Revise the artifact so it is accepted.',
      envelope.wrap('draft-complaint', complaint),
    )
  }
  return sections
}

const draftPrompt = (
  envelope: UntrustedEnvelope,
  instruction: InstructionsResult,
  complaint: string | null,
  feedback: string | null,
): string =>
  [
    ...headSections(envelope, instruction),
    `Write to: ${instruction.resolvedOutputPath}`,
    ...tailSections(envelope, complaint, feedback),
  ].join('\n\n')

const globDraftPrompt = (
  envelope: UntrustedEnvelope,
  instruction: InstructionsResult,
  base: string,
  complaint: string | null,
  feedback: string | null,
): string =>
  [
    ...headSections(envelope, instruction),
    [
      `Write the files under: ${base}`,
      `Every path must match the pattern ${instruction.resolvedOutputPath}, and is given in the reply`,
      'relative to that folder — for example `specs/<capability-path>/spec.md`.',
    ].join('\n'),
    ...tailSections(envelope, complaint, feedback),
  ].join('\n\n')
