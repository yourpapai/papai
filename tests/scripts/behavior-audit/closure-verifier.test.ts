// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import { resolveHint, runClosureCheck } from '../../../scripts/behavior-audit/closure-verifier.js'

describe('resolveHint', () => {
  test('command resolves when in command map', async () => {
    const commands = new Set(['/config', 'config'])
    const result = await resolveHint(
      { kind: 'command', identifier: '/config' },
      { commands, tools: new Set(), routes: new Set(), codeindex: null },
    )
    expect(result.resolved).toBe(true)
    expect(result.evidence).not.toBeNull()
  })

  test('command unresolved when not in map', async () => {
    const result = await resolveHint(
      { kind: 'command', identifier: '/not-real' },
      { commands: new Set(), tools: new Set(), routes: new Set(), codeindex: null },
    )
    expect(result.resolved).toBe(false)
    expect(result.evidence).toBeNull()
  })

  test('tool resolves when in tool map', async () => {
    const tools = new Set(['createTask'])
    const result = await resolveHint(
      { kind: 'tool', identifier: 'createTask' },
      { commands: new Set(), tools, routes: new Set(), codeindex: null },
    )
    expect(result.resolved).toBe(true)
  })

  test('route resolves when in route map', async () => {
    const routes = new Set(['/api/settings'])
    const result = await resolveHint(
      { kind: 'route', identifier: '/api/settings' },
      { commands: new Set(), tools: new Set(), routes, codeindex: null },
    )
    expect(result.resolved).toBe(true)
  })

  test('handler unresolved when codeindex is null', async () => {
    const result = await resolveHint(
      { kind: 'handler', identifier: 'onTextMessage' },
      { commands: new Set(), tools: new Set(), routes: new Set(), codeindex: null },
    )
    expect(result.resolved).toBe(false)
    expect(result.evidence).toBeNull()
  })

  test('handler resolves via codeindex when candidate exists', async () => {
    const codeindex = {
      search: {
        findSymbolCandidates: mock(() =>
          Promise.resolve([
            {
              filePath: 'src/chat/telegram.ts',
              startLine: 10,
              endLine: 20,
              symbolKey: 'k',
              qualifiedName: 'onTextMessage',
              snippet: '',
            },
          ]),
        ),
      },
    }
    const result = await resolveHint(
      { kind: 'handler', identifier: 'onTextMessage' },
      { commands: new Set(), tools: new Set(), routes: new Set(), codeindex },
    )
    expect(result.resolved).toBe(true)
    expect(result.evidence?.filePath).toBe('src/chat/telegram.ts')
  })
})

describe('closureStatus', () => {
  test('unverified when no hints', async () => {
    const result = await runClosureCheck({
      behaviors: [{ id: 'b1', entryPointHints: [], userStory: 's' }],
      resolvers: { commands: new Set(), tools: new Set(), routes: new Set(), codeindex: null },
    })
    expect(result.entries.get('b1')!.closureStatus).toBe('unverified')
  })

  test('resolved when all hints resolve', async () => {
    const result = await runClosureCheck({
      behaviors: [
        {
          id: 'b1',
          entryPointHints: [
            { kind: 'command', identifier: '/config' },
            { kind: 'tool', identifier: 'createTask' },
          ],
          userStory: 's',
        },
      ],
      resolvers: {
        commands: new Set(['/config']),
        tools: new Set(['createTask']),
        routes: new Set(),
        codeindex: null,
      },
    })
    expect(result.entries.get('b1')!.closureStatus).toBe('resolved')
  })

  test('partial when some hints resolve', async () => {
    const result = await runClosureCheck({
      behaviors: [
        {
          id: 'b1',
          entryPointHints: [
            { kind: 'command', identifier: '/config' },
            { kind: 'command', identifier: '/missing' },
          ],
          userStory: 's',
        },
      ],
      resolvers: { commands: new Set(['/config']), tools: new Set(), routes: new Set(), codeindex: null },
    })
    expect(result.entries.get('b1')!.closureStatus).toBe('partial')
  })

  test('unresolved when no hints resolve', async () => {
    const result = await runClosureCheck({
      behaviors: [
        {
          id: 'b1',
          entryPointHints: [{ kind: 'command', identifier: '/nope' }],
          userStory: 's',
        },
      ],
      resolvers: { commands: new Set(), tools: new Set(), routes: new Set(), codeindex: null },
    })
    expect(result.entries.get('b1')!.closureStatus).toBe('unresolved')
  })
})
