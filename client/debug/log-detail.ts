// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { LogEntry } from '../../src/debug/schemas.js'
import { escapeHtml, formatTime, levelClass, levelName } from './helpers.js'
import { renderPropertiesTree } from './tree-view.js'

export function renderLogDetailHTML(entry: LogEntry, _index: number): string {
  let html = '<div class="log-detail-meta">'
  html += `<div class="log-detail-meta-item"><div class="label">Time</div><div class="value">${formatTime(entry.time)}</div></div>`
  html += `<div class="log-detail-meta-item"><div class="label">Level</div><div class="value ${levelClass(entry.level)}">${levelName(entry.level)} (${entry.level})</div></div>`
  const scopeValue = entry.scope === undefined ? 'none' : escapeHtml(entry.scope)
  html += `<div class="log-detail-meta-item"><div class="label">Scope</div><div class="value">${scopeValue}</div></div>`
  html += '</div>'

  html += '<div class="log-detail-section">'
  html += '<h4>Message</h4>'
  html += `<pre style="background:#131313;padding:12px;border-radius:2px;white-space:pre-wrap;word-break:break-word;font-size:11px;color:#cccccc;">${escapeHtml(entry.msg)}</pre>`
  html += '</div>'

  const standardFields = new Set(['time', 'level', 'msg', 'scope'])
  const extraProps: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(entry)) {
    if (!standardFields.has(key)) {
      extraProps[key] = value
    }
  }

  if (Object.keys(extraProps).length > 0) {
    html += '<div class="log-detail-section">'
    html += '<h4>Properties</h4>'
    html += renderPropertiesTree(extraProps)
    html += '</div>'
  }

  return html
}

export function renderLogDetailTitle(index: number): string {
  return `Log Entry #${index + 1}`
}
