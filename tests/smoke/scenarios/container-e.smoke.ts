// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// tests/smoke/scenarios/container-e.smoke.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeAll, describe, expect, test } from 'bun:test'

import { buildContainerEnv, runPapaiContainerToExit } from '../harness/container.js'
import { isDockerAvailable } from '../harness/docker.js'
import { ensurePapaiE2eImage } from '../harness/image.js'
import { SMOKE_STORIES } from './catalog.js'

const title = (key: keyof typeof SMOKE_STORIES): string => SMOKE_STORIES[key].title

const DOCKER = await isDockerAvailable()
if (!DOCKER) console.warn('[smoke] Docker unavailable — skipping T2 container-E lane')

describe.skipIf(!DOCKER)('T2 container E — required-env validation', () => {
  beforeAll(async () => {
    await ensurePapaiE2eImage()
  }, 180_000)

  test(
    title('SCN-required-env-admin'),
    async () => {
      const { logs, exitCode } = await runPapaiContainerToExit({
        // E exits before reading MM/LLM env, so the fake URLs are placeholders it never dials.
        env: buildContainerEnv(
          { llmBaseUrl: 'http://host.docker.internal:1/v1', mattermostUrl: 'http://host.docker.internal:1' },
          { adminUserId: '' },
        ),
      })
      expect(logs).toContain('Missing required environment variables')
      expect(exitCode).toBe(1)
    },
    60_000,
  )
})
