// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type MattermostConstructorConfig = Partial<{
  url: string
  token: string
  platformInstanceId: string
}>

export type ResolvedMattermostConfig = {
  baseUrl: string
  token: string
  platformInstanceId: string
}

export const resolveMattermostConfig = (config: MattermostConstructorConfig): ResolvedMattermostConfig => {
  const url = config.url ?? process.env['MATTERMOST_URL']
  const token = config.token ?? process.env['MATTERMOST_BOT_TOKEN']
  if (url === undefined || url.trim() === '') {
    throw new Error('MATTERMOST_URL environment variable is required')
  }
  if (token === undefined || token.trim() === '') {
    throw new Error('MATTERMOST_BOT_TOKEN environment variable is required')
  }
  return {
    baseUrl: url.replace(/\/+$/u, ''),
    token,
    platformInstanceId: config.platformInstanceId ?? 'legacy-single',
  }
}
