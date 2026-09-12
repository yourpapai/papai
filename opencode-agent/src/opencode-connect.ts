// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createServer } from 'node:net'

import { createOpencodeClient, createOpencodeServer } from '@opencode-ai/sdk'

import { withDeadline } from './deadline.js'
import type { Logger } from './logger.js'
import { buildOpencodeConfig } from './openai-config.js'
import type { OpenAiSettings } from './openai-config.js'
import type { OpenCodeConnection } from './opencode-adapter.js'
import { decodeSessionChildren, decodeSessionId, decodeSessionUsage, sumSessionUsage } from './sdk-contract.js'
import type { SessionUsage } from './sdk-contract.js'
import { errorMessage } from './types.js'

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

/**
 * How long the liveness probe waits before calling the server gone.
 *
 * Short on purpose. This runs after a turn has already failed, on a loopback
 * request to a process on the same host, and its whole value is being answered
 * while the run is still able to report — a generous bound here buys nothing and
 * delays the failure comment.
 */
const PROBE_TIMEOUT_MS = 5_000

/**
 * Whether the server answers at all, for {@link OpenCodeConnection.alive}.
 *
 * Deliberately the same call as `usage`, asked for its *transport* rather than
 * its payload: whatever `session.get` answers, an answer at all means the server
 * is up. Reusing a recorded endpoint rather than reaching for a health route
 * keeps this workspace's rule intact — the SDK shapes here are recorded from a
 * live server, and an endpoint nothing has driven is a guess.
 *
 * Bounded, because "gone" and "wedged" both have to end as `false`: a server
 * whose event loop is stuck would otherwise hold this open for as long as the
 * socket stays half-open, on a path that only ever runs while a failure is
 * already being reported.
 */
const probeAlive = (
  client: ReturnType<typeof createOpencodeClient>,
  directory: string,
  sessionId: string,
): Promise<boolean> =>
  withDeadline(
    client.session.get({ path: { id: sessionId }, query: { directory } }),
    PROBE_TIMEOUT_MS,
    () => new Error('probe timed out'),
  ).then(
    () => true,
    () => false,
  )

/**
 * How far the session tree walk may reach. A subagent tree is shallow and
 * narrow, and the caps exist so a server reporting a pathological graph costs
 * a bounded number of requests, never the run. The parent sits at depth 0 and
 * counts toward the node cap.
 */
const SESSION_TREE_MAX_DEPTH = 8
const SESSION_TREE_MAX_NODES = 32

/**
 * The whole walk's bound — generous against loopback requests that answer in
 * milliseconds, hard against a server that has wedged mid-tree.
 */
const SESSION_TREE_TIMEOUT_MS = 2_000

/**
 * The slice of the SDK client the walk reads — the recorded `session.get` and
 * `session.children` paths, addressed with the directory on every call. The
 * envelope decoders do the rest.
 */
interface SessionTreeClient {
  session: {
    get: (args: { path: { id: string }; query: { directory: string } }) => Promise<unknown>
    children: (args: { path: { id: string }; query: { directory: string } }) => Promise<unknown>
  }
}

/**
 * The breadth-first walk behind `usage`: the session's own account plus every
 * subagent session beneath it, summed into one `SessionUsage` — the same shape
 * one `session.get` read answers, so nothing downstream changes.
 *
 * A visited set counts a cycle or a repeated id once, and the depth and node
 * caps end a walk a pathological graph would keep going — keeping the sessions
 * already gathered, a figure that cannot sum below the parent-only one, behind
 * one warning of their own. Anything else that stops the tree being read
 * whole — a children call that throws, one that never
 * settles (the whole walk sits under one deadline), one that decodes as
 * unrecognised — degrades the answer to the parent's own figure, the one the
 * budget already knew, behind one warning and no failure: the walk decorates
 * the spend read and never fails the turn or the phase. `SessionUsage` carries
 * no marker of the degradation on purpose — a partial tree that read as
 * complete would under-charge a subagent-heavy run while looking exact, and
 * absent is not zero one seam over.
 */
export const sessionTreeUsage = async (
  client: SessionTreeClient,
  directory: string,
  sessionId: string,
  log: Logger,
): Promise<SessionUsage | null> => {
  try {
    const truncated = { value: false }
    const usages = await withDeadline(
      gatherTree(client, directory, [{ id: sessionId, depth: 0 }], new Set<string>([sessionId]), [], truncated),
      SESSION_TREE_TIMEOUT_MS,
      (elapsedMs) => new Error(`the session tree walk did not settle within ${elapsedMs}ms`),
    )
    if (truncated.value)
      log.warn({ sessionId }, 'the session tree walk hit its depth or node cap; this run reports the sessions it read')
    return sumSessionUsage(usages)
  } catch (error) {
    // The degraded figure is the session's own account, re-read rather than
    // remembered: whatever the walk gathered is discarded, and the one read
    // the budget has always made is the one the answer keeps. Bounded like
    // every other read on this path — the wedge the walk deadline exists for
    // would otherwise hang the degradation itself, and a hang is not a
    // rejection, so the callers' `.catch(() => null)` never fires. Expired or
    // unreadable, the answer is absent, which the callers already warn on.
    const parent = await withDeadline(
      client.session.get({ path: { id: sessionId }, query: { directory } }),
      SESSION_TREE_TIMEOUT_MS,
      (elapsedMs) => new Error(`the degraded usage read did not settle within ${elapsedMs}ms`),
    ).then(
      (fetched) => decodeSessionUsage(fetched),
      () => null,
    )
    if (parent === null) return null
    log.warn(
      { sessionId, error: errorMessage(error) },
      'the session tree could not be read whole; this run reports the session’s own usage',
    )
    return parent
  }
}

/** Reads one session's usage and children listing off the recorded paths. */
const readNode = async (
  client: SessionTreeClient,
  directory: string,
  id: string,
): Promise<{ usage: SessionUsage; childIds: readonly string[] }> => {
  const usage = decodeSessionUsage(await client.session.get({ path: { id }, query: { directory } }))
  if (usage === null) throw new Error(`the usage read for ${id} did not decode`)
  const childIds = decodeSessionChildren(await client.session.children({ path: { id }, query: { directory } }))
  if (childIds === null) throw new Error(`the children listing for ${id} did not decode`)
  return { usage, childIds }
}

/** One node waiting to be read: its id and its depth under the root. */
interface TreeNode {
  readonly id: string
  readonly depth: number
}

/**
 * The walk itself: breadth-first from the root, the visited set counting a
 * cycle or a repeated id once, the caps ending it — recording the truncation
 * rather than degrading, since the sessions already gathered cannot sum below
 * the parent-only figure. Any other degradation throws to
 * {@link sessionTreeUsage}'s catch, which degrades to parent-only. The queue
 * is walked by recursion rather than a loop — one node per step, so the caps
 * are checked between requests and nothing reads ahead of them.
 */
const gatherTree = async (
  client: SessionTreeClient,
  directory: string,
  queue: readonly TreeNode[],
  visited: Set<string>,
  usages: SessionUsage[],
  truncated: { value: boolean },
): Promise<SessionUsage[]> => {
  const head = queue[0]
  if (head === undefined) return usages
  if (usages.length >= SESSION_TREE_MAX_NODES || head.depth >= SESSION_TREE_MAX_DEPTH) {
    truncated.value = true
    return usages
  }

  const { usage, childIds } = await readNode(client, directory, head.id)
  usages.push(usage)

  const enqueued: TreeNode[] = []
  for (const childId of childIds) {
    if (!visited.has(childId)) {
      visited.add(childId)
      enqueued.push({ id: childId, depth: head.depth + 1 })
    }
  }
  return gatherTree(client, directory, [...queue.slice(1), ...enqueued], visited, usages, truncated)
}

export const connectSdk = async (
  directory: string,
  openai: OpenAiSettings,
  log: Logger,
): Promise<OpenCodeConnection> => {
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
    usage: (sessionId) => sessionTreeUsage(client, directory, sessionId, log),
    alive: (sessionId) => probeAlive(client, directory, sessionId),
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
