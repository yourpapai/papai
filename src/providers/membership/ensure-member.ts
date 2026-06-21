// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, isNotNull } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import { kaneoWorkspaceMembers } from '../../db/schema.js'
import { setProvisionedIdentityMapping } from '../../identity/mapping.js'
import { getContextSettings as defaultGetContextSettings } from '../../instances/context-store.js'
import { decryptInstanceConfig, encryptInstanceConfig } from '../../instances/encryption.js'
import { logger } from '../../logger.js'
import { defaultTaskProviderResolver } from '../resolver.js'
import type { TaskProvider } from '../types.js'

const log = logger.child({ scope: 'providers:membership' })

export type MemberOutcome = 'created' | 'exists' | 'skipped' | 'failed'

export interface MembershipDeps {
  resolveProvider(configId: string): Promise<TaskProvider | null>
  getContextSettings(contextId: string): { taskInstanceId: string; platformInstanceId: string } | null
  /** Resolves a display label for a user. Returns null when the chat router cannot resolve it (best-effort). */
  resolveUserLabel(userId: string, groupContextId: string, platformInstanceId: string): Promise<string | null>
  /** Decrypt an encrypted password value. Defaults to `decryptInstanceConfig`. Overridable for tests. */
  decryptPassword?(encrypted: string): string
}

export const defaultMembershipDeps: MembershipDeps = {
  resolveProvider: (contextId) => defaultTaskProviderResolver.resolve(contextId),
  getContextSettings: defaultGetContextSettings,
  resolveUserLabel: () => Promise.resolve(null),
}

function buildDisplayName(resolvedLabel: string | null, username: string | null, chatUserId: string): string {
  if (resolvedLabel !== null && resolvedLabel.trim().length > 0) return resolvedLabel
  if (username !== null && username.trim().length > 0) return `@${username}`
  return `User ${chatUserId}`
}

/**
 * Returns true ONLY when an `active` row exists, meaning the member is fully provisioned.
 * A `failed` or `inactive` row should NOT block re-provisioning — it returns false so the
 * caller proceeds to (re)provision and overwrites the existing row via upsert.
 */
function findActiveExistingMemberRow(groupContextId: string, chatUserId: string): boolean {
  const db = defaultGetDrizzleDb()
  const row = db
    .select({ status: kaneoWorkspaceMembers.status })
    .from(kaneoWorkspaceMembers)
    .where(
      and(eq(kaneoWorkspaceMembers.groupContextId, groupContextId), eq(kaneoWorkspaceMembers.chatUserId, chatUserId)),
    )
    .get()
  return row?.status === 'active'
}

/**
 * Look for a previously-provisioned row for this chatUserId in ANY group that has an
 * `encrypted_password`. Returns `{ providerUserId, login, encryptedPassword }` or null.
 */
function findStoredCredentialsAcrossGroups(
  chatUserId: string,
): { providerUserId: string; login: string; encryptedPassword: string } | null {
  const db = defaultGetDrizzleDb()
  const row = db
    .select({
      providerUserId: kaneoWorkspaceMembers.providerUserId,
      login: kaneoWorkspaceMembers.login,
      encryptedPassword: kaneoWorkspaceMembers.encryptedPassword,
    })
    .from(kaneoWorkspaceMembers)
    .where(
      and(
        eq(kaneoWorkspaceMembers.chatUserId, chatUserId),
        eq(kaneoWorkspaceMembers.providerName, 'kaneo'),
        isNotNull(kaneoWorkspaceMembers.encryptedPassword),
      ),
    )
    .get()
  if (row === undefined || row.encryptedPassword === null) return null
  return { providerUserId: row.providerUserId, login: row.login, encryptedPassword: row.encryptedPassword }
}

/**
 * Insert or overwrite (upsert) a member row.
 * A conflict on the PK (groupContextId, chatUserId, providerName) always UPDATES so that
 * a prior `failed` or `inactive` row is replaced — never silently ignored.
 */
function writeMemberRow(
  groupContextId: string,
  chatUserId: string,
  providerUserId: string,
  login: string,
  status: 'active' | 'failed',
  encryptedPassword: string | null,
): void {
  const db = defaultGetDrizzleDb()
  const now = new Date().toISOString()
  db.insert(kaneoWorkspaceMembers)
    .values({
      groupContextId,
      chatUserId,
      providerName: 'kaneo',
      providerUserId,
      login,
      status,
      encryptedPassword,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [
        kaneoWorkspaceMembers.groupContextId,
        kaneoWorkspaceMembers.chatUserId,
        kaneoWorkspaceMembers.providerName,
      ],
      set: { providerUserId, login, status, encryptedPassword, createdAt: now },
    })
    .run()
}

type ExistingOpts = { existingProviderUserId: string; existingLogin: string; existingPassword: string }

/**
 * Resolve reuse opts from a stored credential row. Returns undefined if no row
 * exists, the row has no password, or decryption fails/produces empty string.
 */
function resolveExistingOpts(
  chatUserId: string,
  decryptPassword: ((enc: string) => string) | undefined,
): ExistingOpts | undefined {
  const stored = findStoredCredentialsAcrossGroups(chatUserId)
  if (stored === null) return undefined
  try {
    const decryptFn: (enc: string) => string =
      decryptPassword ?? ((enc) => decryptInstanceConfig(enc)['password'] ?? '')
    const password = decryptFn(stored.encryptedPassword)
    if (password === '') {
      log.warn({ chatUserId }, 'Stored encrypted_password decrypted to empty string — falling back to new sign-up')
      return undefined
    }
    log.debug({ chatUserId, login: stored.login }, 'Reusing stored credentials for cross-group provision')
    return { existingProviderUserId: stored.providerUserId, existingLogin: stored.login, existingPassword: password }
  } catch (err: unknown) {
    log.warn(
      { chatUserId, error: err instanceof Error ? err.message : String(err) },
      'Failed to decrypt stored password — falling back to new sign-up',
    )
    return undefined
  }
}

async function provisionAndPersist(
  groupContextId: string,
  chatUserId: string,
  displayName: string,
  username: string | null,
  provider: TaskProvider,
  existingOpts: ExistingOpts | undefined,
): Promise<MemberOutcome> {
  try {
    const { providerUserId, login, password } = await provider.provisionWorkspaceMember!(
      { chatUserId, displayName, username },
      existingOpts,
    )
    writeMemberRow(groupContextId, chatUserId, providerUserId, login, 'active', encryptInstanceConfig({ password }))
    setProvisionedIdentityMapping({
      contextId: chatUserId,
      providerName: provider.name,
      providerUserId,
      providerUserLogin: login,
      displayName,
      matchMethod: 'provisioned',
      confidence: 1,
    })
    log.info({ groupContextId, chatUserId, providerUserId }, 'Workspace member provisioned')
    return 'created'
  } catch (err: unknown) {
    log.error(
      { groupContextId, chatUserId, error: err instanceof Error ? err.message : String(err) },
      'ensureWorkspaceMember failed',
    )
    writeMemberRow(groupContextId, chatUserId, '', '', 'failed', null)
    return 'failed'
  }
}

/**
 * Idempotent entry point: ensure a chat user is provisioned as a Kaneo workspace member.
 * All failures are logged and returned as 'failed' — never thrown into the caller.
 *
 * Reuse logic: if a prior `kaneo_workspace_members` row (any group) has `encrypted_password`,
 * decrypt it and pass `existingProviderUserId`, `existingLogin`, and `existingPassword` to the
 * provider so it can sign-in (not sign-up) and invite+accept. If the stored row has no password
 * (older row), fall back to a fresh sign-up.
 */
export async function ensureWorkspaceMember(
  groupContextId: string,
  chatUserId: string,
  deps: MembershipDeps = defaultMembershipDeps,
  opts?: { username?: string | null },
): Promise<MemberOutcome> {
  log.debug({ groupContextId, chatUserId }, 'ensureWorkspaceMember called')
  if (findActiveExistingMemberRow(groupContextId, chatUserId)) {
    log.debug({ groupContextId, chatUserId }, 'Member row already exists')
    return 'exists'
  }
  const settings = deps.getContextSettings(groupContextId)
  if (settings === null) {
    log.debug({ groupContextId }, 'No context settings — skipping')
    return 'skipped'
  }
  const provider = await deps.resolveProvider(groupContextId)
  if (
    provider === null ||
    !provider.capabilities.has('members.provision') ||
    provider.provisionWorkspaceMember === undefined
  ) {
    log.debug({ groupContextId, hasProvider: provider !== null }, 'Provider lacks members.provision — skipping')
    return 'skipped'
  }
  const resolvedLabel = await deps.resolveUserLabel(chatUserId, groupContextId, settings.platformInstanceId)
  const displayName = buildDisplayName(resolvedLabel, opts?.username ?? null, chatUserId)
  const existingOpts = resolveExistingOpts(
    chatUserId,
    deps.decryptPassword === undefined ? undefined : (enc: string): string => deps.decryptPassword!(enc),
  )
  return provisionAndPersist(groupContextId, chatUserId, displayName, opts?.username ?? null, provider, existingOpts)
}

/**
 * Mark a workspace member as inactive (e.g. when removed from a group).
 * Used in Phase 3 by the group_member:removed event subscriber.
 */
export function markMemberInactive(groupContextId: string, chatUserId: string): void {
  log.debug({ groupContextId, chatUserId }, 'markMemberInactive called')
  const db = defaultGetDrizzleDb()
  db.update(kaneoWorkspaceMembers)
    .set({ status: 'inactive' })
    .where(
      and(eq(kaneoWorkspaceMembers.groupContextId, groupContextId), eq(kaneoWorkspaceMembers.chatUserId, chatUserId)),
    )
    .run()
}
