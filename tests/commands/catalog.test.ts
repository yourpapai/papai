// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import * as commandCatalog from '../../src/commands/catalog.js'
import { listCommandCatalogEntries, type CommandRegistration } from '../../src/commands/catalog.js'
import * as commandRegistrations from '../../src/commands/index.js'

function getCommandRegistrationExport(
  name: CommandRegistration,
): (typeof commandRegistrations)[keyof typeof commandRegistrations] {
  return commandRegistrations[name]
}

describe('command catalog', () => {
  test('does not expose test-only entry lookup helpers', () => {
    expect('getCommandCatalogEntry' in commandCatalog).toBe(false)
  })

  test('contains the current papai command surface with Telegram publication metadata', () => {
    const entries = listCommandCatalogEntries()
    const names = entries.map((entry) => entry.name)
    const registrations = Object.fromEntries(entries.map((entry) => [entry.name, entry.registration]))
    const telegramVisibility = Object.fromEntries(entries.map((entry) => [entry.name, entry.telegram]))

    expect(names).toEqual([
      'help',
      'start',
      'setup',
      'config',
      'context',
      'clear',
      'group',
      'groups',
      'user',
      'users',
      'announce',
      'plugin',
    ])

    expect(telegramVisibility).toEqual({
      help: {
        publishInDmUser: true,
        publishInDmAdmin: true,
        publishInGroupUser: true,
        publishInGroupAdmin: true,
      },
      start: {
        publishInDmUser: true,
        publishInDmAdmin: true,
        publishInGroupUser: false,
        publishInGroupAdmin: false,
      },
      setup: {
        publishInDmUser: true,
        publishInDmAdmin: true,
        publishInGroupUser: false,
        publishInGroupAdmin: false,
      },
      config: {
        publishInDmUser: true,
        publishInDmAdmin: true,
        publishInGroupUser: false,
        publishInGroupAdmin: false,
      },
      context: {
        publishInDmUser: true,
        publishInDmAdmin: true,
        publishInGroupUser: true,
        publishInGroupAdmin: true,
      },
      clear: {
        publishInDmUser: true,
        publishInDmAdmin: true,
        publishInGroupUser: true,
        publishInGroupAdmin: true,
      },
      group: {
        publishInDmUser: false,
        publishInDmAdmin: true,
        publishInGroupUser: true,
        publishInGroupAdmin: true,
      },
      groups: {
        publishInDmUser: false,
        publishInDmAdmin: true,
        publishInGroupUser: false,
        publishInGroupAdmin: false,
      },
      user: {
        publishInDmUser: false,
        publishInDmAdmin: true,
        publishInGroupUser: false,
        publishInGroupAdmin: false,
      },
      users: {
        publishInDmUser: false,
        publishInDmAdmin: true,
        publishInGroupUser: false,
        publishInGroupAdmin: false,
      },
      announce: {
        publishInDmUser: false,
        publishInDmAdmin: true,
        publishInGroupUser: false,
        publishInGroupAdmin: false,
      },
      plugin: {
        publishInDmUser: false,
        publishInDmAdmin: true,
        publishInGroupUser: false,
        publishInGroupAdmin: false,
      },
    })

    expect(registrations).toEqual({
      help: 'registerHelpCommand',
      start: 'registerStartCommand',
      setup: 'registerSetupCommand',
      config: 'registerConfigCommand',
      context: 'registerContextCommand',
      clear: 'registerClearCommand',
      group: 'registerGroupCommand',
      groups: 'registerGroupCommand',
      user: 'registerAdminCommands',
      users: 'registerAdminCommands',
      announce: 'registerAdminCommands',
      plugin: 'registerPluginCommand',
    })

    for (const entry of entries) {
      const registration = getCommandRegistrationExport(entry.registration)

      expect(typeof registration).toBe('function')
    }
  })
})
