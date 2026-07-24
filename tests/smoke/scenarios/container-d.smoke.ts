// tests/smoke/scenarios/container-d.smoke.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { buildContainerEnv, startPapaiContainer, type PapaiContainer } from '../harness/container.js'
import { isDockerAvailable } from '../harness/docker.js'
import { startFakeLlmServer, type FakeLlmServer } from '../harness/fake-llm-server.js'
import { startFakeMattermostServer, type FakeMattermostServer } from '../harness/fake-mattermost-server.js'
import { ensurePapaiE2eImage } from '../harness/image.js'
import { SMOKE_STORIES } from './catalog.js'

const title = (key: keyof typeof SMOKE_STORIES): string => SMOKE_STORIES[key].title

const DOCKER = await isDockerAvailable()
if (!DOCKER) console.warn('[smoke] Docker unavailable — skipping T2 container-D lane')

type Handle = { container: PapaiContainer; llm: FakeLlmServer; mm: FakeMattermostServer }
let handle: Handle | undefined

describe.skipIf(!DOCKER)('T2 container D — debug surface gated on', () => {
  beforeAll(async () => {
    await ensurePapaiE2eImage()
    const llm = startFakeLlmServer()
    const mm = startFakeMattermostServer({ botUserId: 'bot-user-1', botUsername: 'smokebot' })
    const container = await startPapaiContainer({
      env: buildContainerEnv(
        { llmBaseUrl: llm.containerBaseUrl, mattermostUrl: mm.containerBaseUrl },
        { debugServer: true },
      ),
      readyTimeoutMs: 90_000,
    })
    handle = { container, llm, mm }
  }, 180_000)

  afterAll(async () => {
    if (handle === undefined) return
    await handle.container.remove().catch(() => undefined)
    await handle.mm.stop()
    await handle.llm.stop()
  })

  test(title('SCN-debug-surface-gated-on'), async () => {
    const res = await fetch(`${handle!.container.webBaseUrl}/debug`)
    expect(res.status).toBe(401)
  })
})
