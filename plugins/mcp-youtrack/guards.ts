// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { YouTrackClient } from './client.js'
import type { HttpFetch, PluginToolRuntimeContextLike } from './context.js'
import { YouTrackWriteClient } from './write-client.js'

export class ValidationError extends Error {}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function toRecord(input: unknown): Record<string, unknown> {
  if (!isRecord(input)) {
    throw new ValidationError('input must be an object')
  }
  return input
}

export function readRequiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value === '') {
    throw new ValidationError(`${key} must be a non-empty string`)
  }
  return value
}

export function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

export function readRecord(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = record[key]
  return isRecord(value) ? value : undefined
}

export function readRequiredRecord(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = readRecord(record, key)
  if (value === undefined) {
    throw new ValidationError(`${key} must be an object`)
  }
  return value
}

export function readStringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key]
  if (!Array.isArray(value)) {
    throw new ValidationError(`${key} must be an array of strings`)
  }
  return value.filter((item): item is string => typeof item === 'string')
}

export type IssueLinkDirection = 'sourceToTarget' | 'targetToSource'

export function readDirection(record: Record<string, unknown>, key: string): IssueLinkDirection {
  const value = readRequiredString(record, key)
  if (value !== 'sourceToTarget' && value !== 'targetToSource') {
    throw new ValidationError(`${key} must be one of sourceToTarget, targetToSource`)
  }
  return value
}

function resolveRateLimitActorId(runtimeContext: PluginToolRuntimeContextLike): string {
  if (runtimeContext.chatUserId !== '') return runtimeContext.chatUserId
  return runtimeContext.storageContextId
}

type YouTrackCreds = { baseUrl: string; token: string }

function readCreds(runtimeContext: PluginToolRuntimeContextLike): YouTrackCreds | undefined {
  const baseUrl = runtimeContext.adminConfig.get('base_url')
  const token = runtimeContext.contextConfig.get('token')
  if (baseUrl === undefined || token === undefined) return undefined
  return { baseUrl, token }
}

function buildExecutionError(err: unknown): unknown {
  if (err instanceof ValidationError) {
    return { error: 'validation_error', message: err.message }
  }
  const message = err instanceof Error ? err.message : String(err)
  if (err instanceof Error && err.name === 'AbortError') {
    return { error: 'timeout', message }
  }
  return { error: 'youtrack_error', message }
}

async function withGuards<TClient>(
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
  buildClient: (creds: YouTrackCreds, httpFetch: HttpFetch) => TClient,
  run: (client: TClient) => Promise<unknown>,
): Promise<unknown> {
  const rateResult = runtimeContext.rateLimit.check(resolveRateLimitActorId(runtimeContext))
  if (!rateResult.allowed) {
    return { error: 'rate_limited', retryAfterSec: rateResult.retryAfterSec }
  }

  const creds = readCreds(runtimeContext)
  if (creds === undefined || httpFetch === undefined) {
    return { error: 'not_configured', message: 'YouTrack is not configured' }
  }

  try {
    return await run(buildClient(creds, httpFetch))
  } catch (err) {
    return buildExecutionError(err)
  }
}

export function withYouTrackGuards(
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
  run: (client: YouTrackClient) => Promise<unknown>,
): Promise<unknown> {
  return withGuards(
    runtimeContext,
    httpFetch,
    (creds, fetch) => new YouTrackClient({ baseUrl: creds.baseUrl, token: creds.token, httpFetch: fetch }),
    run,
  )
}

export function withYouTrackWriteGuards(
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
  run: (client: YouTrackWriteClient) => Promise<unknown>,
): Promise<unknown> {
  return withGuards(
    runtimeContext,
    httpFetch,
    (creds, fetch) => new YouTrackWriteClient({ baseUrl: creds.baseUrl, token: creds.token, httpFetch: fetch }),
    run,
  )
}

export type YouTrackToolDefinition = {
  name: string
  description: string
  inputSchema: unknown
  execute: (input: unknown, runtimeContext: PluginToolRuntimeContextLike) => Promise<unknown>
}
