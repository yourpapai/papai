// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import {
  classifyProviderError,
  classifyStatusClass,
  createProviderRequestClock,
} from '../../src/analytics/provider-observer.js'
import { requireProviderRequestScope, type ProviderRequestScope } from '../../src/analytics/provider-request-scope.js'
import { logger } from '../../src/logger.js'

const log = logger.child({ scope: 'kaneo:provision' })

// Provision-specific schemas kept local as they are for auth endpoints, not Kaneo API
const SignUpResponseSchema = z.object({
  user: z.object({ id: z.string() }),
  token: z.string(),
})
const OrgResponseSchema = z.object({ id: z.string(), slug: z.string() })
const ApiKeyResponseSchema = z.object({ key: z.string() })

export type ProvisionResult = {
  email: string
  password: string
  /** Better Auth API key (preferred) or session cookie (fallback). */
  kaneoKey: string
  workspaceId: string
}

function generatePassword(): string {
  const uuid = crypto.randomUUID().replaceAll('-', '')
  return `${uuid.slice(0, 20)}Aa1!`
}

/** Emits the controlled provisioning observation; never throws, never carries request/response content. */
const observeProvisionRequest = (
  scope: ProviderRequestScope,
  clock: Readonly<{ elapsedMs: () => number }>,
  caught: unknown,
  status: number | null,
): void => {
  if (scope.kind !== 'actor') return
  const failed = caught !== null || (status !== null && status >= 400)
  const classification =
    caught === null
      ? { statusClass: classifyStatusClass(status ?? 200), retryable: null }
      : classifyProviderError(caught)
  try {
    scope.observeProviderRequest(scope.requestContext, {
      provider: 'kaneo',
      operation: 'create',
      durationMs: clock.elapsedMs(),
      outcome: failed ? 'failure' : 'success',
      statusClass: classification.statusClass,
      retryable: classification.retryable,
    })
  } catch {
    // Observation must never change provisioning behavior.
  }
}

/** Observed fetch for provisioning auth traffic; the active frame is resolved per request, never snapshot. */
async function provisionFetch(url: string, init: RequestInit): Promise<Response> {
  const scope = requireProviderRequestScope()
  const clock = createProviderRequestClock()
  let caught: unknown = null
  let status: number | null = null
  try {
    const res = await fetch(url, init)
    status = res.status
    return res
  } catch (error: unknown) {
    caught = error
    throw error
  } finally {
    observeProvisionRequest(scope, clock, caught, status)
  }
}

async function doSignUp(
  baseUrl: string,
  publicUrl: string,
  email: string,
  password: string,
  name: string,
): Promise<string> {
  log.debug('Kaneo sign-up')
  const res = await provisionFetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  })
  if (!res.ok) {
    throw new Error(`Sign-up failed (${res.status}): ${await res.text()}`)
  }
  const rawData: unknown = await res.json()
  const parsed = SignUpResponseSchema.safeParse(rawData)
  if (!parsed.success) throw new Error('Sign-up returned invalid data')
  log.debug('Kaneo sign-up complete')

  const setCookies = res.headers.getSetCookie()
  // In HTTPS deployments better-auth prefixes the cookie name with __Secure-,
  // so match on substring rather than exact prefix.
  const sessionHeader = setCookies.find((h) => h.includes('better-auth.session_token='))
  if (sessionHeader !== undefined) {
    // Extract just the name=value pair (drop Secure/HttpOnly/Path/Max-Age attrs).
    // Keep the full cookie name including any __Secure- prefix — the name must
    // match exactly when sent back in the Cookie header.
    return sessionHeader.split(';')[0]!
  }

  // better-auth may not set a cookie when called from a server-side context
  // (e.g. behind a reverse proxy with no client IP). Fall back to constructing
  // the cookie from the token returned in the JSON body.
  // Use the public/auth-facing URL to decide whether better-auth would emit a
  // secure-prefixed cookie. Internal API traffic may be HTTP behind a proxy.
  const cookieName = publicUrl.startsWith('https://')
    ? '__Secure-better-auth.session_token'
    : 'better-auth.session_token'
  log.debug({ cookieName }, 'No session cookie in sign-up response; constructing from JSON token')
  return `${cookieName}=${parsed.data.token}`
}

async function doCreateWorkspace(
  baseUrl: string,
  trustedOrigin: string,
  sessionCookie: string,
  name: string,
  slug: string,
): Promise<string> {
  log.debug('Creating Kaneo workspace')
  const res = await provisionFetch(`${baseUrl}/api/auth/organization/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: sessionCookie,
      Origin: trustedOrigin,
    },
    body: JSON.stringify({ name, slug }),
  })
  if (!res.ok) {
    throw new Error(`Workspace creation failed (${res.status}): ${await res.text()}`)
  }
  const rawData: unknown = await res.json()
  const parsed = OrgResponseSchema.safeParse(rawData)
  if (!parsed.success) throw new Error('Workspace creation returned invalid data')
  return parsed.data.id
}

async function doCreateApiKey(baseUrl: string, trustedOrigin: string, sessionCookie: string): Promise<string> {
  const res = await provisionFetch(`${baseUrl}/api/auth/api-key/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: sessionCookie, Origin: trustedOrigin },
    body: JSON.stringify({ name: 'papai-bot' }),
  })
  if (!res.ok) throw new Error(`API key creation failed (${res.status}): ${await res.text()}`)
  const rawData: unknown = await res.json()
  const parsed = ApiKeyResponseSchema.safeParse(rawData)
  if (!parsed.success) throw new Error('API key response invalid')
  return parsed.data.key
}

/**
 * Provisions a new Kaneo account for a Telegram user:
 * signs up, creates a workspace, and generates an API key (falling back to
 * the session token if the API key endpoint is unavailable).
 */
export async function provisionKaneoUser(
  /** Internal API base URL (e.g. http://kaneo-api:1337) */
  baseUrl: string,
  /** Public-facing web client URL — used as the trusted Origin for all auth requests. */
  publicUrl: string,
  platformUserId: string,
  username: string | null,
): Promise<ProvisionResult> {
  const uniqueSuffix = crypto.randomUUID().replaceAll('-', '').slice(0, 8)
  const email = username === null ? `${platformUserId}-${uniqueSuffix}@pap.ai` : `${username}-${uniqueSuffix}@pap.ai`
  const password = generatePassword()
  const name = username === null ? `User ${platformUserId}` : `@${username}`
  const slug = `papai-${platformUserId}-${uniqueSuffix}`

  log.info({ platformUserId }, 'Provisioning Kaneo user account')
  const trustedOrigin = publicUrl === '' ? baseUrl : publicUrl
  const sessionCookie = await doSignUp(baseUrl, publicUrl, email, password, name)
  const workspaceId = await doCreateWorkspace(baseUrl, trustedOrigin, sessionCookie, name, slug)

  let kaneoKey = sessionCookie
  try {
    kaneoKey = await doCreateApiKey(baseUrl, trustedOrigin, sessionCookie)
    log.info({ platformUserId }, 'Created API key for provisioned user')
  } catch {
    log.warn(
      { platformUserId, errorClass: 'api_key_create_failed' },
      'API key endpoint unavailable — using session token as key',
    )
  }

  log.info({ platformUserId, workspaceId }, 'Kaneo user provisioned')
  return { email, password, kaneoKey, workspaceId }
}
