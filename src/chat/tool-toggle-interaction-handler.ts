// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { safeBuildProvider } from '../commands/context-tool-resolution.js'
import { canManageInteractionTargetContext } from '../commands/plugin-auth.js'
import {
  buildDomainDrillView,
  buildDomainListView,
  resolveToolDomainCode,
  resolveToolNameCode,
  type ToolMenuView,
} from '../commands/tool-config-view.js'
import { getMissingGroupTargetMessage } from '../group-settings/target-validation.js'
import { logger } from '../logger.js'
import { getToolMetadata, TOOL_METADATA, type ToolDomain } from '../tools/tool-metadata.js'
import { cycleDomain, cycleTool, getToolPrefs, setToolPrefs } from '../tools/tool-preferences.js'
import { buildTools } from '../tools/tools-builder.js'
import { replyButtonsPreferReplace, replyTextPreferReplace } from './interaction-router-replies.js'
import type { IncomingInteraction, ReplyFn } from './types.js'

const log = logger.child({ scope: 'chat:tool-toggle-interaction' })

const DOMAIN_SET = new Set<string>(Object.values(TOOL_METADATA).map((m) => m.domain))

function isToolDomain(value: string): value is ToolDomain {
  return DOMAIN_SET.has(value)
}

function decodeContextId(encoded: string): string | null {
  try {
    return Buffer.from(encoded, 'base64url').toString('utf8')
  } catch {
    return null
  }
}

function availableToolNames(targetContextId: string, actorUserId: string, contextType: 'dm' | 'group'): string[] {
  const provider = safeBuildProvider(targetContextId)
  if (provider === null) return []
  const tools = buildTools(provider, actorUserId, targetContextId, 'normal', contextType)
  return Object.keys(tools)
}

async function renderView(reply: ReplyFn, view: ToolMenuView): Promise<void> {
  await replyButtonsPreferReplace(reply, view.text, view.buttons)
}

function filterByDomain(names: string[], domain: string): string[] {
  return names.filter((n) => {
    const m = getToolMetadata(n)
    return m !== undefined && m.domain === domain
  })
}

function resolveCompactAction(action: string): string {
  if (action === 'b') return 'back'
  if (action === 'd') return 'dom'
  if (action === 'o') return 'open'
  if (action === 't') return 'tool'
  return action
}

function resolveCompactMiddle(action: string, middle: string, names: readonly string[]): string {
  if (action === 'd' || action === 'o') {
    if (middle === 'ext') return 'external'
    return resolveToolDomainCode(middle) ?? middle
  }
  if (action === 't') return resolveToolNameCode(middle, names) ?? middle
  return middle
}

async function handleOpenAction(middle: string, contextId: string, names: string[], reply: ReplyFn): Promise<void> {
  if (middle === 'external') {
    await renderView(reply, buildDomainDrillView(contextId, 'external', names, getToolPrefs(contextId)))
    return
  }
  if (!isToolDomain(middle)) {
    await replyTextPreferReplace(reply, 'Unknown tool domain.')
    return
  }
  await renderView(reply, buildDomainDrillView(contextId, middle, names, getToolPrefs(contextId)))
}

async function handleDomAction(
  middle: string,
  contextId: string,
  names: string[],
  userId: string,
  reply: ReplyFn,
): Promise<void> {
  if (middle === 'external') {
    // External pseudo-domain has no bulk default; individual tool cycling only.
    await renderView(reply, buildDomainListView(contextId, names, getToolPrefs(contextId)))
    return
  }
  if (!isToolDomain(middle)) {
    await replyTextPreferReplace(reply, 'Unknown tool domain.')
    return
  }
  const domainNames = filterByDomain(names, middle)
  setToolPrefs(contextId, cycleDomain(getToolPrefs(contextId), middle, domainNames))
  log.info({ contextId, domain: middle, userId }, 'Tool domain cycled')
  await renderView(reply, buildDomainListView(contextId, names, getToolPrefs(contextId)))
}

async function handleToolAction(
  middle: string,
  contextId: string,
  names: string[],
  userId: string,
  reply: ReplyFn,
): Promise<void> {
  const meta = getToolMetadata(middle)
  if (meta === undefined) {
    if (!names.includes(middle)) {
      await replyTextPreferReplace(reply, 'Unknown tool.')
      return
    }
    setToolPrefs(contextId, cycleTool(getToolPrefs(contextId), middle))
    log.info({ contextId, tool: middle, userId }, 'External tool cycled')
    await renderView(reply, buildDomainDrillView(contextId, 'external', names, getToolPrefs(contextId)))
    return
  }
  setToolPrefs(contextId, cycleTool(getToolPrefs(contextId), middle))
  log.info({ contextId, tool: middle, userId }, 'Tool cycled')
  await renderView(reply, buildDomainDrillView(contextId, meta.domain, names, getToolPrefs(contextId)))
}

async function handleDomainAction(
  action: string,
  middle: string,
  contextId: string,
  names: string[],
  userId: string,
  reply: ReplyFn,
): Promise<boolean> {
  const resolvedAction = resolveCompactAction(action)
  const resolvedMiddle = resolveCompactMiddle(action, middle, names)
  if (resolvedAction === 'menu' || resolvedAction === 'back') {
    await renderView(reply, buildDomainListView(contextId, names, getToolPrefs(contextId)))
    return true
  }
  if (resolvedAction === 'open') {
    await handleOpenAction(resolvedMiddle, contextId, names, reply)
    return true
  }
  if (resolvedAction === 'dom') {
    await handleDomAction(resolvedMiddle, contextId, names, userId, reply)
    return true
  }
  if (resolvedAction === 'tool') {
    await handleToolAction(resolvedMiddle, contextId, names, userId, reply)
    return true
  }
  return false
}

export async function handleToolToggleInteraction(interaction: IncomingInteraction, reply: ReplyFn): Promise<boolean> {
  const { callbackData } = interaction
  if (!callbackData.startsWith('tgl:')) return false

  const parts = callbackData.slice(4).split(':')
  const action = parts.at(0)
  const encodedContextId = parts.at(-1)
  const middle = parts.slice(1, parts.length - 1).join(':')

  if (action === undefined || encodedContextId === undefined) {
    log.warn({ callbackData }, 'Malformed tool toggle callback')
    await replyTextPreferReplace(reply, 'Invalid tool action. Please try again.')
    return true
  }
  const contextId = decodeContextId(encodedContextId)
  if (contextId === null) {
    log.warn({ callbackData }, 'Malformed tool toggle callback context')
    await replyTextPreferReplace(reply, 'Invalid tool action. Please try again.')
    return true
  }
  const authorization = canManageInteractionTargetContext(interaction, contextId)
  if (!authorization.allowed) {
    await replyTextPreferReplace(reply, getMissingGroupTargetMessage(interaction.user.id, contextId))
    return true
  }

  const names = availableToolNames(contextId, interaction.user.id, interaction.contextType)
  const handled = await handleDomainAction(action, middle, contextId, names, interaction.user.id, reply)
  if (handled) return true

  log.warn({ callbackData, action }, 'Unknown tool toggle action')
  await replyTextPreferReplace(reply, 'Unknown tool action.')
  return true
}
