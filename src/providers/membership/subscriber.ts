// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'

import { NO_ANALYTICS_SCOPE, type ProviderRequestScope } from '../../analytics/provider-request-scope.js'
import type { DebugEvent } from '../../debug/event-bus.js'
import { subscribe, unsubscribe } from '../../debug/event-bus.js'
import { logger } from '../../logger.js'
import type { MemberOutcome } from './ensure-member.js'

const log = logger.child({ scope: 'providers:membership:subscriber' })
const limit = pLimit(4)

function isPlaceholder(userId: string): boolean {
  return userId.startsWith('placeholder-')
}

export interface SubscriberHandlers {
  ensure(groupContextId: string, chatUserId: string, scope: ProviderRequestScope): Promise<MemberOutcome>
  markInactive(groupContextId: string, chatUserId: string): Promise<void>
}

export function registerMembershipSubscriber(handlers: SubscriberHandlers): () => void {
  const listener = (event: DebugEvent): void => {
    if (event.type === 'group_member:added') {
      const rawGroupId = event.data['groupId']
      const rawUserId = event.data['userId']
      if (typeof rawGroupId !== 'string' || typeof rawUserId !== 'string') return
      if (rawGroupId === '' || rawUserId === '') return
      if (isPlaceholder(rawUserId)) {
        log.debug({ groupId: rawGroupId, userId: rawUserId }, 'Skipping placeholder user in member:added subscriber')
        return
      }
      const groupId = rawGroupId
      const userId = rawUserId
      void limit(async () => {
        // Platform membership events are operational, not actor-attributed.
        const outcome = await handlers.ensure(groupId, userId, NO_ANALYTICS_SCOPE)
        log.debug({ groupId, userId, outcome }, 'group_member:added -> ensureWorkspaceMember')
      })
    } else if (event.type === 'group_member:removed') {
      const rawGroupId = event.data['groupId']
      const rawUserId = event.data['userId']
      if (typeof rawGroupId !== 'string' || typeof rawUserId !== 'string') return
      if (rawGroupId === '' || rawUserId === '') return
      const groupId = rawGroupId
      const userId = rawUserId
      void limit(async () => {
        await handlers.markInactive(groupId, userId)
        log.debug({ groupId, userId }, 'group_member:removed -> markInactive')
      })
    }
  }

  subscribe(listener)
  log.info('Membership event subscriber registered')
  return () => {
    unsubscribe(listener)
    log.debug('Membership event subscriber unregistered')
  }
}
