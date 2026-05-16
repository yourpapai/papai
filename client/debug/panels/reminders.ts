// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/// <reference lib="dom" />
import { escapeHtml, formatTime } from '../helpers.js'

interface RecurringTask {
  id: string
  userId: string
  title: string
  rrule: string | null
  nextRun: string | null
  enabled: boolean
  lastRun: string | null
}

interface DeferredPrompt {
  id: string
  createdByUserId: string
  prompt: string
  fireAt: string
  rrule: string | null
  status: string
}

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + '...'
}

function renderRecurringTask(task: RecurringTask): string {
  const statusClass = task.enabled ? 'status-active' : 'status-paused'
  const statusLabel = task.enabled ? 'active' : 'paused'
  const schedule = task.rrule ?? 'one-shot'
  const nextFire = task.nextRun === null ? '---' : formatTime(task.nextRun)

  let html = '<div class="reminder-row">'
  html += '<div class="reminder-summary">'
  html += `<span class="reminder-name">${escapeHtml(task.title)}</span>`
  html += `<span class="reminder-schedule">${escapeHtml(schedule)}</span>`
  html += `<span class="reminder-next">${nextFire}</span>`
  html += `<span class="reminder-status ${statusClass}">${statusLabel}</span>`
  html += '</div>'
  html += '</div>'
  return html
}

function renderDeferredPrompt(prompt: DeferredPrompt): string {
  const preview = truncateText(prompt.prompt, 80)
  const nextFire = formatTime(prompt.fireAt)

  let html = '<div class="reminder-row deferred">'
  html += '<div class="reminder-summary">'
  html += `<span class="reminder-type">deferred</span>`
  html += `<span class="reminder-prompt">${escapeHtml(preview)}</span>`
  html += `<span class="reminder-next">${nextFire}</span>`
  html += '</div>'
  html += '</div>'
  return html
}

export function renderReminders(
  recurringTasks: readonly RecurringTask[],
  deferredPrompts: readonly DeferredPrompt[],
  activeContext: string,
): string {
  const filteredRecurring = recurringTasks.filter((_t) => {
    if (activeContext === 'all') return true
    if (activeContext === 'dm') return true
    return true
  })

  const filteredDeferred = deferredPrompts.filter((_p) => {
    if (activeContext === 'all') return true
    if (activeContext === 'dm') return true
    return true
  })

  if (filteredRecurring.length === 0 && filteredDeferred.length === 0) {
    return '<span class="placeholder">No reminders</span>'
  }

  let html = ''
  for (const task of filteredRecurring) {
    html += renderRecurringTask(task)
  }
  for (const prompt of filteredDeferred) {
    html += renderDeferredPrompt(prompt)
  }
  return html
}
