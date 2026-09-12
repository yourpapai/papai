// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// tests/platform/scenarios/mattermost-status-lifecycle.platform.ts
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
const ANSWER = 'You have no saved memories yet.'
const STATUS_POST_ID = 'out-1'

const title = (key: keyof typeof PLATFORM_STORIES): string => PLATFORM_STORIES[key].title

const DOCKER = await isDockerAvailable()
if (!DOCKER) console.warn('[platform] Docker unavailable — skipping T3 Mattermost live-status lane')

type Handle = { container: PapaiContainer; llm: FakeLlmServer; mm: FakeMattermostServer }
let handle: Handle | undefined

describe.skipIf(!DOCKER)('T3 Mattermost — live-status mutation lifecycle', () => {
  beforeAll(async () => {
    await ensurePapaiE2eImage()
    const llm = startFakeLlmServer()
    const mm = startFakeMattermostServer({ botUserId: 'bot-user-1', botUsername: 'smokebot' })
    try {
      const container = await startPapaiContainer({
        env: buildContainerEnv({ llmBaseUrl: llm.containerBaseUrl, mattermostUrl: mm.containerBaseUrl }),
        readyTimeoutMs: 90_000,
      })
      handle = { container, llm, mm }
    } catch (error) {
      await mm.stop()
      await llm.stop()
      throw error
    }
  }, 180_000)

  afterAll(async () => {
    if (handle === undefined) return
    await handle.container.stop().catch(() => undefined)
    await handle.container.remove().catch(() => undefined)
    await handle.mm.stop()
    await handle.llm.stop()
  })

  test(
    title('SCN-mattermost-status-lifecycle'),
    async () => {
      const mm = handle!.mm
      await mm.whenConnected()
      handle!.llm.enqueue([
        toolResponse('call_load', 'load_tool', { names: ['list_memory'] }),
        toolResponse('call_list', 'list_memory', {}),
        textResponse(ANSWER),
      ])
      const status = mm.waitForPost()
      mm.deliverMessage({ channelId: 'dm-chat', message: 'list my memories please', userId: ADMIN_USER_ID })
      expect((await status).message).toContain('Thinking')
      const reply = await mm.waitForPost(20_000)
      expect(reply.message).toContain(ANSWER)

      // One status post created up front, patched once per tool step in step order,
      // deleted, and only then the answer — the dismiss precedes the reply, so a
      // reader never sees the status and the answer at the same time.
      expect(mm.postMutations()).toEqual([
        { kind: 'create', postId: STATUS_POST_ID, message: '💭 Thinking…' },
        { kind: 'patch', postId: STATUS_POST_ID, message: '⚙️ Running load tool…' },
        { kind: 'patch', postId: STATUS_POST_ID, message: '🧠 Recalling memory…' },
        { kind: 'patch', postId: STATUS_POST_ID, message: '💬 Preparing response…' },
        { kind: 'delete', postId: STATUS_POST_ID },
        { kind: 'create', postId: 'out-2', message: ANSWER },
      ])
      // Deletion is terminal for the status post: nothing patches it afterwards.
      const afterDelete = mm.postMutations().slice(mm.postMutations().findIndex((m) => m.kind === 'delete') + 1)
      expect(afterDelete.filter((mutation) => mutation.postId === STATUS_POST_ID)).toEqual([])
    },
    120_000,
  )
})
