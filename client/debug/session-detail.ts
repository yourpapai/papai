// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { escapeHtml, formatTime } from './helpers.js'
import { renderTreeView } from './tree-view.js'
import type { SessionDetail } from './types.js'

function tryParseStructured(content: string): unknown {
  const trimmed = content.trim()
  if (trimmed === '') return undefined
  const first = trimmed[0]
  if (first !== '{' && first !== '[') return undefined
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return undefined
  }
}

function renderHistoryContent(content: string): string {
  const parsed = tryParseStructured(content)
  if (parsed !== undefined) {
    return `<div class="history-content json"><pre class="tree-container">${renderTreeView(parsed)}</pre></div>`
  }
  return `<div class="history-content">${escapeHtml(content)}</div>`
}

type SessionModalElements = {
  $sessionModal: HTMLElement
  $sessionModalTitle: HTMLElement
  $sessionModalBody: HTMLElement
  $sessionModalClose: HTMLElement
}

// DOM elements for session modal
export function getSessionModalElements(): SessionModalElements {
  return {
    $sessionModal: document.getElementById('session-modal')!,
    $sessionModalTitle: document.getElementById('session-modal-title')!,
    $sessionModalBody: document.getElementById('session-modal-body')!,
    $sessionModalClose: document.getElementById('session-modal-close')!,
  }
}

function renderBasicInfo(userId: string, session: SessionDetail): string {
  const hasTools = session.hasTools !== undefined && session.hasTools
  const workspaceValue = session.workspaceId === null ? 'none' : escapeHtml(session.workspaceId)

  return `<div class="session-detail-section">
    <h4>Basic Info</h4>
    <div class="session-detail-grid">
      <div class="session-detail-item"><div class="label">User ID</div><div class="value">${escapeHtml(userId)}</div></div>
      <div class="session-detail-item"><div class="label">Last Accessed</div><div class="value">${formatTime(session.lastAccessed)}</div></div>
      <div class="session-detail-item"><div class="label">History Length</div><div class="value">${session.historyLength} messages</div></div>
      <div class="session-detail-item"><div class="label">Workspace</div><div class="value ${session.workspaceId === null ? 'null' : ''}">${workspaceValue}</div></div>
      <div class="session-detail-item"><div class="label">Has Tools</div><div class="value">${hasTools ? 'yes' : 'no'}</div></div>
    </div>
  </div>`
}

function renderSummarySection(summary: string | null): string {
  if (summary === null || summary === '') return ''

  return `<div class="session-detail-section">
    <h4>Summary</h4>
    <pre class="generated-text">${escapeHtml(summary)}</pre>
  </div>`
}

function renderConfigSection(config: Record<string, string | null> | undefined): string {
  if (config === undefined || Object.keys(config).length === 0) return ''

  let rows = ''
  for (const [key, value] of Object.entries(config)) {
    const displayValue = value === null ? 'null' : escapeHtml(value)
    rows += `<tr><td>${escapeHtml(key)}</td><td class="value ${value === null ? 'null' : ''}">${displayValue}</td></tr>`
  }

  return `<div class="session-detail-section">
    <h4>Configuration</h4>
    <table class="config-table"><thead><tr><th>Key</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table>
  </div>`
}

function renderFactsSection(facts: SessionDetail['facts']): string {
  if (facts === undefined || facts.length === 0) return ''

  let items = ''
  for (const fact of facts) {
    items += `<div class="tool-call-item">
      <div class="tool-call-summary">
        <span class="tool-name">${escapeHtml(fact.title)}</span>
        <span class="tool-id">${escapeHtml(fact.identifier)}</span>
      </div>
      <div class="tool-call-id">${escapeHtml(fact.url)}</div>
      <div class="tool-section"><div class="label">Last seen</div><div class="value">${formatTime(fact.lastSeen)}</div></div>
    </div>`
  }

  return `<div class="session-detail-section">
    <h4>Facts (${facts.length})</h4>
    <div class="tool-calls-list">${items}</div>
  </div>`
}

function renderInstructionsSection(instructions: SessionDetail['instructions']): string {
  if (instructions === undefined || instructions === null || instructions.length === 0) return ''

  let items = ''
  for (const instruction of instructions) {
    items += `<div class="instruction-item">
      <div class="instruction-text">${escapeHtml(instruction.text)}</div>
      <div class="instruction-meta">ID: ${escapeHtml(instruction.id)} · Created: ${formatTime(instruction.createdAt)}</div>
    </div>`
  }

  return `<div class="session-detail-section">
    <h4>Instructions (${instructions.length})</h4>
    <div class="instructions-list">${items}</div>
  </div>`
}

function renderHistorySection(history: SessionDetail['history']): string {
  if (history === undefined || history.length === 0) return ''

  let items = ''
  for (const msg of history) {
    const role = msg.role ?? 'unknown'
    const toolCallMeta =
      msg.tool_call_id === undefined
        ? ''
        : `<div class="history-meta">Tool call ID: ${escapeHtml(msg.tool_call_id)}</div>`
    items += `<div class="history-item ${escapeHtml(role)}">
      <div class="history-role">${escapeHtml(role)}</div>
      ${renderHistoryContent(msg.content)}
      ${toolCallMeta}
    </div>`
  }

  return `<div class="session-detail-section">
    <h4>Conversation History (${history.length} messages)</h4>
    <div class="history-list">${items}</div>
  </div>`
}

export function renderSessionDetail(
  userId: string,
  session: SessionDetail,
  elements: ReturnType<typeof getSessionModalElements>,
): void {
  const { $sessionModal, $sessionModalTitle, $sessionModalBody } = elements

  $sessionModalTitle.textContent = `Session: ${escapeHtml(userId)}`

  let html = ''
  html += renderBasicInfo(userId, session)
  html += renderSummarySection(session.summary)
  html += renderConfigSection(session.config)
  html += renderFactsSection(session.facts)
  html += renderInstructionsSection(session.instructions)
  html += renderHistorySection(session.history)

  $sessionModalBody.innerHTML = html
  $sessionModal.hidden = false
}
