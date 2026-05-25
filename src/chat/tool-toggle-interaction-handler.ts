// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { safeBuildProvider } from '../commands/context-tool-resolution.js'
import { buildDomainDrillView, buildDomainListView, type ToolMenuView } from '../commands/tool-config-view.js'
import { listManageableGroups } from '../group-settings/access.js'
import { getMissingGroupTargetMessage } from '../group-settings/target-validation.js'
import { logger } from '../logger.js'
import { getToolMetadata, TOOL_METADATA, type ToolDomain } from '../tools/tool-metadata.js'
import { getToolPrefs, setToolPrefs, toggleDomain, toggleTool } from '../tools/tool-preferences.js'
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

function canManageTargetContext(interaction: IncomingInteraction, targetContextId: string): boolean {
  if (interaction.contextType !== 'dm') return targetContextId === interaction.storageContextId
  if (targetContextId === interaction.user.id) return true
  return listManageableGroups(interaction.user.id).some((group) => group.contextId === targetContextId)
}

function availableToolNames(targetContextId: string, actorUserId: string, contextType: 'dm' | 'group'): string[] {
  const provider = safeBuildProvider(targetContextId)
  if (provider === null) return []
  const tools = buildTools(provider, actorUserId, targetContextId, 'normal', contextType)
  return Object.keys(tools).filter((name) => getToolMetadata(name) !== undefined)
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

async function handleDomainAction(
  action: string,
  middle: string,
  contextId: string,
  names: string[],
  userId: string,
  reply: ReplyFn,
): Promise<boolean> {
  if (action === 'menu' || action === 'back') {
    await renderView(reply, buildDomainListView(contextId, names, getToolPrefs(contextId)))
    return true
  }
  if (action === 'open') {
    if (!isToolDomain(middle)) {
      await replyTextPreferReplace(reply, 'Unknown tool domain.')
      return true
    }
    await renderView(reply, buildDomainDrillView(contextId, middle, names, getToolPrefs(contextId)))
    return true
  }
  if (action === 'dom') {
    if (!isToolDomain(middle)) {
      await replyTextPreferReplace(reply, 'Unknown tool domain.')
      return true
    }
    const domainNames = filterByDomain(names, middle)
    setToolPrefs(contextId, toggleDomain(getToolPrefs(contextId), middle, domainNames))
    log.info({ contextId, domain: middle, userId }, 'Tool domain toggled')
    await renderView(reply, buildDomainListView(contextId, names, getToolPrefs(contextId)))
    return true
  }
  if (action === 'tool') {
    const meta = getToolMetadata(middle)
    if (meta === undefined) {
      await replyTextPreferReplace(reply, 'Unknown tool.')
      return true
    }
    const domainNames = filterByDomain(names, meta.domain)
    setToolPrefs(contextId, toggleTool(getToolPrefs(contextId), middle, domainNames))
    log.info({ contextId, tool: middle, userId }, 'Tool toggled')
    await renderView(reply, buildDomainDrillView(contextId, meta.domain, names, getToolPrefs(contextId)))
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
  if (!canManageTargetContext(interaction, contextId)) {
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
