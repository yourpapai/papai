// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

const CHAT_PROVIDERS = ['telegram', 'mattermost', 'discord'] as const
const TASK_PROVIDERS = ['kaneo', 'youtrack'] as const

type AdminChatProvider = (typeof CHAT_PROVIDERS)[number] | 'unknown'
type AdminTaskProvider = (typeof TASK_PROVIDERS)[number] | 'unknown'

const safeProviderValue = <const T extends readonly string[]>(
  value: string | undefined,
  known: T,
): T[number] | 'unknown' => (value !== undefined && known.includes(value) ? value : 'unknown')

const safeChatProvider = (): AdminChatProvider => safeProviderValue(process.env['CHAT_PROVIDER'], CHAT_PROVIDERS)

const safeTaskProvider = (): AdminTaskProvider => safeProviderValue(process.env['TASK_PROVIDER'], TASK_PROVIDERS)

export const handleAdminSystem = (): Response =>
  new Response(
    JSON.stringify({
      chatProvider: safeChatProvider(),
      taskProvider: safeTaskProvider(),
      debugServer: process.env['DEBUG_SERVER'] === 'true',
      adminUserSet: (process.env['ADMIN_USER_ID'] ?? '') !== '',
    }),
    { headers: { 'Content-Type': 'application/json' } },
  )
