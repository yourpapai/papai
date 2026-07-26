// tests/platform/scenarios/mattermost-http-action.platform.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { createMattermostActionContext } from '../../../src/chat/mattermost/action-signing.js'
import { buildContainerEnv, startPapaiContainer, type PapaiContainer } from '../../smoke/harness/container.js'
import { isDockerAvailable } from '../../smoke/harness/docker.js'
import { startFakeLlmServer, type FakeLlmServer } from '../../smoke/harness/fake-llm-server.js'
import { startFakeMattermostServer, type FakeMattermostServer } from '../../smoke/harness/fake-mattermost-server.js'
import { ensurePapaiE2eImage } from '../../smoke/harness/image.js'
import { PLATFORM_STORIES } from './catalog.js'

const ADMIN_USER_ID = 'admin-user-1'
const CHANNEL_ID = 'chan-1'
const KNOWN_SECRET = 'smoke-t3-action-secret'
const title = (key: keyof typeof PLATFORM_STORIES): string => PLATFORM_STORIES[key].title

const DOCKER = await isDockerAvailable()
if (!DOCKER) console.warn('[platform] Docker unavailable — skipping T3 http-action lane')

type Handle = { container: PapaiContainer; llm: FakeLlmServer; mm: FakeMattermostServer; stopped: boolean }
let handle: Handle | undefined

const signedContext = (secret: string): unknown =>
  createMattermostActionContext(
    {
      platformInstanceId: 'mattermost-default',
      channelId: CHANNEL_ID,
      // The brief's literal callbackData ('perm:d:nonexistent-prompt') matches
      // PERMISSION_CALLBACK_PATTERN in src/chat/interaction-router.ts, whose deny path
      // for an unrecognized/expired prompt id replies with the exact same
      // { ephemeral_text: 'Action is no longer available.' } string this test must rule
      // out — verified via a real container run with temporary tracing. A callbackData
      // that doesn't match the `perm:` prefix takes the router's safe-sink no-op branch
      // instead, which proves signature verification + dispatcher lookup + authorized
      // routing all succeeded (response stays the dispatcher's default
      // { ephemeral_text: 'Action processed.' }) without colliding with the banned string.
      callbackData: 'noop:test-action',
      sourceMessageText: 'do the thing',
      // Brief's literal fixed epoch (1_700_000_000_000, Nov 2023) predates the container's
      // real clock and would already be expired, making the positive case indistinguishable
      // from a bad-signature rejection. Use a live-relative expiry instead.
      expiresAt: Date.now() + 3_600_000,
    },
    secret,
  )

const ActionResponseBodySchema = z.record(z.string(), z.unknown())

const postAction = (webBaseUrl: string, context: unknown): Promise<Response> =>
  fetch(`${webBaseUrl}/mattermost/actions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ user_id: ADMIN_USER_ID, post_id: 'post-1', channel_id: CHANNEL_ID, context }),
  })

describe.skipIf(!DOCKER)('T3 Mattermost — HTTP action callback', () => {
  beforeAll(async () => {
    await ensurePapaiE2eImage()
    const llm = startFakeLlmServer()
    const mm = startFakeMattermostServer({ botUserId: 'bot-user-1', botUsername: 'smokebot' })
    try {
      const container = await startPapaiContainer({
        env: {
          ...buildContainerEnv({ llmBaseUrl: llm.containerBaseUrl, mattermostUrl: mm.containerBaseUrl }),
          PAPAI_MATTERMOST_ACTION_SIGNING_SECRET: KNOWN_SECRET,
        },
        readyTimeoutMs: 90_000,
      })
      handle = { container, llm, mm, stopped: false }
    } catch (error) {
      await mm.stop()
      await llm.stop()
      throw error
    }
  }, 180_000)

  afterAll(async () => {
    if (handle === undefined) return
    if (!handle.stopped) await handle.container.stop().catch(() => undefined)
    await handle.container.remove().catch(() => undefined)
    await handle.mm.stop()
    await handle.llm.stop()
  })

  test(
    title('SCN-http-mattermost-action'),
    async () => {
      // adapter started -> dispatcher registered for mattermost-default
      await handle!.mm.whenConnected()
      const res = await postAction(handle!.container.webBaseUrl, signedContext(KNOWN_SECRET))
      expect(res.status).toBe(200)
      const body = ActionResponseBodySchema.parse(await res.json())
      // Verify passed (not a bad-signature/expired/shape error) and a dispatcher was found.
      expect(body).not.toHaveProperty('error')
      expect(body).not.toEqual({ ephemeral_text: 'Action is no longer available.' })
    },
    60_000,
  )

  test('rejects a context signed with the wrong secret (seam gates)', async () => {
    const res = await postAction(handle!.container.webBaseUrl, signedContext('a-different-secret'))
    expect(res.status).toBe(200)
    const body = ActionResponseBodySchema.parse(await res.json())
    expect(body).toEqual({ error: { message: 'This action is no longer valid.' } })
  })
})
