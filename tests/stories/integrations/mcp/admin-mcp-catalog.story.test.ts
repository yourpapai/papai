// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { setCachedConfig } from '../../../../src/cache.js'
import { getConfigContextIdFromStorageContextId, toScopedContextId } from '../../../../src/chat/scoped-context.js'
import { createFakeMcpServer } from '../../harness/fake-mcp-server.js'
import { scenario } from '../../harness/scenario.js'
import { answer, callCapability, promptTextFingerprint } from '../../harness/scripted-llm.js'

const MCP_URL = 'https://mcp.invalid/rpc'
// A unique word present ONLY in the fake server's tools/call result — never in any tool input or
// reply string. Its fingerprint on the tool result proves the remote MCP tool round-tripped.
const SERVER_MARKER = 'papaimcpmarker9z'

scenario(
  'SCN-settings-admin-mcp-catalog: a configured MCP endpoint surfaces a remote tool the model invokes',
  async ({ given, when, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)

    // Seed the user MCP endpoint config the adapter reads during assembly.
    const storageContextId = toScopedContextId({
      platformInstanceId: alice.platformInstanceId,
      nativeContextId: alice.id,
    })
    const configContextId = getConfigContextIdFromStorageContextId(storageContextId)
    setCachedConfig(configContextId, 'mcp_endpoints', JSON.stringify([{ id: 'fake', url: MCP_URL, enabled: true }]))

    // Serve the fake external MCP server over the strict dispatcher. Declared sequence pinned by
    // the Step 0 discovery spike: exactly one connect handshake, one tools/list, one tools/call per turn.
    const server = createFakeMcpServer({ http: world.http, events: world.events, url: MCP_URL })
    server.expectConnect()
    server.expectToolsList([{ name: 'echo', description: 'echoes a message', inputSchema: { type: 'object' } }])
    server.expectToolCall({ name: 'echo' }, { text: `remote result ${SERVER_MARKER}` })

    given.llm([callCapability('mcp_fake__echo', { message: 'hi' }), answer('The remote tool replied.')])

    await when.message(alice, dm, 'Use the fake tool please')

    // The server-sourced marker surfaces on the real tool result — unscriptable, so its presence
    // proves the real MCP client → fake server round trip reached the model.
    expect(world.model.inspections().at(-1)?.promptToolResultTokenFingerprints).toContain(
      promptTextFingerprint(SERVER_MARKER),
    )
  },
)
