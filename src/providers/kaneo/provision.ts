// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { userCachesForTesting, clearCachedTools } from '../../cache.js'
import type { ReplyFn } from '../../chat/types.js'
import { getConfig, setConfig } from '../../config.js'
import { getContextSettings } from '../../instances/context-store.js'
import { getTaskInstance } from '../../instances/task-store.js'
import { logger } from '../../logger.js'
import { getKaneoWorkspace, setKaneoWorkspace } from '../../users.js'

const log = logger.child({ scope: 'kaneo:provision' })

// Provision-specific schemas kept local as they are for auth endpoints, not Kaneo API
const SignUpResponseSchema = z.object({
  user: z.object({ id: z.string() }),
  token: z.string(),
})
const OrgResponseSchema = z.object({ id: z.string(), slug: z.string() })
const ApiKeyResponseSchema = z.object({ key: z.string() })

type ProvisionResult = {
  email: string
  password: string
  /** Better Auth API key (preferred) or session cookie (fallback). */
  kaneoKey: string
  workspaceId: string
}

type NormalizedProvisionConfig = Readonly<{
  publicUrl: string
  internalUrl: string | undefined
}>

const REGISTRATION_DISABLED_MARKERS = ['signup_disabled', 'registration disabled', 'sign up is disabled'] as const

function getTaskInstancePublicUrl(config: Readonly<Record<string, string>>): string | undefined {
  const baseUrl = config['baseUrl']
  if (baseUrl !== undefined) return baseUrl
  return config['url']
}

function generatePassword(): string {
  const uuid = crypto.randomUUID().replaceAll('-', '')
  return `${uuid.slice(0, 20)}Aa1!`
}

function isRegistrationDisabledErrorMessage(message: string): boolean {
  const normalizedMessage = message.toLowerCase()
  return REGISTRATION_DISABLED_MARKERS.some((marker) => normalizedMessage.includes(marker))
}

function clearProvisionedContextToolCaches(contextId: string): void {
  clearCachedTools(contextId)
  const groupScopedPrefix = `${contextId}:`
  for (const cacheKey of userCachesForTesting.keys()) {
    if (cacheKey.startsWith(groupScopedPrefix)) {
      clearCachedTools(cacheKey)
    }
  }
}

async function doSignUp(
  baseUrl: string,
  publicUrl: string,
  email: string,
  password: string,
  name: string,
): Promise<string> {
  log.debug({ email }, 'Kaneo sign-up')
  const res = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
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
  log.debug({ userId: parsed.data.user.id }, 'Kaneo sign-up complete')

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
  log.debug({ email, cookieName }, 'No session cookie in sign-up response; constructing from JSON token')
  return `${cookieName}=${parsed.data.token}`
}

async function doCreateWorkspace(
  baseUrl: string,
  trustedOrigin: string,
  sessionCookie: string,
  name: string,
  slug: string,
): Promise<string> {
  log.debug({ name }, 'Creating Kaneo workspace')
  const res = await fetch(`${baseUrl}/api/auth/organization/create`, {
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
  const res = await fetch(`${baseUrl}/api/auth/api-key/create`, {
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

  log.info({ platformUserId, email }, 'Provisioning Kaneo user account')
  const trustedOrigin = publicUrl === '' ? baseUrl : publicUrl
  const sessionCookie = await doSignUp(baseUrl, publicUrl, email, password, name)
  const workspaceId = await doCreateWorkspace(baseUrl, trustedOrigin, sessionCookie, name, slug)

  let kaneoKey = sessionCookie
  try {
    kaneoKey = await doCreateApiKey(baseUrl, trustedOrigin, sessionCookie)
    log.info({ platformUserId }, 'Created API key for provisioned user')
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    log.warn({ platformUserId, error: msg }, 'API key endpoint unavailable — using session token as key')
  }

  log.info({ platformUserId, workspaceId }, 'Kaneo user provisioned')
  return { email, password, kaneoKey, workspaceId }
}

export type ProvisionOutcome =
  | {
      status: 'provisioned'
      email: string
      password: string
      kaneoUrl: string
      apiKey: string
      workspaceId: string
    }
  | { status: 'registration_disabled' }
  | { status: 'failed'; error: string }

export type ProvisionConfig = Readonly<{
  publicUrl: string | undefined
  internalUrl: string | undefined
}>

function normalizeProvisionConfig(config: ProvisionConfig): NormalizedProvisionConfig | null {
  const publicUrl = config.publicUrl
  if (publicUrl === undefined) return null
  const trimmedPublicUrl = publicUrl.trim()
  if (trimmedPublicUrl === '') return null

  const internalUrl = config.internalUrl
  if (internalUrl === undefined) return { publicUrl: trimmedPublicUrl, internalUrl: undefined }
  const trimmedInternalUrl = internalUrl.trim()
  if (trimmedInternalUrl === '') return { publicUrl: trimmedPublicUrl, internalUrl: undefined }
  return { publicUrl: trimmedPublicUrl, internalUrl: trimmedInternalUrl }
}

export async function provisionAndConfigure(
  userId: string,
  username: string | null,
  config: ProvisionConfig,
): Promise<ProvisionOutcome> {
  const normalizedConfig = normalizeProvisionConfig(config)
  if (normalizedConfig === null) return { status: 'failed', error: 'Kaneo task instance public URL is missing' }

  try {
    const kaneoUrl = normalizedConfig.publicUrl
    let kaneoInternalUrl = kaneoUrl
    if (normalizedConfig.internalUrl !== undefined) {
      kaneoInternalUrl = normalizedConfig.internalUrl
    }
    const result = await provisionKaneoUser(kaneoInternalUrl, kaneoUrl, userId, username)
    setConfig(userId, 'kaneo_apikey', result.kaneoKey)
    setKaneoWorkspace(userId, result.workspaceId)
    clearProvisionedContextToolCaches(userId)
    log.info({ userId }, 'Kaneo account provisioned and configured')
    return {
      status: 'provisioned',
      email: result.email,
      password: result.password,
      kaneoUrl,
      apiKey: result.kaneoKey,
      workspaceId: result.workspaceId,
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    log.warn({ userId, error: msg }, 'Kaneo provisioning failed')
    if (isRegistrationDisabledErrorMessage(msg)) return { status: 'registration_disabled' }
    return { status: 'failed', error: msg }
  }
}

const provLog = logger.child({ scope: 'kaneo:auto-provision' })

/**
 * Auto-provisions a Kaneo account for a context assigned to an active Kaneo task instance.
 * Unassigned contexts return without provisioning; /config owns task-instance assignment.
 */
export async function maybeProvisionKaneo(reply: ReplyFn, contextId: string, username: string | null): Promise<void> {
  const settings = getContextSettings(contextId)
  if (settings === null) return
  const taskInstance = getTaskInstance(settings.taskInstanceId)
  if (taskInstance === null || taskInstance.status !== 'active' || taskInstance.type !== 'kaneo') return

  if (getKaneoWorkspace(contextId) !== null && getConfig(contextId, 'kaneo_apikey') !== null) {
    return
  }

  const publicUrl = getTaskInstancePublicUrl(taskInstance.config)
  const internalUrl = taskInstance.config['internalUrl']

  provLog.info({ contextId, username }, 'Auto-provisioning Kaneo account')
  const outcome = await provisionAndConfigure(contextId, username, { publicUrl, internalUrl })

  if (outcome.status === 'provisioned') {
    await reply.text(
      `✅ Your Kaneo account has been created!\n🌐 ${outcome.kaneoUrl}\n📧 Email: ${outcome.email}\n🔑 Password: ${outcome.password}\n\nThe bot is already configured and ready to use.`,
    )
    provLog.info({ contextId, workspaceId: outcome.workspaceId }, 'Kaneo account auto-provisioned')
  } else if (outcome.status === 'registration_disabled') {
    await reply.text(
      'Kaneo account could not be created — registration is currently disabled on this instance.\n\nPlease ask the admin to provision your account.',
    )
    provLog.warn({ contextId }, 'Kaneo auto-provisioning failed: registration disabled')
  } else {
    await reply.text(`Kaneo account could not be created — ${outcome.error}. Please ask the admin to check setup.`)
    provLog.error({ contextId, error: outcome.error }, 'Kaneo auto-provisioning failed')
  }
}
