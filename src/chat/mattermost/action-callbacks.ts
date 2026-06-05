// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { logger } from '../../logger.js'
import { getMattermostActionSigningSecret } from './action-secret.js'
import { verifyMattermostActionContext, type VerifiedMattermostActionContext } from './action-signing.js'

const log = logger.child({ scope: 'chat:mattermost:actions' })

export type MattermostActionPayload = Readonly<{
  userId: string
  postId: string
  channelId: string
  teamId?: string
  action: VerifiedMattermostActionContext
}>

export type MattermostActionResponse =
  | { update: { message: string; props: Record<string, unknown> } }
  | { ephemeral_text: string }
  | { error: { message: string } }

type MattermostActionDispatcher = (payload: MattermostActionPayload) => Promise<MattermostActionResponse>

const MattermostActionRequestSchema = z.object({
  user_id: z.string().min(1),
  post_id: z.string().min(1),
  channel_id: z.string().min(1),
  team_id: z.string().optional(),
  context: z.unknown(),
})

const dispatchers = new Map<string, MattermostActionDispatcher>()

export const registerMattermostActionDispatcher = (
  platformInstanceId: string,
  dispatcher: MattermostActionDispatcher,
): void => {
  dispatchers.set(platformInstanceId, dispatcher)
}

export const unregisterMattermostActionDispatcher = (platformInstanceId: string): void => {
  dispatchers.delete(platformInstanceId)
}

const json = (body: MattermostActionResponse, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const actionError = (message: string): Response => json({ error: { message } })

export function isMattermostActionPath(_req: Request, url: URL): boolean {
  return url.pathname === '/mattermost/actions'
}

export async function handleMattermostActionRequest(
  req: Request,
  deps: { getSecret?: () => string } = {},
): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) return actionError('Invalid action payload.')

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return actionError('Invalid action payload.')
  }

  const parsed = MattermostActionRequestSchema.safeParse(raw)
  if (!parsed.success) return actionError('Invalid action payload.')

  const secret = deps.getSecret?.() ?? getMattermostActionSigningSecret()
  const verification = verifyMattermostActionContext(parsed.data.context, secret)
  if (!verification.ok) return actionError('This action is no longer valid.')

  const dispatcher = dispatchers.get(verification.value.platformInstanceId)
  if (dispatcher === undefined) return json({ ephemeral_text: 'Action is no longer available.' })

  try {
    return json(
      await dispatcher({
        userId: parsed.data.user_id,
        postId: parsed.data.post_id,
        channelId: parsed.data.channel_id,
        teamId: parsed.data.team_id,
        action: verification.value,
      }),
    )
  } catch (error) {
    log.error(
      {
        platformInstanceId: verification.value.platformInstanceId,
        channelId: parsed.data.channel_id,
        postId: parsed.data.post_id,
        error: error instanceof Error ? error.message : String(error),
      },
      'Mattermost action dispatcher failed',
    )
    return actionError('Unable to process action.')
  }
}
