// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { listContextsByPlatformInstance } from '../../instances/context-store.js'
import { getMattermostLastEventAt } from '../../instances/platform-store.js'
import { logger } from '../../logger.js'
import { getCachedMessage } from '../../message-cache/index.js'
import { runMattermostCatchUp, type CatchUpDeps } from './catch-up.js'
import { getCatchupConfig } from './catchup-config.js'
import type { MattermostApiFetch } from './file-helpers.js'
import type { MattermostPost } from './schema.js'

const log = logger.child({ scope: 'chat:mattermost:catch-up' })

/** The provider hooks {@link buildMattermostCatchUpDeps} wires into a {@link CatchUpDeps}. */
export interface MattermostCatchUpProviderHooks {
  apiFetch: MattermostApiFetch
  replayPost: (post: MattermostPost, senderName: string | undefined) => Promise<void>
  cachePostOnly: (post: MattermostPost, senderName: string | undefined) => Promise<void>
}

/**
 * Wires a Mattermost provider's live API/pipeline hooks into the shape T3's
 * `runMattermostCatchUp` expects. Kept out of `index.ts` to stay clear of that file's
 * 300-line budget.
 */
export function buildMattermostCatchUpDeps(hooks: MattermostCatchUpProviderHooks): CatchUpDeps {
  return {
    apiFetch: (method, path) => hooks.apiFetch(method, path, undefined),
    listContexts: (platformInstanceId) =>
      listContextsByPlatformInstance(platformInstanceId).map((context) => ({ contextId: context.contextId })),
    getCursor: getMattermostLastEventAt,
    getCachedMessage,
    replayPost: (post) => hooks.replayPost(post, post.user_name),
    cachePostOnly: (post) => hooks.cachePostOnly(post, post.user_name),
    now: () => Date.now(),
  }
}

/**
 * Best-effort, fire-and-forget catch-up kickoff for a `hello` (re)connect event: never blocks
 * or throws out of the WebSocket message handler that calls it.
 */
export function triggerMattermostCatchUpOnHello(
  platformInstanceId: string,
  apiFetch: MattermostApiFetch,
  replayPost: MattermostCatchUpProviderHooks['replayPost'],
  cachePostOnly: MattermostCatchUpProviderHooks['cachePostOnly'],
): void {
  const deps = buildMattermostCatchUpDeps({ apiFetch, replayPost, cachePostOnly })
  void runMattermostCatchUp(platformInstanceId, deps, getCatchupConfig()).catch((error: unknown) => {
    log.warn({ err: error }, 'mattermost catch-up run failed')
  })
}
