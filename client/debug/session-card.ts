// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { escapeHtml } from './helpers.js'
import type { SessionDetail } from './types.js'

export function buildSessionCard(
  userId: string,
  s: SessionDetail,
  wizards: Map<string, { currentStep: number | string; totalSteps: number | string }>,
): string {
  const wiz = wizards.get(userId)
  const isActive = Date.now() - s.lastAccessed < 300000
  let html = `<div class="session-card ${isActive ? 'active' : ''}" data-userid="${escapeHtml(userId)}">`
  html += `<div class="user-id">${escapeHtml(userId)}</div>`
  html += `<div class="session-detail">history: ${s.historyLength} \u00b7 facts: ${s.factsCount} \u00b7 summary: ${s.summary === null ? 'no' : 'yes'}</div>`
  if (s.configKeys?.length > 0) {
    html += `<div class="session-detail">config: ${s.configKeys.length} keys</div>`
  }
  if (s.workspaceId !== null && s.workspaceId !== undefined) {
    html += `<div class="session-detail">workspace: ${escapeHtml(s.workspaceId)}</div>`
  }
  if (wiz !== undefined) {
    html += `<div class="wizard-badge">\uD83E\uDDD9 wizard step ${wiz.currentStep}/${wiz.totalSteps}</div>`
  }
  html += '</div>'
  return html
}
