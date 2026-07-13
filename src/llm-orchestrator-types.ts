// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { generateText, stepCountIs, LanguageModel, ModelMessage, ToolSet } from 'ai'

import type { AiProgressReporter } from './ai-progress-reporter.js'
import type { StagedFileDownloadFn } from './attachments/types.js'
import type { ChatParticipantResolver } from './chat/participants/roster.js'
import type { ReplyFn } from './chat/types.js'
import type { LiveStatusReporter } from './live-status/reporter.js'
import type { EffectiveLlmConfig } from './llm-config-resolver.js'
import type { TaskProvider } from './providers/types.js'
import type { DisclosureSession } from './tools/disclosure/registry.js'

export type LlmOrchestratorDeps = {
  // Non-generic DI seam over the AI SDK `generateText`: the real generic export stays
  // assignable, and the orchestrator only consumes the result loosely (steps/usage/text),
  // so tests can supply a canned result without type-suppression or assertion escape hatches.
  generateText: (options: Parameters<typeof generateText>[0]) => ReturnType<typeof generateText>
  stepCountIs: typeof stepCountIs
  buildModel: (config: EffectiveLlmConfig) => LanguageModel
  resolve: (contextId: string) => Promise<TaskProvider | null> | TaskProvider | null
  maybeAutoProvision: (
    reply: ReplyFn,
    contextId: string,
    chatUserId: string,
    username: string | null,
  ) => Promise<boolean>
} & Partial<Record<'stagedDownloadFn', StagedFileDownloadFn>> &
  Partial<Record<'chatParticipantResolver', ChatParticipantResolver>>

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

export type InvokeModelArgs = {
  contextId: string
  chatUserId: string
  contextType: 'dm' | 'group'
  mainModel: string
  model: LanguageModel
  provider: TaskProvider | null
  tools: ToolSet
  enabledToolNames: ReadonlySet<string>
  messages: ModelMessage[]
  deps: LlmOrchestratorDeps
} & Partial<Record<'progressReporter', AiProgressReporter>> &
  Partial<Record<'disclosure', DisclosureSession>> &
  Partial<Record<'liveStatus', LiveStatusReporter>>

export type StepOutput = {
  stepNumber: number
} & Partial<{
  text: string
  finishReason: string
  toolCalls: Array<StepOutputToolCall>
  usage: TokenUsage
}>

export type ToolCallContext = {
  contextId: string
  chatUserId: string
  contextType: 'dm' | 'group'
  model: string
  modelRole: 'main' | 'small'
  turnId: string
} & Partial<Record<'progressReporter', AiProgressReporter>> &
  Partial<Record<'liveStatus', LiveStatusReporter>>

export type GenerateArgs = {
  contextId: string
  turnId: string
  model: InvokeModelArgs['model']
  systemPrompt: string
  messages: InvokeModelArgs['messages']
  tools: InvokeModelArgs['tools']
  deps: LlmOrchestratorDeps
  disclosure: InvokeModelArgs['disclosure']
  ctx: ToolCallContext
}
