// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { consumeQuota } from '../web/rate-limit.js'
import type { RateLimitResult } from '../web/types.js'

// Plugin self-throttle quota. Deliberately a SEPARATE pool from web_fetch:
// transcription and web fetching must not drain each other. Keyed per
// (plugin, actor) via a namespaced bucket so one actor cannot starve another
// (e.g. one chatty voice user must not exhaust a whole group's transcription
// budget). Larger than the 20/5-min web-fetch limit because voice-first users
// legitimately send many notes in a short window.
export const PLUGIN_QUOTA_WINDOW_MS = 5 * 60 * 1000
export const PLUGIN_QUOTA_LIMIT = 60

/**
 * Consume one unit of a plugin's self-throttle quota for the given actor.
 *
 * Mutating: every allowed call decrements the remaining budget. Callers should
 * pass a stable per-user actor id (e.g. `chatUserId`) so the limit is fair
 * across members of a shared group context.
 */
export function consumePluginQuota(pluginId: string, actorId: string, nowMs?: number): RateLimitResult {
  return consumeQuota(`plugin:${pluginId}:${actorId}`, PLUGIN_QUOTA_LIMIT, PLUGIN_QUOTA_WINDOW_MS, nowMs)
}
