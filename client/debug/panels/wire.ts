/// <reference lib="dom" />
import type { ToolFailure } from '../../../src/debug/schemas.js'
import { escapeHtml } from '../helpers.js'
import { renderTreeView } from '../tree-view.js'
import { renderNotifications } from './notifications.js'
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

export function wirePanelElements(): {
  renderTurnsPanel(): void
  renderNotificationsPanel(): void
  renderToolFailuresPanel(): void
  updateContextChips(): void
} {
  const $contextChips = document.getElementById('context-chips')!
  const $turnCount = document.getElementById('turn-count')!
  const $turnList = document.getElementById('turn-list')!
  const $notificationCount = document.getElementById('notification-count')!
  const $notificationList = document.getElementById('notification-list')!
  const $failureCount = document.getElementById('failure-count')!
  const $failureList = document.getElementById('failure-list')!

  const turnModal = wireTurnModal()
  const failureModal = wireFailureModal()
  wireContextChips($contextChips)

  return {
    renderTurnsPanel(): void {
      const state = window.dashboard.__state
      if (state === undefined) return
      $turnCount.textContent = String(state.turns.length)
      $turnList.innerHTML = renderTurns(state.turns, state.activeContext)

      for (const row of $turnList.querySelectorAll('.turn-row')) {
        row.addEventListener('click', () => {
          const turnId = row.getAttribute('data-turn-id')
          if (turnId !== null) turnModal.showTurn(turnId)
        })
      }

      $contextChips.innerHTML = getContextChips(state)
    },

    renderNotificationsPanel(): void {
      const state = window.dashboard.__state
      if (state === undefined) return
      $notificationCount.textContent = String(state.notifications.length)
      $notificationList.innerHTML = renderNotifications(state.notifications, state.activeContext)
    },

    renderToolFailuresPanel(): void {
      const state = window.dashboard.__state
      if (state === undefined) return
      $failureCount.textContent = String(state.toolFailures.length)
      $failureList.innerHTML = renderToolFailures(state.toolFailures, state.activeContext)

      for (const row of $failureList.querySelectorAll('.failure-row')) {
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
    },

    updateContextChips(): void {
      const state = window.dashboard.__state
      if (state === undefined) return
      $contextChips.innerHTML = getContextChips(state)
    },
  }
}
