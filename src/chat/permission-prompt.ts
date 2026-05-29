// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// Stub: replaced by the real implementation in Phase 4 Task 4.1.

import type { ReplyFn } from './types.js'

export function askPermissionViaChat(
  _reply: ReplyFn,
  _contextId: string,
  _req: { toolName: string; reason: string },
): Promise<'allow' | 'deny'> {
  return Promise.resolve('deny')
}
