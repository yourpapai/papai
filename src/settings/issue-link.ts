// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../logger.js'
import { type AuthCodePrincipal, issueAuthCode } from './auth-code-store.js'
import { buildSettingsUrlFromBase, getSettingsPublicBaseUrl } from './config.js'
import { consumeSettingsQuota } from './rate-limit.js'

const log = logger.child({ scope: 'settings:issue-link' })

/** Max settings links a single principal may request per window. */
export const ISSUE_LIMIT = 5
export const ISSUE_WINDOW_MS = 10 * 60 * 1000

export type IssueSettingsLinkResult =
  | { readonly kind: 'ok'; readonly url: string }
  | { readonly kind: 'not_configured' }
  | { readonly kind: 'rate_limited'; readonly retryAfterSec: number }

export function issueSettingsLink(principal: AuthCodePrincipal, nowMs: number = Date.now()): IssueSettingsLinkResult {
  const base = getSettingsPublicBaseUrl()
  if (base === null) return { kind: 'not_configured' }

  const actorId = `${principal.platformInstanceId}:${principal.platformUserId}`
  const quota = consumeSettingsQuota('issue', actorId, ISSUE_LIMIT, ISSUE_WINDOW_MS, nowMs)
  if (!quota.allowed) return { kind: 'rate_limited', retryAfterSec: quota.retryAfterSec }

  const code = issueAuthCode(principal, nowMs)
  log.info({ platformInstanceId: principal.platformInstanceId }, 'Issued settings link')
  return { kind: 'ok', url: buildSettingsUrlFromBase(base, code) }
}
