import type { ModelMessage } from 'ai'

import { getCachedTools } from '../cache.js'
import type { ChatProvider, ContextRendered, ContextSnapshot } from '../chat/types.js'
import { getConfig } from '../config.js'
import { buildMessagesWithMemory } from '../conversation.js'
import { loadHistory } from '../history.js'
import { buildInstructionsBlock } from '../instructions.js'
import { logger } from '../logger.js'
import { loadFacts, loadSummary } from '../memory.js'
import { buildProviderForUser } from '../providers/factory.js'
import type { TaskProvider } from '../providers/types.js'
import { buildSystemPrompt as buildSystemPromptImpl } from '../system-prompt.js'
import { makeTools } from '../tools/index.js'
import {
  collectContext,
  type ContextCollectorDeps,
  defaultCountTokens,
  prepareDefaultCountTokens,
  resolveEncodingName,
} from './context-collector.js'
import { buildContextToolCatalogPages } from './context-tool-catalog.js'

const log = logger.child({ scope: 'commands:context' })

export interface ContextCommandDeps {
  collectContext: (contextId: string, collectorDeps: ContextCollectorDeps) => ContextSnapshot
}

const defaultDeps: ContextCommandDeps = {
  collectContext,
}

function safeBuildProvider(contextId: string): TaskProvider | null {
  try {
    return buildProviderForUser(contextId, false)
  } catch (error) {
    log.warn(
      { contextId, error: error instanceof Error ? error.message : String(error) },
      'Provider unavailable while building context view',
    )
    return null
  }
}

function buildMemoryMessageText(contextId: string, history: readonly ModelMessage[]): string | null {
  const { memoryMsg } = buildMessagesWithMemory(contextId, history)
  return memoryMsg === null ? null : memoryMsg.content
}

async function buildCollectorDeps(contextId: string, provider: TaskProvider | null): Promise<ContextCollectorDeps> {
  const modelName = getConfig(contextId, 'main_model')
  const encoding = resolveEncodingName(modelName ?? 'unknown')

  // Preload tokenizer for the encoding
  await prepareDefaultCountTokens(encoding ?? 'cl100k_base')

  return {
    getMainModel: () => modelName,
    buildSystemPrompt: () =>
      provider === null ? buildInstructionsBlock(contextId) : buildSystemPromptImpl(provider, contextId),
    buildInstructionsBlock: () => buildInstructionsBlock(contextId),
    getProviderAddendum: () => (provider === null ? '' : provider.getPromptAddendum()),
    getHistory: () => loadHistory(contextId),
    getMemoryMessage: () => buildMemoryMessageText(contextId, loadHistory(contextId)),
    getSummary: () => loadSummary(contextId),
    getFacts: () => loadFacts(contextId),
    getActiveToolDefinitions: (): Record<string, unknown> => {
      const cached = getCachedTools(contextId)
      if (cached !== undefined && cached !== null && typeof cached === 'object') {
        return Object.fromEntries(Object.entries(cached).map(([key, value]) => [key, value as unknown]))
      }
      if (provider === null) return {}
      const tools = makeTools(provider, {
        storageContextId: contextId,
        chatUserId: contextId,
        mode: 'normal',
        contextType: 'dm',
      })
      return Object.fromEntries(Object.entries(tools).map(([key, value]) => [key, value as unknown]))
    },
    getProviderName: () => provider?.name ?? 'none',
    countTokens: (text: string): number => defaultCountTokens(text, encoding ?? 'cl100k_base'),
  }
}

function renderFallback(rendered: ContextRendered & { method: 'embed' }): string {
  const lines: string[] = []
  lines.push(rendered.embed.title)
  lines.push('')
  lines.push(rendered.embed.description)
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

function buildDirectToolCatalogPages(contextId: string, provider: TaskProvider | null): readonly string[] {
  if (provider === null) return buildContextToolCatalogPages({})

  const tools = makeTools(provider, {
    storageContextId: contextId,
    chatUserId: contextId,
    mode: 'normal',
    contextType: 'dm',
  })
  return buildContextToolCatalogPages(tools)
}

async function buildContextSnapshot(
  contextId: string,
  provider: TaskProvider | null,
  deps: ContextCommandDeps,
): Promise<ContextSnapshot> {
  const collectorDeps = await buildCollectorDeps(contextId, provider)
  return deps.collectContext(contextId, collectorDeps)
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

  const provider = safeBuildProvider(auth.storageContextId)
  let snapshot: ContextSnapshot
  try {
    snapshot = await buildContextSnapshot(auth.storageContextId, provider, deps)
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

  const rendered = chat.renderContext(snapshot)
  await sendContextResponse(reply, rendered)
  const toolCatalogPages = buildDirectToolCatalogPages(auth.storageContextId, provider)
  await toolCatalogPages.reduce<Promise<void>>(
    (pending, page) => pending.then(() => reply.formatted(page)),
    Promise.resolve(),
  )
  logContextExecuted(msg.user.id, auth.storageContextId, snapshot, rendered.method)
}

export function registerContextCommand(chat: ChatProvider, deps: ContextCommandDeps = defaultDeps): void {
  chat.registerCommand('context', async (msg, reply, auth) => {
    if (!auth.allowed) return
    await handleContextCommand(msg, reply, auth, chat, deps)
  })
}
