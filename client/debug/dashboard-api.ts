/// <reference lib="dom" />
import type { LogEntry, LlmTrace } from '../../src/debug/schemas.js'
import type { DashboardAPI } from './dashboard-types.js'
import { escapeHtml, formatTime, formatTokens, formatUptime } from './helpers.js'
import { renderLogDetailHTML, renderLogDetailTitle } from './log-detail.js'
import { filterLogs, getLogFilterElements, getLogModalElements, renderLogEntry, updateFuseIndex } from './logs.js'
import { wirePanelElements } from './panels/wire.js'
import { buildSessionCard } from './session-card.js'
import { getSessionModalElements, renderSessionDetail } from './session-detail.js'
import { getTraceModalElements, renderTraceDetail } from './trace-detail.js'
import type { SessionDetail } from './types.js'

const noop = (): void => {}

const dashboard: DashboardAPI = {
  renderConnection: noop,
  renderStats: noop,
  renderInfra: noop,
  renderSessions: noop,
  renderTraces: noop,
  renderLogs: noop,
  renderTurns: noop,
  renderNotifications: noop,
  renderToolFailures: noop,
  updateScopeFilter: noop,
  clearLogs: noop,
  __state: {
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
  },
}

const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined'

if (isBrowser && typeof window.dashboard === 'undefined') {
  window.dashboard = dashboard
}

if (isBrowser) {
  const $connStatus = document.getElementById('connection-status')!
  const $uptime = document.getElementById('uptime')!
  const $statMessages = document.getElementById('stat-messages')!
  const $statLlm = document.getElementById('stat-llm')!
  const $statTools = document.getElementById('stat-tools')!
  const $infraScheduler = document.getElementById('infra-scheduler')!
  const $infraPollers = document.getElementById('infra-pollers')!
  const $infraMsgcache = document.getElementById('infra-msgcache')!
  const $sessionCount = document.getElementById('session-count')!
  const $sessionList = document.getElementById('session-list')!
  const $traceCount = document.getElementById('trace-count')!
  const $traceList = document.getElementById('trace-list')!
  const $logCount = document.getElementById('log-count')!
  const $logEntries = document.getElementById('log-entries')!

  const logElements = getLogFilterElements()
  const sessionElements = getSessionModalElements()
  const logModalElements = getLogModalElements()
  const traceModalElements = getTraceModalElements()
  const panelApi = wirePanelElements()

  let autoScroll = true

  $logEntries.addEventListener('scroll', () => {
    const { scrollTop, scrollHeight, clientHeight } = $logEntries
    autoScroll = scrollHeight - scrollTop - clientHeight < 50
    logElements.$logAutoscroll.hidden = autoScroll
  })

  logElements.$logAutoscroll.addEventListener('click', () => {
    autoScroll = true
    logElements.$logAutoscroll.hidden = true
    $logEntries.scrollTop = $logEntries.scrollHeight
  })

  logElements.$logLevelFilter.addEventListener('change', () => {
    window.dashboard.renderLogs()
  })
  logElements.$logScopeFilter.addEventListener('change', () => {
    window.dashboard.renderLogs()
  })
  logElements.$logSearch.addEventListener('input', () => {
    window.dashboard.renderLogs()
  })
  logElements.$logClear.addEventListener('click', () => {
    window.dashboard.clearLogs()
  })

  sessionElements.$sessionModalClose.addEventListener('click', () => {
    sessionElements.$sessionModal.hidden = true
  })
  sessionElements.$sessionModal.addEventListener('click', (e) => {
    if (e.target === sessionElements.$sessionModal) sessionElements.$sessionModal.hidden = true
  })
  logModalElements.$logModalClose.addEventListener('click', () => {
    logModalElements.$logModal.hidden = true
  })
  logModalElements.$logModal.addEventListener('click', (e) => {
    if (e.target === logModalElements.$logModal) logModalElements.$logModal.hidden = true
  })
  traceModalElements.$traceModalClose.addEventListener('click', () => {
    traceModalElements.$traceModal.hidden = true
  })
  traceModalElements.$traceModal.addEventListener('click', (e) => {
    if (e.target === traceModalElements.$traceModal) traceModalElements.$traceModal.hidden = true
  })

  $traceList.addEventListener('click', (e: Event) => {
    const target = e.target
    if (!(target instanceof HTMLElement)) return
    const row = target.closest('.trace-row')
    if (row === null) return
    const traceId = row.getAttribute('data-trace-id')
    if (traceId === null) return

    const trace = window.dashboard.__state.llmTraces.find((t: LlmTrace) => String(t.timestamp) === traceId)
    if (trace !== undefined) {
      renderTraceDetail(trace, traceModalElements)
    }
  })

  window.dashboard.renderConnection = (connected: boolean): void => {
    $connStatus.textContent = connected ? '\u25cf connected' : '\u25cf disconnected'
    $connStatus.className = `status-dot ${connected ? 'connected' : 'disconnected'}`
  }

  window.dashboard.renderStats = (stats): void => {
    $uptime.textContent = `uptime ${formatUptime(stats.startedAt)}`
    $statMessages.textContent = `msgs: ${stats.totalMessages}`
    $statLlm.textContent = `llm: ${stats.totalLlmCalls}`
    $statTools.textContent = `tools: ${stats.totalToolCalls}`
  }

  window.dashboard.renderInfra = (scheduler, pollers, messageCache): void => {
    const sched = scheduler ?? {}
    const isRunning = sched.running !== undefined && sched.running
    const tickPart = sched.tickCount === undefined ? '' : ` (tick #${sched.tickCount})`
    $infraScheduler.textContent = `scheduler: ${isRunning ? 'running' : 'stopped'}${tickPart}`

    const poll = pollers ?? {}
    const sDot = poll.scheduledRunning !== undefined && poll.scheduledRunning ? '\u25cf' : '\u25cb'
    const aDot = poll.alertsRunning !== undefined && poll.alertsRunning ? '\u25cf' : '\u25cb'
    $infraPollers.textContent = `pollers: scheduled ${sDot}  alerts ${aDot}`

    const mc = messageCache ?? {}
    $infraMsgcache.textContent = `msg-cache: ${mc.size ?? 0} entries, ${mc.pendingWrites ?? 0} pending`
  }

  window.dashboard.renderSessions = (sessions, wizards): void => {
    $sessionCount.textContent = String(sessions.size)
    let html = ''
    for (const [userId, s] of sessions) {
      html += buildSessionCard(userId, s as SessionDetail, wizards)
    }
    $sessionList.innerHTML = html

    for (const card of $sessionList.querySelectorAll('.session-card')) {
      card.addEventListener('click', () => {
        const userId = card.getAttribute('data-userid')
        if (userId !== null) {
          const session = sessions.get(userId)
          if (session !== undefined) {
            renderSessionDetail(userId, session as SessionDetail, sessionElements)
          }
        }
      })
    }
  }

  window.dashboard.renderTraces = (traces): void => {
    $traceCount.textContent = String(traces.length)
    let html = ''
    for (const t of traces) {
      const isError = t.error !== undefined && t.error !== ''
      html += `<div class="trace-row ${isError ? 'error' : ''}" data-trace-id="${t.timestamp}">`
      html += '<div class="trace-summary">'
      html += `<span class="trace-time">${formatTime(t.timestamp)}</span>`
      html += `<span class="trace-user">${escapeHtml(t.userId)}</span>`
      html += `<span class="trace-model">${escapeHtml(t.model)}</span>`
      html += `<span class="trace-duration">${(t.duration / 1000).toFixed(1)}s</span>`
      html += `<span>${t.steps} steps \u00b7 ${formatTokens(t.totalTokens?.inputTokens ?? 0)}\u2193</span>`
      html += '</div>'
      html += '</div>'
    }
    $traceList.innerHTML = html
  }

  const renderLogDetail = (entry: LogEntry, index: number): void => {
    logModalElements.$logModalTitle.textContent = renderLogDetailTitle(index)
    logModalElements.$logModalBody.innerHTML = renderLogDetailHTML(entry, index)
    logModalElements.$logModal.hidden = false
  }

  let fuseInstance: ReturnType<typeof updateFuseIndex> = null

  window.dashboard.renderLogs = (): void => {
    const state = window.dashboard.__state
    if (state === undefined) return

    const minLevel = Number(logElements.$logLevelFilter.value)
    const scope = logElements.$logScopeFilter.value
    const query = logElements.$logSearch.value.trim()

    fuseInstance = updateFuseIndex(state.logs)
    const filtered = filterLogs(state.logs, minLevel, scope, query, fuseInstance)

    $logCount.textContent = String(filtered.length)

    let html = ''
    for (const entry of filtered) {
      html += renderLogEntry(entry)
    }
    $logEntries.innerHTML = html

    const entries = $logEntries.querySelectorAll('.log-entry')
    for (let i = 0; i < entries.length; i++) {
      const entryEl = entries[i]
      if (entryEl === undefined) continue
      const filteredEntry = filtered[i]
      if (filteredEntry === undefined) continue
      const entryIndex = state.logs.indexOf(filteredEntry)
      if (entryIndex >= 0) {
        entryEl.addEventListener('click', () => {
          renderLogDetail(filteredEntry, entryIndex)
        })
      }
    }

    if (autoScroll) {
      $logEntries.scrollTop = $logEntries.scrollHeight
    }
  }

  window.dashboard.updateScopeFilter = (scopes): void => {
    const current = logElements.$logScopeFilter.value
    let html = '<option value="">all scopes</option>'
    for (const s of [...scopes].sort()) {
      html += `<option value="${escapeHtml(s)}"${s === current ? ' selected' : ''}>${escapeHtml(s)}</option>`
    }
    logElements.$logScopeFilter.innerHTML = html
  }

  window.dashboard.renderTurns = panelApi.renderTurnsPanel
  window.dashboard.renderNotifications = panelApi.renderNotificationsPanel
  window.dashboard.renderToolFailures = panelApi.renderToolFailuresPanel
}
