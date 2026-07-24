// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, describe, test } from 'bun:test'

import { KaneoProvider } from '../../../plugins/task-provider-kaneo/provider.js'
import { PARITY_GROUPS } from '../../stories/harness/parity/expectations.js'
import { getE2EConfigSync } from '../global-setup.js'
import { KaneoTestClient } from '../kaneo-test-client.js'

// The container is brought up by the shared preload (tests/e2e/bun-test-setup.ts)
// via the e2e.test.ts aggregator; this file assumes a healthy Kaneo.
describe('provider parity — Kaneo binding (real Docker)', () => {
  const client = new KaneoTestClient()

  afterAll(async () => {
    await client.cleanup()
  })

  for (const group of PARITY_GROUPS) {
    test(group.title, async () => {
      const config = getE2EConfigSync()
      const project = await client.createTestProject(`Parity ${group.id}`)
      const provider = new KaneoProvider({ baseUrl: config.baseUrl, apiKey: config.apiKey }, config.workspaceId)
      await group.run({ provider, projectId: project.id })
    })
  }
})
