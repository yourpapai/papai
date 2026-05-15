/// <reference lib="dom" />
import { escapeHtml, formatTime } from '../helpers.js'

interface Memo {
  id: string
  userId: string
  content: string
  summary: string | null
  tags: readonly string[]
  status: string
  createdAt: string
  updatedAt: string
}

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + '...'
}

export function renderMemos(memos: readonly Memo[], searchQuery: string): string {
  const query = searchQuery.toLowerCase().trim()
  const filtered =
    query === ''
      ? memos
      : memos.filter(
          (m) =>
            m.content.toLowerCase().includes(query) ||
            (m.summary !== null && m.summary.toLowerCase().includes(query)) ||
            m.tags.some((t) => t.toLowerCase().includes(query)),
        )

  if (filtered.length === 0) {
    return '<span class="placeholder">No memos</span>'
  }

  let html = ''
  for (const memo of filtered) {
    const preview = truncateText(memo.content, 120)
    const tags =
      memo.tags.length > 0 ? `<span class="memo-tags">${memo.tags.map((t) => escapeHtml(t)).join(', ')}</span>` : ''

    html += `<div class="memo-row" data-memo-id="${escapeHtml(memo.id)}">`
    html += '<div class="memo-summary">'
    html += `<span class="memo-time">${formatTime(memo.createdAt)}</span>`
    html += `<span class="memo-content">${escapeHtml(preview)}</span>`
    html += tags
    html += '</div>'
    html += '</div>'
  }
  return html
}
