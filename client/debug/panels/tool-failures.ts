// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/// <reference lib="dom" />
import type { ToolFailure } from '../../../src/debug/turn-assembly.js'
import { escapeHtml, formatTime } from '../helpers.js'

function matchesContext(scope: ToolFailure['scope'], activeContext: string): boolean {
  if (activeContext === 'all') return true
  if (activeContext === 'dm') return scope.kind === 'user'
  if (activeContext.startsWith('group:')) {
    const groupId = activeContext.slice('group:'.length)
    return scope.kind === 'group' && scope.groupId === groupId
  }
  return true
}

function retriableLabel(data: Record<string, unknown>): string {
  if (data['retriable'] === true) return 'retriable'
  if (data['retriable'] === false) return 'non-retriable'
  return ''
}

export function renderToolFailures(failures: readonly ToolFailure[], activeContext: string): string {
  const filtered = failures.filter((f) => matchesContext(f.scope, activeContext))
  if (filtered.length === 0) {
    return '<span class="placeholder">No failures</span>'
  }

  let html = ''
  for (let i = 0; i < filtered.length; i++) {
    const f = filtered[i]!
    const toolName = typeof f.data['toolName'] === 'string' ? f.data['toolName'] : 'unknown'
    const error = typeof f.data['error'] === 'string' ? f.data['error'] : ''
    const retriable = retriableLabel(f.data)

    html += `<div class="failure-row" data-index="${i}">`
    html += '<div class="failure-summary">'
    html += `<span class="failure-time">${formatTime(f.timestamp)}</span>`
    html += `<span class="failure-tool">${escapeHtml(toolName)}</span>`
    html += `<span class="failure-error">${escapeHtml(error)}</span>`
    if (retriable !== '') {
      html += `<span class="failure-retriable ${retriable}">${retriable}</span>`
    }
    html += '</div>'
    html += '</div>'
  }

  return html
}
