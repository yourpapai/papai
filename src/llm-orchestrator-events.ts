import type { ModelMessage, ToolSet } from 'ai'

import { emit } from './debug/event-bus.js'
import { buildStepsDetail } from './llm-orchestrator-steps.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'llm-orchestrator-events' })

type TokenUsage = {
  inputTokens: number | undefined
  outputTokens: number | undefined
}

type ResultToolCall = {
  toolName: string
  toolCallId: string
  input: unknown
}

type ResultToolResult = {
  toolCallId: string
  output: unknown
}

type ResultStep = {
  toolCalls: Array<ResultToolCall>
  toolResults: Array<ResultToolResult>
} & Partial<{
  text: string
  finishReason: string
  content: ReadonlyArray<unknown>
  usage: TokenUsage
}>

type ResultResponse = {
  messages: ModelMessage[]
} & Partial<{
  id: string
  modelId: string
}>

export type ToolRoutingTelemetry = {
  intent: string
  confidence: number
  reason: string
  fullToolCount: number
  exposedToolCount: number
}

// Result type after awaiting all streamText promises
export type ResolvedStreamTextResult = {
  text: string
  toolCalls: Array<ResultToolCall>
  toolResults: Array<ResultToolResult>
  steps: Array<ResultStep>
  response: ResultResponse
  usage: TokenUsage
  finishReason: string
} & Partial<{
  warnings: unknown[]
  request: unknown
  providerMetadata: unknown
}>

function stringifySingleToolSchema(toolName: string, value: unknown): string {
  log.debug({ toolName }, 'stringifySingleToolSchema')
  try {
    return JSON.stringify(value, (key, nestedValue: unknown) => {
      if (key === '') return nestedValue
      if (typeof nestedValue === 'function') return '[function]'
      return nestedValue
    })
  } catch (error) {
    log.debug(
      { toolName, error: error instanceof Error ? error.message : String(error) },
      'Tool schema stringify failed',
    )
    return ''
  }
}

function estimateToolSchemaBytes(tools: ToolSet): number {
  log.debug({ toolCount: Object.keys(tools).length }, 'estimateToolSchemaBytes')
  let total = 0
  for (const [name, tool] of Object.entries(tools)) {
    total += name.length
    total += typeof tool.description === 'string' ? tool.description.length : 0
    total += stringifySingleToolSchema(name, tool.inputSchema).length
  }
  return total
}

function buildRoutingTelemetry(routing: ToolRoutingTelemetry | undefined): Record<string, unknown> {
  if (routing === undefined) {
    return {}
  }
  return {
    routingIntent: routing.intent,
    routingConfidence: routing.confidence,
    routingReason: routing.reason,
  }
}

function buildToolTelemetry(tools: ToolSet, routing: ToolRoutingTelemetry | undefined): Record<string, unknown> {
  const exposedToolCount = Object.keys(tools).length
  const fullToolCount = routing === undefined ? exposedToolCount : routing.fullToolCount
  log.debug({ exposedToolCount, hasRouting: routing !== undefined }, 'buildToolTelemetry')
  return {
    toolCount: exposedToolCount,
    exposedToolCount,
    fullToolCount,
    toolSchemaBytes: estimateToolSchemaBytes(tools),
    ...buildRoutingTelemetry(routing),
  }
}

export function emitLlmStart(
  ...args:
    | [contextId: string, mainModel: string, messages: ModelMessage[], tools: ToolSet]
    | [contextId: string, mainModel: string, messages: ModelMessage[], tools: ToolSet, routing: ToolRoutingTelemetry]
): void {
  const [contextId, mainModel, messages, tools, routing] = args
  emit('llm:start', {
    userId: contextId,
    model: mainModel,
    messageCount: messages.length,
    ...buildToolTelemetry(tools, routing),
  })
}

export function emitLlmEnd(
  ...args:
    | [
        contextId: string,
        mainModel: string,
        result: ResolvedStreamTextResult,
        startTime: number,
        messages: ModelMessage[],
        tools: ToolSet,
      ]
    | [
        contextId: string,
        mainModel: string,
        result: ResolvedStreamTextResult,
        startTime: number,
        messages: ModelMessage[],
        tools: ToolSet,
        routing: ToolRoutingTelemetry,
      ]
): void {
  const [contextId, mainModel, result, startTime, messages, tools, routing] = args
  emit('llm:end', {
    userId: contextId,
    model: mainModel,
    steps: result.steps.length,
    totalDuration: Date.now() - startTime,
    tokenUsage: result.usage,
    responseId: result.response.id,
    actualModel: result.response.modelId,
    finishReason: result.finishReason,
    messageCount: messages.length,
    ...buildToolTelemetry(tools, routing),
    generatedText: result.text,
    stepsDetail: buildStepsDetail(result.steps),
  })
}
