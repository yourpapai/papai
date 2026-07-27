// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, describe, test } from 'bun:test'

import { YouTrackProvider } from '../../../../plugins/task-provider-youtrack/provider.js'
import {
  startFakeYouTrackServer,
  type FakeYouTrackServer,
} from '../../../stories/harness/fake-youtrack/serve-over-http.js'
import { PARITY_GROUPS } from '../../../stories/harness/parity/expectations.js'
import { required } from '../../../stories/harness/parity/group.js'
import { youtrackCustomFieldGroups } from './youtrack-custom-field-groups.js'
import { YOUTRACK_PARITY_EXCLUSIONS } from './youtrack-parity-exclusions.js'

// Third binding of the shared parity contract: YouTrackProvider over a fake
// YouTrack REST server. Proves request-building + response-mapping + contract
// conformance; NOT fidelity against a real YouTrack (both fake and expectations
// are authored here). See tests/stories/harness/fake-youtrack/state.ts header.
const excluded = new Set(YOUTRACK_PARITY_EXCLUSIONS.map((entry) => entry.group))
const includedGroups = PARITY_GROUPS.filter((group) => !excluded.has(group.id))
const allGroups = [...includedGroups, ...youtrackCustomFieldGroups]

describe('provider conformance — YouTrack binding (fake server)', () => {
  const fake: FakeYouTrackServer = startFakeYouTrackServer()

  afterAll(async () => {
    await fake.stop()
  })

  for (const group of allGroups) {
    test(group.title, async () => {
      fake.reset()
      const provider = new YouTrackProvider({ baseUrl: fake.url, token: 'fake-token' })
      const project = required(
        await provider.createProject?.({ name: `Parity ${group.id}` }),
        'provider.createProject result',
      )
      await group.run({ provider, projectId: project.id })
    })
  }
})
