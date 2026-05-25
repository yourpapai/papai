// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { resolveDeliveryPlatformInstanceId } from '../chat/delivery-routing.js'
import type { ChatProvider, DeferredDeliveryTarget } from '../chat/types.js'

type RouterInstanceLookup = { getInstance: (id: string) => unknown }
type RouterInstanceActiveLookup = { isInstanceActive: (id: string) => boolean }

const hasRouterInstanceLookup = (chat: ChatProvider): chat is ChatProvider & RouterInstanceLookup =>
  typeof Reflect.get(chat, 'getInstance') === 'function'

const hasRouterInstanceActiveLookup = (chat: ChatProvider): chat is ChatProvider & RouterInstanceActiveLookup =>
  typeof Reflect.get(chat, 'isInstanceActive') === 'function'

export function resolveProactivePlatformInstanceId(chat: ChatProvider, target: DeferredDeliveryTarget): string | null {
  const platformInstanceId = resolveDeliveryPlatformInstanceId(target)
  if (platformInstanceId === null) return null
  if (hasRouterInstanceActiveLookup(chat) && !chat.isInstanceActive(platformInstanceId)) return null
  if (hasRouterInstanceLookup(chat)) {
    const instance = chat.getInstance(platformInstanceId)
    if (instance === undefined || instance === null) return null
  }
  return platformInstanceId
}

export async function sendProactiveMessage(
  chat: ChatProvider,
  target: DeferredDeliveryTarget,
  markdown: string,
): Promise<boolean> {
  const platformInstanceId = resolveProactivePlatformInstanceId(chat, target)
  if (platformInstanceId === null) return false
  await chat.sendMessage(platformInstanceId, target, markdown)
  return true
}
