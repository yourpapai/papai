// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// tests/smoke/harness/fake-mattermost-server.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ServerWebSocket } from 'bun'
import { z } from 'zod'

export type IncomingPost = {
  channelId: string
  message: string
  userId: string
  userName?: string
  postId?: string
  /** Thread root the post belongs to. Omitted means channel level, as Mattermost sends it. */
  rootId?: string
}

/** One ordered write against a post: how the live-status lifecycle is observed. */
export type PostMutation =
  | { kind: 'create'; postId: string; message: string }
  | { kind: 'patch'; postId: string; message: string }
  | { kind: 'delete'; postId: string }
export type CapturedPost = { channel_id: string; message: string; root_id?: string }

export type SeededPost = {
  id: string
  channelId: string
  userId: string
  message: string
  createAt?: number
  rootId?: string
  userName?: string
}

export type FakeMattermostServer = {
  containerBaseUrl: string
  localBaseUrl: string
  botUserId: string
  botUsername: string
  whenConnected(): Promise<void>
  deliverMessage(post: IncomingPost): void
  waitForPost(timeoutMs?: number): Promise<CapturedPost>
  seedPost(post: SeededPost): void
  observedGets(): readonly string[]
  postMutations(): readonly PostMutation[]
  stop(): Promise<void>
}

const GROUP_TEAM_ID = 'team-1'
const CHANNEL_RE = /^\/api\/v4\/channels\/[^/]+$/u
const MEMBER_RE = /^\/api\/v4\/channels\/[^/]+\/members\/[^/]+$/u
const POST_SINGLE_RE = /^\/api\/v4\/posts\/([^/]+)$/u
const POST_THREAD_RE = /^\/api\/v4\/posts\/([^/]+)\/thread$/u
const POST_PATCH_RE = /^\/api\/v4\/posts\/([^/]+)\/patch$/u

const postBodySchema = z.object({
  channel_id: z.string().optional(),
  message: z.string().optional(),
  root_id: z.string().optional(),
})

const patchBodySchema = z.object({ message: z.string().optional() })

const wsFrameSchema = z.object({ action: z.string().optional() })

export function startFakeMattermostServer(
  opts: { botUserId?: string; botUsername?: string; groupChannelIds?: readonly string[] } = {},
): FakeMattermostServer {
  const botUserId = opts.botUserId ?? 'bot-user-1'
  const botUsername = opts.botUsername ?? 'smokebot'
  const groupChannelIds = new Set(opts.groupChannelIds ?? [])

  let activeWs: ServerWebSocket<unknown> | null = null
  let markConnected: () => void = () => {}
  const connected = new Promise<void>((resolve) => {
    markConnected = resolve
  })

  let inCount = 0
  let outCount = 0
  const postBuffer: CapturedPost[] = []
  const postWaiters: Array<(post: CapturedPost) => void> = []
  const seededPosts = new Map<string, SeededPost>()
  const observedGetPaths: string[] = []
  const mutations: PostMutation[] = []
  const knownPostIds = new Set<string>()

  const onPost = (post: CapturedPost): void => {
    const waiter = postWaiters.shift()
    if (waiter === undefined) postBuffer.push(post)
    else waiter(post)
  }

  const toThreadPost = (post: SeededPost): Record<string, unknown> => ({
    id: post.id,
    user_id: post.userId,
    channel_id: post.channelId,
    message: post.message,
    create_at: post.createAt ?? 0,
    ...(post.rootId === undefined ? {} : { root_id: post.rootId }),
  })

  const handleHttp = async (req: Request, url: URL): Promise<Response> => {
    const path = url.pathname
    if (req.method === 'GET') observedGetPaths.push(path)
    if (req.method === 'GET' && path === '/api/v4/users/me') {
      return Response.json({ id: botUserId, username: botUsername })
    }
    if (req.method === 'GET' && CHANNEL_RE.test(path)) {
      const channelId = path.split('/').at(-1) ?? ''
      // Everything is a DM unless the scenario declared it a group: only a non-'D'
      // channel makes the adapter thread-scope the turn's storage context id.
      if (!groupChannelIds.has(channelId)) return Response.json({ id: channelId, type: 'D' })
      return Response.json({ id: channelId, type: 'O', team_id: GROUP_TEAM_ID, display_name: channelId })
    }
    if (req.method === 'GET' && MEMBER_RE.test(path)) {
      const segments = path.split('/')
      return Response.json({ channel_id: segments[4], user_id: segments.at(-1), roles: 'channel_member' })
    }
    if (req.method === 'GET') {
      const threadMatch = POST_THREAD_RE.exec(path)
      if (threadMatch !== null) {
        const rootId = threadMatch[1] ?? ''
        const root = seededPosts.get(rootId)
        if (root === undefined) return new Response('not found', { status: 404 })
        const threadPosts = [root, ...[...seededPosts.values()].filter((p) => p.rootId === rootId)]
        const order = threadPosts.map((p) => p.id)
        const posts = Object.fromEntries(threadPosts.map((p) => [p.id, toThreadPost(p)]))
        return Response.json({ order, posts })
      }
      const singleMatch = POST_SINGLE_RE.exec(path)
      if (singleMatch !== null) {
        const post = seededPosts.get(singleMatch[1] ?? '')
        if (post === undefined) return new Response('not found', { status: 404 })
        return Response.json(toThreadPost(post))
      }
    }
    if (req.method === 'POST' && path === '/api/v4/posts') {
      const rawBody: unknown = await req.json().catch(() => ({}))
      const parsedBody = postBodySchema.safeParse(rawBody)
      const body = parsedBody.success ? parsedBody.data : {}
      outCount += 1
      const captured: CapturedPost = { channel_id: body.channel_id ?? '', message: body.message ?? '' }
      if (body.root_id !== undefined) captured.root_id = body.root_id
      onPost(captured)
      const postId = `out-${String(outCount)}`
      knownPostIds.add(postId)
      mutations.push({ kind: 'create', postId, message: body.message ?? '' })
      return Response.json({ id: postId })
    }
    if (req.method === 'PUT') {
      const patchMatch = POST_PATCH_RE.exec(path)
      if (patchMatch !== null) {
        const postId = patchMatch[1] ?? ''
        if (!knownPostIds.has(postId) && !seededPosts.has(postId)) return new Response('not found', { status: 404 })
        const rawBody: unknown = await req.json().catch(() => ({}))
        const parsed = patchBodySchema.safeParse(rawBody)
        mutations.push({ kind: 'patch', postId, message: (parsed.success ? parsed.data.message : undefined) ?? '' })
        return Response.json({ id: postId })
      }
    }
    if (req.method === 'DELETE') {
      const deleteMatch = POST_SINGLE_RE.exec(path)
      if (deleteMatch !== null) {
        const postId = deleteMatch[1] ?? ''
        if (!knownPostIds.has(postId) && !seededPosts.has(postId)) return new Response('not found', { status: 404 })
        mutations.push({ kind: 'delete', postId })
        return Response.json({ status: 'OK' })
      }
    }
    // Tolerate any other v4 GET the provider probes at startup rather than 404-crashing it.
    if (req.method === 'GET' && path.startsWith('/api/v4/')) return Response.json({})
    return new Response('not found', { status: 404 })
  }

  const server = Bun.serve({
    hostname: '0.0.0.0',
    port: 0,
    fetch(req, srv) {
      const url = new URL(req.url)
      if (url.pathname === '/api/v4/websocket') {
        return srv.upgrade(req) ? undefined : new Response('upgrade failed', { status: 400 })
      }
      return handleHttp(req, url)
    },
    websocket: {
      open(ws) {
        activeWs = ws
      },
      message(_ws, message) {
        const raw: unknown = JSON.parse(typeof message === 'string' ? message : message.toString())
        const parsed = wsFrameSchema.safeParse(raw)
        if (parsed.success && parsed.data.action === 'authentication_challenge') {
          _ws.send(JSON.stringify({ event: 'hello', data: {} }))
          markConnected()
        }
        // user_typing and any other client frames are intentionally ignored.
      },
      close() {
        activeWs = null
      },
    },
  })
  const port = server.port

  return {
    containerBaseUrl: `http://host.docker.internal:${port}`,
    localBaseUrl: `http://127.0.0.1:${port}`,
    botUserId,
    botUsername,
    whenConnected() {
      return connected
    },
    deliverMessage(post) {
      if (activeWs === null) throw new Error('deliverMessage called before the WS connected')
      inCount += 1
      const embedded = {
        id: post.postId ?? `in-${inCount}`,
        user_id: post.userId,
        channel_id: post.channelId,
        message: post.message,
        user_name: post.userName ?? post.userId,
        ...(post.rootId === undefined ? {} : { root_id: post.rootId }),
      }
      activeWs.send(
        JSON.stringify({
          event: 'posted',
          data: { post: JSON.stringify(embedded), sender_name: post.userName ?? post.userId },
        }),
      )
    },
    waitForPost(timeoutMs = 10_000) {
      const buffered = postBuffer.shift()
      if (buffered !== undefined) return Promise.resolve(buffered)
      return new Promise<CapturedPost>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out waiting for an outbound post')), timeoutMs)
        postWaiters.push((post) => {
          clearTimeout(timer)
          resolve(post)
        })
      })
    },
    seedPost(post) {
      seededPosts.set(post.id, post)
    },
    observedGets() {
      return observedGetPaths.slice()
    },
    postMutations() {
      return mutations.slice()
    },
    async stop() {
      await server.stop(true)
    },
  }
}
