// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type TelegramCommandVisibility = {
  readonly publishInDmUser: boolean
  readonly publishInDmAdmin: boolean
  readonly publishInGroupUser: boolean
  readonly publishInGroupAdmin: boolean
}

export type CommandCatalogEntry = {
  readonly name: string
  readonly description: string
  readonly telegram: TelegramCommandVisibility
}

const COMMAND_CATALOG: readonly CommandCatalogEntry[] = [
  {
    name: 'help',
    description: 'Show available commands',
    telegram: {
      publishInDmUser: true,
      publishInDmAdmin: true,
      publishInGroupUser: true,
      publishInGroupAdmin: true,
    },
  },
  {
    name: 'start',
    description: 'Show welcome and getting-started guidance',
    telegram: {
      publishInDmUser: true,
      publishInDmAdmin: true,
      publishInGroupUser: false,
      publishInGroupAdmin: false,
    },
  },
  {
    name: 'setup',
    description: 'Interactive configuration wizard',
    telegram: {
      publishInDmUser: true,
      publishInDmAdmin: true,
      publishInGroupUser: false,
      publishInGroupAdmin: false,
    },
  },
  {
    name: 'config',
    description: 'View or edit current configuration',
    telegram: {
      publishInDmUser: true,
      publishInDmAdmin: true,
      publishInGroupUser: false,
      publishInGroupAdmin: false,
    },
  },
  {
    name: 'context',
    description: 'Show current LLM context usage',
    telegram: {
      publishInDmUser: true,
      publishInDmAdmin: true,
      publishInGroupUser: true,
      publishInGroupAdmin: true,
    },
  },
  {
    name: 'clear',
    description: 'Clear conversation history and memory',
    telegram: {
      publishInDmUser: true,
      publishInDmAdmin: true,
      publishInGroupUser: true,
      publishInGroupAdmin: true,
    },
  },
  {
    name: 'group',
    description: 'Manage group authorization or membership',
    telegram: {
      publishInDmUser: false,
      publishInDmAdmin: true,
      publishInGroupUser: true,
      publishInGroupAdmin: true,
    },
  },
  {
    name: 'groups',
    description: 'List authorized groups',
    telegram: {
      publishInDmUser: false,
      publishInDmAdmin: true,
      publishInGroupUser: false,
      publishInGroupAdmin: false,
    },
  },
  {
    name: 'user',
    description: 'Manage users',
    telegram: {
      publishInDmUser: false,
      publishInDmAdmin: true,
      publishInGroupUser: false,
      publishInGroupAdmin: false,
    },
  },
  {
    name: 'users',
    description: 'List authorized users',
    telegram: {
      publishInDmUser: false,
      publishInDmAdmin: true,
      publishInGroupUser: false,
      publishInGroupAdmin: false,
    },
  },
  {
    name: 'announce',
    description: 'Send announcement to all authorized users',
    telegram: {
      publishInDmUser: false,
      publishInDmAdmin: true,
      publishInGroupUser: false,
      publishInGroupAdmin: false,
    },
  },
  {
    name: 'plugin',
    description: 'Manage plugins',
    telegram: {
      publishInDmUser: false,
      publishInDmAdmin: true,
      publishInGroupUser: false,
      publishInGroupAdmin: false,
    },
  },
]

export function listCommandCatalogEntries(): readonly CommandCatalogEntry[] {
  return COMMAND_CATALOG
}

export function getCommandCatalogEntry(name: string): CommandCatalogEntry {
  const entry = COMMAND_CATALOG.find((candidate) => candidate.name === name)

  if (entry === undefined) {
    throw new Error(`Unknown command catalog entry: ${name}`)
  }

  return entry
}
