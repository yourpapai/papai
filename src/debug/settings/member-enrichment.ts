// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { parseScopedContextId } from '../../chat/scoped-context.js'
import { getGroupUserObservationLabels } from '../../group-settings/registry.js'
import { getPlatformInstance } from '../../instances/platform-store.js'
import { logger } from '../../logger.js'
import { getRuntimeChatRouter } from '../chat-router-runtime.js'
import { resolveMemberLabels } from './member-labels.js'

const log = logger.child({ scope: 'debug-server:member-enrichment' })

export type BareMember = { user_id: string; added_by: string; added_at: string }
export type EnrichedMember = BareMember & { user_label: string | null; added_by_label: string | null }

/** Resolve the persisted provider name for a platform instance. */
function resolveProviderName(platformInstanceId: string): string | null {
  return getPlatformInstance(platformInstanceId)?.type ?? null
}

/** Best-effort display-label enrichment. Never throws — falls back to raw ids on any failure. */
export async function enrichMembers(contextId: string, members: BareMember[]): Promise<EnrichedMember[]> {
  const bare = (): EnrichedMember[] => members.map((m) => ({ ...m, user_label: null, added_by_label: null }))
  try {
    const parsed = parseScopedContextId(contextId)
    if (parsed === null) return bare()
    const { platformInstanceId } = parsed
    const provider = resolveProviderName(platformInstanceId)
    const ids = [...new Set(members.flatMap((m) => [m.user_id, m.added_by]))]
    const cached =
      provider === null ? new Map<string, string>() : getGroupUserObservationLabels(provider, contextId, ids)
    const router = getRuntimeChatRouter()
    const resolveLive = (userId: string): Promise<string | null> =>
      router?.resolveUserLabel?.(userId, { contextId, contextType: 'group', platformInstanceId }) ??
      Promise.resolve(null)
    const labels = await resolveMemberLabels(ids, cached, resolveLive)
    return members.map((m) => ({
      ...m,
      user_label: labels.get(m.user_id) ?? null,
      added_by_label: labels.get(m.added_by) ?? null,
    }))
  } catch (err) {
    log.warn(
      { contextId, err: err instanceof Error ? err.message : String(err) },
      'member label enrichment failed; returning raw ids',
    )
    return bare()
  }
}
