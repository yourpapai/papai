// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { renderSessionDetail } from '../../../client/debug/session-detail.js'
import type { SessionDetail } from '../../../client/debug/types.js'

type ModalElements = Parameters<typeof renderSessionDetail>[2]

function makeMockElements(): ModalElements {
  return {
    $sessionModal: document.createElement('div'),
    $sessionModalTitle: document.createElement('h3'),
    $sessionModalBody: document.createElement('div'),
    $sessionModalClose: document.createElement('button'),
  }
}

function baseSession(history: SessionDetail['history']): SessionDetail {
  return {
    userId: 'test-user',
    lastAccessed: Date.now(),
    historyLength: history?.length ?? 0,
    factsCount: 0,
    summary: null,
    configKeys: [],
    workspaceId: null,
    history,
  }
}

describe('session-detail', () => {
  test('SessionDetail type is properly exported', () => {
    const session: SessionDetail = {
      userId: 'test-user',
      lastAccessed: Date.now(),
      historyLength: 5,
      factsCount: 2,
      summary: null,
      configKeys: [],
      workspaceId: null,
    }

    expect(session.userId).toBe('test-user')
    expect(session.historyLength).toBe(5)
  })

  describe('renderSessionDetail history rendering', () => {
    test('renders plain text content as escaped text', () => {
      const elements = makeMockElements()
      renderSessionDetail('user-1', baseSession([{ role: 'user', content: 'hello <world>' }]), elements)
      const body = elements.$sessionModalBody.innerHTML
      expect(body).toContain('hello &lt;world&gt;')
      expect(body).not.toContain('tree-toggle')
    })

    test('renders JSON object content as collapsible tree', () => {
      const elements = makeMockElements()
      const jsonContent = JSON.stringify({ taskId: 'abc-123', status: 'done', tags: ['urgent', 'bug'] })
      renderSessionDetail(
        'user-1',
        baseSession([{ role: 'tool', content: jsonContent, tool_call_id: 'tc-1' }]),
        elements,
      )
      const body = elements.$sessionModalBody.innerHTML
      expect(body).toContain('tree-toggle')
      expect(body).toContain('taskId')
      expect(body).toContain('"abc-123"')
      expect(body).toContain('"urgent"')
    })

    test('renders JSON array content as collapsible tree', () => {
      const elements = makeMockElements()
      const jsonContent = JSON.stringify([{ id: 1 }, { id: 2 }])
      renderSessionDetail('user-1', baseSession([{ role: 'tool', content: jsonContent }]), elements)
      const body = elements.$sessionModalBody.innerHTML
      expect(body).toContain('tree-toggle')
      expect(body).toContain('id')
    })

    test('falls back to plain text for invalid JSON', () => {
      const elements = makeMockElements()
      renderSessionDetail('user-1', baseSession([{ role: 'user', content: '{ not json' }]), elements)
      const body = elements.$sessionModalBody.innerHTML
      expect(body).toContain('{ not json')
      expect(body).not.toContain('tree-toggle')
    })
  })
})
