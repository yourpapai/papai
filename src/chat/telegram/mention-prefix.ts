// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { DeferredDeliveryTarget } from '../types.js'
import { formatLlmOutput } from './format.js'

type TelegramEntity = ReturnType<typeof formatLlmOutput>['entities'][number]

type TelegramMentionPrefix = {
  text: string
  entities: readonly TelegramEntity[]
}

type TelegramMentionTarget = {
  userId: number
  label: string
  firstName: string
}

const parseTelegramUserId = (value: string): number | null => {
  if (!/^\d+$/u.test(value)) {
    return null
  }

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

const getMentionLabel = (target: DeferredDeliveryTarget, mentionedUserId: string): string => {
  if (mentionedUserId === target.createdByUserId) {
    if (target.createdByUsername !== null) {
      return `@${target.createdByUsername}`
    }
    return 'you'
  }

  return 'user'
}

const normalizeMentionFirstName = (label: string): string => (label.startsWith('@') ? label.slice(1) : label)

export function buildTelegramMentionPrefix(target: DeferredDeliveryTarget): TelegramMentionPrefix {
  if (target.contextType !== 'group' || target.audience !== 'personal') {
    return { text: '', entities: [] }
  }

  const mentionTargets = target.mentionUserIds.flatMap<TelegramMentionTarget>((mentionedUserId) => {
    const userId = parseTelegramUserId(mentionedUserId)
    if (userId === null) {
      return []
    }

    const label = getMentionLabel(target, mentionedUserId)
    return [{ userId, label, firstName: normalizeMentionFirstName(label) }]
  })

  if (mentionTargets.length === 0) {
    return { text: '', entities: [] }
  }

  const text = `${mentionTargets.map((mention) => mention.label).join(' ')} `
  const mentionData = mentionTargets.reduce<{
    offset: number
    entities: readonly TelegramEntity[]
  }>(
    (acc, mention) => {
      const entity: TelegramEntity = {
        offset: acc.offset,
        length: mention.label.length,
        type: 'text_mention',
        user: {
          id: mention.userId,
          is_bot: false,
          first_name: mention.firstName,
        },
      }
      return {
        offset: acc.offset + mention.label.length + 1,
        entities: [...acc.entities, entity],
      }
    },
    { offset: 0, entities: [] },
  )

  return { text, entities: mentionData.entities }
}
