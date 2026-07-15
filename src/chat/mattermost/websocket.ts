// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../logger.js'

const log = logger.child({ scope: 'chat:mattermost:websocket' })

interface ConnectMattermostWebSocketParams {
  baseUrl: string
  token: string
  nextSeq: () => number
  onMessage: (event: MessageEvent) => void
  onReconnect: () => void
}

/**
 * Opens a Mattermost realtime WebSocket connection, sends the authentication challenge on
 * open, forwards messages to `onMessage`, and schedules `onReconnect` 5s after any close.
 */
export function connectMattermostWebSocket(params: ConnectMattermostWebSocketParams): WebSocket {
  const { baseUrl, token, nextSeq, onMessage, onReconnect } = params
  const wsUrl = baseUrl.replace(/^http/u, 'ws') + '/api/v4/websocket'
  log.debug({ wsUrl }, 'Connecting to Mattermost WebSocket')
  const ws = new WebSocket(wsUrl)
  ws.addEventListener('open', () => {
    log.debug('Mattermost WebSocket connected, authenticating')
    ws.send(
      JSON.stringify({
        seq: nextSeq(),
        action: 'authentication_challenge',
        data: { token },
      }),
    )
  })
  ws.addEventListener('message', onMessage)
  ws.addEventListener('close', () => {
    log.warn('Mattermost WebSocket closed, reconnecting in 5s')
    setTimeout(onReconnect, 5000)
  })
  ws.addEventListener('error', (event) => {
    log.error({ event }, 'Mattermost WebSocket error')
  })
  return ws
}
