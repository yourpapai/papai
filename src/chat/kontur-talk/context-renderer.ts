// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { buildContextGrid, SECTION_EMOJIS } from '../../commands/context-grid.js'
import { t } from '../../i18n/index.js'
import type { ContextRendered, ContextSection, ContextSnapshot } from '../types.js'

const formatNumber = (n: number): string => n.toLocaleString('en-US')

const buildHeader = (snapshot: ContextSnapshot): string => {
  const total = formatNumber(snapshot.totalTokens)
  if (snapshot.maxTokens === null) {
    return `**${t('contextView.headerWord', snapshot.locale)}** · ${snapshot.modelName} · ${total} ${t('contextView.tokensUnit', snapshot.locale)}`
  }
  const max = formatNumber(snapshot.maxTokens)
  const pct = ((snapshot.totalTokens / snapshot.maxTokens) * 100).toFixed(1)
  return `**${t('contextView.headerWord', snapshot.locale)}** · ${snapshot.modelName} · ${total} / ${max} ${t('contextView.tokensUnit', snapshot.locale)} (${pct}%)`
}

const emojiFor = (id: string): string => SECTION_EMOJIS[id] ?? '⬜'

const topRow = (section: ContextSection): string =>
  `| ${emojiFor(section.id)} **${section.label}** | ${formatNumber(section.tokens)} |`

const childRow = (child: ContextSection): string => {
  const label = child.detail === undefined ? child.label : `${child.label} (${child.detail})`
  return `| ↳ ${label} | ${formatNumber(child.tokens)} |`
}

const detailRow = (detail: string): string => `| ↳ ${detail} |  |`

const buildTable = (snapshot: ContextSnapshot): string => {
  const lines = [
    `| ${t('contextView.sectionColumnHeader', snapshot.locale)} | ${t('contextView.tokensColumnHeader', snapshot.locale)} |`,
    '| ------ | ------:|',
  ]
  for (const section of snapshot.sections) {
    lines.push(topRow(section))
    if (section.children !== undefined) {
      for (const child of section.children) lines.push(childRow(child))
    }
    if (section.detail !== undefined) lines.push(detailRow(section.detail))
  }
  return lines.join('\n')
}

export const renderKonturTalkContext = (snapshot: ContextSnapshot): ContextRendered => {
  const header = buildHeader(snapshot)
  const grid = buildContextGrid(snapshot)
  const table = buildTable(snapshot)
  const footer = snapshot.approximate ? `\n\n_${t('contextView.approximateFooter', snapshot.locale)}_` : ''
  return { method: 'formatted', content: `${header}\n\n${grid}\n\n${table}${footer}` }
}
