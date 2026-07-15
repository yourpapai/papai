// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'

import { logger } from '../../logger.js'
import { MattermostPostListSchema, type MattermostThreadPost } from './schema.js'

const log = logger.child({ scope: 'chat:mattermost:catch-up' })

export interface CatchUpDeps {
  apiFetch: (method: string, path: string) => Promise<unknown>
  listContexts: (platformInstanceId: string) => { contextId: string }[]
  getCursor: (platformInstanceId: string) => number | null
  getCachedMessage: (contextId: string, messageId: string) => unknown
  replayPost: (post: MattermostThreadPost) => Promise<void>
  cachePostOnly: (post: MattermostThreadPost) => Promise<void>
  now: () => number
}

export interface CatchUpConfig {
  perChannelCap: number
  stalenessMs: number
  concurrency: number
}

/** Order posts oldest -> newest, dropping any id in `order` missing from `posts`. */
function orderedPosts(list: { order: string[]; posts: Record<string, MattermostThreadPost> }): MattermostThreadPost[] {
  return list.order
    .map((id) => list.posts[id])
    .filter((p): p is MattermostThreadPost => p !== undefined)
    .sort((a, b) => a.create_at - b.create_at)
}

/** Thread-reply/empty posts are never replayed or cached during catch-up. */
function isSkippable(post: MattermostThreadPost): boolean {
  return Boolean(post.root_id) || post.message === ''
}

function isProcessed(cached: unknown): boolean {
  return cached !== null && cached !== undefined
}

async function applyPost(
  contextId: string,
  post: MattermostThreadPost,
  deps: CatchUpDeps,
  cfg: CatchUpConfig,
): Promise<void> {
  if (isSkippable(post)) return
  if (isProcessed(deps.getCachedMessage(contextId, post.id))) return
  if (deps.now() - post.create_at > cfg.stalenessMs) {
    await deps.cachePostOnly(post)
    return
  }
  await deps.replayPost(post)
}

async function catchUpChannel(contextId: string, cursor: number, deps: CatchUpDeps, cfg: CatchUpConfig): Promise<void> {
  const raw = await deps.apiFetch('GET', `/api/v4/channels/${contextId}/posts?since=${cursor}`)
  const list = MattermostPostListSchema.parse(raw)
  const ordered = orderedPosts(list)
  const capped = ordered.slice(Math.max(0, ordered.length - cfg.perChannelCap))
  // Posts within a channel are applied oldest-first, one at a time (concurrency 1)
  // to preserve ordering while staying clear of await-in-loop.
  const sequential = pLimit(1)
  await Promise.all(capped.map((post) => sequential(() => applyPost(contextId, post, deps, cfg))))
}

/**
 * On reconnect, backfill posts missed since the last-seen cursor for every known
 * context of a Mattermost platform instance. Best-effort per channel: one
 * channel's failure is logged and does not abort the others. A null cursor means
 * there is no baseline to backfill from, so catch-up is skipped entirely.
 */
export async function runMattermostCatchUp(
  platformInstanceId: string,
  deps: CatchUpDeps,
  cfg: CatchUpConfig,
): Promise<void> {
  const cursor = deps.getCursor(platformInstanceId)
  if (cursor === null) return

  const limit = pLimit(cfg.concurrency)
  await Promise.all(
    deps.listContexts(platformInstanceId).map((ctx) =>
      limit(async () => {
        try {
          await catchUpChannel(ctx.contextId, cursor, deps, cfg)
        } catch (error) {
          log.warn({ err: error, contextId: ctx.contextId }, 'mattermost catch-up failed for channel')
        }
      }),
    ),
  )
}
