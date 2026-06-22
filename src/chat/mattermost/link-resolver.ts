// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'

import type { AppError } from '../../errors.js'
import { providerError, systemError } from '../../errors.js'
import { getPlatformInstance } from '../../instances/platform-store.js'
import { logger } from '../../logger.js'
import { makeMattermostApiFetch, MattermostApiError } from './api-fetch.js'
import type { MattermostApiFetch } from './file-helpers.js'
import { resolveMattermostUserLabel } from './label-helpers.js'
import {
  ChannelInfoSchema,
  MattermostPostListSchema,
  MattermostThreadPostSchema,
  type MattermostThreadPost,
} from './schema.js'

const PERMALINK_PATTERN = /\/pl\/([a-z0-9]+)\/?$/iu
const MAX_THREAD_POSTS = 100

/**
 * Return the Mattermost post id from a permalink, but only when the link's host
 * matches the instance baseUrl host and the path is a `/pl/<postId>` permalink.
 * Returns null otherwise. The URL is parsed for identifiers only — never fetched.
 */
export function parseMattermostPermalink(url: string, baseUrl: string): string | null {
  let parsed: URL
  let base: URL
  try {
    parsed = new URL(url)
    base = new URL(baseUrl)
  } catch {
    return null
  }
  if (parsed.host !== base.host) return null
  const match = PERMALINK_PATTERN.exec(parsed.pathname)
  if (match === null) return null
  return match[1] ?? null
}

const log = logger.child({ scope: 'chat:mattermost:link-resolver' })

export type ChatLinkScope = 'post' | 'thread'

export interface ChatLinkMessage {
  authorId: string
  author: string
  timestamp: string
  text: string
  isRoot: boolean
  isLinked: boolean
}

export interface ChatLinkResult {
  source: 'mattermost'
  channelId: string
  rootPostId: string
  linkedPostId: string
  scope: ChatLinkScope
  messages: ChatLinkMessage[]
  truncated?: boolean
}

export interface ResolveChatLinkArgs {
  platformInstanceId: string
  requesterUserId: string
  url: string
  scope: ChatLinkScope
  apiFetchFactory?: typeof makeMattermostApiFetch
}

/** Error carrying an AppError; recognised by buildToolFailureResult and expectAppError. */
export class ChatLinkError extends Error {
  constructor(
    message: string,
    readonly appError: AppError,
  ) {
    super(message)
    this.name = 'ChatLinkError'
  }
}

function toChatLinkError(e: unknown, postId: string): ChatLinkError {
  if (e instanceof ChatLinkError) return e
  if (e instanceof MattermostApiError) {
    if (e.status === 403 || e.status === 404) {
      return new ChatLinkError(`Post ${postId} not accessible`, providerError.notFound('Chat message', postId))
    }
    if (e.status === 429) {
      return new ChatLinkError('Mattermost rate limited', providerError.rateLimited())
    }
    return new ChatLinkError(
      `Mattermost API error ${e.status}`,
      systemError.networkError(`Mattermost returned ${e.status}`),
    )
  }
  const message = e instanceof Error ? e.message : String(e)
  return new ChatLinkError(message, systemError.networkError(message))
}

function loadMattermostInstance(
  platformInstanceId: string,
  factory: typeof makeMattermostApiFetch,
): { apiFetch: MattermostApiFetch; baseUrl: string } {
  const instance = getPlatformInstance(platformInstanceId)
  if (instance === null || instance.type !== 'mattermost') {
    throw new ChatLinkError('Mattermost instance unavailable', systemError.configMissing('mattermost instance'))
  }
  const baseUrl = instance.config['baseUrl']
  const token = instance.config['token']
  if (baseUrl === undefined || token === undefined) {
    throw new ChatLinkError('Mattermost config incomplete', systemError.configMissing('mattermost baseUrl/token'))
  }
  return { apiFetch: factory(baseUrl, token), baseUrl }
}

// Mattermost channel type for an open (public) channel; `P` is private, `D`/`G` direct.
const OPEN_CHANNEL_TYPE = 'O'

/** True when the requester has an explicit membership record for the channel. */
async function isRequesterChannelMember(
  apiFetch: MattermostApiFetch,
  channelId: string,
  requesterUserId: string,
  postId: string,
): Promise<boolean> {
  try {
    await apiFetch(
      'GET',
      `/api/v4/channels/${encodeURIComponent(channelId)}/members/${encodeURIComponent(requesterUserId)}`,
      undefined,
    )
    return true
  } catch (e) {
    // 403/404 are the "no membership record" signals. Surface anything else
    // (rate limit, 5xx) as a classified error instead of masking it as a denial.
    if (e instanceof MattermostApiError && (e.status === 403 || e.status === 404)) return false
    throw toChatLinkError(e, postId)
  }
}

/**
 * True when the channel is an open (public) channel the bot can see. Public
 * channels are readable by anyone in the workspace without an explicit
 * membership record, mirroring Mattermost's `read_public_channels` access model.
 */
async function isOpenChannel(apiFetch: MattermostApiFetch, channelId: string): Promise<boolean> {
  try {
    const raw = await apiFetch('GET', `/api/v4/channels/${encodeURIComponent(channelId)}`, undefined)
    return ChannelInfoSchema.parse(raw).type === OPEN_CHANNEL_TYPE
  } catch {
    // If the channel metadata can't be read (private / not visible), it is not public.
    return false
  }
}

/**
 * Authorize the requester to read the linked channel. A direct membership record
 * is the fast path; a non-member is still allowed when the channel is public, so
 * "public and open to everyone" channels work. Otherwise the denial is the
 * requester's own lack of access — never framed as the bot not being a member.
 */
async function assertRequesterAccess(
  apiFetch: MattermostApiFetch,
  channelId: string,
  requesterUserId: string,
  postId: string,
): Promise<void> {
  if (await isRequesterChannelMember(apiFetch, channelId, requesterUserId, postId)) return
  if (await isOpenChannel(apiFetch, channelId)) return
  throw new ChatLinkError(
    `Requester ${requesterUserId} cannot access channel ${channelId} for post ${postId}`,
    providerError.accessDenied('that chat channel'),
  )
}

function toMessage(post: MattermostThreadPost, rootId: string, linkedId: string, author: string): ChatLinkMessage {
  return {
    authorId: post.user_id,
    author,
    timestamp: new Date(post.create_at).toISOString(),
    text: post.message,
    isRoot: post.id === rootId,
    isLinked: post.id === linkedId,
  }
}

async function fetchThreadPosts(
  apiFetch: MattermostApiFetch,
  rootId: string,
  postId: string,
): Promise<{ posts: MattermostThreadPost[]; truncated: boolean }> {
  let list
  try {
    const raw = await apiFetch('GET', `/api/v4/posts/${encodeURIComponent(rootId)}/thread`, undefined)
    list = MattermostPostListSchema.parse(raw)
  } catch (e) {
    throw toChatLinkError(e, postId)
  }
  const ordered = list.order
    .map((id) => list.posts[id])
    .filter((p): p is MattermostThreadPost => p !== undefined)
    .sort((a, b) => a.create_at - b.create_at)
  if (ordered.length > MAX_THREAD_POSTS) {
    return { posts: ordered.slice(0, MAX_THREAD_POSTS), truncated: true }
  }
  return { posts: ordered, truncated: false }
}

async function resolveAuthorLabels(
  apiFetch: MattermostApiFetch,
  posts: readonly MattermostThreadPost[],
): Promise<Map<string, string>> {
  const distinct = [...new Set(posts.map((p) => p.user_id))]
  const limit = pLimit(5)
  const cache = new Map<string, string>()
  await Promise.all(
    distinct.map((userId) =>
      limit(async () => {
        const label = await resolveMattermostUserLabel(apiFetch, userId)
        cache.set(userId, label ?? userId)
      }),
    ),
  )
  return cache
}

async function buildResult(
  apiFetch: MattermostApiFetch,
  linked: MattermostThreadPost,
  postId: string,
  scope: ChatLinkScope,
  platformInstanceId: string,
): Promise<ChatLinkResult> {
  const channelId = linked.channel_id
  const rootId = linked.root_id !== undefined && linked.root_id !== '' ? linked.root_id : linked.id
  const selection =
    scope === 'thread' ? await fetchThreadPosts(apiFetch, rootId, postId) : { posts: [linked], truncated: false }

  const labels = await resolveAuthorLabels(apiFetch, selection.posts)
  const messages = selection.posts.map((post) =>
    toMessage(post, rootId, postId, labels.get(post.user_id) ?? post.user_id),
  )

  log.info(
    { platformInstanceId, channelId, postId, scope, count: messages.length, truncated: selection.truncated },
    'fetch_chat_link resolved',
  )
  const result: ChatLinkResult = {
    source: 'mattermost',
    channelId,
    rootPostId: rootId,
    linkedPostId: postId,
    scope,
    messages,
  }
  if (selection.truncated) result.truncated = true
  return result
}

export async function resolveChatLink(args: ResolveChatLinkArgs): Promise<ChatLinkResult> {
  const { platformInstanceId, requesterUserId, url, scope } = args
  const factory = args.apiFetchFactory ?? makeMattermostApiFetch
  const { apiFetch, baseUrl } = loadMattermostInstance(platformInstanceId, factory)

  const postId = parseMattermostPermalink(url, baseUrl)
  if (postId === null) {
    throw new ChatLinkError('Not a Mattermost permalink for this workspace', {
      type: 'validation',
      code: 'invalid-input',
      field: 'url',
      reason: 'not a Mattermost permalink for this workspace',
    })
  }
  log.debug({ platformInstanceId, postId, scope }, 'resolveChatLink')

  let linked: MattermostThreadPost
  try {
    const raw = await apiFetch('GET', `/api/v4/posts/${encodeURIComponent(postId)}`, undefined)
    linked = MattermostThreadPostSchema.parse(raw)
  } catch (e) {
    throw toChatLinkError(e, postId)
  }

  await assertRequesterAccess(apiFetch, linked.channel_id, requesterUserId, postId)
  return buildResult(apiFetch, linked, postId, scope, platformInstanceId)
}
