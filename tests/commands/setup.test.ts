import { beforeEach, describe, expect, test } from 'bun:test'

import { addAuthorizedGroup } from '../../src/authorized-groups.js'
import type { CommandHandler, ReplyFn } from '../../src/chat/types.js'
import { registerSetupCommand } from '../../src/commands/setup.js'
import type { SetupCommandDeps } from '../../src/commands/setup.js'
import { setConfig } from '../../src/config.js'
import { setKaneoWorkspace } from '../../src/users.js'
import {
  createAuth,
  createDmMessage,
  createGroupMessage,
  createMockChatWithCommandHandlers,
  createMockReply,
  mockLogger,
  setupTestDb,
} from '../utils/test-helpers.js'

const startSetupForTarget = async (
  userId: string,
  reply: ReplyFn,
  targetContextId: string,
  deps: SetupCommandDeps,
): Promise<void> => {
  const module = await import('../../src/commands/setup.js')
  return module.startSetupForTarget(userId, reply, targetContextId, deps)
}

describe('/setup command', () => {
  let setupHandler: CommandHandler | null = null
  const originalTaskProvider = process.env['TASK_PROVIDER']
  const originalKaneoAutoProvision = process.env['KANEO_AUTO_PROVISION']

  const requireSetupHandler = (): CommandHandler => {
    if (setupHandler === null) {
      throw new Error('setup handler was not registered')
    }
    return setupHandler
  }

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    const { provider, commandHandlers } = createMockChatWithCommandHandlers()
    registerSetupCommand(provider, (_userId: string) => true)
    const registeredSetupHandler = commandHandlers.get('setup')
    if (registeredSetupHandler === undefined) {
      throw new Error('setup handler was not registered')
    }
    setupHandler = registeredSetupHandler
    if (originalTaskProvider === undefined) {
      delete process.env['TASK_PROVIDER']
    } else {
      process.env['TASK_PROVIDER'] = originalTaskProvider
    }
    if (originalKaneoAutoProvision === undefined) {
      delete process.env['KANEO_AUTO_PROVISION']
    } else {
      process.env['KANEO_AUTO_PROVISION'] = originalKaneoAutoProvision
    }
  })

  test('starts with a personal/group selector in DM', async () => {
    const { reply, buttonCalls } = createMockReply()

    await requireSetupHandler()(createDmMessage('user-1'), reply, createAuth('user-1'))

    expect(buttonCalls[0]).toContain('What do you want to configure?')
  })

  test('group admin gets a DM-only redirect', async () => {
    const { reply, textCalls } = createMockReply()

    await requireSetupHandler()(
      createGroupMessage('user-1', '/setup', true, 'group-1'),
      reply,
      createAuth('user-1', { isGroupAdmin: true }),
    )

    expect(textCalls[0]).toBe(
      'Group settings are configured in direct messages with the bot. Open a DM with me and run /setup.',
    )
  })

  test('non-admin group user gets the admin-only restriction', async () => {
    const { reply, textCalls } = createMockReply()

    await requireSetupHandler()(createGroupMessage('user-1', '/setup', false, 'group-1'), reply, createAuth('user-1'))

    expect(textCalls[0]).toBe(
      'Only group admins can configure group settings, and group settings are configured in direct messages with the bot.',
    )
  })

  test('group setup denial uses allowlist-specific unauthorized guidance', async () => {
    const { reply, textCalls } = createMockReply()

    await requireSetupHandler()(
      createGroupMessage('user-1', '/setup', true, 'group-1'),
      reply,
      createAuth('user-1', { allowed: false, reason: 'group_not_allowed', isGroupAdmin: true }),
    )

    expect(textCalls[0]).toBe(
      'This group is not authorized to use this bot. Ask the bot admin to run `/group add <group-id>` in a DM with the bot.',
    )
  })

  test('first-time allowlisted group setup provisions and stops before wizard', async () => {
    process.env['TASK_PROVIDER'] = 'kaneo'
    process.env['KANEO_AUTO_PROVISION'] = 'true'
    addAuthorizedGroup('group-1', 'admin-1')

    const { reply, textCalls } = createMockReply()
    const deps: SetupCommandDeps = {
      isAuthorizedGroup: () => true,
      provisionAndConfigure: () =>
        Promise.resolve({
          status: 'provisioned',
          email: 'group-1-a1b2c3d4@pap.ai',
          password: 'pw-1',
          kaneoUrl: 'https://kaneo.test',
          apiKey: 'key-1',
          workspaceId: 'ws-1',
        }),
      createWizard: () => ({ success: true, prompt: 'wizard-started' }),
      getConfig: () => null,
      getKaneoWorkspace: () => null,
    }

    await startSetupForTarget('admin-1', reply, 'group-1', deps)

    expect(textCalls.some((text) => text.includes('group Kaneo account has been created'))).toBe(true)
    expect(textCalls.some((text) => text.includes('Run /setup again when you are ready to continue'))).toBe(true)
    expect(textCalls.some((text) => text.includes('wizard-started'))).toBe(false)
  })

  test('first-time allowlisted group setup with auto-provision disabled continues into wizard', async () => {
    process.env['TASK_PROVIDER'] = 'kaneo'
    process.env['KANEO_AUTO_PROVISION'] = 'false'

    const { reply, textCalls } = createMockReply()
    const deps: SetupCommandDeps = {
      isAuthorizedGroup: () => true,
      provisionAndConfigure: () =>
        Promise.resolve({
          status: 'provisioned',
          email: 'group-1-a1b2c3d4@pap.ai',
          password: 'pw-1',
          kaneoUrl: 'https://kaneo.test',
          apiKey: 'key-1',
          workspaceId: 'ws-1',
        }),
      createWizard: () => ({ success: true, prompt: 'wizard-started' }),
      getConfig: () => null,
      getKaneoWorkspace: () => null,
    }

    await startSetupForTarget('admin-1', reply, 'group-1', deps)

    expect(textCalls.some((text) => text.includes('Continuing with the setup process now.'))).toBe(true)
    expect(textCalls.some((text) => text.includes('wizard-started'))).toBe(true)
  })

  const getConfigWithExistingApiKey = (_contextId: string, key: string): string | null => {
    const values: Record<string, string> = { kaneo_apikey: 'existing-key' }
    return Object.prototype.hasOwnProperty.call(values, key) ? values[key]! : null
  }

  test('subsequent allowlisted group setup skips provisioning and starts the wizard', async () => {
    process.env['TASK_PROVIDER'] = 'kaneo'
    addAuthorizedGroup('group-1', 'admin-1')
    setConfig('group-1', 'kaneo_apikey', 'existing-key')
    setKaneoWorkspace('group-1', 'existing-workspace')

    const { reply, textCalls } = createMockReply()
    let provisionCalls = 0
    const deps: SetupCommandDeps = {
      isAuthorizedGroup: () => true,
      provisionAndConfigure: () => {
        provisionCalls++
        return Promise.resolve({ status: 'failed', error: 'should not be called' })
      },
      createWizard: () => ({ success: true, prompt: 'wizard-started' }),
      getConfig: getConfigWithExistingApiKey,
      getKaneoWorkspace: () => 'existing-workspace',
    }

    await startSetupForTarget('admin-1', reply, 'group-1', deps)

    expect(provisionCalls).toBe(0)
    expect(textCalls).toContain('wizard-started')
  })

  test('non-allowlisted group target is blocked before wizard creation', async () => {
    const { reply, textCalls } = createMockReply()
    const deps: SetupCommandDeps = {
      isAuthorizedGroup: () => false,
      provisionAndConfigure: () => Promise.resolve({ status: 'failed', error: 'should not be called' }),
      createWizard: () => ({ success: true, prompt: 'wizard-started' }),
      getConfig: () => null,
      getKaneoWorkspace: () => null,
    }

    await startSetupForTarget('admin-1', reply, 'group-1', deps)

    expect(textCalls[0]).toContain('/group add <group-id>')
  })
})
