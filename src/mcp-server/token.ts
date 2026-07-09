// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHmac, timingSafeEqual } from 'node:crypto'

import { resolveInstanceConfigKey } from '../instances/config-key.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'mcp-server:token' })

/** 30 days — a token must outlast a long-running coding session. Mass-revoke by rotating the secret. */
export const PLUGIN_MCP_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30

/** Verified claims carried by a plugin-MCP binding token. */
export interface PluginMcpTokenClaims {
  storageContextId: string
  chatUserId: string
  pluginId: string
}

interface TokenEnvelope extends PluginMcpTokenClaims {
  v: 1
  exp: number
}

/**
 * Signing secret for the binding token. Defaults to a domain-separated HMAC of the instance
 * config key (so no new env var is required and rotating INSTANCE_CONFIG_KEY rotates this too);
 * a dedicated MCP_SERVER_SIGNING_SECRET overrides it for independent rotation.
 */
function getMcpTokenSigningSecret(): string {
  const override = process.env['MCP_SERVER_SIGNING_SECRET']
  if (override !== undefined && override.trim() !== '') return override.trim()
  return createHmac('sha256', resolveInstanceConfigKey()).update('mcp-plugin-token-v1').digest('base64url')
}

function sign(payload: string): string {
  return createHmac('sha256', getMcpTokenSigningSecret()).update(payload).digest('base64url')
}

function signaturesMatch(actual: string, expected: string): boolean {
  const a = Buffer.from(actual, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** Mint a signed, time-bounded token binding a brokered MCP call to a context + plugin. */
export function mintPluginMcpToken(
  claims: PluginMcpTokenClaims,
  ttlSeconds: number = PLUGIN_MCP_TOKEN_TTL_SECONDS,
): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  const envelope: TokenEnvelope = { v: 1, exp, ...claims }
  const payload = Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64url')
  return `${payload}.${sign(payload)}`
}

/** Verify a token; returns the claims or null (invalid signature, expired, or malformed). Never throws. */
export function verifyPluginMcpToken(raw: string, nowMs: number = Date.now()): PluginMcpTokenClaims | null {
  const dot = raw.indexOf('.')
  if (dot <= 0 || dot === raw.length - 1) return null
  const payload = raw.slice(0, dot)
  const sig = raw.slice(dot + 1)
  if (!signaturesMatch(sig, sign(payload))) return null
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown
    if (typeof decoded !== 'object' || decoded === null) return null
    const env = decoded as Partial<TokenEnvelope>
    if (env.v !== 1 || typeof env.exp !== 'number') return null
    if (
      typeof env.storageContextId !== 'string' ||
      typeof env.chatUserId !== 'string' ||
      typeof env.pluginId !== 'string'
    ) {
      return null
    }
    if (Math.floor(nowMs / 1000) >= env.exp) return null
    return { storageContextId: env.storageContextId, chatUserId: env.chatUserId, pluginId: env.pluginId }
  } catch (err) {
    log.debug({ error: err instanceof Error ? err.message : String(err) }, 'failed to decode mcp token payload')
    return null
  }
}
