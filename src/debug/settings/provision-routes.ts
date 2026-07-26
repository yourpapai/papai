// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { getFeatureObserver } from '../../analytics/feature-observer.js'
import {
  buildSettingsActorRequestContext,
  resolveSettingsProviderRequestScope,
} from '../../analytics/provider-scope-factory.js'
import { getContextSettings } from '../../instances/context-store.js'
import { getTaskInstance } from '../../instances/task-store.js'
import { logger } from '../../logger.js'
import { getTaskProviderProvision, type TaskProviderProvisionOutcome } from '../../providers/registry.js'
import type { SettingsPrincipal } from '../../settings/principal.js'
import { listUsers } from '../../users.js'
import { authenticate, parseJsonBody, requireCsrf, resolveContextScope, settingsJson } from './respond.js'
import type { ContextScope } from './respond.js'

const log = logger.child({ scope: 'debug-server:settings-provision' })
const BodySchema = z.object({ contextId: z.string().optional() })

function resolveProvisionUsername(
  scope: ContextScope,
  platformInstanceId: string,
  platformUserId: string,
): string | null {
  if (scope.kind === 'group') return null
  return listUsers(platformInstanceId).find((u) => u.platform_user_id === platformUserId)?.username ?? null
}

function outcomeToResponse(scope: ContextScope, outcome: TaskProviderProvisionOutcome): Response {
  if (outcome.status === 'provisioned') {
    log.info({ contextId: scope.contextId, status: 'provisioned' }, 'Settings provider provision succeeded')
    return settingsJson(200, {
      status: 'provisioned',
      contextId: scope.contextId,
      email: outcome.email,
      password: outcome.password,
      kaneoUrl: outcome.kaneoUrl,
      workspaceId: outcome.workspaceId,
    })
  }
  if (outcome.status === 'registration_disabled') {
    return settingsJson(422, { status: 'registration_disabled', error: 'Provider registration is disabled' })
  }
  log.warn({ contextId: scope.contextId, status: 'failed', error: outcome.error }, 'Settings provider provision failed')
  return settingsJson(422, { status: 'failed', error: outcome.error })
}

type ProvisionHook = NonNullable<ReturnType<typeof getTaskProviderProvision>>

type ProvisionHookResolution =
  | { ok: true; hook: ProvisionHook }
  | { ok: false; response: Response; missing?: 'task_instance' }

/**
 * Records `unconfigured_reply` (task_instance) after the controlled 422
 * fallback reply is already produced — enum only, never the error text.
 */
function observeUnconfiguredTaskInstance(principal: SettingsPrincipal, scope: ContextScope): void {
  const observer = getFeatureObserver()
  const requestContext = buildSettingsActorRequestContext({
    platformInstanceId: principal.platformInstanceId,
    platformUserId: principal.platformUserId,
    configContextId: scope.contextId,
    contextType: scope.kind === 'group' ? 'group' : 'dm',
    actorRole: principal.isBotAdmin || principal.isSuperAdmin ? 'admin' : 'member',
  })
  if (observer !== null && requestContext !== null) {
    observer.unconfiguredReply(requestContext, { missing: 'task_instance', surface: 'settings' })
  }
}

function resolveProvisionHook(contextId: string): ProvisionHookResolution {
  const settings = getContextSettings(contextId)
  if (settings === null) {
    return { ok: false, response: settingsJson(422, { status: 'failed', error: 'Context has no settings' }) }
  }
  const taskInstance = getTaskInstance(settings.taskInstanceId)
  if (taskInstance === null || taskInstance.status !== 'active') {
    return {
      ok: false,
      response: settingsJson(422, { status: 'failed', error: 'No active task instance assigned' }),
      missing: 'task_instance',
    }
  }
  const provision = getTaskProviderProvision(taskInstance.type)
  if (provision === undefined) {
    return {
      ok: false,
      response: settingsJson(422, {
        status: 'unsupported',
        error: `Provider type '${taskInstance.type}' has no provision hook`,
      }),
    }
  }
  return { ok: true, hook: provision }
}

export async function handleProvisionKaneo(req: Request): Promise<Response> {
  if (req.method !== 'POST') return settingsJson(405, { error: 'method not allowed' })
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  const csrf = requireCsrf(req, auth.authed)
  if (csrf !== null) return csrf

  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = BodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  const { principal } = auth.authed
  const scope = resolveContextScope(principal, 'write', body.data.contextId)
  if (!scope.ok) return scope.response

  const hook = resolveProvisionHook(scope.scope.contextId)
  if (!hook.ok) {
    if (hook.missing === 'task_instance') observeUnconfiguredTaskInstance(principal, scope.scope)
    return hook.response
  }

  const username = resolveProvisionUsername(scope.scope, principal.platformInstanceId, principal.platformUserId)
  const publicUrl = process.env['KANEO_CLIENT_URL']
  const internalUrl = process.env['KANEO_INTERNAL_URL']
  const providerRequestScope = resolveSettingsProviderRequestScope({
    platformInstanceId: principal.platformInstanceId,
    platformUserId: principal.platformUserId,
    configContextId: scope.scope.contextId,
    contextType: scope.scope.kind === 'group' ? 'group' : 'dm',
    actorRole: principal.isBotAdmin || principal.isSuperAdmin ? 'admin' : 'member',
  })
  const outcome = await hook.hook({
    contextId: scope.scope.contextId,
    username,
    publicUrl,
    internalUrl,
    scope: providerRequestScope,
  })
  return outcomeToResponse(scope.scope, outcome)
}
