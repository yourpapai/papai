// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { toScopedContextId } from '../chat/scoped-context.js'
import { getConfigValue, setConfigValue, unsetConfigValue } from '../config.js'
import { listKnownGroupContextsForPlatform } from '../group-settings/admin-group-list.js'
import { listPlatformInstancesSafe } from '../instances/platform-store.js'
import { parseReductionFlagsJson, REDUCTION_FLAGS_CONFIG_KEY, type ReductionFlags } from '../tools/feature-flags.js'
import { listUsers } from '../users.js'

/** Wire/storage shape: snake_case keys exactly as parseReductionFlagsJson reads them. */
export interface AdminFlagState {
  result_compaction: boolean
  progressive_disclosure: boolean
  semantic_tool_retrieval: boolean
}

export interface AdminFlagContextRow {
  contextId: string
  kind: 'user' | 'group'
  label: string
  platformInstanceLabel: string
  flags: AdminFlagState
}

export interface AdminFeatureFlagsSnapshot {
  killSwitchEngaged: boolean
  contexts: AdminFlagContextRow[]
}

export class AdminFeatureFlagsError extends Error {}

const toWire = (flags: ReductionFlags): AdminFlagState => ({
  result_compaction: flags.resultCompaction,
  progressive_disclosure: flags.progressiveDisclosure,
  semantic_tool_retrieval: flags.semanticToolRetrieval,
})

const readFlags = (contextId: string): AdminFlagState =>
  toWire(parseReductionFlagsJson(getConfigValue(contextId, REDUCTION_FLAGS_CONFIG_KEY)))

const kindRank = (kind: 'user' | 'group'): number => (kind === 'user' ? 0 : 1)

function listContextRows(): AdminFlagContextRow[] {
  // Keyed by contextId so a native id that exists as both a users row and a group
  // context (e.g. a Telegram group chat id persisted in `users`) collapses to one
  // row — otherwise the keyed {#each} in AdminFeatureFlagsSection throws
  // each_key_duplicate. Group entries are inserted last and overwrite colliding
  // user rows, since the group registry is authoritative for group contexts.
  const byContextId = new Map<string, AdminFlagContextRow>()
  for (const instance of listPlatformInstancesSafe().instances) {
    for (const user of listUsers(instance.id).filter((u) => !u.platform_user_id.startsWith('placeholder-'))) {
      const contextId = toScopedContextId({ platformInstanceId: instance.id, nativeContextId: user.platform_user_id })
      byContextId.set(contextId, {
        contextId,
        kind: 'user',
        label: user.username ?? user.platform_user_id,
        platformInstanceLabel: instance.id,
        flags: readFlags(contextId),
      })
    }
    for (const group of listKnownGroupContextsForPlatform(instance.id)) {
      byContextId.set(group.contextId, {
        contextId: group.contextId,
        kind: 'group',
        label: group.parentName === null ? group.displayName : `${group.displayName} — ${group.parentName}`,
        platformInstanceLabel: instance.id,
        flags: readFlags(group.contextId),
      })
    }
  }
  return [...byContextId.values()].toSorted(
    (a, b) => kindRank(a.kind) - kindRank(b.kind) || a.label.localeCompare(b.label),
  )
}

export function getAdminFeatureFlagsSnapshot(): AdminFeatureFlagsSnapshot {
  return {
    killSwitchEngaged: process.env['TOOL_CONTEXT_REDUCTION_DISABLED'] === 'true',
    contexts: listContextRows(),
  }
}

export function applyAdminFeatureFlagsUpdate(contextId: string, flags: AdminFlagState): AdminFlagContextRow {
  const row = listContextRows().find((r) => r.contextId === contextId)
  if (row === undefined) throw new AdminFeatureFlagsError('unknown context')
  setConfigValue(contextId, REDUCTION_FLAGS_CONFIG_KEY, JSON.stringify(flags))
  return { ...row, flags: readFlags(contextId) }
}

export function applyAdminFeatureFlagsUnset(contextId: string): AdminFlagContextRow {
  const row = listContextRows().find((r) => r.contextId === contextId)
  if (row === undefined) throw new AdminFeatureFlagsError('unknown context')
  unsetConfigValue(contextId, REDUCTION_FLAGS_CONFIG_KEY)
  return { ...row, flags: readFlags(contextId) }
}
