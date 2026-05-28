// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { getCommandCatalogEntry, listCommandCatalogEntries } from '../../src/commands/catalog.js'

describe('command catalog', () => {
  test('contains the current papai command surface with Telegram publication metadata', () => {
    const names = listCommandCatalogEntries().map((entry) => entry.name)

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

    expect(getCommandCatalogEntry('help')).toMatchObject({
      name: 'help',
      telegram: {
        publishInDmUser: true,
        publishInDmAdmin: true,
        publishInGroupUser: true,
        publishInGroupAdmin: true,
      },
    })

    expect(getCommandCatalogEntry('setup')).toMatchObject({
      name: 'setup',
      telegram: {
        publishInDmUser: true,
        publishInDmAdmin: true,
        publishInGroupUser: false,
        publishInGroupAdmin: false,
      },
    })
  })
})
