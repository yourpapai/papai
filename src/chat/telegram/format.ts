// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { markdownToFormattable } from '@gramio/format/markdown'
import type { TelegramMessageEntity } from '@gramio/types'
import type { MessageEntity } from '@grammyjs/types'
import { lexer, type Token, type Tokens } from 'marked'

import { logger } from '../../logger.js'

const log = logger.child({ scope: 'format' })

const createBaseEntity = (entity: TelegramMessageEntity): { offset: number; length: number } => ({
  offset: entity.offset,
  length: entity.length,
})

const isValidDateTimeFormat = (value: string): value is MessageEntity.DateTimeMessageEntity['date_time_format'] => {
  // Valid patterns: "r" or combinations of optional "w", "d"/"D", "t"/"T"
  return /^[rwdDtT]*$/.test(value) && (value === 'r' || value.length <= 3)
}

const mapPreEntity = (entity: TelegramMessageEntity, base: { offset: number; length: number }): MessageEntity | null =>
  entity.language === undefined ? null : { ...base, type: 'pre', language: entity.language }

const isValidHttpUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

const mapTextLinkEntity = (
  entity: TelegramMessageEntity,
  base: { offset: number; length: number },
): MessageEntity | null => {
  if (entity.url === undefined) {
    return null
  }
  // Telegram requires valid HTTP/HTTPS URLs for text_link entities
  if (!isValidHttpUrl(entity.url)) {
    log.debug({ url: entity.url }, 'Skipping invalid URL in text_link entity')
    return null
  }
  return { ...base, type: 'text_link', url: entity.url }
}

const mapTextMentionEntity = (
  entity: TelegramMessageEntity,
  base: { offset: number; length: number },
): MessageEntity | null => (entity.user === undefined ? null : { ...base, type: 'text_mention', user: entity.user })

const mapCustomEmojiEntity = (
  entity: TelegramMessageEntity,
  base: { offset: number; length: number },
): MessageEntity | null =>
  entity.custom_emoji_id === undefined
    ? null
    : { ...base, type: 'custom_emoji', custom_emoji_id: entity.custom_emoji_id }

const mapDateTimeEntity = (
  entity: TelegramMessageEntity,
  base: { offset: number; length: number },
): MessageEntity | null => {
  if (
    entity.unix_time === undefined ||
    entity.date_time_format === undefined ||
    !isValidDateTimeFormat(entity.date_time_format)
  ) {
    return null
  }
  return {
    ...base,
    type: 'date_time',
    unix_time: entity.unix_time,
    date_time_format: entity.date_time_format,
  }
}

const mapEntity = (entity: TelegramMessageEntity): MessageEntity | null => {
  const base = createBaseEntity(entity)
  const { type } = entity

  // Entities with optional extra properties
  if (type === 'pre') return mapPreEntity(entity, base)
  if (type === 'text_link') return mapTextLinkEntity(entity, base)
  if (type === 'text_mention') return mapTextMentionEntity(entity, base)
  if (type === 'custom_emoji') return mapCustomEmojiEntity(entity, base)
  if (type === 'date_time') return mapDateTimeEntity(entity, base)

  // Common entity types without extra properties
  switch (type) {
    case 'mention':
      return { ...base, type: 'mention' }
    case 'hashtag':
      return { ...base, type: 'hashtag' }
    case 'cashtag':
      return { ...base, type: 'cashtag' }
    case 'bot_command':
      return { ...base, type: 'bot_command' }
    case 'url':
      return { ...base, type: 'url' }
    case 'email':
      return { ...base, type: 'email' }
    case 'phone_number':
      return { ...base, type: 'phone_number' }
    case 'bold':
      return { ...base, type: 'bold' }
    case 'italic':
      return { ...base, type: 'italic' }
    case 'underline':
      return { ...base, type: 'underline' }
    case 'strikethrough':
      return { ...base, type: 'strikethrough' }
    case 'spoiler':
      return { ...base, type: 'spoiler' }
    case 'blockquote':
      return { ...base, type: 'blockquote' }
    case 'expandable_blockquote':
      return { ...base, type: 'expandable_blockquote' }
    case 'code':
      return { ...base, type: 'code' }
    default:
      // Unknown entity types - return null to treat as regular text
      return null
  }
}

const mapToGrammyEntities = (entities: TelegramMessageEntity[]): MessageEntity[] => {
  const mapped: MessageEntity[] = []
  for (const entity of entities) {
    const mappedEntity = mapEntity(entity)
    if (mappedEntity !== null) {
      mapped.push(mappedEntity)
    }
  }
  return mapped
}

/**
 * Flattens markdown table tokens to plain rows so that inline elements (links, bold, etc.)
 * inside cells are handled by markdownToFormattable rather than falling through to its
 * raw-text fallback, which would leave "[text](url)" syntax visible to the user.
 */
const isTableToken = (token: Token): token is Tokens.Table => token.type === 'table'

const preprocessTables = (markdown: string): string =>
  lexer(markdown)
    .map((token) => {
      if (isTableToken(token)) {
        const headerLine = token.header.map((c) => c.text).join(' | ')
        const dataLines = token.rows.map((row) => row.map((c) => c.text).join(' | '))
        return [headerLine, ...dataLines].join('\n')
      }
      return token.raw
    })
    .join('')

/**
 * Ensures lists are properly separated from preceding text with a blank line.
 * Markdown requires a blank line before lists to properly render them as separate blocks.
 * Without this, markdownToFormattable may strip the newline, causing formatting issues like:
 * "Your current projects are:- Work (work)" instead of "Your current projects are:\n\n- Work (work)"
 */
const preprocessLists = (markdown: string): string =>
  // Add blank line before list items when preceded by non-list text
  // Matches: text followed by single newline followed by list marker (-, *, +, or number.)
  markdown.replace(/([^\n])\n([-*+]|\d+\.)\s/g, '$1\n\n$2 ')

/**
 * Converts LLM Markdown response to Telegram-compatible format with grammy MessageEntity types
 * @param markdown - LLM output in Markdown format
 * @returns Object with text and entities compatible with grammy's reply method
 */
export const formatLlmOutput = (markdown: string): { text: string; entities: MessageEntity[] } => {
  log.debug({ markdownLength: markdown.length }, 'Converting Markdown to entities')
  const result = markdownToFormattable(preprocessTables(preprocessLists(markdown)))
  log.debug(
    {
      textLength: result.text.length,
      entityCount: result.entities.length,
    },
    'Markdown converted to entities',
  )
  return {
    text: result.text,
    entities: mapToGrammyEntities(result.entities),
  }
}
