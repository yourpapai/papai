// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { parseScopedContextId } from '../chat/scoped-context.js'

export const matchesAdminPlatformInstance = (contextId: string, platformInstanceId: string | undefined): boolean => {
  if (platformInstanceId === undefined) return true
  const parsed = parseScopedContextId(contextId)
  if (parsed === null) return true
  return parsed.platformInstanceId === platformInstanceId
}

export const getAdminLookupScope = (
  userId: string,
  platformInstanceId: string | undefined,
): { nativeUserId: string; platformInstanceId: string | undefined } => {
  const parsed = parseScopedContextId(userId)
  if (parsed === null) return { nativeUserId: userId, platformInstanceId }
  if (platformInstanceId !== undefined) return { nativeUserId: parsed.nativeContextId, platformInstanceId }
  return { nativeUserId: parsed.nativeContextId, platformInstanceId: parsed.platformInstanceId }
}
