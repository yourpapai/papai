// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// tests/platform/scenarios/mattermost-thread-reply.platform.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { buildContainerEnv, startPapaiContainer, type PapaiContainer } from '../../smoke/harness/container.js'
import { isDockerAvailable } from '../../smoke/harness/docker.js'
import { startFakeLlmServer, textResponse, type FakeLlmServer } from '../../smoke/harness/fake-llm-server.js'
import {
  startFakeMattermostServer,
  type CapturedPost,
  type FakeMattermostServer,
} from '../../smoke/harness/fake-mattermost-server.js'
import { ensurePapaiE2eImage } from '../../smoke/harness/image.js'
import { PLATFORM_STORIES } from './catalog.js'

const ADMIN_USER_ID = 'admin-user-1'
const BOT_USERNAME = 'smokebot'
const GROUP_CHANNEL = 'team-chat'
const THREAD_A = 'threadaaaaaaaaaaaaaaaaaaaaa'
const THREAD_B = 'threadbbbbbbbbbbbbbbbbbbbbb'
const ANSWER = 'Noted the release date.'

const sessionSchema = z.object({ csrfToken: z.string() })
const title = (key: keyof typeof PLATFORM_STORIES): string => PLATFORM_STORIES[key].title

const DOCKER = await isDockerAvailable()
if (!DOCKER) console.warn('[platform] Docker unavailable — skipping T3 Mattermost thread-reply lane')

type Handle = { container: PapaiContainer; llm: FakeLlmServer; mm: FakeMattermostServer }
let handle: Handle | undefined

/**
 * Walks the production operator path that makes a group usable: `/config` in a DM
 * mints a single-use code, the code buys a settings session, and the session
 * authorizes the group. Without it every group post gets the refusal reply.
 */
const authorizeGroup = async (container: PapaiContainer, mm: FakeMattermostServer): Promise<void> => {
  const captured = mm.waitForPost()
  // /config only sets commandInput when the bot is @mentioned at index 0 (DM rule).
  mm.deliverMessage({ channelId: 'dm-config', message: `@${BOT_USERNAME} /config`, userId: ADMIN_USER_ID })
  const codeMatch = /[?&]code=([^\s&]+)/u.exec((await captured).message)
  if (codeMatch === null) throw new Error('no /config link in the settings reply')
  const exchange = await fetch(`${container.webBaseUrl}/settings/auth/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: codeMatch[1] }),
  })
  const cookieMatch = /papai_settings_session=[^;]+/u.exec(exchange.headers.get('set-cookie') ?? '')
  if (cookieMatch === null) throw new Error('settings exchange returned no session cookie')
  const session = sessionSchema.parse(await exchange.json())
  const authorized = await fetch(`${container.webBaseUrl}/settings/api/admin/groups`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: cookieMatch[0],
      'X-Settings-CSRF': session.csrfToken,
    },
    body: JSON.stringify({ groupId: GROUP_CHANNEL }),
  })
  if (authorized.status !== 200) throw new Error(`authorizing ${GROUP_CHANNEL} failed: ${authorized.status}`)
}

/**
 * Drains outbound posts until one matches. A turn also emits its live-status post,
 * so the answer is not reliably the next post on the wire.
 */
const nextPostMatching = async (
  mm: FakeMattermostServer,
  matches: (post: CapturedPost) => boolean,
): Promise<CapturedPost> => {
  for (let attempt = 0; attempt < 6; attempt++) {
    const post = await mm.waitForPost(20_000)
    if (matches(post)) return post
  }
  throw new Error('no outbound post matched within six posts')
}

/** The `/context` grid reports history size as a `N messages` detail row. */
const historyCount = (rendered: string): number => {
  const match = /(\d+) messages?/u.exec(rendered)
  if (match === null) throw new Error(`no history detail row in /context output: ${rendered}`)
  return Number(match[1])
}

const askContext = (mm: FakeMattermostServer, rootId: string, postId: string): Promise<CapturedPost> => {
  mm.deliverMessage({
    channelId: GROUP_CHANNEL,
    message: `@${BOT_USERNAME} /context`,
    userId: ADMIN_USER_ID,
    postId,
    rootId,
  })
  return nextPostMatching(mm, (post) => post.message.includes('Conversation history'))
}

describe.skipIf(!DOCKER)('T3 Mattermost — thread-root reply propagation', () => {
  beforeAll(async () => {
    await ensurePapaiE2eImage()
    const llm = startFakeLlmServer()
    const mm = startFakeMattermostServer({
      botUserId: 'bot-user-1',
      botUsername: BOT_USERNAME,
      groupChannelIds: [GROUP_CHANNEL],
    })
    try {
      const container = await startPapaiContainer({
        env: buildContainerEnv({ llmBaseUrl: llm.containerBaseUrl, mattermostUrl: mm.containerBaseUrl }),
        readyTimeoutMs: 90_000,
      })
      await mm.whenConnected()
      await authorizeGroup(container, mm)
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
    title('SCN-mattermost-thread-reply'),
    async () => {
      const mm = handle!.mm
      for (const id of [THREAD_A, THREAD_B]) {
        mm.seedPost({ id, channelId: GROUP_CHANNEL, userId: ADMIN_USER_ID, message: 'thread root' })
      }
      handle!.llm.enqueue([textResponse(ANSWER)])
      mm.deliverMessage({
        channelId: GROUP_CHANNEL,
        message: `@${BOT_USERNAME} remember the release date`,
        userId: ADMIN_USER_ID,
        postId: 'msgaaaaaaaaaaaaaaaaaaaaaaaa',
        rootId: THREAD_A,
      })
      const answer = await nextPostMatching(mm, (post) => post.message.includes(ANSWER))
      // The adapter answered inside the incoming thread rather than at channel level.
      expect(answer.root_id).toBe(THREAD_A)

      // …and it stored the turn under the thread-scoped context: the sibling thread in
      // the same channel starts empty, which a channel-scoped context could not do.
      const inThread = await askContext(mm, THREAD_A, 'msgbbbbbbbbbbbbbbbbbbbbbbbb')
      const inSibling = await askContext(mm, THREAD_B, 'msgcccccccccccccccccccccccc')
      expect(inThread.root_id).toBe(THREAD_A)
      expect(inSibling.root_id).toBe(THREAD_B)
      expect(historyCount(inThread.message)).toBeGreaterThan(0)
      expect(historyCount(inSibling.message)).toBe(0)
    },
    120_000,
  )
})
