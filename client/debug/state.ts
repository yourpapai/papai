/// <reference lib="dom" />
import type { DashboardState } from './dashboard-types.js'

export const LOG_CAP = 65535

export const state: DashboardState = {
  connected: false,
  stats: { startedAt: Date.now(), totalMessages: 0, totalLlmCalls: 0, totalToolCalls: 0 },
  sessions: new Map(),
  wizards: new Map(),
  scheduler: {},
  pollers: {},
  messageCache: {},
  llmTraces: [],
  logs: [],
  logScopes: new Set(),
  turns: [],
  notifications: [],
  toolFailures: [],
  activeContext: 'all',
  activeLogFilter: {},
}

// Expose state for renderLogs() to access
window.dashboard.__state = state

export function renderAll(): void {
  const dash = window.dashboard
  dash.renderConnection(state.connected)
  dash.renderStats(state.stats)
  dash.renderInfra(state.scheduler, state.pollers, state.messageCache)
  dash.renderSessions(state.sessions, state.wizards)
  dash.renderTraces(state.llmTraces)
  dash.renderLogs()
  dash.renderTurns()
  dash.renderNotifications()
  dash.renderToolFailures()
}

// --- Clear logs (called from UI) ---

window.dashboard.clearLogs = (): void => {
  state.logs.length = 0
  state.logScopes.clear()
  window.dashboard.updateScopeFilter(state.logScopes)
  window.dashboard.renderLogs()
}

// --- Uptime ticker ---

setInterval(() => {
  if (state.connected) window.dashboard.renderStats(state.stats)
}, 10000)
