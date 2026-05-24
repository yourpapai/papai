// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatRouter } from '../chat/router.js'

let runtimeChatRouter: ChatRouter | null = null

export const setRuntimeChatRouter = (router: ChatRouter): void => {
  runtimeChatRouter = router
}

export const getRuntimeChatRouter = (): ChatRouter | null => runtimeChatRouter

export const clearRuntimeChatRouter = (): void => {
  runtimeChatRouter = null
}
