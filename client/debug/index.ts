// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/// <reference lib="dom" />

// Single entry point for the debug dashboard client.
// Import order matters — each module has side effects.

// 1. Dashboard API setup (creates window.dashboard with render functions)
import './dashboard-api.js'
// 2. State management (sets window.dashboard.state, clearLogs, uptime ticker)
import './state.js'
// 4. Bootstrap (fetches initial logs, sets up SSE — must be last)
import './init.js'

// 3. Tree view toggle handler (moved from inline HTML script)
document.addEventListener('click', (e: Event) => {
  const target = e.target
  if (!(target instanceof HTMLElement)) return
  if (!target.classList.contains('tree-toggle')) return

  const targetId = target.getAttribute('data-target')
  if (targetId === null) return
  const children = document.getElementById(targetId)
  if (children === null) return

  children.classList.toggle('collapsed')
  target.classList.toggle('collapsed')
  target.textContent = children.classList.contains('collapsed') ? '\u25b6' : '\u25bc'
})
