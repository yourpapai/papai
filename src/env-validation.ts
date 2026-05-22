// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type ChatProviderValidationResult = { ok: true } | { ok: false; reason: string; missing?: string[] }

export function validateChatProviderEnv(
  chatProvider: string | undefined,
  env: Record<string, string | undefined>,
): ChatProviderValidationResult {
  if (chatProvider !== 'telegram' && chatProvider !== 'mattermost' && chatProvider !== 'discord') {
    return {
      ok: false,
      reason: 'CHAT_PROVIDER must be "telegram", "mattermost", or "discord"',
    }
  }
  const requirements: Record<'telegram' | 'mattermost' | 'discord', readonly string[]> = {
    telegram: ['TELEGRAM_BOT_TOKEN'],
    mattermost: ['MATTERMOST_URL', 'MATTERMOST_BOT_TOKEN'],
    discord: ['DISCORD_BOT_TOKEN'],
  }
  const required = requirements[chatProvider]
  const missing = required.filter((key) => (env[key]?.trim() ?? '') === '')
  if (missing.length > 0) {
    return { ok: false, reason: `Missing ${chatProvider} env vars`, missing }
  }
  return { ok: true }
}
