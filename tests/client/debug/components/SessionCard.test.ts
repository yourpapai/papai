// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import SessionCard from '../../../../client/debug/components/SessionCard.svelte'
import type { Session } from '../../../../client/debug/dashboard-types.js'

function baseSession(overrides: Partial<Session> = {}): Session {
  return {
    userId: 'u1',
    lastAccessed: Date.now(),
    historyLength: 3,
    factsCount: 2,
    summary: null,
    configKeys: [],
    ...overrides,
  }
}

function render(
  userId: string,
  session: Session,
  wizard?: { userId: string; currentStep: number | '---'; totalSteps: number | '---' },
): { target: HTMLElement; component: ReturnType<typeof mount> } {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.getElementById('root')!
  const component = mount(SessionCard, {
    target,
    props: { userId, session, wizard, onSelect: () => {} },
  })
  return { target, component }
}

describe('SessionCard', () => {
  test('renders userId, history count, and facts count', () => {
    const { target, component } = render('alice', baseSession({ historyLength: 5, factsCount: 7 }))
    expect(target.textContent).toContain('alice')
    expect(target.textContent).toContain('history: 5')
    expect(target.textContent).toContain('facts: 7')
    void unmount(component)
  })

  test('adds active class when session was accessed recently', () => {
    const { target, component } = render('alice', baseSession({ lastAccessed: Date.now() }))
    expect(target.querySelector('.session-card.active')).not.toBeNull()
    void unmount(component)
  })

  test('omits active class when session is stale', () => {
    const { target, component } = render('alice', baseSession({ lastAccessed: Date.now() - 1_000_000 }))
    expect(target.querySelector('.session-card.active')).toBeNull()
    expect(target.querySelector('.session-card')).not.toBeNull()
    void unmount(component)
  })

  test('shows wizard badge when wizard is present', () => {
    const wizard = { userId: 'alice', currentStep: 2 as const, totalSteps: 5 as const }
    const { target, component } = render('alice', baseSession(), wizard)
    expect(target.textContent).toContain('wizard step 2/5')
    void unmount(component)
  })

  test('shows config key count when config is non-empty', () => {
    const { target, component } = render('alice', baseSession({ configKeys: ['llm_apikey', 'main_model'] }))
    expect(target.textContent).toContain('config: 2 keys')
    void unmount(component)
  })

  test('renders a StatusPill reflecting active/idle state', () => {
    const activeSession = baseSession({ lastAccessed: Date.now() })
    const { target: activeTarget, component: activeComponent } = render('u1', activeSession)
    const activePill = activeTarget.querySelector('.ui-pill')
    expect(activePill).not.toBeNull()
    expect(activePill?.textContent?.trim()).toBe('active')
    void unmount(activeComponent)

    const idleSession = baseSession({ lastAccessed: Date.now() - 600_000 })
    const { target: idleTarget, component: idleComponent } = render('u1', idleSession)
    const idlePill = idleTarget.querySelector('.ui-pill')
    expect(idlePill).not.toBeNull()
    expect(idlePill?.textContent?.trim()).toBe('idle')
    void unmount(idleComponent)
  })
})
