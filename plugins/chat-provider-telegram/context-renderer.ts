// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ContextRendered, ContextSection, ContextSnapshot } from '../../src/chat/types.js'
import { buildContextGrid } from '../../src/commands/context-grid.js'

const formatNumber = (n: number): string => n.toLocaleString('en-US')

const buildHeader = (snapshot: ContextSnapshot): string => {
  const total = formatNumber(snapshot.totalTokens)
  if (snapshot.maxTokens === null) {
    return `Context · ${snapshot.modelName} · ${total} tokens`
  }
  const max = formatNumber(snapshot.maxTokens)
  const pct = ((snapshot.totalTokens / snapshot.maxTokens) * 100).toFixed(1)
  return `Context · ${snapshot.modelName} · ${total} / ${max} tokens (${pct}%)`
}

const formatSectionLine = (section: ContextSection, indent: number): string => {
  const pad = ' '.repeat(indent)
  const tokens = `${formatNumber(section.tokens)} tk`
  return `${pad}${section.label.padEnd(24 - indent)} ${tokens.padStart(10)}`
}

const buildDetail = (snapshot: ContextSnapshot): string => {
  const lines: string[] = []
  for (const section of snapshot.sections) {
    lines.push(formatSectionLine(section, 0))
    if (section.children !== undefined) {
      for (const child of section.children) {
        lines.push(formatSectionLine(child, 2))
      }
    }
    if (section.detail !== undefined) {
      lines.push(`  ${section.detail}`)
    }
  }
  return lines.join('\n')
}

export const renderTelegramContext = (snapshot: ContextSnapshot): ContextRendered => {
  const header = buildHeader(snapshot)
  const grid = buildContextGrid(snapshot)
  const detail = buildDetail(snapshot)
  const footer = snapshot.approximate ? '\n\n_token counts are approximate_' : ''
  const content = `${header}\n\n${grid}\n\n\`\`\`\n${detail}\n\`\`\`${footer}`
  return { method: 'text', content }
}
