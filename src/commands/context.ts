import type { ModelMessage, ToolSet } from 'ai'

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
  buildLiveToolSet: (
    storageContextId: string,
    actorUserId: string,
    contextType: 'dm' | 'group',
    provider: TaskProvider | null,
  ) => ToolSet | null
}

const defaultDeps: ContextCommandDeps = {
  collectContext,
  buildLiveToolSet: buildInvocationToolSet,
}
function resolveModelName(modelName: string | null | undefined): string {
  if (modelName === undefined || modelName === null) return 'unknown'
  return modelName
}
function resolveEncoding(encoding: string | null | undefined): 'o200k_base' | 'cl100k_base' {
  if (encoding === undefined || encoding === null) return 'cl100k_base'
  return resolveEncodingName(encoding)
}
function resolveContextCommandDeps(deps: ContextCommandDeps | null | undefined): ContextCommandDeps {
  if (deps === null || deps === undefined) return defaultDeps
  return deps
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

function resolveActiveToolDefinitions(
  storageContextId: string,
  actorUserId: string,
  contextType: 'dm' | 'group',
  provider: TaskProvider | null,
  deps: ContextCommandDeps,
): Record<string, unknown> {
  const cached = toToolRecord(getCachedTools(storageContextId))
  if (Object.keys(cached).length > 0) return cached

  const liveTools = deps.buildLiveToolSet(storageContextId, actorUserId, contextType, provider)
  return toToolRecord(liveTools)
}

async function buildCollectorDeps(
  storageContextId: string,
  actorUserId: string,
  contextType: 'dm' | 'group',
  provider: TaskProvider | null,
  deps: ContextCommandDeps,
): Promise<ContextCollectorDeps> {
  const modelName = getConfig(storageContextId, 'main_model')
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
    getActiveToolDefinitions: (): Record<string, unknown> =>
      resolveActiveToolDefinitions(storageContextId, actorUserId, contextType, provider, deps),
    getProviderName: () => providerName,
    countTokens: (text: string): number => defaultCountTokens(text, resolvedEncoding),
  }
}

function toToolRecord(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null || typeof value !== 'object') return {}
  return Object.fromEntries(Object.entries(value).map(([key, entryValue]) => [key, entryValue as unknown]))
}

function isToolSet(value: Record<string, unknown>): value is ToolSet {
  return Object.values(value).every((entry) => typeof entry === 'object' && entry !== null)
}

function buildInvocationToolSet(
  storageContextId: string,
  actorUserId: string,
  contextType: 'dm' | 'group',
  provider: TaskProvider | null,
): ToolSet | null {
  if (provider === null) return null

  return makeTools(provider, {
    storageContextId,
    chatUserId: actorUserId,
    mode: 'normal',
    contextType,
  })
}

function resolveActiveToolSet(contextId: string, provider: TaskProvider | null): ToolSet {
  const tools =
    provider === null
      ? {}
      : toToolRecord(
          makeTools(provider, {
            storageContextId: contextId,
            chatUserId: contextId,
            mode: 'normal',
            contextType: 'dm',
          }),
        )
  return isToolSet(tools) ? tools : {}
}

function resolveCachedToolSet(contextId: string): ToolSet {
  const cachedTools = toToolRecord(getCachedTools(contextId))
  return isToolSet(cachedTools) ? cachedTools : {}
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

function buildDirectToolCatalogPages(
  storageContextId: string,
  actorUserId: string,
  contextType: 'dm' | 'group',
  provider: TaskProvider | null,
  deps: ContextCommandDeps,
): readonly string[] {
  try {
    const liveTools = deps.buildLiveToolSet(storageContextId, actorUserId, contextType, provider)
    if (liveTools !== null) return buildContextToolCatalogPages(liveTools)
  } catch (error) {
    log.warn(
      {
        storageContextId,
        actorUserId,
        contextType,
        error: error instanceof Error ? error.message : String(error),
      },
      'Live tool catalog build failed; falling back to cached tools',
    )
    return buildContextToolCatalogPages(resolveCachedToolSet(storageContextId))
  }

  const cachedTools = resolveCachedToolSet(storageContextId)
  if (Object.keys(cachedTools).length > 0) return buildContextToolCatalogPages(cachedTools)

  return buildContextToolCatalogPages(resolveActiveToolSet(storageContextId, provider))
}

async function buildContextSnapshot(
  storageContextId: string,
  actorUserId: string,
  contextType: 'dm' | 'group',
  provider: TaskProvider | null,
  deps: ContextCommandDeps,
): Promise<ContextSnapshot> {
  const collectorDeps = await buildCollectorDeps(storageContextId, actorUserId, contextType, provider, deps)
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

  const provider = safeBuildProvider(auth.storageContextId)
  let snapshot: ContextSnapshot
  try {
    snapshot = await buildContextSnapshot(auth.storageContextId, msg.user.id, msg.contextType, provider, deps)
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
  const toolCatalogPages = buildDirectToolCatalogPages(
    auth.storageContextId,
    msg.user.id,
    msg.contextType,
    provider,
    deps,
  )
  await toolCatalogPages.reduce<Promise<void>>(
    (pending, page) => pending.then(() => reply.formatted(page)),
    Promise.resolve(),
  )
  logContextExecuted(msg.user.id, auth.storageContextId, snapshot, rendered.method)
}

export function registerContextCommand(chat: ChatProvider): void
export function registerContextCommand(chat: ChatProvider, deps: ContextCommandDeps | null): void
export function registerContextCommand(
  chat: ChatProvider,
  ...rest: readonly [ContextCommandDeps | null] | readonly []
): void {
  const resolvedDeps = resolveContextCommandDeps(rest[0])
  chat.registerCommand('context', async (msg, reply, auth) => {
    if (!auth.allowed) return
    await handleContextCommand(msg, reply, auth, chat, resolvedDeps)
  })
}
