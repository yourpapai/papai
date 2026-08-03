// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import type { FeatureObserver } from '../../src/analytics/feature-observer.js'
import { setFeatureObserverForTesting } from '../../src/analytics/feature-observer.js'
import type { CommandHandler } from '../../src/chat/types.js'
import { registerConfigCommand } from '../../src/commands/config.js'
import { handleSettingsBootstrap, handleSettingsExchange } from '../../src/debug/settings-routes.js'
import { handleByokRoutes } from '../../src/debug/settings/byok-routes.js'
import { handleContextTaskInstanceRoutes } from '../../src/debug/settings/context-task-instance-routes.js'
import { handleGroupRoutes } from '../../src/debug/settings/group-routes.js'
import { handleProvisionKaneo } from '../../src/debug/settings/provision-routes.js'
import { ensureContextPlatformInstance, setContextSettings } from '../../src/instances/context-store.js'
import { insertTaskInstance } from '../../src/instances/task-store.js'
import { issueAuthCode } from '../../src/settings/auth-code-store.js'
import { ISSUE_LIMIT } from '../../src/settings/issue-link.js'
import { resolveSettingsPrincipal } from '../../src/settings/principal.js'
import { addUser } from '../../src/users.js'
import { authHeaders, establishSession, type SettingsSession } from '../debug/settings/helpers.js'
import {
  createAuth,
  createDmMessage,
  createMockChatWithCommandHandlers,
  createMockReply,
  mockLogger,
  seedTestPlatformInstance,
  setupTestDb,
} from '../utils/test-helpers.js'

const CANARY_BASE_URL = 'https://canary-settings.example'
const CANARY_CODE_HINT = 'canary-code'

const facts: Array<Record<string, unknown>> = []

const record = (type: string, props: Record<string, unknown>): void => {
  facts.push({
    version: 1,
    type,
    sourceEventId: `test:${type}:${facts.length}`,
    occurredAtMs: 0,
    source: {
      platform: 'telegram',
      platformInstanceId: 'pi-1',
      chatUserId: 'u-1',
      nativeContextId: 'u-1',
      storageContextId: 'u-1',
      configContextId: 'u-1',
      contextType: 'dm',
      actorRole: 'member',
      taskInstanceId: null,
      taskProvider: 'none',
      invocationMode: 'settings',
      rawTurnId: null,
    },
    ...props,
  })
}

const observerStub: FeatureObserver = {
  featureUsed: (_ctx, input) =>
    record('feature_used', { feature: input.feature, operation: input.operation, outcome: input.outcome }),
  featureOpportunity: () => {},
  mcpAvailability: () => {},
  configLinkIssued: (ctx, result) => {
    record('config_link_issued', { result })
    lastContexts.push(ctx)
  },
  settingsOpened: (ctx, input) => {
    record('settings_opened', { entry: input.entry, result: input.result })
    lastContexts.push(ctx)
  },
  taskInstanceAssigned: (_ctx, input) => record('task_instance_assigned', { ...input }),
  rateLimitBlocked: (_ctx, limit) => record('rate_limit_blocked', { limit }),
  unconfiguredReply: (_ctx, input) => record('unconfigured_reply', { ...input }),
}

const lastContexts: unknown[] = []

const factsOfType = (type: string): Array<Record<string, unknown>> => facts.filter((fact) => fact['type'] === type)

const originalBaseUrl = process.env['SETTINGS_PUBLIC_BASE_URL']

beforeEach(async () => {
  mockLogger()
  await setupTestDb()
  facts.length = 0
  lastContexts.length = 0
  setFeatureObserverForTesting(observerStub)
  delete process.env['SETTINGS_PUBLIC_BASE_URL']
})

afterEach(() => {
  setFeatureObserverForTesting(null)
  if (originalBaseUrl === undefined) delete process.env['SETTINGS_PUBLIC_BASE_URL']
  else process.env['SETTINGS_PUBLIC_BASE_URL'] = originalBaseUrl
})

const configHandler = (): CommandHandler => {
  const { provider: mockChat, commandHandlers } = createMockChatWithCommandHandlers()
  registerConfigCommand(mockChat)
  const handler = commandHandlers.get('config')
  assert.ok(handler !== undefined, 'expected config handler to be registered')
  return handler
}

describe('config link milestones', () => {
  test('issued link emits config_link_issued issued without the URL', async () => {
    seedTestPlatformInstance({ id: 'test-instance' })
    process.env['SETTINGS_PUBLIC_BASE_URL'] = CANARY_BASE_URL
    const { reply } = createMockReply()
    await configHandler()(createDmMessage('u-1'), reply, createAuth('u-1'))

    const emitted = factsOfType('config_link_issued')
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({ result: 'issued' })
    expect(JSON.stringify(facts)).not.toContain(CANARY_BASE_URL)
    expect(JSON.stringify(facts)).not.toContain('code=')
  })

  test('rate-limited issuance emits config_link_issued rate_limited and rate_limit_blocked settings_link', async () => {
    seedTestPlatformInstance({ id: 'test-instance' })
    process.env['SETTINGS_PUBLIC_BASE_URL'] = CANARY_BASE_URL
    const handler = configHandler()
    const msg = createDmMessage('u-1')
    const auth = createAuth('u-1')
    for (let i = 0; i < ISSUE_LIMIT + 1; i += 1) {
      await handler(msg, createMockReply().reply, auth)
    }

    const issued = factsOfType('config_link_issued')
    expect(issued.filter((fact) => fact['result'] === 'issued')).toHaveLength(ISSUE_LIMIT)
    expect(issued.filter((fact) => fact['result'] === 'rate_limited')).toHaveLength(1)
    const blocked = factsOfType('rate_limit_blocked')
    expect(blocked).toHaveLength(1)
    expect(blocked[0]).toMatchObject({ limit: 'settings_link' })
  })

  test('not-configured issuance emits config_link_issued not_configured and unconfigured_reply settings_base_url', async () => {
    seedTestPlatformInstance({ id: 'test-instance' })
    await configHandler()(createDmMessage('u-1'), createMockReply().reply, createAuth('u-1'))

    expect(factsOfType('config_link_issued')).toHaveLength(1)
    expect(factsOfType('config_link_issued')[0]).toMatchObject({ result: 'not_configured' })
    const unconfigured = factsOfType('unconfigured_reply')
    expect(unconfigured).toHaveLength(1)
    expect(unconfigured[0]).toMatchObject({ missing: 'settings_base_url', surface: 'chat' })
  })
})

describe('settings exchange milestones', () => {
  const exchangeReq = (code: string): Request =>
    new Request('https://x/settings/auth/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })

  test('successful exchange emits settings_opened config_link/success without the code', async () => {
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
    const code = issueAuthCode({ platformInstanceId: 'pi-1', platformUserId: 'u-1' })
    const res = await handleSettingsExchange(exchangeReq(code))
    expect(res.status).toBe(200)

    const opened = factsOfType('settings_opened')
    expect(opened).toHaveLength(1)
    expect(opened[0]).toMatchObject({ entry: 'config_link', result: 'success' })
    expect(JSON.stringify(facts)).not.toContain(code)
  })

  test('expired code emits settings_opened config_link/expired', async () => {
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
    const nowMs = Date.now()
    const code = issueAuthCode({ platformInstanceId: 'pi-1', platformUserId: 'u-1' }, nowMs)
    const res = await handleSettingsExchange(exchangeReq(code), nowMs + 20 * 60 * 1000)
    expect(res.status).toBe(401)

    const opened = factsOfType('settings_opened')
    expect(opened).toHaveLength(1)
    expect(opened[0]).toMatchObject({ entry: 'config_link', result: 'expired' })
    expect(JSON.stringify(facts)).not.toContain(CANARY_CODE_HINT)
  })

  test('an unknown code emits no settings_opened fact (no attributable actor)', async () => {
    seedTestPlatformInstance({ id: 'pi-1' })
    const res = await handleSettingsExchange(exchangeReq('no-such-code'))
    expect(res.status).toBe(401)
    expect(factsOfType('settings_opened')).toHaveLength(0)
  })

  test('bootstrap with an existing session emits settings_opened existing_session/success', async () => {
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
    const session = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'u-1' })
    facts.length = 0

    const res = await handleSettingsBootstrap(
      new Request('https://x/settings/api/bootstrap', { headers: authHeaders(session) }),
    )
    expect(res.status).toBe(200)
    const opened = factsOfType('settings_opened')
    expect(opened).toHaveLength(1)
    expect(opened[0]).toMatchObject({ entry: 'existing_session', result: 'success' })
  })
})

describe('task assignment milestones', () => {
  const ENDPOINT = 'https://x/settings/api/context/task-instance'
  let session: SettingsSession

  const patchAssignment = (taskInstanceId: string): Promise<Response> =>
    handleContextTaskInstanceRoutes(
      new Request(ENDPOINT, {
        method: 'PATCH',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskInstanceId }),
      }),
      new URL(ENDPOINT),
    )

  beforeEach(async () => {
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
    insertTaskInstance({ id: 'ti-kaneo', type: 'kaneo', config: {}, status: 'active' })
    insertTaskInstance({ id: 'ti-yt', type: 'youtrack', config: {}, status: 'active' })
    session = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'u-1' })
  })

  test('first assignment emits task_instance_assigned first_assignment from none', async () => {
    const res = await patchAssignment('ti-kaneo')
    expect(res.status).toBe(200)
    const assigned = factsOfType('task_instance_assigned')
    expect(assigned).toHaveLength(1)
    expect(assigned[0]).toMatchObject({ change: 'first_assignment', fromProvider: 'none', toProvider: 'kaneo' })
  })

  test('changed assignment emits task_instance_assigned changed with provider transition', async () => {
    await patchAssignment('ti-kaneo')
    facts.length = 0
    const res = await patchAssignment('ti-yt')
    expect(res.status).toBe(200)
    const assigned = factsOfType('task_instance_assigned')
    expect(assigned).toHaveLength(1)
    expect(assigned[0]).toMatchObject({ change: 'changed', fromProvider: 'kaneo', toProvider: 'youtrack' })
  })

  test('re-assigning the same instance emits no fact', async () => {
    await patchAssignment('ti-kaneo')
    facts.length = 0
    const res = await patchAssignment('ti-kaneo')
    expect(res.status).toBe(200)
    expect(factsOfType('task_instance_assigned')).toHaveLength(0)
  })

  test('cold-context platform seeding emits no task assignment fact', () => {
    ensureContextPlatformInstance('pi-1:group-9', 'pi-1')
    expect(factsOfType('task_instance_assigned')).toHaveLength(0)
  })
})

describe('provision fallback milestones', () => {
  let session: SettingsSession

  const postProvision = (): Promise<Response> =>
    handleProvisionKaneo(
      new Request('https://x/settings/api/provision/kaneo', {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )

  beforeEach(async () => {
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
    session = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'u-1' })
  })

  test('no active task instance emits unconfigured_reply task_instance after the settings fallback reply', async () => {
    const { personalConfigContextId } = resolveSettingsPrincipal('pi-1', 'u-1')
    insertTaskInstance({ id: 'ti-stopped', type: 'kaneo', config: {}, status: 'stopped' })
    setContextSettings({ contextId: personalConfigContextId, taskInstanceId: 'ti-stopped', platformInstanceId: 'pi-1' })
    const res = await postProvision()
    expect(res.status).toBe(422)
    const unconfigured = factsOfType('unconfigured_reply')
    expect(unconfigured).toHaveLength(1)
    expect(unconfigured[0]).toMatchObject({ missing: 'task_instance', surface: 'settings' })
    expect(JSON.stringify(unconfigured)).not.toContain('ti-stopped')
  })

  test('an active instance without a provision hook produces no unconfigured fact', async () => {
    const { personalConfigContextId } = resolveSettingsPrincipal('pi-1', 'u-1')
    insertTaskInstance({ id: 'ti-kaneo', type: 'kaneo', config: {}, status: 'active' })
    setContextSettings({ contextId: personalConfigContextId, taskInstanceId: 'ti-kaneo', platformInstanceId: 'pi-1' })
    const res = await postProvision()
    expect(res.status).toBe(422)
    expect(factsOfType('unconfigured_reply')).toHaveLength(0)
  })
})

describe('settings mutation milestones', () => {
  let session: SettingsSession

  beforeEach(async () => {
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
    session = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'u-1' })
  })

  test('BYOK enablement emits feature_used byok/enable success', async () => {
    const res = await handleByokRoutes(
      new Request('https://x/settings/api/byok', {
        method: 'PATCH',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'enable' }),
      }),
      new URL('https://x/settings/api/byok'),
    )
    expect(res.status).toBe(200)
    const used = factsOfType('feature_used').filter((fact) => fact['feature'] === 'byok')
    expect(used).toHaveLength(1)
    expect(used[0]).toMatchObject({ operation: 'enable', outcome: 'success' })
  })

  test('guest-mode enablement emits feature_used guest_mode/enable success as a group-setting event', async () => {
    const { addAuthorizedGroup } = await import('../../src/authorized-groups.js')
    const { toScopedContextId } = await import('../../src/chat/scoped-context.js')
    const { upsertGroupAdminObservation, upsertKnownGroupContext } =
      await import('../../src/group-settings/registry.js')
    const groupId = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'grp-1' })
    upsertKnownGroupContext({ contextId: groupId, provider: 'telegram', displayName: 'Test Group', parentName: null })
    upsertGroupAdminObservation({
      contextId: groupId,
      provider: 'telegram',
      userId: 'u-1',
      username: 'u-1',
      isAdmin: true,
    })
    addAuthorizedGroup(groupId, 'u-1')
    const res = await handleGroupRoutes(
      new Request('https://x/settings/api/group/guest-mode', {
        method: 'PATCH',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ contextId: groupId, enabled: true }),
      }),
      new URL('https://x/settings/api/group/guest-mode'),
      '/settings/api/group/guest-mode',
    )
    expect(res.status).toBe(200)
    const used = factsOfType('feature_used').filter((fact) => fact['feature'] === 'guest_mode')
    expect(used).toHaveLength(1)
    expect(used[0]).toMatchObject({ operation: 'enable', outcome: 'success' })
    const source: unknown = used[0]?.['source']
    assert(typeof source === 'object')
    assert(source !== null)
    assert('actorRole' in source)
    const actorRole: unknown = source.actorRole
    assert(typeof actorRole === 'string')
    expect(actorRole).not.toMatch(/guest/u)
  })
})
