// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getThreadScopedStorageContextId } from '../auth.js'
import type { AuthorizationResult, IncomingMessage } from './types.js'

export const buildScopedCommandAuth = (
  msg: IncomingMessage,
  isAdmin: boolean,
  platformInstanceId: string,
): AuthorizationResult => ({
  allowed: true,
  isBotAdmin: isAdmin,
  isGroupAdmin: isAdmin,
  storageContextId: getThreadScopedStorageContextId(msg.contextId, msg.contextType, msg.threadId, platformInstanceId),
  configContextId: getThreadScopedStorageContextId(msg.contextId, msg.contextType, undefined, platformInstanceId),
})
