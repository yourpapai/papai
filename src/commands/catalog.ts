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

export type CommandRegistration =
  | 'registerAdminCommands'
  | 'registerClearCommand'
  | 'registerConfigCommand'
  | 'registerContextCommand'
  | 'registerDashboardCommand'
  | 'registerGroupCommand'
  | 'registerHelpCommand'
  | 'registerStartCommand'

export type CommandCatalogEntry = {
  readonly name: string
  readonly description: string
  readonly registration: CommandRegistration
  readonly telegram: TelegramCommandVisibility
}

const COMMAND_CATALOG: readonly CommandCatalogEntry[] = [
  {
    name: 'help',
    description: 'Show available commands',
    registration: 'registerHelpCommand',
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
    registration: 'registerStartCommand',
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
    registration: 'registerConfigCommand',
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
    registration: 'registerContextCommand',
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
    registration: 'registerClearCommand',
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
    registration: 'registerGroupCommand',
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
    registration: 'registerGroupCommand',
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
    registration: 'registerAdminCommands',
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
    registration: 'registerAdminCommands',
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
    registration: 'registerAdminCommands',
    telegram: {
      publishInDmUser: false,
      publishInDmAdmin: true,
      publishInGroupUser: false,
      publishInGroupAdmin: false,
    },
  },
  {
    name: 'dashboard',
    description: 'Issue a one-time dashboard sign-in link',
    registration: 'registerDashboardCommand',
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
