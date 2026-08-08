// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createServer } from 'node:net'

import { createOpencodeClient, createOpencodeServer } from '@opencode-ai/sdk'

import { buildOpencodeConfig } from './openai-config.js'
import type { OpenAiSettings } from './openai-config.js'
import type { OpenCodeConnection } from './opencode-adapter.js'
import { decodeSessionId, decodeSessionUsage } from './sdk-contract.js'

/**
 * Booting a headless OpenCode server and wiring one client to it.
 *
 * Split from `opencode-adapter.ts` when the abort would not fit beside the rest,
 * along a seam the file already had three of. `sdk-contract.ts` is what the SDK
 * *says* — the shapes, recorded; this file is how the SDK is *started and
 * addressed* — a spawned process, a port, a base URL, a directory on every call;
 * and the adapter is what the pipeline does with the result. All three change for
 * different reasons: this one on a server-lifecycle question, that one on a
 * version bump, the adapter on a pipeline change.
 */

/**
 * Reserves a free TCP port.
 *
 * `createOpencodeServer` passes its `port` straight to `opencode serve`, and
 * port `0` there does *not* mean "pick an ephemeral one" — the server was
 * observed booting on its 4096 default instead, so two agent processes on one
 * host would collide. Binding a listener and reading back the assigned port
 * gets a real free one. The window between closing this and the server binding
 * is a race in theory; in practice it beats a fixed port that is guaranteed to
 * clash.
 */
const reservePort = (): Promise<number> => {
  const probe = createServer()
  return new Promise((resolve, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      probe.close(() => {
        if (port === 0) reject(new Error('Could not reserve a port for the OpenCode server'))
        else resolve(port)
      })
    })
  })
}

/** The SDK's own default is 5s, which a cold runner with a large repo can miss. */
const SERVER_BOOT_TIMEOUT_MS = 60_000

export const connectSdk = async (directory: string, openai: OpenAiSettings): Promise<OpenCodeConnection> => {
  // The provider, endpoint and model are pinned in the server's own config, so
  // the session cannot fall back to whatever credentials happen to be in env.
  // The SDK delivers this to `opencode serve` through OPENCODE_CONFIG_CONTENT —
  // the same channel the review-loop subprocesses use.
  const server = await createOpencodeServer({
    hostname: '127.0.0.1',
    port: await reservePort(),
    config: buildOpencodeConfig(openai),
    timeout: SERVER_BOOT_TIMEOUT_MS,
  })
  const client = createOpencodeClient({ baseUrl: server.url, directory })

  return {
    createSession: async (title) => {
      const created = await client.session.create({ body: { title }, query: { directory } })
      return decodeSessionId(created)
    },
    sendPrompt: (sessionId, body) => client.session.prompt({ path: { id: sessionId }, body, query: { directory } }),
    // `/event` is a server-sent-event stream; the generated client hands back
    // the parsed events as an async generator.
    //
    // `sseMaxRetryAttempts: 0` is load-bearing. The client's default is to
    // reconnect for ever with no cap, so when `close()` kills the server the
    // stream does not end — it starts retrying a socket that will never come
    // back. Verified against a real server: without this the generator was
    // still open eight seconds after the server was closed, and a teardown that
    // waited on it hung the job until its own timeout.
    events: async () => (await client.event.subscribe({ sseMaxRetryAttempts: 0 })).stream,
    usage: async (sessionId) =>
      decodeSessionUsage(await client.session.get({ path: { id: sessionId }, query: { directory } })),
    // The stop. Measured against a live server: this kills the tool child the
    // model is running and leaves the server itself up — which is the opposite of
    // what `close()` does, and the reason the two are not interchangeable.
    abort: (sessionId) => client.session.abort({ path: { id: sessionId }, query: { directory } }),
    close: (): Promise<void> => {
      server.close()
      return Promise.resolve()
    },
  }
}
