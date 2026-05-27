// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage } from 'ai'

import type { ChatProvider, ContextRendered, ContextSnapshot } from '../chat/types.js'
import { buildMessagesWithMemory } from '../conversation.js'
import { loadHistory } from '../history.js'
import { buildInstructionsBlock } from '../instructions.js'
import { logger } from '../logger.js'
import { loadFacts, loadSummary } from '../memory.js'
import type { TaskProvider } from '../providers/types.js'
import { getSystemConfig } from '../system-config.js'
import { buildSystemPrompt as buildSystemPromptImpl } from '../system-prompt.js'
import {
  collectContext,
  type ContextCollectorDeps,
  defaultCountTokens,
  prepareDefaultCountTokens,
  resolveEncodingName,
  type ToolRoutingInfo,
} from './context-collector.js'
import {
  buildInvocationToolSet,
  resolveActiveToolDefinitions,
  resolveContextToolSurface,
  safeBuildProvider,
  type BuildLiveToolSet,
  type ResolvedContextToolSurface,
} from './context-tool-resolution.js'

const log = logger.child({ scope: 'commands:context' })

export interface ContextCommandDeps {
  collectContext: (contextId: string, collectorDeps: ContextCollectorDeps) => ContextSnapshot
  buildProvider: (contextId: string) => TaskProvider | null
  buildLiveToolSet: BuildLiveToolSet
  resolveActiveToolDefinitions: (resolvedToolSurface: ResolvedContextToolSurface) => Record<string, unknown>
  resolveToolSurface: (
    storageContextId: string,
    actorUserId: string,
    contextType: 'dm' | 'group',
    provider: TaskProvider | null,
    buildLiveToolSet: BuildLiveToolSet,
    lastUserText: string | undefined,
  ) => Promise<ResolvedContextToolSurface> | ResolvedContextToolSurface
}

const defaultDeps: ContextCommandDeps = {
  collectContext,
  buildProvider: safeBuildProvider,
  buildLiveToolSet: buildInvocationToolSet,
  resolveActiveToolDefinitions,
  resolveToolSurface: resolveContextToolSurface,
}
function resolveModelName(modelName: string | null | undefined): string {
  if (modelName !== undefined && modelName !== null) return modelName
  return 'unknown'
}
function resolveEncoding(encoding: 'o200k_base' | 'cl100k_base' | null | undefined): 'o200k_base' | 'cl100k_base' {
  if (encoding !== undefined && encoding !== null) return encoding
  return 'cl100k_base'
}
function resolveRegisterDeps(rest: readonly [ContextCommandDeps] | readonly []): ContextCommandDeps {
  if (rest[0] !== undefined) return { ...defaultDeps, ...rest[0] }
  return defaultDeps
}

function buildMemoryMessageText(contextId: string, history: readonly ModelMessage[]): string | null {
  const { memoryMsg } = buildMessagesWithMemory(contextId, history)
  return memoryMsg === null ? null : memoryMsg.content
}

function extractTextFromUserContent(content: ModelMessage['content']): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const part of content) {
    if (typeof part === 'object' && part !== null && 'type' in part && part.type === 'text' && 'text' in part) {
      const text = (part as { text: unknown }).text
      if (typeof text === 'string') parts.push(text)
    }
  }
  return parts.join(' ')
}

export function getLastUserText(history: readonly ModelMessage[]): string | undefined {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const message = history[i]
    if (message === undefined || message.role !== 'user') continue
    const text = extractTextFromUserContent(message.content).trim()
    if (text.length > 0) return text
  }
  return undefined
}

async function buildCollectorDeps(
  storageContextId: string,
  provider: TaskProvider | null,
  resolvedToolSurface: ResolvedContextToolSurface,
  deps: ContextCommandDeps,
): Promise<ContextCollectorDeps> {
  const modelName = getSystemConfig('main_model')
  const resolvedModelName = resolveModelName(modelName)
  const encoding = resolveEncodingName(resolvedModelName)
  const resolvedEncoding = resolveEncoding(encoding)
  const providerName = provider === null ? 'none' : provider.name

  await prepareDefaultCountTokens(resolvedEncoding)

  return {
    getMainModel: () => modelName,
    buildSystemPrompt: () =>
      provider === null ? buildInstructionsBlock(storageContextId) : buildSystemPromptImpl(provider, storageContextId),
    buildInstructionsBlock: () => buildInstructionsBlock(storageContextId),
    getProviderAddendum: () => (provider === null ? '' : provider.getPromptAddendum()),
    getHistory: () => loadHistory(storageContextId),
    getMemoryMessage: () => buildMemoryMessageText(storageContextId, loadHistory(storageContextId)),
    getSummary: () => loadSummary(storageContextId),
    getFacts: () => loadFacts(storageContextId),
    getActiveToolDefinitions: (): Record<string, unknown> => deps.resolveActiveToolDefinitions(resolvedToolSurface),
    getProviderName: () => providerName,
    getToolRoutingInfo: (): ToolRoutingInfo | undefined => resolvedToolSurface.routing,
    countTokens: (text: string): number => defaultCountTokens(text, resolvedEncoding),
  }
}

function renderFallback(rendered: ContextRendered & { method: 'embed' }): string {
  const lines: string[] = [rendered.embed.title, '', rendered.embed.description]
  if (rendered.embed.fields !== undefined) {
    lines.push('')
    for (const field of rendered.embed.fields) {
      lines.push(`${field.name}: ${field.value}`)
    }
  }
  if (rendered.embed.footer !== undefined) {
    lines.push('')
    lines.push(rendered.embed.footer)
  }
  return lines.join('\n')
}

async function sendContextResponse(
  reply: Parameters<Parameters<ChatProvider['registerCommand']>[1]>[1],
  rendered: ContextRendered,
): Promise<void> {
  if (rendered.method === 'embed') {
    if (reply.embed === undefined) {
      await reply.formatted(renderFallback(rendered))
    } else {
      await reply.embed(rendered.embed)
    }
  } else if (rendered.method === 'formatted') {
    await reply.formatted(rendered.content)
  } else {
    await reply.text(rendered.content)
  }
}

function renderContextForMessage(
  chat: ChatProvider,
  msg: { readonly platformInstanceId: string },
  snapshot: ContextSnapshot,
): ContextRendered {
  if (chat.renderContextForInstance !== undefined) {
    return chat.renderContextForInstance(msg.platformInstanceId, snapshot)
  }
  return chat.renderContext(snapshot)
}

async function buildContextSnapshot(
  storageContextId: string,
  provider: TaskProvider | null,
  resolvedToolSurface: ResolvedContextToolSurface,
  deps: ContextCommandDeps,
): Promise<ContextSnapshot> {
  const collectorDeps = await buildCollectorDeps(storageContextId, provider, resolvedToolSurface, deps)
  return deps.collectContext(storageContextId, collectorDeps)
}

function logContextExecuted(userId: string, contextId: string, snapshot: ContextSnapshot, method: string): void {
  log.info(
    {
      userId,
      storageContextId: contextId,
      totalTokens: snapshot.totalTokens,
      maxTokens: snapshot.maxTokens,
      method,
      approximate: snapshot.approximate,
    },
    '/context command executed',
  )
}

async function handleContextCommand(
  msg: Parameters<Parameters<ChatProvider['registerCommand']>[1]>[0],
  reply: Parameters<Parameters<ChatProvider['registerCommand']>[1]>[1],
  auth: Parameters<Parameters<ChatProvider['registerCommand']>[1]>[2],
  chat: ChatProvider,
  deps: ContextCommandDeps,
): Promise<void> {
  log.debug({ userId: msg.user.id, storageContextId: auth.storageContextId }, '/context command called')

  const provider = deps.buildProvider(auth.storageContextId)
  const lastUserText = getLastUserText(loadHistory(auth.storageContextId))
  const resolvedToolSurface = await deps.resolveToolSurface(
    auth.storageContextId,
    msg.user.id,
    msg.contextType,
    provider,
    deps.buildLiveToolSet,
    lastUserText,
  )
  let snapshot: ContextSnapshot
  try {
    snapshot = await buildContextSnapshot(auth.storageContextId, provider, resolvedToolSurface, deps)
  } catch (error) {
    log.warn(
      {
        userId: msg.user.id,
        storageContextId: auth.storageContextId,
        error: error instanceof Error ? error.message : String(error),
      },
      '/context collector failed',
    )
    await reply.text('Sorry — could not build context view right now.')
    return
  }

  const rendered = renderContextForMessage(chat, msg, snapshot)
  await sendContextResponse(reply, rendered)
  logContextExecuted(msg.user.id, auth.storageContextId, snapshot, rendered.method)
}

export function registerContextCommand(chat: ChatProvider): void
export function registerContextCommand(chat: ChatProvider, deps: ContextCommandDeps): void
export function registerContextCommand(chat: ChatProvider, ...rest: readonly [ContextCommandDeps] | readonly []): void {
  const resolvedDeps = resolveRegisterDeps(rest)
  chat.registerCommand('context', async (msg, reply, auth) => {
    if (!auth.allowed) return
    await handleContextCommand(msg, reply, auth, chat, resolvedDeps)
  })
}
