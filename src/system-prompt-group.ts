// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ContextType } from './chat/types.js'
import { getDictionary, type Locale } from './i18n/index.js'

// resolve_chat_participant bullets + USER IDs note are gated on the enabled tool set; base group rules always present.
export function buildDeferredFragment(
  base: string,
  ctx: ContextType | undefined,
  e: ReadonlySet<string> | undefined,
  locale: Locale = 'en',
): string {
  if (ctx !== 'group') return base
  const r = e?.has('resolve_chat_participant') === true
  const groupReminders = r
    ? getDictionary(locale).systemPrompt.groupRemindersWithParticipants
    : getDictionary(locale).systemPrompt.groupReminders
  return `${base}\n\n${groupReminders}`
}
