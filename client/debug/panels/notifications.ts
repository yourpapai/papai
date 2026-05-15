/// <reference lib="dom" />
import type { Notification } from '../../../src/debug/turn-assembly.js'
import { escapeHtml, formatTime } from '../helpers.js'

function matchesContext(scope: Notification['scope'], activeContext: string): boolean {
  if (activeContext === 'all') return true
  if (activeContext === 'dm') return scope.kind === 'user'
  if (activeContext.startsWith('group:')) {
    const groupId = activeContext.slice('group:'.length)
    return scope.kind === 'group' && scope.groupId === groupId
  }
  return true
}

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + '...'
}

function renderNotificationText(n: Notification): string {
  const data = n.data
  if (n.type === 'reply:sent' && typeof data['text'] === 'string') {
    return escapeHtml(truncateText(data['text'], 120))
  }
  if (n.type === 'typing:start' || n.type === 'typing:stop') {
    return ''
  }
  if (Object.keys(data).length > 0) {
    const preview = JSON.stringify(data)
    return escapeHtml(truncateText(preview, 100))
  }
  return ''
}

export function renderNotifications(notifications: readonly Notification[], activeContext: string): string {
  const filtered = notifications.filter((n) => matchesContext(n.scope, activeContext))
  if (filtered.length === 0) {
    return '<span class="placeholder">No notifications</span>'
  }

  let html = ''
  for (const n of filtered) {
    html += '<div class="notification-row">'
    html += `<span class="notification-time">${formatTime(n.timestamp)}</span>`
    html += `<span class="notification-type">${escapeHtml(n.type)}</span>`
    const text = renderNotificationText(n)
    if (text !== '') {
      html += `<span class="notification-text">${text}</span>`
    }
    html += '</div>'
  }

  return html
}
