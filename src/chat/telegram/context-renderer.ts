// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { buildContextGrid } from '../../commands/context-grid.js'
import { t } from '../../i18n/index.js'
import type { ContextRendered, ContextSection, ContextSnapshot } from '../types.js'

const formatNumber = (n: number): string => n.toLocaleString('en-US')

const buildHeader = (snapshot: ContextSnapshot): string => {
  const total = formatNumber(snapshot.totalTokens)
  if (snapshot.maxTokens === null) {
    return `${t('contextView.headerWord', snapshot.locale)} · ${snapshot.modelName} · ${total} ${t('contextView.tokensUnit', snapshot.locale)}`
  }
  const max = formatNumber(snapshot.maxTokens)
  const pct = ((snapshot.totalTokens / snapshot.maxTokens) * 100).toFixed(1)
  return `${t('contextView.headerWord', snapshot.locale)} · ${snapshot.modelName} · ${total} / ${max} ${t('contextView.tokensUnit', snapshot.locale)} (${pct}%)`
}

const formatSectionLine = (section: ContextSection, locale: ContextSnapshot['locale'], indent: number): string => {
  const pad = ' '.repeat(indent)
  const tokens = `${formatNumber(section.tokens)} ${t('contextView.tokenSuffix', locale)}`
  return `${pad}${section.label.padEnd(24 - indent)} ${tokens.padStart(10)}`
}

const buildDetail = (snapshot: ContextSnapshot): string => {
  const lines: string[] = []
  for (const section of snapshot.sections) {
    lines.push(formatSectionLine(section, snapshot.locale, 0))
    if (section.children !== undefined) {
      for (const child of section.children) {
        lines.push(formatSectionLine(child, snapshot.locale, 2))
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
  const footer = snapshot.approximate ? `\n\n_${t('contextView.approximateFooter', snapshot.locale)}_` : ''
  const content = `${header}\n\n${grid}\n\n\`\`\`\n${detail}\n\`\`\`${footer}`
  return { method: 'text', content }
}
