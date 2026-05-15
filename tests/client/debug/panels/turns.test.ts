import { describe, expect, test } from 'bun:test'

import { renderTurns } from '../../../../client/debug/panels/turns.js'
import type { Turn } from '../../../../src/debug/schemas.js'

function makeTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    turnId: 'turn-1',
    scope: { kind: 'user', userId: 'u1' },
    startedAt: 1700000000000,
    endedAt: 1700000005000,
    status: 'ok',
    incomingMessageCount: 1,
    toolCalls: [],
    ...overrides,
  }
}

describe('renderTurns', () => {
  test('returns placeholder when turns array is empty', () => {
    const html = renderTurns([], 'all')
    expect(html).toContain('placeholder')
    expect(html).toContain('No turns')
  })

  test('renders a single ok turn row', () => {
    const turn = makeTurn()
    const html = renderTurns([turn], 'all')
    expect(html).toContain('turn-1')
    expect(html).toContain('turn-row')
    expect(html).toContain('status-ok')
  })

  test('renders running turn with correct status class', () => {
    const turn = makeTurn({ status: 'running', endedAt: undefined })
    const html = renderTurns([turn], 'all')
    expect(html).toContain('status-running')
  })

  test('renders error turn with correct status class', () => {
    const turn = makeTurn({ status: 'error' })
    const html = renderTurns([turn], 'all')
    expect(html).toContain('status-error')
  })

  test('renders cancelled turn with correct status class', () => {
    const turn = makeTurn({ status: 'cancelled' })
    const html = renderTurns([turn], 'all')
    expect(html).toContain('status-cancelled')
  })

  test('renders scope icon for user scope', () => {
    const turn = makeTurn({ scope: { kind: 'user', userId: 'u1' } })
    const html = renderTurns([turn], 'all')
    expect(html).toContain('scope-user')
  })

  test('renders scope icon for group scope', () => {
    const turn = makeTurn({ scope: { kind: 'group', groupId: 'g1' } })
    const html = renderTurns([turn], 'all')
    expect(html).toContain('scope-group')
  })

  test('renders tool count', () => {
    const turn = makeTurn({
      toolCalls: [
        { name: 'create_task', durationMs: 100, ok: true },
        { name: 'update_task', durationMs: 200, ok: false },
      ],
    })
    const html = renderTurns([turn], 'all')
    expect(html).toContain('2 tools')
  })

  test('renders duration when endedAt is present', () => {
    const turn = makeTurn({ startedAt: 1700000000000, endedAt: 1700000005000 })
    const html = renderTurns([turn], 'all')
    expect(html).toContain('5.0s')
  })

  test('filters by context when activeContext is not all', () => {
    const turn1 = makeTurn({ turnId: 'turn-dm', scope: { kind: 'user', userId: 'u1' } })
    const turn2 = makeTurn({ turnId: 'turn-group', scope: { kind: 'group', groupId: 'g1' } })
    const html = renderTurns([turn1, turn2], 'dm')
    expect(html).toContain('turn-dm')
    expect(html).not.toContain('turn-group')
  })

  test('includes data-turn-id attribute for click handling', () => {
    const turn = makeTurn()
    const html = renderTurns([turn], 'all')
    expect(html).toContain('data-turn-id="turn-1"')
  })
})
