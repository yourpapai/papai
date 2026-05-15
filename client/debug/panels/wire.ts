/// <reference lib="dom" />
import type { ToolFailure } from '../../../src/debug/schemas.js'
import { escapeHtml } from '../helpers.js'
import { renderTreeView } from '../tree-view.js'
import { renderContext } from './context.js'
import { renderMemos } from './memos.js'
import { renderNotifications } from './notifications.js'
import { renderReminders } from './reminders.js'
import { renderToolFailures } from './tool-failures.js'
import { renderTurns } from './turns.js'

function getContextChips(state: {
  turns: readonly { scope: { kind: string; groupId?: string } }[]
  notifications: readonly { scope: { kind: string; groupId?: string } }[]
  toolFailures: readonly { scope: { kind: string; groupId?: string } }[]
  activeContext: string
}): string {
  const seen = new Set<string>()
  seen.add('all')
  seen.add('dm')
  for (const turn of state.turns) {
    if (turn.scope.kind === 'group' && turn.scope.groupId !== undefined) {
      seen.add(`group:${turn.scope.groupId}`)
    }
  }
  for (const n of state.notifications) {
    if (n.scope.kind === 'group' && n.scope.groupId !== undefined) {
      seen.add(`group:${n.scope.groupId}`)
    }
  }
  for (const f of state.toolFailures) {
    if (f.scope.kind === 'group' && f.scope.groupId !== undefined) {
      seen.add(`group:${f.scope.groupId}`)
    }
  }

  let html = ''
  for (const ctx of seen) {
    const isActive = ctx === state.activeContext
    html += `<button class="chip${isActive ? ' active' : ''}" data-context="${escapeHtml(ctx)}">${escapeHtml(ctx)}</button>`
  }
  return html
}

function wireTurnModal(): {
  showTurn(turnId: string): void
} {
  const $modal = document.getElementById('turn-modal')!
  const $title = document.getElementById('turn-modal-title')!
  const $close = document.getElementById('turn-modal-close')!
  const $body = document.getElementById('turn-modal-body')!

  $close.addEventListener('click', () => {
    $modal.hidden = true
  })
  $modal.addEventListener('click', (e) => {
    if (e.target === $modal) $modal.hidden = true
  })

  return {
    showTurn(turnId: string): void {
      const turn = window.dashboard.__state.turns.find((t) => t.turnId === turnId)
      if (turn !== undefined) {
        $title.textContent = `Turn: ${turn.turnId}`
        $body.innerHTML = `<div class="tree-container">${renderTreeView(turn)}</div>`
        $modal.hidden = false
      }
    },
  }
}

function wireFailureModal(): {
  showFailure(failure: ToolFailure): void
} {
  const $modal = document.getElementById('failure-modal')!
  const $title = document.getElementById('failure-modal-title')!
  const $close = document.getElementById('failure-modal-close')!
  const $body = document.getElementById('failure-modal-body')!

  $close.addEventListener('click', () => {
    $modal.hidden = true
  })
  $modal.addEventListener('click', (e) => {
    if (e.target === $modal) $modal.hidden = true
  })

  return {
    showFailure(failure: ToolFailure): void {
      const toolName = typeof failure.data['toolName'] === 'string' ? failure.data['toolName'] : 'unknown'
      $title.textContent = `Tool Failure: ${toolName}`
      $body.innerHTML = `<div class="tree-container">${renderTreeView(failure)}</div>`
      $modal.hidden = false
    },
  }
}

function wireContextChips($chips: HTMLElement): void {
  $chips.addEventListener('click', (e: Event) => {
    const target = e.target
    if (!(target instanceof HTMLElement)) return
    if (!target.classList.contains('chip')) return
    const context = target.getAttribute('data-context')
    if (context === null) return

    for (const chip of $chips.querySelectorAll('.chip')) {
      chip.classList.remove('active')
    }
    target.classList.add('active')

    window.dashboard.__state.activeContext = context
    window.dashboard.renderTurns()
    window.dashboard.renderNotifications()
    window.dashboard.renderToolFailures()
  })
}

function getPanelElements(): {
  $contextChips: HTMLElement
  $turnCount: HTMLElement
  $turnList: HTMLElement
  $notificationCount: HTMLElement
  $notificationList: HTMLElement
  $failureCount: HTMLElement
  $failureList: HTMLElement
  $reminderCount: HTMLElement
  $reminderList: HTMLElement
  $memoCount: HTMLElement
  $memoList: HTMLElement
  $memoSearch: HTMLInputElement | null
  $contextDetail: HTMLElement
} {
  const memoSearchEl = document.getElementById('memo-search')
  return {
    $contextChips: document.getElementById('context-chips')!,
    $turnCount: document.getElementById('turn-count')!,
    $turnList: document.getElementById('turn-list')!,
    $notificationCount: document.getElementById('notification-count')!,
    $notificationList: document.getElementById('notification-list')!,
    $failureCount: document.getElementById('failure-count')!,
    $failureList: document.getElementById('failure-list')!,
    $reminderCount: document.getElementById('reminder-count')!,
    $reminderList: document.getElementById('reminder-list')!,
    $memoCount: document.getElementById('memo-count')!,
    $memoList: document.getElementById('memo-list')!,
    $memoSearch: memoSearchEl instanceof HTMLInputElement ? memoSearchEl : null,
    $contextDetail: document.getElementById('context-detail')!,
  }
}

function createRenderTurnsPanel(
  elements: ReturnType<typeof getPanelElements>,
  turnModal: ReturnType<typeof wireTurnModal>,
): () => void {
  return (): void => {
    const state = window.dashboard.__state
    if (state === undefined) return
    elements.$turnCount.textContent = String(state.turns.length)
    elements.$turnList.innerHTML = renderTurns(state.turns, state.activeContext)

    for (const row of elements.$turnList.querySelectorAll('.turn-row')) {
      row.addEventListener('click', (e: Event) => {
        const target = e.target
        if (target instanceof HTMLElement && target.classList.contains('turn-log-link')) {
          e.stopPropagation()
          const turnId = target.getAttribute('data-turn-id')
          if (turnId !== null) {
            state.activeLogFilter.turnId = turnId
            const badge = document.getElementById('log-turnid-badge')
            const label = document.getElementById('log-turnid-label')
            if (badge !== null && label !== null) {
              label.textContent = `turn:${turnId.slice(0, 8)}`
              badge.hidden = false
            }
            window.dashboard.renderLogs()
            document.getElementById('log-explorer')?.scrollIntoView({ behavior: 'smooth' })
          }
          return
        }
        const turnId = row.getAttribute('data-turn-id')
        if (turnId !== null) turnModal.showTurn(turnId)
      })
    }

    elements.$contextChips.innerHTML = getContextChips(state)
  }
}

function createRenderNotificationsPanel(elements: ReturnType<typeof getPanelElements>): () => void {
  return (): void => {
    const state = window.dashboard.__state
    if (state === undefined) return
    elements.$notificationCount.textContent = String(state.notifications.length)
    elements.$notificationList.innerHTML = renderNotifications(state.notifications, state.activeContext)
  }
}

function createRenderToolFailuresPanel(
  elements: ReturnType<typeof getPanelElements>,
  failureModal: ReturnType<typeof wireFailureModal>,
): () => void {
  return (): void => {
    const state = window.dashboard.__state
    if (state === undefined) return
    elements.$failureCount.textContent = String(state.toolFailures.length)
    elements.$failureList.innerHTML = renderToolFailures(state.toolFailures, state.activeContext)

    for (const row of elements.$failureList.querySelectorAll('.failure-row')) {
      row.addEventListener('click', () => {
        const index = Number(row.getAttribute('data-index'))
        const filtered = state.toolFailures.filter((f) => {
          if (state.activeContext === 'all') return true
          if (state.activeContext === 'dm') return f.scope.kind === 'user'
          return true
        })
        const failure = filtered[index]
        if (failure !== undefined) failureModal.showFailure(failure)
      })
    }
  }
}

function createRenderRemindersPanel(elements: ReturnType<typeof getPanelElements>): () => void {
  return (): void => {
    const state = window.dashboard.__state
    if (state === undefined) return
    const totalCount = state.recurringTasks.length + state.deferredPrompts.length
    elements.$reminderCount.textContent = String(totalCount)
    elements.$reminderList.innerHTML = renderReminders(state.recurringTasks, state.deferredPrompts, state.activeContext)
  }
}

function createRenderMemosPanel(
  elements: ReturnType<typeof getPanelElements>,
  getMemoSearchQuery: () => string,
): () => void {
  return (): void => {
    const state = window.dashboard.__state
    if (state === undefined) return
    elements.$memoCount.textContent = String(state.memos.length)
    elements.$memoList.innerHTML = renderMemos(state.memos, getMemoSearchQuery())
  }
}

function createRenderContextPanel(elements: ReturnType<typeof getPanelElements>): () => void {
  return (): void => {
    const state = window.dashboard.__state
    if (state === undefined) return
    elements.$contextDetail.innerHTML = renderContext(
      state.identityMappings,
      state.activeConfigEditors,
      state.wizards,
      state.authorizedGroups,
    )
  }
}

export function wirePanelElements(): {
  renderTurnsPanel(): void
  renderNotificationsPanel(): void
  renderToolFailuresPanel(): void
  renderRemindersPanel(): void
  renderMemosPanel(): void
  renderContextPanel(): void
  updateContextChips(): void
} {
  const elements = getPanelElements()
  const turnModal = wireTurnModal()
  const failureModal = wireFailureModal()
  wireContextChips(elements.$contextChips)

  let memoSearchQuery = ''

  if (elements.$memoSearch !== null) {
    elements.$memoSearch.addEventListener('input', () => {
      memoSearchQuery = elements.$memoSearch!.value
      window.dashboard.renderMemos()
    })
  }

  return {
    renderTurnsPanel: createRenderTurnsPanel(elements, turnModal),
    renderNotificationsPanel: createRenderNotificationsPanel(elements),
    renderToolFailuresPanel: createRenderToolFailuresPanel(elements, failureModal),
    renderRemindersPanel: createRenderRemindersPanel(elements),
    renderMemosPanel: createRenderMemosPanel(elements, () => memoSearchQuery),
    renderContextPanel: createRenderContextPanel(elements),
    updateContextChips(): void {
      const state = window.dashboard.__state
      if (state === undefined) return
      elements.$contextChips.innerHTML = getContextChips(state)
    },
  }
}
