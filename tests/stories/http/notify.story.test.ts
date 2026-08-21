// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { scenario } from '../harness/scenario.js'

const proactiveReplyCount = (world: { chat: { allReplies(): readonly { kind: string }[] } }): number =>
  world.chat.allReplies().filter((reply) => reply.kind === 'proactive').length

scenario('SCN-http-notify: an authorized notify delivers a proactive message', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  given.notifyToken('notify-secret')
  const contextId = world.scopedStorageContextId(dm)

  const body = JSON.stringify({ contextId, contextType: 'dm', markdown: 'Your build finished: **green**.' })

  // Wrong bearer is rejected before any delivery.
  const unauthorized = await when.request('/api/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong-token' },
    body,
  })
  then.responseStatus(unauthorized, 401)
  if (proactiveReplyCount(world) !== 0) throw new Error('Rejected notify requests must not deliver proactive messages')

  then.responseStatus(
    await when.request('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer notify-secret' },
      body: '{not valid json',
    }),
    400,
  )
  if (proactiveReplyCount(world) !== 0) throw new Error('Rejected notify requests must not deliver proactive messages')

  then.responseStatus(
    await when.request('/api/notify', {
      headers: { Authorization: 'Bearer notify-secret' },
    }),
    405,
  )
  if (proactiveReplyCount(world) !== 0) throw new Error('Rejected notify requests must not deliver proactive messages')

  then.responseStatus(
    await when.request('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer notify-secret' },
      body: JSON.stringify({ contextId, contextType: 'dm' }),
    }),
    400,
  )
  if (proactiveReplyCount(world) !== 0) throw new Error('Rejected notify requests must not deliver proactive messages')

  // Authorized notify delivers a real proactive message captured by the scenario chat.
  const delivered = await when.request('/api/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer notify-secret' },
    body,
  })
  then.responseStatus(delivered, 200)
  then.replyTo(alice).contains('build finished')
})
