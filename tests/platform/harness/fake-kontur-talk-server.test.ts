// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { startFakeKonturTalkServer } from './fake-kontur-talk-server.js'

describe('fake Kontur Talk server', () => {
  test('records a send request and shuts down cleanly', async () => {
    const fake = await startFakeKonturTalkServer()

    const response = await fetch(`${fake.baseUrl}/bot/test/send_message`, {
      method: 'POST',
      body: JSON.stringify({ room_id: '!room' }),
    })

    expect(response.status).toBe(200)
    expect(fake.sentRequests()).toEqual([{ room_id: '!room' }])

    await fake.stop()
    fake.assertClean()
  })

  test('serves queued updates then holds the next poll until teardown', async () => {
    const fake = await startFakeKonturTalkServer()
    fake.enqueueUpdates([
      {
        event_id: 'event-1',
        user_id: 'user-1',
        room_id: '!room',
        room_is_direct: false,
        type: 'm.room.message',
        timestamp: 0,
        message_type: 'm.text',
      },
    ])

    const first = await fetch(`${fake.baseUrl}/bot/test/get_updates?timeout=30`)
    expect(await first.json()).toEqual({ updates: [expect.objectContaining({ event_id: 'event-1' })] })

    const held = fetch(`${fake.baseUrl}/bot/test/get_updates?timeout=30`)
    await fake.whenPollPending()
    await fake.stop()

    await expect(held).resolves.toMatchObject({ ok: true })
    fake.assertClean()
  })

  test('rejects unexpected requests', async () => {
    const fake = await startFakeKonturTalkServer()

    const response = await fetch(`${fake.baseUrl}/bot/test/unexpected`)

    expect(response.status).toBe(404)

    await fake.stop()
    fake.assertClean()
  })
})
