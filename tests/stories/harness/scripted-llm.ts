// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { LanguageModelV3CallOptions, LanguageModelV3GenerateResult } from '@ai-sdk/provider'
import { MockLanguageModelV3 } from 'ai/test'

import type { ScenarioEvents } from './events.js'

export type ModelDecision = { kind: 'tool'; capabilityId: string; input: unknown } | { kind: 'answer'; text: string }

export type ScriptedModelInspection = Readonly<{
  generation: number
  availableTools: readonly string[]
  hasToolResult: boolean
}>

export type ScriptedModel = Readonly<{
  model: MockLanguageModelV3
  enqueue(decisions: readonly ModelDecision[]): void
  verifyConsumed(): void
  inspections(): readonly ScriptedModelInspection[]
}>

type ScriptedModelOptions = Readonly<{
  resolveCapability(capabilityId: string): string
  nextId?: () => string
  events?: ScenarioEvents
}>

type PendingToolCall = Readonly<{
  capabilityId: string
  toolCallId: string
  toolName: string
}>

type PromptPartSummary = Readonly<{
  role: string
  contentKinds: readonly string[]
  contentCount: number
  toolNames: readonly string[]
  toolResultCount: number
}>

const ZERO_USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
} as const

export const callCapability = (capabilityId: string, input: unknown): ModelDecision => ({
  kind: 'tool',
  capabilityId,
  input,
})

export const answer = (text: string): ModelDecision => ({ kind: 'answer', text })

const availableToolNames = (options: LanguageModelV3CallOptions): readonly string[] =>
  (options.tools ?? []).map(({ name }) => name).sort()

const summarizePrompt = (options: LanguageModelV3CallOptions): readonly PromptPartSummary[] =>
  options.prompt.map((message): PromptPartSummary => {
    if (typeof message.content === 'string') {
      return {
        role: message.role,
        contentKinds: ['text'],
        contentCount: 1,
        toolNames: [],
        toolResultCount: 0,
      }
    }

    return {
      role: message.role,
      contentKinds: message.content.map(({ type }) => type),
      contentCount: message.content.length,
      toolNames: message.content.flatMap((part) => ('toolName' in part ? [part.toolName] : [])),
      toolResultCount: message.content.filter(({ type }) => type === 'tool-result').length,
    }
  })

const promptHasToolResult = (options: LanguageModelV3CallOptions, pending: PendingToolCall): boolean =>
  options.prompt.some(
    (message) =>
      typeof message.content !== 'string' &&
      message.content.some(
        (part) =>
          part.type === 'tool-result' && part.toolCallId === pending.toolCallId && part.toolName === pending.toolName,
      ),
  )

const generationResult = (
  content: LanguageModelV3GenerateResult['content'],
  unified: LanguageModelV3GenerateResult['finishReason']['unified'],
): LanguageModelV3GenerateResult => ({
  content,
  finishReason: { unified, raw: undefined },
  usage: ZERO_USAGE,
  warnings: [],
})

function resolveWireName(
  capabilityId: string,
  resolveCapability: (id: string) => string,
  tools: readonly string[],
): string {
  try {
    return resolveCapability(capabilityId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const listedTools = tools.length === 0 ? '(none)' : tools.join(', ')
    throw new Error(`Could not resolve capability '${capabilityId}': ${message}; available tools: ${listedTools}`, {
      cause: error,
    })
  }
}

function serializeToolInput(decision: Extract<ModelDecision, { kind: 'tool' }>, generation: number): string {
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(decision.input)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Could not serialize input for capability '${decision.capabilityId}' at generation ${generation} (tool decision): ${message}`,
      { cause: error },
    )
  }
  if (serialized !== undefined) return serialized

  const cause = new TypeError('JSON.stringify returned undefined')
  throw new Error(
    `Could not serialize input for capability '${decision.capabilityId}' at generation ${generation} (tool decision): ${cause.message}`,
    { cause },
  )
}

export function createScriptedModel(options: ScriptedModelOptions): ScriptedModel {
  let decisions: readonly ModelDecision[] = []
  let pendingToolCall: PendingToolCall | undefined
  let generation = 0
  let localId = 0
  let recordedInspections: readonly ScriptedModelInspection[] = []

  const nextId = options.nextId ?? ((): string => `tool-call-${++localId}`)
  const runDecision = (callOptions: LanguageModelV3CallOptions): LanguageModelV3GenerateResult => {
    generation += 1
    const tools = availableToolNames(callOptions)
    const hasToolResult = pendingToolCall === undefined ? false : promptHasToolResult(callOptions, pendingToolCall)
    const inspection = { generation, availableTools: tools, hasToolResult } as const
    recordedInspections = [...recordedInspections, inspection]
    options.events?.record('llm.generate', {
      generation,
      prompt: summarizePrompt(callOptions),
      availableTools: tools,
    })

    const decision = decisions[0]
    if (decision === undefined) throw new Error(`Scripted model has no queued decisions for generation ${generation}`)

    if (pendingToolCall !== undefined && !hasToolResult) {
      throw new Error(
        `Next ${decision.kind} decision expected tool result for '${pendingToolCall.toolName}' (${pendingToolCall.toolCallId})`,
      )
    }
    pendingToolCall = undefined

    if (decision.kind === 'answer') {
      decisions = decisions.slice(1)
      return generationResult([{ type: 'text', text: decision.text }], 'stop')
    }

    const toolName = resolveWireName(decision.capabilityId, options.resolveCapability, tools)
    if (!tools.includes(toolName)) {
      const listedTools = tools.length === 0 ? '(none)' : tools.join(', ')
      throw new Error(
        `Capability '${decision.capabilityId}' resolved to '${toolName}', but it was not advertised; available tools: ${listedTools}`,
      )
    }
    const input = serializeToolInput(decision, generation)
    const toolCallId = nextId()
    pendingToolCall = { capabilityId: decision.capabilityId, toolCallId, toolName }
    decisions = decisions.slice(1)
    return generationResult([{ type: 'tool-call', toolCallId, toolName, input }], 'tool-calls')
  }
  const doGenerate = (callOptions: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> =>
    Promise.resolve(runDecision(callOptions))

  const model = new MockLanguageModelV3({ doGenerate })

  return {
    model,
    enqueue(nextDecisions): void {
      decisions = [...decisions, ...nextDecisions]
    },
    verifyConsumed(): void {
      if (pendingToolCall !== undefined) {
        const queued =
          decisions.length === 0
            ? ''
            : `; ${decisions.length} queued ${decisions.length === 1 ? 'decision remains' : 'decisions remain'}`
        throw new Error(
          `Scripted model is awaiting tool result for '${pendingToolCall.toolName}' (${pendingToolCall.toolCallId}, capability '${pendingToolCall.capabilityId}')${queued}`,
        )
      }
      if (decisions.length === 0) return
      const suffix = decisions.length === 1 ? 'decision' : 'decisions'
      throw new Error(
        `Scripted model has ${decisions.length} unused ${suffix}: ${decisions.map(({ kind }) => kind).join(', ')}`,
      )
    },
    inspections(): readonly ScriptedModelInspection[] {
      return recordedInspections.map((inspection) => ({
        ...inspection,
        availableTools: [...inspection.availableTools],
      }))
    },
  }
}
