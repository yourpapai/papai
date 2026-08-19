// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// tests/smoke/scenarios/container-p.smoke.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { buildContainerEnv, startPapaiContainer, type PapaiContainer } from '../harness/container.js'
import { isDockerAvailable } from '../harness/docker.js'
import { startFakeLlmServer, textResponse, toolResponse, type FakeLlmServer } from '../harness/fake-llm-server.js'
import { startFakeMattermostServer, type FakeMattermostServer } from '../harness/fake-mattermost-server.js'
import { ensurePapaiE2eImage } from '../harness/image.js'
import { SMOKE_STORIES } from './catalog.js'

const ADMIN_USER_ID = 'admin-user-1'
const SHIPPED_PLUGIN_IDS = [
  'acp',
  'audio-transcribe',
  'synthetic-web-search',
  'task-provider-kaneo',
  'task-provider-youtrack',
]

const title = (key: keyof typeof SMOKE_STORIES): string => SMOKE_STORIES[key].title

const pluginsSchema = z.object({ plugins: z.array(z.object({ id: z.string() })) })

const setCookieHeader = (res: Response): string => res.headers.get('set-cookie') ?? ''

const DOCKER = await isDockerAvailable()
if (!DOCKER) console.warn('[smoke] Docker unavailable — skipping T2 container-P lane')

type Handle = { container: PapaiContainer; llm: FakeLlmServer; mm: FakeMattermostServer; stopped: boolean }
let handle: Handle | undefined

describe.skipIf(!DOCKER)('T2 container P — process-real smoke', () => {
  beforeAll(async () => {
    await ensurePapaiE2eImage()
    const llm = startFakeLlmServer()
    const mm = startFakeMattermostServer({ botUserId: 'bot-user-1', botUsername: 'smokebot' })
    // If the container never boots (the regression this lane exists to catch), the fakes were
    // already listening — stop them here so a boot failure doesn't leak servers into the D/E stages.
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

  test(title('SCN-boot-serve-empty-db'), async () => {
    const res = await fetch(`${handle!.container.webBaseUrl}/settings`)
    expect(res.status).toBe(200)
  })

  test(title('SCN-debug-surface-gated-off'), async () => {
    const res = await fetch(`${handle!.container.webBaseUrl}/debug`)
    expect(res.status).toBe(404)
  })

  test(title('SCN-protected-surfaces-bind'), async () => {
    for (const path of ['/mcp/status', '/admin/identity/mappings', '/recurring']) {
      const res = await fetch(`${handle!.container.webBaseUrl}${path}`)
      expect(res.status).toBe(401)
    }
  })

  test(
    title('SCN-plugin-registry-served'),
    async () => {
      await handle!.mm.whenConnected()
      const captured = handle!.mm.waitForPost()
      // /config only sets commandInput when the bot is @mentioned at index 0 (DM rule).
      handle!.mm.deliverMessage({
        channelId: 'dm-config',
        message: `@${handle!.mm.botUsername} /config`,
        userId: ADMIN_USER_ID,
      })
      const reply = await captured

      const codeMatch = /[?&]code=([^\s&]+)/u.exec(reply.message)
      expect(codeMatch).not.toBeNull()
      const code = codeMatch![1]

      const exchange = await fetch(`${handle!.container.webBaseUrl}/settings/auth/exchange`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      expect(exchange.status).toBe(200)
      const cookieMatch = /papai_settings_session=[^;]+/u.exec(setCookieHeader(exchange))
      expect(cookieMatch).not.toBeNull()

      const plugins = await fetch(`${handle!.container.webBaseUrl}/settings/api/plugins`, {
        headers: { cookie: cookieMatch![0] },
      })
      expect(plugins.status).toBe(200)
      const body = pluginsSchema.parse(await plugins.json())
      const ids = new Set(body.plugins.map((plugin) => plugin.id))
      for (const id of SHIPPED_PLUGIN_IDS) expect(ids.has(id)).toBe(true)
    },
    30_000,
  )

  test(
    title('SCN-chat-turn-tool-loop'),
    async () => {
      await handle!.mm.whenConnected()
      // A fresh, empty DB always humanizes the release announcement via one LLM completion
      // at boot (announcements module); baseline the count so this turn's own request count
      // is measured independently of that unrelated, deterministic startup call.
      const baselineRequests = handle!.llm.requestCount()
      handle!.llm.enqueue([
        toolResponse('call_load', 'load_tool', { names: ['list_memory'] }),
        toolResponse('call_list', 'list_memory', {}),
        textResponse('You have no saved memories yet.'),
      ])
      const picker = handle!.mm.waitForPost()
      const status = handle!.mm.waitForPost()
      handle!.mm.deliverMessage({ channelId: 'dm-chat', message: 'list my memories please', userId: ADMIN_USER_ID })
      // This is the first authorized non-command message from the config context, so the
      // first-interaction language picker (src/chat/language-picker.ts) posts before the
      // turn starts; /config above is a command and never triggered it.
      expect((await picker).message).toContain('Choose the language I will talk to you in:')
      // Live status posts an ephemeral "💭 Thinking…" message before the real reply, then
      // edits/deletes it via PUT/DELETE (docs/architecture/behaviors.md § Live task status)
      // — only the initial status and the final reply are new POST /api/v4/posts calls.
      await status
      const reply = await handle!.mm.waitForPost()
      expect(reply.message).toContain('You have no saved memories yet.')
      expect(handle!.llm.requestCount() - baselineRequests).toBe(3)
    },
    30_000,
  )

  // Runs last: SIGTERM is both the graceful-shutdown assertion and container P's teardown.
  test(
    title('SCN-graceful-shutdown'),
    async () => {
      const { logs, exitCode } = await handle!.container.stop()
      handle!.stopped = true
      expect(logs).toContain('SIGTERM received, starting graceful shutdown...')
      expect(exitCode).toBe(0)
    },
    30_000,
  )
})
