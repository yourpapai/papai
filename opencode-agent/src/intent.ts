// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { promptForJson } from './ask-json.js'
import { COMMENT_INTENTS } from './commands.js'
import type { CommentIntent } from './commands.js'
import { composeSystemPrompt } from './obra-skills.js'
import type { PhaseDeps } from './phase-context.js'
import { mintEnvelope } from './phases/envelope.js'
import { buildClassifyPrompt, CLASSIFY_INSTRUCTIONS } from './prompts.js'
import { errorMessage } from './types.js'
import type { AgentState, Phase } from './types.js'

const intentSchema = z.object({ intent: z.enum(COMMENT_INTENTS) })

export interface ClassifyInput {
  body: string
  phase: Phase
  state: AgentState
  deps: PhaseDeps
}

/**
 * Reads a maintainer's plain comment as an intent.
 *
 * Explicit slash commands never reach here — this is only for the conversation
 * a reviewer actually has: "why did you pick that file?", "use the existing
 * helper instead", "looks good". Guessing is the point, so the guess is biased:
 * **any failure or ambiguity resolves to `question`**, because answering a
 * comment that was really a change request costs one reply, while re-planning a
 * comment that was really a question discards an approved artefact.
 */
export const classifyComment = async (input: ClassifyInput): Promise<CommentIntent> => {
  const { deps, state } = input

  const envelope = mintEnvelope()

  try {
    const agent = await deps.agent()
    const classified = await promptForJson({
      agent,
      schema: intentSchema,
      envelope,
      log: deps.log,
      request: {
        system: composeSystemPrompt({
          phase: state.phase,
          skills: [],
          repoRoot: deps.config.repoRoot,
          nonce: envelope.nonce,
          instructions: CLASSIFY_INSTRUCTIONS,
        }),
        prompt: buildClassifyPrompt(envelope, input.body, input.phase),
        agent: 'plan',
      },
    })

    return classified.intent
  } catch (error) {
    deps.log.warn({ error: errorMessage(error) }, 'Comment classification failed; treating it as a question')
    return 'question'
  }
}
