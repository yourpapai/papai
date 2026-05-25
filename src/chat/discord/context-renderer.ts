// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { buildContextGrid, SECTION_EMOJIS } from '../../commands/context-grid.js'
import type { ContextRendered, ContextSection, ContextSnapshot, EmbedField } from '../types.js'

const COLOR_GREEN = 0x2ecc71
const COLOR_YELLOW = 0xf1c40f
const COLOR_RED = 0xe74c3c

const formatNumber = (n: number): string => n.toLocaleString('en-US')

const pickColor = (snapshot: ContextSnapshot): number | undefined => {
  if (snapshot.maxTokens === null) return undefined
  const ratio = snapshot.totalTokens / snapshot.maxTokens
  if (ratio < 0.5) return COLOR_GREEN
  if (ratio < 0.8) return COLOR_YELLOW
  return COLOR_RED
}

const buildFooter = (snapshot: ContextSnapshot): string => {
  const total = formatNumber(snapshot.totalTokens)
  const approximate = snapshot.approximate ? ' (approximate)' : ''
  if (snapshot.maxTokens === null) {
    return `${total} tokens${approximate}`
  }
  const max = formatNumber(snapshot.maxTokens)
  const pct = ((snapshot.totalTokens / snapshot.maxTokens) * 100).toFixed(1)
  return `${total} / ${max} tokens (${pct}%)${approximate}`
}

const emojiFor = (label: string): string => SECTION_EMOJIS[label] ?? '⬜'

const buildFieldValue = (section: ContextSection): string => {
  const lines: string[] = [`${formatNumber(section.tokens)} tokens`]
  if (section.children !== undefined) {
    for (const child of section.children) {
      const suffix = child.detail === undefined ? '' : ` (${child.detail})`
      lines.push(`↳ ${child.label}${suffix}: ${formatNumber(child.tokens)}`)
    }
  }
  if (section.detail !== undefined) {
    lines.push(section.detail)
  }
  return lines.join('\n')
}

const buildFields = (snapshot: ContextSnapshot): EmbedField[] =>
  snapshot.sections.map((section) => ({
    name: `${emojiFor(section.label)} ${section.label}`,
    value: buildFieldValue(section),
    inline: false,
  }))

export const renderDiscordContext = (snapshot: ContextSnapshot): ContextRendered => {
  const color = pickColor(snapshot)
  const embed: {
    title: string
    description: string
    fields: EmbedField[]
    footer: string
    color?: number
  } = {
    title: `Context · ${snapshot.modelName}`,
    description: buildContextGrid(snapshot),
    fields: buildFields(snapshot),
    footer: buildFooter(snapshot),
  }
  if (color !== undefined) {
    embed.color = color
  }
  return { method: 'embed', embed }
}
