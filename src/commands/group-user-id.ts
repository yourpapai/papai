// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { supportsUserResolution } from '../chat/capabilities.js'
import type { ChatProvider, ResolveUserContext } from '../chat/types.js'

export type GroupUserIdResult = { kind: 'resolved'; userId: string } | { kind: 'error'; message: string }

export async function extractGroupUserId(
  chat: ChatProvider,
  input: string,
  context: ResolveUserContext,
): Promise<GroupUserIdResult> {
  if (input.startsWith('@')) {
    if (!supportsUserResolution(chat)) {
      return { kind: 'error', message: 'This chat provider does not support username lookup. Use an explicit user ID.' }
    }
    const resolveUserId = chat.resolveUserId
    if (resolveUserId === undefined) {
      return { kind: 'error', message: 'This chat provider does not support username lookup. Use an explicit user ID.' }
    }
    const resolved = await resolveUserId(input, context)
    if (resolved === null || resolved === undefined) {
      return { kind: 'error', message: "Couldn't resolve that username. Use an explicit user ID." }
    }
    return { kind: 'resolved', userId: resolved }
  }
  if (/^\d+$/u.test(input) || /^[a-zA-Z0-9_-]+$/u.test(input)) {
    return { kind: 'resolved', userId: input }
  }
  return { kind: 'error', message: 'Please provide a valid user mention or ID.' }
}
