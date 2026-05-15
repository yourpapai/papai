/// <reference lib="dom" />
import type { Turn } from '../../../src/debug/turn-assembly.js'
import { escapeHtml, formatTime } from '../helpers.js'

function scopeClass(kind: string): string {
  if (kind === 'user') return 'scope-user'
  if (kind === 'group') return 'scope-group'
  return 'scope-global'
}

function scopeIcon(kind: string): string {
  if (kind === 'user') return '\u263a'
  if (kind === 'group') return '\u263b'
  return '\u25cf'
}

function durationMs(startedAt: number, endedAt?: number): string {
  const end = endedAt ?? Date.now()
  const ms = end - startedAt
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${ms}ms`
}

function matchesContext(scope: Turn['scope'], activeContext: string): boolean {
  if (activeContext === 'all') return true
  if (activeContext === 'dm') return scope.kind === 'user'
  if (activeContext.startsWith('group:')) {
    const groupId = activeContext.slice('group:'.length)
    return scope.kind === 'group' && scope.groupId === groupId
  }
  return true
}

export function renderTurns(turns: readonly Turn[], activeContext: string): string {
  const filtered = turns.filter((t) => matchesContext(t.scope, activeContext))
  if (filtered.length === 0) {
    return '<span class="placeholder">No turns</span>'
  }

  let html = ''
  for (const turn of filtered) {
    const statusClass = `status-${turn.status}`
    const scopeCls = scopeClass(turn.scope.kind)
    const icon = scopeIcon(turn.scope.kind)
    const dur = durationMs(turn.startedAt, turn.endedAt)
    const toolCount = turn.toolCalls.length

    html += `<div class="turn-row ${statusClass}" data-turn-id="${escapeHtml(turn.turnId)}">`
    html += '<div class="turn-summary">'
    html += `<span class="turn-time">${formatTime(turn.startedAt)}</span>`
    html += `<span class="turn-scope ${scopeCls}">${icon}</span>`
    html += `<span class="turn-status ${statusClass}">${turn.status}</span>`
    html += `<span class="turn-duration">${dur}</span>`
    html += `<span class="turn-tools">${toolCount} tool${toolCount === 1 ? '' : 's'}</span>`
    html += '</div>'
    html += '</div>'
  }

  return html
}
