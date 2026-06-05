// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type MattermostConstructorConfig = Readonly<{
  baseUrl?: string
  token?: string
  platformInstanceId: string
}>

export type ResolvedMattermostConfig = {
  baseUrl: string
  token: string
  platformInstanceId: string
}

const resolvePlatformInstanceId = (platformInstanceId: string | undefined): string => {
  if (platformInstanceId === undefined || platformInstanceId.trim() === '')
    throw new Error('platformInstanceId is required')
  return platformInstanceId
}

export const resolveMattermostConfig = (config: MattermostConstructorConfig): ResolvedMattermostConfig => {
  const url = config.baseUrl
  const token = config.token
  if (url === undefined || url.trim() === '') {
    throw new Error('MATTERMOST_URL environment variable is required')
  }
  if (token === undefined || token.trim() === '') {
    throw new Error('MATTERMOST_BOT_TOKEN environment variable is required')
  }
  return {
    baseUrl: url.replace(/\/+$/u, ''),
    token,
    platformInstanceId: resolvePlatformInstanceId(config.platformInstanceId),
  }
}
