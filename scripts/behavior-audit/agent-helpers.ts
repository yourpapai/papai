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

const log = pino({ level: VERBOSE ? 'debug' : 'silent', base: undefined, timestamp: pino.stdTimeFunctions.isoTime })

type GenerateTextInput = Parameters<typeof generateText>[0]
type GenerateTextOutput = Awaited<ReturnType<typeof generateText>>

type CallbackKeys =
  | 'experimental_onStart'
  | 'experimental_onStepStart'
  | 'experimental_onToolCallStart'
  | 'experimental_onToolCallFinish'
  | 'onStepFinish'
  | 'onFinish'

const verboseCallbacks: Pick<GenerateTextInput, CallbackKeys> = {
  experimental_onStart: ({ model }) => {
    log.debug({ modelId: model.modelId, provider: model.provider }, 'start')
  },
  experimental_onStepStart: ({ stepNumber }) => {
    log.debug({ stepNumber }, 'step start')
  },
  experimental_onToolCallStart: ({ toolCall }) => {
    log.debug({ tool: toolCall.toolName, input: JSON.stringify(toolCall.input).slice(0, 200) }, 'tool call start')
  },
  experimental_onToolCallFinish: ({ toolCall, durationMs, success, error }) => {
    if (success) {
      log.debug({ tool: toolCall.toolName, durationMs }, 'tool call finish')
    } else {
      log.warn(
        { tool: toolCall.toolName, durationMs, error: error instanceof Error ? error.message : String(error) },
        'tool call error',
      )
    }
  },
  onStepFinish: ({ stepNumber, finishReason, usage }) => {
    log.debug(
      { stepNumber, finishReason, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
      'step finish',
    )
  },
  onFinish: ({ totalUsage, steps }) => {
    log.debug(
      { steps: steps.length, totalInputTokens: totalUsage.inputTokens, totalOutputTokens: totalUsage.outputTokens },
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
