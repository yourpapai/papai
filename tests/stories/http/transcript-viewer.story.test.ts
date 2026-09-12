// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import { configureCodingSessionCapability } from '../../../src/coding-sessions/configure.js'
import { createFakeMagi } from '../harness/fake-magi.js'
import { scenario } from '../harness/scenario.js'

const MAGI_URL = 'https://magi.invalid'
const MAGI_TOKEN = 'magi-secret'

scenario(
  'SCN-http-transcript-viewer: the viewer proxies transcript bytes from magi',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const group = given.group('team')
    given.member(group, alice)

    // Before magi config exists, the transcript route reports "not configured".
    const unconfigured = await when.request('/t/viewer-token/transcript')
    then.responseStatus(unconfigured, 503)

    // Seed acp magi config (what getViewerMagiConfig reads) after the unconfigured check above.
    // given.codingSession requires an unstarted scenario world, but the request already
    // started the runtime, so seed the same underlying config that fixture writes directly.
    await configureCodingSessionCapability({
      pluginDirectory: 'plugins',
      contextId: toScopedContextId({ platformInstanceId: group.platformInstanceId, nativeContextId: group.id }),
      magiBaseUrl: MAGI_URL,
      magiToken: MAGI_TOKEN,
      updatedBy: 'scenario-admin',
    })
    const magi = createFakeMagi({ http: world.http, events: world.events, baseUrl: MAGI_URL, token: MAGI_TOKEN })
    magi.expectTranscriptHistory('viewer-token', { turns: [{ role: 'assistant', text: 'deploy succeeded' }] })

    const proxied = await when.request('/t/viewer-token/transcript')
    then.responseStatus(proxied, 200)
    then.responseJson(await proxied.json()).equals({ turns: [{ role: 'assistant', text: 'deploy succeeded' }] })
  },
)
