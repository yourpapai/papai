// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { generateText, stepCountIs, ModelMessage, ToolSet } from 'ai'

import type { StagedFileDownloadFn } from './attachments/types.js'
import type { ReplyFn } from './chat/types.js'
import type { TaskProvider } from './providers/types.js'

export interface LlmOrchestratorDeps {
  generateText: typeof generateText
  stepCountIs: typeof stepCountIs
  buildOpenAI: (apiKey: string, baseURL: string) => ReturnType<typeof createOpenAICompatible>
  buildProviderForUser: (userId: string) => TaskProvider
  getKaneoWorkspace: (userId: string) => string | null
  maybeProvisionKaneo: (reply: ReplyFn, contextId: string, username: string | null) => Promise<void>
  stagedDownloadFn?: StagedFileDownloadFn
}

type TokenUsage = { inputTokens: number | undefined; outputTokens: number | undefined }

type StepToolCall = { toolName: string; toolCallId: string; input: unknown }

type StepToolResult = { toolCallId: string; output: unknown }

type StepOutputToolCall = {
  toolName: string
  toolCallId: string
  args: unknown
} & Partial<{
  result: unknown
  error: string
}>

export type StepInput = Partial<{
  text: string
  finishReason: string
  toolCalls: Array<StepToolCall>
  toolResults: ReadonlyArray<StepToolResult>
  content: ReadonlyArray<unknown>
  usage: TokenUsage
}>

type ToolRoutingInfo = {
  intent: string
  confidence: number
  reason: string
  fullToolCount: number
  exposedToolCount: number
}

export type InvokeModelArgs = {
  contextId: string
  chatUserId: string
  contextType: 'dm' | 'group'
  mainModel: string
  model: ReturnType<ReturnType<typeof createOpenAICompatible>>
  provider: TaskProvider
  tools: ToolSet
  toolRouting: ToolRoutingInfo | undefined
  messages: ModelMessage[]
  deps: LlmOrchestratorDeps
}

export type StepOutput = {
  stepNumber: number
} & Partial<{
  text: string
  finishReason: string
  toolCalls: Array<StepOutputToolCall>
  usage: TokenUsage
}>
