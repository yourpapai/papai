// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { logger } from '../../../src/logger.js'
import type { KaneoConfig } from '../client.js'

const log = logger.child({ scope: 'kaneo:members' })

// Schemas for Better Auth responses (auth endpoints, not Kaneo API)
const AuthResponseSchema = z.object({
  user: z.object({ id: z.string() }),
  token: z.string(),
})

const InviteResponseSchema = z.object({ id: z.string() })

function generateMemberPassword(): string {
  const uuid = crypto.randomUUID().replaceAll('-', '')
  return `${uuid.slice(0, 20)}Aa1!`
}

/**
 * Extract a Better Auth session cookie from a sign-up or sign-in response.
 * Prefers `Set-Cookie: better-auth.session_token=…`; falls back to the JSON `token` field.
 * Uses `__Secure-` prefix when publicUrl is HTTPS, per Better Auth cookie semantics.
 */
function extractSessionCookie(res: Response, token: string, publicUrl: string): string {
  const setCookies = res.headers.getSetCookie()
  const sessionHeader = setCookies.find((h) => h.includes('better-auth.session_token='))
  if (sessionHeader !== undefined) {
    return sessionHeader.split(';')[0]!
  }
  const cookieName = publicUrl.startsWith('https://')
    ? '__Secure-better-auth.session_token'
    : 'better-auth.session_token'
  return `${cookieName}=${token}`
}

async function doMemberSignUp(
  baseUrl: string,
  publicUrl: string,
  email: string,
  password: string,
  displayName: string,
): Promise<{ userId: string; sessionCookie: string }> {
  log.debug({ email, displayName }, 'kaneoProvisionMember: sign-up')
  const res = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name: displayName }),
  })
  if (!res.ok) {
    throw new Error(`Member sign-up failed (${res.status}): ${await res.text()}`)
  }
  const parsed = AuthResponseSchema.safeParse(await res.json())
  if (!parsed.success) throw new Error('Member sign-up returned invalid data')
  const { user, token } = parsed.data
  const sessionCookie = extractSessionCookie(res, token, publicUrl)
  return { userId: user.id, sessionCookie }
}

async function doMemberSignIn(
  baseUrl: string,
  publicUrl: string,
  email: string,
  password: string,
): Promise<{ userId: string; sessionCookie: string }> {
  log.debug({ email }, 'kaneoProvisionMember: sign-in (reuse path)')
  const res = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) {
    throw new Error(`Member sign-in failed (${res.status}): ${await res.text()}`)
  }
  const parsed = AuthResponseSchema.safeParse(await res.json())
  if (!parsed.success) throw new Error('Member sign-in returned invalid data')
  const { user, token } = parsed.data
  const sessionCookie = extractSessionCookie(res, token, publicUrl)
  return { userId: user.id, sessionCookie }
}

/**
 * Invite a member (by email) to an existing workspace/organization using the SERVICE credential.
 * Returns the `invitationId` to pass to `doAcceptInvitation`.
 * A 200 response that already contains an existing invitation ID is treated as success.
 */
async function doInviteMember(
  serviceConfig: KaneoConfig,
  workspaceId: string,
  email: string,
  publicUrl: string,
): Promise<string> {
  log.debug({ workspaceId, email }, 'kaneoProvisionMember: invite-member')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Origin: publicUrl === '' ? serviceConfig.baseUrl : publicUrl,
  }
  if (serviceConfig.sessionCookie === undefined) {
    headers['Authorization'] = `Bearer ${serviceConfig.apiKey}`
  } else {
    headers['Cookie'] = serviceConfig.sessionCookie
  }
  const res = await fetch(`${serviceConfig.baseUrl}/api/auth/organization/invite-member`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, role: 'member', organizationId: workspaceId }),
  })
  if (!res.ok) {
    throw new Error(`invite-member failed (${res.status}): ${await res.text()}`)
  }
  const parsed = InviteResponseSchema.safeParse(await res.json())
  if (!parsed.success) throw new Error('invite-member returned unexpected shape (expected { id })')
  const { id: invitationId } = parsed.data
  log.info({ email, workspaceId, invitationId }, 'Member invited to Kaneo workspace')
  return invitationId
}

/**
 * Accept an invitation using the MEMBER's own session cookie.
 * This is the only step that authenticates as the member, not the service account.
 */
async function doAcceptInvitation(
  baseUrl: string,
  memberSessionCookie: string,
  invitationId: string,
  publicUrl: string,
): Promise<void> {
  log.debug({ invitationId }, 'kaneoProvisionMember: accept-invitation')
  const res = await fetch(`${baseUrl}/api/auth/organization/accept-invitation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: memberSessionCookie,
      Origin: publicUrl === '' ? baseUrl : publicUrl,
    },
    body: JSON.stringify({ invitationId }),
  })
  if (!res.ok) {
    throw new Error(`accept-invitation failed (${res.status}): ${await res.text()}`)
  }
  log.info({ invitationId }, 'Invitation accepted — member joined workspace')
}

export type ProvisionMemberResult = {
  providerUserId: string
  login: string
  /** Generated password for new members; the stored password passed through for reuse. */
  password: string
}

/**
 * Provision a Kaneo member for a group workspace using the invite + accept flow:
 *
 * New member:
 *   1. `doMemberSignUp` — create a Better Auth account; capture session cookie + userId.
 *   2. `doInviteMember` — service account invites by email; capture invitationId.
 *   3. `doAcceptInvitation` — member session cookie accepts; member joins workspace.
 *
 * Reuse (existing account in another group):
 *   1. `doMemberSignIn` — re-authenticate the member with their stored password.
 *   2. `doInviteMember` — same as above.
 *   3. `doAcceptInvitation` — same as above.
 *
 * Returns the member's provider ID, login (email), and password. The password is:
 *   - Generated fresh for new members (caller MUST persist it encrypted).
 *   - The stored value passed back unchanged for reuse (so the caller can re-save it).
 */
export async function kaneoProvisionMember(
  /** Service account config (the group's stored kaneoKey + baseUrl). */
  serviceConfig: KaneoConfig,
  workspaceId: string,
  member: { chatUserId: string; displayName: string; username: string | null },
  /** Public-facing Kaneo URL (for Origin header and secure-cookie detection). */
  publicUrl: string,
  /**
   * When provided, SKIP sign-up and re-authenticate the member with their stored password instead.
   * All three fields must be present for the reuse path; if any is missing, treat as new member.
   */
  existing?: { providerUserId: string; login: string; password: string },
): Promise<ProvisionMemberResult> {
  log.info(
    { chatUserId: member.chatUserId, displayName: member.displayName, reuse: existing !== undefined },
    'Provisioning Kaneo member',
  )

  let userId: string
  let sessionCookie: string
  let login: string
  let password: string

  if (existing === undefined) {
    // New member path: generate email and password, sign up.
    const uniqueSuffix = crypto.randomUUID().replaceAll('-', '').slice(0, 8)
    const emailBase = member.username ?? member.chatUserId
    login = `${emailBase}-${uniqueSuffix}@pap.ai`
    password = generateMemberPassword()
    const signUp = await doMemberSignUp(serviceConfig.baseUrl, publicUrl, login, password, member.displayName)
    userId = signUp.userId
    sessionCookie = signUp.sessionCookie
  } else {
    // Reuse path: re-authenticate to get a fresh session cookie for accept-invitation.
    const signIn = await doMemberSignIn(serviceConfig.baseUrl, publicUrl, existing.login, existing.password)
    userId = signIn.userId
    sessionCookie = signIn.sessionCookie
    login = existing.login
    password = existing.password
    log.info({ chatUserId: member.chatUserId, userId, workspaceId }, 'Kaneo member reuse: signed in')
  }

  const invitationId = await doInviteMember(serviceConfig, workspaceId, login, publicUrl)
  await doAcceptInvitation(serviceConfig.baseUrl, sessionCookie, invitationId, publicUrl)

  log.info({ chatUserId: member.chatUserId, userId, workspaceId }, 'Kaneo member provisioned')
  return { providerUserId: userId, login, password }
}
