// tests/platform/scenarios/mattermost-fetch-chat-link.platform.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { buildContainerEnv, startPapaiContainer, type PapaiContainer } from '../../smoke/harness/container.js'
import { isDockerAvailable } from '../../smoke/harness/docker.js'
import {
  startFakeLlmServer,
  textResponse,
  toolResponse,
  type FakeLlmServer,
} from '../../smoke/harness/fake-llm-server.js'
import { startFakeMattermostServer, type FakeMattermostServer } from '../../smoke/harness/fake-mattermost-server.js'
import { ensurePapaiE2eImage } from '../../smoke/harness/image.js'
import { PLATFORM_STORIES } from './catalog.js'

const ADMIN_USER_ID = 'admin-user-1'
const title = (key: keyof typeof PLATFORM_STORIES): string => PLATFORM_STORIES[key].title

const DOCKER = await isDockerAvailable()
if (!DOCKER) console.warn('[platform] Docker unavailable — skipping T3 fetch-chat-link lane')

type Handle = { container: PapaiContainer; llm: FakeLlmServer; mm: FakeMattermostServer; stopped: boolean }
let handle: Handle | undefined

describe.skipIf(!DOCKER)('T3 Mattermost — fetch_chat_link resolver', () => {
  beforeAll(async () => {
    await ensurePapaiE2eImage()
    const llm = startFakeLlmServer()
    const mm = startFakeMattermostServer({ botUserId: 'bot-user-1', botUsername: 'smokebot' })
    try {
      const container = await startPapaiContainer({
        env: buildContainerEnv({ llmBaseUrl: llm.containerBaseUrl, mattermostUrl: mm.containerBaseUrl }),
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
    title('SCN-fetch-chat-link'),
    async () => {
      await handle!.mm.whenConnected()
      handle!.mm.seedPost({
        id: 'post1abc',
        channelId: 'dm-chat',
        userId: 'author-1',
        message: 'ship the release notes',
        createAt: 1_700_000_000_000,
      })
      const permalink = `${handle!.mm.containerBaseUrl}/team/pl/post1abc`
      handle!.llm.enqueue([
        toolResponse('call_load', 'load_tool', { names: ['fetch_chat_link'] }),
        toolResponse('call_fetch', 'fetch_chat_link', { url: permalink, scope: 'thread' }),
        textResponse('Summarized the linked thread.'),
      ])
      const status = handle!.mm.waitForPost()
      handle!.mm.deliverMessage({
        channelId: 'dm-chat',
        message: `summarize ${permalink}`,
        userId: ADMIN_USER_ID,
      })
      await status
      const reply = await handle!.mm.waitForPost()
      expect(reply.message).toContain('Summarized the linked thread.')
      // The real adapter resolved the permalink through the fake REST API end to end.
      expect(handle!.mm.observedGets()).toContain('/api/v4/posts/post1abc')
      expect(handle!.mm.observedGets()).toContain('/api/v4/posts/post1abc/thread')
    },
    60_000,
  )
})
