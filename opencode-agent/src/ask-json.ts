// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { z } from 'zod'

import type { Logger } from './logger.js'
import { parseModelJson, readModelJson } from './model-json.js'
import type { AgentPromptRequest, OpenCodeAgent } from './opencode-adapter.js'
import type { UntrustedEnvelope } from './prompts.js'

export interface JsonAsk<T> {
  agent: OpenCodeAgent
  request: AgentPromptRequest
  schema: z.ZodType<T>
  /** The prompt's own envelope, so the rejected reply is quoted back safely. */
  envelope: UntrustedEnvelope
  log: Logger
}

/**
 * Asks the model for JSON, and re-asks **once** when the reply does not validate.
 *
 * A malformed reply used to fail the phase outright: the run parked in `FAILED`
 * and waited for a human `/retry`, for what is usually a stray sentence around
 * an otherwise correct object. One re-ask carrying the validation complaint
 * recovers most of those without anybody being woken up.
 *
 * Exactly once, not until it works. A model that cannot produce the shape twice
 * will not produce it on the fifth attempt either, and each round costs real
 * tokens and real wall clock inside a job that has its own timeout.
 *
 * The rejected reply is quoted back inside the envelope. It is model output
 * rather than issue text, but it is still text this pipeline did not author, and
 * it is being pasted into a prompt — which is the whole situation the envelope
 * exists for.
 */
export const promptForJson = async <T>(ask: JsonAsk<T>): Promise<T> => {
  const first = await ask.agent.prompt(ask.request)
  const parsed = readModelJson(first.text, ask.schema)
  if (parsed.ok) return parsed.value

  ask.log.warn({ reason: parsed.reason }, 'Model reply did not validate; re-asking once')

  const repaired = await ask.agent.prompt({
    ...ask.request,
    prompt: repairPrompt(ask.request.prompt, first.text, parsed.reason, ask.envelope),
  })

  // Throws on a second failure, so the issue still gets the full raw reply.
  return parseModelJson(repaired.text, ask.schema)
}

const repairPrompt = (original: string, rejected: string, reason: string, envelope: UntrustedEnvelope): string =>
  [
    'Your previous reply to the request below could not be used.',
    '',
    envelope.wrap('rejected-reply', rejected),
    '',
    `It failed with: ${reason}`,
    '',
    'Answer the original request again, as a single JSON object and nothing else:',
    'no prose before or after it, no markdown fence around it.',
    '',
    original,
  ].join('\n')
