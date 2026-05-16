// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/// <reference lib="dom" />
import type { IdentityMappingEntry, AuthorizedGroupEntry } from '../dashboard-types.js'
import { escapeHtml } from '../helpers.js'

function renderIdentitySection(mappings: Map<string, IdentityMappingEntry>): string {
  if (mappings.size === 0) {
    return '<span class="placeholder">No identity mappings</span>'
  }

  let html = '<div class="context-section">'
  for (const [userId, m] of mappings) {
    html += '<div class="context-item">'
    html += `<span class="context-key">${escapeHtml(userId)}</span>`
    html += `<span class="context-value">${escapeHtml(m.provider)} \u2192 ${escapeHtml(m.providerUserId ?? 'unmatched')}</span>`
    if (m.displayName !== null) {
      html += `<span class="context-meta">${escapeHtml(m.displayName)}</span>`
    }
    html += '</div>'
  }
  html += '</div>'
  return html
}

function renderEditorsSection(
  editors: Set<string>,
  wizards: Map<string, { currentStep: number | '---'; totalSteps: number | '---' }>,
): string {
  if (editors.size === 0 && wizards.size === 0) {
    return '<span class="placeholder">No active sessions</span>'
  }

  let html = '<div class="context-section">'
  for (const userId of editors) {
    html += '<div class="context-item">'
    html += `<span class="context-key">${escapeHtml(userId)}</span>`
    html += '<span class="context-value">config-editor active</span>'
    html += '</div>'
  }
  for (const [userId, w] of wizards) {
    html += '<div class="context-item">'
    html += `<span class="context-key">${escapeHtml(userId)}</span>`
    html += `<span class="context-value">wizard step ${w.currentStep}/${w.totalSteps}</span>`
    html += '</div>'
  }
  html += '</div>'
  return html
}

function renderAuthSection(groups: readonly AuthorizedGroupEntry[]): string {
  if (groups.length === 0) {
    return '<span class="placeholder">No authorized groups</span>'
  }

  let html = '<div class="context-section">'
  for (const g of groups) {
    html += '<div class="context-item">'
    html += `<span class="context-key">${escapeHtml(g.group_id)}</span>`
    html += `<span class="context-meta">by ${escapeHtml(g.added_by)}</span>`
    html += '</div>'
  }
  html += '</div>'
  return html
}

export function renderContext(
  identityMappings: Map<string, IdentityMappingEntry>,
  activeConfigEditors: Set<string>,
  wizards: Map<string, { currentStep: number | '---'; totalSteps: number | '---' }>,
  authorizedGroups: readonly AuthorizedGroupEntry[],
): string {
  let html = '<div class="context-panel-sections">'

  html += '<div class="context-panel-section">'
  html += '<h3>Identity Mappings</h3>'
  html += renderIdentitySection(identityMappings)
  html += '</div>'

  html += '<div class="context-panel-section">'
  html += '<h3>Config Editor / Wizard</h3>'
  html += renderEditorsSection(activeConfigEditors, wizards)
  html += '</div>'

  html += '<div class="context-panel-section">'
  html += '<h3>Authorized Groups</h3>'
  html += renderAuthSection(authorizedGroups)
  html += '</div>'

  html += '</div>'
  return html
}
