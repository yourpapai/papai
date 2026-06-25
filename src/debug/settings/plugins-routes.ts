// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { getPluginConfig, maskSensitiveValue, setPluginConfig, unsetPluginConfig } from '../../config.js'
import { logger } from '../../logger.js'
import {
  getPluginContextEligibility,
  isPluginActiveForContext,
  pluginRegistry,
  setPluginEnabledForContext,
} from '../../plugins/registry.js'
import { isPluginEnabledForContext } from '../../plugins/store.js'
import { authenticate, parseJsonBody, requireCsrf, resolveContextScope, settingsJson } from './respond.js'

const log = logger.child({ scope: 'debug-server:settings-plugins' })

function handleGet(req: Request, url: URL): Response {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  const scope = resolveContextScope(auth.authed.principal, 'read', url.searchParams.get('contextId') ?? undefined)
  if (!scope.ok) return scope.response

  const plugins = pluginRegistry.getAllEntries().map((entry) => {
    const id = entry.discoveredPlugin.manifest.id
    const contextConfig = entry.discoveredPlugin.manifest.configRequirements
      .filter((r) => r.scope === 'context')
      .map((r) => ({
        key: r.key,
        label: r.label,
        required: r.required,
        sensitive: r.sensitive,
        hasValue: (getPluginConfig(scope.scope.contextId, id, r.key) ?? '').length > 0,
      }))
    return {
      id,
      name: entry.discoveredPlugin.manifest.name,
      active: isPluginActiveForContext(id, scope.scope.contextId),
      enabled: isPluginEnabledForContext(id, scope.scope.contextId),
      eligibility: getPluginContextEligibility(id, scope.scope.contextId),
      contextConfig,
    }
  })
  return settingsJson(200, { contextId: scope.scope.contextId, plugins })
}

const ToggleBodySchema = z.object({
  pluginId: z.string().min(1),
  enabled: z.boolean(),
  contextId: z.string().optional(),
})

async function handleToggle(req: Request): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  const csrf = requireCsrf(req, auth.authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = ToggleBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  const scope = resolveContextScope(auth.authed.principal, 'write', body.data.contextId)
  if (!scope.ok) return scope.response

  const registryEntry = pluginRegistry.getEntry(body.data.pluginId)
  if (registryEntry === undefined) {
    return settingsJson(422, { error: 'unknown plugin' })
  }
  if (body.data.enabled) {
    if (registryEntry.state !== 'active') {
      return settingsJson(422, { error: 'plugin not active' })
    }
    const eligibility = getPluginContextEligibility(body.data.pluginId, scope.scope.contextId)
    if (!eligibility.eligible && eligibility.reason === 'config_missing') {
      return settingsJson(422, { error: 'plugin config missing', missingKeys: eligibility.missingKeys })
    }
  }
  setPluginEnabledForContext(body.data.pluginId, scope.scope.contextId, body.data.enabled)
  log.info(
    { contextId: scope.scope.contextId, pluginId: body.data.pluginId, enabled: body.data.enabled },
    'Settings plugin toggled',
  )
  return settingsJson(200, { ok: true, contextId: scope.scope.contextId })
}

const ConfigSetBodySchema = z.object({
  action: z.literal('set').optional(),
  pluginId: z.string().min(1),
  key: z.string().min(1),
  value: z.string(),
  contextId: z.string().optional(),
})

const ConfigUnsetBodySchema = z.object({
  action: z.literal('unset'),
  pluginId: z.string().min(1),
  key: z.string().min(1),
  contextId: z.string().optional(),
})

const ConfigBodySchema = z.union([ConfigUnsetBodySchema, ConfigSetBodySchema])

async function handleConfig(req: Request): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  const csrf = requireCsrf(req, auth.authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = ConfigBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  const scope = resolveContextScope(auth.authed.principal, 'write', body.data.contextId)
  if (!scope.ok) return scope.response

  const entry = pluginRegistry.getEntry(body.data.pluginId)
  if (entry === undefined) return settingsJson(422, { error: 'unknown plugin' })
  const requirement = entry.discoveredPlugin.manifest.configRequirements.find(
    (r) => r.scope === 'context' && r.key === body.data.key,
  )
  if (requirement === undefined) return settingsJson(422, { error: 'unknown plugin config key' })

  if (body.data.action === 'unset') {
    unsetPluginConfig(scope.scope.contextId, body.data.pluginId, body.data.key)
    log.info(
      { contextId: scope.scope.contextId, pluginId: body.data.pluginId, key: body.data.key },
      'Settings plugin config unset',
    )
    return settingsJson(200, { ok: true, contextId: scope.scope.contextId })
  }

  // Masked secrets: an empty submit or a submit equal to the masked form of the stored value means "no change".
  if (requirement.sensitive) {
    const current = getPluginConfig(scope.scope.contextId, body.data.pluginId, body.data.key) ?? ''
    if (body.data.value.length === 0 || (current.length > 0 && body.data.value === maskSensitiveValue(current))) {
      return settingsJson(200, { ok: true, contextId: scope.scope.contextId, unchanged: true })
    }
  }
  setPluginConfig(scope.scope.contextId, body.data.pluginId, body.data.key, body.data.value)
  log.info(
    { contextId: scope.scope.contextId, pluginId: body.data.pluginId, key: body.data.key },
    'Settings plugin config updated',
  )
  return settingsJson(200, { ok: true, contextId: scope.scope.contextId })
}

export function handlePluginsRoutes(req: Request, url: URL, pathname: string): Promise<Response> {
  if (pathname === '/settings/api/plugins') {
    if (req.method === 'GET') return Promise.resolve(handleGet(req, url))
    return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
  }
  if (pathname === '/settings/api/plugins/toggle') {
    if (req.method === 'POST') return handleToggle(req)
    return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
  }
  if (pathname === '/settings/api/plugins/config') {
    if (req.method === 'PATCH') return handleConfig(req)
    return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
  }
  return Promise.resolve(settingsJson(404, { error: 'not found' }))
}
