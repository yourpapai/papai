// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildMattermostPostedMessage } from '../../../src/chat/mattermost/post-builder.js'
import type { BuildPostedMessageDeps } from '../../../src/chat/mattermost/post-builder.js'
import type { CommandHandler, ReplyFn } from '../../../src/chat/types.js'
import { createMockReply } from '../../utils/test-helpers.js'

type ApiFetch = (method: string, path: string, body: unknown) => Promise<unknown>

const CHANNEL_PATH = '/api/v4/channels/chan-1'
const TEAM_PATH = '/api/v4/teams/team-1'
const DM_CHANNEL_PATH = '/api/v4/channels/c'

function makeGroupApiFetch(): ApiFetch {
  const routes: Record<string, unknown> = {
    [CHANNEL_PATH]: { type: 'O', display_name: 'Ops', name: 'ops', team_id: 'team-1' },
    [TEAM_PATH]: { display_name: 'Platform', name: 'platform' },
  }
  return (_method: string, path: string): Promise<unknown> => {
    const found = routes[path]
    if (found !== undefined) return Promise.resolve(found)
    if (path.includes('/members/')) return Promise.resolve({ roles: '' })
    return Promise.resolve({})
  }
}

function makeAdminApiFetch(): ApiFetch {
  const routes: Record<string, unknown> = {
    [CHANNEL_PATH]: { type: 'O', team_id: 'team-1' },
    [TEAM_PATH]: { display_name: 'T', name: 't' },
  }
  return (_method: string, path: string): Promise<unknown> => {
    const found = routes[path]
    if (found !== undefined) return Promise.resolve(found)
    if (path.includes('/members/')) return Promise.resolve({ roles: 'channel_admin system_user' })
    return Promise.resolve({})
  }
}

function makeDmApiFetch(): ApiFetch {
  const routes: Record<string, unknown> = {
    [DM_CHANNEL_PATH]: { type: 'D' },
  }
  return (_method: string, path: string): Promise<unknown> => {
    const found = routes[path]
    if (found !== undefined) return Promise.resolve(found)
    return Promise.resolve({})
  }
}

function makeDeps(
  apiFetch: ApiFetch,
  matchCommand?: (text: string) => { handler: CommandHandler; match: string } | null,
): BuildPostedMessageDeps {
  const { reply } = createMockReply()
  return {
    apiFetch,
    botUsername: 'papai',
    platformInstanceId: 'mattermost-default',
    baseUrl: 'https://mm.invalid',
    token: 'tok',
    buildReplyFn: (): ReplyFn => reply,
    matchCommand: matchCommand ?? ((): null => null),
  }
}

describe('buildMattermostPostedMessage', () => {
  test('builds IncomingMessage from a group post with channel and team metadata', async () => {
    const result = await buildMattermostPostedMessage(
      { id: 'p1', user_id: 'u1', channel_id: 'chan-1', message: 'hello' },
      'alice',
      undefined,
      makeDeps(makeGroupApiFetch()),
    )

    expect(result.msg.contextType).toBe('group')
    expect(result.msg.contextName).toBe('Ops')
    expect(result.msg.contextParentName).toBe('Platform')
    expect(result.msg.messageId).toBe('p1')
    expect(result.msg.user.id).toBe('u1')
    expect(result.msg.platformInstanceId).toBe('mattermost-default')
    expect(result.command).toBeNull()
  })

  test('reports isAdmin when channel member roles include channel_admin', async () => {
    const result = await buildMattermostPostedMessage(
      { id: 'p1', user_id: 'u1', channel_id: 'chan-1', message: 'hi' },
      undefined,
      undefined,
      makeDeps(makeAdminApiFetch()),
    )

    expect(result.isAdmin).toBe(true)
    expect(result.msg.user.isAdmin).toBe(true)
  })

  test('invokes matchCommand with the normalized command input', async () => {
    let seenText = ''
    const result = await buildMattermostPostedMessage(
      { id: 'p1', user_id: 'u1', channel_id: 'c', message: '@papai /help foo' },
      'alice',
      undefined,
      makeDeps(makeDmApiFetch(), (text: string) => {
        seenText = text
        return { handler: (): Promise<void> => Promise.resolve(), match: 'foo' }
      }),
    )

    expect(seenText).toBe('/help foo')
    expect(result.command?.match).toBe('foo')
    expect(result.msg.commandMatch).toBe('foo')
  })
})
