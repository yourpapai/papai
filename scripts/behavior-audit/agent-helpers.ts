// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { generateText } from 'ai'
import pino from 'pino'

import { VERBOSE } from './config.js'

declare global {
  interface RequestInit {
    timeout?: number | false
  }
}

export const fetchWithoutTimeout: typeof fetch = (input, init) => fetch(input, { ...init, timeout: false })
fetchWithoutTimeout.preconnect = fetch.preconnect

const log = pino({
  level: VERBOSE ? 'debug' : 'silent',
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
})

type GenerateTextInput = Parameters<typeof generateText>[0]
type GenerateTextOutput = Awaited<ReturnType<typeof generateText>>

type CallbackKeys = 'onStart' | 'onStepStart' | 'onToolExecutionStart' | 'onToolExecutionEnd' | 'onStepEnd' | 'onEnd'

const verboseCallbacks: Pick<GenerateTextInput, CallbackKeys> = {
  onStart: ({ modelId, provider }) => {
    log.debug({ modelId, provider }, 'start')
  },
  onStepStart: ({ stepNumber }) => {
    log.debug({ stepNumber }, 'step start')
  },
  onToolExecutionStart: ({ toolCall }) => {
    log.debug({ tool: toolCall.toolName, input: JSON.stringify(toolCall.input).slice(0, 200) }, 'tool call start')
  },
  onToolExecutionEnd: ({ toolCall, toolExecutionMs, toolOutput }) => {
    if (toolOutput.type === 'tool-result') {
      log.debug({ tool: toolCall.toolName, durationMs: toolExecutionMs }, 'tool call finish')
    } else {
      const { error } = toolOutput
      log.warn(
        {
          tool: toolCall.toolName,
          durationMs: toolExecutionMs,
          error: error instanceof Error ? error.message : String(error),
        },
        'tool call error',
      )
    }
  },
  onStepEnd: ({ stepNumber, finishReason, usage }) => {
    log.debug(
      {
        stepNumber,
        finishReason,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      },
      'step finish',
    )
  },
  onEnd: ({ usage, steps }) => {
    log.debug(
      {
        steps: steps.length,
        totalInputTokens: usage.inputTokens,
        totalOutputTokens: usage.outputTokens,
      },
      'done',
    )
  },
}

const noCallbacks = {} as Partial<Pick<GenerateTextInput, CallbackKeys>>

export function verboseGenerateText(input: GenerateTextInput): Promise<GenerateTextOutput> {
  const callbacks: Pick<GenerateTextInput, CallbackKeys> | Partial<Pick<GenerateTextInput, CallbackKeys>> = VERBOSE
    ? verboseCallbacks
    : noCallbacks
  return generateText({ ...input, ...callbacks })
}

export type { GenerateTextInput, GenerateTextOutput }
